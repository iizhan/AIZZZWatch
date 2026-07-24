import type { GroupSnapshot, PricingModelSnapshot, ResolvedStationAdapterType, SourceKeySnapshot, StationAdapterType, StationErrorCode, StationSnapshot } from './types'
import type { StationApiPaths } from './types'

export const defaultStationApiPaths: Required<StationApiPaths> = {
  profile: '/user/profile',
  balance: '',
  groups: '/groups/available',
  rates: '/groups/rates',
  channels: '/channels/available',
  keys: '',
  authRefresh: '/auth/refresh',
  adminGroups: '/admin/groups/all',
  adminAccounts: '/admin/accounts?page=1&page_size=100',
  adminDashboard: '/admin/dashboard/snapshot-v2',
  adminUsers: '/admin/users?page=1&page_size=100',
  adminChannels: '/admin/channels?page=1&page_size=100',
  adminPlatforms: '/admin/platforms?page=1&page_size=100',
  adminUsage: '/admin/usage/stats',
  adminUsageLogs: '/admin/usage?page=1&page_size=100&sort_by=created_at&sort_order=desc',
  adminSettings: '/admin/settings'
}

/** Standard Sub2API user Key list. NewAPI and custom adapters keep their own contracts. */
export const defaultSub2ApiKeyListPath = '/keys?page=1&page_size=20&sort_by=created_at&sort_order=desc&timezone=Asia%2FShanghai'

/** Confirmed NewAPI user-facing read endpoints. `channels` remains the shared price-list path. */
export const defaultNewApiPaths: Required<Pick<StationApiPaths, 'profile' | 'groups' | 'channels' | 'keys' | 'authRefresh'>> = {
  profile: '/api/user/self',
  groups: '/api/user/self/groups',
  channels: '/api/pricing',
  keys: '/api/token/?p=0&size=100',
  authRefresh: '/api/user/auth/refresh'
}

const lcodexHost = 'lcodex.cc'
const lcodexLegacyPublicApiHost = 'api.lcodex.cc'
const lcodexChannelPricingPath = '/api/v1/channels/available'

export interface LcodexStationCompatibility {
  managementApiBaseUrl: string
  apiPaths: StationApiPaths
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value.trim())
    return ['http:', 'https:'].includes(url.protocol) ? url : undefined
  } catch {
    return undefined
  }
}

export function resolveLcodexStationCompatibility(value: string): LcodexStationCompatibility | undefined {
  const url = parseHttpUrl(value)
  if (url?.hostname.toLowerCase() !== lcodexHost) return undefined
  return {
    managementApiBaseUrl: url.origin,
    apiPaths: { channels: lcodexChannelPricingPath }
  }
}

export function isLcodexLegacyPublicApiUrl(value: string | undefined): boolean {
  const url = value ? parseHttpUrl(value) : undefined
  return url?.hostname.toLowerCase() === lcodexLegacyPublicApiHost
}

/**
 * lcodex's current management endpoints remain at the site root while its
 * price view uses a versioned endpoint. Only replace an untouched default
 * path set so an operator's custom fork paths always remain authoritative.
 */
export function applyLcodexApiPathDefaults(baseUrl: string, paths: StationApiPaths): StationApiPaths {
  const compatibility = resolveLcodexStationCompatibility(baseUrl)
  if (!compatibility) return paths
  const hasCustomPath = Object.entries(paths).some(([key, value]) => {
    const defaultPath = defaultStationApiPaths[key as keyof typeof defaultStationApiPaths]
    return typeof value === 'string' && value.trim() && value.trim() !== defaultPath
  })
  return hasCustomPath ? paths : { ...paths, ...compatibility.apiPaths }
}

export interface Sub2ApiEnvelope<T> {
  code?: number
  message?: string
  data?: T
}

export interface ProfileResponse {
  balance?: number | string
  credit_balance?: number | string
  credits?: number | string
  credit?: number | string
  amount?: number | string
  total?: number | string
  remaining?: number | string
  username?: string
  email?: string
}

type BooleanLike = boolean | number | string

export interface AvailableGroupResponse {
  id: number
  name?: string
  title?: string
  channel_name?: string
  display_name?: string
  platform?: string
  provider?: string
  type?: string
  model_type?: string
  rate_multiplier?: number
  rate?: number
  multiplier?: number
  ratio?: number
  price_ratio?: number
  subscription_type?: string
  subscriptionType?: string
  subscription?: string
  type_label?: string
  is_exclusive?: BooleanLike
  isExclusive?: BooleanLike
  exclusive?: BooleanLike
  is_private?: BooleanLike
  private?: BooleanLike
  dedicated?: BooleanLike
  special?: BooleanLike
  peak_rate_enabled?: BooleanLike
  peakRateEnabled?: BooleanLike
  peak_rate_multiplier?: number
  peakRateMultiplier?: number
}

