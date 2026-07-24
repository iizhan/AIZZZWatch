export type WindowMode = 'full' | 'compact' | 'bubble'
export type AdminCredentialType = 'jwt' | 'api-key'
/** Whether a station is an upstream source or the user's own aggregation platform. */
export type StationRole = 'source' | 'own'
/** Controls the HTTP contract used to read a station. */
export type StationAdapterType = 'auto' | 'sub2api' | 'newapi' | 'custom'
export type ResolvedStationAdapterType = Exclude<StationAdapterType, 'auto'>
export type GroupChangeKind = 'added' | 'removed' | 'rate-up' | 'rate-down'
export type GroupCapabilityTagId = 'image' | 'coding' | 'vision' | 'embedding' | 'audio' | 'video' | 'chat'
export type StationAutoReauthState = 'pending' | 'success' | 'manual-required' | 'failed'

/** Safe, local-only status of the most recent password keepalive attempt. */
export interface StationAutoReauthStatus {
  state: StationAutoReauthState
  at: string
}

export type StationHealth = 'loading' | 'healthy' | 'stale' | 'error' | 'forbidden' | 'empty'

export type StationErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'API_ERROR'
  | 'INVALID_RESPONSE'
  | 'ENCRYPTION_UNAVAILABLE'
  | 'UNKNOWN'

export interface StationInput {
  id?: string
  name: string
  baseUrl: string
  apiBaseUrl?: string
  stationRole?: StationRole
  adapterType?: StationAdapterType
  detectedAdapterType?: ResolvedStationAdapterType
  rechargeRatio?: number
  lowBalanceThreshold?: number
  apiPaths?: StationApiPaths
  readMapping?: StationReadMapping
  accessToken?: string
  refreshToken?: string
  sessionCookie?: string
  userAgent?: string
  adminToken?: string
  adminCredentialType?: AdminCredentialType
  /** Write-only local browser-login credential fields. Never returned from StationPublic. */
  loginAccount?: string
  loginPassword?: string
  clearSavedLoginCredentials?: boolean
  /** Allows saved local login credentials to renew an expired station session. */
  autoReauthEnabled?: boolean
  pollingIntervalMs?: number
}

export interface StationPublic {
  id: string
  name: string
  baseUrl: string
  apiBaseUrl?: string
  /** Legacy entries omit this and keep the prior capability-based fallback. */
  stationRole?: StationRole
  /** Legacy entries omit this and remain on the established Sub2API adapter. */
  adapterType?: StationAdapterType
  /** Result of the last explicit read-only auto-detection. */
  detectedAdapterType?: ResolvedStationAdapterType
  rechargeRatio: number
  lowBalanceThreshold: number
  apiPaths: StationApiPaths
  /** Local, read-only response-field mapping for compatible forks. */
  readMapping?: StationReadMapping
  hasAccessToken: boolean
  hasRefreshToken: boolean
  hasAdminToken: boolean
  hasSavedLoginCredentials: boolean
  autoReauthEnabled: boolean
  autoReauthStatus?: StationAutoReauthStatus
  adminCredentialType?: AdminCredentialType
  pollingIntervalMs: number
}

export interface PricingModelSnapshot {
  name: string
  inputPrice?: number
  outputPrice?: number
  perRequestPrice?: number
}

export interface StationApiPaths {
  profile?: string
  balance?: string
  groups?: string
  rates?: string
  channels?: string
  keys?: string
  authRefresh?: string
  adminGroups?: string
  adminAccounts?: string
  adminDashboard?: string
  adminUsers?: string
  adminChannels?: string
  adminPlatforms?: string
  adminUsage?: string
  /** Read-only per-request usage endpoint. Kept separate from aggregate adminUsage. */
  adminUsageLogs?: string
  adminSettings?: string
}

export type StationReadCapability = 'profile' | 'groups' | 'rates' | 'channels' | 'keys'
export type StationReadMappingTemplate = 'sub2api' | 'newapi' | 'lcodex' | 'aihub' | 'custom'
export type StationReadRecordMode = 'list' | 'keyed-map'

/**
 * A deliberately constrained mapping: dot paths only, validated on save, and
 * applied exclusively to same-origin GET responses in the main process.
 */
export interface StationReadCapabilityMapping {
  objectPath?: string
  recordsPath?: string
  recordMode?: StationReadRecordMode
  fields?: Record<string, string>
}

export interface StationReadMapping {
  version: 1
  template: StationReadMappingTemplate
  capabilities: Partial<Record<StationReadCapability, StationReadCapabilityMapping>>
}

