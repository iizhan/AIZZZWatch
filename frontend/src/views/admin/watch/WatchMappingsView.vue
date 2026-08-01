<template>
  <AppLayout>
    <div class="watch-surface space-y-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.mappingsTitle') }}</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('admin.watch.mappingsDescription') }}</p>
        </div>
        <button class="btn btn-secondary" type="button" :disabled="loading" @click="loadAll">
          <Icon name="refresh" size="sm" :class="{ 'animate-spin': loading }" />
          <span>{{ t('common.refresh') }}</span>
        </button>
      </div>

      <div v-if="error" class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200" role="alert">
        <span>{{ error }}</span>
        <button class="font-medium underline" type="button" @click="loadAll">{{ t('admin.watch.retry') }}</button>
      </div>

      <section class="rounded-lg border border-gray-200 bg-white p-5 dark:border-dark-700 dark:bg-dark-800">
        <div class="grid gap-4 md:grid-cols-[minmax(240px,1fr)_minmax(200px,260px)_auto_auto] md:items-end">
          <label class="block text-sm text-gray-700 dark:text-gray-200">
            {{ t('admin.watch.targetGroup') }}
            <select v-model.number="filters.target_group_id" class="input mt-1 w-full">
              <option :value="0">{{ t('admin.watch.allActiveAccounts') }}</option>
              <option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option>
            </select>
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-200">
            {{ t('admin.watch.platform') }}
            <select v-model="filters.platform" class="input mt-1 w-full">
              <option value="">{{ t('admin.watch.allPlatforms') }}</option>
              <option v-for="platform in platformOptions" :key="platform.value" :value="platform.value">{{ platform.label }}</option>
            </select>
          </label>
          <button class="btn btn-primary h-10 min-w-[104px] whitespace-nowrap" type="button" :disabled="loading" @click="applyFilters">
            {{ loading ? t('common.loading') : t('admin.watch.loadMappings') }}
          </button>
          <button class="btn btn-secondary h-10 min-w-[112px] whitespace-nowrap" type="button" :disabled="scanLoading" @click="runScan">
            <Icon name="search" size="sm" :class="{ 'animate-pulse': scanLoading }" />
            <span>{{ scanLoading ? t('common.loading') : t('admin.watch.scanMappings') }}</span>
          </button>
        </div>
        <p class="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400">{{ t('admin.watch.mappingsHint') }}</p>
      </section>

      <section v-if="scanResult" class="rounded-lg border border-blue-200 bg-blue-50/70 p-5 dark:border-blue-900/50 dark:bg-blue-900/10">
        <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.scanResultTitle') }}</h2>
            <p class="mt-1 text-xs text-gray-600 dark:text-gray-300">
              {{ t('admin.watch.scanResultHint', { ready: scanResult.ready_count, ambiguous: scanResult.ambiguous_count, mapped: scanResult.mapped_count }) }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="btn btn-secondary btn-sm" type="button" @click="selectReadyCandidates">{{ t('admin.watch.selectReadyMappings') }}</button>
            <button class="btn btn-primary btn-sm" type="button" :disabled="confirmingScan || selectedConfirmItems.length === 0" @click="confirmSelectedMappings">
              {{ confirmingScan ? t('common.saving') : t('admin.watch.confirmSelectedMappings', { count: selectedConfirmItems.length }) }}
            </button>
          </div>
        </div>

        <div v-if="scanResult.candidates.length === 0" class="py-8 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('admin.watch.noScanCandidates') }}</div>
        <div v-else class="overflow-hidden rounded-lg border border-blue-100 bg-white dark:border-blue-900/40 dark:bg-dark-800">
          <div class="max-h-[560px] overflow-auto">
            <table class="w-full min-w-[1680px] table-fixed text-left text-sm">
            <thead class="sticky top-0 z-10 bg-blue-50 text-xs text-blue-900 shadow-[0_1px_0_rgba(191,219,254,1)] dark:bg-blue-950 dark:text-blue-100 dark:shadow-[0_1px_0_rgba(30,58,138,0.8)]">
              <tr>
                <th class="w-[72px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.select') }}</th>
                <th class="w-[280px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.account') }}</th>
                <th class="w-[140px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.platform') }}</th>
                <th class="w-[200px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.source') }}</th>
                <th class="w-[220px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.sourceKey') }}</th>
                <th class="w-[280px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.sourceGroup') }}</th>
                <th class="w-[150px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.mappingStatus') }}</th>
                <th class="w-[330px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.reason') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-blue-50 dark:divide-dark-700">
              <tr v-for="candidate in visibleScanCandidates" :key="candidate.account_id" class="align-top">
                <td class="px-4 py-3">
                  <input
                    v-model="scanSelections[candidate.account_id]"
                    class="h-4 w-4 rounded border-gray-300 text-primary-600"
                    type="checkbox"
                    :disabled="!canSelectCandidate(candidate)"
                  />
                </td>
                <td class="px-4 py-3">
                  <div class="truncate font-medium text-gray-900 dark:text-white" :title="candidate.account_name">{{ candidate.account_name }}</div>
                  <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">#{{ candidate.account_id }}</div>
                  <div v-if="candidate.account_base_url" class="mt-1 max-w-[240px] truncate font-mono text-xs text-gray-400" :title="candidate.account_base_url">{{ candidate.account_base_url }}</div>
                  <p v-if="candidate.target_group_id && !candidate.in_target_group" class="mt-2 max-w-xs text-xs text-amber-600 dark:text-amber-300">
                    {{ watchReasonText(t, candidate.participation_reason) }}
                  </p>
                </td>
                <td class="px-4 py-3">
                  <span class="inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:bg-dark-700 dark:text-gray-200">
                    <PlatformIcon :platform="platformValue(candidate.platform)" size="xs" />
                    {{ platformLabel(candidate.platform) }}
                  </span>
                </td>
                <td class="px-4 py-3 text-gray-700 dark:text-gray-200">{{ candidate.source_name || '-' }}</td>
                <td class="px-4 py-3">
                  <div class="font-medium text-gray-900 dark:text-white">{{ candidate.source_key_label || '-' }}</div>
                  <div v-if="candidate.source_key_external_id" class="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400">{{ candidate.source_key_external_id }}</div>
                </td>
                <td class="px-4 py-3">
                  <select v-if="candidate.status === 'needs_group'" v-model="scanGroupDrafts[candidate.account_id]" class="input w-full">
                    <option value="">{{ t('admin.watch.selectSourceGroup') }}</option>
                    <option v-for="group in candidate.groups || []" :key="group.external_id" :value="group.external_id">
                      {{ group.name }} · {{ formatNumber(group.final_cost) }}
                    </option>
                  </select>
                  <div v-else>
                    <div class="font-medium text-gray-900 dark:text-white">{{ candidate.source_group_name || '-' }}</div>
                    <div v-if="candidate.source_group_external_id" class="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400">{{ candidate.source_group_external_id }}</div>
                  </div>
                </td>
                <td class="px-4 py-3"><span :class="scanStatusClass(candidate.status)">{{ scanStatusText(candidate.status) }}</span></td>
                <td class="break-words px-4 py-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  <div>{{ watchReasonText(t, candidate.reason) }}</div>
                  <div v-if="candidate.target_group_id && !candidate.in_target_group" class="mt-1 text-amber-600 dark:text-amber-300">{{ t('admin.watch.targetGroupNonParticipant') }}</div>
                </td>
              </tr>
            </tbody>
            </table>
          </div>
          <Pagination
            v-if="scanResult.candidates.length > 0"
            :page="scanPagination.page"
            :total="scanResult.candidates.length"
            :page-size="scanPagination.page_size"
            :page-size-options="mappingPageSizeOptions"
            @update:page="handleScanPageChange"
            @update:pageSize="handleScanPageSizeChange"
          />
        </div>
      </section>

      <section class="rounded-lg border border-gray-200 bg-white p-5 dark:border-dark-700 dark:bg-dark-800">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.accountMappings') }}</h2>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.accountMappingsHint') }}</p>
          </div>
          <span v-if="view" class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.observedAt') }}: {{ formatDate(view.generated_at) }}</span>
        </div>

        <div v-if="loading && !view" class="py-16 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('common.loading') }}</div>
        <div v-else-if="!view || view.accounts.length === 0" class="border-y border-gray-200 py-16 text-center text-sm text-gray-500 dark:border-dark-700 dark:text-gray-400">
          {{ t('admin.watch.noMappingAccounts') }}
        </div>
        <div v-else class="overflow-hidden border-y border-gray-200 dark:border-dark-700">
          <div class="max-h-[560px] overflow-auto">
            <table class="w-full min-w-[1560px] table-fixed text-left text-sm">
            <thead class="sticky top-0 z-10 bg-gray-50 text-xs text-gray-500 shadow-[0_1px_0_rgba(229,231,235,1)] dark:bg-dark-800 dark:text-gray-300 dark:shadow-[0_1px_0_rgba(55,65,81,1)]">
              <tr>
                <th class="w-[280px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.account') }}</th>
                <th class="w-[140px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.platform') }}</th>
                <th class="w-[230px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.source') }}</th>
                <th class="w-[240px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.sourceKey') }}</th>
                <th class="w-[240px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.sourceGroup') }}</th>
                <th class="w-[270px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.mappingStatus') }}</th>
                <th class="w-[160px] whitespace-nowrap px-4 py-3 text-right font-medium">{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-dark-700">
              <tr v-for="row in view.accounts" :key="row.account_id" class="bg-white align-top dark:bg-dark-800">
                <td class="px-4 py-3">
                  <div class="truncate font-medium text-gray-900 dark:text-white" :title="row.account_name">{{ row.account_name }}</div>
                  <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">#{{ row.account_id }}</div>
                  <div v-if="row.account_base_url" class="mt-1 max-w-[220px] truncate font-mono text-xs text-gray-400" :title="row.account_base_url">{{ row.account_base_url }}</div>
                  <p v-if="row.target_group_id && !row.in_target_group" class="mt-2 max-w-xs text-xs text-amber-600 dark:text-amber-300">
                    {{ watchReasonText(t, row.participation_reason) }}
                  </p>
                </td>
                <td class="px-4 py-3">
                  <span class="inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:bg-dark-700 dark:text-gray-200">
                    <PlatformIcon :platform="platformValue(row.platform)" size="xs" />
                    {{ platformLabel(row.platform) }}
                  </span>
                </td>
                <td class="px-4 py-3">
                  <select v-model.number="draftFor(row).source_id" class="input w-full" @change="onSourceChange(row)">
                    <option :value="0">{{ t('admin.watch.selectSource') }}</option>
                    <option v-for="source in view.sources" :key="source.id" :value="source.id">{{ source.name }}</option>
                  </select>
                </td>
                <td class="px-4 py-3">
                  <select v-model="draftFor(row).source_key_external_id" class="input w-full" :disabled="!draftFor(row).source_id || loadingSnapshotIds.has(draftFor(row).source_id)" @change="onKeyChange(row)">
                    <option value="">{{ loadingSnapshotIds.has(draftFor(row).source_id) ? t('common.loading') : t('admin.watch.selectSourceKey') }}</option>
                    <option v-for="key in keysFor(row)" :key="key.external_id" :value="key.external_id">{{ key.label }} · {{ key.external_id }}</option>
                  </select>
                  <p v-if="selectedKey(row)?.summary" class="mt-1 max-w-xs text-xs text-gray-500 dark:text-gray-400">{{ selectedKey(row)?.summary }}</p>
                </td>
                <td class="px-4 py-3">
                  <select v-model="draftFor(row).source_group_external_id" class="input w-full" :disabled="!draftFor(row).source_key_external_id">
                    <option value="">{{ t('admin.watch.autoOrSingleGroup') }}</option>
                    <option v-for="group in groupsFor(row)" :key="group.external_id" :value="group.external_id">{{ group.name }} · {{ formatNumber(effectiveGroupCost(row, group.external_id)) }}</option>
                  </select>
                </td>
                <td class="px-4 py-3">
                  <span :class="mappingStatusClass(row.mapping_status)">{{ mappingStatusText(row) }}</span>
                  <p v-if="row.reason" class="mt-1 max-w-xs text-xs text-amber-600 dark:text-amber-300">{{ watchReasonText(t, row.reason) }}</p>
                  <p v-if="row.target_group_id && !row.in_target_group" class="mt-1 max-w-xs text-xs text-amber-600 dark:text-amber-300">{{ t('admin.watch.targetGroupNonParticipant') }}</p>
                  <p v-if="mappingSaveBlockReason(row)" class="mt-1 max-w-xs text-xs text-amber-600 dark:text-amber-300">{{ mappingSaveBlockReason(row) }}</p>
                </td>
                <td class="px-4 py-3">
                  <div class="flex justify-end gap-2">
                    <button class="btn btn-primary btn-sm" type="button" :disabled="!canSave(row) || savingAccountId === row.account_id" @click="saveRow(row)">
                      {{ savingAccountId === row.account_id ? t('common.saving') : t('common.save') }}
                    </button>
                    <button v-if="row.mapping" class="btn btn-secondary btn-sm" type="button" :disabled="savingAccountId === row.account_id" @click="clearRow(row)">
                      {{ t('admin.watch.unbind') }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
            </table>
          </div>
          <Pagination
            v-if="view.total > 0"
            :page="view.page"
            :total="view.total"
            :page-size="view.page_size"
            :page-size-options="mappingPageSizeOptions"
            @update:page="handleMappingPageChange"
            @update:pageSize="handleMappingPageSizeChange"
          />
        </div>
      </section>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import Icon from '@/components/icons/Icon.vue'
import Pagination from '@/components/common/Pagination.vue'
import PlatformIcon from '@/components/common/PlatformIcon.vue'
import { groupsAPI } from '@/api/admin/groups'
import { useAppStore } from '@/stores/app'
import { GROUP_PLATFORMS, type GroupPlatform } from '@/types'
import {
  confirmAccountMappingBatch,
  deleteAccountMapping,
  getSource,
  listAccountMappings,
  listSources,
  saveAccountMapping,
  scanAccountMappings,
  type WatchAccountMappingCandidate,
  type WatchAccountMappingRow,
  type WatchAccountMappingsView,
  type WatchAccountMappingScanResult,
  type WatchSourceGroupObservation,
  type WatchSourceKeyObservation,
  type WatchSourceSnapshot,
  type WatchSource,
} from '@/api/admin/watch'
import { watchReasonText } from './watchText'

const { t, locale } = useI18n()
const appStore = useAppStore()
const loading = ref(false)
const error = ref('')
const groups = ref<Array<{ id: number; name: string }>>([])
const view = ref<WatchAccountMappingsView | null>(null)
const sourceSnapshots = ref<Record<number, WatchSourceSnapshot>>({})
const loadingSnapshotIds = ref(new Set<number>())
const savingAccountId = ref<number | null>(null)
const scanLoading = ref(false)
const confirmingScan = ref(false)
const scanResult = ref<WatchAccountMappingScanResult | null>(null)
const drafts = reactive<Record<number, { source_id: number; source_key_external_id: string; source_group_external_id: string }>>({})
const scanSelections = reactive<Record<number, boolean>>({})
const scanGroupDrafts = reactive<Record<number, string>>({})
const filters = reactive({ target_group_id: 0, platform: '' })
const mappingPagination = reactive({ page: 1, page_size: 20 })
const scanPagination = reactive({ page: 1, page_size: 20 })
const mappingPageSizeOptions = [20, 50, 100]
let sourceRefreshTimer: ReturnType<typeof setInterval> | undefined
let sourceRefreshInFlight = false
let terminalSourceBaselineReady = false
let pendingTerminalSourceRefresh = false
let lastMappingRefreshAt = Date.now()
const lastTerminalSourceMarkers = new Map<number, string>()
const sourceRefreshCoalesceMs = 10_000

const platformNames: Record<GroupPlatform, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  grok: 'Grok',
  composite: 'Composite',
}
const platformOptions = GROUP_PLATFORMS.map((value) => ({ value, label: platformNames[value] }))
const visibleScanCandidates = computed(() => {
  const candidates = scanResult.value?.candidates || []
  const start = (scanPagination.page - 1) * scanPagination.page_size
  return candidates.slice(start, start + scanPagination.page_size)
})

const selectedConfirmItems = computed(() => {
  const result = scanResult.value
  if (!result) return []
  return result.candidates
    .filter((candidate) => scanSelections[candidate.account_id] && canSelectCandidate(candidate))
    .map((candidate) => ({
      account_id: candidate.account_id,
      source_id: candidate.source_id || 0,
      source_key_external_id: candidate.source_key_external_id || '',
      source_group_external_id: candidate.source_group_external_id || scanGroupDrafts[candidate.account_id] || undefined,
      mapping_method: 'auto' as const,
    }))
    .filter((item) => item.source_id > 0 && item.source_key_external_id && item.source_group_external_id)
})

function errorMessage(err: any, fallback: string) {
  const message = err?.message || err?.response?.data?.message
  return message ? watchReasonText(t, message, message) : fallback
}

function draftFor(row: WatchAccountMappingRow) {
  if (!drafts[row.account_id]) {
    drafts[row.account_id] = {
      source_id: row.mapping?.source_id || row.auto_matched_source_id || 0,
      source_key_external_id: row.mapping?.source_key_external_id || '',
      source_group_external_id: row.mapping?.source_group_external_id || '',
    }
  }
  return drafts[row.account_id]
}

function hydrateDrafts() {
  if (!view.value) return
  for (const row of view.value.accounts) {
    drafts[row.account_id] = {
      source_id: row.mapping?.source_id || row.auto_matched_source_id || 0,
      source_key_external_id: row.mapping?.source_key_external_id || '',
      source_group_external_id: row.mapping?.source_group_external_id || '',
    }
  }
}

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [nextGroups] = await Promise.all([groupsAPI.getAll()])
    groups.value = nextGroups.map((group) => ({ id: group.id, name: group.name }))
    await loadMappings({ refreshScan: true })
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.mappingsLoadFailed'))
  } finally {
    loading.value = false
  }
}

