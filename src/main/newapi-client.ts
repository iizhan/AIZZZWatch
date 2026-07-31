import { createHash } from 'node:crypto'
import { classifySub2ApiError, normalizeRecordCollection, resolveStationApiPath, resolveStationApiRequestUrl, Sub2ApiError } from '../shared/sub2api'
import type { GroupSnapshot, NewApiSessionAuthMode, PricingModelSnapshot, SourceKeySnapshot, StationApiPaths, StationSnapshot } from '../shared/types'
import type { FetchLike } from './sub2api-client'
import { isBoundedCookieHeader } from './web-auth'

interface NewApiClientStation {
  id: string
  name: string
  baseUrl: string
  apiBaseUrl?: string
  accessToken?: string
  sessionCookie?: string
  sessionAuthMode?: NewApiSessionAuthMode
  newApiSelectedUserId?: string
  userAgent?: string
  apiPaths?: StationApiPaths
  fetchImpl?: FetchLike
}

interface NewApiRequestOptions {
  method?: 'GET' | 'POST'
  optional?: boolean
  body?: string
}

interface NewApiGroupDefinition {
  ratio?: number
  description?: string
}

interface NewApiResponseEnvelope {
  payload: Record<string, unknown>
  sessionCookie?: string
}

function newApiBaseUrl(station: NewApiClientStation): string {
  const candidate = (station.apiBaseUrl ?? station.baseUrl).trim().replace(/\/+$/, '')
  try {
    const url = new URL(candidate)
    url.pathname = url.pathname.replace(/\/api\/v1$/i, '') || '/'
    return url.toString().replace(/\/+$/, '')
  } catch {
    return candidate.replace(/\/api\/v1$/i, '')
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function unwrapNewApiPayload<T>(payload: unknown): T {
  const record = asRecord(payload)
  if (!record) throw new Sub2ApiError('NewAPI 接口返回不是 JSON 对象', 'INVALID_RESPONSE')
  if (record.success === false) {
    throw new Sub2ApiError(typeof record.message === 'string' ? record.message : 'NewAPI 请求失败', 'API_ERROR')
  }
  return ('data' in record ? record.data : record) as T
}

function finiteNumber(value: unknown): number | undefined {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : undefined
  return typeof numberValue === 'number' && Number.isFinite(numberValue) ? numberValue : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function boundedNewApiSelectedUserId(value: unknown): string | undefined {
  const candidate = nonEmptyString(value)
  return candidate && /^\d{1,20}$/.test(candidate) ? candidate : undefined
}

function newApiBalance(profile: Record<string, unknown>): number | undefined {
  // NewAPI's `quota` is already the remaining balance; `used_quota` is a
  // cumulative usage statistic and must not be deducted a second time.
  return finiteNumber(profile.quota ?? profile.remain_quota ?? profile.remainQuota ?? profile.balance ?? profile.credits)
}

function refreshedSessionCookie(headers: Headers, currentCookie?: string): string | undefined {
  const cookieHeaders = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? [headers.get('set-cookie')].filter((value): value is string => Boolean(value))
  const refreshValue = cookieHeaders
    .map((value) => value.match(/(?:^|,\s*)new_api_refresh=([^;]*)/i)?.[1])
    .find((value): value is string => value !== undefined)
  if (refreshValue === undefined) return undefined
  const cookies = (currentCookie ?? '').split(';').map((value) => value.trim()).filter(Boolean)
    .filter((value) => !/^new_api_refresh=/i.test(value))
  if (refreshValue) cookies.push(`new_api_refresh=${refreshValue}`)
  return cookies.join('; ')
}

function stableGroupIds(stationId: string, names: Iterable<string>): Map<string, number> {
  const ids = new Map<string, number>()
  const used = new Set<number>()
  for (const name of [...new Set(names)].sort((left, right) => left.localeCompare(right))) {
    let attempt = 0
    let id = 0
    do {
      const digest = createHash('sha256').update(`${stationId}\u0000${name}\u0000${attempt}`).digest()
      id = digest.readUIntBE(0, 6)
      attempt += 1
    } while (used.has(id))
    used.add(id)
    ids.set(name, id)
  }
  return ids
}

function normalizeUserGroups(payload: unknown): Map<string, NewApiGroupDefinition> {
  const groups = new Map<string, NewApiGroupDefinition>()
  const record = asRecord(payload)
  if (record) {
    for (const [name, value] of Object.entries(record)) {
      const groupName = name.trim()
      if (!groupName) continue
      const details = asRecord(value)
      groups.set(groupName, {
        ratio: finiteNumber(details?.ratio ?? value),
        description: nonEmptyString(details?.desc ?? details?.description)
      })
    }
    return groups
  }
  for (const item of normalizeRecordCollection(payload)) {
    const name = nonEmptyString(item.name ?? item.group ?? item.id)
    if (!name) continue
    groups.set(name, {
      ratio: finiteNumber(item.ratio ?? item.group_ratio ?? item.rate_multiplier),
      description: nonEmptyString(item.desc ?? item.description)
    })
  }
  return groups
}

function normalizePricingGroupRatios(envelope: Record<string, unknown>): Map<string, number> {
  const ratios = new Map<string, number>()
  const raw = asRecord(envelope.group_ratio)
  if (!raw) return ratios
  for (const [name, value] of Object.entries(raw)) {
    const ratio = finiteNumber(value)
    if (ratio === undefined || !name.trim()) continue
    ratios.set(name.trim(), ratio)
  }
  return ratios
}

function pricingEnabledGroups(record: Record<string, unknown>): string[] {
  const raw = record.enable_groups ?? record.enableGroups
  if (Array.isArray(raw)) return raw.flatMap((value) => nonEmptyString(value) ?? [])
  const value = nonEmptyString(raw)
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : []
}

function normalizePricingModel(record: Record<string, unknown>): PricingModelSnapshot | undefined {
  const name = nonEmptyString(record.model_name ?? record.modelName ?? record.name)
  if (!name) return undefined
  if (nonEmptyString(record.billing_mode ?? record.billingMode) === 'tiered_expr' || nonEmptyString(record.billing_expr ?? record.billingExpr)) return { name }
  const quotaType = finiteNumber(record.quota_type ?? record.quotaType)
  if (quotaType === 1) {
    const perRequestPrice = finiteNumber(record.model_price ?? record.modelPrice)
    return perRequestPrice === undefined ? { name } : { name, perRequestPrice }
  }
  const modelRatio = finiteNumber(record.model_ratio ?? record.modelRatio)
  if (modelRatio === undefined) return { name }
  const inputPrice = modelRatio * 2
  const completionRatio = finiteNumber(record.completion_ratio ?? record.completionRatio) ?? 1
  return { name, inputPrice, outputPrice: inputPrice * completionRatio }
}

function pricingModelsForGroups(payload: unknown, groupNames: string[]): Map<string, PricingModelSnapshot[]> {
  const modelsByGroup = new Map(groupNames.map((name) => [name, [] as PricingModelSnapshot[]]))
  const groupNameSet = new Set(groupNames)
  const seen = new Map<string, Set<string>>(groupNames.map((name) => [name, new Set<string>()]))
  for (const pricing of normalizeRecordCollection(payload)) {
    const model = normalizePricingModel(pricing)
    if (!model) continue
    const enabled = pricingEnabledGroups(pricing)
    const targets = enabled.includes('all') ? groupNames : enabled.filter((group) => groupNameSet.has(group))
    for (const groupName of targets) {
      const names = seen.get(groupName)
      if (!names || names.has(model.name)) continue
      names.add(model.name)
      modelsByGroup.get(groupName)?.push(model)
    }
  }
  return modelsByGroup
}

function inferGroupPlatform(name: string, models: PricingModelSnapshot[]): string {
  const haystack = `${name} ${models.map((model) => model.name).join(' ')}`.toLowerCase()
  if (/claude|anthropic/.test(haystack)) return 'anthropic'
  if (/gemini/.test(haystack)) return 'gemini'
  if (/grok/.test(haystack)) return 'grok'
  if (/antigravity/.test(haystack)) return 'antigravity'
  if (/gpt|openai|o[1-9]/.test(haystack)) return 'openai'
  return 'newapi'
}

function normalizeNewApiGroups(input: {
  stationId: string
  userGroups: Map<string, NewApiGroupDefinition>
  pricingRatios: Map<string, number>
  pricingPayload?: unknown
}): GroupSnapshot[] {
  // `/api/pricing` can include globally configured groups. When the user
  // endpoint is available, it is the authority for which groups this account
  // may actually purchase from, so retain only that intersection.
  const ratioByName = input.userGroups.size > 0
    ? new Map([...input.userGroups].flatMap(([name, group]) => {
        const ratio = input.pricingRatios.get(name) ?? group.ratio
        return ratio === undefined ? [] : [[name, ratio] as const]
      }))
    : input.pricingRatios
  const groupIds = stableGroupIds(input.stationId, ratioByName.keys())
  const modelsByGroup = pricingModelsForGroups(input.pricingPayload, [...ratioByName.keys()])
  return [...ratioByName]
    .filter(([name, ratio]) => name !== 'auto' && Number.isFinite(ratio))
    .map(([name, ratio]) => {
      const pricingModels = modelsByGroup.get(name) ?? []
      const description = input.userGroups.get(name)?.description
      return {
        id: groupIds.get(name)!,
        name,
        platform: inferGroupPlatform(name, pricingModels),
        rateMultiplier: ratio,
        userRateMultiplier: ratio,
        pricingAvailable: pricingModels.some((model) => model.inputPrice !== undefined || model.outputPrice !== undefined || model.perRequestPrice !== undefined),
        pricingHint: description,
        pricingModels: pricingModels.length > 0 ? pricingModels : undefined
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

function normalizeNewApiTokens(payload: unknown, groupIds: Map<string, number>): SourceKeySnapshot[] {
  return normalizeRecordCollection(payload).flatMap((token) => {
    const id = token.id ?? token.token_id
    const label = token.name ?? token.label
    if ((typeof id !== 'number' && typeof id !== 'string') || typeof label !== 'string' || !label.trim()) return []
    const groupName = nonEmptyString(token.group)
    const groupId = groupName && groupName !== 'auto' ? groupIds.get(groupName) : undefined
    const createdAtSeconds = finiteNumber(token.created_time ?? token.createdAt)
    return [{
      id: String(id),
      label: label.trim(),
      status: nonEmptyString(token.status) ?? (finiteNumber(token.status) !== undefined ? String(token.status) : undefined),
      createdAt: createdAtSeconds === undefined ? undefined : new Date(createdAtSeconds * 1_000).toISOString(),
      groupIds: groupId === undefined ? [] : [groupId],
      groupNames: groupId === undefined || !groupName ? [] : [groupName],
      summary: 'NewAPI 令牌记录（仅保留名称与分组，不读取或保存令牌原文）'
    }]
  })
}

/** Read-only adapter for NewAPI's user, group, pricing, and token endpoints. */
export class NewApiClient {
  constructor(private readonly station: NewApiClientStation) {}

  private endpoint(key: 'profile' | 'groups' | 'keys' | 'channels' | 'authRefresh', fallback: string): string {
    return resolveStationApiPath(fallback, this.station.apiPaths?.[key])
  }

  private url(path: string): string {
    return resolveStationApiRequestUrl(newApiBaseUrl(this.station), path)
  }

  private async requestEnvelope(path: string, options: NewApiRequestOptions = {}): Promise<NewApiResponseEnvelope | undefined> {
    const token = this.station.accessToken?.trim()
    const sessionCookie = isBoundedCookieHeader(this.station.sessionCookie) ? this.station.sessionCookie : undefined
    const usesCookieSession = this.station.sessionAuthMode === 'cookie-session' || (!token && Boolean(sessionCookie))
    const selectedUserId = usesCookieSession ? boundedNewApiSelectedUserId(this.station.newApiSelectedUserId) : undefined
    if (!token && !sessionCookie) throw new Sub2ApiError('未配置 NewAPI 登录会话，请重新授权或粘贴 JWT', 'UNAUTHORIZED', 401)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const origin = new URL(newApiBaseUrl(this.station)).origin
      const response = await (this.station.fetchImpl ?? fetch)(this.url(path), {
        method: options.method ?? 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(!usesCookieSession && token ? { Authorization: `Bearer ${token}` } : {}),
          'x-user-ui-request': '1',
          Referer: `${origin}/`,
          ...(options.method === 'POST' ? { Origin: origin, 'Content-Type': 'application/json' } : {}),
          ...(sessionCookie ? { Cookie: sessionCookie } : {}),
          ...(selectedUserId ? { 'New-Api-User': selectedUserId } : {}),
          ...(this.station.userAgent ? { 'User-Agent': this.station.userAgent } : {})
        },
        ...(options.method === 'POST' ? { body: options.body ?? '{}' } : {})
      })
      const text = await response.text()
      let payload: unknown
      try {
        payload = text.trim() ? JSON.parse(text) : null
      } catch {
        payload = null
      }
      if (!response.ok) {
        if (options.optional && [403, 404, 405].includes(response.status)) return undefined
        const message = payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).message === 'string'
          ? String((payload as Record<string, unknown>).message)
          : response.status === 403 && /html|text\//i.test(response.headers.get('content-type') ?? '')
            ? 'NewAPI 拒绝当前会话，可能需要重新授权或 Cookie/UA 已失效'
            : `NewAPI 请求失败 (${response.status})：${path}`
        throw new Sub2ApiError(message, response.status === 401 ? 'UNAUTHORIZED' : response.status === 403 ? 'FORBIDDEN' : 'API_ERROR', response.status)
      }
      const record = asRecord(payload)
      if (!record) {
        if (options.optional) return undefined
        throw new Sub2ApiError(`NewAPI 接口返回不是 JSON 对象（${path}）`, 'INVALID_RESPONSE', response.status)
      }
      if (record.success === false) {
        if (options.optional) return undefined
        throw new Sub2ApiError(typeof record.message === 'string' ? record.message : 'NewAPI 请求失败', 'API_ERROR', response.status)
      }
      return { payload: record, sessionCookie: refreshedSessionCookie(response.headers, this.station.sessionCookie) }
    } catch (error) {
      if (error instanceof Sub2ApiError) throw error
      const classified = classifySub2ApiError(error)
      if (options.optional && classified.code === 'API_ERROR') return undefined
      throw new Sub2ApiError(classified.message, classified.code)
    } finally {
      clearTimeout(timeout)
    }
  }

  private async request<T>(path: string, optional = false): Promise<T | undefined> {
    const envelope = await this.requestEnvelope(path, { optional })
    return envelope === undefined ? undefined : unwrapNewApiPayload<T>(envelope.payload)
  }

  async refreshAccessToken(): Promise<{ accessToken: string; refreshToken?: string; sessionCookie?: string }> {
    if (this.station.sessionAuthMode === 'cookie-session') {
      throw new Sub2ApiError('当前 OneAPI Cookie 会话不支持刷新访问令牌，请重新授权', 'UNAUTHORIZED', 401)
    }
    const envelope = await this.requestEnvelope(this.endpoint('authRefresh', '/api/user/auth/refresh'), { method: 'POST' })
    if (!envelope) throw new Sub2ApiError('NewAPI 会话刷新未返回数据', 'UNAUTHORIZED', 401)
    const payload = unwrapNewApiPayload<unknown>(envelope.payload)
    const record = asRecord(payload)
    const accessToken = nonEmptyString(record?.access_token ?? record?.accessToken)
    if (!accessToken) throw new Sub2ApiError('NewAPI 会话刷新未返回访问令牌', 'UNAUTHORIZED', 401)
    return { accessToken, sessionCookie: envelope.sessionCookie }
  }

  async fetchSnapshot(previous?: StationSnapshot): Promise<StationSnapshot> {
    const started = Date.now()
    try {
      const profile = await this.request<Record<string, unknown>>(this.endpoint('profile', '/api/user/self'))
      const userGroups = await this.request<unknown>(this.endpoint('groups', '/api/user/self/groups'), true)

      let pricingEnvelope: Record<string, unknown> | undefined
      let priceCapability: StationSnapshot['priceCapability'] = 'missing'
      try {
        pricingEnvelope = (await this.requestEnvelope(this.endpoint('channels', '/api/pricing')))?.payload
      } catch (error) {
        const apiError = error instanceof Sub2ApiError ? error : undefined
        priceCapability = apiError?.status === 403 || apiError?.status === 404 ? 'disabled' : 'unknown'
      }

      let tokenPayload: unknown
      let sourceKeyReadState: NonNullable<StationSnapshot['sourceKeyReadState']> = 'unavailable'
      try {
        tokenPayload = await this.request<unknown>(this.endpoint('keys', '/api/token/?p=0&size=100'), true)
        sourceKeyReadState = tokenPayload === undefined
          ? previous?.sourceKeys?.length ? 'stale' : 'unavailable'
          : 'available'
      } catch {
        sourceKeyReadState = previous?.sourceKeys?.length ? 'stale' : 'unavailable'
      }

      const pricingPayload = pricingEnvelope === undefined ? undefined : unwrapNewApiPayload<unknown>(pricingEnvelope)
      const groups = normalizeNewApiGroups({
        stationId: this.station.id,
        userGroups: normalizeUserGroups(userGroups),
        pricingRatios: pricingEnvelope ? normalizePricingGroupRatios(pricingEnvelope) : new Map(),
        pricingPayload
      })
      if (pricingEnvelope && groups.some((group) => group.pricingAvailable)) priceCapability = 'available'

      const groupIds = new Map(groups.map((group) => [group.name, group.id]))
      const now = new Date().toISOString()
      return {
        stationId: this.station.id,
        stationName: this.station.name,
        health: 'healthy',
        balance: profile ? newApiBalance(profile) : previous?.balance,
        currency: 'USD',
        groups,
        sourceKeys: tokenPayload === undefined ? previous?.sourceKeys : normalizeNewApiTokens(tokenPayload, groupIds),
        sourceKeyReadState,
        accounts: [],
        lastUpdatedAt: now,
        lastSuccessAt: now,
        responseTimeMs: Date.now() - started,
        priceCapability
      }
    } catch (error) {
      const classified = classifySub2ApiError(error)
      return {
        stationId: this.station.id,
        stationName: this.station.name,
        health: classified.code === 'UNAUTHORIZED' || classified.code === 'FORBIDDEN' ? 'forbidden' : 'error',
        errorCode: classified.code,
        errorMessage: classified.message,
        balance: previous?.balance,
        currency: 'USD',
        groups: previous?.groups ?? [],
        sourceKeys: previous?.sourceKeys,
        sourceKeyReadState: previous?.sourceKeys?.length ? 'stale' : previous?.sourceKeyReadState ?? 'unavailable',
        accounts: [],
        lastUpdatedAt: new Date().toISOString(),
        lastSuccessAt: previous?.lastSuccessAt,
        responseTimeMs: Date.now() - started,
        priceCapability: previous?.priceCapability ?? 'unknown'
      }
    }
  }
}
