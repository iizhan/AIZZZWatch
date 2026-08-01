<template>
  <AppLayout>
    <div class="watch-surface space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.pricingTitle') }}</h1>
          <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{{ t('admin.watch.pricingBoardDescription') }}</p>
        </div>
        <button class="btn btn-secondary" type="button" :disabled="loading" @click="loadBoard">
          <Icon name="refresh" size="sm" :class="{ 'animate-spin': loading }" />
          <span>{{ t('common.refresh') }}</span>
        </button>
      </div>

      <div v-if="error" class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200" role="alert">
        <span>{{ error }}</span>
        <button class="font-medium underline" type="button" @click="loadBoard">{{ t('admin.watch.retry') }}</button>
      </div>

      <dl class="grid grid-cols-5 divide-x divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:divide-dark-700 dark:border-dark-700 dark:bg-dark-800">
        <div v-for="item in summaryItems" :key="item.label" class="min-w-0 px-2.5 py-2 sm:px-3">
          <dt class="truncate text-[11px] text-gray-500 dark:text-gray-400" :title="item.label">{{ item.label }}</dt>
          <dd class="mt-0.5 truncate text-base font-semibold tabular-nums text-gray-900 dark:text-white" :title="String(item.value)">{{ item.value }}</dd>
        </div>
      </dl>

      <section class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm dark:border-dark-700 dark:bg-dark-800">
        <div class="grid gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(220px,1.5fr)_40px]">
          <label class="block text-xs text-gray-600 dark:text-gray-300">
            {{ t('admin.watch.source') }}
            <select v-model.number="filters.source_id" class="input mt-1 w-full" @change="applyFilters">
              <option :value="0">{{ t('admin.watch.allSources') }}</option>
              <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option>
            </select>
          </label>
          <label class="block text-xs text-gray-600 dark:text-gray-300">
            {{ t('admin.watch.platform') }}
            <select v-model="filters.platform" class="input mt-1 w-full" @change="applyFilters">
              <option value="">{{ t('admin.watch.allPlatforms') }}</option>
              <option v-for="platform in platformOptions" :key="platform.value" :value="platform.value">{{ platform.label }}</option>
            </select>
          </label>
          <label class="block text-xs text-gray-600 dark:text-gray-300">
            {{ t('admin.watch.changeDirection') }}
            <select v-model="filters.change_kind" class="input mt-1 w-full" @change="applyFilters">
              <option value="all">{{ t('admin.watch.allChanges') }}</option>
              <option value="increase">{{ t('admin.watch.increase') }}</option>
              <option value="decrease">{{ t('admin.watch.decrease') }}</option>
            </select>
          </label>
          <label class="block text-xs text-gray-600 dark:text-gray-300">
            {{ t('admin.watch.usageState') }}
            <select v-model="filters.in_use" class="input mt-1 w-full" @change="applyFilters">
              <option value="all">{{ t('admin.watch.allUsageStates') }}</option>
              <option value="true">{{ t('admin.watch.inUse') }}</option>
              <option value="false">{{ t('admin.watch.notInUse') }}</option>
            </select>
          </label>
          <label class="block text-xs text-gray-600 dark:text-gray-300">
            {{ t('admin.watch.search') }}
            <input v-model.trim="filters.search" class="input mt-1 w-full" :placeholder="t('admin.watch.searchPricingPlaceholder')" @keyup.enter="applyFilters" />
          </label>
          <button class="btn btn-primary mt-auto h-10 w-10 p-0" type="button" :disabled="loading" :title="t('admin.watch.applyFilters')" :aria-label="t('admin.watch.applyFilters')" @click="applyFilters">
            <Icon name="search" size="sm" />
          </button>
        </div>
      </section>

      <section class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-dark-700 dark:bg-dark-800">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-2.5 dark:border-dark-700">
          <div class="flex min-w-0 items-center gap-2">
            <h2 class="whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.procurementPriceBoard') }}</h2>
            <span class="truncate text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.pricingBoardHint') }}</span>
          </div>
          <span class="whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">{{ board ? formatDate(board.generated_at) : '-' }}</span>
        </div>

        <div v-if="loading && !board" class="py-16 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('common.loading') }}</div>
        <div v-else-if="rows.length === 0" class="flex min-h-56 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-gray-500 dark:text-gray-400">
          <span>{{ hasActiveFilters ? t('admin.watch.noPricingRowsForFilters') : t('admin.watch.noPricingRows') }}</span>
          <button v-if="hasActiveFilters" class="btn btn-secondary btn-sm" type="button" @click="clearFilters">{{ t('admin.watch.clearPricingFilters') }}</button>
        </div>
        <div v-else data-testid="pricing-table-scroll" class="max-h-[clamp(360px,calc(100vh-19rem),680px)] min-h-[320px] max-w-full overflow-auto">
          <table class="w-full min-w-[1040px] text-left text-sm">
            <thead class="sticky top-0 z-10 bg-gray-50 text-xs text-gray-500 shadow-[0_1px_0_rgba(0,0,0,0.06)] dark:bg-dark-800 dark:text-gray-400">
              <tr>
                <th class="w-[270px] min-w-[270px] whitespace-nowrap px-3 py-2.5 font-medium">
                  <button class="inline-flex items-center gap-1.5 whitespace-nowrap hover:text-primary-600 dark:hover:text-primary-300" type="button" :title="sortButtonTitle('source')" :aria-label="sortButtonTitle('source')" @click="setSort('source')">
                    <Icon name="server" size="xs" />
                    {{ t('admin.watch.sourceAndGroup') }}
                    <Icon :name="sortIconName('source')" size="xs" :class="sortIconClass('source')" aria-hidden="true" />
                  </button>
                </th>
                <th class="w-[95px] min-w-[95px] whitespace-nowrap px-3 py-2.5 font-medium">{{ t('admin.watch.platform') }}</th>
                <th class="w-[150px] min-w-[150px] whitespace-nowrap px-3 py-2.5 text-right font-medium">{{ t('admin.watch.costBreakdown') }}</th>
                <th class="w-[120px] min-w-[120px] whitespace-nowrap px-3 py-2.5 text-right font-medium">
                  <button class="inline-flex items-center justify-end gap-1.5 whitespace-nowrap hover:text-primary-600 dark:hover:text-primary-300" type="button" :title="sortButtonTitle('final_multiplier')" :aria-label="sortButtonTitle('final_multiplier')" @click="setSort('final_multiplier')">
                    {{ t('admin.watch.finalMultiplier') }}
                    <Icon :name="sortIconName('final_multiplier')" size="xs" :class="sortIconClass('final_multiplier')" aria-hidden="true" />
                  </button>
                </th>
                <th class="w-[160px] min-w-[160px] whitespace-nowrap px-3 py-2.5 font-medium">
                  <button class="inline-flex items-center gap-1.5 whitespace-nowrap hover:text-primary-600 dark:hover:text-primary-300" type="button" :title="sortButtonTitle('change')" :aria-label="sortButtonTitle('change')" @click="setSort('change')">
                    <Icon name="trendingUp" size="xs" />
                    {{ t('admin.watch.changeDirection') }}
                    <Icon :name="sortIconName('change')" size="xs" :class="sortIconClass('change')" aria-hidden="true" />
                  </button>
                </th>
                <th class="w-[120px] min-w-[120px] whitespace-nowrap px-3 py-2.5 font-medium">
                  <button class="inline-flex items-center gap-1.5 whitespace-nowrap hover:text-primary-600 dark:hover:text-primary-300" type="button" :title="sortButtonTitle('in_use')" :aria-label="sortButtonTitle('in_use')" @click="setSort('in_use')">
                    {{ t('admin.watch.usageState') }}
                    <Icon :name="sortIconName('in_use')" size="xs" :class="sortIconClass('in_use')" aria-hidden="true" />
                  </button>
                </th>
                <th class="w-[180px] min-w-[180px] whitespace-nowrap px-3 py-2.5 font-medium">
                  <button class="inline-flex items-center gap-1.5 whitespace-nowrap hover:text-primary-600 dark:hover:text-primary-300" type="button" :title="sortButtonTitle('observed_at')" :aria-label="sortButtonTitle('observed_at')" @click="setSort('observed_at')">
                    <Icon name="clock" size="xs" />
                    {{ t('admin.watch.healthAndObservedAt') }}
                    <Icon :name="sortIconName('observed_at')" size="xs" :class="sortIconClass('observed_at')" aria-hidden="true" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-dark-700">
              <template v-for="row in pagedRows" :key="pricingRowKey(row)">
                <tr data-testid="pricing-row" class="bg-white transition hover:bg-gray-50 dark:bg-dark-800 dark:hover:bg-dark-700/50">
                <td class="max-w-[270px] px-3 py-2">
                  <button class="block max-w-[246px] truncate text-left font-medium text-primary-600 hover:underline dark:text-primary-300" type="button" :title="row.group_name || row.group_external_id" @click="openHistory(row)">
                    {{ row.group_name || row.group_external_id }}
                  </button>
                  <div class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <span class="max-w-[120px] truncate" :title="row.source_name">{{ row.source_name }}</span>
                    <span aria-hidden="true">·</span>
                    <span class="whitespace-nowrap">{{ adapterLabel(row.adapter_type) }}</span>
                    <button class="inline-flex items-center gap-1 whitespace-nowrap text-primary-600 hover:underline dark:text-primary-300" type="button" :aria-expanded="expandedRowKey === pricingRowKey(row)" @click="toggleRowDetails(row)">
                      {{ row.model_prices?.length ? t('admin.watch.modelPriceCount', { count: row.model_prices.length }) : t('admin.watch.pricingRowDetails') }}
                      <Icon :name="expandedRowKey === pricingRowKey(row) ? 'chevronUp' : 'chevronDown'" size="xs" />
                    </button>
                  </div>
                </td>
                <td class="whitespace-nowrap px-3 py-2">
                  <span class="inline-flex whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-dark-700 dark:text-gray-200">{{ platformDisplay(row.platform) }}</span>
                </td>
                <td class="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-gray-700 dark:text-gray-200">
                  <button class="hover:text-primary-600 dark:hover:text-primary-300" type="button" @click="openHistory(row)">
                    {{ formatValue(row.user_rate_multiplier ?? row.rate_multiplier) }} ÷ {{ formatValue(row.recharge_ratio) }}
                  </button>
                  <div v-if="row.user_rate_multiplier != null" class="mt-0.5 text-[11px] text-gray-400">{{ t('admin.watch.userRateOverride') }}</div>
                </td>
                <td class="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold text-gray-900 dark:text-white">
                  <button class="hover:text-primary-600 dark:hover:text-primary-300" type="button" @click="openHistory(row)">
                    {{ formatValue(row.final_multiplier) }}
                  </button>
                </td>
                <td class="whitespace-nowrap px-3 py-2">
                  <button v-if="row.change_kind" :class="directionClass(row.change_kind)" type="button" @click="openHistory(row)">
                    <Icon :name="directionIcon(row.change_kind)" size="xs" />
                    {{ row.change_kind === 'increase' ? t('admin.watch.increase') : t('admin.watch.decrease') }}
                  </button>
                  <span v-else class="text-xs text-gray-400">{{ t('admin.watch.noRecentChange') }}</span>
                </td>
                <td class="whitespace-nowrap px-3 py-2">
                  <span :class="row.in_use ? usageClass(true) : usageClass(false)">
                    <Icon :name="row.in_use ? 'checkCircle' : 'xCircle'" size="xs" />
                    {{ row.in_use ? t('admin.watch.inUse') : t('admin.watch.notInUse') }}
                  </span>
                  <div class="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{{ t('admin.watch.accountCount', { count: row.in_use_account_count }) }}</div>
                </td>
                <td class="whitespace-nowrap px-3 py-2">
                  <span :class="statusClass(row.source_status)">
                    <Icon :name="statusIcon(row.source_status)" size="xs" :class="{ 'animate-spin': row.source_status === 'checking' }" />
                    {{ statusLabel(row.source_status) }}
                  </span>
                  <div class="mt-0.5 max-w-[160px] truncate text-[11px] text-gray-500 dark:text-gray-400" :title="row.source_error_code ? errorCodeLabel(row.source_error_code) : formatDate(row.observed_at)">
                    {{ row.source_error_code ? errorCodeLabel(row.source_error_code) : formatDate(row.observed_at) }}
                  </div>
                </td>
              </tr>
                <tr v-if="expandedRowKey === pricingRowKey(row)" class="bg-gray-50/80 dark:bg-dark-900/30">
                  <td colspan="7" class="px-4 py-3">
                    <div class="flex flex-wrap items-start gap-x-6 gap-y-2 text-xs">
                      <div class="min-w-0">
                        <span class="text-gray-500 dark:text-gray-400">{{ t('admin.watch.externalId') }}：</span>
                        <span class="font-mono text-gray-700 dark:text-gray-200">{{ row.group_external_id }}</span>
                      </div>
                      <div class="min-w-0 flex-1">
                        <span class="mr-2 text-gray-500 dark:text-gray-400">{{ t('admin.watch.modelPriceSnapshot') }}：</span>
                        <span v-if="!row.model_prices?.length" class="text-gray-400">-</span>
                        <button v-for="price in row.model_prices" :key="`${price.platform}:${price.model}`" class="mr-3 inline-flex max-w-[320px] truncate text-primary-600 hover:underline dark:text-primary-300" type="button" :title="modelPriceTitle(price)" @click="openHistory(row, price)">
                          {{ price.model }} · {{ compactModelPrice(price) }}
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <Pagination v-if="rows.length" :total="rows.length" :page="pagination.page" :page-size="pagination.page_size" :page-size-options="[20, 50, 100]" @update:page="changePage" @update:page-size="changePageSize" />
      </section>
    </div>

    <BaseDialog :show="Boolean(historyTarget)" :title="historyTitle" width="wide" @close="closeHistory">
      <div class="space-y-5">
        <div v-if="historyError" class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200" role="alert">{{ historyError }}</div>
        <div v-if="historyLoading" class="py-12 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('common.loading') }}</div>
        <template v-else-if="history">
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="rounded-lg border border-gray-200 p-3 dark:border-dark-700">
              <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.recordCount') }}</div>
              <div class="mt-1 text-xl font-semibold text-gray-900 dark:text-white">{{ history.summary.record_count }}</div>
            </div>
            <div class="rounded-lg border border-gray-200 p-3 dark:border-dark-700">
              <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.minValue') }}</div>
              <div class="mt-1 font-mono text-xl font-semibold text-gray-900 dark:text-white">{{ formatValue(history.summary.min_value) }}</div>
            </div>
            <div class="rounded-lg border border-gray-200 p-3 dark:border-dark-700">
              <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.maxValue') }}</div>
              <div class="mt-1 font-mono text-xl font-semibold text-gray-900 dark:text-white">{{ formatValue(history.summary.max_value) }}</div>
            </div>
          </div>

          <div class="rounded-lg border border-gray-200 p-4 dark:border-dark-700">
            <div class="mb-3 flex items-center justify-between">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.historyTrend') }}</h3>
              <select v-model="historyChangeKind" class="input w-36" @change="reloadHistory">
                <option value="all">{{ t('admin.watch.allChanges') }}</option>
                <option value="increase">{{ t('admin.watch.increase') }}</option>
                <option value="decrease">{{ t('admin.watch.decrease') }}</option>
              </select>
            </div>
            <svg v-if="history.points.length > 1" class="h-56 w-full overflow-visible" viewBox="0 0 640 220" role="img" :aria-label="t('admin.watch.historyTrend')">
              <polyline fill="none" stroke="currentColor" stroke-width="3" class="text-primary-500" :points="chartPolyline" />
              <circle v-for="(point, index) in chartPoints" :key="index" :cx="point.x" :cy="point.y" r="3" class="fill-primary-500" />
            </svg>
            <div v-else class="py-16 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('admin.watch.notEnoughHistory') }}</div>
          </div>

          <div class="rounded-lg border border-gray-200 dark:border-dark-700">
            <div class="border-b border-gray-200 px-4 py-3 dark:border-dark-700">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.changeEvents') }}</h3>
            </div>
            <div v-if="history.events.length === 0" class="py-10 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('admin.watch.noPriceChanges') }}</div>
            <div v-else class="max-h-72 divide-y divide-gray-100 overflow-y-auto dark:divide-dark-700">
              <article v-for="event in history.events" :key="event.id" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <span :class="directionClass(event.change_kind)">{{ event.change_kind === 'increase' ? t('admin.watch.increase') : t('admin.watch.decrease') }}</span>
                  <span class="ml-2 font-mono text-gray-700 dark:text-gray-200">{{ formatValue(event.previous_value) }} → {{ formatValue(event.next_value) }}</span>
                  <span class="ml-2 text-xs text-gray-500 dark:text-gray-400">{{ itemLabel(event) }}</span>
                </div>
                <time class="text-xs text-gray-500 dark:text-gray-400">{{ formatDate(event.observed_at) }}</time>
              </article>
            </div>
          </div>
        </template>
      </div>
    </BaseDialog>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import AppLayout from '@/components/layout/AppLayout.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import Pagination from '@/components/common/Pagination.vue'
