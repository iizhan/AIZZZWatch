import { afterEach, describe, expect, it, vi } from 'vitest'
import { diagnoseStation } from '../src/main/station-diagnostics'

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('station diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('probes a manually recorded api base url and keeps custom paths', async () => {
    const fetchMock = vi.fn((url: string | URL) => {
      const target = String(url)
      if (target.includes('https://krill-ai.com/custom-api/profile')) return Promise.resolve(ok({ balance: 7 }))
      return Promise.resolve(new Response('not found', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await diagnoseStation({
      name: 'Krill',
      baseUrl: 'https://krill-ai.com',
      apiBaseUrl: 'https://krill-ai.com/custom-api',
      apiPaths: { profile: '/profile' }
    })

    expect(fetchMock).toHaveBeenCalledWith('https://krill-ai.com/custom-api/profile', expect.any(Object))
    expect(result.apiVariant).toBe('fork')
    expect(result.probes.find((probe) => probe.name === '用户信息')).toMatchObject({ ok: true, path: '/profile' })
    expect(result.suggestedPaths.profile).toBe('/profile')
  })

  it('probes a configured source key endpoint when present', async () => {
    const fetchMock = vi.fn((url: string | URL) => {
      const target = String(url)
      if (target.includes('/keys?page=1')) return Promise.resolve(ok([{ id: 1, name: 'Key A' }]))
      return Promise.resolve(new Response('not found', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await diagnoseStation({
      name: 'Keys Station',
      baseUrl: 'https://shayulajiao.xyz',
      apiPaths: { keys: '/keys?page=1&page_size=100&status=active&sort_by=created_at&sort_order=desc&timezone=Asia%2FShanghai' }
    })

    expect(result.probes.find((probe) => probe.name === '密钥列表')).toMatchObject({ ok: true, path: '/keys?page=1&page_size=100&status=active&sort_by=created_at&sort_order=desc&timezone=Asia%2FShanghai' })
  })

  it('reuses the saved browser session shape for a read-only diagnostic', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({}))
    const result = await diagnoseStation({
      name: '聪明哥',
      baseUrl: 'https://sub2.congmingai.com/api/v1',
      accessToken: 'token',
      sessionCookie: 'session=opaque',
      userAgent: 'AIZZZWatch test UA',
      apiPaths: { groups: '/groups/available' },
      fetchImpl: fetchMock
    })

    expect(result.probes.find((probe) => probe.name === '分组列表')).toMatchObject({ ok: true })
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers.Cookie).toBe('session=opaque')
    expect(headers['User-Agent']).toBe('AIZZZWatch test UA')
    expect(headers.Referer).toBe('https://sub2.congmingai.com/')
  })

  it('probes the aihub user summary endpoint while preserving a manual profile path', async () => {
    const fetchMock = vi.fn((url: string | URL) => {
      const target = String(url)
      if (target === 'https://aihub.top/api/v1/auth/me?timezone=Asia%2FShanghai') return Promise.resolve(ok({ credits: 42.25 }))
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const result = await diagnoseStation({
      name: 'aihub',
      baseUrl: 'https://aihub.top/api/v1',
      apiPaths: { profile: '/user/profile' },
      fetchImpl: fetchMock
    })

    expect(result.probes.find((probe) => probe.name === '用户信息')).toMatchObject({
      ok: true,
      path: '/auth/me?timezone=Asia%2FShanghai'
    })

    const manual = await diagnoseStation({
      name: 'aihub',
      baseUrl: 'https://aihub.top/api/v1',
      apiPaths: { profile: '/custom/profile' },
      fetchImpl: fetchMock
    })
    expect(manual.probes.find((probe) => probe.name === '用户信息')).toMatchObject({ path: '/custom/profile' })
  })

  it('uses lcodex root management endpoints and its versioned price endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({}))
    const result = await diagnoseStation({
      name: 'lcodex',
      baseUrl: 'https://lcodex.cc',
      apiBaseUrl: 'https://api.lcodex.cc',
      fetchImpl: fetchMock
    })

    const calledUrls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(calledUrls).toContain('https://lcodex.cc/user/profile')
    expect(calledUrls).toContain('https://lcodex.cc/groups/available')
    expect(calledUrls).toContain('https://lcodex.cc/groups/rates')
    expect(calledUrls).toContain('https://lcodex.cc/api/v1/channels/available')
    expect(calledUrls).not.toContain('https://lcodex.cc/api/v1/user/profile')
    expect(result.suggestedPaths.channels).toBe('/api/v1/channels/available')
  })

  it('identifies NewAPI from its user endpoint without treating it as a Sub2API group station', async () => {
    const fetchMock = vi.fn((url: string | URL) => {
      const target = String(url)
      if (target === 'https://newapi.example.com/api/user/self') return Promise.resolve(ok({ id: 7, quota: 100 }))
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const result = await diagnoseStation({
      name: 'NewAPI',
      baseUrl: 'https://newapi.example.com',
      adapterType: 'auto',
      fetchImpl: fetchMock
    })

    expect(result).toMatchObject({ apiVariant: 'newapi', detectedAdapterType: 'newapi' })
    expect(result.suggestedPaths).toMatchObject({ profile: '/api/user/self', keys: '/api/token/?p=0&size=100', channels: '/api/models' })
  })
})
