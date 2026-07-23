import { describe, expect, it } from 'vitest'
import type { GroupSnapshot, StationSnapshot } from '../src/shared/types'
import { accountApiBaseMatchesStation, accountCanRecommend, accountCurrentEffectiveLabel, accountCurrentEffectiveMeta, accountCurrentEffectiveTitle, accountCurrentGroupOptions, accountMatchesGroupFilter, accountMatchesPlatformFilter, accountMatchesScheduleFilter, accountMatchesWorkbenchQuery, accountRecommendationActionLabel, accountRecommendationLabel, accountRecommendationTone, accountScheduleLabel, accountScheduleState, accountWorkbenchGroupFilterOptions, accountWorkbenchPlatformOptions, activeUpstreamGroupUsages, batchMutationResultCounts, buildAccountRecommendationMutations, clearManualGroupTag, compareRankingRows, compareSourceWalletStations, countHiddenGroupsForRows, effectiveMultiplierValue, filterGroupSwitchOptions, formatRateMultiplier, groupPreferenceKey, groupSpecialTags, groupSwitchCandidateGroups, groupSwitchCompletionNotice, groupSwitchPlatformOptions, groupSwitchPreview, groupSwitchSuccessText, inferAccountCategory, inferAccountUpstreamMapping, inferGroupCapabilityTags, isAdminManagedStation, isOwnStation, isPriceRankingStation, isStationBalanceLow, mergeSnapshotMap, normalizeAccountRecommendationStrategy, rankingSortText, rebuildAccountUpstreamMappings, recommendedAccountGroupOption, resolveAccountUpstreamMappingSource, resolveGroupCapabilityTags, safeGroupSwitchOptions, sortedGroupSwitchOptions, stationAdapterLabel, toggleManualGroupTag, toggleRankingSort } from '../src/renderer/src/App'
import { rowMatchesPriceSearch } from '../src/renderer/src/App'

function makeRow(overrides: Partial<Parameters<typeof compareRankingRows>[0]> = {}) {
  return {
    key: 'row',
    category: 'all',
    categoryLabel: '全部',
    tags: [{ id: 'chat', label: '对话' }],
    specialTags: [],
    modelName: 'model',
    platform: 'openai',
    stationId: 'station',
    stationName: '站点',
    groupId: 1,
    groupName: '分组',
    rateMultiplier: 1,
    rechargeRatio: 1,
    effectiveMultiplier: 1,
    health: 'healthy',
    score: 0.01,
    ...overrides
  } as Parameters<typeof compareRankingRows>[0]
}

