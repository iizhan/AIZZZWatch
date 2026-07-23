import type { AccountSnapshot } from './types'

export type UsageCapabilityPrecision = 'precise' | 'account' | 'aggregate' | 'unit-only' | 'unavailable'

export interface UsageCapabilityDiagnostic {
  precision: UsageCapabilityPrecision
  precisionLabel: string
  summary: string
  recordCount: number
  accountUsageCount: number
  fieldNames: string[]
  dimensions: {
    account: boolean
    group: boolean
    key: boolean
    user: boolean
    model: boolean
    time: boolean
  }
  measures: {
    cost: boolean
    tokens: boolean
    requests: boolean
    quota: boolean
    usage: boolean
  }
  period: 'hourly' | 'daily' | 'range' | 'single' | 'unknown'
  sampleRows: Array<Record<string, string>>
}

interface AnalyzeUsageCapabilityInput {
  usageRecords?: Record<string, unknown>[]
  accounts?: AccountSnapshot[]
}

const accountAliases = ['account', 'accountid', 'accountname', 'account_id', 'account_name', 'channelaccount', 'channel_account']
const groupAliases = ['group', 'groupid', 'groupname', 'group_id', 'group_name', 'groupids', 'group_ids']
const keyAliases = ['keyid', 'apikeyid', 'tokenid', 'credentialid', 'api_key_id', 'key_id', 'token_id']
const userAliases = ['user', 'userid', 'username', 'email', 'user_id', 'user_name']
const modelAliases = ['model', 'modelname', 'model_name', 'engine']
const hourlyAliases = ['hour', 'hourly', 'createdhour', 'created_hour']
const dailyAliases = ['date', 'day', 'daily', 'today', 'statdate', 'stat_date']
const rangeAliases = ['period', 'range', 'starttime', 'endtime', 'start_time', 'end_time', 'from', 'to']
const costAliases = ['cost', 'totalcost', 'amount', 'fee', 'spent', 'total_cost']
const tokenAliases = ['tokens', 'totaltokens', 'prompttokens', 'completiontokens', 'inputtokens', 'outputtokens', 'total_tokens']
const requestAliases = ['requests', 'requestcount', 'count', 'calls', 'request_count']
const quotaAliases = ['quota', 'usedquota', 'used_quota', 'credits', 'credit']
const usageAliases = ['usage', 'used', 'consume', 'consumed']

function normalizeFieldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function matchesAnyField(fieldNames: string[], aliases: string[]): boolean {
  const normalizedAliases = aliases.map(normalizeFieldName)
  return fieldNames.some((field) => {
    const normalized = normalizeFieldName(field.split('.').at(-1) ?? field)
    return normalizedAliases.some((alias) => normalized === alias || normalized.endsWith(alias))
  })
}

function flattenRecord(record: Record<string, unknown>, prefix = '', depth = 0): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  if (depth > 2) return output
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key
    output[path] = value
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(output, flattenRecord(value as Record<string, unknown>, path, depth + 1))
    }
  }
  return output
}

function fieldNamesFor(records: Record<string, unknown>[]): string[] {
  const fields = new Set<string>()
  for (const record of records) {
    for (const key of Object.keys(flattenRecord(record))) fields.add(key)
  }
  return [...fields].sort((left, right) => left.localeCompare(right)).slice(0, 120)
}

function isSecretLike(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/bearer\s+/i.test(trimmed) || /^sk-[a-z0-9_-]{16,}/i.test(trimmed) || /^eyJ[a-z0-9_-]+\./i.test(trimmed)) return true
  return trimmed.length > 48 && !/\s/.test(trimmed)
}

function safeSampleValue(value: unknown): string {
  if (value === null || value === undefined) return '空'
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : '非有限数字'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return '空字符串'
    if (isSecretLike(trimmed)) return '已脱敏'
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return 'email(已脱敏)'
    return `string(${trimmed.length})`
  }
  if (Array.isArray(value)) return `array(${value.length})`
  if (typeof value === 'object') return 'object'
  return typeof value
}

export function createUsageCapabilitySampleRows(records: Record<string, unknown>[]): Array<Record<string, string>> {
  return records.slice(0, 2).map((record) => {
    const flattened = flattenRecord(record)
    return Object.fromEntries(
      Object.entries(flattened)
        .slice(0, 12)
        .map(([key, value]) => [key, safeSampleValue(value)])
    )
  })
}

