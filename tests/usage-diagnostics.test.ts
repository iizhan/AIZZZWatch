import { describe, expect, it } from 'vitest'
import { analyzeUsageCapability, createUsageCapabilitySampleRows } from '../src/shared/usage-diagnostics'
import type { AccountSnapshot } from '../src/shared/types'

describe('usage capability diagnostics', () => {
  it('marks account and group usage records as precise profit data', () => {
    const diagnostic = analyzeUsageCapability({
      usageRecords: [
        { account_id: 10, group_id: 20, date: '2026-07-19', cost: 1.25, tokens: 1200 }
      ]
    })

    expect(diagnostic.precision).toBe('precise')
    expect(diagnostic.precisionLabel).toBe('精确利润')
    expect(diagnostic.dimensions.account).toBe(true)
    expect(diagnostic.dimensions.group).toBe(true)
    expect(diagnostic.measures.cost).toBe(true)
    expect(diagnostic.period).toBe('daily')
  })

  it('marks account-only usage as account level data', () => {
    const diagnostic = analyzeUsageCapability({
      usageRecords: [
        { account_name: 'claude-main', requests: 88, total_tokens: 9000, period: 'today' }
      ]
    })

    expect(diagnostic.precision).toBe('account')
    expect(diagnostic.dimensions.account).toBe(true)
    expect(diagnostic.dimensions.group).toBe(false)
    expect(diagnostic.measures.tokens).toBe(true)
  })

  it('marks total-only usage as aggregate reference data', () => {
    const diagnostic = analyzeUsageCapability({
      usageRecords: [
        { scope: 'today', requests: 904, cost: 12.4 }
      ]
    })

    expect(diagnostic.precision).toBe('aggregate')
    expect(diagnostic.recordCount).toBe(1)
    expect(diagnostic.summary).toContain('汇总趋势')
  })

  it('falls back to unit-only when only account records contain usage totals', () => {
    const accounts: AccountSnapshot[] = [
      { id: 1, name: 'openai-a', platform: 'openai', groupIds: [101], groups: ['OpenAI'], status: 'active', usageAmount: 30 }
    ]

    const diagnostic = analyzeUsageCapability({ accounts })

    expect(diagnostic.precision).toBe('unit-only')
    expect(diagnostic.accountUsageCount).toBe(1)
  })

  it('redacts sample values instead of exposing raw secrets or private records', () => {
    const [sample] = createUsageCapabilitySampleRows([
      {
        api_key: ['sk', 'demonstration', 'only', 'not', 'a', 'credential'].join('-'),
        email: 'admin@example.com',
        account_id: 7,
        nested: { bearer: 'Bearer abc.def.ghi' }
      }
    ])

    expect(sample.api_key).toBe('已脱敏')
    expect(sample.email).toBe('email(已脱敏)')
    expect(sample.account_id).toBe('number')
    expect(sample['nested.bearer']).toBe('已脱敏')
  })
})
