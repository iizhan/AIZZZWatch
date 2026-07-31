import { applyLcodexApiPathDefaults, isLcodexLegacyPublicApiUrl, resolveLcodexStationCompatibility, resolveStationApiPath, resolveStationApiRequestUrl, unwrapApiResponse, usesNewApiContract } from '../shared/sub2api'
import type { ResolvedStationAdapterType, StationAdapterType, StationApiPaths } from '../shared/types'

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
  /** Main-process only Cookie header after NewAPI rotates its HttpOnly refresh Cookie. */
  sessionCookie?: string
  /** The station explicitly does not implement the standard NewAPI refresh endpoint. */
  authRefreshUnsupported?: boolean
}

/**
 * OneAPI-compatible deployments can select an account context in the page.
 * This field is main-process-only and contains only the decimal `uid` value
 * used by the station's documented `New-Api-User` request header.
 */
export interface NewApiCookieSessionVerification {
  verified: boolean
  selectedUserId?: string
}

const maxWebAuthAccessTokenLength = 16 * 1024
const maxWebAuthCookieHeaderLength = 16 * 1024
const maxWebAuthCookiePairLength = 4 * 1024

export interface WebAuthLaunchTarget {
  loadUrl: string
  fallbackUrl?: string
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

function normalizeNewApiBaseCandidate(value: string | undefined): string | undefined {
  const candidate = normalizeBaseCandidate(value)
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    url.pathname = url.pathname.replace(/\/api\/v1$/i, '') || '/'
    return url.toString().replace(/\/+$/, '')
  } catch {
    return candidate.replace(/\/api\/v1$/i, '')
  }
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

export function isNewApiWebAuthContract(input: Pick<{ adapterType?: StationAdapterType; detectedAdapterType?: ResolvedStationAdapterType }, 'adapterType' | 'detectedAdapterType'>): boolean {
  return usesNewApiContract(input.adapterType ?? 'sub2api', input.detectedAdapterType)
}

export function resolveNewApiRefreshUrl(apiBaseUrl: string, authRefreshPath?: string): string | undefined {
  const normalized = normalizeNewApiBaseCandidate(apiBaseUrl)
  if (!normalized) return undefined
  try {
    return resolveStationApiRequestUrl(normalized, resolveStationApiPath('/api/user/auth/refresh', authRefreshPath))
  } catch {
    return undefined
  }
}

export function resolveNewApiProfileUrl(apiBaseUrl: string, profilePath?: string): string | undefined {
  const normalized = normalizeNewApiBaseCandidate(apiBaseUrl)
  if (!normalized) return undefined
  try {
    return resolveStationApiRequestUrl(normalized, resolveStationApiPath('/api/user/self', profilePath))
  } catch {
    return undefined
  }
}

/**
 * Chromium only returns a cookie when the queried URL is within the cookie's
 * path. NewAPI scopes its HttpOnly refresh cookie to its refresh endpoint.
 */
export function resolveWebAuthCookieUrl(apiBaseUrl: string, newApiAuth: boolean, authRefreshPath?: string): string {
  if (!newApiAuth) return apiBaseUrl
  return resolveNewApiRefreshUrl(apiBaseUrl, authRefreshPath) ?? apiBaseUrl
}

export function resolveWebAuthLaunchTarget(normalizedBaseUrl: string, preferNewApiSignIn = false): WebAuthLaunchTarget {
  const compatibility = resolveLcodexStationCompatibility(normalizedBaseUrl)
  if (compatibility) {
    return { loadUrl: compatibility.managementApiBaseUrl, clientRoute: '/login' }
  }
  const root = normalizedBaseUrl.replace(/\/api\/v1\/?$/, '')
  return preferNewApiSignIn
    ? { loadUrl: `${root}/sign-in`, fallbackUrl: `${root}/login` }
    : { loadUrl: `${root}/login`, fallbackUrl: `${root}/sign-in` }
}

/**
 * Some SPA deployments return 200 for an unknown route and render their own
 * 404 page. Only a same-origin, current candidate login route is eligible for
 * the one-time fallback; redirects, challenge pages and external OAuth pages
 * must remain untouched.
 */
export async function isWebAuthLoginRouteNotFound(loginWindow: WebAuthWindowLike, expectedUrl: string): Promise<boolean> {
  let current: URL
  let expected: URL
  try {
    current = new URL(loginWindow.webContents.getURL())
    expected = new URL(expectedUrl)
  } catch {
    return false
  }
  if (current.origin !== expected.origin) return false
  const currentPath = current.pathname.replace(/\/+$/, '') || '/'
  const expectedPath = expected.pathname.replace(/\/+$/, '') || '/'
  if (currentPath !== expectedPath && !['/404', '/not-found'].includes(currentPath)) return false
  try {
    const pageText = await loginWindow.webContents.executeJavaScript(`document.body?.innerText?.slice(0, 1200) || ''`, true)
    return typeof pageText === 'string' && /(?:\b404\b|page\s+not\s+found|页面未找到|页面不存在)/i.test(pageText)
  } catch {
    return false
  }
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

/**
 * Cookies originate from the temporary Chromium authorization partition, but
 * they still cross a trust boundary before becoming a main-process request
 * header. Reject malformed or oversized data rather than forwarding it.
 */
export function buildBoundedCookieHeader(cookies: Array<{ name: string; value: string }>): string | undefined {
  if (cookies.length === 0 || cookies.length > 32) return undefined
  const pairs: string[] = []
  for (const cookie of cookies) {
    const name = typeof cookie.name === 'string' ? cookie.name : ''
    const value = typeof cookie.value === 'string' ? cookie.value : ''
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || !value || /[;\r\n\u0000-\u001F\u007F]/.test(value)) return undefined
    const pair = `${name}=${value}`
    if (pair.length > maxWebAuthCookiePairLength) return undefined
    pairs.push(pair)
  }
  const header = pairs.join('; ')
  return header.length > 0 && header.length <= maxWebAuthCookieHeaderLength ? header : undefined
}

export function isBoundedCookieHeader(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxWebAuthCookieHeaderLength) return false
  const cookies = value.split(';').map((part) => part.trim()).map((part) => {
    const separator = part.indexOf('=')
    return separator > 0 ? { name: part.slice(0, separator), value: part.slice(separator + 1) } : undefined
  })
  if (cookies.some((cookie) => !cookie)) return false
  const normalized = buildBoundedCookieHeader(cookies as Array<{ name: string; value: string }>)
  return normalized !== undefined
}

