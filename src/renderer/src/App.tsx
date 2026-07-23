import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Database,
  Eye,
  EyeOff,
  FolderOpen,
  Gauge,
  HardDrive,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LogIn,
  LockKeyhole,
  Maximize2,
  KeyRound,
  Minimize2,
  MoreHorizontal,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Trash2,
  UserRoundCheck,
  X
} from 'lucide-react'
import type {
  AccountCostKind,
  AccountCostProfile,
  AccountUpstreamMapping,
  AccountGroupMutation,
  AccountSnapshot,
  DataCenterSummary,
  DataFileSummary,
  GroupCapabilityTagId,
  GroupChangeEvent,
  GroupChangeKind,
  InternalUserProfile,
  ProfitIntervalGranularity,
  ProfitIntervalReport,
  StationApiPaths,
  StationAdapterType,
  StationDiagnostics,
  GroupSnapshot,
  SourceKeySnapshot,
  StationInput,
  StationMappingPreview,
  StationPublic,
  StationReadCapability,
  StationReadMapping,
  StationRole,
  StationSnapshot,
  TimeCostLedger,
  UsageLedgerCoverage,
  WebAuthInput,
  WindowMode
} from '../../shared/types'
import { defaultStationApiPaths } from '../../shared/sub2api'
import { mappingFieldDefinitions, stationReadCapabilities } from '../../shared/station-read-mapping'
import { emptyTimeCostLedger, latestLedgerObservationAt, summarizeTemporalUsageCosts, type TemporalUsageCostSummary } from '../../shared/time-cost-ledger'
import { analyzeUsageCapability, type UsageCapabilityDiagnostic, type UsageCapabilityPrecision } from '../../shared/usage-diagnostics'

const demoStations: StationPublic[] = [
  {
    id: 'demo-primary',
    name: '主力中转站',
    baseUrl: 'https://demo.sub2api.local/api/v1',
    apiBaseUrl: '',
    stationRole: 'own',
    rechargeRatio: 10,
    lowBalanceThreshold: 20,
    apiPaths: {},
    hasAccessToken: true,
    hasRefreshToken: true,
    hasAdminToken: true,
    hasSavedLoginCredentials: false,
    autoReauthEnabled: false,
    adminCredentialType: 'jwt',
    pollingIntervalMs: 30_000
  },
  {
    id: 'demo-fallback',
    name: '备用线路',
    baseUrl: 'https://backup.sub2api.local/api/v1',
    apiBaseUrl: '',
    stationRole: 'source',
    rechargeRatio: 1,
    lowBalanceThreshold: 50,
    apiPaths: {},
    hasAccessToken: true,
    hasRefreshToken: false,
    hasAdminToken: false,
    hasSavedLoginCredentials: false,
    autoReauthEnabled: false,
    pollingIntervalMs: 30_000
  }
]

const demoGroups: GroupSnapshot[] = [
  { id: 101, name: 'Claude Code Pro', platform: 'anthropic', rateMultiplier: 0.72, userRateMultiplier: 0.68, pricingAvailable: true, pricingHint: 'claude-3-7-sonnet 入 0.0030 / 出 0.0150', pricingModels: [{ name: 'claude-3-7-sonnet', inputPrice: 0.003, outputPrice: 0.015 }] },
  { id: 102, name: 'OpenAI Fast', platform: 'openai', rateMultiplier: 0.45, userRateMultiplier: 0.45, pricingAvailable: true, pricingHint: 'gpt-4.1 入 0.0020 / 出 0.0080', pricingModels: [{ name: 'gpt-4.1', inputPrice: 0.002, outputPrice: 0.008 }] },
  { id: 103, name: 'Gemini Image 生图', platform: 'gemini', rateMultiplier: 0.23, userRateMultiplier: 0.23, pricingAvailable: false, pricingHint: 'img 价格接口未启用' },
  { id: 104, name: 'Grok 夜间组', platform: 'grok', rateMultiplier: 0.58, userRateMultiplier: 0.5, pricingAvailable: true, pricingHint: 'grok-4 入 0.0030 / 出 0.0150', pricingModels: [{ name: 'grok-4', inputPrice: 0.003, outputPrice: 0.015 }] },
  { id: 105, name: 'Antigravity Dev', platform: 'antigravity', rateMultiplier: 0.66, userRateMultiplier: 0.6, pricingAvailable: true, pricingHint: 'antigravity 入 0.0018 / 出 0.0060', pricingModels: [{ name: 'antigravity', inputPrice: 0.0018, outputPrice: 0.006 }] }
]

const demoSnapshots: Record<string, StationSnapshot> = {
  'demo-primary': {
    stationId: 'demo-primary', stationName: '主力中转站', health: 'healthy', balance: 128.42, currency: 'USD', groups: demoGroups,
    accounts: [{ id: 1, name: 'claude-main', platform: 'anthropic', groupIds: [101, 103], groups: ['Claude Code Pro', 'Gemini Image 生图'], status: 'active', scheduleEnabled: true }, { id: 2, name: 'openai-pool', platform: 'openai', groupIds: [102], groups: ['OpenAI Fast'], status: 'active', scheduleEnabled: false }],
    lastUpdatedAt: new Date(Date.now() - 18_000).toISOString(), lastSuccessAt: new Date(Date.now() - 18_000).toISOString(), responseTimeMs: 284, priceCapability: 'available'
  },
  'demo-fallback': {
    stationId: 'demo-fallback', stationName: '备用线路', health: 'stale', balance: 42.1, currency: 'USD', groups: demoGroups.slice(0, 2), accounts: [],
    lastUpdatedAt: new Date(Date.now() - 9 * 60_000).toISOString(), lastSuccessAt: new Date(Date.now() - 9 * 60_000).toISOString(), responseTimeMs: 690, priceCapability: 'disabled', errorCode: 'API_ERROR', errorMessage: '最近一次刷新返回 503'
  }
}

const demoGroupChangeEvents: GroupChangeEvent[] = [
  {
    id: 'demo-rate-down',
    kind: 'rate-down',
    stationId: 'demo-primary',
    stationName: '主力中转站',
    groupId: 101,
    groupName: 'Claude Code Pro',
    platform: 'anthropic',
    previousRate: 0.8,
    nextRate: 0.68,
    occurredAt: new Date(Date.now() - 5 * 60_000).toISOString()
  },
  {
    id: 'demo-rate-up',
    kind: 'rate-up',
    stationId: 'demo-primary',
    stationName: '主力中转站',
    groupId: 102,
    groupName: 'OpenAI Fast',
    platform: 'openai',
    previousRate: 0.35,
    nextRate: 0.45,
    occurredAt: new Date(Date.now() - 10 * 60_000).toISOString()
  },
  {
    id: 'demo-added',
    kind: 'added',
    stationId: 'demo-primary',
    stationName: '主力中转站',
    groupId: 103,
    groupName: 'Gemini Image 生图',
    platform: 'gemini',
    nextRate: 0.23,
    occurredAt: new Date(Date.now() - 15 * 60_000).toISOString()
  },
  {
    id: 'demo-removed',
    kind: 'removed',
    stationId: 'demo-fallback',
    stationName: '备用线路',
    groupId: 999,
    groupName: '废弃 Claude 旧组',
    platform: 'anthropic',
    previousRate: 0.9,
    occurredAt: new Date(Date.now() - 20 * 60_000).toISOString()
  }
]

type SettingsForm = {
  id?: string
  name: string
  baseUrl: string
  apiBaseUrl: string
  stationRole: StationRole
  adapterType: StationAdapterType
  detectedAdapterType?: Exclude<StationAdapterType, 'auto'>
  accessToken: string
  refreshToken: string
  adminToken: string
  adminCredentialType: 'jwt' | 'api-key'
  loginAccount: string
  loginPassword: string
  clearSavedLoginCredentials: boolean
  autoReauthEnabled: boolean
  pollingIntervalMs: number
  rechargeRatio: number
  lowBalanceThreshold: number
  apiPaths: StationApiPaths
}

type NoticeKind = 'success' | 'warning' | 'error'

const newApiPathDefaults: StationApiPaths = { profile: '/api/user/self', groups: '/api/user/self/groups', channels: '/api/pricing', keys: '/api/token/?p=0&size=100', authRefresh: '/api/user/auth/refresh' }
const emptyForm: SettingsForm = { name: '', baseUrl: '', apiBaseUrl: '', stationRole: 'source', adapterType: 'auto', accessToken: '', refreshToken: '', adminToken: '', adminCredentialType: 'jwt', loginAccount: '', loginPassword: '', clearSavedLoginCredentials: false, autoReauthEnabled: false, pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {} }

const categoryTabs = [
  { id: 'all', label: '全部', keywords: [] },
  { id: 'anthropic', label: 'Anthropic', keywords: ['anthropic', 'claude', 'sonnet', 'haiku', 'opus'] },
  { id: 'openai', label: 'OpenAI', keywords: ['openai', 'gpt', 'o1', 'o3', 'o4', 'chatgpt'] },
  { id: 'gemini', label: 'Gemini', keywords: ['gemini', 'google'] },
  { id: 'antigravity', label: 'Antigravity', keywords: ['antigravity'] },
  { id: 'grok', label: 'Grok', keywords: ['grok', 'xai', 'x-ai'] },
  { id: 'other', label: '其他', keywords: [] }
] as const

type CategoryId = typeof categoryTabs[number]['id']

type RankingSortKey = 'effectiveCost' | 'effectiveMultiplier' | 'rateMultiplier' | 'rechargeRatio'

type RankingSortDirection = 'asc' | 'desc'

type RankingSortState = {
  key: RankingSortKey
  direction: RankingSortDirection
}

type CostViewMode = 'group' | 'account'

type CostStatusFilter = 'all' | ProfitRiskStatus

type CostKindFilter = 'all' | 'unset' | AccountCostKind

type CostSortMode = 'unset-first' | 'risk' | 'cost-kind' | 'category' | 'group-rate' | 'account-count' | 'margin'

type WorkspaceView = 'pricing' | 'stations' | 'integration' | 'data'

type IntegrationDraft = {
  apiPaths: StationApiPaths
  readMapping: StationReadMapping
}

function integrationTemplateFor(station: StationPublic): StationReadMapping['template'] {
  try {
    const hostname = new URL(station.baseUrl).hostname.toLowerCase()
    if (hostname === 'lcodex.cc') return 'lcodex'
    if (hostname === 'aihub.top') return 'aihub'
  } catch {
    // Stored station URLs have already passed main-process validation.
  }
  return station.adapterType === 'newapi' ? 'newapi' : 'sub2api'
}

function integrationDraftFromStation(station: StationPublic): IntegrationDraft {
  return {
    apiPaths: { ...station.apiPaths },
    readMapping: station.readMapping ?? { version: 1, template: integrationTemplateFor(station), capabilities: {} }
  }
}

type SourceWalletView = 'source' | 'own'

type SourceWalletSortDirection = RankingSortDirection

type StationConsoleTab = 'overview' | 'users' | 'accounts' | 'protection' | 'profit' | 'groups' | 'channels' | 'platforms' | 'usage' | 'settings'

type RankingSortOption = {
  key: RankingSortKey
  label: string
}

const defaultRankingSort: RankingSortState = { key: 'effectiveMultiplier', direction: 'asc' }

const rankingSortLabels: Record<RankingSortKey, string> = {
  effectiveCost: '模型价格',
  effectiveMultiplier: '最终倍率',
  rateMultiplier: '倍率',
  rechargeRatio: '充值比例'
}

const rankingSortDefaultDirections: Record<RankingSortKey, RankingSortDirection> = {
  effectiveCost: 'asc',
  effectiveMultiplier: 'asc',
  rateMultiplier: 'asc',
  rechargeRatio: 'desc'
}

const rankingSortOptions: RankingSortOption[] = [
  { key: 'rateMultiplier', label: '倍率' },
  { key: 'rechargeRatio', label: '充值' },
  { key: 'effectiveMultiplier', label: '最终倍率' },
  { key: 'effectiveCost', label: '模型价格' }
]

const stationConsoleTabs: Array<{ id: StationConsoleTab; label: string; hint: string }> = [
  { id: 'overview', label: '总览', hint: '快速查看当前站点的整体健康、账户和用量' },
  { id: 'users', label: '用户', hint: '用户管理、API Key、平台配额和登录信息' },
  { id: 'accounts', label: '账号', hint: '聚合账号、分组和批量切换管理' },
  { id: 'protection', label: '成本', hint: '账号上游映射、基础倍率建议和亏损保护' },
  { id: 'profit', label: '收益', hint: '按管理员用量明细核算区间收入、上游成本和亏损' },
  { id: 'groups', label: '分组', hint: '分组倍率、标签、隐藏和变化记录' },
  { id: 'channels', label: '渠道', hint: '模型渠道、价格与最终倍率对比' },
  { id: 'platforms', label: '平台', hint: '按平台分组和分类统计' },
  { id: 'usage', label: '用量', hint: '消费、请求和用量统计' },
  { id: 'settings', label: '设置', hint: '站点配置、路径和重新授权入口' }
]

const hiddenGroupsStorageKey = 'aizzzwatch:hidden-ranking-groups:v1'
const groupChangeEventsStorageKey = 'aizzzwatch:group-change-events:v1'
const groupChangeEventsRetentionLimit = 50_000
const accountRecommendationStrategyStorageKey = 'aizzzwatch:account-recommendation-strategy:v1'
const groupChangeNotificationStorageKey = 'aizzzwatch:last-change-notification:v1'

type GroupCapabilityTag = {
  id: GroupCapabilityTagId
  label: string
}

type GroupTagFilter = 'all' | GroupCapabilityTagId

type GroupChangeFilter = 'all' | GroupChangeKind

type RankingChangeFilter = 'all' | 'rate-up' | 'rate-down'

type RankingUsageFilter = 'in-use' | 'not-in-use'

type GroupHistorySelection = {
  stationId: string
  groupId: number
}

type GroupHistoryTrendPoint = {
  id: string
  value: number
  occurredAt: string
  kind: GroupChangeKind
}

const groupCapabilityTags: Array<GroupCapabilityTag & { keywords: string[] }> = [
  { id: 'image', label: '生图', keywords: ['img', 'image', 'images', 'picture', 'photo', 'draw', '绘图', '画图', '生图', '文生图', '图像生成', 'midjourney', 'mj', 'dall-e', 'dalle', 'stable diffusion', 'sdxl', 'flux', 'ideogram'] },
  { id: 'coding', label: '代码', keywords: ['code', 'coding', 'coder', 'codex', 'claude code', 'cursor', 'antigravity', 'dev'] },
  { id: 'vision', label: '视觉', keywords: ['vision', 'visual', 'vl', 'ocr', '看图', '识图', '图像理解'] },
  { id: 'embedding', label: '向量', keywords: ['embedding', 'embeddings', 'embed', 'rerank', '向量', '重排'] },
  { id: 'audio', label: '语音', keywords: ['audio', 'speech', 'voice', 'tts', 'stt', 'whisper', '语音', '音频', '转录'] },
  { id: 'video', label: '视频', keywords: ['video', 'sora', 'runway', 'kling', 'veo', '视频', '生视频'] }
]

const defaultGroupCapabilityTag: GroupCapabilityTag = { id: 'chat', label: '对话' }

const groupChangeFilterOptions: Array<{ id: GroupChangeFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'rate-down', label: '降价' },
  { id: 'rate-up', label: '涨价' },
  { id: 'added', label: '新增' },
  { id: 'removed', label: '删除' }
]

const accountRecommendationStrategyOptions: Array<{ id: AccountRecommendationStrategy; label: string; hint: string }> = [
  { id: 'category-first', label: '当前分类优先', hint: '先按当前分类和标签找最低，找不到再回退全部分组' },
  { id: 'all-station', label: '全站最低', hint: '忽略当前分类，只在当前站点可见分组里找最低' }
]

const accountScheduleFilterOptions: Array<{ id: AccountScheduleFilter; label: string }> = [
  { id: 'all', label: '全部调度' },
  { id: 'enabled', label: '调度开启' },
  { id: 'disabled', label: '调度关闭' },
  { id: 'unknown', label: '调度未知' }
]

type ComparisonRow = {
  key: string
  category: CategoryId
  categoryLabel: string
  tags: GroupCapabilityTag[]
  specialTags: ReturnType<typeof groupSpecialTags>
  modelName: string
  platform: string
  stationId: string
  stationName: string
  groupId: number
  groupName: string
  rateMultiplier: number
  rechargeRatio: number
  effectiveMultiplier: number
  balance?: number
  health: StationSnapshot['health']
  lastUpdatedAt?: string
  effectiveInputPrice?: number
  effectiveOutputPrice?: number
  effectiveRequestPrice?: number
  rawInputPrice?: number
  rawOutputPrice?: number
  rawRequestPrice?: number
  score?: number
}

type ComparableGroup = {
  id: number
  name: string
  platform: string
  rate: number
}

type GroupSwitchOption = {
  group: GroupSnapshot
  rate: number
  effectiveMultiplier: number
}

type GroupSwitchPlatformFilter = 'all' | string

type GroupSwitchScope = 'category' | 'all'

type GroupSwitchPreviewDirection = 'cheaper' | 'more-expensive' | 'same' | 'unknown'

type AccountRecommendationStrategy = 'category-first' | 'all-station'
type AccountScheduleFilter = 'all' | 'enabled' | 'disabled' | 'unknown'
type AccountScheduleState = Exclude<AccountScheduleFilter, 'all'>
type AccountPlatformFilter = 'all' | string
type AccountGroupFilter = 'all' | string

type AccountGroupFilterOption = {
  id: string
  label: string
  meta: string
  count: number
}

type GroupSwitchPreview = {
  previousLabel: string
  nextLabel: string
  previousEffectiveMultiplier?: number
  nextEffectiveMultiplier?: number
  delta?: number
  direction: GroupSwitchPreviewDirection
}

type AccountGroupRecommendation = {
  option: GroupSwitchOption
  safeForAccount: boolean
  currentEffectiveMultiplier?: number
  safetyEffectiveMultiplier?: number
}

type AccountGroupCandidate = GroupSwitchOption & {
  safeForAccount: boolean
  scopeLabel: string
  safetyEffectiveMultiplier?: number
}

type AccountRecommendationTone = 'initial' | 'safe' | 'candidate'

type AdminAccountWorkbenchRow = {
  focusKey: string
  station: StationPublic
  snapshot?: StationSnapshot
  account: AccountSnapshot
  recommendation?: AccountGroupRecommendation & { scopeLabel: string }
  currentGroups: GroupSwitchOption[]
}

type MappingEditorState = {
  accountStationId: string
  accountId: number
  sourceStationId: string
  sourceKeyId: string
  sourceGroupId: number | ''
  sourceKeyLabel: string
}

type MappingRebuildPreview = {
  mappings: AccountUpstreamMapping[]
  candidates: AccountUpstreamMapping[]
  scanned: number
  skippedExisting: number
}

type CostProfileEditorState = {
  accountStationId: string
  accountId: number
  kind: AccountCostKind
  fixedCostAmount: string
  cycleDays: string
  variableCostMultiplier: string
  note: string
}

type BatchCostProfileEditorState = Omit<CostProfileEditorState, 'accountId'> & {
  sellingGroupId: number
  sellingGroupName: string
  accountIds: number[]
  existingProfileCount: number
  crossGroupAccountCount: number
  mode: 'unset-only' | 'overwrite-all'
}

type ProfitRiskStatus = 'profitable' | 'near-loss' | 'loss' | 'unmapped' | 'stale' | 'exempt'

type AccountGroupProfitRow = {
  key: string
  station: StationPublic
  snapshot?: StationSnapshot
  account: AccountSnapshot
  group: GroupSnapshot
  mapping?: AccountUpstreamMapping
  costProfile?: AccountCostProfile
  costKind: AccountCostKind
  sourceStation?: StationPublic
  sourceGroup?: GroupSnapshot
  upstreamEffectiveMultiplier?: number
  accountCostMultiplier?: number
  groupEffectiveMultiplier: number
  unitMargin?: number
  suggestedBaseRateMultiplier?: number
  baseRateNeedsUpdate: boolean
  usageAmount?: number
  estimatedProfit?: number
  temporalCostSummary?: TemporalUsageCostSummary
  status: ProfitRiskStatus
}

type AccountProfitGroup = {
  key: string
  station: StationPublic
  account: AccountSnapshot
  rows: AccountGroupProfitRow[]
  summaryStatus: ProfitRiskStatus
  hasCostProfile: boolean
  costKind: AccountCostKind
  primaryCategory: CategoryId
  primaryCategoryLabel: string
  minEffectiveMultiplier?: number
  maxEffectiveMultiplier?: number
}

type SellingGroupProfitGroup = {
  key: string
  station: StationPublic
  group: GroupSnapshot
  rows: AccountGroupProfitRow[]
  summaryStatus: ProfitRiskStatus
  category: CategoryId
  categoryLabel: string
  groupEffectiveMultiplier: number
  accountCount: number
  lossCount: number
  nearLossCount: number
  unmappedCount: number
  hasUnsetAccountCost: boolean
  minAccountCostMultiplier?: number
  maxAccountCostMultiplier?: number
  minUnitMargin?: number
  cheapestAccountRow?: AccountGroupProfitRow
}

type BatchMutationResultStatus = 'success' | 'failed' | 'skipped'

type BatchMutationResult = {
  id: string
  status: BatchMutationResultStatus
  accountName: string
  stationName: string
  targetLabel: string
  occurredAt: string
  message?: string
}

type GroupMenuState = {
  stationId: string
  groupId: number
}

type SourceStationAction = {
  stationId: string
  kind: 'refresh' | 'retry' | 'login'
}

function initialWindowMode(): WindowMode {
  const value = new URLSearchParams(window.location.search).get('mode')
  return value === 'bubble' || value === 'compact' ? value : 'full'
}

function formatMoney(value: number | undefined): string {
  if (typeof value !== 'number') return '--'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function isStationBalanceLow(balance: number | undefined, lowBalanceThreshold: number): boolean {
  return typeof balance === 'number'
    && Number.isFinite(balance)
    && Number.isFinite(lowBalanceThreshold)
    && lowBalanceThreshold > 0
    && balance <= lowBalanceThreshold
}

function formatTime(value?: string): string {
  if (!value) return '从未同步'
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value))
}

function formatGroupChangeObservedAt(value?: string): string {
  if (!value) return ''
  const occurredAt = new Date(value)
  if (Number.isNaN(occurredAt.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .format(occurredAt)
    .replaceAll('/', '-')
}

function autoReauthStatusLabel(status: StationPublic['autoReauthStatus']): string {
  if (!status) return ''
  const timestamp = formatGroupChangeObservedAt(status.at)
  if (status.state === 'pending') return `正在尝试重新登录${timestamp ? ` · ${timestamp}` : ''}`
  if (status.state === 'success') return `上次保活成功${timestamp ? ` · ${timestamp}` : ''}`
  if (status.state === 'manual-required') return `需要人工完成验证${timestamp ? ` · ${timestamp}` : ''}`
  return `上次保活未完成${timestamp ? ` · ${timestamp}` : ''}`
}

function formatAge(value: string | undefined, now: number): string {
  if (!value) return '等待数据'
  const age = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000))
  if (age < 60) return `${age} 秒前`
  return `${Math.floor(age / 60)} 分钟前`
}

function formatBytes(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} KB`
  return `${(value / 1024 / 1024).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} MB`
}

function formatDataFileTime(file: DataFileSummary): string {
  return file.exists ? formatTime(file.updatedAt) : '尚未生成'
}

function dataFileStatusText(file: DataFileSummary): string {
  return file.exists ? `${formatBytes(file.sizeBytes)} · ${formatDataFileTime(file)}` : '本地文件尚未生成'
}

function formatRechargeRatio(value: number | undefined): string {
  return `1:${(value ?? 1).toLocaleString('zh-CN', { maximumFractionDigits: 4 })}`
}

function sourceKeyLabel(key: SourceKeySnapshot, index: number): string {
  return key.label || `密钥 ${index + 1}`
}

function sourceKeyStatusLabel(key: SourceKeySnapshot): string {
  return key.status ? key.status : '状态未知'
}

function sourceKeyGroupLabel(key: SourceKeySnapshot): string {
  if (key.groupNames.length > 0) return key.groupNames.join('、')
  if (key.groupIds.length > 0) return key.groupIds.map((id) => String(id)).join('、')
  return '未绑定分组'
}

type AdminRecord = Record<string, unknown>

function isAdminRecord(value: unknown): value is AdminRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function formatAdminValue(value: unknown): string {
  if (value === null || value === undefined) return '--'
  if (typeof value === 'string') return value.trim() || '--'
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 4 }) : '--'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (Array.isArray(value)) return value.map((item) => formatAdminValue(item)).join('、') || '--'
  if (isAdminRecord(value)) return Object.entries(value).slice(0, 4).map(([key, item]) => `${key}: ${formatAdminValue(item)}`).join(' · ') || '--'
  return '--'
}

function adminRecordLabel(record: AdminRecord, fallback: string): string {
  const label = [record.name, record.title, record.username, record.email, record.label, record.key, record.id]
    .find((value) => typeof value === 'string' && value.trim()) ?? fallback
  return String(label)
}

function adminRecordMeta(record: AdminRecord): string {
  return [
    record.status,
    record.role,
    record.signup_source,
    record.platform,
    record.source,
    record.type
    ].filter((value) => typeof value === 'string' && value.trim()).map((value) => String(value)).join(' · ')
}

function adminRecordNumber(record: AdminRecord, preferredKeys: string[] = []): number | undefined {
  for (const key of [...preferredKeys, ...Object.keys(record)]) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function adminRecordPositiveInteger(record: AdminRecord, preferredKeys: string[] = []): number | undefined {
  for (const key of [...preferredKeys, ...Object.keys(record)]) {
    const value = record[key]
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : undefined
    if (typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0) return parsed
  }
  return undefined
}

function adminRecordFields(record: AdminRecord, preferredKeys: string[] = []): Array<{ label: string; value: string }> {
  const keys = [
    ...preferredKeys,
    ...Object.keys(record).filter((key) => !preferredKeys.includes(key))
  ]
  return keys
    .filter((key) => !['name', 'title', 'username', 'email', 'label', 'key', 'id', 'status', 'role', 'signup_source', 'platform', 'source', 'type'].includes(key))
    .slice(0, 4)
    .map((key) => ({ label: key, value: formatAdminValue(record[key]) }))
}

function adminRecordArray(value: unknown): AdminRecord[] {
  return Array.isArray(value) ? value.filter(isAdminRecord) : []
}

function stationConsoleTitle(tab: StationConsoleTab): string {
  if (tab === 'overview') return '管理总览'
  if (tab === 'users') return '用户管理'
  if (tab === 'accounts') return '账号管理'
  if (tab === 'protection') return '成本保护'
  if (tab === 'profit') return '收益核算'
  if (tab === 'groups') return '分组管理'
  if (tab === 'channels') return '渠道管理'
  if (tab === 'platforms') return '平台视图'
  if (tab === 'usage') return '用量统计'
  return '站点设置'
}

export function formatRateMultiplier(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}x`
}

export function effectiveMultiplierValue(rateMultiplier: number, rechargeRatio: number): number {
  if (!Number.isFinite(rateMultiplier) || !Number.isFinite(rechargeRatio) || rechargeRatio <= 0) return Number.POSITIVE_INFINITY
  return rateMultiplier / rechargeRatio
}

function accountUpstreamMappingKey(accountStationId: string, accountId: number): string {
  return `${accountStationId}:${accountId}`
}

export type UpstreamMappingResolutionState = 'unmapped' | 'legacy-ready' | 'legacy-stale' | 'key-following' | 'key-multiple-groups' | 'key-missing' | 'key-unassigned' | 'key-group-missing'

export interface UpstreamMappingResolution {
  state: UpstreamMappingResolutionState
  sourceKey?: SourceKeySnapshot
  group?: GroupSnapshot
}

export interface ActiveUpstreamGroupUsage {
  accountStationId: string
  accountId: number
  sourceStationId: string
  sourceGroupId: number
}

/**
 * Resolves the current upstream cost group without persisting a remote group
 * change. A Key with one group follows that group; multi-group Keys remain on
 * the previously confirmed group until the user chooses the protection basis.
 */
export function resolveAccountUpstreamMappingSource(
  mapping: AccountUpstreamMapping | undefined,
  sourceSnapshot: Pick<StationSnapshot, 'groups' | 'sourceKeys'> | undefined
): UpstreamMappingResolution {
  if (!mapping) return { state: 'unmapped' }
  const legacyGroup = sourceSnapshot?.groups.find((group) => group.id === mapping.sourceGroupId)
  if (!mapping.sourceKeyId) return legacyGroup ? { state: 'legacy-ready', group: legacyGroup } : { state: 'legacy-stale' }

  const sourceKey = sourceSnapshot?.sourceKeys?.find((key) => key.id === mapping.sourceKeyId)
  if (!sourceKey) return { state: 'key-missing' }
  const groupIds = [...new Set(sourceKey.groupIds.filter((id) => Number.isInteger(id) && id > 0))]
  if (groupIds.length === 0) return { state: 'key-unassigned', sourceKey }
  if (groupIds.length === 1) {
    const group = sourceSnapshot?.groups.find((item) => item.id === groupIds[0])
    return group ? { state: 'key-following', sourceKey, group } : { state: 'key-group-missing', sourceKey }
  }
  const group = legacyGroup && groupIds.includes(legacyGroup.id) ? legacyGroup : undefined
  return { state: 'key-multiple-groups', sourceKey, group }
}

/**
 * A price-ranking group is in use only when its upstream relationship is
 * exact. Multi-group Keys are deliberately excluded until their cost basis is
 * confirmed, so an ambiguous relationship is never presented as active use.
 */
export function activeUpstreamGroupUsages(
  mappings: AccountUpstreamMapping[],
  snapshots: Record<string, Pick<StationSnapshot, 'groups' | 'sourceKeys'> | undefined>
): ActiveUpstreamGroupUsage[] {
  const usages = new Map<string, ActiveUpstreamGroupUsage>()
  for (const mapping of mappings) {
    const resolution = resolveAccountUpstreamMappingSource(mapping, snapshots[mapping.sourceStationId])
    if ((resolution.state !== 'legacy-ready' && resolution.state !== 'key-following') || !resolution.group) continue
    const usage = {
      accountStationId: mapping.accountStationId,
      accountId: mapping.accountId,
      sourceStationId: mapping.sourceStationId,
      sourceGroupId: resolution.group.id
    }
    usages.set(`${usage.accountStationId}:${usage.accountId}:${usage.sourceStationId}:${usage.sourceGroupId}`, usage)
  }
  return [...usages.values()]
}

function accountCostKindLabel(kind: AccountCostKind): string {
  if (kind === 'self-owned-exempt') return '账号免计费'
  if (kind === 'gifted') return '赠送免费'
  if (kind === 'subscription') return '自购订阅'
  if (kind === 'manual') return '手动成本'
  return '三方按量'
}

function accountCostKindHint(kind: AccountCostKind): string {
  if (kind === 'self-owned-exempt') return '按上游账号免成本；使用用户仍需在用户页单独设为内部自用'
  if (kind === 'gifted') return '成本为 0，不需要绑定三方来源'
  if (kind === 'subscription') return '固定周期成本，可选填写额外单位成本'
  if (kind === 'manual') return '用固定成本和单位成本兜底'
  return '按绑定的三方站点分组折算成本'
}

function formatCostAmount(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function looksLikeSecretLabel(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/bearer\s+/i.test(trimmed) || /^sk-[a-z0-9_-]{16,}/i.test(trimmed) || /^eyJ[a-z0-9_-]+\./i.test(trimmed)) return true
  return trimmed.length > 48 && !/\s/.test(trimmed)
}

function formatSignedMultiplier(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatRateMultiplier(value)}`
}

function formatProfitStatus(status: ProfitRiskStatus): string {
  if (status === 'exempt') return '免计费'
  if (status === 'profitable') return '赚钱'
  if (status === 'near-loss') return '接近亏损'
  if (status === 'loss') return '亏损'
  if (status === 'stale') return '来源失效'
  return '未绑定'
}

function profitRiskWeight(status: ProfitRiskStatus): number {
  const riskWeight: Record<ProfitRiskStatus, number> = { loss: 0, 'near-loss': 1, stale: 2, unmapped: 3, profitable: 4, exempt: 5 }
  return riskWeight[status]
}

function accountCostKindSortWeight(kind: AccountCostKind): number {
  if (kind === 'upstream-metered') return 0
  if (kind === 'self-owned-exempt') return 1
  if (kind === 'gifted') return 2
  if (kind === 'subscription') return 3
  return 4
}

function categorySortWeight(category: CategoryId): number {
  const index = categoryTabs.findIndex((item) => item.id === category)
  return index >= 0 ? index : categoryTabs.length
}

function usageCapabilityTone(precision: UsageCapabilityPrecision): string {
  if (precision === 'precise') return 'strong'
  if (precision === 'account') return 'medium'
  if (precision === 'aggregate' || precision === 'unit-only') return 'weak'
  return 'missing'
}

function usageCapabilityDimensionLabels(diagnostic: UsageCapabilityDiagnostic): string[] {
  const labels = [
    diagnostic.dimensions.account ? '账号' : undefined,
    diagnostic.dimensions.group ? '分组' : undefined,
    diagnostic.dimensions.key ? '密钥' : undefined,
    diagnostic.dimensions.user ? '用户' : undefined,
    diagnostic.dimensions.model ? '模型' : undefined,
    diagnostic.dimensions.time ? '时间' : undefined
  ].filter((item): item is string => Boolean(item))
  return labels.length > 0 ? labels : ['未识别维度']
}

function usageCapabilityMeasureLabels(diagnostic: UsageCapabilityDiagnostic): string[] {
  const labels = [
    diagnostic.measures.cost ? '费用' : undefined,
    diagnostic.measures.tokens ? 'Tokens' : undefined,
    diagnostic.measures.requests ? '请求' : undefined,
    diagnostic.measures.quota ? '额度' : undefined,
    diagnostic.measures.usage ? '用量' : undefined
  ].filter((item): item is string => Boolean(item))
  return labels.length > 0 ? labels : ['未识别消耗']
}

function usageLedgerCoverageLabel(coverage: UsageLedgerCoverage | undefined): string {
  if (!coverage) return '管理员明细尚未读取'
  const state = coverage.state === 'complete'
    ? '覆盖完成'
    : coverage.state === 'page-limit'
      ? '仅覆盖最近页'
      : coverage.state === 'incomplete'
        ? '字段不完整，未伪造精确账'
        : '明细接口不可用'
  return `${state} · ${coverage.acceptedEntries}/${coverage.recordsSeen} 条 · ${formatTime(coverage.fetchedAt)}`
}

function profitRiskStatus(groupEffectiveMultiplier: number, upstreamEffectiveMultiplier?: number): ProfitRiskStatus {
  if (typeof upstreamEffectiveMultiplier !== 'number' || !Number.isFinite(upstreamEffectiveMultiplier)) return 'unmapped'
  const margin = groupEffectiveMultiplier - upstreamEffectiveMultiplier
  if (margin < -0.000_000_1) return 'loss'
  const nearLossLine = Math.max(0.001, upstreamEffectiveMultiplier * 0.05)
  if (margin <= nearLossLine) return 'near-loss'
  return 'profitable'
}

function profileCostMultiplier(profile: AccountCostProfile | undefined): number | undefined {
  if (!profile) return undefined
  if (profile.kind === 'self-owned-exempt') return 0
  if (profile.kind === 'gifted') return 0
  if (profile.kind === 'subscription') return profile.variableCostMultiplier ?? 0
  if (profile.kind === 'manual') return profile.variableCostMultiplier ?? 0
  return undefined
}

export function suggestedAccountBaseRateMultiplier(upstreamEffectiveMultiplier: number | undefined, stationRechargeRatio: number, safetyRatio = 0.05): number | undefined {
  if (typeof upstreamEffectiveMultiplier !== 'number' || !Number.isFinite(upstreamEffectiveMultiplier)) return undefined
  if (!Number.isFinite(stationRechargeRatio) || stationRechargeRatio <= 0) return undefined
  return upstreamEffectiveMultiplier * stationRechargeRatio * (1 + safetyRatio)
}

export function sortedGroupSwitchOptions(groups: GroupSnapshot[], rechargeRatio: number): GroupSwitchOption[] {
  return groups
    .map((group) => {
      const rate = group.userRateMultiplier ?? group.rateMultiplier
      return {
        group,
        rate,
        effectiveMultiplier: effectiveMultiplierValue(rate, rechargeRatio)
      }
    })
    .sort((left, right) => left.effectiveMultiplier - right.effectiveMultiplier || left.group.name.localeCompare(right.group.name))
}

export function groupSwitchCandidateGroups(groups: GroupSnapshot[], category: CategoryId, scope: GroupSwitchScope): GroupSnapshot[] {
  if (scope === 'all' || category === 'all') return groups
  return groups.filter((group) => inferCategory(group) === category)
}

function groupEffectiveMultiplier(group: GroupSnapshot, rechargeRatio: number): number {
  return effectiveMultiplierValue(group.userRateMultiplier ?? group.rateMultiplier, rechargeRatio)
}

export function accountSafetyEffectiveMultiplier(account: Pick<AccountSnapshot, 'baseRateMultiplier'>, station: Pick<StationPublic, 'rechargeRatio'>): number | undefined {
  return typeof account.baseRateMultiplier === 'number' && Number.isFinite(account.baseRateMultiplier)
    ? effectiveMultiplierValue(account.baseRateMultiplier, station.rechargeRatio)
    : undefined
}

export function safeGroupSwitchOptions(groups: GroupSnapshot[], rechargeRatio: number, safetyEffectiveMultiplier: number | undefined): GroupSwitchOption[] {
  const options = sortedGroupSwitchOptions(groups, rechargeRatio)
  if (typeof safetyEffectiveMultiplier !== 'number' || !Number.isFinite(safetyEffectiveMultiplier)) return options
  return options
    .filter((option) => option.effectiveMultiplier >= safetyEffectiveMultiplier - 0.0005)
    .sort((left, right) => Math.abs(left.effectiveMultiplier - safetyEffectiveMultiplier) - Math.abs(right.effectiveMultiplier - safetyEffectiveMultiplier)
      || left.effectiveMultiplier - right.effectiveMultiplier
      || left.group.name.localeCompare(right.group.name))
}

export function groupSpecialTags(group: Pick<GroupSnapshot, 'subscriptionType' | 'isExclusive' | 'peakRateEnabled' | 'peakRateMultiplier'>): Array<{ key: string; label: string; tone: 'exclusive' | 'subscription' | 'peak'; title: string }> {
  const tags: Array<{ key: string; label: string; tone: 'exclusive' | 'subscription' | 'peak'; title: string }> = []
  if (group.isExclusive) tags.push({ key: 'exclusive', label: '专属', tone: 'exclusive', title: '该分组被上游标记为专属/私有/独享' })
  if (group.subscriptionType) tags.push({ key: `subscription-${group.subscriptionType}`, label: String(group.subscriptionType), tone: 'subscription', title: `订阅类型：${group.subscriptionType}` })
  if (group.peakRateEnabled) tags.push({ key: 'peak', label: '峰值', tone: 'peak', title: group.peakRateMultiplier ? `峰值倍率 ${formatRateMultiplier(group.peakRateMultiplier)}` : '该分组启用了峰值倍率' })
  return tags
}

function apiBaseMatchKey(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined
  try {
    const url = new URL(value.trim())
    const pathname = url.pathname
      .replace(/\/+$/g, '')
      .replace(/\/api\/v1$/i, '')
      .replace(/\/v1$/i, '')
      .replace(/\/api$/i, '')
    return `${url.hostname.toLowerCase()}${pathname}` || url.hostname.toLowerCase()
  } catch {
    return value.trim().replace(/^https?:\/\//i, '').replace(/\/+$/g, '').replace(/\/api\/v1$/i, '').replace(/\/v1$/i, '').toLowerCase()
  }
}

export function accountApiBaseMatchesStation(accountApiBaseUrl: string | undefined, station: Pick<StationPublic, 'baseUrl' | 'apiBaseUrl'>): boolean {
  const accountKey = apiBaseMatchKey(accountApiBaseUrl)
  if (!accountKey) return false
  const stationKeys = [apiBaseMatchKey(station.apiBaseUrl), apiBaseMatchKey(station.baseUrl)].filter((value): value is string => Boolean(value))
  return stationKeys.some((stationKey) => accountKey === stationKey || accountKey.startsWith(`${stationKey}/`) || stationKey.startsWith(`${accountKey}/`))
}

export function inferAccountUpstreamMapping(
  accountStationId: string,
  account: Pick<AccountSnapshot, 'id' | 'name' | 'apiBaseUrl' | 'baseRateMultiplier' | 'upstreamSourceStationId' | 'upstreamSourceKeyId'> & { platform?: string },
  sourceStations: StationPublic[],
  snapshots: Record<string, StationSnapshot>
): AccountUpstreamMapping | undefined {
  if (account.upstreamSourceStationId && account.upstreamSourceKeyId) {
    const sourceStation = sourceStations.find((station) => station.id === account.upstreamSourceStationId)
    const sourceKey = sourceStation
      ? snapshots[sourceStation.id]?.sourceKeys?.find((key) => key.id === account.upstreamSourceKeyId)
      : undefined
    const sourceGroupIds = sourceKey ? [...new Set(sourceKey.groupIds.filter((id) => Number.isInteger(id) && id > 0))] : []
    if (sourceStation && sourceKey && sourceGroupIds.length === 1) {
      const sourceGroup = snapshots[sourceStation.id]?.groups.find((group) => group.id === sourceGroupIds[0])
      if (sourceGroup) {
        return {
          accountStationId,
          accountId: account.id,
          sourceStationId: sourceStation.id,
          sourceGroupId: sourceGroup.id,
          sourceKeyId: sourceKey.id,
          sourceKeyLabel: sourceKeyLabel(sourceKey, 0),
          updatedAt: 'credential-match'
        }
      }
    }
  }
  // API addresses and multipliers are diagnostic hints only. They never prove
  // which upstream Key an account uses, so automatic mapping stops here.
  return undefined
}

export interface AccountUpstreamMappingRebuildResult {
  mappings: AccountUpstreamMapping[]
  candidates: AccountUpstreamMapping[]
  scanned: number
  added: number
  skippedExisting: number
}

export function rebuildAccountUpstreamMappings(
  currentMappings: AccountUpstreamMapping[],
  adminStations: Array<{ station: StationPublic; snapshot?: Pick<StationSnapshot, 'accounts'> }>,
  sourceStations: StationPublic[],
  snapshots: Record<string, StationSnapshot>,
  updatedAt = new Date().toISOString()
): AccountUpstreamMappingRebuildResult {
  const mappingByAccount = new Map<string, AccountUpstreamMapping>()
  for (const mapping of currentMappings) {
    const key = accountUpstreamMappingKey(mapping.accountStationId, mapping.accountId)
    if (!mappingByAccount.has(key)) mappingByAccount.set(key, mapping)
  }
  let scanned = 0
  let added = 0
  let skippedExisting = 0
  const candidates: AccountUpstreamMapping[] = []
  for (const { station, snapshot } of adminStations) {
    for (const account of snapshot?.accounts ?? []) {
      scanned += 1
      const key = accountUpstreamMappingKey(station.id, account.id)
      if (mappingByAccount.has(key)) {
        skippedExisting += 1
        continue
      }
      const inferred = inferAccountUpstreamMapping(station.id, account, sourceStations, snapshots)
      if (!inferred) continue
      mappingByAccount.set(key, { ...inferred, updatedAt })
      candidates.push({ ...inferred, updatedAt })
      added += 1
    }
  }
  return { mappings: [...mappingByAccount.values()], candidates, scanned, added, skippedExisting }
}

export function groupSwitchPreview(
  groups: GroupSnapshot[],
  previousGroupIds: number[],
  nextGroupIds: number[],
  rechargeRatio: number
): GroupSwitchPreview {
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const previousGroups = previousGroupIds.map((id) => groupById.get(id)).filter((group): group is GroupSnapshot => Boolean(group))
  const previousLabel = previousGroups.length > 0 ? previousGroups.map((group) => group.name).join('、') : '未绑定分组'
  const nextGroups = nextGroupIds.map((id) => groupById.get(id)).filter((group): group is GroupSnapshot => Boolean(group))
  const nextLabel = nextGroups.length > 0 ? nextGroups.map((group) => group.name).join('、') : '请选择目标组合'
  const previousEffectiveMultiplier = previousGroups.length > 0
    ? Math.min(...previousGroups.map((group) => groupEffectiveMultiplier(group, rechargeRatio)))
    : undefined
  const nextEffectiveMultiplier = nextGroups.length > 0
    ? Math.min(...nextGroups.map((group) => groupEffectiveMultiplier(group, rechargeRatio)))
    : undefined
  const canCompare = Number.isFinite(previousEffectiveMultiplier) && Number.isFinite(nextEffectiveMultiplier)
  const delta = canCompare ? nextEffectiveMultiplier! - previousEffectiveMultiplier! : undefined
  const direction: GroupSwitchPreviewDirection = typeof delta !== 'number'
    ? 'unknown'
    : Math.abs(delta) < 0.0005
      ? 'same'
      : delta < 0
        ? 'cheaper'
        : 'more-expensive'
  return { previousLabel, nextLabel, previousEffectiveMultiplier, nextEffectiveMultiplier, delta, direction }
}

export function accountCurrentGroupOptions(groups: GroupSnapshot[], groupIds: number[], rechargeRatio: number): GroupSwitchOption[] {
  const groupById = new Map(groups.map((group) => [group.id, group]))
  return groupIds
    .map((id) => groupById.get(id))
    .filter((group): group is GroupSnapshot => Boolean(group))
    .map((group) => {
      const rate = group.userRateMultiplier ?? group.rateMultiplier
      return {
        group,
        rate,
        effectiveMultiplier: effectiveMultiplierValue(rate, rechargeRatio)
      }
    })
}

export function buildAccountGroupProfitRows(
  adminStations: Array<{ station: StationPublic; snapshot?: StationSnapshot }>,
  allStations: StationPublic[],
  snapshots: Record<string, StationSnapshot>,
  mappings: AccountUpstreamMapping[],
  costProfiles: AccountCostProfile[] = [],
  timeCostLedger?: TimeCostLedger
): AccountGroupProfitRow[] {
  const stationById = new Map(allStations.map((station) => [station.id, station]))
  const mappingByAccount = new Map(mappings.map((mapping) => [accountUpstreamMappingKey(mapping.accountStationId, mapping.accountId), mapping]))
  const costProfileByAccount = new Map(costProfiles.map((profile) => [accountUpstreamMappingKey(profile.accountStationId, profile.accountId), profile]))
  const rows: AccountGroupProfitRow[] = []
  for (const { station, snapshot } of adminStations) {
    const groupById = new Map((snapshot?.groups ?? []).map((group) => [group.id, group]))
    for (const account of snapshot?.accounts ?? []) {
      const accountKey = accountUpstreamMappingKey(station.id, account.id)
      const costProfile = costProfileByAccount.get(accountKey)
      const costKind = costProfile?.kind ?? 'upstream-metered'
      const isCostExempt = costKind === 'self-owned-exempt'
      // Keep the local upstream association available when the accounting mode
      // is exempt; it is not consulted for cost protection or profit math.
      const mapping = mappingByAccount.get(accountKey)
      const sourceStation = mapping ? stationById.get(mapping.sourceStationId) : undefined
      const sourceResolution = resolveAccountUpstreamMappingSource(mapping, mapping ? snapshots[mapping.sourceStationId] : undefined)
      const sourceGroup = sourceResolution.group
      const upstreamRate = sourceGroup ? sourceGroup.userRateMultiplier ?? sourceGroup.rateMultiplier : undefined
      const upstreamEffectiveMultiplier = sourceStation && typeof upstreamRate === 'number'
        ? effectiveMultiplierValue(upstreamRate, sourceStation.rechargeRatio)
        : undefined
      const profileMultiplier = profileCostMultiplier(costProfile)
      const accountCostMultiplier = isCostExempt ? 0 : costKind === 'upstream-metered' ? upstreamEffectiveMultiplier : profileMultiplier
      const suggestedBaseRate = isCostExempt ? undefined : suggestedAccountBaseRateMultiplier(accountCostMultiplier, station.rechargeRatio)
      const baseRateNeedsUpdate = !isCostExempt && typeof account.baseRateMultiplier === 'number'
        && typeof suggestedBaseRate === 'number'
        && account.baseRateMultiplier < suggestedBaseRate - 0.0005
      for (const groupId of [...new Set(account.groupIds)]) {
        const group = groupById.get(groupId)
        if (!group) continue
        const groupRate = group.userRateMultiplier ?? group.rateMultiplier
        const groupEffectiveMultiplier = effectiveMultiplierValue(groupRate, station.rechargeRatio)
        const status: ProfitRiskStatus = isCostExempt
          ? 'exempt'
          : costKind === 'upstream-metered' && mapping && (!sourceGroup || sourceResolution.state === 'key-multiple-groups')
          ? 'stale'
          : profitRiskStatus(groupEffectiveMultiplier, accountCostMultiplier)
        const unitMargin = !isCostExempt && typeof accountCostMultiplier === 'number' && Number.isFinite(accountCostMultiplier)
          ? groupEffectiveMultiplier - accountCostMultiplier
          : undefined
        const relationUsageAmount = account.groupIds.length === 1 ? account.usageAmount : undefined
        const estimatedProfit = !isCostExempt && typeof relationUsageAmount === 'number' && typeof unitMargin === 'number'
          ? relationUsageAmount * unitMargin
          : undefined
        const temporalCostSummary = costKind === 'upstream-metered' && timeCostLedger
          ? summarizeTemporalUsageCosts(
              timeCostLedger,
              station.id,
              account.id,
              account.groupIds.length === 1 ? undefined : group.id
            )
          : undefined
        rows.push({
          key: `${station.id}:${account.id}:${group.id}`,
          station,
          snapshot,
          account,
          group,
          mapping,
          costProfile,
          costKind,
          sourceStation,
          sourceGroup,
          upstreamEffectiveMultiplier,
          accountCostMultiplier,
          groupEffectiveMultiplier,
          unitMargin,
          suggestedBaseRateMultiplier: suggestedBaseRate,
          baseRateNeedsUpdate,
          usageAmount: relationUsageAmount,
          estimatedProfit,
          temporalCostSummary: temporalCostSummary && (temporalCostSummary.exactEntries + temporalCostSummary.unknownEntries + temporalCostSummary.ambiguousEntries > 0)
            ? temporalCostSummary
            : undefined,
          status
        })
      }
    }
  }
  return rows.sort((left, right) => {
    const riskWeight: Record<ProfitRiskStatus, number> = { loss: 0, 'near-loss': 1, stale: 2, unmapped: 3, profitable: 4, exempt: 5 }
    return riskWeight[left.status] - riskWeight[right.status]
      || left.station.name.localeCompare(right.station.name)
      || left.account.name.localeCompare(right.account.name)
      || left.group.name.localeCompare(right.group.name)
  })
}

export function groupProfitRowsByAccount(rows: AccountGroupProfitRow[]): AccountProfitGroup[] {
  const groupMap = new Map<string, AccountProfitGroup>()
  for (const row of rows) {
    const key = `${row.station.id}:${row.account.id}`
    const existing = groupMap.get(key)
    if (!existing) {
      groupMap.set(key, {
        key,
        station: row.station,
        account: row.account,
        rows: [row],
        summaryStatus: row.status,
        hasCostProfile: Boolean(row.costProfile),
        costKind: row.costKind,
        primaryCategory: inferCategory(row.group),
        primaryCategoryLabel: categoryLabel(inferCategory(row.group)),
        minEffectiveMultiplier: row.groupEffectiveMultiplier,
        maxEffectiveMultiplier: row.groupEffectiveMultiplier
      })
      continue
    }
    existing.rows.push(row)
    existing.minEffectiveMultiplier = typeof existing.minEffectiveMultiplier === 'number'
      ? Math.min(existing.minEffectiveMultiplier, row.groupEffectiveMultiplier)
      : row.groupEffectiveMultiplier
    existing.maxEffectiveMultiplier = typeof existing.maxEffectiveMultiplier === 'number'
      ? Math.max(existing.maxEffectiveMultiplier, row.groupEffectiveMultiplier)
      : row.groupEffectiveMultiplier
    existing.hasCostProfile = existing.hasCostProfile || Boolean(row.costProfile)
    if (accountCostKindSortWeight(row.costKind) < accountCostKindSortWeight(existing.costKind)) existing.costKind = row.costKind
    const rowCategory = inferCategory(row.group)
    if (categorySortWeight(rowCategory) < categorySortWeight(existing.primaryCategory)) {
      existing.primaryCategory = rowCategory
      existing.primaryCategoryLabel = categoryLabel(rowCategory)
    }
    if (profitRiskWeight(row.status) < profitRiskWeight(existing.summaryStatus)) existing.summaryStatus = row.status
  }
  return [...groupMap.values()].sort((left, right) => {
    return profitRiskWeight(left.summaryStatus) - profitRiskWeight(right.summaryStatus)
      || left.station.name.localeCompare(right.station.name)
      || left.account.name.localeCompare(right.account.name)
  })
}

function finiteNumbers(values: Array<number | undefined>): number[] {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
}

function worstProfitStatus(rows: AccountGroupProfitRow[]): ProfitRiskStatus {
  return rows.reduce<ProfitRiskStatus>((status, row) => (
    profitRiskWeight(row.status) < profitRiskWeight(status) ? row.status : status
  ), 'profitable')
}

export function groupProfitRowsBySellingGroup(rows: AccountGroupProfitRow[]): SellingGroupProfitGroup[] {
  const groupMap = new Map<string, SellingGroupProfitGroup>()
  for (const row of rows) {
    const key = `${row.station.id}:${row.group.id}`
    const existing = groupMap.get(key)
    if (!existing) {
      groupMap.set(key, {
        key,
        station: row.station,
        group: row.group,
        rows: [row],
        summaryStatus: row.status,
        category: inferCategory(row.group),
        categoryLabel: categoryLabel(inferCategory(row.group)),
        groupEffectiveMultiplier: row.groupEffectiveMultiplier,
        accountCount: 1,
        lossCount: row.status === 'loss' ? 1 : 0,
        nearLossCount: row.status === 'near-loss' ? 1 : 0,
        unmappedCount: row.status === 'unmapped' || row.status === 'stale' ? 1 : 0,
        hasUnsetAccountCost: !row.costProfile,
        minAccountCostMultiplier: row.costKind === 'self-owned-exempt' ? undefined : row.accountCostMultiplier,
        maxAccountCostMultiplier: row.costKind === 'self-owned-exempt' ? undefined : row.accountCostMultiplier,
        minUnitMargin: row.unitMargin,
        cheapestAccountRow: row.costKind === 'self-owned-exempt' ? undefined : row
      })
      continue
    }
    existing.rows.push(row)
    existing.summaryStatus = worstProfitStatus(existing.rows)
    existing.accountCount = existing.rows.length
    existing.lossCount += row.status === 'loss' ? 1 : 0
    existing.nearLossCount += row.status === 'near-loss' ? 1 : 0
    existing.unmappedCount += row.status === 'unmapped' || row.status === 'stale' ? 1 : 0
    existing.hasUnsetAccountCost = existing.hasUnsetAccountCost || !row.costProfile
    if (row.costKind !== 'self-owned-exempt') {
      const costs = finiteNumbers([existing.minAccountCostMultiplier, row.accountCostMultiplier])
      if (costs.length > 0) existing.minAccountCostMultiplier = Math.min(...costs)
      const maxCosts = finiteNumbers([existing.maxAccountCostMultiplier, row.accountCostMultiplier])
      if (maxCosts.length > 0) existing.maxAccountCostMultiplier = Math.max(...maxCosts)
    }
    const margins = finiteNumbers([existing.minUnitMargin, row.unitMargin])
    if (margins.length > 0) existing.minUnitMargin = Math.min(...margins)
    if (
      row.costKind !== 'self-owned-exempt'
      && typeof row.accountCostMultiplier === 'number'
      && (
        !existing.cheapestAccountRow
        || typeof existing.cheapestAccountRow.accountCostMultiplier !== 'number'
        || row.accountCostMultiplier < existing.cheapestAccountRow.accountCostMultiplier
      )
    ) {
      existing.cheapestAccountRow = row
    }
  }
  return [...groupMap.values()].map((group) => ({
    ...group,
    rows: [...group.rows].sort((left, right) => {
      return profitRiskWeight(left.status) - profitRiskWeight(right.status)
        || Number(!left.costProfile) - Number(!right.costProfile)
        || (left.accountCostMultiplier ?? Number.POSITIVE_INFINITY) - (right.accountCostMultiplier ?? Number.POSITIVE_INFINITY)
        || left.account.name.localeCompare(right.account.name)
    })
  })).sort((left, right) => {
    return profitRiskWeight(left.summaryStatus) - profitRiskWeight(right.summaryStatus)
      || left.station.name.localeCompare(right.station.name)
      || left.group.name.localeCompare(right.group.name)
  })
}

export function sortAccountProfitGroups(groups: AccountProfitGroup[], mode: CostSortMode = 'unset-first'): AccountProfitGroup[] {
  return [...groups].sort((left, right) => {
    const unsetCompare = Number(left.hasCostProfile) - Number(right.hasCostProfile)
    if (unsetCompare !== 0) return unsetCompare
    if (mode === 'category') {
      return categorySortWeight(left.primaryCategory) - categorySortWeight(right.primaryCategory)
        || left.primaryCategoryLabel.localeCompare(right.primaryCategoryLabel)
        || profitRiskWeight(left.summaryStatus) - profitRiskWeight(right.summaryStatus)
        || left.station.name.localeCompare(right.station.name)
        || left.account.name.localeCompare(right.account.name)
    }
    if (mode === 'cost-kind') {
      return accountCostKindSortWeight(left.costKind) - accountCostKindSortWeight(right.costKind)
        || profitRiskWeight(left.summaryStatus) - profitRiskWeight(right.summaryStatus)
        || left.station.name.localeCompare(right.station.name)
        || left.account.name.localeCompare(right.account.name)
    }
    if (mode === 'group-rate') {
      return (left.minEffectiveMultiplier ?? Number.POSITIVE_INFINITY) - (right.minEffectiveMultiplier ?? Number.POSITIVE_INFINITY)
        || profitRiskWeight(left.summaryStatus) - profitRiskWeight(right.summaryStatus)
        || left.station.name.localeCompare(right.station.name)
        || left.account.name.localeCompare(right.account.name)
    }
    if (mode === 'account-count') {
      return right.rows.length - left.rows.length
        || profitRiskWeight(left.summaryStatus) - profitRiskWeight(right.summaryStatus)
        || left.station.name.localeCompare(right.station.name)
        || left.account.name.localeCompare(right.account.name)
    }
    if (mode === 'margin') {
      const leftWorstMargin = Math.min(...left.rows.map((row) => row.unitMargin ?? Number.POSITIVE_INFINITY))
      const rightWorstMargin = Math.min(...right.rows.map((row) => row.unitMargin ?? Number.POSITIVE_INFINITY))
      return leftWorstMargin - rightWorstMargin
        || profitRiskWeight(left.summaryStatus) - profitRiskWeight(right.summaryStatus)
        || left.station.name.localeCompare(right.station.name)
        || left.account.name.localeCompare(right.account.name)
    }
    return profitRiskWeight(left.summaryStatus) - profitRiskWeight(right.summaryStatus)
      || accountCostKindSortWeight(left.costKind) - accountCostKindSortWeight(right.costKind)
      || left.station.name.localeCompare(right.station.name)
      || left.account.name.localeCompare(right.account.name)
  })
}

export function sortSellingGroupProfitGroups(groups: SellingGroupProfitGroup[], mode: CostSortMode = 'unset-first'): SellingGroupProfitGroup[] {
  return [...groups].sort((left, right) => {
    const unsetCompare = Number(left.hasUnsetAccountCost) === Number(right.hasUnsetAccountCost)
      ? 0
      : left.hasUnsetAccountCost ? -1 : 1
    if (mode === 'unset-first' && unsetCompare !== 0) return unsetCompare
    if (mode === 'category') {
      return categorySortWeight(left.category) - categorySortWeight(right.category)
        || profitRiskWeight(left.summaryStatus) - profitRiskWeight(right.summaryStatus)
        || left.group.name.localeCompare(right.group.name)
    }
    if (mode === 'group-rate') {
      return left.groupEffectiveMultiplier - right.groupEffectiveMultiplier
        || profitRiskWeight(left.summaryStatus) - profitRiskWeight(right.summaryStatus)
        || left.group.name.localeCompare(right.group.name)
    }
    if (mode === 'account-count') {
      return right.accountCount - left.accountCount
        || profitRiskWeight(left.summaryStatus) - profitRiskWeight(right.summaryStatus)
        || left.group.name.localeCompare(right.group.name)
    }
    if (mode === 'margin') {
      return (left.minUnitMargin ?? Number.POSITIVE_INFINITY) - (right.minUnitMargin ?? Number.POSITIVE_INFINITY)
        || profitRiskWeight(left.summaryStatus) - profitRiskWeight(right.summaryStatus)
        || left.group.name.localeCompare(right.group.name)
    }
    if (mode === 'cost-kind') {
      return Math.min(...left.rows.map((row) => accountCostKindSortWeight(row.costKind))) - Math.min(...right.rows.map((row) => accountCostKindSortWeight(row.costKind)))
        || profitRiskWeight(left.summaryStatus) - profitRiskWeight(right.summaryStatus)
        || left.group.name.localeCompare(right.group.name)
    }
    return profitRiskWeight(left.summaryStatus) - profitRiskWeight(right.summaryStatus)
      || unsetCompare
      || left.group.name.localeCompare(right.group.name)
  })
}

function accountCostFixedLabel(profile: AccountCostProfile | undefined): string | undefined {
  if (!profile || typeof profile.fixedCostAmount !== 'number') return undefined
  const cycleDays = typeof profile.cycleDays === 'number' && Number.isFinite(profile.cycleDays) && profile.cycleDays > 0
    ? profile.cycleDays
    : 30
  return `固定成本 ${formatCostAmount(profile.fixedCostAmount)} / ${cycleDays}天`
}

function accountCostOriginLabel(row: AccountGroupProfitRow | undefined): string {
  if (!row) return '暂无成本档案'
  if (row.costKind === 'self-owned-exempt') {
    return ['账号免计费：保留上游关联，但成本保护和收益核算按 0 计；不等同于内部自用用户', row.costProfile?.note].filter(Boolean).join(' · ')
  }
  if (row.costKind === 'upstream-metered') {
    if (row.sourceStation && row.sourceGroup) {
      return `${row.sourceStation.name} / ${row.sourceGroup.name}${row.mapping?.sourceKeyLabel ? ` / ${row.mapping.sourceKeyLabel}` : ''}`
    }
    return row.mapping ? '来源分组当前不可见，请刷新后重新关联' : '未关联上游来源：请关联上游密钥，或设置账号成本'
  }
  const fixedLabel = accountCostFixedLabel(row.costProfile)
  const unitLabel = typeof row.accountCostMultiplier === 'number' ? `单位 ${formatRateMultiplier(row.accountCostMultiplier)}` : undefined
  return [accountCostKindLabel(row.costKind), fixedLabel, unitLabel, row.costProfile?.note].filter(Boolean).join(' · ')
}

function accountFocusKey(stationId: string, accountId: number): string {
  return `${stationId}:${accountId}`
}

export function recommendedAccountGroupOption(
  groups: GroupSnapshot[],
  currentGroupIds: number[],
  rechargeRatio: number,
  category: CategoryId,
  scope: GroupSwitchScope,
  safetyEffectiveMultiplier?: number,
  accountCategory: CategoryId = 'other'
): AccountGroupRecommendation | undefined {
  const currentIds = new Set(currentGroupIds)
  const currentOptions = accountCurrentGroupOptions(groups, currentGroupIds, rechargeRatio)
  const currentEffectiveMultiplier = currentOptions.length === 1
    ? currentOptions[0].effectiveMultiplier
    : currentOptions.length > 1
      ? Math.min(...currentOptions.map((option) => option.effectiveMultiplier))
      : undefined
  const option = safeGroupSwitchOptions(
    groupSwitchCandidateGroups(groups, category, scope)
      .filter((group) => groupMatchesAccountCategory(group, accountCategory))
      .filter((group) => !currentIds.has(group.id)),
    rechargeRatio,
    safetyEffectiveMultiplier
  )[0]
  if (!option) return undefined
  return {
    option,
    currentEffectiveMultiplier,
    safetyEffectiveMultiplier,
    safeForAccount: typeof safetyEffectiveMultiplier === 'number' && Number.isFinite(safetyEffectiveMultiplier)
      ? option.effectiveMultiplier >= safetyEffectiveMultiplier - 0.0005
      : true
  }
}

export function accountMatchesWorkbenchQuery(
  stationName: string,
  account: AccountSnapshot,
  recommendationGroupName: string | undefined,
  query: string
): boolean {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return true
  const text = [
    stationName,
    account.name,
    account.platform,
    account.status,
    account.groups.join(' '),
    recommendationGroupName
  ].filter(Boolean).join(' ').toLowerCase()
  return text.includes(keyword)
}

export function accountScheduleState(account: Pick<AccountSnapshot, 'scheduleEnabled'>): AccountScheduleState {
  if (account.scheduleEnabled === true) return 'enabled'
  if (account.scheduleEnabled === false) return 'disabled'
  return 'unknown'
}

export function accountScheduleLabel(account: Pick<AccountSnapshot, 'scheduleEnabled'>): string {
  const state = accountScheduleState(account)
  if (state === 'enabled') return '调度开启'
  if (state === 'disabled') return '调度关闭'
  return '调度未知'
}

export function accountMatchesScheduleFilter(account: Pick<AccountSnapshot, 'scheduleEnabled'>, filter: AccountScheduleFilter): boolean {
  return filter === 'all' || accountScheduleState(account) === filter
}

export function accountMatchesPlatformFilter(account: Pick<AccountSnapshot, 'platform'>, filter: AccountPlatformFilter): boolean {
  return filter === 'all' || (account.platform || '账号') === filter
}

function accountGroupFilterKey(stationId: string, groupId: number): string {
  return `${stationId}:${groupId}`
}

export function accountMatchesGroupFilter(stationId: string, account: Pick<AccountSnapshot, 'groupIds'>, filter: AccountGroupFilter): boolean {
  return filter === 'all' || account.groupIds.some((groupId) => accountGroupFilterKey(stationId, groupId) === filter)
}

export function accountWorkbenchPlatformOptions(adminStations: Array<{ snapshot?: Pick<StationSnapshot, 'accounts'> }>): string[] {
  return [...new Set(adminStations.flatMap(({ snapshot }) => (snapshot?.accounts ?? []).map((account) => account.platform || '账号')))]
    .sort((left, right) => left.localeCompare(right))
}

export function accountWorkbenchGroupFilterOptions(adminStations: Array<{ station: Pick<StationPublic, 'id' | 'name'>; snapshot?: Pick<StationSnapshot, 'accounts' | 'groups'> }>): AccountGroupFilterOption[] {
  const options = new Map<string, AccountGroupFilterOption>()
  for (const { station, snapshot } of adminStations) {
    const groupById = new Map((snapshot?.groups ?? []).map((group) => [group.id, group]))
    for (const account of snapshot?.accounts ?? []) {
      for (const groupId of [...new Set(account.groupIds)]) {
        const group = groupById.get(groupId)
        const key = accountGroupFilterKey(station.id, groupId)
        const existing = options.get(key)
        if (existing) {
          existing.count += 1
          continue
        }
        options.set(key, {
          id: key,
          label: group?.name ?? `分组 ${groupId}`,
          meta: `${group?.platform || account.platform || '账号'} · ${station.name}`,
          count: 1
        })
      }
    }
  }
  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label) || left.meta.localeCompare(right.meta))
}

export function accountCanRecommend(account: Pick<AccountSnapshot, 'scheduleEnabled'>): boolean {
  return account.scheduleEnabled === true
}

export function accountRecommendationTone(currentGroupCount: number, safeForAccount?: boolean): AccountRecommendationTone {
  if (currentGroupCount <= 0) return 'initial'
  return safeForAccount ? 'safe' : 'candidate'
}

export function accountRecommendationLabel(currentGroupCount: number, safeForAccount?: boolean): string {
  const tone = accountRecommendationTone(currentGroupCount, safeForAccount)
  if (tone === 'initial') return '推荐初始分组'
  if (tone === 'safe') return '可加入安全分组'
  return '安全候选'
}

export function accountRecommendationActionLabel(currentGroupCount: number, safeForAccount?: boolean): string {
  const tone = accountRecommendationTone(currentGroupCount, safeForAccount)
  if (tone === 'initial') return '选择推荐'
  if (tone === 'safe') return '加入安全分组'
  return '选择安全候选'
}

export function accountCurrentEffectiveLabel(groups: GroupSnapshot[], groupIds: number[], rechargeRatio: number): string {
  const currentOptions = accountCurrentGroupOptions(groups, groupIds, rechargeRatio)
  if (currentOptions.length === 0) return '--'
  if (currentOptions.length === 1) return formatRateMultiplier(currentOptions[0].effectiveMultiplier)
  return `最低 ${formatRateMultiplier(Math.min(...currentOptions.map((option) => option.effectiveMultiplier)))}`
}

export function accountCurrentEffectiveTitle(groups: GroupSnapshot[], groupIds: number[], rechargeRatio: number): string {
  const currentOptions = accountCurrentGroupOptions(groups, groupIds, rechargeRatio)
  if (currentOptions.length === 0) return '当前账号未绑定分组'
  if (currentOptions.length === 1) {
    const option = currentOptions[0]
    return `当前分组：${option.group.name} · ${formatRateMultiplier(option.effectiveMultiplier)}`
  }
  const sorted = [...currentOptions].sort((left, right) => left.effectiveMultiplier - right.effectiveMultiplier || left.group.name.localeCompare(right.group.name))
  const lowest = sorted[0]
  return `当前组合最低：${formatRateMultiplier(lowest.effectiveMultiplier)} · ${lowest.group.name}；全部当前分组：${sorted.map((option) => `${option.group.name} ${formatRateMultiplier(option.effectiveMultiplier)}`).join(' / ')}`
}

export function accountCurrentEffectiveMeta(groups: GroupSnapshot[], groupIds: number[], rechargeRatio: number): string {
  const currentOptions = accountCurrentGroupOptions(groups, groupIds, rechargeRatio)
  if (currentOptions.length === 0) return '未绑定分组'
  if (currentOptions.length === 1) return `${currentOptions[0].group.name} · 当前 1 个分组`
  const sorted = [...currentOptions].sort((left, right) => left.effectiveMultiplier - right.effectiveMultiplier || left.group.name.localeCompare(right.group.name))
  return `${sorted[0].group.name} · 当前 ${currentOptions.length} 个分组`
}

function accountRecommendationBlockedText(account: Pick<AccountSnapshot, 'scheduleEnabled'>): { label: string; title: string; detail: string } | undefined {
  if (accountCanRecommend(account)) return undefined
  const label = accountScheduleLabel(account)
  return {
    label: '不参与推荐',
    title: label,
    detail: `${label}账号只展示，不进入推荐和批量推荐。`
  }
}

type AccountStateTone = 'ready' | 'warning' | 'missing'

interface AccountStateStatus {
  tone: AccountStateTone
  label: string
  detail: string
}

function accountSourceStatus(
  account: Pick<AccountSnapshot, 'apiBaseUrl' | 'baseRateMultiplier' | 'scheduleEnabled' | 'platform'>,
  mapping: AccountUpstreamMapping | undefined,
  sourceStation: StationPublic | undefined,
  resolution: UpstreamMappingResolution,
  sourceStations: StationPublic[],
  snapshots: Record<string, StationSnapshot>
): AccountStateStatus {
  if (account.scheduleEnabled === false) {
    return { tone: 'warning', label: '未参与调度', detail: '该账号已关闭调度，不会显示为使用中，也不计入上游成本。' }
  }
  const sourceKeyReadState = sourceStation ? snapshots[sourceStation.id]?.sourceKeyReadState : undefined
  if (mapping && sourceStation && resolution.group && (sourceKeyReadState === 'stale' || sourceKeyReadState === 'unavailable')) {
    return { tone: 'warning', label: 'Key 数据过期', detail: `保留 ${sourceStation.name} / ${resolution.group.name} 的上次确认关系；恢复 Key 列表读取后会重新验证。` }
  }
  if (mapping && sourceStation && resolution.group && resolution.state !== 'key-multiple-groups') {
    const inferred = mapping.updatedAt === 'auto'
    return {
      tone: 'ready',
      label: resolution.state === 'key-following' ? '跟随 Key' : inferred ? '自动来源' : '来源已绑',
      detail: `${sourceStation.name} / ${resolution.group.name}${resolution.sourceKey ? ` / ${sourceKeyLabel(resolution.sourceKey, 0)}` : mapping.sourceKeyLabel ? ` / ${mapping.sourceKeyLabel}` : ''}`
    }
  }
  if (mapping && sourceStation && resolution.state === 'key-multiple-groups') {
    return {
      tone: 'warning',
      label: '多分组待确认',
      detail: `上游 Key 当前有多个分组${resolution.group ? `；暂沿用 ${resolution.group.name}` : ''}，请重新选择保护口径。`
    }
  }
  if (mapping) {
    if (resolution.state === 'key-missing' && sourceKeyReadState === 'not-configured') {
      return { tone: 'warning', label: '未读取 Key', detail: '该三方站点尚未配置密钥列表接口，无法验证已保存的上游 Key。' }
    }
    if (resolution.state === 'key-missing' && (sourceKeyReadState === 'stale' || sourceKeyReadState === 'unavailable')) {
      return { tone: 'warning', label: 'Key 列表不可用', detail: '保留了已保存的来源关系；请恢复三方站点的密钥列表读取后再验证。' }
    }
    const detailByState: Partial<Record<UpstreamMappingResolutionState, string>> = {
      'key-missing': '上游 Key 已不存在或尚未同步，请刷新或重新关联。',
      'key-unassigned': '上游 Key 当前未分配分组，请在上游站点设置后刷新。',
      'key-group-missing': '上游 Key 的当前分组未返回，请刷新或检查站点权限。'
    }
    return { tone: 'warning', label: '来源失效', detail: detailByState[resolution.state] ?? '来源站点或分组当前不可见，请刷新或重新关联。' }
  }
  const inferred = inferAccountUpstreamMapping('', account as AccountSnapshot, sourceStations, snapshots)
  if (inferred) {
    const station = sourceStations.find((item) => item.id === inferred.sourceStationId)
    const group = snapshots[inferred.sourceStationId]?.groups.find((item) => item.id === inferred.sourceGroupId)
    return { tone: 'warning', label: '可自动关联', detail: `${station?.name ?? '三方站点'} / ${group?.name ?? '来源分组'} 可唯一匹配；点击“扫描关联”后确认。` }
  }
  if (!account.apiBaseUrl?.trim()) return { tone: 'missing', label: '缺 API 地址', detail: '我的站点账号未返回上游 API 地址，无法定位三方来源。' }
  if (typeof account.baseRateMultiplier !== 'number' || !Number.isFinite(account.baseRateMultiplier)) return { tone: 'missing', label: '缺基础倍率', detail: '我的站点账号未返回基础倍率，无法与上游分组做安全候选匹配。' }
  const baseMatchedStations = sourceStations.filter((station) => accountApiBaseMatchesStation(account.apiBaseUrl, station))
  if (baseMatchedStations.length === 0) return { tone: 'missing', label: '来源地址未匹配', detail: '账号 API 地址与已添加三方站点不一致；请检查三方站点 API 基址。' }
  if (baseMatchedStations.some((station) => snapshots[station.id]?.sourceKeyReadState === 'not-configured')) {
    return { tone: 'warning', label: '待配置 Key 接口', detail: '已匹配到来源站点，但尚未读取它的 Key 列表；请在接口适配中心配置密钥列表路径。' }
  }
  if (baseMatchedStations.some((station) => {
    const state = snapshots[station.id]?.sourceKeyReadState
    return state === 'stale' || state === 'unavailable'
  })) return { tone: 'warning', label: 'Key 列表不可用', detail: '已匹配到来源站点，但当前无法读取 Key 列表；恢复读取后可重新扫描。' }
  return { tone: 'missing', label: '候选冲突', detail: '同一 API 地址或倍率存在多个可能来源，应用不会按低价猜测；请选择对应上游 Key。' }
}

function accountCostStatus(profile: AccountCostProfile | undefined, sourceReady: boolean): AccountStateStatus {
  if (profile) {
    const fixedLabel = accountCostFixedLabel(profile)
    const detail = [accountCostKindLabel(profile.kind), fixedLabel, profile.note].filter(Boolean).join(' · ')
    return { tone: 'ready', label: profile.kind === 'self-owned-exempt' ? '免计费' : '成本已设', detail }
  }
  if (sourceReady) return { tone: 'ready', label: '三方按量', detail: '按关联的上游 Key 当前分组折算成本' }
  return { tone: 'missing', label: '成本未设', detail: '未关联上游来源且没有账号成本档案' }
}

function AccountStateBadge({
  status,
  onClick,
  ariaLabel
}: {
  status: AccountStateStatus
  onClick: () => void
  ariaLabel: string
}) {
  const Icon = status.tone === 'ready' ? CheckCircle2 : status.tone === 'warning' ? AlertTriangle : Circle
  return (
    <button type="button" className={`account-state-badge ${status.tone}`} title={`${status.label}：${status.detail}`} aria-label={`${ariaLabel}：${status.label}，${status.detail}`} onClick={onClick}>
      <Icon className="account-state-icon" size={13} aria-hidden="true" />
      <span>{status.label}</span>
    </button>
  )
}

function accountCandidateOptionsFor(
  station: StationPublic,
  snapshot: StationSnapshot | undefined,
  account: AccountSnapshot,
  category: CategoryId,
  selectedTag: GroupTagFilter,
  hiddenGroupKeys: Set<string>,
  manualGroupTags: Record<string, GroupCapabilityTagId[]>,
  strategy: AccountRecommendationStrategy,
  safetyEffectiveMultiplier?: number
): { candidates: AccountGroupCandidate[]; currentEffectiveMultiplier?: number } {
  const groups = snapshot?.groups ?? []
  const currentIds = new Set(account.groupIds)
  const useAllStationStrategy = strategy === 'all-station'
  const accountCategory = inferAccountCategory(account)
  const visibleGroups = groups.filter((group) => {
    const key = groupPreferenceKey(station.id, group.id)
    return !hiddenGroupKeys.has(key)
      && groupMatchesAccountCategory(group, accountCategory)
      && groupMatchesTagFilter(group, selectedTag, manualGroupTags[key])
  })
  const currentOptions = accountCurrentGroupOptions(groups, account.groupIds, station.rechargeRatio)
  const currentEffectiveMultiplier = currentOptions.length === 1
    ? currentOptions[0].effectiveMultiplier
    : currentOptions.length > 1
      ? Math.min(...currentOptions.map((option) => option.effectiveMultiplier))
      : undefined
  if (!accountCanRecommend(account)) {
    return { candidates: [], currentEffectiveMultiplier }
  }
  const scopedGroups = groupSwitchCandidateGroups(
    visibleGroups,
    useAllStationStrategy ? 'all' : category,
    useAllStationStrategy || category === 'all' ? 'all' : 'category'
  ).filter((group) => !currentIds.has(group.id))
  const fallbackGroups = category === 'all' || useAllStationStrategy
    ? []
    : groupSwitchCandidateGroups(visibleGroups, 'all', 'all').filter((group) => !currentIds.has(group.id))
  const primaryOptions = safeGroupSwitchOptions(scopedGroups, station.rechargeRatio, safetyEffectiveMultiplier)
  const fallbackOptions = primaryOptions.length > 0 ? [] : safeGroupSwitchOptions(fallbackGroups, station.rechargeRatio, safetyEffectiveMultiplier)
  const scopeLabel = primaryOptions.length > 0
    ? useAllStationStrategy ? '全站最低' : category === 'all' ? '全部分组' : categoryLabel(category)
    : '全部分组'
  return {
    candidates: [...primaryOptions, ...fallbackOptions].slice(0, 3).map((option) => ({
      ...option,
      safeForAccount: typeof safetyEffectiveMultiplier === 'number' && Number.isFinite(safetyEffectiveMultiplier)
        ? option.effectiveMultiplier >= safetyEffectiveMultiplier - 0.0005
        : true,
      scopeLabel,
      safetyEffectiveMultiplier
    })),
    currentEffectiveMultiplier
  }
}

export function buildAccountRecommendationMutations(
  stationId: string,
  accounts: AccountSnapshot[],
  groups: GroupSnapshot[],
  rechargeRatio: number,
  category: CategoryId,
  scope: GroupSwitchScope,
  safetyByAccountId: Record<number, number | undefined> = {}
): AccountGroupMutation[] {
  return accounts
    .map((account) => {
      if (!accountCanRecommend(account)) return undefined
      const recommendation = recommendedAccountGroupOption(groups, account.groupIds, rechargeRatio, category, scope, safetyByAccountId[account.id], inferAccountCategory(account))
      if (!recommendation?.safeForAccount) return undefined
      const nextGroupIds = [...new Set([...account.groupIds, recommendation.option.group.id])]
      return {
        stationId,
        accountId: account.id,
        accountName: account.name,
        previousGroupIds: account.groupIds,
        nextGroupIds
      }
    })
    .filter((mutation): mutation is AccountGroupMutation => Boolean(mutation))
}

export function batchMutationResultCounts(results: BatchMutationResult[]): Record<BatchMutationResultStatus, number> {
  return results.reduce<Record<BatchMutationResultStatus, number>>((counts, result) => {
    counts[result.status] += 1
    return counts
  }, { success: 0, failed: 0, skipped: 0 })
}

export function isOwnStation(station: Pick<StationPublic, 'hasAdminToken' | 'stationRole'>, snapshot?: Pick<StationSnapshot, 'accounts'>): boolean {
  if (station.stationRole) return station.stationRole === 'own'
  return station.hasAdminToken || (snapshot?.accounts.length ?? 0) > 0
}

export function stationAdapterLabel(station: Pick<StationPublic, 'adapterType' | 'detectedAdapterType'>): string {
  const resolved = station.adapterType === 'auto' ? station.detectedAdapterType : station.adapterType
  return resolved === 'newapi' ? 'NewAPI' : resolved === 'custom' ? '自定义兼容' : station.adapterType === 'auto' ? '自动检测' : 'Sub2API'
}

export function isAdminManagedStation(station: Pick<StationPublic, 'hasAdminToken' | 'stationRole' | 'adapterType' | 'detectedAdapterType'>, snapshot?: Pick<StationSnapshot, 'accounts'>): boolean {
  return isOwnStation(station, snapshot) && stationAdapterLabel(station) !== 'NewAPI'
}

export function isPriceRankingStation(station: Pick<StationPublic, 'hasAdminToken' | 'stationRole' | 'adapterType' | 'detectedAdapterType'>, snapshot?: Pick<StationSnapshot, 'accounts'>): boolean {
  return !isOwnStation(station, snapshot)
}

export function mergeSnapshotMap(current: Record<string, StationSnapshot>, snapshot: StationSnapshot): Record<string, StationSnapshot> {
  return { ...current, [snapshot.stationId]: snapshot }
}

export function groupSwitchSuccessText(accountName: string, nextLabel: string): string {
  return `${accountName} 组合已更新为 ${nextLabel}，已刷新站点状态`
}

export function groupSwitchCompletionNotice(accountName: string, nextLabel: string, snapshot: StationSnapshot): { kind: NoticeKind; text: string } {
  if (snapshot.health === 'healthy') {
    return { kind: 'success', text: groupSwitchSuccessText(accountName, nextLabel) }
  }
  return {
    kind: 'warning',
    text: `${accountName} 已提交切组到 ${nextLabel}，但刷新失败，请手动刷新确认`
  }
}

export function groupSwitchPlatformOptions(options: GroupSwitchOption[]): string[] {
  return [...new Set(options.map((option) => option.group.platform).filter(Boolean))].sort((left, right) => left.localeCompare(right))
}

export function filterGroupSwitchOptions(options: GroupSwitchOption[], query: string, platform: GroupSwitchPlatformFilter): GroupSwitchOption[] {
  const normalizedQuery = query.trim().toLowerCase()
  return options.filter((option) => {
    if (platform !== 'all' && option.group.platform !== platform) return false
    if (!normalizedQuery) return true
    const haystack = `${option.group.name} ${option.group.platform}`.toLowerCase()
    return haystack.includes(normalizedQuery)
  })
}

function formatPrice(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
}

function formatMultiplierInput(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return value.toFixed(3)
}

function parseMultiplierInput(value: string): number | undefined {
  const normalized = value.trim()
  if (!normalized) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function pathValue(value: string | undefined, fallback: string): string {
  return value ?? fallback
}

function cleanPath(value: string): string {
  return value.trim().replace(/\s+/g, '')
}

function cleanUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function categoryLabel(category: CategoryId): string {
  return categoryTabs.find((item) => item.id === category)?.label ?? '其他'
}

function inferCategory(group: GroupSnapshot, modelName = ''): CategoryId {
  const haystack = `${group.platform} ${group.name} ${modelName}`.toLowerCase()
  const matched = categoryTabs.find((category) => category.id !== 'all' && category.id !== 'other' && category.keywords.some((keyword) => haystack.includes(keyword)))
  return matched?.id ?? 'other'
}

export function inferAccountCategory(account: Pick<AccountSnapshot, 'platform'> & Partial<Pick<AccountSnapshot, 'name'>>): CategoryId {
  const haystack = `${account.platform} ${account.name ?? ''}`.toLowerCase()
  const matched = categoryTabs.find((category) => category.id !== 'all' && category.id !== 'other' && category.keywords.some((keyword) => haystack.includes(keyword)))
  return matched?.id ?? 'other'
}

function groupMatchesAccountCategory(group: GroupSnapshot, accountCategory: CategoryId): boolean {
  return accountCategory === 'other' || inferCategory(group) === accountCategory
}

export function inferGroupCapabilityTags(group: GroupSnapshot, modelName = ''): GroupCapabilityTag[] {
  const modelNames = group.pricingModels?.map((model) => model.name).join(' ') ?? ''
  const haystack = `${group.platform} ${group.name} ${modelName} ${modelNames} ${group.pricingHint ?? ''}`.toLowerCase()
  const matched = groupCapabilityTags
    .filter((tag) => tag.keywords.some((keyword) => haystack.includes(keyword)))
    .map(({ id, label }) => ({ id, label }))
  return matched.length > 0 ? matched : [defaultGroupCapabilityTag]
}

export function groupPreferenceKey(stationId: string, groupId: number): string {
  return `${stationId}:${groupId}`
}

function tagById(id: GroupCapabilityTagId): GroupCapabilityTag {
  if (id === defaultGroupCapabilityTag.id) return defaultGroupCapabilityTag
  const tag = groupCapabilityTags.find((item) => item.id === id)
  return tag ? { id: tag.id, label: tag.label } : { id, label: id }
}

export function resolveGroupCapabilityTags(group: GroupSnapshot, manualTags?: GroupCapabilityTagId[], modelName = ''): GroupCapabilityTag[] {
  const normalizedManualTags = manualTags ? [...new Set(manualTags)] : []
  return normalizedManualTags.length > 0 ? normalizedManualTags.map(tagById) : inferGroupCapabilityTags(group, modelName)
}

export function toggleManualGroupTag(
  current: Record<string, GroupCapabilityTagId[]>,
  key: string,
  tagId: GroupCapabilityTagId,
  fallbackTags: GroupCapabilityTagId[]
): Record<string, GroupCapabilityTagId[]> {
  const base = current[key] ?? fallbackTags
  const nextTags = base.includes(tagId) ? base.filter((item) => item !== tagId) : [...base, tagId]
  const next = { ...current }
  if (nextTags.length > 0) next[key] = [...new Set(nextTags)]
  else delete next[key]
  return next
}

export function clearManualGroupTag(current: Record<string, GroupCapabilityTagId[]>, key: string): Record<string, GroupCapabilityTagId[]> {
  const next = { ...current }
  delete next[key]
  return next
}

function groupMatchesTagFilter(group: GroupSnapshot, tagFilter: GroupTagFilter, manualTags?: GroupCapabilityTagId[]): boolean {
  return tagFilter === 'all' || resolveGroupCapabilityTags(group, manualTags).some((tag) => tag.id === tagFilter)
}

function rowMatchesTagFilter(row: ComparisonRow, tagFilter: GroupTagFilter): boolean {
  return tagFilter === 'all' || row.tags.some((tag) => tag.id === tagFilter)
}

export function rowMatchesPriceSearch(row: ComparisonRow, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return true
  return [row.modelName, row.groupName, row.stationName, row.platform]
    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
}

function groupTagLabel(tag: GroupCapabilityTagId): string {
  return tag === defaultGroupCapabilityTag.id
    ? defaultGroupCapabilityTag.label
    : groupCapabilityTags.find((item) => item.id === tag)?.label ?? tag
}

function effectiveScore(row: ComparisonRow): number {
  return row.score ?? Number.POSITIVE_INFINITY
}

export function rankingSortValue(row: ComparisonRow, key: RankingSortKey): number {
  if (key === 'effectiveCost') return effectiveScore(row)
  if (key === 'effectiveMultiplier') return row.effectiveMultiplier
  if (key === 'rateMultiplier') return row.rateMultiplier
  return row.rechargeRatio
}

export function compareRankingRows(left: ComparisonRow, right: ComparisonRow, sort: RankingSortState): number {
  const leftValue = rankingSortValue(left, sort.key)
  const rightValue = rankingSortValue(right, sort.key)
  const leftMissing = !Number.isFinite(leftValue)
  const rightMissing = !Number.isFinite(rightValue)
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) {
      return left.categoryLabel.localeCompare(right.categoryLabel)
        || left.modelName.localeCompare(right.modelName)
        || left.stationName.localeCompare(right.stationName)
    }
    return leftMissing ? 1 : -1
  }

  const primary = sort.direction === 'asc' ? leftValue - rightValue : rightValue - leftValue
  if (primary !== 0) return primary
  return effectiveScore(left) - effectiveScore(right)
    || left.categoryLabel.localeCompare(right.categoryLabel)
    || left.modelName.localeCompare(right.modelName)
    || left.stationName.localeCompare(right.stationName)
}

export function compareSourceWalletStations(
  left: StationPublic,
  right: StationPublic,
  snapshots: Record<string, StationSnapshot>,
  direction: SourceWalletSortDirection
): number {
  const leftBalance = snapshots[left.id]?.balance
  const rightBalance = snapshots[right.id]?.balance
  const leftMissing = typeof leftBalance !== 'number' || !Number.isFinite(leftBalance)
  const rightMissing = typeof rightBalance !== 'number' || !Number.isFinite(rightBalance)
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return left.name.localeCompare(right.name)
    return leftMissing ? 1 : -1
  }
  const primary = direction === 'asc' ? leftBalance - rightBalance : rightBalance - leftBalance
  return primary || left.name.localeCompare(right.name)
}

export function toggleRankingSort(current: RankingSortState, key: RankingSortKey): RankingSortState {
  if (current.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  return { key, direction: rankingSortDefaultDirections[key] }
}

export function rankingSortText(sort: RankingSortState): string {
  return `按${rankingSortLabels[sort.key]}${sort.direction === 'asc' ? '从低到高' : '从高到低'}`
}

function rankingSortGlyph(sort: RankingSortState, key: RankingSortKey): string {
  if (sort.key !== key) return '↕'
  return sort.direction === 'asc' ? '↑' : '↓'
}

function hiddenGroupKey(row: Pick<ComparisonRow, 'stationId' | 'groupId'>): string {
  return groupPreferenceKey(row.stationId, row.groupId)
}

export function countHiddenGroupsForRows(rows: Array<Pick<ComparisonRow, 'stationId' | 'groupId'>>, hiddenKeys: Iterable<string>): number {
  const hiddenSet = new Set(hiddenKeys)
  return new Set(rows.filter((row) => hiddenSet.has(hiddenGroupKey(row))).map(hiddenGroupKey)).size
}

export function clearGroupLocalReferences(
  hiddenKeys: Iterable<string>,
  stationId: string,
  groupId: number
): { hiddenGroupKeys: string[] } {
  const key = `${stationId}:${groupId}`
  return {
    hiddenGroupKeys: [...hiddenKeys].filter((item) => item !== key)
  }
}

function readHiddenGroupKeys(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const value = window.localStorage.getItem(hiddenGroupsStorageKey)
    const parsed: unknown = value ? JSON.parse(value) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

function isGroupChangeKind(value: unknown): value is GroupChangeKind {
  return value === 'added' || value === 'removed' || value === 'rate-up' || value === 'rate-down'
}

export function normalizeStoredGroupChangeEvents(value: unknown): GroupChangeEvent[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is GroupChangeEvent => {
      if (!item || typeof item !== 'object') return false
      const event = item as Partial<GroupChangeEvent>
      return typeof event.id === 'string'
        && isGroupChangeKind(event.kind)
        && typeof event.stationId === 'string'
        && typeof event.stationName === 'string'
        && typeof event.groupId === 'number'
        && typeof event.groupName === 'string'
        && typeof event.platform === 'string'
        && typeof event.occurredAt === 'string'
        && Number.isFinite(new Date(event.occurredAt).getTime())
    })
    .slice(0, groupChangeEventsRetentionLimit)
}

function readStoredGroupChangeEvents(): GroupChangeEvent[] {
  if (typeof window === 'undefined') return []
  try {
    const value = window.localStorage.getItem(groupChangeEventsStorageKey)
    return normalizeStoredGroupChangeEvents(value ? JSON.parse(value) : [])
  } catch {
    return []
  }
}

function readLastGroupChangeNotificationAt(): string | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage.getItem(groupChangeNotificationStorageKey) || undefined
  } catch {
    return undefined
  }
}

function saveLastGroupChangeNotificationAt(value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(groupChangeNotificationStorageKey, value)
  } catch {
    // Notification read markers are local UI convenience only.
  }
}

function newestGroupChangeTime(events: GroupChangeEvent[]): string | undefined {
  return events
    .map((event) => event.occurredAt)
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0]
}

export function groupChangeNotificationSummary(events: GroupChangeEvent[], lastNotifiedAt?: string): { events: GroupChangeEvent[]; rateUp: number; rateDown: number; newestAt?: string; text?: string } {
  const lastTime = lastNotifiedAt ? new Date(lastNotifiedAt).getTime() : Number.NaN
  const hasLastNotification = Number.isFinite(lastTime)
  const changedEvents = events.filter((event) => {
    if (!isVerifiedRateChangeEvent(event)) return false
    const occurredAt = new Date(event.occurredAt).getTime()
    return !hasLastNotification || (Number.isFinite(occurredAt) && occurredAt > lastTime)
  })
  const rateUp = changedEvents.filter((event) => event.kind === 'rate-up').length
  const rateDown = changedEvents.filter((event) => event.kind === 'rate-down').length
  const newestAt = newestGroupChangeTime(changedEvents)
  const parts = [
    rateUp > 0 ? `${rateUp} 个涨价` : undefined,
    rateDown > 0 ? `${rateDown} 个降价` : undefined
  ].filter((item): item is string => Boolean(item))
  return {
    events: changedEvents,
    rateUp,
    rateDown,
    newestAt,
    text: parts.length > 0 ? `发现 ${parts.join('、')}，可在价格榜筛选查看。` : undefined
  }
}

function showSystemNotification(title: string, body: string): void {
  if (typeof Notification === 'undefined') return
  try {
    const show = () => new Notification(title, { body })
    if (Notification.permission === 'granted') {
      show()
      return
    }
    if (Notification.permission === 'default') {
      void Notification.requestPermission()
        .then((permission) => {
          if (permission === 'granted') show()
        })
        .catch(() => undefined)
    }
  } catch {
    // System notifications are best-effort.
  }
}

export function normalizeAccountRecommendationStrategy(value: unknown): AccountRecommendationStrategy {
  return value === 'all-station' ? 'all-station' : 'category-first'
}

function readAccountRecommendationStrategy(): AccountRecommendationStrategy {
  if (typeof window === 'undefined') return 'category-first'
  try {
    return normalizeAccountRecommendationStrategy(window.localStorage.getItem(accountRecommendationStrategyStorageKey))
  } catch {
    return 'category-first'
  }
}

function comparableGroup(group: GroupSnapshot): ComparableGroup {
  return {
    id: group.id,
    name: group.name,
    platform: group.platform,
    rate: group.userRateMultiplier ?? group.rateMultiplier
  }
}

function groupMap(snapshot: StationSnapshot): Map<number, ComparableGroup> {
  return new Map(snapshot.groups.map((group) => [group.id, comparableGroup(group)]))
}

export function detectSnapshotChanges(
  previous: Record<string, StationSnapshot>,
  next: Record<string, StationSnapshot>,
  occurredAt = new Date().toISOString()
): GroupChangeEvent[] {
  const events: GroupChangeEvent[] = []
  for (const snapshot of Object.values(next)) {
    const previousSnapshot = previous[snapshot.stationId]
    if (!previousSnapshot) continue
    const before = groupMap(previousSnapshot)
    const after = groupMap(snapshot)

    for (const group of after.values()) {
      const previousGroup = before.get(group.id)
      if (!previousGroup) {
        events.push({
          id: `${occurredAt}:${snapshot.stationId}:${group.id}:added`,
          kind: 'added',
          stationId: snapshot.stationId,
          stationName: snapshot.stationName,
          groupId: group.id,
          groupName: group.name,
          platform: group.platform,
          nextRate: group.rate,
          occurredAt
        })
        continue
      }
      const delta = group.rate - previousGroup.rate
      if (Math.abs(delta) >= 0.0005) {
        events.push({
          id: `${occurredAt}:${snapshot.stationId}:${group.id}:${delta > 0 ? 'rate-up' : 'rate-down'}`,
          kind: delta > 0 ? 'rate-up' : 'rate-down',
          stationId: snapshot.stationId,
          stationName: snapshot.stationName,
          groupId: group.id,
          groupName: group.name,
          platform: group.platform,
          previousRate: previousGroup.rate,
          nextRate: group.rate,
          occurredAt
        })
      }
    }

    for (const group of before.values()) {
      if (after.has(group.id)) continue
      events.push({
        id: `${occurredAt}:${snapshot.stationId}:${group.id}:removed`,
        kind: 'removed',
        stationId: snapshot.stationId,
        stationName: snapshot.stationName,
        groupId: group.id,
        groupName: group.name,
        platform: group.platform,
        previousRate: group.rate,
        occurredAt
      })
    }
  }
  return events
}

export function latestVisibleGroupChangeFor(stationId: string, groupId: number, events: GroupChangeEvent[]): GroupChangeEvent | undefined {
  return events.reduce<GroupChangeEvent | undefined>((latest, event) => {
    if (event.stationId !== stationId || event.groupId !== groupId || !isVerifiedRateChangeEvent(event)) return latest
    if (!latest) return event
    return new Date(event.occurredAt).getTime() > new Date(latest.occurredAt).getTime() ? event : latest
  }, undefined)
}

export function isVerifiedRateChangeEvent(event: GroupChangeEvent): boolean {
  if (event.kind !== 'rate-up' && event.kind !== 'rate-down') return false
  if (typeof event.previousRate !== 'number' || !Number.isFinite(event.previousRate) || typeof event.nextRate !== 'number' || !Number.isFinite(event.nextRate)) return false
  const delta = event.nextRate - event.previousRate
  if (Math.abs(delta) < 0.0005) return false
  return event.kind === 'rate-up' ? delta > 0 : delta < 0
}

export function rowMatchesRankingChangeFilter(row: Pick<ComparisonRow, 'stationId' | 'groupId'>, events: GroupChangeEvent[], filter: RankingChangeFilter): boolean {
  if (filter === 'all') return true
  return latestVisibleGroupChangeFor(row.stationId, row.groupId, events)?.kind === filter
}

export function rankingChangeFilterCount(rows: Array<Pick<ComparisonRow, 'stationId' | 'groupId'>>, events: GroupChangeEvent[], filter: RankingChangeFilter): number {
  const groupKeys = new Set(rows.filter((row) => rowMatchesRankingChangeFilter(row, events, filter)).map((row) => `${row.stationId}:${row.groupId}`))
  return groupKeys.size
}

export function filterGroupChangeEvents(events: GroupChangeEvent[], filter: GroupChangeFilter): GroupChangeEvent[] {
  const visible = events.filter((event) => (event.kind !== 'rate-up' && event.kind !== 'rate-down') || isVerifiedRateChangeEvent(event))
  return filter === 'all' ? visible : visible.filter((event) => event.kind === filter)
}

export function searchGroupChangeEvents(events: GroupChangeEvent[], query: string): GroupChangeEvent[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return events
  return events.filter((event) => {
    const haystack = `${event.stationName} ${event.groupName} ${event.platform} ${changeKindLabel(event.kind)}`.toLowerCase()
    return haystack.includes(normalizedQuery)
  })
}

export function groupHistoryEvents(events: GroupChangeEvent[], stationId: string, groupId: number): GroupChangeEvent[] {
  return events.filter((event) => event.stationId === stationId && event.groupId === groupId)
}

function finiteRateValue(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function groupHistoryTrendPoints(events: GroupChangeEvent[]): GroupHistoryTrendPoint[] {
  const points: GroupHistoryTrendPoint[] = []
  const chronologicalEvents = [...events].sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime())
  for (const event of chronologicalEvents) {
    if (event.kind === 'rate-up' || event.kind === 'rate-down') {
      const previousRate = finiteRateValue(event.previousRate)
      const nextRate = finiteRateValue(event.nextRate)
      if (previousRate !== undefined) points.push({ id: `${event.id}:previous`, value: previousRate, occurredAt: event.occurredAt, kind: event.kind })
      if (nextRate !== undefined) points.push({ id: `${event.id}:next`, value: nextRate, occurredAt: event.occurredAt, kind: event.kind })
      continue
    }
    const eventRate = finiteRateValue(event.kind === 'removed' ? event.previousRate : event.nextRate)
    if (eventRate !== undefined) points.push({ id: event.id, value: eventRate, occurredAt: event.occurredAt, kind: event.kind })
  }
  return points
}

export function accountsForGroup(accounts: AccountSnapshot[], groupId: number): AccountSnapshot[] {
  return accounts.filter((account) => account.groupIds.includes(groupId))
}

export function groupChangeFilterCount(events: GroupChangeEvent[], filter: GroupChangeFilter): number {
  return filterGroupChangeEvents(events, filter).length
}

function changeKindLabel(kind: GroupChangeKind): string {
  if (kind === 'added') return '新增'
  if (kind === 'removed') return '删除'
  if (kind === 'rate-up') return '变贵'
  return '变便宜'
}

export function groupChangeTooltip(event: GroupChangeEvent): string {
  if (event.kind === 'added') return `新增：当前 ${formatRateMultiplier(event.nextRate)} · ${formatTime(event.occurredAt)}`
  if (event.kind === 'removed') return `删除：原倍率 ${formatRateMultiplier(event.previousRate)} · ${formatTime(event.occurredAt)}`
  return `${changeKindLabel(event.kind)}：${formatRateMultiplier(event.previousRate)} → ${formatRateMultiplier(event.nextRate)} · ${formatTime(event.occurredAt)}`
}

export function groupChangeRateText(event: GroupChangeEvent): string {
  if (event.kind === 'added') return formatRateMultiplier(event.nextRate)
  if (event.kind === 'removed') return formatRateMultiplier(event.previousRate)
  return `${formatRateMultiplier(event.previousRate)} → ${formatRateMultiplier(event.nextRate)}`
}

export function groupRateChangeIndicator(event: GroupChangeEvent | undefined): { tone: '' | 'added' | 'rate-up' | 'rate-down'; arrow: string } {
  if (!event) return { tone: '', arrow: '' }
  if (event.kind === 'rate-up') return { tone: 'rate-up', arrow: '↑' }
  if (event.kind === 'rate-down') return { tone: 'rate-down', arrow: '↓' }
  if (event.kind === 'added') return { tone: 'added', arrow: '+' }
  return { tone: '', arrow: '' }
}

export function groupRateChangeIcon(event: GroupChangeEvent | undefined): { tone: '' | 'added' | 'rate-up' | 'rate-down'; icon: string } {
  if (!event) return { tone: '', icon: '' }
  if (event.kind === 'rate-up') return { tone: 'rate-up', icon: '📈' }
  if (event.kind === 'rate-down') return { tone: 'rate-down', icon: '📉' }
  if (event.kind === 'added') return { tone: 'added', icon: 'sparkles' }
  return { tone: '', icon: '' }
}

function switchPreviewLabel(direction: GroupSwitchPreviewDirection): string {
  if (direction === 'cheaper') return '目标更便宜'
  if (direction === 'more-expensive') return '目标更贵'
  if (direction === 'same') return '倍率基本持平'
  return '等待可比较目标'
}

function RankingSortButton({
  option,
  sort,
  onChange,
  compact = false
}: {
  option: RankingSortOption
  sort: RankingSortState
  onChange: (key: RankingSortKey) => void
  compact?: boolean
}) {
  const active = sort.key === option.key
  return (
    <button
      type="button"
      className={active ? 'sort-header-button active' : 'sort-header-button'}
      onClick={() => onChange(option.key)}
      aria-label={`按${option.label}排序，当前${active ? (sort.direction === 'asc' ? '从低到高' : '从高到低') : `默认${rankingSortDefaultDirections[option.key] === 'asc' ? '从低到高' : '从高到低'}`}`}
      title={`按${option.label}排序`}
      data-compact={compact ? 'true' : 'false'}
    >
      <span>{option.label}</span>
      <strong>{rankingSortGlyph(sort, option.key)}</strong>
    </button>
  )
}

function GroupHistoryChart({ points }: { points: GroupHistoryTrendPoint[] }) {
  if (points.length === 0) {
    return <div className="group-history-chart empty"><SlidersHorizontal size={16} /><span>暂无可绘制的倍率走势</span></div>
  }

  const width = 640
  const height = 132
  const paddingX = 28
  const paddingY = 20
  const values = points.map((point) => point.value)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const spread = Math.max(maxValue - minValue, 0.001)
  const xFor = (index: number) => points.length === 1
    ? width / 2
    : paddingX + (index / (points.length - 1)) * (width - paddingX * 2)
  const yFor = (value: number) => height - paddingY - ((value - minValue) / spread) * (height - paddingY * 2)
  const coordinates = points.map((point, index) => ({ point, x: xFor(index), y: yFor(point.value) }))
  const linePath = coordinates.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L ${coordinates.at(-1)?.x.toFixed(1) ?? width / 2} ${height - paddingY} L ${coordinates[0]?.x.toFixed(1) ?? width / 2} ${height - paddingY} Z`
  const lastPoint = points.at(-1)
  const firstPoint = points[0]
  const tone = lastPoint && firstPoint && lastPoint.value < firstPoint.value ? 'down' : lastPoint && firstPoint && lastPoint.value > firstPoint.value ? 'up' : 'same'

  return (
    <div className={`group-history-chart ${tone}`} aria-label="分组倍率走势">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`倍率走势，从 ${formatRateMultiplier(firstPoint?.value)} 到 ${formatRateMultiplier(lastPoint?.value)}`}>
        <line className="group-history-chart-grid" x1={paddingX} x2={width - paddingX} y1={paddingY} y2={paddingY} />
        <line className="group-history-chart-grid" x1={paddingX} x2={width - paddingX} y1={height - paddingY} y2={height - paddingY} />
        {points.length === 1
          ? <line className="group-history-chart-line" x1={paddingX} x2={width - paddingX} y1={coordinates[0].y} y2={coordinates[0].y} />
          : <>
              <path className="group-history-chart-area" d={areaPath} />
              <path className="group-history-chart-line" d={linePath} />
            </>}
        {coordinates.map(({ point, x, y }) => (
          <circle key={point.id} className={`group-history-chart-point ${point.kind}`} cx={x} cy={y} r="4.5">
            <title>{changeKindLabel(point.kind)} · {formatRateMultiplier(point.value)} · {formatTime(point.occurredAt)}</title>
          </circle>
        ))}
      </svg>
      <div className="group-history-chart-labels">
        <span><em>最低</em><strong>{formatRateMultiplier(minValue)}</strong></span>
        <span><em>最高</em><strong>{formatRateMultiplier(maxValue)}</strong></span>
        <span><em>记录</em><strong>{points.length}</strong></span>
      </div>
    </div>
  )
}

function healthLabel(snapshot?: StationSnapshot): string {
  if (!snapshot || snapshot.health === 'loading') return '同步中'
  if (snapshot.health === 'healthy') return '正常'
  if (snapshot.health === 'stale') return '数据过期'
  if (snapshot.health === 'forbidden') return '需要授权'
  if (snapshot.health === 'empty') return '暂无数据'
  return '连接失败'
}

function formatBillingUnits(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

function shanghaiDateInput(value = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function shiftShanghaiDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00+08:00`)
  value.setUTCDate(value.getUTCDate() + days)
  return shanghaiDateInput(value)
}

function profitCoverageLabel(report: ProfitIntervalReport | null): string {
  if (!report) return '尚未核算'
  const { coverage } = report
  const prefix = coverage.state === 'complete'
    ? '区间已完整读取'
    : coverage.state === 'page-limit'
      ? '达到明细页数上限'
      : coverage.state === 'incomplete'
        ? '区间读取不完整'
        : '管理员明细不可用'
  const detail = coverage.detail ? ` · ${coverage.detail}` : ''
  return `${prefix} · ${coverage.acceptedEntries}/${coverage.recordsSeen} 条已纳入${detail}`
}

function App() {
  const [stations, setStations] = useState<StationPublic[]>([])
  const [snapshots, setSnapshots] = useState<Record<string, StationSnapshot>>({})
  const [selectedId, setSelectedId] = useState('demo-primary')
  const [mode, setMode] = useState<WindowMode>(initialWindowMode)
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsForm, setSettingsForm] = useState<SettingsForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [authorizing, setAuthorizing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [sourceStationAction, setSourceStationAction] = useState<SourceStationAction | null>(null)
  const [notice, setNotice] = useState<{ kind: NoticeKind; text: string } | null>(null)
  const [mutation, setMutation] = useState<AccountGroupMutation | null>(null)
  const [mutating, setMutating] = useState(false)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>('all')
  const [selectedTag, setSelectedTag] = useState<GroupTagFilter>('all')
  const [diagnostics, setDiagnostics] = useState<StationDiagnostics | null>(null)
  const [diagnosing, setDiagnosing] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [rankingSort, setRankingSort] = useState<RankingSortState>(defaultRankingSort)
  const [rankingChangeFilter, setRankingChangeFilter] = useState<RankingChangeFilter>('all')
  const [rankingUsageFilter, setRankingUsageFilter] = useState<RankingUsageFilter>('not-in-use')
  const [priceSearchQuery, setPriceSearchQuery] = useState('')
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('pricing')
  const [integrationDraft, setIntegrationDraft] = useState<IntegrationDraft | null>(null)
  const [mappingPreview, setMappingPreview] = useState<StationMappingPreview | null>(null)
  const [mappingPreviewing, setMappingPreviewing] = useState(false)
  const [mappingSaving, setMappingSaving] = useState(false)
  const [dataCenterSummary, setDataCenterSummary] = useState<DataCenterSummary | null>(null)
  const [dataCenterLoading, setDataCenterLoading] = useState(false)
  const [dataCenterError, setDataCenterError] = useState<string | null>(null)
  const [stationConsoleTab, setStationConsoleTab] = useState<StationConsoleTab>('accounts')
  const [sourceWalletView, setSourceWalletView] = useState<SourceWalletView>('source')
  const [sourceWalletBalanceSort, setSourceWalletBalanceSort] = useState<SourceWalletSortDirection>('desc')
  const [hiddenGroupKeys, setHiddenGroupKeys] = useState<Set<string>>(() => new Set())
  const [operatingExcludedGroupKeys, setOperatingExcludedGroupKeys] = useState<Set<string>>(() => new Set())
  const [manualGroupTags, setManualGroupTags] = useState<Record<string, GroupCapabilityTagId[]>>({})
  const [accountUpstreamMappings, setAccountUpstreamMappings] = useState<AccountUpstreamMapping[]>([])
  const [accountCostProfiles, setAccountCostProfiles] = useState<AccountCostProfile[]>([])
  const [internalUserProfiles, setInternalUserProfiles] = useState<InternalUserProfile[]>([])
  const [timeCostLedger, setTimeCostLedger] = useState<TimeCostLedger>(() => emptyTimeCostLedger())
  const [mappingEditor, setMappingEditor] = useState<MappingEditorState | null>(null)
  const [mappingRebuildPreview, setMappingRebuildPreview] = useState<MappingRebuildPreview | null>(null)
  const [costProfileEditor, setCostProfileEditor] = useState<CostProfileEditorState | null>(null)
  const [batchCostProfileEditor, setBatchCostProfileEditor] = useState<BatchCostProfileEditorState | null>(null)
  const [rebuildingMappings, setRebuildingMappings] = useState(false)
  const [usageDiagnosticOpen, setUsageDiagnosticOpen] = useState(false)
  const [showHiddenGroups, setShowHiddenGroups] = useState(false)
  const [changeLogOpen, setChangeLogOpen] = useState(false)
  const [changeLogQuery, setChangeLogQuery] = useState('')
  const [changeLogFilter, setChangeLogFilter] = useState<GroupChangeFilter>('all')
  const [selectedGroupHistory, setSelectedGroupHistory] = useState<GroupHistorySelection | null>(null)
  const [groupChangeEvents, setGroupChangeEvents] = useState<GroupChangeEvent[]>([])
  const [dismissedGroupChangeEventIds, setDismissedGroupChangeEventIds] = useState<Set<string>>(() => new Set())
  const [demoChangeLogDismissed, setDemoChangeLogDismissed] = useState(false)
  const [openGroupMenu, setOpenGroupMenu] = useState<GroupMenuState | null>(null)
  const [expandedAdminGroupKeys, setExpandedAdminGroupKeys] = useState<Set<string>>(() => new Set())
  const [groupSwitchQuery, setGroupSwitchQuery] = useState('')
  const [groupSwitchPlatform, setGroupSwitchPlatform] = useState<GroupSwitchPlatformFilter>('all')
  const [groupSwitchScope, setGroupSwitchScope] = useState<GroupSwitchScope>('category')
  const [accountSearchQuery, setAccountSearchQuery] = useState('')
  const [accountScheduleFilter, setAccountScheduleFilter] = useState<AccountScheduleFilter>('enabled')
  const [accountPlatformFilter, setAccountPlatformFilter] = useState<AccountPlatformFilter>('all')
  const [accountGroupFilter, setAccountGroupFilter] = useState<AccountGroupFilter>('all')
  const [accountRecommendationStrategy, setAccountRecommendationStrategy] = useState<AccountRecommendationStrategy>(() => readAccountRecommendationStrategy())
  const [costViewMode, setCostViewMode] = useState<CostViewMode>('group')
  const [costStatusFilter, setCostStatusFilter] = useState<CostStatusFilter>('all')
  const [costKindFilter, setCostKindFilter] = useState<CostKindFilter>('all')
  const [costBaseRateOnly, setCostBaseRateOnly] = useState(false)
  const [costSortMode, setCostSortMode] = useState<CostSortMode>('unset-first')
  const [profitGranularity, setProfitGranularity] = useState<ProfitIntervalGranularity>('day')
  const [profitEndDate, setProfitEndDate] = useState(() => shanghaiDateInput())
  const [profitStartDate, setProfitStartDate] = useState(() => shiftShanghaiDate(shanghaiDateInput(), -6))
  const [profitAccountId, setProfitAccountId] = useState('all')
  const [profitSellingGroupId, setProfitSellingGroupId] = useState('all')
  const [profitReport, setProfitReport] = useState<ProfitIntervalReport | null>(null)
  const [profitLoading, setProfitLoading] = useState(false)
  const [profitArchiving, setProfitArchiving] = useState(false)
  const [profitError, setProfitError] = useState<string | null>(null)
  const [focusedAccountKey, setFocusedAccountKey] = useState('')
  const [candidateBudgetInput, setCandidateBudgetInput] = useState('')
  const [mutationQueue, setMutationQueue] = useState<AccountGroupMutation[]>([])
  const [batchQueueActive, setBatchQueueActive] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [batchMutationResults, setBatchMutationResults] = useState<BatchMutationResult[]>([])
  const [expandedProfitAccountKeys, setExpandedProfitAccountKeys] = useState<Set<string>>(() => new Set())
  const previousSnapshotsRef = useRef<Record<string, StationSnapshot> | null>(null)
  const preferencesLoadedRef = useRef(false)

  const isBrowserPreview = window.aizzz.runtime.isBrowserPreview
  const demoMode = stations.length === 0
  const sourceStations = demoMode ? demoStations : stations
  const visibleSnapshots = demoMode ? demoSnapshots : snapshots
  const selectedConsoleStation = useMemo(() => {
    const selected = sourceStations.find((station) => station.id === selectedId)
    if (selected && isAdminManagedStation(selected, visibleSnapshots[selected.id])) return selected
    return sourceStations.find((station) => isAdminManagedStation(station, visibleSnapshots[station.id]))
  }, [selectedId, sourceStations, visibleSnapshots])
  const selectedConsoleSnapshot = selectedConsoleStation ? visibleSnapshots[selectedConsoleStation.id] : undefined
  const baseGroupChangeEvents = demoMode && !demoChangeLogDismissed && groupChangeEvents.length === 0 ? demoGroupChangeEvents : groupChangeEvents
  const showDemoChangeLogReset = demoMode && !demoChangeLogDismissed && groupChangeEvents.length === 0
  const visibleGroupChangeEvents = useMemo(() => baseGroupChangeEvents.filter((event) => !dismissedGroupChangeEventIds.has(event.id) && ((event.kind !== 'rate-up' && event.kind !== 'rate-down') || isVerifiedRateChangeEvent(event))), [baseGroupChangeEvents, dismissedGroupChangeEventIds])
  const observedRateChangeEvents = useMemo(
    () => visibleGroupChangeEvents.filter(isVerifiedRateChangeEvent),
    [visibleGroupChangeEvents]
  )
  const searchedGroupChangeEvents = useMemo(() => searchGroupChangeEvents(visibleGroupChangeEvents, changeLogQuery), [changeLogQuery, visibleGroupChangeEvents])
  const filteredGroupChangeEvents = useMemo(() => filterGroupChangeEvents(searchedGroupChangeEvents, changeLogFilter), [changeLogFilter, searchedGroupChangeEvents])
  const selectedGroupHistoryEvents = useMemo(() => {
    return selectedGroupHistory
      ? groupHistoryEvents(visibleGroupChangeEvents, selectedGroupHistory.stationId, selectedGroupHistory.groupId)
      : []
  }, [selectedGroupHistory, visibleGroupChangeEvents])
  const selectedGroupHistoryTrendPoints = useMemo(() => groupHistoryTrendPoints(selectedGroupHistoryEvents), [selectedGroupHistoryEvents])
  const selectedGroupHistoryCurrent = useMemo(() => {
    if (!selectedGroupHistory) return undefined
    return visibleSnapshots[selectedGroupHistory.stationId]?.groups.find((group) => group.id === selectedGroupHistory.groupId)
  }, [selectedGroupHistory, visibleSnapshots])
  const priceRankingStationIds = useMemo(() => new Set(sourceStations
    .filter((station) => isPriceRankingStation(station, visibleSnapshots[station.id]))
    .map((station) => station.id)), [sourceStations, visibleSnapshots])
  const allComparisonRows = useMemo<ComparisonRow[]>(() => {
    const rows: ComparisonRow[] = []
    for (const station of sourceStations) {
      const snapshot = visibleSnapshots[station.id]
      if (!snapshot) continue
      const rechargeRatio = station.rechargeRatio || 1
      for (const group of snapshot.groups) {
        const rateMultiplier = group.userRateMultiplier ?? group.rateMultiplier
        const effectiveMultiplier = effectiveMultiplierValue(rateMultiplier, rechargeRatio)
        const models = group.pricingModels && group.pricingModels.length > 0 ? group.pricingModels : [{ name: group.name }]
        for (const model of models) {
          const category = inferCategory(group, model.name)
            const tags = resolveGroupCapabilityTags(group, manualGroupTags[groupPreferenceKey(station.id, group.id)], model.name)
            const specialTags = groupSpecialTags(group)
          const effectiveInputPrice = typeof model.inputPrice === 'number' ? model.inputPrice * rateMultiplier / rechargeRatio : undefined
          const effectiveOutputPrice = typeof model.outputPrice === 'number' ? model.outputPrice * rateMultiplier / rechargeRatio : undefined
          const effectiveRequestPrice = typeof model.perRequestPrice === 'number' ? model.perRequestPrice * rateMultiplier / rechargeRatio : undefined
          const score = effectiveInputPrice ?? effectiveOutputPrice ?? effectiveRequestPrice
          rows.push({
            key: `${station.id}:${group.id}:${model.name}`,
            category,
              categoryLabel: categoryLabel(category),
              tags,
              specialTags,
            modelName: model.name,
            platform: group.platform,
            stationId: station.id,
            stationName: station.name,
            groupId: group.id,
            groupName: group.name,
            rateMultiplier,
            rechargeRatio,
            effectiveMultiplier,
            balance: snapshot.balance,
            health: snapshot.health,
            lastUpdatedAt: snapshot.lastUpdatedAt,
            effectiveInputPrice,
            effectiveOutputPrice,
            effectiveRequestPrice,
            rawInputPrice: model.inputPrice,
            rawOutputPrice: model.outputPrice,
            rawRequestPrice: model.perRequestPrice,
            score
          })
        }
      }
    }
    return rows
  }, [manualGroupTags, sourceStations, visibleSnapshots])
  const comparisonRows = useMemo(() => {
    return allComparisonRows.filter((row) => priceRankingStationIds.has(row.stationId))
  }, [allComparisonRows, priceRankingStationIds])
  const categoryCounts = useMemo(() => {
    const counts = new Map<CategoryId, number>()
    const countableRows = showHiddenGroups ? comparisonRows : comparisonRows.filter((row) => !hiddenGroupKeys.has(hiddenGroupKey(row)))
    counts.set('all', countableRows.length)
    for (const row of countableRows) counts.set(row.category, (counts.get(row.category) ?? 0) + 1)
    return counts
  }, [comparisonRows, hiddenGroupKeys, showHiddenGroups])
  const categoryRows = useMemo(() => {
    return selectedCategory === 'all' ? comparisonRows : comparisonRows.filter((row) => row.category === selectedCategory)
  }, [comparisonRows, selectedCategory])
  const tagOptions = useMemo(() => {
    const counts = new Map<GroupCapabilityTagId, number>()
    const countableRows = showHiddenGroups ? categoryRows : categoryRows.filter((row) => !hiddenGroupKeys.has(hiddenGroupKey(row)))
    for (const row of countableRows) {
      for (const tag of row.tags) counts.set(tag.id, (counts.get(tag.id) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([id, count]) => ({ id, label: groupTagLabel(id), count }))
      .sort((left, right) => {
        if (left.id === 'chat') return 1
        if (right.id === 'chat') return -1
        return right.count - left.count || left.label.localeCompare(right.label)
      })
  }, [categoryRows, hiddenGroupKeys, showHiddenGroups])
  const tagFilterTotalCount = useMemo(() => {
    const countableRows = showHiddenGroups ? categoryRows : categoryRows.filter((row) => !hiddenGroupKeys.has(hiddenGroupKey(row)))
    return countableRows.length
  }, [categoryRows, hiddenGroupKeys, showHiddenGroups])
  const taggedRows = useMemo(() => {
    return categoryRows.filter((row) => rowMatchesTagFilter(row, selectedTag))
  }, [categoryRows, selectedTag])
  const totalHiddenGroupCount = useMemo(() => countHiddenGroupsForRows(comparisonRows, hiddenGroupKeys), [comparisonRows, hiddenGroupKeys])
  const visibleFilterHiddenGroupCount = useMemo(() => countHiddenGroupsForRows(taggedRows, hiddenGroupKeys), [hiddenGroupKeys, taggedRows])
  const rankingFilterRows = useMemo(() => {
    return showHiddenGroups ? taggedRows : taggedRows.filter((row) => !hiddenGroupKeys.has(hiddenGroupKey(row)))
  }, [hiddenGroupKeys, showHiddenGroups, taggedRows])
  const searchedRankingRows = useMemo(() => {
    return rankingFilterRows.filter((row) => rowMatchesPriceSearch(row, priceSearchQuery))
  }, [priceSearchQuery, rankingFilterRows])
  const rankingChangeFilterCounts = useMemo(() => {
    return {
      all: rankingChangeFilterCount(searchedRankingRows, baseGroupChangeEvents, 'all'),
      'rate-up': rankingChangeFilterCount(searchedRankingRows, baseGroupChangeEvents, 'rate-up'),
      'rate-down': rankingChangeFilterCount(searchedRankingRows, baseGroupChangeEvents, 'rate-down')
    }
  }, [baseGroupChangeEvents, searchedRankingRows])
  const rankedRows = useMemo(() => {
    const changeFilteredRows = searchedRankingRows.filter((row) => rowMatchesRankingChangeFilter(row, baseGroupChangeEvents, rankingChangeFilter))
    return [...changeFilteredRows].sort((left, right) => compareRankingRows(left, right, rankingSort))
  }, [baseGroupChangeEvents, rankingChangeFilter, rankingSort, searchedRankingRows])
  const visibleStations = useMemo(() => {
    if (workspaceView === 'stations') return sourceStations
    if (selectedCategory === 'all' && selectedTag === 'all') return sourceStations
    const stationIds = new Set(rankedRows.map((row) => row.stationId))
    return sourceStations.filter((station) => stationIds.has(station.id))
  }, [rankedRows, selectedCategory, selectedTag, sourceStations, workspaceView])
  const ownStations = useMemo(() => {
    return sourceStations.filter((station) => isOwnStation(station, visibleSnapshots[station.id]))
  }, [sourceStations, visibleSnapshots])
  const thirdPartySourceStations = useMemo(() => {
    return sourceStations.filter((station) => isPriceRankingStation(station, visibleSnapshots[station.id]))
  }, [sourceStations, visibleSnapshots])
  const sourceWalletStations = useMemo(() => {
    const stations = sourceWalletView === 'own' ? ownStations : thirdPartySourceStations
    return [...stations].sort((left, right) => compareSourceWalletStations(left, right, visibleSnapshots, sourceWalletBalanceSort))
  }, [ownStations, sourceWalletBalanceSort, sourceWalletView, thirdPartySourceStations, visibleSnapshots])
  const selectedStation = sourceStations.find((station) => station.id === selectedId) ?? visibleStations[0] ?? sourceStations[0]
  const selectedSnapshot = selectedStation ? visibleSnapshots[selectedStation.id] : undefined
  const integrationStation = sourceStations.find((station) => station.id === selectedId) ?? sourceStations[0]

  useEffect(() => {
    let disposed = false
    void window.aizzz.preferences.get().then((preferences) => {
      if (disposed) return
      const legacyHiddenKeys = readHiddenGroupKeys()
      const legacyChangeEvents = readStoredGroupChangeEvents()
      const nextHiddenGroupKeys = preferences.hiddenGroupKeys.length > 0 ? preferences.hiddenGroupKeys : [...legacyHiddenKeys]
      const nextGroupChangeEvents = preferences.groupChangeEvents.length > 0 ? preferences.groupChangeEvents : legacyChangeEvents
      setHiddenGroupKeys(new Set(nextHiddenGroupKeys))
      setOperatingExcludedGroupKeys(new Set(preferences.operatingExcludedGroupKeys ?? []))
      setManualGroupTags(preferences.manualGroupTags ?? {})
      setAccountUpstreamMappings(preferences.accountUpstreamMappings ?? [])
      setAccountCostProfiles(preferences.accountCostProfiles ?? [])
      setInternalUserProfiles(preferences.internalUserProfiles ?? [])
      setTimeCostLedger(preferences.timeCostLedger ?? emptyTimeCostLedger())
      setGroupChangeEvents(nextGroupChangeEvents)
      setDismissedGroupChangeEventIds(new Set(preferences.dismissedGroupChangeEventIds ?? []))
      preferencesLoadedRef.current = true
      if (preferences.hiddenGroupKeys.length === 0 && nextHiddenGroupKeys.length > 0) {
        void window.aizzz.preferences.setHiddenGroupKeys(nextHiddenGroupKeys).catch(() => undefined)
      }
      if (preferences.groupChangeEvents.length === 0 && nextGroupChangeEvents.length > 0) {
        void window.aizzz.preferences.setGroupChangeEvents(nextGroupChangeEvents).catch(() => undefined)
      }
    }).catch(() => {
      if (disposed) return
      setHiddenGroupKeys(readHiddenGroupKeys())
      setOperatingExcludedGroupKeys(new Set())
      setManualGroupTags({})
      setAccountUpstreamMappings([])
      setAccountCostProfiles([])
      setInternalUserProfiles([])
      setTimeCostLedger(emptyTimeCostLedger())
      setGroupChangeEvents(readStoredGroupChangeEvents())
      setDismissedGroupChangeEventIds(new Set())
      preferencesLoadedRef.current = true
    })
    void window.aizzz.stations.list().then((next) => {
      if (disposed) return
      setStations(next)
      if (next[0]) setSelectedId(next[0].id)
    })
    void window.aizzz.stations.getSnapshots().then((next) => {
      if (disposed) return
      const snapshotMap = Object.fromEntries(next.map((snapshot) => [snapshot.stationId, snapshot]))
      previousSnapshotsRef.current = snapshotMap
      setSnapshots(snapshotMap)
      void window.aizzz.preferences.get().then((preferences) => {
        if (!disposed) setTimeCostLedger(preferences.timeCostLedger ?? emptyTimeCostLedger())
      }).catch(() => undefined)
    })
    const unsubscribe = window.aizzz.stations.onSnapshotsUpdated((next) => {
      if (disposed) return
      const snapshotMap = Object.fromEntries(next.map((snapshot) => [snapshot.stationId, snapshot]))
      previousSnapshotsRef.current = snapshotMap
      setSnapshots(snapshotMap)
      // Change detection is main-process owned. Fetching the persisted view
      // after the snapshot prevents startup empty states from becoming fake
      // "added" history in the renderer.
      void window.aizzz.preferences.get().then((preferences) => {
        if (disposed) return
        setGroupChangeEvents(preferences.groupChangeEvents ?? [])
        setTimeCostLedger(preferences.timeCostLedger ?? emptyTimeCostLedger())
      }).catch(() => undefined)
    })
    const unsubscribeStations = window.aizzz.stations.onStationsUpdated((next) => {
      if (!disposed) setStations(next)
    })
    const unsubscribeWindow = window.aizzz.window.onModeChanged((state) => {
      if (!disposed) {
        setMode(state.mode)
        setAlwaysOnTop(state.alwaysOnTop)
      }
    })
    return () => {
      disposed = true
      unsubscribe()
      unsubscribeStations()
      unsubscribeWindow()
    }
  }, [])

  useEffect(() => {
    if (workspaceView !== 'integration' || !integrationStation) return
    setIntegrationDraft(integrationDraftFromStation(integrationStation))
    setMappingPreview(null)
  }, [integrationStation?.id, workspaceView])

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('bubble-body', mode === 'bubble')
    return () => document.body.classList.remove('bubble-body')
  }, [mode])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4200)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!preferencesLoadedRef.current) return
    void window.aizzz.preferences.setHiddenGroupKeys([...hiddenGroupKeys]).catch(() => undefined)
  }, [hiddenGroupKeys])

  useEffect(() => {
    if (!preferencesLoadedRef.current) return
    void window.aizzz.preferences.setOperatingExcludedGroupKeys([...operatingExcludedGroupKeys]).catch(() => undefined)
  }, [operatingExcludedGroupKeys])

  useEffect(() => {
    if (!preferencesLoadedRef.current) return
    void window.aizzz.preferences.setManualGroupTags(manualGroupTags).catch(() => undefined)
  }, [manualGroupTags])

  useEffect(() => {
    if (!preferencesLoadedRef.current) return
    void window.aizzz.preferences.setAccountUpstreamMappings(accountUpstreamMappings).catch(() => undefined)
  }, [accountUpstreamMappings])

  useEffect(() => {
    if (!preferencesLoadedRef.current) return
    void window.aizzz.preferences.setAccountCostProfiles(accountCostProfiles).catch(() => undefined)
  }, [accountCostProfiles])

  useEffect(() => {
    if (!preferencesLoadedRef.current || groupChangeEvents.length === 0) return
    const summary = groupChangeNotificationSummary(groupChangeEvents, readLastGroupChangeNotificationAt())
    if (!summary.text || !summary.newestAt) return
    saveLastGroupChangeNotificationAt(summary.newestAt)
    setNotice({ kind: summary.rateUp > 0 ? 'warning' : 'success', text: summary.text })
    showSystemNotification('AIZZZWatch 分组倍率变动', summary.text)
  }, [groupChangeEvents])

  useEffect(() => {
    if (!preferencesLoadedRef.current) return
    void window.aizzz.preferences.setDismissedGroupChangeEventIds([...dismissedGroupChangeEventIds]).catch(() => undefined)
  }, [dismissedGroupChangeEventIds])

  useEffect(() => {
    if (workspaceView !== 'data') return
    void refreshDataCenterSummary()
  }, [workspaceView, stations.length, hiddenGroupKeys.size, operatingExcludedGroupKeys.size, manualGroupTags, groupChangeEvents.length, dismissedGroupChangeEventIds.size, accountUpstreamMappings.length, accountCostProfiles.length, internalUserProfiles.length])

  useEffect(() => {
    try {
      window.localStorage.setItem(accountRecommendationStrategyStorageKey, accountRecommendationStrategy)
    } catch {
      // Renderer-only convenience preference; failing to persist should not block account management.
    }
  }, [accountRecommendationStrategy])

  useEffect(() => {
    if (sourceWalletStations.some((station) => station.id === selectedId) || !sourceWalletStations[0]) return
    setSelectedId(sourceWalletStations[0].id)
  }, [selectedId, sourceWalletStations])

  useEffect(() => {
    setProfitReport(null)
    setProfitError(null)
    setProfitAccountId('all')
    setProfitSellingGroupId('all')
  }, [selectedConsoleStation?.id])

  useEffect(() => {
    setGroupSwitchQuery('')
    setGroupSwitchPlatform('all')
    const hasPreselectedTarget = Boolean(mutation && mutation.nextGroupIds.join(',') !== mutation.previousGroupIds.join(','))
    setGroupSwitchScope(hasPreselectedTarget ? 'all' : 'category')
  }, [mutation?.stationId, mutation?.accountId])

  useEffect(() => {
    setOpenGroupMenu(null)
  }, [selectedCategory, selectedTag, selectedId, workspaceView, showHiddenGroups, settingsOpen, mutation?.stationId, mutation?.accountId])

  useEffect(() => {
    if (!openGroupMenu) return
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!(event.target instanceof Element)) return
      if (event.target.closest('.group-row-menu, .group-menu-button')) return
      setOpenGroupMenu(null)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenGroupMenu(null)
    }
    window.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [openGroupMenu])

  const totals = useMemo(() => {
    const values = visibleStations.map((station) => visibleSnapshots[station.id])
    return {
      balance: values.reduce((sum, snapshot) => sum + (snapshot?.balance ?? 0), 0),
      healthy: values.filter((snapshot) => snapshot?.health === 'healthy').length,
      groups: values.reduce((sum, snapshot) => sum + (snapshot?.groups.length ?? 0), 0),
      latest: values.map((snapshot) => snapshot?.lastUpdatedAt).filter(Boolean).sort().at(-1)
    }
  }, [visibleSnapshots, visibleStations])
  const showRankingToolbar = mode === 'compact' || viewportWidth <= 620
  const newApiSettings = settingsForm.adapterType === 'newapi' || (settingsForm.adapterType === 'auto' && settingsForm.detectedAdapterType === 'newapi')
  const settingsStation = settingsForm.id ? stations.find((station) => station.id === settingsForm.id) : undefined
  const settingsHasSavedLoginCredentials = Boolean(settingsStation?.hasSavedLoginCredentials)
  const settingsCanConfigureAutoReauth = !settingsForm.clearSavedLoginCredentials && (settingsHasSavedLoginCredentials || Boolean(settingsForm.loginAccount.trim() && settingsForm.loginPassword))

  async function refreshDataCenterSummary() {
    setDataCenterLoading(true)
    setDataCenterError(null)
    try {
      const summary = await window.aizzz.dataCenter.getSummary()
      setDataCenterSummary(summary)
    } catch (error) {
      setDataCenterError(error instanceof Error ? error.message : '数据中心读取失败')
    } finally {
      setDataCenterLoading(false)
    }
  }

  async function refreshAll() {
    if (demoMode) {
      setRefreshing(true)
      await new Promise((resolve) => window.setTimeout(resolve, 420))
      setRefreshing(false)
      setNotice({ kind: 'success', text: '演示数据已刷新' })
      return
    }
    setRefreshing(true)
    try {
      await window.aizzz.stations.refresh()
      setNotice({ kind: 'success', text: '已完成刷新' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '刷新失败' })
    } finally {
      setRefreshing(false)
    }
  }

  function stationLoginInput(station: StationPublic): WebAuthInput {
    return {
      id: station.id,
      name: station.name,
      baseUrl: station.baseUrl,
      apiBaseUrl: station.apiBaseUrl,
      stationRole: station.stationRole,
      adapterType: station.adapterType,
      detectedAdapterType: station.detectedAdapterType,
      rechargeRatio: station.rechargeRatio,
      lowBalanceThreshold: station.lowBalanceThreshold,
      apiPaths: station.apiPaths,
      adminCredentialType: station.adminCredentialType,
      pollingIntervalMs: station.pollingIntervalMs
    }
  }

  async function retrySelectedStation() {
    if (!selectedStation) return
    if (selectedSnapshot?.health === 'forbidden' || selectedSnapshot?.errorCode === 'UNAUTHORIZED') {
      await authorizeStationFor(stationLoginInput(selectedStation))
      return
    }
    await window.aizzz.stations.refresh(selectedStation.id)
  }

  async function refreshSourceStation(station: StationPublic, kind: SourceStationAction['kind'] = 'refresh') {
    setSourceStationAction({ stationId: station.id, kind })
    try {
      if (demoMode) {
        await refreshAll()
      } else {
        await window.aizzz.stations.refresh(station.id)
        setNotice({ kind: 'success', text: `${station.name} 已${kind === 'retry' ? '重试' : '刷新'}` })
      }
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? `${station.name} ${kind === 'retry' ? '重试' : '刷新'}失败：${error.message}` : `${station.name} ${kind === 'retry' ? '重试' : '刷新'}失败` })
    } finally {
      setSourceStationAction((current) => current?.stationId === station.id && current.kind === kind ? null : current)
    }
  }

  async function retrySourceStation(station: StationPublic, snapshot?: StationSnapshot) {
    if (snapshot?.health === 'forbidden' || snapshot?.errorCode === 'UNAUTHORIZED') {
      setSourceStationAction({ stationId: station.id, kind: 'login' })
      try {
        await authorizeStationFor(stationLoginInput(station))
      } finally {
        setSourceStationAction((current) => current?.stationId === station.id && current.kind === 'login' ? null : current)
      }
      return
    }
    await refreshSourceStation(station, 'retry')
  }

  function updateIntegrationCapability(capability: StationReadCapability, update: (current: NonNullable<StationReadMapping['capabilities'][StationReadCapability]>) => NonNullable<StationReadMapping['capabilities'][StationReadCapability]>) {
    setIntegrationDraft((current) => {
      if (!current) return current
      const capabilityMapping = current.readMapping.capabilities[capability] ?? {}
      return {
        ...current,
        readMapping: {
          ...current.readMapping,
          capabilities: {
            ...current.readMapping.capabilities,
            [capability]: update(capabilityMapping)
          }
        }
      }
    })
  }

  async function previewIntegrationMapping() {
    if (!integrationStation || !integrationDraft) return
    setMappingPreviewing(true)
    try {
      const preview = await window.aizzz.stations.previewMapping({
        id: integrationStation.id,
        apiPaths: integrationDraft.apiPaths,
        readMapping: integrationDraft.readMapping
      })
      setMappingPreview(preview)
      setNotice({ kind: preview.capabilities.some((item) => item.state === 'ready') ? 'success' : 'warning', text: '读取映射检测已完成' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '读取映射检测失败' })
    } finally {
      setMappingPreviewing(false)
    }
  }

  async function saveIntegrationMapping() {
    if (!integrationStation || !integrationDraft) return
    setMappingSaving(true)
    try {
      const next = await window.aizzz.stations.save({
        id: integrationStation.id,
        name: integrationStation.name,
        baseUrl: integrationStation.baseUrl,
        apiBaseUrl: integrationStation.apiBaseUrl,
        stationRole: integrationStation.stationRole,
        adapterType: integrationStation.adapterType,
        detectedAdapterType: integrationStation.detectedAdapterType,
        rechargeRatio: integrationStation.rechargeRatio,
        lowBalanceThreshold: integrationStation.lowBalanceThreshold,
        adminCredentialType: integrationStation.adminCredentialType,
        pollingIntervalMs: integrationStation.pollingIntervalMs,
        apiPaths: integrationDraft.apiPaths,
        readMapping: integrationDraft.readMapping
      })
      setStations(next)
      const refreshed = await window.aizzz.stations.refresh(integrationStation.id)
      setSnapshots((current) => ({ ...current, ...Object.fromEntries(refreshed.map((snapshot) => [snapshot.stationId, snapshot])) }))
      setNotice({ kind: 'success', text: '接口适配已保存并完成刷新' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '接口适配保存失败' })
    } finally {
      setMappingSaving(false)
    }
  }

  function openEdit(station?: StationPublic) {
    setDiagnostics(null)
    setSettingsForm(station ? { id: station.id, name: station.name, baseUrl: station.baseUrl, apiBaseUrl: station.apiBaseUrl ?? '', stationRole: station.stationRole ?? (isOwnStation(station, visibleSnapshots[station.id]) ? 'own' : 'source'), adapterType: station.adapterType ?? 'sub2api', detectedAdapterType: station.detectedAdapterType, accessToken: '', refreshToken: '', adminToken: '', adminCredentialType: station.adminCredentialType ?? 'jwt', loginAccount: '', loginPassword: '', clearSavedLoginCredentials: false, autoReauthEnabled: station.autoReauthEnabled, pollingIntervalMs: station.pollingIntervalMs, rechargeRatio: station.rechargeRatio ?? 1, lowBalanceThreshold: station.lowBalanceThreshold ?? 10, apiPaths: station.apiPaths ?? {} } : { ...emptyForm, stationRole: sourceWalletView === 'own' ? 'own' : 'source' })
    setSettingsOpen(true)
  }

  async function runDiagnostics() {
    if (!settingsForm.baseUrl.trim()) {
      setNotice({ kind: 'error', text: '请先填写站点地址' })
      return
    }
    setDiagnosing(true)
    try {
      const result = await window.aizzz.stations.diagnose({
        id: settingsForm.id,
        name: settingsForm.name,
        baseUrl: settingsForm.baseUrl,
        apiBaseUrl: settingsForm.apiBaseUrl || undefined,
        adapterType: settingsForm.adapterType,
        accessToken: settingsForm.accessToken,
        refreshToken: settingsForm.refreshToken,
        adminToken: settingsForm.adminToken,
        adminCredentialType: settingsForm.adminCredentialType,
        apiPaths: settingsForm.apiPaths
      })
      setDiagnostics(result)
      if (Object.keys(result.suggestedPaths).length > 0) {
        setSettingsForm((current) => ({
          ...current,
          detectedAdapterType: result.detectedAdapterType ?? current.detectedAdapterType,
          apiPaths: { ...current.apiPaths, ...result.suggestedPaths }
        }))
      }
      setNotice({ kind: 'success', text: result.detectedAdapterType === 'newapi' ? '已识别为 NewAPI 站点；只启用已确认的只读能力' : result.apiVariant === 'standard' ? '已识别为标准 Sub2API 站点' : result.apiVariant === 'fork' ? '已识别为二开或自定义站点' : '诊断完成，请选择匹配的站点类型' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '诊断失败' })
    } finally {
      setDiagnosing(false)
    }
  }

  function applySuggestedPaths() {
    if (!diagnostics) return
    setSettingsForm((current) => ({
      ...current,
      apiPaths: { ...current.apiPaths, ...diagnostics.suggestedPaths }
    }))
  }

  async function authorizeStationFor(input: WebAuthInput) {
    if (!input.name.trim() || !input.baseUrl.trim()) {
      setNotice({ kind: 'error', text: '请先填写站点名称和地址' })
      return
    }
    setAuthorizing(true)
    try {
      const next = await window.aizzz.auth.login(input)
      setStations(next)
      const station = next.find((item) => item.id === input.id) ?? next.find((item) => item.name === input.name) ?? next.at(-1)
      if (station) setSelectedId(station.id)
      setSettingsOpen(false)
      setNotice({ kind: 'success', text: '网页登录授权成功，正在同步' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error && error.message === 'AUTH_CANCELLED' ? '已取消网页登录授权' : error instanceof Error ? error.message : '网页登录授权失败' })
    } finally {
      setAuthorizing(false)
    }
  }

  async function authorizeStation(useSavedLoginCredentials = false) {
    await authorizeStationFor({
      id: settingsForm.id,
      name: settingsForm.name,
      baseUrl: settingsForm.baseUrl,
      apiBaseUrl: settingsForm.apiBaseUrl || undefined,
      stationRole: settingsForm.stationRole,
      adapterType: settingsForm.adapterType,
      detectedAdapterType: settingsForm.detectedAdapterType,
      rechargeRatio: settingsForm.rechargeRatio,
      lowBalanceThreshold: settingsForm.lowBalanceThreshold,
      apiPaths: settingsForm.apiPaths,
      adminCredentialType: settingsForm.adminCredentialType,
      pollingIntervalMs: settingsForm.pollingIntervalMs,
      useSavedLoginCredentials
    })
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      const next = await window.aizzz.stations.save(settingsForm as StationInput)
      setStations(next)
      setSelectedId(settingsForm.id ?? next.at(-1)?.id ?? '')
      setSettingsOpen(false)
      setNotice({ kind: 'success', text: '站点配置已保存，正在同步' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  async function removeSelected(station: StationPublic) {
    if (!window.confirm(`确定移除“${station.name}”？本地令牌也会被删除。`)) return
    try {
      const next = await window.aizzz.stations.remove(station.id)
      setStations(next)
      setSelectedId(next[0]?.id ?? 'demo-primary')
      setNotice({ kind: 'success', text: '站点已移除' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '移除失败' })
    }
  }

  async function confirmMutation() {
    if (!mutation) return
    const nextQueuedMutation = mutationQueue[0]
    const remainingQueue = mutationQueue.slice(1)
    setMutating(true)
    setMutationError(null)
    try {
      const successText = groupSwitchSuccessText(mutation.accountName, currentSwitchPreview?.nextLabel ?? '目标分组')
      if (demoMode) {
        setNotice({ kind: 'success', text: `演示：${successText}` })
      } else {
        const nextSnapshot = await window.aizzz.admin.updateAccountGroups(mutation)
        setSnapshots((current) => {
          const next = mergeSnapshotMap(current, nextSnapshot)
          previousSnapshotsRef.current = next
          return next
        })
        setSelectedId(nextSnapshot.stationId)
        setNotice(groupSwitchCompletionNotice(mutation.accountName, currentSwitchPreview?.nextLabel ?? '目标分组', nextSnapshot))
      }
      recordMutationResult(mutation, 'success', currentSwitchPreview?.nextLabel ?? '目标分组')
      if (nextQueuedMutation) {
        setMutationQueue(remainingQueue)
        setMutation(nextQueuedMutation)
        setSelectedId(nextQueuedMutation.stationId)
        setFocusedAccountKey(accountFocusKey(nextQueuedMutation.stationId, nextQueuedMutation.accountId))
        setGroupSwitchQuery('')
        setGroupSwitchPlatform('all')
        setGroupSwitchScope('all')
      } else {
        setMutationQueue([])
        setMutation(null)
        setBatchQueueActive(false)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '切组失败，可重试'
      recordMutationResult(mutation, 'failed', currentSwitchPreview?.nextLabel ?? '目标分组', message)
      setMutationError(message)
      setNotice({ kind: 'error', text: message })
    } finally {
      setMutating(false)
    }
  }

  async function changeMode(nextMode: WindowMode) {
    setMode(nextMode)
    await window.aizzz.window.setMode(nextMode)
  }

  async function togglePin() {
    const result = await window.aizzz.window.toggleAlwaysOnTop()
    setAlwaysOnTop(result.alwaysOnTop)
  }

  const adminStations = useMemo(() => {
    return visibleStations
      .map((station) => ({ station, snapshot: visibleSnapshots[station.id] }))
      .filter(({ station, snapshot }) => isAdminManagedStation(station, snapshot))
  }, [visibleSnapshots, visibleStations])
  const adminAccountCount = useMemo(() => adminStations.reduce((sum, item) => sum + (item.snapshot?.accounts.length ?? 0), 0), [adminStations])
  const effectiveAccountUpstreamMappings = useMemo(() => {
    const manualKeys = new Set(accountUpstreamMappings.map((mapping) => accountUpstreamMappingKey(mapping.accountStationId, mapping.accountId)))
    const inferred: AccountUpstreamMapping[] = []
    for (const { station, snapshot } of adminStations) {
      for (const account of snapshot?.accounts ?? []) {
        const key = accountUpstreamMappingKey(station.id, account.id)
        if (manualKeys.has(key)) continue
        const mapping = inferAccountUpstreamMapping(station.id, account, thirdPartySourceStations, visibleSnapshots)
        // A main-process credential fingerprint is the only automatic proof.
        if (mapping?.updatedAt === 'credential-match') inferred.push(mapping)
      }
    }
    return [...accountUpstreamMappings, ...inferred]
  }, [accountUpstreamMappings, adminStations, thirdPartySourceStations, visibleSnapshots])
  const activeUpstreamUsageByGroup = useMemo(() => {
    const accountNames = new Map<string, { stationName: string; accountName: string }>()
    for (const station of sourceStations) {
      if (!isOwnStation(station, visibleSnapshots[station.id])) continue
      const snapshot = visibleSnapshots[station.id]
      if (snapshot?.health !== 'healthy') continue
      for (const account of snapshot.accounts) {
        if (!accountCanRecommend(account)) continue
        accountNames.set(accountUpstreamMappingKey(station.id, account.id), { stationName: station.name, accountName: account.name })
      }
    }
    const usagesByGroup = new Map<string, Array<{ stationName: string; accountName: string }>>()
    for (const usage of activeUpstreamGroupUsages(effectiveAccountUpstreamMappings, visibleSnapshots)) {
      const account = accountNames.get(accountUpstreamMappingKey(usage.accountStationId, usage.accountId))
      if (!account) continue
      const groupKey = `${usage.sourceStationId}:${usage.sourceGroupId}`
      const current = usagesByGroup.get(groupKey) ?? []
      if (!current.some((item) => item.stationName === account.stationName && item.accountName === account.accountName)) current.push(account)
      usagesByGroup.set(groupKey, current)
    }
    return usagesByGroup
  }, [effectiveAccountUpstreamMappings, sourceStations, visibleSnapshots])
  const activeUpstreamUsageGroupCount = activeUpstreamUsageByGroup.size
  const displayedRankedRows = useMemo(() => {
    const isInUse = (row: ComparisonRow) => activeUpstreamUsageByGroup.has(`${row.stationId}:${row.groupId}`)
    return rankedRows.filter((row) => rankingUsageFilter === 'in-use' ? isInUse(row) : !isInUse(row))
  }, [activeUpstreamUsageByGroup, rankedRows, rankingUsageFilter])
  const accountMappingByKey = useMemo(() => new Map(effectiveAccountUpstreamMappings.map((mapping) => [accountUpstreamMappingKey(mapping.accountStationId, mapping.accountId), mapping])), [effectiveAccountUpstreamMappings])
  const accountCostProfileByKey = useMemo(() => new Map(accountCostProfiles.map((profile) => [accountUpstreamMappingKey(profile.accountStationId, profile.accountId), profile])), [accountCostProfiles])
  const accountPlatformOptions = useMemo(() => accountWorkbenchPlatformOptions(adminStations), [adminStations])
  const accountGroupFilterOptions = useMemo(() => accountWorkbenchGroupFilterOptions(adminStations), [adminStations])
  useEffect(() => {
    if (accountPlatformFilter !== 'all' && !accountPlatformOptions.includes(accountPlatformFilter)) setAccountPlatformFilter('all')
  }, [accountPlatformFilter, accountPlatformOptions])
  useEffect(() => {
    if (accountGroupFilter !== 'all' && !accountGroupFilterOptions.some((option) => option.id === accountGroupFilter)) setAccountGroupFilter('all')
  }, [accountGroupFilter, accountGroupFilterOptions])
  const profitRows = useMemo(() => buildAccountGroupProfitRows(adminStations, sourceStations, visibleSnapshots, effectiveAccountUpstreamMappings, accountCostProfiles, timeCostLedger), [accountCostProfiles, effectiveAccountUpstreamMappings, adminStations, sourceStations, timeCostLedger, visibleSnapshots])
  const operatingProfitRows = useMemo(() => profitRows.filter((row) => !operatingExcludedGroupKeys.has(groupPreferenceKey(row.station.id, row.group.id))), [operatingExcludedGroupKeys, profitRows])
  const timeCostLedgerSummary = useMemo(() => summarizeTemporalUsageCosts(timeCostLedger), [timeCostLedger])
  const selectedUsageCoverage = useMemo(
    () => selectedConsoleStation ? timeCostLedger.usageCoverage.find((item) => item.accountStationId === selectedConsoleStation.id) : undefined,
    [selectedConsoleStation, timeCostLedger]
  )
  const visibleProfitRows = useMemo(() => {
    const keyword = accountSearchQuery.trim().toLowerCase()
    return profitRows.filter((row) => {
      const matchesKeyword = !keyword || [
        row.station.name,
        row.account.name,
        row.group.name,
        row.group.platform,
        row.sourceStation?.name,
        row.sourceGroup?.name,
        row.mapping?.sourceKeyLabel,
        accountCostKindLabel(row.costKind),
        row.costProfile?.note
      ].filter(Boolean).join(' ').toLowerCase().includes(keyword)
      const matchesStatus = costStatusFilter === 'all' || row.status === costStatusFilter
      const matchesKind = costKindFilter === 'all'
        || (costKindFilter === 'unset' ? !row.costProfile : row.costKind === costKindFilter)
      const matchesBaseRate = !costBaseRateOnly || row.baseRateNeedsUpdate
      return matchesKeyword && matchesStatus && matchesKind && matchesBaseRate
    })
  }, [accountSearchQuery, costBaseRateOnly, costKindFilter, costStatusFilter, profitRows])
  const visibleProfitAccountGroups = useMemo(() => sortAccountProfitGroups(groupProfitRowsByAccount(visibleProfitRows), costSortMode), [costSortMode, visibleProfitRows])
  const visibleSellingGroupProfitGroups = useMemo(() => sortSellingGroupProfitGroups(groupProfitRowsBySellingGroup(visibleProfitRows), costSortMode), [costSortMode, visibleProfitRows])
  const profitRiskCounts = useMemo(() => {
    return operatingProfitRows.reduce<Record<ProfitRiskStatus, number>>((counts, row) => {
      counts[row.status] += 1
      return counts
    }, { profitable: 0, 'near-loss': 0, loss: 0, unmapped: 0, stale: 0, exempt: 0 })
  }, [operatingProfitRows])
  const visibleProfitAccountCount = visibleProfitAccountGroups.length
  const visibleSellingGroupCount = visibleSellingGroupProfitGroups.length
  const baseRateUpdateCount = useMemo(() => new Set(operatingProfitRows.filter((row) => row.baseRateNeedsUpdate).map((row) => accountUpstreamMappingKey(row.station.id, row.account.id))).size, [operatingProfitRows])
  const adminConsoleDashboard = adminRecordArray(selectedConsoleSnapshot?.adminConsole?.dashboard)
  const adminConsoleUsers = adminRecordArray(selectedConsoleSnapshot?.adminConsole?.users)
  const adminConsoleChannels = adminRecordArray(selectedConsoleSnapshot?.adminConsole?.channels)
  const adminConsolePlatforms = adminRecordArray(selectedConsoleSnapshot?.adminConsole?.platforms)
  const adminConsoleUsage = adminRecordArray(selectedConsoleSnapshot?.adminConsole?.usage)
  const adminConsoleSettings = adminRecordArray(selectedConsoleSnapshot?.adminConsole?.settings)
  const selectedUsageDiagnostic = useMemo(() => analyzeUsageCapability({
    usageRecords: adminConsoleUsage,
    accounts: selectedConsoleSnapshot?.accounts ?? []
  }), [adminConsoleUsage, selectedConsoleSnapshot])
  const selectedConsoleTitle = stationConsoleTitle(stationConsoleTab)
  const selectedConsoleStationRows = useMemo(
    () => selectedConsoleStation ? allComparisonRows.filter((row) => row.stationId === selectedConsoleStation.id) : [],
    [allComparisonRows, selectedConsoleStation]
  )

  const mutationStation = mutation ? sourceStations.find((station) => station.id === mutation.stationId) : selectedStation
  const mutationSnapshot = mutation ? visibleSnapshots[mutation.stationId] : selectedSnapshot
  const mappingEditorAccountStation = mappingEditor ? sourceStations.find((station) => station.id === mappingEditor.accountStationId) : undefined
  const mappingEditorSnapshot = mappingEditor ? visibleSnapshots[mappingEditor.accountStationId] : undefined
  const mappingEditorAccount = mappingEditor ? mappingEditorSnapshot?.accounts.find((account) => account.id === mappingEditor.accountId) : undefined
  const costProfileEditorAccountStation = costProfileEditor ? sourceStations.find((station) => station.id === costProfileEditor.accountStationId) : undefined
  const costProfileEditorSnapshot = costProfileEditor ? visibleSnapshots[costProfileEditor.accountStationId] : undefined
  const costProfileEditorAccount = costProfileEditor ? costProfileEditorSnapshot?.accounts.find((account) => account.id === costProfileEditor.accountId) : undefined
  const mappingEditorSourceStation = mappingEditor ? sourceStations.find((station) => station.id === mappingEditor.sourceStationId) : undefined
  const mappingEditorSourceKeys = mappingEditorSourceStation ? visibleSnapshots[mappingEditorSourceStation.id]?.sourceKeys ?? [] : []
  const mappingEditorSourceGroups = mappingEditorSourceStation ? visibleSnapshots[mappingEditorSourceStation.id]?.groups ?? [] : []
  const mappingEditorSelectedSourceKey = mappingEditor?.sourceKeyId
    ? mappingEditorSourceKeys.find((key) => key.id === mappingEditor.sourceKeyId)
    : undefined
  const mappingEditorSelectedKeyGroupIds = mappingEditorSelectedSourceKey
    ? [...new Set(mappingEditorSelectedSourceKey.groupIds.filter((id) => Number.isInteger(id) && id > 0))]
    : []
  const mappingEditorVisibleSourceGroups = mappingEditorSelectedSourceKey
    ? mappingEditorSourceGroups.filter((group) => mappingEditorSelectedKeyGroupIds.includes(group.id))
    : mappingEditorSourceGroups
  const mappingEditorSourceOptions = sourceStations.filter((station) => station.id !== mappingEditor?.accountStationId && isPriceRankingStation(station, visibleSnapshots[station.id]))
  const mappingEditorSourceChoices = mappingEditorSourceOptions.length > 0
    ? mappingEditorSourceOptions
    : sourceStations.filter((station) => station.id !== mappingEditor?.accountStationId)
  const groupSwitchCandidates = groupSwitchCandidateGroups(mutationSnapshot?.groups ?? [], selectedCategory, groupSwitchScope)
    .filter((group) => !mutationStation || !hiddenGroupKeys.has(groupPreferenceKey(mutationStation.id, group.id)))
    .filter((group) => groupMatchesTagFilter(group, selectedTag, mutationStation ? manualGroupTags[groupPreferenceKey(mutationStation.id, group.id)] : undefined))
  const groupSwitchOptions = sortedGroupSwitchOptions(groupSwitchCandidates, mutationStation?.rechargeRatio ?? 1)
  const groupSwitchPlatforms = groupSwitchPlatformOptions(groupSwitchOptions)
  const visibleGroupSwitchOptions = filterGroupSwitchOptions(groupSwitchOptions, groupSwitchQuery, groupSwitchPlatform)
  const currentSwitchPreview = mutation ? groupSwitchPreview(mutationSnapshot?.groups ?? [], mutation.previousGroupIds, mutation.nextGroupIds, mutationStation?.rechargeRatio ?? 1) : undefined

  function accountMinimumSafeEffectiveMultiplier(station: StationPublic, account: AccountSnapshot): number | undefined {
    const accountKey = accountUpstreamMappingKey(station.id, account.id)
    const costProfile = accountCostProfileByKey.get(accountKey)
    const profileMultiplier = profileCostMultiplier(costProfile)
    if (typeof profileMultiplier === 'number' && Number.isFinite(profileMultiplier)) return profileMultiplier
    const mapping = accountMappingByKey.get(accountKey)
    const sourceStation = mapping ? sourceStations.find((item) => item.id === mapping.sourceStationId) : undefined
    const sourceResolution = resolveAccountUpstreamMappingSource(mapping, mapping ? visibleSnapshots[mapping.sourceStationId] : undefined)
    const sourceGroup = sourceResolution.group
    const upstreamRate = sourceGroup ? sourceGroup.userRateMultiplier ?? sourceGroup.rateMultiplier : undefined
    const upstreamEffectiveMultiplier = sourceStation && typeof upstreamRate === 'number'
      ? effectiveMultiplierValue(upstreamRate, sourceStation.rechargeRatio)
      : undefined
    if (sourceResolution.state !== 'key-multiple-groups' && typeof upstreamEffectiveMultiplier === 'number' && Number.isFinite(upstreamEffectiveMultiplier)) return upstreamEffectiveMultiplier
    return accountSafetyEffectiveMultiplier(account, station)
  }

  function accountRecommendationFor(station: StationPublic, snapshot: StationSnapshot | undefined, account: AccountSnapshot): (AccountGroupRecommendation & { scopeLabel: string }) | undefined {
    if (!accountCanRecommend(account)) return undefined
    const groups = snapshot?.groups ?? []
    const currentIds = new Set(account.groupIds)
    const useAllStationStrategy = accountRecommendationStrategy === 'all-station'
    const accountCategory = inferAccountCategory(account)
    const visibleGroups = groups.filter((group) => {
      const key = groupPreferenceKey(station.id, group.id)
      return !hiddenGroupKeys.has(key)
        && groupMatchesAccountCategory(group, accountCategory)
        && groupMatchesTagFilter(group, selectedTag, manualGroupTags[key])
    })
    const currentOptions = accountCurrentGroupOptions(groups, account.groupIds, station.rechargeRatio)
    const currentEffectiveMultiplier = currentOptions.length === 1
      ? currentOptions[0].effectiveMultiplier
      : currentOptions.length > 1
        ? Math.min(...currentOptions.map((option) => option.effectiveMultiplier))
        : undefined
    const safetyEffectiveMultiplier = accountMinimumSafeEffectiveMultiplier(station, account)
    const scopedGroups = groupSwitchCandidateGroups(
      visibleGroups,
      useAllStationStrategy ? 'all' : selectedCategory,
      useAllStationStrategy || selectedCategory === 'all' ? 'all' : 'category'
    )
      .filter((group) => !currentIds.has(group.id))
    const fallbackGroups = selectedCategory === 'all' || useAllStationStrategy
      ? []
      : groupSwitchCandidateGroups(visibleGroups, 'all', 'all').filter((group) => !currentIds.has(group.id))
    const option = safeGroupSwitchOptions(scopedGroups, station.rechargeRatio, safetyEffectiveMultiplier)[0] ?? safeGroupSwitchOptions(fallbackGroups, station.rechargeRatio, safetyEffectiveMultiplier)[0]
    if (!option) return undefined
    const scopeLabel = scopedGroups.some((group) => group.id === option.group.id)
      ? useAllStationStrategy ? '全站最低' : selectedCategory === 'all' ? '全部分组' : categoryLabel(selectedCategory)
      : '全部分组'
    return {
      option,
      currentEffectiveMultiplier,
      safetyEffectiveMultiplier,
      scopeLabel,
      safeForAccount: typeof safetyEffectiveMultiplier === 'number' && Number.isFinite(safetyEffectiveMultiplier)
        ? option.effectiveMultiplier >= safetyEffectiveMultiplier - 0.0005
        : true
    }
  }

  function applyCostStatusQuickFilter(status: ProfitRiskStatus) {
    setStationConsoleTab('protection')
    setCostStatusFilter(status)
    setCostBaseRateOnly(false)
    setCostKindFilter('all')
  }

  function applyBaseRateQuickFilter() {
    setStationConsoleTab('protection')
    setCostStatusFilter('all')
    setCostBaseRateOnly(true)
    setCostKindFilter('all')
  }

  function clearCostQuickFilters() {
    setCostStatusFilter('all')
    setCostBaseRateOnly(false)
  }

  async function loadProfitIntervalReport() {
    if (!selectedConsoleStation) {
      setProfitError('请先添加一个带管理员权限的我的站点')
      return
    }
    if (demoMode) {
      setProfitError('演示模式没有真实管理员用量明细，请在桌面端添加管理员站点后核算')
      setProfitReport(null)
      return
    }
    if (profitEndDate < profitStartDate) {
      setProfitError('结束日期不能早于开始日期')
      return
    }
    setProfitLoading(true)
    setProfitError(null)
    try {
      const report = await window.aizzz.profit.load({
        stationId: selectedConsoleStation.id,
        startAt: new Date(`${profitStartDate}T00:00:00+08:00`).toISOString(),
        endAt: new Date(`${shiftShanghaiDate(profitEndDate, 1)}T00:00:00+08:00`).toISOString(),
        timezone: 'Asia/Shanghai',
        granularity: profitGranularity,
        accountId: profitAccountId === 'all' ? undefined : Number(profitAccountId),
        sellingGroupId: profitSellingGroupId === 'all' ? undefined : Number(profitSellingGroupId)
      })
      setProfitReport(report)
      if (report.coverage.state === 'complete') setNotice({ kind: 'success', text: '收益区间核算完成' })
      else setNotice({ kind: 'warning', text: profitCoverageLabel(report) })
    } catch (error) {
      setProfitReport(null)
      setProfitError(error instanceof Error ? error.message : '收益核算失败')
    } finally {
      setProfitLoading(false)
    }
  }

  async function archiveProfitInterval(force = false) {
    if (!selectedConsoleStation) {
      setProfitError('请先添加一个带管理员权限的我的站点')
      return
    }
    if (demoMode) {
      setProfitError('演示模式不能归档真实管理员用量')
      return
    }
    if (profitEndDate < profitStartDate) {
      setProfitError('结束日期不能早于开始日期')
      return
    }
    setProfitArchiving(true)
    setProfitError(null)
    try {
      const coverage = await window.aizzz.profit.archive({
        stationId: selectedConsoleStation.id,
        startAt: new Date(`${profitStartDate}T00:00:00+08:00`).toISOString(),
        endAt: new Date(`${shiftShanghaiDate(profitEndDate, 1)}T00:00:00+08:00`).toISOString(),
        timezone: 'Asia/Shanghai',
        granularity: profitGranularity
      }, { force })
      const partialDays = coverage.filter((item) => item.state !== 'complete').length
      setNotice({ kind: partialDays > 0 ? 'warning' : 'success', text: partialDays > 0 ? `${force ? '重新归档完成' : '归档完成'}，但有 ${partialDays} 天不完整` : `${force ? '已重新归档' : '已归档'} ${coverage.length} 天用量` })
      await loadProfitIntervalReport()
    } catch (error) {
      setProfitError(error instanceof Error ? error.message : '收益归档失败')
    } finally {
      setProfitArchiving(false)
    }
  }

  async function toggleInternalUserProfile(stationId: string, userId: number) {
    const key = `${stationId}:${userId}`
    const isInternal = internalUserProfiles.some((profile) => `${profile.accountStationId}:${profile.userId}` === key)
    const next = isInternal
      ? internalUserProfiles.filter((profile) => `${profile.accountStationId}:${profile.userId}` !== key)
      : [...internalUserProfiles, { accountStationId: stationId, userId, updatedAt: new Date().toISOString() }]
    try {
      const saved = await window.aizzz.preferences.setInternalUserProfiles(next)
      setInternalUserProfiles(saved.internalUserProfiles ?? next)
      setNotice({ kind: 'success', text: isInternal ? `已恢复用户 #${userId} 的经营核算` : `用户 #${userId} 已标记为内部自用，不计入经营核算` })
      if (profitReport?.query.stationId === stationId) await loadProfitIntervalReport()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '保存内部自用用户失败' })
    }
  }

  function previewSourceMappingsFromSnapshots() {
    if (rebuildingMappings) return
    const result = rebuildAccountUpstreamMappings(
      accountUpstreamMappings,
      adminStations,
      thirdPartySourceStations,
      visibleSnapshots
    )
    if (result.scanned === 0) {
      setNotice({ kind: 'warning', text: '当前没有可扫描的我的站点账号。' })
      return
    }
    if (thirdPartySourceStations.length === 0) {
      setNotice({ kind: 'warning', text: '当前没有三方站点，无法重建来源绑定。' })
      return
    }
    if (result.added === 0) {
      setNotice({ kind: 'warning', text: `已扫描 ${result.scanned} 个账号，没有找到可唯一匹配的来源关系；已有绑定 ${result.skippedExisting} 个未覆盖。请查看每个账号的来源状态。` })
      return
    }
    setMappingRebuildPreview({
      mappings: result.mappings,
      candidates: result.candidates,
      scanned: result.scanned,
      skippedExisting: result.skippedExisting
    })
  }

  async function confirmSourceMappingRebuild() {
    if (!mappingRebuildPreview || rebuildingMappings) return
    setRebuildingMappings(true)
    try {
      setAccountUpstreamMappings(mappingRebuildPreview.mappings)
      await window.aizzz.preferences.setAccountUpstreamMappings(mappingRebuildPreview.mappings)
      setNotice({ kind: 'success', text: `已确认 ${mappingRebuildPreview.candidates.length} 条自动来源关系；已有 ${mappingRebuildPreview.skippedExisting} 条绑定未覆盖。` })
      setMappingRebuildPreview(null)
      setCostStatusFilter('all')
      setCostBaseRateOnly(false)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '保存来源关联失败' })
    } finally {
      setRebuildingMappings(false)
    }
  }

  function openAccountMappingEditor(station: StationPublic, account: AccountSnapshot) {
    const current = accountUpstreamMappings.find((mapping) => mapping.accountStationId === station.id && mapping.accountId === account.id)
      ?? accountMappingByKey.get(accountUpstreamMappingKey(station.id, account.id))
    const inferred = current ? undefined : inferAccountUpstreamMapping(station.id, account, thirdPartySourceStations, visibleSnapshots)
    const initialMapping = current ?? inferred
    const fallbackSourceStation = initialMapping?.sourceStationId ? sourceStations.find((sourceStation) => sourceStation.id === initialMapping.sourceStationId) : thirdPartySourceStations[0] ?? sourceStations.find((sourceStation) => sourceStation.id !== station.id)
    const fallbackGroups = fallbackSourceStation ? visibleSnapshots[fallbackSourceStation.id]?.groups ?? [] : []
    setMappingEditor({
      accountStationId: station.id,
      accountId: account.id,
      sourceStationId: initialMapping?.sourceStationId ?? fallbackSourceStation?.id ?? '',
      sourceKeyId: initialMapping?.sourceKeyId ?? '',
      sourceGroupId: initialMapping?.sourceGroupId ?? fallbackGroups[0]?.id ?? '',
      sourceKeyLabel: initialMapping?.sourceKeyLabel ?? ''
    })
  }

  function saveAccountMapping() {
    if (!mappingEditor || !mappingEditor.sourceStationId || typeof mappingEditor.sourceGroupId !== 'number') {
      setNotice({ kind: 'warning', text: '请选择来源站点和来源分组后再保存关联。' })
      return
    }
    const sourceSnapshot = visibleSnapshots[mappingEditor.sourceStationId]
    const sourceKey = mappingEditor.sourceKeyId ? sourceSnapshot?.sourceKeys?.find((key) => key.id === mappingEditor.sourceKeyId) : undefined
    if ((sourceSnapshot?.sourceKeys?.length ?? 0) > 0 && !sourceKey) {
      setNotice({ kind: 'warning', text: '该来源站已读取到上游密钥，请选择对应密钥后再保存。' })
      return
    }
    if (sourceKey && !sourceKey.groupIds.includes(mappingEditor.sourceGroupId)) {
      setNotice({ kind: 'warning', text: '请选择该上游密钥当前所属的分组作为保护口径。' })
      return
    }
    const sourceKeyLabelInput = mappingEditor.sourceKeyLabel.trim()
    if (looksLikeSecretLabel(sourceKeyLabelInput)) {
      setNotice({ kind: 'error', text: '密钥备注看起来像完整密钥/JWT，请改成脱敏名称后再保存。' })
      return
    }
    const nextMapping: AccountUpstreamMapping = {
      accountStationId: mappingEditor.accountStationId,
      accountId: mappingEditor.accountId,
      sourceStationId: mappingEditor.sourceStationId,
      sourceGroupId: mappingEditor.sourceGroupId,
      sourceKeyId: sourceKey?.id ?? (mappingEditor.sourceKeyId.trim() || undefined),
      sourceKeyLabel: sourceKey ? sourceKeyLabel(sourceKey, 0) : sourceKeyLabelInput || undefined,
      updatedAt: new Date().toISOString()
    }
    setAccountUpstreamMappings((current) => [
      nextMapping,
      ...current.filter((mapping) => mapping.accountStationId !== nextMapping.accountStationId || mapping.accountId !== nextMapping.accountId)
    ])
    setMappingEditor(null)
    setNotice({ kind: 'success', text: sourceKey ? '已关联上游密钥；后续单分组变更会自动跟随。' : '已保存旧版来源分组绑定；不会保存密钥原文。' })
  }

  function clearAccountMapping() {
    if (!mappingEditor) return
    setAccountUpstreamMappings((current) => current.filter((mapping) => mapping.accountStationId !== mappingEditor.accountStationId || mapping.accountId !== mappingEditor.accountId))
    setMappingEditor(null)
    setNotice({ kind: 'success', text: '已清除这个账号的上游映射。' })
  }

  function openAccountCostProfileEditor(station: StationPublic, account: AccountSnapshot) {
    const current = accountCostProfiles.find((profile) => profile.accountStationId === station.id && profile.accountId === account.id)
    setCostProfileEditor({
      accountStationId: station.id,
      accountId: account.id,
      kind: current?.kind ?? 'upstream-metered',
      fixedCostAmount: typeof current?.fixedCostAmount === 'number' ? String(current.fixedCostAmount) : '',
      cycleDays: typeof current?.cycleDays === 'number' ? String(current.cycleDays) : '30',
      variableCostMultiplier: typeof current?.variableCostMultiplier === 'number' ? String(current.variableCostMultiplier) : '',
      note: current?.note ?? ''
    })
  }

  function optionalCostNumber(value: string, max = 1_000_000): number | undefined {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed) || parsed < 0) return undefined
    return Math.min(parsed, max)
  }

  function saveAccountCostProfile() {
    if (!costProfileEditor) return
    const note = costProfileEditor.note.trim()
    if (looksLikeSecretLabel(note)) {
      setNotice({ kind: 'error', text: '成本备注看起来像完整密钥/JWT，请改成脱敏说明后再保存。' })
      return
    }
    if (costProfileEditor.kind === 'upstream-metered') {
      setAccountCostProfiles((current) => current.filter((profile) => profile.accountStationId !== costProfileEditor.accountStationId || profile.accountId !== costProfileEditor.accountId))
      setCostProfileEditor(null)
      setNotice({ kind: 'success', text: '已恢复为“三方按量”默认成本模式；原上游映射会继续保留。' })
      return
    }
    const fixedCostAmount = optionalCostNumber(costProfileEditor.fixedCostAmount)
    const cycleDays = optionalCostNumber(costProfileEditor.cycleDays, 366)
    const variableCostMultiplier = optionalCostNumber(costProfileEditor.variableCostMultiplier)
    const isCostExempt = costProfileEditor.kind === 'self-owned-exempt'
    const nextProfile: AccountCostProfile = {
      accountStationId: costProfileEditor.accountStationId,
      accountId: costProfileEditor.accountId,
      kind: costProfileEditor.kind,
      fixedCostAmount: isCostExempt ? undefined : fixedCostAmount,
      cycleDays: isCostExempt ? undefined : fixedCostAmount !== undefined ? cycleDays ?? 30 : cycleDays,
      variableCostMultiplier: isCostExempt ? undefined : variableCostMultiplier,
      note: note ? note.slice(0, 120) : undefined,
      updatedAt: new Date().toISOString()
    }
    setAccountCostProfiles((current) => [
      nextProfile,
      ...current.filter((profile) => profile.accountStationId !== nextProfile.accountStationId || profile.accountId !== nextProfile.accountId)
    ])
    setCostProfileEditor(null)
    setNotice({ kind: 'success', text: `已保存账号成本档案：${accountCostKindLabel(nextProfile.kind)}。这是账号级设置，分组不会成为成本档案对象。` })
  }

  function clearAccountCostProfile() {
    if (!costProfileEditor) return
    setAccountCostProfiles((current) => current.filter((profile) => profile.accountStationId !== costProfileEditor.accountStationId || profile.accountId !== costProfileEditor.accountId))
    setCostProfileEditor(null)
    setNotice({ kind: 'success', text: '已恢复账号成本为“三方按量”默认模式。' })
  }

  function openBatchCostProfileEditor(group: SellingGroupProfitGroup) {
    const allRows = profitRows.filter((row) => row.station.id === group.station.id && row.group.id === group.group.id)
    const accounts = [...new Map(allRows.map((row) => [row.account.id, row.account])).values()]
    const existingProfiles = accounts.filter((account) => accountCostProfileByKey.has(accountUpstreamMappingKey(group.station.id, account.id)))
    setBatchCostProfileEditor({
      accountStationId: group.station.id,
      sellingGroupId: group.group.id,
      sellingGroupName: group.group.name,
      accountIds: accounts.map((account) => account.id),
      existingProfileCount: existingProfiles.length,
      crossGroupAccountCount: accounts.filter((account) => account.groupIds.length > 1).length,
      mode: 'unset-only',
      kind: 'upstream-metered',
      fixedCostAmount: '',
      cycleDays: '30',
      variableCostMultiplier: '',
      note: ''
    })
  }

  function saveBatchCostProfiles() {
    if (!batchCostProfileEditor) return
    const note = batchCostProfileEditor.note.trim()
    if (looksLikeSecretLabel(note)) {
      setNotice({ kind: 'error', text: '成本备注看起来像完整密钥/JWT，请改成脱敏说明后再保存。' })
      return
    }
    if (batchCostProfileEditor.mode === 'overwrite-all' && !window.confirm(`将覆盖 ${batchCostProfileEditor.accountIds.length} 个账号已有的本地成本档案。账号属于多个分组时，其他分组也会受影响。确定继续吗？`)) return
    const fixedCostAmount = optionalCostNumber(batchCostProfileEditor.fixedCostAmount)
    const cycleDays = optionalCostNumber(batchCostProfileEditor.cycleDays, 366)
    const variableCostMultiplier = optionalCostNumber(batchCostProfileEditor.variableCostMultiplier)
    const isCostExempt = batchCostProfileEditor.kind === 'self-owned-exempt'
    setAccountCostProfiles((current) => {
      const existing = new Map(current.map((profile) => [accountUpstreamMappingKey(profile.accountStationId, profile.accountId), profile]))
      for (const accountId of batchCostProfileEditor.accountIds) {
        const key = accountUpstreamMappingKey(batchCostProfileEditor.accountStationId, accountId)
        if (batchCostProfileEditor.mode === 'unset-only' && existing.has(key)) continue
        if (batchCostProfileEditor.kind === 'upstream-metered') {
          existing.delete(key)
          continue
        }
        existing.set(key, {
          accountStationId: batchCostProfileEditor.accountStationId,
          accountId,
          kind: batchCostProfileEditor.kind,
          fixedCostAmount: isCostExempt ? undefined : fixedCostAmount,
          cycleDays: isCostExempt ? undefined : fixedCostAmount !== undefined ? cycleDays ?? 30 : cycleDays,
          variableCostMultiplier: isCostExempt ? undefined : variableCostMultiplier,
          note: note ? note.slice(0, 120) : undefined,
          updatedAt: new Date().toISOString()
        })
      }
      return [...existing.values()]
    })
    setNotice({ kind: 'success', text: `已批量更新 ${batchCostProfileEditor.sellingGroupName} 下账号的本地成本档案。` })
    setBatchCostProfileEditor(null)
  }

  function focusAdminAccount(station: StationPublic, account: AccountSnapshot) {
    setWorkspaceView('stations')
    setStationConsoleTab('accounts')
    setSelectedId(station.id)
    setFocusedAccountKey(accountFocusKey(station.id, account.id))
  }

  function focusFirstAdminAccount(station: StationPublic, _snapshot?: StationSnapshot) {
    setSelectedId(station.id)
    setFocusedAccountKey('')
  }

  function beginAccountSwitch(station: StationPublic, account: AccountSnapshot, nextGroupId?: number) {
    focusAdminAccount(station, account)
    setMutationQueue([])
    setBatchQueueActive(false)
    setMutationError(null)
    setGroupSwitchQuery('')
    setGroupSwitchPlatform('all')
    setGroupSwitchScope(nextGroupId ? 'all' : 'category')
    setMutation({
      stationId: station.id,
      accountId: account.id,
      accountName: account.name,
      previousGroupIds: account.groupIds,
      nextGroupIds: nextGroupId ? [...new Set([...account.groupIds, nextGroupId])] : account.groupIds
    })
  }

  function beginRemoveAccountFromGroup(station: StationPublic, account: AccountSnapshot, groupId: number, groupName: string) {
    const nextGroupIds = account.groupIds.filter((id) => id !== groupId)
    if (nextGroupIds.length === account.groupIds.length) {
      setNotice({ kind: 'warning', text: `${account.name} 当前没有绑定 ${groupName}` })
      return
    }
    if (nextGroupIds.length === 0) {
      setNotice({ kind: 'warning', text: `${account.name} 至少需要保留一个分组；请用“调整组合”选择替代分组后再移出。` })
      return
    }
    setSelectedId(station.id)
    setFocusedAccountKey(accountFocusKey(station.id, account.id))
    setMutationQueue([])
    setBatchQueueActive(false)
    setMutationError(null)
    setGroupSwitchQuery('')
    setGroupSwitchPlatform('all')
    setGroupSwitchScope('all')
    setMutation({
      stationId: station.id,
      accountId: account.id,
      accountName: account.name,
      previousGroupIds: account.groupIds,
      nextGroupIds
    })
  }

  function closeMutation() {
    setMutation(null)
    setMutationQueue([])
    setBatchQueueActive(false)
    setMutationError(null)
  }

  function toggleMutationGroupId(groupId: number) {
    if (!mutation) return
    setMutation({
      ...mutation,
      nextGroupIds: mutation.nextGroupIds.includes(groupId)
        ? mutation.nextGroupIds.filter((currentGroupId) => currentGroupId !== groupId)
        : [...mutation.nextGroupIds, groupId].sort((left, right) => left - right)
    })
  }

  function recordMutationResult(mutationValue: AccountGroupMutation, status: BatchMutationResultStatus, targetLabel: string, message?: string) {
    const stationName = sourceStations.find((station) => station.id === mutationValue.stationId)?.name ?? '目标站点'
    setBatchMutationResults((current) => [{
      id: `${Date.now()}:${mutationValue.stationId}:${mutationValue.accountId}:${status}`,
      status,
      accountName: mutationValue.accountName,
      stationName,
      targetLabel,
      occurredAt: new Date().toISOString(),
      message
    }, ...current].slice(0, 20))
  }

  function skipCurrentMutation() {
    if (!mutation) return
    const nextQueuedMutation = mutationQueue[0]
    recordMutationResult(mutation, 'skipped', currentSwitchPreview?.nextLabel ?? '目标分组')
    setMutationError(null)
    if (nextQueuedMutation) {
      setMutationQueue((current) => current.slice(1))
      setMutation(nextQueuedMutation)
      setSelectedId(nextQueuedMutation.stationId)
      setFocusedAccountKey(accountFocusKey(nextQueuedMutation.stationId, nextQueuedMutation.accountId))
      setGroupSwitchQuery('')
      setGroupSwitchPlatform('all')
      setGroupSwitchScope('all')
      setNotice({ kind: 'warning', text: `已跳过 ${mutation.accountName}，继续下一个账号` })
      return
    }
    setMutation(null)
    setMutationQueue([])
    setBatchQueueActive(false)
    setNotice({ kind: 'warning', text: `已跳过 ${mutation.accountName}` })
  }

  const adminAccountRows = useMemo<AdminAccountWorkbenchRow[]>(() => {
    const rows: AdminAccountWorkbenchRow[] = []
    for (const { station, snapshot } of adminStations) {
      const accounts = snapshot?.accounts ?? []
      for (const account of accounts) {
        if (!accountMatchesScheduleFilter(account, accountScheduleFilter)) continue
        if (!accountMatchesPlatformFilter(account, accountPlatformFilter)) continue
        if (!accountMatchesGroupFilter(station.id, account, accountGroupFilter)) continue
        const recommendation = accountRecommendationFor(station, snapshot, account)
        if (!accountMatchesWorkbenchQuery(station.name, account, recommendation?.option.group.name, accountSearchQuery)) continue
        rows.push({
          focusKey: accountFocusKey(station.id, account.id),
          station,
          snapshot,
          account,
          recommendation,
          currentGroups: accountCurrentGroupOptions(snapshot?.groups ?? [], account.groupIds, station.rechargeRatio)
        })
      }
    }
    return rows
  }, [accountGroupFilter, accountPlatformFilter, accountRecommendationStrategy, accountScheduleFilter, accountSearchQuery, adminStations, hiddenGroupKeys, manualGroupTags, selectedCategory, selectedTag])
  const visibleAdminStationIds = useMemo(() => new Set(adminAccountRows.map((row) => row.station.id)), [adminAccountRows])
  const visibleAdminStations = adminStations.filter(({ station }) => visibleAdminStationIds.has(station.id))
  const focusedAdminAccountRow = useMemo(() => {
    if (adminAccountRows.length === 0) return undefined
    const focused = focusedAccountKey ? adminAccountRows.find((row) => row.focusKey === focusedAccountKey) : undefined
    if (focused) return focused
    const preferredStationRow = selectedStation ? adminAccountRows.find((row) => row.station.id === selectedStation.id) : undefined
    return preferredStationRow ?? adminAccountRows[0]
  }, [adminAccountRows, focusedAccountKey, selectedStation?.id])
  const focusedAccountRecommendation = focusedAdminAccountRow?.recommendation
  const focusedAccountBlockedText = focusedAdminAccountRow ? accountRecommendationBlockedText(focusedAdminAccountRow.account) : undefined
  const focusedStatusKey = focusedAdminAccountRow ? accountUpstreamMappingKey(focusedAdminAccountRow.station.id, focusedAdminAccountRow.account.id) : undefined
  const focusedMapping = focusedStatusKey ? accountMappingByKey.get(focusedStatusKey) : undefined
  const focusedSourceStation = focusedMapping ? sourceStations.find((station) => station.id === focusedMapping.sourceStationId) : undefined
  const focusedSourceResolution = resolveAccountUpstreamMappingSource(focusedMapping, focusedMapping ? visibleSnapshots[focusedMapping.sourceStationId] : undefined)
  const focusedSourceStatus = focusedAdminAccountRow ? accountSourceStatus(focusedAdminAccountRow.account, focusedMapping, focusedSourceStation, focusedSourceResolution, thirdPartySourceStations, visibleSnapshots) : undefined
  const focusedCostProfile = focusedStatusKey ? accountCostProfileByKey.get(focusedStatusKey) : undefined
  const focusedCostStatus = focusedAdminAccountRow ? accountCostStatus(focusedCostProfile, focusedSourceStatus?.tone === 'ready') : undefined
  const focusedAccountCandidateData = useMemo(() => {
    if (!focusedAdminAccountRow) return { candidates: [] as AccountGroupCandidate[], currentEffectiveMultiplier: undefined as number | undefined }
    const safetyEffectiveMultiplier = accountMinimumSafeEffectiveMultiplier(focusedAdminAccountRow.station, focusedAdminAccountRow.account)
    return accountCandidateOptionsFor(
      focusedAdminAccountRow.station,
      focusedAdminAccountRow.snapshot,
      focusedAdminAccountRow.account,
      selectedCategory,
      selectedTag,
      hiddenGroupKeys,
      manualGroupTags,
      accountRecommendationStrategy,
      safetyEffectiveMultiplier
    )
  }, [accountRecommendationStrategy, focusedAdminAccountRow, hiddenGroupKeys, manualGroupTags, selectedCategory, selectedTag, accountMappingByKey, accountCostProfileByKey, sourceStations, visibleSnapshots])
  const activeCandidateBudgetLine = parseMultiplierInput(candidateBudgetInput) ?? focusedAccountRecommendation?.safetyEffectiveMultiplier
  const focusedAccountCandidates = useMemo(() => {
    if (activeCandidateBudgetLine === undefined) return focusedAccountCandidateData.candidates
    return focusedAccountCandidateData.candidates.filter((option) => option.effectiveMultiplier >= activeCandidateBudgetLine - 0.0005)
  }, [activeCandidateBudgetLine, focusedAccountCandidateData])
  useEffect(() => {
    setCandidateBudgetInput(formatMultiplierInput(focusedAccountRecommendation?.safetyEffectiveMultiplier))
  }, [focusedAdminAccountRow?.focusKey])
  const batchRecommendationRows = adminAccountRows.filter((row) => row.recommendation?.safeForAccount)
  const batchResultCounts = useMemo(() => batchMutationResultCounts(batchMutationResults), [batchMutationResults])

  function beginBatchRecommendationQueue() {
    const mutations = batchRecommendationRows
      .map((row) => {
        if (!row.recommendation) return undefined
        return {
          stationId: row.station.id,
          accountId: row.account.id,
          accountName: row.account.name,
          previousGroupIds: row.account.groupIds,
          nextGroupIds: [...new Set([...row.account.groupIds, row.recommendation.option.group.id])]
        }
      })
      .filter((item): item is AccountGroupMutation => Boolean(item))
    const firstMutation = mutations[0]
    if (!firstMutation) {
      setNotice({ kind: 'warning', text: '当前筛选下没有可排队的推荐组合' })
      return
    }
    setMutationQueue(mutations.slice(1))
    setBatchQueueActive(true)
    setSelectedId(firstMutation.stationId)
    setFocusedAccountKey(accountFocusKey(firstMutation.stationId, firstMutation.accountId))
    setGroupSwitchQuery('')
    setGroupSwitchPlatform('all')
    setGroupSwitchScope('all')
    setMutation(firstMutation)
    setNotice({ kind: 'success', text: `已加入 ${mutations.length} 个推荐组合，逐个确认后提交` })
  }

  function categoryGroups(station: StationPublic, snapshot: StationSnapshot | undefined): GroupSnapshot[] {
    return snapshot?.groups.filter((group) => {
      const key = groupPreferenceKey(station.id, group.id)
      return (selectedCategory === 'all' || inferCategory(group) === selectedCategory)
        && groupMatchesTagFilter(group, selectedTag, manualGroupTags[key])
    }) ?? []
  }

  function toggleHiddenGroup(row: ComparisonRow) {
    const key = hiddenGroupKey(row)
    setGroupHiddenState(key, row.groupName, !hiddenGroupKeys.has(key))
  }

  function setGroupHiddenState(key: string, groupName: string, hidden: boolean) {
    setHiddenGroupKeys((current) => {
      const next = new Set(current)
      if (hidden) next.add(key)
      else next.delete(key)
      return next
    })
    setOpenGroupMenu(null)
    setNotice({ kind: 'success', text: hidden ? `已隐藏 ${groupName}` : `已恢复显示 ${groupName}` })
  }

  function toggleOperatingExcludedGroup(stationId: string, group: GroupSnapshot) {
    const key = groupPreferenceKey(stationId, group.id)
    setOperatingExcludedGroupKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    const excluded = !operatingExcludedGroupKeys.has(key)
    setNotice({ kind: 'success', text: excluded ? `${group.name} 已设为公益核算排除，不计入经营总览。` : `${group.name} 已恢复计入经营总览。` })
  }

  function toggleProfitAccountExpanded(key: string) {
    setExpandedProfitAccountKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleGroupTag(stationId: string, group: GroupSnapshot, tagId: GroupCapabilityTagId) {
    const key = groupPreferenceKey(stationId, group.id)
    const fallbackTags = resolveGroupCapabilityTags(group).map((tag) => tag.id)
    setManualGroupTags((current) => toggleManualGroupTag(current, key, tagId, fallbackTags))
  }

  function restoreAutomaticTags(stationId: string, groupId: number) {
    setManualGroupTags((current) => clearManualGroupTag(current, groupPreferenceKey(stationId, groupId)))
    setOpenGroupMenu(null)
    setNotice({ kind: 'success', text: '已恢复自动标签' })
  }

  function openMenuForGroup(event: React.MouseEvent, stationId: string, groupId: number) {
    event.preventDefault()
    event.stopPropagation()
    setOpenGroupMenu((current) => current?.stationId === stationId && current.groupId === groupId ? null : { stationId, groupId })
  }

  function clearRemovedGroup(event: GroupChangeEvent) {
    const next = clearGroupLocalReferences(hiddenGroupKeys, event.stationId, event.groupId)
    setHiddenGroupKeys(new Set(next.hiddenGroupKeys))
    setDismissedGroupChangeEventIds((current) => new Set(current).add(event.id))
    setNotice({ kind: 'success', text: `已隐藏 ${event.groupName} 的已删除记录，历史仍保留` })
  }

  function openGroupHistory(event: GroupChangeEvent) {
    setChangeLogOpen(true)
    setSelectedGroupHistory({ stationId: event.stationId, groupId: event.groupId })
    setSelectedId(event.stationId)
  }

  function handleChangeEventKeyDown(event: React.KeyboardEvent, change: GroupChangeEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    openGroupHistory(change)
  }

  function toggleAdminGroupExpanded(groupKey: string) {
    setExpandedAdminGroupKeys((current) => {
      const next = new Set(current)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }

  function toggleShowHiddenGroups() {
    const next = !showHiddenGroups
    if (next && visibleFilterHiddenGroupCount === 0) {
      setSelectedCategory('all')
      setSelectedTag('all')
    }
    setShowHiddenGroups(next)
  }

  function handleRankingRowKeyDown(event: React.KeyboardEvent, row: ComparisonRow) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    setSelectedId(row.stationId)
  }

  function renderCostRelationCard(row: AccountGroupProfitRow, titleMode: CostViewMode) {
    const roleClass = titleMode === 'group' ? 'account-detail' : 'group-detail'
    return (
      <article className={`cost-relation-card nested ${roleClass} ${row.status}`} key={row.key}>
        <div className="cost-relation-main">
          <span className={`cost-risk-badge ${row.status}`}>{formatProfitStatus(row.status)}</span>
          <div className={titleMode === 'group' ? 'cost-account-title account-title' : 'cost-account-title group-title'}>
            <strong>{titleMode === 'group' ? row.account.name : row.group.name}</strong>
            <em>
              {titleMode === 'group'
                ? `${row.account.platform || '账号'} · 账号 #${row.account.id} · 成本 ${accountCostKindLabel(row.costKind)}`
                : `售卖分组 #${row.group.id} · 售价 ${formatRateMultiplier(row.groupEffectiveMultiplier)}`}
            </em>
            <span title={accountCostOriginLabel(row)}>{accountCostOriginLabel(row)}</span>
          </div>
          <div className="cost-card-actions">
            <button type="button" className="outline-button compact" onClick={() => openAccountCostProfileEditor(row.station, row.account)}>设置账号成本</button>
            {row.costKind === 'upstream-metered' && (
              <button type="button" className="outline-button compact" onClick={() => openAccountMappingEditor(row.station, row.account)}>
                {row.mapping ? '修改上游关联' : '关联上游密钥'}
              </button>
            )}
          </div>
        </div>
        <div className="cost-metric-grid">
          <span><em>我的售价</em><strong>{formatRateMultiplier(row.groupEffectiveMultiplier)}</strong></span>
          <span><em>{row.costKind === 'self-owned-exempt' ? '成本口径' : row.costKind === 'upstream-metered' ? '上游成本' : '单位成本'}</em><strong>{row.costKind === 'self-owned-exempt' ? '免计费' : formatRateMultiplier(row.accountCostMultiplier)}</strong></span>
          <span><em>单位利润</em><strong className={row.status === 'loss' ? 'danger-text' : row.status === 'near-loss' ? 'warning-text' : row.status === 'profitable' ? 'success-text' : undefined}>{row.costKind === 'self-owned-exempt' ? '不核算' : formatSignedMultiplier(row.unitMargin)}</strong></span>
          <span><em>账号基础倍率</em><strong>{formatRateMultiplier(row.account.baseRateMultiplier)}</strong></span>
          <span><em>建议基础倍率</em><strong className={row.baseRateNeedsUpdate ? 'warning-text' : undefined}>{formatRateMultiplier(row.suggestedBaseRateMultiplier)}</strong></span>
          <span title={row.costKind === 'upstream-metered' ? '只累计带稳定记录 ID、账号和发生时间的用量；上游倍率与充值比例按当时观察值冻结。' : undefined}>
            <em>{row.costKind === 'self-owned-exempt' ? '收益口径' : row.costKind === 'upstream-metered' ? '时间账本成本' : '收益估算'}</em>
            <strong>{row.costKind === 'self-owned-exempt' ? '成本按 0'
              : row.costKind === 'upstream-metered'
              ? typeof row.temporalCostSummary?.totalCost === 'number' ? formatCostAmount(row.temporalCostSummary.totalCost) : row.temporalCostSummary ? '待拆分' : '暂无精确明细'
              : typeof row.estimatedProfit === 'number' ? formatSignedMultiplier(row.estimatedProfit) : '用量不足'}</strong>
          </span>
        </div>
        <div className="cost-source-line">
          <span>用量：{typeof row.usageAmount === 'number' ? row.usageAmount.toLocaleString('zh-CN', { maximumFractionDigits: 4 }) : '接口未提供账号×分组用量'}</span>
          <span title={row.temporalCostSummary ? '未知表示记录早于首次观察或缺少对应倍率；多分组 Key 不会按最低价猜算。' : undefined}>{row.temporalCostSummary
            ? `时间账本：精确 ${row.temporalCostSummary.exactEntries} · 待观察 ${row.temporalCostSummary.unknownEntries} · 待确认 ${row.temporalCostSummary.ambiguousEntries}`
            : accountCostFixedLabel(row.costProfile) ?? accountCostKindHint(row.costKind)}</span>
        </div>
        <div className="cost-relation-actions">
          <button type="button" className="outline-button compact" onClick={() => focusAdminAccount(row.station, row.account)}>查看账号</button>
          {(row.status === 'loss' || row.status === 'near-loss') && (
            <button
              type="button"
              className={row.status === 'loss' ? 'danger-button compact' : 'outline-button compact'}
              onClick={() => row.account.groupIds.length > 1 ? beginRemoveAccountFromGroup(row.station, row.account, row.group.id, row.group.name) : beginAccountSwitch(row.station, row.account)}
            >
              {row.account.groupIds.length > 1 ? row.status === 'loss' ? '移出亏损分组' : '确认移出' : '调整组合'}
            </button>
          )}
        </div>
      </article>
    )
  }

  function renderStationAccountFocus() {
    if (!focusedAdminAccountRow) return null

    return (
      <div className="station-account-focus" aria-label="当前选中账号">
        <div className="station-account-focus-heading">
          <div>
            <span className="eyebrow">账号详情</span>
            <h2>组合与推荐</h2>
            <em title={`${focusedAdminAccountRow.station.name} · ${focusedAdminAccountRow.account.platform} · ${focusedAdminAccountRow.account.status || 'active'} · ${accountScheduleLabel(focusedAdminAccountRow.account)}`}>所属站点：{focusedAdminAccountRow.station.name} · {focusedAdminAccountRow.account.platform} · {focusedAdminAccountRow.account.status || 'active'} · {accountScheduleLabel(focusedAdminAccountRow.account)}</em>
          </div>
          <span className="station-account-focus-tip">当前行展开</span>
        </div>
        {focusedSourceStatus && focusedCostStatus && (
          <div className="account-status-strip focus" aria-label={`${focusedAdminAccountRow.account.name} 来源和成本状态`}>
            <AccountStateBadge status={focusedSourceStatus} ariaLabel={`${focusedAdminAccountRow.account.name} 来源状态`} onClick={() => openAccountMappingEditor(focusedAdminAccountRow.station, focusedAdminAccountRow.account)} />
            <AccountStateBadge status={focusedCostStatus} ariaLabel={`${focusedAdminAccountRow.account.name} 成本状态`} onClick={() => openAccountCostProfileEditor(focusedAdminAccountRow.station, focusedAdminAccountRow.account)} />
          </div>
        )}
        <div className="station-account-focus-body">
          <div className="station-account-focus-main">
            <div className="station-account-focus-summary">
              <span className="current-baseline-card" title={accountCurrentEffectiveTitle(focusedAdminAccountRow.snapshot?.groups ?? [], focusedAdminAccountRow.account.groupIds, focusedAdminAccountRow.station.rechargeRatio)}>
                <em>当前组合最低</em>
                <strong>{accountCurrentEffectiveLabel(focusedAdminAccountRow.snapshot?.groups ?? [], focusedAdminAccountRow.account.groupIds, focusedAdminAccountRow.station.rechargeRatio)}</strong>
                <small title={accountCurrentEffectiveTitle(focusedAdminAccountRow.snapshot?.groups ?? [], focusedAdminAccountRow.account.groupIds, focusedAdminAccountRow.station.rechargeRatio)}>{accountCurrentEffectiveMeta(focusedAdminAccountRow.snapshot?.groups ?? [], focusedAdminAccountRow.account.groupIds, focusedAdminAccountRow.station.rechargeRatio)}</small>
              </span>
              <span title={`当前账号所在分组：${focusedAdminAccountRow.currentGroups.length} 个`}>
                <em>当前分组</em>
                <strong>{focusedAdminAccountRow.currentGroups.length} 个</strong>
              </span>
              <span title={focusedAdminAccountRow.recommendation ? `${focusedAdminAccountRow.recommendation.option.group.name} · 最终 ${formatRateMultiplier(focusedAdminAccountRow.recommendation.option.effectiveMultiplier)}` : '暂无推荐结果'}>
                <em>推荐结果</em>
                <strong>{focusedAdminAccountRow.recommendation ? formatRateMultiplier(focusedAdminAccountRow.recommendation.option.effectiveMultiplier) : '--'}</strong>
              </span>
            </div>
          </div>
          <div className="account-current-groups-block focus-wide">
            <span className="account-section-label" title={`当前账号所在分组：${focusedAdminAccountRow.currentGroups.length || focusedAdminAccountRow.account.groupIds.length} 个`}>所在分组 · {focusedAdminAccountRow.currentGroups.length || focusedAdminAccountRow.account.groupIds.length} 个</span>
            <div className="account-group-chip-list focus">
              {focusedAdminAccountRow.currentGroups.length > 0
                ? focusedAdminAccountRow.currentGroups.map((option) => {
                    const canRemoveGroup = focusedAdminAccountRow.currentGroups.length > 1
                    return (
                      <span className="account-group-chip full" key={option.group.id}>
                        <span title={`${option.group.name} · ${formatRateMultiplier(option.effectiveMultiplier)}`}>{option.group.name} · {formatRateMultiplier(option.effectiveMultiplier)}</span>
                        <button
                          type="button"
                          disabled={!canRemoveGroup}
                          title={canRemoveGroup ? `从 ${focusedAdminAccountRow.account.name} 移除 ${option.group.name}` : '至少保留一个分组'}
                          aria-label={canRemoveGroup ? `从 ${focusedAdminAccountRow.account.name} 移除 ${option.group.name}` : `${focusedAdminAccountRow.account.name} 至少保留一个分组`}
                          onClick={() => beginRemoveAccountFromGroup(focusedAdminAccountRow.station, focusedAdminAccountRow.account, option.group.id, option.group.name)}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    )
                  })
                : <span className="account-group-chip empty"><span title="未绑定分组">未绑定分组</span></span>}
            </div>
          </div>
          <div className={accountRecommendationTone(focusedAdminAccountRow.currentGroups.length, focusedAccountRecommendation?.safeForAccount) === 'safe' ? 'account-recommendation safe' : 'account-recommendation'}>
            <span>{focusedAccountBlockedText?.label ?? accountRecommendationLabel(focusedAdminAccountRow.currentGroups.length, focusedAccountRecommendation?.safeForAccount)}</span>
            {focusedAccountBlockedText
              ? <>
                  <strong title={focusedAccountBlockedText.title}>{focusedAccountBlockedText.title}</strong>
                  <em title={focusedAccountBlockedText.detail}>{focusedAccountBlockedText.detail}</em>
                </>
              : focusedAccountRecommendation
              ? <>
                  <strong title={focusedAccountRecommendation.option.group.name}>{focusedAccountRecommendation.option.group.name}</strong>
                  <em title={`${focusedAccountRecommendation.scopeLabel} · 候选最终 ${formatRateMultiplier(focusedAccountRecommendation.option.effectiveMultiplier)} · 安全线 ${formatRateMultiplier(focusedAccountRecommendation.safetyEffectiveMultiplier)}`}>{focusedAccountRecommendation.scopeLabel} · 最终 {formatRateMultiplier(focusedAccountRecommendation.option.effectiveMultiplier)}</em>
                </>
              : <>
                  <strong title="暂无候选">暂无候选</strong>
                  <em title="换分类、标签或恢复隐藏分组后再试">换分类、标签或恢复隐藏分组后再试</em>
                </>}
          </div>
          <div className="account-candidate-list" aria-label={focusedAdminAccountRow.currentGroups.length > 0 ? '安全候选组合' : '可选初始分组'}>
            <div className="account-candidate-toolbar">
              <span className="account-candidate-title">{focusedAdminAccountRow.currentGroups.length > 0 ? '安全候选' : '可选分组'}</span>
              <label className="account-candidate-budget">
                <span>安全线</span>
                <input
                  type="number"
                  min={0}
                  step={0.001}
                  value={candidateBudgetInput}
                  onChange={(event) => {
                    setCandidateBudgetInput(event.target.value)
                  }}
                  placeholder={formatMultiplierInput(focusedAccountCandidateData.currentEffectiveMultiplier) || '无限制'}
                  title="只显示不低于该最终倍率的候选"
                  aria-label="候选安全线"
                />
                <button type="button" className="text-button" onClick={() => setCandidateBudgetInput(formatMultiplierInput(focusedAccountRecommendation?.safetyEffectiveMultiplier))} title="跟随账号成本安全线">跟随成本</button>
              </label>
            </div>
            {focusedAccountCandidateData.candidates.length > 0 && focusedAccountCandidates.length === 0 && (
              <div className="empty-state compact-empty account-candidate-empty"><SlidersHorizontal size={18} /><span>没有高于当前安全线的候选，降低安全线或换分类再试。</span></div>
            )}
            {focusedAccountCandidates.length > 0 && focusedAccountCandidates.map((option) => (
              <button
                key={option.group.id}
                type="button"
                className={option.safeForAccount ? 'account-candidate-row safe' : 'account-candidate-row'}
                onClick={() => beginAccountSwitch(focusedAdminAccountRow.station, focusedAdminAccountRow.account, option.group.id)}
                title={`${option.scopeLabel} · 最终 ${formatRateMultiplier(option.effectiveMultiplier)}`}
              >
                <span className="account-candidate-main">
                  <strong>{option.group.name}</strong>
                  <em>{option.group.platform}{option.safeForAccount ? ' · 安全' : ' · 候选'}</em>
                </span>
                <span className="account-candidate-rate">
                  <strong>{formatRateMultiplier(option.effectiveMultiplier)}</strong>
                  <em>最终倍率</em>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="station-account-focus-actions">
          {focusedAccountRecommendation && <button type="button" className="outline-button compact" onClick={() => beginAccountSwitch(focusedAdminAccountRow.station, focusedAdminAccountRow.account, focusedAccountRecommendation.option.group.id)}>{accountRecommendationActionLabel(focusedAdminAccountRow.currentGroups.length, focusedAccountRecommendation.safeForAccount)}</button>}
          <button type="button" className="outline-button compact" onClick={() => openAccountMappingEditor(focusedAdminAccountRow.station, focusedAdminAccountRow.account)}>关联上游密钥</button>
          <button type="button" className="primary-button compact" onClick={() => beginAccountSwitch(focusedAdminAccountRow.station, focusedAdminAccountRow.account)}>调整组合 <ChevronDown size={14} /></button>
        </div>
      </div>
    )
  }

  const stationConsoleContent = workspaceView !== 'stations' || stationConsoleTab === 'accounts'
    ? null
    : (
        <div className="station-console-pane" aria-label={`${selectedConsoleTitle}内容`}>
          {!selectedConsoleStation ? (
            <div className="admin-console-section">
              <div className="empty-state compact-empty">
                <LockKeyhole size={18} />
                <span>先在来源钱包里添加一个“我的站点”，这里就会展开用户、账号、分组、渠道、平台、用量和设置。</span>
              </div>
            </div>
          ) : stationConsoleTab === 'overview' ? (
            <div className="admin-console-section">
              <div className="admin-console-summary">
                <article className="admin-console-stat"><span>站点</span><strong>{selectedConsoleStation.name}</strong><em>{selectedConsoleStation.baseUrl}</em></article>
                <article className="admin-console-stat"><span>健康</span><strong>{selectedConsoleSnapshot?.health === 'healthy' ? '正常' : healthLabel(selectedConsoleSnapshot)}</strong><em>余额 {formatMoney(selectedConsoleSnapshot?.balance)}</em></article>
                <article className="admin-console-stat"><span>账号 / 分组</span><strong>{selectedConsoleSnapshot?.accounts.length ?? 0} / {selectedConsoleSnapshot?.groups.length ?? 0}</strong><em>当前可管理内容</em></article>
              </div>
              <div className="admin-console-list">
                {adminConsoleDashboard.length > 0
                  ? adminConsoleDashboard.map((record, index) => (
                      <article className="admin-console-row" key={`${adminRecordLabel(record, 'stat')}-${index}`}>
                        <div className="admin-console-row-main">
                          <strong>{adminRecordLabel(record, '统计')}</strong>
                          <span>{adminRecordMeta(record) || formatAdminValue(record.value ?? record.count ?? record.total ?? record.amount)}</span>
                        </div>
                        <div className="admin-console-row-fields">
                          {adminRecordFields(record, ['title', 'value', 'count', 'total', 'amount']).map((field) => <em key={field.label}>{field.label} · {field.value}</em>)}
                        </div>
                      </article>
                    ))
                  : <div className="empty-state compact-empty"><SlidersHorizontal size={18} /><span>这里先放管理台总览；切换上方分区可查看用户、账号、分组、渠道、平台、用量和设置。</span></div>}
              </div>
            </div>
          ) : null}

          {selectedConsoleStation && stationConsoleTab === 'users' && (
            <div className="admin-console-section">
              <div className="admin-console-summary">
                <article className="admin-console-stat"><span>用户</span><strong>{adminConsoleUsers.length}</strong><em>当前站点返回的用户条目</em></article>
                <article className="admin-console-stat"><span>含 API Key</span><strong>{adminConsoleUsers.filter((record) => (adminRecordNumber(record, ['api_key_count', 'apiKeys', 'api_keys']) ?? 0) > 0).length}</strong><em>可继续往下展开查看</em></article>
                <article className="admin-console-stat"><span>后台统计</span><strong>{adminConsoleDashboard.length}</strong><em>接口概览条目</em></article>
              </div>
              {adminConsoleDashboard.length > 0
                ? <div className="admin-console-list compact"><div className="admin-console-list-title">统计概览</div>{adminConsoleDashboard.map((record, index) => (
                    <article className="admin-console-row" key={`${adminRecordLabel(record, 'stat')}-${index}`}>
                      <div className="admin-console-row-main">
                        <strong>{adminRecordLabel(record, '统计')}</strong>
                        <span>{adminRecordMeta(record) || formatAdminValue(record.value ?? record.count ?? record.total ?? record.amount)}</span>
                      </div>
                      <div className="admin-console-row-fields">
                        {adminRecordFields(record, ['title', 'value', 'count', 'total', 'amount']).map((field) => <em key={field.label}>{field.label} · {field.value}</em>)}
                      </div>
                    </article>
                  ))}</div>
                : <div className="empty-state compact-empty"><LockKeyhole size={18} /><span>未发现后台概览数据；可以在站点设置里补录后台概览路径。</span></div>}
              {adminConsoleUsers.length > 0
                ? <div className="admin-console-list">{adminConsoleUsers.map((record, index) => {
                    const userId = adminRecordPositiveInteger(record, ['id', 'user_id', 'userId'])
                    const internalUser = userId !== undefined && internalUserProfiles.some((profile) => profile.accountStationId === selectedConsoleStation.id && profile.userId === userId)
                    const apiKeyCount = adminRecordNumber(record, ['api_key_count', 'apiKeys', 'api_keys'])
                    const quota = adminRecordNumber(record, ['quota', 'limit', 'max'])
                    const balance = adminRecordNumber(record, ['balance', 'credits', 'credit', 'amount', 'total', 'remaining'])
                    return (
                      <article className="admin-console-row" key={`${adminRecordLabel(record, 'user')}-${index}`}>
                        <div className="admin-console-row-main">
                          <strong>{adminRecordLabel(record, `用户 ${index + 1}`)}</strong>
                          <span>{adminRecordMeta(record) || '无附加标记'}</span>
                        </div>
                        <div className="admin-console-row-fields">
                          <em>状态 · {formatAdminValue(record.status ?? record.role ?? 'normal')}</em>
                          {typeof apiKeyCount === 'number' && <em>API Key · {apiKeyCount}</em>}
                          {typeof quota === 'number' && <em>额度 · {quota.toLocaleString('zh-CN')}</em>}
                          {typeof balance === 'number' && <em>余额 · {formatMoney(balance)}</em>}
                          {adminRecordFields(record, ['api_key_count', 'platform_quotas', 'quota', 'usage', 'balance', 'credits', 'credit', 'remaining']).map((field) => <em key={field.label}>{field.label} · {field.value}</em>)}
                          {userId === undefined
                            ? <em title="当前用户列表未返回稳定用户 ID，无法安全应用内部自用核算规则">无法识别用户 ID</em>
                            : <button
                                type="button"
                                className={internalUser ? 'compact-user-toggle active' : 'compact-user-toggle'}
                                aria-pressed={internalUser}
                                title={internalUser ? '取消内部自用，恢复该用户的经营核算' : '标记为内部自用，排除该用户的经营收入、成本与利润'}
                                onClick={() => void toggleInternalUserProfile(selectedConsoleStation.id, userId)}
                              >
                                <UserRoundCheck size={13} />
                                {internalUser ? '内部自用' : '设为内部自用'}
                              </button>}
                        </div>
                      </article>
                    )
                  })}</div>
                : <div className="empty-state compact-empty"><LockKeyhole size={18} /><span>当前站点没有返回用户列表，或管理员用户路径尚未补录。</span></div>}
            </div>
          )}

          {stationConsoleTab === 'protection' && (
            <div className="admin-console-section cost-protection-section">
              <div className="admin-console-summary cost-summary">
                <button type="button" className={costStatusFilter === 'loss' && !costBaseRateOnly ? 'admin-console-stat clickable active' : 'admin-console-stat clickable'} onClick={() => applyCostStatusQuickFilter('loss')}><span>亏损关系</span><strong className={profitRiskCounts.loss > 0 ? 'danger-text' : undefined}>{profitRiskCounts.loss}</strong><em>账号某条使用明细会亏</em></button>
                <button type="button" className={costStatusFilter === 'near-loss' && !costBaseRateOnly ? 'admin-console-stat clickable active' : 'admin-console-stat clickable'} onClick={() => applyCostStatusQuickFilter('near-loss')}><span>接近亏损</span><strong className={profitRiskCounts['near-loss'] > 0 ? 'warning-text' : undefined}>{profitRiskCounts['near-loss']}</strong><em>小于安全缓冲</em></button>
                <button type="button" className={costStatusFilter === 'unmapped' && !costBaseRateOnly ? 'admin-console-stat clickable active' : 'admin-console-stat clickable'} onClick={() => applyCostStatusQuickFilter('unmapped')}><span>未绑定来源</span><strong>{profitRiskCounts.unmapped}</strong><em>先绑定三方来源</em></button>
                <button type="button" className={costStatusFilter === 'exempt' && !costBaseRateOnly ? 'admin-console-stat clickable active' : 'admin-console-stat clickable'} onClick={() => applyCostStatusQuickFilter('exempt')}><span>账号免计费</span><strong>{profitRiskCounts.exempt}</strong><em>不计入成本保护</em></button>
                <button type="button" className={costBaseRateOnly ? 'admin-console-stat clickable active' : 'admin-console-stat clickable'} onClick={applyBaseRateQuickFilter}><span>基础倍率需调</span><strong className={baseRateUpdateCount > 0 ? 'warning-text' : undefined}>{baseRateUpdateCount}</strong><em>按上游成本建议</em></button>
              </div>
              <div className="admin-console-note">
                <strong>单位利润 = 售卖最终倍率 − 账号成本倍率。</strong> 大于 0 为赚钱，小于 0 为亏损；利润不高于成本的 5%（至少 0.001x）标为接近亏损。历史上游成本按本地观察到的倍率、充值比例和 Key 分组边界计算，不用当前倍率回算。
              </div>
              <div className="admin-console-note" title="精确条目要求稳定用量记录 ID、账号 ID、明确发生时间和数值用量。没有这些条件的汇总接口不会进入时间账本。">
                <strong>时间账本：</strong> 精确 {timeCostLedgerSummary.exactEntries} 条 · 待观察 {timeCostLedgerSummary.unknownEntries} 条 · 待确认 {timeCostLedgerSummary.ambiguousEntries} 条 · 最近观察 {formatTime(latestLedgerObservationAt(timeCostLedger))}
              </div>
              <div className="admin-console-note" title="管理员明细仅在主进程读取，界面只接收已校验的账本条目与覆盖计数。">
                <strong>管理员用量明细：</strong> {usageLedgerCoverageLabel(selectedUsageCoverage)}
              </div>
              <div className={`usage-capability-card ${usageCapabilityTone(selectedUsageDiagnostic.precision)}`}>
                <div className="usage-capability-main">
                  <span className="usage-capability-badge">{selectedUsageDiagnostic.precisionLabel}</span>
                  <div>
                    <strong>用量能力诊断</strong>
                    <em>{selectedUsageDiagnostic.summary}</em>
                  </div>
                </div>
                <div className="usage-capability-meta" aria-label="用量诊断维度">
                  <span>记录 {selectedUsageDiagnostic.recordCount}</span>
                  <span>账号累计 {selectedUsageDiagnostic.accountUsageCount}</span>
                  {usageCapabilityDimensionLabels(selectedUsageDiagnostic).map((label) => <span key={`dimension-${label}`}>{label}</span>)}
                  {usageCapabilityMeasureLabels(selectedUsageDiagnostic).map((label) => <span key={`measure-${label}`}>{label}</span>)}
                </div>
                <button type="button" className="outline-button compact" onClick={() => setUsageDiagnosticOpen(true)}>查看字段</button>
              </div>
              <div className="station-admin-toolbar cost-toolbar" aria-label="成本保护筛选">
                <div className="cost-view-toggle" role="tablist" aria-label="成本视角">
                  <button type="button" className={costViewMode === 'group' ? 'active' : undefined} aria-pressed={costViewMode === 'group'} onClick={() => setCostViewMode('group')}>按分组</button>
                  <button type="button" className={costViewMode === 'account' ? 'active' : undefined} aria-pressed={costViewMode === 'account'} onClick={() => setCostViewMode('account')}>按账号</button>
                </div>
                <input
                  type="search"
                  className="station-admin-search"
                  value={accountSearchQuery}
                  onChange={(event) => setAccountSearchQuery(event.target.value)}
                  placeholder="搜索账号、使用明细、来源站点或来源分组"
                  aria-label="搜索成本保护关系"
                />
                <label className="cost-sort-control">
                  <span>状态</span>
                  <select value={costStatusFilter} onChange={(event) => setCostStatusFilter(event.target.value as CostStatusFilter)} aria-label="成本风险筛选">
                    <option value="all">全部状态</option>
                    <option value="loss">只看亏损</option>
                    <option value="near-loss">接近亏损</option>
                    <option value="unmapped">未绑定来源</option>
                    <option value="stale">来源失效</option>
                    <option value="profitable">安全盈利</option>
                    <option value="exempt">账号免计费</option>
                  </select>
                </label>
                <label className="cost-sort-control">
                  <span>成本</span>
                  <select value={costKindFilter} onChange={(event) => setCostKindFilter(event.target.value as CostKindFilter)} aria-label="账号成本类型筛选">
                    <option value="all">全部成本</option>
                    <option value="unset">未设置</option>
                    <option value="upstream-metered">三方按量</option>
                    <option value="self-owned-exempt">账号免计费</option>
                    <option value="gifted">赠送免费</option>
                    <option value="subscription">自购订阅</option>
                    <option value="manual">手动成本</option>
                  </select>
                </label>
                <label className="cost-sort-control">
                  <span>排序</span>
                  <select value={costSortMode} onChange={(event) => setCostSortMode(event.target.value as CostSortMode)} aria-label="成本排序">
                    <option value="unset-first">未设置优先</option>
                    <option value="risk">风险优先</option>
                    <option value="cost-kind">成本类型</option>
                    <option value="category">分类排序</option>
                    <option value="group-rate">售卖倍率</option>
                    <option value="account-count">账号数量</option>
                    <option value="margin">最低利润</option>
                  </select>
                </label>
                <span className="last-seen">
                  {costViewMode === 'group'
                    ? `显示 ${visibleSellingGroupCount} 个分组 / ${visibleProfitRows.length} 个账号明细`
                    : `显示 ${visibleProfitAccountCount} 个账号 / ${visibleProfitRows.length} 条使用明细`}
                  {(costStatusFilter !== 'all' || costBaseRateOnly) && <button type="button" className="text-button inline-reset" onClick={clearCostQuickFilters}>清除快捷筛选</button>}
                </span>
                <button
                  type="button"
                  className="outline-button compact"
                  title="校验已读取的账号密钥；只保留唯一精确匹配，不按地址或倍率猜测"
                  disabled={rebuildingMappings || adminAccountCount === 0 || thirdPartySourceStations.length === 0}
                  onClick={previewSourceMappingsFromSnapshots}
                >
                  {rebuildingMappings ? <LoaderCircle className="spin" size={13} /> : <RotateCcw size={13} />}
                  校验密钥
                </button>
              </div>
              <div className="cost-relation-list">
                {adminStations.length === 0 && <div className="empty-state ranking-empty"><LockKeyhole size={18} /><span>先添加一个带管理员权限的“我的站点”，才能计算账号成本保护。</span></div>}
                {adminStations.length > 0 && profitRows.length === 0 && <div className="empty-state ranking-empty"><SlidersHorizontal size={18} /><span>当前我的站点没有返回账号或分组关系。</span></div>}
                {profitRows.length > 0 && visibleProfitRows.length === 0 && <div className="empty-state ranking-empty"><SlidersHorizontal size={18} /><span>当前搜索下没有匹配的成本关系。</span></div>}
                {costViewMode === 'group' && visibleSellingGroupProfitGroups.map((group) => {
                  const expandedKey = `group:${group.key}`
                  const expanded = expandedProfitAccountKeys.has(expandedKey)
                  const cheapestRow = group.cheapestAccountRow
                  const hasComparableCost = typeof group.minAccountCostMultiplier === 'number'
                  const operatingExcluded = operatingExcludedGroupKeys.has(groupPreferenceKey(group.station.id, group.group.id))
                  const publicWelfareSummary = profitReport?.query.stationId === group.station.id
                    ? profitReport.publicWelfareGroups.find((item) => item.sellingGroupId === group.group.id)
                    : undefined
                  return (
                    <article className={`cost-account-card selling-group group-owner ${group.summaryStatus} ${operatingExcluded ? 'public-welfare' : ''} ${expanded ? 'expanded' : ''}`} key={group.key}>
                      <div className="cost-relation-main">
                        <span className={`cost-risk-badge ${group.summaryStatus}`}>{group.accountCount} 个账号</span>
                        <div className="cost-account-title group-title">
                          <strong>{group.group.name}</strong>
                          <em>{group.station.name} · {group.categoryLabel} · 售价 {formatRateMultiplier(group.groupEffectiveMultiplier)}</em>
                          <span title="这个分组下每个账号按自己的账号成本独立判断">
                            亏损 {group.lossCount} · 接近 {group.nearLossCount} · 未绑定/失效 {group.unmappedCount} · {hasComparableCost ? `最低账号成本 ${formatRateMultiplier(group.minAccountCostMultiplier)} · 最低利润 ${formatSignedMultiplier(group.minUnitMargin)}` : '免计费账号不参与成本比较'}
                          </span>
                        </div>
                        <div className="cost-card-actions">
                          <button type="button" className={operatingExcluded ? 'outline-button compact active' : 'outline-button compact'} title="仅影响本机经营核算，不会修改远端分组" aria-pressed={operatingExcluded} onClick={() => toggleOperatingExcludedGroup(group.station.id, group.group)}>{operatingExcluded ? '公益核算排除' : '设为公益分组'}</button>
                          <button type="button" className="outline-button compact" title="成本仍按账号保存；默认只填未设置的账号" onClick={() => openBatchCostProfileEditor(group)}>批量设置成本</button>
                          {cheapestRow && <button type="button" className="outline-button compact" onClick={() => focusAdminAccount(cheapestRow.station, cheapestRow.account)}>查看最便宜账号</button>}
                          <button type="button" className="outline-button compact" onClick={() => toggleProfitAccountExpanded(expandedKey)}>
                            {expanded ? '收起账号' : `展开 ${group.accountCount} 个账号`}
                          </button>
                        </div>
                      </div>
                      <div className="cost-account-summary">
                        <span className="group-chip">所在分组：{formatRateMultiplier(group.groupEffectiveMultiplier)}</span>
                        <span className="account-chip">账号数：{group.accountCount}</span>
                        <span className="account-chip">最便宜账号：{cheapestRow ? cheapestRow.account.name : hasComparableCost ? '暂无' : '免计费不比较'}</span>
                        <span className="account-chip">账号成本区间：{hasComparableCost ? `${formatRateMultiplier(group.minAccountCostMultiplier)} - ${formatRateMultiplier(group.maxAccountCostMultiplier)}` : '免计费不比较'}</span>
                        <span>风险：{formatProfitStatus(group.summaryStatus)}</span>
                        {operatingExcluded && <span className="group-chip" title="不计入经营收入、成本、利润、亏损与成本保护统计；原始账本不会删除">公益核算排除</span>}
                        {publicWelfareSummary && <span className="group-chip" title={publicWelfareSummary.unresolvedUpstreamRequests > 0 ? `${publicWelfareSummary.unresolvedUpstreamRequests} 条上游成本尚未追溯` : '已按该分组的严格用量归档记录汇总'}>公益参考：收入 {formatBillingUnits(publicWelfareSummary.revenue)} · 成本 {formatBillingUnits(publicWelfareSummary.upstreamCost)} · 利润 {formatBillingUnits(publicWelfareSummary.revenue - publicWelfareSummary.upstreamCost)}</span>}
                        {operatingExcluded && profitReport?.query.stationId === group.station.id && !publicWelfareSummary && <span className="group-chip">公益参考：无精确分组用量</span>}
                        <span className="account-chip">操作对象：展开后只对账号设置成本/来源/移出</span>
                      </div>
                      {expanded && (
                        <div className="cost-group-list">
                          {group.rows.map((row) => renderCostRelationCard(row, 'group'))}
                        </div>
                      )}
                    </article>
                  )
                })}
                {costViewMode === 'account' && visibleProfitAccountGroups.map((group) => {
                  const expandedKey = `account:${group.key}`
                  const expanded = expandedProfitAccountKeys.has(expandedKey)
                  const firstRow = group.rows[0]
                  const statusCounts = group.rows.reduce<Record<ProfitRiskStatus, number>>((counts, row) => {
                    counts[row.status] += 1
                    return counts
                  }, { profitable: 0, 'near-loss': 0, loss: 0, unmapped: 0, stale: 0, exempt: 0 })
                  return (
                    <article className={`cost-account-card account-owner ${group.summaryStatus} ${expanded ? 'expanded' : ''}`} key={group.key}>
                      <div className="cost-relation-main">
                        <span className={`cost-risk-badge ${group.summaryStatus}`}>{group.rows.length} 条明细</span>
                        <div className="cost-account-title account-title">
                          <strong>{group.account.name}</strong>
                          <em>{group.station.name} · {group.account.platform || '账号'}</em>
                          <span title={`这个账号当前有 ${group.rows.length} 条使用明细`}>
                            分类 {group.primaryCategoryLabel} · 成本 {accountCostKindLabel(firstRow?.costKind ?? 'upstream-metered')} · 最低 {formatRateMultiplier(group.minEffectiveMultiplier)} · 最高 {formatRateMultiplier(group.maxEffectiveMultiplier)} · 亏损 {statusCounts.loss}
                          </span>
                        </div>
                        <div className="cost-card-actions">
                          <button type="button" className="outline-button compact" onClick={() => openAccountCostProfileEditor(group.station, group.account)}>设置账号成本</button>
                          <button type="button" className="outline-button compact" onClick={() => toggleProfitAccountExpanded(expandedKey)}>
                            {expanded ? '收起明细' : `展开 ${group.rows.length} 条使用明细`}
                          </button>
                        </div>
                      </div>
                      <div className="cost-account-summary">
                        <span className="group-chip">所在分组：{group.rows.length} 条明细</span>
                        <span>分类：{group.primaryCategoryLabel}</span>
                        <span>成本档案：{accountCostKindLabel(firstRow?.costKind ?? 'upstream-metered')}</span>
                        <span>来源/成本：{accountCostOriginLabel(firstRow)}</span>
                        <span className="account-chip">账号基础倍率：{formatRateMultiplier(firstRow?.account.baseRateMultiplier)}</span>
                        <span className="account-chip">建议基础倍率：{formatRateMultiplier(firstRow?.suggestedBaseRateMultiplier)}</span>
                        <span className="account-chip">作用范围：该账号下的全部分组共用同一份成本档案</span>
                      </div>
                      {expanded && (
                        <div className="cost-group-list">
                          {group.rows.map((row) => renderCostRelationCard(row, 'account'))}
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            </div>
          )}

          {stationConsoleTab === 'profit' && (
            <div className="admin-console-section profit-interval-section">
              <div className="profit-interval-heading">
                <div>
                  <span className="eyebrow">ADMIN USAGE</span>
                  <h2>收益区间核算</h2>
                  <p>收入取站内实际扣费；上游成本按每条用量发生时的已观察来源倍率核算。金额均为站内统一计费单位。</p>
                </div>
                <div className="profit-interval-actions">
                  <button type="button" className="outline-button compact" onClick={() => void loadProfitIntervalReport()} disabled={profitLoading || profitArchiving || !selectedConsoleStation}>
                    {profitLoading ? <LoaderCircle className="spin" size={13} /> : <Activity size={13} />}
                    {profitLoading ? '读取中' : '查看归档'}
                  </button>
                  <button type="button" className="primary-button compact" onClick={() => void archiveProfitInterval()} disabled={profitLoading || profitArchiving || !selectedConsoleStation}>
                    {profitArchiving ? <LoaderCircle className="spin" size={13} /> : <Archive size={13} />}
                    {profitArchiving ? '归档中' : '归档当前区间'}
                  </button>
                  <button type="button" className="outline-button icon-button" onClick={() => void archiveProfitInterval(true)} disabled={profitLoading || profitArchiving || !selectedConsoleStation} title="重新读取站点用量并覆盖本地当前区间归档" aria-label="重新归档当前区间">
                    <RotateCcw size={14} />
                  </button>
                </div>
              </div>
              <div className="profit-query-toolbar" aria-label="收益区间筛选">
                <div className="cost-view-toggle" role="tablist" aria-label="收益核算粒度">
                  <button type="button" className={profitGranularity === 'day' ? 'active' : undefined} aria-pressed={profitGranularity === 'day'} onClick={() => setProfitGranularity('day')}>按天</button>
                  <button type="button" className={profitGranularity === 'hour' ? 'active' : undefined} aria-pressed={profitGranularity === 'hour'} onClick={() => setProfitGranularity('hour')}>按小时</button>
                </div>
                <label className="profit-date-field"><span>开始</span><input type="date" value={profitStartDate} max={profitEndDate} onChange={(event) => setProfitStartDate(event.target.value)} /></label>
                <label className="profit-date-field"><span>结束</span><input type="date" value={profitEndDate} min={profitStartDate} onChange={(event) => setProfitEndDate(event.target.value)} /></label>
                <label className="profit-select-field"><span>账号</span><select value={profitAccountId} onChange={(event) => setProfitAccountId(event.target.value)}><option value="all">全部账号</option>{(selectedConsoleSnapshot?.accounts ?? []).map((account) => <option key={account.id} value={account.id}>{account.name} · #{account.id}</option>)}</select></label>
                <label className="profit-select-field"><span>售卖分组</span><select value={profitSellingGroupId} onChange={(event) => setProfitSellingGroupId(event.target.value)}><option value="all">全部分组</option>{(selectedConsoleSnapshot?.groups ?? []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
                <span className="last-seen">{profitGranularity === 'hour' ? '按小时最多 7 天' : '按天最多 90 天'} · [开始, 结束次日)</span>
              </div>
              {profitGranularity === 'hour' && (Date.parse(`${profitEndDate}T00:00:00+08:00`) - Date.parse(`${profitStartDate}T00:00:00+08:00`)) / 86_400_000 > 6 && <div className="admin-console-note warning"><AlertTriangle size={14} /><span>按小时最多核算 7 天；请缩短日期区间或切换为按天。</span></div>}
              {profitError && <div className="admin-console-note error"><AlertTriangle size={14} /><span>{profitError}</span><button type="button" className="text-button" onClick={() => void loadProfitIntervalReport()} disabled={profitLoading}>重试</button></div>}
              {!profitReport && !profitError && <div className="empty-state ranking-empty"><Gauge size={18} /><span>归档日期范围后查看收益；仅保存脱敏后的账本字段，不保存或展示原始管理员用量明细。</span></div>}
              {profitReport && <>
                <div className={`admin-console-note ${profitReport.coverage.state === 'complete' ? '' : 'warning'}`} title={profitCoverageLabel(profitReport)}><strong>覆盖范围：</strong><span>{profitCoverageLabel(profitReport)}</span></div>
                <div className="profit-summary-grid" aria-label="收益区间汇总">
                  <article className="admin-console-stat"><span>收入</span><strong>{formatBillingUnits(profitReport.totals.revenue)}</strong><em>站内实际扣费</em></article>
                  <article className="admin-console-stat"><span>免计费口径</span><strong>{formatBillingUnits(profitReport.totals.exemptRevenue)}</strong><em>{profitReport.totals.exemptRequests} 请求按成本 0</em></article>
                  <article className="admin-console-stat"><span>站内账号成本</span><strong>{formatBillingUnits(profitReport.totals.accountCost)}</strong><em>账号倍率口径</em></article>
                  <article className="admin-console-stat"><span>实际上游成本</span><strong>{formatBillingUnits(profitReport.totals.upstreamCost)}</strong><em>已成功追溯</em></article>
                  <article className="admin-console-stat"><span>可归因毛利</span><strong className={profitReport.totals.attributableRevenue < 0 ? 'danger-text' : profitReport.totals.attributableRevenue > 0 ? 'success-text' : undefined}>{formatBillingUnits(profitReport.totals.attributableRevenue)}</strong><em>{profitReport.totals.exemptRevenue > 0 ? '含免计费口径' : `亏损请求 ${profitReport.totals.lossRequests}`}</em></article>
                  <article className="admin-console-stat"><span>待归因收入</span><strong className={profitReport.totals.unattributedRevenue > 0 ? 'warning-text' : undefined}>{formatBillingUnits(profitReport.totals.unattributedRevenue)}</strong><em>来源历史不足</em></article>
                </div>
                {profitReport.internalUsage.requests > 0 && <div className="admin-console-note internal-usage-note"><UserRoundCheck size={14} /><span><strong>内部自用消耗：</strong>{profitReport.internalUsage.requests} 请求已排除经营核算 · 站内扣费参考 {formatBillingUnits(profitReport.internalUsage.stationCharge)} · 可追溯上游 {formatBillingUnits(profitReport.internalUsage.upstreamCost)}{profitReport.internalUsage.unresolvedUpstreamRequests > 0 ? ` · ${profitReport.internalUsage.unresolvedUpstreamRequests} 条上游待追溯` : ''}</span></div>}
                {profitReport.publicWelfareUsage.requests > 0 && <div className="admin-console-note internal-usage-note"><Archive size={14} /><span><strong>公益分组参考：</strong>{profitReport.publicWelfareUsage.requests} 请求已排除经营核算 · 站内扣费参考 {formatBillingUnits(profitReport.publicWelfareUsage.stationCharge)} · 可追溯上游 {formatBillingUnits(profitReport.publicWelfareUsage.upstreamCost)}{profitReport.publicWelfareUsage.unresolvedUpstreamRequests > 0 ? ` · ${profitReport.publicWelfareUsage.unresolvedUpstreamRequests} 条上游待追溯` : ''}</span></div>}
                {profitReport.unidentifiedUserRequests > 0 && <div className="admin-console-note warning"><AlertTriangle size={14} /><span>{profitReport.unidentifiedUserRequests} 条归档用量未返回用户 ID，已按普通经营记录核算；无法安全应用内部自用排除。</span></div>}
                <section className="profit-breakdown-section">
                  <div className="profit-breakdown-heading"><strong>{profitGranularity === 'hour' ? '按小时' : '按天'}明细</strong><span>{profitReport.buckets.length} 个区间</span></div>
                  {profitReport.buckets.length === 0 ? <div className="empty-state ranking-empty"><SlidersHorizontal size={18} /><span>该区间没有可核算的严格用量记录。</span></div> : <div className="profit-bucket-list">
                    {profitReport.buckets.map((bucket) => <div className="profit-bucket-row" key={bucket.key}>
                      <strong>{bucket.label}</strong><span>{bucket.requests} 请求</span><span title="站内实际扣费">收入 {formatBillingUnits(bucket.revenue)}</span><span title="已按当时上游倍率追溯">上游 {formatBillingUnits(bucket.upstreamCost)}</span><span className={bucket.attributableRevenue < 0 ? 'danger-text' : bucket.attributableRevenue > 0 ? 'success-text' : undefined} title={bucket.exemptRevenue > 0 ? `其中 ${formatBillingUnits(bucket.exemptRevenue)} 为免计费口径` : undefined}>毛利 {formatBillingUnits(bucket.attributableRevenue)}{bucket.exemptRevenue > 0 ? ' · 含免计费' : ''}</span><span className={bucket.unattributedRevenue > 0 ? 'warning-text' : undefined}>待归因 {formatBillingUnits(bucket.unattributedRevenue)}</span>
                    </div>)}
                  </div>}
                </section>
                <section className="profit-breakdown-section">
                  <div className="profit-breakdown-heading"><strong>账号与售卖分组</strong><span>优先显示亏损与待归因关系</span></div>
                  {profitReport.accounts.length === 0 ? <div className="empty-state ranking-empty"><SlidersHorizontal size={18} /><span>没有符合当前账号和分组筛选的记录。</span></div> : <div className="profit-account-list">
                    {profitReport.accounts.map((account) => {
                      const accountName = selectedConsoleSnapshot?.accounts.find((item) => item.id === account.accountId)?.name ?? `账号 #${account.accountId}`
                      const groupName = account.sellingGroupId === undefined ? '未标记售卖分组' : selectedConsoleSnapshot?.groups.find((item) => item.id === account.sellingGroupId)?.name ?? `分组 #${account.sellingGroupId}`
                      return <div className="profit-account-row" key={`${account.accountId}:${account.sellingGroupId ?? ''}`}>
                        <div><strong>{accountName}</strong><span>{groupName} · {account.requests} 请求</span></div><span>收入 {formatBillingUnits(account.revenue)}</span><span>上游 {formatBillingUnits(account.upstreamCost)}</span><span className={account.attributableRevenue < 0 ? 'danger-text' : account.attributableRevenue > 0 ? 'success-text' : undefined} title={account.exemptRevenue > 0 ? `其中 ${formatBillingUnits(account.exemptRevenue)} 为免计费口径` : undefined}>毛利 {formatBillingUnits(account.attributableRevenue)}{account.exemptRevenue > 0 ? ' · 含免计费' : ''}</span><span className={account.unattributedRevenue > 0 ? 'warning-text' : undefined}>待归因 {formatBillingUnits(account.unattributedRevenue)}</span>
                      </div>
                    })}
                  </div>}
                </section>
              </>}
            </div>
          )}

          {selectedConsoleStation && stationConsoleTab === 'groups' && (
            <div className="admin-console-section">
              <div className="admin-console-summary">
                <article className="admin-console-stat"><span>分组</span><strong>{selectedConsoleSnapshot?.groups.length ?? 0}</strong><em>当前站点可见分组</em></article>
                <article className="admin-console-stat"><span>隐藏</span><strong>{selectedConsoleStation ? countHiddenGroupsForRows(allComparisonRows.filter((row) => row.stationId === selectedConsoleStation.id), hiddenGroupKeys) : 0}</strong><em>本机隐藏偏好</em></article>
                <article className="admin-console-stat"><span>涨跌</span><strong>{observedRateChangeEvents.filter((event) => event.stationId === selectedConsoleStation.id).length}</strong><em>本机观察到的倍率变化</em></article>
              </div>
              <div className="mini-group-list inline">
                {categoryGroups(selectedConsoleStation, selectedConsoleSnapshot).length === 0 && <div className="empty-state compact-empty"><SlidersHorizontal size={18} /><span>当前没有可见分组，或分类筛选后为空。</span></div>}
                {categoryGroups(selectedConsoleStation, selectedConsoleSnapshot).map((group) => {
                  const latestChange = latestVisibleGroupChangeFor(selectedConsoleStation.id, group.id, visibleGroupChangeEvents)
                  const groupKey = groupPreferenceKey(selectedConsoleStation.id, group.id)
                  const hidden = hiddenGroupKeys.has(groupKey)
                  const manualTags = manualGroupTags[groupKey]
                  const groupTags = resolveGroupCapabilityTags(group, manualTags)
                  const groupAccounts = accountsForGroup(selectedConsoleSnapshot?.accounts ?? [], group.id)
                  const expanded = expandedAdminGroupKeys.has(groupKey)
                  return (
                    <article className={hidden ? 'admin-group-card hidden' : 'admin-group-card'} key={group.id}>
                      <div className="mini-group-row">
                        <button type="button" className={hidden ? 'group-visibility-button hidden' : 'group-visibility-button'} title={hidden ? '恢复到价格榜显示' : '从价格榜隐藏'} aria-label={`${hidden ? '恢复到价格榜显示' : '从价格榜隐藏'} ${selectedConsoleStation.name} 的 ${group.name}`} aria-pressed={hidden} onClick={() => setGroupHiddenState(groupKey, group.name, !hidden)}>
                          {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                        <button type="button" className="mini-group-main admin-group-expand-trigger" aria-expanded={expanded} onClick={() => toggleAdminGroupExpanded(groupKey)} title={expanded ? '收起分组账号' : '展开分组账号'}>
                          <strong>{group.name}</strong>
                          <span className="mini-group-meta">
                            <em>{group.platform}</em>
                            {groupTags.map((tag) => <span key={tag.id} className={`capability-tag mini tag-${tag.id}`}>{tag.label}</span>)}
                            {groupSpecialTags(group).map((tag) => <span key={tag.key} className={`special-group-tag ${tag.tone}`} title={tag.title}>{tag.label}</span>)}
                            {manualTags && <span className="manual-tag-badge">手动</span>}
                            <span className="group-account-count">{groupAccounts.length} 账号</span>
                            {latestChange && <span className={`group-change-badge ${latestChange.kind}`} title={groupChangeTooltip(latestChange)}>{changeKindLabel(latestChange.kind)}</span>}
                          </span>
                        </button>
                        {latestChange && <button type="button" className="icon-button compact-icon-button" title="查看分组价格走势" onClick={() => openGroupHistory(latestChange)}><Activity size={14} /></button>}
                        <button type="button" className="rate-value" title="当前倍率" onClick={() => { if (latestChange) openGroupHistory(latestChange) }}>{formatRateMultiplier(group.userRateMultiplier ?? group.rateMultiplier)}</button>
                        <button type="button" className="icon-button compact-icon-button" title={expanded ? '收起账号' : '展开账号'} aria-label={expanded ? `收起 ${group.name} 的账号` : `展开 ${group.name} 的账号`} aria-expanded={expanded} onClick={() => toggleAdminGroupExpanded(groupKey)}>
                          <ChevronDown size={14} className={expanded ? 'rotate-open' : undefined} />
                        </button>
                      </div>
                      {expanded && (
                        <div className="admin-group-account-list" aria-label={`${group.name} 下的账号`}>
                          {groupAccounts.length === 0
                            ? <div className="admin-group-account-empty"><LockKeyhole size={14} /><span>当前没有账号绑定这个分组。</span></div>
                            : groupAccounts.map((account) => (
                                <div className="admin-group-account-row" key={account.id}>
                                  <button type="button" className="admin-group-account-main" onClick={() => focusAdminAccount(selectedConsoleStation, account)} title="跳转到账号并查看候选趋势">
                                    <strong>{account.name}</strong>
                                    <em>{account.platform || '账号'} · {account.status || 'active'} · {account.groups.length} 个分组</em>
                                  </button>
                                  <button type="button" className="outline-button compact" onClick={() => beginRemoveAccountFromGroup(selectedConsoleStation, account, group.id, group.name)}>
                                    <Trash2 size={13} /> 移出分组
                                  </button>
                                </div>
                              ))}
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            </div>
          )}

          {selectedConsoleStation && stationConsoleTab === 'channels' && (
            <div className="admin-console-section">
              <div className="admin-console-summary">
                <article className="admin-console-stat"><span>渠道组</span><strong>{selectedConsoleSnapshot?.groups.length ?? 0}</strong><em>当前分组列表</em></article>
                <article className="admin-console-stat"><span>可比价</span><strong>{selectedConsoleSnapshot?.groups.filter((group) => group.pricingAvailable).length ?? 0}</strong><em>可展示模型价格</em></article>
                <article className="admin-console-stat"><span>后台渠道</span><strong>{adminConsoleChannels.length}</strong><em>独立渠道接口返回</em></article>
              </div>
              {adminConsoleChannels.length > 0 && <div className="admin-console-list compact">
                <div className="admin-console-list-title">后台渠道清单</div>
                {adminConsoleChannels.map((record, index) => (
                  <article className="admin-console-row" key={`${adminRecordLabel(record, 'channel')}-${index}`}>
                    <div className="admin-console-row-main">
                      <strong>{adminRecordLabel(record, `渠道 ${index + 1}`)}</strong>
                      <span>{adminRecordMeta(record) || '渠道配置 / 分组映射'}</span>
                    </div>
                    <div className="admin-console-row-fields">
                      {adminRecordFields(record, ['name', 'title', 'platform', 'status', 'type']).map((field) => <em key={field.label}>{field.label} · {field.value}</em>)}
                    </div>
                  </article>
                ))}
              </div>}
              <div className="ranking-table compact-console-table">
                {sortedGroupSwitchOptions(selectedConsoleSnapshot?.groups ?? [], selectedConsoleStation.rechargeRatio).map((option, index) => (
                  <div className="ranking-row compact" key={option.group.id}>
                    <span className="rank-index">{index + 1}</span>
                    <span className="rank-model">
                      <span className="rank-tags">
                        <span className="platform-tag">{option.group.platform}</span>
                        {resolveGroupCapabilityTags(option.group).map((tag) => <span key={tag.id} className={`capability-tag tag-${tag.id}`}>{tag.label}</span>)}
                        {groupSpecialTags(option.group).map((tag) => <span key={tag.key} className={`special-group-tag ${tag.tone}`} title={tag.title}>{tag.label}</span>)}
                      </span>
                      <strong>{option.group.name}</strong>
                      <em>{selectedConsoleStation.name} · {formatRateMultiplier(option.rate)}</em>
                    </span>
                    <span className="rank-source"><strong>{selectedConsoleStation.name}</strong><em>{formatRechargeRatio(selectedConsoleStation.rechargeRatio)}</em></span>
                    <span className="rank-effective">{formatRateMultiplier(option.effectiveMultiplier)}</span>
                    <span className={option.group.pricingAvailable ? 'rank-price' : 'rank-price muted'} title={option.group.pricingHint ?? '价格接口未启用'}>
                      {option.group.pricingAvailable
                        ? <><strong>{option.group.pricingHint ?? '模型价格已提供'}</strong><em>最终倍率 {formatRateMultiplier(option.effectiveMultiplier)}</em></>
                        : <><strong>未提供价格</strong><em>看最终倍率</em></>}
                    </span>
                    <span />
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedConsoleStation && stationConsoleTab === 'platforms' && (
            <div className="admin-console-section">
              <div className="admin-console-summary">
                <article className="admin-console-stat"><span>平台分类</span><strong>{categoryTabs.length - 2}</strong><em>Anthropic / OpenAI / Gemini / Antigravity / Grok</em></article>
                <article className="admin-console-stat"><span>本站分组</span><strong>{selectedConsoleStationRows.length}</strong><em>按最终倍率与价格汇总</em></article>
                <article className="admin-console-stat"><span>平台记录</span><strong>{adminConsolePlatforms.length}</strong><em>独立平台接口返回</em></article>
              </div>
              <div className="admin-console-grid">
                {categoryTabs.filter((category) => category.id !== 'all').map((category) => {
                  const rows = selectedConsoleStationRows.filter((row) => row.category === category.id)
                  const bestRow = [...rows].sort((left, right) => left.effectiveMultiplier - right.effectiveMultiplier)[0]
                  return (
                    <article className="admin-console-stat admin-console-stat-wide" key={category.id}>
                      <span>{category.label}</span>
                      <strong>{rows.length}</strong>
                      <em>{rows.length > 0 ? `最低 ${formatRateMultiplier(bestRow.effectiveMultiplier)} · ${bestRow.modelName}` : '暂无分组'}</em>
                    </article>
                  )
                })}
              </div>
              {adminConsolePlatforms.length > 0 && <div className="admin-console-list compact">
                <div className="admin-console-list-title">平台配置清单</div>
                {adminConsolePlatforms.map((record, index) => (
                  <article className="admin-console-row" key={`${adminRecordLabel(record, 'platform')}-${index}`}>
                    <div className="admin-console-row-main">
                      <strong>{adminRecordLabel(record, `平台 ${index + 1}`)}</strong>
                      <span>{adminRecordMeta(record) || '平台分组 / 配额 / 状态'}</span>
                    </div>
                    <div className="admin-console-row-fields">
                      {adminRecordFields(record, ['name', 'title', 'platform', 'status', 'type', 'model']).map((field) => <em key={field.label}>{field.label} · {field.value}</em>)}
                    </div>
                  </article>
                ))}
              </div>}
            </div>
          )}

          {selectedConsoleStation && stationConsoleTab === 'usage' && (
            <div className="admin-console-section">
              <div className="admin-console-summary">
                <article className="admin-console-stat"><span>统计项</span><strong>{adminConsoleUsage.length}</strong><em>当前站点返回的用量记录</em></article>
                <article className="admin-console-stat"><span>请求</span><strong>{adminConsoleUsage.reduce((sum, record) => sum + (typeof record.requests === 'number' ? record.requests : Number(record.requests) || 0), 0).toLocaleString('zh-CN')}</strong><em>累计请求数</em></article>
                <article className="admin-console-stat"><span>费用</span><strong>{adminConsoleUsage.reduce((sum, record) => sum + (typeof record.cost === 'number' ? record.cost : Number(record.cost) || 0), 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</strong><em>累计消耗</em></article>
              </div>
              <div className={`usage-capability-card ${usageCapabilityTone(selectedUsageDiagnostic.precision)}`}>
                <div className="usage-capability-main">
                  <span className="usage-capability-badge">{selectedUsageDiagnostic.precisionLabel}</span>
                  <div>
                    <strong>接口可用性</strong>
                    <em>{selectedUsageDiagnostic.summary}</em>
                  </div>
                </div>
                <button type="button" className="outline-button compact" onClick={() => setUsageDiagnosticOpen(true)}>查看字段</button>
              </div>
              <div className="admin-console-list">
                {adminConsoleUsage.length > 0
                  ? adminConsoleUsage.map((record, index) => (
                      <article className="admin-console-row" key={`${adminRecordLabel(record, 'usage')}-${index}`}>
                        <div className="admin-console-row-main">
                          <strong>{adminRecordLabel(record, `用量 ${index + 1}`)}</strong>
                          <span>{adminRecordMeta(record) || '统计周期'}</span>
                        </div>
                        <div className="admin-console-row-fields">
                          {adminRecordFields(record, ['requests', 'tokens', 'cost', 'period', 'date']).map((field) => <em key={field.label}>{field.label} · {field.value}</em>)}
                        </div>
                      </article>
                    ))
                  : <div className="empty-state compact-empty"><Gauge size={18} /><span>当前站点没有返回用量统计；可在后台开启统计或补录路径。</span></div>}
              </div>
            </div>
          )}

          {selectedConsoleStation && stationConsoleTab === 'settings' && (
            <div className="admin-console-section">
              <div className="admin-console-summary">
                <article className="admin-console-stat"><span>站点</span><strong>{selectedConsoleStation.name}</strong><em>{selectedConsoleStation.baseUrl}</em></article>
                <article className="admin-console-stat"><span>充值比例</span><strong>{formatRechargeRatio(selectedConsoleStation.rechargeRatio)}</strong><em>价格对比核心参数</em></article>
                <article className="admin-console-stat"><span>余额阈值</span><strong>{formatMoney(selectedConsoleStation.lowBalanceThreshold)}</strong><em>低余额提醒</em></article>
              </div>
              <div className="admin-console-list">
                {adminConsoleSettings.length > 0
                  ? adminConsoleSettings.map((record, index) => (
                      <article className="admin-console-row" key={`${adminRecordLabel(record, 'setting')}-${index}`}>
                        <div className="admin-console-row-main">
                          <strong>{adminRecordLabel(record, `设置 ${index + 1}`)}</strong>
                          <span>{adminRecordMeta(record) || '站点设置项'}</span>
                        </div>
                        <div className="admin-console-row-fields">
                          {adminRecordFields(record, ['value']).map((field) => <em key={field.label}>{field.label} · {field.value}</em>)}
                        </div>
                      </article>
                    ))
                  : <div className="empty-state compact-empty"><Settings size={18} /><span>当前没有返回站点设置项；可用“编辑”或“重新授权”补录。</span></div>}
              </div>
              <div className="station-console-actions">
                <button type="button" className="outline-button compact" onClick={() => openEdit(selectedConsoleStation)}><Settings size={14} /> 编辑站点</button>
                <button type="button" className="outline-button compact" onClick={() => void authorizeStationFor(stationLoginInput(selectedConsoleStation))}><LogIn size={14} /> 重新授权</button>
                <button type="button" className="outline-button compact" onClick={() => void window.aizzz.stations.refresh(selectedConsoleStation.id)}><RefreshCw size={14} /> 刷新后台</button>
              </div>
            </div>
          )}
        </div>
      )

  if (mode === 'bubble') {
    return (
      <div className="app-shell mode-bubble">
        <button className="bubble-button" title="打开 AIZZZWatch 紧凑窗口" onClick={() => void changeMode('compact')}>
          <Activity size={19} />
          <span className="bubble-balance">{formatMoney(totals.balance)}</span>
          <span className={totals.healthy === visibleStations.length ? 'bubble-health healthy' : 'bubble-health warning'} />
        </button>
      </div>
    )
  }

  return (
    <div className={`app-shell mode-${mode}`}>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Activity size={17} /></div>
          <div>
            <div className="brand-name">AIZZZWatch</div>
            <div className="brand-subtitle">Token 采购比价</div>
          </div>
        </div>
        <div className="top-actions">
          <div className="mode-switch" aria-label="窗口模式">
            <button className={mode === 'full' ? 'icon-button active' : 'icon-button'} title="完整窗口" onClick={() => void changeMode('full')}><Maximize2 size={15} /></button>
            <button className={mode === 'compact' ? 'icon-button active' : 'icon-button'} title="紧凑浮窗" onClick={() => void changeMode('compact')}><Minimize2 size={15} /></button>
            <button className="icon-button" title="气泡窗口" onClick={() => void changeMode('bubble')}><Circle size={15} /></button>
          </div>
          <button className={alwaysOnTop ? 'icon-button active' : 'icon-button'} title="固定在最顶层" onClick={() => void togglePin()}><Pin size={15} /></button>
          <button className="icon-button" title="刷新所有站点" onClick={() => void refreshAll()} disabled={refreshing}><RefreshCw className={refreshing ? 'spin' : ''} size={15} /></button>
          <button className="icon-button" title="站点设置" onClick={() => openEdit()}><Settings size={15} /></button>
        </div>
      </header>

      <main className="content">
        <section className="overview-strip" aria-label="总览和视角切换">
          <div className="view-switch" aria-label="工作视角">
            <button type="button" className={workspaceView === 'pricing' ? 'view-switch-button active' : 'view-switch-button'} aria-pressed={workspaceView === 'pricing'} onClick={() => setWorkspaceView('pricing')}>查价视图</button>
            <button type="button" className={workspaceView === 'stations' ? 'view-switch-button active' : 'view-switch-button'} aria-pressed={workspaceView === 'stations'} onClick={() => setWorkspaceView('stations')}>我的站点</button>
            <button type="button" className={workspaceView === 'integration' ? 'view-switch-button active' : 'view-switch-button'} aria-pressed={workspaceView === 'integration'} onClick={() => setWorkspaceView('integration')}>数据接入</button>
            <button type="button" className={workspaceView === 'data' ? 'view-switch-button active' : 'view-switch-button'} aria-pressed={workspaceView === 'data'} onClick={() => setWorkspaceView('data')}>数据中心</button>
          </div>
          <div className="overview-metrics">
            <span><strong>{visibleStations.length}</strong> 来源 · {totals.healthy} 正常</span>
            <span><strong>{formatMoney(totals.balance)}</strong> 总余额</span>
            <span className="muted-overview">同步 {formatTime(totals.latest)}</span>
            <button
              type="button"
              className={changeLogOpen ? 'change-log-chip active' : 'change-log-chip'}
              aria-expanded={changeLogOpen}
              title="查看近期分组变化"
              onClick={() => setChangeLogOpen((current) => !current)}
            >
              涨跌 {observedRateChangeEvents.length}
            </button>
          </div>
        </section>

        {demoMode && <div className="demo-strip"><Gauge size={15} /><span>当前显示本地演示数据</span><button className="text-button" onClick={() => openEdit()}><Plus size={14} />添加真实站点</button></div>}

        <div className={`buying-grid view-${workspaceView}`}>
          <section className={workspaceView === 'stations' ? 'panel buying-panel station-admin-panel' : workspaceView === 'integration' ? 'panel buying-panel integration-panel' : workspaceView === 'data' ? 'panel buying-panel data-center-panel' : 'panel buying-panel'}>
            {workspaceView === 'stations' ? (
              <>
                <div className="panel-heading buying-heading">
                  <div><span className="eyebrow">MY STATION</span><h1>{stationConsoleTab === 'accounts' ? '我的站点账号' : `${selectedConsoleStation?.name ?? '我的站点'} · ${selectedConsoleTitle}`}</h1></div>
                  <div className="ranking-heading-actions">
                    <span className="last-seen">{stationConsoleTab === 'accounts' ? (selectedCategory === 'all' ? '全部分类' : `跟随 ${categoryLabel(selectedCategory)}`) : selectedConsoleStation ? (selectedConsoleSnapshot?.health === 'healthy' ? '后台正常' : healthLabel(selectedConsoleSnapshot)) : '先选一个站点'}</span>
                    <span className="last-seen">{stationConsoleTab === 'accounts' ? `${adminAccountRows.length}/${adminAccountCount} 个账号` : formatMoney(selectedConsoleSnapshot?.balance)}</span>
                  </div>
                </div>
                <div className="station-console-tabs" role="tablist" aria-label="管理台分区">
                  {stationConsoleTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={stationConsoleTab === tab.id}
                      className={stationConsoleTab === tab.id ? 'station-console-tab active' : 'station-console-tab'}
                      title={tab.hint}
                      onClick={() => setStationConsoleTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                {stationConsoleTab === 'accounts' ? (
                  <>
                <div className="station-admin-toolbar" aria-label="账号管理工具栏">
                  <input
                    type="search"
                    className="station-admin-search"
                    value={accountSearchQuery}
                    onChange={(event) => setAccountSearchQuery(event.target.value)}
                    placeholder="搜索账号、分组、站点或平台"
                    aria-label="搜索我的站点账号"
                  />
                  <label className="station-admin-strategy">
                    <span>调度</span>
                    <select
                      value={accountScheduleFilter}
                      onChange={(event) => setAccountScheduleFilter(event.target.value as AccountScheduleFilter)}
                      aria-label="账号调度筛选"
                    >
                      {accountScheduleFilterOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="station-admin-strategy">
                    <span>渠道</span>
                    <select
                      value={accountPlatformFilter}
                      onChange={(event) => setAccountPlatformFilter(event.target.value)}
                      aria-label="账号渠道筛选"
                    >
                      <option value="all">全部渠道</option>
                      {accountPlatformOptions.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
                    </select>
                  </label>
                  <label className="station-admin-strategy account-group-filter">
                    <span>分组</span>
                    <select
                      value={accountGroupFilter}
                      onChange={(event) => setAccountGroupFilter(event.target.value)}
                      aria-label="账号所在分组筛选"
                    >
                      <option value="all">全部分组</option>
                      {accountGroupFilterOptions.map((option) => <option key={option.id} value={option.id}>{option.label} · {option.count}</option>)}
                    </select>
                  </label>
                  <label className="station-admin-strategy">
                    <span>策略</span>
                    <select
                      value={accountRecommendationStrategy}
                      onChange={(event) => setAccountRecommendationStrategy(event.target.value as AccountRecommendationStrategy)}
                      title={accountRecommendationStrategyOptions.find((option) => option.id === accountRecommendationStrategy)?.hint}
                      aria-label="批量推荐策略"
                    >
                      {accountRecommendationStrategyOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <button type="button" className="outline-button compact" disabled={batchRecommendationRows.length === 0} onClick={beginBatchRecommendationQueue}>
                    批量推荐 {batchRecommendationRows.length}
                  </button>
                </div>
                {batchMutationResults.length > 0 && (
                  <div className="batch-result-panel" aria-label="批量切组结果">
                    <div className="batch-result-heading">
                      <div><span className="eyebrow">BATCH RESULT</span><h2>批量结果</h2></div>
                      <div className="batch-result-summary">
                        <span className="success">成功 {batchResultCounts.success}</span>
                        <span className="failed">失败 {batchResultCounts.failed}</span>
                        <span>跳过 {batchResultCounts.skipped}</span>
                      </div>
                      <button type="button" className="text-button" onClick={() => setBatchMutationResults([])}>清空</button>
                    </div>
                    <div className="batch-result-list">
                      {batchMutationResults.map((result) => <div className={`batch-result-row ${result.status}`} key={result.id}>
                        <span className="batch-result-status">{result.status === 'success' ? '成功' : result.status === 'failed' ? '失败' : '跳过'}</span>
                        <span className="batch-result-main"><strong>{result.accountName}</strong><em>{result.stationName} · {result.targetLabel}{result.message ? ` · ${result.message}` : ''}</em></span>
                        <time>{formatTime(result.occurredAt)}</time>
                      </div>)}
                    </div>
                  </div>
                )}
                <div className="station-admin-board" aria-label="我的站点账号管理">
                  {adminStations.length === 0 && <div className="empty-state ranking-empty"><LockKeyhole size={18} /><span>当前来源没有可管理账号；请在站点设置里补充管理员凭据并同步。</span></div>}
                  {adminStations.length > 0 && visibleAdminStations.length === 0 && <div className="empty-state ranking-empty"><SlidersHorizontal size={18} /><span>当前搜索或调度筛选下没有匹配账号，换个关键词或切换调度筛选试试。</span></div>}
                  {visibleAdminStations.map(({ station, snapshot }) => {
                    const accounts = snapshot?.accounts ?? []
                    const rows = adminAccountRows.filter((row) => row.station.id === station.id)
                    const balanceLow = isStationBalanceLow(snapshot?.balance, station.lowBalanceThreshold)
                    return <article className={station.id === selectedStation?.id ? 'station-admin-card selected' : 'station-admin-card'} key={station.id}>
                      <div className="station-admin-heading">
                        <button type="button" className="station-admin-title" onClick={() => focusFirstAdminAccount(station, snapshot)}>
                          <span className={`health-dot ${snapshot?.health ?? 'loading'}`} />
                          <span><strong>{station.name}</strong><em>{formatRechargeRatio(station.rechargeRatio)} · {healthLabel(snapshot)}</em></span>
                        </button>
                        <div className="station-admin-wallet">
                          <span className={balanceLow ? 'low-balance-text' : undefined}>{formatMoney(snapshot?.balance)}</span>
                          <em>{rows.length}/{accounts.length} 账号</em>
                        </div>
                      </div>
                      {balanceLow && <div className="inline-alert balance-alert station-admin-alert"><AlertTriangle size={14} /><span>余额低于 {formatMoney(station.lowBalanceThreshold)}，建议先充值。</span></div>}
                      {accounts.length === 0
                        ? <div className="empty-state compact-empty"><LockKeyhole size={18} /><span>已配置管理员凭据，但本次同步未返回账号列表。</span></div>
                        : <div className="admin-account-list">
                            {rows.map(({ account, recommendation, currentGroups }) => {
                              const focusKey = accountFocusKey(station.id, account.id)
                              const isFocused = focusedAdminAccountRow?.focusKey === focusKey
                              const scheduleState = accountScheduleState(account)
                              const blockedText = accountRecommendationBlockedText(account)
                              const accountKey = accountUpstreamMappingKey(station.id, account.id)
                              const mapping = accountMappingByKey.get(accountKey)
                              const sourceStation = mapping ? sourceStations.find((item) => item.id === mapping.sourceStationId) : undefined
                              const sourceResolution = resolveAccountUpstreamMappingSource(mapping, mapping ? visibleSnapshots[mapping.sourceStationId] : undefined)
                              const sourceStatus = accountSourceStatus(account, mapping, sourceStation, sourceResolution, thirdPartySourceStations, visibleSnapshots)
                              const costProfile = accountCostProfileByKey.get(accountKey)
                              const costStatus = accountCostStatus(costProfile, sourceStatus.tone === 'ready')
                              return <div className={`${isFocused ? 'admin-account-row selected' : 'admin-account-row'} ${scheduleState !== 'enabled' ? 'schedule-muted' : ''}`} key={account.id}>
                                <div className="admin-account-identity">
                                  <button type="button" className="admin-account-main admin-account-focus-trigger" onClick={() => focusAdminAccount(station, account)} aria-pressed={isFocused}>
                                    <span className="admin-account-title-line">
                                      <strong title={account.name}>{account.name}</strong>
                                      <em>账号 #{account.id}</em>
                                    </span>
                                    <span className="rank-tags"><span className="platform-tag">{account.platform || '账号'}</span><span className="capability-tag mini tag-chat">{account.status || 'active'}</span><span className={`account-schedule-badge ${scheduleState}`}>{accountScheduleLabel(account)}</span></span>
                                  </button>
                                  <div className="account-status-strip" aria-label={`${account.name} 状态`}>
                                    <AccountStateBadge status={sourceStatus} ariaLabel={`${account.name} 来源状态`} onClick={() => openAccountMappingEditor(station, account)} />
                                    <AccountStateBadge status={costStatus} ariaLabel={`${account.name} 成本状态`} onClick={() => openAccountCostProfileEditor(station, account)} />
                                  </div>
                                  <div className="account-current-groups-block">
                                    <span className="account-section-label">所在分组 · {currentGroups.length || account.groupIds.length} 个</span>
                                    <div className="account-group-chip-list">
                                      {currentGroups.length > 0
                                        ? currentGroups.map((option) => {
                                            const canRemoveGroup = currentGroups.length > 1
                                            return <span className="account-group-chip full" key={option.group.id}>
                                              <span title={`${option.group.name} · ${formatRateMultiplier(option.effectiveMultiplier)}`}>{option.group.name} · {formatRateMultiplier(option.effectiveMultiplier)}</span>
                                              <button
                                                type="button"
                                                disabled={!canRemoveGroup}
                                                title={canRemoveGroup ? `从 ${account.name} 移除 ${option.group.name}` : '至少保留一个分组'}
                                                aria-label={canRemoveGroup ? `从 ${account.name} 移除 ${option.group.name}` : `${account.name} 至少保留一个分组`}
                                                onClick={() => beginRemoveAccountFromGroup(station, account, option.group.id, option.group.name)}
                                              >
                                                <X size={12} />
                                              </button>
                                            </span>
                                          })
                                        : <span className="account-group-chip empty"><span>未绑定分组</span></span>}
                                    </div>
                                  </div>
                                </div>
                                <div className="admin-account-side">
                                  <div className="admin-account-current" title={accountCurrentEffectiveTitle(snapshot?.groups ?? [], account.groupIds, station.rechargeRatio)}>
                                    <span>当前组合最低</span>
                                    <strong>{accountCurrentEffectiveLabel(snapshot?.groups ?? [], account.groupIds, station.rechargeRatio)}</strong>
                                    {currentGroups.length > 0 && <em title="当前保留组合，点击目标可增删">当前保留组合，点击目标可增删</em>}
                                  </div>
                                  <div className={accountRecommendationTone(currentGroups.length, recommendation?.safeForAccount) === 'safe' ? 'account-recommendation safe' : 'account-recommendation'}>
                                    <span>{blockedText?.label ?? accountRecommendationLabel(currentGroups.length, recommendation?.safeForAccount)}</span>
                                    {blockedText
                                      ? <>
                                          <strong title={blockedText.title}>{blockedText.title}</strong>
                                          <em title={blockedText.detail}>{blockedText.detail}</em>
                                        </>
                                      : recommendation
                                      ? <>
                                          <strong title={recommendation.option.group.name}>{recommendation.option.group.name}</strong>
                                          <em title={`${recommendation.scopeLabel} · 最终 ${formatRateMultiplier(recommendation.option.effectiveMultiplier)}`}>{recommendation.scopeLabel} · 最终 {formatRateMultiplier(recommendation.option.effectiveMultiplier)}</em>
                                        </>
                                      : <>
                                          <strong title="暂无候选">暂无候选</strong>
                                          <em title="换分类、标签或恢复隐藏分组后再试">换分类、标签或恢复隐藏分组后再试</em>
                                        </>}
                                  </div>
                                </div>
                                <div className="admin-account-actions">
                                  {recommendation && <button type="button" className="outline-button compact" onClick={() => beginAccountSwitch(station, account, recommendation.option.group.id)}>{accountRecommendationActionLabel(currentGroups.length, recommendation.safeForAccount)}</button>}
                                  <button type="button" className="outline-button compact" onClick={() => openAccountCostProfileEditor(station, account)}>设置账号成本</button>
                                  <button type="button" className="outline-button compact" onClick={() => openAccountMappingEditor(station, account)}>关联上游密钥</button>
                                  <button type="button" className="primary-button compact" onClick={() => beginAccountSwitch(station, account)}>调整组合 <ChevronDown size={14} /></button>
                                </div>
                                {isFocused && renderStationAccountFocus()}
                              </div>
                            })}
                          </div>}
                    </article>
                  })}
                </div>
                  </>
                ) : stationConsoleContent}
              </>
            ) : workspaceView === 'integration' ? (
              <>
                <div className="panel-heading buying-heading integration-heading">
                  <div><span className="eyebrow">INTEGRATION</span><h1>接口适配中心</h1></div>
                  <div className="integration-actions">
                    <button type="button" className="outline-button compact" onClick={() => setIntegrationDraft(integrationStation ? integrationDraftFromStation(integrationStation) : null)} disabled={!integrationStation || mappingSaving}>恢复已保存</button>
                    <button type="button" className="outline-button compact" onClick={() => integrationStation && setIntegrationDraft({ apiPaths: { ...integrationStation.apiPaths }, readMapping: { version: 1, template: integrationTemplateFor(integrationStation), capabilities: {} } })} disabled={!integrationStation || mappingSaving}>清除自定义字段</button>
                    <button type="button" className="outline-button compact" onClick={() => void previewIntegrationMapping()} disabled={!integrationStation || !integrationDraft || mappingPreviewing || mappingSaving}>{mappingPreviewing ? <LoaderCircle className="spin" size={14} /> : <Search size={14} />}{mappingPreviewing ? '检测中' : '检测并预览'}</button>
                    <button type="button" className="primary-button compact" onClick={() => void saveIntegrationMapping()} disabled={!integrationStation || !integrationDraft || mappingSaving || mappingPreviewing}>{mappingSaving ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{mappingSaving ? '保存中' : '保存适配'}</button>
                  </div>
                </div>
                {!integrationStation || !integrationDraft ? (
                  <div className="empty-state ranking-empty"><SlidersHorizontal size={18} /><span>先添加并保存一个三方站点，再在这里配置它的只读数据接入。</span></div>
                ) : integrationStation.adapterType === 'newapi' ? (
                  <div className="integration-empty"><ShieldCheck size={18} /><strong>NewAPI 使用内置只读适配器</strong><span>它会读取当前用户可用分组、固定定价和令牌所属分组，并进入价格榜；二开差异请通过站点设置中的五个明确路径配置，不开放任意字段映射。</span></div>
                ) : (
                  <div className="integration-workspace">
                    <div className="integration-station-strip" role="tablist" aria-label="选择要适配的站点">
                      {sourceStations.map((station) => <button key={station.id} type="button" role="tab" aria-selected={station.id === integrationStation.id} className={station.id === integrationStation.id ? 'integration-station-tab active' : 'integration-station-tab'} onClick={() => setSelectedId(station.id)}><strong>{station.name}</strong><span>{stationAdapterLabel(station)}</span></button>)}
                    </div>
                    <div className="integration-summary">
                      <div><span>站点</span><strong title={integrationStation.apiBaseUrl ?? integrationStation.baseUrl}>{integrationStation.name}</strong></div>
                      <div><span>模板</span><select value={integrationDraft.readMapping.template} onChange={(event) => setIntegrationDraft((current) => current ? { ...current, readMapping: { ...current.readMapping, template: event.target.value as StationReadMapping['template'] } } : current)} aria-label="读取模板"><option value="sub2api">Sub2API</option><option value="lcodex">lcodex</option><option value="aihub">AIHub</option><option value="custom">自定义兼容</option></select></div>
                      <div><span>API 根</span><strong title={integrationStation.apiBaseUrl ?? integrationStation.baseUrl}>{(integrationStation.apiBaseUrl ?? integrationStation.baseUrl).replace(/^https?:\/\//, '')}</strong></div>
                      <div><span>授权</span><strong>{integrationStation.hasAccessToken ? '已保存' : '未授权'}</strong></div>
                    </div>
                    <div className="integration-note"><ShieldCheck size={15} /><span>只支持同源 HTTPS GET 和点路径，例如 <code>data.items</code>。检测仅展示字段、数量和摘要，不保存令牌、Cookie 或原始响应。</span></div>
                    <div className="integration-capability-list">
                      {stationReadCapabilities.map((capability) => {
                        const definition = mappingFieldDefinitions[capability]
                        const config = integrationDraft.readMapping.capabilities[capability] ?? {}
                        const preview = mappingPreview?.capabilities.find((item) => item.capability === capability)
                        const isProfile = capability === 'profile'
                        return <section className="integration-capability" key={capability}>
                          <header>
                            <div><span className="eyebrow">{capability.toUpperCase()}</span><h2>{isProfile ? '钱包余额' : capability === 'groups' ? '分组' : capability === 'rates' ? '倍率' : capability === 'channels' ? '模型价格' : '上游密钥'}</h2></div>
                            <span className={preview ? `integration-status ${preview.state}` : 'integration-status'}>{preview?.state === 'ready' ? '可用' : preview?.state === 'partial' ? '待补字段' : preview?.state === 'unavailable' ? '不可用' : '未检测'}</span>
                          </header>
                          <div className="integration-capability-controls">
                            <label>接口路径<input value={integrationDraft.apiPaths[capability] ?? ''} onChange={(event) => setIntegrationDraft((current) => current ? { ...current, apiPaths: { ...current.apiPaths, [capability]: event.target.value } } : current)} placeholder={defaultStationApiPaths[capability] ?? '例如 /api/v1/groups'} /></label>
                            <label>{isProfile ? '对象路径' : '列表路径'}<input value={isProfile ? config.objectPath ?? '' : config.recordsPath ?? ''} onChange={(event) => updateIntegrationCapability(capability, (current) => ({ ...current, [isProfile ? 'objectPath' : 'recordsPath']: event.target.value }))} placeholder={isProfile ? 'data' : 'data.items'} /></label>
                            {capability === 'rates' && <label>返回形态<select value={config.recordMode ?? 'list'} onChange={(event) => updateIntegrationCapability(capability, (current) => ({ ...current, recordMode: event.target.value as 'list' | 'keyed-map' }))}><option value="list">记录列表</option><option value="keyed-map">键值倍率表</option></select></label>}
                          </div>
                          {capability !== 'rates' || config.recordMode !== 'keyed-map' ? <div className="integration-field-grid">{definition.map((field) => <label key={field.key}><span>{field.label}{field.required && <b>必填</b>}</span><input value={config.fields?.[field.key] ?? ''} onChange={(event) => updateIntegrationCapability(capability, (current) => ({ ...current, fields: { ...current.fields, [field.key]: event.target.value } }))} placeholder={field.key} /></label>)}</div> : <div className="integration-field-help">键名会作为分组 ID，值会作为倍率；不需要额外字段映射。</div>}
                          <div className="integration-preview" aria-live="polite"><span>检测结果</span><strong title={preview?.detail ?? preview?.preview}>{preview ? (preview.preview ?? preview.detail ?? '接口已响应') : '尚未检测'}</strong><em>{preview ? `${preview.records} 条 · ${preview.path}` : '保存前可随时检测；不会写入远端站点。'}</em></div>
                        </section>
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : workspaceView === 'data' ? (
              <>
                <div className="panel-heading buying-heading">
                  <div><span className="eyebrow">DATA CENTER</span><h1>数据中心</h1></div>
                  <div className="ranking-heading-actions">
                    <span className="last-seen">{dataCenterSummary ? `检查 ${formatTime(dataCenterSummary.files.preferences.updatedAt ?? dataCenterSummary.files.stations.updatedAt)}` : '等待读取'}</span>
                    <button type="button" className="outline-button compact" onClick={() => void refreshDataCenterSummary()} disabled={dataCenterLoading}>
                      {dataCenterLoading ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} 刷新
                    </button>
                  </div>
                </div>
                {dataCenterError && <div className="inline-alert source-alert"><AlertTriangle size={15} /><span>{dataCenterError}</span><button type="button" className="text-button" onClick={() => void refreshDataCenterSummary()}>重试</button></div>}
                {!dataCenterSummary && !dataCenterError
                  ? <div className="empty-state ranking-empty"><LoaderCircle className="spin" size={18} /><span>正在读取本地数据摘要…</span></div>
                  : dataCenterSummary && (
                    <div className="data-center-body">
                      <div className="data-center-note">
                        <ShieldCheck size={16} />
                        <span>这里只显示脱敏计数和文件状态，不展示 token、cookie、原始站点配置或账号明细。</span>
                      </div>
                      <div className="data-center-summary" aria-label="本地数据概览">
                        <article className="admin-console-stat data-center-stat">
                          <span>站点</span>
                          <strong>{dataCenterSummary.stations.count}</strong>
                          <em>授权 {dataCenterSummary.stations.withAccessToken} · 管理员 {dataCenterSummary.stations.withAdminToken}</em>
                        </article>
                        <article className="admin-console-stat data-center-stat">
                          <span>变化历史</span>
                          <strong>{dataCenterSummary.preferences.groupChangeEvents}</strong>
                          <em>已隐藏提示 {dataCenterSummary.preferences.dismissedGroupChangeEventIds}</em>
                        </article>
                        <article className="admin-console-stat data-center-stat">
                          <span>隐藏分组</span>
                          <strong>{dataCenterSummary.preferences.hiddenGroupKeys}</strong>
                          <em>只影响价格榜和全部视图显示</em>
                        </article>
                        <article className="admin-console-stat data-center-stat">
                          <span>手动标签</span>
                          <strong>{dataCenterSummary.preferences.manualGroupTags}</strong>
                          <em>用于生图/代码/视觉等筛选</em>
                        </article>
                        <article className="admin-console-stat data-center-stat">
                          <span>上游映射</span>
                          <strong>{dataCenterSummary.preferences.accountUpstreamMappings}</strong>
                          <em>账号来源绑定，不含密钥原文</em>
                        </article>
                        <article className="admin-console-stat data-center-stat">
                          <span>账号成本</span>
                          <strong>{dataCenterSummary.preferences.accountCostProfiles}</strong>
                          <em>赠送/订阅/手动成本档案</em>
                        </article>
                        <article className="admin-console-stat data-center-stat">
                          <span>内部自用用户</span>
                          <strong>{dataCenterSummary.preferences.internalUserProfiles}</strong>
                          <em>仅本机经营核算排除</em>
                        </article>
                      </div>
                      <section className="data-center-section">
                        <div className="data-center-section-heading">
                          <div><span className="eyebrow">STORAGE</span><h2>本地数据位置</h2></div>
                          {dataCenterSummary.isCustomUserDataPath && <span className="data-center-badge">自定义目录</span>}
                        </div>
                        <div className="data-path-row">
                          <FolderOpen size={16} />
                          <span>{dataCenterSummary.userDataPath}</span>
                        </div>
                        <div className="data-file-grid">
                          <article className="data-file-card">
                            <Database size={16} />
                            <div>
                              <strong>站点配置</strong>
                              <span>{dataCenterSummary.files.stations.path}</span>
                              <em>{dataFileStatusText(dataCenterSummary.files.stations)}</em>
                            </div>
                          </article>
                          <article className="data-file-card">
                            <HardDrive size={16} />
                            <div>
                              <strong>界面偏好与历史</strong>
                              <span>{dataCenterSummary.files.preferences.path}</span>
                              <em>{dataFileStatusText(dataCenterSummary.files.preferences)}</em>
                            </div>
                          </article>
                        </div>
                      </section>
                      <section className="data-center-section">
                        <div className="data-center-section-heading">
                          <div><span className="eyebrow">NEXT</span><h2>后续可补</h2></div>
                          <span className="last-seen">当前版本只读</span>
                        </div>
                        <div className="data-center-actions" aria-label="后续数据管理能力">
                          <button type="button" className="outline-button compact" disabled title="后续实现：导出脱敏备份包">导出备份</button>
                          <button type="button" className="outline-button compact" disabled title="后续实现：导入前先预览差异，不直接覆盖">导入恢复</button>
                          <button type="button" className="outline-button compact" disabled title="后续实现：检查站点接口、凭据状态和本地文件权限">接口诊断</button>
                        </div>
                      </section>
                    </div>
                  )}
              </>
            ) : (
              <>
            <div className="panel-heading buying-heading">
              <div><span className="eyebrow">BUYING BOARD</span><h1>{categoryLabel(selectedCategory)} 价格榜</h1></div>
              <div className="ranking-heading-actions">
                {totalHiddenGroupCount > 0 && <button type="button" className={showHiddenGroups ? 'ghost-chip active' : 'ghost-chip'} title={visibleFilterHiddenGroupCount > 0 ? '显示或收起当前筛选里的隐藏分组' : '当前筛选没有隐藏项，点击后切到全部分组查看'} onClick={toggleShowHiddenGroups}>{showHiddenGroups ? '收起隐藏' : `已隐藏 ${totalHiddenGroupCount} 组`}</button>}
                <span className="last-seen">{rankingSortText(rankingSort)}</span>
              </div>
            </div>
            <div className="category-tabs" role="tablist" aria-label="模型分类">
              {categoryTabs.map((category) => <button key={category.id} type="button" className={category.id === selectedCategory ? 'category-tab active' : 'category-tab'} onClick={() => setSelectedCategory(category.id)}><span>{category.label}</span><strong>{categoryCounts.get(category.id) ?? 0}</strong></button>)}
            </div>
            <div className="tag-filter-tabs" role="tablist" aria-label="能力标签筛选">
              <button type="button" className={selectedTag === 'all' ? 'tag-filter-chip active' : 'tag-filter-chip'} aria-pressed={selectedTag === 'all'} onClick={() => setSelectedTag('all')}><span>全部标签</span><strong>{tagFilterTotalCount}</strong></button>
              {tagOptions.map((tag) => (
                <button
                  type="button"
                  key={tag.id}
                  className={selectedTag === tag.id ? `tag-filter-chip tag-${tag.id} active` : `tag-filter-chip tag-${tag.id}`}
                  aria-pressed={selectedTag === tag.id}
                  onClick={() => setSelectedTag(tag.id)}
                >
                  <span>{tag.label}</span><strong>{tag.count}</strong>
                </button>
              ))}
            </div>
            <div className="ranking-search" role="search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={priceSearchQuery}
                onChange={(event) => setPriceSearchQuery(event.target.value)}
                placeholder="搜索模型、分组、来源站点或平台"
                aria-label="搜索价格榜"
              />
              {priceSearchQuery && <button type="button" className="icon-button ranking-search-clear" title="清除搜索" aria-label="清除价格榜搜索" onClick={() => setPriceSearchQuery('')}><X size={14} /></button>}
            </div>
            <div className="ranking-change-filter" role="group" aria-label="价格榜涨跌筛选">
              <span className="ranking-change-filter-label">倍率变动</span>
              <button type="button" className={rankingChangeFilter === 'all' ? 'ranking-change-filter-button active' : 'ranking-change-filter-button'} aria-pressed={rankingChangeFilter === 'all'} onClick={() => setRankingChangeFilter('all')}>
                全部 <strong>{rankingChangeFilterCounts.all}</strong>
              </button>
              <button type="button" className={rankingChangeFilter === 'rate-up' ? 'ranking-change-filter-button rate-up active' : 'ranking-change-filter-button rate-up'} aria-pressed={rankingChangeFilter === 'rate-up'} onClick={() => setRankingChangeFilter('rate-up')}>
                涨价 <strong>{rankingChangeFilterCounts['rate-up']}</strong>
              </button>
              <button type="button" className={rankingChangeFilter === 'rate-down' ? 'ranking-change-filter-button rate-down active' : 'ranking-change-filter-button rate-down'} aria-pressed={rankingChangeFilter === 'rate-down'} onClick={() => setRankingChangeFilter('rate-down')}>
                降价 <strong>{rankingChangeFilterCounts['rate-down']}</strong>
              </button>
              <button
                type="button"
                role="switch"
                className={rankingUsageFilter === 'in-use' ? 'ranking-usage-switch active' : 'ranking-usage-switch'}
                aria-checked={rankingUsageFilter === 'in-use'}
                aria-label={rankingUsageFilter === 'in-use' ? '正在显示我的站点使用中的分组' : '正在显示我的站点未使用的分组'}
                title={rankingUsageFilter === 'in-use' ? `只显示我的站点使用中的分组（${activeUpstreamUsageGroupCount} 个）` : '只显示我的站点未精确关联的分组'}
                onClick={() => setRankingUsageFilter((current) => current === 'in-use' ? 'not-in-use' : 'in-use')}
              >
                <Link2 size={12} aria-hidden="true" />
                <span className="ranking-usage-switch-track" aria-hidden="true"><span /></span>
                <span>{rankingUsageFilter === 'in-use' ? '使用中' : '未使用'}</span>
              </button>
            </div>
            {showRankingToolbar && (
              <div className="ranking-toolbar" aria-label="价格榜排序">
                <span className="ranking-toolbar-label">排序</span>
                {rankingSortOptions.map((option) => (
                  <RankingSortButton
                    key={option.key}
                    option={option}
                    sort={rankingSort}
                    onChange={(key) => setRankingSort((current) => toggleRankingSort(current, key))}
                    compact
                  />
                ))}
              </div>
            )}
            <div className="ranking-table">
              <div className="ranking-header">
                <span>#</span>
                <span>模型 / 分组</span>
                <span className="ranking-header-label">来源站点 <em>倍率 / 充值</em></span>
                {showRankingToolbar
                  ? <span className="ranking-header-label">最终倍率</span>
                  : <RankingSortButton
                      option={{ key: 'effectiveMultiplier', label: '最终倍率' }}
                      sort={rankingSort}
                      onChange={(key) => setRankingSort((current) => toggleRankingSort(current, key))}
                    />}
                {showRankingToolbar
                  ? <span className="ranking-header-label" title="模型价格仅在站点提供渠道价格时显示；计算口径 = 原始模型价格 × 最终倍率">模型价格</span>
                  : <RankingSortButton
                      option={{ key: 'effectiveCost', label: '模型价格' }}
                      sort={rankingSort}
                      onChange={(key) => setRankingSort((current) => toggleRankingSort(current, key))}
                    />}
                <span className="ranking-header-label">显示</span>
              </div>
              {displayedRankedRows.length === 0 && <div className="empty-state ranking-empty"><SlidersHorizontal size={18} /><span>{rankingUsageFilter === 'in-use' ? '当前筛选下没有已精确关联到我的站点账号的三方分组。' : priceSearchQuery ? `没有匹配“${priceSearchQuery}”的模型、分组、来源站点或平台。` : '当前分类下的分组均已被我的站点使用。'}</span></div>}
              {displayedRankedRows.map((row, index) => {
                const isHidden = hiddenGroupKeys.has(hiddenGroupKey(row))
                const latestChange = latestVisibleGroupChangeFor(row.stationId, row.groupId, baseGroupChangeEvents)
                const rateChangeIcon = groupRateChangeIcon(latestChange)
                const activeUsage = activeUpstreamUsageByGroup.get(`${row.stationId}:${row.groupId}`)
                const activeUsageTitle = activeUsage ? `我的站点使用中 · ${activeUsage.length} 个账号：${activeUsage.map((item) => `${item.stationName} / ${item.accountName}`).join('、')}` : undefined
                return <div key={row.key} role="button" tabIndex={0} className={`${row.stationId === selectedStation?.id ? 'ranking-row selected' : 'ranking-row'}${isHidden ? ' hidden' : ''}`} onClick={() => setSelectedId(row.stationId)} onKeyDown={(event) => handleRankingRowKeyDown(event, row)}>
                  <span className="rank-index">{index + 1}</span>
                  <span className="rank-model">
                    <span className="rank-tags"><span className="platform-tag">{isHidden ? '已隐藏' : row.categoryLabel}</span>{activeUsage && <span className="ranking-usage-badge" title={activeUsageTitle} aria-label={activeUsageTitle}><Link2 size={11} aria-hidden="true" /><strong>{activeUsage.length}</strong></span>}{row.tags.map((tag) => <span key={tag.id} className={`capability-tag tag-${tag.id}`}>{tag.label}</span>)}{row.specialTags.map((tag) => <span key={tag.key} className={`special-group-tag ${tag.tone}`} title={tag.title}>{tag.label}</span>)}</span>
                    <strong>{row.modelName}</strong>
                    <em>{row.groupName} · {row.platform}</em>
                  </span>
                  <span className="rank-source"><strong>{row.stationName}</strong><em>{formatRateMultiplier(row.rateMultiplier)} · {formatRechargeRatio(row.rechargeRatio)} · {healthLabel({ health: row.health } as StationSnapshot)} · {row.lastUpdatedAt ? formatAge(row.lastUpdatedAt, nowTick) : '等待数据'}</em></span>
                  <span className={rateChangeIcon.tone ? `rank-effective ${rateChangeIcon.tone}` : 'rank-effective'}>
                    <span className="rank-effective-value">
                      {latestChange && (
                        <button type="button" className={`rank-change-badge ${latestChange.kind}`} title={groupChangeTooltip(latestChange)} onClick={(event) => { event.stopPropagation(); openGroupHistory(latestChange) }}>
                          {rateChangeIcon.icon === 'sparkles' ? <Sparkles size={11} /> : rateChangeIcon.icon || changeKindLabel(latestChange.kind)}
                        </button>
                      )}
                      {formatRateMultiplier(row.effectiveMultiplier)}
                    </span>
                    {latestChange && <span className={`rank-rate-change-time ${latestChange.kind}`} aria-label={`最近${latestChange.kind === 'rate-up' ? '涨价' : '降价'} ${formatGroupChangeObservedAt(latestChange.occurredAt)}`} title={`${groupChangeTooltip(latestChange)} · 本地观察 ${formatGroupChangeObservedAt(latestChange.occurredAt)}`}>{latestChange.kind === 'rate-up' ? '涨价' : '降价'} · {formatGroupChangeObservedAt(latestChange.occurredAt)}</span>}
                  </span>
                  <span className={row.score === undefined ? 'rank-price muted' : 'rank-price'} title={row.score === undefined ? '站点未返回模型基准价，不能从倍率和充值比例推导金额价格；请看最终倍率' : '模型价格 = 原始模型价格 × 最终倍率'}>
                    {row.score === undefined
                      ? <><strong>未提供价格</strong><em>仅最终倍率</em></>
                      : <><strong>入 {formatPrice(row.effectiveInputPrice)}</strong><em>出 {formatPrice(row.effectiveOutputPrice)}{row.effectiveRequestPrice !== undefined ? ` · 请求 ${formatPrice(row.effectiveRequestPrice)}` : ''}</em></>}
                  </span>
                  <button type="button" className={isHidden ? 'rank-visibility-button restore' : 'rank-visibility-button'} title={isHidden ? '恢复显示该分组' : '隐藏该分组'} aria-label={`${isHidden ? '恢复显示' : '隐藏'} ${row.stationName} 的 ${row.groupName}`} onClick={(event) => { event.stopPropagation(); toggleHiddenGroup(row) }}>{isHidden ? <RotateCcw size={14} /> : <EyeOff size={14} />}</button>
                </div>
              })}
            </div>
              </>
            )}
          </section>

          {(workspaceView === 'pricing' || workspaceView === 'stations') && <aside className="panel source-panel">
            <div className="panel-heading source-panel-heading">
              <div><span className="eyebrow">SOURCES</span><h1>来源钱包</h1></div>
              <button className="outline-button" onClick={() => openEdit()}><Plus size={15} /> {sourceWalletView === 'own' ? '添加我的站点' : '添加三方站点'}</button>
            </div>
            <div className="source-wallet-tabs" role="tablist" aria-label="来源钱包视图">
              <button type="button" role="tab" aria-selected={sourceWalletView === 'source'} className={sourceWalletView === 'source' ? 'active' : ''} onClick={() => setSourceWalletView('source')}>三方站点 <strong>{thirdPartySourceStations.length}</strong></button>
              <button type="button" role="tab" aria-selected={sourceWalletView === 'own'} className={sourceWalletView === 'own' ? 'active' : ''} onClick={() => setSourceWalletView('own')}>我的站点 <strong>{ownStations.length}</strong></button>
            </div>
            <div className="source-wallet-toolbar" aria-label="来源钱包排序">
              <span>排序</span>
              <button
                type="button"
                className="source-sort-button active"
                title={`当前按余额${sourceWalletBalanceSort === 'desc' ? '从高到低' : '从低到高'}排序；未知余额排最后`}
                aria-label={`按余额${sourceWalletBalanceSort === 'desc' ? '从高到低' : '从低到高'}排序`}
                onClick={() => setSourceWalletBalanceSort((direction) => direction === 'desc' ? 'asc' : 'desc')}
              >
                余额 {sourceWalletBalanceSort === 'desc' ? '↓' : '↑'}
              </button>
              {sourceWalletView === 'own' && (
                <button
                  type="button"
                  className="source-sort-button"
                  title="扫描可唯一确认的上游关系；预览后才会保存，不覆盖已有绑定"
                  disabled={rebuildingMappings || adminAccountCount === 0 || thirdPartySourceStations.length === 0}
                  onClick={previewSourceMappingsFromSnapshots}
                >
                  {rebuildingMappings ? <LoaderCircle className="spin" size={12} /> : <RotateCcw size={12} />}
                  扫描关联
                </button>
              )}
            </div>
            <div className="source-list">
              {sourceWalletStations.length === 0 && <div className="empty-state"><SlidersHorizontal size={18} /><span>{sourceWalletView === 'own' ? '暂无我的聚合站点；编辑站点后将角色设为“我的站点（聚合平台）”。' : '暂无三方站点；添加外部中转站后会出现在这里。'}</span></div>}
              {sourceWalletStations.map((station) => {
                const snapshot = visibleSnapshots[station.id]
                const expanded = station.id === selectedId
                const stationGroups = categoryGroups(station, snapshot)
                const sourceKeys = snapshot?.sourceKeys ?? []
                const balanceLow = isStationBalanceLow(snapshot?.balance, station.lowBalanceThreshold)
                const sourceAction = sourceStationAction?.stationId === station.id ? sourceStationAction : null
                const sourceBusy = Boolean(sourceAction)
                return <div key={station.id} className={expanded ? 'source-card-shell expanded' : 'source-card-shell'}>
                  <button type="button" className={`${expanded ? 'source-card selected' : 'source-card'}${balanceLow ? ' balance-low' : ''}`} onClick={() => setSelectedId(station.id)} aria-expanded={expanded}>
                    <span className={`health-dot ${snapshot?.health ?? 'loading'}`} />
                    <span className="source-main"><strong>{station.name}</strong><em>{stationAdapterLabel(station)} · {formatRechargeRatio(station.rechargeRatio)}{station.apiBaseUrl ? ` · API ${station.apiBaseUrl.replace(/^https?:\/\//, '')}` : ' · 默认接口'}</em></span>
                    <span className={balanceLow ? 'source-balance low' : 'source-balance'}><small>{balanceLow ? '余额不足' : '剩余余额'}</small><strong>{formatMoney(snapshot?.balance)}</strong></span>
                  </button>
                  {expanded && <div className="source-inline-detail">
                    {balanceLow && <div className="inline-alert balance-alert"><AlertTriangle size={15} /><span>余额低于提醒阈值 {formatMoney(station.lowBalanceThreshold)}，建议充值。</span></div>}
                    {snapshot?.errorMessage && <div className="inline-alert source-alert" aria-busy={sourceBusy}><AlertTriangle size={15} /><span>{snapshot.errorMessage}</span><button className="text-button" disabled={sourceBusy} onClick={() => void retrySourceStation(station, snapshot)}>{sourceBusy ? <LoaderCircle className="spin" size={13} /> : null}{sourceAction?.kind === 'login' ? '重新登录中' : sourceBusy ? '重试中' : snapshot.health === 'forbidden' || snapshot.errorCode === 'UNAUTHORIZED' ? '重新登录' : '重试'}</button></div>}
                    <div className="source-stats"><div><span>余额</span><strong className={balanceLow ? 'low-balance-text' : undefined}>{formatMoney(snapshot?.balance)}</strong></div><div><span>响应</span><strong>{snapshot?.responseTimeMs ? `${snapshot.responseTimeMs} ms` : '--'}</strong></div><div><span>价格</span><strong>{snapshot?.priceCapability === 'available' ? '已提供' : snapshot?.priceCapability === 'disabled' ? '未启用' : snapshot?.priceCapability === 'missing' ? '暂无固定价格' : '不可用'}</strong></div><div><span>同步</span><strong>{formatAge(snapshot?.lastUpdatedAt, nowTick)}</strong></div></div>
                    <div className="source-inline-actions" aria-label={`${station.name} 操作`}>
                      <button className="source-action-button" title={sourceAction?.kind === 'refresh' ? '刷新中' : '刷新'} aria-label={`${sourceAction?.kind === 'refresh' ? '正在刷新' : '刷新'} ${station.name}`} disabled={sourceBusy} onClick={() => void refreshSourceStation(station)}>{sourceAction?.kind === 'refresh' ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}</button>
                      <button className="source-action-button" title="编辑" aria-label={`编辑 ${station.name}`} onClick={() => openEdit(station)}><MoreHorizontal size={14} /></button>
                      {!demoMode && <button className="source-action-button danger" title="移除" aria-label={`移除 ${station.name}`} onClick={() => void removeSelected(station)}><Trash2 size={14} /></button>}
                    </div>
                    {sourceKeys.length > 0 && (
                      <div className="source-key-section" aria-label={`${station.name} 上游密钥`}>
                        <div className="source-key-heading">
                          <span><KeyRound size={13} /> 上游密钥</span>
                          <strong>{sourceKeys.length}</strong>
                        </div>
                        <div className="source-key-list">
                          {sourceKeys.slice(0, 20).map((key, keyIndex) => (
                            <div className="source-key-row" key={key.id} title={key.summary ?? sourceKeyLabel(key, keyIndex)}>
                              <span className="source-key-main">
                                <strong>{sourceKeyLabel(key, keyIndex)}</strong>
                                <em>{sourceKeyGroupLabel(key)}</em>
                              </span>
                              <span className="source-key-meta">
                                <strong>{sourceKeyStatusLabel(key)}</strong>
                                <em>{key.createdAt ? formatTime(key.createdAt) : '时间未知'}</em>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {station.apiPaths.keys && sourceKeys.length === 0 && !snapshot?.errorMessage && (
                      <div className="source-key-section empty-source-key" aria-label={`${station.name} 上游密钥`}>
                        <div className="source-key-heading">
                          <span><KeyRound size={13} /> 上游密钥</span>
                          <strong>{snapshot?.sourceKeyReadState === 'stale' ? '!' : '0'}</strong>
                        </div>
                        <div className="empty-state compact-empty"><KeyRound size={16} /><span>{snapshot?.sourceKeyReadState === 'stale' ? '密钥列表本次读取失败，正在保留上次数据。' : snapshot?.sourceKeyReadState === 'unavailable' ? '密钥列表当前不可读取，请检查接口路径或重新授权。' : '密钥接口已配置，但当前没有返回可展示密钥。'}</span></div>
                      </div>
                    )}
                    {!station.apiPaths.keys && stationAdapterLabel(station) !== 'NewAPI' && (
                      <div className="source-key-section empty-source-key" aria-label={`${station.name} 上游密钥读取状态`}>
                        <div className="source-key-heading"><span><KeyRound size={13} /> 上游密钥</span><strong>--</strong></div>
                        <div className="empty-state compact-empty"><KeyRound size={16} /><span>尚未配置密钥列表接口，无法自动验证“使用中”关联。</span></div>
                      </div>
                    )}
                    <div className="mini-group-list inline" aria-label={`${station.name} 当前分类分组`}>
                      {stationGroups.length === 0 && <div className="empty-state compact-empty"><SlidersHorizontal size={18} /><span>{snapshot?.priceCapability === 'disabled' ? '分组或定价接口当前不可读取，请检查路径或重新授权。' : '暂无可用于比价的分组'}</span></div>}
                      {stationGroups.map((group) => {
                        const latestChange = latestVisibleGroupChangeFor(station.id, group.id, visibleGroupChangeEvents)
                        const groupKey = groupPreferenceKey(station.id, group.id)
                        const hidden = hiddenGroupKeys.has(groupKey)
                        const manualTags = manualGroupTags[groupKey]
                        const groupTags = resolveGroupCapabilityTags(group, manualTags)
                        const menuOpen = openGroupMenu?.stationId === station.id && openGroupMenu.groupId === group.id
                        const rateChangeIndicator = groupRateChangeIndicator(latestChange)
                        return <div className={hidden ? 'mini-group-row hidden' : 'mini-group-row'} key={group.id} onContextMenu={(event) => openMenuForGroup(event, station.id, group.id)}>
                          <button
                            type="button"
                            className={hidden ? 'group-visibility-button hidden' : 'group-visibility-button'}
                            title={hidden ? '恢复到价格榜显示' : '从价格榜隐藏'}
                            aria-label={`${hidden ? '恢复到价格榜显示' : '从价格榜隐藏'} ${station.name} 的 ${group.name}`}
                            aria-pressed={hidden}
                            onClick={() => setGroupHiddenState(groupKey, group.name, !hidden)}
                          >
                            {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                          <span className="mini-group-main" title={group.name}>
                            <strong>{group.name}</strong>
                            <span className="mini-group-meta">
                              <em>{group.platform}</em>
                              {groupTags.map((tag) => <span key={tag.id} className={`capability-tag mini tag-${tag.id}`}>{tag.label}</span>)}
                              {groupSpecialTags(group).map((tag) => <span key={tag.key} className={`special-group-tag ${tag.tone}`} title={tag.title}>{tag.label}</span>)}
                              {manualTags && <span className="manual-tag-badge">手动</span>}
                              {latestChange && <button type="button" className={`group-change-badge ${latestChange.kind}`} title={groupChangeTooltip(latestChange)} onClick={() => openGroupHistory(latestChange)}>{changeKindLabel(latestChange.kind)}</button>}
                            </span>
                          </span>
                          <button type="button" className={rateChangeIndicator.tone ? `rate-value ${rateChangeIndicator.tone}` : 'rate-value'} title={latestChange ? groupChangeTooltip(latestChange) : '当前倍率'} onClick={() => { if (latestChange) openGroupHistory(latestChange) }}>{rateChangeIndicator.arrow && <em>{rateChangeIndicator.arrow}</em>}{formatRateMultiplier(group.userRateMultiplier ?? group.rateMultiplier)}</button>
                          <button type="button" className="group-menu-button" title="设置标签和显示状态" aria-label={`设置 ${group.name} 的标签和显示状态`} onClick={(event) => openMenuForGroup(event, station.id, group.id)}><Tags size={13} /></button>
                          {menuOpen && (
                            <div className="group-row-menu" role="menu" onClick={(event) => event.stopPropagation()}>
                              <span className="group-row-menu-title">设置标签</span>
                              <div className="group-row-menu-tags">
                                {[...groupCapabilityTags.map(({ id, label }) => ({ id, label })), defaultGroupCapabilityTag].map((tag) => {
                                  const selected = groupTags.some((item) => item.id === tag.id)
                                  return <button key={tag.id} type="button" className={selected ? `capability-tag-button tag-${tag.id} active` : `capability-tag-button tag-${tag.id}`} onClick={() => toggleGroupTag(station.id, group, tag.id)}>{tag.label}</button>
                                })}
                              </div>
                              <div className="group-row-menu-actions">
                                <button type="button" onClick={() => restoreAutomaticTags(station.id, group.id)}>恢复自动标签</button>
                              </div>
                            </div>
                          )}
                        </div>
                      })}
                    </div>
                    {snapshot && snapshot.accounts.length > 0 && <div className="account-section compact-account"><div className="section-heading"><div><span className="eyebrow">ADMIN</span><h2>聚合账号</h2></div><LockKeyhole size={15} className="muted-icon" /></div><div className="account-list">{snapshot.accounts.map((account) => <div className="account-row" key={account.id}><div><strong>{account.name}</strong><span>{account.platform} · {account.groups.join('、') || '未绑定分组'}</span></div><button className="outline-button compact" onClick={() => setMutation({ stationId: snapshot.stationId, accountId: account.id, accountName: account.name, previousGroupIds: account.groupIds, nextGroupIds: account.groupIds })}>切换 <ChevronDown size={14} /></button></div>)}</div></div>}
                  </div>}
                </div>
              })}
            </div>
          </aside>}
        </div>
        <footer className="statusbar"><span><span className="status-live" />实时监控已开启</span><span>最后检查 {formatTime(totals.latest)}</span><span className="statusbar-right">{demoMode ? '演示模式' : isBrowserPreview ? '浏览器预览' : '安全存储已启用'}</span></footer>
      </main>

      {changeLogOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setChangeLogOpen(false) }}>
          <section className="modal change-log-modal" role="dialog" aria-modal="true" aria-labelledby="change-log-title">
            <div className="change-log-heading">
              <div><span className="eyebrow">CHANGES</span><h2 id="change-log-title">近期分组变化</h2></div>
              <div className="change-log-heading-actions">
                {showDemoChangeLogReset && <button type="button" className="text-button" onClick={() => setDemoChangeLogDismissed(true)}>关闭演示数据</button>}
                <button type="button" className="icon-button" title="关闭近期分组变化" aria-label="关闭近期分组变化" onClick={() => setChangeLogOpen(false)}><X size={15} /></button>
              </div>
            </div>
            <div className="change-log-note">这里只显示近期分组变化；点某条记录可以看这个分组的历史，清理只会隐藏已删除提示，不会删历史。</div>
            {selectedGroupHistory && selectedGroupHistoryEvents.length > 0 && (
              <div className="group-history-detail" aria-label="分组变化详情">
                <div className="group-history-heading">
                  <div>
                    <span className="eyebrow">分组历史</span>
                    <h3>{selectedGroupHistoryEvents[0].groupName}</h3>
                    <em>{selectedGroupHistoryEvents[0].stationName} · {selectedGroupHistoryEvents[0].platform}</em>
                  </div>
                  <div className="group-history-current">
                    <span>当前倍率</span>
                    <strong>{selectedGroupHistoryCurrent ? formatRateMultiplier(selectedGroupHistoryCurrent.userRateMultiplier ?? selectedGroupHistoryCurrent.rateMultiplier) : '当前不可见'}</strong>
                  </div>
                  <button type="button" className="icon-button" title="关闭详情" onClick={() => setSelectedGroupHistory(null)}><X size={14} /></button>
                </div>
                {!selectedGroupHistoryCurrent && (
                  <div className="group-history-missing">
                    <AlertTriangle size={14} />
                    <span>该分组当前列表里已不可见，可能已被站点删除、停用，或被本地隐藏。</span>
                    {selectedGroupHistoryEvents.some((event) => event.kind === 'removed') && <button type="button" className="change-cleanup-button" title="隐藏这条已删除记录，不会删除历史" onClick={() => clearRemovedGroup(selectedGroupHistoryEvents.find((event) => event.kind === 'removed') ?? selectedGroupHistoryEvents[0])}>清理本地记录</button>}
                  </div>
                )}
                <GroupHistoryChart points={selectedGroupHistoryTrendPoints} />
                <div className="group-history-timeline">
                  {selectedGroupHistoryEvents.map((event) => <div className={`group-history-event ${event.kind}`} key={event.id}>
                    <span className="change-kind">{changeKindLabel(event.kind)}</span>
                    <strong>{groupChangeRateText(event)}</strong>
                    <em>{formatTime(event.occurredAt)}</em>
                  </div>)}
                </div>
              </div>
            )}
            {visibleGroupChangeEvents.length > 0 && (
              <div className="change-log-controls">
                <input
                  className="change-search-input"
                  value={changeLogQuery}
                  onChange={(event) => setChangeLogQuery(event.target.value)}
                  placeholder="搜索站点、分组、平台"
                  aria-label="搜索近期分组变化"
                />
                <div className="change-filter-tabs" aria-label="变化类型筛选">
                  {groupChangeFilterOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={changeLogFilter === option.id ? 'change-filter-chip active' : 'change-filter-chip'}
                      aria-pressed={changeLogFilter === option.id}
                      onClick={() => setChangeLogFilter(option.id)}
                    >
                      <span>{option.label}</span><strong>{groupChangeFilterCount(searchedGroupChangeEvents, option.id)}</strong>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {visibleGroupChangeEvents.length === 0
              ? <div className="empty-state compact-empty"><SlidersHorizontal size={18} /><span>等待下一次同步后对比分组变化。</span></div>
              : filteredGroupChangeEvents.length === 0
                ? <div className="empty-state compact-empty"><SlidersHorizontal size={18} /><span>当前筛选下暂无变化。</span></div>
              : <div className="change-log-list">
                  {filteredGroupChangeEvents.map((event) => <div
                    className={`change-log-item ${event.kind}${selectedGroupHistory?.stationId === event.stationId && selectedGroupHistory.groupId === event.groupId ? ' selected' : ''}`}
                    key={event.id}
                    role="button"
                    tabIndex={0}
                    title="查看该分组历史"
                    onClick={() => openGroupHistory(event)}
                    onKeyDown={(keyboardEvent) => handleChangeEventKeyDown(keyboardEvent, event)}
                  >
                    <span className="change-kind">{changeKindLabel(event.kind)}</span>
                    <span className="change-main"><strong>{event.groupName}</strong><em>{event.stationName} · {event.platform} · {formatTime(event.occurredAt)}</em></span>
                    <span className="change-rate">{groupChangeRateText(event)}</span>
                    {event.kind === 'removed' && <button type="button" className="change-cleanup-button" title="隐藏这条已删除记录，不会删除历史" onClick={(clickEvent) => { clickEvent.stopPropagation(); clearRemovedGroup(event) }}>清理</button>}
                  </div>)}
                </div>}
          </section>
        </div>
      )}

      {settingsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false) }}>
        <form className="modal" onSubmit={(event) => void saveSettings(event)}>
          <div className="modal-heading">
            <div>
              <span className="eyebrow">STATION CONFIG</span>
              <h2>{settingsForm.id ? '编辑站点' : '添加站点'}</h2>
            </div>
            <button type="button" className="icon-button" title="关闭" onClick={() => setSettingsOpen(false)}><X size={16} /></button>
          </div>

          <label>显示名称<input required value={settingsForm.name} onChange={(event) => setSettingsForm({ ...settingsForm, name: event.target.value })} placeholder="例如：主力中转站" /></label>
          <label>站点角色<select value={settingsForm.stationRole} onChange={(event) => setSettingsForm({ ...settingsForm, stationRole: event.target.value as StationRole })}><option value="source">三方站点（上游来源）</option><option value="own">我的站点（聚合平台）</option></select><span className="field-hint">三方站点只参与来源钱包和价格榜；我的站点才会进入账号、成本与收益管理。</span></label>
          <label>站点类型<select value={settingsForm.adapterType} onChange={(event) => {
            const adapterType = event.target.value as StationAdapterType
            setSettingsForm((current) => ({
              ...current,
              adapterType,
              detectedAdapterType: adapterType === 'auto' ? undefined : adapterType,
              apiPaths: adapterType === 'newapi' ? { ...current.apiPaths, ...newApiPathDefaults } : current.apiPaths
            }))
          }}><option value="auto">自动检测</option><option value="sub2api">Sub2API</option><option value="newapi">NewAPI</option><option value="custom">自定义兼容</option></select><span className="field-hint">自动检测只做读取探测；自定义兼容仍需选择与 Sub2API 相同的数据结构，不能猜测任意 JSON。</span></label>
          <label>{newApiSettings ? '站点地址' : 'API 地址'}<input required value={settingsForm.baseUrl} onChange={(event) => setSettingsForm({ ...settingsForm, baseUrl: event.target.value })} placeholder={newApiSettings ? 'https://newapi.example.com' : 'https://relay.example.com/api/v1'} /><span className="field-hint">{newApiSettings ? 'NewAPI 使用站点根地址；会读取余额、可用分组、定价与令牌分组。' : '支持站点根地址或带 /api/v1 的地址'}</span></label>
          <label>API 基址 <span className="optional">可选</span><input value={settingsForm.apiBaseUrl} onChange={(event) => setSettingsForm({ ...settingsForm, apiBaseUrl: cleanUrl(event.target.value) })} placeholder={newApiSettings ? '部署在子路径时填写实际根地址' : '二开站可手动填真实 API 根地址'} /><span className="field-hint">{newApiSettings ? 'NewAPI 可作为来源站进入价格榜；管理员控制台仍不复用 Sub2API 管理接口。' : '标准站留空即可；二开站如果实际接口根不是默认 /api/v1，请在这里记录。'}</span></label>
          <label>充值比例 <span className="field-inline">1 : <input type="number" min={0.0001} step={0.0001} value={settingsForm.rechargeRatio} onChange={(event) => setSettingsForm({ ...settingsForm, rechargeRatio: Number(event.target.value) })} /></span><span className="field-hint">例如 1:10 填 10，1:1 填 1；用于换算最终倍率。</span></label>
          <label>余额提醒阈值 <span className="field-inline"><input type="number" min={0} step={0.01} value={settingsForm.lowBalanceThreshold} onChange={(event) => setSettingsForm({ ...settingsForm, lowBalanceThreshold: Number(event.target.value) })} /><span>余额</span></span><span className="field-hint">余额小于等于该值时来源钱包标红；填 0 关闭提醒。</span></label>
          <div className="station-access-link">
            <div><strong>接口适配</strong><span>分组、倍率、模型价格、余额和上游密钥的路径及字段映射已集中到“数据接入”。</span></div>
            <div className="station-access-actions">
              <button type="button" className="outline-button compact" onClick={() => void runDiagnostics()} disabled={diagnosing || authorizing || saving}>{diagnosing ? <LoaderCircle className="spin" size={14} /> : <Search size={14} />}{diagnosing ? '识别中' : '自动识别'}</button>
              <button type="button" className="outline-button compact" disabled={!settingsForm.id} title={settingsForm.id ? '打开接口适配中心' : '请先保存站点基础信息'} onClick={() => { if (!settingsForm.id) return; setSelectedId(settingsForm.id); setSettingsOpen(false); setWorkspaceView('integration') }}>打开适配中心</button>
            </div>
          </div>

          <div className="diagnostic-block">
            <div className="section-heading compact-section">
              <div>
                <span className="eyebrow">DIAGNOSTICS</span>
                <h2>兼容诊断</h2>
              </div>
              <div className="detail-actions">
                <button type="button" className="outline-button compact" onClick={() => void runDiagnostics()} disabled={diagnosing || authorizing || saving}>
                  {diagnosing ? <LoaderCircle className="spin" size={15} /> : <LayoutDashboard size={15} />} {diagnosing ? '探测中' : '自动探测'}
                </button>
                <button type="button" className="outline-button compact" onClick={applySuggestedPaths} disabled={!diagnostics || Object.keys(diagnostics.suggestedPaths).length === 0}>
                  <Check size={14} /> 应用建议
                </button>
              </div>
            </div>
            <div className="diagnostic-summary">
              <div><span>识别结果</span><strong>{diagnostics?.detectedAdapterType === 'newapi' ? 'NewAPI' : diagnostics?.detectedAdapterType === 'sub2api' ? 'Sub2API' : diagnostics ? diagnostics.apiVariant : '未探测'}</strong></div>
              <div><span>Cookie</span><strong>{diagnostics ? (diagnostics.needsCookie ? '可能需要' : '暂未发现') : '--'}</strong></div>
              <div><span>UA</span><strong>{diagnostics ? (diagnostics.needsUserAgent ? '可能需要' : '暂未发现') : '--'}</strong></div>
            </div>
            {diagnostics?.notes && <div className="diagnostic-note">{diagnostics.notes}</div>}
            <div className="diagnostic-probe-list">
              {diagnostics?.probes.length ? diagnostics.probes.map((probe) => <div className="diagnostic-probe" key={`${probe.name}:${probe.path}`}><span>{probe.name}</span><strong>{probe.ok ? '可用' : '失败'}</strong><em>{probe.path} · {probe.hint}</em></div>) : <div className="empty-state compact-empty"><SlidersHorizontal size={18} /><span>点击自动探测后，这里会显示每个接口的状态</span></div>}
            </div>
          </div>

          <div className="diagnostic-paths">
            {newApiSettings ? <>
              <label>NewAPI 用户路径<input value={pathValue(settingsForm.apiPaths.profile, newApiPathDefaults.profile ?? '')} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, profile: cleanPath(event.target.value) } })} placeholder={newApiPathDefaults.profile} /></label>
              <label>NewAPI 分组路径<input value={pathValue(settingsForm.apiPaths.groups, newApiPathDefaults.groups ?? '')} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, groups: cleanPath(event.target.value) } })} placeholder={newApiPathDefaults.groups} /><span className="field-hint">只读取当前登录用户可用且有固定倍率的分组。</span></label>
              <label>NewAPI 令牌路径<input value={pathValue(settingsForm.apiPaths.keys, newApiPathDefaults.keys ?? '')} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, keys: cleanPath(event.target.value) } })} placeholder={newApiPathDefaults.keys} /><span className="field-hint">只展示令牌记录名称，不读取或保存令牌原文。</span></label>
              <label>NewAPI 定价路径<input value={pathValue(settingsForm.apiPaths.channels, newApiPathDefaults.channels ?? '')} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, channels: cleanPath(event.target.value) } })} placeholder={newApiPathDefaults.channels} /><span className="field-hint">用于价格榜与模型分类；动态计费模型不换算为固定价格。</span></label>
              <label>NewAPI 会话刷新路径<input value={pathValue(settingsForm.apiPaths.authRefresh, newApiPathDefaults.authRefresh ?? '')} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, authRefresh: cleanPath(event.target.value) } })} placeholder={newApiPathDefaults.authRefresh} /></label>
            </> : <>
            <label>用户信息路径<input value={pathValue(settingsForm.apiPaths.profile, defaultStationApiPaths.profile)} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, profile: cleanPath(event.target.value) } })} placeholder={defaultStationApiPaths.profile} /></label>
            <label>余额路径<input value={settingsForm.apiPaths.balance ?? ''} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, balance: cleanPath(event.target.value) } })} placeholder="/api/credits" /><span className="field-hint">支持相对路径，或同站 HTTPS 完整地址；不同站点地址不会保存。</span></label>
            <label>分组列表路径<input value={pathValue(settingsForm.apiPaths.groups, defaultStationApiPaths.groups)} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, groups: cleanPath(event.target.value) } })} placeholder={defaultStationApiPaths.groups} /></label>
            <label>倍率列表路径<input value={pathValue(settingsForm.apiPaths.rates, defaultStationApiPaths.rates)} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, rates: cleanPath(event.target.value) } })} placeholder={defaultStationApiPaths.rates} /></label>
            <label>价格列表路径<input value={pathValue(settingsForm.apiPaths.channels, defaultStationApiPaths.channels)} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, channels: cleanPath(event.target.value) } })} placeholder={defaultStationApiPaths.channels} /></label>
            <label>密钥列表路径 <span className="optional">Sub2API 默认</span><input value={settingsForm.apiPaths.keys ?? ''} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, keys: cleanPath(event.target.value) } })} placeholder="/keys?page=1&page_size=20&sort_by=created_at&sort_order=desc&timezone=Asia%2FShanghai" /><span className="field-hint">标准 Sub2API 站点留空会自动使用默认路径；只读拉取上游密钥列表，不保存密钥原文。</span></label>
            <label>刷新授权路径<input value={pathValue(settingsForm.apiPaths.authRefresh, defaultStationApiPaths.authRefresh)} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, authRefresh: cleanPath(event.target.value) } })} placeholder={defaultStationApiPaths.authRefresh} /></label>
            <label>管理员分组路径<input value={pathValue(settingsForm.apiPaths.adminGroups, defaultStationApiPaths.adminGroups)} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, adminGroups: cleanPath(event.target.value) } })} placeholder={defaultStationApiPaths.adminGroups} /></label>
            <label>管理员账号路径<input value={pathValue(settingsForm.apiPaths.adminAccounts, defaultStationApiPaths.adminAccounts)} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, adminAccounts: cleanPath(event.target.value) } })} placeholder={defaultStationApiPaths.adminAccounts} /></label>
            <label>后台概览路径<input value={pathValue(settingsForm.apiPaths.adminDashboard, defaultStationApiPaths.adminDashboard)} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, adminDashboard: cleanPath(event.target.value) } })} placeholder={defaultStationApiPaths.adminDashboard} /></label>
            <label>用户列表路径<input value={pathValue(settingsForm.apiPaths.adminUsers, defaultStationApiPaths.adminUsers)} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, adminUsers: cleanPath(event.target.value) } })} placeholder={defaultStationApiPaths.adminUsers} /></label>
            <label>渠道列表路径<input value={pathValue(settingsForm.apiPaths.adminChannels, defaultStationApiPaths.adminChannels)} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, adminChannels: cleanPath(event.target.value) } })} placeholder={defaultStationApiPaths.adminChannels} /></label>
            <label>平台列表路径<input value={pathValue(settingsForm.apiPaths.adminPlatforms, defaultStationApiPaths.adminPlatforms)} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, adminPlatforms: cleanPath(event.target.value) } })} placeholder={defaultStationApiPaths.adminPlatforms} /></label>
            <label>用量统计路径<input value={pathValue(settingsForm.apiPaths.adminUsage, defaultStationApiPaths.adminUsage)} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, adminUsage: cleanPath(event.target.value) } })} placeholder={defaultStationApiPaths.adminUsage} /></label>
            <label>用量明细路径<input value={pathValue(settingsForm.apiPaths.adminUsageLogs, defaultStationApiPaths.adminUsageLogs)} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, adminUsageLogs: cleanPath(event.target.value) } })} placeholder={defaultStationApiPaths.adminUsageLogs} /><span className="field-hint">仅管理员只读拉取；页面只保存脱敏账本条目和覆盖计数。</span></label>
            <label>站点设置路径<input value={pathValue(settingsForm.apiPaths.adminSettings, defaultStationApiPaths.adminSettings)} onChange={(event) => setSettingsForm({ ...settingsForm, apiPaths: { ...settingsForm.apiPaths, adminSettings: cleanPath(event.target.value) } })} placeholder={defaultStationApiPaths.adminSettings} /></label>
            </>}
          </div>

          <div className="auth-actions">
            <button type="button" className="outline-button" onClick={() => void authorizeStation()} disabled={isBrowserPreview || authorizing || saving} title={isBrowserPreview ? '浏览器预览不执行网页登录授权' : settingsForm.id ? '重新授权 / 换号登录' : '网页登录授权'}>{authorizing ? <LoaderCircle className="spin" size={15} /> : <LogIn size={15} />} {authorizing ? '等待网页登录' : settingsForm.id ? '重新授权 / 换号登录' : '网页登录授权'}</button>
            {settingsHasSavedLoginCredentials && <button type="button" className="outline-button" onClick={() => void authorizeStation(true)} disabled={isBrowserPreview || authorizing || saving} title="仅在同源登录页填入已保存账号密码，不会自动提交"><KeyRound size={15} /> 使用保存账号密码授权</button>}
            <span className="field-hint">{isBrowserPreview ? '浏览器预览不执行网页登录授权；请打开桌面快捷入口完成真实登录。' : settingsForm.id ? '会覆盖当前站点的登录令牌和 Cookie；如果登录账号是管理员，同一 JWT 会用于“我的站点”账号管理。' : '在隔离窗口完成站点登录；如果登录账号是管理员，同一 JWT 会用于“我的站点”账号管理。'}</span>
          </div>
          <div className="auth-credentials-block">
            <div className="section-heading compact-section"><div><span className="eyebrow">LOGIN CREDENTIALS</span><h2>网页登录账号密码</h2></div>{settingsHasSavedLoginCredentials && !settingsForm.clearSavedLoginCredentials && <span className="status-chip ready"><CheckCircle2 size={13} /> 已加密保存</span>}</div>
            <label>登录账号 <span className="optional">可选</span><input value={settingsForm.loginAccount} onChange={(event) => setSettingsForm({ ...settingsForm, loginAccount: event.target.value, clearSavedLoginCredentials: false })} placeholder={settingsHasSavedLoginCredentials ? '留空则保留已保存账号' : '邮箱、用户名或手机号'} autoComplete="username" /></label>
            <label>登录密码 <span className="optional">可选</span><input type="password" value={settingsForm.loginPassword} onChange={(event) => setSettingsForm({ ...settingsForm, loginPassword: event.target.value, clearSavedLoginCredentials: false })} placeholder={settingsHasSavedLoginCredentials ? '留空则保留已保存密码' : '与登录账号同时填写'} autoComplete="new-password" /></label>
            <div className="auth-keepalive-row">
              <label className="auth-keepalive-toggle"><input type="checkbox" checked={settingsForm.autoReauthEnabled} disabled={!settingsCanConfigureAutoReauth} onChange={(event) => setSettingsForm({ ...settingsForm, autoReauthEnabled: event.target.checked })} /><span>令牌失效时自动重新登录</span></label>
              <span className="field-hint">先尝试刷新令牌；仅 HTTPS 同源登录页会自动提交。验证码、2FA 与风控页会转为人工授权。</span>
              {settingsStation?.autoReauthStatus && <span className={`auth-keepalive-status ${settingsStation.autoReauthStatus.state}`}>{autoReauthStatusLabel(settingsStation.autoReauthStatus)}</span>}
            </div>
            {settingsHasSavedLoginCredentials && <div className="auth-actions"><span className="field-hint">密码原文不会回显。{settingsForm.clearSavedLoginCredentials ? '保存配置后会清除已保存账号密码并关闭自动重新登录。' : '可使用上方按钮在同源登录页填入，仍需你自行提交登录。'}</span><button type="button" className="text-button" onClick={() => setSettingsForm({ ...settingsForm, loginAccount: '', loginPassword: '', clearSavedLoginCredentials: !settingsForm.clearSavedLoginCredentials, autoReauthEnabled: settingsForm.clearSavedLoginCredentials ? settingsForm.autoReauthEnabled : false })}>{settingsForm.clearSavedLoginCredentials ? '撤销清除' : '清除已保存凭据'}</button></div>}
          </div>
          <label>站点登录 JWT <span className="optional">备用</span><input type="password" value={settingsForm.accessToken} onChange={(event) => setSettingsForm({ ...settingsForm, accessToken: event.target.value })} placeholder={settingsForm.id ? '留空则保留原令牌' : '粘贴 access token'} autoComplete="off" /></label>
          <label>刷新令牌 <span className="optional">可选</span><input type="password" value={settingsForm.refreshToken} onChange={(event) => setSettingsForm({ ...settingsForm, refreshToken: event.target.value })} placeholder={settingsForm.id ? '留空则保留原令牌' : '用于自动续期'} autoComplete="off" /></label>
          <label>管理员凭据 <span className="optional">可选</span><select value={settingsForm.adminCredentialType} onChange={(event) => setSettingsForm({ ...settingsForm, adminCredentialType: event.target.value as SettingsForm['adminCredentialType'] })}><option value="jwt">管理员 JWT</option><option value="api-key">管理员 API Key</option></select><input type="password" value={settingsForm.adminToken} onChange={(event) => setSettingsForm({ ...settingsForm, adminToken: event.target.value })} placeholder={settingsForm.id ? '留空则保留原凭据；管理员网页登录可不填' : 'API Key 或独立管理员 token；管理员网页登录可不填'} autoComplete="off" /></label>
          <label>轮询间隔 <span className="field-inline"><input type="number" min={15} max={300} value={settingsForm.pollingIntervalMs / 1000} onChange={(event) => setSettingsForm({ ...settingsForm, pollingIntervalMs: Number(event.target.value) * 1000 })} /><span>秒</span></span></label>
          <div className="modal-note"><LockKeyhole size={14} /><span>{isBrowserPreview ? '浏览器预览只在当前页面内存中保存配置，不执行真实登录、轮询或远程写入。' : '登录账号密码、登录令牌、刷新令牌和管理员凭据仅写入 macOS 安全存储，渲染页面不会读取已保存的原文。填入不会自动提交，也不会绕过验证码或 2FA。'}</span></div>
          <div className="modal-actions"><button type="button" className="outline-button" onClick={() => setSettingsOpen(false)}>取消</button><button type="submit" className="primary-button" disabled={saving || authorizing || diagnosing}>{saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} {saving ? '保存中' : '保存配置'}</button></div>
        </form>
      </div>}

      {usageDiagnosticOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setUsageDiagnosticOpen(false) }}>
          <section className="modal usage-diagnostic-modal" role="dialog" aria-modal="true" aria-labelledby="usage-diagnostic-title">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">USAGE CAPABILITY</span>
                <h2 id="usage-diagnostic-title">用量能力诊断</h2>
              </div>
              <button type="button" className="icon-button" title="关闭" onClick={() => setUsageDiagnosticOpen(false)}><X size={16} /></button>
            </div>
            <div className={`usage-capability-card ${usageCapabilityTone(selectedUsageDiagnostic.precision)}`}>
              <div className="usage-capability-main">
                <span className="usage-capability-badge">{selectedUsageDiagnostic.precisionLabel}</span>
                <div>
                  <strong>{selectedConsoleStation?.name ?? '当前站点'}</strong>
                  <em>{selectedUsageDiagnostic.summary}</em>
                </div>
              </div>
              <div className="usage-capability-meta">
                <span>明细 {selectedUsageDiagnostic.recordCount}</span>
                <span>账号累计 {selectedUsageDiagnostic.accountUsageCount}</span>
                {usageCapabilityDimensionLabels(selectedUsageDiagnostic).map((label) => <span key={`modal-dimension-${label}`}>{label}</span>)}
                {usageCapabilityMeasureLabels(selectedUsageDiagnostic).map((label) => <span key={`modal-measure-${label}`}>{label}</span>)}
              </div>
            </div>
            <div className="usage-diagnostic-grid">
              <section>
                <h3>识别到的字段</h3>
                {selectedUsageDiagnostic.fieldNames.length > 0
                  ? <div className="usage-field-list">{selectedUsageDiagnostic.fieldNames.map((field) => <span key={field}>{field}</span>)}</div>
                  : <div className="empty-state compact-empty"><Gauge size={18} /><span>当前接口没有返回可识别的用量字段。</span></div>}
              </section>
              <section>
                <h3>脱敏样例</h3>
                {selectedUsageDiagnostic.sampleRows.length > 0
                  ? <div className="usage-sample-list">
                      {selectedUsageDiagnostic.sampleRows.map((row, index) => (
                        <article key={`usage-sample-${index}`}>
                          <strong>样例 {index + 1}</strong>
                          {Object.entries(row).map(([key, value]) => <span key={key}><em>{key}</em><code>{value}</code></span>)}
                        </article>
                      ))}
                    </div>
                  : <div className="empty-state compact-empty"><Database size={18} /><span>暂无样例。这里只展示脱敏后的值类型，不显示真实密钥、邮箱或完整日志。</span></div>}
              </section>
            </div>
            <div className="modal-note"><ShieldCheck size={14} /><span>诊断只看字段名和脱敏后的值类型；如果三方站点只返回余额/订阅/当天汇总，会被标为汇总参考，不会参与长期精确利润归因。</span></div>
            <div className="modal-actions"><button type="button" className="primary-button" onClick={() => setUsageDiagnosticOpen(false)}>知道了</button></div>
          </section>
        </div>
      )}

      {costProfileEditor && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCostProfileEditor(null) }}>
          <section className="modal cost-profile-modal" role="dialog" aria-modal="true" aria-labelledby="cost-profile-title">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">ACCOUNT COST</span>
                <h2 id="cost-profile-title">设置账号成本档案</h2>
              </div>
              <button type="button" className="icon-button" title="关闭" onClick={() => setCostProfileEditor(null)}><X size={16} /></button>
            </div>
            <div className="modal-note"><ShieldCheck size={14} /><span>这里保存的是“账号成本档案”，不会修改分组配置；该账号下所有售卖分组共用同一份成本档案。不要粘贴账号密码、密钥、JWT 或 Cookie，远程账号不会被自动停用。</span></div>
            <div className="mapping-target-card">
              <span>账号成本作用范围</span>
              <strong>{costProfileEditorAccount?.name ?? `账号 ${costProfileEditor.accountId}`}</strong>
              <em>{costProfileEditorAccountStation?.name ?? '我的站点'} · 关联使用明细 {costProfileEditorAccount?.groupIds.length ?? 0} 条（仅作展示，成本档案仍归属账号）</em>
            </div>
            <label>
              成本类型
              <select
                value={costProfileEditor.kind}
                onChange={(event) => setCostProfileEditor({ ...costProfileEditor, kind: event.target.value as AccountCostKind })}
              >
                <option value="upstream-metered">三方按量：按来源分组倍率折算</option>
                <option value="self-owned-exempt">账号免计费：按上游账号成本为 0</option>
                <option value="gifted">赠送免费：成本为 0</option>
                <option value="subscription">自购订阅：周期固定成本</option>
                <option value="manual">手动成本：固定成本 + 单位成本兜底</option>
              </select>
              <span className="field-hint">{accountCostKindHint(costProfileEditor.kind)}</span>
            </label>
            {(costProfileEditor.kind === 'subscription' || costProfileEditor.kind === 'manual') && (
              <div className="cost-profile-grid">
                <label>
                  固定成本金额
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={costProfileEditor.fixedCostAmount}
                    onChange={(event) => setCostProfileEditor({ ...costProfileEditor, fixedCostAmount: event.target.value })}
                    placeholder="例如 20"
                  />
                </label>
                <label>
                  费用周期（天）
                  <input
                    type="number"
                    min={1}
                    max={366}
                    step={1}
                    value={costProfileEditor.cycleDays}
                    onChange={(event) => setCostProfileEditor({ ...costProfileEditor, cycleDays: event.target.value })}
                    placeholder="30"
                  />
                  <span className="field-hint">这笔固定成本覆盖多久：月付填 30，年付填 365。用于后续摊销/回本参考；没有精确用量时不伪造利润。</span>
                </label>
              </div>
            )}
            {(costProfileEditor.kind === 'subscription' || costProfileEditor.kind === 'manual') && (
              <label>
                单位成本倍率 <span className="optional">可选</span>
                <input
                  type="number"
                  min={0}
                  step={0.001}
                  value={costProfileEditor.variableCostMultiplier}
                  onChange={(event) => setCostProfileEditor({ ...costProfileEditor, variableCostMultiplier: event.target.value })}
                  placeholder={costProfileEditor.kind === 'subscription' ? '不填则单位成本按 0 计算' : '例如 0.025'}
                />
                <span className="field-hint">这里按最终倍率口径填写；比如 0.025 会按 0.025x 保存和展示。</span>
              </label>
            )}
            <label>
              成本备注 <span className="optional">脱敏</span>
              <input
                value={costProfileEditor.note}
                onChange={(event) => setCostProfileEditor({ ...costProfileEditor, note: event.target.value })}
                placeholder="例如 朋友赠送 / Plus 月付 / 手动估算，不要填密钥"
                maxLength={120}
              />
            </label>
            <div className="cost-profile-hints">
              <span><strong>三方按量</strong>：继续用“绑定来源”计算上游倍率。</span>
              <span><strong>账号免计费</strong>：保留来源关联、用量和收入，但不参与成本保护、上游成本或亏损判断；内部自用用户请在“用户”页单独设置。</span>
              <span><strong>赠送免费</strong>：单位成本固定为 0，不参与上游涨价风险。</span>
              <span><strong>订阅/手动</strong>：固定成本单独展示；有账号级用量时才会估算收益。</span>
            </div>
            <div className="modal-actions">
              <button type="button" className="outline-button" onClick={clearAccountCostProfile}>恢复默认</button>
              <button type="button" className="outline-button" onClick={() => setCostProfileEditor(null)}>取消</button>
              <button type="button" className="primary-button" onClick={saveAccountCostProfile}>保存账号成本</button>
            </div>
          </section>
        </div>
      )}

      {batchCostProfileEditor && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setBatchCostProfileEditor(null) }}>
          <section className="modal cost-profile-modal" role="dialog" aria-modal="true" aria-labelledby="batch-cost-profile-title">
            <div className="modal-heading">
              <div><span className="eyebrow">BATCH ACCOUNT COST</span><h2 id="batch-cost-profile-title">批量设置账号成本</h2></div>
              <button type="button" className="icon-button" title="关闭" onClick={() => setBatchCostProfileEditor(null)}><X size={16} /></button>
            </div>
            <div className="mapping-target-card">
              <span>目标售卖分组</span>
              <strong>{batchCostProfileEditor.sellingGroupName}</strong>
              <em>{batchCostProfileEditor.accountIds.length} 个账号 · {batchCostProfileEditor.existingProfileCount} 个已有成本档案 · {batchCostProfileEditor.crossGroupAccountCount} 个账号同时属于其他分组</em>
            </div>
            <div className="modal-note"><ShieldCheck size={14} /><span>成本档案始终归属账号，不会创建分组成本，也不会修改远端。多分组账号的成本会同步影响其余分组。</span></div>
            <label>应用范围<select value={batchCostProfileEditor.mode} onChange={(event) => setBatchCostProfileEditor({ ...batchCostProfileEditor, mode: event.target.value as BatchCostProfileEditorState['mode'] })}><option value="unset-only">仅设置未配置成本的账号</option><option value="overwrite-all">覆盖该分组下全部账号成本</option></select><span className="field-hint">覆盖已有成本会在保存前再次确认。</span></label>
            <label>成本类型<select value={batchCostProfileEditor.kind} onChange={(event) => setBatchCostProfileEditor({ ...batchCostProfileEditor, kind: event.target.value as AccountCostKind })}><option value="upstream-metered">三方按量：按来源分组倍率折算</option><option value="self-owned-exempt">账号免计费：按上游账号成本为 0</option><option value="gifted">赠送免费：成本为 0</option><option value="subscription">自购订阅：周期固定成本</option><option value="manual">手动成本：固定成本 + 单位成本兜底</option></select></label>
            {(batchCostProfileEditor.kind === 'subscription' || batchCostProfileEditor.kind === 'manual') && <div className="cost-profile-grid">
              <label>固定成本金额<input type="number" min={0} step={0.01} value={batchCostProfileEditor.fixedCostAmount} onChange={(event) => setBatchCostProfileEditor({ ...batchCostProfileEditor, fixedCostAmount: event.target.value })} /></label>
              <label>费用周期（天）<input type="number" min={1} max={366} step={1} value={batchCostProfileEditor.cycleDays} onChange={(event) => setBatchCostProfileEditor({ ...batchCostProfileEditor, cycleDays: event.target.value })} /></label>
            </div>}
            {(batchCostProfileEditor.kind === 'subscription' || batchCostProfileEditor.kind === 'manual') && <label>单位成本倍率 <span className="optional">可选</span><input type="number" min={0} step={0.001} value={batchCostProfileEditor.variableCostMultiplier} onChange={(event) => setBatchCostProfileEditor({ ...batchCostProfileEditor, variableCostMultiplier: event.target.value })} placeholder="例如 0.025" /></label>}
            <label>成本备注 <span className="optional">脱敏</span><input value={batchCostProfileEditor.note} maxLength={120} onChange={(event) => setBatchCostProfileEditor({ ...batchCostProfileEditor, note: event.target.value })} placeholder="例如 Plus 月付；不要填密钥" /></label>
            <div className="modal-actions"><button type="button" className="outline-button" onClick={() => setBatchCostProfileEditor(null)}>取消</button><button type="button" className="primary-button" onClick={saveBatchCostProfiles}>保存批量成本</button></div>
          </section>
        </div>
      )}

      {mappingRebuildPreview && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMappingRebuildPreview(null) }}>
          <section className="modal mapping-modal" role="dialog" aria-modal="true" aria-labelledby="mapping-rebuild-title">
            <div className="modal-heading">
              <div><span className="eyebrow">UPSTREAM KEY CHECK</span><h2 id="mapping-rebuild-title">校验上游密钥关联</h2></div>
              <button type="button" className="icon-button" title="关闭" onClick={() => setMappingRebuildPreview(null)}><X size={16} /></button>
            </div>
            <div className="modal-note"><ShieldCheck size={14} /><span>仅接受账号配置密钥与三方 Key 记录的唯一精确匹配。API 地址和倍率只用于诊断展示，不会参与自动关联；不会保存密钥原文。</span></div>
            <div className="mapping-preview-summary">
              <span>扫描账号 <strong>{mappingRebuildPreview.scanned}</strong></span>
              <span>可确认 <strong>{mappingRebuildPreview.candidates.length}</strong></span>
              <span>保留原关联 <strong>{mappingRebuildPreview.skippedExisting}</strong></span>
            </div>
            <div className="mapping-preview-list" aria-label="待确认上游关系">
              {mappingRebuildPreview.candidates.slice(0, 100).map((candidate) => {
                const accountStation = sourceStations.find((station) => station.id === candidate.accountStationId)
                const account = visibleSnapshots[candidate.accountStationId]?.accounts.find((item) => item.id === candidate.accountId)
                const sourceStation = thirdPartySourceStations.find((station) => station.id === candidate.sourceStationId)
                const sourceSnapshot = visibleSnapshots[candidate.sourceStationId]
                const sourceKey = sourceSnapshot?.sourceKeys?.find((key) => key.id === candidate.sourceKeyId)
                const group = sourceSnapshot?.groups.find((item) => item.id === candidate.sourceGroupId)
                return <article key={accountUpstreamMappingKey(candidate.accountStationId, candidate.accountId)}>
                  <div><strong>{account?.name ?? `账号 #${candidate.accountId}`}</strong><em>{accountStation?.name ?? '我的站点'} · {account?.platform || '未知平台'}</em></div>
                  <ArrowRight size={15} aria-hidden="true" />
                  <div><strong>{sourceStation?.name ?? '三方站点'} / {group?.name ?? `分组 #${candidate.sourceGroupId}`}</strong><em>{sourceKey ? sourceKeyLabel(sourceKey, 0) : candidate.sourceKeyLabel ?? '唯一来源候选'}</em></div>
                </article>
              })}
              {mappingRebuildPreview.candidates.length > 100 && <div className="mapping-preview-overflow">仅预览前 100 条，确认将保存全部 {mappingRebuildPreview.candidates.length} 条候选。</div>}
            </div>
            <div className="modal-actions">
              <button type="button" className="outline-button" onClick={() => setMappingRebuildPreview(null)} disabled={rebuildingMappings}>取消</button>
              <button type="button" className="primary-button" onClick={() => void confirmSourceMappingRebuild()} disabled={rebuildingMappings}>{rebuildingMappings ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}确认 {mappingRebuildPreview.candidates.length} 条关联</button>
            </div>
          </section>
        </div>
      )}

      {mappingEditor && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMappingEditor(null) }}>
          <section className="modal mapping-modal" role="dialog" aria-modal="true" aria-labelledby="mapping-title">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">UPSTREAM MAPPING</span>
                <h2 id="mapping-title">关联上游密钥</h2>
              </div>
              <button type="button" className="icon-button" title="关闭" onClick={() => setMappingEditor(null)}><X size={16} /></button>
            </div>
            <div className="modal-note"><ShieldCheck size={14} /><span>这里只保存来源站点、Key 记录 ID、保护口径和脱敏备注；不要粘贴三方密钥原文。</span></div>
            <div className="mapping-target-card">
              <span>我的账号</span>
              <strong>{mappingEditorAccount?.name ?? `账号 ${mappingEditor.accountId}`}</strong>
              <em>{mappingEditorAccountStation?.name ?? '我的站点'} · {mappingEditorAccount?.groups.join('、') || '未绑定分组'}</em>
            </div>
            <label>
              来源站点
              <select
                value={mappingEditor.sourceStationId}
                onChange={(event) => {
                  const sourceStationId = event.target.value
                  const firstGroup = visibleSnapshots[sourceStationId]?.groups[0]
                  setMappingEditor({ ...mappingEditor, sourceStationId, sourceKeyId: '', sourceGroupId: firstGroup?.id ?? '', sourceKeyLabel: '' })
                }}
              >
                <option value="">请选择三方来源站点</option>
                {mappingEditorSourceChoices.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
              </select>
            </label>
            {mappingEditorSourceKeys.length > 0 && (
              <label>
                上游密钥
                <select
                  value={mappingEditor.sourceKeyId}
                  onChange={(event) => {
                    const sourceKeyId = event.target.value
                    const selectedKey = mappingEditorSourceKeys.find((key) => key.id === sourceKeyId)
                    const keyGroupIds = selectedKey ? [...new Set(selectedKey.groupIds.filter((id) => Number.isInteger(id) && id > 0))] : []
                    const firstGroupId = keyGroupIds[0] ?? ''
                    setMappingEditor({
                      ...mappingEditor,
                      sourceKeyId,
                      sourceGroupId: keyGroupIds.length === 1 ? firstGroupId : mappingEditor.sourceGroupId,
                      sourceKeyLabel: selectedKey ? sourceKeyLabel(selectedKey, 0) : ''
                    })
                  }}
                  disabled={!mappingEditor.sourceStationId}
                >
                  <option value="">请选择上游密钥</option>
                  {mappingEditorSourceKeys.map((key, index) => <option key={key.id} value={key.id}>{sourceKeyLabel(key, index)} · {sourceKeyGroupLabel(key)}</option>)}
                </select>
                <span className="field-hint">保存的是上游 Key 的记录 ID，不保存 Key 原文；它单独切换分组后会自动跟随。</span>
              </label>
            )}
            <label>
              保护口径分组
              <select
                value={mappingEditor.sourceGroupId}
                onChange={(event) => setMappingEditor({ ...mappingEditor, sourceGroupId: Number(event.target.value) || '' })}
                disabled={!mappingEditor.sourceStationId || mappingEditorVisibleSourceGroups.length === 0 || mappingEditorSelectedKeyGroupIds.length === 1 || (mappingEditorSourceKeys.length > 0 && !mappingEditorSelectedSourceKey)}
              >
                <option value="">请选择来源分组</option>
                {mappingEditorVisibleSourceGroups.map((group) => {
                  const sourceRate = group.userRateMultiplier ?? group.rateMultiplier
                  const effectiveRate = mappingEditorSourceStation ? effectiveMultiplierValue(sourceRate, mappingEditorSourceStation.rechargeRatio) : undefined
                  return <option key={group.id} value={group.id}>{group.name} · {formatRateMultiplier(effectiveRate)}</option>
                })}
              </select>
              <span className="field-hint">{mappingEditorSelectedKeyGroupIds.length === 1 ? '该 Key 当前只有一个分组，应用会自动跟随，无需手动维护。' : mappingEditorSelectedKeyGroupIds.length > 1 ? '该 Key 有多个分组，请选择本账号的保护口径；应用不会自动取低价。' : mappingEditorSourceKeys.length > 0 ? '请先选择上游密钥，再读取它当前所属的分组。' : '未读取密钥列表时保留旧版分组绑定，后续可重新授权后关联 Key。'}</span>
            </label>
            {!mappingEditorSelectedSourceKey && (
              <label>
                密钥备注 <span className="optional">旧版兼容</span>
              <input
                value={mappingEditor.sourceKeyLabel}
                onChange={(event) => setMappingEditor({ ...mappingEditor, sourceKeyLabel: event.target.value })}
                placeholder="例如 krill-claude-01，不要填完整密钥"
                maxLength={80}
              />
                <span className="field-hint">仅用于未提供密钥接口的旧站点；不要输入密钥、JWT 或 Cookie。</span>
              </label>
            )}
            <div className="modal-actions">
              <button type="button" className="outline-button" onClick={clearAccountMapping}>清除绑定</button>
              <button type="button" className="outline-button" onClick={() => setMappingEditor(null)}>取消</button>
              <button type="button" className="primary-button" onClick={saveAccountMapping}>保存绑定</button>
            </div>
          </section>
        </div>
      )}

      {mutation && (
        <div className="modal-backdrop">
          <div className="modal confirm-modal">
            <div className="modal-heading">
              <div><span className="eyebrow">REMOTE CHANGE</span><h2>确认分组组合</h2></div>
              <button className="icon-button" title={batchQueueActive ? '取消队列' : '取消'} onClick={closeMutation}><X size={16} /></button>
            </div>
            <div className="mutation-summary">
              <span className="mutation-icon"><SlidersHorizontal size={18} /></span>
              <div>
                <strong>{mutation.accountName}</strong>
                <p>
                  将在 {mutationStation?.name ?? '目标站点'} 更新账号分组组合。
                  {mutation.nextGroupIds.length < mutation.previousGroupIds.length
                    ? '当前操作会从这个账号移出已取消选择的分组，确认后才会提交到远程。'
                    : '一个账号可以同时保留多个分组，下面默认保留当前组合，再按需增删。'}
                </p>
                {mutationQueue.length > 0 && <em className="mutation-queue-hint">确认当前账号后，会继续弹出队列里剩余 {mutationQueue.length} 个账号。</em>}
              </div>
            </div>
            <div className="group-picker">
              <label>目标组合 <span className="optional">按最终倍率从低到高</span></label>
              <div className="group-scope-switch" aria-label="目标分组候选范围">
                <button
                  type="button"
                  className={groupSwitchScope === 'category' ? 'group-scope-button active' : 'group-scope-button'}
                  aria-pressed={groupSwitchScope === 'category'}
                  onClick={() => { setGroupSwitchScope('category'); setGroupSwitchPlatform('all') }}
                >
                  当前分类：{categoryLabel(selectedCategory)}
                </button>
                <button
                  type="button"
                  className={groupSwitchScope === 'all' ? 'group-scope-button active' : 'group-scope-button'}
                  aria-pressed={groupSwitchScope === 'all'}
                  onClick={() => { setGroupSwitchScope('all'); setGroupSwitchPlatform('all') }}
                >
                  全部分组
                </button>
              </div>
              <div className="group-picker-toolbar">
                <input
                  type="search"
                  className="group-picker-search"
                  value={groupSwitchQuery}
                  onChange={(event) => setGroupSwitchQuery(event.target.value)}
                  placeholder="搜索分组或平台"
                  aria-label="搜索目标分组"
                />
                <span className="group-picker-count">{mutation.nextGroupIds.length} 已选 · {visibleGroupSwitchOptions.length}/{groupSwitchOptions.length} 个候选</span>
              </div>
              {groupSwitchPlatforms.length > 1 && (
                <div className="group-filter-tabs" role="tablist" aria-label="按平台筛选目标分组">
                  <button type="button" className={groupSwitchPlatform === 'all' ? 'group-filter-chip active' : 'group-filter-chip'} aria-pressed={groupSwitchPlatform === 'all'} onClick={() => setGroupSwitchPlatform('all')}>全部</button>
                  {groupSwitchPlatforms.map((platform) => (
                    <button
                      type="button"
                      key={platform}
                      className={groupSwitchPlatform === platform ? 'group-filter-chip active' : 'group-filter-chip'}
                      aria-pressed={groupSwitchPlatform === platform}
                      onClick={() => setGroupSwitchPlatform(platform)}
                    >
                      {platform}
                    </button>
                  ))}
                </div>
              )}
              <div className="group-option-list" role="listbox" aria-label="目标分组">
                {groupSwitchOptions.length === 0 && <div className="empty-state compact-empty"><SlidersHorizontal size={18} /><span>当前分类暂无可切换分组</span></div>}
                {groupSwitchOptions.length > 0 && visibleGroupSwitchOptions.length === 0 && <div className="empty-state compact-empty"><SlidersHorizontal size={18} /><span>没有匹配的候选，清空搜索或切换平台。</span></div>}
                {visibleGroupSwitchOptions.map((option) => {
                  const selected = mutation.nextGroupIds.includes(option.group.id)
                  const current = mutation.previousGroupIds.includes(option.group.id)
                  return (
                    <button
                      type="button"
                      key={option.group.id}
                      className={selected ? 'group-option selected' : 'group-option'}
                      role="option"
                      aria-selected={selected}
                      onClick={() => toggleMutationGroupId(option.group.id)}
                    >
                      <span className="group-option-main">
                        <strong>{option.group.name}</strong>
                        <span className="group-option-meta">
                          <em>{option.group.platform}{current ? ' · 当前绑定' : ''}{selected ? ' · 已选入组合' : ''}</em>
                          {resolveGroupCapabilityTags(option.group, mutationStation ? manualGroupTags[groupPreferenceKey(mutationStation.id, option.group.id)] : undefined).map((tag) => <span key={tag.id} className={`capability-tag mini tag-${tag.id}`}>{tag.label}</span>)}
                          {groupSpecialTags(option.group).map((tag) => <span key={tag.key} className={`special-group-tag ${tag.tone}`} title={tag.title}>{tag.label}</span>)}
                        </span>
                      </span>
                      <span className="group-option-rate">
                        <strong>最终 {formatRateMultiplier(option.effectiveMultiplier)}</strong>
                        <em>倍率 {formatRateMultiplier(option.rate)}</em>
                      </span>
                    </button>
                  )
                })}
              </div>
              {currentSwitchPreview && (
                <div className={`group-switch-preview ${currentSwitchPreview.direction}`} aria-label="切组差异预览">
                  <div className="group-switch-preview-flow">
                    <span><em>当前组合</em><strong>{currentSwitchPreview.previousLabel}</strong></span>
                    <ArrowRight size={14} aria-hidden="true" />
                    <span><em>目标组合</em><strong>{currentSwitchPreview.nextLabel}</strong></span>
                  </div>
                  <div className="group-switch-preview-rate">
                    <strong>{switchPreviewLabel(currentSwitchPreview.direction)}</strong>
                    <em>
                      {currentSwitchPreview.previousEffectiveMultiplier !== undefined ? formatRateMultiplier(currentSwitchPreview.previousEffectiveMultiplier) : '--'}
                      {' → '}
                      {currentSwitchPreview.nextEffectiveMultiplier !== undefined ? formatRateMultiplier(currentSwitchPreview.nextEffectiveMultiplier) : '--'}
                    </em>
                  </div>
                </div>
              )}
              {mutationError && <div className="mutation-error"><AlertTriangle size={14} /><span>{mutationError}</span></div>}
              <span className="field-hint">最终倍率 = 分组倍率 ÷ 当前站点充值比例；模型价格仅在站点提供渠道价格时显示。一个账号可以同时保留多个分组，点击候选可增删组合。数值越低越便宜。</span>
            </div>
            <div className="modal-actions">
              <button className="outline-button" onClick={closeMutation}>{batchQueueActive ? '取消队列' : '取消'}</button>
              {(batchQueueActive || mutationError) && <button className="outline-button" disabled={mutating} onClick={skipCurrentMutation}>跳过当前</button>}
              <button className="primary-button" disabled={mutating || mutation.nextGroupIds.length === 0 || mutation.nextGroupIds.join(',') === mutation.previousGroupIds.join(',')} onClick={() => void confirmMutation()}>{mutating ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} {mutating ? '提交中' : mutationError ? '重试组合' : '确认组合'}</button>
            </div>
          </div>
        </div>
      )}

      {notice && <div className={`toast ${notice.kind}`}><span>{notice.kind === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}</span>{notice.text}</div>}
    </div>
  )
}

export default App
