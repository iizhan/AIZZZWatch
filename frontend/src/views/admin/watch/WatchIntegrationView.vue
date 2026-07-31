<template>
  <AppLayout>
    <div class="space-y-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.integrationTitle') }}</h1>
          <p class="mt-1 max-w-5xl text-sm text-gray-500 dark:text-gray-400">{{ t('admin.watch.integrationDescription') }}</p>
        </div>
        <button class="btn btn-secondary" type="button" :disabled="loading" @click="refreshAll">
          <Icon name="refresh" size="sm" :class="{ 'animate-spin': loading }" />
          {{ t('common.refresh') }}
        </button>
      </div>

      <div v-if="error" class="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200" role="alert">{{ error }}</div>

      <section class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div v-for="metric in metrics" :key="metric.key" class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-dark-700 dark:bg-dark-800">
          <div class="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{{ metric.label }}</span>
            <Icon :name="metric.icon" size="sm" :class="metric.color" />
          </div>
          <div class="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">{{ metric.value }}</div>
        </div>
      </section>

      <section class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-dark-700 dark:bg-dark-800">
        <div class="flex flex-wrap items-end gap-3">
          <label class="min-w-[170px]">
            <span class="input-label">{{ t('admin.watch.healthWindow') }}</span>
            <select v-model.number="windowSeconds" class="input">
              <option :value="1800">{{ t('admin.watch.window30m') }}</option>
              <option :value="3600">{{ t('admin.watch.window1h') }}</option>
              <option :value="21600">{{ t('admin.watch.window6h') }}</option>
              <option :value="86400">{{ t('admin.watch.window24h') }}</option>
            </select>
          </label>
          <label class="min-w-[170px]">
            <span class="input-label">{{ t('admin.watch.statusFilter') }}</span>
            <select v-model="statusFilter" class="input">
              <option value="all">{{ t('admin.watch.allStatuses') }}</option>
              <option value="healthy">{{ t('admin.watch.healthStatus_healthy') }}</option>
              <option value="abnormal">{{ t('admin.watch.healthStatus_abnormal') }}</option>
              <option value="observing">{{ t('admin.watch.healthStatus_observing') }}</option>
              <option value="disabled">{{ t('admin.watch.healthStatus_disabled') }}</option>
            </select>
          </label>
          <label class="min-w-[150px]">
            <span class="input-label">{{ t('admin.watch.platform') }}</span>
            <select v-model="platformFilter" class="input">
              <option value="">{{ t('admin.watch.allPlatforms') }}</option>
              <option v-for="platform in platforms" :key="platform" :value="platform">{{ platformLabel(platform) }}</option>
            </select>
          </label>
          <label class="min-w-[180px]">
            <span class="input-label">{{ t('admin.watch.source') }}</span>
            <select v-model.number="sourceFilter" class="input">
              <option :value="0">{{ t('admin.watch.allSources') }}</option>
              <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option>
            </select>
          </label>
          <label class="min-w-[260px] flex-1">
            <span class="input-label">{{ t('admin.watch.search') }}</span>
            <div class="relative">
              <Icon name="search" size="sm" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input v-model.trim="search" class="input pl-9" :placeholder="t('admin.watch.filterPlaceholder')" />
            </div>
          </label>
        </div>
        <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.integrationHealthListHint') }}</p>
      </section>

      <section>
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.integrationHealthList') }}</h2>
            <p v-if="health" class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ formatDate(health.window_start) }} → {{ formatDate(health.window_end) }}</p>
          </div>
          <span class="text-xs text-gray-500 dark:text-gray-400">{{ health?.items.length || 0 }}</span>
        </div>
        <div v-if="loading && !health" class="py-16 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('common.loading') }}</div>
        <div v-else-if="!health || health.items.length === 0" class="border-y border-gray-200 py-16 text-center text-sm text-gray-500 dark:border-dark-700 dark:text-gray-400">{{ t('admin.watch.noIntegrationRows') }}</div>
        <div v-else class="overflow-x-auto rounded-lg border border-gray-200 dark:border-dark-700">
          <table class="min-w-[1380px] text-left text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 dark:bg-dark-800/70 dark:text-gray-400">
              <tr>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.account') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.platform') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.baseUrl') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.relatedSource') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.lastRequest') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.requestWindowCount') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.successRate') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.failureCount') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.mainError') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('common.status') }}</th>
                <th class="whitespace-nowrap px-4 py-3 text-right font-medium">{{ t('admin.watch.action') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-dark-700">
              <tr v-for="row in health.items" :key="row.account_id" class="bg-white align-top hover:bg-gray-50 dark:bg-dark-800 dark:hover:bg-dark-700/70">
                <td class="px-4 py-3">
                  <button type="button" class="flex min-w-[190px] items-start gap-2 text-left" @click="openDetails(row)">
                    <Icon name="userCircle" size="sm" class="mt-0.5 flex-shrink-0 text-gray-400" />
                    <span class="min-w-0">
                      <span class="block truncate font-medium text-gray-900 dark:text-white" :title="row.account_name">{{ row.account_name }}</span>
                      <span class="mt-1 block text-xs text-gray-500 dark:text-gray-400">#{{ row.account_id }}</span>
                    </span>
                  </button>
                </td>
                <td class="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-gray-200">{{ platformLabel(row.platform) }}</td>
                <td class="px-4 py-3"><span class="block max-w-[250px] truncate font-mono text-xs text-gray-500 dark:text-gray-400" :title="row.account_base_url || '-'">{{ row.account_base_url || '-' }}</span></td>
                <td class="px-4 py-3">
                  <div class="min-w-[190px]">
                    <div class="truncate font-medium text-gray-900 dark:text-white">{{ row.source_name || '-' }}</div>
                    <div class="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{{ row.source_group_name || row.source_group_external_id || '-' }}</div>
                  </div>
                </td>
                <td class="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-gray-200">{{ formatDate(row.last_request_at) }}</td>
                <td class="whitespace-nowrap px-4 py-3 font-mono">{{ row.window_request_count }}</td>
                <td class="whitespace-nowrap px-4 py-3">
                  <span :class="rateClass(row.success_rate)">{{ formatPercent(row.success_rate) }}</span>
                  <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ row.success_count }} / {{ row.window_request_count }}</div>
                </td>
                <td class="whitespace-nowrap px-4 py-3 font-mono">{{ row.failure_count }}</td>
                <td class="px-4 py-3"><span class="block max-w-[220px] truncate text-xs text-gray-500 dark:text-gray-400" :title="row.main_error ? watchReasonText(t, row.main_error) : '-'">{{ row.main_error ? watchReasonText(t, row.main_error) : '-' }}</span></td>
                <td class="px-4 py-3"><span :class="healthStatusClass(row.status)"><Icon :name="healthStatusIcon(row.status)" size="xs" />{{ healthStatusLabel(row.status) }}</span><div v-if="row.status_reason" class="mt-1 max-w-[220px] text-xs text-gray-500 dark:text-gray-400">{{ watchReasonText(t, row.status_reason) }}</div></td>
                <td class="px-4 py-3 text-right">
                  <div class="flex justify-end gap-2">
                    <button class="btn btn-secondary btn-sm" type="button" :title="t('admin.watch.requestLogs')" :aria-label="t('admin.watch.requestLogs')" @click="openDetails(row)"><Icon name="document" size="xs" />{{ t('admin.watch.requestLogs') }}</button>
                    <button class="btn btn-secondary btn-sm" type="button" :disabled="!row.source_id || diagnosingSourceId === row.source_id" :title="row.source_id ? t('admin.watch.runSourceDiagnosis') : t('admin.watch.diagnosisUnavailable')" :aria-label="row.source_id ? t('admin.watch.runSourceDiagnosis') : t('admin.watch.diagnosisUnavailable')" @click="runDiagnosis(row)"><Icon name="beaker" size="xs" :class="{ 'animate-pulse': diagnosingSourceId === row.source_id }" />{{ t('admin.watch.structureSnapshot') }}</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <div v-if="detailsOpen" class="fixed inset-0 z-50 flex justify-end bg-black/30" @click.self="closeDetails">
      <aside class="h-full w-full max-w-4xl overflow-y-auto bg-white p-6 shadow-xl dark:bg-dark-900">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.detailDrawerTitle') }}</h2>
            <p class="mt-1 truncate text-sm text-gray-500 dark:text-gray-400" :title="selectedRow?.account_name">{{ selectedRow?.account_name || '-' }} · {{ platformLabel(selectedRow?.platform) }}</p>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" :aria-label="t('admin.watch.closeDetails')" @click="closeDetails"><Icon name="x" size="sm" /></button>
        </div>

        <div v-if="selectedRow" class="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div class="rounded-lg border border-gray-200 p-3 dark:border-dark-700"><div class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.healthStatus_healthy') }}</div><div class="mt-2"><span :class="healthStatusClass(selectedRow.status)"><Icon :name="healthStatusIcon(selectedRow.status)" size="xs" />{{ healthStatusLabel(selectedRow.status) }}</span></div></div>
          <div class="rounded-lg border border-gray-200 p-3 dark:border-dark-700"><div class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.requestWindowCount') }}</div><div class="mt-2 text-xl font-semibold text-gray-900 dark:text-white">{{ selectedRow.window_request_count }}</div></div>
          <div class="rounded-lg border border-gray-200 p-3 dark:border-dark-700"><div class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.successRate') }}</div><div class="mt-2 text-xl font-semibold text-gray-900 dark:text-white">{{ formatPercent(selectedRow.success_rate) }}</div></div>
          <div class="rounded-lg border border-gray-200 p-3 dark:border-dark-700"><div class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.relatedSource') }}</div><div class="mt-2 truncate text-sm font-medium text-gray-900 dark:text-white" :title="selectedRow.source_name || '-'">{{ selectedRow.source_name || '-' }}</div></div>
        </div>

        <section class="mt-6">
          <div class="mb-3 flex items-center justify-between gap-3"><h3 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.requestLogs') }}</h3><span class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.healthWindow') }}: {{ windowLabel }}</span></div>
          <div class="overflow-x-auto border-y border-gray-200 dark:border-dark-700">
            <table class="min-w-[720px] text-left text-sm">
              <thead class="bg-gray-50 text-xs text-gray-500 dark:bg-dark-800/70 dark:text-gray-400"><tr><th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.observedAt') }}</th><th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.platform') }}</th><th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.model') }}</th><th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('common.status') }}</th><th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.lastLatency') }}</th><th class="px-4 py-3 font-medium">{{ t('admin.watch.reason') }}</th></tr></thead>
              <tbody class="divide-y divide-gray-100 dark:divide-dark-700">
                <tr v-if="requestLogsLoading"><td colspan="6" class="px-4 py-10 text-center text-gray-500 dark:text-gray-400">{{ t('common.loading') }}</td></tr>
                <tr v-else-if="requestLogs.length === 0"><td colspan="6" class="px-4 py-10 text-center text-gray-500 dark:text-gray-400">{{ t('admin.watch.noRequestLogs') }}</td></tr>
                <tr v-for="item in requestLogs" v-else :key="`${item.kind}-${item.request_id}-${item.created_at}`" class="bg-white dark:bg-dark-900">
                  <td class="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-gray-200">{{ formatDate(item.created_at) }}</td>
                  <td class="whitespace-nowrap px-4 py-3">{{ platformLabel(item.platform) }}</td>
                  <td class="max-w-[220px] truncate px-4 py-3" :title="item.model">{{ item.model || '-' }}</td>
                  <td class="px-4 py-3"><span :class="item.kind === 'success' ? activeClass : failedClass">{{ item.kind === 'success' ? t('admin.watch.healthStatus_healthy') : t('admin.watch.healthStatus_abnormal') }}</span></td>
                  <td class="whitespace-nowrap px-4 py-3 font-mono">{{ item.duration_ms == null ? '-' : `${item.duration_ms} ms` }}</td>
                  <td class="max-w-[260px] truncate px-4 py-3 text-xs text-gray-500 dark:text-gray-400" :title="item.message || item.phase || '-'">{{ item.message || item.phase || '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="mt-6">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.sourceStructureSnapshot') }}</h3><button v-if="selectedRow?.source_id" class="btn btn-secondary btn-sm" type="button" :disabled="diagnosingSourceId === selectedRow.source_id" @click="runDiagnosis(selectedRow)"><Icon name="beaker" size="xs" :class="{ 'animate-pulse': diagnosingSourceId === selectedRow.source_id }" />{{ t('admin.watch.runSourceDiagnosis') }}</button></div>
          <div v-if="snapshotLoading" class="py-10 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('common.loading') }}</div>
          <div v-else-if="!snapshot" class="border-y border-gray-200 py-10 text-center text-sm text-gray-500 dark:border-dark-700 dark:text-gray-400">{{ selectedRow?.source_id ? t('admin.watch.noNormalizedGroups') : t('admin.watch.diagnosisUnavailable') }}</div>
          <div v-else class="grid gap-3 sm:grid-cols-3">
            <div class="rounded-lg border border-gray-200 p-4 dark:border-dark-700"><div class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.connectivity') }}</div><div class="mt-2"><span :class="statusClass(snapshot.source.last_check_status)">{{ watchStatusLabel(t, snapshot.source.last_check_status) }}</span></div></div>
            <div class="rounded-lg border border-gray-200 p-4 dark:border-dark-700"><div class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.normalizedGroups') }}</div><div class="mt-2 text-xl font-semibold text-gray-900 dark:text-white">{{ snapshot.groups.length }}</div></div>
            <div class="rounded-lg border border-gray-200 p-4 dark:border-dark-700"><div class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.normalizedPrices') }}</div><div class="mt-2 text-xl font-semibold text-gray-900 dark:text-white">{{ snapshot.prices.length }}</div></div>
          </div>
        </section>
      </aside>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import Icon from '@/components/icons/Icon.vue'
