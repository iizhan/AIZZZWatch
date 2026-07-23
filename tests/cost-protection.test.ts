import { describe, expect, it } from 'vitest'
import { buildAccountGroupProfitRows, groupProfitRowsByAccount, groupProfitRowsBySellingGroup, sortAccountProfitGroups, sortSellingGroupProfitGroups, suggestedAccountBaseRateMultiplier } from '../src/renderer/src/App'
import type { AccountCostProfile, AccountUpstreamMapping, StationPublic, StationSnapshot } from '../src/shared/types'

function station(input: Partial<StationPublic> & Pick<StationPublic, 'id' | 'name' | 'rechargeRatio'>): StationPublic {
  return {
    baseUrl: 'https://example.com/api/v1',
    lowBalanceThreshold: 10,
    apiPaths: {},
    hasAccessToken: false,
    hasRefreshToken: false,
    hasAdminToken: false,
    hasSavedLoginCredentials: false,
    pollingIntervalMs: 30_000,
    ...input
  }
}

function snapshot(stationId: string, stationName: string, groups: StationSnapshot['groups'], accounts: StationSnapshot['accounts']): StationSnapshot {
  return {
    stationId,
    stationName,
    health: 'healthy',
    currency: 'USD',
    groups,
    accounts,
    priceCapability: 'available'
  }
}

