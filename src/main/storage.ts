import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { applyKnownSourceStationApiPathDefaults, applyLcodexApiPathDefaults, applyNewApiPathDefaults, defaultStationApiPaths, defaultSub2ApiKeyListPath, isLcodexLegacyPublicApiUrl, normalizeStationBaseUrl, normalizeStationApiPaths, resolveLcodexStationCompatibility, resolveSameOriginHttpsApiBaseUrl, resolveStationApiRequestUrl, Sub2ApiError } from '../shared/sub2api'
import { normalizeStationReadMapping } from '../shared/station-read-mapping'
import { appendAccountUpstreamMappingEvents, appendObservedGroupRateChanges, appendProfitUsageArchiveDay, appendTimeCostSnapshot, emptyTimeCostLedger } from '../shared/time-cost-ledger'
import type { AccountCostKind, AccountCostProfile, AccountUpstreamMapping, AdminCredentialType, DataCenterSummary, DataFileSummary, GroupCapabilityTagId, GroupChangeEvent, GroupChangeKind, InternalUserProfile, NewApiSessionAuthMode, ProfitArchiveDayCoverage, ProfitUsageRecord, ResolvedStationAdapterType, StationAdapterType, StationApiPaths, StationAutoReauthReason, StationAutoReauthStatus, StationInput, StationPublic, StationReadMapping, StationRole, StationSnapshot, TimeCostLedger, UiPreferences, UsageLedgerCoverage, UsageLedgerEntry } from '../shared/types'

export interface StoredStation {
  id: string
  name: string
  baseUrl: string
  apiBaseUrl?: string
  stationRole?: StationRole
  adapterType?: StationAdapterType
  detectedAdapterType?: ResolvedStationAdapterType
  rechargeRatio: number
  lowBalanceThreshold: number
  apiPaths: StationApiPaths
  readMapping?: StationReadMapping
  accessToken?: string
  refreshToken?: string
  sessionCookie?: string
  sessionAuthMode?: NewApiSessionAuthMode
  newApiSelectedUserId?: string
  userAgent?: string
  adminToken?: string
  adminCredentialType?: AdminCredentialType
  loginAccount?: string
  loginPassword?: string
  autoReauthEnabled?: boolean
  autoReauthStatus?: StationAutoReauthStatus
  pollingIntervalMs: number
}

const fileName = 'stations.json'
const preferencesFileName = 'ui-preferences.json'
let preferenceMutationQueue: Promise<void> = Promise.resolve()
let stationMutationQueue: Promise<void> = Promise.resolve()

/**
 * A data file exists but could not be understood. It is never safe to treat
 * that as "no data": the file is the only copy of the station credentials and
 * the ledger, and continuing would let the next ordinary save overwrite it.
 */
export class StationDataFileCorruptError extends Error {
  constructor(readonly path: string, readonly backupPath: string | undefined, options?: { cause?: unknown }) {
    super(backupPath
      ? `数据文件已损坏，原文件已备份为 ${backupPath}，本次未读取任何数据以免覆盖其中的凭据`
      : `数据文件已损坏且无法备份（${path}），本次未读取任何数据以免覆盖其中的凭据`)
    this.name = 'StationDataFileCorruptError'
    if (options && 'cause' in options) this.cause = options.cause
  }
}

function storagePath(): string {
  return join(app.getPath('userData'), fileName)
}

function preferencesPath(): string {
  return join(app.getPath('userData'), preferencesFileName)
}

async function dataFileSummary(path: string): Promise<DataFileSummary> {
  try {
    const stat = await fs.stat(path)
    return {
      exists: stat.isFile(),
      path,
      updatedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size
    }
  } catch {
    return { exists: false, path }
  }
}

/**
 * These files hold the only copy of every station credential and ledger
 * record. A plain writeFile truncates the target before writing, so an
 * interrupted write leaves a half-document that parses as nothing and reads
 * back as "no stations". Stage the contents in a sibling temp file, flush it,
 * then rename: the target only ever contains a complete document.
 */
async function writeDataFileAtomic(path: string, contents: string): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  let handle: FileHandle | undefined
  try {
    handle = await fs.open(temporaryPath, 'w', 0o600)
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    // The open mode is masked by umask; set it explicitly while the file is
    // still unreachable under its final name.
    await fs.chmod(temporaryPath, 0o600)
    await fs.rename(temporaryPath, path)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function isFileMissingError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

/**
 * Move the unreadable file aside instead of deleting it, so the encrypted
 * credentials inside stay recoverable by hand.
 */
async function backupCorruptDataFile(path: string): Promise<string> {
  const backupPath = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
  await fs.rename(path, backupPath)
  return backupPath
}

async function readDataFile<T>(path: string, parse: (raw: string) => T): Promise<T | undefined> {
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (error) {
    if (isFileMissingError(error)) return undefined
    throw error
  }
  try {
    return parse(raw)
  } catch (parseError) {
    try {
      const backupPath = await backupCorruptDataFile(path)
      throw new StationDataFileCorruptError(path, backupPath, { cause: parseError })
    } catch (backupError) {
      if (backupError instanceof StationDataFileCorruptError) throw backupError
      // A failed move leaves the unreadable original in place. Propagating a
      // recovery-required error prevents any later mutation from treating the
      // file as an empty document and replacing the only copy of local data.
      throw new StationDataFileCorruptError(path, undefined, { cause: backupError })
    }
  }
}

function encrypt(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Sub2ApiError('当前系统无法提供安全存储，拒绝保存令牌', 'ENCRYPTION_UNAVAILABLE')
  }
  return safeStorage.encryptString(value).toString('base64')
}

function decrypt(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (!safeStorage.isEncryptionAvailable()) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    return undefined
  }
}

function sanitizeRechargeRatio(value: unknown, strict = false): number {
  if (value === undefined || value === null || value === '') return 1
  const ratio = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(ratio) || ratio <= 0) {
    if (strict) throw new Sub2ApiError('充值比例必须大于 0', 'INVALID_RESPONSE')
    return 1
  }
  return Math.min(Math.max(ratio, 0.0001), 1_000_000)
}

function sanitizeLowBalanceThreshold(value: unknown, strict = false): number {
  if (value === undefined || value === null || value === '') return 10
  const threshold = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(threshold) || threshold < 0) {
    if (strict) throw new Sub2ApiError('余额提醒阈值不能小于 0', 'INVALID_RESPONSE')
    return 10
  }
  return Math.min(threshold, 1_000_000_000)
}

