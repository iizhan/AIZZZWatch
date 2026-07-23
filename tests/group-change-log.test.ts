import { describe, expect, it } from 'vitest'
import { accountsForGroup, clearGroupLocalReferences, detectSnapshotChanges, filterGroupChangeEvents, groupChangeFilterCount, groupChangeNotificationSummary, groupChangeRateText, groupChangeTooltip, groupHistoryEvents, groupHistoryTrendPoints, groupRateChangeIcon, groupRateChangeIndicator, latestVisibleGroupChangeFor, normalizeStoredGroupChangeEvents, rankingChangeFilterCount, rowMatchesRankingChangeFilter, searchGroupChangeEvents } from '../src/renderer/src/App'
import type { GroupSnapshot, StationSnapshot } from '../src/shared/types'

function group(input: Pick<GroupSnapshot, 'id' | 'name' | 'platform' | 'rateMultiplier'>): GroupSnapshot {
  return {
    ...input,
    pricingAvailable: false
  }
}

function snapshot(groups: StationSnapshot['groups']): StationSnapshot {
  return {
    stationId: 'station-a',
    stationName: '站点 A',
    health: 'healthy',
    currency: 'USD',
    groups,
    accounts: [],
    lastUpdatedAt: '2026-07-17T12:00:00.000Z',
    priceCapability: 'disabled'
  }
}

