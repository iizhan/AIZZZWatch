<template>
  <AppLayout>
    <div class="space-y-6">
      <section class="border-b border-gray-200 pb-4 dark:border-dark-700">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-xl font-semibold text-gray-900 dark:text-white">{{ t('recommendations.publicPricingPageTitle') }}</h2>
          <span class="inline-flex h-5 items-center rounded bg-amber-100 px-2 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            {{ t('nav.beta') }}
          </span>
        </div>
        <p class="mt-1 text-sm leading-6 text-gray-500 dark:text-dark-300">{{ t('recommendations.publicPricingDescription') }}</p>
      </section>

      <section class="card overflow-hidden">
        <div v-if="loading" class="px-5 py-10 text-center text-sm text-gray-500 dark:text-dark-300">
          {{ t('recommendations.loading') }}
        </div>
        <div v-else-if="error" role="alert" class="px-5 py-10 text-center text-sm text-red-600 dark:text-red-400">
          {{ error }}
        </div>
        <div v-else-if="publicPricing.length === 0" class="px-5 py-10 text-center text-sm text-gray-500 dark:text-dark-300">
          {{ t('recommendations.noPublicPricing') }}
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr class="border-b border-gray-200 bg-gray-50 text-gray-500 dark:border-dark-700 dark:bg-dark-800 dark:text-dark-300">
                <th class="whitespace-nowrap px-5 py-3 font-medium">{{ t('recommendations.name') }}</th>
                <th class="whitespace-nowrap px-5 py-3 font-medium">{{ t('recommendations.platform') }}</th>
                <th class="whitespace-nowrap px-5 py-3 font-medium">{{ t('recommendations.currentMultiplier') }}</th>
                <th class="whitespace-nowrap px-5 py-3 font-medium">{{ t('recommendations.observedAt') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in publicPricing" :key="row.id" class="border-b border-gray-100 last:border-0 dark:border-dark-700">
                <td class="px-5 py-4 font-medium text-gray-900 dark:text-white">{{ row.public_name }}</td>
                <td class="px-5 py-4 text-gray-600 dark:text-dark-300">{{ row.platform }}</td>
                <td class="px-5 py-4 font-semibold text-emerald-600 dark:text-emerald-400">{{ formatMultiplier(row.effective_multiplier) }}</td>
                <td class="whitespace-nowrap px-5 py-4 text-gray-500 dark:text-dark-400">{{ formatDate(row.observed_at) }}</td>
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
import { recommendationAPI, type PublicPricing } from '@/api/recommendations'
import AppLayout from '@/components/layout/AppLayout.vue'

const { locale, t } = useI18n()
const publicPricing = ref<PublicPricing[]>([])
const loading = ref(true)
const error = ref('')

function formatDate(value: string) {
  return new Date(value).toLocaleString(locale.value)
}

function formatMultiplier(value: number) {
  return Number(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const response = await recommendationAPI.getPublicPricing()
    publicPricing.value = response.data || []
  } catch (cause: any) {
    error.value = cause?.message || t('recommendations.publicPricingLoadError')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>