function rotatedNewApiSessionCookie(headers: Headers, cookies: Array<{ name: string; value: string }>): string | undefined {
  const setCookieHeaders = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? [headers.get('set-cookie')].filter((value): value is string => Boolean(value))
  const refreshValue = setCookieHeaders
    .map((value) => value.match(/(?:^|,\s*)new_api_refresh=([^;]*)/i)?.[1])
    .find((value): value is string => value !== undefined)
  if (refreshValue === undefined) return undefined
  const remaining = cookies
    .filter((cookie) => cookie.name.toLowerCase() !== 'new_api_refresh')
    .map((cookie) => `${cookie.name}=${cookie.value}`)
  if (refreshValue) remaining.push(`new_api_refresh=${refreshValue}`)
  return remaining.join('; ')
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
  const cookieHeader = buildBoundedCookieHeader(input.cookies)
  if (!cookieHeader) return undefined

  const response = await input.fetchImpl(`${apiBaseUrl}/auth/session/restore`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Sub2API-Auth-Client': input.authClientId.trim(),
      Cookie: cookieHeader,
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

/**
 * NewAPI keeps its short-lived access token in client memory and its refresh
 * session in an HttpOnly cookie. Restore the access token in the main process
 * after browser login without exposing either value to the renderer.
 */
export async function tryRestoreNewApiSession(input: {
  fetchImpl: WebAuthFetchLike
  apiBaseUrl: string
  authRefreshPath?: string
  cookies: Array<{ name: string; value: string }>
  userAgent: string
  /** Use the isolated BrowserWindow partition instead of constructing a Cookie header. */
  useSessionCredentials?: boolean
}): Promise<WebAuthRestoreResult | undefined> {
  const refreshUrl = resolveNewApiRefreshUrl(input.apiBaseUrl, input.authRefreshPath)
  if (!refreshUrl || (!input.useSessionCredentials && input.cookies.length === 0)) return undefined
  let origin: string
  try {
    origin = new URL(refreshUrl).origin
  } catch {
    return undefined
  }
  let cookieHeader: string | undefined
  if (!input.useSessionCredentials) {
    cookieHeader = buildBoundedCookieHeader(input.cookies)
    if (!cookieHeader) return undefined
  }
  const response = await input.fetchImpl(refreshUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Origin: origin,
      Referer: `${origin}/`,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      'User-Agent': input.userAgent
    },
    ...(input.useSessionCredentials ? { credentials: 'include' } : {}),
    body: '{}'
  })
  if (response.status === 404) return { authRefreshUnsupported: true }
  if (!response.ok) return undefined
  const raw = await response.text().catch(() => '')
  if (!raw.trim()) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  const envelope = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined
  if (!envelope || envelope.success !== true || !envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) return undefined
  const accessToken = cleanString((envelope.data as Record<string, unknown>).access_token)
  return accessToken
    ? { accessToken, sessionCookie: rotatedNewApiSessionCookie(response.headers, input.cookies) }
    : undefined
}

