<template>
  <AppLayout>
    <div class="watch-surface space-y-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.keepaliveTitle') }}</h1>
          <p class="mt-1 max-w-4xl text-sm text-gray-500 dark:text-gray-400">{{ t('admin.watch.keepaliveDescription') }}</p>
        </div>
        <button class="btn btn-secondary" type="button" :disabled="loading" @click="refreshAll">
          <Icon name="refresh" size="sm" :class="{ 'animate-spin': loading }" />
          {{ t('common.refresh') }}
        </button>
      </div>

      <div v-if="error" class="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200" role="alert">{{ error }}</div>

      <section class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-dark-700 dark:bg-dark-800">
          <div class="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{{ t('admin.watch.activeKeepalives') }}</span>
            <Icon name="checkCircle" size="sm" class="text-emerald-500" />
          </div>
          <div class="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">{{ activeCount }}</div>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-dark-700 dark:bg-dark-800">
          <div class="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{{ t('admin.watch.failedKeepalives') }}</span>
            <Icon name="exclamationTriangle" size="sm" class="text-red-500" />
          </div>
          <div class="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">{{ failedCount }}</div>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-dark-700 dark:bg-dark-800">
          <div class="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{{ t('admin.watch.dueKeepalives') }}</span>
            <Icon name="clock" size="sm" class="text-amber-500" />
          </div>
          <div class="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">{{ dueCount }}</div>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-dark-700 dark:bg-dark-800">
          <div class="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{{ t('admin.watch.disabledKeepalives') }}</span>
            <Icon name="ban" size="sm" class="text-gray-400" />
          </div>
          <div class="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">{{ disabledCount }}</div>
        </div>
      </section>

      <section class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-dark-700 dark:bg-dark-800">
        <div class="flex flex-wrap items-end gap-3">
          <label class="min-w-[180px]">
            <span class="input-label">{{ t('admin.watch.statusFilter') }}</span>
            <select v-model="statusFilter" class="input">
              <option value="all">{{ t('admin.watch.allStatuses') }}</option>
              <option value="active">{{ t('admin.watch.keepaliveState_active') }}</option>
              <option value="failed">{{ t('admin.watch.keepaliveState_failed') }}</option>
              <option value="checking">{{ t('admin.watch.keepaliveState_checking') }}</option>
              <option value="waiting">{{ t('admin.watch.keepaliveState_waiting') }}</option>
              <option value="disabled">{{ t('admin.watch.keepaliveState_disabled') }}</option>
            </select>
          </label>
          <label class="min-w-[260px] flex-1">
            <span class="input-label">{{ t('admin.watch.search') }}</span>
            <div class="relative">
              <Icon name="search" size="sm" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input v-model.trim="search" class="input pl-9" :placeholder="t('admin.watch.filterPlaceholder')" />
            </div>
          </label>
          <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.autoRefreshHint') }}</div>
        </div>
        <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.keepaliveListHint') }}</p>
      </section>

      <section>
        <div class="mb-3 flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.keepaliveList') }}</h2>
          <span class="text-xs text-gray-500 dark:text-gray-400">{{ filteredSources.length }} / {{ sources.length }}</span>
        </div>
        <div v-if="loading && sources.length === 0" class="py-16 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('common.loading') }}</div>
        <div v-else-if="filteredSources.length === 0" class="border-y border-gray-200 py-16 text-center text-sm text-gray-500 dark:border-dark-700 dark:text-gray-400">{{ t('admin.watch.noKeepaliveRows') }}</div>
        <div v-else class="overflow-x-auto rounded-lg border border-gray-200 dark:border-dark-700">
          <table class="min-w-[1240px] text-left text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 dark:bg-dark-800/70 dark:text-gray-400">
              <tr>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.source') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.keepaliveState') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.keepaliveActive') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.lastKeepalive') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.lastSuccess') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.lastLatency') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.nextKeepalive') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.reason') }}</th>
                <th class="whitespace-nowrap px-4 py-3 text-right font-medium">{{ t('admin.watch.action') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-dark-700">
              <tr v-for="source in filteredSources" :key="source.id" class="bg-white align-top hover:bg-gray-50 dark:bg-dark-800 dark:hover:bg-dark-700/70">
                <td class="px-4 py-3">
                  <div class="flex min-w-[220px] items-start gap-2">
                    <Icon :name="source.enabled ? 'server' : 'ban'" size="sm" class="mt-0.5 flex-shrink-0 text-gray-400" />
                    <div class="min-w-0">
                      <div class="truncate font-medium text-gray-900 dark:text-white" :title="source.name">{{ source.name }}</div>
                      <div class="mt-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400" :title="source.base_url">{{ source.base_url }}</div>
                      <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ adapterLabel(source.adapter_type) }} · {{ source.keepalive_interval_seconds }}s</div>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-3"><span :class="stateClass(source.keepalive_state)"><Icon :name="stateIcon(source.keepalive_state)" size="xs" />{{ stateLabel(source.keepalive_state) }}</span></td>
                <td class="px-4 py-3">
                  <span :class="source.keepalive_active ? activeClass : inactiveClass">
                    <Icon :name="source.keepalive_active ? 'checkCircle' : 'xCircle'" size="xs" />
                    {{ source.keepalive_active ? t('admin.watch.keepaliveActive') : t('admin.watch.keepaliveInactive') }}
                  </span>
                  <div v-if="source.keepalive_valid_until" class="mt-1 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.keepaliveValidUntil') }} {{ formatDate(source.keepalive_valid_until) }}</div>
                </td>
                <td class="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-gray-200">{{ formatDate(source.last_keepalive_at) }}</td>
                <td class="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-gray-200">{{ formatDate(source.last_keepalive_success_at) }}</td>
                <td class="whitespace-nowrap px-4 py-3 font-mono text-gray-700 dark:text-gray-200">{{ source.last_keepalive_latency_ms == null ? '-' : `${source.last_keepalive_latency_ms} ms` }}</td>
                <td class="whitespace-nowrap px-4 py-3">
                  <div class="font-medium text-gray-900 dark:text-white">{{ countdownText(source) }}</div>
                  <div v-if="source.next_keepalive_at" class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ formatDate(source.next_keepalive_at) }}</div>
                </td>
                <td class="px-4 py-3">
                  <div class="max-w-[260px] text-xs text-gray-500 dark:text-gray-400">{{ sourceReason(source) }}</div>
                </td>
                <td class="px-4 py-3 text-right">
                  <div class="flex justify-end gap-2">
                    <button class="btn btn-secondary btn-sm" type="button" :disabled="runningId === source.id" :title="t('admin.watch.immediateCheck')" :aria-label="t('admin.watch.immediateCheck')" @click="runKeepalive(source)">
                      <Icon name="play" size="xs" :class="{ 'animate-pulse': runningId === source.id }" />
                      {{ t('admin.watch.immediateCheck') }}
                    </button>
                    <button class="btn btn-secondary btn-sm" type="button" :title="t('admin.watch.openKeepaliveHistory')" :aria-label="t('admin.watch.openKeepaliveHistory')" @click="openDetails(source)">
                      <Icon name="eye" size="xs" />
                      {{ t('admin.watch.openKeepaliveHistory') }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <div v-if="detailsOpen" class="fixed inset-0 z-50 flex justify-end bg-black/30" @click.self="closeDetails">
      <aside class="h-full w-full max-w-3xl overflow-y-auto bg-white p-6 shadow-xl dark:bg-dark-900">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.keepaliveHistory') }}</h2>
            <p class="mt-1 truncate text-sm text-gray-500 dark:text-gray-400" :title="activeDetailSource?.name">{{ activeDetailSource?.name || '-' }}</p>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" :aria-label="t('admin.watch.closeDetails')" @click="closeDetails"><Icon name="x" size="sm" /></button>
        </div>
        <div class="mt-5 grid gap-3 sm:grid-cols-3">
          <div class="rounded-lg border border-gray-200 p-3 dark:border-dark-700">
            <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.keepaliveState') }}</div>
            <div class="mt-2"><span :class="stateClass(activeDetailSource?.keepalive_state)"><Icon :name="stateIcon(activeDetailSource?.keepalive_state)" size="xs" />{{ stateLabel(activeDetailSource?.keepalive_state) }}</span></div>
          </div>
          <div class="rounded-lg border border-gray-200 p-3 dark:border-dark-700">
            <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.lastTokenRefresh') }}</div>
            <div class="mt-2 text-sm font-medium text-gray-900 dark:text-white">{{ formatDate(activeDetailSource?.last_token_refreshed_at) }}</div>
          </div>
          <div class="rounded-lg border border-gray-200 p-3 dark:border-dark-700">
            <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.heartbeatPath') }}</div>
            <div class="mt-2 truncate font-mono text-sm text-gray-900 dark:text-white" :title="activeDetailSource?.heartbeat_path">{{ activeDetailSource?.heartbeat_path || '-' }}</div>
          </div>
        </div>
        <div class="mt-5 overflow-x-auto border-y border-gray-200 dark:border-dark-700">
          <table class="min-w-full text-left text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 dark:bg-dark-800/70 dark:text-gray-400">
              <tr>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.observedAt') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('common.status') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.lastLatency') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.errorCode') }}</th>
                <th class="whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.validUntil') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-dark-700">
              <tr v-if="checksLoading"><td colspan="5" class="px-4 py-10 text-center text-gray-500 dark:text-gray-400">{{ t('common.loading') }}</td></tr>
              <tr v-else-if="checks.length === 0"><td colspan="5" class="px-4 py-10 text-center text-gray-500 dark:text-gray-400">{{ t('admin.watch.noChecks') }}</td></tr>
              <tr v-for="check in checks" v-else :key="check.id" class="bg-white dark:bg-dark-900">
                <td class="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-gray-200">{{ formatDate(check.observed_at) }}</td>
                <td class="px-4 py-3"><span :class="statusClass(check.status)">{{ statusLabel(check.status) }}</span></td>
                <td class="whitespace-nowrap px-4 py-3 font-mono">{{ check.latency_ms == null ? '-' : `${check.latency_ms} ms` }}</td>
                <td class="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{{ check.error_code ? watchReasonText(t, check.error_code) : '-' }}</td>
                <td class="whitespace-nowrap px-4 py-3 text-gray-500 dark:text-gray-400">{{ formatDate(check.expires_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </aside>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import Icon from '@/components/icons/Icon.vue'
import { useAppStore } from '@/stores/app'
import { keepaliveSource, listSourceChecks, listSources, type WatchKeepaliveState, type WatchSource, type WatchSourceCheck } from '@/api/admin/watch'
import { watchReasonText, watchStatusLabel } from './watchText'

const { t, locale } = useI18n()
const appStore = useAppStore()
const sources = ref<WatchSource[]>([])
const checks = ref<WatchSourceCheck[]>([])
const statusFilter = ref<'all' | WatchKeepaliveState>('all')
const search = ref('')
const selectedSourceId = ref<number | null>(null)
const detailsOpen = ref(false)
const loading = ref(false)
const checksLoading = ref(false)
const runningId = ref<number | null>(null)
const error = ref('')
const fetchedAt = ref(Date.now())
const nowTick = ref(Date.now())
let refreshTimer: ReturnType<typeof setInterval> | undefined
let tickTimer: ReturnType<typeof setInterval> | undefined

const activeClass = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
const inactiveClass = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-dark-700 dark:text-gray-300'

const filteredSources = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return sources.value.filter((source) => {
    if (statusFilter.value !== 'all' && (source.keepalive_state || 'waiting') !== statusFilter.value) return false
    if (!keyword) return true
    return [
      source.name,
      source.base_url,
      source.api_base_url,
      source.last_keepalive_error_code,
      source.keepalive_state_reason
    ].some((value) => (value || '').toLowerCase().includes(keyword))
  })
})
const activeCount = computed(() => sources.value.filter((source) => source.keepalive_active).length)
const failedCount = computed(() => sources.value.filter((source) => source.keepalive_state === 'failed').length)
const dueCount = computed(() => sources.value.filter((source) => source.keepalive_due && source.keepalive_state !== 'disabled').length)
const disabledCount = computed(() => sources.value.filter((source) => source.keepalive_state === 'disabled').length)
const activeDetailSource = computed(() => selectedSourceId.value == null ? null : sources.value.find((source) => source.id === selectedSourceId.value) || null)

function errorMessage(err: any, fallback: string) {
  const message = err?.response?.data?.message || err?.message
  return message ? watchReasonText(t, message, fallback) : fallback
}

async function refreshAll() {
  loading.value = true
  error.value = ''
  try {
    sources.value = await listSources()
    fetchedAt.value = Date.now()
    if (detailsOpen.value && selectedSourceId.value) await loadChecks(selectedSourceId.value)
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.sourcesLoadFailed'))
  } finally {
    loading.value = false
  }
}

async function loadChecks(sourceId: number) {
  checksLoading.value = true
  try {
    checks.value = await listSourceChecks(sourceId, 50, 'keepalive')
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.checksLoadFailed'))
  } finally {
    checksLoading.value = false
  }
}

async function runKeepalive(source: WatchSource) {
  runningId.value = source.id
  error.value = ''
  try {
    await keepaliveSource(source.id)
    appStore.showSuccess(t('admin.watch.checkCompleted'))
    await refreshAll()
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.checkFailed'))
  } finally {
    runningId.value = null
  }
}

async function openDetails(source: WatchSource) {
  selectedSourceId.value = source.id
  detailsOpen.value = true
  checks.value = []
  await loadChecks(source.id)
}

function closeDetails() {
  detailsOpen.value = false
  selectedSourceId.value = null
  checks.value = []
}

function stateLabel(state?: string) {
  const key = `admin.watch.keepaliveState_${state || 'waiting'}`
  const translated = t(key)
  return translated === key ? t('admin.watch.keepaliveState_waiting') : translated
}

function stateIcon(state?: string) {
  if (state === 'active') return 'checkCircle'
  if (state === 'failed') return 'exclamationTriangle'
  if (state === 'checking') return 'refresh'
  if (state === 'disabled') return 'ban'
  return 'clock'
}

function stateClass(state?: string) {
  const base = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium '
  if (state === 'active') return base + 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (state === 'failed') return base + 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  if (state === 'checking') return base + 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (state === 'disabled') return base + 'bg-gray-100 text-gray-600 dark:bg-dark-700 dark:text-gray-300'
  return base + 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
}

function statusLabel(status?: string) { return watchStatusLabel(t, status) }
function statusClass(status?: string) {
  const base = 'inline-flex rounded-full px-2.5 py-1 text-xs font-medium '
  if (status === 'healthy' || status === 'success') return base + 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (status === 'degraded') return base + 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  if (status === 'error') return base + 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  return base + 'bg-gray-100 text-gray-600 dark:bg-dark-700 dark:text-gray-300'
}

function sourceReason(source: WatchSource) {
  const reason = source.keepalive_state_reason || source.last_keepalive_error_code
  return reason ? watchReasonText(t, reason) : '-'
}

function remainingSeconds(source: WatchSource) {
  if (source.keepalive_state === 'disabled') return null
  const base = Number(source.next_keepalive_in_seconds || 0)
  const elapsed = Math.floor((nowTick.value - fetchedAt.value) / 1000)
  return Math.max(0, base - elapsed)
}

function countdownText(source: WatchSource) {
  const seconds = remainingSeconds(source)
  if (seconds == null) return '-'
  if (seconds <= 0) return t('admin.watch.keepaliveDueNow')
  return formatDuration(seconds)
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const min = minutes % 60
  return min ? `${hours}h ${min}m` : `${hours}h`
}

function adapterLabel(adapter?: string) {
  const key = `admin.watch.adapter_${adapter || 'custom'}`
  const translated = t(key)
  return translated === key ? adapter || '-' : translated
}

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '-'
}

onMounted(async () => {
  await refreshAll()
  refreshTimer = setInterval(refreshAll, 30_000)
  tickTimer = setInterval(() => { nowTick.value = Date.now() }, 1_000)
})
onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  if (tickTimer) clearInterval(tickTimer)
})
</script>
