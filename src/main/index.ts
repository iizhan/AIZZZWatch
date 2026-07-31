import { app, BrowserWindow, ipcMain, nativeImage, net, Notification as NativeNotification, session, Tray } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { getDataCenterSummary, getUiPreferences, listStations, publicStations, recordProfitUsageArchiveDay, recordTimeCostLedgerSnapshot, recoverInterruptedAutoReauthStatuses, removeStation, saveAccountCostProfiles, saveAccountUpstreamMappings, saveGroupChangeEvents, saveHiddenGroupKeys, saveInternalUserProfiles, saveManualGroupTags, saveOperatingExcludedGroupKeys, saveStation, stationLoginCredentials, stationTokens, updateStationAutoReauthStatus, saveDismissedGroupChangeEventIds, type StoredStation } from './storage'
import { diagnoseStation } from './station-diagnostics'
import { hasUsableAdminCredential, isJwtExpiringSoon, resolveWebAuthTokens, Sub2ApiClient } from './sub2api-client'
import { NewApiClient } from './newapi-client'
import { autoReauthRetryDelaysMs, SerializedStationAutoReauthQueue } from './auto-reauth-queue'
import { StationRefreshEpochs } from './station-refresh-epochs'
import { createStationReadClient, usesSub2ApiContract } from './station-adapter'
import { buildBoundedCookieHeader, collectWebAuthApiBaseUrls, isNewApiCookieSessionPage, isNewApiWebAuthContract, isWebAuthLoginRouteNotFound, readWebAuthProbeSnapshot, resolveNewApiProfileUrl, resolveWebAuthApiBaseUrl, resolveWebAuthApiPaths, resolveWebAuthCookieUrl, resolveWebAuthLaunchTarget, tryRestoreNewApiSession, tryRestoreNewApiSessionFromPage, tryRestoreWebAuthSession, tryVerifyNewApiCookieSession } from './web-auth'
import { classifySub2ApiError, createEmptySnapshot, isTrustedStationReadApiBase, normalizeStationApiPaths, normalizeStationBaseUrl, resolveSameOriginHttpsApiBaseUrl, resolveStationApiRequestUrl, sameNumberSet } from '../shared/sub2api'
import { normalizeStationReadMapping } from '../shared/station-read-mapping'
import { archiveCoverageForQuery, archiveDates, buildProfitIntervalReport, dayArchiveQuery } from '../shared/time-cost-ledger'
import type { AccountGroupMutation, AccountUpstreamMapping, GroupChangeEvent, ProfitArchiveDayCoverage, ProfitIntervalQuery, StationAutoReauthReason, StationAutoReauthStatus, StationDiagnostics, StationInput, StationMappingPreview, StationSnapshot, WebAuthInput, WindowMode } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let bubbleWindow: BrowserWindow | null = null
let tray: Tray | null = null
let authWindow: BrowserWindow | null = null
let authPartition: string | null = null
let mode: WindowMode = 'full'
let alwaysOnTop = false
const snapshots = new Map<string, StationSnapshot>()
const pollers = new Map<string, NodeJS.Timeout>()
const stationRefreshesInFlight = new Map<string, Promise<StationSnapshot>>()
const stationRefreshEpochs = new StationRefreshEpochs()
const sourceKeyFingerprints = new Map<string, Map<string, string>>()
const accountCredentialFingerprints = new Map<string, Map<number, string>>()
const autoReauthQueue = new SerializedStationAutoReauthQueue()
const autoReauthRetryTimers = new Map<string, NodeJS.Timeout>()

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

function sendPreferencesUpdated(): void {
  mainWindow?.webContents.send('preferences:updated')
  bubbleWindow?.webContents.send('preferences:updated')
}

function isRateChangeEvent(event: GroupChangeEvent): boolean {
  if (event.kind !== 'rate-up' && event.kind !== 'rate-down') return false
  const previousRate = event.previousRate
  const nextRate = event.nextRate
  if (typeof previousRate !== 'number' || typeof nextRate !== 'number' || !Number.isFinite(previousRate) || !Number.isFinite(nextRate)) return false
  const delta = nextRate - previousRate
  return event.kind === 'rate-up' ? delta >= 0.0005 : delta <= -0.0005
}