import Icon from '@/components/icons/Icon.vue'
import {
  getPricingHistory,
  listPricingBoard,
  listSources,
  type WatchPricingBoard,
  type WatchPricingBoardModelPrice,
  type WatchPricingBoardRow,
  type WatchPricingHistory,
  type WatchPriceChange,
  type WatchSource,
} from '@/api/admin/watch'
import { GROUP_PLATFORMS, type GroupPlatform } from '@/types'
import { platformLabel } from '@/utils/platformColors'
import { watchReasonText, watchStatusLabel } from './watchText'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const loading = ref(false)
const error = ref('')
const board = ref<WatchPricingBoard | null>(null)
const sources = ref<WatchSource[]>([])
const history = ref<WatchPricingHistory | null>(null)
type HistoryComponent = 'group_multiplier' | 'input' | 'output' | 'per_request'
const historyTarget = ref<{
  row: WatchPricingBoardRow
  price?: WatchPricingBoardModelPrice
  platform?: string
  model?: string
  component?: HistoryComponent
} | null>(null)
const historyLoading = ref(false)
const historyError = ref('')
const historyChangeKind = ref<'all' | 'increase' | 'decrease'>('all')
let sourceRefreshTimer: ReturnType<typeof setInterval> | undefined
let sourceRefreshInFlight = false
let lastOpenedHistoryQueryKey = ''
const expandedRowKey = ref('')
type SortKey = 'final_multiplier' | 'observed_at' | 'source' | 'change' | 'in_use'

