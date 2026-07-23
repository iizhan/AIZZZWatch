import { classifySub2ApiError, normalizeRecordCollection, resolveStationApiPath, resolveStationApiRequestUrl, Sub2ApiError } from '../shared/sub2api'
import type { SourceKeySnapshot, StationApiPaths, StationSnapshot } from '../shared/types'
import type { FetchLike } from './sub2api-client'

interface NewApiClientStation {
  id: string
  name: string
  baseUrl: string
  apiBaseUrl?: string
  accessToken?: string
  sessionCookie?: string
  userAgent?: string
  apiPaths?: StationApiPaths
  fetchImpl?: FetchLike
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

function unwrapNewApiPayload<T>(payload: unknown): T {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Sub2ApiError('NewAPI 接口返回不是 JSON 对象', 'INVALID_RESPONSE')
  }
  const record = payload as Record<string, unknown>
  if (record.success === false) {
    throw new Sub2ApiError(typeof record.message === 'string' ? record.message : 'NewAPI 请求失败', 'API_ERROR')
  }
  return ('data' in record ? record.data : record) as T
}

function finiteNumber(value: unknown): number | undefined {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : undefined
  return typeof numberValue === 'number' && Number.isFinite(numberValue) ? numberValue : undefined
}

function newApiBalance(profile: Record<string, unknown>): number | undefined {
  const quota = finiteNumber(profile.quota ?? profile.balance ?? profile.credits)
  const used = finiteNumber(profile.used_quota ?? profile.usedQuota)
  if (quota !== undefined && used !== undefined) return quota - used
  return quota
}

function normalizeNewApiTokens(payload: unknown): SourceKeySnapshot[] {
  return normalizeRecordCollection(payload).flatMap((token) => {
    const id = token.id ?? token.token_id
    const label = token.name ?? token.label
    if ((typeof id !== 'number' && typeof id !== 'string') || typeof label !== 'string' || !label.trim()) return []
    return [{
      id: String(id),
      label: label.trim(),
      status: typeof token.status === 'string' ? token.status : undefined,
      createdAt: typeof token.created_time === 'number' ? new Date(token.created_time * 1_000).toISOString() : undefined,
      groupIds: [],
      groupNames: [],
      summary: 'NewAPI 令牌记录（不读取或保存令牌原文）'
    }]
  })
}

/** Read-only adapter for NewAPI's user, token, and model capability endpoints. */
export class NewApiClient {
  constructor(private readonly station: NewApiClientStation) {}

  private endpoint(key: 'profile' | 'keys' | 'channels', fallback: string): string {
    return resolveStationApiPath(fallback, this.station.apiPaths?.[key])
  }

  private url(path: string): string {
    return resolveStationApiRequestUrl(newApiBaseUrl(this.station), path)
  }

  private async request<T>(path: string, optional = false): Promise<T | undefined> {
    const token = this.station.accessToken?.trim()
    if (!token) throw new Sub2ApiError('未配置 NewAPI 访问令牌，请重新授权或粘贴 JWT', 'UNAUTHORIZED', 401)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await (this.station.fetchImpl ?? fetch)(this.url(path), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'x-user-ui-request': '1',
          Referer: `${new URL(newApiBaseUrl(this.station)).origin}/`,
          ...(this.station.sessionCookie ? { Cookie: this.station.sessionCookie } : {}),
          ...(this.station.userAgent ? { 'User-Agent': this.station.userAgent } : {})
        }
      })
      const text = await response.text()
      let payload: unknown
      try {
        payload = text.trim() ? JSON.parse(text) : null
      } catch {
        payload = null
      }
      if (!response.ok) {
        if (optional && [403, 404, 405].includes(response.status)) return undefined
        const message = payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).message === 'string'
          ? String((payload as Record<string, unknown>).message)
          : response.status === 403 && /html|text\//i.test(response.headers.get('content-type') ?? '')
            ? 'NewAPI 拒绝当前会话，可能需要重新授权或 Cookie/UA 已失效'
            : `NewAPI 请求失败 (${response.status})：${path}`
        throw new Sub2ApiError(message, response.status === 401 ? 'UNAUTHORIZED' : response.status === 403 ? 'FORBIDDEN' : 'API_ERROR', response.status)
      }
      if (!payload) {
        if (optional) return undefined
        throw new Sub2ApiError(`NewAPI 接口返回不是 JSON 对象（${path}）`, 'INVALID_RESPONSE', response.status)
      }
      return unwrapNewApiPayload<T>(payload)
    } catch (error) {
      if (error instanceof Sub2ApiError) throw error
      const classified = classifySub2ApiError(error)
      if (optional && classified.code === 'API_ERROR') return undefined
      throw new Sub2ApiError(classified.message, classified.code)
    } finally {
      clearTimeout(timeout)
    }
  }

  async fetchSnapshot(previous?: StationSnapshot): Promise<StationSnapshot> {
    const started = Date.now()
    try {
      const profile = await this.request<Record<string, unknown>>(this.endpoint('profile', '/api/user/self'))
      const tokenPayload = await this.request<unknown>(this.endpoint('keys', '/api/token/?p=0&size=100'), true)
      await this.request<unknown>(this.endpoint('channels', '/api/models'), true)
      const now = new Date().toISOString()
      return {
        stationId: this.station.id,
        stationName: this.station.name,
        health: 'healthy',
        balance: profile ? newApiBalance(profile) : previous?.balance,
        currency: 'USD',
        groups: [],
        sourceKeys: tokenPayload === undefined ? previous?.sourceKeys : normalizeNewApiTokens(tokenPayload),
        accounts: [],
        lastUpdatedAt: now,
        lastSuccessAt: now,
        responseTimeMs: Date.now() - started,
        priceCapability: 'missing'
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
        groups: [],
        sourceKeys: previous?.sourceKeys,
        accounts: [],
        lastUpdatedAt: new Date().toISOString(),
        priceCapability: 'missing'
      }
    }
  }
}