describe('cost protection helpers', () => {
  it('suggests a higher base rate from upstream effective cost', () => {
    expect(suggestedAccountBaseRateMultiplier(0.01, 1)).toBe(0.0105)
    expect(suggestedAccountBaseRateMultiplier(0.01, 10)).toBeCloseTo(0.105, 12)
  })

  it('builds profit rows for each account-group relation and marks loss states', () => {
    const myStation = station({ id: 'my-station', name: '我的站点', rechargeRatio: 1, hasAdminToken: true })
    const sourceStations: StationPublic[] = [
      station({ id: 'source-a', name: '三方站 A', rechargeRatio: 10 }),
      station({ id: 'source-b', name: '三方站 B', rechargeRatio: 1 })
    ]
    const snapshots: Record<string, StationSnapshot> = {
      'source-a': snapshot('source-a', '三方站 A', [
        { id: 11, name: 'Claude 便宜组', platform: 'anthropic', rateMultiplier: 0.1, userRateMultiplier: 0.1, pricingAvailable: false },
        { id: 12, name: 'Claude 贵组', platform: 'anthropic', rateMultiplier: 0.3, userRateMultiplier: 0.3, pricingAvailable: false }
      ], []),
      'source-b': snapshot('source-b', '三方站 B', [
        { id: 21, name: 'OpenAI 基础组', platform: 'openai', rateMultiplier: 0.02, userRateMultiplier: 0.02, pricingAvailable: false }
      ], []),
      'my-station': snapshot('my-station', '我的站点', [
        { id: 101, name: 'Claude 低价分组', platform: 'anthropic', rateMultiplier: 0.005, userRateMultiplier: 0.005, pricingAvailable: false },
        { id: 102, name: 'Claude 高价分组', platform: 'anthropic', rateMultiplier: 0.2, userRateMultiplier: 0.2, pricingAvailable: false }
      ], [
        { id: 1, name: 'claude-main', platform: 'anthropic', groupIds: [101, 102], groups: ['Claude 低价分组', 'Claude 高价分组'], status: 'active', baseRateMultiplier: 0.005, usageAmount: 1000 }
      ])
    }
    const adminStations = [{ station: myStation, snapshot: snapshots['my-station'] }]
    const mappings: AccountUpstreamMapping[] = [
      { accountStationId: 'my-station', accountId: 1, sourceStationId: 'source-a', sourceGroupId: 11, sourceKeyLabel: 'krill-01', updatedAt: '2026-07-19T00:00:00.000Z' }
    ]

    const rows = buildAccountGroupProfitRows(adminStations, sourceStations, snapshots, mappings)

    expect(rows).toHaveLength(2)
    expect(rows[0].key).toBe('my-station:1:101')
    expect(rows[0].status).toBe('loss')
    expect(rows[0].upstreamEffectiveMultiplier).toBe(0.01)
    expect(rows[0].groupEffectiveMultiplier).toBe(0.005)
    expect(rows[0].unitMargin).toBe(-0.005)
    expect(rows[0].suggestedBaseRateMultiplier).toBeCloseTo(0.0105, 12)
    expect(rows[0].baseRateNeedsUpdate).toBe(true)
    expect(rows[1].key).toBe('my-station:1:102')
    expect(rows[1].status).toBe('profitable')
    expect(rows[1].estimatedProfit).toBeUndefined()
    expect(rows[1].usageAmount).toBeUndefined()
  })

  it('uses the current single-group key assignment for upstream cost protection', () => {
    const myStation = station({ id: 'my-station', name: '我的站点', rechargeRatio: 1, hasAdminToken: true })
    const sourceStation = station({ id: 'source-a', name: '三方站 A', rechargeRatio: 1 })
    const snapshots: Record<string, StationSnapshot> = {
      'source-a': {
        ...snapshot('source-a', '三方站 A', [
          { id: 11, name: '旧上游组', platform: 'openai', rateMultiplier: 0.01, pricingAvailable: false },
          { id: 12, name: '新上游组', platform: 'openai', rateMultiplier: 0.04, pricingAvailable: false }
        ], []),
        sourceKeys: [{ id: 'source-key-1', label: 'main key', groupIds: [12], groupNames: ['新上游组'] }]
      },
      'my-station': snapshot('my-station', '我的站点', [
        { id: 101, name: '销售组', platform: 'openai', rateMultiplier: 0.03, pricingAvailable: false }
      ], [
        { id: 1, name: '上游账号', platform: 'openai', groupIds: [101], groups: ['销售组'], status: 'active' }
      ])
    }

    const rows = buildAccountGroupProfitRows([{ station: myStation, snapshot: snapshots['my-station'] }], [sourceStation, myStation], snapshots, [{
      accountStationId: 'my-station', accountId: 1, sourceStationId: 'source-a', sourceGroupId: 11, sourceKeyId: 'source-key-1', updatedAt: '2026-07-21T00:00:00.000Z'
    }])

    expect(rows[0]).toMatchObject({ sourceGroup: { id: 12 }, upstreamEffectiveMultiplier: 0.04, status: 'loss' })
  })

  it('deduplicates repeated group ids from account payloads while keeping different groups', () => {
    const myStation = station({ id: 'my-station', name: '我的站点', rechargeRatio: 1, hasAdminToken: true })
    const sourceStation = station({ id: 'source-a', name: '三方站 A', rechargeRatio: 10 })
    const snapshots: Record<string, StationSnapshot> = {
      'source-a': snapshot('source-a', '三方站 A', [
        { id: 11, name: '上游便宜组', platform: 'openai', rateMultiplier: 0.1, userRateMultiplier: 0.1, pricingAvailable: false }
      ], []),
      'my-station': snapshot('my-station', '我的站点', [
        { id: 101, name: 'PLUS池组', platform: 'openai', rateMultiplier: 0.058, userRateMultiplier: 0.058, pricingAvailable: false },
        { id: 102, name: 'PRO+PLUS混池组', platform: 'openai', rateMultiplier: 0.073, userRateMultiplier: 0.073, pricingAvailable: false }
      ], [
        { id: 1, name: '0.03 congming-快速稳定分组1', platform: 'openai', groupIds: [101, 101, 102], groups: ['PLUS池组', 'PLUS池组', 'PRO+PLUS混池组'], status: 'active' }
      ])
    }
    const mappings: AccountUpstreamMapping[] = [
      { accountStationId: 'my-station', accountId: 1, sourceStationId: 'source-a', sourceGroupId: 11, updatedAt: '2026-07-19T00:00:00.000Z' }
    ]

    const rows = buildAccountGroupProfitRows([{ station: myStation, snapshot: snapshots['my-station'] }], [sourceStation, myStation], snapshots, mappings)

    expect(rows.map((row) => row.key).sort()).toEqual(['my-station:1:101', 'my-station:1:102'])
    expect(rows.map((row) => row.group.name).sort()).toEqual(['PLUS池组', 'PRO+PLUS混池组'])
  })

  it('groups cost relations by account for the folded cost list', () => {
    const myStation = station({ id: 'my-station', name: '我的站点', rechargeRatio: 1, hasAdminToken: true })
    const sourceStation = station({ id: 'source-a', name: '三方站 A', rechargeRatio: 10 })
    const snapshots: Record<string, StationSnapshot> = {
      'source-a': snapshot('source-a', '三方站 A', [
        { id: 11, name: '上游便宜组', platform: 'openai', rateMultiplier: 0.1, userRateMultiplier: 0.1, pricingAvailable: false }
      ], []),
      'my-station': snapshot('my-station', '我的站点', [
        { id: 101, name: 'PLUS池组', platform: 'openai', rateMultiplier: 0.058, userRateMultiplier: 0.058, pricingAvailable: false },
        { id: 102, name: 'PRO+PLUS混池组', platform: 'openai', rateMultiplier: 0.073, userRateMultiplier: 0.073, pricingAvailable: false }
      ], [
        { id: 1, name: 'congming-main', platform: 'openai', groupIds: [101, 102], groups: ['PLUS池组', 'PRO+PLUS混池组'], status: 'active' }
      ])
    }
    const rows = buildAccountGroupProfitRows(
      [{ station: myStation, snapshot: snapshots['my-station'] }],
      [sourceStation, myStation],
      snapshots,
      [{ accountStationId: 'my-station', accountId: 1, sourceStationId: 'source-a', sourceGroupId: 11, updatedAt: '2026-07-19T00:00:00.000Z' }]
    )

    const groups = groupProfitRowsByAccount(rows)

    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('my-station:1')
    expect(groups[0].rows).toHaveLength(2)
    expect(groups[0].minEffectiveMultiplier).toBe(0.058)
    expect(groups[0].maxEffectiveMultiplier).toBe(0.073)
  })

  it('groups multiple accounts under one selling group for group-first cost operations', () => {
    const myStation = station({ id: 'my-station', name: '我的站点', rechargeRatio: 1, hasAdminToken: true })
    const sourceStation = station({ id: 'source-a', name: '三方站 A', rechargeRatio: 1 })
    const snapshots: Record<string, StationSnapshot> = {
      'source-a': snapshot('source-a', '三方站 A', [
        { id: 11, name: '上游便宜组', platform: 'openai', rateMultiplier: 0.03, userRateMultiplier: 0.03, pricingAvailable: false },
        { id: 12, name: '上游亏损组', platform: 'openai', rateMultiplier: 0.08, userRateMultiplier: 0.08, pricingAvailable: false }
      ], []),
      'my-station': snapshot('my-station', '我的站点', [
        { id: 101, name: 'PLUS池组', platform: 'openai', rateMultiplier: 0.058, userRateMultiplier: 0.058, pricingAvailable: false }
      ], [
        { id: 1, name: 'cheap-account', platform: 'openai', groupIds: [101], groups: ['PLUS池组'], status: 'active' },
        { id: 2, name: 'loss-account', platform: 'openai', groupIds: [101], groups: ['PLUS池组'], status: 'active' },
        { id: 3, name: 'gift-account', platform: 'openai', groupIds: [101], groups: ['PLUS池组'], status: 'active' }
      ])
    }
    const mappings: AccountUpstreamMapping[] = [
      { accountStationId: 'my-station', accountId: 1, sourceStationId: 'source-a', sourceGroupId: 11, updatedAt: '2026-07-19T00:00:00.000Z' },
      { accountStationId: 'my-station', accountId: 2, sourceStationId: 'source-a', sourceGroupId: 12, updatedAt: '2026-07-19T00:00:00.000Z' }
    ]
    const profiles: AccountCostProfile[] = [
      { accountStationId: 'my-station', accountId: 3, kind: 'gifted', updatedAt: '2026-07-19T00:00:00.000Z' }
    ]

    const rows = buildAccountGroupProfitRows([{ station: myStation, snapshot: snapshots['my-station'] }], [sourceStation, myStation], snapshots, mappings, profiles)
    const groups = groupProfitRowsBySellingGroup(rows)

    expect(groups).toHaveLength(1)
    expect(groups[0].group.name).toBe('PLUS池组')
    expect(groups[0].accountCount).toBe(3)
    expect(groups[0].lossCount).toBe(1)
    expect(groups[0].summaryStatus).toBe('loss')
    expect(groups[0].cheapestAccountRow?.account.name).toBe('gift-account')
    expect(groups[0].rows.map((row) => row.account.name)).toEqual(['loss-account', 'gift-account', 'cheap-account'])
  })

  it('treats gifted accounts as zero-cost without requiring an upstream mapping', () => {
    const myStation = station({ id: 'my-station', name: '我的站点', rechargeRatio: 1, hasAdminToken: true })
    const snapshots: Record<string, StationSnapshot> = {
      'my-station': snapshot('my-station', '我的站点', [
        { id: 101, name: '免费 Plus 池', platform: 'openai', rateMultiplier: 0.025, userRateMultiplier: 0.025, pricingAvailable: false }
      ], [
        { id: 1, name: 'friend-gift-plus', platform: 'openai', groupIds: [101], groups: ['免费 Plus 池'], status: 'active', usageAmount: 100 }
      ])
    }
    const profiles: AccountCostProfile[] = [
      { accountStationId: 'my-station', accountId: 1, kind: 'gifted', note: '朋友赠送', updatedAt: '2026-07-19T00:00:00.000Z' }
    ]

    const rows = buildAccountGroupProfitRows([{ station: myStation, snapshot: snapshots['my-station'] }], [myStation], snapshots, [], profiles)

    expect(rows).toHaveLength(1)
    expect(rows[0].costKind).toBe('gifted')
    expect(rows[0].status).toBe('profitable')
    expect(rows[0].accountCostMultiplier).toBe(0)
    expect(rows[0].unitMargin).toBe(0.025)
    expect(rows[0].estimatedProfit).toBe(2.5)
  })

  it('keeps an upstream association but exempts a self-owned account from cost protection', () => {
    const myStation = station({ id: 'my-station', name: '我的站点', rechargeRatio: 1, hasAdminToken: true })
    const sourceStation = station({ id: 'source-a', name: '三方站 A', rechargeRatio: 1 })
    const snapshots: Record<string, StationSnapshot> = {
      'source-a': snapshot('source-a', '三方站 A', [
        { id: 11, name: '上游高价组', platform: 'openai', rateMultiplier: 0.08, pricingAvailable: false }
      ], []),
      'my-station': snapshot('my-station', '我的站点', [
        { id: 101, name: '低价售卖组', platform: 'openai', rateMultiplier: 0.02, pricingAvailable: false }
      ], [
        { id: 1, name: '我的账号', platform: 'openai', groupIds: [101], groups: ['低价售卖组'], status: 'active', baseRateMultiplier: 0.02, usageAmount: 100 }
      ])
    }
    const mapping: AccountUpstreamMapping = {
      accountStationId: 'my-station', accountId: 1, sourceStationId: 'source-a', sourceGroupId: 11, updatedAt: '2026-07-22T00:00:00.000Z'
    }
    const profiles: AccountCostProfile[] = [
      { accountStationId: 'my-station', accountId: 1, kind: 'self-owned-exempt', updatedAt: '2026-07-22T00:00:00.000Z' }
    ]

    const [row] = buildAccountGroupProfitRows([{ station: myStation, snapshot: snapshots['my-station'] }], [sourceStation, myStation], snapshots, [mapping], profiles)

    expect(row).toMatchObject({ costKind: 'self-owned-exempt', status: 'exempt', mapping })
    expect(row.accountCostMultiplier).toBe(0)
    expect(row.unitMargin).toBeUndefined()
    expect(row.estimatedProfit).toBeUndefined()
    expect(row.suggestedBaseRateMultiplier).toBeUndefined()
    expect(row.baseRateNeedsUpdate).toBe(false)
    const [sellingGroup] = groupProfitRowsBySellingGroup([row])
    expect(sellingGroup).toMatchObject({ summaryStatus: 'exempt', cheapestAccountRow: undefined, minAccountCostMultiplier: undefined, maxAccountCostMultiplier: undefined })
  })

  it('applies manual unit cost while carrying fixed subscription cost metadata', () => {
    const myStation = station({ id: 'my-station', name: '我的站点', rechargeRatio: 1, hasAdminToken: true })
    const snapshots: Record<string, StationSnapshot> = {
      'my-station': snapshot('my-station', '我的站点', [
        { id: 101, name: '自购 Plus 池', platform: 'openai', rateMultiplier: 0.026, userRateMultiplier: 0.026, pricingAvailable: false }
      ], [
        { id: 1, name: 'self-plus', platform: 'openai', groupIds: [101], groups: ['自购 Plus 池'], status: 'active', usageAmount: 1000 }
      ])
    }
    const profiles: AccountCostProfile[] = [
      {
        accountStationId: 'my-station',
        accountId: 1,
        kind: 'subscription',
        fixedCostAmount: 20,
        cycleDays: 30,
        variableCostMultiplier: 0.025,
        note: 'Plus 月付',
        updatedAt: '2026-07-19T00:00:00.000Z'
      }
    ]

    const rows = buildAccountGroupProfitRows([{ station: myStation, snapshot: snapshots['my-station'] }], [myStation], snapshots, [], profiles)

    expect(rows).toHaveLength(1)
    expect(rows[0].costKind).toBe('subscription')
    expect(rows[0].status).toBe('near-loss')
    expect(rows[0].accountCostMultiplier).toBe(0.025)
    expect(rows[0].unitMargin).toBeCloseTo(0.001, 12)
    expect(rows[0].costProfile?.fixedCostAmount).toBe(20)
    expect(rows[0].costProfile?.cycleDays).toBe(30)
    expect(rows[0].estimatedProfit).toBeCloseTo(1, 12)
  })

  it('sorts accounts without cost profiles before configured cost profiles', () => {
    const myStation = station({ id: 'my-station', name: '我的站点', rechargeRatio: 1, hasAdminToken: true })
    const snapshots: Record<string, StationSnapshot> = {
      'my-station': snapshot('my-station', '我的站点', [
        { id: 101, name: 'OpenAI 未设置', platform: 'openai', rateMultiplier: 0.03, userRateMultiplier: 0.03, pricingAvailable: false },
        { id: 102, name: 'Claude 已设置', platform: 'anthropic', rateMultiplier: 0.02, userRateMultiplier: 0.02, pricingAvailable: false }
      ], [
        { id: 1, name: 'configured-account', platform: 'anthropic', groupIds: [102], groups: ['Claude 已设置'], status: 'active' },
        { id: 2, name: 'unset-account', platform: 'openai', groupIds: [101], groups: ['OpenAI 未设置'], status: 'active' }
      ])
    }
    const profiles: AccountCostProfile[] = [
      { accountStationId: 'my-station', accountId: 1, kind: 'gifted', updatedAt: '2026-07-19T00:00:00.000Z' }
    ]

    const rows = buildAccountGroupProfitRows([{ station: myStation, snapshot: snapshots['my-station'] }], [myStation], snapshots, [], profiles)
    const groups = sortAccountProfitGroups(groupProfitRowsByAccount(rows), 'unset-first')

    expect(groups.map((group) => group.account.name)).toEqual(['unset-account', 'configured-account'])
    expect(groups[0].hasCostProfile).toBe(false)
    expect(groups[1].hasCostProfile).toBe(true)
  })

  it('sorts configured accounts by model category when category sorting is selected', () => {
    const myStation = station({ id: 'my-station', name: '我的站点', rechargeRatio: 1, hasAdminToken: true })
    const snapshots: Record<string, StationSnapshot> = {
      'my-station': snapshot('my-station', '我的站点', [
        { id: 101, name: 'Gemini Image', platform: 'gemini', rateMultiplier: 0.02, userRateMultiplier: 0.02, pricingAvailable: false },
        { id: 102, name: 'OpenAI Fast', platform: 'openai', rateMultiplier: 0.02, userRateMultiplier: 0.02, pricingAvailable: false },
        { id: 103, name: 'Claude Code', platform: 'anthropic', rateMultiplier: 0.02, userRateMultiplier: 0.02, pricingAvailable: false }
      ], [
        { id: 1, name: 'gemini-account', platform: 'gemini', groupIds: [101], groups: ['Gemini Image'], status: 'active' },
        { id: 2, name: 'openai-account', platform: 'openai', groupIds: [102], groups: ['OpenAI Fast'], status: 'active' },
        { id: 3, name: 'claude-account', platform: 'anthropic', groupIds: [103], groups: ['Claude Code'], status: 'active' }
      ])
    }
    const profiles: AccountCostProfile[] = [
      { accountStationId: 'my-station', accountId: 1, kind: 'gifted', updatedAt: '2026-07-19T00:00:00.000Z' },
      { accountStationId: 'my-station', accountId: 2, kind: 'gifted', updatedAt: '2026-07-19T00:00:00.000Z' },
      { accountStationId: 'my-station', accountId: 3, kind: 'gifted', updatedAt: '2026-07-19T00:00:00.000Z' }
    ]

    const rows = buildAccountGroupProfitRows([{ station: myStation, snapshot: snapshots['my-station'] }], [myStation], snapshots, [], profiles)
    const groups = sortAccountProfitGroups(groupProfitRowsByAccount(rows), 'category')

    expect(groups.map((group) => group.account.name)).toEqual(['claude-account', 'openai-account', 'gemini-account'])
    expect(groups.map((group) => group.primaryCategoryLabel)).toEqual(['Anthropic', 'OpenAI', 'Gemini'])
  })

  it('sorts selling groups by account count and worst margin', () => {
    const myStation = station({ id: 'my-station', name: '我的站点', rechargeRatio: 1, hasAdminToken: true })
    const sourceStation = station({ id: 'source-a', name: '三方站 A', rechargeRatio: 1 })
    const snapshots: Record<string, StationSnapshot> = {
      'source-a': snapshot('source-a', '三方站 A', [
        { id: 11, name: '上游 0.02', platform: 'openai', rateMultiplier: 0.02, userRateMultiplier: 0.02, pricingAvailable: false },
        { id: 12, name: '上游 0.07', platform: 'openai', rateMultiplier: 0.07, userRateMultiplier: 0.07, pricingAvailable: false }
      ], []),
      'my-station': snapshot('my-station', '我的站点', [
        { id: 101, name: 'A 分组', platform: 'openai', rateMultiplier: 0.06, userRateMultiplier: 0.06, pricingAvailable: false },
        { id: 102, name: 'B 分组', platform: 'openai', rateMultiplier: 0.05, userRateMultiplier: 0.05, pricingAvailable: false }
      ], [
        { id: 1, name: 'a-1', platform: 'openai', groupIds: [101], groups: ['A 分组'], status: 'active' },
        { id: 2, name: 'a-2', platform: 'openai', groupIds: [101], groups: ['A 分组'], status: 'active' },
        { id: 3, name: 'b-1', platform: 'openai', groupIds: [102], groups: ['B 分组'], status: 'active' }
      ])
    }
    const mappings: AccountUpstreamMapping[] = [
      { accountStationId: 'my-station', accountId: 1, sourceStationId: 'source-a', sourceGroupId: 11, updatedAt: '2026-07-19T00:00:00.000Z' },
      { accountStationId: 'my-station', accountId: 2, sourceStationId: 'source-a', sourceGroupId: 12, updatedAt: '2026-07-19T00:00:00.000Z' },
      { accountStationId: 'my-station', accountId: 3, sourceStationId: 'source-a', sourceGroupId: 11, updatedAt: '2026-07-19T00:00:00.000Z' }
    ]

    const rows = buildAccountGroupProfitRows([{ station: myStation, snapshot: snapshots['my-station'] }], [sourceStation, myStation], snapshots, mappings)
    const groups = groupProfitRowsBySellingGroup(rows)

    expect(sortSellingGroupProfitGroups(groups, 'account-count').map((group) => group.group.name)).toEqual(['A 分组', 'B 分组'])
    expect(sortSellingGroupProfitGroups(groups, 'margin').map((group) => group.group.name)).toEqual(['A 分组', 'B 分组'])
  })
})