const filters = reactive<{
  source_id: number
  platform: '' | GroupPlatform
  change_kind: 'all' | 'increase' | 'decrease'
  in_use: 'all' | 'true' | 'false'
  sort: SortKey
  order: 'asc' | 'desc'
  search: string
}>({
  source_id: Number(route.query.source_id || 0),
  platform: normalizePlatform(route.query.platform),
  change_kind: ['increase', 'decrease'].includes(String(route.query.change_kind)) ? (String(route.query.change_kind) as 'increase' | 'decrease') : 'all',
  in_use: ['true', 'false'].includes(String(route.query.in_use)) ? (String(route.query.in_use) as 'true' | 'false') : 'all',
  sort: normalizeSort(route.query.sort),
  order: String(route.query.order || 'asc') === 'desc' ? 'desc' : 'asc',
  search: String(route.query.search || ''),
})

const pagination = reactive({
  page: normalizePage(route.query.page),
  page_size: normalizePageSize(route.query.page_size),
})

const rows = computed(() => board.value?.rows ?? [])
const totalPages = computed(() => Math.max(1, Math.ceil(rows.value.length / pagination.page_size)))
const pagedRows = computed(() => {
  const start = (pagination.page - 1) * pagination.page_size
  return rows.value.slice(start, start + pagination.page_size)
})
const hasActiveFilters = computed(() => Boolean(
  filters.source_id || filters.platform || filters.change_kind !== 'all' || filters.in_use !== 'all' || filters.search
))
const platformOptions = GROUP_PLATFORMS.map((value) => ({ value, label: platformLabel(value) }))
const summaryItems = computed(() => {
  const inUseRows = rows.value.filter((row) => row.in_use)
  const changedRows = rows.value.filter((row) => row.change_kind)
  const min = rows.value.length ? Math.min(...rows.value.map((row) => row.final_multiplier)) : undefined
  return [
    { label: t('admin.watch.boardRows'), value: rows.value.length },
    { label: t('admin.watch.inUseGroups'), value: inUseRows.length },
    { label: t('admin.watch.changedGroups'), value: changedRows.length },
    { label: t('admin.watch.lowestFinalMultiplier'), value: formatValue(min) },
    { label: t('admin.watch.sourceCount'), value: sources.value.length },
  ]
})