import { diagnoseSource, getSource, listIntegrationAccountHealth, listSources, type WatchIntegrationAccountHealthList, type WatchIntegrationAccountHealthRow, type WatchSource, type WatchSourceSnapshot } from '@/api/admin/watch'
import { listRequestDetails, type OpsRequestDetail } from '@/api/admin/ops'
import { useAppStore } from '@/stores/app'
import { watchReasonText, watchStatusLabel } from './watchText'

const { t, locale } = useI18n()
const appStore = useAppStore()
const health = ref<WatchIntegrationAccountHealthList | null>(null)
const sources = ref<WatchSource[]>([])
const statusFilter = ref<'all' | 'healthy' | 'abnormal' | 'observing' | 'disabled'>('all')
const platformFilter = ref('')
const sourceFilter = ref(0)
const search = ref('')
const windowSeconds = ref(1800)
const loading = ref(false)
const error = ref('')
const detailsOpen = ref(false)
const selectedRow = ref<WatchIntegrationAccountHealthRow | null>(null)
const requestLogs = ref<OpsRequestDetail[]>([])
const requestLogsLoading = ref(false)
const snapshot = ref<WatchSourceSnapshot | null>(null)
const snapshotLoading = ref(false)
const diagnosingSourceId = ref<number | null>(null)
let refreshTimer: ReturnType<typeof setInterval> | undefined