function sanitizeStationRole(value: unknown): StationRole | undefined {
  return value === 'source' || value === 'own' ? value : undefined
}

function sanitizeAdapterType(value: unknown): StationAdapterType | undefined {
  return value === 'auto' || value === 'sub2api' || value === 'newapi' || value === 'custom' ? value : undefined
}

function sanitizeDetectedAdapterType(value: unknown): ResolvedStationAdapterType | undefined {
  return value === 'sub2api' || value === 'newapi' || value === 'custom' ? value : undefined
}

function sanitizeNewApiSessionAuthMode(value: unknown): NewApiSessionAuthMode | undefined {
  return value === 'refresh-token' || value === 'cookie-session' ? value : undefined
}

function sanitizeNewApiSelectedUserId(value: unknown): string | undefined {
  const candidate = typeof value === 'string' ? value.trim() : ''
  return /^\d{1,20}$/.test(candidate) ? candidate : undefined
}

function sanitizeAutoReauthStatus(value: unknown): StationAutoReauthStatus | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const state = record.state
  const at = record.at
  if (typeof at !== 'string' || Number.isNaN(new Date(at).getTime())) return undefined
  const allowedStates = new Set(['pending', 'success', 'retry-scheduled', 'manual-required', 'credentials-invalid', 'interrupted'])
  const allowedReasons = new Set<StationAutoReauthReason>(['session-expired', 'network-error', 'timeout', 'manual-challenge', 'credentials-invalid', 'login-contract-changed', 'application-restarted', 'manual-priority', 'unknown'])
  const attempts = typeof record.attempts === 'number' && Number.isInteger(record.attempts) && record.attempts >= 0
    ? Math.min(record.attempts, 3)
    : undefined
  const nextRetryAt = typeof record.nextRetryAt === 'string' && !Number.isNaN(new Date(record.nextRetryAt).getTime())
    ? record.nextRetryAt
    : undefined
  if (state === 'failed') return { state: 'interrupted', at, reason: 'unknown', attempts }
  if (typeof state !== 'string' || !allowedStates.has(state)) return undefined
  const reason = typeof record.reason === 'string' && allowedReasons.has(record.reason as StationAutoReauthReason)
    ? record.reason as StationAutoReauthReason
    : undefined
  return {
    state: state as StationAutoReauthStatus['state'],
    at,
    reason,
    attempts,
    nextRetryAt: state === 'retry-scheduled' ? nextRetryAt : undefined
  }
}

function toPublic(station: StoredStation): StationPublic {
  return {
    id: station.id,
    name: station.name,
    baseUrl: station.baseUrl,
    apiBaseUrl: station.apiBaseUrl,
    stationRole: station.stationRole,
    adapterType: station.adapterType,
    detectedAdapterType: station.detectedAdapterType,
    rechargeRatio: station.rechargeRatio ?? 1,
    lowBalanceThreshold: station.lowBalanceThreshold ?? 10,
    apiPaths: station.apiPaths ?? defaultStationApiPaths,
    readMapping: station.readMapping,
    hasAccessToken: Boolean(station.accessToken),
    hasSessionCookie: Boolean(station.sessionCookie),
    hasRefreshToken: Boolean(station.refreshToken),
    hasAdminToken: Boolean(station.adminToken),
    hasSavedLoginCredentials: Boolean(station.loginAccount && station.loginPassword),
    autoReauthEnabled: Boolean(station.autoReauthEnabled),
    autoReauthStatus: station.autoReauthStatus,
    adminCredentialType: station.adminToken ? (station.adminCredentialType ?? 'jwt') : undefined,
    pollingIntervalMs: station.pollingIntervalMs
  }
}

function usesSub2ApiDefaultKeyPath(adapterType: StationAdapterType, detectedAdapterType: ResolvedStationAdapterType | undefined): boolean {
  return adapterType === 'sub2api' || (adapterType === 'auto' && detectedAdapterType === 'sub2api')
}

function applySub2ApiKeyPathDefault(paths: StationApiPaths, adapterType: StationAdapterType, detectedAdapterType: ResolvedStationAdapterType | undefined): StationApiPaths {
  if (!usesSub2ApiDefaultKeyPath(adapterType, detectedAdapterType) || paths.keys?.trim()) return paths
  return { ...paths, keys: defaultSub2ApiKeyListPath }
}

async function readStored(): Promise<StoredStation[]> {
  let parsed: unknown[] | undefined
  try {
    parsed = await readDataFile(storagePath(), (raw) => {
      const value = JSON.parse(raw) as unknown
      if (!Array.isArray(value)) throw new Error('站点数据文件的顶层结构不是数组')
      return value
    })
  } catch (error) {
    // A successful backup makes a new empty document safe. Any other read or
    // backup failure must block mutations rather than risking credential loss.
    if (error instanceof StationDataFileCorruptError && error.backupPath) {
      console.error(error.message)
      return []
    }
    throw error
  }
  if (!parsed) return []
  return parsed
    .filter((value): value is StoredStation => Boolean(value && typeof value === 'object'))
    // One unnormalizable entry must not discard the healthy stations beside
    // it, and must not be mistaken for whole-file corruption either.
    .flatMap((value) => {
      try {
        const adapterType = sanitizeAdapterType(value.adapterType) ?? 'sub2api'
        const detectedAdapterType = sanitizeDetectedAdapterType(value.detectedAdapterType)
        const baseUrl = normalizeStationBaseUrl(value.baseUrl, adapterType === 'auto' ? detectedAdapterType : adapterType)
        const apiPaths = applyNewApiPathDefaults(applySub2ApiKeyPathDefault(applyKnownSourceStationApiPathDefaults(baseUrl, applyLcodexApiPathDefaults(baseUrl, {
          ...defaultStationApiPaths,
          ...normalizeStationApiPaths(value.apiPaths)
        })), adapterType, detectedAdapterType), adapterType, detectedAdapterType)
        const readMapping = normalizeStationReadMapping(value.readMapping)
        const configuredApiBaseUrl = sanitizeApiBaseUrl(value.apiBaseUrl)
        const apiBaseUrl = readMapping?.template === 'custom' && configuredApiBaseUrl
          ? resolveSameOriginHttpsApiBaseUrl(baseUrl, configuredApiBaseUrl)
          : resolveStoredApiBaseUrl(baseUrl, configuredApiBaseUrl, apiPaths)
        return [{
          ...value,
          stationRole: sanitizeStationRole(value.stationRole),
          adapterType,
          detectedAdapterType,
          sessionAuthMode: sanitizeNewApiSessionAuthMode(value.sessionAuthMode),
          newApiSelectedUserId: value.newApiSelectedUserId,
          baseUrl,
          rechargeRatio: sanitizeRechargeRatio(value.rechargeRatio),
          lowBalanceThreshold: sanitizeLowBalanceThreshold(value.lowBalanceThreshold),
          apiBaseUrl,
          apiPaths,
          readMapping,
          autoReauthEnabled: Boolean(value.autoReauthEnabled),
          autoReauthStatus: sanitizeAutoReauthStatus(value.autoReauthStatus)
        }]
      } catch {
        return []
      }
    })
}