async function loadMappings(options: { refreshScan?: boolean } = {}) {
  loading.value = true
  error.value = ''
  let shouldRefreshScan = false
  try {
    let nextView = await listAccountMappings({
      target_group_id: filters.target_group_id || undefined,
      platform: filters.platform || undefined,
      page: mappingPagination.page,
      page_size: mappingPagination.page_size,
    })
    if (nextView.accounts.length === 0 && nextView.total > 0 && mappingPagination.page > 1) {
      mappingPagination.page = Math.max(nextView.pages, 1)
      nextView = await listAccountMappings({
        target_group_id: filters.target_group_id || undefined,
        platform: filters.platform || undefined,
        page: mappingPagination.page,
        page_size: mappingPagination.page_size,
      })
    }
    view.value = nextView
    mappingPagination.page = view.value.page
    mappingPagination.page_size = view.value.page_size
    hydrateDrafts()
    await preloadMappedSources()
    shouldRefreshScan = Boolean(options.refreshScan)
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.mappingsLoadFailed'))
  } finally {
    loading.value = false
  }
  if (shouldRefreshScan) {
    await runScan()
  }
}

async function applyFilters() {
  mappingPagination.page = 1
  scanPagination.page = 1
  await loadMappings({ refreshScan: true })
}

async function handleMappingPageChange(page: number) {
  mappingPagination.page = page
  await loadMappings()
}

