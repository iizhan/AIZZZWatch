import type {
  AccountUpstreamMapping,
  AccountUpstreamMappingEvent,
  CostRateObservation,
  GroupChangeEvent,
  GroupSnapshot,
  ProfitAccountSummary,
  PublicWelfareGroupSummary,
  ProfitIntervalBucket,
  ProfitIntervalQuery,
  ProfitIntervalReport,
  ProfitArchiveDayCoverage,
  ProfitUsageRecord,
  SourceKeyGroupObservation,
  StationSnapshot,
  TimeCostLedger,
  UsageLedgerCoverage,
  UsageLedgerEntry
} from './types'

const rateObservationLimit = 20_000
const keyGroupObservationLimit = 20_000
const mappingEventLimit = 20_000
const usageEntryLimit = 50_000
const profitUsageRecordLimit = 50_000
const profitUsageCoverageLimit = 2_000
const usageCoverageLimit = 2_000
const groupChangeEventLimit = 50_000
const rateChangeTolerance = 0.0005

type Timestamped = { observedAt?: string; effectiveAt?: string; occurredAt?: string }

export type TemporalCostResolutionState = 'exact' | 'unknown' | 'ambiguous'

export interface TemporalUsageCost {
  entry: UsageLedgerEntry
  state: TemporalCostResolutionState
  effectiveMultiplier?: number
  cost?: number
  reason?: string
}

export interface TemporalUsageCostSummary {
  exactEntries: number
  unknownEntries: number
  ambiguousEntries: number
  totalCost?: number
  latestObservedAt?: string
}

/**
 * Local history that survives after its live station configuration is gone.
 * It is deliberately read-only: a record here is not evidence that a newly
 * added station is the same remote station.
 */
export interface OrphanedLocalHistorySummary {
  stationId: string
  stationName?: string
  groupChangeCount: number
  rateObservationCount: number
  sourceKeyObservationCount: number
  usageEntryCount: number
  profitUsageRecordCount: number
  lastObservedAt?: string
  recentGroupChanges: GroupChangeEvent[]
  recentRateObservations: CostRateObservation[]
}

export interface TimeCostSnapshotInput {
  stationId: string
  rechargeRatio: number
  snapshot: Pick<StationSnapshot, 'groups' | 'sourceKeys' | 'adminConsole' | 'lastSuccessAt' | 'lastUpdatedAt'>
  usageEntries?: UsageLedgerEntry[]
  usageCoverage?: UsageLedgerCoverage
  observedAt?: string
}

export interface ProfitIntervalReportOptions {
  /** Current local accounting choice. It intentionally applies to every queried interval. */
  exemptAccountKeys?: ReadonlySet<string>
  /** Local-only internal users whose requests never enter operating profit. */
  internalUserKeys?: ReadonlySet<string>
  /** Selling-group keys (`stationId:groupId`) excluded from operating totals. */
  operatingExcludedGroupKeys?: ReadonlySet<string>
}

function isFinitePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidDate(value: string | undefined): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function compareIsoDescending<T extends Timestamped>(left: T, right: T): number {
  const leftAt = left.observedAt ?? left.effectiveAt ?? left.occurredAt ?? ''
  const rightAt = right.observedAt ?? right.effectiveAt ?? right.occurredAt ?? ''
  return rightAt.localeCompare(leftAt)
}

function effectiveRate(group: GroupSnapshot): number | undefined {
  const value = group.userRateMultiplier ?? group.rateMultiplier
  return isFiniteNumber(value) && value >= 0 ? value : undefined
}

function normalizedGroupIds(groupIds: number[]): number[] {
  return [...new Set(groupIds.filter(isFinitePositiveInteger))].sort((left, right) => left - right)
}

function sameNumberArray(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isSecretLike(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/bearer\s+/i.test(trimmed) || /^sk-[a-z0-9_-]{16,}/i.test(trimmed) || /^eyJ[a-z0-9_-]+\./i.test(trimmed)) return true
  return trimmed.length > 160 && !/\s/.test(trimmed)
}

function safeIdentifier(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const normalized = String(value).trim()
  if (!normalized || normalized.length > maxLength || isSecretLike(normalized)) return undefined
  return normalized
}

function flattenRecord(record: Record<string, unknown>, prefix = '', depth = 0): Record<string, unknown> {
  const flattened: Record<string, unknown> = {}
  if (depth > 2) return flattened
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key
    flattened[path] = value
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(flattened, flattenRecord(value as Record<string, unknown>, path, depth + 1))
    }
  }
  return flattened
}

function normalizedFieldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function valuesForAliases(record: Record<string, unknown>, aliases: string[]): unknown[] {
  const directValues = aliases
    .filter((alias) => Object.prototype.hasOwnProperty.call(record, alias))
    .map((alias) => record[alias])
  const flattened = flattenRecord(record)
  const nestedValues: unknown[] = []
  for (const [path, value] of Object.entries(flattened)) {
    const name = normalizedFieldName(path.split('.').at(-1) ?? path)
    // A nested generic `id` often identifies a user, channel, or model rather
    // than the usage event. Only an explicit top-level id is accepted here.
    if (aliases.includes(name) && (name !== 'id' || !path.includes('.'))) nestedValues.push(value)
  }
  return [...directValues, ...nestedValues]
}

function firstMatchingValue<T>(values: unknown[], normalize: (value: unknown) => T | undefined): T | undefined {
  for (const value of values) {
    const normalized = normalize(value)
    if (normalized !== undefined) return normalized
  }
  return undefined
}

function numericValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : undefined
  return isFiniteNumber(parsed) && parsed >= 0 ? parsed : undefined
}

function integerValue(value: unknown): number | undefined {
  const parsed = numericValue(value)
  return parsed !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function timestampValue(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1_000 : value
    const date = new Date(milliseconds)
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
  }
  if (typeof value !== 'string' || !value.trim()) return undefined
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function shanghaiCalendarDate(value: string): string | undefined {
  if (!isValidDate(value)) return undefined
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

const usageIdAliases = ['id', 'usageid', 'recordid', 'logid', 'requestid', 'usageeventid', 'billid']
const usageAccountAliases = ['accountid', 'account', 'channelaccountid', 'channelaccount']
const usageGroupAliases = ['groupid', 'group']
const usageTimeAliases = ['occurredat', 'createdat', 'usedat', 'requesttime', 'timestamp', 'time', 'datetime']
const usageAmountAliases = ['usageamount', 'usedquota', 'quota', 'usage', 'used', 'consumed', 'consume', 'amount', 'cost', 'totalcost', 'actualcost', 'accountstatscost', 'fee', 'spent']

/**
 * Extract only records that can be de-duplicated and placed on one side of a
 * local observation boundary. Aggregates intentionally do not enter this ledger.
 */
export function extractStrictUsageEntries(stationId: string, records: Record<string, unknown>[] | undefined): UsageLedgerEntry[] {
  const entries = new Map<string, UsageLedgerEntry>()
  for (const record of records ?? []) {
    const externalId = firstMatchingValue(valuesForAliases(record, usageIdAliases), safeIdentifier)
    const accountId = firstMatchingValue(valuesForAliases(record, usageAccountAliases), integerValue)
    const occurredAt = firstMatchingValue(valuesForAliases(record, usageTimeAliases), timestampValue)
    const usageAmount = firstMatchingValue(valuesForAliases(record, usageAmountAliases), numericValue)
    if (!externalId || accountId === undefined || !occurredAt || usageAmount === undefined) continue
    const sellingGroupId = firstMatchingValue(valuesForAliases(record, usageGroupAliases), integerValue)
    const id = `${stationId}:${externalId}`
    entries.set(id, { id, accountStationId: stationId, accountId, sellingGroupId, usageAmount, occurredAt })
  }
  return [...entries.values()]
}

function directRecordNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  return firstMatchingValue(keys.map((key) => record[key]), numericValue)
}

function directRecordPositiveInteger(record: Record<string, unknown>, keys: string[]): number | undefined {
  return firstMatchingValue(keys.map((key) => record[key]), integerValue)
}

function directRecordTimestamp(record: Record<string, unknown>, keys: string[]): string | undefined {
  return firstMatchingValue(keys.map((key) => record[key]), timestampValue)
}

/**
 * Reduce administrator usage rows to the exact accounting inputs needed for a
 * range report. This deliberately accepts explicit Sub2API fields only; a
 * generic nested `cost` or `id` can refer to a model, user, or channel.
 */
export function extractStrictProfitUsageRecords(stationId: string, records: Record<string, unknown>[] | undefined): ProfitUsageRecord[] {
  const entries = new Map<string, ProfitUsageRecord>()
  for (const record of records ?? []) {
    const externalId = safeIdentifier(record.id)
    const accountId = directRecordPositiveInteger(record, ['account_id', 'accountId'])
    const occurredAt = directRecordTimestamp(record, ['created_at', 'createdAt'])
    const revenue = directRecordNumber(record, ['actual_cost', 'actualCost'])
    const upstreamBaseCost = directRecordNumber(record, ['account_stats_cost', 'accountStatsCost'])
      ?? directRecordNumber(record, ['total_cost', 'totalCost'])
    const accountRateMultiplier = directRecordNumber(record, ['account_rate_multiplier', 'accountRateMultiplier']) ?? 1
    if (!externalId || accountId === undefined || !occurredAt || revenue === undefined || upstreamBaseCost === undefined || accountRateMultiplier < 0) continue
    const sellingGroupId = directRecordPositiveInteger(record, ['group_id', 'groupId'])
    const userId = directRecordPositiveInteger(record, ['user_id', 'userId'])
    const id = `${stationId}:${externalId}`
    entries.set(id, { id, accountStationId: stationId, accountId, userId, sellingGroupId, occurredAt, revenue, upstreamBaseCost, accountRateMultiplier })
  }
  return [...entries.values()]
}

function shanghaiBucket(occurredAt: string, granularity: ProfitIntervalQuery['granularity']): Pick<ProfitIntervalBucket, 'key' | 'label'> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(occurredAt))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const date = shanghaiCalendarDate(occurredAt) ?? `${values.year}-${values.month}-${values.day}`
  if (granularity === 'day') return { key: date, label: date }
  const hour = values.hour ?? '00'
  return { key: `${date} ${hour}:00`, label: `${date} ${hour}:00` }
}