const historyTitle = computed(() => {
  const target = historyTarget.value
  if (!target) return t('admin.watch.priceHistory')
  const suffix = target.model
    ? `${target.model} / ${target.platform || target.row.platform}`
    : t('admin.watch.groupMultiplier')
  return `${target.row.source_name} · ${target.row.group_name || target.row.group_external_id} · ${suffix}`
})

const chartPoints = computed(() => {
  const points = history.value?.points ?? []
  if (points.length === 0) return []
  const values = points.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return points.map((point, index) => ({
    x: 24 + (index * 592) / Math.max(points.length - 1, 1),
    y: 196 - ((point.value - min) * 172) / span,
  }))
})
const chartPolyline = computed(() => chartPoints.value.map((point) => `${point.x},${point.y}`).join(' '))

function errorMessage(err: any, fallback: string) {
  const message = err?.message || err?.response?.data?.message
  return message ? watchReasonText(t, message, message) : fallback
}

async function loadBoard() {
  loading.value = true
  error.value = ''
  try {
    const params = {
      source_id: filters.source_id || undefined,
      platform: filters.platform || undefined,
      change_kind: filters.change_kind,
      in_use: filters.in_use,
      sort: filters.sort,
      order: filters.order,
      search: filters.search || undefined,
    }
    const [nextBoard, nextSources] = await Promise.all([listPricingBoard(params), listSources()])
    board.value = nextBoard
    sources.value = nextSources
    const nextTotalPages = Math.max(1, Math.ceil(nextBoard.rows.length / pagination.page_size))
    pagination.page = Math.min(pagination.page, nextTotalPages)
    await router.replace({ query: { ...cleanQuery(params), ...paginationQuery(), ...historyQueryFromRoute() } })
    openHistoryFromRouteRows(nextBoard.rows)
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.pricingBoardLoadFailed'))
  } finally {
    loading.value = false
  }
}