describe('group change log helpers', () => {
  it('detects added, removed, cheaper, and more expensive groups', () => {
    const previous = {
      'station-a': snapshot([
        group({ id: 1, name: 'Claude', platform: 'anthropic', rateMultiplier: 0.5 }),
        group({ id: 2, name: 'GPT', platform: 'openai', rateMultiplier: 0.2 }),
        group({ id: 3, name: 'Gemini', platform: 'gemini', rateMultiplier: 0.3 })
      ])
    }
    const next = {
      'station-a': snapshot([
        group({ id: 1, name: 'Claude', platform: 'anthropic', rateMultiplier: 0.6 }),
        group({ id: 2, name: 'GPT', platform: 'openai', rateMultiplier: 0.1 }),
        group({ id: 4, name: 'Grok', platform: 'grok', rateMultiplier: 0.4 })
      ])
    }

    const changes = detectSnapshotChanges(previous, next, '2026-07-17T12:30:00.000Z')

    expect(changes.map((change) => change.kind)).toEqual(['rate-up', 'rate-down', 'added', 'removed'])
    expect(changes.find((change) => change.kind === 'rate-up')).toMatchObject({ groupName: 'Claude', previousRate: 0.5, nextRate: 0.6 })
    expect(changes.find((change) => change.kind === 'rate-down')).toMatchObject({ groupName: 'GPT', previousRate: 0.2, nextRate: 0.1 })
    expect(changes.find((change) => change.kind === 'added')).toMatchObject({ groupName: 'Grok', nextRate: 0.4 })
    expect(changes.find((change) => change.kind === 'removed')).toMatchObject({ groupName: 'Gemini', previousRate: 0.3 })
  })

  it('ignores tiny multiplier jitter and first-seen stations', () => {
    const previous = {
      'station-a': snapshot([group({ id: 1, name: 'Claude', platform: 'anthropic', rateMultiplier: 0.5 })])
    }
    const next = {
      'station-a': snapshot([group({ id: 1, name: 'Claude', platform: 'anthropic', rateMultiplier: 0.5004 })]),
      'station-b': {
        ...snapshot([group({ id: 2, name: 'GPT', platform: 'openai', rateMultiplier: 0.2 })]),
        stationId: 'station-b',
        stationName: '站点 B'
      }
    }

    expect(detectSnapshotChanges(previous, next)).toEqual([])
  })

  it('normalizes persisted change events and drops invalid entries', () => {
    const valid = {
      id: 'event-1',
      kind: 'rate-down',
      stationId: 'station-a',
      stationName: '站点 A',
      groupId: 1,
      groupName: 'Claude',
      platform: 'anthropic',
      previousRate: 0.6,
      nextRate: 0.5,
      occurredAt: '2026-07-17T12:30:00.000Z'
    }

    const events = normalizeStoredGroupChangeEvents([
      valid,
      { ...valid, id: 'bad-kind', kind: 'unknown' },
      { ...valid, id: 'bad-group', groupId: '1' },
      null
    ])

    expect(events).toEqual([valid])
  })

  it('keeps the expanded persisted history without dropping real changes at the old five-hundred-event boundary', () => {
    const many = Array.from({ length: 520 }, (_, index) => ({
      id: `event-${index}`,
      kind: 'added',
      stationId: 'station-a',
      stationName: '站点 A',
      groupId: index,
      groupName: `Group ${index}`,
      platform: 'openai',
      occurredAt: '2026-07-17T12:30:00.000Z'
    }))

    expect(normalizeStoredGroupChangeEvents(many)).toHaveLength(520)
  })

  it('finds the latest visible group change and ignores removed entries', () => {
    const events = [
      {
        id: 'removed-latest',
        kind: 'removed' as const,
        stationId: 'station-a',
        stationName: '站点 A',
        groupId: 1,
        groupName: 'Claude',
        platform: 'anthropic',
        previousRate: 0.6,
        occurredAt: '2026-07-17T12:40:00.000Z'
      },
      {
        id: 'rate-down',
        kind: 'rate-down' as const,
        stationId: 'station-a',
        stationName: '站点 A',
        groupId: 1,
        groupName: 'Claude',
        platform: 'anthropic',
        previousRate: 0.6,
        nextRate: 0.5,
        occurredAt: '2026-07-17T12:30:00.000Z'
      },
      {
        id: 'other-station',
        kind: 'added' as const,
        stationId: 'station-b',
        stationName: '站点 B',
        groupId: 1,
        groupName: 'Claude',
        platform: 'anthropic',
        nextRate: 0.4,
        occurredAt: '2026-07-17T12:20:00.000Z'
      }
    ]

    expect(latestVisibleGroupChangeFor('station-a', 1, events)?.id).toBe('rate-down')
    expect(latestVisibleGroupChangeFor('station-b', 2, events)).toBeUndefined()
  })

  it('builds readable rate change indicators and hover details', () => {
    const rateDown = {
      id: 'rate-down',
      kind: 'rate-down' as const,
      stationId: 'station-a',
      stationName: '站点 A',
      groupId: 1,
      groupName: 'Claude',
      platform: 'anthropic',
      previousRate: 0.6,
      nextRate: 0.5,
      occurredAt: '2026-07-17T12:30:00.000Z'
    }
    const rateUp = { ...rateDown, id: 'rate-up', kind: 'rate-up' as const, previousRate: 0.5, nextRate: 0.6 }
    const added = { ...rateDown, id: 'added', kind: 'added' as const, previousRate: undefined, nextRate: 0.4 }

    expect(groupRateChangeIndicator(rateDown)).toEqual({ tone: 'rate-down', arrow: '↓' })
    expect(groupRateChangeIndicator(rateUp)).toEqual({ tone: 'rate-up', arrow: '↑' })
    expect(groupRateChangeIndicator(added)).toEqual({ tone: 'added', arrow: '+' })
    expect(groupChangeTooltip(rateDown)).toContain('变便宜：0.600x → 0.500x')
    expect(groupChangeTooltip(rateUp)).toContain('变贵：0.500x → 0.600x')
    expect(groupChangeTooltip(added)).toContain('新增：当前 0.400x')
    expect(groupRateChangeIcon(rateDown)).toEqual({ tone: 'rate-down', icon: '📉' })
    expect(groupRateChangeIcon(rateUp)).toEqual({ tone: 'rate-up', icon: '📈' })
    expect(groupRateChangeIcon(added)).toEqual({ tone: 'added', icon: 'sparkles' })
  })

  it('uses only the newest rate direction and time for a group', () => {
    const events = [
      { id: 'up-old', kind: 'rate-up' as const, stationId: 'station-a', stationName: '站点 A', groupId: 1, groupName: 'Claude', platform: 'anthropic', previousRate: 0.5, nextRate: 0.6, occurredAt: '2026-07-17T12:10:00.000Z' },
      { id: 'down', kind: 'rate-down' as const, stationId: 'station-a', stationName: '站点 A', groupId: 1, groupName: 'Claude', platform: 'anthropic', previousRate: 0.6, nextRate: 0.5, occurredAt: '2026-07-17T12:20:00.000Z' },
      { id: 'up-new', kind: 'rate-up' as const, stationId: 'station-a', stationName: '站点 A', groupId: 1, groupName: 'Claude', platform: 'anthropic', previousRate: 0.5, nextRate: 0.7, occurredAt: '2026-07-17T12:30:00.000Z' },
      { id: 'removed', kind: 'removed' as const, stationId: 'station-a', stationName: '站点 A', groupId: 1, groupName: 'Claude', platform: 'anthropic', previousRate: 0.7, occurredAt: '2026-07-17T12:40:00.000Z' }
    ]

    expect(latestVisibleGroupChangeFor('station-a', 1, events)?.id).toBe('up-new')
    expect(latestVisibleGroupChangeFor('station-a', 2, events)).toBeUndefined()
  })

  it('drops persisted changes with an invalid observation time before selecting latest changes', () => {
    const invalid = {
      id: 'invalid-up',
      kind: 'rate-up' as const,
      stationId: 'station-a',
      stationName: '站点 A',
      groupId: 1,
      groupName: 'Claude',
      platform: 'anthropic',
      previousRate: 0.5,
      nextRate: 0.6,
      occurredAt: 'not-a-time'
    }

    expect(normalizeStoredGroupChangeEvents([invalid])).toEqual([])
  })

  it('filters change messages and opens a group-specific history', () => {
    const events = [
      {
        id: 'rate-down-new',
        kind: 'rate-down' as const,
        stationId: 'station-a',
        stationName: '站点 A',
        groupId: 1,
        groupName: 'Claude',
        platform: 'anthropic',
        previousRate: 0.6,
        nextRate: 0.5,
        occurredAt: '2026-07-17T12:50:00.000Z'
      },
      {
        id: 'rate-up-old',
        kind: 'rate-up' as const,
        stationId: 'station-a',
        stationName: '站点 A',
        groupId: 1,
        groupName: 'Claude',
        platform: 'anthropic',
        previousRate: 0.5,
        nextRate: 0.6,
        occurredAt: '2026-07-17T12:30:00.000Z'
      },
      {
        id: 'added-other',
        kind: 'added' as const,
        stationId: 'station-a',
        stationName: '站点 A',
        groupId: 2,
        groupName: 'GPT',
        platform: 'openai',
        nextRate: 0.2,
        occurredAt: '2026-07-17T12:20:00.000Z'
      },
      {
        id: 'removed-other',
        kind: 'removed' as const,
        stationId: 'station-b',
        stationName: '备用站',
        groupId: 9,
        groupName: '废弃 Claude 旧组',
        platform: 'anthropic',
        previousRate: 0.9,
        occurredAt: '2026-07-17T12:10:00.000Z'
      }
    ]

    expect(filterGroupChangeEvents(events, 'rate-down').map((event) => event.id)).toEqual(['rate-down-new'])
    expect(groupChangeFilterCount(events, 'all')).toBe(4)
    expect(groupChangeFilterCount(events, 'added')).toBe(1)
    expect(groupHistoryEvents(events, 'station-a', 1).map((event) => event.id)).toEqual(['rate-down-new', 'rate-up-old'])
    expect(searchGroupChangeEvents(events, '备用').map((event) => event.id)).toEqual(['removed-other'])
    expect(searchGroupChangeEvents(events, '变贵').map((event) => event.id)).toEqual(['rate-up-old'])
    expect(groupChangeRateText(events[0])).toBe('0.600x → 0.500x')
    expect(groupChangeRateText(events[2])).toBe('0.200x')
    expect(groupChangeRateText(events[3])).toBe('0.900x')
  })

  it('builds chronological trend points for the selected group history', () => {
    const events = [
      {
        id: 'newer',
        kind: 'rate-down' as const,
        stationId: 'station-a',
        stationName: '站点 A',
        groupId: 1,
        groupName: 'Claude',
        platform: 'anthropic',
        previousRate: 0.7,
        nextRate: 0.5,
        occurredAt: '2026-07-17T12:50:00.000Z'
      },
      {
        id: 'older',
        kind: 'added' as const,
        stationId: 'station-a',
        stationName: '站点 A',
        groupId: 1,
        groupName: 'Claude',
        platform: 'anthropic',
        nextRate: 0.8,
        occurredAt: '2026-07-17T12:30:00.000Z'
      }
    ]

    expect(groupHistoryTrendPoints(events).map((point) => point.value)).toEqual([0.8, 0.7, 0.5])
  })

  it('maps admin accounts back to the groups they use', () => {
    const accounts = [
      { id: 1, name: 'openai-main', platform: 'openai', groupIds: [10, 11], groups: ['cheap', 'backup'], status: 'active' },
      { id: 2, name: 'claude-main', platform: 'anthropic', groupIds: [12], groups: ['claude'], status: 'active' }
    ]

    expect(accountsForGroup(accounts, 10).map((account) => account.name)).toEqual(['openai-main'])
    expect(accountsForGroup(accounts, 12).map((account) => account.name)).toEqual(['claude-main'])
  })

  it('clears the hidden marker for a removed group without deleting history', () => {
    const events = [
      {
        id: 'removed',
        kind: 'removed' as const,
        stationId: 'station-a',
        stationName: '站点 A',
        groupId: 1,
        groupName: 'Claude',
        platform: 'anthropic',
        previousRate: 0.6,
        occurredAt: '2026-07-17T12:40:00.000Z'
      },
      {
        id: 'rate-up',
        kind: 'rate-up' as const,
        stationId: 'station-a',
        stationName: '站点 A',
        groupId: 1,
        groupName: 'Claude',
        platform: 'anthropic',
        previousRate: 0.5,
        nextRate: 0.6,
        occurredAt: '2026-07-17T12:30:00.000Z'
      },
      {
        id: 'other',
        kind: 'added' as const,
        stationId: 'station-b',
        stationName: '站点 B',
        groupId: 1,
        groupName: 'Claude',
        platform: 'anthropic',
        nextRate: 0.4,
        occurredAt: '2026-07-17T12:20:00.000Z'
      }
    ]

    const next = clearGroupLocalReferences(['station-a:1', 'station-b:1'], 'station-a', 1)

    expect(next.hiddenGroupKeys).toEqual(['station-b:1'])
    expect(events.map((event) => event.id)).toEqual(['removed', 'rate-up', 'other'])
  })

  it('filters price ranking by each group latest persisted rate direction', () => {
    const events = [
      { id: 'newest-down', kind: 'rate-down' as const, stationId: 'station-a', stationName: '站点 A', groupId: 1, groupName: 'Claude', platform: 'anthropic', previousRate: 0.03, nextRate: 0.02, occurredAt: '2026-07-21T08:30:00.000Z' },
      { id: 'older-up', kind: 'rate-up' as const, stationId: 'station-a', stationName: '站点 A', groupId: 1, groupName: 'Claude', platform: 'anthropic', previousRate: 0.02, nextRate: 0.03, occurredAt: '2026-07-21T08:00:00.000Z' },
      { id: 'up', kind: 'rate-up' as const, stationId: 'station-b', stationName: '站点 B', groupId: 2, groupName: 'GPT', platform: 'openai', previousRate: 0.01, nextRate: 0.02, occurredAt: '2026-07-21T08:20:00.000Z' }
    ]
    const rows = [
      { stationId: 'station-a', groupId: 1 },
      { stationId: 'station-a', groupId: 1 },
      { stationId: 'station-b', groupId: 2 }
    ]

    expect(rowMatchesRankingChangeFilter(rows[0], events, 'rate-down')).toBe(true)
    expect(rowMatchesRankingChangeFilter(rows[0], events, 'rate-up')).toBe(false)
    expect(rowMatchesRankingChangeFilter(rows[2], events, 'rate-up')).toBe(true)
    expect(rankingChangeFilterCount(rows, events, 'all')).toBe(2)
    expect(rankingChangeFilterCount(rows, events, 'rate-down')).toBe(1)
    expect(rankingChangeFilterCount(rows, events, 'rate-up')).toBe(1)

    expect(latestVisibleGroupChangeFor('station-a', 1, [...events].reverse())?.id).toBe('newest-down')
  })

  it('keeps legacy rate events without a baseline out of display, filters, and notifications', () => {
    const events = [
      { id: 'legacy', kind: 'rate-up' as const, stationId: 'station-a', stationName: '站点 A', groupId: 1, groupName: 'Claude', platform: 'anthropic', nextRate: 0.03, occurredAt: '2026-07-21T08:30:00.000Z' }
    ]
    const row = { stationId: 'station-a', groupId: 1 }

    expect(latestVisibleGroupChangeFor('station-a', 1, events)).toBeUndefined()
    expect(rowMatchesRankingChangeFilter(row, events, 'rate-up')).toBe(false)
    expect(rankingChangeFilterCount([row], events, 'rate-up')).toBe(0)
    expect(groupChangeNotificationSummary(events).text).toBeUndefined()
  })

  it('summarizes only unnotified rate increases and decreases', () => {
    const events = [
      { id: 'down', kind: 'rate-down' as const, stationId: 'station-a', stationName: '站点 A', groupId: 1, groupName: 'Claude', platform: 'anthropic', previousRate: 0.03, nextRate: 0.02, occurredAt: '2026-07-21T08:30:00.000Z' },
      { id: 'up', kind: 'rate-up' as const, stationId: 'station-b', stationName: '站点 B', groupId: 2, groupName: 'GPT', platform: 'openai', previousRate: 0.01, nextRate: 0.02, occurredAt: '2026-07-21T08:20:00.000Z' },
      { id: 'old-added', kind: 'added' as const, stationId: 'station-c', stationName: '站点 C', groupId: 3, groupName: 'Gemini', platform: 'gemini', nextRate: 0.02, occurredAt: '2026-07-21T08:10:00.000Z' }
    ]

    expect(groupChangeNotificationSummary(events, '2026-07-21T08:15:00.000Z')).toMatchObject({
      rateUp: 1,
      rateDown: 1,
      newestAt: '2026-07-21T08:30:00.000Z',
      text: '发现 1 个涨价、1 个降价，可在价格榜筛选查看。'
    })
    expect(groupChangeNotificationSummary(events, '2026-07-21T09:00:00.000Z').text).toBeUndefined()
    expect(groupChangeNotificationSummary(events, 'not-a-time').text).toBe('发现 1 个涨价、1 个降价，可在价格榜筛选查看。')
  })
})