function emptyProfitTotals(): Omit<ProfitIntervalBucket, 'key' | 'label'> {
  return { requests: 0, revenue: 0, exemptRequests: 0, exemptRevenue: 0, accountCost: 0, upstreamCost: 0, attributableRevenue: 0, unattributedRevenue: 0, lossRequests: 0 }
}

function addProfitRecord(
  target: Omit<ProfitIntervalBucket, 'key' | 'label'>,
  record: ProfitUsageRecord,
  upstreamCost: number | undefined,
  exempt: boolean
): void {
  target.requests += 1
  target.revenue += record.revenue
  if (exempt) {
    target.exemptRequests += 1
    target.exemptRevenue += record.revenue
    target.attributableRevenue += record.revenue
    return
  }
  target.accountCost += record.upstreamBaseCost * record.accountRateMultiplier
  if (upstreamCost === undefined) {
    target.unattributedRevenue += record.revenue
    return
  }
  target.upstreamCost += upstreamCost
  const attributableRevenue = record.revenue - upstreamCost
  target.attributableRevenue += attributableRevenue
  if (attributableRevenue < 0) target.lossRequests += 1
}

function addInternalUsage(
  target: ProfitIntervalReport['internalUsage'],
  record: ProfitUsageRecord,
  upstreamCost: number | undefined
): void {
  target.requests += 1
  target.stationCharge += record.revenue
  if (upstreamCost === undefined) {
    target.unresolvedUpstreamRequests += 1
    return
  }
  target.upstreamCost += upstreamCost
}

function addPublicWelfareUsage(
  target: ProfitIntervalReport['publicWelfareUsage'],
  groups: Map<number, PublicWelfareGroupSummary>,
  record: ProfitUsageRecord,
  upstreamCost: number | undefined
): void {
  target.requests += 1
  target.stationCharge += record.revenue
  if (upstreamCost === undefined) target.unresolvedUpstreamRequests += 1
  else target.upstreamCost += upstreamCost
  if (record.sellingGroupId === undefined) return
  const group = groups.get(record.sellingGroupId) ?? {
    sellingGroupId: record.sellingGroupId,
    requests: 0,
    revenue: 0,
    upstreamCost: 0,
    unresolvedUpstreamRequests: 0
  }
  group.requests += 1
  group.revenue += record.revenue
  if (upstreamCost === undefined) group.unresolvedUpstreamRequests += 1
  else group.upstreamCost += upstreamCost
  groups.set(group.sellingGroupId, group)
}

/**
 * Coverage and archival persist at whole-Shanghai-day granularity, so every
 * day the [startAt, endAt) interval touches must be included — not just days
 * fully contained inside it. An hour-granularity query entirely within one
 * day, or one whose end falls mid-day, still needs that day's full archive:
 * a day's archive covers any sub-range query within it, but an unarchived
 * partial day silently reads back as "not yet archived" (see
 * archiveCoverageForQuery) even when the live-tracked data is already there.
 */