function historyQueryFromRoute() {
  const sourceID = route.query.history_source_id
  const groupExternalID = route.query.history_group_external_id
  if (!sourceID || !groupExternalID) return {}
  return {
    history_source_id: sourceID,
    history_group_external_id: groupExternalID,
    history_platform: route.query.history_platform || undefined,
    history_model: route.query.history_model || undefined,
    history_component: route.query.history_component || undefined,
  }
}

function cleanQuery(params: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '' && value !== 'all')) as Record<string, string | number>
}

function paginationQuery() {
  return {
    page: pagination.page > 1 ? pagination.page : undefined,
    page_size: pagination.page_size !== 20 ? pagination.page_size : undefined,
  }
}

function applyFilters() {
  pagination.page = 1
  loadBoard()
}

function clearFilters() {
  filters.source_id = 0
  filters.platform = ''
  filters.change_kind = 'all'
  filters.in_use = 'all'
  filters.search = ''
  pagination.page = 1
  loadBoard()
}

function changePage(page: number) {
  pagination.page = Math.min(Math.max(page, 1), totalPages.value)
  expandedRowKey.value = ''
  syncPaginationQuery()
}

function changePageSize(pageSize: number) {
  pagination.page_size = normalizePageSize(pageSize)
  pagination.page = 1
  expandedRowKey.value = ''
  syncPaginationQuery()
}