function usagePrecisionLabel(precision: UsageCapabilityPrecision): string {
  if (precision === 'precise') return '精确利润'
  if (precision === 'account') return '账号级利润'
  if (precision === 'aggregate') return '汇总参考'
  if (precision === 'unit-only') return '仅单位利润'
  return '不可计算'
}

function usagePeriodLabel(period: UsageCapabilityDiagnostic['period']): string {
  if (period === 'hourly') return '小时级'
  if (period === 'daily') return '日级/可能仅当日'
  if (period === 'range') return '区间统计'
  if (period === 'single') return '单周期'
  return '未识别周期'
}

function buildSummary(diagnostic: Omit<UsageCapabilityDiagnostic, 'summary'>): string {
  if (diagnostic.precision === 'precise') return `已检测到账号、分组和消耗字段，可支持账号×分组收益归因；周期：${usagePeriodLabel(diagnostic.period)}。`
  if (diagnostic.precision === 'account') return `已检测到账号/密钥维度和消耗字段，但缺少分组维度，只能估算账号级收益；周期：${usagePeriodLabel(diagnostic.period)}。`
  if (diagnostic.precision === 'aggregate') return `接口返回了消耗统计，但缺少账号/分组维度，只能看汇总趋势；周期：${usagePeriodLabel(diagnostic.period)}。`
  if (diagnostic.precision === 'unit-only') return '后台用量明细缺失，但账号列表含累计用量字段；只能在单分组账号上做粗略收益估算。'
  return '当前没有检测到可用用量明细，只能展示倍率、上游成本和单位利润。'
}

export function analyzeUsageCapability(input: AnalyzeUsageCapabilityInput): UsageCapabilityDiagnostic {
  const usageRecords = input.usageRecords?.filter((record) => record && typeof record === 'object' && !Array.isArray(record)) ?? []
  const accountUsageCount = (input.accounts ?? []).filter((account) => typeof account.usageAmount === 'number' && Number.isFinite(account.usageAmount)).length
  const fieldNames = fieldNamesFor(usageRecords)
  const dimensions = {
    account: matchesAnyField(fieldNames, accountAliases),
    group: matchesAnyField(fieldNames, groupAliases),
    key: matchesAnyField(fieldNames, keyAliases),
    user: matchesAnyField(fieldNames, userAliases),
    model: matchesAnyField(fieldNames, modelAliases),
    time: matchesAnyField(fieldNames, [...hourlyAliases, ...dailyAliases, ...rangeAliases])
  }
  const measures = {
    cost: matchesAnyField(fieldNames, costAliases),
    tokens: matchesAnyField(fieldNames, tokenAliases),
    requests: matchesAnyField(fieldNames, requestAliases),
    quota: matchesAnyField(fieldNames, quotaAliases),
    usage: matchesAnyField(fieldNames, usageAliases)
  }
  const hasMeasure = Object.values(measures).some(Boolean)
  const period: UsageCapabilityDiagnostic['period'] = matchesAnyField(fieldNames, hourlyAliases)
    ? 'hourly'
    : matchesAnyField(fieldNames, dailyAliases)
      ? 'daily'
      : matchesAnyField(fieldNames, rangeAliases)
        ? 'range'
        : usageRecords.length === 1
          ? 'single'
          : 'unknown'
  const precision: UsageCapabilityPrecision = usageRecords.length === 0 && accountUsageCount > 0
    ? 'unit-only'
    : usageRecords.length === 0 || !hasMeasure
      ? 'unavailable'
      : dimensions.account && dimensions.group
        ? 'precise'
        : dimensions.account || dimensions.key
          ? 'account'
          : 'aggregate'

  const diagnosticWithoutSummary = {
    precision,
    precisionLabel: usagePrecisionLabel(precision),
    recordCount: usageRecords.length,
    accountUsageCount,
    fieldNames,
    dimensions,
    measures,
    period,
    sampleRows: createUsageCapabilitySampleRows(usageRecords)
  }

  return {
    ...diagnosticWithoutSummary,
    summary: buildSummary(diagnosticWithoutSummary)
  }
}
