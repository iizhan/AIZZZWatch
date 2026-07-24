import { describe, expect, it, vi } from 'vitest'
import { NewApiClient } from '../src/main/newapi-client'
import { resolveStationAdapterType, usesSub2ApiContract } from '../src/main/station-adapter'

function ok(data: unknown, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ success: true, data, ...extra }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('NewApiClient', () => {
  it('normalizes user groups, fixed prices, and token groups without exposing keys', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ quota: 100, used_quota: 24, username: 'owner' }))
      .mockResolvedValueOnce(ok({ default: { ratio: 0.8, desc: '标准用户组' }, pro: { ratio: 0.5, desc: '高级用户组' }, auto: { ratio: '自动' } }))
      .mockResolvedValueOnce(ok([
        { model_name: 'gpt-4.1', quota_type: 0, model_ratio: 0.0025, completion_ratio: 2, enable_groups: ['default', 'pro', 'private-only'] },
        { model_name: 'dall-e-3', quota_type: 1, model_price: 0.08, enable_groups: ['pro'] },
        { model_name: 'tiered-model', quota_type: 0, model_ratio: 0.001, completion_ratio: 2, billing_expr: 'tiered expression', enable_groups: ['default'] }
      ], { group_ratio: { default: 0.75, pro: 0.4, 'private-only': 0.1 }, usable_group: { default: '标准用户组', pro: '高级用户组', 'private-only': '未授予当前用户' } }))
      .mockResolvedValueOnce(ok({ items: [{ id: 9, name: 'primary token', group: 'pro', key: 'must-not-leave-main' }] }))

    const result = await new NewApiClient({
      id: 'newapi',
      name: 'NewAPI',
      baseUrl: 'https://newapi.example.com',
      accessToken: 'opaque-token',
      fetchImpl: fetchMock
    }).fetchSnapshot()

    const defaultGroup = result.groups.find((group) => group.name === 'default')
    const proGroup = result.groups.find((group) => group.name === 'pro')
    expect(result).toMatchObject({ health: 'healthy', balance: 100, priceCapability: 'available', sourceKeyReadState: 'available' })
    expect(result.groups.map((group) => group.name)).toEqual(['default', 'pro'])
    expect(result.groups.find((group) => group.name === 'private-only')).toBeUndefined()
    expect(defaultGroup).toMatchObject({ rateMultiplier: 0.75, userRateMultiplier: 0.75, pricingHint: '标准用户组', pricingAvailable: true })
    expect(defaultGroup?.pricingModels).toEqual(expect.arrayContaining([
      { name: 'gpt-4.1', inputPrice: 0.005, outputPrice: 0.01 },
      { name: 'tiered-model' }
    ]))
    expect(proGroup).toMatchObject({ rateMultiplier: 0.4, pricingAvailable: true })
    expect(proGroup?.pricingModels).toEqual(expect.arrayContaining([{ name: 'dall-e-3', perRequestPrice: 0.08 }]))
    expect(result.sourceKeys).toEqual([expect.objectContaining({ id: '9', label: 'primary token', groupIds: [proGroup?.id], groupNames: ['pro'] })])
    expect(JSON.stringify(result)).not.toContain('must-not-leave-main')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://newapi.example.com/api/user/self',
      'https://newapi.example.com/api/user/self/groups',
      'https://newapi.example.com/api/pricing',
      'https://newapi.example.com/api/token/?p=0&size=100'
    ])
  })

  it('keeps the prior token list as stale when the optional token endpoint is unavailable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ quota: 10 }))
      .mockResolvedValueOnce(ok({ default: { ratio: 1 } }))
      .mockResolvedValueOnce(ok([{ model_name: 'gpt-4.1', quota_type: 0, model_ratio: 0.002, completion_ratio: 1, enable_groups: ['default'] }], { group_ratio: { default: 1 } }))
      .mockResolvedValueOnce(new Response('not found', { status: 404, headers: { 'Content-Type': 'text/plain' } }))

    const result = await new NewApiClient({
      id: 'newapi-stale', name: 'NewAPI', baseUrl: 'https://newapi.example.com', accessToken: 'opaque-token', fetchImpl: fetchMock
    }).fetchSnapshot({
      stationId: 'newapi-stale', stationName: 'NewAPI', health: 'healthy', balance: 9, currency: 'USD', groups: [],
      sourceKeys: [{ id: 'old', label: 'previous', groupIds: [], groupNames: [] }], sourceKeyReadState: 'available', accounts: [], priceCapability: 'available'
    })

    expect(result).toMatchObject({ sourceKeyReadState: 'stale', sourceKeys: [{ id: 'old' }] })
  })

  it('uses the detected type for automatic stations and never gives NewAPI the Sub2API contract', () => {
    expect(resolveStationAdapterType({ adapterType: 'auto', detectedAdapterType: 'newapi' })).toBe('newapi')
    expect(usesSub2ApiContract({ adapterType: 'auto', detectedAdapterType: 'newapi' })).toBe(false)
    expect(resolveStationAdapterType({ adapterType: 'custom' })).toBe('custom')
  })

  it('honors same-origin NewAPI endpoint overrides', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ quota: 10 }))
      .mockResolvedValueOnce(ok({ standard: { ratio: 1 } }))
      .mockResolvedValueOnce(ok([], { group_ratio: { standard: 1 } }))
      .mockResolvedValueOnce(ok([]))

    await new NewApiClient({
      id: 'newapi-custom',
      name: 'NewAPI Custom',
      baseUrl: 'https://newapi.example.com',
      accessToken: 'opaque-token',
      apiPaths: { profile: '/panel/user', groups: '/panel/groups', keys: '/panel/tokens', channels: '/panel/pricing' },
      fetchImpl: fetchMock
    }).fetchSnapshot()

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://newapi.example.com/panel/user',
      'https://newapi.example.com/panel/groups',
      'https://newapi.example.com/panel/pricing',
      'https://newapi.example.com/panel/tokens'
    ])
  })

  it('refreshes a NewAPI access token and keeps a rotated session cookie in main process code', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { access_token: 'renewed-token' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'new_api_refresh=rotated-cookie; Path=/api/user/auth; HttpOnly' }
    }))
    await expect(new NewApiClient({
      id: 'newapi-refresh', name: 'NewAPI', baseUrl: 'https://newapi.example.com', accessToken: 'old-token', sessionCookie: 'new_api_refresh=opaque', fetchImpl: fetchMock
    }).refreshAccessToken()).resolves.toEqual({ accessToken: 'renewed-token', sessionCookie: 'new_api_refresh=rotated-cookie' })

    expect(fetchMock).toHaveBeenCalledWith('https://newapi.example.com/api/user/auth/refresh', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Cookie: 'new_api_refresh=opaque', Authorization: 'Bearer old-token', Origin: 'https://newapi.example.com' })
    }))
  })
})
