<template>
  <AppLayout>
    <div class="space-y-5">
      <div>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('admin.recommendations.heading') }}</h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-dark-400">{{ t('admin.recommendations.reviewRules') }}</p>
      </div>

      <div v-if="error" role="alert" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{{ error }}</div>

      <section class="card p-4">
        <h3 class="font-semibold text-gray-900 dark:text-white">{{ t('admin.recommendations.modelOptions') }}</h3>
        <div class="mt-3 grid gap-2 sm:grid-cols-[minmax(0,160px)_minmax(0,220px)_100px_auto]">
          <input v-model.trim="newModel.key" class="input h-10" :placeholder="t('admin.recommendations.modelKey')" />
          <input v-model.trim="newModel.name" class="input h-10" :placeholder="t('admin.recommendations.displayName')" />
          <input v-model.number="newModel.sort_order" class="input h-10" type="number" :placeholder="t('admin.recommendations.sortOrder')" />
          <button class="btn btn-secondary h-10" :disabled="saving" @click="saveModel(newModel)">{{ t('admin.recommendations.addOrUpdate') }}</button>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <div v-for="model in modelRows" :key="model.key" class="flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm dark:border-dark-700">
            <input v-model="model.enabled" type="checkbox" :aria-label="t('admin.recommendations.enableModel', { name: model.name })" />
            <span>{{ model.name }}</span>
            <button class="text-primary-600" :disabled="saving" @click="saveModel(model)">{{ t('common.save') }}</button>
          </div>
        </div>
      </section>

      <section class="card p-4">
        <div>
          <h3 class="font-semibold text-gray-900 dark:text-white">{{ t('admin.recommendations.publicPricing') }}</h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-dark-400">{{ t('admin.recommendations.publicPricingHint') }}</p>
        </div>
        <div class="mt-4 max-h-[360px] overflow-auto">
          <table class="w-full min-w-[820px] text-left text-sm">
            <thead class="sticky top-0 bg-white dark:bg-dark-900">
              <tr class="border-b text-gray-500">
                <th class="px-3 py-2">{{ t('admin.recommendations.publish') }}</th>
                <th class="px-3 py-2">{{ t('admin.recommendations.sourceGroup') }}</th>
                <th class="px-3 py-2">{{ t('admin.recommendations.platform') }}</th>
                <th class="px-3 py-2">{{ t('admin.recommendations.currentMultiplier') }}</th>
                <th class="px-3 py-2">{{ t('admin.recommendations.publicName') }}</th>
                <th class="px-3 py-2">{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in pricingRows" :key="`${row.source_id}:${row.group_external_id}`" class="border-b last:border-0 dark:border-dark-700">
                <td class="px-3 py-2"><input v-model="row.enabled" type="checkbox" :aria-label="t('admin.recommendations.publishGroup', { name: row.group_name })" /></td>
                <td class="px-3 py-2"><div class="font-medium">{{ row.source_name }}</div><div class="text-xs text-gray-500">{{ row.group_name }}</div></td>
                <td class="px-3 py-2">{{ row.platform }}</td>
                <td class="px-3 py-2">{{ formatMultiplier(row.effective_multiplier) }}</td>
                <td class="px-3 py-2"><input v-model.trim="row.public_name" class="input h-10 min-w-[220px]" :placeholder="row.group_name" /></td>
                <td class="px-3 py-2"><button class="btn btn-secondary btn-sm" :disabled="saving" @click="savePricing(row)">{{ t('common.save') }}</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card p-4">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 class="font-semibold text-gray-900 dark:text-white">{{ t('admin.recommendations.reviewList') }}</h3>
            <p class="mt-1 text-sm text-gray-500 dark:text-dark-400">{{ t('admin.recommendations.reviewListHint') }}</p>
          </div>
          <label class="w-44 space-y-1 text-sm">
            <span class="text-gray-600 dark:text-dark-300">{{ t('admin.recommendations.statusFilter') }}</span>
            <select v-model="statusFilter" class="input h-10" @change="loadRecommendations">
              <option value="">{{ t('admin.recommendations.statusAll') }}</option>
              <option value="pending">{{ t('admin.recommendations.statusPending') }}</option>
              <option value="adopted">{{ t('admin.recommendations.statusAdopted') }}</option>
              <option value="rejected">{{ t('admin.recommendations.statusRejected') }}</option>
            </select>
          </label>
        </div>
        <div class="mt-4 overflow-x-auto">
          <table class="w-full min-w-[1100px] text-left text-sm">
            <thead><tr class="border-b text-gray-500"><th class="px-3 py-2">{{ t('admin.recommendations.time') }}</th><th class="px-3 py-2">{{ t('admin.recommendations.user') }}</th><th class="px-3 py-2">{{ t('admin.recommendations.siteModel') }}</th><th class="px-3 py-2">{{ t('admin.recommendations.multiplier') }}</th><th class="px-3 py-2">{{ t('admin.recommendations.requestedReward') }}</th><th class="px-3 py-2">{{ t('admin.recommendations.status') }}</th><th class="px-3 py-2">{{ t('common.actions') }}</th></tr></thead>
            <tbody>
              <tr v-for="item in items" :key="item.id" class="border-b last:border-0 dark:border-dark-700">
                <td class="whitespace-nowrap px-3 py-3">{{ formatDate(item.created_at) }}</td>
                <td class="px-3 py-3">#{{ item.user_id }}</td>
                <td class="max-w-[300px] truncate px-3 py-3" :title="item.site_url">{{ item.site_url }}<span class="ml-2 text-gray-400">{{ item.model_key }}</span></td>
                <td class="px-3 py-3">{{ item.submitted_multiplier }}</td>
                <td class="px-3 py-3">{{ rewardTypeLabel(item.requested_reward_type) }}</td>
                <td class="px-3 py-3">{{ statusLabel(item.status) }}</td>
                <td class="px-3 py-3"><button class="btn btn-secondary btn-sm" :disabled="item.status !== 'pending'" @click="open(item)">{{ t('admin.recommendations.review') }}</button></td>
              </tr>
            </tbody>
          </table>
          <div v-if="loading" class="p-8 text-center text-sm text-gray-500">{{ t('admin.recommendations.loading') }}</div>
          <div v-else-if="items.length === 0" class="p-8 text-center text-sm text-gray-500">{{ t('admin.recommendations.empty') }}</div>
        </div>
      </section>
    </div>

    <Teleport to="body">
      <div v-if="selected" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" @click.self="closeDialog">
        <form class="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl dark:bg-dark-900" @submit.prevent="save">
          <div class="flex items-center justify-between"><h3 class="font-semibold">{{ t('admin.recommendations.reviewItem', { id: selected.id }) }}</h3><button type="button" class="text-xl" :aria-label="t('common.close')" @click="closeDialog">×</button></div>
          <p class="mt-3 break-all text-sm text-gray-500">{{ selected.site_url }}</p>
          <label class="mt-4 block space-y-1 text-sm" for="recommendation-decision-result"><span>{{ t('admin.recommendations.result') }}</span><select id="recommendation-decision-result" v-model="decision.adopted" class="input h-10"><option :value="true">{{ t('admin.recommendations.adopt') }}</option><option :value="false">{{ t('admin.recommendations.reject') }}</option></select></label>
          <label v-if="decision.adopted" class="mt-3 block space-y-1 text-sm" for="recommendation-reward-type"><span>{{ t('admin.recommendations.rewardType') }}</span><select id="recommendation-reward-type" v-model="decision.reward_type" class="input h-10"><option value="profit_share">{{ t('admin.recommendations.profitShare') }}</option><option value="one_time_credit">{{ t('admin.recommendations.oneTime') }}</option></select></label>
          <label v-if="decision.adopted && decision.reward_type === 'one_time_credit'" class="mt-3 block space-y-1 text-sm" for="recommendation-one-time-amount"><span>{{ t('admin.recommendations.oneTimeAmount') }}</span><input id="recommendation-one-time-amount" v-model.number="decision.amount" class="input h-10" type="number" min="0.00000001" step="any" required /></label>
          <div v-if="decision.adopted && decision.reward_type === 'profit_share'" class="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600 dark:border-dark-700 dark:bg-dark-800 dark:text-dark-300">{{ t('admin.recommendations.fixedProfitRule') }}</div>
          <label class="mt-3 block space-y-1 text-sm" for="recommendation-decision-reason"><span>{{ decision.adopted ? t('admin.recommendations.decisionReason') : t('admin.recommendations.rejectionReason') }}</span><textarea id="recommendation-decision-reason" v-model.trim="decision.reason" class="input min-h-[90px]" required /></label>
          <label v-if="decision.adopted && rewardTypeChanged" class="mt-3 block space-y-1 text-sm" for="recommendation-adjustment-reason"><span>{{ t('admin.recommendations.adjustmentReason') }}</span><textarea id="recommendation-adjustment-reason" v-model.trim="decision.admin_note" class="input min-h-[70px]" required /></label>
          <p v-if="decisionError" role="alert" class="mt-3 text-sm text-red-600 dark:text-red-400">{{ decisionError }}</p>
          <div class="mt-5 flex justify-end gap-2"><button type="button" class="btn btn-secondary" @click="closeDialog">{{ t('common.cancel') }}</button><button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? t('admin.recommendations.saving') : t('admin.recommendations.confirm') }}</button></div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { recommendationAPI, type PublicPricingAdminRow, type Recommendation, type RecommendationModelOption } from '@/api/recommendations'
