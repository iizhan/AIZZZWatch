<template>
  <AppLayout>
    <div class="watch-surface space-y-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.operationsTitle') }}</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('admin.watch.operationsDescription') }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <label class="text-sm text-gray-600 dark:text-gray-300" for="watch-operations-window">
            {{ t('admin.watch.windowDays') }}
          </label>
          <select
            id="watch-operations-window"
            v-model.number="windowDays"
            class="input w-28"
            :disabled="loading"
            @change="loadReport"
          >
            <option :value="7">7</option>
            <option :value="14">14</option>
            <option :value="30">30</option>
            <option :value="90">90</option>
          </select>
          <button class="btn btn-secondary" type="button" :disabled="loading" @click="loadReport">
            {{ loading ? t('common.loading') : t('admin.watch.refresh') }}
          </button>
        </div>
      </div>

      <div
        v-if="error"
        class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200"
      >
        {{ error }}
      </div>

      <div
        class="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-100"
      >
        {{ t('admin.watch.operationsEstimateNotice') }}
      </div>

      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div
          v-for="item in summaryItems"
          :key="item.label"
          class="rounded-lg border border-gray-200 bg-white p-4 dark:border-dark-700 dark:bg-dark-800"
        >
          <div class="text-xs text-gray-500 dark:text-gray-400">{{ item.label }}</div>
          <div class="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">{{ item.value }}</div>
          <div v-if="item.hint" class="mt-2 text-xs text-gray-500 dark:text-gray-400">{{ item.hint }}</div>
        </div>
      </div>

      <section class="rounded-lg border border-gray-200 bg-white dark:border-dark-700 dark:bg-dark-800">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4 dark:border-dark-700">
          <div>
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.operationsAlerts') }}</h2>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.operationsAlertsHint') }}</p>
          </div>
          <span class="text-xs text-gray-500 dark:text-gray-400">{{ report ? formatDate(report.generated_at) : '-' }}</span>
        </div>

        <div v-if="loading && !report" class="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          {{ t('common.loading') }}
        </div>
        <div v-else-if="alerts.length === 0" class="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          {{ t('admin.watch.noOperationsAlerts') }}
        </div>
        <div v-else class="divide-y divide-gray-100 dark:divide-dark-700">
          <article v-for="alert in alerts" :key="alert.id" class="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span :class="severityClass(alert.severity)">{{ severityLabel(alert.severity) }}</span>
                <h3 class="font-medium text-gray-900 dark:text-white">{{ alertTitle(alert) }}</h3>
              </div>
              <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">{{ alertDescription(alert) }}</p>
            </div>
            <time v-if="alert.observed_at" class="text-xs text-gray-500 dark:text-gray-400">{{ formatDate(alert.observed_at) }}</time>
          </article>
        </div>
      </section>

      <section id="watch-rate-anomalies" class="rounded-lg border border-gray-200 bg-white dark:border-dark-700 dark:bg-dark-800">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-dark-700">
          <div>
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.rateAnomalies') }}</h2>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.rateAnomaliesHint') }}</p>
          </div>
          <div class="flex items-center gap-2">
            <select v-model="anomalyStatus" class="input h-10 w-32" :aria-label="t('admin.watch.rateAnomalyStatus')" @change="loadAnomalies">
              <option value="all">{{ t('admin.watch.allStatuses') }}</option>
              <option value="open">{{ t('admin.watch.rateAnomalyOpen') }}</option>
              <option value="resolved">{{ t('admin.watch.rateAnomalyResolved') }}</option>
            </select>
            <button class="icon-action" type="button" :disabled="anomalyLoading" :title="t('common.refresh')" :aria-label="t('common.refresh')" @click="loadAnomalies">
              <Icon name="refresh" size="sm" :class="{ 'animate-spin': anomalyLoading }" />
            </button>
          </div>
        </div>
        <div v-if="anomalyLoading && anomalies.length === 0" class="py-12 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('common.loading') }}</div>
        <div v-else-if="anomalies.length === 0" class="py-12 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('admin.watch.noRateAnomalies') }}</div>
        <div v-else class="overflow-x-auto">
          <table class="min-w-[1180px] text-left text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 dark:bg-dark-800/70 dark:text-gray-400">
              <tr>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.targetGroup') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.rateAnomalyKind') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.valueChange') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.pricingEvidence') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.status') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.detectedAt') }}</th>
                <th class="px-4 py-3 text-right font-medium">{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-dark-700">
              <tr v-for="anomaly in anomalies" :key="anomaly.id" class="align-top" :class="{ 'bg-amber-50 dark:bg-amber-900/10': focusedAnomalyId === anomaly.id }">
                <td class="px-4 py-3">
                  <div class="font-medium text-gray-900 dark:text-white">{{ anomaly.group_name || `#${anomaly.target_group_id}` }}</div>
                  <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">#{{ anomaly.id }}</div>
                </td>
                <td class="px-4 py-3"><span :class="anomalyKindClass(anomaly.kind)">{{ anomalyKindLabel(anomaly.kind) }}</span></td>
                <td class="px-4 py-3 font-mono text-gray-700 dark:text-gray-200">{{ formatMoney(anomaly.current_value) }} → {{ formatMoney(anomaly.target_value) }}</td>
                <td class="px-4 py-3">
                  <div class="text-gray-700 dark:text-gray-200">{{ pricingSourceLabel(anomaly.pricing_source) }}</div>
                  <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.evidenceCounts', { official: anomaly.official_probe_count, fallback: anomaly.watch_fallback_count, mismatch: anomaly.evidence_mismatch_count }) }}</div>
                </td>
                <td class="px-4 py-3"><span :class="anomalyStatusClass(anomaly.status)">{{ anomaly.status === 'open' ? t('admin.watch.rateAnomalyOpen') : t('admin.watch.rateAnomalyResolved') }}</span></td>
                <td class="px-4 py-3 text-gray-500 dark:text-gray-400">{{ formatDate(anomaly.detected_at) }}</td>
                <td class="px-4 py-3 text-right">
                  <button
                    v-if="anomaly.kind === 'overpriced'"
                    class="btn btn-secondary btn-sm"
                    type="button"
                    :disabled="anomaly.status !== 'resolved' || previewingAnomalyId === anomaly.id"
                    @click="openCompensation(anomaly)"
                  >
                    {{ anomaly.status === 'resolved' ? t('admin.watch.previewCompensation') : t('admin.watch.resolveBeforeCompensation') }}
                  </button>
                  <span v-else class="text-xs text-gray-400">{{ t('admin.watch.noUserCompensation') }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <BaseDialog :show="Boolean(compensationPreview)" :title="t('admin.watch.compensationPreview')" width="wide" @close="closeCompensation">
      <div v-if="compensationPreview" class="space-y-5">
        <div class="grid gap-x-5 gap-y-3 border-y border-gray-200 py-3 sm:grid-cols-2 xl:grid-cols-[minmax(18rem,2fr)_repeat(3,minmax(7rem,1fr))] dark:border-dark-700">
          <div><div class="text-xs text-gray-500">{{ t('admin.watch.compensationWindow') }}</div><div class="mt-1 text-sm text-gray-900 dark:text-white">{{ formatDate(compensationPreview.window_start) }} → {{ formatDate(compensationPreview.window_end) }}</div></div>
          <div><div class="text-xs text-gray-500">{{ t('admin.watch.eligibleUsers') }}</div><div class="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{{ compensationPreview.eligible_count }}</div></div>
          <div><div class="text-xs text-gray-500">{{ t('admin.watch.candidateAmount') }}</div><div class="mt-1 text-lg font-semibold text-emerald-700 dark:text-emerald-300">{{ formatMoney(compensationPreview.candidate_amount) }}</div></div>
          <div><div class="text-xs text-gray-500">{{ t('admin.watch.unresolvedRequests') }}</div><div class="mt-1 text-lg font-semibold text-amber-700 dark:text-amber-300">{{ compensationPreview.unresolved_request_count }}</div></div>
        </div>
        <div class="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-100">{{ t('admin.watch.compensationSafetyNotice') }}</div>
        <div class="max-h-80 overflow-auto border-y border-gray-200 dark:border-dark-700">
          <table class="min-w-[920px] text-left text-sm">
            <thead class="sticky top-0 bg-gray-50 text-xs text-gray-500 dark:bg-dark-800 dark:text-gray-400"><tr><th class="px-3 py-2"><span class="sr-only">{{ t('common.select') }}</span></th><th class="px-3 py-2">{{ t('admin.watch.user') }}</th><th class="px-3 py-2">{{ t('admin.watch.requestCount') }}</th><th class="px-3 py-2">{{ t('admin.watch.exactRequests') }}</th><th class="px-3 py-2">{{ t('admin.watch.unresolvedRequests') }}</th><th class="px-3 py-2">{{ t('admin.watch.actualCharged') }}</th><th class="px-3 py-2">{{ t('admin.watch.expectedCharged') }}</th><th class="px-3 py-2">{{ t('admin.watch.candidateAmount') }}</th></tr></thead>
            <tbody class="divide-y divide-gray-100 dark:divide-dark-700">
              <tr v-for="row in compensationPreview.rows" :key="row.user_id" :class="{ 'opacity-60': !row.eligible }">
                <td class="px-3 py-2"><input v-model="selectedUserIds" type="checkbox" :value="row.user_id" :disabled="!row.eligible" :aria-label="t('admin.watch.selectCompensationUser', { user: row.username || row.email || row.user_id })" /></td>
                <td class="px-3 py-2"><div class="font-medium text-gray-900 dark:text-white">{{ row.username || '-' }}</div><div class="text-xs text-gray-500">{{ row.email || `#${row.user_id}` }}</div><div v-if="row.reason" class="mt-1 text-xs text-amber-700 dark:text-amber-300">{{ compensationReasonLabel(row.reason) }}</div></td>
                <td class="px-3 py-2">{{ row.request_count }}</td><td class="px-3 py-2">{{ row.eligible_request_count }}</td><td class="px-3 py-2">{{ row.unresolved_request_count }}</td><td class="px-3 py-2 font-mono">{{ formatMoney(row.actual_cost) }}</td><td class="px-3 py-2 font-mono">{{ formatMoney(row.expected_cost) }}</td><td class="px-3 py-2 font-mono font-semibold text-emerald-700 dark:text-emerald-300">{{ formatMoney(row.candidate_amount) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <label class="block"><span class="input-label">{{ t('admin.watch.compensationReason') }}</span><input v-model.trim="compensationReason" class="input h-10 w-full" maxlength="500" /></label>
        <label class="flex items-start gap-2 rounded-md border border-gray-200 p-3 text-sm text-gray-700 dark:border-dark-700 dark:text-gray-200"><input v-model="compensationConfirmed" type="checkbox" class="mt-0.5 h-4 w-4 shrink-0" />{{ t('admin.watch.compensationConfirmNotice') }}</label>
      </div>
      <template #footer>
        <div class="flex justify-end gap-3"><button class="btn btn-secondary" type="button" @click="() => closeCompensation()">{{ t('common.cancel') }}</button><button class="btn btn-primary" type="button" :disabled="!canApplyCompensation || applyingCompensation" @click="confirmCompensation">{{ applyingCompensation ? t('admin.watch.compensating') : t('admin.watch.confirmCompensation') }}</button></div>
      </template>
    </BaseDialog>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import AppLayout from '@/components/layout/AppLayout.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import Icon from '@/components/icons/Icon.vue'
import { useAppStore } from '@/stores/app'
import {
  applyRateCompensation,
  getOperationsReport,
  listRateAnomalies,
  previewRateCompensation,
  type WatchOperationsAlert,
  type WatchOperationsReport,
  type WatchRateAnomaly,
  type WatchRateAnomalyKind,
  type WatchRateAnomalyStatus,
  type WatchRateCompensationPreview,
} from '@/api/admin/watch'

const { t, locale } = useI18n()
const route = useRoute()
const appStore = useAppStore()
const loading = ref(false)
const anomalyLoading = ref(false)
const previewingAnomalyId = ref<number | null>(null)
const applyingCompensation = ref(false)
const error = ref('')
const windowDays = ref(7)
const report = ref<WatchOperationsReport | null>(null)
const anomalies = ref<WatchRateAnomaly[]>([])
const anomalyStatus = ref<'all' | WatchRateAnomalyStatus>('all')
const compensationPreview = ref<WatchRateCompensationPreview | null>(null)
const selectedUserIds = ref<number[]>([])
const compensationReason = ref('')
const compensationConfirmed = ref(false)

const alerts = computed(() => report.value?.alerts ?? [])
const focusedAnomalyId = computed(() => Number.parseInt(String(route.query.anomaly_id || '0'), 10) || 0)
const canApplyCompensation = computed(() => compensationConfirmed.value && selectedUserIds.value.length > 0 && compensationReason.value.trim().length > 0)

const summaryItems = computed(() => {
  const summary = report.value?.summary
  return [
    { label: t('admin.watch.estimatedRevenue'), value: formatMoney(summary?.revenue), hint: t('admin.watch.estimatedRevenueHint') },
    { label: t('admin.watch.estimatedUpstreamCost'), value: formatMoney(summary?.estimated_upstream_cost), hint: t('admin.watch.estimatedUpstreamCostHint') },
    { label: t('admin.watch.estimatedGrossProfit'), value: formatMoney(summary?.gross_profit), hint: formatMargin(summary?.gross_margin) },
    { label: t('admin.watch.requestCount'), value: formatInteger(summary?.request_count), hint: t('admin.watch.requestCountHint', { loss: summary?.loss_request_count ?? 0, unresolved: summary?.unresolved_request_count ?? 0 }) },
    { label: t('admin.watch.accountCoverage'), value: formatInteger(summary?.account_count), hint: t('admin.watch.groupCoverage', { count: summary?.group_count ?? 0 }) },
    { label: t('admin.watch.windowRange'), value: summary ? `${formatDate(summary.window_start)} → ${formatDate(summary.window_end)}` : '-', hint: t('admin.watch.windowRangeHint') },
  ]
})

async function loadReport() {
  loading.value = true
  error.value = ''
  try {
    report.value = await getOperationsReport(windowDays.value)
  } catch (err: any) {
    error.value = err?.response?.data?.message || err?.message || t('admin.watch.operationsLoadFailed')
  } finally {
    loading.value = false
  }
}

async function loadAnomalies() {
  anomalyLoading.value = true
  try {
    anomalies.value = await listRateAnomalies({ status: anomalyStatus.value, limit: 100 })
  } catch (err: any) {
    error.value = err?.response?.data?.message || err?.message || t('admin.watch.rateAnomaliesLoadFailed')
  } finally {
    anomalyLoading.value = false
  }
}

async function loadAll() {
  error.value = ''
  await Promise.all([loadReport(), loadAnomalies()])
}

async function openCompensation(anomaly: WatchRateAnomaly) {
  previewingAnomalyId.value = anomaly.id
  error.value = ''
  try {
    const preview = await previewRateCompensation(anomaly.id)
    compensationPreview.value = preview
    selectedUserIds.value = preview.rows.filter((row) => row.eligible).map((row) => row.user_id)
    compensationReason.value = t('admin.watch.defaultCompensationReason')
    compensationConfirmed.value = false
  } catch (err: any) {
    error.value = err?.response?.data?.message || err?.message || t('admin.watch.compensationPreviewFailed')
  } finally {
    previewingAnomalyId.value = null
  }
}

function closeCompensation(force = false) {
  if (applyingCompensation.value && !force) return
  compensationPreview.value = null
  selectedUserIds.value = []
  compensationReason.value = ''
  compensationConfirmed.value = false
}

async function confirmCompensation() {
  const preview = compensationPreview.value
  if (!preview || !canApplyCompensation.value) return
  applyingCompensation.value = true
  try {
    const result = await applyRateCompensation(preview.anomaly.id, {
      user_ids: selectedUserIds.value,
      confirmed: true,
      idempotency_key: operationKey(`watch-rate-comp:${preview.anomaly.id}`),
      reason: compensationReason.value.trim(),
    })
    appStore.showSuccess(t('admin.watch.compensationApplied', { count: result.applied_count, amount: formatMoney(result.compensated_amount) }))
    closeCompensation(true)
    await loadAnomalies()
  } catch (err: any) {
    error.value = err?.response?.data?.message || err?.message || t('admin.watch.compensationFailed')
  } finally {
    applyingCompensation.value = false
  }
}

function operationKey(prefix: string) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}:${random}`
}

function formatMoney(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-'
  return new Intl.NumberFormat(locale.value, { minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(value)
}

function formatInteger(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-'
  return new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }).format(value)
}

function formatMargin(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return t('admin.watch.grossMarginUnavailable')
  return t('admin.watch.estimatedGrossMargin', {
    value: new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 2 }).format(value),
  })
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function severityLabel(severity: WatchOperationsAlert['severity']) {
  return t(`admin.watch.alertSeverity_${severity}`)
}

function severityClass(severity: WatchOperationsAlert['severity']) {
  const base = 'inline-flex rounded-full px-2.5 py-1 text-xs font-medium '
  if (severity === 'critical') return base + 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'
  if (severity === 'warning') return base + 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-100'
  return base + 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
}

function anomalyKindLabel(kind: WatchRateAnomalyKind) {
  return kind === 'underpriced' ? t('admin.watch.rateAnomalyUnderpriced') : t('admin.watch.rateAnomalyOverpriced')
}

function anomalyKindClass(kind: WatchRateAnomalyKind) {
  const base = 'inline-flex rounded-full px-2.5 py-1 text-xs font-medium '
  return kind === 'underpriced'
    ? base + 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'
    : base + 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-100'
}

function anomalyStatusClass(status: WatchRateAnomalyStatus) {
  const base = 'inline-flex rounded-full px-2.5 py-1 text-xs font-medium '
  return status === 'open'
    ? base + 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'
    : base + 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
}

function pricingSourceLabel(source: WatchRateAnomaly['pricing_source']) {
  const key = `admin.watch.pricingSource_${source}`
  const translated = t(key)
  return translated === key ? source : translated
}

function compensationReasonLabel(reason: string) {
  const map: Record<string, string> = {
    'underpriced incidents do not create user compensation': t('admin.watch.compensationReasonUnderpriced'),
    'rate anomaly is still open': t('admin.watch.compensationReasonOpen'),
    'compensation has already been recorded': t('admin.watch.compensationReasonRecorded'),
    'no overcharge was found': t('admin.watch.compensationReasonNone'),
    'unsupported or ambiguous usage is excluded and requires review': t('admin.watch.compensationReasonPartial'),
  }
  return map[reason] || reason
}

function alertTitle(alert: WatchOperationsAlert) {
  return t(`admin.watch.alertKind_${alert.kind}`)
}

function alertDescription(alert: WatchOperationsAlert) {
  const name = alert.entity_name || '-'
  if (alert.kind === 'source_low_balance') {
    return t('admin.watch.alertSourceLowBalanceDescription', {
      name,
      value: formatMoney(alert.value),
      threshold: formatMoney(alert.threshold),
    })
  }
  if (alert.kind === 'price_increase') {
    return t('admin.watch.alertPriceIncreaseDescription', {
      name,
      previous: formatMoney(alert.previous_value),
      next: formatMoney(alert.next_value),
      target: [alert.platform, alert.model, alert.component].filter(Boolean).join(' / ') || '-',
    })
  }
  return t('admin.watch.alertGenericDescription', {
    name,
    status: alert.status || '-',
    code: alert.error_code || '-',
  })
}

onMounted(async () => {
  await loadAll()
  if (focusedAnomalyId.value > 0) {
    await nextTick()
    document.getElementById('watch-rate-anomalies')?.scrollIntoView({ block: 'start' })
  }
})
</script>

<style scoped>
.icon-action { @apply inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-dark-700 dark:hover:text-white; }
</style>
