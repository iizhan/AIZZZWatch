import { apiClient } from '../client'

export type WatchPriceMode = 'group_multiplier' | 'model_price'
export type WatchPriceComponent = 'input' | 'output' | 'per_request'

export interface WatchAccountStatus {
  id: number
  name: string
  platform: string
  health: 'available' | 'blocked'
  reason?: string
  rate_multiplier: number
  observed_at: string
}

export interface WatchOverview {
  generated_at: string
  accounts: WatchAccountStatus[]
  active_accounts: number
  blocked_accounts: number
  active_groups: number
  active_channels: number
  detection_kind: string
}

export interface WatchOperationsUsageSummary {
  window_start: string
  window_end: string
  request_count: number
  loss_request_count: number
  unresolved_request_count: number
  account_count: number
  group_count: number
  revenue: number
  estimated_upstream_cost: number
  gross_profit: number
  gross_margin?: number
}

export interface WatchOperationsAlert {
  id: string
  kind: string
  severity: 'critical' | 'warning' | 'info'
  entity_type?: string
  entity_id?: number
  entity_name?: string
  status?: string
  error_code?: string
  platform?: string
  model?: string
  component?: string
  value?: number
  threshold?: number
  previous_value?: number
  next_value?: number
  observed_at?: string
}

export interface WatchOperationsReport {
  generated_at: string
  window_days: number
  summary: WatchOperationsUsageSummary
  alerts: WatchOperationsAlert[]
}

export interface WatchPricingCandidate {
  account_id?: number
  account_name?: string
  source_id: number
  source_name: string
  group_id?: number
  group_external_id?: string
  group_name: string
  platform?: string
  value: number
  healthy: boolean
  reason?: string
  observed_at: string
}

export interface WatchPricingAccountCostRow {
  account_id: number
  account_name: string
  platform: string
  source_id?: number
  source_name?: string
  source_key_external_id?: string
  source_key_label?: string
  source_group_external_id?: string
  source_group_name?: string
  source_group_rate_multiplier?: number
  official_probe_multiplier?: number
  watch_fallback_multiplier?: number
  recharge_ratio?: number
  effective_cost?: number
  pricing_source?: 'official_probe' | 'watch_fallback'
  official_probe_status?: 'ok' | 'missing' | 'unsupported' | 'failed' | 'stale' | 'invalid' | 'not_applicable'
  evidence_mismatch?: boolean
  downward_safe: boolean
  healthy: boolean
  reason?: string
  observed_at?: string
}

export type WatchRateAnomalyKind = 'underpriced' | 'overpriced'
export type WatchRateAnomalyStatus = 'open' | 'resolved'

export interface WatchRateAnomaly {
  id: number
  pricing_rule_id?: number
  target_group_id: number
  group_name: string
  kind: WatchRateAnomalyKind
  status: WatchRateAnomalyStatus
  current_value: number
  target_value: number
  highest_upstream_cost: number
  pricing_source: 'official_probe' | 'watch_fallback' | 'mixed' | 'unresolved'
  official_probe_count: number
  watch_fallback_count: number
  evidence_mismatch_count: number
  detected_at: string
  last_observed_at: string
  resolved_at?: string
  created_at: string
  updated_at: string
}

export interface WatchRateCompensationRow {
  user_id: number
  username: string
  email: string
  request_count: number
  eligible_request_count: number
  unresolved_request_count: number
  actual_cost: number
  expected_cost: number
  candidate_amount: number
  eligible: boolean
  reason?: string
  already_compensated: boolean
}

export interface WatchRateCompensationPreview {
  anomaly: WatchRateAnomaly
  window_start: string
  window_end: string
  user_count: number
  eligible_count: number
  request_count: number
  actual_cost: number
  expected_cost: number
  candidate_amount: number
  unresolved_request_count: number
  rows: WatchRateCompensationRow[]
  generated_at: string
}

export interface WatchRateCompensationApplyResult {
  anomaly_id: number
  applied_user_ids: number[]
  skipped_user_ids: number[]
  applied_count: number
  compensated_amount: number
  applied_at: string
  replayed: boolean
}

export interface WatchPricingPreview {
  mode: WatchPriceMode
  component?: WatchPriceComponent
  target_group_id: number
  current_value?: number
  target_value?: number
  proposed_value?: number
  candidates: WatchPricingCandidate[]
  cost_rows: WatchPricingAccountCostRow[]
  frozen: boolean
  freeze_reason?: string
  generated_at: string
}

