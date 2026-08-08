<template>
  <AppLayout>
    <div class="space-y-6">
      <section class="card border-primary-200 bg-primary-50 p-5 dark:border-primary-900/40 dark:bg-primary-900/20">
        <h2 class="text-lg font-semibold text-primary-900 dark:text-primary-100">{{ t('recommendations.title') }}</h2>
        <p class="mt-2 text-sm leading-6 text-primary-800 dark:text-primary-200">
          {{ t('recommendations.rules') }}
        </p>
      </section>

      <section class="card p-5">
        <h3 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('recommendations.submitTitle') }}</h3>
        <form class="mt-4 grid gap-4 md:grid-cols-2" @submit.prevent="submit">
          <label class="space-y-1 text-sm text-gray-700 dark:text-gray-300">
            <span>{{ t('recommendations.siteURL') }}</span>
            <input v-model.trim="form.site_url" class="input" type="url" required placeholder="https://example.com" />
          </label>
          <label class="space-y-1 text-sm text-gray-700 dark:text-gray-300">
            <span>{{ t('recommendations.model') }}</span>
            <select v-model="form.model_key" class="input" required>
              <option value="" disabled>{{ t('recommendations.chooseModel') }}</option>
              <option v-for="model in models" :key="model.key" :value="model.key">{{ model.name }}</option>
            </select>
          </label>
          <label class="space-y-1 text-sm text-gray-700 dark:text-gray-300">
            <span>{{ t('recommendations.observedMultiplier') }}</span>
            <input v-model.number="form.multiplier" class="input" type="number" min="0.00000001" step="any" required />
          </label>
          <label class="space-y-1 text-sm text-gray-700 dark:text-gray-300">
            <span>{{ t('recommendations.rewardType') }}</span>
            <select v-model="form.reward_type" class="input" required>
              <option value="profit_share">{{ t('recommendations.profitShareOption') }}</option>
              <option value="one_time_credit">{{ t('recommendations.oneTimeOption') }}</option>
            </select>
          </label>
          <label class="space-y-1 text-sm text-gray-700 dark:text-gray-300 md:col-span-2">
            <span>{{ t('recommendations.note') }}</span>
            <textarea v-model.trim="form.note" class="input min-h-[88px]" maxlength="1000" />
          </label>
          <div class="flex items-center gap-3 md:col-span-2">
            <button class="btn btn-primary" type="submit" :disabled="submitting">{{ submitting ? t('recommendations.submitting') : t('recommendations.submit') }}</button>
            <span v-if="message" role="status" class="text-sm text-emerald-600 dark:text-emerald-400">{{ message }}</span>
            <span v-if="error" role="alert" class="text-sm text-red-600 dark:text-red-400">{{ error }}</span>
          </div>
        </form>
      </section>

      <section class="card p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('recommendations.myRecords') }}</h3>
            <p class="mt-1 text-sm text-gray-500 dark:text-dark-400">{{ t('recommendations.transferHint') }}</p>
          </div>
          <button class="btn btn-secondary" :disabled="transferring || !canTransfer" @click="transfer">{{ transferring ? t('recommendations.transferring') : t('recommendations.transfer') }}</button>
        </div>
        <div v-if="loading" class="py-8 text-center text-sm text-gray-500">{{ t('recommendations.loading') }}</div>
        <div v-else-if="items.length === 0" class="mt-4 rounded-lg border border-dashed p-6 text-center text-sm text-gray-500">{{ t('recommendations.empty') }}</div>
        <div v-else class="mt-4 overflow-x-auto">
          <table class="w-full min-w-[860px] text-left text-sm">
            <thead><tr class="border-b text-gray-500"><th class="px-3 py-2">{{ t('recommendations.time') }}</th><th class="px-3 py-2">{{ t('recommendations.site') }}</th><th class="px-3 py-2">{{ t('recommendations.model') }}</th><th class="px-3 py-2">{{ t('recommendations.multiplier') }}</th><th class="px-3 py-2">{{ t('recommendations.status') }}</th><th class="px-3 py-2">{{ t('recommendations.details') }}</th></tr></thead>
            <tbody>
              <tr v-for="item in items" :key="item.id" class="border-b last:border-0 dark:border-dark-700">
                <td class="px-3 py-3 whitespace-nowrap">{{ formatDate(item.created_at) }}</td>
                <td class="max-w-[260px] truncate px-3 py-3" :title="item.site_url">{{ item.site_url }}</td>
                <td class="px-3 py-3">{{ modelName(item.model_key) }}</td>
                <td class="px-3 py-3">{{ item.submitted_multiplier }}</td>
                <td class="px-3 py-3">{{ statusLabel(item) }}</td>
				<td class="px-3 py-3">
				  <div>{{ item.decision_reason || t('recommendations.pendingReview') }}</div>
				  <div v-if="item.reward?.admin_note" class="mt-1 text-xs text-gray-500 dark:text-dark-300">{{ t('recommendations.adjustmentNote', { note: item.reward.admin_note }) }}</div>
				  <div v-if="item.reward" class="mt-1 text-xs text-emerald-600 dark:text-emerald-400">{{ rewardSummary(item) }}</div>
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
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { recommendationAPI, type Recommendation, type RecommendationModelOption } from '@/api/recommendations'
import AppLayout from '@/components/layout/AppLayout.vue'

const { locale, t } = useI18n()
const models = ref<RecommendationModelOption[]>([])
const items = ref<Recommendation[]>([])
const loading = ref(true)
const submitting = ref(false)
const transferring = ref(false)
const message = ref('')
const error = ref('')
const form = reactive({ site_url: '', model_key: '', multiplier: 1, reward_type: 'profit_share', note: '' })
const canTransfer = computed(() => items.value.reduce((total, item) => total + (item.reward?.reward_type === 'profit_share' ? item.reward.available_amount : 0), 0) >= 1)

function formatDate(value: string) { return new Date(value).toLocaleString(locale.value) }
function modelName(key: string) { return models.value.find((model) => model.key === key)?.name || key }
function statusLabel(item: Recommendation) { return t(`recommendations.status_${item.status}`) }
function rewardSummary(item: Recommendation) {
  if (!item.reward) return ''
  if (item.reward.reward_type === 'one_time_credit') return t('recommendations.oneTimeReward', { amount: item.reward.amount.toFixed(4) })
  return t('recommendations.profitReward', { available: item.reward.available_amount.toFixed(4), total: item.reward.amount.toFixed(4) })
}
async function load() {
  loading.value = true; error.value = ''
  try { const [m, r] = await Promise.all([recommendationAPI.getModels(), recommendationAPI.listMine()]); models.value = m.data || []; items.value = r.data || []; if (!form.model_key) form.model_key = models.value[0]?.key || '' } catch (e: any) { error.value = e?.message || t('recommendations.loadError') } finally { loading.value = false }
}
async function submit() {
  submitting.value = true; message.value = ''; error.value = ''
  try { await recommendationAPI.create({ ...form }); message.value = t('recommendations.submitSuccess'); form.site_url = ''; form.note = ''; await load() } catch (e: any) { error.value = e?.message || t('recommendations.submitError') } finally { submitting.value = false }
}
async function transfer() {
  transferring.value = true; message.value = ''; error.value = ''
  try { const response = await recommendationAPI.transfer(); message.value = t('recommendations.transferSuccess', { amount: Number(response.data?.transferred_amount || 0).toFixed(4) }); await load() } catch (e: any) { error.value = e?.message || t('recommendations.transferError') } finally { transferring.value = false }
}
onMounted(load)
</script>