export function archiveDates(query: ProfitIntervalQuery): string[] {
  const dates: string[] = []
  const endExclusiveMs = Date.parse(query.endAt)
  if (!Number.isFinite(endExclusiveMs)) return dates
  const startDate = shanghaiCalendarDate(query.startAt)
  const lastTouchedDate = shanghaiCalendarDate(new Date(endExclusiveMs - 1).toISOString())
  if (!startDate || !lastTouchedDate) return dates
  const cursor = new Date(`${startDate}T00:00:00+08:00`)
  // A day-count guard well beyond any caller's validated range (90 days)
  // keeps this loop bounded even if a future caller's invariants change.
  for (let guard = 0; guard < 400; guard += 1) {
    const currentDate = shanghaiCalendarDate(cursor.toISOString())
    if (!currentDate) break
    dates.push(currentDate)
    if (currentDate >= lastTouchedDate) break
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

/** Builds the fixed [00:00, 24:00) Shanghai-day query archival persists coverage for. */
export function dayArchiveQuery(query: ProfitIntervalQuery, date: string): ProfitIntervalQuery {
  const start = new Date(`${date}T00:00:00+08:00`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return {
    ...query,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    accountId: undefined,
    sellingGroupId: undefined
  }
}

export function archiveCoverageForQuery(ledger: TimeCostLedger, query: ProfitIntervalQuery): UsageLedgerCoverage {
  const dates = archiveDates(query)
  const coverageByDate = new Map(ledger.profitUsageCoverage
    .filter((item) => item.accountStationId === query.stationId)
    .map((item) => [item.date, item]))
  const covered = dates.map((date) => coverageByDate.get(date)).filter((item): item is ProfitArchiveDayCoverage => Boolean(item))
  const missing = dates.length - covered.length
  const pageLimited = covered.filter((item) => item.state === 'page-limit')
  const interrupted = covered.filter((item) => item.state === 'incomplete' || item.state === 'unavailable')
  const state: UsageLedgerCoverage['state'] = missing > 0 || interrupted.length > 0
    ? 'incomplete'
    : pageLimited.length > 0
      ? 'page-limit'
      : covered.length > 0 ? 'complete' : 'unavailable'
  const details = [
    `完整 ${covered.filter((item) => item.state === 'complete').length} 天`,
    pageLimited.length > 0 ? `部分 ${pageLimited.length} 天` : undefined,
    interrupted.length > 0 ? `失败 ${interrupted.length} 天` : undefined,
    missing > 0 ? `未归档 ${missing} 天` : undefined
  ].filter(Boolean).join(' · ')
  return {
    accountStationId: query.stationId,
    fetchedAt: covered.map((item) => item.fetchedAt).sort((left, right) => right.localeCompare(left))[0] ?? new Date().toISOString(),
    state,
    pagesFetched: covered.reduce((total, item) => total + item.pagesFetched, 0),
    recordsSeen: covered.reduce((total, item) => total + item.recordsSeen, 0),
    acceptedEntries: covered.reduce((total, item) => total + item.acceptedEntries, 0),
    detail: details || '尚未归档'
  }
}

/**
 * Calculates a bounded [startAt, endAt) interval report. Exact upstream cost
 * is resolved through the persisted observation ledger at each request time;
 * missing or ambiguous history remains visible as unattributed revenue.
 */
export function buildProfitIntervalReport(
  query: ProfitIntervalQuery,
  records: ProfitUsageRecord[],
  coverage: UsageLedgerCoverage,
  ledger: TimeCostLedger,
  options: ProfitIntervalReportOptions = {}
): ProfitIntervalReport {
  const start = Date.parse(query.startAt)
  const end = Date.parse(query.endAt)
  const totals = emptyProfitTotals()
  const internalUsage: ProfitIntervalReport['internalUsage'] = {
    requests: 0,
    stationCharge: 0,
    upstreamCost: 0,
    unresolvedUpstreamRequests: 0
  }
  const publicWelfareUsage: ProfitIntervalReport['publicWelfareUsage'] = {
    requests: 0,
    stationCharge: 0,
    upstreamCost: 0,
    unresolvedUpstreamRequests: 0
  }
  const publicWelfareGroups = new Map<number, PublicWelfareGroupSummary>()
  let unidentifiedUserRequests = 0
  const buckets = new Map<string, ProfitIntervalBucket>()
  const accounts = new Map<string, ProfitAccountSummary>()

  for (const record of records) {
    const occurredAt = Date.parse(record.occurredAt)
    if (record.accountStationId !== query.stationId || !Number.isFinite(occurredAt) || occurredAt < start || occurredAt >= end) continue
    if (query.accountId !== undefined && record.accountId !== query.accountId) continue
    if (query.sellingGroupId !== undefined && record.sellingGroupId !== query.sellingGroupId) continue

    const exempt = options.exemptAccountKeys?.has(`${record.accountStationId}:${record.accountId}`) ?? false
    const upstream = exempt ? undefined : calculateTemporalUsageCost(ledger, {
      id: record.id,
      accountStationId: record.accountStationId,
      accountId: record.accountId,
      sellingGroupId: record.sellingGroupId,
      usageAmount: record.upstreamBaseCost,
      occurredAt: record.occurredAt
    })
    const upstreamCost = upstream?.state === 'exact' ? upstream.cost : undefined
    const internal = record.userId !== undefined && (options.internalUserKeys?.has(`${record.accountStationId}:${record.userId}`) ?? false)
    if (internal) {
      addInternalUsage(internalUsage, record, upstreamCost)
      continue
    }
    const operatingExcluded = record.sellingGroupId !== undefined
      && (options.operatingExcludedGroupKeys?.has(`${record.accountStationId}:${record.sellingGroupId}`) ?? false)
    if (operatingExcluded) {
      addPublicWelfareUsage(publicWelfareUsage, publicWelfareGroups, record, upstreamCost)
      continue
    }
    if (record.userId === undefined) unidentifiedUserRequests += 1
    addProfitRecord(totals, record, upstreamCost, exempt)

    const bucketIdentity = shanghaiBucket(record.occurredAt, query.granularity)
    const bucket = buckets.get(bucketIdentity.key) ?? { ...bucketIdentity, ...emptyProfitTotals() }
    addProfitRecord(bucket, record, upstreamCost, exempt)
    buckets.set(bucket.key, bucket)

    const accountKey = `${record.accountId}:${record.sellingGroupId ?? ''}`
    const account = accounts.get(accountKey) ?? {
      accountId: record.accountId,
      sellingGroupId: record.sellingGroupId,
      ...emptyProfitTotals()
    }
    addProfitRecord(account, record, upstreamCost, exempt)
    accounts.set(accountKey, account)
  }

  return {
    query,
    coverage,
    totals,
    internalUsage,
    publicWelfareUsage,
    publicWelfareGroups: [...publicWelfareGroups.values()].sort((left, right) => left.sellingGroupId - right.sellingGroupId),
    unidentifiedUserRequests,
    buckets: [...buckets.values()].sort((left, right) => left.key.localeCompare(right.key)),
    accounts: [...accounts.values()].sort((left, right) => {
      return right.lossRequests - left.lossRequests
        || left.attributableRevenue - right.attributableRevenue
        || right.unattributedRevenue - left.unattributedRevenue
        || left.accountId - right.accountId
    })
  }
}

function latestAtOrBefore<T extends Timestamped>(items: T[], occurredAt: string): T | undefined {
  const target = Date.parse(occurredAt)
  if (!Number.isFinite(target)) return undefined
  return items
    .filter((item) => {
      const timestamp = item.observedAt ?? item.effectiveAt ?? item.occurredAt
      return isValidDate(timestamp) && Date.parse(timestamp) <= target
    })
    .sort((left, right) => {
      const leftAt = left.observedAt ?? left.effectiveAt ?? left.occurredAt ?? ''
      const rightAt = right.observedAt ?? right.effectiveAt ?? right.occurredAt ?? ''
      return rightAt.localeCompare(leftAt)
    })[0]
}

export function resolveMappingAtTime(ledger: TimeCostLedger, accountStationId: string, accountId: number, occurredAt: string): AccountUpstreamMappingEvent | undefined {
  return latestAtOrBefore(ledger.mappingEvents.filter((event) => event.accountStationId === accountStationId && event.accountId === accountId), occurredAt)
}

export function resolveSourceGroupAtTime(
  ledger: TimeCostLedger,
  stationId: string,
  sourceKeyId: string | undefined,
  fallbackGroupId: number | undefined,
  occurredAt: string
): { state: TemporalCostResolutionState; groupId?: number; reason?: string } {
  if (!sourceKeyId) {
    return isFinitePositiveInteger(fallbackGroupId)
      ? { state: 'exact', groupId: fallbackGroupId }
      : { state: 'unknown', reason: '该时点没有上游分组' }
  }
  const observation = latestAtOrBefore(
    ledger.sourceKeyGroupObservations.filter((item) => item.stationId === stationId && item.sourceKeyId === sourceKeyId),
    occurredAt
  )
  if (!observation) return { state: 'unknown', reason: '该时点没有已观察到的上游 Key 分组' }
  if (observation.groupIds.length !== 1) return { state: 'ambiguous', reason: '上游 Key 在该时点属于多个分组，未取最低价' }
  return { state: 'exact', groupId: observation.groupIds[0] }
}

export function resolveRateAtTime(ledger: TimeCostLedger, stationId: string, groupId: number, occurredAt: string): CostRateObservation | undefined {
  return latestAtOrBefore(
    ledger.rateObservations.filter((item) => item.stationId === stationId && item.groupId === groupId),
    occurredAt
  )
}

export function calculateTemporalUsageCost(ledger: TimeCostLedger, entry: UsageLedgerEntry): TemporalUsageCost {
  const mapping = resolveMappingAtTime(ledger, entry.accountStationId, entry.accountId, entry.occurredAt)
  if (!mapping?.sourceStationId) return { entry, state: 'unknown', reason: '该时点尚未关联上游来源' }
  const sourceGroup = resolveSourceGroupAtTime(ledger, mapping.sourceStationId, mapping.sourceKeyId, mapping.sourceGroupId, entry.occurredAt)
  if (sourceGroup.state !== 'exact' || sourceGroup.groupId === undefined) return { entry, state: sourceGroup.state, reason: sourceGroup.reason }
  const rate = resolveRateAtTime(ledger, mapping.sourceStationId, sourceGroup.groupId, entry.occurredAt)
  if (!rate) return { entry, state: 'unknown', reason: '该时点没有已观察到的上游倍率' }
  return {
    entry,
    state: 'exact',
    effectiveMultiplier: rate.effectiveMultiplier,
    cost: entry.usageAmount * rate.effectiveMultiplier
  }
}

export function summarizeTemporalUsageCosts(
  ledger: TimeCostLedger,
  accountStationId?: string,
  accountId?: number,
  sellingGroupId?: number
): TemporalUsageCostSummary {
  const entries = ledger.usageEntries.filter((entry) => {
    if (accountStationId && entry.accountStationId !== accountStationId) return false
    if (accountId !== undefined && entry.accountId !== accountId) return false
    if (sellingGroupId !== undefined && entry.sellingGroupId !== sellingGroupId) return false
    return true
  })
  const calculated = entries.map((entry) => calculateTemporalUsageCost(ledger, entry))
  const exact = calculated.filter((item) => item.state === 'exact')
  return {
    exactEntries: exact.length,
    unknownEntries: calculated.filter((item) => item.state === 'unknown').length,
    ambiguousEntries: calculated.filter((item) => item.state === 'ambiguous').length,
    totalCost: exact.length > 0 ? exact.reduce((total, item) => total + (item.cost ?? 0), 0) : undefined,
    latestObservedAt: latestLedgerObservationAt(ledger)
  }
}

export function latestLedgerObservationAt(ledger: TimeCostLedger): string | undefined {
  return [
    ...ledger.rateObservations.map((item) => item.observedAt),
    ...ledger.sourceKeyGroupObservations.map((item) => item.observedAt),
    ...ledger.mappingEvents.map((item) => item.effectiveAt)
  ].filter(isValidDate).sort((left, right) => right.localeCompare(left))[0]
}

/**
 * Keeps historical local observations visible when the companion station
 * configuration was lost. No identifier is matched to a newly added station.
 */
export function summarizeOrphanedLocalHistory(
  currentStationIds: ReadonlySet<string>,
  groupChangeEvents: GroupChangeEvent[],
  ledger: TimeCostLedger
): OrphanedLocalHistorySummary[] {
  const summaries = new Map<string, OrphanedLocalHistorySummary>()
  const stationNameObservedAt = new Map<string, string>()

  function ensure(stationId: string): OrphanedLocalHistorySummary | undefined {
    if (!stationId || currentStationIds.has(stationId)) return undefined
    const existing = summaries.get(stationId)
    if (existing) return existing
    const next: OrphanedLocalHistorySummary = {
      stationId,
      groupChangeCount: 0,
      rateObservationCount: 0,
      sourceKeyObservationCount: 0,
      usageEntryCount: 0,
      profitUsageRecordCount: 0,
      recentGroupChanges: [],
      recentRateObservations: []
    }
    summaries.set(stationId, next)
    return next
  }

  function updateLastObservedAt(summary: OrphanedLocalHistorySummary, candidate?: string): void {
    if (!isValidDate(candidate)) return
    if (!summary.lastObservedAt || candidate > summary.lastObservedAt) summary.lastObservedAt = candidate
  }

  for (const event of groupChangeEvents) {
    const summary = ensure(event.stationId)
    if (!summary) continue
    summary.groupChangeCount += 1
    const previousNameAt = stationNameObservedAt.get(event.stationId)
    if (event.stationName.trim() && (!previousNameAt || event.occurredAt > previousNameAt)) {
      summary.stationName = event.stationName.trim()
      stationNameObservedAt.set(event.stationId, event.occurredAt)
    }
    summary.recentGroupChanges.push(event)
    updateLastObservedAt(summary, event.occurredAt)
  }
  for (const observation of ledger.rateObservations) {
    const summary = ensure(observation.stationId)
    if (!summary) continue
    summary.rateObservationCount += 1
    summary.recentRateObservations.push(observation)
    updateLastObservedAt(summary, observation.observedAt)
  }
  for (const observation of ledger.sourceKeyGroupObservations) {
    const summary = ensure(observation.stationId)
    if (!summary) continue
    summary.sourceKeyObservationCount += 1
    updateLastObservedAt(summary, observation.observedAt)
  }
  for (const entry of ledger.usageEntries) {
    const summary = ensure(entry.accountStationId)
    if (!summary) continue
    summary.usageEntryCount += 1
    updateLastObservedAt(summary, entry.occurredAt)
  }
  for (const record of ledger.profitUsageRecords) {
    const summary = ensure(record.accountStationId)
    if (!summary) continue
    summary.profitUsageRecordCount += 1
    updateLastObservedAt(summary, record.occurredAt)
  }

  return [...summaries.values()]
    .map((summary) => ({
      ...summary,
      recentGroupChanges: [...summary.recentGroupChanges].sort(compareIsoDescending).slice(0, 4),
      recentRateObservations: [...summary.recentRateObservations].sort(compareIsoDescending).slice(0, 4)
    }))
    .sort((left, right) => (right.lastObservedAt ?? '').localeCompare(left.lastObservedAt ?? ''))
}

function trimByTimestamp<T extends Timestamped>(items: T[], limit: number): T[] {
  return [...items].sort(compareIsoDescending).slice(0, limit)
}

export function emptyTimeCostLedger(): TimeCostLedger {
  return { rateObservations: [], sourceKeyGroupObservations: [], mappingEvents: [], usageEntries: [], usageCoverage: [], profitUsageRecords: [], profitUsageCoverage: [] }
}

export function appendProfitUsageArchiveDay(
  ledger: TimeCostLedger,
  records: ProfitUsageRecord[],
  coverage: ProfitArchiveDayCoverage
): TimeCostLedger {
  // A re-archive replaces one station's Shanghai calendar day. Retaining rows
  // omitted by a later response would inflate the local revenue report.
  const entries = new Map(ledger.profitUsageRecords
    .filter((record) => record.accountStationId !== coverage.accountStationId || shanghaiCalendarDate(record.occurredAt) !== coverage.date)
    .map((record) => [record.id, record]))
  for (const record of records) {
    if (record.accountStationId !== coverage.accountStationId || !isFinitePositiveInteger(record.accountId)
      || !isValidDate(record.occurredAt) || !isFiniteNumber(record.revenue) || record.revenue < 0
      || !isFiniteNumber(record.upstreamBaseCost) || record.upstreamBaseCost < 0
      || !isFiniteNumber(record.accountRateMultiplier) || record.accountRateMultiplier < 0
      || !safeIdentifier(record.id, 240) || shanghaiCalendarDate(record.occurredAt) !== coverage.date) continue
    entries.set(record.id, record)
  }
  const profitUsageCoverage = [
    coverage,
    ...ledger.profitUsageCoverage.filter((item) => item.accountStationId !== coverage.accountStationId || item.date !== coverage.date)
  ]
  return {
    ...ledger,
    profitUsageRecords: [...entries.values()].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, profitUsageRecordLimit),
    profitUsageCoverage: profitUsageCoverage.sort((left, right) => right.date.localeCompare(left.date)).slice(0, profitUsageCoverageLimit)
  }
}

function observedGroupRate(group: GroupSnapshot): number | undefined {
  return effectiveRate(group)
}

/**
 * The ledger is the persisted baseline. A first successful observation only
 * establishes it; it cannot be represented as a price change.
 */
export function appendObservedGroupRateChanges(
  existingEvents: GroupChangeEvent[],
  ledger: TimeCostLedger,
  stationId: string,
  stationName: string,
  groups: GroupSnapshot[],
  observedAt: string
): GroupChangeEvent[] {
  const nextEvents: GroupChangeEvent[] = []
  for (const group of groups) {
    const nextRate = observedGroupRate(group)
    if (!isFinitePositiveInteger(group.id) || nextRate === undefined) continue
    const previous = ledger.rateObservations
      .filter((item) => item.stationId === stationId && item.groupId === group.id)
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0]
    if (!previous || Math.abs(previous.rateMultiplier - nextRate) < rateChangeTolerance) continue
    nextEvents.push({
      id: `${stationId}:group:${group.id}:rate:${observedAt}`,
      kind: nextRate > previous.rateMultiplier ? 'rate-up' : 'rate-down',
      stationId,
      stationName,
      groupId: group.id,
      groupName: group.name,
      platform: group.platform,
      previousRate: previous.rateMultiplier,
      nextRate,
      occurredAt: observedAt
    })
  }
  if (nextEvents.length === 0) return existingEvents
  const seen = new Set<string>()
  return [...nextEvents, ...existingEvents]
    .filter((event) => {
      if (seen.has(event.id)) return false
      seen.add(event.id)
      return true
    })
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, groupChangeEventLimit)
}