const activeClass = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
const failedClass = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300'
const metrics = computed(() => [
  { key: 'healthy', label: t('admin.watch.healthyRoutes'), value: health.value?.healthy_count || 0, icon: 'checkCircle' as const, color: 'text-emerald-500' },
  { key: 'abnormal', label: t('admin.watch.abnormalRoutes'), value: health.value?.abnormal_count || 0, icon: 'exclamationTriangle' as const, color: 'text-red-500' },
  { key: 'observing', label: t('admin.watch.observingRoutes'), value: health.value?.observing_count || 0, icon: 'clock' as const, color: 'text-amber-500' },
  { key: 'disabled', label: t('admin.watch.disabledRoutes'), value: health.value?.disabled_count || 0, icon: 'ban' as const, color: 'text-gray-400' }
])
const platforms = computed(() => Array.from(new Set(health.value?.items.map((row) => row.platform).filter(Boolean) || [])).sort())
const windowLabel = computed(() => {
  if (windowSeconds.value === 1800) return t('admin.watch.window30m')
  if (windowSeconds.value === 3600) return t('admin.watch.window1h')
  if (windowSeconds.value === 21600) return t('admin.watch.window6h')
  return t('admin.watch.window24h')
})

function errorMessage(err: any, fallback: string) {
  const message = err?.response?.data?.message || err?.message
  return message ? watchReasonText(t, message, fallback) : fallback
}

