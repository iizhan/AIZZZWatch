import type { StationReadCapability, StationReadCapabilityMapping, StationReadMapping, StationReadMappingTemplate } from './types'

const dotPathPattern = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*){0,11}$/
const unsafePathSegments = new Set(['__proto__', 'constructor', 'prototype'])

export const stationReadCapabilities: StationReadCapability[] = ['profile', 'groups', 'rates', 'channels', 'keys']

export const mappingFieldDefinitions: Record<StationReadCapability, Array<{ key: string; label: string; required: boolean }>> = {
  profile: [{ key: 'balance', label: '余额', required: true }],
  groups: [
    { key: 'id', label: '分组 ID', required: true },
    { key: 'name', label: '分组名称', required: true },
    { key: 'platform', label: '平台', required: false },
    { key: 'rateMultiplier', label: '倍率', required: false }
  ],
  rates: [
    { key: 'groupId', label: '分组 ID', required: true },
    { key: 'rateMultiplier', label: '倍率', required: true }
  ],
  channels: [
    { key: 'groupId', label: '分组 ID', required: true },
    { key: 'modelName', label: '模型名称', required: true },
    { key: 'inputPrice', label: '输入价格', required: false },
    { key: 'outputPrice', label: '输出价格', required: false },
    { key: 'perRequestPrice', label: '单次价格', required: false }
  ],
  keys: [
    { key: 'id', label: '密钥记录 ID', required: true },
    { key: 'name', label: '显示名称', required: false },
    { key: 'groupIds', label: '分组 ID 列表', required: false }
  ]
}

function cleanPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return dotPathPattern.test(trimmed) && trimmed.split('.').every((segment) => !unsafePathSegments.has(segment)) ? trimmed : undefined
}

function cleanFields(capability: StationReadCapability, value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const allowed = new Set(mappingFieldDefinitions[capability].map((field) => field.key))
  const fields = Object.fromEntries(Object.entries(value)
    .flatMap(([key, candidate]) => allowed.has(key) && cleanPath(candidate) ? [[key, cleanPath(candidate) as string]] : []))
  return Object.keys(fields).length > 0 ? fields : undefined
}

function cleanCapability(capability: StationReadCapability, value: unknown): StationReadCapabilityMapping | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const mapping = value as Partial<StationReadCapabilityMapping>
  const objectPath = cleanPath(mapping.objectPath)
  const recordsPath = cleanPath(mapping.recordsPath)
  const fields = cleanFields(capability, mapping.fields)
  const recordMode = mapping.recordMode === 'keyed-map' ? 'keyed-map' : mapping.recordMode === 'list' ? 'list' : undefined
  if (!objectPath && !recordsPath && !fields && !recordMode) return undefined
  return { objectPath, recordsPath, recordMode, fields }
}

export function normalizeStationReadMapping(value: unknown): StationReadMapping | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const mapping = value as Partial<StationReadMapping>
  const template: StationReadMappingTemplate = ['sub2api', 'newapi', 'lcodex', 'aihub', 'custom'].includes(mapping.template ?? '')
    ? mapping.template as StationReadMappingTemplate
    : 'custom'
  const capabilities = Object.fromEntries(stationReadCapabilities.flatMap((capability) => {
    const next = cleanCapability(capability, mapping.capabilities?.[capability])
    return next ? [[capability, next]] : []
  })) as StationReadMapping['capabilities']
  return Object.keys(capabilities).length > 0 || template !== 'custom'
    ? { version: 1, template, capabilities }
    : undefined
}

export function readMappedPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value
  let current: unknown = value
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export function mappedCapabilityFields(capability: StationReadCapability, mapping: StationReadMapping | undefined): string[] {
  return Object.keys(mapping?.capabilities[capability]?.fields ?? {})
}

export function mapRecordFields(capability: StationReadCapability, record: Record<string, unknown>, mapping: StationReadMapping | undefined): Record<string, unknown> {
  const fields = mapping?.capabilities[capability]?.fields
  if (!fields) return record
  return {
    ...record,
    ...Object.fromEntries(Object.entries(fields).map(([key, path]) => [key, readMappedPath(record, path)]))
  }
}

export function mappingRequiredFieldsPresent(capability: StationReadCapability, fields: string[]): boolean {
  return mappingFieldDefinitions[capability].filter((field) => field.required).every((field) => fields.includes(field.key))
}