/**
 * Legacy OneAPI deployments authenticate browser requests with a Cookie and
 * expose no refresh-token endpoint. Verify only the fixed profile endpoint in
 * the isolated BrowserWindow partition. The profile body never leaves this
 * helper. A deployment may require its documented numeric selected-user
 * context; it is read and returned only as a bounded main-process value.
 */
export async function tryVerifyNewApiCookieSession(input: {
  loginWindow: WebAuthWindowLike
  apiBaseUrl: string
  profilePath?: string
}): Promise<NewApiCookieSessionVerification> {
  if (!isNewApiCookieSessionPage(input)) return { verified: false }
  const profileUrl = resolveNewApiProfileUrl(input.apiBaseUrl, input.profilePath)
  if (!profileUrl) return { verified: false }
  let result: { verified?: unknown; selectedUserId?: unknown } | null | undefined
  try {
    result = await input.loginWindow.webContents.executeJavaScript(`(() => {
      const profileUrl = ${JSON.stringify(profileUrl)}
      const expectedOrigin = ${JSON.stringify(new URL(profileUrl).origin)}
      if (window.location.protocol !== 'https:' || window.location.origin !== expectedOrigin) return { verified: false }
      let selectedUserId
      try {
        const candidate = window.localStorage.getItem('uid') || ''
        selectedUserId = /^\\d{1,20}$/.test(candidate) ? candidate : undefined
      } catch {
        selectedUserId = undefined
      }
      return window.fetch(profileUrl, {
        method: 'GET',
        credentials: 'include',
        redirect: 'manual',
        headers: {
          Accept: 'application/json',
          ...(selectedUserId ? { 'New-Api-User': selectedUserId } : {})
        }
      }).then(async (response) => {
        if (!response.ok || response.type === 'opaqueredirect') return { verified: false }
        if (!/application\\/json/i.test(response.headers.get('content-type') || '')) return { verified: false }
        const payload = await response.json().catch(() => undefined)
        const validEnvelope = Boolean(payload && typeof payload === 'object' && !Array.isArray(payload)
          && payload.success === true
          && payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data))
        return validEnvelope ? { verified: true, ...(selectedUserId ? { selectedUserId } : {}) } : { verified: false }
      }).catch(() => ({ verified: false }))
    })()`, true) as { verified?: unknown; selectedUserId?: unknown } | null | undefined
  } catch {
    return { verified: false }
  }
  const selectedUserId = cleanString(result?.selectedUserId)
  return {
    verified: result?.verified === true,
    ...(selectedUserId && /^\d{1,20}$/.test(selectedUserId) ? { selectedUserId } : {})
  }
}