export interface WatchPricingApplyInput {
  target_group_id: number
  mode: WatchPriceMode
  model?: string
  platform?: string
  component?: WatchPriceComponent
  adjustment_step?: number
  expected_current_value: number
  proposed_value: number
  confirmed: boolean
  idempotency_key: string
}

export interface WatchPricingRollbackInput {
  expected_current_value: number
  confirmed: boolean
  idempotency_key: string
}

export interface WatchPriceAudit {
  id: number
  target_type: string
  target_id: number
  target_group_id: number
  mode: WatchPriceMode
  component?: WatchPriceComponent
  previous_value?: number
  next_value?: number
  candidate_source_id?: number
  candidate_group_external_id?: string
  action: 'applying' | 'applied' | 'frozen' | 'conflict' | 'failed' | 'rolled_back'
  reason?: string
  actor_user_id?: number
  idempotency_key?: string
  platform?: string
  model?: string
  rollback_of_id?: number
  created_at: string
  updated_at: string
}

export interface WatchPricingRule {
  id: number
  name: string
  target_group_id: number
  mode: WatchPriceMode
  platform?: string
  model?: string
  component: WatchPriceComponent
  enabled: boolean
  interval_seconds: number
  adjustment_step: number
  run_sequence: number
  last_run_at?: string
  next_run_at?: string
  last_status?: string
  last_error_code?: string
  created_at: string
  updated_at: string
}

export interface WatchPricingRuleInput {
  name: string
  target_group_id: number
  mode: WatchPriceMode
  platform?: string
  model?: string
  component?: WatchPriceComponent
  enabled: boolean
  interval_seconds: number
  adjustment_step?: number
}

export interface WatchPricingRuleRunResult {
  rule: WatchPricingRule
  preview?: WatchPricingPreview
  audit?: WatchPriceAudit
  status: string
  error_code?: string
}

export type WatchSourceAdapter = 'sub2api' | 'newapi' | 'custom'
export type WatchCredentialType = 'bearer' | 'api_key' | 'cookie'
export type WatchSourceAuthMode = 'manual' | 'password'
export type WatchCheckStatus = 'healthy' | 'degraded' | 'error' | 'checking'
export type WatchDiagnosticState = 'waiting' | 'checking' | 'completed' | 'failed'
export type WatchKeepaliveState = 'disabled' | 'waiting' | 'checking' | 'active' | 'failed'
export type WatchIntegrationAccountHealthStatus = 'healthy' | 'abnormal' | 'observing' | 'disabled'
export type WatchReadCapability = 'profile' | 'groups' | 'rates' | 'channels' | 'keys'
export type WatchReadRecordMode = 'list' | 'keyed_map'

export interface WatchSourceReadCapabilityMapping {
  object_path?: string
  records_path?: string
  record_mode?: WatchReadRecordMode
  fields?: Record<string, string>
}

export interface WatchSourceReadMapping {
  version?: number
  template?: WatchSourceAdapter
  capabilities?: Partial<Record<WatchReadCapability, WatchSourceReadCapabilityMapping>>
}

export interface WatchSource {
  id: number
  name: string
  adapter_type: WatchSourceAdapter
  base_url: string
  api_base_url: string
  recharge_ratio: number
  low_balance_threshold: number
  polling_interval_seconds: number
  request_timeout_seconds: number
  auth_mode?: WatchSourceAuthMode
  profile_path: string
  groups_path: string
  rates_path?: string
  pricing_path?: string
  keys_path?: string
  login_path?: string
  login_username_hint?: string
  heartbeat_path: string
  read_mapping?: WatchSourceReadMapping
  keepalive_enabled: boolean
  keepalive_interval_seconds: number
  auto_follow_key_group: boolean
  enabled: boolean
  has_credential: boolean
  has_login_credential: boolean
  credential_type?: WatchCredentialType
  last_check_status?: WatchCheckStatus
  last_check_at?: string
  last_success_at?: string
  last_error_code?: string
  last_latency_ms?: number
  last_balance?: number
  next_check_at?: string
  next_check_in_seconds: number
  check_due: boolean
  diagnostic_state?: WatchDiagnosticState
  diagnostic_state_reason?: string
  last_keepalive_status?: WatchCheckStatus
  last_keepalive_at?: string
  last_keepalive_success_at?: string
  last_keepalive_error_code?: string
  last_keepalive_latency_ms?: number
  last_token_refreshed_at?: string
  next_keepalive_at?: string
  next_keepalive_in_seconds: number
  keepalive_due: boolean
  keepalive_active: boolean
  keepalive_state?: WatchKeepaliveState
  keepalive_state_reason?: string
  keepalive_valid_until?: string
  created_at: string
  updated_at: string
}

