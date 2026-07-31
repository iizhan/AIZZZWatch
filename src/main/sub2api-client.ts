import type {
  AdminAccountResponse,
  AdminGroupResponse,
  AvailableChannelResponse,
  AvailableGroupResponse,
  ProfileResponse,
  Sub2ApiEnvelope
} from '../shared/sub2api'
import {
  buildPricingHints,
  classifySub2ApiError,
  defaultStationApiPaths,
  normalizeGroups,
  normalizeRecordCollection,
  normalizeSourceKeys,
  pickProfileBalance,
  resolveStationReadApiBases,
  resolveStationApiPath,
  resolveStationProfilePath,
  resolveStationApiRequestUrl,
  unwrapApiResponse,
  Sub2ApiError
} from '../shared/sub2api'
import { extractStrictProfitUsageRecords, extractStrictUsageEntries } from '../shared/time-cost-ledger'
import { mapRecordFields, mappedCapabilityFields, mappingFieldDefinitions, mappingRequiredFieldsPresent, readMappedPath } from '../shared/station-read-mapping'
import type { AccountGroupMutation, AccountSnapshot, AdminConsoleSnapshot, AdminCredentialType, PricingModelSnapshot, ProfitIntervalQuery, ProfitUsageRecord, StationApiPaths, StationMappingPreview, StationMappingPreviewCapability, StationReadCapability, StationReadMapping, StationSnapshot, UsageLedgerCoverage, UsageLedgerEntry } from '../shared/types'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

interface ClientStation {
  id: string
  name: string
  baseUrl: string
  apiBaseUrl?: string
  accessToken?: string
  refreshToken?: string
  sessionCookie?: string
  userAgent?: string
  adminToken?: string
  adminCredentialType?: AdminCredentialType
  apiPaths?: StationApiPaths
  readMapping?: StationReadMapping
  fetchImpl?: FetchLike
}

interface FetchOptions {
  admin?: boolean
  signal?: AbortSignal
}

interface ParsedApiResponse {
  payload: unknown
  contentType: string
  bodyKind: 'empty' | 'html' | 'json' | 'text'
}

export interface AdminUsageDetailResult {
  entries: UsageLedgerEntry[]
  coverage: UsageLedgerCoverage
}

export interface AdminProfitUsageResult {
  records: ProfitUsageRecord[]
  coverage: UsageLedgerCoverage
}

const adminUsageDetailPageSize = 100
const adminUsageDetailMaxPages = 5
const adminProfitUsageMaxPages = 20

function dateInTimezone(value: string | Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function isAuthorizationError(error: unknown): boolean {
  return error instanceof Sub2ApiError && (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN')
}

function knownDedicatedBalancePath(apiBaseUrl: string): string | undefined {
  try {
    return new URL(apiBaseUrl).hostname.toLowerCase() === 'shayulajiao.xyz'
      ? 'https://shayulajiao.xyz/api/v1/auth/me?timezone=Asia%2FShanghai'
      : undefined
  } catch {
    return undefined
  }
}

function isSharkStation(apiBaseUrl: string): boolean {
  try {
    return new URL(apiBaseUrl).hostname.toLowerCase() === 'shayulajiao.xyz'
  } catch {
    return false
  }
}

function pickFirstFiniteNumber(value: object, keys: string[]): number | undefined {
  const record = value as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    const numberValue = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : undefined
    if (typeof numberValue === 'number' && Number.isFinite(numberValue)) return numberValue
  }
  return undefined
}

function mappedRecords(payload: unknown, capability: Exclude<StationReadCapability, 'profile'>, mapping: StationReadMapping | undefined): Record<string, unknown>[] {
  const config = mapping?.capabilities[capability]
  const source = readMappedPath(payload, config?.recordsPath)
  const records = normalizeRecordCollection(source)
  return records.map((record) => mapRecordFields(capability, record, mapping))
}

function mappedProfile(payload: unknown, mapping: StationReadMapping | undefined): ProfileResponse {
  const config = mapping?.capabilities.profile
  const source = readMappedPath(payload, config?.objectPath)
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {}
  return mapRecordFields('profile', source as Record<string, unknown>, mapping) as ProfileResponse
}

function mappedRates(payload: unknown, mapping: StationReadMapping | undefined): Record<string, number> {
  const config = mapping?.capabilities.rates
  const source = readMappedPath(payload, config?.recordsPath)
  if (config?.recordMode === 'keyed-map' && source && typeof source === 'object' && !Array.isArray(source)) {
    return Object.fromEntries(Object.entries(source).flatMap(([key, value]) => {
      const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : undefined
      return typeof numberValue === 'number' && Number.isFinite(numberValue) ? [[key, numberValue]] : []
    }))
  }
  if (!config) return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, number> : {}
  return Object.fromEntries(mappedRecords(payload, 'rates', mapping).flatMap((record) => {
    const id = typeof record.groupId === 'number' || typeof record.groupId === 'string' ? String(record.groupId) : ''
    const rate = typeof record.rateMultiplier === 'number' ? record.rateMultiplier : typeof record.rateMultiplier === 'string' ? Number(record.rateMultiplier) : undefined
    return id && typeof rate === 'number' && Number.isFinite(rate) ? [[id, rate]] : []
  }))
}

function mappedPricingHints(payload: unknown, mapping: StationReadMapping | undefined): Map<number, PricingModelSnapshot[]> {
  const hints = new Map<number, PricingModelSnapshot[]>()
  for (const record of mappedRecords(payload, 'channels', mapping)) {
    const groupId = typeof record.groupId === 'number' ? record.groupId : typeof record.groupId === 'string' ? Number(record.groupId) : undefined
    const name = typeof record.modelName === 'string' ? record.modelName.trim() : ''
    if (!Number.isFinite(groupId) || !name) continue
    const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined
    const model = { name, inputPrice: number(record.inputPrice), outputPrice: number(record.outputPrice), perRequestPrice: number(record.perRequestPrice) }
    const list = hints.get(groupId as number) ?? []
    list.push(model)
    hints.set(groupId as number, list)
  }
  return hints
}

function pickDirectCredential(value: Record<string, unknown>): string | undefined {
  for (const key of ['api_key', 'apiKey', 'upstream_key', 'upstreamKey', 'provider_key', 'providerKey', 'access_key', 'accessKey']) {
    const candidate = value[key]
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length >= 8 && trimmed.length <= 4096) return trimmed
  }
  return undefined
}

