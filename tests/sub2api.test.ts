import {
  applyLcodexApiPathDefaults,
  buildPricingHints,
  classifySub2ApiError,
  normalizeApiBaseUrl,
  normalizeStationApiPaths,
  normalizeGroups,
  pickProfileBalance,
  resolveStationApiRequestUrl,
  resolveStationProfilePath,
  sameNumberSet,
  Sub2ApiError,
  unwrapApiResponse
} from '../src/shared/sub2api'
import { createPreviewApi } from '../src/renderer/src/preview-api'
import { describe, expect, it } from 'vitest'

describe('Sub2API contract helpers', () => {
  it('normalizes station root URLs without duplicating api prefix', () => {
    expect(normalizeApiBaseUrl('https://relay.example.com')).toBe('https://relay.example.com/api/v1')
    expect(normalizeApiBaseUrl('https://relay.example.com/api/v1/')).toBe('https://relay.example.com/api/v1')
  })

  it('rejects unsafe or malformed station URLs', () => {
    expect(() => normalizeApiBaseUrl('file:///tmp/a')).toThrow('HTTP 或 HTTPS')
    expect(() => normalizeApiBaseUrl('not-a-url')).toThrow('有效 URL')
  })

  it('keeps full custom endpoint URLs but limits them to same-origin HTTPS requests', () => {
    expect(normalizeStationApiPaths({ balance: 'https://shayulajiao.xyz/api/credits' })).toEqual({ balance: 'https://shayulajiao.xyz/api/credits' })
    expect(resolveStationApiRequestUrl('https://shayulajiao.xyz/api/v1', 'https://shayulajiao.xyz/api/credits')).toBe('https://shayulajiao.xyz/api/credits')
    expect(() => resolveStationApiRequestUrl('https://shayulajiao.xyz/api/v1', 'http://shayulajiao.xyz/api/credits')).toThrow('必须使用 HTTPS')
    expect(() => resolveStationApiRequestUrl('https://shayulajiao.xyz/api/v1', 'https://other.example/api/credits')).toThrow('必须与站点同源')
  })

  it('uses the aihub user summary endpoint only while the standard profile path is unchanged', () => {
    expect(resolveStationProfilePath('https://aihub.top/api/v1', '/user/profile')).toBe('/auth/me?timezone=Asia%2FShanghai')
    expect(resolveStationProfilePath('https://aihub.top/api/v1', '/custom/profile')).toBe('/custom/profile')
    expect(resolveStationProfilePath('https://relay.example.com/api/v1', '/user/profile')).toBe('/user/profile')
  })

  it('uses lcodex root management endpoints and preserves operator overrides', () => {
    expect(applyLcodexApiPathDefaults('https://lcodex.cc/api/v1', {
      profile: '/user/profile',
      groups: '/groups/available',
      rates: '/groups/rates',
      channels: '/channels/available'
    })).toMatchObject({ channels: '/api/v1/channels/available' })
    expect(applyLcodexApiPathDefaults('https://lcodex.cc', {
      channels: '/operator/channels'
    })).toEqual({ channels: '/operator/channels' })
  })

  it('unwraps standard success envelopes and rejects API errors', () => {
    expect(unwrapApiResponse<{ balance: number }>({ code: 0, data: { balance: 2 } })).toEqual({ balance: 2 })
    expect(() => unwrapApiResponse({ code: 1003, message: 'forbidden' })).toThrow('forbidden')
  })

  it('joins user rates and optional pricing hints to visible groups', () => {
    const hints = buildPricingHints([{
      name: 'relay',
      platforms: [{ platform: 'anthropic', groups: [{ id: 7, name: 'Claude' }], supported_models: [{ name: 'claude-3-7', pricing: { input_price: 0.003, output_price: 0.015 } }] }]
    }])
    const groups = normalizeGroups([{ id: 7, name: 'Claude', platform: 'anthropic', rate_multiplier: 0.8 }], { 7: 0.72 }, hints)
    expect(groups[0]).toMatchObject({ id: 7, rateMultiplier: 0.8, userRateMultiplier: 0.72, pricingAvailable: true })
    expect(groups[0].pricingHint).toContain('claude-3-7')
    expect(groups[0].pricingModels?.[0]).toMatchObject({ name: 'claude-3-7', inputPrice: 0.003, outputPrice: 0.015 })
  })

  it('normalizes forked channel fields and balance aliases', () => {
    expect(pickProfileBalance({ credits: 12.5 })).toBe(12.5)
    expect(pickProfileBalance({ credit_balance: 70.949198 })).toBe(70.949198)
    expect(pickProfileBalance({ remaining: '56.78' })).toBe(56.78)
    expect(pickProfileBalance({ data: { available_credits: '42.25' } } as never)).toBe(42.25)

    const groups = normalizeGroups([{ id: 9, title: 'Krill Claude', provider: 'anthropic', multiplier: 0.025 }], {})

    expect(groups[0]).toMatchObject({ id: 9, name: 'Krill Claude', platform: 'anthropic', rateMultiplier: 0.025 })
  })

  it('normalizes exclusive, subscription and peak group metadata from forked fields', () => {
    const groups = normalizeGroups([{
      id: 12,
      name: 'Plus 专属池',
      platform: 'openai',
      rate_multiplier: 0.02,
      is_private: 1,
      subscriptionType: 'plus',
      peakRateEnabled: 'true',
      peakRateMultiplier: 0.04
    }], {})

    expect(groups[0]).toMatchObject({
      isExclusive: true,
      subscriptionType: 'plus',
      peakRateEnabled: true,
      peakRateMultiplier: 0.04
    })
  })

  it('keeps all supported model prices for category price ranking', () => {
    const hints = buildPricingHints([{
      name: 'relay',
      platforms: [{
        platform: 'grok',
        groups: [{ id: 11, name: 'Grok' }],
        supported_models: [
          { name: 'grok-4', pricing: { input_price: 0.003, output_price: 0.015 } },
          { name: 'antigravity', pricing: { input_price: 0.0018, output_price: 0.006 } }
        ]
      }]
    }])

    const groups = normalizeGroups([{ id: 11, name: 'Grok', platform: 'grok', rate_multiplier: 0.5 }], { 11: 0.45 }, hints)

    expect(groups[0].pricingModels).toHaveLength(2)
    expect(groups[0].pricingHint).toContain('grok-4')
  })

  it('classifies timeout and preserves typed adapter errors', () => {
    expect(classifySub2ApiError(new DOMException('aborted', 'AbortError'))).toEqual({ code: 'TIMEOUT', message: '请求超时' })
    expect(classifySub2ApiError(new Sub2ApiError('no access', 'FORBIDDEN', 403))).toEqual({ code: 'FORBIDDEN', message: 'no access' })
  })

  it('compares confirmed account group sets without order sensitivity', () => {
    expect(sameNumberSet([3, 1], [1, 3])).toBe(true)
    expect(sameNumberSet([1], [1, 2])).toBe(false)
  })

  it('keeps manually added browser preview stations visible without web login', async () => {
    const api = createPreviewApi()
    const next = await api.stations.save({ name: '预览站点', baseUrl: 'https://relay.example.com' })
    const snapshots = await api.stations.getSnapshots()

    await expect(api.auth.login({ name: '预览站点', baseUrl: 'https://relay.example.com' })).rejects.toThrow('浏览器预览不执行网页登录授权')
    expect(api.runtime.isBrowserPreview).toBe(true)
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ name: '预览站点', baseUrl: 'https://relay.example.com/api/v1' })
    expect(next[0].rechargeRatio).toBe(1)
    expect(next[0].lowBalanceThreshold).toBe(10)
    expect(snapshots[0]).toMatchObject({ stationName: '预览站点', health: 'empty' })
  })

  it('keeps a custom low balance threshold in browser preview station settings', async () => {
    const api = createPreviewApi()
    const next = await api.stations.save({ name: '预览站点', baseUrl: 'https://relay.example.com', lowBalanceThreshold: 35.5 })

    expect(next[0]).toMatchObject({ lowBalanceThreshold: 35.5 })
  })
})
