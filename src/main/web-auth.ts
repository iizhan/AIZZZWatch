import { applyLcodexApiPathDefaults, isLcodexLegacyPublicApiUrl, resolveLcodexStationCompatibility, unwrapApiResponse } from '../shared/sub2api'
import type { StationApiPaths } from '../shared/types'

export type WebAuthFetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface WebAuthProbeSnapshot {
  pageApiBaseUrl?: string
  authClientId?: string
  accessToken?: string
  authToken?: string
  auth_token?: string
  access_token?: string
  token?: string
  jwt?: string
  refreshToken?: string
  refresh_token?: string
  refresh?: string
  sessionAccessToken?: string
  sessionRefreshToken?: string
}

export interface WebAuthWindowLike {
  webContents: {
    executeJavaScript(source: string, userGesture?: boolean): Promise<unknown>
    getURL(): string
    getUserAgent(): string
  }
}

export interface WebAuthRestoreResult {
  accessToken?: string
  refreshToken?: string
}

export interface WebAuthLaunchTarget {
  loadUrl: string
  clientRoute?: string
}

interface WebAuthRestoreResponse {
  authenticated?: boolean
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

function normalizeBaseCandidate(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/g, '')
  if (!trimmed) return undefined
  if (!/^https?:\/\//i.test(trimmed)) return undefined
  return trimmed
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

export function collectWebAuthApiBaseUrls(input: {
  loginPageUrl: string
  normalizedBaseUrl: string
  inputApiBaseUrl?: string
  pageApiBaseUrl?: string
}): string[] {
  const loginOrigin = (() => {
    try {
      return new URL(input.loginPageUrl).origin
    } catch {
      return undefined
    }
  })()
  return unique([
    normalizeBaseCandidate(input.pageApiBaseUrl),
    normalizeBaseCandidate(input.inputApiBaseUrl),
    loginOrigin,
    normalizeBaseCandidate(input.normalizedBaseUrl)
  ])
}

export function resolveWebAuthLaunchTarget(normalizedBaseUrl: string): WebAuthLaunchTarget {
  const compatibility = resolveLcodexStationCompatibility(normalizedBaseUrl)
  if (compatibility) {
    return { loadUrl: compatibility.managementApiBaseUrl, clientRoute: '/login' }
  }
  return { loadUrl: `${normalizedBaseUrl.replace(/\/api\/v1\/?$/, '')}/login` }
}

export function resolveWebAuthApiBaseUrl(input: {
  normalizedBaseUrl: string
  inputApiBaseUrl?: string
  pageApiBaseUrl?: string
}): string | undefined {
  const compatibility = resolveLcodexStationCompatibility(input.normalizedBaseUrl)
  const explicitApiBaseUrl = normalizeBaseCandidate(input.inputApiBaseUrl)
  if (compatibility) {
    return explicitApiBaseUrl && !isLcodexLegacyPublicApiUrl(explicitApiBaseUrl)
      ? explicitApiBaseUrl
      : compatibility.managementApiBaseUrl
  }
  return explicitApiBaseUrl ?? normalizeBaseCandidate(input.pageApiBaseUrl)
}

export function resolveWebAuthApiPaths(normalizedBaseUrl: string, paths?: StationApiPaths): StationApiPaths | undefined {
  if (!resolveLcodexStationCompatibility(normalizedBaseUrl)) return paths
  return applyLcodexApiPathDefaults(normalizedBaseUrl, paths ?? {})
}

export function buildCookieHeader(cookies: Array<{ name: string; value: string }>): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export async function readWebAuthProbeSnapshot(loginWindow: WebAuthWindowLike): Promise<WebAuthProbeSnapshot> {
  const result = await loginWindow.webContents.executeJavaScript(`(() => {
    const config = window.__APP_CONFIG__ || {}
    return {
      pageApiBaseUrl: typeof config.api_base_url === 'string' ? config.api_base_url : undefined,
      authClientId: localStorage.getItem('sub2api_auth_client_id') || undefined,
      accessToken: localStorage.getItem('auth_token') || localStorage.getItem('access_token') || localStorage.getItem('token') || localStorage.getItem('jwt') || undefined,
      authToken: localStorage.getItem('authToken') || undefined,
      auth_token: localStorage.getItem('auth_token') || undefined,
      access_token: localStorage.getItem('access_token') || undefined,
      token: localStorage.getItem('token') || undefined,
      jwt: localStorage.getItem('jwt') || undefined,
      refreshToken: localStorage.getItem('refresh_token') || localStorage.getItem('refreshToken') || localStorage.getItem('refresh') || undefined,
      refresh_token: localStorage.getItem('refresh_token') || undefined,
      refresh: localStorage.getItem('refresh') || undefined,
      sessionAccessToken: sessionStorage.getItem('ai_gateway_access_token') || undefined,
      sessionRefreshToken: sessionStorage.getItem('ai_gateway_refresh_token') || undefined
    }
  })()`, true) as Partial<WebAuthProbeSnapshot> | null | undefined
  return {
    pageApiBaseUrl: cleanString(result?.pageApiBaseUrl),
    authClientId: cleanString(result?.authClientId),
    accessToken: cleanString(result?.sessionAccessToken) ?? cleanString(result?.accessToken),
    authToken: cleanString(result?.authToken),
    auth_token: cleanString(result?.auth_token),
    access_token: cleanString(result?.access_token),
    token: cleanString(result?.token),
    jwt: cleanString(result?.jwt),
    refreshToken: cleanString(result?.sessionRefreshToken) ?? cleanString(result?.refreshToken),
    refresh_token: cleanString(result?.refresh_token),
    refresh: cleanString(result?.refresh)
  }
}

export async function tryRestoreWebAuthSession(input: {
  fetchImpl: WebAuthFetchLike
  apiBaseUrl: string
  authClientId?: string
  cookies: Array<{ name: string; value: string }>
  userAgent: string
}): Promise<WebAuthRestoreResult | undefined> {
  const apiBaseUrl = normalizeBaseCandidate(input.apiBaseUrl)
  if (!apiBaseUrl || !input.authClientId?.trim()) return undefined
  if (input.cookies.length === 0) return undefined

  const response = await input.fetchImpl(`${apiBaseUrl}/auth/session/restore`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Sub2API-Auth-Client': input.authClientId.trim(),
      Cookie: buildCookieHeader(input.cookies),
      'User-Agent': input.userAgent
    },
    body: JSON.stringify({})
  })

  if (!response.ok) return undefined
  const raw = await response.text().catch(() => '')
  if (!raw.trim()) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  let payload: unknown
  try {
    payload = unwrapApiResponse<WebAuthRestoreResponse>(parsed)
  } catch {
    return undefined
  }
  if (!payload || typeof payload !== 'object') return undefined
  const record = payload as Record<string, unknown>
  const authenticated = record.authenticated === true
  const accessToken = typeof record.access_token === 'string' ? record.access_token.trim() : ''
  const refreshToken = typeof record.refresh_token === 'string' ? record.refresh_token.trim() : ''
  const expiresIn = typeof record.expires_in === 'number' && Number.isFinite(record.expires_in) ? record.expires_in : undefined
  if (!authenticated || !accessToken || !expiresIn || expiresIn <= 0) return undefined
  return {
    accessToken,
    refreshToken: refreshToken || undefined
  }
}