export function appendTimeCostSnapshot(ledger: TimeCostLedger, input: TimeCostSnapshotInput): TimeCostLedger {
  const observedAt = isValidDate(input.observedAt)
    ? new Date(input.observedAt).toISOString()
    : isValidDate(input.snapshot.lastSuccessAt)
      ? new Date(input.snapshot.lastSuccessAt).toISOString()
      : isValidDate(input.snapshot.lastUpdatedAt)
        ? new Date(input.snapshot.lastUpdatedAt).toISOString()
        : new Date().toISOString()
  const rechargeRatio = isFiniteNumber(input.rechargeRatio) && input.rechargeRatio > 0 ? input.rechargeRatio : 1
  const rateObservations = [...ledger.rateObservations]
  for (const group of input.snapshot.groups) {
    if (!isFinitePositiveInteger(group.id)) continue
    const rateMultiplier = effectiveRate(group)
    if (rateMultiplier === undefined) continue
    const latest = rateObservations
      .filter((item) => item.stationId === input.stationId && item.groupId === group.id)
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0]
    const effectiveMultiplier = rateMultiplier / rechargeRatio
    if (latest && latest.rateMultiplier === rateMultiplier && latest.rechargeRatio === rechargeRatio) continue
    rateObservations.push({
      id: `${input.stationId}:group:${group.id}:${observedAt}`,
      stationId: input.stationId,
      groupId: group.id,
      rateMultiplier,
      rechargeRatio,
      effectiveMultiplier,
      observedAt,
      timeSource: 'observed'
    })
  }

  const sourceKeyGroupObservations = [...ledger.sourceKeyGroupObservations]
  for (const key of input.snapshot.sourceKeys ?? []) {
    const sourceKeyId = safeIdentifier(key.id)
    if (!sourceKeyId) continue
    const groupIds = normalizedGroupIds(key.groupIds)
    const latest = sourceKeyGroupObservations
      .filter((item) => item.stationId === input.stationId && item.sourceKeyId === sourceKeyId)
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0]
    if (latest && sameNumberArray(latest.groupIds, groupIds)) continue
    sourceKeyGroupObservations.push({
      id: `${input.stationId}:key:${sourceKeyId}:${observedAt}`,
      stationId: input.stationId,
      sourceKeyId,
      groupIds,
      observedAt,
      timeSource: 'observed'
    })
  }

  const usageEntries = new Map(ledger.usageEntries.map((entry) => [entry.id, entry]))
  for (const entry of input.usageEntries ?? []) {
    if (entry.accountStationId !== input.stationId || !isFinitePositiveInteger(entry.accountId)
      || !isFiniteNumber(entry.usageAmount) || entry.usageAmount < 0 || !isValidDate(entry.occurredAt)
      || !safeIdentifier(entry.id, 240)) continue
    usageEntries.set(entry.id, entry)
  }
  const usageCoverage = input.usageCoverage
    ? [input.usageCoverage, ...ledger.usageCoverage.filter((item) => item.accountStationId !== input.usageCoverage?.accountStationId)]
    : ledger.usageCoverage
  return {
    rateObservations: trimByTimestamp(rateObservations, rateObservationLimit) as CostRateObservation[],
    sourceKeyGroupObservations: trimByTimestamp(sourceKeyGroupObservations, keyGroupObservationLimit) as SourceKeyGroupObservation[],
    mappingEvents: trimByTimestamp(ledger.mappingEvents, mappingEventLimit) as AccountUpstreamMappingEvent[],
    usageEntries: [...usageEntries.values()].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, usageEntryLimit),
    usageCoverage: usageCoverage.slice(0, usageCoverageLimit),
    profitUsageRecords: ledger.profitUsageRecords,
    profitUsageCoverage: ledger.profitUsageCoverage
  }
}

