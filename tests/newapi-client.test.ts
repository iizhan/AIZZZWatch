import { describe, expect, it, vi } from 'vitest'
import { NewApiClient } from '../src/main/newapi-client'
import { resolveStationAdapterType, usesSub2ApiContract } from '../src/main/station-adapter'

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('NewApiClient', () => {
  it('reads only NewAPI user, token, and model endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ quota: 100, used_quota: 24, username: 'owner' }))
      .mockResolvedValueOnce(ok({ items: [{ id: 9, name: 'primary token', key: 'must-not-leave-main' }] }))
      .mockResolvedValueOnce(ok(['gpt-4.1']))

    const result = await new NewApiClient({
      id: 'newapi',
      name: 'NewAPI',
      baseUrl: 'https://newapi.example.com',
      accessToken: 'opaque-token',
      fetchImpl: fetchMock
    }).fetchSnapshot()

    expect(result).toMatchObject({ health: 'healthy', balance: 76, groups: [], priceCapability: 'missing' })
    expect(result.sourceKeys).toEqual([expect.objectContaining({ id: '9', label: 'primary token' })])
    expect(JSON.stringify(result)).not.toContain('must-not-leave-main')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://newapi.example.com/api/user/self',
      'https://newapi.example.com/api/token/?p=0&size=100',
      'https://newapi.example.com/api/models'
    ])
  })

  it('uses the detected type for automatic stations and never gives NewAPI the Sub2API contract', () => {
    expect(resolveStationAdapterType({ adapterType: 'auto', detectedAdapterType: 'newapi' })).toBe('newapi')
    expect(usesSub2ApiContract({ adapterType: 'auto', detectedAdapterType: 'newapi' })).toBe(false)
    expect(resolveStationAdapterType({ adapterType: 'custom' })).toBe('custom')
  })

  it('honors same-origin NewAPI endpoint overrides', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ quota: 10 }))
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([]))

    await new NewApiClient({
      id: 'newapi-custom',
      name: 'NewAPI Custom',
      baseUrl: 'https://newapi.example.com',
      accessToken: 'opaque-token',
      apiPaths: { profile: '/panel/user', keys: '/panel/tokens', channels: '/panel/models' },
      fetchImpl: fetchMock
    }).fetchSnapshot()

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://newapi.example.com/panel/user',
      'https://newapi.example.com/panel/tokens',
      'https://newapi.example.com/panel/models'
    ])
  })
})