function showGroupChangeNotification(events: GroupChangeEvent[]): void {
  const rateChanges = events.filter(isRateChangeEvent)
  const rateUp = rateChanges.filter((event) => event.kind === 'rate-up').length
  const rateDown = rateChanges.filter((event) => event.kind === 'rate-down').length
  if ((rateUp === 0 && rateDown === 0) || !NativeNotification.isSupported()) return
  const parts = [rateUp > 0 ? `${rateUp} 个涨价` : undefined, rateDown > 0 ? `${rateDown} 个降价` : undefined]
    .filter((item): item is string => Boolean(item))
  const notification = new NativeNotification({
    title: 'AIZZZWatch 分组倍率变动',
    body: `发现 ${parts.join('、')}，点击查看对应记录。`,
    silent: false
  })
  notification.on('click', () => {
    revealMainWindow()
    const filter = rateUp > 0 && rateDown > 0 ? 'all' : rateUp > 0 ? 'rate-up' : 'rate-down'
    mainWindow?.webContents.send('preferences:open-group-changes', { filter })
  })
  notification.show()
}

function sendStationsUpdated(stations: StoredStation[]): void {
  const publicStationList = publicStations(stations)
  mainWindow?.webContents.send('stations:updated', publicStationList)
  bubbleWindow?.webContents.send('stations:updated', publicStationList)
}