export interface StationMappingPreviewCapability {
  capability: StationReadCapability
  state: 'ready' | 'partial' | 'unavailable'
  path: string
  records: number
  fields: string[]
  preview?: string
  detail?: string
}

export interface StationMappingPreview {
  stationId?: string
  generatedAt: string
  capabilities: StationMappingPreviewCapability[]
}

export interface StationApiProbe {
  name: string
  path: string
  method: 'GET' | 'POST' | 'PUT'
  admin?: boolean
}

export interface StationApiProbeResult {
  name: string
  path: string
  method: 'GET' | 'POST' | 'PUT'
  ok: boolean
  status?: number
  hint: string
}

export interface StationDiagnostics {
  apiVariant: 'standard' | 'fork' | 'custom' | 'newapi' | 'unknown'
  detectedAdapterType?: ResolvedStationAdapterType
  needsCookie: boolean
  needsUserAgent: boolean
  probes: StationApiProbeResult[]
  suggestedPaths: StationApiPaths
  notes?: string
}

export interface GroupSnapshot {
  id: number
  name: string
  platform: string
  rateMultiplier: number
  userRateMultiplier?: number
  subscriptionType?: string
  isExclusive?: boolean
  peakRateEnabled?: boolean
  peakRateMultiplier?: number
  pricingAvailable: boolean
  pricingHint?: string
  pricingModels?: PricingModelSnapshot[]
}

export interface SourceKeySnapshot {
  id: string
  label: string
  status?: string
  createdAt?: string
  groupIds: number[]
  groupNames: string[]
  summary?: string
}

export interface AccountSnapshot {
  id: number
  name: string
  platform: string
  apiBaseUrl?: string
  /** Resolved in the main process from a live third-party credential match. */
  upstreamSourceStationId?: string
  upstreamSourceKeyId?: string
  groupIds: number[]
  groups: string[]
  status: string
  scheduleEnabled?: boolean
  baseRateMultiplier?: number
  usageAmount?: number
}

export interface AccountUpstreamMapping {
  accountStationId: string
  accountId: number
  sourceStationId: string
  sourceGroupId: number
  /** Stable upstream key record id only. Never stores the callable key value. */
  sourceKeyId?: string
  sourceKeyLabel?: string
  updatedAt: string
}

export interface CostRateObservation {
  id: string
  stationId: string
  groupId: number
  rateMultiplier: number
  rechargeRatio: number
  effectiveMultiplier: number
  observedAt: string
  timeSource: 'observed'
}

export interface SourceKeyGroupObservation {
  id: string
  stationId: string
  sourceKeyId: string
  groupIds: number[]
  observedAt: string
  timeSource: 'observed'
}

export interface AccountUpstreamMappingEvent {
  id: string
  accountStationId: string
  accountId: number
  sourceStationId?: string
  sourceKeyId?: string
  sourceGroupId?: number
  effectiveAt: string
  timeSource: 'observed' | 'manual'
}

export interface UsageLedgerEntry {
  id: string
  accountStationId: string
  accountId: number
  sellingGroupId?: number
  usageAmount: number
  occurredAt: string
}

/** Minimal administrator usage values required for interval profit analysis. */
export interface ProfitUsageRecord {
  id: string
  accountStationId: string
  accountId: number
  /** Stable station user identifier when the administrator usage row provides one. */
  userId?: number
  sellingGroupId?: number
  occurredAt: string
  /** Customer-side amount actually deducted by this station. */
  revenue: number
  /** Base amount before the account/upstream multiplier. */
  upstreamBaseCost: number
  /** Snapshot of this station's account multiplier at request time. */
  accountRateMultiplier: number
}

/** Coverage of one Shanghai calendar day in the locally archived profit ledger. */
export interface ProfitArchiveDayCoverage {
  accountStationId: string
  date: string
  fetchedAt: string
  state: UsageLedgerCoverageState
  pagesFetched: number
  recordsSeen: number
  acceptedEntries: number
  detail?: string
}

export type ProfitIntervalGranularity = 'day' | 'hour'

export interface ProfitIntervalQuery {
  stationId: string
  startAt: string
  endAt: string
  timezone: 'Asia/Shanghai'
  granularity: ProfitIntervalGranularity
  accountId?: number
  sellingGroupId?: number
}

export interface ProfitIntervalBucket {
  key: string
  label: string
  requests: number
  revenue: number
  exemptRequests: number
  exemptRevenue: number
  accountCost: number
  upstreamCost: number
  attributableRevenue: number
  unattributedRevenue: number
  lossRequests: number
}