function mappingSignature(mapping: Pick<AccountUpstreamMappingEvent, 'sourceStationId' | 'sourceKeyId' | 'sourceGroupId'>): string {
  return `${mapping.sourceStationId ?? ''}:${mapping.sourceKeyId ?? ''}:${mapping.sourceGroupId ?? ''}`
}

export function appendAccountUpstreamMappingEvents(
  ledger: TimeCostLedger,
  previousMappings: AccountUpstreamMapping[],
  nextMappings: AccountUpstreamMapping[],
  effectiveAt = new Date().toISOString()
): TimeCostLedger {
  const previousByAccount = new Map(previousMappings.map((mapping) => [`${mapping.accountStationId}:${mapping.accountId}`, mapping]))
  const nextByAccount = new Map(nextMappings.map((mapping) => [`${mapping.accountStationId}:${mapping.accountId}`, mapping]))
  const accountKeys = new Set([...previousByAccount.keys(), ...nextByAccount.keys()])
  const mappingEvents = [...ledger.mappingEvents]
  for (const key of accountKeys) {
    const previous = previousByAccount.get(key)
    const next = nextByAccount.get(key)
    const previousSignature = previous ? mappingSignature(previous) : ''
    const nextSignature = next ? mappingSignature(next) : ''
    if (previousSignature === nextSignature) continue
    const accountReference = next ?? previous
    if (!accountReference || !accountReference.accountStationId.trim() || !isFinitePositiveInteger(accountReference.accountId)) continue
    const { accountStationId, accountId } = accountReference
    const latest = mappingEvents
      .filter((event) => event.accountStationId === accountStationId && event.accountId === accountId)
      .sort((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))[0]
    if (latest && mappingSignature(latest) === nextSignature) continue
    mappingEvents.push({
      id: `${accountStationId}:account:${accountId}:${effectiveAt}`,
      accountStationId,
      accountId,
      sourceStationId: next?.sourceStationId,
      sourceKeyId: next?.sourceKeyId,
      sourceGroupId: next?.sourceGroupId,
      effectiveAt,
      timeSource: 'observed'
    })
  }
  return { ...ledger, mappingEvents: trimByTimestamp(mappingEvents, mappingEventLimit) as AccountUpstreamMappingEvent[] }
}
