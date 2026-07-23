import { createEmptySnapshot, normalizeStationBaseUrl } from '../../shared/sub2api'
import { emptyTimeCostLedger } from '../../shared/time-cost-ledger'
import type { AccountCostKind, AccountCostProfile, AccountUpstreamMapping, AizzzApi, DataCenterSummary, GroupCapabilityTagId, GroupChangeEvent, InternalUserProfile, ProfitIntervalQuery, ProfitIntervalReport, StationDiagnostics, StationInput, StationMappingPreview, StationPublic, StationReadCapability, StationSnapshot, UiPreferences } from '../../shared/types'

const previewPreferencesStorageKey = 'aizzzwatch:preview-ui-preferences:v1'

function createPreviewId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `preview-${Date.now()}-${Math.round(Math.random() * 10_000)}`
}

function clampPollingInterval(value: number | undefined): number {
  return Math.min(Math.max(value ?? 30_000, 15_000), 300_000)
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim())
}

function sanitizeRechargeRatio(value: number | undefined, fallback = 1): number {
  if (value === undefined) return fallback
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function sanitizeLowBalanceThreshold(value: number | undefined, fallback = 10): number {
  if (value === undefined) return fallback
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function createPreviewSnapshot(station: StationPublic): StationSnapshot {
  return {
    ...createEmptySnapshot(station.id, station.name),
    health: 'empty',
    errorMessage: '浏览器预览已保存站点配置，但不会连接真实站点。请通过桌面快捷入口完成网页登录授权和真实刷新。',
    lastUpdatedAt: new Date().toISOString(),
    adminConsole: {
      dashboard: [
        { title: '用户数', value: 12, hint: '活跃 8 / 暂停 4' },
        { title: 'API Key', value: 34, hint: '近 24h 2 次更新' },
        { title: '用量', value: '1.28M tokens', hint: '今日累计' }
      ],
      users: [
        { id: 1001, name: `${station.name} Admin`, email: 'admin@example.com', status: 'active', role: 'owner', api_key_count: 4, signup_source: 'manual' },
        { id: 1002, name: 'Billing Ops', email: 'ops@example.com', status: 'active', role: 'operator', api_key_count: 2, signup_source: 'invite' }
      ],
      usage: [
        { scope: 'today', tokens: 1280000, requests: 904, cost: 12.4 }
      ],
      settings: [
        { key: 'site_name', value: station.name },
        { key: 'recharge_ratio', value: `1:${station.rechargeRatio}` },
        { key: 'balance_threshold', value: station.lowBalanceThreshold }
      ]
    }
  }
}

function createPreviewDiagnostics(): StationDiagnostics {
  return {
    apiVariant: 'unknown',
    needsCookie: false,
    needsUserAgent: false,
    probes: [],
    suggestedPaths: {},
    notes: '浏览器预览不执行真实接口探测；请在桌面端完成自动诊断，或直接手动补录路径。'
  }
}

function createPreviewMappingPreview(input: Pick<StationInput, 'id' | 'apiPaths' | 'readMapping'>): StationMappingPreview {
  const capabilities: StationReadCapability[] = ['profile', 'groups', 'rates', 'channels', 'keys']
  return {
    stationId: input.id,
    generatedAt: new Date().toISOString(),
    capabilities: capabilities.map((capability) => ({
      capability,
      state: 'partial',
      path: input.apiPaths?.[capability] ?? '--',
      records: 0,
      fields: Object.keys(input.readMapping?.capabilities[capability]?.fields ?? {}),
      detail: '浏览器预览不连接真实站点；请在桌面端检测并预览解析结果。'
    }))
  }
}

function emptyPreviewPreferences(): UiPreferences {
  return { hiddenGroupKeys: [], operatingExcludedGroupKeys: [], manualGroupTags: {}, groupChangeEvents: [], dismissedGroupChangeEventIds: [], accountUpstreamMappings: [], accountCostProfiles: [], internalUserProfiles: [], timeCostLedger: emptyTimeCostLedger() }
}

function normalizePreviewPreferences(value: unknown): UiPreferences {
  if (!value || typeof value !== 'object') return emptyPreviewPreferences()
  const preferences = value as Partial<UiPreferences>
  const isAccountCostKind = (kind: unknown): kind is AccountCostKind => kind === 'upstream-metered' || kind === 'self-owned-exempt' || kind === 'gifted' || kind === 'subscription' || kind === 'manual'
  const sanitizeOptionalNumber = (input: unknown, max = 1_000_000): number | undefined => {
    if (typeof input !== 'number' || !Number.isFinite(input) || input < 0) return undefined
    return Math.min(input, max)
  }
  const manualGroupTags = preferences.manualGroupTags && typeof preferences.manualGroupTags === 'object' && !Array.isArray(preferences.manualGroupTags)
    ? Object.fromEntries(Object.entries(preferences.manualGroupTags).map(([key, tags]) => [
        key,
        Array.isArray(tags) ? [...new Set(tags.filter((tag): tag is GroupCapabilityTagId => tag === 'image' || tag === 'coding' || tag === 'vision' || tag === 'embedding' || tag === 'audio' || tag === 'video' || tag === 'chat'))] : []
      ]).filter(([, tags]) => tags.length > 0))
    : {}
  return {
    hiddenGroupKeys: Array.isArray(preferences.hiddenGroupKeys) ? preferences.hiddenGroupKeys.filter((item): item is string => typeof item === 'string') : [],
    operatingExcludedGroupKeys: Array.isArray(preferences.operatingExcludedGroupKeys) ? preferences.operatingExcludedGroupKeys.filter((item): item is string => typeof item === 'string') : [],
    manualGroupTags,
    groupChangeEvents: Array.isArray(preferences.groupChangeEvents) ? preferences.groupChangeEvents.filter((item): item is GroupChangeEvent => Boolean(item && typeof item === 'object')).slice(0, 50_000) : [],
    dismissedGroupChangeEventIds: Array.isArray(preferences.dismissedGroupChangeEventIds) ? [...new Set(preferences.dismissedGroupChangeEventIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))] : [],
    accountUpstreamMappings: Array.isArray(preferences.accountUpstreamMappings)
      ? preferences.accountUpstreamMappings.flatMap((item): AccountUpstreamMapping[] => {
          if (!item || typeof item !== 'object') return []
          const mapping = item as Partial<AccountUpstreamMapping>
          const accountId = mapping.accountId
          const sourceGroupId = mapping.sourceGroupId
          if (typeof mapping.accountStationId !== 'string' || !mapping.accountStationId.trim()
            || typeof mapping.sourceStationId !== 'string' || !mapping.sourceStationId.trim()
            || typeof accountId !== 'number' || !Number.isInteger(accountId)
            || typeof sourceGroupId !== 'number' || !Number.isInteger(sourceGroupId)) return []
          return [{
            accountStationId: mapping.accountStationId.trim(),
            accountId,
            sourceStationId: mapping.sourceStationId.trim(),
            sourceGroupId,
            sourceKeyId: typeof mapping.sourceKeyId === 'string' ? mapping.sourceKeyId.trim().slice(0, 160) || undefined : undefined,
            sourceKeyLabel: typeof mapping.sourceKeyLabel === 'string' ? mapping.sourceKeyLabel.trim().slice(0, 80) || undefined : undefined,
            updatedAt: typeof mapping.updatedAt === 'string' && mapping.updatedAt.trim() ? mapping.updatedAt : new Date(0).toISOString()
          }]
        }).slice(0, 2_000)
      : [],
    accountCostProfiles: Array.isArray(preferences.accountCostProfiles)
      ? preferences.accountCostProfiles.flatMap((item): AccountCostProfile[] => {
          if (!item || typeof item !== 'object') return []
          const profile = item as Partial<AccountCostProfile>
          if (typeof profile.accountStationId !== 'string' || !profile.accountStationId.trim()) return []
          const accountId = profile.accountId
          if (typeof accountId !== 'number' || !Number.isInteger(accountId) || accountId <= 0) return []
          if (!isAccountCostKind(profile.kind)) return []
          return [{
            accountStationId: profile.accountStationId.trim(),
            accountId,
            kind: profile.kind,
            fixedCostAmount: sanitizeOptionalNumber(profile.fixedCostAmount),
            cycleDays: sanitizeOptionalNumber(profile.cycleDays, 366),
            cycleStartedAt: typeof profile.cycleStartedAt === 'string' && profile.cycleStartedAt.trim() ? profile.cycleStartedAt.trim() : undefined,
            variableCostMultiplier: sanitizeOptionalNumber(profile.variableCostMultiplier),
            note: typeof profile.note === 'string' ? profile.note.trim().slice(0, 120) || undefined : undefined,
            updatedAt: typeof profile.updatedAt === 'string' && profile.updatedAt.trim() ? profile.updatedAt : new Date(0).toISOString()
          }]
        }).slice(0, 2_000)
      : [],
    internalUserProfiles: Array.isArray(preferences.internalUserProfiles)
      ? preferences.internalUserProfiles.flatMap((item): InternalUserProfile[] => {
          if (!item || typeof item !== 'object') return []
          const profile = item as Partial<InternalUserProfile>
          if (typeof profile.accountStationId !== 'string' || !profile.accountStationId.trim()
            || typeof profile.userId !== 'number' || !Number.isInteger(profile.userId) || profile.userId <= 0) return []
          return [{
            accountStationId: profile.accountStationId.trim(),
            userId: profile.userId,
            updatedAt: typeof profile.updatedAt === 'string' && profile.updatedAt.trim() ? profile.updatedAt : new Date(0).toISOString()
          }]
        }).slice(0, 10_000)
      : [],
    timeCostLedger: emptyTimeCostLedger()
  }
}

function readPreviewPreferences(): UiPreferences {
  try {
    const value = window.localStorage.getItem(previewPreferencesStorageKey)
    return normalizePreviewPreferences(value ? JSON.parse(value) : {})
  } catch {
    return emptyPreviewPreferences()
  }
}

function writePreviewPreferences(preferences: UiPreferences): UiPreferences {
  const next = normalizePreviewPreferences(preferences)
  window.localStorage.setItem(previewPreferencesStorageKey, JSON.stringify(next))
  return next
}

function createPreviewDataCenterSummary(stations: StationPublic[]): DataCenterSummary {
  const preferences = readPreviewPreferences()
  const preferencesRaw = window.localStorage.getItem(previewPreferencesStorageKey) ?? ''
  const updatedAt = new Date().toISOString()
  return {
    userDataPath: '浏览器预览 localStorage（不访问桌面端真实数据）',
    isCustomUserDataPath: false,
    stations: {
      count: stations.length,
      withAccessToken: stations.filter((station) => station.hasAccessToken).length,
      withRefreshToken: stations.filter((station) => station.hasRefreshToken).length,
      withAdminToken: stations.filter((station) => station.hasAdminToken).length
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
      stations: { exists: true, path: 'preview memory', updatedAt, sizeBytes: JSON.stringify(stations).length },
      preferences: { exists: Boolean(preferencesRaw), path: previewPreferencesStorageKey, updatedAt, sizeBytes: preferencesRaw.length }
    }
  }
}

function unavailablePreviewProfitReport(query: ProfitIntervalQuery): ProfitIntervalReport {
  return {
    query,
    coverage: {
      accountStationId: query.stationId,
      fetchedAt: new Date().toISOString(),
      state: 'unavailable',
      pagesFetched: 0,
      recordsSeen: 0,
      acceptedEntries: 0,
      detail: '浏览器预览不读取管理员用量明细，请在桌面端核算收益。'
    },
    totals: { requests: 0, revenue: 0, exemptRequests: 0, exemptRevenue: 0, accountCost: 0, upstreamCost: 0, attributableRevenue: 0, unattributedRevenue: 0, lossRequests: 0 },
    internalUsage: { requests: 0, stationCharge: 0, upstreamCost: 0, unresolvedUpstreamRequests: 0 },
    publicWelfareUsage: { requests: 0, stationCharge: 0, upstreamCost: 0, unresolvedUpstreamRequests: 0 },
    publicWelfareGroups: [],
    unidentifiedUserRequests: 0,
    buckets: [],
    accounts: []
  }
}

export function createPreviewApi(): AizzzApi {
  let stations: StationPublic[] = []
  const snapshots = new Map<string, StationSnapshot>()
  const snapshotListeners = new Set<(next: StationSnapshot[]) => void>()
  const stationListeners = new Set<(next: StationPublic[]) => void>()

  const emitSnapshots = (): void => {
    const next = [...snapshots.values()]
    for (const listener of snapshotListeners) listener(next)
  }

  const emitStations = (): void => {
    for (const listener of stationListeners) listener(stations)
  }

  return {
    runtime: {
      isBrowserPreview: true
    },
    auth: {
      login: async () => {
        throw new Error('浏览器预览不执行网页登录授权，请打开桌面端完成真实登录')
      }
    },
    stations: {
      list: async () => stations,
      diagnose: async () => createPreviewDiagnostics(),
      previewMapping: async (input) => createPreviewMappingPreview(input),
      save: async (input: StationInput) => {
        const name = input.name.trim()
        if (!name) throw new Error('站点名称不能为空')
        const baseUrl = normalizeStationBaseUrl(input.baseUrl, input.adapterType === 'auto' ? input.detectedAdapterType : input.adapterType)
        const existing = input.id ? stations.find((station) => station.id === input.id) : undefined
        const hasReadMappingInput = Object.prototype.hasOwnProperty.call(input, 'readMapping')
        const hasAdminToken = hasValue(input.adminToken) || Boolean(existing?.hasAdminToken)
        const station: StationPublic = {
          id: existing?.id ?? input.id ?? createPreviewId(),
          name,
          baseUrl,
          apiBaseUrl: input.apiBaseUrl?.trim() || existing?.apiBaseUrl,
          stationRole: input.stationRole ?? existing?.stationRole ?? 'source',
          adapterType: input.adapterType ?? existing?.adapterType ?? 'sub2api',
          detectedAdapterType: input.detectedAdapterType ?? existing?.detectedAdapterType,
          rechargeRatio: sanitizeRechargeRatio(input.rechargeRatio, existing?.rechargeRatio ?? 1),
          lowBalanceThreshold: sanitizeLowBalanceThreshold(input.lowBalanceThreshold, existing?.lowBalanceThreshold ?? 10),
          apiPaths: input.apiPaths ?? existing?.apiPaths ?? {},
          readMapping: hasReadMappingInput ? input.readMapping : existing?.readMapping,
          hasAccessToken: hasValue(input.accessToken) || Boolean(existing?.hasAccessToken),
          hasRefreshToken: hasValue(input.refreshToken) || Boolean(existing?.hasRefreshToken),
          hasAdminToken,
          hasSavedLoginCredentials: false,
          autoReauthEnabled: false,
          adminCredentialType: hasAdminToken ? input.adminCredentialType ?? existing?.adminCredentialType ?? 'jwt' : undefined,
          pollingIntervalMs: clampPollingInterval(input.pollingIntervalMs)
        }
        stations = existing
          ? stations.map((item) => (item.id === station.id ? station : item))
          : [...stations, station]
        snapshots.set(station.id, createPreviewSnapshot(station))
        emitStations()
        emitSnapshots()
        return stations
      },
      remove: async (id: string) => {
        stations = stations.filter((station) => station.id !== id)
        snapshots.delete(id)
        emitStations()
        emitSnapshots()
        return stations
      },
      refresh: async (id?: string) => {
        const targets = id ? stations.filter((station) => station.id === id) : stations
        for (const station of targets) snapshots.set(station.id, createPreviewSnapshot(station))
        emitSnapshots()
        return [...snapshots.values()]
      },
      getSnapshots: async () => [...snapshots.values()],
      onSnapshotsUpdated: (callback) => {
        snapshotListeners.add(callback)
        return () => snapshotListeners.delete(callback)
      },
      onStationsUpdated: (callback) => {
        stationListeners.add(callback)
        return () => stationListeners.delete(callback)
      }
    },
    window: {
      setMode: async (mode) => ({ mode }),
      toggleAlwaysOnTop: async () => ({ alwaysOnTop: false }),
      show: async () => undefined,
      onModeChanged: () => () => undefined
    },
    admin: {
      updateAccountGroups: async () => {
        throw new Error('浏览器预览不执行远程写入')
      }
    },
    profit: {
      load: async (query) => unavailablePreviewProfitReport(query),
      archive: async () => {
        throw new Error('浏览器预览不执行管理员用量归档')
      }
    },
    preferences: {
      get: async () => readPreviewPreferences(),
      setHiddenGroupKeys: async (keys) => writePreviewPreferences({ ...readPreviewPreferences(), hiddenGroupKeys: keys }),
      setOperatingExcludedGroupKeys: async (keys) => writePreviewPreferences({ ...readPreviewPreferences(), operatingExcludedGroupKeys: keys }),
      setManualGroupTags: async (tags) => writePreviewPreferences({ ...readPreviewPreferences(), manualGroupTags: tags }),
      setGroupChangeEvents: async (events) => writePreviewPreferences({ ...readPreviewPreferences(), groupChangeEvents: events }),
      setDismissedGroupChangeEventIds: async (ids) => writePreviewPreferences({ ...readPreviewPreferences(), dismissedGroupChangeEventIds: ids }),
      setAccountUpstreamMappings: async (mappings) => writePreviewPreferences({ ...readPreviewPreferences(), accountUpstreamMappings: mappings }),
      setAccountCostProfiles: async (profiles) => writePreviewPreferences({ ...readPreviewPreferences(), accountCostProfiles: profiles }),
      setInternalUserProfiles: async (profiles) => writePreviewPreferences({ ...readPreviewPreferences(), internalUserProfiles: profiles })
    },
    dataCenter: {
      getSummary: async () => createPreviewDataCenterSummary(stations)
    }
  }
}