async function handleMappingPageSizeChange(pageSize: number) {
  mappingPagination.page_size = pageSize
  mappingPagination.page = 1
  await loadMappings()
}

function handleScanPageChange(page: number) {
  scanPagination.page = page
}

function handleScanPageSizeChange(pageSize: number) {
  scanPagination.page_size = pageSize
  scanPagination.page = 1
}

async function preloadMappedSources() {
  if (!view.value) return
  const sourceIds = [...new Set(view.value.accounts.map((row) => draftFor(row).source_id).filter((id) => id > 0))]
  await Promise.all(sourceIds.map((id) => ensureSnapshot(id).catch(() => undefined)))
}

async function ensureSnapshot(sourceId: number) {
  if (!sourceId || sourceSnapshots.value[sourceId]) return
  loadingSnapshotIds.value = new Set([...loadingSnapshotIds.value, sourceId])
  try {
    sourceSnapshots.value = { ...sourceSnapshots.value, [sourceId]: await getSource(sourceId) }
  } finally {
    const next = new Set(loadingSnapshotIds.value)
    next.delete(sourceId)
    loadingSnapshotIds.value = next
  }
}

async function onSourceChange(row: WatchAccountMappingRow) {
  const draft = draftFor(row)
  draft.source_key_external_id = ''
  draft.source_group_external_id = ''
  await ensureSnapshot(draft.source_id)
}