export interface WatchSourceCredential {
  access_token?: string
  api_key?: string
  cookie?: string
  user_agent?: string
  extra_headers?: Record<string, string>
}

export interface WatchSourceInput {
  name: string
  adapter_type: WatchSourceAdapter
  base_url: string
  api_base_url?: string
  recharge_ratio: number
  low_balance_threshold: number
  polling_interval_seconds: number
  request_timeout_seconds: number
  keepalive_enabled?: boolean
  keepalive_interval_seconds?: number
  auto_follow_key_group?: boolean
  profile_path?: string
  groups_path?: string
  rates_path?: string
  pricing_path?: string
  keys_path?: string
  login_path?: string
  heartbeat_path?: string
  read_mapping?: WatchSourceReadMapping
  enabled: boolean
  auth_mode?: WatchSourceAuthMode
  login_username?: string
  login_email?: string
  login_password?: string
  credential_type?: WatchCredentialType
  credential?: WatchSourceCredential
  clear_credential?: boolean
}

export interface WatchSourceEndpointDiagnostic {
  name: string
  method: string
  path: string
  url: string
  status: 'pending' | 'success' | 'error' | 'needs_auth' | 'interactive_auth' | 'skipped'
  error_code?: string
  status_code?: number
  content_type?: string
  latency_ms: number
  optional: boolean
  json: boolean
  response_keys?: string[]
  response_preview?: string
  reason?: string
}

export interface WatchSourceDiagnosticReport {
  adapter_type: WatchSourceAdapter
  base_url: string
  api_base_url: string
  auth_mode: WatchSourceAuthMode
  generated_at: string
  endpoints: WatchSourceEndpointDiagnostic[]
}

export interface WatchSourcePortableKDF {
  name: string
  salt: string
  time: number
  memory_kib: number
  parallelism: number
  key_length: number
}

export interface WatchSourcePortableCipher {
  name: string
  nonce: string
}

export interface WatchSourcePortableEnvelope {
  format: string
  version: number
  encrypted: boolean
  created_at: string
  kdf: WatchSourcePortableKDF
  cipher: WatchSourcePortableCipher
  ciphertext: string
}

export interface WatchSourceImportPreviewItem {
  index: number
  name: string
  adapter_type: WatchSourceAdapter
  base_url: string
  auth_mode: WatchSourceAuthMode
  has_credential: boolean
  has_login_credential: boolean
  existing_source_id?: number
  default_action: 'create' | 'skip' | 'invalid'
  reason?: string
}

export interface WatchSourceImportPreview {
  format: string
  version: number
  count: number
  items: WatchSourceImportPreviewItem[]
}

export type WatchSourceImportAction = 'create' | 'skip' | 'overwrite' | 'rename'

export interface WatchSourceImportDecision {
  index: number
  action: WatchSourceImportAction
  name?: string
}

export interface WatchSourceImportResultItem {
  index: number
  name: string
  action: string
  source_id?: number
  status: string
  reason?: string
}

export interface WatchSourceImportResult {
  created: number
  updated: number
  skipped: number
  failed: number
  items: WatchSourceImportResultItem[]
}

export interface WatchSourceCheck {
  id: number
  source_id: number
  status: WatchCheckStatus
  error_code?: string
  latency_ms?: number
  observed_at: string
  expires_at: string
}

export interface WatchSourceGroupObservation {
  external_id: string
  name: string
  platform: string
  rate_multiplier: number
  user_rate_multiplier?: number
  pricing_available: boolean
  observed_at: string
}

export interface WatchSourcePriceObservation {
  group_external_id: string
  platform: string
  model: string
  component: WatchPriceComponent
  value: number
  observed_at: string
}

export interface WatchSourceKeyObservation {
  external_id: string
  label: string
  status?: string
  group_external_ids: string[]
  group_names: string[]
  summary?: string
  external_created_at?: string
  observed_at: string
}

