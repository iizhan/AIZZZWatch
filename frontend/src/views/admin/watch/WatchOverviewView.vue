<template>
  <AppLayout>
    <div class="space-y-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.overviewTitle') }}</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('admin.watch.overviewDescription') }}</p>
        </div>
        <button class="btn btn-secondary" type="button" :disabled="loading" @click="loadOverview">
          {{ loading ? t('common.loading') : t('admin.watch.refresh') }}
        </button>
      </div>

      <div
        v-if="error"
        class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200"
      >
        {{ error }}
      </div>

      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div
          v-for="item in summaryItems"
          :key="item.label"
          class="rounded-lg border border-gray-200 bg-white p-4 dark:border-dark-700 dark:bg-dark-800"
        >
          <div class="text-xs text-gray-500 dark:text-gray-400">{{ item.label }}</div>
          <div class="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">{{ item.value }}</div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import { getOverview, type WatchOverview } from '@/api/admin/watch'

const { t } = useI18n()
const loading = ref(false)
const error = ref('')
const overview = ref<WatchOverview | null>(null)

const summaryItems = computed(() => [
  { label: t('admin.watch.activeAccounts'), value: overview.value?.active_accounts ?? '-' },
  { label: t('admin.watch.blockedAccounts'), value: overview.value?.blocked_accounts ?? '-' },
  { label: t('admin.watch.activeGroups'), value: overview.value?.active_groups ?? '-' },
  { label: t('admin.watch.activeChannels'), value: overview.value?.active_channels ?? '-' },
])

async function loadOverview() {
  loading.value = true
  error.value = ''
  try {
    overview.value = await getOverview()
  } catch (err: any) {
    error.value = err?.response?.data?.message || err?.message || t('admin.watch.loadFailed')
  } finally {
    loading.value = false
  }
}

onMounted(loadOverview)
</script>