function onKeyChange(row: WatchAccountMappingRow) {
  draftFor(row).source_group_external_id = ''
}

function keysFor(row: WatchAccountMappingRow): WatchSourceKeyObservation[] {
  const snapshot = sourceSnapshots.value[draftFor(row).source_id]
  return snapshot?.source_keys || []
}

function selectedKey(row: WatchAccountMappingRow): WatchSourceKeyObservation | undefined {
  const draft = draftFor(row)
  return keysFor(row).find((key) => key.external_id === draft.source_key_external_id)
}

function groupsFor(row: WatchAccountMappingRow): WatchSourceGroupObservation[] {
  const draft = draftFor(row)
  const snapshot = sourceSnapshots.value[draft.source_id]
  if (!snapshot) return []
  const key = selectedKey(row)
  if (!key || key.group_external_ids.length === 0) return snapshot.groups
  const allowed = new Set(key.group_external_ids)
  return snapshot.groups.filter((group) => allowed.has(group.external_id))
}

function selectedKeyRequiresGroup(row: WatchAccountMappingRow) {
  const key = selectedKey(row)
  if (!key) return false
  return key.group_external_ids.length > 1 || (key.group_external_ids.length === 0 && groupsFor(row).length > 1)
}

function effectiveGroupCost(row: WatchAccountMappingRow, groupExternalId: string) {
  const snapshot = sourceSnapshots.value[draftFor(row).source_id]
  const group = snapshot?.groups.find((item) => item.external_id === groupExternalId)
  if (!snapshot || !group || snapshot.source.recharge_ratio <= 0) return undefined
  return (group.user_rate_multiplier ?? group.rate_multiplier) / snapshot.source.recharge_ratio
}

