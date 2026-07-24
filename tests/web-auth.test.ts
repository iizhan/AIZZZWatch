import { describe, expect, it, vi } from 'vitest'
import { collectWebAuthApiBaseUrls, isNewApiWebAuthContract, readWebAuthProbeSnapshot, resolveNewApiRefreshUrl, resolveWebAuthApiBaseUrl, resolveWebAuthApiPaths, resolveWebAuthCookieUrl, resolveWebAuthLaunchTarget, tryRestoreNewApiSession, tryRestoreWebAuthSession } from '../src/main/web-auth'

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

  it('selects NewAPI restoration only for the explicit or detected NewAPI contract', () => {
    expect(isNewApiWebAuthContract({ adapterType: 'newapi' })).toBe(true)
    expect(isNewApiWebAuthContract({ adapterType: 'auto', detectedAdapterType: 'newapi' })).toBe(true)
    expect(isNewApiWebAuthContract({ adapterType: 'sub2api' })).toBe(false)
  })

  it('queries the NewAPI refresh-cookie path instead of the site root', () => {
    expect(resolveWebAuthCookieUrl('https://newapi.example.com/api/v1', true)).toBe('https://newapi.example.com/api/user/auth/refresh')
    expect(resolveWebAuthCookieUrl('https://relay.example.com/api/v1', false)).toBe('https://relay.example.com/api/v1')
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
