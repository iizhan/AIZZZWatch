import { app, BrowserWindow, ipcMain, nativeImage, net, session, Tray } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { getDataCenterSummary, getUiPreferences, listStations, publicStations, recordProfitUsageArchiveDay, recordTimeCostLedgerSnapshot, removeStation, saveAccountCostProfiles, saveAccountUpstreamMappings, saveGroupChangeEvents, saveHiddenGroupKeys, saveInternalUserProfiles, saveManualGroupTags, saveOperatingExcludedGroupKeys, saveStation, stationLoginCredentials, stationTokens, updateStationAutoReauthStatus, saveDismissedGroupChangeEventIds, type StoredStation } from './storage'
import { diagnoseStation } from './station-diagnostics'
import { hasUsableAdminCredential, isJwtExpiringSoon, resolveWebAuthTokens, Sub2ApiClient } from './sub2api-client'
import { NewApiClient } from './newapi-client'
import { createStationReadClient, usesSub2ApiContract } from './station-adapter'
import { collectWebAuthApiBaseUrls, isNewApiWebAuthContract, isWebAuthLoginRouteNotFound, readWebAuthProbeSnapshot, resolveWebAuthApiBaseUrl, resolveWebAuthApiPaths, resolveWebAuthCookieUrl, resolveWebAuthLaunchTarget, tryRestoreNewApiSession, tryRestoreWebAuthSession } from './web-auth'
import { classifySub2ApiError, createEmptySnapshot, normalizeStationApiPaths, normalizeStationBaseUrl, resolveStationApiRequestUrl, sameNumberSet } from '../shared/sub2api'
import { normalizeStationReadMapping } from '../shared/station-read-mapping'
import { buildProfitIntervalReport } from '../shared/time-cost-ledger'
import type { AccountGroupMutation, AccountUpstreamMapping, ProfitArchiveDayCoverage, ProfitIntervalQuery, StationAutoReauthStatus, StationDiagnostics, StationInput, StationMappingPreview, StationSnapshot, TimeCostLedger, UsageLedgerCoverage, WebAuthInput, WindowMode } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let bubbleWindow: BrowserWindow | null = null
let tray: Tray | null = null
let authWindow: BrowserWindow | null = null
let authPartition: string | null = null
let mode: WindowMode = 'full'
let alwaysOnTop = false
const snapshots = new Map<string, StationSnapshot>()
const pollers = new Map<string, NodeJS.Timeout>()
const sourceKeyFingerprints = new Map<string, Map<string, string>>()
const accountCredentialFingerprints = new Map<string, Map<number, string>>()
const autoReauthAttempts = new Map<string, Promise<void>>()
let autoReauthReservation: string | undefined
const autoReauthFailureCooldownMs = 5 * 60_000

app.setName('AIZZZWatch')
app.setAppUserModelId('com.aizzzwatch.desktop')
app.setPath('userData', process.env.AIZZZWATCH_USER_DATA_DIR?.trim() || join(app.getPath('appData'), 'AIZZZWatch'))
const hasSingleInstanceLock = app.requestSingleInstanceLock()

function nativeAssetPath(filename: 'icon.icns' | 'icon.ico'): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'assets', filename)
    : join(app.getAppPath(), 'assets', filename)
}

function createPlatformIcon() {
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.icns'
  const icon = nativeImage.createFromPath(nativeAssetPath(iconName))
  return icon.isEmpty() ? nativeImage.createEmpty() : icon
}

function rendererLaunchQuery(mode?: WindowMode): Record<string, string> {
  // The packaged renderer uses a stable file URL; give its HTML document a
  // fresh URL per launch so Electron never reuses an older cached shell.
  return { ...(mode ? { mode } : {}), launch: String(Date.now()) }
}

function electronFetch(input: string, init?: RequestInit): Promise<Response> {
  return net.fetch(input, init)
}

function createSub2ApiClient(input: ConstructorParameters<typeof Sub2ApiClient>[0]): Sub2ApiClient {
  return new Sub2ApiClient({ ...input, fetchImpl: electronFetch })
}