function syncPaginationQuery() {
  router.replace({
    query: {
      ...cleanQuery({
        source_id: filters.source_id || undefined,
        platform: filters.platform || undefined,
        change_kind: filters.change_kind,
        in_use: filters.in_use,
        sort: filters.sort,
        order: filters.order,
        search: filters.search || undefined,
      }),
      ...paginationQuery(),
      ...historyQueryFromRoute(),
    },
  })
}

function normalizePage(value: unknown) {
  const page = Number(value)
  return Number.isInteger(page) && page > 0 ? page : 1
}

function normalizePageSize(value: unknown) {
  const size = Number(value)
  return [20, 50, 100].includes(size) ? size : 20
}

function normalizeSort(value: unknown): SortKey {
  const sort = String(value || 'final_multiplier')
  return ['final_multiplier', 'observed_at', 'source', 'change', 'in_use'].includes(sort) ? (sort as SortKey) : 'final_multiplier'
}

function normalizePlatform(value: unknown): '' | GroupPlatform {
  const platform = String(value || '').toLowerCase()
  return (GROUP_PLATFORMS as readonly string[]).includes(platform) ? (platform as GroupPlatform) : ''
}

function setSort(sort: SortKey) {
  if (filters.sort === sort) {
    filters.order = filters.order === 'asc' ? 'desc' : 'asc'
  } else {
    filters.sort = sort
    filters.order = sort === 'source' ? 'asc' : 'desc'
  }
  pagination.page = 1
  loadBoard()
}

function pricingRowKey(row: WatchPricingBoardRow) {
  return `${row.source_id}:${row.group_external_id}:${row.platform || ''}`
}

function toggleRowDetails(row: WatchPricingBoardRow) {
  const key = pricingRowKey(row)
  expandedRowKey.value = expandedRowKey.value === key ? '' : key
}

function sortIconName(sort: SortKey): 'sort' | 'arrowUp' | 'arrowDown' {
  if (filters.sort !== sort) return 'sort'
  return filters.order === 'asc' ? 'arrowUp' : 'arrowDown'
}

function sortIconClass(sort: SortKey) {
  return filters.sort === sort ? 'text-primary-600 dark:text-primary-300' : 'text-gray-400 dark:text-gray-500'
}