export interface WatchSourceSnapshot {
  source: WatchSource
  check?: WatchSourceCheck
  balance?: number
  groups: WatchSourceGroupObservation[]
  prices: WatchSourcePriceObservation[]
  source_keys: WatchSourceKeyObservation[]
}

export interface WatchSourceInteractiveAuthSession {
  session_id: string
  source_id: number
  source_name: string
  auth_url: string
  status: 'pending' | 'completed'
  expires_at: string
  created_at: string
}

export interface WatchSourceInteractiveAuthCompleteInput {
  session_id: string
  credential_type: WatchCredentialType
  credential: WatchSourceCredential
  validate?: boolean
}

export interface WatchSourceInteractiveAuthCompleteResult {
  status: 'saved' | 'validated'
  source: WatchSource
  snapshot?: WatchSourceSnapshot
}

export interface WatchPriceChange {
  id: number
  source_id: number
  source_name: string
  group_external_id: string
  group_name?: string
  platform: string
  model?: string
  component: 'group_multiplier' | WatchPriceComponent
  previous_value: number
  next_value: number
  change_kind: 'increase' | 'decrease'
  observed_at: string
}

export interface WatchAccountUpstreamMapping {
  account_id: number
  account_name?: string
  platform?: string
  source_id: number
  source_name?: string
  source_key_external_id: string
  source_key_label?: string
  source_group_external_id?: string
  source_group_name?: string
  mapping_method: 'manual' | 'auto'
  group_binding_state: 'confirmed' | 'needs_confirmation'
  updated_by?: number
  created_at: string
  updated_at: string
}

export interface WatchAccountMappingInput {
  source_id: number
  source_key_external_id: string
  source_group_external_id?: string
  mapping_method?: 'manual' | 'auto'
}

export interface WatchAccountMappingRow {
  account_id: number
  account_name: string
  platform: string
  schedulable: boolean
  account_base_url?: string
  mapping?: WatchAccountUpstreamMapping
  mapping_status: 'mapped' | 'unmapped' | 'auto_match_available' | 'needs_confirmation'
  reason?: string
  in_target_group: boolean
  target_group_id?: number
  participation_reason?: string
  auto_matched_source_id?: number
  auto_matched_source_name?: string
}