import AppLayout from '@/components/layout/AppLayout.vue'

const { locale, t } = useI18n()
const items = ref<Recommendation[]>([])
const pricingRows = ref<PublicPricingAdminRow[]>([])
const modelRows = ref<RecommendationModelOption[]>([])
const newModel = reactive<RecommendationModelOption>({ key: '', name: '', sort_order: 100, enabled: true })
const statusFilter = ref('pending')
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const decisionError = ref('')
const selected = ref<Recommendation | null>(null)
const decision = reactive({ adopted: true, reason: '', reward_type: 'profit_share', amount: 0, share_percent: 1, cap_amount: 100, admin_note: '' })
const rewardTypeChanged = computed(() => Boolean(selected.value && decision.reward_type !== selected.value.requested_reward_type))

function formatDate(value: string) { return new Date(value).toLocaleString(locale.value) }
function formatMultiplier(value: number) { return Number(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') }
function rewardTypeLabel(type: string) { return t(type === 'profit_share' ? 'admin.recommendations.profitShareShort' : 'admin.recommendations.oneTimeShort') }
function statusLabel(status: string) { return t(`admin.recommendations.status_${status}`) }
async function loadRecommendations() { loading.value = true; error.value = ''; try { const response = await recommendationAPI.adminList(statusFilter.value || undefined); items.value = response.data || [] } catch (e: any) { error.value = e?.message || t('admin.recommendations.loadError') } finally { loading.value = false } }
async function load() { loading.value = true; error.value = ''; try { const [recommendations, pricing, models] = await Promise.all([recommendationAPI.adminList(statusFilter.value), recommendationAPI.adminListPublicPricing(), recommendationAPI.adminListModels()]); items.value = recommendations.data || []; pricingRows.value = pricing.data || []; modelRows.value = models.data || [] } catch (e: any) { error.value = e?.message || t('admin.recommendations.loadError') } finally { loading.value = false } }
async function saveModel(model: RecommendationModelOption) { error.value = ''; saving.value = true; try { await recommendationAPI.adminSaveModel(model); if (model === newModel) { newModel.key = ''; newModel.name = ''; newModel.sort_order = 100; newModel.enabled = true } await load() } catch (e: any) { error.value = e?.message || t('admin.recommendations.saveModelError') } finally { saving.value = false } }
async function savePricing(row: PublicPricingAdminRow) { error.value = ''; saving.value = true; if (!row.public_name) row.public_name = row.group_name; try { await recommendationAPI.adminSavePublicPricing(row) } catch (e: any) { error.value = e?.message || t('admin.recommendations.savePricingError') } finally { saving.value = false } }
function open(item: Recommendation) { selected.value = item; decision.adopted = true; decision.reason = ''; decision.reward_type = item.requested_reward_type; decision.amount = 0; decision.share_percent = 1; decision.cap_amount = 100; decision.admin_note = ''; decisionError.value = '' }
function closeDialog() { selected.value = null; decisionError.value = '' }
async function save() {
  if (!selected.value) return
  decisionError.value = ''
  if (!decision.reason.trim()) { decisionError.value = t('admin.recommendations.reasonRequired'); return }
  if (decision.adopted && decision.reward_type === 'one_time_credit' && (!Number.isFinite(decision.amount) || decision.amount <= 0)) { decisionError.value = t('admin.recommendations.amountPositive'); return }
  if (decision.adopted && rewardTypeChanged.value && !decision.admin_note.trim()) { decisionError.value = t('admin.recommendations.adjustmentReasonRequired'); return }
  saving.value = true; error.value = ''
  try { await recommendationAPI.adminDecide(selected.value.id, decision); closeDialog(); await loadRecommendations() } catch (e: any) { decisionError.value = e?.message || t('admin.recommendations.decisionError') } finally { saving.value = false }
}
onMounted(load)
</script>