function mappingSaveBlockReason(row: WatchAccountMappingRow) {
  const draft = draftFor(row)
  if (!draft.source_id || !draft.source_key_external_id) return ''
  if (selectedKeyRequiresGroup(row) && !draft.source_group_external_id) {
    return t('admin.watch.selectSourceGroupRequired')
  }
  return ''
}

function canSave(row: WatchAccountMappingRow) {
  const draft = draftFor(row)
  return Boolean(draft.source_id && draft.source_key_external_id && !mappingSaveBlockReason(row))
}

async function runScan() {
  scanLoading.value = true
  error.value = ''
  try {
    scanResult.value = await scanAccountMappings({
      target_group_id: filters.target_group_id || undefined,
      platform: filters.platform || undefined,
    })
    scanPagination.page = 1
    for (const candidate of scanResult.value.candidates) {
      scanSelections[candidate.account_id] = false
      scanGroupDrafts[candidate.account_id] = candidate.source_group_external_id || ''
    }
    selectReadyCandidates()
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.mappingScanFailed'))
  } finally {
    scanLoading.value = false
  }
}

function canSelectCandidate(candidate: WatchAccountMappingCandidate) {
  if (candidate.target_group_id && !candidate.in_target_group) return false
  if (!candidate.source_id || !candidate.source_key_external_id) return false
  if (candidate.status === 'ready') return Boolean(candidate.source_group_external_id)
  if (candidate.status === 'needs_group') return Boolean(scanGroupDrafts[candidate.account_id])
  return false
}