export interface ProfitAccountSummary {
  accountId: number
  sellingGroupId?: number
  requests: number
  revenue: number
  exemptRequests: number
  exemptRevenue: number
  accountCost: number
  upstreamCost: number
  attributableRevenue: number
  unattributedRevenue: number
  lossRequests: number
}

/** Local-only reference totals for a selling group excluded from operations. */
export interface PublicWelfareGroupSummary {
  sellingGroupId: number
  requests: number
  revenue: number
  upstreamCost: number
  unresolvedUpstreamRequests: number
}

export interface ProfitIntervalReport {
  query: ProfitIntervalQuery
  coverage: UsageLedgerCoverage
  totals: Omit<ProfitIntervalBucket, 'key' | 'label'>
  /** Internal-user requests are intentionally excluded from every business total. */
  internalUsage: {
    requests: number
    stationCharge: number
    upstreamCost: number
    unresolvedUpstreamRequests: number
  }
  /** Public-welfare groups stay out of operating totals, but retain a reference view. */
  publicWelfareUsage: {
    requests: number
    stationCharge: number
    upstreamCost: number
    unresolvedUpstreamRequests: number
  }
  publicWelfareGroups: PublicWelfareGroupSummary[]
  /** These legacy/provider rows remain in business totals because they cannot be safely matched to a user. */
  unidentifiedUserRequests: number
  buckets: ProfitIntervalBucket[]
  accounts: ProfitAccountSummary[]
}

export type UsageLedgerCoverageState = 'complete' | 'page-limit' | 'incomplete' | 'unavailable'

/**
 * Counts and freshness only. Raw administrator usage records never leave the
 * main process or enter the local preference file.
 */
export interface UsageLedgerCoverage {
  accountStationId: string
  fetchedAt: string
  state: UsageLedgerCoverageState
  pagesFetched: number
  recordsSeen: number
  acceptedEntries: number
  detail?: string
}

export interface TimeCostLedger {
  rateObservations: CostRateObservation[]
  sourceKeyGroupObservations: SourceKeyGroupObservation[]
  mappingEvents: AccountUpstreamMappingEvent[]
  usageEntries: UsageLedgerEntry[]
  usageCoverage: UsageLedgerCoverage[]
  profitUsageRecords: ProfitUsageRecord[]
  profitUsageCoverage: ProfitArchiveDayCoverage[]
}

export type AccountCostKind = 'upstream-metered' | 'self-owned-exempt' | 'gifted' | 'subscription' | 'manual'

/** A local-only marker for a user the station owner consumes as internal use. */
export interface InternalUserProfile {
  accountStationId: string
  userId: number
  updatedAt: string
}

export interface AccountCostProfile {
  accountStationId: string
  accountId: number
  kind: AccountCostKind
  fixedCostAmount?: number
  cycleDays?: number
  cycleStartedAt?: string
  variableCostMultiplier?: number
  note?: string
  updatedAt: string
}

export interface AdminConsoleSnapshot {
  dashboard?: Record<string, unknown>[]
  users?: Record<string, unknown>[]
  channels?: Record<string, unknown>[]
  platforms?: Record<string, unknown>[]
  usage?: Record<string, unknown>[]
  settings?: Record<string, unknown>[]
  notes?: string
}

export interface StationSnapshot {
  stationId: string
  stationName: string
  health: StationHealth
  errorCode?: StationErrorCode
  errorMessage?: string
  balance?: number
  currency: 'USD'
  groups: GroupSnapshot[]
  sourceKeys?: SourceKeySnapshot[]
  /**
   * Indicates whether the optional upstream Key list can currently support
   * relationship tracking. A stale list is retained only for recovery UI.
   */
  sourceKeyReadState?: 'not-configured' | 'available' | 'stale' | 'unavailable'
  accounts: AccountSnapshot[]
  lastUpdatedAt?: string
  lastSuccessAt?: string
  responseTimeMs?: number
  priceCapability: 'available' | 'disabled' | 'missing' | 'unknown'
  adminConsole?: AdminConsoleSnapshot
}

export interface AccountGroupMutation {
  stationId: string
  accountId: number
  accountName: string
  previousGroupIds: number[]
  nextGroupIds: number[]
}

export interface GroupChangeEvent {
  id: string
  kind: GroupChangeKind
  stationId: string
  stationName: string
  groupId: number
  groupName: string
  platform: string
  previousRate?: number
  nextRate?: number
  occurredAt: string
}