interface NormalizedGroupSource {
  id: number
  name: string
  platform?: string
  rate_multiplier?: number
  subscription_type?: string
  is_exclusive?: boolean
  peak_rate_enabled?: boolean
  peak_rate_multiplier?: number
}

export interface AvailableChannelResponse {
  name?: string
  platforms?: Array<{
    platform?: string
    groups?: Array<{ id?: number; name?: string; rate_multiplier?: number }>
    supported_models?: Array<{
      name?: string
      pricing?: {
        input_price?: number | null
        output_price?: number | null
        per_request_price?: number | null
      } | null
    }>
  }>
}

export interface AdminAccountResponse {
  id: number
  name?: string
  platform?: string
  status?: string
  schedulable?: boolean | number | string
  is_schedulable?: boolean | number | string
  schedulable_enabled?: boolean | number | string
  schedule_enabled?: boolean | number | string
  scheduling_enabled?: boolean | number | string
  enable_schedule?: boolean | number | string
  schedule?: boolean | number | string
  is_scheduled?: boolean | number | string
  is_schedule_enabled?: boolean | number | string
  enabled?: boolean | number | string
  is_enabled?: boolean | number | string
  disabled?: boolean | number | string
  is_disabled?: boolean | number | string
  group_ids?: number[]
  groups?: Array<{ id?: number; name?: string }>
  rate_multiplier?: number
  base_rate_multiplier?: number
  multiplier?: number
  ratio?: number
  price_ratio?: number
  usage?: number
  used?: number
  used_quota?: number
  cost?: number
  total_cost?: number
}

export interface AdminGroupResponse {
  id: number
  name?: string
}

export class Sub2ApiError extends Error {
  constructor(
    message: string,
    public readonly code: StationErrorCode,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'Sub2ApiError'
  }
}

export function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Sub2ApiError('站点地址不能为空', 'INVALID_RESPONSE')

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Sub2ApiError('站点地址不是有效 URL', 'INVALID_RESPONSE')
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Sub2ApiError('站点地址必须使用 HTTP 或 HTTPS', 'INVALID_RESPONSE')
  }

  if (/\/api\/v1$/i.test(url.pathname)) return trimmed
  return `${trimmed}/api/v1`
}

/** NewAPI endpoints live at `/api/*`, unlike Sub2API's `/api/v1/*` root. */
export function normalizeStationBaseUrl(value: string, adapterType?: StationAdapterType): string {
  if (adapterType !== 'newapi') return normalizeApiBaseUrl(value)
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Sub2ApiError('站点地址不能为空', 'INVALID_RESPONSE')
  try {
    const url = new URL(trimmed)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
    return trimmed
  } catch {
    throw new Sub2ApiError('站点地址不是有效 URL', 'INVALID_RESPONSE')
  }
}

export function normalizeStationApiPaths(paths?: StationApiPaths): StationApiPaths {
  const next: StationApiPaths = {}
  for (const [key, value] of Object.entries(paths ?? {})) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    next[key as keyof StationApiPaths] = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  }
  return next
}

export function usesNewApiContract(adapterType: StationAdapterType, detectedAdapterType: ResolvedStationAdapterType | undefined): boolean {
  return adapterType === 'newapi' || (adapterType === 'auto' && detectedAdapterType === 'newapi')
}

/**
 * Old NewAPI records inherited Sub2API defaults and used `/api/models` only as
 * a capability probe. Replace only those known defaults so manual paths remain
 * authoritative.
 */
export function applyNewApiPathDefaults(paths: StationApiPaths, adapterType: StationAdapterType, detectedAdapterType: ResolvedStationAdapterType | undefined): StationApiPaths {
  if (!usesNewApiContract(adapterType, detectedAdapterType)) return paths
  const next = { ...paths }
  const fallbackKeys = new Set<keyof typeof defaultNewApiPaths>(['profile', 'groups', 'channels', 'keys', 'authRefresh'])
  for (const key of fallbackKeys) {
    const value = next[key]?.trim()
    const sub2Default = defaultStationApiPaths[key]
    const legacyNewApiDefault = key === 'channels' ? '/api/models' : undefined
    if (!value || value === sub2Default || value === legacyNewApiDefault) next[key] = defaultNewApiPaths[key]
  }
  return next
}