function sourceKeyCredentials(payload: unknown): Map<string, string> {
  const records = normalizeRecordCollection(payload)
  const keys = normalizeSourceKeys(payload)
  const credentials = new Map<string, string>()
  for (const [index, record] of records.entries()) {
    const key = keys[index]
    const credential = key && pickDirectCredential(record)
    if (key && credential) credentials.set(key.id, credential)
  }
  return credentials
}

function pickFirstString(value: object, keys: string[]): string | undefined {
  const record = value as Record<string, unknown>
  for (const key of keys) {
    const item = record[key]
    if (typeof item === 'string' && item.trim()) return item.trim()
  }
  return undefined
}

function normalizeBooleanLike(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 1) return true
    if (value === 0) return false
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'on', 'enabled', 'enable', 'active', 'running', 'normal', 'open', '开启', '启用', '正常'].includes(normalized)) return true
    if (['false', '0', 'no', 'off', 'disabled', 'disable', 'inactive', 'paused', 'pause', 'closed', 'stopped', 'error', '关闭', '停用', '暂停', '禁用'].includes(normalized)) return false
  }
  return undefined
}

function pickFirstBooleanLike(value: object, keys: string[]): boolean | undefined {
  const record = value as Record<string, unknown>
  for (const key of keys) {
    const booleanValue = normalizeBooleanLike(record[key])
    if (typeof booleanValue === 'boolean') return booleanValue
  }
  return undefined
}

function inferAccountScheduleEnabled(account: AdminAccountResponse): boolean | undefined {
  const direct = pickFirstBooleanLike(account, [
    'schedulable',
    'is_schedulable',
    'schedulable_enabled',
    'schedule_enabled',
    'scheduling_enabled',
    'enable_schedule',
    'schedule',
    'is_scheduled',
    'is_schedule_enabled'
  ])
  if (typeof direct === 'boolean') return direct
  const enabled = pickFirstBooleanLike(account, ['enabled', 'is_enabled'])
  if (typeof enabled === 'boolean') return enabled
  const disabled = pickFirstBooleanLike(account, ['disabled', 'is_disabled'])
  if (typeof disabled === 'boolean') return !disabled
  return undefined
}

export function hasUsableAdminCredential(station: { accessToken?: string; adminToken?: string; adminCredentialType?: AdminCredentialType }): boolean {
  if (station.adminToken?.trim()) return true
  if (station.adminCredentialType === 'api-key') return false
  return Boolean(station.accessToken?.trim())
}