/**
 * Keeps Cookie-session capture tied to a logged-in HTTPS page. The caller can
 * distinguish an in-progress login page from a logged-in page whose session
 * cannot be persisted, without reading profile data or Cookie values.
 */
export function isNewApiCookieSessionPage(input: Pick<Parameters<typeof tryVerifyNewApiCookieSession>[0], 'loginWindow' | 'apiBaseUrl' | 'profilePath'>): boolean {
  const profileUrl = resolveNewApiProfileUrl(input.apiBaseUrl, input.profilePath)
  if (!profileUrl) return false
  try {
    const currentUrl = new URL(input.loginWindow.webContents.getURL())
    const targetUrl = new URL(profileUrl)
    const currentPath = currentUrl.pathname.replace(/\/+$/, '') || '/'
    return currentUrl.protocol === 'https:'
      && targetUrl.protocol === 'https:'
      && currentUrl.origin === targetUrl.origin
      && !['/login', '/sign-in', '/otp'].includes(currentPath)
  } catch {
    return false
  }
}

/**
 * Some NewAPI deployments only complete their refresh flow from the logged-in
 * browser page. Keep that fallback bound to the current HTTPS origin and return
 * only the whitelisted access token to the main process.
 */
export async function tryRestoreNewApiSessionFromPage(input: {
  loginWindow: WebAuthWindowLike
  apiBaseUrl: string
  authRefreshPath?: string
}): Promise<WebAuthRestoreResult | undefined> {
  const refreshUrl = resolveNewApiRefreshUrl(input.apiBaseUrl, input.authRefreshPath)
  if (!refreshUrl) return undefined

  let currentUrl: URL
  let targetUrl: URL
  try {
    currentUrl = new URL(input.loginWindow.webContents.getURL())
    targetUrl = new URL(refreshUrl)
  } catch {
    return undefined
  }
  const currentPath = currentUrl.pathname.replace(/\/+$/, '') || '/'
  if (currentUrl.protocol !== 'https:' || targetUrl.protocol !== 'https:' || currentUrl.origin !== targetUrl.origin) return undefined
  if (['/login', '/sign-in', '/otp'].includes(currentPath)) return undefined

  let result: { accessToken?: unknown } | null | undefined
  try {
    result = await input.loginWindow.webContents.executeJavaScript(`(() => {
    const refreshUrl = ${JSON.stringify(targetUrl.toString())}
    const expectedOrigin = ${JSON.stringify(targetUrl.origin)}
    if (window.location.protocol !== 'https:' || window.location.origin !== expectedOrigin) return undefined
    return window.fetch(refreshUrl, {
      method: 'POST',
      credentials: 'include',
      redirect: 'manual',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: '{}'
    }).then(async (response) => {
      if (!response.ok || response.type === 'opaqueredirect') return undefined
      if (!/application\\/json/i.test(response.headers.get('content-type') || '')) return undefined
      const payload = await response.json()
      const data = payload && typeof payload === 'object' && payload.success === true && payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
        ? payload.data
        : undefined
      const accessToken = data && typeof data.access_token === 'string' ? data.access_token.trim() : ''
      return accessToken && accessToken.length <= ${maxWebAuthAccessTokenLength} ? { accessToken } : undefined
    }).catch(() => undefined)
    })()`, true) as { accessToken?: unknown } | null | undefined
  } catch {
    return undefined
  }
  const accessToken = cleanString(result?.accessToken)
  return accessToken && accessToken.length <= maxWebAuthAccessTokenLength ? { accessToken } : undefined
}