export function normalizeRecordCollection(payload: unknown): Record<string, unknown>[] {
  if (payload === null || payload === undefined) return []
  const candidate = unwrapApiResponse<unknown>(payload)
  if (Array.isArray(candidate)) {
    return candidate.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
  }
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const record = candidate as Record<string, unknown>
    for (const key of ['items', 'users', 'records', 'data'] as const) {
      const value = record[key]
      if (Array.isArray(value)) {
        return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
      }
    }
    return [record]
  }
  return []
}

export function resolveStationApiPath(fallback: string, path?: string): string {
  const trimmed = path?.trim()
  if (!trimmed) return fallback
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/**
 * Keep a small, explicit compatibility table for known forks whose user
 * summary endpoint differs from the standard Sub2API profile route. A manual
 * non-default profile path always takes precedence over this table.
 */
export function resolveStationProfilePath(apiBaseUrl: string, configuredPath?: string): string {
  const profilePath = resolveStationApiPath(defaultStationApiPaths.profile, configuredPath)
  if (profilePath !== defaultStationApiPaths.profile) return profilePath
  try {
    if (new URL(apiBaseUrl).hostname.toLowerCase() === 'aihub.top') {
      return '/auth/me?timezone=Asia%2FShanghai'
    }
  } catch {
    // API base validation happens before a station client or diagnostic runs.
  }
  return profilePath
}

/**
 * Full custom endpoints are useful for forked stations, but must never turn a
 * station setting into an arbitrary outbound request.
 */
export function resolveStationApiRequestUrl(apiBaseUrl: string, path: string): string {
  const base = apiBaseUrl.trim().replace(/\/+$/, '')
  if (!base) throw new Sub2ApiError('API 基址不能为空', 'INVALID_RESPONSE')
  if (!/^https?:\/\//i.test(path.trim())) return `${base}${path}`

  let baseUrl: URL
  let targetUrl: URL
  try {
    baseUrl = new URL(base)
    targetUrl = new URL(path.trim())
  } catch {
    throw new Sub2ApiError('自定义接口地址不是有效 URL', 'INVALID_RESPONSE')
  }
  if (targetUrl.protocol !== 'https:') {
    throw new Sub2ApiError('自定义接口地址必须使用 HTTPS', 'INVALID_RESPONSE')
  }
  if (targetUrl.username || targetUrl.password || targetUrl.origin !== baseUrl.origin) {
    throw new Sub2ApiError('自定义接口地址必须与站点同源', 'INVALID_RESPONSE')
  }
  return targetUrl.toString()
}

export function unwrapApiResponse<T>(payload: unknown): T {
  if (!payload || typeof payload !== 'object') {
    throw new Sub2ApiError('接口返回不是 JSON 对象', 'INVALID_RESPONSE')
  }

  const record = payload as Record<string, unknown>
  if ('code' in record && typeof record.code === 'number' && record.code !== 0) {
    const message = typeof record.message === 'string' ? record.message : 'Sub2API 请求失败'
    throw new Sub2ApiError(message, 'API_ERROR')
  }

  if ('data' in record) return record.data as T
  return payload as T
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function safeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function secretLike(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/bearer\s+/i.test(trimmed) || /^sk-[a-z0-9_-]{16,}/i.test(trimmed) || /^eyJ[a-z0-9_-]+\./i.test(trimmed)) return true
  return trimmed.length > 48 && !/\s/.test(trimmed)
}

function normalizeBooleanLike(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 1) return true
    if (value === 0) return false
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'on', 'enabled', 'enable', 'active', 'open', '专属', '私有', '独享'].includes(normalized)) return true
    if (['false', '0', 'no', 'off', 'disabled', 'disable', 'inactive', 'closed'].includes(normalized)) return false
  }
  return undefined
}

function pickFirstBooleanLike(record: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = normalizeBooleanLike(record[key])
    if (typeof value === 'boolean') return value
  }
  return undefined
}

function pickFirstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function pickFirstSafeString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = safeString(record[key])
    if (value && !secretLike(value)) return value
  }
  return undefined
}

function pickFirstTimestamp(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      const date = new Date(value.trim())
      return Number.isNaN(date.getTime()) ? value.trim() : date.toISOString()
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const ms = value > 10_000_000_000 ? value : value * 1000
      const date = new Date(ms)
      if (!Number.isNaN(date.getTime())) return date.toISOString()
    }
  }
  return undefined
}