function selectReadyCandidates() {
  if (!scanResult.value) return
  for (const candidate of scanResult.value.candidates) {
    scanSelections[candidate.account_id] = candidate.status === 'ready' && canSelectCandidate(candidate)
  }
}

async function confirmSelectedMappings() {
  if (selectedConfirmItems.value.length === 0) return
  confirmingScan.value = true
  error.value = ''
  try {
    const result = await confirmAccountMappingBatch({ confirmed: true, items: selectedConfirmItems.value })
    if (result.failed.length > 0) {
      error.value = t('admin.watch.mappingBatchPartialFailed', { failed: result.failed.length, saved: result.saved.length })
    } else {
      appStore.showSuccess(t('admin.watch.mappingBatchSaved', { count: result.saved.length }))
    }
    await loadMappings()
    await runScan()
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.mappingBatchSaveFailed'))
  } finally {
    confirmingScan.value = false
  }
}

function terminalSourceMarker(source: WatchSource) {
  const state = String(source.diagnostic_state || '').trim().toLowerCase()
  const status = String(source.last_check_status || '').trim().toLowerCase()
  const terminal = state === 'completed' || state === 'failed' || ['healthy', 'degraded', 'success', 'error'].includes(status)
  if (!terminal || !source.last_check_at) return ''
  return [source.id, source.last_check_at, status, source.last_error_code || ''].join(':')
}

