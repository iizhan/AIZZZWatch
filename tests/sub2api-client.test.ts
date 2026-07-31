import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasUsableAdminCredential, isJwtExpiringSoon, isJwtLike, jwtExpirationMs, resolveWebAuthTokens, Sub2ApiClient } from '../src/main/sub2api-client'

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function base64UrlEncodeJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function makeJwt(expirationAtMs: number): string {
  const header = base64UrlEncodeJson({ alg: 'HS256', typ: 'JWT' })
  const payload = base64UrlEncodeJson({ exp: Math.floor(expirationAtMs / 1000) })
  return `${header}.${payload}.signature`
}

describe('Sub2ApiClient', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('parses JWT expiration time and triggers proactive refresh near expiry', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-17T00:00:00Z'))

    const soonToken = makeJwt(Date.now() + 2 * 60 * 1000)
    const laterToken = makeJwt(Date.now() + 10 * 60 * 1000)

    expect(jwtExpirationMs(soonToken)).toBe(Date.now() + 2 * 60 * 1000)
    expect(isJwtExpiringSoon(soonToken)).toBe(true)
    expect(isJwtExpiringSoon(laterToken)).toBe(false)
    expect(isJwtLike(laterToken)).toBe(true)
    expect(isJwtLike('csrf-token')).toBe(false)
  })

  it('falls back to login cookies when the login page has no localStorage token', () => {
    const cookieJwt = makeJwt(Date.now() + 10 * 60 * 1000)
    expect(resolveWebAuthTokens(
      {},
      [{ name: 'krill_jwt', value: 'cookie-token' }, { name: '_kfp', value: 'fingerprint' }]
    )).toEqual({ accessToken: 'cookie-token', refreshToken: undefined })
    expect(resolveWebAuthTokens(
      {},
      [{ name: 'jwt', value: 'smart-cookie-token' }]
    )).toEqual({ accessToken: 'smart-cookie-token', refreshToken: undefined })
    expect(resolveWebAuthTokens(
      {},
      [{ name: 'token', value: 'csrf-token' }, { name: 'jwt', value: 'login-jwt' }]
    )).toEqual({ accessToken: 'login-jwt', refreshToken: undefined })
    expect(resolveWebAuthTokens(
      { accessToken: 'storage-token', refreshToken: 'refresh-token' },
      [{ name: 'krill_jwt', value: 'cookie-token' }]
    )).toEqual({ accessToken: 'storage-token', refreshToken: 'refresh-token' })
    expect(resolveWebAuthTokens(
      { access_token: 'snake-storage-token', refresh_token: 'snake-refresh-token' },
      []
    )).toEqual({ accessToken: 'snake-storage-token', refreshToken: 'snake-refresh-token' })
    expect(resolveWebAuthTokens(
      { accessToken: 'csrf-token', token: 'csrf-token', jwt: cookieJwt },
      [{ name: 'token', value: 'fingerprint' }]
    )).toEqual({ accessToken: cookieJwt, refreshToken: undefined })
  })

  it('builds a healthy station snapshot from user endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ balance: 18.25 }))
      .mockResolvedValueOnce(ok([{ id: 3, name: 'Claude', platform: 'anthropic', rate_multiplier: 0.8 }]))
      .mockResolvedValueOnce(ok({ 3: 0.72 }))
      .mockResolvedValueOnce(ok([{
        name: 'main',
        platforms: [{
          platform: 'anthropic',
          groups: [{ id: 3 }],
          supported_models: [{ name: 'claude', pricing: { input_price: 0.003, output_price: 0.015 } }]
        }]
      }]))
    vi.stubGlobal('fetch', fetchMock)

    const client = new Sub2ApiClient({ id: 's1', name: 'Station', baseUrl: 'https://relay.example.com/api/v1', accessToken: 'secret' })
    const result = await client.fetchSnapshot()

    expect(result).toMatchObject({ stationId: 's1', health: 'healthy', balance: 18.25, priceCapability: 'available' })
    expect(result.groups[0]).toMatchObject({ id: 3, userRateMultiplier: 0.72, pricingAvailable: true })
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain('https://relay.example.com/api/v1/groups/available')
  })

  it('uses aihub auth/me with timezone to read the source wallet balance', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ credits: 42.25 }))
      .mockResolvedValueOnce(ok([{ id: 3, name: 'Claude', platform: 'anthropic', rate_multiplier: 0.8 }]))
      .mockResolvedValueOnce(ok({ 3: 0.72 }))
      .mockResolvedValueOnce(ok([]))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new Sub2ApiClient({
      id: 'aihub',
      name: 'aihub',
      baseUrl: 'https://aihub.top/api/v1',
      accessToken: 'secret',
      apiPaths: { profile: '/user/profile' }
    }).fetchSnapshot()

    expect(result).toMatchObject({ health: 'healthy', balance: 42.25 })
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain('https://aihub.top/api/v1/auth/me?timezone=Asia%2FShanghai')
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain('https://aihub.top/api/v1/user/profile')
  })

  it('uses Krill\'s known user paths from a legacy API root without manual path edits', async () => {
    const fetchMock = vi.fn((url: string | URL) => {
      const target = String(url)
      if (target === 'https://www.krill-ai.net/api/auth/me') return Promise.resolve(ok({ credits: 12.5 }))
      if (target === 'https://www.krill-ai.net/api/my/channels') {
        return Promise.resolve(ok([{ id: 3, title: 'OpenAI', provider: 'openai', multiplier: 0.025 }]))
      }
      return Promise.resolve(new Response('not found', { status: 404, headers: { 'Content-Type': 'text/plain' } }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await new Sub2ApiClient({
      id: 'krill',
      name: 'Krill',
      baseUrl: 'https://www.krill-ai.net/api/v1',
      accessToken: 'secret',
      apiPaths: { profile: '/api/auth/me', balance: '/api/credits', groups: '/api/my/channels' }
    }).fetchSnapshot()

    expect(result).toMatchObject({ health: 'healthy', balance: 12.5 })
    expect(result.groups[0]).toMatchObject({ id: 3, name: 'OpenAI', platform: 'openai', rateMultiplier: 0.025 })
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('https://www.krill-ai.net/api/auth/me')
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('https://www.krill-ai.net/api/my/channels')
  })

  it('uses an injected fetch implementation for desktop Chromium network requests', async () => {
    const globalFetch = vi.fn()
    vi.stubGlobal('fetch', globalFetch)
    const injectedFetch = vi.fn()
      .mockResolvedValueOnce(ok({ balance: 9.9 }))
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok([]))

    const client = new Sub2ApiClient({
      id: 'chromium-fetch',
      name: 'Chromium Fetch',
      baseUrl: 'https://relay.example.com/api/v1',
      accessToken: 'secret',
      fetchImpl: injectedFetch
    })
    const result = await client.fetchSnapshot()

    expect(result).toMatchObject({ health: 'healthy', balance: 9.9 })
    expect(injectedFetch).toHaveBeenCalled()
    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('keeps monitoring healthy when channel pricing is disabled', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(ok({ balance: 1 }))
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'disabled' }), { status: 403 })))

    const client = new Sub2ApiClient({ id: 's2', name: 'Station', baseUrl: 'https://relay.example.com/api/v1', accessToken: 'secret' })
    const result = await client.fetchSnapshot()

    expect(result.health).toBe('healthy')
    expect(result.priceCapability).toBe('disabled')
  })

  it('maps unauthorized responses to a visible forbidden state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'expired' }), { status: 401 })))

    const client = new Sub2ApiClient({ id: 's3', name: 'Station', baseUrl: 'https://relay.example.com/api/v1', accessToken: 'expired' })
    const result = await client.fetchSnapshot()

    expect(result).toMatchObject({ health: 'forbidden', errorCode: 'UNAUTHORIZED', errorMessage: 'expired' })
  })

  it('explains a text or HTML 403 as a session or WAF recovery problem', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>blocked</html>', {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    })))

    const result = await new Sub2ApiClient({ id: 'smart', name: '聪明哥', baseUrl: 'https://sub2.congmingai.com/api/v1', accessToken: 'secret' }).fetchSnapshot()

    expect(result).toMatchObject({ health: 'error', errorCode: 'FORBIDDEN' })
    expect(result.errorMessage).toContain('重新授权 / 换号登录')
    expect(result.errorMessage).toContain('兼容诊断')
  })

  it('reports login redirects as API path issues instead of following them', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('', {
      status: 302,
      headers: { Location: 'https://relay.example.com/login' }
    })))
    vi.stubGlobal('fetch', fetchMock)

    const client = new Sub2ApiClient({ id: 'redirect', name: 'Redirect Station', baseUrl: 'https://relay.example.com/api/v1', accessToken: 'secret' })
    const result = await client.fetchSnapshot()

    expect(result).toMatchObject({ health: 'error', errorCode: 'API_ERROR' })
    expect(result.errorMessage).toContain('重定向到 https://relay.example.com/login')
    expect(result.errorMessage).toContain('API 基址')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it('classifies too many redirects as an API path problem', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('net::ERR_TOO_MANY_REDIRECTS')))

    const client = new Sub2ApiClient({ id: 'loop', name: 'Loop Station', baseUrl: 'https://relay.example.com/api/v1', accessToken: 'secret' })
    const result = await client.fetchSnapshot()

    expect(result).toMatchObject({ health: 'error', errorCode: 'API_ERROR' })
    expect(result.errorMessage).toContain('重定向循环')
  })

  it('reports the required groups endpoint when HTML responses block synchronization', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('<html>login</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    }))))

    const client = new Sub2ApiClient({ id: 'html', name: 'HTML Station', baseUrl: 'https://relay.example.com/api/v1', accessToken: 'secret' })
    const result = await client.fetchSnapshot()

    expect(result).toMatchObject({ health: 'error', errorCode: 'INVALID_RESPONSE' })
    expect(result.errorMessage).toContain('/groups/available')
    expect(result.errorMessage).toContain('HTTP 200')
    expect(result.errorMessage).toContain('text/html')
    expect(result.errorMessage).toContain('网页登录页')
  })

  it('continues syncing forked stations when the optional profile endpoint returns HTML', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('<html>login</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      }))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok([{ id: 3, name: 'Claude', platform: 'anthropic', rate_multiplier: 0.8 }]))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok([]))
    vi.stubGlobal('fetch', fetchMock)

    const client = new Sub2ApiClient({ id: 'fork-profile', name: 'Fork Station', baseUrl: 'https://shayulajiao.xyz/api/v1', accessToken: 'secret' })
    const result = await client.fetchSnapshot()

    expect(result).toMatchObject({ health: 'healthy', balance: undefined })
    expect(result.groups[0]).toMatchObject({ id: 3, name: 'Claude' })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://shayulajiao.xyz/api/v1/user/profile',
      'https://shayulajiao.xyz/api/v1/auth/me?timezone=Asia%2FShanghai',
      'https://shayulajiao.xyz/api/v1/groups/available',
      'https://shayulajiao.xyz/api/v1/groups/rates',
      'https://shayulajiao.xyz/api/v1/channels/available'
    ])
  })

  it('reports empty refresh responses with endpoint context', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })))

    const client = new Sub2ApiClient({ id: 'refresh-empty', name: 'Station', baseUrl: 'https://relay.example.com/api/v1', refreshToken: 'refresh-secret' })

    await expect(client.refreshAccessToken()).rejects.toThrow(/\/auth\/refresh.*接口返回空内容/)
  })

  it('keeps a source wallet readable when only its groups endpoint returns 404 text', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ balance: 18.25 }))
      .mockResolvedValueOnce(new Response('not found', {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new Sub2ApiClient({ id: 'groups-404', name: 'Station', baseUrl: 'https://relay.example.com/api/v1', accessToken: 'secret' })

    const result = await client.fetchSnapshot()

    expect(result).toMatchObject({ health: 'healthy', balance: 18.25, groups: [], priceCapability: 'disabled' })
    expect(result.errorMessage).toMatch(/余额已读取，但分组暂不可读取.*分组接口未命中.*\/groups\/available/)
  })

  it('refreshes access and refresh tokens through the auth endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ access_token: 'next-access', refresh_token: 'next-refresh' }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new Sub2ApiClient({ id: 's4', name: 'Station', baseUrl: 'https://relay.example.com/api/v1', accessToken: 'expired', refreshToken: 'refresh-secret' })
    await expect(client.refreshAccessToken()).resolves.toEqual({ accessToken: 'next-access', refreshToken: 'next-refresh' })

    expect(fetchMock).toHaveBeenCalledWith('https://relay.example.com/api/v1/auth/refresh', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ refresh_token: 'refresh-secret' })
    }))
  })

  it('sends an administrator API key with x-api-key', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([]))
    vi.stubGlobal('fetch', fetchMock)

    const client = new Sub2ApiClient({ id: 's5', name: 'Station', baseUrl: 'https://relay.example.com/api/v1', adminToken: 'admin-key', adminCredentialType: 'api-key' })
    await client.fetchAdminData()

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers['x-api-key']).toBe('admin-key')
    expect(headers.Authorization).toBeUndefined()
  })

  it('sends an administrator JWT as a Bearer token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([]))
    vi.stubGlobal('fetch', fetchMock)

    const client = new Sub2ApiClient({ id: 's6', name: 'Station', baseUrl: 'https://relay.example.com/api/v1', adminToken: 'admin-jwt', adminCredentialType: 'jwt' })
    await client.fetchAdminData()

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer admin-jwt')
    expect(headers['x-api-key']).toBeUndefined()
  })

  it('normalizes administrator account scheduling without confusing account status', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([
        { id: 1, name: 'enabled-schedule', platform: 'openai', api_key: 'account-key-not-rendered', api_base_url: 'https://relay.example.com/api/v1', group_ids: [10], status: 'active', schedulable: true },
        { id: 2, name: 'disabled-schedule', platform: 'openai', group_ids: [10], status: 'active', schedule_enabled: false },
        { id: 3, name: 'disabled-flag', platform: 'openai', group_ids: [10], status: 'active', disabled: true },
        { id: 4, name: 'status-only', platform: 'openai', group_ids: [10], status: 'active' }
      ]))
    vi.stubGlobal('fetch', fetchMock)

    const client = new Sub2ApiClient({ id: 'schedule', name: 'Station', baseUrl: 'https://relay.example.com/api/v1', adminToken: 'admin-jwt', adminCredentialType: 'jwt' })
    const result = await client.fetchAdminData()

    expect(result.accounts.map((account) => [account.name, account.scheduleEnabled])).toEqual([
      ['enabled-schedule', true],
      ['disabled-schedule', false],
      ['disabled-flag', false],
      ['status-only', undefined]
    ])
    expect(result.accounts[0].apiBaseUrl).toBe('https://relay.example.com/api/v1')
    expect(result.accounts[0]).not.toHaveProperty('api_key')
    expect(client.getAdminAccountCredentials()).toEqual(new Map([[1, 'account-key-not-rendered']]))
  })

  it('uses the station login JWT for administrator endpoints when no dedicated admin token exists', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([]))
    vi.stubGlobal('fetch', fetchMock)

    const client = new Sub2ApiClient({ id: 's6-login', name: 'Station', baseUrl: 'https://relay.example.com/api/v1', accessToken: 'login-admin-jwt' })
    await client.fetchAdminData()

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer login-admin-jwt')
    expect(headers['x-api-key']).toBeUndefined()
  })

  it('loads optional admin console records without failing when a page is missing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok([{ title: '用户数', value: 12 }]))
      .mockResolvedValueOnce(ok([{ name: 'Admin', status: 'active' }]))
      .mockResolvedValueOnce(ok([{ name: 'Channels', platform: 'openai' }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'missing' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'missing' }), { status: 404 }))
      .mockResolvedValueOnce(ok([{ key: 'site_name', value: 'AIZZZWatch' }]))
    vi.stubGlobal('fetch', fetchMock)

    const client = new Sub2ApiClient({ id: 's6-console', name: 'Station', baseUrl: 'https://relay.example.com/api/v1', adminToken: 'admin-jwt', adminCredentialType: 'jwt' })
    const result = await client.fetchAdminConsoleData()

    expect(result).toEqual({
      dashboard: [{ title: '用户数', value: 12 }],
      users: [{ name: 'Admin', status: 'active' }],
      channels: [{ name: 'Channels', platform: 'openai' }],
      platforms: undefined,
      usage: undefined,
      settings: [{ key: 'site_name', value: 'AIZZZWatch' }]
    })
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('reduces administrator usage pages to strict ledger entries without exposing raw log fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({
      items: [
        { id: 'usage-1', account_id: 7, group_id: 3, created_at: '2026-07-21T12:00:00.000Z', total_cost: 12.5, api_key: 'must-not-leave-main' },
        { id: 'bad-usage', account_id: 7, total_cost: 3 }
      ]
    }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new Sub2ApiClient({ id: 'mine', name: 'Mine', baseUrl: 'https://relay.example.com/api/v1', adminToken: 'admin-jwt', adminCredentialType: 'jwt' })
    const result = await client.fetchAdminUsageDetail()

    expect(result.entries).toEqual([{
      id: 'mine:usage-1', accountStationId: 'mine', accountId: 7, sellingGroupId: 3, usageAmount: 12.5, occurredAt: '2026-07-21T12:00:00.000Z'
    }])
    expect(result.coverage).toMatchObject({ state: 'incomplete', pagesFetched: 1, recordsSeen: 2, acceptedEntries: 1 })
    expect(JSON.stringify(result)).not.toContain('must-not-leave-main')
    expect(fetchMock.mock.calls[0][0]).toContain('/admin/usage?page=1&page_size=100')
  })

  it('marks administrator usage detail unavailable instead of treating aggregate stats as exact logs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'missing' }), { status: 404 })))
    const client = new Sub2ApiClient({ id: 'mine', name: 'Mine', baseUrl: 'https://relay.example.com/api/v1', adminToken: 'admin-jwt', adminCredentialType: 'jwt' })

    await expect(client.fetchAdminUsageDetail()).resolves.toMatchObject({
      entries: [],
      coverage: { state: 'unavailable', acceptedEntries: 0 }
    })
  })

  it('reads a bounded profit interval with only strict accounting fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({
      items: [{
        id: 'profit-1', account_id: 7, group_id: 3, created_at: '2026-07-21T12:00:00.000Z',
        actual_cost: 5, account_stats_cost: 100, account_rate_multiplier: 0.03, api_key: 'must-not-leave-main'
      }]
    }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new Sub2ApiClient({ id: 'mine', name: 'Mine', baseUrl: 'https://relay.example.com/api/v1', adminToken: 'admin-jwt', adminCredentialType: 'jwt' })

    const result = await client.fetchAdminProfitUsage({
      stationId: 'mine', startAt: '2026-07-20T16:00:00.000Z', endAt: '2026-07-21T16:00:00.000Z', timezone: 'Asia/Shanghai', granularity: 'day', accountId: 7, sellingGroupId: 3
    })

    expect(result.records).toEqual([{
      id: 'mine:profit-1', accountStationId: 'mine', accountId: 7, sellingGroupId: 3,
      occurredAt: '2026-07-21T12:00:00.000Z', revenue: 5, upstreamBaseCost: 100, accountRateMultiplier: 0.03
    }])
    expect(result.coverage).toMatchObject({ state: 'complete', pagesFetched: 1, recordsSeen: 1, acceptedEntries: 1 })
    expect(JSON.stringify(result)).not.toContain('must-not-leave-main')
    const requestUrl = String(fetchMock.mock.calls[0][0])
    expect(requestUrl).toContain('start_date=2026-07-21')
    expect(requestUrl).toContain('end_date=2026-07-21')
    expect(requestUrl).toContain('timezone=Asia%2FShanghai')
    expect(requestUrl).toContain('sort_order=asc')
  })

  it('does not treat a login JWT as an administrator API key', () => {
    expect(hasUsableAdminCredential({ accessToken: 'login-jwt', adminCredentialType: 'api-key' })).toBe(false)
    expect(hasUsableAdminCredential({ accessToken: 'login-jwt', adminCredentialType: 'jwt' })).toBe(true)
    expect(hasUsableAdminCredential({ accessToken: 'login-jwt' })).toBe(true)
    expect(hasUsableAdminCredential({ adminToken: 'admin-key', adminCredentialType: 'api-key' })).toBe(true)
  })

  it('includes session cookies and user agent on authenticated requests', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ balance: 18.25 }))
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'disabled' }), { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new Sub2ApiClient({
      id: 's7',
      name: 'Station',
      baseUrl: 'https://relay.example.com/api/v1',
      accessToken: 'secret',
      sessionCookie: 'fp=abc123; session=xyz789',
      userAgent: 'AIZZZWatch/0.1.0 Electron/33.4.11'
    })
    await client.fetchSnapshot()

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers.Cookie).toBe('fp=abc123; session=xyz789')
    expect(headers['User-Agent']).toContain('AIZZZWatch/0.1.0')
  })

  it('supports forked stations with a dedicated balance endpoint and inline group multipliers', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ email: 'user@example.com' }))
      .mockResolvedValueOnce(ok({ credits: 88.8 }))
      .mockResolvedValueOnce(ok([{ id: 12, title: 'Krill Claude', provider: 'anthropic', multiplier: 0.025 }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'not found' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'not found' }), { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new Sub2ApiClient({
      id: 'krill',
      name: 'Krill',
      baseUrl: 'https://www.krill-ai.com',
      apiBaseUrl: 'https://www.krill-ai.com',
      accessToken: 'secret',
      apiPaths: {
        profile: '/api/auth/me',
        balance: '/api/credits',
        groups: '/api/my/channels'
      }
    })
    const result = await client.fetchSnapshot()

    expect(result).toMatchObject({ health: 'healthy', balance: 88.8 })
    expect(result.groups[0]).toMatchObject({ name: 'Krill Claude', platform: 'anthropic', rateMultiplier: 0.025 })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://www.krill-ai.com/api/auth/me',
      'https://www.krill-ai.com/api/credits',
      'https://www.krill-ai.com/api/my/channels',
      'https://www.krill-ai.com/groups/rates',
      'https://www.krill-ai.com/channels/available'
    ])
  })

  it('uses Shark auth profile balance endpoint when no custom balance path is saved', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('<html>login</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
      .mockResolvedValueOnce(ok({ credits: 56.78 }))
      .mockResolvedValueOnce(ok([{ id: 12, name: 'Shark Claude', platform: 'anthropic', rate_multiplier: 0.025 }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'not found' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'not found' }), { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new Sub2ApiClient({
      id: 'shark',
      name: '鲨鱼辣椒',
      baseUrl: 'https://shayulajiao.xyz/api/v1',
      accessToken: 'secret'
    }).fetchSnapshot()

    expect(result).toMatchObject({ health: 'healthy', balance: 56.78 })
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain('https://shayulajiao.xyz/api/v1/auth/me?timezone=Asia%2FShanghai')
    const balanceCall = fetchMock.mock.calls.find(([url]) => url === 'https://shayulajiao.xyz/api/v1/auth/me?timezone=Asia%2FShanghai')
    expect(balanceCall?.[1]?.headers).toMatchObject({ Referer: 'https://shayulajiao.xyz/keys' })
  })

  it('loads forked source keys when a key list path is configured', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ balance: 10 }))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok([{ id: 3, name: 'Claude', platform: 'anthropic', rate_multiplier: 0.8 }]))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok([{ id: 101, name: 'Team Key', api_key: 'source-key-not-rendered', status: 'active', group_ids: [3], created_at: '2026-07-20T00:00:00Z' }]))
      .mockResolvedValueOnce(ok([]))
    vi.stubGlobal('fetch', fetchMock)

    const client = new Sub2ApiClient({
      id: 'keys',
      name: 'Key Station',
      baseUrl: 'https://shayulajiao.xyz/api/v1',
      accessToken: 'secret',
      apiPaths: {
        keys: '/keys?page=1&page_size=100&status=active&sort_by=created_at&sort_order=desc&timezone=Asia%2FShanghai'
      }
    })

    const result = await client.fetchSnapshot()

    expect(result.sourceKeys).toEqual([
      expect.objectContaining({
        id: '101',
        label: 'Team Key',
        status: 'active',
        groupIds: [3],
        groupNames: [],
        createdAt: '2026-07-20T00:00:00.000Z'
      })
    ])
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain('https://shayulajiao.xyz/api/v1/keys?page=1&page_size=100&status=active&sort_by=created_at&sort_order=desc&timezone=Asia%2FShanghai')
    expect(result.sourceKeys?.[0]).not.toHaveProperty('api_key')
    expect(result.sourceKeyReadState).toBe('available')
    expect(client.getSourceKeyCredentials()).toEqual(new Map([['101', 'source-key-not-rendered']]))
  })

  it('keeps a prior Key list as stale when the optional Key endpoint temporarily fails', async () => {
    const previous = {
      stationId: 'keys', stationName: 'Key Station', health: 'healthy' as const, balance: 10, currency: 'USD' as const,
      groups: [{ id: 3, name: 'Claude', platform: 'anthropic', rateMultiplier: 0.8, pricingAvailable: false }],
      sourceKeys: [{ id: '101', label: 'Team Key', groupIds: [3], groupNames: ['Claude'] }],
      sourceKeyReadState: 'available' as const, accounts: [], priceCapability: 'missing' as const
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ balance: 10 }))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok([{ id: 3, name: 'Claude', platform: 'anthropic', rate_multiplier: 0.8 }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'temporary failure' }), { status: 503 }))
      .mockResolvedValueOnce(ok([]))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new Sub2ApiClient({
      id: 'keys', name: 'Key Station', baseUrl: 'https://relay.example.com/api/v1', accessToken: 'secret', apiPaths: { keys: '/keys' }
    }).fetchSnapshot(previous)

    expect(result).toMatchObject({ health: 'healthy', sourceKeyReadState: 'stale' })
    expect(result.sourceKeys).toEqual(previous.sourceKeys)
  })

  it('maps forked read payloads without exposing source-key credentials', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ data: { wallet: { credits: '70.949198' } } }))
      .mockResolvedValueOnce(ok({ data: { items: [{ gid: '7', title: 'Claude', provider: { name: 'anthropic' }, ratio: '0.025' }] } }))
      .mockResolvedValueOnce(ok({ data: { items: [{ source_group: '7', multiplier: '0.02' }] } }))
      .mockResolvedValueOnce(ok({ data: { items: [{ key_id: 'k-7', label: 'Claude key', groups: ['7'], api_key: 'must-not-leak' }] } }))
      .mockResolvedValueOnce(ok({ data: { items: [{ group: '7', model: { name: 'claude-sonnet' }, price: { input: '0.003', output: '0.015' } }] } }))
    vi.stubGlobal('fetch', fetchMock)

    const mapping = {
      version: 1 as const,
      template: 'custom' as const,
      capabilities: {
        profile: { objectPath: 'data.wallet', fields: { balance: 'credits' } },
        groups: { recordsPath: 'data.items', fields: { id: 'gid', name: 'title', platform: 'provider.name', rateMultiplier: 'ratio' } },
        rates: { recordsPath: 'data.items', recordMode: 'list' as const, fields: { groupId: 'source_group', rateMultiplier: 'multiplier' } },
        channels: { recordsPath: 'data.items', fields: { groupId: 'group', modelName: 'model.name', inputPrice: 'price.input', outputPrice: 'price.output' } },
        keys: { recordsPath: 'data.items', fields: { id: 'key_id', name: 'label', groupIds: 'groups' } }
      }
    }
    const client = new Sub2ApiClient({
      id: 'mapped', name: 'Mapped', baseUrl: 'https://relay.example.com/api/v1', accessToken: 'secret',
      apiPaths: { keys: '/keys' }, readMapping: mapping
    })
    const snapshot = await client.fetchSnapshot()

    expect(snapshot).toMatchObject({ health: 'healthy', balance: 70.949198 })
    expect(snapshot.groups).toEqual([expect.objectContaining({ id: 7, name: 'Claude', platform: 'anthropic', rateMultiplier: 0.025, userRateMultiplier: 0.02, pricingAvailable: true })])
    expect(snapshot.sourceKeys).toEqual([expect.objectContaining({ id: 'k-7', label: 'Claude key', groupIds: [7] })])
    expect(JSON.stringify(snapshot)).not.toContain('must-not-leak')
    expect(client.getSourceKeyCredentials()).toBeUndefined()
  })

  it('marks a mapping preview partial when a required field path has no value', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok({ data: { items: [{ gid: 7, title: 'Claude' }] } }))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok([]))
    vi.stubGlobal('fetch', fetchMock)

    const preview = await new Sub2ApiClient({
      id: 'preview', name: 'Preview', baseUrl: 'https://relay.example.com/api/v1', accessToken: 'secret',
      readMapping: {
        version: 1,
        template: 'custom',
        capabilities: { groups: { recordsPath: 'data.items', fields: { id: 'missing.id', name: 'title' } } }
      }
    }).previewReadMapping()

    expect(preview.capabilities.find((item) => item.capability === 'groups')).toMatchObject({ state: 'partial', records: 1, detail: '必填字段未配置或未解析到值' })
  })
})