function sortButtonTitle(sort: SortKey) {
  const labels: Record<SortKey, string> = {
    source: t('admin.watch.source'),
    final_multiplier: t('admin.watch.finalMultiplier'),
    change: t('admin.watch.changeDirection'),
    in_use: t('admin.watch.usageState'),
    observed_at: t('admin.watch.observedAt'),
  }
  const direction = filters.sort === sort
    ? (filters.order === 'asc' ? t('admin.watch.ascending') : t('admin.watch.descending'))
    : t('admin.watch.sortBy')
  return `${labels[sort]} · ${direction}`
}

function sourceStateFingerprint(list: WatchSource[]) {
  return list.map((source) => [
    source.id,
    source.last_check_status || '',
    source.last_check_at || '',
    source.last_error_code || '',
    source.diagnostic_state || ''
  ].join(':')).join('|')
}

async function refreshBoardAfterSourceDiagnostics() {
  if (sourceRefreshInFlight || loading.value) return
  sourceRefreshInFlight = true
  try {
    const before = sourceStateFingerprint(sources.value)
    const nextSources = await listSources()
    const after = sourceStateFingerprint(nextSources)
    sources.value = nextSources
    const hasChanged = before !== '' && before !== after
    if (hasChanged) {
      await loadBoard()
    }
  } catch {
    // 静默轮询只用于联动刷新，页面主错误仍由手动加载承载。
  } finally {
    sourceRefreshInFlight = false
  }
}

function openHistory(row: WatchPricingBoardRow, price?: WatchPricingBoardModelPrice, component?: HistoryComponent) {
  historyTarget.value = {
    row,
    price,
    platform: price?.platform || row.platform,
    model: price?.model,
    component: component || (price ? preferredPriceComponent(price) : 'group_multiplier'),
  }
  historyChangeKind.value = 'all'
  lastOpenedHistoryQueryKey = ''
  reloadHistory()
}

function closeHistory() {
  historyTarget.value = null
  history.value = null
  historyError.value = ''
  lastOpenedHistoryQueryKey = ''
  const query = { ...route.query }
  delete query.history_source_id
  delete query.history_group_external_id
  delete query.history_platform
  delete query.history_model
  delete query.history_component
  router.replace({ query })
}

async function reloadHistory() {
  const target = historyTarget.value
  if (!target) return
  historyLoading.value = true
  historyError.value = ''
  try {
    history.value = await getPricingHistory({
      source_id: target.row.source_id,
      group_external_id: target.row.group_external_id,
      platform: target.platform || target.price?.platform || target.row.platform || undefined,
      model: target.model || target.price?.model || undefined,
      component: target.component || (target.price ? preferredPriceComponent(target.price) : 'group_multiplier'),
      change_kind: historyChangeKind.value,
      limit: 200,
    })
  } catch (err) {
    historyError.value = errorMessage(err, t('admin.watch.priceHistoryLoadFailed'))
  } finally {
    historyLoading.value = false
  }
}

function normalizeHistoryComponent(value: unknown): HistoryComponent {
  const component = String(value || 'group_multiplier')
  return ['group_multiplier', 'input', 'output', 'per_request'].includes(component) ? (component as HistoryComponent) : 'group_multiplier'
}

function openHistoryFromRouteRows(nextRows: WatchPricingBoardRow[]) {
  const sourceID = Number(route.query.history_source_id || 0)
  const groupExternalID = String(route.query.history_group_external_id || '')
  if (!sourceID || !groupExternalID) return
  const component = normalizeHistoryComponent(route.query.history_component)
  const platform = String(route.query.history_platform || '')
  const model = String(route.query.history_model || '')
  const key = `${sourceID}:${groupExternalID}:${component}:${platform}:${model}`
  if (lastOpenedHistoryQueryKey === key && historyTarget.value) return
  const row = nextRows.find((item) => item.source_id === sourceID && item.group_external_id === groupExternalID)
  if (!row) return
  const price = component === 'group_multiplier'
    ? undefined
    : row.model_prices?.find((item) => {
      return (!platform || item.platform === platform) && (!model || item.model === model)
    })
  historyTarget.value = {
    row,
    price,
    platform: platform || price?.platform || row.platform,
    model: model || price?.model,
    component,
  }
  historyChangeKind.value = 'all'
  lastOpenedHistoryQueryKey = key
  reloadHistory()
}

function adapterLabel(adapter: string) {
  return t(`admin.watch.adapter_${adapter}`)
}

function statusLabel(status?: string) {
  return watchStatusLabel(t, status)
}

function errorCodeLabel(code: string) {
  const key = `admin.watch.errorCode_${code}`
  const translated = t(key)
  return translated === key ? code : translated
}