export interface WatchAccountMappingsView {
  target_group_id?: number
  generated_at: string
  accounts: WatchAccountMappingRow[]
  sources: WatchSource[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface WatchAccountMappingCandidateGroup {
  external_id: string
  name: string
  platform?: string
  final_cost?: number
}

export interface WatchAccountMappingCandidate {
  account_id: number
  account_name: string
  platform: string
  account_base_url?: string
  source_id?: number
  source_name?: string
  source_key_external_id?: string
  source_key_label?: string
  source_group_external_id?: string
  source_group_name?: string
  groups?: WatchAccountMappingCandidateGroup[]
  status: 'ready' | 'needs_group' | 'multiple_match' | 'unmatched' | 'mapped' | 'needs_confirmation'
  reason?: string
  in_target_group: boolean
  target_group_id?: number
  participation_reason?: string
}

export interface WatchAccountMappingScanResult {
  target_group_id?: number
  generated_at: string
  candidates: WatchAccountMappingCandidate[]
  ready_count: number
  ambiguous_count: number
  mapped_count: number
}

export interface WatchAccountMappingBatchConfirmResult {
  saved: WatchAccountUpstreamMapping[]
  failed: Array<{ account_id: number; reason: string }>
  updated_at: string
}

export interface WatchPricingBoardModelPrice {
  platform: string
  model: string
  input_price?: number
  output_price?: number
  per_request_price?: number
  observed_at?: string
}

export interface WatchPricingBoardRow {
  source_id: number
  source_name: string
  adapter_type: WatchSourceAdapter
  group_external_id: string
  group_name: string
  platform: string
  tags?: string[]
  rate_multiplier: number
  user_rate_multiplier?: number
  recharge_ratio: number
  final_multiplier: number
  model_prices?: WatchPricingBoardModelPrice[]
  change_kind?: 'increase' | 'decrease'
  previous_value?: number
  next_value?: number
  change_observed_at?: string
  in_use: boolean
  in_use_account_count: number
  source_status?: WatchCheckStatus
  source_error_code?: string
  observed_at: string
}

export interface WatchPricingBoard {
  generated_at: string
  rows: WatchPricingBoardRow[]
}

export interface WatchPricingHistoryPoint {
  observed_at: string
  value: number
}

export interface WatchPricingHistory {
  source_id: number
  source_name?: string
  group_external_id: string
  group_name?: string
  component: 'group_multiplier' | WatchPriceComponent
  platform?: string
  model?: string
  summary: {
    min_value?: number
    max_value?: number
    record_count: number
  }
  points: WatchPricingHistoryPoint[]
  events: WatchPriceChange[]
  generated_at: string
}

export interface WatchIntegrationAccountHealthRow {
  account_id: number
  account_name: string
  platform: string
  account_status?: string
  schedulable: boolean
  account_base_url?: string
  source_id?: number
  source_name?: string
  source_group_external_id?: string
  source_group_name?: string
  last_request_at?: string
  window_request_count: number
  success_count: number
  failure_count: number
  success_rate?: number
  main_error?: string
  status: WatchIntegrationAccountHealthStatus
  status_reason?: string
}

export interface WatchIntegrationAccountHealthList {
  generated_at: string
  window_start: string
  window_end: string
  window_seconds: number
  healthy_count: number
  abnormal_count: number
  observing_count: number
  disabled_count: number
  items: WatchIntegrationAccountHealthRow[]
}

export async function getOverview(): Promise<WatchOverview> {
  const { data } = await apiClient.get<WatchOverview>('/admin/watch/overview')
  return data
}

export async function getOperationsReport(days = 7): Promise<WatchOperationsReport> {
  const { data } = await apiClient.get<WatchOperationsReport>('/admin/watch/operations', { params: { days } })
  return data
}

export async function listIntegrationAccountHealth(params: {
  status?: 'all' | WatchIntegrationAccountHealthStatus
  platform?: string
  source_id?: number
  search?: string
  window_seconds?: number
  limit?: number
} = {}): Promise<WatchIntegrationAccountHealthList> {
  const { data } = await apiClient.get<WatchIntegrationAccountHealthList>('/admin/watch/integration/accounts', { params })
  return data
}

export async function listPricingBoard(params: {
  source_id?: number
  platform?: string
  tag?: string
  search?: string
  change_kind?: 'all' | 'increase' | 'decrease'
  in_use?: 'all' | 'true' | 'false'
  sort?: string
  order?: 'asc' | 'desc'
} = {}): Promise<WatchPricingBoard> {
  const { data } = await apiClient.get<WatchPricingBoard>('/admin/watch/pricing/board', { params })
  return data
}

export async function getPricingHistory(params: {
  source_id: number
  group_external_id: string
  platform?: string
  model?: string
  component?: 'group_multiplier' | WatchPriceComponent
  change_kind?: 'all' | 'increase' | 'decrease'
  limit?: number
}): Promise<WatchPricingHistory> {
  const { data } = await apiClient.get<WatchPricingHistory>('/admin/watch/pricing/history', { params })
  return data
}

export async function previewPricing(input: {
  target_group_id: number
  mode: WatchPriceMode
  model?: string
  platform?: string
  component?: WatchPriceComponent
  source_group_ids?: number[]
  adjustment_step?: number
}): Promise<WatchPricingPreview> {
  const { data } = await apiClient.post<WatchPricingPreview>('/admin/watch/pricing/preview', input)
  return data
}

export async function applyPricing(input: WatchPricingApplyInput): Promise<WatchPriceAudit> {
  const { data } = await apiClient.post<WatchPriceAudit>('/admin/watch/pricing/apply', input, {
    headers: { 'Idempotency-Key': input.idempotency_key }
  })
  return data
}

export async function rollbackPricing(id: number, input: WatchPricingRollbackInput): Promise<WatchPriceAudit> {
  const { data } = await apiClient.post<WatchPriceAudit>(`/admin/watch/pricing/${id}/rollback`, input, {
    headers: { 'Idempotency-Key': input.idempotency_key }
  })
  return data
}

export async function listPriceAudits(limit = 100): Promise<WatchPriceAudit[]> {
  const { data } = await apiClient.get<WatchPriceAudit[]>('/admin/watch/audits', { params: { limit } })
  return data
}

export async function listPricingRules(): Promise<WatchPricingRule[]> {
  const { data } = await apiClient.get<WatchPricingRule[]>('/admin/watch/pricing-rules')
  return data
}

export async function createPricingRule(input: WatchPricingRuleInput): Promise<WatchPricingRule> {
  const { data } = await apiClient.post<WatchPricingRule>('/admin/watch/pricing-rules', input)
  return data
}

export async function updatePricingRule(id: number, input: WatchPricingRuleInput): Promise<WatchPricingRule> {
  const { data } = await apiClient.put<WatchPricingRule>(`/admin/watch/pricing-rules/${id}`, input)
  return data
}

export async function deletePricingRule(id: number): Promise<void> {
  await apiClient.delete(`/admin/watch/pricing-rules/${id}`)
}

export async function runPricingRule(id: number): Promise<WatchPricingRuleRunResult> {
  const { data } = await apiClient.post<WatchPricingRuleRunResult>(`/admin/watch/pricing-rules/${id}/run`)
  return data
}

export async function listRateAnomalies(params: { status?: 'all' | WatchRateAnomalyStatus; limit?: number } = {}): Promise<WatchRateAnomaly[]> {
  const { data } = await apiClient.get<WatchRateAnomaly[]>('/admin/watch/rate-anomalies', { params })
  return data
}

export async function previewRateCompensation(id: number): Promise<WatchRateCompensationPreview> {
  const { data } = await apiClient.get<WatchRateCompensationPreview>(`/admin/watch/rate-anomalies/${id}/compensation-preview`)
  return data
}

export async function applyRateCompensation(id: number, input: {
  user_ids: number[]
  confirmed: boolean
  idempotency_key: string
  reason: string
}): Promise<WatchRateCompensationApplyResult> {
  const { data } = await apiClient.post<WatchRateCompensationApplyResult>(`/admin/watch/rate-anomalies/${id}/compensate`, input, {
    headers: { 'Idempotency-Key': input.idempotency_key },
  })
  return data
}

export async function listSources(): Promise<WatchSource[]> {
  const { data } = await apiClient.get<WatchSource[]>('/admin/watch/sources')
  return data
}

export async function exportSources(input: { source_ids?: number[]; password: string; include_credentials?: boolean }): Promise<WatchSourcePortableEnvelope> {
  const { data } = await apiClient.post<WatchSourcePortableEnvelope>('/admin/watch/sources/export', {
    ...input,
    include_credentials: input.include_credentials ?? true,
  })
  return data
}

export async function previewSourceImport(input: { package: WatchSourcePortableEnvelope; password: string }): Promise<WatchSourceImportPreview> {
  const { data } = await apiClient.post<WatchSourceImportPreview>('/admin/watch/sources/import/preview', input)
  return data
}

export async function applySourceImport(input: {
  package: WatchSourcePortableEnvelope
  password: string
  decisions: WatchSourceImportDecision[]
}): Promise<WatchSourceImportResult> {
  const { data } = await apiClient.post<WatchSourceImportResult>('/admin/watch/sources/import/apply', input)
  return data
}

export async function getSource(id: number): Promise<WatchSourceSnapshot> {
  const { data } = await apiClient.get<WatchSourceSnapshot>(`/admin/watch/sources/${id}`)
  return data
}

export async function createSource(input: WatchSourceInput): Promise<WatchSource> {
  const { data } = await apiClient.post<WatchSource>('/admin/watch/sources', input)
  return data
}

export async function diagnoseSourceInput(input: WatchSourceInput): Promise<WatchSourceDiagnosticReport> {
  const { data } = await apiClient.post<WatchSourceDiagnosticReport>('/admin/watch/sources/diagnose-preview', input)
  return data
}

export async function updateSource(id: number, input: WatchSourceInput): Promise<WatchSource> {
  const { data } = await apiClient.put<WatchSource>(`/admin/watch/sources/${id}`, input)
  return data
}

export async function deleteSource(id: number): Promise<void> {
  await apiClient.delete(`/admin/watch/sources/${id}`)
}

export async function diagnoseSource(id: number): Promise<WatchSourceSnapshot> {
  const { data } = await apiClient.post<WatchSourceSnapshot>(`/admin/watch/sources/${id}/diagnose`)
  return data
}

export async function startSourceInteractiveAuth(id: number): Promise<WatchSourceInteractiveAuthSession> {
  const { data } = await apiClient.post<WatchSourceInteractiveAuthSession>(`/admin/watch/sources/${id}/interactive-auth/start`)
  return data
}

export async function getSourceInteractiveAuth(id: number, sessionId: string): Promise<WatchSourceInteractiveAuthSession> {
  const { data } = await apiClient.get<WatchSourceInteractiveAuthSession>(`/admin/watch/sources/${id}/interactive-auth/status`, { params: { session_id: sessionId } })
  return data
}

export async function completeSourceInteractiveAuth(id: number, input: WatchSourceInteractiveAuthCompleteInput): Promise<WatchSourceInteractiveAuthCompleteResult> {
  const { data } = await apiClient.post<WatchSourceInteractiveAuthCompleteResult>(`/admin/watch/sources/${id}/interactive-auth/complete`, input)
  return data
}

export async function keepaliveSource(id: number): Promise<WatchSourceSnapshot> {
  const { data } = await apiClient.post<WatchSourceSnapshot>(`/admin/watch/sources/${id}/keepalive`)
  return data
}

export async function listSourceChecks(id: number, limit = 50, kind?: 'diagnose' | 'keepalive'): Promise<WatchSourceCheck[]> {
  const { data } = await apiClient.get<WatchSourceCheck[]>(`/admin/watch/sources/${id}/checks`, { params: { limit, kind: kind === 'keepalive' ? 'keepalive' : undefined } })
  return data
}

export async function listPriceChanges(params: {
  limit?: number
  after_id?: number
  source_id?: number
  group_external_id?: string
  platform?: string
  model?: string
  component?: 'group_multiplier' | WatchPriceComponent
  change_kind?: 'all' | 'increase' | 'decrease'
} = {}): Promise<WatchPriceChange[]> {
  const { data } = await apiClient.get<WatchPriceChange[]>('/admin/watch/changes', { params })
  return data
}

export interface WatchAccountMappingFilters {
  target_group_id?: number
  platform?: string
  search?: string
  mapping_status?: 'mapped' | 'unmapped' | 'needs_confirmation'
  mapping_method?: 'auto' | 'manual'
  source_id?: number
}

export async function listAccountMappings(params: WatchAccountMappingFilters & { page?: number; page_size?: number } = {}): Promise<WatchAccountMappingsView> {
  const { data } = await apiClient.get<WatchAccountMappingsView>('/admin/watch/account-mappings', { params })
  return data
}

export async function scanAccountMappings(input: WatchAccountMappingFilters): Promise<WatchAccountMappingScanResult> {
  const { data } = await apiClient.post<WatchAccountMappingScanResult>('/admin/watch/account-mappings/scan', input)
  return data
}

export async function confirmAccountMappingBatch(input: {
  confirmed: boolean
  items: Array<WatchAccountMappingInput & { account_id: number }>
}): Promise<WatchAccountMappingBatchConfirmResult> {
  const { data } = await apiClient.post<WatchAccountMappingBatchConfirmResult>('/admin/watch/account-mappings/batch-confirm', input)
  return data
}

export async function saveAccountMapping(accountId: number, input: WatchAccountMappingInput): Promise<WatchAccountUpstreamMapping> {
  const { data } = await apiClient.put<WatchAccountUpstreamMapping>(`/admin/watch/account-mappings/${accountId}`, input)
  return data
}

export async function deleteAccountMapping(accountId: number): Promise<void> {
  await apiClient.delete(`/admin/watch/account-mappings/${accountId}`)
}

export const watchAPI = {
  getOverview,
  getOperationsReport,
  listIntegrationAccountHealth,
  listPricingBoard,
  getPricingHistory,
  previewPricing,
  applyPricing,
  rollbackPricing,
  listPriceAudits,
  listPricingRules,
  createPricingRule,
  updatePricingRule,
  deletePricingRule,
  runPricingRule,
  listRateAnomalies,
  previewRateCompensation,
  applyRateCompensation,
  listSources,
  getSource,
  createSource,
  diagnoseSourceInput,
  updateSource,
  deleteSource,
  diagnoseSource,
  keepaliveSource,
  listSourceChecks,
  listPriceChanges,
  listAccountMappings,
  scanAccountMappings,
  confirmAccountMappingBatch,
  saveAccountMapping,
  deleteAccountMapping,
}
export default watchAPI