function collectGroupIds(value: unknown): number[] {
  const ids = new Set<number>()
  const add = (item: unknown) => {
    if (typeof item === 'number' && Number.isFinite(item)) ids.add(item)
    else if (typeof item === 'string' && item.trim() && Number.isFinite(Number(item))) ids.add(Number(item))
    else if (item && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, unknown>
      add(record.id ?? record.group_id ?? record.groupId)
    }
  }
  if (Array.isArray(value)) value.forEach(add)
  else add(value)
  return [...ids]
}

function collectGroupNames(value: unknown): string[] {
  const names = new Set<string>()
  const add = (item: unknown) => {
    if (typeof item === 'string' && item.trim() && !secretLike(item)) names.add(item.trim())
    else if (item && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, unknown>
      const name = pickFirstSafeString(record, ['name', 'title', 'group_name', 'groupName', 'display_name', 'displayName'])
      if (name) names.add(name)
    }
  }
  if (Array.isArray(value)) value.forEach(add)
  else add(value)
  return [...names]
}

function pickBalanceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function pickBalanceFromRecord(record: Record<string, unknown>): number | undefined {
  for (const key of ['balance', 'credit_balance', 'credits', 'credit', 'amount', 'total', 'remaining', 'available', 'available_credits', 'remaining_credits', 'current_balance', 'usable_credits']) {
    const value = pickBalanceNumber(record[key])
    if (value !== undefined) return value
  }
  return undefined
}

export function pickProfileBalance(profile: ProfileResponse): number | undefined {
  const record = profile as Record<string, unknown>
  const direct = pickBalanceFromRecord(record)
  if (direct !== undefined) return direct
  for (const key of ['data', 'wallet', 'balance_info', 'credit_info', 'credits', 'balance']) {
    const nested = record[key]
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue
    const value = pickBalanceFromRecord(nested as Record<string, unknown>)
    if (value !== undefined) return value
  }
  return undefined
}

function normalizeGroupSource(group: AvailableGroupResponse, index: number): NormalizedGroupSource {
  const record = group as unknown as Record<string, unknown>
  const id = safeNumber(group.id, index + 1)
  const name = [group.name, group.title, group.channel_name, group.display_name]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
  const platform = [group.platform, group.provider, group.type, group.model_type]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
  const rateMultiplier = [group.rate_multiplier, group.rate, group.multiplier, group.ratio, group.price_ratio]
    .find((value): value is number => typeof value === 'number' && Number.isFinite(value))

  return {
    id,
    name: name?.trim() || `分组 ${id}`,
    platform: platform?.trim(),
    rate_multiplier: rateMultiplier,
    subscription_type: pickFirstString(record, ['subscription_type', 'subscriptionType', 'subscription', 'type_label']),
    is_exclusive: pickFirstBooleanLike(record, ['is_exclusive', 'isExclusive', 'exclusive', 'is_private', 'private', 'dedicated', 'special']),
    peak_rate_enabled: pickFirstBooleanLike(record, ['peak_rate_enabled', 'peakRateEnabled']),
    peak_rate_multiplier: typeof record.peak_rate_multiplier === 'number'
      ? record.peak_rate_multiplier
      : typeof record.peakRateMultiplier === 'number'
        ? record.peakRateMultiplier
        : undefined
  }
}

export function normalizeGroups(
  groups: AvailableGroupResponse[],
  rates: Record<string, number> | Record<number, number> = {},
  pricingByGroupId: Map<number, PricingModelSnapshot[]> = new Map()
): GroupSnapshot[] {
  return (Array.isArray(groups) ? groups : []).map((group, index) => {
    const normalized = normalizeGroupSource(group, index)
    const groupId = normalized.id
    const rate = (rates as Record<string, number>)[String(groupId)]
    const pricingModels = pricingByGroupId.get(groupId) ?? []
    return {
      id: groupId,
      name: normalized.name,
      platform: normalized.platform ?? 'unknown',
      rateMultiplier: safeNumber(normalized.rate_multiplier, 1),
      userRateMultiplier: typeof rate === 'number' ? rate : undefined,
      subscriptionType: normalized.subscription_type,
      isExclusive: normalized.is_exclusive,
      peakRateEnabled: normalized.peak_rate_enabled,
      peakRateMultiplier: normalized.peak_rate_multiplier,
      pricingAvailable: pricingModels.length > 0,
      pricingHint: formatPricingHint(pricingModels),
      pricingModels
    }
  })
}

