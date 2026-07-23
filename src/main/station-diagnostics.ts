import { applyLcodexApiPathDefaults, defaultNewApiPaths, defaultStationApiPaths, isLcodexLegacyPublicApiUrl, normalizeApiBaseUrl, normalizeStationApiPaths, resolveLcodexStationCompatibility, resolveStationApiPath, resolveStationApiRequestUrl, resolveStationProfilePath } from '../shared/sub2api'
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
  fetchImpl?: FetchLike
}

function buildHeaders(input: StationDiagnosticsInput, admin = false): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', 'x-user-ui-request': '1' }
  try {
    headers.Referer = `${new URL(apiBaseUrl(input)).origin}/`
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
  const candidate = (input.apiBaseUrl ?? input.baseUrl).trim().replace(/\/+$/, '')
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

function bodyHint(payload: string): string {
  const trimmed = payload.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      if (typeof record.message === 'string' && record.message.trim()) return record.message.trim()
      if (typeof record.error === 'string' && record.error.trim()) return record.error.trim()
      if (typeof record.code === 'string' && record.code.trim()) return record.code.trim()
    }
  } catch {
    // Ignore parse errors and fall back to raw text.
  }
  return trimmed.slice(0, 120)
}

function classifyHint(status: number, payloadHint: string): { ok: boolean; hint: string } {
  if (status >= 200 && status < 300) return { ok: true, hint: payloadHint || '接口可用' }
  if (status === 401) return { ok: true, hint: payloadHint || '需要授权' }
  if (status === 403) return { ok: true, hint: payloadHint || '权限不足' }
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
    const response = await fetchImpl(resolveStationApiRequestUrl(apiBaseUrl(input, spec.adapter), spec.path), {
      method: spec.method,
      headers: buildHeaders(input, Boolean(spec.admin)),
      signal: controller.signal,
      redirect: 'manual',
      body: spec.method === 'POST' ? JSON.stringify({ refresh_token: input.refreshToken ?? 'probe' }) : undefined
    })
    const payloadHint = bodyHint(await response.text().catch(() => ''))
    const classified = classifyHint(response.status, payloadHint)
    return {
      name: spec.name,
      path: spec.path,
      method: spec.method,
      ok: classified.ok,
      status: response.status,
      hint: classified.hint
    }
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
  const apiPaths = applyLcodexApiPathDefaults(input.baseUrl, normalizeStationApiPaths(input.apiPaths))
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
