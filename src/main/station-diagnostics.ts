import { applyKnownSourceStationApiPathDefaults, applyLcodexApiPathDefaults, defaultNewApiPaths, defaultStationApiPaths, isLcodexLegacyPublicApiUrl, normalizeApiBaseUrl, normalizeStationApiPaths, normalizeStationBaseUrl, resolveLcodexStationCompatibility, resolveStationReadApiBases, resolveStationApiPath, resolveStationApiRequestUrl, resolveStationProfilePath } from '../shared/sub2api'
import type { FetchLike } from './sub2api-client'
import type { ResolvedStationAdapterType, StationAdapterType, StationApiPaths, StationApiProbe, StationApiProbeResult, StationDiagnostics } from '../shared/types'

export interface StationDiagnosticsInput {
  name: string
  baseUrl: string
  apiBaseUrl?: string
  adapterType?: StationAdapterType
  accessToken?: string
  refreshToken?: string
  sessionCookie?: string
  userAgent?: string
  adminToken?: string
  adminCredentialType?: 'jwt' | 'api-key'
  apiPaths?: StationApiPaths
  /** Explicit detailed diagnostics may use an already saved session. Auto-detection never does. */
  useSavedCredentials?: boolean
  fetchImpl?: FetchLike
}

function buildHeaders(input: StationDiagnosticsInput, apiBaseUrl: string, admin = false): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', 'x-user-ui-request': '1' }
  try {
    headers.Referer = `${new URL(apiBaseUrl).origin}/`
  } catch {
    // URL validation occurs in the normal diagnosis path.
  }
  const dedicatedAdminToken = input.adminToken?.trim()
  const token = admin
    ? dedicatedAdminToken || (input.adminCredentialType === 'api-key' ? undefined : input.accessToken)
    : input.accessToken
  if (token) {
    if (admin && dedicatedAdminToken && input.adminCredentialType === 'api-key') headers['x-api-key'] = token
    else headers.Authorization = `Bearer ${token}`
  }
  if (input.sessionCookie?.trim()) headers.Cookie = input.sessionCookie
  if (input.userAgent?.trim()) headers['User-Agent'] = input.userAgent
  return headers
}

function newApiBaseUrl(input: StationDiagnosticsInput): string {
  const candidate = (input.apiBaseUrl?.trim() || normalizeStationBaseUrl(input.baseUrl, 'newapi')).replace(/\/+$/, '')
  const url = new URL(candidate)
  url.pathname = url.pathname.replace(/\/api\/v1$/i, '') || '/'
  return url.toString().replace(/\/+$/, '')
}

function sub2ApiProbeSpecs(input: StationDiagnosticsInput, paths: StationApiPaths): StationApiProbe[] {
  return [
    { name: '用户信息', path: resolveStationProfilePath(apiBaseUrl(input), paths.profile), method: 'GET' },
    ...(paths.balance ? [{ name: '余额信息', path: resolveStationApiPath('', paths.balance), method: 'GET' as const }] : []),
    { name: '分组列表', path: resolveStationApiPath(defaultStationApiPaths.groups, paths.groups), method: 'GET' },
    { name: '倍率列表', path: resolveStationApiPath(defaultStationApiPaths.rates, paths.rates), method: 'GET' },
    { name: '价格列表', path: resolveStationApiPath(defaultStationApiPaths.channels, paths.channels), method: 'GET' },
    ...(paths.keys ? [{ name: '密钥列表', path: resolveStationApiPath('', paths.keys), method: 'GET' as const }] : []),
    { name: '刷新授权', path: resolveStationApiPath(defaultStationApiPaths.authRefresh, paths.authRefresh), method: 'POST' },
    { name: '管理员分组', path: resolveStationApiPath(defaultStationApiPaths.adminGroups, paths.adminGroups), method: 'GET', admin: true },
    { name: '管理员账号', path: resolveStationApiPath(defaultStationApiPaths.adminAccounts, paths.adminAccounts), method: 'GET', admin: true },
    { name: '后台概览', path: resolveStationApiPath(defaultStationApiPaths.adminDashboard, paths.adminDashboard), method: 'GET', admin: true },
    { name: '用户列表', path: resolveStationApiPath(defaultStationApiPaths.adminUsers, paths.adminUsers), method: 'GET', admin: true },
    { name: '渠道列表', path: resolveStationApiPath(defaultStationApiPaths.adminChannels, paths.adminChannels), method: 'GET', admin: true },
    { name: '平台列表', path: resolveStationApiPath(defaultStationApiPaths.adminPlatforms, paths.adminPlatforms), method: 'GET', admin: true },
    { name: '用量统计', path: resolveStationApiPath(defaultStationApiPaths.adminUsage, paths.adminUsage), method: 'GET', admin: true },
    { name: '站点设置', path: resolveStationApiPath(defaultStationApiPaths.adminSettings, paths.adminSettings), method: 'GET', admin: true }
  ]
}