async function setStationAutoReauthStatus(
  id: string,
  status: Omit<StationAutoReauthStatus, 'at'> & { at?: string }
): Promise<void> {
  const stations = await updateStationAutoReauthStatus(id, { ...status, at: status.at ?? new Date().toISOString() })
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

function canQueueStationAutoReauth(station: StoredStation): boolean {
  if (!station.autoReauthEnabled || !isHttpsStation(station)) return false
  const credentials = stationLoginCredentials(station)
  return Boolean(credentials.loginAccount && credentials.loginPassword)
}

function classifyAutoReauthFailure(error: unknown): { kind: 'retry' | 'manual' | 'credentials-invalid' | 'interrupted'; reason: StationAutoReauthReason } {
  const message = error instanceof Error ? error.message : ''
  if (message === 'AUTH_CANCELLED') return { kind: 'interrupted', reason: 'manual-priority' }
  if (/AUTO_AUTH_TIMEOUT|AUTH_LOGIN_ROUTE_NOT_FOUND|unavailable/i.test(message)) return { kind: 'manual', reason: 'login-contract-changed' }
  if (/password|credential|invalid login|incorrect/i.test(message)) return { kind: 'credentials-invalid', reason: 'credentials-invalid' }
  if (/timed? ?out|ERR_TIMED_OUT/i.test(message)) return { kind: 'retry', reason: 'timeout' }
  if (/ERR_(?:INTERNET_DISCONNECTED|CONNECTION|NAME_NOT_RESOLVED)|ENOTFOUND|ECONN|network/i.test(message)) return { kind: 'retry', reason: 'network-error' }
  return { kind: 'manual', reason: 'unknown' }
}

function scheduleAutoReauthRetry(station: StoredStation, reason: Extract<StationAutoReauthReason, 'network-error' | 'timeout'>, attempts: number): void {
  if (attempts >= autoReauthRetryDelaysMs.length) {
    void setStationAutoReauthStatus(station.id, { state: 'interrupted', reason, attempts }).catch(() => undefined)
    return
  }
  const delay = autoReauthRetryDelaysMs[attempts]
  const nextRetryAt = new Date(Date.now() + delay).toISOString()
  void setStationAutoReauthStatus(station.id, { state: 'retry-scheduled', reason, attempts: attempts + 1, nextRetryAt }).catch(() => undefined)
  const priorTimer = autoReauthRetryTimers.get(station.id)
  if (priorTimer) clearTimeout(priorTimer)
  const timer = setTimeout(() => {
    autoReauthRetryTimers.delete(station.id)
    void listStations().then((stations) => {
      const next = stations.find((item) => item.id === station.id)
      if (next) queueStationAutoReauth(next)
    })
  }, delay)
  autoReauthRetryTimers.set(station.id, timer)
}

async function runStationAutoReauth(station: StoredStation): Promise<void> {
  let manualInterventionRequired = false
  const attempts = station.autoReauthStatus?.state === 'retry-scheduled' ? station.autoReauthStatus.attempts ?? 0 : 0
  try {
    await setStationAutoReauthStatus(station.id, { state: 'pending', reason: 'session-expired', attempts })
    await beginWebAuth(webAuthInputFromStoredStation(station), {
      autoSubmitSavedLogin: true,
      onManualInterventionRequired: () => {
        manualInterventionRequired = true
        void setStationAutoReauthStatus(station.id, { state: 'manual-required', reason: 'manual-challenge', attempts })
      },
      onCredentialsInvalid: () => {
        void setStationAutoReauthStatus(station.id, { state: 'credentials-invalid', reason: 'credentials-invalid', attempts })
      }
    })
    await setStationAutoReauthStatus(station.id, { state: 'success', reason: 'session-expired', attempts: 0 })
    await refreshStation(station.id, false).catch(() => undefined)
  } catch (error) {
    if (manualInterventionRequired) return
    const failure = classifyAutoReauthFailure(error)
    if (failure.kind === 'retry') {
      scheduleAutoReauthRetry(station, failure.reason as Extract<StationAutoReauthReason, 'network-error' | 'timeout'>, attempts)
      return
    }
    const state = failure.kind === 'credentials-invalid' ? 'credentials-invalid' : failure.kind === 'interrupted' ? 'interrupted' : 'manual-required'
    await setStationAutoReauthStatus(station.id, { state, reason: failure.reason, attempts }).catch(() => undefined)
  }
}

function drainAutoReauthQueue(): void {
  if (autoReauthQueue.activeStationId || (authWindow && !authWindow.isDestroyed())) return
  const stationId = autoReauthQueue.reserveNext()
  if (!stationId) return
  void listStations().then(async (stations) => {
    const station = stations.find((item) => item.id === stationId)
    if (autoReauthQueue.isActiveCancelled(stationId) || !station || !canQueueStationAutoReauth(station)) {
      autoReauthQueue.complete(stationId)
      drainAutoReauthQueue()
      return
    }
    try {
      await runStationAutoReauth(station)
    } finally {
      autoReauthQueue.complete(stationId)
      drainAutoReauthQueue()
    }
  }).catch(() => {
    autoReauthQueue.complete(stationId)
    drainAutoReauthQueue()
  })
}

function queueStationAutoReauth(station: StoredStation): void {
  if (!canQueueStationAutoReauth(station) || autoReauthRetryTimers.has(station.id)) return
  if (!autoReauthQueue.enqueue(station.id)) return
  drainAutoReauthQueue()
}

async function interruptAutoReauthForManualLogin(manualStationId?: string): Promise<void> {
  if (manualStationId) {
    const retryTimer = autoReauthRetryTimers.get(manualStationId)
    if (retryTimer) clearTimeout(retryTimer)
    autoReauthRetryTimers.delete(manualStationId)
    autoReauthQueue.cancel(manualStationId)
  }
  const activeStationId = autoReauthQueue.activeStationId
  if (!activeStationId) return
  autoReauthQueue.cancel(activeStationId)
  await setStationAutoReauthStatus(activeStationId, { state: 'interrupted', reason: 'manual-priority' }).catch(() => undefined)
  await closeAuthWindow()
}

/**
 * Background pollers run on independent per-station intervals, and IPC
 * callers can request a refresh (single station or all of them) at any time.
 * Without this, an overlapping poller tick and an explicit refresh request
 * for the same station would each run their own full fetch — snapshot,
 * admin data, admin console, usage detail — concurrently against the same
 * station, doubling load for no benefit since both would resolve to the
 * same answer. Concurrent calls for the same (id, allowTokenRefresh) share
 * one in-flight fetch instead.
 */
async function refreshStation(id: string, allowTokenRefresh = true, force = false): Promise<StationSnapshot> {
  const key = `${id}:${allowTokenRefresh}`
  if (!force) {
    const inFlight = stationRefreshesInFlight.get(key)
    if (inFlight) return inFlight
  }
  const refreshEpoch = stationRefreshEpochs.begin(id)
  const promise = refreshStationOnce(id, allowTokenRefresh, refreshEpoch).catch((error) => {
    // A newer explicit refresh supersedes this request. Do not let a delayed
    // transport error overwrite its result with a stale error snapshot.
    if (!stationRefreshEpochs.isCurrent(id, refreshEpoch)) {
      return snapshots.get(id) ?? createEmptySnapshot(id, id)
    }
    throw error
  }).finally(() => {
    // Only clear this call's own entry: a forced call must not delete a
    // concurrent, still-relevant in-flight promise that other callers are
    // sharing under the same key.
    if (stationRefreshesInFlight.get(key) === promise) stationRefreshesInFlight.delete(key)
  })
  stationRefreshesInFlight.set(key, promise)
  return promise
}

async function refreshStationOnce(id: string, allowTokenRefresh: boolean, refreshEpoch: number): Promise<StationSnapshot> {
  const stations = await listStations()
  const station = stations.find((item) => item.id === id)
  if (!station) throw new Error('找不到站点')
  let tokens = stationTokens(station)
  let client = createStationReadClient({ ...station, ...tokens, fetchImpl: electronFetch })
  const rotateStationTokens = async (): Promise<boolean> => {
    if (!stationRefreshEpochs.isCurrent(id, refreshEpoch)) return false
    if (!(client instanceof Sub2ApiClient) && !(client instanceof NewApiClient)) return false
    if (client instanceof Sub2ApiClient && !tokens.refreshToken) return false
    if (client instanceof NewApiClient && (!tokens.sessionCookie || station.sessionAuthMode === 'cookie-session')) return false
    try {
      const tokenPair = await client.refreshAccessToken()
      if (!stationRefreshEpochs.isCurrent(id, refreshEpoch)) return false
      await saveStation({
        id: station.id,
        name: station.name,
        baseUrl: station.baseUrl,
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
        sessionCookie: 'sessionCookie' in tokenPair ? tokenPair.sessionCookie : undefined,
        pollingIntervalMs: station.pollingIntervalMs
      })
      if (!stationRefreshEpochs.isCurrent(id, refreshEpoch)) return false
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
    || (client instanceof NewApiClient && Boolean(tokens.sessionCookie) && station.sessionAuthMode !== 'cookie-session')
  if (allowTokenRefresh && canRefreshSession && isJwtExpiringSoon(tokens.accessToken)) {
    await rotateStationTokens()
  }
  if (!stationRefreshEpochs.isCurrent(id, refreshEpoch)) return snapshots.get(id) ?? createEmptySnapshot(id, station.name)
  let next = await client.fetchSnapshot(snapshots.get(id))
  if (allowTokenRefresh && canRefreshSession && next.errorCode === 'UNAUTHORIZED') {
    const refreshed = await rotateStationTokens()
    if (refreshed) {
      next = await client.fetchSnapshot(snapshots.get(id))
    }
  }
  if (!stationRefreshEpochs.isCurrent(id, refreshEpoch)) return next
  if (allowTokenRefresh && isSessionReauthorizationNeeded(next)) queueStationAutoReauth(station)
  let usageDetail: Awaited<ReturnType<Sub2ApiClient['fetchAdminUsageDetail']>> | undefined
  if (client instanceof Sub2ApiClient && next.health === 'healthy' && hasUsableAdminCredential({ ...station, ...tokens })) {
    try {
      const admin = await client.fetchAdminData()
      if (!stationRefreshEpochs.isCurrent(id, refreshEpoch)) return next
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
    if (!stationRefreshEpochs.isCurrent(id, refreshEpoch)) return next
  }
  const sourceCredentials = client instanceof Sub2ApiClient ? client.getSourceKeyCredentials() : undefined
  if (!stationRefreshEpochs.isCurrent(id, refreshEpoch)) return next
  if (next.sourceKeyReadState === 'available') {
    sourceKeyFingerprints.set(id, new Map([...(sourceCredentials ?? [])].map(([keyId, value]) => [keyId, credentialFingerprint(value)])))
  } else if (next.sourceKeyReadState === 'not-configured') {
    // This station is no longer configured to read Keys, so an old runtime
    // fingerprint must not keep creating new automatic associations.
    sourceKeyFingerprints.delete(id)
  }
  snapshots.set(id, next)
  if (!stationRefreshEpochs.isCurrent(id, refreshEpoch)) return next
  updateUpstreamKeyLinks(stations)
  if (!stationRefreshEpochs.isCurrent(id, refreshEpoch)) return next
  await persistVerifiedUpstreamKeyLinks()
  if (!stationRefreshEpochs.isCurrent(id, refreshEpoch)) return next
  const recorded = next.health === 'healthy'
    ? await recordTimeCostLedgerSnapshot(station, next, usageDetail)
    : undefined
  if (!stationRefreshEpochs.isCurrent(id, refreshEpoch)) return next
  if (recorded) {
    sendPreferencesUpdated()
    showGroupChangeNotification(recorded.newGroupChangeEvents)
  }
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
  bubbleWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
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

/**
 * The default session is shared by the main and bubble windows, which only
 * ever load this app's own bundled renderer. The renderer's only use of the
 * browser permission model is desktop notifications for group-rate-change
 * alerts, while the main process owns their delivery; everything else is denied
 * by default rather than left to Electron's permissive built-in behavior.
 */
function applyDefaultSessionPermissionGuards(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'notifications')
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'notifications')
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

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
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
  onCredentialsInvalid?: () => void
}

type AutoLoginIntervention = 'none' | 'manual-required' | 'credentials-invalid'

async function inspectAutoLoginIntervention(loginWindow: BrowserWindow, stationBaseUrl: string): Promise<AutoLoginIntervention> {
  if (loginWindow.isDestroyed() || !isSameOrigin(loginWindow.webContents.getURL(), stationBaseUrl)) return 'none'
  const script = `(() => {
    const form = document.querySelector('form') || document
    const pageText = [document.body?.innerText, form.textContent].filter(Boolean).join(' ').toLowerCase()
    if (Boolean(document.querySelector('[data-sitekey], iframe[src*="captcha" i], iframe[src*="hcaptcha" i], iframe[src*="turnstile" i], input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="totp" i]'))
      || /captcha|\\u9a8c\\u8bc1\\u7801|\\u4eba\\u673a\\u9a8c\\u8bc1|verify you are human|two[ -]?factor|\\u4e8c\\u6b21\\u9a8c\\u8bc1|\\u5b89\\u5168\\u9a8c\\u8bc1/.test(pageText)) return 'manual-required'
    const isLoginRoute = /\\/(?:login|sign-in|signin)\\/?$/i.test(window.location.pathname)
    if (isLoginRoute && /invalid credentials|incorrect password|password is incorrect|login failed|\\u8d26\\u53f7\\u6216\\u5bc6\\u7801|\\u5bc6\\u7801\\u9519\\u8bef|\\u767b\\u5f55\\u5931\\u8d25/.test(pageText)) return 'credentials-invalid'
    return 'none'
  })()`
  try {
    const result = await loginWindow.webContents.executeJavaScript(script, true)
    return result === 'manual-required' || result === 'credentials-invalid' ? result : 'none'
  } catch {
    return 'none'
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
  const baseUrl = input.baseUrl.trim()
  if (!baseUrl) throw new Error('站点地址不能为空')
  const normalizedBaseUrl = normalizeStationBaseUrl(baseUrl, input.adapterType === 'auto' ? input.detectedAdapterType : input.adapterType)
  const name = input.name.trim() || new URL(normalizedBaseUrl).hostname
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
  const authorizationSession = session.fromPartition(partition)
  // The login window renders an arbitrary remote station's page. It has no
  // legitimate reason to open child windows or request device/notification
  // permissions, and denying by default avoids an untracked popup holding
  // onto the authorization partition's cookies after this window closes.
  loginWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  authorizationSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  authorizationSession.setPermissionCheckHandler(() => false)

  return new Promise<ReturnType<typeof publicStations>>((resolve, reject) => {
    let settled = false
    let captureInProgress = false
    let poller: NodeJS.Timeout | undefined
    let automaticAuthTimeout: NodeJS.Timeout | undefined
    let requestedClientLoginRoute = false
    let authRouteFallbackUsed = false
    let lastSessionRestoreAttemptAt = 0
    let lastNewApiPageRecoveryAttemptAt = 0
    let lastNewApiCookieSessionAttemptAt = 0
    let newApiSessionCapturePending = false
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
    const requestCredentialsUpdate = (): void => {
      if (!options.autoSubmitSavedLogin || settled) return
      if (automaticAuthTimeout) clearTimeout(automaticAuthTimeout)
      options.onCredentialsInvalid?.()
      void finish(() => reject(new Error('AUTO_AUTH_CREDENTIALS_INVALID')))
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
      if (loginWindow.isDestroyed() || captureInProgress) return
      captureInProgress = true
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
          const cookies = await authorizationSession.cookies.get({ url: cookieUrl }).catch(() => [])
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
        let newApiSelectedUserId: string | undefined
        let verifiedCookieSession = false
        let hasUnsupportedNewApiRefresh = false
        // The 700ms poller below re-runs capture() continuously while a
        // login is in progress. Without this cooldown, every tick would fire
        // a session-restore POST against every candidate API base URL (up to
        // four) at the station, hammering it several times per second for as
        // long as the login window stays open with no token yet.
        if (!resolvedTokens.accessToken && Date.now() - lastSessionRestoreAttemptAt >= 2_000) {
          lastSessionRestoreAttemptAt = Date.now()
          for (const { apiBaseUrl, cookies } of cookieSets) {
            const restored = newApiAuth
              ? await tryRestoreNewApiSession({
                  fetchImpl: (url, init) => authorizationSession.fetch(url, init),
                  apiBaseUrl,
                  authRefreshPath: newApiAuthRefreshPath,
                  cookies,
                  userAgent: loginWindow.webContents.getUserAgent(),
                  useSessionCredentials: true
                })
              : await tryRestoreWebAuthSession({
                  fetchImpl: electronFetch,
                  apiBaseUrl,
                  authClientId: probe.authClientId,
                  cookies,
                  userAgent: loginWindow.webContents.getUserAgent()
                })
            if (restored?.authRefreshUnsupported) hasUnsupportedNewApiRefresh = true
            if (!restored?.accessToken) continue
            resolvedTokens.accessToken = restored.accessToken
            resolvedTokens.refreshToken = resolvedTokens.refreshToken || restored.refreshToken
            const cookieUrl = resolveWebAuthCookieUrl(apiBaseUrl, true, newApiAuthRefreshPath)
            const currentCookies = await authorizationSession.cookies.get({ url: cookieUrl }).catch(() => cookies)
            restoredSessionCookie = buildBoundedCookieHeader(currentCookies) || restored.sessionCookie
            resolvedApiBaseUrl = resolvedApiBaseUrl || apiBaseUrl
            break
          }
        }
        if (!resolvedTokens.accessToken && newApiAuth && !hasUnsupportedNewApiRefresh && Date.now() - lastNewApiPageRecoveryAttemptAt >= 2_000) {
          const pageRecoveryApiBaseUrl = apiBaseUrls.find((apiBaseUrl) => {
            const refreshUrl = resolveWebAuthCookieUrl(apiBaseUrl, true, newApiAuthRefreshPath)
            return isSameOrigin(loginPageUrl, refreshUrl)
          })
          if (pageRecoveryApiBaseUrl) {
            lastNewApiPageRecoveryAttemptAt = Date.now()
            const restored = await tryRestoreNewApiSessionFromPage({
              loginWindow,
              apiBaseUrl: pageRecoveryApiBaseUrl,
              authRefreshPath: newApiAuthRefreshPath
            })
            if (restored?.accessToken) {
              resolvedTokens.accessToken = restored.accessToken
              const cookieUrl = resolveWebAuthCookieUrl(pageRecoveryApiBaseUrl, true, newApiAuthRefreshPath)
              const currentCookies = await authorizationSession.cookies.get({ url: cookieUrl }).catch(() => [])
              restoredSessionCookie = buildBoundedCookieHeader(currentCookies) || undefined
              resolvedApiBaseUrl = pageRecoveryApiBaseUrl
            }
          }
        }
        if (!resolvedTokens.accessToken && newApiAuth && Date.now() - lastNewApiCookieSessionAttemptAt >= 2_000) {
          const cookieSessionApiBaseUrl = apiBaseUrls.find((apiBaseUrl) => {
            const profileUrl = resolveNewApiProfileUrl(apiBaseUrl, input.apiPaths?.profile)
            return profileUrl !== undefined && isSameOrigin(loginPageUrl, profileUrl)
          })
          if (cookieSessionApiBaseUrl) {
            lastNewApiCookieSessionAttemptAt = Date.now()
            const cookieSessionPage = isNewApiCookieSessionPage({ loginWindow, apiBaseUrl: cookieSessionApiBaseUrl, profilePath: input.apiPaths?.profile })
            const verification = cookieSessionPage
              ? await tryVerifyNewApiCookieSession({
                  loginWindow,
                  apiBaseUrl: cookieSessionApiBaseUrl,
                  profilePath: input.apiPaths?.profile
                })
              : { verified: false }
            const profileUrl = resolveNewApiProfileUrl(cookieSessionApiBaseUrl, input.apiPaths?.profile)
            if (verification.verified && profileUrl) {
              const currentCookies = await authorizationSession.cookies.get({ url: profileUrl }).catch(() => [])
              const boundedCookieHeader = buildBoundedCookieHeader(currentCookies)
              if (boundedCookieHeader) {
                verifiedCookieSession = true
                restoredSessionCookie = boundedCookieHeader
                newApiSelectedUserId = verification.selectedUserId
                resolvedApiBaseUrl = cookieSessionApiBaseUrl
                if (!loginWindow.isDestroyed()) loginWindow.setTitle(`登录 ${name} — 正在保存会话`)
              } else {
                newApiSessionCapturePending = true
                if (!loginWindow.isDestroyed()) loginWindow.setTitle(`登录 ${name} — 网页会话已验证，但没有可安全保存的 Cookie`)
              }
            } else if (cookieSessionPage) {
              newApiSessionCapturePending = true
              if (!loginWindow.isDestroyed()) loginWindow.setTitle(`登录 ${name} — 网页会话验证失败`)
            }
          }
        }
        if (!resolvedTokens.accessToken && !verifiedCookieSession) return
        const saveApiBaseUrl = resolvedApiBaseUrl
        const cookieSource = cookieSets.find((item) => item.apiBaseUrl === (saveApiBaseUrl || normalizedBaseUrl))
          ?? cookieSets.find((item) => item.cookies.length > 0)
        const sessionCookie = restoredSessionCookie
          ?? buildBoundedCookieHeader(cookieSource?.cookies ?? [])
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
          sessionAuthMode: newApiAuth ? (verifiedCookieSession ? 'cookie-session' : 'refresh-token') : undefined,
          newApiSelectedUserId,
          userAgent
        })
        await finish(() => resolve(publicStations(stations)))
      } catch (error) {
        await finish(() => reject(error instanceof Error ? error : new Error('网页登录授权失败')))
      } finally {
        captureInProgress = false
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
            void inspectAutoLoginIntervention(loginWindow, savedCredentialsBaseUrl ?? normalizedBaseUrl).then((intervention) => {
              if (intervention === 'manual-required') requestManualIntervention()
              if (intervention === 'credentials-invalid') requestCredentialsUpdate()
            })
          }
          void capture()
        }, 700)
      })().catch((error: unknown) => {
        void finish(() => reject(error instanceof Error ? error : new Error('新版网页登录路由跳转失败')))
      })
    })
    loginWindow.webContents.on('did-navigate-in-page', fillSavedLogin)
    loginWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
      // A captcha iframe, blocked analytics script, or any other sub-frame
      // resource failing to load must not abort the whole login flow.
      if (!isMainFrame || errorCode === -3) return
      void finish(() => reject(new Error(`网页登录页面加载失败 (${errorCode}): ${errorDescription}`)))
    })
    loginWindow.on('closed', () => {
      void finish(() => reject(new Error(newApiSessionCapturePending ? 'AUTH_NEWAPI_SESSION_NOT_CAPTURED' : 'AUTH_CANCELLED')))
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

function registerIpc(): void {
  ipcMain.handle('auth:login', async (_event, input: WebAuthInput) => {
    await interruptAutoReauthForManualLogin(input.id)
    try {
      await beginWebAuth(input)
      const reauthorizedStation = input.id ? (await listStations()).find((station) => station.id === input.id) : undefined
      if (reauthorizedStation?.autoReauthEnabled) {
        await setStationAutoReauthStatus(reauthorizedStation.id, { state: 'success', reason: 'session-expired', attempts: 0 })
      }
      await startPolling()
      return publicStations(await listStations())
    } finally {
      drainAutoReauthQueue()
    }
  })
  ipcMain.handle('stations:list', async () => publicStations(await listStations()))
  ipcMain.handle('stations:save', async (_event, input: StationInput) => {
    const stations = await saveStation(input)
    await startPolling()
    return publicStations(stations)
  })
  ipcMain.handle('stations:diagnose', async (_event, input: Pick<StationInput, 'id' | 'name' | 'baseUrl' | 'apiBaseUrl' | 'adapterType' | 'accessToken' | 'refreshToken' | 'adminToken' | 'adminCredentialType' | 'apiPaths'> & { useSavedCredentials?: boolean }): Promise<StationDiagnostics> => {
    const stored = input.id ? (await listStations()).find((station) => station.id === input.id) : undefined
    const useSavedCredentials = input.useSavedCredentials === true
    if (useSavedCredentials && stored && !isSameOrigin(input.baseUrl, stored.baseUrl)) {
      throw new Error('站点地址已变更；保存的登录会话只能用于原 HTTPS 同源站点。请先保存新地址后再做详细诊断。')
    }
    if (useSavedCredentials && stored && input.apiBaseUrl?.trim() && !isTrustedStationReadApiBase(stored.baseUrl, input.apiBaseUrl)) {
      throw new Error('接口根地址必须与已保存站点同源，不能使用保存的登录会话跨站诊断。')
    }
    const storedTokens = stored && useSavedCredentials ? stationTokens(stored) : undefined
    return diagnoseStation({
      ...(useSavedCredentials ? stored : undefined),
      ...input,
      accessToken: useSavedCredentials ? input.accessToken?.trim() || storedTokens?.accessToken : undefined,
      refreshToken: useSavedCredentials ? input.refreshToken?.trim() || storedTokens?.refreshToken : undefined,
      adminToken: useSavedCredentials ? input.adminToken?.trim() || storedTokens?.adminToken : undefined,
      sessionCookie: storedTokens?.sessionCookie,
      userAgent: storedTokens?.userAgent,
      useSavedCredentials,
      fetchImpl: electronFetch
    })
  })
  ipcMain.handle('stations:preview-mapping', async (_event, input: Pick<StationInput, 'id' | 'apiBaseUrl' | 'apiPaths' | 'readMapping'>): Promise<StationMappingPreview> => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.id !== 'string' || !input.id.trim()) {
      throw new Error('读取映射检测参数无效')
    }
    const stored = input.id ? (await listStations()).find((station) => station.id === input.id) : undefined
    if (!stored) throw new Error('请先保存站点基础信息，再检测读取映射')
    const storedTokens = stationTokens(stored)
    const hasReadMappingInput = Object.prototype.hasOwnProperty.call(input, 'readMapping')
    const hasApiBaseUrlInput = Object.prototype.hasOwnProperty.call(input, 'apiBaseUrl')
    const apiBaseUrl = hasApiBaseUrlInput
      ? resolveSameOriginHttpsApiBaseUrl(stored.baseUrl, input.apiBaseUrl)
      : stored.apiBaseUrl
    const station = {
      ...stored,
      apiBaseUrl,
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
    if (station.readMapping?.template === 'custom') {
      resolveSameOriginHttpsApiBaseUrl(stored.baseUrl, station.apiBaseUrl)
    } else if (Object.keys(station.readMapping?.capabilities ?? {}).length > 0 && new URL(station.apiBaseUrl ?? station.baseUrl).protocol !== 'https:') {
      throw new Error('自定义读取映射仅允许 HTTPS 站点')
    }
    for (const path of Object.values(station.apiPaths)) {
      if (path) resolveStationApiRequestUrl(station.apiBaseUrl ?? station.baseUrl, path)
    }
    return new Sub2ApiClient(station).previewReadMapping()
  })
  ipcMain.handle('stations:remove', async (_event, id: string) => {
    const stations = await removeStation(id)
    stationRefreshEpochs.invalidate(id)
    snapshots.delete(id)
    sourceKeyFingerprints.delete(id)
    accountCredentialFingerprints.delete(id)
    await startPolling()
    return publicStations(stations)
  })
  ipcMain.handle('stations:refresh', async (_event, id?: string) => {
    const result = id
      ? [await refreshStation(id, true, true)]
      : await Promise.all((await listStations()).map((station) => refreshStation(station.id, true, true)))
    await schedulePollingTimers()
    return result
  })
  ipcMain.handle('stations:keepalive-check', async (_event, id: string) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('站点标识无效')
    await refreshStation(id, true, true)
    return publicStations(await listStations())
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
    // A maximal 7-day hourly window can straddle a day boundary on both ends
    // and so touch up to 8 calendar days; the cap must accommodate the
    // largest range validateProfitIntervalQuery still allows.
    if (dates.length > 8) throw new Error('单次最多归档 8 天，请缩短日期范围后继续')
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
      // The write above must be reflected in this refresh; sharing a
      // same-key in-flight fetch that started before the mutation would
      // return stale group data instead of the value just written.
      return await refreshStation(mutation.stationId, true, true)
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

  app.whenReady().then(async () => {
    registerIpc()
    applyDefaultSessionPermissionGuards()
    const stations = await recoverInterruptedAutoReauthStatuses()
    sendStationsUpdated(stations)
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
    for (const timer of autoReauthRetryTimers.values()) clearTimeout(timer)
    autoReauthRetryTimers.clear()
    void closeAuthWindow()
    bubbleWindow?.destroy()
    tray?.destroy()
  })

  app.on('window-all-closed', () => {
    // Keep the menu bar utility alive on macOS.
    if (process.platform !== 'darwin') app.quit()
  })
}