async function writeStored(stations: StoredStation[]): Promise<void> {
  const payload = stations.map((station) => ({ ...station }))
  await writeDataFileAtomic(storagePath(), JSON.stringify(payload, null, 2))
}

/**
 * Station mutations are read-modify-write over the single credential file, so
 * they must not interleave. Two concurrent token rotations would otherwise
 * each start from the same snapshot and the later write would silently drop
 * the earlier station's rotated refresh token.
 */
async function mutateStations(mutator: (current: StoredStation[]) => StoredStation[] | undefined): Promise<StoredStation[]> {
  let result: StoredStation[] | undefined
  const operation = stationMutationQueue.then(async () => {
    const current = await readStored()
    const next = mutator(current)
    if (next) await writeStored(next)
    result = next ?? current
  })
  stationMutationQueue = operation.catch(() => undefined)
  await operation
  return result ?? []
}

function isGroupChangeKind(value: unknown): value is GroupChangeKind {
  return value === 'added' || value === 'removed' || value === 'rate-up' || value === 'rate-down'
}

function normalizeHiddenGroupKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))]
}

function isGroupCapabilityTagId(value: unknown): value is GroupCapabilityTagId {
  return value === 'image'
    || value === 'coding'
    || value === 'vision'
    || value === 'embedding'
    || value === 'audio'
    || value === 'video'
    || value === 'chat'
}

function normalizeManualGroupTags(value: unknown): Record<string, GroupCapabilityTagId[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, tags]) => {
      const normalizedKey = key.trim()
      if (!normalizedKey || !Array.isArray(tags)) return undefined
      const normalizedTags = [...new Set(tags.filter(isGroupCapabilityTagId))]
      return normalizedTags.length > 0 ? [normalizedKey, normalizedTags] as const : undefined
    })
    .filter((entry): entry is readonly [string, GroupCapabilityTagId[]] => Boolean(entry))
  return Object.fromEntries(entries)
}

function normalizeGroupChangeEvents(value: unknown): GroupChangeEvent[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is GroupChangeEvent => {
      if (!item || typeof item !== 'object') return false
      const event = item as Partial<GroupChangeEvent>
      return typeof event.id === 'string'
        && isGroupChangeKind(event.kind)
        && typeof event.stationId === 'string'
        && typeof event.stationName === 'string'
        && typeof event.groupId === 'number'
        && typeof event.groupName === 'string'
        && typeof event.platform === 'string'
        && typeof event.occurredAt === 'string'
    })
    .slice(0, 50_000)
}

function normalizeDismissedGroupChangeEventIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))]
}

function looksLikeSecretLabel(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/bearer\s+/i.test(trimmed) || /^sk-[a-z0-9_-]{16,}/i.test(trimmed) || /^eyJ[a-z0-9_-]+\./i.test(trimmed)) return true
  return trimmed.length > 48 && !/\s/.test(trimmed)
}