function newApiProbeSpecs(paths: StationApiPaths): StationApiProbe[] {
  return [
    { name: 'NewAPI 用户信息', path: resolveStationApiPath(defaultNewApiPaths.profile, paths.profile), method: 'GET' },
    { name: 'NewAPI 可用分组', path: resolveStationApiPath(defaultNewApiPaths.groups, paths.groups), method: 'GET' },
    { name: 'NewAPI 价格列表', path: resolveStationApiPath(defaultNewApiPaths.channels, paths.channels), method: 'GET' },
    { name: 'NewAPI 令牌列表', path: resolveStationApiPath(defaultNewApiPaths.keys, paths.keys), method: 'GET' }
  ]
}

function probeSpecs(input: StationDiagnosticsInput, paths: StationApiPaths, adapterType?: StationAdapterType): Array<StationApiProbe & { adapter?: ResolvedStationAdapterType }> {
  if (adapterType === 'newapi') return newApiProbeSpecs(paths).map((spec) => ({ ...spec, adapter: 'newapi' }))
  if (adapterType === 'auto') {
    return [
      ...sub2ApiProbeSpecs(input, paths).filter((spec) => ['用户信息', '分组列表', '倍率列表', '价格列表'].includes(spec.name)).map((spec) => ({ ...spec, adapter: 'sub2api' as const })),
      ...newApiProbeSpecs(paths).map((spec) => ({ ...spec, adapter: 'newapi' as const }))
    ]
  }
  return sub2ApiProbeSpecs(input, paths).map((spec) => ({ ...spec, adapter: 'sub2api' as const }))
}