function statusClass(status?: string) {
  const base = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium '
  if (status === 'checking') return base + 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (status === 'healthy' || status === 'success') return base + 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (status === 'degraded') return base + 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  if (status === 'error') return base + 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'
  return base + 'bg-gray-100 text-gray-600 dark:bg-dark-700 dark:text-gray-300'
}

function statusIcon(status?: string): 'refresh' | 'checkCircle' | 'exclamationTriangle' | 'xCircle' | 'questionCircle' {
  if (status === 'checking') return 'refresh'
  if (status === 'healthy' || status === 'success') return 'checkCircle'
  if (status === 'degraded') return 'exclamationTriangle'
  if (status === 'error') return 'xCircle'
  return 'questionCircle'
}

function directionClass(kind?: string) {
  const base = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium '
  return kind === 'increase'
    ? base + 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'
    : base + 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
}

function directionIcon(kind?: string): 'arrowUp' | 'arrowDown' {
  return kind === 'increase' ? 'arrowUp' : 'arrowDown'
}

function usageClass(inUse: boolean) {
  const base = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium '
  return inUse
    ? base + 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
    : base + 'bg-gray-100 text-gray-600 dark:bg-dark-700 dark:text-gray-300'
}

function platformDisplay(platform?: string) {
  return platform ? platformLabel(platform) : '-'
}

function itemLabel(change: WatchPriceChange) {
  if (change.component === 'group_multiplier') return t('admin.watch.groupMultiplier')
  return t(`admin.watch.${change.component === 'per_request' ? 'perRequestPrice' : `${change.component}Price`}`)
}

function modelPriceTitle(price: WatchPricingBoardModelPrice) {
  return `${price.platform} / ${price.model} · ${compactModelPrice(price)}`
}

function compactModelPrice(price: WatchPricingBoardModelPrice) {
  const parts = [
    price.input_price == null ? '' : `I ${formatValue(price.input_price)}`,
    price.output_price == null ? '' : `O ${formatValue(price.output_price)}`,
    price.per_request_price == null ? '' : `R ${formatValue(price.per_request_price)}`,
  ].filter(Boolean)
  return parts.join(' · ') || '-'
}

function preferredPriceComponent(price: WatchPricingBoardModelPrice): 'input' | 'output' | 'per_request' {
  if (price.input_price != null) return 'input'
  if (price.output_price != null) return 'output'
  return 'per_request'
}

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '-'
}

function formatValue(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-'
  return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
}

onMounted(() => {
  loadBoard()
  sourceRefreshTimer = setInterval(() => {
    refreshBoardAfterSourceDiagnostics()
  }, 5000)
})

watch(
  () => route.query,
  () => {
    if (route.path !== '/admin/intelligent-ops/pricing') return
    const nextSourceID = Number(route.query.source_id || 0)
    const nextPlatform = normalizePlatform(route.query.platform)
    const nextChangeKind = ['increase', 'decrease'].includes(String(route.query.change_kind)) ? (String(route.query.change_kind) as 'increase' | 'decrease') : 'all'
    const nextInUse = ['true', 'false'].includes(String(route.query.in_use)) ? (String(route.query.in_use) as 'true' | 'false') : 'all'
    const nextSort = normalizeSort(route.query.sort)
    const nextOrder = String(route.query.order || 'asc') === 'desc' ? 'desc' : 'asc'
    const nextSearch = String(route.query.search || '')
    const nextPage = normalizePage(route.query.page)
    const nextPageSize = normalizePageSize(route.query.page_size)
    const changed = filters.source_id !== nextSourceID ||
      filters.platform !== nextPlatform ||
      filters.change_kind !== nextChangeKind ||
      filters.in_use !== nextInUse ||
      filters.sort !== nextSort ||
      filters.order !== nextOrder ||
      filters.search !== nextSearch
    if (changed) {
      filters.source_id = nextSourceID
      filters.platform = nextPlatform
      filters.change_kind = nextChangeKind
      filters.in_use = nextInUse
      filters.sort = nextSort
      filters.order = nextOrder
      filters.search = nextSearch
      pagination.page = nextPage
      pagination.page_size = nextPageSize
      loadBoard()
      return
    }
    pagination.page_size = nextPageSize
    pagination.page = Math.min(nextPage, totalPages.value)
    openHistoryFromRouteRows(rows.value)
  },
  { deep: true }
)

onBeforeUnmount(() => {
  if (sourceRefreshTimer) clearInterval(sourceRefreshTimer)
})
</script>
