import { describe, expect, it, vi } from 'vitest'
import { buildBoundedCookieHeader, collectWebAuthApiBaseUrls, isBoundedCookieHeader, isNewApiCookieSessionPage, isNewApiWebAuthContract, isWebAuthLoginRouteNotFound, readWebAuthProbeSnapshot, resolveNewApiProfileUrl, resolveNewApiRefreshUrl, resolveWebAuthApiBaseUrl, resolveWebAuthApiPaths, resolveWebAuthCookieUrl, resolveWebAuthLaunchTarget, tryRestoreNewApiSession, tryRestoreNewApiSessionFromPage, tryRestoreWebAuthSession, tryVerifyNewApiCookieSession } from '../src/main/web-auth'
import { webAuthErrorText } from '../src/renderer/src/App'

describe('web auth helpers', () => {
  it('collects api base url candidates from the page config and login origin', () => {
    expect(collectWebAuthApiBaseUrls({
      loginPageUrl: 'https://lcodex.cc/login',
      normalizedBaseUrl: 'https://lcodex.cc/api/v1',
      pageApiBaseUrl: 'https://api.lcodex.cc'
    })).toEqual([
      'https://api.lcodex.cc',
      'https://lcodex.cc',
      'https://lcodex.cc/api/v1'
    ])
  })

  it('reads lcodex session storage credentials from the login page', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({
      pageApiBaseUrl: 'https://api.lcodex.cc',
      sessionAccessToken: 'probe-token',
      sessionRefreshToken: 'probe-refresh'
    })

    await expect(readWebAuthProbeSnapshot({
      webContents: {
        executeJavaScript,
        getURL: () => 'https://lcodex.cc/login',
        getUserAgent: () => 'test-agent'
      }
    })).resolves.toMatchObject({
      pageApiBaseUrl: 'https://api.lcodex.cc',
      accessToken: 'probe-token',
      refreshToken: 'probe-refresh'
    })
  })

  it('uses lcodex root-page routing and management endpoints', () => {
    expect(resolveWebAuthLaunchTarget('https://lcodex.cc/api/v1')).toEqual({
      loadUrl: 'https://lcodex.cc',
      clientRoute: '/login'
    })
    expect(resolveWebAuthApiBaseUrl({
      normalizedBaseUrl: 'https://lcodex.cc/api/v1',
      inputApiBaseUrl: 'https://api.lcodex.cc',
      pageApiBaseUrl: 'https://api.lcodex.cc'
    })).toBe('https://lcodex.cc')
    expect(resolveWebAuthApiPaths('https://lcodex.cc/api/v1', {
      channels: '/channels/available'
    })).toEqual({ channels: '/api/v1/channels/available' })
  })

  it('prefers the current NewAPI sign-in route while retaining the legacy fallback', () => {
    expect(resolveWebAuthLaunchTarget('https://newapi.example.com', true)).toEqual({
      loadUrl: 'https://newapi.example.com/sign-in',
      fallbackUrl: 'https://newapi.example.com/login'
    })
    expect(resolveWebAuthLaunchTarget('https://relay.example.com/api/v1')).toEqual({
      loadUrl: 'https://relay.example.com/login',
      fallbackUrl: 'https://relay.example.com/sign-in'
    })
  })

  it('recognizes only a same-origin candidate-page SPA 404 as eligible for a route fallback', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue('404\n糟糕！页面未找到！\n您要查找的页面似乎不存在或可能已被移除。')
    const loginWindow = {
      webContents: {
        executeJavaScript,
        getURL: () => 'https://nihao.dog/login',
        getUserAgent: () => 'test-agent'
      }
    }
    await expect(isWebAuthLoginRouteNotFound(loginWindow, 'https://nihao.dog/login')).resolves.toBe(true)

    loginWindow.webContents.getURL = () => 'https://oauth.example.com/login'
    await expect(isWebAuthLoginRouteNotFound(loginWindow, 'https://nihao.dog/login')).resolves.toBe(false)
    expect(executeJavaScript).toHaveBeenCalledTimes(1)
  })

  it('renders a missing-route error distinctly from a user-cancelled authorization', () => {
    expect(webAuthErrorText(new Error('AUTH_CANCELLED'))).toBe('已取消网页登录授权')
    expect(webAuthErrorText(new Error('AUTH_LOGIN_ROUTE_NOT_FOUND:/sign-in,/login'))).toContain('已尝试 /sign-in、/login')
    expect(webAuthErrorText(new Error('AUTH_NEWAPI_SESSION_NOT_CAPTURED'))).toContain('未能保存可用的 NewAPI 会话')
  })

  it('keeps individual storage token aliases for JWT preference resolution', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({
      accessToken: 'csrf-token',
      token: 'csrf-token',
      jwt: 'jwt-token'
    })

    await expect(readWebAuthProbeSnapshot({
      webContents: {
        executeJavaScript,
        getURL: () => 'https://relay.example.com/login',
        getUserAgent: () => 'test-agent'
      }
    })).resolves.toMatchObject({
      accessToken: 'csrf-token',
      token: 'csrf-token',
      jwt: 'jwt-token'
    })
  })

  it('restores a web auth session with client id, cookies and user agent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: {
        authenticated: true,
        access_token: 'restored-jwt',
        expires_in: 3600,
        refresh_token: 'next-refresh'
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))

    await expect(tryRestoreWebAuthSession({
      fetchImpl: fetchMock,
      apiBaseUrl: 'https://api.lcodex.cc',
      authClientId: 'client-123',
      cookies: [{ name: 'krill_jwt', value: 'cookie-jwt' }, { name: '_kfp', value: 'fingerprint' }],
      userAgent: 'AIZZZWatch/1.0'
    })).resolves.toEqual({
      accessToken: 'restored-jwt',
      refreshToken: 'next-refresh'
    })

    expect(fetchMock).toHaveBeenCalledWith('https://api.lcodex.cc/auth/session/restore', expect.objectContaining({
      method: 'POST',
      body: '{}',
      headers: expect.objectContaining({
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Sub2API-Auth-Client': 'client-123',
        Cookie: 'krill_jwt=cookie-jwt; _kfp=fingerprint',
        'User-Agent': 'AIZZZWatch/1.0'
      })
    }))
  })

  it('refuses to forward a malformed cookie as a session-restore header instead of sending it unvalidated', async () => {
    const fetchMock = vi.fn()
    await expect(tryRestoreWebAuthSession({
      fetchImpl: fetchMock,
      apiBaseUrl: 'https://api.lcodex.cc',
      authClientId: 'client-123',
      cookies: [{ name: 'krill_jwt', value: 'bad\r\nheader' }],
      userAgent: 'AIZZZWatch/1.0'
    })).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('restores a NewAPI browser session from its HttpOnly refresh cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { access_token: 'newapi-restored-jwt' }
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'new_api_refresh=rotated-refresh; Path=/api/user/auth; HttpOnly'
      }
    }))

    await expect(tryRestoreNewApiSession({
      fetchImpl: fetchMock,
      apiBaseUrl: 'https://newapi.example.com/api/v1',
      cookies: [{ name: 'theme', value: 'dark' }, { name: 'new_api_refresh', value: 'refresh-opaque' }],
      userAgent: 'AIZZZWatch/1.0'
    })).resolves.toEqual({ accessToken: 'newapi-restored-jwt', sessionCookie: 'theme=dark; new_api_refresh=rotated-refresh' })

    expect(fetchMock).toHaveBeenCalledWith('https://newapi.example.com/api/user/auth/refresh', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Origin: 'https://newapi.example.com',
        Referer: 'https://newapi.example.com/',
        Cookie: 'theme=dark; new_api_refresh=refresh-opaque',
        'User-Agent': 'AIZZZWatch/1.0'
      })
    }))
  })

  it('refuses to forward a malformed NewAPI cookie as a refresh header instead of sending it unvalidated', async () => {
    const fetchMock = vi.fn()
    await expect(tryRestoreNewApiSession({
      fetchImpl: fetchMock,
      apiBaseUrl: 'https://newapi.example.com/api/v1',
      cookies: [{ name: 'new_api_refresh', value: 'bad\r\nheader' }],
      userAgent: 'AIZZZWatch/1.0'
    })).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the isolated authorization session instead of copying its Cookie header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { access_token: 'newapi-restored-jwt' }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))

    await expect(tryRestoreNewApiSession({
      fetchImpl: fetchMock,
      apiBaseUrl: 'https://newapi.example.com',
      cookies: [{ name: 'new_api_refresh', value: 'refresh-opaque' }],
      userAgent: 'AIZZZWatch/1.0',
      useSessionCredentials: true
    })).resolves.toEqual({ accessToken: 'newapi-restored-jwt' })

    expect(fetchMock).toHaveBeenCalledWith('https://newapi.example.com/api/user/auth/refresh', expect.objectContaining({
      credentials: 'include',
      headers: expect.not.objectContaining({ Cookie: expect.any(String) })
    }))
  })

  it('recovers a NewAPI session only from a logged-in same-origin page and returns the whitelisted token', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({ accessToken: 'page-restored-jwt' })
    await expect(tryRestoreNewApiSessionFromPage({
      loginWindow: {
        webContents: {
          executeJavaScript,
          getURL: () => 'https://newapi.example.com/dashboard',
          getUserAgent: () => 'test-agent'
        }
      },
      apiBaseUrl: 'https://newapi.example.com/api/v1'
    })).resolves.toEqual({ accessToken: 'page-restored-jwt' })

    const script = executeJavaScript.mock.calls[0][0] as string
    expect(script).toContain('https://newapi.example.com/api/user/auth/refresh')
    expect(script).toContain("credentials: 'include'")
    expect(script).toContain("redirect: 'manual'")
    expect(script).toContain("payload.success === true")
    expect(script).toContain("typeof data.access_token === 'string'")
  })

  it('does not invoke page recovery on login, non-HTTPS, or cross-origin pages', async () => {
    const executeJavaScript = vi.fn()
    const createLoginWindow = (url: string) => ({
      webContents: { executeJavaScript, getURL: () => url, getUserAgent: () => 'test-agent' }
    })
    await expect(tryRestoreNewApiSessionFromPage({
      loginWindow: createLoginWindow('https://newapi.example.com/sign-in'),
      apiBaseUrl: 'https://newapi.example.com'
    })).resolves.toBeUndefined()
    await expect(tryRestoreNewApiSessionFromPage({
      loginWindow: createLoginWindow('https://other.example.com/dashboard'),
      apiBaseUrl: 'https://newapi.example.com'
    })).resolves.toBeUndefined()
    await expect(tryRestoreNewApiSessionFromPage({
      loginWindow: createLoginWindow('http://newapi.example.com/dashboard'),
      apiBaseUrl: 'http://newapi.example.com'
    })).resolves.toBeUndefined()
    expect(executeJavaScript).not.toHaveBeenCalled()
  })

  it('does not accept a page recovery result without a bounded token field', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({ accessToken: 'x'.repeat(16 * 1024 + 1) })
    await expect(tryRestoreNewApiSessionFromPage({
      loginWindow: {
        webContents: {
          executeJavaScript,
          getURL: () => 'https://newapi.example.com/dashboard',
          getUserAgent: () => 'test-agent'
        }
      },
      apiBaseUrl: 'https://newapi.example.com'
    })).resolves.toBeUndefined()
  })

  it('degrades safely when the page is navigating during session recovery', async () => {
    const executeJavaScript = vi.fn().mockRejectedValue(new Error('Execution context was destroyed'))
    await expect(tryRestoreNewApiSessionFromPage({
      loginWindow: {
        webContents: {
          executeJavaScript,
          getURL: () => 'https://newapi.example.com/dashboard',
          getUserAgent: () => 'test-agent'
        }
      },
      apiBaseUrl: 'https://newapi.example.com'
    })).resolves.toBeUndefined()
  })

  it('rejects a non-standard NewAPI refresh response without exposing another token field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { accessToken: 'not-an-auth-bundle-token' }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))

    await expect(tryRestoreNewApiSession({
      fetchImpl: fetchMock,
      apiBaseUrl: 'https://newapi.example.com',
      cookies: [{ name: 'new_api_refresh', value: 'refresh-opaque' }],
      userAgent: 'AIZZZWatch/1.0'
    })).resolves.toBeUndefined()
  })

  it('selects NewAPI restoration only for the explicit or detected NewAPI contract', () => {
    expect(isNewApiWebAuthContract({ adapterType: 'newapi' })).toBe(true)
    expect(isNewApiWebAuthContract({ adapterType: 'auto', detectedAdapterType: 'newapi' })).toBe(true)
    expect(isNewApiWebAuthContract({ adapterType: 'sub2api' })).toBe(false)
  })

  it('queries the NewAPI refresh-cookie path instead of the site root', () => {
    expect(resolveWebAuthCookieUrl('https://newapi.example.com/api/v1', true)).toBe('https://newapi.example.com/api/user/auth/refresh')
    expect(resolveWebAuthCookieUrl('https://relay.example.com/api/v1', false)).toBe('https://relay.example.com/api/v1')
  })

  it('resolves the fixed OneAPI profile endpoint independently of the refresh endpoint', () => {
    expect(resolveNewApiProfileUrl('https://nihao.dog/api/v1')).toBe('https://nihao.dog/api/user/self')
    expect(resolveNewApiProfileUrl('https://nihao.dog', '/panel/user/self')).toBe('https://nihao.dog/panel/user/self')
  })

  it('marks a missing NewAPI refresh route as unsupported without treating it as a token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('not found', { status: 404, headers: { 'Content-Type': 'text/plain' } }))
    await expect(tryRestoreNewApiSession({
      fetchImpl: fetchMock,
      apiBaseUrl: 'https://nihao.dog',
      cookies: [],
      userAgent: 'test-agent',
      useSessionCredentials: true
    })).resolves.toEqual({ authRefreshUnsupported: true })
  })

  it('verifies a legacy OneAPI Cookie session through the fixed profile endpoint without returning profile data', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({ verified: true, selectedUserId: '42' })
    const result = await tryVerifyNewApiCookieSession({
      loginWindow: {
        webContents: {
          executeJavaScript,
          getURL: () => 'https://nihao.dog/dashboard',
          getUserAgent: () => 'test-agent'
        }
      },
      apiBaseUrl: 'https://nihao.dog'
    })

    expect(result).toEqual({ verified: true, selectedUserId: '42' })
    const script = executeJavaScript.mock.calls[0][0] as string
    expect(script).toContain('https://nihao.dog/api/user/self')
    expect(script).toContain("credentials: 'include'")
    expect(script).toContain('payload.success === true')
    expect(script).toContain("localStorage.getItem('uid')")
    expect(script).toContain("'New-Api-User': selectedUserId")
    expect(script).not.toContain("localStorage.getItem('user')")
    expect(script).not.toContain('access_token')
  })

  it('distinguishes a logged-in NewAPI page from its login routes before Cookie-session capture', () => {
    const windowFor = (url: string) => ({
      webContents: { executeJavaScript: vi.fn(), getURL: () => url, getUserAgent: () => 'test-agent' }
    })
    expect(isNewApiCookieSessionPage({ loginWindow: windowFor('https://nihao.dog/dashboard'), apiBaseUrl: 'https://nihao.dog' })).toBe(true)
    expect(isNewApiCookieSessionPage({ loginWindow: windowFor('https://nihao.dog/sign-in'), apiBaseUrl: 'https://nihao.dog' })).toBe(false)
    expect(isNewApiCookieSessionPage({ loginWindow: windowFor('https://other.example/dashboard'), apiBaseUrl: 'https://nihao.dog' })).toBe(false)
  })

  it('does not verify a Cookie session on login, insecure, cross-origin, or failed page verification', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({ verified: false })
    const windowFor = (url: string) => ({
      webContents: { executeJavaScript, getURL: () => url, getUserAgent: () => 'test-agent' }
    })
    await expect(tryVerifyNewApiCookieSession({ loginWindow: windowFor('https://nihao.dog/sign-in'), apiBaseUrl: 'https://nihao.dog' })).resolves.toEqual({ verified: false })
    await expect(tryVerifyNewApiCookieSession({ loginWindow: windowFor('http://nihao.dog/dashboard'), apiBaseUrl: 'http://nihao.dog' })).resolves.toEqual({ verified: false })
    await expect(tryVerifyNewApiCookieSession({ loginWindow: windowFor('https://other.example/dashboard'), apiBaseUrl: 'https://nihao.dog' })).resolves.toEqual({ verified: false })
    expect(executeJavaScript).not.toHaveBeenCalled()

    await expect(tryVerifyNewApiCookieSession({ loginWindow: windowFor('https://nihao.dog/dashboard'), apiBaseUrl: 'https://nihao.dog' })).resolves.toEqual({ verified: false })
    expect(executeJavaScript).toHaveBeenCalledTimes(1)
  })

  it('keeps only a bounded numeric selected-user context in the main process result', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({ verified: true, selectedUserId: 'not-a-user-id' })
    await expect(tryVerifyNewApiCookieSession({
      loginWindow: {
        webContents: {
          executeJavaScript,
          getURL: () => 'https://nihao.dog/dashboard',
          getUserAgent: () => 'test-agent'
        }
      },
      apiBaseUrl: 'https://nihao.dog'
    })).resolves.toEqual({ verified: true })
  })

  it('bounds browser Cookie data before it becomes a main-process request header', () => {
    expect(buildBoundedCookieHeader([{ name: 'oneapi_session', value: 'opaque-cookie' }])).toBe('oneapi_session=opaque-cookie')
    expect(isBoundedCookieHeader('oneapi_session=opaque-cookie')).toBe(true)
    expect(buildBoundedCookieHeader([{ name: 'oneapi_session', value: 'bad\r\nheader' }])).toBeUndefined()
    expect(isBoundedCookieHeader('oneapi_session=bad\r\nheader')).toBe(false)
  })

  it('uses a same-origin NewAPI refresh-path override for browser-session recovery', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { access_token: 'custom-restored-jwt' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))

    expect(resolveNewApiRefreshUrl('https://newapi.example.com/api/v1', '/panel/auth/refresh')).toBe('https://newapi.example.com/panel/auth/refresh')
    expect(resolveWebAuthCookieUrl('https://newapi.example.com/api/v1', true, '/panel/auth/refresh')).toBe('https://newapi.example.com/panel/auth/refresh')
    await expect(tryRestoreNewApiSession({
      fetchImpl: fetchMock,
      apiBaseUrl: 'https://newapi.example.com/api/v1',
      authRefreshPath: '/panel/auth/refresh',
      cookies: [{ name: 'new_api_refresh', value: 'refresh-opaque' }],
      userAgent: 'AIZZZWatch/1.0'
    })).resolves.toEqual({ accessToken: 'custom-restored-jwt' })
    expect(fetchMock).toHaveBeenCalledWith('https://newapi.example.com/panel/auth/refresh', expect.anything())
  })
})