function looksLikeCredential(value: string): boolean {
  const trimmed = value.trim()
  return /bearer\s+/i.test(trimmed) || /^sk-[a-z0-9_-]{16,}/i.test(trimmed) || /^eyJ[a-z0-9_-]+\./i.test(trimmed)
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value.trim())
      : undefined
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function normalizeInternalUserProfiles(value: unknown): InternalUserProfile[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const profile = item as Partial<InternalUserProfile>
    const userId = normalizePositiveInteger(profile.userId)
    const accountStationId = typeof profile.accountStationId === 'string' ? profile.accountStationId.trim() : ''
    if (!accountStationId || userId === undefined) return []
    const key = `${accountStationId}:${userId}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{
      accountStationId,
      userId,
      updatedAt: normalizeIsoTimestamp(profile.updatedAt) ?? new Date(0).toISOString()
    }]
  }).slice(0, 10_000)
}

function normalizeAccountUpstreamMappings(value: unknown): AccountUpstreamMapping[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const mapping = item as Partial<AccountUpstreamMapping>
      if (typeof mapping.accountStationId !== 'string' || !mapping.accountStationId.trim()) return []
      const accountId = normalizePositiveInteger(mapping.accountId)
      if (accountId === undefined) return []
      if (typeof mapping.sourceStationId !== 'string' || !mapping.sourceStationId.trim()) return []
      const sourceGroupId = normalizePositiveInteger(mapping.sourceGroupId)
      if (sourceGroupId === undefined) return []
      const key = `${mapping.accountStationId}:${accountId}`
      if (seen.has(key)) return []
      seen.add(key)
      const sourceKeyLabel = typeof mapping.sourceKeyLabel === 'string' && !looksLikeSecretLabel(mapping.sourceKeyLabel)
        ? mapping.sourceKeyLabel.trim().slice(0, 80) || undefined
        : undefined
      const sourceKeyId = typeof mapping.sourceKeyId === 'string' && !looksLikeSecretLabel(mapping.sourceKeyId)
        ? mapping.sourceKeyId.trim().slice(0, 160) || undefined
        : undefined
      return [{
        accountStationId: mapping.accountStationId.trim(),
        accountId,
        sourceStationId: mapping.sourceStationId.trim(),
        sourceGroupId,
        sourceKeyId,
        sourceKeyLabel,
        updatedAt: typeof mapping.updatedAt === 'string' && mapping.updatedAt.trim()
          ? mapping.updatedAt
          : new Date(0).toISOString()
      }]
    })
    .slice(0, 2_000)
}

function isAccountCostKind(value: unknown): value is AccountCostKind {
  return value === 'upstream-metered' || value === 'self-owned-exempt' || value === 'gifted' || value === 'subscription' || value === 'manual'
}

function sanitizeOptionalCostNumber(value: unknown, max = 1_000_000_000): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numberValue) || numberValue < 0) return undefined
  return Math.min(numberValue, max)
}

function normalizeAccountCostProfiles(value: unknown): AccountCostProfile[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const profile = item as Partial<AccountCostProfile>
      if (typeof profile.accountStationId !== 'string' || !profile.accountStationId.trim()) return []
      const accountId = profile.accountId
      if (typeof accountId !== 'number' || !Number.isInteger(accountId) || accountId <= 0) return []
      if (!isAccountCostKind(profile.kind)) return []
      const key = `${profile.accountStationId}:${accountId}`
      if (seen.has(key)) return []
      seen.add(key)
      const fixedCostAmount = sanitizeOptionalCostNumber(profile.fixedCostAmount)
      const variableCostMultiplier = sanitizeOptionalCostNumber(profile.variableCostMultiplier, 1_000_000)
      const cycleDays = sanitizeOptionalCostNumber(profile.cycleDays, 366)
      const isCostExempt = profile.kind === 'self-owned-exempt'
      const note = typeof profile.note === 'string' && !looksLikeSecretLabel(profile.note)
        ? profile.note.trim().slice(0, 120) || undefined
        : undefined
      return [{
        accountStationId: profile.accountStationId.trim(),
        accountId,
        kind: profile.kind,
        fixedCostAmount: isCostExempt ? undefined : fixedCostAmount,
        cycleDays: isCostExempt ? undefined : cycleDays,
        cycleStartedAt: isCostExempt ? undefined : typeof profile.cycleStartedAt === 'string' && profile.cycleStartedAt.trim() ? profile.cycleStartedAt.trim() : undefined,
        variableCostMultiplier: isCostExempt ? undefined : variableCostMultiplier,
        note,
        updatedAt: typeof profile.updatedAt === 'string' && profile.updatedAt.trim()
          ? profile.updatedAt
          : new Date(0).toISOString()
      }]
    })
    .slice(0, 2_000)
}

function normalizeIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined
}

function normalizeTimeCostLedger(value: unknown): TimeCostLedger {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyTimeCostLedger()
  const ledger = value as Partial<TimeCostLedger>
  const rateObservations = Array.isArray(ledger.rateObservations)
    ? ledger.rateObservations.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const observation = item as TimeCostLedger['rateObservations'][number]
        const observedAt = normalizeIsoTimestamp(observation.observedAt)
        if (typeof observation.id !== 'string' || looksLikeCredential(observation.id)
          || typeof observation.stationId !== 'string' || !observation.stationId.trim()
          || !normalizePositiveInteger(observation.groupId)
          || !Number.isFinite(observation.rateMultiplier) || observation.rateMultiplier < 0
          || !Number.isFinite(observation.rechargeRatio) || observation.rechargeRatio <= 0
          || !Number.isFinite(observation.effectiveMultiplier) || observation.effectiveMultiplier < 0
          || !observedAt || observation.timeSource !== 'observed') return []
        return [{
          id: observation.id.trim().slice(0, 240),
          stationId: observation.stationId.trim(),
          groupId: observation.groupId,
          rateMultiplier: observation.rateMultiplier,
          rechargeRatio: observation.rechargeRatio,
          effectiveMultiplier: observation.effectiveMultiplier,
          observedAt,
          timeSource: 'observed' as const
        }]
      }).slice(0, 20_000)
    : []
  const sourceKeyGroupObservations = Array.isArray(ledger.sourceKeyGroupObservations)
    ? ledger.sourceKeyGroupObservations.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const observation = item as TimeCostLedger['sourceKeyGroupObservations'][number]
        const observedAt = normalizeIsoTimestamp(observation.observedAt)
        const groupIds = Array.isArray(observation.groupIds)
          ? [...new Set(observation.groupIds.filter((id): id is number => Boolean(normalizePositiveInteger(id))))].sort((left, right) => left - right)
          : []
        if (typeof observation.id !== 'string' || looksLikeCredential(observation.id)
          || typeof observation.stationId !== 'string' || !observation.stationId.trim()
          || typeof observation.sourceKeyId !== 'string' || looksLikeSecretLabel(observation.sourceKeyId)
          || !observation.sourceKeyId.trim() || !observedAt || observation.timeSource !== 'observed') return []
        return [{
          id: observation.id.trim().slice(0, 240),
          stationId: observation.stationId.trim(),
          sourceKeyId: observation.sourceKeyId.trim().slice(0, 160),
          groupIds,
          observedAt,
          timeSource: 'observed' as const
        }]
      }).slice(0, 20_000)
    : []
  const mappingEvents = Array.isArray(ledger.mappingEvents)
    ? ledger.mappingEvents.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const event = item as TimeCostLedger['mappingEvents'][number]
        const effectiveAt = normalizeIsoTimestamp(event.effectiveAt)
        const sourceKeyId = typeof event.sourceKeyId === 'string' && !looksLikeSecretLabel(event.sourceKeyId)
          ? event.sourceKeyId.trim().slice(0, 160) || undefined
          : undefined
        const sourceStationId = typeof event.sourceStationId === 'string' ? event.sourceStationId.trim() || undefined : undefined
        const sourceGroupId = normalizePositiveInteger(event.sourceGroupId)
        if (typeof event.id !== 'string' || looksLikeCredential(event.id)
          || typeof event.accountStationId !== 'string' || !event.accountStationId.trim()
          || !normalizePositiveInteger(event.accountId) || !effectiveAt
          || (event.timeSource !== 'observed' && event.timeSource !== 'manual')) return []
        return [{
          id: event.id.trim().slice(0, 240),
          accountStationId: event.accountStationId.trim(),
          accountId: event.accountId,
          sourceStationId,
          sourceKeyId,
          sourceGroupId,
          effectiveAt,
          timeSource: event.timeSource
        }]
      }).slice(0, 20_000)
    : []
  const usageEntries = Array.isArray(ledger.usageEntries)
    ? ledger.usageEntries.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const entry = item as TimeCostLedger['usageEntries'][number]
        const occurredAt = normalizeIsoTimestamp(entry.occurredAt)
        if (typeof entry.id !== 'string' || looksLikeCredential(entry.id)
          || typeof entry.accountStationId !== 'string' || !entry.accountStationId.trim()
          || !normalizePositiveInteger(entry.accountId)
          || !Number.isFinite(entry.usageAmount) || entry.usageAmount < 0 || !occurredAt) return []
        return [{
          id: entry.id.trim().slice(0, 240),
          accountStationId: entry.accountStationId.trim(),
          accountId: entry.accountId,
          sellingGroupId: normalizePositiveInteger(entry.sellingGroupId),
          usageAmount: entry.usageAmount,
          occurredAt
        }]
      }).slice(0, 50_000)
    : []
  const usageCoverage = Array.isArray(ledger.usageCoverage)
    ? ledger.usageCoverage.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const coverage = item as Partial<UsageLedgerCoverage>
        const fetchedAt = normalizeIsoTimestamp(coverage.fetchedAt)
        const state = coverage.state
        if (typeof coverage.accountStationId !== 'string' || !coverage.accountStationId.trim() || !fetchedAt
          || !['complete', 'page-limit', 'incomplete', 'unavailable'].includes(String(state))) return []
        const pagesFetched = sanitizeOptionalCostNumber(coverage.pagesFetched, 100)
        const recordsSeen = sanitizeOptionalCostNumber(coverage.recordsSeen, 1_000_000)
        const acceptedEntries = sanitizeOptionalCostNumber(coverage.acceptedEntries, 1_000_000)
        if (pagesFetched === undefined || recordsSeen === undefined || acceptedEntries === undefined) return []
        return [{
          accountStationId: coverage.accountStationId.trim(),
          fetchedAt,
          state: state as UsageLedgerCoverage['state'],
          pagesFetched: Math.floor(pagesFetched),
          recordsSeen: Math.floor(recordsSeen),
          acceptedEntries: Math.floor(acceptedEntries),
          detail: typeof coverage.detail === 'string' && !looksLikeSecretLabel(coverage.detail)
            ? coverage.detail.trim().slice(0, 160) || undefined
            : undefined
        }]
      }).slice(0, 2_000)
    : []
  const profitUsageRecords = Array.isArray(ledger.profitUsageRecords)
    ? ledger.profitUsageRecords.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const record = item as ProfitUsageRecord
        const occurredAt = normalizeIsoTimestamp(record.occurredAt)
        if (typeof record.id !== 'string' || looksLikeCredential(record.id)
          || typeof record.accountStationId !== 'string' || !record.accountStationId.trim()
          || !normalizePositiveInteger(record.accountId) || !occurredAt
          || !Number.isFinite(record.revenue) || record.revenue < 0
          || !Number.isFinite(record.upstreamBaseCost) || record.upstreamBaseCost < 0
          || !Number.isFinite(record.accountRateMultiplier) || record.accountRateMultiplier < 0) return []
        return [{
          id: record.id.trim().slice(0, 240), accountStationId: record.accountStationId.trim(), accountId: record.accountId,
          userId: normalizePositiveInteger(record.userId),
          sellingGroupId: normalizePositiveInteger(record.sellingGroupId), occurredAt,
          revenue: record.revenue, upstreamBaseCost: record.upstreamBaseCost, accountRateMultiplier: record.accountRateMultiplier
        }]
      }).slice(0, 50_000)
    : []
  const profitUsageCoverage = Array.isArray(ledger.profitUsageCoverage)
    ? ledger.profitUsageCoverage.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const coverage = item as ProfitArchiveDayCoverage
        const fetchedAt = normalizeIsoTimestamp(coverage.fetchedAt)
        if (typeof coverage.accountStationId !== 'string' || !coverage.accountStationId.trim()
          || !/^\d{4}-\d{2}-\d{2}$/.test(coverage.date) || !fetchedAt
          || !['complete', 'page-limit', 'incomplete', 'unavailable'].includes(coverage.state)
          || !Number.isFinite(coverage.pagesFetched) || !Number.isFinite(coverage.recordsSeen) || !Number.isFinite(coverage.acceptedEntries)) return []
        return [{
          accountStationId: coverage.accountStationId.trim(), date: coverage.date, fetchedAt, state: coverage.state,
          pagesFetched: Math.max(0, Math.floor(coverage.pagesFetched)), recordsSeen: Math.max(0, Math.floor(coverage.recordsSeen)), acceptedEntries: Math.max(0, Math.floor(coverage.acceptedEntries)),
          detail: typeof coverage.detail === 'string' && !looksLikeSecretLabel(coverage.detail) ? coverage.detail.trim().slice(0, 160) || undefined : undefined
        }]
      }).slice(0, 2_000)
    : []
  return { rateObservations, sourceKeyGroupObservations, mappingEvents, usageEntries, usageCoverage, profitUsageRecords, profitUsageCoverage }
}

function emptyUiPreferences(): UiPreferences {
  return { hiddenGroupKeys: [], operatingExcludedGroupKeys: [], manualGroupTags: {}, groupChangeEvents: [], dismissedGroupChangeEventIds: [], accountUpstreamMappings: [], accountCostProfiles: [], internalUserProfiles: [], timeCostLedger: emptyTimeCostLedger() }
}

function normalizeUiPreferences(value: unknown): UiPreferences {
  if (!value || typeof value !== 'object') return emptyUiPreferences()
  const preferences = value as Partial<UiPreferences>
  return {
    hiddenGroupKeys: normalizeHiddenGroupKeys(preferences.hiddenGroupKeys),
    operatingExcludedGroupKeys: normalizeHiddenGroupKeys(preferences.operatingExcludedGroupKeys),
    manualGroupTags: normalizeManualGroupTags(preferences.manualGroupTags),
    groupChangeEvents: normalizeGroupChangeEvents(preferences.groupChangeEvents),
    dismissedGroupChangeEventIds: normalizeDismissedGroupChangeEventIds(preferences.dismissedGroupChangeEventIds),
    accountUpstreamMappings: normalizeAccountUpstreamMappings(preferences.accountUpstreamMappings),
    accountCostProfiles: normalizeAccountCostProfiles(preferences.accountCostProfiles),
    internalUserProfiles: normalizeInternalUserProfiles(preferences.internalUserProfiles),
    timeCostLedger: normalizeTimeCostLedger(preferences.timeCostLedger)
  }
}

function parseUiPreferencesDocument(raw: string): Record<string, unknown> {
  const value = JSON.parse(raw) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('偏好数据文件的顶层结构不是对象')
  }
  return value as Record<string, unknown>
}

async function writeUiPreferences(preferences: UiPreferences): Promise<void> {
  await writeDataFileAtomic(preferencesPath(), JSON.stringify(normalizeUiPreferences(preferences), null, 2))
}

async function mutateUiPreferences(mutator: (current: UiPreferences) => UiPreferences): Promise<UiPreferences> {
  let result: UiPreferences | undefined
  const operation = preferenceMutationQueue.then(async () => {
    const current = await getUiPreferences()
    const next = normalizeUiPreferences(mutator(current))
    if (JSON.stringify(next) !== JSON.stringify(current)) await writeUiPreferences(next)
    result = next
  })
  preferenceMutationQueue = operation.catch(() => undefined)
  await operation
  return result ?? emptyUiPreferences()
}

function nextSecret(inputValue: string | undefined, existingValue: string | undefined): string | undefined {
  const trimmed = inputValue?.trim()
  if (!trimmed) return existingValue
  return encrypt(trimmed)
}

export function publicStations(stations: StoredStation[]): StationPublic[] {
  return stations.map(toPublic)
}

export async function listStations(): Promise<StoredStation[]> {
  return readStored()
}

export async function getUiPreferences(): Promise<UiPreferences> {
  let parsed: unknown
  try {
    parsed = await readDataFile(preferencesPath(), parseUiPreferencesDocument)
  } catch (error) {
    if (error instanceof StationDataFileCorruptError && error.backupPath) {
      console.error(error.message)
      return emptyUiPreferences()
    }
    throw error
  }
  return parsed === undefined ? emptyUiPreferences() : normalizeUiPreferences(parsed)
}

export async function getDataCenterSummary(): Promise<DataCenterSummary> {
  const stations = await readStored()
  const preferences = await getUiPreferences()
  return {
    userDataPath: app.getPath('userData'),
    isCustomUserDataPath: Boolean(process.env.AIZZZWATCH_USER_DATA_DIR?.trim()),
    stations: {
      count: stations.length,
      withAccessToken: stations.filter((station) => Boolean(station.accessToken)).length,
      withRefreshToken: stations.filter((station) => Boolean(station.refreshToken)).length,
      withAdminToken: stations.filter((station) => Boolean(station.adminToken)).length
    },
    preferences: {
      hiddenGroupKeys: preferences.hiddenGroupKeys.length,
      operatingExcludedGroupKeys: preferences.operatingExcludedGroupKeys.length,
      manualGroupTags: Object.keys(preferences.manualGroupTags).length,
      groupChangeEvents: preferences.groupChangeEvents.length,
      dismissedGroupChangeEventIds: preferences.dismissedGroupChangeEventIds.length,
      accountUpstreamMappings: preferences.accountUpstreamMappings.length,
      accountCostProfiles: preferences.accountCostProfiles.length,
      internalUserProfiles: preferences.internalUserProfiles.length
    },
    files: {
      stations: await dataFileSummary(storagePath()),
      preferences: await dataFileSummary(preferencesPath())
    }
  }
}

export async function saveHiddenGroupKeys(keys: string[]): Promise<UiPreferences> {
  return mutateUiPreferences((current) => ({ ...current, hiddenGroupKeys: normalizeHiddenGroupKeys(keys) }))
}

export async function saveOperatingExcludedGroupKeys(keys: string[]): Promise<UiPreferences> {
  return mutateUiPreferences((current) => ({ ...current, operatingExcludedGroupKeys: normalizeHiddenGroupKeys(keys) }))
}

export async function saveManualGroupTags(tags: Record<string, GroupCapabilityTagId[]>): Promise<UiPreferences> {
  return mutateUiPreferences((current) => ({ ...current, manualGroupTags: normalizeManualGroupTags(tags) }))
}

export async function saveGroupChangeEvents(events: GroupChangeEvent[]): Promise<UiPreferences> {
  return mutateUiPreferences((current) => ({ ...current, groupChangeEvents: normalizeGroupChangeEvents(events) }))
}

export async function saveDismissedGroupChangeEventIds(ids: string[]): Promise<UiPreferences> {
  return mutateUiPreferences((current) => ({ ...current, dismissedGroupChangeEventIds: normalizeDismissedGroupChangeEventIds(ids) }))
}

export async function saveAccountUpstreamMappings(mappings: AccountUpstreamMapping[]): Promise<UiPreferences> {
  return mutateUiPreferences((current) => {
    const accountUpstreamMappings = normalizeAccountUpstreamMappings(mappings)
    return {
      ...current,
      accountUpstreamMappings,
      timeCostLedger: appendAccountUpstreamMappingEvents(current.timeCostLedger, current.accountUpstreamMappings, accountUpstreamMappings)
    }
  })
}

export async function saveAccountCostProfiles(profiles: AccountCostProfile[]): Promise<UiPreferences> {
  return mutateUiPreferences((current) => ({ ...current, accountCostProfiles: normalizeAccountCostProfiles(profiles) }))
}

export async function saveInternalUserProfiles(profiles: InternalUserProfile[]): Promise<UiPreferences> {
  return mutateUiPreferences((current) => ({ ...current, internalUserProfiles: normalizeInternalUserProfiles(profiles) }))
}

export interface RecordedTimeCostLedgerSnapshot {
  preferences: UiPreferences
  newGroupChangeEvents: GroupChangeEvent[]
}

export async function recordTimeCostLedgerSnapshot(
  station: Pick<StoredStation, 'id' | 'rechargeRatio'> & { name?: string },
  snapshot: StationSnapshot,
  usageDetail?: { entries: UsageLedgerEntry[]; coverage: UsageLedgerCoverage }
): Promise<RecordedTimeCostLedgerSnapshot> {
  if (snapshot.health !== 'healthy') return { preferences: await getUiPreferences(), newGroupChangeEvents: [] }
  let newGroupChangeEvents: GroupChangeEvent[] = []
  const preferences = await mutateUiPreferences((current) => {
    const observedAt = snapshot.lastSuccessAt ?? snapshot.lastUpdatedAt ?? new Date().toISOString()
    const withCurrentMappings = appendAccountUpstreamMappingEvents(
      current.timeCostLedger,
      [],
      current.accountUpstreamMappings,
      observedAt
    )
    const groupChangeEvents = appendObservedGroupRateChanges(
      current.groupChangeEvents,
      withCurrentMappings,
      station.id,
      station.name ?? snapshot.stationName,
      snapshot.groups,
      observedAt
    )
    const existingIds = new Set(current.groupChangeEvents.map((event) => event.id))
    newGroupChangeEvents = groupChangeEvents.filter((event) => !existingIds.has(event.id))
    return {
      ...current,
      groupChangeEvents,
      timeCostLedger: appendTimeCostSnapshot(withCurrentMappings, {
        stationId: station.id,
        rechargeRatio: station.rechargeRatio,
        snapshot,
        usageEntries: usageDetail?.entries,
        usageCoverage: usageDetail?.coverage,
        observedAt
      })
    }
  })
  return { preferences, newGroupChangeEvents }
}

export async function recordProfitUsageArchiveDay(records: ProfitUsageRecord[], coverage: ProfitArchiveDayCoverage): Promise<UiPreferences> {
  return mutateUiPreferences((current) => ({
    ...current,
    timeCostLedger: appendProfitUsageArchiveDay(current.timeCostLedger, records, coverage)
  }))
}

export async function saveStation(input: StationInput): Promise<StoredStation[]> {
  const requestedAdapterType = sanitizeAdapterType(input.adapterType)
  const pollingIntervalMs = Math.min(Math.max(input.pollingIntervalMs ?? 30_000, 15_000), 300_000)
  const rechargeRatio = sanitizeRechargeRatio(input.rechargeRatio, true)
  const lowBalanceThreshold = sanitizeLowBalanceThreshold(input.lowBalanceThreshold, true)
  return mutateStations((stations) => {
  const existing = input.id ? stations.find((station) => station.id === input.id) : undefined
  const adapterType = requestedAdapterType ?? existing?.adapterType ?? 'sub2api'
  const detectedAdapterType = sanitizeDetectedAdapterType(input.detectedAdapterType) ?? existing?.detectedAdapterType
  const isNewApiStation = adapterType === 'newapi' || (adapterType === 'auto' && detectedAdapterType === 'newapi')
  const requestedSessionAuthMode = sanitizeNewApiSessionAuthMode(input.sessionAuthMode)
  const hasNewAccessToken = Boolean(input.accessToken?.trim())
  const hasNewApiSelectedUserIdInput = Object.prototype.hasOwnProperty.call(input, 'newApiSelectedUserId')
  // A verified Cookie-only reauthorization replaces a prior Bearer session.
  // Conversely, a newly pasted NewAPI token intentionally returns the station
  // to the standard Bearer/refresh contract without exposing that mode to IPC.
  const sessionAuthMode = requestedSessionAuthMode
    ?? (isNewApiStation && hasNewAccessToken ? 'refresh-token' : existing?.sessionAuthMode)
  const baseUrl = normalizeStationBaseUrl(input.baseUrl, adapterType === 'auto' ? detectedAdapterType : adapterType)
  const name = input.name.trim() || new URL(baseUrl).hostname
  const hasApiPathsInput = Object.prototype.hasOwnProperty.call(input, 'apiPaths')
  const apiPaths = applyNewApiPathDefaults(applySub2ApiKeyPathDefault(applyKnownSourceStationApiPathDefaults(baseUrl, applyLcodexApiPathDefaults(baseUrl, {
    ...defaultStationApiPaths,
    ...normalizeStationApiPaths(hasApiPathsInput ? input.apiPaths : existing?.apiPaths)
  })), adapterType, detectedAdapterType), adapterType, detectedAdapterType)
  const hasApiBaseUrlInput = Object.prototype.hasOwnProperty.call(input, 'apiBaseUrl')
  const lcodexCompatibility = resolveLcodexStationCompatibility(baseUrl)
  const requestedApiBaseUrl = sanitizeApiBaseUrl(input.apiBaseUrl, true)
  const candidateApiBaseUrl = lcodexCompatibility && (!requestedApiBaseUrl || isLcodexLegacyPublicApiUrl(requestedApiBaseUrl))
    ? lcodexCompatibility.managementApiBaseUrl
    : requestedApiBaseUrl ?? (hasApiBaseUrlInput ? baseUrl : existing?.apiBaseUrl ?? lcodexCompatibility?.managementApiBaseUrl ?? baseUrl)
  // A manually entered or already-saved root is intentional configuration.
  // The legacy compatibility repair applies only to a newly inferred root;
  // otherwise a valid custom root such as /api would be silently rewritten
  // back to the inferred /api/v1 default.
  const apiBaseUrl = hasApiBaseUrlInput || Boolean(existing?.apiBaseUrl)
    ? candidateApiBaseUrl
    : resolveStoredApiBaseUrl(baseUrl, candidateApiBaseUrl, apiPaths)
  // An explicit undefined means the caller intentionally removed its custom
  // read mapping; an omitted property keeps a saved mapping during normal edits.
  const hasReadMappingInput = Object.prototype.hasOwnProperty.call(input, 'readMapping')
  const readMapping = hasReadMappingInput ? normalizeStationReadMapping(input.readMapping) : existing?.readMapping
  if (readMapping?.template === 'custom') {
    if (new URL(apiBaseUrl).protocol !== 'https:') {
      throw new Error('自定义读取映射仅允许 HTTPS 站点')
    }
    resolveSameOriginHttpsApiBaseUrl(baseUrl, apiBaseUrl)
  } else if (Object.keys(readMapping?.capabilities ?? {}).length > 0 && new URL(apiBaseUrl).protocol !== 'https:') {
    throw new Error('自定义读取映射仅允许 HTTPS 站点')
  }
  for (const path of Object.values(apiPaths)) {
    if (path) resolveStationApiRequestUrl(apiBaseUrl, path)
  }
  const loginAccount = input.loginAccount?.trim()
  const loginPassword = input.loginPassword
  const hasNewLoginPassword = typeof loginPassword === 'string' && loginPassword.length > 0
  if (!input.clearSavedLoginCredentials && Boolean(loginAccount) !== hasNewLoginPassword) {
    throw new Sub2ApiError('保存网页登录凭据时必须同时填写账号和密码', 'INVALID_RESPONSE')
  }
  const willHaveSavedLoginCredentials = !input.clearSavedLoginCredentials
    && Boolean(hasNewLoginPassword ? loginAccount : existing?.loginAccount)
    && Boolean(hasNewLoginPassword ? loginPassword : existing?.loginPassword)
  const autoReauthEnabled = input.clearSavedLoginCredentials
    ? false
    : input.autoReauthEnabled ?? existing?.autoReauthEnabled ?? false
  if (autoReauthEnabled && !willHaveSavedLoginCredentials) {
    throw new Sub2ApiError('开启自动重新登录前，必须先保存网页登录账号和密码', 'INVALID_RESPONSE')
  }
  if (autoReauthEnabled && new URL(baseUrl).protocol !== 'https:') {
    throw new Sub2ApiError('自动重新登录仅允许 HTTPS 站点', 'INVALID_RESPONSE')
  }
  const station: StoredStation = {
    id: existing?.id ?? input.id ?? randomUUID(),
    name,
    baseUrl,
    apiBaseUrl,
    stationRole: sanitizeStationRole(input.stationRole) ?? existing?.stationRole ?? 'source',
    adapterType,
    detectedAdapterType,
    rechargeRatio: input.rechargeRatio === undefined ? existing?.rechargeRatio ?? 1 : rechargeRatio,
    lowBalanceThreshold: input.lowBalanceThreshold === undefined ? existing?.lowBalanceThreshold ?? 10 : lowBalanceThreshold,
    apiPaths,
    readMapping,
    accessToken: sessionAuthMode === 'cookie-session' ? undefined : nextSecret(input.accessToken, existing?.accessToken),
    refreshToken: sessionAuthMode === 'cookie-session' ? undefined : nextSecret(input.refreshToken, existing?.refreshToken),
    sessionCookie: nextSecret(input.sessionCookie, existing?.sessionCookie),
    sessionAuthMode,
    newApiSelectedUserId: isNewApiStation && sessionAuthMode === 'cookie-session'
      ? hasNewApiSelectedUserIdInput
        ? encrypt(sanitizeNewApiSelectedUserId(input.newApiSelectedUserId))
        : existing?.newApiSelectedUserId
      : undefined,
    userAgent: nextSecret(input.userAgent, existing?.userAgent),
    adminToken: nextSecret(input.adminToken, existing?.adminToken),
    adminCredentialType: input.adminCredentialType ?? existing?.adminCredentialType,
    loginAccount: input.clearSavedLoginCredentials ? undefined : nextSecret(loginAccount, existing?.loginAccount),
    loginPassword: input.clearSavedLoginCredentials ? undefined : hasNewLoginPassword ? encrypt(loginPassword) : existing?.loginPassword,
    autoReauthEnabled,
    autoReauthStatus: autoReauthEnabled && !hasNewLoginPassword ? existing?.autoReauthStatus : undefined,
    pollingIntervalMs
  }
  return existing
    ? stations.map((item) => (item.id === station.id ? station : item))
    : [...stations, station]
  })
}

function sanitizeApiBaseUrl(value: unknown, strict = false): string | undefined {
  if (value === undefined || value === null) return undefined
  const trimmed = String(value).trim().replace(/\/+$/, '')
  if (!trimmed) return undefined
  try {
    const url = new URL(trimmed)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
    return trimmed
  } catch {
    if (!strict) return undefined
    throw new Sub2ApiError('API 基址不是有效 URL', 'INVALID_RESPONSE')
  }
}

function isSameOriginApiPathPrefixUrl(rootCandidate: string, versionedCandidate: string): boolean {
  try {
    const root = new URL(rootCandidate)
    const versioned = new URL(versionedCandidate)
    const rootPath = root.pathname.replace(/\/+$/g, '') || '/'
    const versionedPath = versioned.pathname.replace(/\/+$/g, '') || '/'
    return root.origin === versioned.origin
      && rootPath !== versionedPath
      && (rootPath === '/' || versionedPath.startsWith(`${rootPath}/`))
      && /\/api(?:\/|$)/i.test(versionedPath)
  } catch {
    return false
  }
}

function apiPathsAlreadyIncludeApiPrefix(paths: StationApiPaths): boolean {
  return Object.values(paths).some((path) => typeof path === 'string' && /^\/api(?:\/|$)/i.test(path.trim()))
}

function resolveStoredApiBaseUrl(baseUrl: string, apiBaseUrl: string | undefined, apiPaths: StationApiPaths): string {
  if (!apiBaseUrl) return baseUrl
  if (isSameOriginApiPathPrefixUrl(apiBaseUrl, baseUrl) && !apiPathsAlreadyIncludeApiPrefix(apiPaths)) return baseUrl
  return apiBaseUrl
}

export async function removeStation(id: string): Promise<StoredStation[]> {
  return mutateStations((stations) => stations.filter((station) => station.id !== id))
}

export async function updateStationAutoReauthStatus(id: string, status: StationAutoReauthStatus): Promise<StoredStation[]> {
  return mutateStations((stations) => {
    if (!stations.some((station) => station.id === id)) return undefined
    return stations.map((station) => station.id === id ? { ...station, autoReauthStatus: status } : station)
  })
}

/** Reclassify a persisted in-flight keepalive after an app restart. */
export async function recoverInterruptedAutoReauthStatuses(): Promise<StoredStation[]> {
  return mutateStations((stations) => {
    let changed = false
    const now = new Date().toISOString()
    const next = stations.map((station) => {
      if (station.autoReauthStatus?.state !== 'pending') return station
      changed = true
      return {
        ...station,
        autoReauthStatus: {
          state: 'interrupted' as const,
          at: now,
          reason: 'application-restarted' as const,
          attempts: station.autoReauthStatus.attempts ?? 0
        }
      }
    })
    return changed ? next : undefined
  })
}

export function stationTokens(
  station: Pick<StoredStation, 'accessToken' | 'refreshToken' | 'sessionCookie' | 'newApiSelectedUserId' | 'userAgent' | 'adminToken' | 'adminCredentialType'>
): Pick<StoredStation, 'accessToken' | 'refreshToken' | 'sessionCookie' | 'newApiSelectedUserId' | 'userAgent' | 'adminToken' | 'adminCredentialType'> {
  return {
    accessToken: decrypt(station.accessToken),
    refreshToken: decrypt(station.refreshToken),
    sessionCookie: decrypt(station.sessionCookie),
    newApiSelectedUserId: sanitizeNewApiSelectedUserId(decrypt(station.newApiSelectedUserId)),
    userAgent: decrypt(station.userAgent),
    adminToken: decrypt(station.adminToken),
    adminCredentialType: station.adminCredentialType
  }
}

export function stationLoginCredentials(station: Pick<StoredStation, 'loginAccount' | 'loginPassword'>): { loginAccount?: string; loginPassword?: string } {
  const loginAccount = decrypt(station.loginAccount)
  const loginPassword = decrypt(station.loginPassword)
  return loginAccount && loginPassword ? { loginAccount, loginPassword } : {}
}