async function refreshAll() {
  loading.value = true
  error.value = ''
  try {
    const [nextHealth, nextSources] = await Promise.all([
      listIntegrationAccountHealth({ status: statusFilter.value, platform: platformFilter.value, source_id: sourceFilter.value || undefined, search: search.value || undefined, window_seconds: windowSeconds.value, limit: 500 }),
      listSources()
    ])
    health.value = nextHealth
    sources.value = nextSources
    if (detailsOpen.value && selectedRow.value) await loadDetails(selectedRow.value)
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function loadDetails(row: WatchIntegrationAccountHealthRow) {
  selectedRow.value = row
  requestLogsLoading.value = true
  snapshotLoading.value = Boolean(row.source_id)
  requestLogs.value = []
  snapshot.value = null
  const end = health.value?.window_end
  const start = health.value?.window_start
  try {
    const requestsPromise = listRequestDetails({ account_id: row.account_id, kind: 'all', start_time: start, end_time: end, page: 1, page_size: 50 })
    const snapshotPromise = row.source_id ? getSource(row.source_id) : Promise.resolve(null)
    const [requests, nextSnapshot] = await Promise.all([requestsPromise, snapshotPromise])
    requestLogs.value = requests.items || []
    snapshot.value = nextSnapshot
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.loadFailed'))
  } finally {
    requestLogsLoading.value = false
    snapshotLoading.value = false
  }
}

async function openDetails(row: WatchIntegrationAccountHealthRow) {
  detailsOpen.value = true
  await loadDetails(row)
}

function closeDetails() {
  detailsOpen.value = false
  selectedRow.value = null
  requestLogs.value = []
  snapshot.value = null
}

async function runDiagnosis(row: WatchIntegrationAccountHealthRow) {
  if (!row.source_id) return
  diagnosingSourceId.value = row.source_id
  error.value = ''
  try {
    snapshot.value = await diagnoseSource(row.source_id)
    appStore.showSuccess(t('admin.watch.checkCompleted'))
    await refreshAll()
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.checkFailed'))
  } finally {
    diagnosingSourceId.value = null
  }
}

function platformLabel(platform?: string) {
  if (!platform) return '-'
  const key = `admin.platform_${platform}`
  const translated = t(key)
  return translated === key ? platform : translated
}

function healthStatusLabel(status?: string) {
  const key = `admin.watch.healthStatus_${status || 'observing'}`
  const translated = t(key)
  return translated === key ? status || '-' : translated
}

function healthStatusIcon(status?: string) {
  if (status === 'healthy') return 'checkCircle'
  if (status === 'abnormal') return 'exclamationTriangle'
  if (status === 'disabled') return 'ban'
  return 'clock'
}

function healthStatusClass(status?: string) {
  const base = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium '
  if (status === 'healthy') return base + 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (status === 'abnormal') return base + 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  if (status === 'disabled') return base + 'bg-gray-100 text-gray-600 dark:bg-dark-700 dark:text-gray-300'
  return base + 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
}

function rateClass(rate?: number) {
  if (rate == null) return 'text-gray-500 dark:text-gray-400'
  return rate >= 0.95 ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-red-600 dark:text-red-400'
}

function formatPercent(rate?: number) {
  return rate == null ? '-' : `${new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 1 }).format(rate)}`
}

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '-'
}

function statusClass(status?: string) {
  const base = 'inline-flex rounded-full px-2.5 py-1 text-xs font-medium '
  if (status === 'healthy' || status === 'success') return base + 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (status === 'degraded') return base + 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  if (status === 'error') return base + 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  return base + 'bg-gray-100 text-gray-600 dark:bg-dark-700 dark:text-gray-300'
}

watch([statusFilter, platformFilter, sourceFilter, search, windowSeconds], () => { void refreshAll() })
onMounted(async () => {
  await refreshAll()
  refreshTimer = setInterval(refreshAll, 30_000)
})
onBeforeUnmount(() => { if (refreshTimer) clearInterval(refreshTimer) })
</script>
