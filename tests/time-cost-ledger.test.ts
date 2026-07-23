import { describe, expect, it } from 'vitest'
import {
  appendAccountUpstreamMappingEvents,
  appendObservedGroupRateChanges,
  appendProfitUsageArchiveDay,
  appendTimeCostSnapshot,
  buildProfitIntervalReport,
  calculateTemporalUsageCost,
  emptyTimeCostLedger,
  extractStrictProfitUsageRecords,
  extractStrictUsageEntries,
  resolveSourceGroupAtTime
} from '../src/shared/time-cost-ledger'
import type { AccountUpstreamMapping, TimeCostLedger, UsageLedgerEntry } from '../src/shared/types'

function usageEntry(occurredAt: string, id = 'usage-1'): UsageLedgerEntry {
  return { id, accountStationId: 'mine', accountId: 7, usageAmount: 100, occurredAt }
}

function ledgerWithRateChange(): TimeCostLedger {
  return {
    rateObservations: [
      { id: 'rate-new', stationId: 'source', groupId: 11, rateMultiplier: 0.04, rechargeRatio: 1, effectiveMultiplier: 0.04, observedAt: '2026-07-21T11:50:00.000Z', timeSource: 'observed' },
      { id: 'rate-old', stationId: 'source', groupId: 11, rateMultiplier: 0.02, rechargeRatio: 1, effectiveMultiplier: 0.02, observedAt: '2026-07-21T11:00:00.000Z', timeSource: 'observed' }
    ],
    sourceKeyGroupObservations: [
      { id: 'key-group', stationId: 'source', sourceKeyId: 'key-a', groupIds: [11], observedAt: '2026-07-21T11:00:00.000Z', timeSource: 'observed' }
    ],
    mappingEvents: [
      { id: 'mapping', accountStationId: 'mine', accountId: 7, sourceStationId: 'source', sourceKeyId: 'key-a', sourceGroupId: 11, effectiveAt: '2026-07-21T11:00:00.000Z', timeSource: 'observed' }
    ],
    usageEntries: [],
    usageCoverage: [],
    profitUsageRecords: [],
    profitUsageCoverage: []
  }
}