function decodeBase64UrlJson(payload: string): Record<string, unknown> | undefined {
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  try {
    const json = Buffer.from(padded, 'base64').toString('utf8')
    const value = JSON.parse(json) as unknown
    return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

export function jwtExpirationMs(token?: string): number | undefined {
  const payload = token?.split('.')[1]
  if (!payload) return undefined
  const value = decodeBase64UrlJson(payload)
  const exp = value?.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return undefined
  return Math.floor(exp * 1000)
}

export function isJwtExpiringSoon(token?: string, leadTimeMs = 5 * 60 * 1000): boolean {
  const expirationMs = jwtExpirationMs(token)
  if (!expirationMs) return false
  return expirationMs <= Date.now() + leadTimeMs
}

export function isJwtLike(value?: string): boolean {
  const parts = value?.trim().split('.') ?? []
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return false
  return Boolean(decodeBase64UrlJson(parts[1]))
}

export function resolveWebAuthTokens(
  storage: Record<string, string | undefined>,
  cookies: Array<{ name: string; value: string }>
): { accessToken?: string; refreshToken?: string } {
  const cookieByName = new Map(cookies.map((cookie) => [cookie.name, cookie.value]))
  const accessTokenCandidates = [
    storage.accessToken,
    storage.authToken,
    storage.auth_token,
    storage.token,
    storage.jwt,
    storage.access_token,
    cookieByName.get('krill_jwt'),
    cookieByName.get('jwt'),
    cookieByName.get('auth_token'),
    cookieByName.get('access_token'),
    cookieByName.get('token')
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
  const accessToken = accessTokenCandidates.find(isJwtLike) ?? accessTokenCandidates[0]
  const refreshToken = [
    storage.refreshToken,
    storage.refresh_token,
    storage.refresh
  ].find((value) => Boolean(value?.trim()))?.trim()
  return {
    accessToken: accessToken || undefined,
    refreshToken: refreshToken || undefined
  }
}

export class Sub2ApiClient {
  private latestSourceKeyCredentials: Map<string, string> | undefined
  private latestAccountCredentials: Map<number, string> | undefined
  private activeReadApiBase: string | undefined

  constructor(private readonly station: ClientStation) {}

  getSourceKeyCredentials(): ReadonlyMap<string, string> | undefined {
    return this.latestSourceKeyCredentials
  }

  getAdminAccountCredentials(): ReadonlyMap<number, string> | undefined {
    return this.latestAccountCredentials
  }

  private apiBase(): string {
    return this.activeReadApiBase ?? this.station.apiBaseUrl ?? this.station.baseUrl
  }

  private readApiBases(): string[] {
    if (this.activeReadApiBase) return [this.activeReadApiBase]
    return resolveStationReadApiBases(this.station.baseUrl, this.station.apiBaseUrl)
  }

  private apiPath(key: keyof typeof defaultStationApiPaths): string {
    if (key === 'profile') return resolveStationProfilePath(this.apiBase(), this.station.apiPaths?.profile)
    return resolveStationApiPath(defaultStationApiPaths[key], this.station.apiPaths?.[key])
  }

  private requestUrl(path: string, apiBaseUrl = this.apiBase()): string {
    return resolveStationApiRequestUrl(apiBaseUrl, path)
  }

  private adminUsagePagePath(
    page: number,
    options: Partial<Pick<ProfitIntervalQuery, 'startAt' | 'endAt' | 'timezone' | 'accountId' | 'sellingGroupId'>> = {}
  ): string {
    const url = new URL(this.requestUrl(this.apiPath('adminUsageLogs')))
    url.searchParams.set('page', String(page))
    url.searchParams.set('page_size', String(adminUsageDetailPageSize))
    url.searchParams.set('sort_by', 'created_at')
    url.searchParams.set('sort_order', options.startAt ? 'asc' : 'desc')
    if (options.startAt && options.endAt) {
      const endAt = new Date(options.endAt)
      endAt.setUTCDate(endAt.getUTCDate() - 1)
      const timezone = options.timezone ?? 'Asia/Shanghai'
      url.searchParams.set('start_date', dateInTimezone(options.startAt, timezone))
      url.searchParams.set('end_date', dateInTimezone(endAt, timezone))
      url.searchParams.set('timezone', timezone)
    }
    if (options.accountId !== undefined) url.searchParams.set('account_id', String(options.accountId))
    if (options.sellingGroupId !== undefined) url.searchParams.set('group_id', String(options.sellingGroupId))
    return url.toString()
  }

  private fetch(input: string, init?: RequestInit): Promise<Response> {
    return (this.station.fetchImpl ?? fetch)(input, init)
  }

  private async readApiResponse(response: Response): Promise<ParsedApiResponse> {
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'unknown'
    const text = await response.text()
    const trimmed = text.trim()
    if (!trimmed) return { payload: null, contentType, bodyKind: 'empty' }
    try {
      return { payload: JSON.parse(trimmed) as unknown, contentType, bodyKind: 'json' }
    } catch {
      return {
        payload: null,
        contentType,
        bodyKind: contentType.includes('html') || /^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed) ? 'html' : 'text'
      }
    }
  }

  private responseContext(path: string, response: Response, parsed: ParsedApiResponse): string {
    return `${path}，HTTP ${response.status}，${parsed.contentType}`
  }

  private responseBodyHint(parsed: ParsedApiResponse): string {
    if (parsed.bodyKind === 'empty') return '接口返回空内容'
    if (parsed.bodyKind === 'html') return '疑似返回网页登录页、风控页或反代拦截页'
    if (parsed.bodyKind === 'text') return '接口返回文本而不是 JSON'
    return 'JSON 顶层不是对象'
  }

  private redirectLocationHint(response: Response): string {
    const location = response.headers.get('location')?.trim()
    if (!location) return '站点返回重定向'
    try {
      const target = new URL(location, this.apiBase())
      return `站点返回重定向到 ${target.origin}${target.pathname}`
    } catch {
      return `站点返回重定向到 ${location.split('?')[0]}`
    }
  }

  private responseFailureMessage(path: string, response: Response, parsed: ParsedApiResponse): string {
    if (response.status >= 300 && response.status < 400) {
      return `请求失败 (${response.status})：${this.redirectLocationHint(response)}；疑似 API 基址/路径打到了网页登录页，请检查 API 基址和接口路径（${path}）`
    }
    if (response.status === 403 && (parsed.bodyKind === 'html' || parsed.bodyKind === 'text')) {
      return `请求失败 (403)：站点拒绝当前登录会话，可能是风控或会话指纹失效；请在编辑站点中点击“重新授权 / 换号登录”，再执行兼容诊断（${this.responseContext(path, response, parsed)}；${this.responseBodyHint(parsed)}）`
    }
    const endpointHint =
      path === this.apiPath('groups')
        ? '分组接口未命中，二开站可能不是默认 /groups/available，或还需要补 timezone 等查询参数'
        : path === this.apiPath('keys') || path === resolveStationApiPath('', this.station.apiPaths?.keys)
          ? '密钥列表接口未命中，二开站可能需要 /keys 查询参数或 UI 请求头'
        : path === this.apiPath('adminGroups')
          ? '管理员分组接口未命中，二开站可能不是默认 /admin/groups/all'
          : undefined
    const context = `${this.responseContext(path, response, parsed)}；${this.responseBodyHint(parsed)}`
    if (endpointHint) return `请求失败 (${response.status})：${endpointHint}（${context}）`
    return `请求失败 (${response.status})：${this.responseBodyHint(parsed)}`
  }

  private invalidResponseMessage(path: string, response: Response, parsed: ParsedApiResponse): string {
    return `接口返回不是 JSON 对象（${this.responseContext(path, response, parsed)}；${this.responseBodyHint(parsed)}）`
  }

  private authHeaders(admin = false, apiBaseUrl = this.apiBase()): Record<string, string> {
    const dedicatedAdminToken = this.station.adminToken?.trim()
    const token = admin
      ? dedicatedAdminToken || (this.station.adminCredentialType === 'api-key' ? undefined : this.station.accessToken)
      : this.station.accessToken
    if (!token) throw new Sub2ApiError(admin ? '未配置管理员凭据' : '未配置访问令牌', 'UNAUTHORIZED', 401)
    const headers: Record<string, string> = { 'x-user-ui-request': '1' }
    try {
      headers.Referer = `${new URL(apiBaseUrl).origin}/`
    } catch {
      // The station base URL is validated before a client is constructed.
    }
    if (isSharkStation(apiBaseUrl)) headers.Referer = 'https://shayulajiao.xyz/keys'
    if (this.station.sessionCookie) headers.Cookie = this.station.sessionCookie
    if (this.station.userAgent) headers['User-Agent'] = this.station.userAgent
    if (admin && dedicatedAdminToken && this.station.adminCredentialType === 'api-key') return { ...headers, 'x-api-key': token }
    return { ...headers, Authorization: `Bearer ${token}` }
  }

  private async request<T>(path: string, options: FetchOptions = {}): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const onAbort = () => controller.abort()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const apiBases = options.admin ? [this.apiBase()] : this.readApiBases()
      let lastError: Sub2ApiError | undefined
      for (const apiBaseUrl of apiBases) {
        try {
          const response = await this.fetch(this.requestUrl(path, apiBaseUrl), {
            method: 'GET',
            headers: { ...this.authHeaders(options.admin, apiBaseUrl), Accept: 'application/json' },
            redirect: 'manual',
            signal: controller.signal
          })
          const parsed = await this.readApiResponse(response)
          const payload = parsed.payload as Sub2ApiEnvelope<T> | null
          if (!response.ok) {
            const message = payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.message === 'string'
              ? payload.message
              : this.responseFailureMessage(path, response, parsed)
            const code = response.status === 401 ? 'UNAUTHORIZED' : response.status === 403 ? 'FORBIDDEN' : 'API_ERROR'
            throw new Sub2ApiError(message, code, response.status)
          }
          if (!payload || typeof payload !== 'object') {
            throw new Sub2ApiError(this.invalidResponseMessage(path, response, parsed), 'INVALID_RESPONSE', response.status)
          }
          this.activeReadApiBase = apiBaseUrl
          return unwrapApiResponse<T>(payload)
        } catch (error) {
          if (error instanceof Sub2ApiError && error.status === 404 && apiBaseUrl !== apiBases[apiBases.length - 1]) {
            lastError = error
            continue
          }
          throw error
        }
      }
      throw lastError ?? new Sub2ApiError('未找到可用的兼容 API 根', 'API_ERROR')
    } catch (error) {
      if (error instanceof Sub2ApiError) throw error
      const classified = classifySub2ApiError(error)
      throw new Sub2ApiError(classified.message, classified.code)
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }

  private async requestJson<T>(path: string, body: unknown, options: FetchOptions = {}): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await this.fetch(this.requestUrl(path), {
        method: 'PUT',
        headers: { ...this.authHeaders(options.admin), Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'manual',
        signal: controller.signal
      })
      const parsed = await this.readApiResponse(response)
      const payload = parsed.payload as Sub2ApiEnvelope<T> | null
      if (!response.ok) {
        const message = payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.message === 'string'
          ? payload.message
          : this.responseFailureMessage(path, response, parsed)
        const code = response.status === 401 ? 'UNAUTHORIZED' : response.status === 403 ? 'FORBIDDEN' : 'API_ERROR'
        throw new Sub2ApiError(message, code, response.status)
      }
      if (!payload || typeof payload !== 'object') {
        throw new Sub2ApiError(this.invalidResponseMessage(path, response, parsed), 'INVALID_RESPONSE', response.status)
      }
      return unwrapApiResponse<T>(payload)
    } catch (error) {
      if (error instanceof Sub2ApiError) throw error
      const classified = classifySub2ApiError(error)
      throw new Sub2ApiError(classified.message, classified.code)
    } finally {
      clearTimeout(timeout)
    }
  }

  private async requestOptional<T>(path: string, options: FetchOptions = {}): Promise<T | undefined> {
    try {
      return await this.request<T>(path, options)
    } catch (error) {
      if (error instanceof Sub2ApiError && [403, 404, 405].includes(error.status ?? 0)) return undefined
      return undefined
    }
  }

  async refreshAccessToken(): Promise<{ accessToken: string; refreshToken: string }> {
    const refreshToken = this.station.refreshToken
    if (!refreshToken) throw new Sub2ApiError('未配置刷新令牌，请重新授权', 'UNAUTHORIZED', 401)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await this.fetch(this.requestUrl(this.apiPath('authRefresh')), {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-user-ui-request': '1',
          ...(this.station.sessionCookie ? { Cookie: this.station.sessionCookie } : {}),
          ...(this.station.userAgent ? { 'User-Agent': this.station.userAgent } : {})
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: controller.signal
      })
      const parsed = await this.readApiResponse(response)
      const payload = parsed.payload as Sub2ApiEnvelope<{
        access_token?: string
        refresh_token?: string
      }> | null
      if (!response.ok) {
        const message = payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.message === 'string'
          ? payload.message
          : `刷新授权失败 (${response.status})：${this.responseBodyHint(parsed)}`
        const code = response.status === 401 ? 'UNAUTHORIZED' : response.status === 403 ? 'FORBIDDEN' : 'API_ERROR'
        throw new Sub2ApiError(message, code, response.status)
      }
      if (!payload || typeof payload !== 'object') {
        throw new Sub2ApiError(this.invalidResponseMessage(this.apiPath('authRefresh'), response, parsed), 'INVALID_RESPONSE', response.status)
      }
      const data = unwrapApiResponse<{ access_token?: string; refresh_token?: string }>(payload)
      const accessToken = typeof data.access_token === 'string' ? data.access_token.trim() : ''
      const nextRefreshToken = typeof data.refresh_token === 'string' ? data.refresh_token.trim() : ''
      if (!accessToken || !nextRefreshToken) throw new Sub2ApiError('刷新接口未返回完整令牌', 'INVALID_RESPONSE')
      return { accessToken, refreshToken: nextRefreshToken }
    } catch (error) {
      if (error instanceof Sub2ApiError) throw error
      const classified = classifySub2ApiError(error)
      throw new Sub2ApiError(classified.message, classified.code)
    } finally {
      clearTimeout(timeout)
    }
  }

  async fetchSnapshot(previous?: StationSnapshot, signal?: AbortSignal): Promise<StationSnapshot> {
    const started = Date.now()
    try {
      let balance = previous?.balance
      let hasReadableBalance = typeof balance === 'number'
      try {
        const profile = await this.request<unknown>(this.apiPath('profile'), { signal })
        const profileBalance = pickProfileBalance(mappedProfile(profile, this.station.readMapping))
        if (typeof profileBalance === 'number') {
          balance = profileBalance
          hasReadableBalance = true
        }
      } catch (error) {
        if (isAuthorizationError(error)) throw error
        // Some forks don't expose the standard profile endpoint or return HTML there.
      }
      const balancePath = this.station.apiPaths?.balance?.trim() || knownDedicatedBalancePath(this.apiBase())
      if (balancePath) {
        try {
          const balancePayload = await this.request<unknown>(resolveStationApiPath('', balancePath), { signal })
          const dedicatedBalance = pickProfileBalance(mappedProfile(balancePayload, this.station.readMapping))
          if (typeof dedicatedBalance === 'number') {
            balance = dedicatedBalance
            hasReadableBalance = true
          }
        } catch {
          // Dedicated balance endpoints are optional for forked stations.
        }
      }
      let groupsPayload: unknown
      let groupReadMessage: string | undefined
      try {
        groupsPayload = await this.request<unknown>(this.apiPath('groups'), { signal })
      } catch (error) {
        if (isAuthorizationError(error)) throw error
        if (!hasReadableBalance) throw error
        const classified = classifySub2ApiError(error)
        groupReadMessage = `余额已读取，但分组暂不可读取：${classified.message}`
      }
      let ratesPayload: Record<string, number> = {}
      try {
        ratesPayload = mappedRates(await this.request<unknown>(this.apiPath('rates'), { signal }), this.station.readMapping)
      } catch {
        // Some forked stations include multipliers in the group/channel list and do not expose a rates endpoint.
      }
      let sourceKeys: StationSnapshot['sourceKeys'] = previous?.sourceKeys
      const keyPath = this.station.apiPaths?.keys?.trim()
      let sourceKeyReadState: NonNullable<StationSnapshot['sourceKeyReadState']> = keyPath ? 'unavailable' : 'not-configured'
      this.latestSourceKeyCredentials = undefined
      if (keyPath) {
        try {
          const keyPayload = await this.requestOptional(resolveStationApiPath('', keyPath), { signal })
          if (keyPayload !== undefined) {
            const mapped = mappedRecords(keyPayload, 'keys', this.station.readMapping).map((record) => ({
              ...record,
              id: record.id,
              name: record.name,
              group_ids: record.groupIds
            }))
            sourceKeys = normalizeSourceKeys(this.station.readMapping?.capabilities.keys ? mapped : keyPayload)
            this.latestSourceKeyCredentials = this.station.readMapping?.capabilities.keys ? undefined : sourceKeyCredentials(keyPayload)
            sourceKeyReadState = 'available'
          } else if (previous?.sourceKeys?.length) {
            sourceKeyReadState = 'stale'
          }
        } catch {
          // Keep the last successful Key list visible for recovery, but never
          // treat this refresh as proof that a relationship disappeared.
          sourceKeyReadState = previous?.sourceKeys?.length ? 'stale' : 'unavailable'
        }
      } else {
        sourceKeys = undefined
      }
      const groups = groupsPayload === undefined
        ? []
        : this.station.readMapping?.capabilities.groups
          ? mappedRecords(groupsPayload, 'groups', this.station.readMapping).map((record) => ({
              ...record,
              id: pickFirstFiniteNumber(record, ['id']) ?? record.id,
              name: record.name,
              platform: record.platform,
              rate_multiplier: pickFirstFiniteNumber(record, ['rateMultiplier']) ?? record.rateMultiplier
            })) as AvailableGroupResponse[]
          : Array.isArray(groupsPayload) ? groupsPayload as AvailableGroupResponse[] : (groupsPayload as { groups?: AvailableGroupResponse[] }).groups ?? []

      let channels: AvailableChannelResponse[] = []
      let mappedChannelHints: Map<number, PricingModelSnapshot[]> | undefined
      let priceCapability: StationSnapshot['priceCapability'] = groupReadMessage ? 'disabled' : 'unknown'
      try {
        const channelPayload = await this.request<unknown>(this.apiPath('channels'), { signal })
        if (this.station.readMapping?.capabilities.channels) {
          mappedChannelHints = mappedPricingHints(channelPayload, this.station.readMapping)
          priceCapability = mappedChannelHints.size > 0 ? 'available' : 'missing'
        } else {
          channels = Array.isArray(channelPayload) ? channelPayload as AvailableChannelResponse[] : (channelPayload as { channels?: AvailableChannelResponse[] }).channels ?? []
          priceCapability = channels.length > 0 ? 'available' : 'missing'
        }
      } catch (error) {
        const apiError = error instanceof Sub2ApiError ? error : undefined
        if (!groupReadMessage) priceCapability = apiError?.status === 403 || apiError?.status === 404 ? 'disabled' : 'unknown'
      }

      const pricing = mappedChannelHints ?? buildPricingHints(channels)
      const normalizedGroups = normalizeGroups(groups, ratesPayload ?? {}, pricing)
      const now = new Date().toISOString()
      return {
        stationId: this.station.id,
        stationName: this.station.name,
        health: 'healthy',
        balance,
        currency: 'USD',
        groups: normalizedGroups,
        sourceKeys,
        sourceKeyReadState,
        accounts: previous?.accounts ?? [],
        lastUpdatedAt: now,
        lastSuccessAt: now,
        responseTimeMs: Date.now() - started,
        priceCapability,
        errorMessage: groupReadMessage,
        adminConsole: previous?.adminConsole
      }
    } catch (error) {
      const classified = classifySub2ApiError(error)
      return {
        stationId: this.station.id,
        stationName: this.station.name,
        health: classified.code === 'UNAUTHORIZED' ? 'forbidden' : 'error',
        errorCode: classified.code,
        errorMessage: classified.message,
        balance: previous?.balance,
        currency: 'USD',
        groups: previous?.groups ?? [],
        sourceKeys: previous?.sourceKeys,
        sourceKeyReadState: previous?.sourceKeys?.length ? 'stale' : previous?.sourceKeyReadState ?? 'unavailable',
        accounts: previous?.accounts ?? [],
        lastUpdatedAt: new Date().toISOString(),
        lastSuccessAt: previous?.lastSuccessAt,
        responseTimeMs: Date.now() - started,
        priceCapability: previous?.priceCapability ?? 'unknown',
        adminConsole: previous?.adminConsole
      }
    }
  }

  async previewReadMapping(): Promise<StationMappingPreview> {
    const capabilities: StationReadCapability[] = ['profile', 'groups', 'rates', 'channels', 'keys']
    const results: StationMappingPreviewCapability[] = []
    for (const capability of capabilities) {
      const path = capability === 'keys' && !this.station.apiPaths?.keys?.trim()
        ? undefined
        : this.apiPath(capability)
      if (!path) {
        results.push({ capability, state: 'unavailable', path: '--', records: 0, fields: [], detail: '未配置接口路径' })
        continue
      }
      try {
        const payload = await this.request<unknown>(path)
        const configuredFields = mappedCapabilityFields(capability, this.station.readMapping)
        if (capability === 'profile') {
          const balance = pickProfileBalance(mappedProfile(payload, this.station.readMapping))
          results.push({
            capability,
            state: typeof balance === 'number' ? 'ready' : 'partial',
            path,
            records: typeof balance === 'number' ? 1 : 0,
            fields: configuredFields.length > 0 ? configuredFields : ['内置余额别名'],
            preview: typeof balance === 'number' ? `余额 ${balance}` : undefined,
            detail: typeof balance === 'number' ? undefined : '接口可达，但未解析到数值余额'
          })
          continue
        }
        if (capability === 'rates' && this.station.readMapping?.capabilities.rates?.recordMode === 'keyed-map') {
          const rates = mappedRates(payload, this.station.readMapping)
          results.push({ capability, state: Object.keys(rates).length > 0 ? 'ready' : 'partial', path, records: Object.keys(rates).length, fields: configuredFields.length > 0 ? configuredFields : ['键值倍率'], preview: Object.keys(rates).length > 0 ? `已解析 ${Object.keys(rates).length} 个倍率` : undefined, detail: Object.keys(rates).length > 0 ? undefined : '接口可达，但未解析到倍率' })
          continue
        }
        const records = mappedRecords(payload, capability, this.station.readMapping)
        const requiredFields = mappingFieldDefinitions[capability].filter((field) => field.required).map((field) => field.key)
        const required = configuredFields.length === 0 || (
          mappingRequiredFieldsPresent(capability, configuredFields)
          && records.some((record) => requiredFields.every((field) => record[field] !== undefined && record[field] !== null && record[field] !== ''))
        )
        results.push({
          capability,
          state: records.length > 0 && required ? 'ready' : records.length > 0 ? 'partial' : 'partial',
          path,
          records: records.length,
          fields: configuredFields.length > 0 ? configuredFields : ['内置字段别名'],
          preview: records.length > 0 ? `已解析 ${records.length} 条` : undefined,
          detail: records.length === 0 ? '接口可达，但未解析到记录' : required ? undefined : '必填字段未配置或未解析到值'
        })
      } catch (error) {
        const classified = classifySub2ApiError(error)
        results.push({ capability, state: 'unavailable', path, records: 0, fields: mappedCapabilityFields(capability, this.station.readMapping), detail: classified.message })
      }
    }
    return { stationId: this.station.id, generatedAt: new Date().toISOString(), capabilities: results }
  }

  async fetchAdminConsoleData(): Promise<AdminConsoleSnapshot> {
    const [dashboardPayload, usersPayload, channelsPayload, platformsPayload, usagePayload, settingsPayload] = await Promise.all([
      this.requestOptional(this.apiPath('adminDashboard'), { admin: true }),
      this.requestOptional(this.apiPath('adminUsers'), { admin: true }),
      this.requestOptional(this.apiPath('adminChannels'), { admin: true }),
      this.requestOptional(this.apiPath('adminPlatforms'), { admin: true }),
      this.requestOptional(this.apiPath('adminUsage'), { admin: true }),
      this.requestOptional(this.apiPath('adminSettings'), { admin: true })
    ])

    const consoleData: AdminConsoleSnapshot = {}
    if (dashboardPayload !== undefined) consoleData.dashboard = normalizeRecordCollection(dashboardPayload)
    if (usersPayload !== undefined) consoleData.users = normalizeRecordCollection(usersPayload)
    if (channelsPayload !== undefined) consoleData.channels = normalizeRecordCollection(channelsPayload)
    if (platformsPayload !== undefined) consoleData.platforms = normalizeRecordCollection(platformsPayload)
    if (usagePayload !== undefined) consoleData.usage = normalizeRecordCollection(usagePayload)
    if (settingsPayload !== undefined) consoleData.settings = normalizeRecordCollection(settingsPayload)
    return consoleData
  }

  /**
   * Read administrator log pages only in the privileged process. The adapter
   * immediately reduces provider rows to ledger fields, so callers cannot
   * accidentally expose full request logs to the renderer or local storage.
   */
  async fetchAdminUsageDetail(): Promise<AdminUsageDetailResult> {
    const fetchedAt = new Date().toISOString()
    const entriesById = new Map<string, UsageLedgerEntry>()
    let pagesFetched = 0
    let recordsSeen = 0
    try {
      for (let page = 1; page <= adminUsageDetailMaxPages; page += 1) {
        const payload = await this.request<unknown>(this.adminUsagePagePath(page), { admin: true })
        const records = normalizeRecordCollection(payload)
        pagesFetched += 1
        recordsSeen += records.length
        for (const entry of extractStrictUsageEntries(this.station.id, records)) entriesById.set(entry.id, entry)
        if (records.length < adminUsageDetailPageSize) {
          return {
            entries: [...entriesById.values()],
            coverage: {
              accountStationId: this.station.id,
              fetchedAt,
              state: entriesById.size < recordsSeen ? 'incomplete' : 'complete',
              pagesFetched,
              recordsSeen,
              acceptedEntries: entriesById.size
            }
          }
        }
      }
      return {
        entries: [...entriesById.values()],
        coverage: {
          accountStationId: this.station.id,
          fetchedAt,
          state: 'page-limit',
          pagesFetched,
          recordsSeen,
          acceptedEntries: entriesById.size,
          detail: `仅读取最近 ${adminUsageDetailMaxPages * adminUsageDetailPageSize} 条明细`
        }
      }
    } catch {
      return {
        entries: [...entriesById.values()],
        coverage: {
          accountStationId: this.station.id,
          fetchedAt,
          state: 'unavailable',
          pagesFetched,
          recordsSeen,
          acceptedEntries: entriesById.size,
          detail: '管理员用量明细接口不可用或未授权'
        }
      }
    }
  }

  /**
   * An on-demand, bounded interval read for the revenue report. Provider rows
   * are reduced immediately so no raw request log can cross the main-process
   * boundary. The server accepts date filters only; final [start, end)
   * enforcement is repeated by the shared report builder.
   */
  async fetchAdminProfitUsage(query: ProfitIntervalQuery): Promise<AdminProfitUsageResult> {
    const fetchedAt = new Date().toISOString()
    const recordsById = new Map<string, ProfitUsageRecord>()
    let pagesFetched = 0
    let recordsSeen = 0
    try {
      for (let page = 1; page <= adminProfitUsageMaxPages; page += 1) {
        const payload = await this.request<unknown>(this.adminUsagePagePath(page, query), { admin: true })
        const records = normalizeRecordCollection(payload)
        pagesFetched += 1
        recordsSeen += records.length
        for (const record of extractStrictProfitUsageRecords(this.station.id, records)) recordsById.set(record.id, record)
        if (records.length < adminUsageDetailPageSize) {
          return {
            records: [...recordsById.values()],
            coverage: {
              accountStationId: this.station.id,
              fetchedAt,
              state: recordsById.size < recordsSeen ? 'incomplete' : 'complete',
              pagesFetched,
              recordsSeen,
              acceptedEntries: recordsById.size
            }
          }
        }
      }
      return {
        records: [...recordsById.values()],
        coverage: {
          accountStationId: this.station.id,
          fetchedAt,
          state: 'page-limit',
          pagesFetched,
          recordsSeen,
          acceptedEntries: recordsById.size,
          detail: `区间明细超过 ${adminProfitUsageMaxPages * adminUsageDetailPageSize} 条，只核算已读取部分`
        }
      }
    } catch {
      return {
        records: [...recordsById.values()],
        coverage: {
          accountStationId: this.station.id,
          fetchedAt,
          state: pagesFetched > 0 ? 'incomplete' : 'unavailable',
          pagesFetched,
          recordsSeen,
          acceptedEntries: recordsById.size,
          detail: pagesFetched > 0 ? '区间明细读取中断，只核算已读取部分' : '管理员用量明细接口不可用或未授权'
        }
      }
    }
  }

  async fetchAdminData(): Promise<{ accounts: AccountSnapshot[]; groups: AdminGroupResponse[] }> {
    const groupsPayload = await this.request<AdminGroupResponse[] | { items?: AdminGroupResponse[] }>(this.apiPath('adminGroups'), { admin: true })
    const accountsPayload = await this.request<AdminAccountResponse[] | { items?: AdminAccountResponse[] }>(this.apiPath('adminAccounts'), { admin: true })
    const groups = Array.isArray(groupsPayload) ? groupsPayload : groupsPayload.items ?? []
    const accounts = Array.isArray(accountsPayload) ? accountsPayload : accountsPayload.items ?? []
    const accountCredentials = new Map<number, string>()
    const normalizedAccounts = accounts.map((account) => {
      const credential = pickDirectCredential(account as unknown as Record<string, unknown>)
      if (credential) accountCredentials.set(account.id, credential)
      return {
        id: account.id,
        name: account.name || `账号 ${account.id}`,
        platform: account.platform || 'unknown',
        apiBaseUrl: pickFirstString(account, ['api_base_url', 'apiBaseUrl', 'base_url', 'baseUrl', 'endpoint', 'api_url', 'apiUrl', 'proxy_url', 'proxyUrl']),
        groupIds: Array.isArray(account.group_ids) ? account.group_ids : [],
        groups: (account.groups ?? []).map((group) => group.name || `分组 ${group.id ?? ''}`),
        status: account.status || 'unknown',
        scheduleEnabled: inferAccountScheduleEnabled(account),
        baseRateMultiplier: pickFirstFiniteNumber(account, ['base_rate_multiplier', 'rate_multiplier', 'multiplier', 'ratio', 'price_ratio']),
        usageAmount: pickFirstFiniteNumber(account, ['usage', 'used', 'used_quota', 'cost', 'total_cost'])
      }
    })
    this.latestAccountCredentials = accountCredentials
    return {
      groups,
      accounts: normalizedAccounts
    }
  }

  async updateAccountGroups(mutation: AccountGroupMutation): Promise<void> {
    await this.requestJson(`/admin/accounts/${mutation.accountId}`, { group_ids: mutation.nextGroupIds }, { admin: true })
  }
}