export function normalizeSourceKeys(payload: unknown): SourceKeySnapshot[] {
  return normalizeRecordCollection(payload)
    .map((record, index): SourceKeySnapshot => {
      const idSource = record.id ?? record.key_id ?? record.keyId ?? record.api_key_id ?? record.apiKeyId ?? index + 1
      const id = typeof idSource === 'number' || typeof idSource === 'string' ? String(idSource) : String(index + 1)
      const label = pickFirstSafeString(record, ['name', 'title', 'label', 'remark', 'description', 'note'])
        ?? `密钥 ${index + 1}`
      const status = pickFirstSafeString(record, ['status', 'state', 'enabled', 'disabled'])
      const createdAt = pickFirstTimestamp(record, ['created_at', 'createdAt', 'created_time', 'createdTime'])
      const groupIds = [
        ...collectGroupIds(record.group_id),
        ...collectGroupIds(record.groupId),
        ...collectGroupIds(record.group_ids),
        ...collectGroupIds(record.groupIds),
        ...collectGroupIds(record.groups),
        ...collectGroupIds(record.group)
      ]
      const groupNames = [
        ...collectGroupNames(record.group_name),
        ...collectGroupNames(record.groupName),
        ...collectGroupNames(record.groups),
        ...collectGroupNames(record.group)
      ]
      const summary = [
        status ? `状态 ${status}` : undefined,
        groupNames.length > 0 ? `分组 ${groupNames.join('、')}` : groupIds.length > 0 ? `分组 ID ${groupIds.join('、')}` : undefined,
        createdAt ? `创建 ${createdAt}` : undefined
      ].filter((item): item is string => Boolean(item)).join(' · ') || undefined
      return {
        id,
        label: label.slice(0, 80),
        status,
        createdAt,
        groupIds: [...new Set(groupIds)],
        groupNames: [...new Set(groupNames)].slice(0, 8),
        summary
      }
    })
    .slice(0, 200)
}

function formatPricingHint(models: PricingModelSnapshot[]): string | undefined {
  const model = models[0]
  if (!model) return undefined
  const inputText = typeof model.inputPrice === 'number' ? model.inputPrice.toFixed(4) : '-'
  const outputText = typeof model.outputPrice === 'number' ? model.outputPrice.toFixed(4) : '-'
  if (typeof model.inputPrice === 'number' || typeof model.outputPrice === 'number') return `${model.name} 入 ${inputText} / 出 ${outputText}`
  if (typeof model.perRequestPrice === 'number') return `${model.name} 请求 ${model.perRequestPrice.toFixed(4)}`
  return model.name
}

export function buildPricingHints(channels: AvailableChannelResponse[]): Map<number, PricingModelSnapshot[]> {
  const hints = new Map<number, PricingModelSnapshot[]>()
  for (const channel of Array.isArray(channels) ? channels : []) {
    for (const section of channel.platforms ?? []) {
      const models = (section.supported_models ?? [])
        .map((model): PricingModelSnapshot | undefined => {
          if (!model.pricing) return undefined
          const name = typeof model.name === 'string' && model.name.trim() ? model.name : '模型'
          return {
            name,
            inputPrice: typeof model.pricing.input_price === 'number' ? model.pricing.input_price : undefined,
            outputPrice: typeof model.pricing.output_price === 'number' ? model.pricing.output_price : undefined,
            perRequestPrice: typeof model.pricing.per_request_price === 'number' ? model.pricing.per_request_price : undefined
          }
        })
        .filter((model): model is PricingModelSnapshot => Boolean(model))
      if (models.length === 0) continue
      for (const group of section.groups ?? []) {
        if (typeof group.id !== 'number') continue
        hints.set(group.id, [...(hints.get(group.id) ?? []), ...models])
      }
    }
  }
  return hints
}

export function classifySub2ApiError(error: unknown): { code: StationErrorCode; message: string } {
  if (error instanceof Sub2ApiError) return { code: error.code, message: error.message }
  if (error instanceof DOMException && error.name === 'AbortError') return { code: 'TIMEOUT', message: '请求超时' }
  if (error instanceof Error && /ERR_TOO_MANY_REDIRECTS|too many redirects/i.test(error.message)) {
    return { code: 'API_ERROR', message: '请求发生重定向循环，通常是 API 基址或接口路径打到了网页登录页或反代跳转页' }
  }
  if (error instanceof TypeError) return { code: 'NETWORK', message: '网络连接失败' }
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : '未知错误' }
}

export function createEmptySnapshot(stationId: string, stationName: string): StationSnapshot {
  return {
    stationId,
    stationName,
    health: 'loading',
    currency: 'USD',
    groups: [],
    accounts: [],
    priceCapability: 'unknown'
  }
}

export function sameNumberSet(left: number[], right: number[]): boolean {
  return [...new Set(left)].sort((a, b) => a - b).join(',') === [...new Set(right)].sort((a, b) => a - b).join(',')
}
