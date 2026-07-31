<template>
  <AppLayout>
    <div class="space-y-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.changesTitle') }}</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('admin.watch.changesDescription') }}</p>
        </div>
        <button class="btn btn-secondary" type="button" :disabled="loading" @click="loadChanges">
          {{ loading ? t('common.loading') : t('admin.watch.refresh') }}
        </button>
      </div>

      <div
        v-if="error"
        class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200"
      >
        {{ error }}
      </div>

      <section class="rounded-lg border border-gray-200 bg-white dark:border-dark-700 dark:bg-dark-800">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4 dark:border-dark-700">
          <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.changeHistory') }}</h2>
          <span class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.changeHistoryHint') }}</span>
        </div>

        <div v-if="loading && changes.length === 0" class="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          {{ t('common.loading') }}
        </div>
        <div v-else-if="changes.length === 0" class="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          {{ t('admin.watch.noPriceChanges') }}
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[960px] text-left text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 dark:bg-dark-800/70 dark:text-gray-400">
              <tr>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.observedAt') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.source') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.externalId') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.platform') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.priceItem') }}</th>
                <th class="px-4 py-3 text-right font-medium">{{ t('admin.watch.previousValue') }}</th>
                <th class="px-4 py-3 text-right font-medium">{{ t('admin.watch.nextValue') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.changeDirection') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-dark-700">
              <tr v-for="change in changes" :key="change.id" class="text-gray-700 dark:text-gray-200">
                <td class="whitespace-nowrap px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{{ formatDate(change.observed_at) }}</td>
                <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ change.source_name }}</td>
                <td class="px-4 py-3 font-mono text-xs">{{ change.group_external_id }}</td>
                <td class="px-4 py-3">{{ change.platform || '-' }}</td>
                <td class="px-4 py-3">
                  <div class="font-medium text-gray-900 dark:text-white">{{ itemLabel(change) }}</div>
                  <div v-if="change.model" class="mt-0.5 font-mono text-xs text-gray-500 dark:text-gray-400">{{ change.model }}</div>
                </td>
                <td class="px-4 py-3 text-right font-mono">{{ formatValue(change.previous_value) }}</td>
                <td class="px-4 py-3 text-right font-mono font-medium text-gray-900 dark:text-white">{{ formatValue(change.next_value) }}</td>
                <td class="px-4 py-3">
                  <span :class="directionClass(change.change_kind)">
                    {{ change.change_kind === 'increase' ? t('admin.watch.increase') : t('admin.watch.decrease') }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import { listPriceChanges, type WatchPriceChange } from '@/api/admin/watch'

const { t, locale } = useI18n()
const loading = ref(false)
const error = ref('')
const changes = ref<WatchPriceChange[]>([])

async function loadChanges() {
  loading.value = true
  error.value = ''
  try {
    changes.value = await listPriceChanges({ limit: 500 })
  } catch (err: any) {
    error.value = err?.response?.data?.message || err?.message || t('admin.watch.priceChangesLoadFailed')
  } finally {
    loading.value = false
  }
}

function itemLabel(change: WatchPriceChange) {
  if (change.component === 'group_multiplier') return t('admin.watch.groupMultiplier')
  return t(`admin.watch.${change.component === 'per_request' ? 'perRequestPrice' : `${change.component}Price`}`)
}

function directionClass(kind: WatchPriceChange['change_kind']) {
  const base = 'inline-flex rounded-full px-2.5 py-1 text-xs font-medium '
  return kind === 'increase'
    ? base + 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'
    : base + 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))
}

function formatValue(value: number) {
  return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
}

onMounted(loadChanges)
</script>