describe('time cost ledger', () => {
  it('uses the persisted rate baseline across restart without creating bootstrap changes', () => {
    const firstSnapshot = {
      groups: [{ id: 11, name: 'OpenAI', platform: 'openai', rateMultiplier: 0.02, pricingAvailable: false }],
      lastSuccessAt: '2026-07-21T11:00:00.000Z'
    }
    const baseline = appendTimeCostSnapshot(emptyTimeCostLedger(), { stationId: 'source', rechargeRatio: 1, snapshot: firstSnapshot })
    expect(appendObservedGroupRateChanges([], baseline, 'source', 'Source', firstSnapshot.groups, '2026-07-21T11:00:00.000Z')).toEqual([])

    const unchangedAfterRestart = appendObservedGroupRateChanges([], baseline, 'source', 'Source', firstSnapshot.groups, '2026-07-21T12:00:00.000Z')
    expect(unchangedAfterRestart).toEqual([])

    const changed = appendObservedGroupRateChanges([], baseline, 'source', 'Source', [{ ...firstSnapshot.groups[0], rateMultiplier: 0.03 }], '2026-07-21T12:05:00.000Z')
    expect(changed).toMatchObject([{ kind: 'rate-up', previousRate: 0.02, nextRate: 0.03, occurredAt: '2026-07-21T12:05:00.000Z' }])
  })

  it('uses the old multiplier before the observed change boundary', () => {
    const result = calculateTemporalUsageCost(ledgerWithRateChange(), usageEntry('2026-07-21T11:40:00.000Z'))

    expect(result).toMatchObject({ state: 'exact', effectiveMultiplier: 0.02, cost: 2 })
  })

  it('uses the new multiplier at the exact change boundary', () => {
    const result = calculateTemporalUsageCost(ledgerWithRateChange(), usageEntry('2026-07-21T11:50:00.000Z'))

    expect(result).toMatchObject({ state: 'exact', effectiveMultiplier: 0.04, cost: 4 })
  })

  it('freezes the recharge ratio with the observed multiplier', () => {
    const ledger = ledgerWithRateChange()
    ledger.rateObservations = [
      { id: 'ratio-new', stationId: 'source', groupId: 11, rateMultiplier: 0.1, rechargeRatio: 10, effectiveMultiplier: 0.01, observedAt: '2026-07-21T12:00:00.000Z', timeSource: 'observed' },
      { id: 'ratio-old', stationId: 'source', groupId: 11, rateMultiplier: 0.02, rechargeRatio: 1, effectiveMultiplier: 0.02, observedAt: '2026-07-21T11:00:00.000Z', timeSource: 'observed' }
    ]

    expect(calculateTemporalUsageCost(ledger, usageEntry('2026-07-21T11:40:00.000Z'))).toMatchObject({ effectiveMultiplier: 0.02, cost: 2 })
    expect(calculateTemporalUsageCost(ledger, usageEntry('2026-07-21T12:10:00.000Z', 'usage-2'))).toMatchObject({ effectiveMultiplier: 0.01, cost: 1 })
  })

  it('returns unknown before the first local observation', () => {
    const result = calculateTemporalUsageCost(ledgerWithRateChange(), usageEntry('2026-07-21T10:59:59.000Z'))

    expect(result).toMatchObject({ state: 'unknown' })
  })

  it('does not choose the lowest group when an upstream key belongs to multiple groups', () => {
    const ledger = ledgerWithRateChange()
    ledger.sourceKeyGroupObservations[0] = { ...ledger.sourceKeyGroupObservations[0], groupIds: [11, 12] }

    expect(calculateTemporalUsageCost(ledger, usageEntry('2026-07-21T11:40:00.000Z'))).toMatchObject({ state: 'ambiguous' })
  })

  it('resolves a key group switch by its observation time', () => {
    const ledger = ledgerWithRateChange()
    ledger.sourceKeyGroupObservations.push({ id: 'key-group-new', stationId: 'source', sourceKeyId: 'key-a', groupIds: [12], observedAt: '2026-07-21T12:00:00.000Z', timeSource: 'observed' })

    expect(resolveSourceGroupAtTime(ledger, 'source', 'key-a', 11, '2026-07-21T11:59:59.000Z')).toMatchObject({ state: 'exact', groupId: 11 })
    expect(resolveSourceGroupAtTime(ledger, 'source', 'key-a', 11, '2026-07-21T12:00:00.000Z')).toMatchObject({ state: 'exact', groupId: 12 })
  })

  it('rejects usage records without a stable id, account id, timestamp, or numeric usage', () => {
    const entries = extractStrictUsageEntries('mine', [
      { id: 'ok', account_id: 7, created_at: '2026-07-21T11:40:00.000Z', usage: 20 },
      { account_id: 7, created_at: '2026-07-21T11:40:00.000Z', usage: 20 },
      { user: { id: 'user-7' }, account_id: 7, created_at: '2026-07-21T11:40:00.000Z', usage: 20 },
      { id: 'no-account', created_at: '2026-07-21T11:40:00.000Z', usage: 20 },
      { id: 'no-time', account_id: 7, usage: 20 },
      { id: 'no-amount', account_id: 7, created_at: '2026-07-21T11:40:00.000Z' }
    ])

    expect(entries).toEqual([{ id: 'mine:ok', accountStationId: 'mine', accountId: 7, usageAmount: 20, occurredAt: '2026-07-21T11:40:00.000Z' }])
  })

  it('deduplicates the same main-process usage entry across polls', () => {
    const snapshot = {
      groups: [],
      lastSuccessAt: '2026-07-21T12:00:00.000Z'
    }
    const usageEntries = [{ id: 'mine:same-record', accountStationId: 'mine', accountId: 7, usageAmount: 20, occurredAt: '2026-07-21T11:40:00.000Z' }]
    const first = appendTimeCostSnapshot(emptyTimeCostLedger(), { stationId: 'mine', rechargeRatio: 1, snapshot, usageEntries })
    const next = appendTimeCostSnapshot(first, { stationId: 'mine', rechargeRatio: 1, snapshot, usageEntries })

    expect(next.usageEntries).toHaveLength(1)
  })

  it('archives strict profit records by stable id and replaces the same Shanghai day', () => {
    const otherDay = appendProfitUsageArchiveDay(emptyTimeCostLedger(), [{
      id: 'mine:other-day', accountStationId: 'mine', accountId: 7, sellingGroupId: 3,
      occurredAt: '2026-07-22T00:00:00.000Z', revenue: 4, upstreamBaseCost: 100, accountRateMultiplier: 0.03
    }], {
      accountStationId: 'mine', date: '2026-07-22', fetchedAt: '2026-07-22T00:00:00.000Z',
      state: 'complete', pagesFetched: 1, recordsSeen: 1, acceptedEntries: 1
    })
    const first = appendProfitUsageArchiveDay(otherDay, [{
      id: 'mine:profit-1', accountStationId: 'mine', accountId: 7, sellingGroupId: 3,
      occurredAt: '2026-07-21T11:40:00.000Z', revenue: 5, upstreamBaseCost: 100, accountRateMultiplier: 0.03
    }, {
      id: 'mine:stale-profit', accountStationId: 'mine', accountId: 7, sellingGroupId: 3,
      occurredAt: '2026-07-21T12:00:00.000Z', revenue: 9, upstreamBaseCost: 100, accountRateMultiplier: 0.03
    }], {
      accountStationId: 'mine', date: '2026-07-21', fetchedAt: '2026-07-22T00:00:00.000Z',
      state: 'page-limit', pagesFetched: 20, recordsSeen: 2000, acceptedEntries: 2000
    })
    const next = appendProfitUsageArchiveDay(first, [{
      id: 'mine:profit-1', accountStationId: 'mine', accountId: 7, sellingGroupId: 3,
      occurredAt: '2026-07-21T11:40:00.000Z', revenue: 6, upstreamBaseCost: 100, accountRateMultiplier: 0.03
    }], {
      accountStationId: 'mine', date: '2026-07-21', fetchedAt: '2026-07-22T00:01:00.000Z',
      state: 'complete', pagesFetched: 2, recordsSeen: 150, acceptedEntries: 150
    })

    expect(next.profitUsageRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'mine:profit-1', revenue: 6 }),
      expect.objectContaining({ id: 'mine:other-day', revenue: 4 })
    ]))
    expect(next.profitUsageRecords).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'mine:stale-profit' })]))
    expect(next.profitUsageCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-07-21', state: 'complete', pagesFetched: 2 }),
      expect.objectContaining({ date: '2026-07-22', state: 'complete', pagesFetched: 1 })
    ]))
  })

  it('keeps profit records strict and does not retain unrelated request fields', () => {
    const records = extractStrictProfitUsageRecords('mine', [{
      id: 'profit-1',
      account_id: 7,
      group_id: 3,
      created_at: '2026-07-21T11:40:00.000Z',
      actual_cost: 5,
      account_stats_cost: 100,
      account_rate_multiplier: 0.03,
      user_id: 99,
      username: 'internal-user-must-not-persist',
      api_key: 'must-not-leave-main',
      user: { id: 99 }
    }, {
      id: 'missing-revenue', account_id: 7, created_at: '2026-07-21T11:40:00.000Z', total_cost: 100
    }])

    expect(records).toEqual([{
      id: 'mine:profit-1', accountStationId: 'mine', accountId: 7, sellingGroupId: 3,
      userId: 99, occurredAt: '2026-07-21T11:40:00.000Z', revenue: 5, upstreamBaseCost: 100, accountRateMultiplier: 0.03
    }])
    expect(JSON.stringify(records)).not.toContain('must-not-leave-main')
    expect(JSON.stringify(records)).not.toContain('internal-user-must-not-persist')
  })

  it('excludes marked internal users from operating profit while retaining an internal consumption summary', () => {
    const records = extractStrictProfitUsageRecords('mine', [
      { id: 'internal', account_id: 7, user_id: 99, group_id: 3, created_at: '2026-07-21T11:40:00.000Z', actual_cost: 5, total_cost: 100, account_rate_multiplier: 0.03 },
      { id: 'external', account_id: 7, user_id: 100, group_id: 3, created_at: '2026-07-21T11:40:00.000Z', actual_cost: 7, total_cost: 100, account_rate_multiplier: 0.02 },
      { id: 'legacy', account_id: 7, group_id: 3, created_at: '2026-07-21T11:40:00.000Z', actual_cost: 3, total_cost: 100, account_rate_multiplier: 0.02 }
    ])

    const report = buildProfitIntervalReport({
      stationId: 'mine', startAt: '2026-07-21T11:00:00.000Z', endAt: '2026-07-21T12:00:00.000Z', timezone: 'Asia/Shanghai', granularity: 'hour'
    }, records, {
      accountStationId: 'mine', fetchedAt: '2026-07-21T12:00:00.000Z', state: 'complete', pagesFetched: 1, recordsSeen: 3, acceptedEntries: 3
    }, ledgerWithRateChange(), { internalUserKeys: new Set(['mine:99']) })

    expect(report.totals).toMatchObject({ requests: 2, revenue: 10, accountCost: 4, upstreamCost: 4, attributableRevenue: 6, lossRequests: 0 })
    expect(report.internalUsage).toEqual({ requests: 1, stationCharge: 5, upstreamCost: 2, unresolvedUpstreamRequests: 0 })
    expect(report.unidentifiedUserRequests).toBe(1)
    expect(report.buckets).toMatchObject([{ requests: 2, revenue: 10 }])
  })

  it('excludes configured public-welfare selling groups from operating totals while retaining group reference totals', () => {
    const records = extractStrictProfitUsageRecords('mine', [
      { id: 'welfare', account_id: 7, group_id: 3, created_at: '2026-07-21T11:40:00.000Z', actual_cost: 5, total_cost: 100, account_rate_multiplier: 0.03 },
      { id: 'operating', account_id: 7, group_id: 4, created_at: '2026-07-21T11:45:00.000Z', actual_cost: 7, total_cost: 100, account_rate_multiplier: 0.03 }
    ])
    const report = buildProfitIntervalReport({
      stationId: 'mine', startAt: '2026-07-21T11:00:00.000Z', endAt: '2026-07-21T12:00:00.000Z', timezone: 'Asia/Shanghai', granularity: 'hour'
    }, records, {
      accountStationId: 'mine', fetchedAt: '2026-07-21T12:00:00.000Z', state: 'complete', pagesFetched: 1, recordsSeen: 2, acceptedEntries: 2
    }, ledgerWithRateChange(), { operatingExcludedGroupKeys: new Set(['mine:3']) })

    expect(report.totals).toMatchObject({ requests: 1, revenue: 7, upstreamCost: 2, attributableRevenue: 5 })
    expect(report.publicWelfareUsage).toEqual({ requests: 1, stationCharge: 5, upstreamCost: 2, unresolvedUpstreamRequests: 0 })
    expect(report.publicWelfareGroups).toEqual([{ sellingGroupId: 3, requests: 1, revenue: 5, upstreamCost: 2, unresolvedUpstreamRequests: 0 }])
  })

  it('calculates interval revenue with the upstream multiplier at each request time', () => {
    const records = extractStrictProfitUsageRecords('mine', [
      { id: 'before', account_id: 7, group_id: 3, created_at: '2026-07-21T11:40:00.000Z', actual_cost: 5, account_stats_cost: 100, account_rate_multiplier: 0.03 },
      { id: 'at-change', account_id: 7, group_id: 3, created_at: '2026-07-21T11:50:00.000Z', actual_cost: 5, total_cost: 100, account_rate_multiplier: 0.03 },
      { id: 'missing-map', account_id: 8, group_id: 3, created_at: '2026-07-21T11:55:00.000Z', actual_cost: 7, total_cost: 100, account_rate_multiplier: 0.02 }
    ])
    const report = buildProfitIntervalReport({
      stationId: 'mine', startAt: '2026-07-21T11:40:00.000Z', endAt: '2026-07-21T12:00:00.000Z', timezone: 'Asia/Shanghai', granularity: 'hour'
    }, records, {
      accountStationId: 'mine', fetchedAt: '2026-07-21T12:00:00.000Z', state: 'complete', pagesFetched: 1, recordsSeen: 3, acceptedEntries: 3
    }, ledgerWithRateChange())

    expect(report.totals).toMatchObject({ requests: 3, revenue: 17, accountCost: 8, upstreamCost: 6, attributableRevenue: 4, unattributedRevenue: 7, lossRequests: 0 })
    expect(report.buckets).toMatchObject([{ key: '2026-07-21 19:00', requests: 3, upstreamCost: 6 }])
    expect(report.accounts.find((item) => item.accountId === 7)).toMatchObject({ requests: 2, accountCost: 6, upstreamCost: 6, attributableRevenue: 4 })
    expect(report.accounts.find((item) => item.accountId === 8)).toMatchObject({ requests: 1, upstreamCost: 0, unattributedRevenue: 7 })
  })

  it('uses a left-closed right-open range boundary for profit records', () => {
    const records = extractStrictProfitUsageRecords('mine', [
      { id: 'left', account_id: 7, created_at: '2026-07-21T11:40:00.000Z', actual_cost: 4, total_cost: 100, account_rate_multiplier: 0.02 },
      { id: 'right', account_id: 7, created_at: '2026-07-21T11:50:00.000Z', actual_cost: 4, total_cost: 100, account_rate_multiplier: 0.02 }
    ])
    const report = buildProfitIntervalReport({
      stationId: 'mine', startAt: '2026-07-21T11:40:00.000Z', endAt: '2026-07-21T11:50:00.000Z', timezone: 'Asia/Shanghai', granularity: 'day'
    }, records, {
      accountStationId: 'mine', fetchedAt: '2026-07-21T12:00:00.000Z', state: 'complete', pagesFetched: 1, recordsSeen: 2, acceptedEntries: 2
    }, ledgerWithRateChange())

    expect(report.totals.requests).toBe(1)
    expect(report.totals.revenue).toBe(4)
  })

  it('keeps exempt-account revenue and requests while excluding both cost measures', () => {
    const records = extractStrictProfitUsageRecords('mine', [
      { id: 'exempt', account_id: 7, group_id: 3, created_at: '2026-07-21T11:40:00.000Z', actual_cost: 5, total_cost: 100, account_rate_multiplier: 0.03 },
      { id: 'metered', account_id: 8, group_id: 3, created_at: '2026-07-21T11:50:00.000Z', actual_cost: 7, total_cost: 100, account_rate_multiplier: 0.02 }
    ])
    const report = buildProfitIntervalReport({
      stationId: 'mine', startAt: '2026-07-21T11:40:00.000Z', endAt: '2026-07-21T12:00:00.000Z', timezone: 'Asia/Shanghai', granularity: 'hour'
    }, records, {
      accountStationId: 'mine', fetchedAt: '2026-07-21T12:00:00.000Z', state: 'complete', pagesFetched: 1, recordsSeen: 2, acceptedEntries: 2
    }, ledgerWithRateChange(), { exemptAccountKeys: new Set(['mine:7']) })

    expect(report.totals).toMatchObject({ requests: 2, revenue: 12, exemptRequests: 1, exemptRevenue: 5, accountCost: 2, upstreamCost: 0, attributableRevenue: 5, unattributedRevenue: 7, lossRequests: 0 })
    expect(report.accounts.find((item) => item.accountId === 7)).toMatchObject({ requests: 1, revenue: 5, exemptRequests: 1, exemptRevenue: 5, accountCost: 0, upstreamCost: 0, attributableRevenue: 5, lossRequests: 0 })
    expect(report.accounts.find((item) => item.accountId === 8)).toMatchObject({ requests: 1, exemptRequests: 0, accountCost: 2, upstreamCost: 0, attributableRevenue: 0, unattributedRevenue: 7 })
  })

  it('keeps the old and new upstream mapping in separate time periods', () => {
    const first: AccountUpstreamMapping[] = [{ accountStationId: 'mine', accountId: 7, sourceStationId: 'source-a', sourceGroupId: 11, sourceKeyId: 'key-a', updatedAt: '2026-07-21T11:00:00.000Z' }]
    const second: AccountUpstreamMapping[] = [{ accountStationId: 'mine', accountId: 7, sourceStationId: 'source-b', sourceGroupId: 22, sourceKeyId: 'key-b', updatedAt: '2026-07-21T12:00:00.000Z' }]
    const ledger = appendAccountUpstreamMappingEvents(emptyTimeCostLedger(), [], first, '2026-07-21T11:00:00.000Z')
    const changed = appendAccountUpstreamMappingEvents(ledger, first, second, '2026-07-21T12:00:00.000Z')

    expect(changed.mappingEvents).toHaveLength(2)
    expect(changed.mappingEvents.find((event) => event.effectiveAt === '2026-07-21T11:00:00.000Z')).toMatchObject({ sourceStationId: 'source-a', sourceKeyId: 'key-a' })
    expect(changed.mappingEvents.find((event) => event.effectiveAt === '2026-07-21T12:00:00.000Z')).toMatchObject({ sourceStationId: 'source-b', sourceKeyId: 'key-b' })
  })
})