function parseJsonObject(payload: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(payload) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function bodyHint(_payload: string, parsed?: Record<string, unknown>): string {
  // Diagnostics cross the main/renderer boundary. Never use a raw response
  // fallback here: a successful authenticated profile can contain an email,
  // balance, or other private fields even when it has no message property.
  if (!parsed) return ''
  for (const field of ['message', 'error', 'code'] as const) {
    const value = parsed[field]
    if (typeof value !== 'string') continue
    const hint = value.trim()
    if (!hint || hint.length > 120) continue
    // A provider error may echo an Authorization/Cookie value. Keep only a
    // short human-readable message, never a value that resembles a secret or
    // a serialized response object.
    if (/bearer\s+|authorization|cookie\s*=|eyJ[a-z0-9_-]+\.|sk-[a-z0-9_-]{16,}|[{}\[\]<>]/i.test(hint)) continue
    return hint
  }
  return ''
}

function classifyHint(status: number, payloadHint: string, isJsonObject: boolean): { ok: boolean; hint: string } {
  if (status >= 200 && status < 300 && isJsonObject) return { ok: true, hint: payloadHint || '接口可用' }
  if ((status === 401 || status === 403) && isJsonObject) return { ok: true, hint: payloadHint || (status === 401 ? '需要授权' : '权限不足') }
  if (status >= 200 && status < 300 && !isJsonObject) return { ok: false, hint: '接口返回非 JSON 对象（可能是登录页、风控页或反代页面）' }
  if ((status === 401 || status === 403) && !isJsonObject) return { ok: false, hint: '授权响应不是 JSON 对象（可能是登录页、风控页或反代页面）' }
  if (status === 404) return { ok: false, hint: payloadHint || '未找到路径' }
  return { ok: false, hint: payloadHint || `HTTP ${status}` }
}

function apiBaseUrl(input: StationDiagnosticsInput, adapter?: ResolvedStationAdapterType): string {
  if (adapter === 'newapi') return newApiBaseUrl(input)
  const configuredApiBaseUrl = input.apiBaseUrl?.trim()
  const lcodexCompatibility = resolveLcodexStationCompatibility(input.baseUrl)
  if (lcodexCompatibility && (!configuredApiBaseUrl || isLcodexLegacyPublicApiUrl(configuredApiBaseUrl))) {
    return lcodexCompatibility.managementApiBaseUrl
  }
  return (configuredApiBaseUrl ?? normalizeApiBaseUrl(input.baseUrl)).replace(/\/+$/, '')
}

async function probeOne(input: StationDiagnosticsInput, spec: StationApiProbe & { adapter?: ResolvedStationAdapterType }): Promise<StationApiProbeResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const fetchImpl = input.fetchImpl ?? fetch
    const diagnosticInput = input.useSavedCredentials ? input : { ...input, accessToken: undefined, refreshToken: undefined, sessionCookie: undefined, userAgent: undefined, adminToken: undefined }
    const apiBases = spec.adapter === 'newapi'
      ? [apiBaseUrl(diagnosticInput, spec.adapter)]
      : resolveStationReadApiBases(diagnosticInput.baseUrl, apiBaseUrl(diagnosticInput, spec.adapter))
    let lastResult: StationApiProbeResult | undefined
    for (let index = 0; index < apiBases.length; index += 1) {
      const candidateApiBaseUrl = apiBases[index]
      const response = await fetchImpl(resolveStationApiRequestUrl(candidateApiBaseUrl, spec.path), {
        method: spec.method,
        headers: buildHeaders(diagnosticInput, candidateApiBaseUrl, Boolean(spec.admin)),
        signal: controller.signal,
        redirect: 'manual',
        body: spec.method === 'POST' ? JSON.stringify({ refresh_token: input.useSavedCredentials ? input.refreshToken ?? 'probe' : 'probe' }) : undefined
      })
      const payload = await response.text().catch(() => '')
      const parsed = parseJsonObject(payload)
      const payloadHint = bodyHint(payload, parsed)
      const classified = classifyHint(response.status, payloadHint, Boolean(parsed))
      const result: StationApiProbeResult = {
        name: spec.name,
        path: spec.path,
        method: spec.method,
        ok: classified.ok,
        status: response.status,
        hint: classified.hint
      }
      if (response.status !== 404 || index === apiBases.length - 1) return result
      lastResult = result
    }
    return lastResult ?? { name: spec.name, path: spec.path, method: spec.method, ok: false, hint: '未找到可用的兼容 API 根' }
  } catch (error) {
    return {
      name: spec.name,
      path: spec.path,
      method: spec.method,
      ok: false,
      hint: error instanceof DOMException && error.name === 'AbortError' ? '请求超时' : error instanceof Error ? error.message : '请求失败'
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function diagnoseStation(input: StationDiagnosticsInput): Promise<StationDiagnostics> {
  const apiPaths = applyKnownSourceStationApiPathDefaults(input.baseUrl, applyLcodexApiPathDefaults(input.baseUrl, normalizeStationApiPaths(input.apiPaths)))
  const probes = await Promise.all(probeSpecs(input, apiPaths, input.adapterType).map((spec) => probeOne(input, spec)))
  const normalizedBaseUrl = normalizeApiBaseUrl(input.baseUrl)
  const customApiBaseUrl = input.apiBaseUrl?.trim().replace(/\/+$/, '')
  const customPathsUsed = Boolean(customApiBaseUrl && customApiBaseUrl !== normalizedBaseUrl) || Object.entries(apiPaths).some(([key, value]) => value && value !== defaultStationApiPaths[key as keyof typeof defaultStationApiPaths])
  const standardSignals = probes.filter((probe) => ['用户信息', '分组列表', '倍率列表', '价格列表'].includes(probe.name) && probe.ok).length
  const newApiSignals = probes.filter((probe) => probe.name.startsWith('NewAPI ') && probe.ok).length
  const detectedAdapterType: ResolvedStationAdapterType | undefined = input.adapterType === 'newapi'
    ? 'newapi'
    : input.adapterType === 'custom'
      ? 'custom'
      : input.adapterType === 'sub2api'
        ? 'sub2api'
        : newApiSignals > 0 && standardSignals === 0
          ? 'newapi'
          : standardSignals > 0 && newApiSignals === 0
            ? 'sub2api'
            : undefined
  const apiVariant: StationDiagnostics['apiVariant'] = customPathsUsed
    ? (standardSignals > 0 ? 'fork' : 'custom')
    : detectedAdapterType === 'newapi' ? 'newapi' : (standardSignals > 0 ? 'standard' : 'unknown')
  const needsCookie = probes.some((probe) => /cookie|session|fingerprint/i.test(probe.hint))
  const needsUserAgent = probes.some((probe) => /user agent|ua|fingerprint/i.test(probe.hint))
  const suggestedPaths: StationApiPaths = {
    profile: detectedAdapterType === 'newapi' ? apiPaths.profile ?? defaultNewApiPaths.profile : apiPaths.profile ?? defaultStationApiPaths.profile,
    balance: apiPaths.balance,
    groups: detectedAdapterType === 'newapi' ? apiPaths.groups ?? defaultNewApiPaths.groups : apiPaths.groups ?? defaultStationApiPaths.groups,
    rates: apiPaths.rates ?? defaultStationApiPaths.rates,
    channels: detectedAdapterType === 'newapi' ? apiPaths.channels ?? defaultNewApiPaths.channels : apiPaths.channels ?? defaultStationApiPaths.channels,
    keys: detectedAdapterType === 'newapi' ? apiPaths.keys ?? defaultNewApiPaths.keys : apiPaths.keys,
    authRefresh: detectedAdapterType === 'newapi' ? apiPaths.authRefresh ?? defaultNewApiPaths.authRefresh : apiPaths.authRefresh ?? defaultStationApiPaths.authRefresh,
    adminGroups: apiPaths.adminGroups ?? defaultStationApiPaths.adminGroups,
    adminAccounts: apiPaths.adminAccounts ?? defaultStationApiPaths.adminAccounts,
    adminDashboard: apiPaths.adminDashboard ?? defaultStationApiPaths.adminDashboard,
    adminUsers: apiPaths.adminUsers ?? defaultStationApiPaths.adminUsers,
    adminChannels: apiPaths.adminChannels ?? defaultStationApiPaths.adminChannels,
    adminPlatforms: apiPaths.adminPlatforms ?? defaultStationApiPaths.adminPlatforms,
    adminUsage: apiPaths.adminUsage ?? defaultStationApiPaths.adminUsage,
    adminSettings: apiPaths.adminSettings ?? defaultStationApiPaths.adminSettings
  }
  const notes = probes
    .filter((probe) => !probe.ok)
    .map((probe) => `${probe.name}: ${probe.hint}`)
    .slice(0, 4)
    .join('；')
  return {
    apiVariant,
    detectedAdapterType,
    needsCookie,
    needsUserAgent,
    probes,
    suggestedPaths,
    notes: notes || undefined
  }
}