describe('ranking sort helpers', () => {
  it('sorts by effective cost ascending and keeps missing values at the end', () => {
    const rows = [
      makeRow({ key: 'high', score: 0.03, rateMultiplier: 0.7, rechargeRatio: 10 }),
      makeRow({ key: 'low', score: 0.01, rateMultiplier: 0.4, rechargeRatio: 20 }),
      makeRow({ key: 'missing', score: undefined, rateMultiplier: 0.2, rechargeRatio: 1 })
    ]

    const sorted = [...rows].sort((left, right) => compareRankingRows(left, right, { key: 'effectiveCost', direction: 'asc' }))

    expect(sorted.map((row) => row.key)).toEqual(['low', 'high', 'missing'])
  })

  it('toggles the current column and applies a sensible default for a new column', () => {
    expect(toggleRankingSort({ key: 'effectiveCost', direction: 'asc' }, 'effectiveCost')).toEqual({ key: 'effectiveCost', direction: 'desc' })
    expect(toggleRankingSort({ key: 'effectiveCost', direction: 'asc' }, 'rateMultiplier')).toEqual({ key: 'rateMultiplier', direction: 'asc' })
    expect(toggleRankingSort({ key: 'effectiveCost', direction: 'asc' }, 'rechargeRatio')).toEqual({ key: 'rechargeRatio', direction: 'desc' })
    expect(toggleRankingSort({ key: 'effectiveCost', direction: 'asc' }, 'effectiveMultiplier')).toEqual({ key: 'effectiveMultiplier', direction: 'asc' })
  })

  it('renders a clear sort label', () => {
    expect(rankingSortText({ key: 'rechargeRatio', direction: 'desc' })).toBe('按充值比例从高到低')
    expect(rankingSortText({ key: 'effectiveMultiplier', direction: 'asc' })).toBe('按最终倍率从低到高')
    expect(rankingSortText({ key: 'effectiveCost', direction: 'asc' })).toBe('按模型价格从低到高')
  })

  it('keeps rate multipliers at three decimal places', () => {
    expect(formatRateMultiplier(0.025)).toBe('0.025x')
    expect(formatRateMultiplier(1)).toBe('1.000x')
  })

  it('calculates and sorts by the recharge-adjusted multiplier', () => {
    expect(effectiveMultiplierValue(0.1, 10)).toBe(0.01)
    expect(effectiveMultiplierValue(0.01, 1)).toBe(0.01)

    const rows = [
      makeRow({ key: 'raw-low-but-adjusted-high', rateMultiplier: 0.025, rechargeRatio: 1, effectiveMultiplier: effectiveMultiplierValue(0.025, 1) }),
      makeRow({ key: 'raw-high-but-adjusted-low', rateMultiplier: 0.1, rechargeRatio: 10, effectiveMultiplier: effectiveMultiplierValue(0.1, 10) })
    ]

    const sorted = [...rows].sort((left, right) => compareRankingRows(left, right, { key: 'effectiveMultiplier', direction: 'asc' }))

    expect(sorted.map((row) => row.key)).toEqual(['raw-high-but-adjusted-low', 'raw-low-but-adjusted-high'])
  })

  it('follows a single upstream key group while keeping legacy and ambiguous mappings conservative', () => {
    const groups: GroupSnapshot[] = [
      { id: 11, name: '旧组', platform: 'openai', rateMultiplier: 0.03, pricingAvailable: false },
      { id: 12, name: '新组', platform: 'openai', rateMultiplier: 0.05, pricingAvailable: false },
      { id: 13, name: '附加组', platform: 'openai', rateMultiplier: 0.01, pricingAvailable: false }
    ]
    const baseMapping = { accountStationId: 'mine', accountId: 1, sourceStationId: 'source', sourceGroupId: 11, updatedAt: '2026-07-21T00:00:00.000Z' }

    expect(resolveAccountUpstreamMappingSource(baseMapping, { groups, sourceKeys: [] })).toMatchObject({ state: 'legacy-ready', group: { id: 11 } })
    expect(resolveAccountUpstreamMappingSource({ ...baseMapping, sourceKeyId: 'key-1' }, {
      groups,
      sourceKeys: [{ id: 'key-1', label: 'Claude key', groupIds: [12], groupNames: ['新组'] }]
    })).toMatchObject({ state: 'key-following', group: { id: 12 } })
    expect(resolveAccountUpstreamMappingSource({ ...baseMapping, sourceKeyId: 'key-1' }, {
      groups,
      sourceKeys: [{ id: 'key-1', label: 'Claude key', groupIds: [12, 13], groupNames: ['新组', '附加组'] }]
    })).toMatchObject({ state: 'key-multiple-groups' })
    expect(resolveAccountUpstreamMappingSource({ ...baseMapping, sourceKeyId: 'missing' }, { groups, sourceKeys: [] }).state).toBe('key-missing')
    expect(resolveAccountUpstreamMappingSource({ ...baseMapping, sourceKeyId: 'empty' }, {
      groups,
      sourceKeys: [{ id: 'empty', label: '未分组', groupIds: [], groupNames: [] }]
    }).state).toBe('key-unassigned')
  })

  it('marks only exact current upstream group relationships as in use', () => {
    const usages = activeUpstreamGroupUsages([
      { accountStationId: 'mine', accountId: 1, sourceStationId: 'source', sourceGroupId: 11, updatedAt: 'manual' },
      { accountStationId: 'mine', accountId: 2, sourceStationId: 'source', sourceGroupId: 11, sourceKeyId: 'single-key', updatedAt: 'manual' },
      { accountStationId: 'mine', accountId: 3, sourceStationId: 'source', sourceGroupId: 11, sourceKeyId: 'multi-key', updatedAt: 'manual' }
    ], {
      source: {
        groups: [
          { id: 11, name: 'Legacy', platform: 'openai', rateMultiplier: 0.03, pricingAvailable: false },
          { id: 12, name: 'Current', platform: 'openai', rateMultiplier: 0.02, pricingAvailable: false }
        ],
        sourceKeys: [
          { id: 'single-key', label: 'Single', groupIds: [12], groupNames: ['Current'] },
          { id: 'multi-key', label: 'Multi', groupIds: [11, 12], groupNames: ['Legacy', 'Current'] }
        ]
      }
    })

    expect(usages).toEqual([
      { accountStationId: 'mine', accountId: 1, sourceStationId: 'source', sourceGroupId: 11 },
      { accountStationId: 'mine', accountId: 2, sourceStationId: 'source', sourceGroupId: 12 }
    ])
  })

  it('infers colorful capability tags for image generation and other groups', () => {
    const imageGroup: GroupSnapshot = {
      id: 1,
      name: 'Midjourney IMG 生图组',
      platform: 'openai',
      rateMultiplier: 0.2,
      pricingAvailable: true,
      pricingModels: [{ name: 'dall-e-3' }]
    }
    const defaultGroup: GroupSnapshot = {
      id: 2,
      name: 'Claude 普通组',
      platform: 'anthropic',
      rateMultiplier: 0.2,
      pricingAvailable: true
    }

    expect(inferGroupCapabilityTags(imageGroup).map((tag) => tag.id)).toContain('image')
    expect(inferGroupCapabilityTags(defaultGroup)).toEqual([{ id: 'chat', label: '对话' }])
  })

  it('uses manual group tags until the user restores automatic tags', () => {
    const group: GroupSnapshot = {
      id: 8,
      name: 'Midjourney IMG 生图组',
      platform: 'openai',
      rateMultiplier: 0.2,
      pricingAvailable: true
    }
    const key = groupPreferenceKey('station-a', group.id)
    const manual = toggleManualGroupTag({}, key, 'coding', inferGroupCapabilityTags(group).map((tag) => tag.id))

    expect(manual[key]).toEqual(['image', 'coding'])
    expect(resolveGroupCapabilityTags(group, manual[key]).map((tag) => tag.id)).toEqual(['image', 'coding'])

    const withoutImage = toggleManualGroupTag(manual, key, 'image', inferGroupCapabilityTags(group).map((tag) => tag.id))
    expect(withoutImage[key]).toEqual(['coding'])
    expect(resolveGroupCapabilityTags(group, withoutImage[key])).toEqual([{ id: 'coding', label: '代码' }])

    const restored = clearManualGroupTag(withoutImage, key)
    expect(restored[key]).toBeUndefined()
    expect(resolveGroupCapabilityTags(group, restored[key]).map((tag) => tag.id)).toEqual(['image'])
  })

  it('counts hidden groups by station and group instead of duplicated model rows', () => {
    const rows = [
      makeRow({ key: 'model-a', stationId: 'station-a', groupId: 1 }),
      makeRow({ key: 'model-b', stationId: 'station-a', groupId: 1 }),
      makeRow({ key: 'model-c', stationId: 'station-b', groupId: 1 })
    ]

    expect(countHiddenGroupsForRows(rows, ['station-a:1', 'station-b:1', 'missing:1'])).toBe(2)
  })

  it('flags low balances only when the station threshold is enabled', () => {
    expect(isStationBalanceLow(9.99, 10)).toBe(true)
    expect(isStationBalanceLow(10, 10)).toBe(true)
    expect(isStationBalanceLow(10.01, 10)).toBe(false)
    expect(isStationBalanceLow(1, 0)).toBe(false)
    expect(isStationBalanceLow(undefined, 10)).toBe(false)
  })

  it('sorts source wallet stations by balance and keeps unknown balances last', () => {
    const stations = [
      { id: 'missing', name: '无余额' },
      { id: 'low', name: '低余额' },
      { id: 'high', name: '高余额' }
    ] as Parameters<typeof compareSourceWalletStations>[0][]
    const snapshots = {
      low: { stationId: 'low', stationName: '低余额', health: 'healthy', balance: 1, currency: 'USD', groups: [], accounts: [], priceCapability: 'missing' },
      high: { stationId: 'high', stationName: '高余额', health: 'healthy', balance: 99, currency: 'USD', groups: [], accounts: [], priceCapability: 'missing' }
    } as Parameters<typeof compareSourceWalletStations>[2]

    expect([...stations].sort((left, right) => compareSourceWalletStations(left, right, snapshots, 'desc')).map((station) => station.id)).toEqual(['high', 'low', 'missing'])
    expect([...stations].sort((left, right) => compareSourceWalletStations(left, right, snapshots, 'asc')).map((station) => station.id)).toEqual(['low', 'high', 'missing'])
  })

  it('searches the price ranking by model, group, source station, or platform', () => {
    const row = makeRow({ modelName: 'Claude Sonnet', groupName: '高阶组', stationName: '鲨鱼辣椒', platform: 'anthropic' })

    expect(rowMatchesPriceSearch(row, 'sonnet')).toBe(true)
    expect(rowMatchesPriceSearch(row, '高阶')).toBe(true)
    expect(rowMatchesPriceSearch(row, '鲨鱼')).toBe(true)
    expect(rowMatchesPriceSearch(row, 'anthropic')).toBe(true)
    expect(rowMatchesPriceSearch(row, 'openai')).toBe(false)
  })

  it('sorts group switch options by recharge-adjusted multiplier', () => {
    const options = sortedGroupSwitchOptions([
      { id: 1, name: 'higher', platform: 'openai', rateMultiplier: 0.1, pricingAvailable: false },
      { id: 2, name: 'lower', platform: 'anthropic', rateMultiplier: 0.025, pricingAvailable: false }
    ], 10)

    expect(options.map((option) => option.group.name)).toEqual(['lower', 'higher'])
    expect(options[0]).toMatchObject({ rate: 0.025, effectiveMultiplier: 0.0025 })
  })

  it('resolves account current groups and recommends the lowest safe switch target', () => {
    const groups: GroupSnapshot[] = [
      { id: 1, name: 'Current OpenAI', platform: 'openai', rateMultiplier: 0.2, pricingAvailable: false },
      { id: 2, name: 'Unsafe OpenAI', platform: 'openai', rateMultiplier: 0.1, pricingAvailable: false },
      { id: 3, name: 'Safe OpenAI', platform: 'openai', rateMultiplier: 0.3, pricingAvailable: false }
    ]

    expect(accountCurrentGroupOptions(groups, [1], 10)).toEqual([
      { group: groups[0], rate: 0.2, effectiveMultiplier: 0.02 }
    ])

    const recommendation = recommendedAccountGroupOption(groups, [1], 10, 'openai', 'category', 0.027)

    expect(recommendation?.option.group.name).toBe('Safe OpenAI')
    expect(recommendation?.currentEffectiveMultiplier).toBe(0.02)
    expect(recommendation?.safeForAccount).toBe(true)
    expect(safeGroupSwitchOptions(groups, 10, 0.027).map((option) => option.group.name)).toEqual(['Safe OpenAI'])
    expect(recommendedAccountGroupOption(groups, [1, 2, 3], 10, 'all', 'all')).toBeUndefined()
  })

  it('filters workbench accounts and builds a safe recommendation queue', () => {
    const groups: GroupSnapshot[] = [
      { id: 1, name: 'Current OpenAI', platform: 'openai', rateMultiplier: 0.2, pricingAvailable: false },
      { id: 2, name: 'Cheaper OpenAI', platform: 'openai', rateMultiplier: 0.1, pricingAvailable: false },
      { id: 3, name: 'Higher OpenAI', platform: 'openai', rateMultiplier: 0.3, pricingAvailable: false }
    ]
    const accounts = [
      { id: 10, name: 'openai-pool', platform: 'openai', groupIds: [1], groups: ['Current OpenAI'], status: 'active', scheduleEnabled: true },
      { id: 11, name: 'already-cheap', platform: 'openai', groupIds: [2], groups: ['Cheaper OpenAI'], status: 'active', scheduleEnabled: true },
      { id: 12, name: 'disabled-schedule', platform: 'openai', groupIds: [1], groups: ['Current OpenAI'], status: 'active', scheduleEnabled: false }
    ]

    expect(accountMatchesWorkbenchQuery('主力中转站', accounts[0], 'Cheaper OpenAI', 'pool')).toBe(true)
    expect(accountMatchesWorkbenchQuery('主力中转站', accounts[0], 'Cheaper OpenAI', 'cheaper')).toBe(true)
    expect(accountMatchesWorkbenchQuery('主力中转站', accounts[0], 'Cheaper OpenAI', 'missing')).toBe(false)

    expect(buildAccountRecommendationMutations('station-a', accounts, groups, 10, 'openai', 'category', { 10: 0.02, 11: 0.02 })).toEqual([
      {
        stationId: 'station-a',
        accountId: 10,
        accountName: 'openai-pool',
        previousGroupIds: [1],
        nextGroupIds: [1, 3]
      },
      {
        stationId: 'station-a',
        accountId: 11,
        accountName: 'already-cheap',
        previousGroupIds: [2],
        nextGroupIds: [2, 1]
      }
    ])
  })

  it('separates schedule-enabled accounts from disabled or unknown accounts', () => {
    expect(accountScheduleState({ scheduleEnabled: true })).toBe('enabled')
    expect(accountScheduleState({ scheduleEnabled: false })).toBe('disabled')
    expect(accountScheduleState({ scheduleEnabled: undefined })).toBe('unknown')
    expect(accountScheduleLabel({ scheduleEnabled: true })).toBe('调度开启')
    expect(accountScheduleLabel({ scheduleEnabled: false })).toBe('调度关闭')
    expect(accountMatchesScheduleFilter({ scheduleEnabled: false }, 'disabled')).toBe(true)
    expect(accountMatchesScheduleFilter({ scheduleEnabled: undefined }, 'unknown')).toBe(true)
    expect(accountCanRecommend({ scheduleEnabled: true })).toBe(true)
    expect(accountCanRecommend({ scheduleEnabled: false })).toBe(false)
    expect(accountCanRecommend({ scheduleEnabled: undefined })).toBe(false)
  })

  it('matches channel and group filters for the account workbench', () => {
    const account = { id: 1, name: 'claude-main', platform: 'anthropic', groupIds: [11, 12], groups: ['Claude', 'Claude Pro'], status: 'active', scheduleEnabled: true }
    expect(accountMatchesPlatformFilter(account, 'all')).toBe(true)
    expect(accountMatchesPlatformFilter(account, 'anthropic')).toBe(true)
    expect(accountMatchesPlatformFilter(account, 'openai')).toBe(false)
    expect(accountMatchesGroupFilter('station-a', account, 'all')).toBe(true)
    expect(accountMatchesGroupFilter('station-a', account, 'station-a:11')).toBe(true)
    expect(accountMatchesGroupFilter('station-a', account, 'station-a:99')).toBe(false)

    const options = accountWorkbenchPlatformOptions([
      { snapshot: { accounts: [account, { ...account, id: 2, platform: 'openai' }] } }
    ])
    expect(options).toEqual(['anthropic', 'openai'])

    const groupOptions = accountWorkbenchGroupFilterOptions([
      {
        station: { id: 'station-a', name: '站点 A' },
        snapshot: {
          accounts: [account],
          groups: [
            { id: 11, name: 'Claude', platform: 'anthropic', rateMultiplier: 0.1, pricingAvailable: false },
            { id: 12, name: 'Claude Pro', platform: 'anthropic', rateMultiplier: 0.2, pricingAvailable: false }
          ]
        }
      }
    ])
    expect(groupOptions.map((option) => option.id)).toEqual(['station-a:11', 'station-a:12'])
    expect(groupOptions[0].count).toBe(1)
  })

  it('uses initial recommendation wording for accounts without groups', () => {
    expect(accountRecommendationTone(0, true)).toBe('initial')
    expect(accountRecommendationLabel(0, true)).toBe('推荐初始分组')
    expect(accountRecommendationActionLabel(0, true)).toBe('选择推荐')
    expect(accountRecommendationTone(1, true)).toBe('safe')
    expect(accountRecommendationLabel(1, true)).toBe('可加入安全分组')
    expect(accountRecommendationActionLabel(1, true)).toBe('加入安全分组')
    expect(accountRecommendationTone(1, false)).toBe('candidate')
    expect(accountRecommendationLabel(1, false)).toBe('安全候选')
    expect(accountRecommendationActionLabel(1, false)).toBe('选择安全候选')
  })

  it('keeps account recommendations inside the account platform category', () => {
    const groups: GroupSnapshot[] = [
      { id: 1, name: 'Current OpenAI', platform: 'openai', rateMultiplier: 0.02, pricingAvailable: false },
      { id: 2, name: 'Claude Safe', platform: 'anthropic', rateMultiplier: 0.021, pricingAvailable: false },
      { id: 3, name: 'OpenAI Safe', platform: 'openai', rateMultiplier: 0.03, pricingAvailable: false }
    ]

    expect(inferAccountCategory({ name: 'openai-main', platform: 'openai' })).toBe('openai')
    const recommendation = recommendedAccountGroupOption(groups, [1], 1, 'all', 'all', 0.02, 'openai')

    expect(recommendation?.option.group.name).toBe('OpenAI Safe')
  })

  it('keeps batch recommendations inside each account platform category', () => {
    const groups: GroupSnapshot[] = [
      { id: 1, name: 'Current OpenAI', platform: 'openai', rateMultiplier: 0.02, pricingAvailable: false },
      { id: 2, name: 'Claude Safe', platform: 'anthropic', rateMultiplier: 0.021, pricingAvailable: false },
      { id: 3, name: 'OpenAI Safe', platform: 'openai', rateMultiplier: 0.03, pricingAvailable: false }
    ]
    const mutations = buildAccountRecommendationMutations(
      'mine',
      [{ id: 9, name: 'openai-account', platform: 'openai', groupIds: [1], groups: ['Current OpenAI'], status: 'active', scheduleEnabled: true }],
      groups,
      1,
      'all',
      'all',
      { 9: 0.02 }
    )

    expect(mutations[0].nextGroupIds).toEqual([1, 3])
  })

  it('shows special group tags but never infers an upstream mapping from API base URL and multiplier', () => {
    const group: GroupSnapshot = { id: 7, name: '专属池', platform: 'openai', rateMultiplier: 0.02, isExclusive: true, subscriptionType: 'plus', peakRateEnabled: true, peakRateMultiplier: 0.04, pricingAvailable: false }
    expect(groupSpecialTags(group).map((tag) => tag.label)).toEqual(['专属', 'plus', '峰值'])
    expect(accountApiBaseMatchesStation('https://relay.example.com/api/v1', { baseUrl: 'https://relay.example.com/api/v1', apiBaseUrl: undefined })).toBe(true)

    const sourceStation = { id: 'source', name: 'source', baseUrl: 'https://relay.example.com/api/v1', rechargeRatio: 1 } as Parameters<typeof inferAccountUpstreamMapping>[2][0]
    const mapping = inferAccountUpstreamMapping(
      'mine',
      { id: 9, name: 'acc', apiBaseUrl: 'https://relay.example.com/api/v1', baseRateMultiplier: 0.02 },
      [sourceStation],
      {
        source: { stationId: 'source', stationName: 'source', health: 'healthy', balance: 1, currency: 'USD', groups: [group], accounts: [], priceCapability: 'missing' }
      }
    )
    expect(mapping).toBeUndefined()
  })

  it('does not infer an upstream mapping even when one duplicate API-base station has the matching multiplier', () => {
    const firstSource = { id: 'source-a', name: 'source-a', baseUrl: 'https://relay.example.com/api/v1', rechargeRatio: 1 } as Parameters<typeof inferAccountUpstreamMapping>[2][0]
    const secondSource = { id: 'source-b', name: 'source-b', baseUrl: 'https://relay.example.com/api/v1', rechargeRatio: 1 } as Parameters<typeof inferAccountUpstreamMapping>[2][0]
    const mapping = inferAccountUpstreamMapping(
      'mine',
      { id: 9, name: 'acc', apiBaseUrl: 'https://relay.example.com/api/v1', baseRateMultiplier: 0.02 },
      [firstSource, secondSource],
      {
        'source-a': { stationId: 'source-a', stationName: 'source-a', health: 'healthy', balance: 1, currency: 'USD', groups: [{ id: 1, name: 'wrong', platform: 'openai', rateMultiplier: 0.03, pricingAvailable: false }], accounts: [], priceCapability: 'missing' },
        'source-b': { stationId: 'source-b', stationName: 'source-b', health: 'healthy', balance: 1, currency: 'USD', groups: [{ id: 2, name: 'match', platform: 'openai', rateMultiplier: 0.02, pricingAvailable: false }], accounts: [], priceCapability: 'missing' }
      }
    )

    expect(mapping).toBeUndefined()
  })

  it('does not bind a Key record from an address and multiplier candidate', () => {
    const sourceStation = { id: 'source', name: 'source', baseUrl: 'https://relay.example.com/api/v1', rechargeRatio: 1 } as Parameters<typeof inferAccountUpstreamMapping>[2][0]
    const snapshot = {
      stationId: 'source', stationName: 'source', health: 'healthy' as const, balance: 1, currency: 'USD' as const,
      groups: [{ id: 7, name: 'OpenAI', platform: 'openai', rateMultiplier: 0.02, pricingAvailable: false }],
      sourceKeys: [{ id: 'key-record-7', label: 'OpenAI 账号 A', groupIds: [7], groupNames: ['OpenAI'] }],
      accounts: [], priceCapability: 'missing' as const
    }
    const account = { id: 9, name: 'acc', platform: 'openai', apiBaseUrl: 'https://relay.example.com/api/v1', baseRateMultiplier: 0.02 }

    expect(inferAccountUpstreamMapping('mine', account, [sourceStation], { source: snapshot })).toBeUndefined()
    expect(inferAccountUpstreamMapping('mine', account, [sourceStation], {
      source: { ...snapshot, sourceKeys: [...snapshot.sourceKeys, { id: 'key-record-8', label: 'OpenAI 账号 B', groupIds: [7], groupNames: ['OpenAI'] }] }
    })).toBeUndefined()
  })

  it('uses a main-process credential match before API-base and multiplier inference', () => {
    const sourceStation = { id: 'source', name: 'source', baseUrl: 'https://relay.example.com/api/v1', rechargeRatio: 1 } as Parameters<typeof inferAccountUpstreamMapping>[2][0]
    const mapping = inferAccountUpstreamMapping(
      'mine',
      {
        id: 9,
        name: 'third-party-account',
        platform: 'openai',
        apiBaseUrl: 'https://different.example.com/api/v1',
        baseRateMultiplier: 0.9,
        upstreamSourceStationId: 'source',
        upstreamSourceKeyId: 'key-7'
      },
      [sourceStation],
      {
        source: {
          stationId: 'source', stationName: 'source', health: 'healthy', balance: 1, currency: 'USD',
          groups: [{ id: 7, name: 'Matched', platform: 'openai', rateMultiplier: 0.02, pricingAvailable: false }],
          sourceKeys: [{ id: 'key-7', label: 'Matched Key', groupIds: [7], groupNames: ['Matched'] }],
          accounts: [], priceCapability: 'missing'
        }
      }
    )

    expect(mapping).toMatchObject({ sourceStationId: 'source', sourceGroupId: 7, sourceKeyId: 'key-7', updatedAt: 'credential-match' })
  })

  it('rebuilds only exact credential matches and keeps existing manual mappings', () => {
    const adminStation = { id: 'mine', name: 'mine', baseUrl: 'https://mine.example.com/api/v1', rechargeRatio: 1 } as Parameters<typeof rebuildAccountUpstreamMappings>[1][0]['station']
    const sourceStation = { id: 'source', name: 'source', baseUrl: 'https://relay.example.com/api/v1', rechargeRatio: 1 } as Parameters<typeof rebuildAccountUpstreamMappings>[2][0]
    const result = rebuildAccountUpstreamMappings(
      [{ accountStationId: 'mine', accountId: 1, sourceStationId: 'source', sourceGroupId: 7, updatedAt: 'manual' }],
      [{ station: adminStation, snapshot: { accounts: [
        { id: 1, name: 'manual', platform: 'openai', apiBaseUrl: 'https://relay.example.com/api/v1', groupIds: [7], groups: ['A'], status: 'active', baseRateMultiplier: 0.02 },
        { id: 2, name: 'auto', platform: 'openai', apiBaseUrl: 'https://relay.example.com/api/v1', groupIds: [7], groups: ['A'], status: 'active', baseRateMultiplier: 0.02, upstreamSourceStationId: 'source', upstreamSourceKeyId: 'key-7' }
      ] } }],
      [sourceStation],
      {
        source: { stationId: 'source', stationName: 'source', health: 'healthy', balance: 1, currency: 'USD', groups: [{ id: 7, name: 'A', platform: 'openai', rateMultiplier: 0.02, pricingAvailable: false }], sourceKeys: [{ id: 'key-7', label: 'Key A', groupIds: [7], groupNames: ['A'] }], accounts: [], priceCapability: 'missing' }
      },
      '2026-07-21T00:00:00.000Z'
    )

    expect(result.scanned).toBe(2)
    expect(result.added).toBe(1)
    expect(result.skippedExisting).toBe(1)
    expect(result.candidates).toEqual([
      expect.objectContaining({ accountStationId: 'mine', accountId: 2, sourceStationId: 'source', sourceGroupId: 7 })
    ])
    expect(result.mappings).toEqual([
      { accountStationId: 'mine', accountId: 1, sourceStationId: 'source', sourceGroupId: 7, updatedAt: 'manual' },
      expect.objectContaining({ accountStationId: 'mine', accountId: 2, sourceStationId: 'source', sourceGroupId: 7, updatedAt: '2026-07-21T00:00:00.000Z' })
    ])
  })

  it('explains the current combination baseline for hover text', () => {
    const groups: GroupSnapshot[] = [
      { id: 1, name: 'PLUS池组', platform: 'openai', rateMultiplier: 0.058, pricingAvailable: false },
      { id: 2, name: 'PRO+PLUS混池组', platform: 'openai', rateMultiplier: 0.073, pricingAvailable: false },
      { id: 3, name: 'grok free', platform: 'openai', rateMultiplier: 0.03, pricingAvailable: false }
    ]

    expect(accountCurrentEffectiveLabel(groups, [1, 2], 1)).toBe('最低 0.058x')
    expect(accountCurrentEffectiveMeta(groups, [1, 2], 1)).toBe('PLUS池组 · 当前 2 个分组')
    expect(accountCurrentEffectiveMeta(groups, [3], 1)).toBe('grok free · 当前 1 个分组')
    expect(accountCurrentEffectiveMeta(groups, [], 1)).toBe('未绑定分组')
    expect(accountCurrentEffectiveTitle(groups, [1, 2], 1)).toBe('当前组合最低：0.058x · PLUS池组；全部当前分组：PLUS池组 0.058x / PRO+PLUS混池组 0.073x')
    expect(accountCurrentEffectiveTitle(groups, [3], 1)).toBe('当前分组：grok free · 0.030x')
    expect(accountCurrentEffectiveTitle(groups, [], 1)).toBe('当前账号未绑定分组')
  })

  it('summarizes batch mutation results for the workbench result panel', () => {
    expect(batchMutationResultCounts([
      { id: '1', status: 'success', accountName: 'a', stationName: 's', targetLabel: 'g', occurredAt: '2026-07-18T00:00:00.000Z' },
      { id: '2', status: 'failed', accountName: 'b', stationName: 's', targetLabel: 'g', occurredAt: '2026-07-18T00:00:01.000Z', message: '失败' },
      { id: '3', status: 'skipped', accountName: 'c', stationName: 's', targetLabel: 'g', occurredAt: '2026-07-18T00:00:02.000Z' },
      { id: '4', status: 'success', accountName: 'd', stationName: 's', targetLabel: 'g', occurredAt: '2026-07-18T00:00:03.000Z' }
    ])).toEqual({ success: 2, failed: 1, skipped: 1 })
  })

  it('normalizes the stored account recommendation strategy preference', () => {
    expect(normalizeAccountRecommendationStrategy('all-station')).toBe('all-station')
    expect(normalizeAccountRecommendationStrategy('category-first')).toBe('category-first')
    expect(normalizeAccountRecommendationStrategy('unexpected')).toBe('category-first')
  })

  it('identifies stations managed by the current user for the source wallet tab', () => {
    expect(isAdminManagedStation({ hasAdminToken: true }, { accounts: [] })).toBe(true)
    expect(isAdminManagedStation({ hasAdminToken: false }, { accounts: [{ id: 1, name: 'admin', platform: 'openai', groupIds: [], groups: [], status: 'active' }] })).toBe(true)
    expect(isAdminManagedStation({ hasAdminToken: false }, { accounts: [] })).toBe(false)
  })

  it('uses an explicit station role before legacy account inference', () => {
    const accountSnapshot = { accounts: [{ id: 1, name: 'upstream', platform: 'openai', groupIds: [], groups: [], status: 'active' }] }
    expect(isAdminManagedStation({ hasAdminToken: false, stationRole: 'source' }, accountSnapshot)).toBe(false)
    expect(isPriceRankingStation({ hasAdminToken: false, stationRole: 'source' }, accountSnapshot)).toBe(true)
    expect(isAdminManagedStation({ hasAdminToken: false, stationRole: 'own' }, { accounts: [] })).toBe(true)
  })

  it('keeps admin-managed stations out of the public price ranking source set', () => {
    expect(isPriceRankingStation({ hasAdminToken: true }, { accounts: [] })).toBe(false)
    expect(isPriceRankingStation({ hasAdminToken: false }, { accounts: [{ id: 1, name: 'admin', platform: 'openai', groupIds: [], groups: [], status: 'active' }] })).toBe(false)
    expect(isPriceRankingStation({ hasAdminToken: false }, { accounts: [] })).toBe(true)
  })

  it('keeps an own NewAPI station out of both price ranking and unsupported Sub2API administration', () => {
    const newApiStation = { hasAdminToken: true, stationRole: 'own' as const, adapterType: 'newapi' as const }
    expect(isOwnStation(newApiStation, { accounts: [] })).toBe(true)
    expect(isAdminManagedStation(newApiStation, { accounts: [] })).toBe(false)
    expect(isPriceRankingStation(newApiStation, { accounts: [] })).toBe(false)
    expect(stationAdapterLabel(newApiStation)).toBe('NewAPI')
  })

  it('filters group switch options by search text and platform while preserving sorted order', () => {
    const options = sortedGroupSwitchOptions([
      { id: 1, name: 'OpenAI Fast', platform: 'openai', rateMultiplier: 0.1, pricingAvailable: false },
      { id: 2, name: 'Claude Slow', platform: 'anthropic', rateMultiplier: 0.2, pricingAvailable: false },
      { id: 3, name: 'Claude Cheap', platform: 'anthropic', rateMultiplier: 0.05, pricingAvailable: false }
    ], 10)

    expect(groupSwitchPlatformOptions(options)).toEqual(['anthropic', 'openai'])
    expect(filterGroupSwitchOptions(options, 'claude', 'all').map((option) => option.group.name)).toEqual(['Claude Cheap', 'Claude Slow'])
    expect(filterGroupSwitchOptions(options, '', 'openai').map((option) => option.group.name)).toEqual(['OpenAI Fast'])
    expect(filterGroupSwitchOptions(options, 'claude', 'openai')).toEqual([])
  })

  it('can switch group candidates between current category and all groups', () => {
    const groups = [
      { id: 1, name: 'OpenAI Fast', platform: 'openai', rateMultiplier: 0.1, pricingAvailable: false },
      { id: 2, name: 'Claude Cheap', platform: 'anthropic', rateMultiplier: 0.05, pricingAvailable: false },
      { id: 3, name: 'Gemini Shared', platform: 'gemini', rateMultiplier: 0.2, pricingAvailable: false }
    ]

    expect(groupSwitchCandidateGroups(groups, 'anthropic', 'category').map((group) => group.name)).toEqual(['Claude Cheap'])
    expect(groupSwitchCandidateGroups(groups, 'anthropic', 'all').map((group) => group.name)).toEqual(['OpenAI Fast', 'Claude Cheap', 'Gemini Shared'])
    expect(groupSwitchCandidateGroups(groups, 'all', 'category').map((group) => group.name)).toEqual(['OpenAI Fast', 'Claude Cheap', 'Gemini Shared'])
  })

  it('summarizes group switch multiplier differences before remote submit', () => {
    const groups = [
      { id: 1, name: 'Current', platform: 'openai', rateMultiplier: 0.2, pricingAvailable: false },
      { id: 2, name: 'Cheaper', platform: 'openai', rateMultiplier: 0.1, pricingAvailable: false },
      { id: 3, name: 'Higher', platform: 'openai', rateMultiplier: 0.3, pricingAvailable: false }
    ]

    expect(groupSwitchPreview(groups, [1], [2], 10)).toMatchObject({
      previousLabel: 'Current',
      nextLabel: 'Cheaper',
      previousEffectiveMultiplier: 0.02,
      nextEffectiveMultiplier: 0.01,
      direction: 'cheaper'
    })
    expect(groupSwitchPreview(groups, [1], [3], 10)).toMatchObject({ direction: 'more-expensive' })
    expect(groupSwitchPreview(groups, [1, 2], [3], 10)).toMatchObject({
      previousLabel: 'Current、Cheaper',
      nextLabel: 'Higher',
      direction: 'more-expensive'
    })
  })

  it('builds a clear post-switch success message and merges the refreshed snapshot', () => {
    expect(groupSwitchSuccessText('claude-main', 'OpenAI Fast')).toBe('claude-main 组合已更新为 OpenAI Fast，已刷新站点状态')
    expect(groupSwitchCompletionNotice('claude-main', 'OpenAI Fast', {
      stationId: 'target',
      stationName: 'After',
      health: 'healthy',
      currency: 'USD',
      priceCapability: 'available',
      groups: [],
      accounts: []
    })).toEqual({ kind: 'success', text: 'claude-main 组合已更新为 OpenAI Fast，已刷新站点状态' })
    expect(groupSwitchCompletionNotice('claude-main', 'OpenAI Fast', {
      stationId: 'target',
      stationName: 'After',
      health: 'error',
      errorMessage: '网络连接失败',
      currency: 'USD',
      priceCapability: 'available',
      groups: [],
      accounts: []
    })).toEqual({ kind: 'warning', text: 'claude-main 已提交切组到 OpenAI Fast，但刷新失败，请手动刷新确认' })

    const current: Record<string, StationSnapshot> = {
      old: {
        stationId: 'old',
        stationName: 'Old',
        health: 'healthy',
        balance: 1,
        currency: 'USD',
        priceCapability: 'available',
        groups: [],
        accounts: []
      },
      target: {
        stationId: 'target',
        stationName: 'Before',
        health: 'stale',
        balance: 2,
        currency: 'USD',
        priceCapability: 'disabled',
        groups: [],
        accounts: []
      }
    }
    const next = mergeSnapshotMap(current, {
      stationId: 'target',
      stationName: 'After',
      health: 'healthy',
      balance: 3,
      currency: 'USD',
      priceCapability: 'available',
      groups: [],
      accounts: []
    })

    expect(next.old).toBe(current.old)
    expect(next.target).toMatchObject({ stationName: 'After', health: 'healthy', balance: 3 })
  })
})