export interface UiPreferences {
  hiddenGroupKeys: string[]
  /** Local-only groups excluded from operating revenue, cost, and profit totals. */
  operatingExcludedGroupKeys: string[]
  manualGroupTags: Record<string, GroupCapabilityTagId[]>
  groupChangeEvents: GroupChangeEvent[]
  dismissedGroupChangeEventIds: string[]
  accountUpstreamMappings: AccountUpstreamMapping[]
  accountCostProfiles: AccountCostProfile[]
  internalUserProfiles: InternalUserProfile[]
  timeCostLedger: TimeCostLedger
}

export interface DataFileSummary {
  exists: boolean
  path: string
  updatedAt?: string
  sizeBytes?: number
}

export interface DataCenterSummary {
  userDataPath: string
  isCustomUserDataPath: boolean
  stations: {
    count: number
    withAccessToken: number
    withRefreshToken: number
    withAdminToken: number
  }
  preferences: {
    hiddenGroupKeys: number
    operatingExcludedGroupKeys: number
    manualGroupTags: number
    groupChangeEvents: number
    dismissedGroupChangeEventIds: number
    accountUpstreamMappings: number
    accountCostProfiles: number
    internalUserProfiles: number
  }
  files: {
    stations: DataFileSummary
    preferences: DataFileSummary
  }
}

export interface AppState {
  stations: StationPublic[]
  snapshots: Record<string, StationSnapshot>
  mode: WindowMode
  alwaysOnTop: boolean
}

export interface AizzzApi {
  runtime: {
    isBrowserPreview: boolean
  }
  auth: {
    login: (input: WebAuthInput) => Promise<StationPublic[]>
  }
  stations: {
    list: () => Promise<StationPublic[]>
    save: (input: StationInput) => Promise<StationPublic[]>
    remove: (id: string) => Promise<StationPublic[]>
    refresh: (id?: string) => Promise<StationSnapshot[]>
    getSnapshots: () => Promise<StationSnapshot[]>
    diagnose: (input: Pick<StationInput, 'id' | 'name' | 'baseUrl' | 'apiBaseUrl' | 'adapterType' | 'accessToken' | 'refreshToken' | 'adminToken' | 'adminCredentialType' | 'apiPaths'>) => Promise<StationDiagnostics>
    previewMapping: (input: Pick<StationInput, 'id' | 'apiPaths' | 'readMapping'>) => Promise<StationMappingPreview>
    onSnapshotsUpdated: (callback: (snapshots: StationSnapshot[]) => void) => () => void
    onStationsUpdated: (callback: (stations: StationPublic[]) => void) => () => void
  }
  window: {
    setMode: (mode: WindowMode) => Promise<{ mode: WindowMode }>
    toggleAlwaysOnTop: () => Promise<{ alwaysOnTop: boolean }>
    show: () => Promise<void>
    onModeChanged: (callback: (state: { mode: WindowMode; alwaysOnTop: boolean }) => void) => () => void
  }
  admin: {
    updateAccountGroups: (mutation: AccountGroupMutation) => Promise<StationSnapshot>
  }
  profit: {
    load: (query: ProfitIntervalQuery) => Promise<ProfitIntervalReport>
    archive: (query: ProfitIntervalQuery, options?: { force?: boolean }) => Promise<ProfitArchiveDayCoverage[]>
  }
  preferences: {
    get: () => Promise<UiPreferences>
    setHiddenGroupKeys: (keys: string[]) => Promise<UiPreferences>
    setOperatingExcludedGroupKeys: (keys: string[]) => Promise<UiPreferences>
    setManualGroupTags: (tags: Record<string, GroupCapabilityTagId[]>) => Promise<UiPreferences>
    setGroupChangeEvents: (events: GroupChangeEvent[]) => Promise<UiPreferences>
    setDismissedGroupChangeEventIds: (ids: string[]) => Promise<UiPreferences>
    setAccountUpstreamMappings: (mappings: AccountUpstreamMapping[]) => Promise<UiPreferences>
    setAccountCostProfiles: (profiles: AccountCostProfile[]) => Promise<UiPreferences>
    setInternalUserProfiles: (profiles: InternalUserProfile[]) => Promise<UiPreferences>
  }
  dataCenter: {
    getSummary: () => Promise<DataCenterSummary>
  }
}

export type WebAuthInput = Pick<StationInput, 'id' | 'name' | 'baseUrl' | 'apiBaseUrl' | 'stationRole' | 'adapterType' | 'detectedAdapterType' | 'rechargeRatio' | 'lowBalanceThreshold' | 'apiPaths' | 'adminCredentialType' | 'pollingIntervalMs'> & {
  /** Requires an existing locally encrypted login account/password pair. */
  useSavedLoginCredentials?: boolean
}