function credentialFingerprint(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

function updateUpstreamKeyLinks(stations: Awaited<ReturnType<typeof listStations>>): void {
  const sourceStationIds = new Set(stations.filter((station) => station.stationRole !== 'own').map((station) => station.id))
  const sourceCandidates = new Map<string, Array<{ stationId: string; keyId: string }>>()
  for (const [stationId, fingerprints] of sourceKeyFingerprints) {
    if (!sourceStationIds.has(stationId)) continue
    const keys = snapshots.get(stationId)?.sourceKeys ?? []
    const validKeyIds = new Set(keys.map((key) => key.id))
    for (const [keyId, fingerprint] of fingerprints) {
      if (!validKeyIds.has(keyId)) continue
      const current = sourceCandidates.get(fingerprint) ?? []
      current.push({ stationId, keyId })
      sourceCandidates.set(fingerprint, current)
    }
  }

  for (const [stationId, fingerprints] of accountCredentialFingerprints) {
    const snapshot = snapshots.get(stationId)
    if (!snapshot) continue
    snapshot.accounts = snapshot.accounts.map((account) => {
      const fingerprint = fingerprints.get(account.id)
      const candidates = fingerprint ? sourceCandidates.get(fingerprint) ?? [] : []
      const candidate = candidates.length === 1 ? candidates[0] : undefined
      if (candidate) return { ...account, upstreamSourceStationId: candidate.stationId, upstreamSourceKeyId: candidate.keyId }

      // A failed optional Key request must not erase an already-proven link.
      // When the next successful source read no longer has that Key, the link
      // is cleared normally by the reliable candidate pass above.
      const previousSourceState = account.upstreamSourceStationId
        ? snapshots.get(account.upstreamSourceStationId)?.sourceKeyReadState
        : undefined
      if (previousSourceState === 'stale' || previousSourceState === 'unavailable') return account

      const { upstreamSourceStationId: _previousStationId, upstreamSourceKeyId: _previousKeyId, ...baseAccount } = account
      return baseAccount
    })
  }
}

async function persistVerifiedUpstreamKeyLinks(): Promise<void> {
  const preferences = await getUiPreferences()
  const verified = new Map<string, AccountUpstreamMapping>()
  for (const snapshot of snapshots.values()) {
    for (const account of snapshot.accounts) {
      if (!account.upstreamSourceStationId || !account.upstreamSourceKeyId) continue
      const sourceSnapshot = snapshots.get(account.upstreamSourceStationId)
      const sourceKey = sourceSnapshot?.sourceKeys?.find((key) => key.id === account.upstreamSourceKeyId)
      const groupIds = [...new Set(sourceKey?.groupIds.filter((groupId) => Number.isInteger(groupId) && groupId > 0) ?? [])]
      if (!sourceKey || groupIds.length !== 1) continue
      verified.set(`${snapshot.stationId}:${account.id}`, {
        accountStationId: snapshot.stationId,
        accountId: account.id,
        sourceStationId: account.upstreamSourceStationId,
        sourceGroupId: groupIds[0],
        sourceKeyId: sourceKey.id,
        sourceKeyLabel: sourceKey.label,
        updatedAt: new Date().toISOString()
      })
    }
  }
  if (verified.size === 0) return
  const nextMappings = preferences.accountUpstreamMappings.map((mapping) => verified.get(`${mapping.accountStationId}:${mapping.accountId}`) ?? mapping)
  for (const [key, mapping] of verified) {
    if (!preferences.accountUpstreamMappings.some((item) => `${item.accountStationId}:${item.accountId}` === key)) nextMappings.push(mapping)
  }
  const same = nextMappings.length === preferences.accountUpstreamMappings.length
    && nextMappings.every((mapping, index) => {
      const current = preferences.accountUpstreamMappings[index]
      return current?.accountStationId === mapping.accountStationId && current.accountId === mapping.accountId
        && current.sourceStationId === mapping.sourceStationId && current.sourceGroupId === mapping.sourceGroupId
        && current.sourceKeyId === mapping.sourceKeyId
    })
  if (!same) await saveAccountUpstreamMappings(nextMappings)
}

function sendSnapshots(): void {
  mainWindow?.webContents.send('stations:snapshot-updated', [...snapshots.values()])
  bubbleWindow?.webContents.send('stations:snapshot-updated', [...snapshots.values()])
}

function sendStationsUpdated(stations: StoredStation[]): void {
  const publicStationList = publicStations(stations)
  mainWindow?.webContents.send('stations:updated', publicStationList)
  bubbleWindow?.webContents.send('stations:updated', publicStationList)
}

async function setStationAutoReauthStatus(id: string, state: StationAutoReauthStatus['state']): Promise<void> {
  const stations = await updateStationAutoReauthStatus(id, { state, at: new Date().toISOString() })
  sendStationsUpdated(stations)
}

function createPostMutationRefreshFailureSnapshot(stationId: string, stationName: string, error: unknown): StationSnapshot {
  const previous = snapshots.get(stationId) ?? createEmptySnapshot(stationId, stationName)
  const classified = classifySub2ApiError(error)
  return {
    ...previous,
    stationId,
    stationName,
    health: previous.lastSuccessAt ? 'stale' : 'error',
    errorCode: classified.code,
    errorMessage: `分组已提交，但刷新失败：${classified.message}`,
    lastUpdatedAt: new Date().toISOString()
  }
}

function isHttpsStation(station: Pick<StoredStation, 'baseUrl'>): boolean {
  try {
    return new URL(station.baseUrl).protocol === 'https:'
  } catch {
    return false
  }
}

function isSessionReauthorizationNeeded(snapshot: Pick<StationSnapshot, 'errorCode' | 'errorMessage'>): boolean {
  if (snapshot.errorCode === 'UNAUTHORIZED') return true
  if (snapshot.errorCode !== 'FORBIDDEN') return false
  return /session|cookie|jwt|token|\u4f1a\u8bdd|\u91cd\u65b0\u6388\u6743|\u767b\u5f55/i.test(snapshot.errorMessage ?? '')
}

function isAutoReauthCoolingDown(station: Pick<StoredStation, 'autoReauthStatus'>): boolean {
  const status = station.autoReauthStatus
  if (status?.state !== 'failed') return false
  const attemptedAt = new Date(status.at).getTime()
  return Number.isFinite(attemptedAt) && Date.now() - attemptedAt < autoReauthFailureCooldownMs
}

function webAuthInputFromStoredStation(station: StoredStation): WebAuthInput {
  return {
    id: station.id,
    name: station.name,
    baseUrl: station.baseUrl,
    apiBaseUrl: station.apiBaseUrl,
    stationRole: station.stationRole,
    adapterType: station.adapterType,
    detectedAdapterType: station.detectedAdapterType,
    rechargeRatio: station.rechargeRatio,
    lowBalanceThreshold: station.lowBalanceThreshold,
    apiPaths: station.apiPaths,
    adminCredentialType: station.adminCredentialType,
    pollingIntervalMs: station.pollingIntervalMs,
    useSavedLoginCredentials: true
  }
}

function scheduleStationAutoReauth(station: StoredStation): void {
  if (!station.autoReauthEnabled || !isHttpsStation(station) || isAutoReauthCoolingDown(station)) return
  if (autoReauthAttempts.has(station.id) || autoReauthReservation || (authWindow && !authWindow.isDestroyed())) return
  const credentials = stationLoginCredentials(station)
  if (!credentials.loginAccount || !credentials.loginPassword) return

  autoReauthReservation = station.id
  const attempt = (async () => {
    try {
      await setStationAutoReauthStatus(station.id, 'pending')
      await beginWebAuth(webAuthInputFromStoredStation(station), {
        autoSubmitSavedLogin: true,
        onManualInterventionRequired: () => {
          void setStationAutoReauthStatus(station.id, 'manual-required')
        }
      })
      await setStationAutoReauthStatus(station.id, 'success')
      await refreshStation(station.id, false).catch(() => undefined)
    } catch {
      await setStationAutoReauthStatus(station.id, 'failed').catch(() => undefined)
    }
  })()
  autoReauthAttempts.set(station.id, attempt)
  void attempt.finally(() => {
    autoReauthAttempts.delete(station.id)
    if (autoReauthReservation === station.id) autoReauthReservation = undefined
  })
}

async function refreshStation(id: string, allowTokenRefresh = true): Promise<StationSnapshot> {
  const stations = await listStations()
  const station = stations.find((item) => item.id === id)
  if (!station) throw new Error('找不到站点')
  let tokens = stationTokens(station)
  let client = createStationReadClient({ ...station, ...tokens, fetchImpl: electronFetch })
  const rotateStationTokens = async (): Promise<boolean> => {
    if (!(client instanceof Sub2ApiClient) && !(client instanceof NewApiClient)) return false
    if (client instanceof Sub2ApiClient && !tokens.refreshToken) return false
    if (client instanceof NewApiClient && !tokens.sessionCookie) return false
    try {
      const tokenPair = await client.refreshAccessToken()
      await saveStation({
        id: station.id,
        name: station.name,
        baseUrl: station.baseUrl,
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
        sessionCookie: 'sessionCookie' in tokenPair ? tokenPair.sessionCookie : undefined,
        pollingIntervalMs: station.pollingIntervalMs
      })
      const refreshedStations = await listStations()
      const refreshedStation = refreshedStations.find((item) => item.id === id)
      if (!refreshedStation) return false
      tokens = stationTokens(refreshedStation)
      client = createStationReadClient({ ...refreshedStation, ...tokens, fetchImpl: electronFetch })
      return true
    } catch {
      return false
    }
  }

  const canRefreshSession = (client instanceof Sub2ApiClient && Boolean(tokens.refreshToken))
    || (client instanceof NewApiClient && Boolean(tokens.sessionCookie))
  if (allowTokenRefresh && canRefreshSession && isJwtExpiringSoon(tokens.accessToken)) {
    await rotateStationTokens()
  }
  let next = await client.fetchSnapshot(snapshots.get(id))
  if (allowTokenRefresh && canRefreshSession && next.errorCode === 'UNAUTHORIZED') {
    const refreshed = await rotateStationTokens()
    if (refreshed) {
      next = await client.fetchSnapshot(snapshots.get(id))
    }
  }
  if (allowTokenRefresh && isSessionReauthorizationNeeded(next)) scheduleStationAutoReauth(station)
  let usageDetail: Awaited<ReturnType<Sub2ApiClient['fetchAdminUsageDetail']>> | undefined
  if (client instanceof Sub2ApiClient && next.health === 'healthy' && hasUsableAdminCredential({ ...station, ...tokens })) {
    try {
      const admin = await client.fetchAdminData()
      next.accounts = admin.accounts
      accountCredentialFingerprints.set(id, new Map([...client.getAdminAccountCredentials() ?? []].map(([accountId, value]) => [accountId, credentialFingerprint(value)])))
    } catch {
      // Admin data is optional for the monitoring snapshot.
      // Preserve the last exact match while the current account read is stale.
    }
    try {
      next.adminConsole = await client.fetchAdminConsoleData()
    } catch {
      // Admin console pages are optional and may vary across stations.
    }
    usageDetail = await client.fetchAdminUsageDetail()
  }
  const sourceCredentials = client instanceof Sub2ApiClient ? client.getSourceKeyCredentials() : undefined
  if (next.sourceKeyReadState === 'available') {
    sourceKeyFingerprints.set(id, new Map([...(sourceCredentials ?? [])].map(([keyId, value]) => [keyId, credentialFingerprint(value)])))
  } else if (next.sourceKeyReadState === 'not-configured') {
    // This station is no longer configured to read Keys, so an old runtime
    // fingerprint must not keep creating new automatic associations.
    sourceKeyFingerprints.delete(id)
  }
  snapshots.set(id, next)
  updateUpstreamKeyLinks(stations)
  await persistVerifiedUpstreamKeyLinks()
  if (next.health === 'healthy') await recordTimeCostLedgerSnapshot(station, next, usageDetail)
  sendSnapshots()
  return next
}

function clearPollers(): void {
  for (const poller of pollers.values()) clearInterval(poller)
  pollers.clear()
}

function refreshStationInBackground(id: string, stationName: string): void {
  void refreshStation(id).catch((error) => {
    const previous = snapshots.get(id) ?? createEmptySnapshot(id, stationName)
    const classified = classifySub2ApiError(error)
    snapshots.set(id, {
      ...previous,
      health: previous.lastSuccessAt ? 'stale' : 'error',
      errorCode: classified.code,
      errorMessage: classified.message,
      lastUpdatedAt: new Date().toISOString()
    })
    sendSnapshots()
  })
}

async function startPolling(autoRefresh = true): Promise<void> {
  clearPollers()
  const stations = await listStations()
  for (const station of stations) {
    if (!snapshots.has(station.id)) {
      const emptySnapshot = createEmptySnapshot(station.id, station.name)
      if (!autoRefresh) emptySnapshot.health = 'empty'
      snapshots.set(station.id, emptySnapshot)
    }
    if (autoRefresh) {
      refreshStationInBackground(station.id, station.name)
      pollers.set(station.id, setInterval(() => refreshStationInBackground(station.id, station.name), station.pollingIntervalMs))
    }
  }
  sendSnapshots()
}

async function schedulePollingTimers(): Promise<void> {
  clearPollers()
  const stations = await listStations()
  for (const station of stations) {
    pollers.set(station.id, setInterval(() => refreshStationInBackground(station.id, station.name), station.pollingIntervalMs))
  }
}

function createBubbleWindow(): void {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.show()
    bubbleWindow.focus()
    return
  }
  bubbleWindow = new BrowserWindow({
    width: 112,
    height: 112,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void bubbleWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}?mode=bubble`)
  } else {
    void bubbleWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: rendererLaunchQuery('bubble') })
  }
  bubbleWindow.on('closed', () => {
    bubbleWindow = null
  })
}

function applyWindowMode(nextMode: WindowMode): void {
  mode = nextMode
  if (!mainWindow) return
  if (nextMode === 'bubble') {
    mainWindow.webContents.send('window:mode', { mode, alwaysOnTop })
    mainWindow.hide()
    createBubbleWindow()
    return
  }

  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.destroy()
    bubbleWindow = null
  }
  mainWindow.show()
  if (nextMode === 'full') {
    mainWindow.setResizable(true)
    mainWindow.setSize(1080, 760)
    mainWindow.setMinimumSize(760, 540)
    mainWindow.setAlwaysOnTop(alwaysOnTop)
  } else if (nextMode === 'compact') {
    mainWindow.setResizable(true)
    mainWindow.setSize(520, 680)
    mainWindow.setMinimumSize(420, 520)
    mainWindow.setAlwaysOnTop(true, 'floating')
  }
  mainWindow.webContents.send('window:mode', { mode, alwaysOnTop })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 760,
    minHeight: 540,
    title: 'AIZZZWatch',
    icon: createPlatformIcon(),
    show: false,
    backgroundColor: '#F4F6F8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: rendererLaunchQuery() })
  }
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    applyWindowMode(mode)
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function revealMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (mode === 'bubble') {
    applyWindowMode('full')
    return
  }
  mainWindow.show()
  mainWindow.focus()
}

async function closeAuthWindow(): Promise<void> {
  const windowToClose = authWindow
  const partition = authPartition
  authWindow = null
  authPartition = null
  if (windowToClose && !windowToClose.isDestroyed()) windowToClose.destroy()
  if (partition) {
    try {
      await session.fromPartition(partition).clearStorageData()
    } catch {
      // Temporary authorization storage is best-effort cleanup.
    }
  }
}

function isSameOrigin(url: string, stationBaseUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(stationBaseUrl).origin
  } catch {
    return false
  }
}

type SavedLoginFillResult = 'filled' | 'submitted' | 'manual-required' | 'unavailable'

interface WebAuthFlowOptions {
  autoSubmitSavedLogin?: boolean
  onManualInterventionRequired?: () => void
}

async function hasWebAuthSecurityChallenge(loginWindow: BrowserWindow, stationBaseUrl: string): Promise<boolean> {
  if (loginWindow.isDestroyed() || !isSameOrigin(loginWindow.webContents.getURL(), stationBaseUrl)) return false
  const script = `(() => {
    const form = document.querySelector('form') || document
    const pageText = [document.body?.innerText, form.textContent].filter(Boolean).join(' ').toLowerCase()
    return Boolean(document.querySelector('[data-sitekey], iframe[src*="captcha" i], iframe[src*="hcaptcha" i], iframe[src*="turnstile" i], input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="totp" i]'))
      || /captcha|\\u9a8c\\u8bc1\\u7801|\\u4eba\\u673a\\u9a8c\\u8bc1|verify you are human|two[ -]?factor|\\u4e8c\\u6b21\\u9a8c\\u8bc1|\\u5b89\\u5168\\u9a8c\\u8bc1/.test(pageText)
  })()`
  try {
    return Boolean(await loginWindow.webContents.executeJavaScript(script, true))
  } catch {
    return false
  }
}

async function fillSavedLoginCredentials(loginWindow: BrowserWindow, stationBaseUrl: string, credentials: { loginAccount: string; loginPassword: string }, autoSubmit = false): Promise<SavedLoginFillResult> {
  if (loginWindow.isDestroyed() || !isSameOrigin(loginWindow.webContents.getURL(), stationBaseUrl)) return 'unavailable'
  const script = `(() => {
    const credentials = ${JSON.stringify(credentials)}
    const visible = (element) => Boolean(element && !element.disabled && element.offsetParent !== null)
    const password = [...document.querySelectorAll('input[type="password"]')].find(visible)
    if (!password) return 'unavailable'
    const form = password.closest('form') || document
    const account = [...form.querySelectorAll('input')].find((element) => {
      if (!visible(element) || element === password) return false
      const type = (element.getAttribute('type') || 'text').toLowerCase()
      const hint = [element.name, element.id, element.autocomplete, element.placeholder].filter(Boolean).join(' ').toLowerCase()
      return type === 'email' || /email|mail|user|account|login|phone|mobile/.test(hint)
    })
    if (!account) return 'unavailable'
    const assign = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (!setter) return false
      setter.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
    if (!assign(account, credentials.loginAccount) || !assign(password, credentials.loginPassword)) return 'unavailable'
    if (!${JSON.stringify(autoSubmit)}) return 'filled'
    const pageText = [document.body?.innerText, form.textContent].filter(Boolean).join(' ').toLowerCase()
    const hasChallenge = Boolean(document.querySelector('[data-sitekey], iframe[src*="captcha" i], iframe[src*="hcaptcha" i], iframe[src*="turnstile" i], input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="totp" i]'))
      || /captcha|\u9a8c\u8bc1\u7801|\u4eba\u673a\u9a8c\u8bc1|verify you are human|two[ -]?factor|\u4e8c\u6b21\u9a8c\u8bc1|\u5b89\u5168\u9a8c\u8bc1/.test(pageText)
    if (hasChallenge) return 'manual-required'
    const submit = [...form.querySelectorAll('button, input[type="submit"]')].find((element) => {
      if (!visible(element)) return false
      const type = (element.getAttribute('type') || '').toLowerCase()
      const label = [element.textContent, element.getAttribute('value'), element.getAttribute('aria-label'), element.getAttribute('title')].filter(Boolean).join(' ').toLowerCase()
      return type === 'submit' || /login|sign in|\u767b\u5f55|\u767b\u5165/.test(label)
    })
    if (!submit) return 'manual-required'
    submit.click()
    return 'submitted'
  })()`
  try {
    const result = await loginWindow.webContents.executeJavaScript(script, true)
    return result === 'filled' || result === 'submitted' || result === 'manual-required' ? result : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

async function beginWebAuth(input: WebAuthInput, options: WebAuthFlowOptions = {}): Promise<ReturnType<typeof publicStations>> {
  const name = input.name.trim()
  if (!name) throw new Error('站点名称不能为空')
  const baseUrl = input.baseUrl.trim()
  if (!baseUrl) throw new Error('站点地址不能为空')
  const normalizedBaseUrl = normalizeStationBaseUrl(baseUrl, input.adapterType === 'auto' ? input.detectedAdapterType : input.adapterType)
  const newApiAuth = isNewApiWebAuthContract(input)
  const authLaunchTarget = resolveWebAuthLaunchTarget(normalizedBaseUrl, newApiAuth)
  if (authWindow && !authWindow.isDestroyed()) {
    if (!authWindow.isVisible()) authWindow.show()
    authWindow.focus()
    throw new Error('已有授权窗口打开')
  }
  const storedStation = input.id ? (await listStations()).find((station) => station.id === input.id) : undefined
  let savedLoginCredentials: { loginAccount: string; loginPassword: string } | undefined
  let savedCredentialsBaseUrl: string | undefined
  if (input.useSavedLoginCredentials) {
    const saved = storedStation ? stationLoginCredentials(storedStation) : undefined
    if (!saved?.loginAccount || !saved.loginPassword) throw new Error('该站点没有已保存的网页登录账号密码，请先在编辑站点中保存。')
    if (!storedStation || !isSameOrigin(normalizedBaseUrl, storedStation.baseUrl)) {
      throw new Error('站点地址已变更。请先保存新的站点地址，再使用已保存账号密码授权。')
    }
    savedLoginCredentials = { loginAccount: saved.loginAccount, loginPassword: saved.loginPassword }
    savedCredentialsBaseUrl = storedStation.baseUrl
  }

  const partition = `aizzz-auth-${randomUUID()}`
  authPartition = partition
  const loginWindow = new BrowserWindow({
    width: 520,
    height: 760,
    title: `登录 ${name}`,
    show: !options.autoSubmitSavedLogin,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      partition
    }
  })
  authWindow = loginWindow

  return new Promise<ReturnType<typeof publicStations>>((resolve, reject) => {
    let settled = false
    let poller: NodeJS.Timeout | undefined
    let automaticAuthTimeout: NodeJS.Timeout | undefined
    let requestedClientLoginRoute = false
    let authRouteFallbackUsed = false
    const missingAuthRoutePaths: string[] = []
    let savedLoginFilled = false
    let manualInterventionRequired = false
    const requestManualIntervention = (): void => {
      if (!options.autoSubmitSavedLogin || manualInterventionRequired) return
      manualInterventionRequired = true
      if (automaticAuthTimeout) clearTimeout(automaticAuthTimeout)
      options.onManualInterventionRequired?.()
      if (!loginWindow.isDestroyed()) {
        loginWindow.show()
        loginWindow.focus()
      }
    }
    const fillSavedLogin = (): void => {
      if (!savedLoginCredentials || savedLoginFilled) return
      void fillSavedLoginCredentials(loginWindow, savedCredentialsBaseUrl ?? normalizedBaseUrl, savedLoginCredentials, Boolean(options.autoSubmitSavedLogin)).then((result) => {
        if (result !== 'unavailable') savedLoginFilled = true
        if (result === 'manual-required') requestManualIntervention()
      })
    }
    const finish = async (callback: () => void): Promise<void> => {
      if (settled) return
      settled = true
      if (poller) clearInterval(poller)
      if (automaticAuthTimeout) clearTimeout(automaticAuthTimeout)
      await closeAuthWindow()
      callback()
    }
    const capture = async (): Promise<void> => {
      if (loginWindow.isDestroyed()) return
      try {
        const probe = await readWebAuthProbeSnapshot(loginWindow)
        const loginPageUrl = loginWindow.webContents.getURL()
        const explicitApiBaseUrl = input.apiBaseUrl?.trim().replace(/\/+$/g, '') || undefined
        const apiBaseUrls = collectWebAuthApiBaseUrls({
          loginPageUrl,
          normalizedBaseUrl,
          inputApiBaseUrl: explicitApiBaseUrl,
          pageApiBaseUrl: probe.pageApiBaseUrl
        })
        const newApiAuthRefreshPath = newApiAuth ? input.apiPaths?.authRefresh : undefined
        const cookieSets = await Promise.all(apiBaseUrls.map(async (apiBaseUrl) => {
          const cookieUrl = resolveWebAuthCookieUrl(apiBaseUrl, newApiAuth, newApiAuthRefreshPath)
          const cookies = await session.fromPartition(partition).cookies.get({ url: cookieUrl }).catch(() => [])
          return { apiBaseUrl, cookies }
        }))
        const resolvedTokens = resolveWebAuthTokens(probe as Record<string, string | undefined>, cookieSets.flatMap((item) => item.cookies))
        let resolvedApiBaseUrl = newApiAuth
          ? (explicitApiBaseUrl ?? normalizedBaseUrl).replace(/\/api\/v1\/?$/i, '')
          : resolveWebAuthApiBaseUrl({
              normalizedBaseUrl,
              inputApiBaseUrl: explicitApiBaseUrl,
              pageApiBaseUrl: probe.pageApiBaseUrl
            })
        let restoredSessionCookie: string | undefined
        if (!resolvedTokens.accessToken) {
          for (const { apiBaseUrl, cookies } of cookieSets) {
            const restored = newApiAuth
              ? await tryRestoreNewApiSession({
                  fetchImpl: electronFetch,
                  apiBaseUrl,
                  authRefreshPath: newApiAuthRefreshPath,
                  cookies,
                  userAgent: loginWindow.webContents.getUserAgent()
                })
              : await tryRestoreWebAuthSession({
                  fetchImpl: electronFetch,
                  apiBaseUrl,
                  authClientId: probe.authClientId,
                  cookies,
                  userAgent: loginWindow.webContents.getUserAgent()
                })
            if (!restored?.accessToken) continue
            resolvedTokens.accessToken = restored.accessToken
            resolvedTokens.refreshToken = resolvedTokens.refreshToken || restored.refreshToken
            restoredSessionCookie = restored.sessionCookie
            resolvedApiBaseUrl = resolvedApiBaseUrl || apiBaseUrl
            break
          }
        }
        if (!resolvedTokens.accessToken) return
        const saveApiBaseUrl = resolvedApiBaseUrl
        const cookieSource = cookieSets.find((item) => item.apiBaseUrl === (saveApiBaseUrl || normalizedBaseUrl))
          ?? cookieSets.find((item) => item.cookies.length > 0)
        const sessionCookie = restoredSessionCookie
          ?? cookieSource?.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
        const userAgent = loginWindow.webContents.getUserAgent()
        const stations = await saveStation({
          id: input.id,
          name,
          baseUrl: normalizedBaseUrl,
          apiBaseUrl: saveApiBaseUrl,
          stationRole: input.stationRole,
          adapterType: input.adapterType,
          detectedAdapterType: input.detectedAdapterType,
          rechargeRatio: input.rechargeRatio,
          lowBalanceThreshold: input.lowBalanceThreshold,
          apiPaths: resolveWebAuthApiPaths(normalizedBaseUrl, input.apiPaths),
          adminCredentialType: input.adminCredentialType,
          pollingIntervalMs: input.pollingIntervalMs,
          accessToken: resolvedTokens.accessToken,
          refreshToken: resolvedTokens.refreshToken,
          sessionCookie,
          userAgent
        })
        await finish(() => resolve(publicStations(stations)))
      } catch (error) {
        await finish(() => reject(error instanceof Error ? error : new Error('网页登录授权失败')))
      }
    }
    const tryFallbackAuthRoute = async (): Promise<boolean> => {
      if (!authLaunchTarget.fallbackUrl || authRouteFallbackUsed || loginWindow.isDestroyed()) return false
      const routeMissing = await isWebAuthLoginRouteNotFound(loginWindow, authLaunchTarget.loadUrl)
      if (!routeMissing) return false
      try {
        const currentPath = new URL(loginWindow.webContents.getURL()).pathname
        missingAuthRoutePaths.push(currentPath)
      } catch {
        // The expected primary path below remains useful in the final error.
      }
      authRouteFallbackUsed = true
      try {
        await loginWindow.loadURL(authLaunchTarget.fallbackUrl)
      } catch (error) {
        await finish(() => reject(error instanceof Error ? error : new Error('网页登录备用入口加载失败')))
      }
      return true
    }
    const reportMissingAuthRoute = async (): Promise<boolean> => {
      if (!authRouteFallbackUsed || loginWindow.isDestroyed()) return false
      const routeMissing = await isWebAuthLoginRouteNotFound(loginWindow, authLaunchTarget.fallbackUrl ?? authLaunchTarget.loadUrl)
      if (!routeMissing) return false
      try {
        missingAuthRoutePaths.push(new URL(loginWindow.webContents.getURL()).pathname)
      } catch {
        // The fixed fallback path below still documents the attempted route.
      }
      const attemptedPaths = [...new Set([...missingAuthRoutePaths, new URL(authLaunchTarget.loadUrl).pathname, new URL(authLaunchTarget.fallbackUrl ?? authLaunchTarget.loadUrl).pathname])]
      await finish(() => reject(new Error(`AUTH_LOGIN_ROUTE_NOT_FOUND:${attemptedPaths.join(',')}`)))
      return true
    }
    loginWindow.webContents.on('did-finish-load', () => {
      void (async () => {
        if (authLaunchTarget.clientRoute && !requestedClientLoginRoute) {
          requestedClientLoginRoute = true
          await loginWindow.webContents.executeJavaScript(`(() => {
            if (window.location.pathname === ${JSON.stringify(authLaunchTarget.clientRoute)}) return true
            window.history.pushState({}, '', ${JSON.stringify(authLaunchTarget.clientRoute)})
            window.dispatchEvent(new PopStateEvent('popstate'))
            return true
          })()`, true)
        }
        if (await tryFallbackAuthRoute()) return
        if (await reportMissingAuthRoute()) return
        fillSavedLogin()
        void capture()
        if (!poller) poller = setInterval(() => {
          if (!savedLoginFilled) fillSavedLogin()
          else if (options.autoSubmitSavedLogin && !manualInterventionRequired) {
            void hasWebAuthSecurityChallenge(loginWindow, savedCredentialsBaseUrl ?? normalizedBaseUrl).then((hasChallenge) => {
              if (hasChallenge) requestManualIntervention()
            })
          }
          void capture()
        }, 700)
      })().catch((error: unknown) => {
        void finish(() => reject(error instanceof Error ? error : new Error('新版网页登录路由跳转失败')))
      })
    })
    loginWindow.webContents.on('did-navigate-in-page', fillSavedLogin)
    loginWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      if (errorCode === -3) return
      void finish(() => reject(new Error(`网页登录页面加载失败 (${errorCode}): ${errorDescription}`)))
    })
    loginWindow.on('closed', () => {
      void finish(() => reject(new Error('AUTH_CANCELLED')))
    })
    if (options.autoSubmitSavedLogin) {
      automaticAuthTimeout = setTimeout(() => {
        void finish(() => reject(new Error('AUTO_AUTH_TIMEOUT')))
      }, 45_000)
    }
    void loginWindow.loadURL(authLaunchTarget.loadUrl)
  })
}

function createTray(): void {
  tray = new Tray(createPlatformIcon())
  if (process.platform === 'darwin') tray.setTitle('AW')
  tray.setToolTip('AIZZZWatch')
  tray.on('click', () => {
    if (mode === 'bubble' && bubbleWindow) {
      if (bubbleWindow.isVisible()) {
        bubbleWindow.hide()
        return
      }
      revealMainWindow()
      return
    }
    if (mode === 'bubble' && !bubbleWindow) {
      revealMainWindow()
      return
    }
    if (!mainWindow) createWindow()
    else if (mainWindow.isVisible()) mainWindow.hide()
    else revealMainWindow()
  })
}

function positiveOptionalInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new Error(`${label}无效`)
  return value
}

function validateProfitIntervalQuery(input: unknown): ProfitIntervalQuery {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('收益核算参数无效')
  const query = input as Partial<ProfitIntervalQuery>
  if (typeof query.stationId !== 'string' || !query.stationId.trim()) throw new Error('请选择管理员站点')
  if (query.timezone !== 'Asia/Shanghai') throw new Error('收益核算仅支持 Asia/Shanghai 时区')
  if (query.granularity !== 'day' && query.granularity !== 'hour') throw new Error('收益核算粒度无效')
  if (typeof query.startAt !== 'string' || typeof query.endAt !== 'string') throw new Error('请选择有效的核算区间')
  const start = Date.parse(query.startAt)
  const end = Date.parse(query.endAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('核算区间必须满足开始早于结束')
  const maximumRangeMs = (query.granularity === 'hour' ? 7 : 90) * 24 * 60 * 60 * 1_000
  if (end - start > maximumRangeMs) {
    throw new Error(query.granularity === 'hour' ? '按小时核算最多 7 天，请缩短区间或切换为按天' : '按天核算最多 90 天，请缩短区间')
  }
  return {
    stationId: query.stationId.trim(),
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
    timezone: 'Asia/Shanghai',
    granularity: query.granularity,
    accountId: positiveOptionalInteger(query.accountId, '账号筛选'),
    sellingGroupId: positiveOptionalInteger(query.sellingGroupId, '售卖分组筛选')
  }
}

function shanghaiDate(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function archiveDates(query: ProfitIntervalQuery): string[] {
  const dates: string[] = []
  const endDate = shanghaiDate(query.endAt)
  let cursor = new Date(`${shanghaiDate(query.startAt)}T00:00:00+08:00`)
  while (shanghaiDate(cursor.toISOString()) !== endDate) {
    dates.push(shanghaiDate(cursor.toISOString()))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function dayArchiveQuery(query: ProfitIntervalQuery, date: string): ProfitIntervalQuery {
  const start = new Date(`${date}T00:00:00+08:00`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return {
    ...query,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    accountId: undefined,
    sellingGroupId: undefined
  }
}

function archiveCoverageForQuery(ledger: TimeCostLedger, query: ProfitIntervalQuery): UsageLedgerCoverage {
  const dates = archiveDates(query)
  const coverageByDate = new Map(ledger.profitUsageCoverage
    .filter((item) => item.accountStationId === query.stationId)
    .map((item) => [item.date, item]))
  const covered = dates.map((date) => coverageByDate.get(date)).filter((item): item is ProfitArchiveDayCoverage => Boolean(item))
  const missing = dates.length - covered.length
  const pageLimited = covered.filter((item) => item.state === 'page-limit')
  const interrupted = covered.filter((item) => item.state === 'incomplete' || item.state === 'unavailable')
  const state: UsageLedgerCoverage['state'] = missing > 0 || interrupted.length > 0
    ? 'incomplete'
    : pageLimited.length > 0
      ? 'page-limit'
      : covered.length > 0 ? 'complete' : 'unavailable'
  const details = [
    `完整 ${covered.filter((item) => item.state === 'complete').length} 天`,
    pageLimited.length > 0 ? `部分 ${pageLimited.length} 天` : undefined,
    interrupted.length > 0 ? `失败 ${interrupted.length} 天` : undefined,
    missing > 0 ? `未归档 ${missing} 天` : undefined
  ].filter(Boolean).join(' · ')
  return {
    accountStationId: query.stationId,
    fetchedAt: covered.map((item) => item.fetchedAt).sort((left, right) => right.localeCompare(left))[0] ?? new Date().toISOString(),
    state,
    pagesFetched: covered.reduce((total, item) => total + item.pagesFetched, 0),
    recordsSeen: covered.reduce((total, item) => total + item.recordsSeen, 0),
    acceptedEntries: covered.reduce((total, item) => total + item.acceptedEntries, 0),
    detail: details || '尚未归档'
  }
}

function registerIpc(): void {
  ipcMain.handle('auth:login', async (_event, input: WebAuthInput) => {
    const stations = await beginWebAuth(input)
    await startPolling()
    return stations
  })
  ipcMain.handle('stations:list', async () => publicStations(await listStations()))
  ipcMain.handle('stations:save', async (_event, input: StationInput) => {
    const stations = await saveStation(input)
    await startPolling()
    return publicStations(stations)
  })
  ipcMain.handle('stations:diagnose', async (_event, input: Pick<StationInput, 'id' | 'name' | 'baseUrl' | 'apiBaseUrl' | 'adapterType' | 'accessToken' | 'refreshToken' | 'adminToken' | 'adminCredentialType' | 'apiPaths'>): Promise<StationDiagnostics> => {
    const stored = input.id ? (await listStations()).find((station) => station.id === input.id) : undefined
    const storedTokens = stored ? stationTokens(stored) : undefined
    return diagnoseStation({
      ...stored,
      ...input,
      accessToken: input.accessToken?.trim() || storedTokens?.accessToken,
      refreshToken: input.refreshToken?.trim() || storedTokens?.refreshToken,
      adminToken: input.adminToken?.trim() || storedTokens?.adminToken,
      sessionCookie: storedTokens?.sessionCookie,
      userAgent: storedTokens?.userAgent,
      fetchImpl: electronFetch
    })
  })
  ipcMain.handle('stations:preview-mapping', async (_event, input: Pick<StationInput, 'id' | 'apiPaths' | 'readMapping'>): Promise<StationMappingPreview> => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.id !== 'string' || !input.id.trim()) {
      throw new Error('读取映射检测参数无效')
    }
    const stored = input.id ? (await listStations()).find((station) => station.id === input.id) : undefined
    if (!stored) throw new Error('请先保存站点基础信息，再检测读取映射')
    const storedTokens = stationTokens(stored)
    const hasReadMappingInput = Object.prototype.hasOwnProperty.call(input, 'readMapping')
    const station = {
      ...stored,
      apiPaths: normalizeStationApiPaths(input.apiPaths ?? stored.apiPaths),
      readMapping: hasReadMappingInput ? normalizeStationReadMapping(input.readMapping) : stored.readMapping,
      accessToken: storedTokens.accessToken,
      refreshToken: storedTokens.refreshToken,
      adminToken: storedTokens.adminToken,
      sessionCookie: storedTokens.sessionCookie,
      userAgent: storedTokens.userAgent,
      fetchImpl: electronFetch
    }
    if (!usesSub2ApiContract(station)) throw new Error('NewAPI 当前使用内置只读适配器，不开放 Sub2API 字段映射')
    if (Object.keys(station.readMapping?.capabilities ?? {}).length > 0 && new URL(station.apiBaseUrl ?? station.baseUrl).protocol !== 'https:') {
      throw new Error('自定义读取映射仅允许 HTTPS 站点')
    }
    for (const path of Object.values(station.apiPaths)) {
      if (path) resolveStationApiRequestUrl(station.apiBaseUrl ?? station.baseUrl, path)
    }
    return new Sub2ApiClient(station).previewReadMapping()
  })
  ipcMain.handle('stations:remove', async (_event, id: string) => {
    const stations = await removeStation(id)
    snapshots.delete(id)
    sourceKeyFingerprints.delete(id)
    accountCredentialFingerprints.delete(id)
    await startPolling()
    return publicStations(stations)
  })
  ipcMain.handle('stations:refresh', async (_event, id?: string) => {
    const result = id
      ? [await refreshStation(id)]
      : await Promise.all((await listStations()).map((station) => refreshStation(station.id)))
    await schedulePollingTimers()
    return result
  })
  ipcMain.handle('stations:snapshots', () => [...snapshots.values()])
  ipcMain.handle('preferences:get', () => getUiPreferences())
  ipcMain.handle('preferences:set-hidden-groups', (_event, keys: string[]) => saveHiddenGroupKeys(keys))
  ipcMain.handle('preferences:set-operating-excluded-groups', (_event, keys: string[]) => saveOperatingExcludedGroupKeys(keys))
  ipcMain.handle('preferences:set-manual-group-tags', (_event, tags) => saveManualGroupTags(tags))
  ipcMain.handle('preferences:set-group-change-events', (_event, events) => saveGroupChangeEvents(events))
  ipcMain.handle('preferences:set-dismissed-group-change-event-ids', (_event, ids: string[]) => saveDismissedGroupChangeEventIds(ids))
  ipcMain.handle('preferences:set-account-upstream-mappings', (_event, mappings) => saveAccountUpstreamMappings(mappings))
  ipcMain.handle('preferences:set-account-cost-profiles', (_event, profiles) => saveAccountCostProfiles(profiles))
  ipcMain.handle('preferences:set-internal-user-profiles', (_event, profiles) => saveInternalUserProfiles(profiles))
  ipcMain.handle('data-center:get-summary', () => getDataCenterSummary())
  ipcMain.handle('window:set-mode', (_event, nextMode: WindowMode) => {
    if (!['full', 'compact', 'bubble'].includes(nextMode)) throw new Error('不支持的窗口模式')
    applyWindowMode(nextMode)
    return { mode }
  })
  ipcMain.handle('window:toggle-on-top', () => {
    alwaysOnTop = !alwaysOnTop
    if (mode === 'full') mainWindow?.setAlwaysOnTop(alwaysOnTop)
    mainWindow?.webContents.send('window:mode', { mode, alwaysOnTop })
    return { alwaysOnTop }
  })
  ipcMain.handle('window:show', () => {
    if (mode === 'bubble') applyWindowMode('compact')
    mainWindow?.show()
    mainWindow?.focus()
  })
  ipcMain.handle('profit:load', async (_event, input: unknown) => {
    const query = validateProfitIntervalQuery(input)
    const stations = await listStations()
    const station = stations.find((item) => item.id === query.stationId)
    if (station && !usesSub2ApiContract(station)) throw new Error('NewAPI 当前只支持只读余额、令牌和模型能力，不支持 Sub2API 收益核算')
    if (!station) throw new Error('找不到我的站点')
    const preferences = await getUiPreferences()
    const records = preferences.timeCostLedger.profitUsageRecords.filter((record) => record.accountStationId === query.stationId)
    const exemptAccountKeys = new Set(preferences.accountCostProfiles
      .filter((profile) => profile.kind === 'self-owned-exempt')
      .map((profile) => `${profile.accountStationId}:${profile.accountId}`))
    const internalUserKeys = new Set(preferences.internalUserProfiles
      .map((profile) => `${profile.accountStationId}:${profile.userId}`))
    const operatingExcludedGroupKeys = new Set(preferences.operatingExcludedGroupKeys)
    return buildProfitIntervalReport(
      query,
      records,
      archiveCoverageForQuery(preferences.timeCostLedger, query),
      preferences.timeCostLedger,
      { exemptAccountKeys, internalUserKeys, operatingExcludedGroupKeys }
    )
  })
  ipcMain.handle('profit:archive', async (_event, input: unknown, options: unknown) => {
    const query = validateProfitIntervalQuery(input)
    const dates = archiveDates(query)
    if (dates.length > 7) throw new Error('单次最多归档 7 天，请缩短日期范围后继续')
    const stations = await listStations()
    const station = stations.find((item) => item.id === query.stationId)
    const tokens = station ? stationTokens(station) : undefined
    if (station && !usesSub2ApiContract(station)) throw new Error('NewAPI 当前不支持 Sub2API 收益归档')
    if (!station || !tokens || !hasUsableAdminCredential({ ...station, ...tokens })) throw new Error('未配置可用的管理员登录凭据')
    const client = new Sub2ApiClient({ ...station, ...tokens, fetchImpl: electronFetch })
    const preferences = await getUiPreferences()
    const existing = new Map(preferences.timeCostLedger.profitUsageCoverage
      .filter((item) => item.accountStationId === station.id)
      .map((item) => [item.date, item]))
    const archived: ProfitArchiveDayCoverage[] = []
    for (const date of dates) {
      const previous = existing.get(date)
      const force = Boolean(options && typeof options === 'object' && (options as { force?: unknown }).force === true)
      if (previous?.state === 'complete' && !force) {
        archived.push(previous)
        continue
      }
      const result = await client.fetchAdminProfitUsage(dayArchiveQuery(query, date))
      const coverage: ProfitArchiveDayCoverage = { ...result.coverage, date }
      await recordProfitUsageArchiveDay(result.records, coverage)
      archived.push(coverage)
    }
    return archived
  })
  ipcMain.handle('admin:update-account-groups', async (_event, mutation: AccountGroupMutation) => {
    const stations = await listStations()
    const station = stations.find((item) => item.id === mutation.stationId)
    const tokens = station ? stationTokens(station) : undefined
    if (station && !usesSub2ApiContract(station)) throw new Error('NewAPI 当前不支持 Sub2API 分组组合管理')
    if (!station || !tokens || !hasUsableAdminCredential({ ...station, ...tokens })) throw new Error('未配置管理员登录凭据')
    if (!Number.isInteger(mutation.accountId) || mutation.accountId <= 0) throw new Error('账号 ID 无效')
    const nextGroupIds = [...new Set(mutation.nextGroupIds)]
    if (nextGroupIds.length === 0 || nextGroupIds.some((id) => !Number.isInteger(id) || id <= 0)) throw new Error('目标分组无效')
    const client = createSub2ApiClient({ ...station, ...tokens })
    const admin = await client.fetchAdminData()
    const currentAccount = admin.accounts.find((account) => account.id === mutation.accountId)
    if (!currentAccount) throw new Error('远程账号不存在，请刷新后重试')
    if (!sameNumberSet(currentAccount.groupIds, mutation.previousGroupIds)) throw new Error('远程分组已变化，请刷新后重新确认')
    const validGroupIds = new Set(admin.groups.map((group) => group.id))
    if (nextGroupIds.some((id) => !validGroupIds.has(id))) throw new Error('目标分组不存在或已停用')
    await client.updateAccountGroups({ ...mutation, nextGroupIds })
    try {
      return await refreshStation(mutation.stationId)
    } catch (error) {
      const fallback = createPostMutationRefreshFailureSnapshot(station.id, station.name, error)
      snapshots.set(station.id, fallback)
      sendSnapshots()
      return fallback
    }
  })
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    revealMainWindow()
  })

  app.whenReady().then(() => {
    registerIpc()
    createWindow()
    createTray()
    // Polling belongs to the application lifecycle, not window events: a
    // hidden, compact, or slow-to-render window must still start monitoring.
    void startPolling()
    app.on('activate', () => {
      revealMainWindow()
    })
  })

  app.on('before-quit', () => {
    clearPollers()
    void closeAuthWindow()
    bubbleWindow?.destroy()
    tray?.destroy()
  })

  app.on('window-all-closed', () => {
    // Keep the menu bar utility alive on macOS.
    if (process.platform !== 'darwin') app.quit()
  })
}
