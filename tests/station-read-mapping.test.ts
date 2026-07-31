import { describe, expect, it } from 'vitest'
import { mappingRequiredFieldsPresent, normalizeStationReadMapping, readMappedPath } from '../src/shared/station-read-mapping'

describe('station read mapping', () => {
  it('keeps an explicit empty custom template so an API root can be configured before field mappings', () => {
    expect(normalizeStationReadMapping({ version: 1, template: 'custom', capabilities: {} })).toEqual({
      version: 1,
      template: 'custom',
      capabilities: {}
    })
    expect(normalizeStationReadMapping({})).toBeUndefined()
  })

  it('keeps only allowed dot paths and known fields', () => {
    expect(normalizeStationReadMapping({
      version: 1,
      template: 'custom',
      capabilities: {
        groups: {
          recordsPath: 'data.items',
          fields: {
            id: 'group.id',
            name: 'group.title',
            rateMultiplier: 'cost.multiplier',
            unknown: 'should.not.persist',
            platform: 'items[0].platform'
          }
        }
      }
    })).toEqual({
      version: 1,
      template: 'custom',
      capabilities: {
        groups: {
          recordsPath: 'data.items',
          fields: { id: 'group.id', name: 'group.title', rateMultiplier: 'cost.multiplier' }
        }
      }
    })
  })

  it('rejects script-like, array and over-deep paths', () => {
    const tooDeep = Array.from({ length: 13 }, (_, index) => `x${index}`).join('.')
    expect(normalizeStationReadMapping({
      version: 1,
      template: 'custom',
      capabilities: { profile: { objectPath: '__proto__.secret', fields: { balance: tooDeep } } }
    })).toBeUndefined()
  })

  it('reads only direct object segments and reports required mappings', () => {
    expect(readMappedPath({ data: { amount: 7 } }, 'data.amount')).toBe(7)
    expect(readMappedPath({ data: [{ amount: 7 }] }, 'data.amount')).toBeUndefined()
    expect(mappingRequiredFieldsPresent('groups', ['id', 'name'])).toBe(true)
    expect(mappingRequiredFieldsPresent('groups', ['id'])).toBe(false)
  })
})