function observeTerminalSourceChanges(sources: WatchSource[]) {
  let changed = false
  for (const source of sources) {
    const marker = terminalSourceMarker(source)
    if (!marker) continue
    if (terminalSourceBaselineReady && lastTerminalSourceMarkers.get(source.id) !== marker) {
      changed = true
    }
    lastTerminalSourceMarkers.set(source.id, marker)
  }
  terminalSourceBaselineReady = true
  return changed
}

async function refreshMappingsAfterSourceDiagnostics() {
  if (sourceRefreshInFlight || loading.value || scanLoading.value) return
  if (!view.value?.sources.length) return
  sourceRefreshInFlight = true
  try {
    const nextSources = await listSources()
    if (observeTerminalSourceChanges(nextSources)) {
      pendingTerminalSourceRefresh = true
    }
    const refreshDue = pendingTerminalSourceRefresh && Date.now() - lastMappingRefreshAt >= sourceRefreshCoalesceMs
    if (refreshDue) {
      await loadMappings()
      if (view.value) {
        view.value = { ...view.value, sources: nextSources }
      }
      await runScan()
      pendingTerminalSourceRefresh = false
      lastMappingRefreshAt = Date.now()
    } else if (view.value) {
      view.value = { ...view.value, sources: nextSources }
    }
  } catch {
    // 静默轮询只负责诊断完成后的联动刷新；页面主错误由显式操作展示。
  } finally {
    sourceRefreshInFlight = false
  }
}

async function saveRow(row: WatchAccountMappingRow) {
  if (!canSave(row)) return
  const draft = draftFor(row)
  savingAccountId.value = row.account_id
  error.value = ''
  try {
    await saveAccountMapping(row.account_id, {
      source_id: draft.source_id,
      source_key_external_id: draft.source_key_external_id,
      source_group_external_id: draft.source_group_external_id || undefined,
      mapping_method: 'manual',
    })
    appStore.showSuccess(t('admin.watch.mappingSaved'))
    await loadMappings()
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.mappingSaveFailed'))
  } finally {
    savingAccountId.value = null
  }
}

async function clearRow(row: WatchAccountMappingRow) {
  savingAccountId.value = row.account_id
  error.value = ''
  try {
    await deleteAccountMapping(row.account_id)
    appStore.showSuccess(t('admin.watch.mappingDeleted'))
    await loadMappings()
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.mappingDeleteFailed'))
  } finally {
    savingAccountId.value = null
  }
}

function mappingStatusText(row: WatchAccountMappingRow) {
  if (row.mapping_status === 'mapped') return t('admin.watch.mappingStatus_mapped')
  if (row.mapping_status === 'auto_match_available') return t('admin.watch.mappingStatus_auto_match_available')
  return t('admin.watch.mappingStatus_unmapped')
}

function mappingStatusClass(status: string) {
  const base = 'inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium '
  if (status === 'mapped') return base + 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (status === 'auto_match_available') return base + 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  return base + 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
}

function scanStatusText(status: WatchAccountMappingCandidate['status']) {
  return t(`admin.watch.scanStatus_${status}`)
}

function scanStatusClass(status: WatchAccountMappingCandidate['status']) {
  const base = 'inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium '
  if (status === 'ready') return base + 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (status === 'mapped') return base + 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (status === 'needs_group') return base + 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  if (status === 'multiple_match') return base + 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'
  return base + 'bg-gray-100 text-gray-600 dark:bg-dark-700 dark:text-gray-300'
}

function platformValue(value?: string): GroupPlatform | undefined {
  const normalized = String(value || '').trim().toLowerCase()
  return GROUP_PLATFORMS.find((platform) => platform === normalized)
}

function platformLabel(value?: string) {
  const platform = platformValue(value)
  return platform ? platformNames[platform] : value || '-'
}

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '-'
}

function formatNumber(value?: number) {
  return value == null ? '-' : new Intl.NumberFormat(locale.value, { maximumFractionDigits: 8 }).format(value)
}

onMounted(() => {
  loadAll()
  sourceRefreshTimer = setInterval(() => {
    refreshMappingsAfterSourceDiagnostics()
  }, 5000)
})

onBeforeUnmount(() => {
  if (sourceRefreshTimer) clearInterval(sourceRefreshTimer)
})
</script>
