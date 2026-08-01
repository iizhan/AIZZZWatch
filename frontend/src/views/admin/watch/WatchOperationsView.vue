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
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import { getOperationsReport, type WatchOperationsAlert, type WatchOperationsReport } from '@/api/admin/watch'

const { t, locale } = useI18n()
const loading = ref(false)
const error = ref('')
const windowDays = ref(7)
const report = ref<WatchOperationsReport | null>(null)

const alerts = computed(() => report.value?.alerts ?? [])

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

onMounted(loadReport)
</script>
