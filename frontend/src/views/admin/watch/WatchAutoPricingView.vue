<template>
  <AppLayout>
    <div class="watch-surface space-y-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.autoPricingTitle') }}</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('admin.watch.autoPricingDescription') }}</p>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-secondary" type="button" :disabled="loading" @click="loadAll">
            <Icon name="refresh" size="sm" :class="{ 'animate-spin': loading }" />
            <span>{{ t('common.refresh') }}</span>
          </button>
          <button class="btn btn-primary" type="button" @click="openCreateRule">
            <Icon name="plus" size="sm" />
            <span>{{ t('admin.watch.addPricingRule') }}</span>
          </button>
        </div>
      </div>

      <div v-if="error" class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200" role="alert">
        <span>{{ error }}</span>
        <button class="font-medium underline" type="button" @click="loadAll">{{ t('admin.watch.retry') }}</button>
      </div>

      <section class="rounded-lg border border-gray-200 bg-white p-5 dark:border-dark-700 dark:bg-dark-800">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.manualApplyTitle') }}</h2>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.manualApplyHint') }}</p>
          </div>
          <span class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">
            {{ t('admin.watch.confirmedWrite') }}
          </span>
        </div>

        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <label class="block text-sm text-gray-700 dark:text-gray-200">
            {{ t('admin.watch.targetGroup') }}
            <select v-model.number="manualForm.targetGroupId" class="input mt-1 w-full">
              <option :value="0">{{ t('admin.watch.selectGroup') }}</option>
              <option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option>
            </select>
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-200">
            {{ t('admin.watch.mode') }}
            <select v-model="manualForm.mode" class="input mt-1 w-full">
              <option value="group_multiplier">{{ t('admin.watch.groupMode') }}</option>
              <option value="model_price">{{ t('admin.watch.modelMode') }}</option>
            </select>
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-200">
            {{ t('admin.watch.platform') }}
            <input v-model.trim="manualForm.platform" class="input mt-1 w-full" placeholder="openai" />
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-200">
            {{ t('admin.watch.model') }}
            <input v-model.trim="manualForm.model" class="input mt-1 w-full" :disabled="manualForm.mode !== 'model_price'" placeholder="gpt-4o" />
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-200">
            {{ t('admin.watch.component') }}
            <select v-model="manualForm.component" class="input mt-1 w-full" :disabled="manualForm.mode !== 'model_price'">
              <option value="input">{{ t('admin.watch.inputPrice') }}</option>
              <option value="output">{{ t('admin.watch.outputPrice') }}</option>
              <option value="per_request">{{ t('admin.watch.perRequestPrice') }}</option>
            </select>
          </label>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <button class="btn btn-secondary" type="button" :disabled="previewLoading || !manualForm.targetGroupId" @click="runManualPreview">
            {{ previewLoading ? t('common.loading') : t('admin.watch.runPreview') }}
          </button>
          <button class="btn btn-primary" type="button" :disabled="!canApplyPreview || applying" @click="pendingApply = preview">
            {{ applying ? t('common.processing') : t('admin.watch.applySuggestedPrice') }}
          </button>
        </div>

        <div v-if="preview" class="mt-5 border-t border-gray-200 pt-4 dark:border-dark-700">
          <div class="flex flex-wrap items-center gap-3 text-sm">
            <span class="text-gray-500 dark:text-gray-400">{{ t('admin.watch.currentValue') }} <strong class="text-gray-900 dark:text-white">{{ formatValue(preview.current_value) }}</strong></span>
            <span class="text-gray-500 dark:text-gray-400">{{ t('admin.watch.targetValue') }} <strong class="text-gray-900 dark:text-white">{{ formatValue(preview.target_value) }}</strong></span>
            <span class="text-gray-500 dark:text-gray-400">{{ t('admin.watch.proposedValue') }} <strong class="text-gray-900 dark:text-white">{{ formatValue(preview.proposed_value) }}</strong></span>
            <span v-if="preview.frozen" class="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-200">{{ t('admin.watch.frozen') }}: {{ watchReasonText(t, preview.freeze_reason) }}</span>
            <span v-else class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">{{ t('admin.watch.candidateReady') }}</span>
          </div>
          <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.currentPricingFormula') }}</p>
          <div class="mt-4">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.accountCostRows') }}</h3>
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.accountCostRowsHint') }}</p>
            </div>
            <div v-if="preview.cost_rows.length === 0" class="border-y border-gray-200 py-8 text-center text-sm text-gray-500 dark:border-dark-700 dark:text-gray-400">
              {{ t('admin.watch.noAccountCostRows') }}
            </div>
            <div v-else class="overflow-x-auto border-y border-gray-200 dark:border-dark-700">
              <table class="min-w-[1320px] text-left text-sm">
                <thead class="bg-gray-50 text-xs text-gray-500 dark:bg-dark-800/70 dark:text-gray-400">
                  <tr>
                    <th class="px-4 py-3 font-medium">{{ t('admin.watch.account') }}</th>
                    <th class="px-4 py-3 font-medium">{{ t('admin.watch.source') }}</th>
                    <th class="px-4 py-3 font-medium">{{ t('admin.watch.sourceKey') }}</th>
                    <th class="px-4 py-3 font-medium">{{ t('admin.watch.sourceGroup') }}</th>
                    <th class="px-4 py-3 font-medium">{{ t('admin.watch.pricingEvidence') }}</th>
                    <th class="px-4 py-3 font-medium">{{ t('admin.watch.rechargeRatio') }}</th>
                    <th class="px-4 py-3 font-medium">{{ t('admin.watch.finalCost') }}</th>
                    <th class="px-4 py-3 font-medium">{{ t('admin.watch.status') }}</th>
                    <th class="px-4 py-3 font-medium">{{ t('admin.watch.reason') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-dark-700">
                  <tr v-for="row in preview.cost_rows" :key="row.account_id" class="bg-white align-top dark:bg-dark-800">
                    <td class="px-4 py-3">
                      <div class="font-medium text-gray-900 dark:text-white">{{ row.account_name }}</div>
                      <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">#{{ row.account_id }} · {{ row.platform || '-' }}</div>
                    </td>
                    <td class="px-4 py-3 text-gray-700 dark:text-gray-200">{{ row.source_name || '-' }}</td>
                    <td class="px-4 py-3">
                      <div class="font-medium text-gray-900 dark:text-white">{{ row.source_key_label || '-' }}</div>
                      <div v-if="row.source_key_external_id" class="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400">{{ row.source_key_external_id }}</div>
                    </td>
                    <td class="px-4 py-3">
                      <div class="font-medium text-gray-900 dark:text-white">{{ row.source_group_name || '-' }}</div>
                      <div v-if="row.source_group_external_id" class="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400">{{ row.source_group_external_id }}</div>
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex flex-wrap items-center gap-2">
                        <span :class="pricingSourceClass(row.pricing_source)">{{ pricingSourceLabel(row.pricing_source) }}</span>
                        <span v-if="row.evidence_mismatch" class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-100">{{ t('admin.watch.evidenceMismatch') }}</span>
                      </div>
                      <div class="mt-1 space-y-0.5 font-mono text-xs text-gray-600 dark:text-gray-300">
                        <div>{{ t('admin.watch.officialProbeShort') }} {{ formatValue(row.official_probe_multiplier) }} · {{ officialProbeStatusLabel(row.official_probe_status) }}</div>
                        <div>{{ t('admin.watch.watchFallbackShort') }} {{ formatValue(row.watch_fallback_multiplier ?? row.source_group_rate_multiplier) }}</div>
                      </div>
                    </td>
                    <td class="px-4 py-3 font-mono text-gray-700 dark:text-gray-200">{{ formatValue(row.recharge_ratio) }}</td>
                    <td class="px-4 py-3 font-mono font-semibold text-gray-900 dark:text-white">{{ formatValue(row.effective_cost) }}</td>
                    <td class="px-4 py-3"><span :class="accountCostStatusClass(row.healthy)">{{ row.healthy ? t('admin.watch.healthy') : t('admin.watch.ineligible') }}</span></td>
                    <td class="px-4 py-3 text-gray-500 dark:text-gray-400">{{ watchReasonText(t, row.reason) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section class="rounded-lg border border-gray-200 bg-white p-5 dark:border-dark-700 dark:bg-dark-800">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.pricingRules') }}</h2>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.pricingRulesHint') }}</p>
          </div>
        </div>
        <div v-if="rules.length === 0" class="border-y border-gray-200 py-12 text-center text-sm text-gray-500 dark:border-dark-700 dark:text-gray-400">
          {{ t('admin.watch.noPricingRules') }}
        </div>
        <div v-else class="overflow-x-auto border-y border-gray-200 dark:border-dark-700">
          <table class="min-w-full text-left text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 dark:bg-dark-800/70 dark:text-gray-400">
              <tr>
                <th class="px-4 py-3 font-medium">{{ t('common.name') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.targetGroup') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.mode') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.adjustmentStep') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.status') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.nextRun') }}</th>
                <th class="px-4 py-3 text-right font-medium">{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-dark-700">
              <tr v-for="rule in rules" :key="rule.id" class="bg-white dark:bg-dark-800">
                <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ rule.name }}</td>
                <td class="px-4 py-3 text-gray-700 dark:text-gray-200">{{ groupName(rule.target_group_id) }}</td>
                <td class="px-4 py-3 text-gray-700 dark:text-gray-200">{{ modeLabel(rule.mode) }}</td>
                <td class="px-4 py-3 font-mono text-gray-700 dark:text-gray-200">{{ formatValue(rule.adjustment_step) }}</td>
                <td class="px-4 py-3">
                  <div :class="rule.enabled ? 'text-emerald-600' : 'text-gray-500'">{{ rule.enabled ? t('common.enabled') : t('common.disabled') }}</div>
                  <div v-if="rule.last_status" class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ statusText(rule.last_status, rule.last_error_code) }}</div>
                </td>
                <td class="px-4 py-3 text-gray-500 dark:text-gray-400">{{ formatDate(rule.next_run_at) }}</td>
                <td class="px-4 py-3">
                  <div class="flex justify-end gap-1">
                    <button class="icon-action" type="button" :title="t('admin.watch.runRuleNow')" :aria-label="t('admin.watch.runRuleNow')" :disabled="runningRuleId === rule.id" @click="runRule(rule)">
                      <Icon name="play" size="sm" :class="{ 'animate-pulse': runningRuleId === rule.id }" />
                    </button>
                    <button class="icon-action" type="button" :title="t('common.edit')" :aria-label="t('common.edit')" @click="openEditRule(rule)"><Icon name="edit" size="sm" /></button>
                    <button class="icon-action text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20" type="button" :title="t('common.delete')" :aria-label="t('common.delete')" @click="deletingRule = rule"><Icon name="trash" size="sm" /></button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="rounded-lg border border-gray-200 bg-white p-5 dark:border-dark-700 dark:bg-dark-800">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.pricingAudits') }}</h2>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.pricingAuditsHint') }}</p>
          </div>
        </div>
        <div v-if="audits.length === 0" class="border-y border-gray-200 py-12 text-center text-sm text-gray-500 dark:border-dark-700 dark:text-gray-400">{{ t('admin.watch.noPricingAudits') }}</div>
        <div v-else class="overflow-x-auto border-y border-gray-200 dark:border-dark-700">
          <table class="min-w-full text-left text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 dark:bg-dark-800/70 dark:text-gray-400">
              <tr>
                <th class="px-4 py-3 font-medium">ID</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.targetGroup') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.valueChange') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.action') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.watch.observedAt') }}</th>
                <th class="px-4 py-3 text-right font-medium">{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-dark-700">
              <tr v-for="audit in audits" :key="audit.id" class="bg-white dark:bg-dark-800">
                <td class="px-4 py-3 font-mono text-gray-700 dark:text-gray-200">#{{ audit.id }}</td>
                <td class="px-4 py-3 text-gray-700 dark:text-gray-200">{{ groupName(audit.target_group_id) }}</td>
                <td class="px-4 py-3 font-mono text-gray-700 dark:text-gray-200">{{ formatValue(audit.previous_value) }} → {{ formatValue(audit.next_value) }}</td>
                <td class="px-4 py-3">
                  <span :class="auditActionClass(audit.action)">{{ t(`admin.watch.audit_${audit.action}`) }}</span>
                  <div v-if="audit.reason" class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ watchReasonText(t, audit.reason) }}</div>
                </td>
                <td class="px-4 py-3 text-gray-500 dark:text-gray-400">{{ formatDate(audit.created_at) }}</td>
                <td class="px-4 py-3">
                  <div class="flex justify-end">
                    <button v-if="canRollback(audit)" class="btn btn-secondary btn-sm" type="button" @click="pendingRollback = audit">{{ t('admin.watch.rollback') }}</button>
                    <span v-else class="text-xs text-gray-400">-</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <BaseDialog :show="showRuleEditor" :title="editingRule ? t('admin.watch.editPricingRule') : t('admin.watch.addPricingRule')" width="wide" @close="closeRuleEditor">
      <form id="watch-pricing-rule-form" class="watch-surface space-y-5" @submit.prevent="saveRule">
        <div v-if="ruleFormError" id="watch-pricing-rule-error" class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200" role="alert">{{ ruleFormError }}</div>
        <div class="watch-rule-form-grid">
          <label class="watch-rule-field"><span class="input-label">{{ t('common.name') }}</span><input v-model.trim="ruleForm.name" class="input watch-rule-input" required maxlength="100" /></label>
          <label class="watch-rule-field"><span class="input-label">{{ t('admin.watch.targetGroup') }}</span><select v-model.number="ruleForm.target_group_id" class="input watch-rule-input" required><option :value="0">{{ t('admin.watch.selectGroup') }}</option><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option></select></label>
          <label class="watch-rule-field"><span class="input-label">{{ t('admin.watch.mode') }}</span><select v-model="ruleForm.mode" class="input watch-rule-input"><option value="group_multiplier">{{ t('admin.watch.groupMode') }}</option><option value="model_price">{{ t('admin.watch.modelMode') }}</option></select></label>
          <label class="watch-rule-field"><span class="input-label">{{ t('admin.watch.intervalSeconds') }}</span><input v-model.number="ruleForm.interval_seconds" class="input watch-rule-input" type="number" min="60" max="86400" step="60" required /></label>
          <label class="watch-rule-field"><span class="input-label">{{ t('admin.watch.adjustmentStep') }}</span><input ref="adjustmentStepInput" v-model.number="ruleForm.adjustment_step" class="input watch-rule-input" type="number" step="any" required :aria-invalid="isAdjustmentStepInvalid ? 'true' : undefined" :aria-describedby="isAdjustmentStepInvalid ? 'watch-pricing-rule-error' : undefined" @input="clearAdjustmentStepValidity" @invalid="handleAdjustmentStepInvalid" /></label>
          <label class="watch-rule-field"><span class="input-label">{{ t('admin.watch.platform') }}</span><input v-model.trim="ruleForm.platform" class="input watch-rule-input" placeholder="openai" /></label>
          <label class="watch-rule-field"><span class="input-label">{{ t('admin.watch.model') }}</span><input v-model.trim="ruleForm.model" class="input watch-rule-input" :disabled="ruleForm.mode !== 'model_price'" placeholder="gpt-4o" /></label>
          <label class="watch-rule-field"><span class="input-label">{{ t('admin.watch.component') }}</span><select v-model="ruleForm.component" class="input watch-rule-input" :disabled="ruleForm.mode !== 'model_price'"><option value="input">{{ t('admin.watch.inputPrice') }}</option><option value="output">{{ t('admin.watch.outputPrice') }}</option><option value="per_request">{{ t('admin.watch.perRequestPrice') }}</option></select></label>
          <label class="watch-rule-checkbox"><input v-model="ruleForm.enabled" type="checkbox" class="h-4 w-4 shrink-0 rounded border-gray-300 text-primary-600" />{{ t('admin.watch.enableAutoRun') }}</label>
        </div>
      </form>
      <template #footer>
        <div class="flex justify-end gap-3">
          <button class="btn btn-secondary" type="button" @click="closeRuleEditor">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" type="submit" form="watch-pricing-rule-form" :disabled="savingRule">{{ savingRule ? t('common.saving') : t('common.save') }}</button>
        </div>
      </template>
    </BaseDialog>

    <ConfirmDialog :show="Boolean(pendingApply)" :title="t('admin.watch.applySuggestedPrice')" :message="applyConfirmMessage" :confirm-text="t('admin.watch.confirmApply')" @confirm="confirmApply" @cancel="pendingApply = null" />
    <ConfirmDialog :show="Boolean(pendingRollback)" :title="t('admin.watch.rollback')" :message="rollbackConfirmMessage" :confirm-text="t('admin.watch.confirmRollback')" danger @confirm="confirmRollback" @cancel="pendingRollback = null" />
    <ConfirmDialog :show="Boolean(deletingRule)" :title="t('admin.watch.deletePricingRule')" :message="t('admin.watch.deletePricingRuleConfirm', { name: deletingRule?.name || '' })" :confirm-text="t('common.delete')" danger @confirm="confirmDeleteRule" @cancel="deletingRule = null" />
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import Icon from '@/components/icons/Icon.vue'
import { groupsAPI } from '@/api/admin/groups'
import { useAppStore } from '@/stores/app'
import {
  applyPricing,
  createPricingRule,
  deletePricingRule,
  listPriceAudits,
  listPricingRules,
  previewPricing,
  rollbackPricing,
  runPricingRule,
  updatePricingRule,
  type WatchPriceAudit,
  type WatchPriceComponent,
  type WatchPriceMode,
  type WatchPricingPreview,
  type WatchPricingRule,
  type WatchPricingRuleInput,
} from '@/api/admin/watch'
import { watchReasonText } from './watchText'

const { t, locale } = useI18n()
const appStore = useAppStore()
const loading = ref(false)
const previewLoading = ref(false)
const applying = ref(false)
const savingRule = ref(false)
const runningRuleId = ref<number | null>(null)
const error = ref('')
const ruleFormError = ref('')
const groups = ref<Array<{ id: number; name: string }>>([])
const rules = ref<WatchPricingRule[]>([])
const audits = ref<WatchPriceAudit[]>([])
const preview = ref<WatchPricingPreview | null>(null)
const pendingApply = ref<WatchPricingPreview | null>(null)
const pendingRollback = ref<WatchPriceAudit | null>(null)
const deletingRule = ref<WatchPricingRule | null>(null)
const editingRule = ref<WatchPricingRule | null>(null)
const showRuleEditor = ref(false)
const adjustmentStepInput = ref<HTMLInputElement | null>(null)

const manualForm = reactive({
  targetGroupId: 0,
  mode: 'group_multiplier' as WatchPriceMode,
  platform: '',
  model: '',
  component: 'input' as WatchPriceComponent,
})

const ruleForm = reactive({
  name: '',
  target_group_id: 0,
  mode: 'group_multiplier' as WatchPriceMode,
  platform: '',
  model: '',
  component: 'input' as WatchPriceComponent,
  enabled: false,
  interval_seconds: 300,
  adjustment_step: 0.003,
})

const canApplyPreview = computed(() => Boolean(preview.value && !preview.value.frozen && preview.value.current_value != null && preview.value.proposed_value != null))
const applyConfirmMessage = computed(() => t('admin.watch.applyConfirmMessage', { current: formatValue(pendingApply.value?.current_value), next: formatValue(pendingApply.value?.proposed_value) }))
const rollbackConfirmMessage = computed(() => t('admin.watch.rollbackConfirmMessage', { current: formatValue(pendingRollback.value?.next_value), next: formatValue(pendingRollback.value?.previous_value) }))
const isAdjustmentStepInvalid = computed(() => ruleFormError.value === adjustmentStepPositiveMessage())

function adjustmentStepPositiveMessage() {
  return t('admin.watch.reason_adjustment_step_must_be_positive')
}

function errorMessage(err: any, fallback: string) {
  const candidates = [
    err?.reason,
    err?.metadata?.reason,
    err?.error_code,
    err?.response?.data?.reason,
    err?.response?.data?.error_code,
    err?.response?.data?.message,
    err?.message,
  ].filter(Boolean)
  for (const candidate of candidates) {
    const raw = String(candidate)
    const translated = watchReasonText(t, raw, '')
    if (translated && translated !== raw) return translated
    if (/[\u4e00-\u9fa5]/.test(raw)) return raw
  }
  return fallback
}

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [nextGroups, nextRules, nextAudits] = await Promise.all([
      groupsAPI.getAll(),
      listPricingRules(),
      listPriceAudits(100),
    ])
    groups.value = nextGroups.map((group) => ({ id: group.id, name: group.name }))
    rules.value = nextRules
    audits.value = nextAudits
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function runManualPreview() {
  previewLoading.value = true
  error.value = ''
  try {
    preview.value = await previewPricing(buildManualPreviewInput())
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.previewFailed'))
  } finally {
    previewLoading.value = false
  }
}

async function confirmApply() {
  if (!pendingApply.value || pendingApply.value.current_value == null || pendingApply.value.proposed_value == null) return
  applying.value = true
  try {
    await applyPricing({
      ...buildManualPreviewInput(),
      expected_current_value: pendingApply.value.current_value,
      proposed_value: pendingApply.value.proposed_value,
      confirmed: true,
      idempotency_key: operationKey('watch-manual'),
    })
    pendingApply.value = null
    appStore.showSuccess(t('admin.watch.priceApplied'))
    await loadAll()
    await runManualPreview()
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.applyFailed'))
  } finally {
    applying.value = false
  }
}

function buildManualPreviewInput() {
  return {
    target_group_id: manualForm.targetGroupId,
    mode: manualForm.mode,
    platform: manualForm.platform || undefined,
    model: manualForm.mode === 'model_price' ? manualForm.model || undefined : undefined,
    component: manualForm.component,
  }
}

function resetRuleForm() {
  Object.assign(ruleForm, { name: '', target_group_id: 0, mode: 'group_multiplier', platform: '', model: '', component: 'input', enabled: false, interval_seconds: 300, adjustment_step: 0.003 })
  clearAdjustmentStepValidity()
}

function openCreateRule() {
  editingRule.value = null
  resetRuleForm()
  ruleFormError.value = ''
  showRuleEditor.value = true
}

function openEditRule(rule: WatchPricingRule) {
  editingRule.value = rule
  Object.assign(ruleForm, {
    name: rule.name,
    target_group_id: rule.target_group_id,
    mode: rule.mode,
    platform: rule.platform || '',
    model: rule.model || '',
    component: rule.component || 'input',
    enabled: rule.enabled,
    interval_seconds: rule.interval_seconds,
    adjustment_step: rule.adjustment_step || 0.003,
  })
  ruleFormError.value = ''
  clearAdjustmentStepValidity()
  showRuleEditor.value = true
}

function closeRuleEditor() {
  if (!savingRule.value) showRuleEditor.value = false
}

function clearAdjustmentStepValidity(event?: Event) {
  const input = (event?.target as HTMLInputElement | undefined) || adjustmentStepInput.value
  input?.setCustomValidity('')
  if (isAdjustmentStepInvalid.value) ruleFormError.value = ''
}

function handleAdjustmentStepInvalid(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.validity.valueMissing || input.validity.badInput) return
  const value = Number(input.value)
  if (!Number.isFinite(value) || value <= 0) {
    input.setCustomValidity(adjustmentStepPositiveMessage())
  }
}

function validateAdjustmentStep() {
  const value = Number(ruleForm.adjustment_step)
  if (!Number.isFinite(value) || value <= 0) {
    const message = adjustmentStepPositiveMessage()
    ruleFormError.value = message
    adjustmentStepInput.value?.setCustomValidity(message)
    adjustmentStepInput.value?.reportValidity()
    return false
  }
  ruleForm.adjustment_step = value
  adjustmentStepInput.value?.setCustomValidity('')
  return true
}

function buildRuleInput(): WatchPricingRuleInput {
  return {
    name: ruleForm.name,
    target_group_id: ruleForm.target_group_id,
    mode: ruleForm.mode,
    platform: ruleForm.platform || undefined,
    model: ruleForm.mode === 'model_price' ? ruleForm.model || undefined : undefined,
    component: ruleForm.component,
    enabled: ruleForm.enabled,
    interval_seconds: ruleForm.interval_seconds,
    adjustment_step: ruleForm.adjustment_step,
  }
}

async function saveRule() {
  ruleFormError.value = ''
  if (!validateAdjustmentStep()) return
  savingRule.value = true
  try {
    if (editingRule.value) await updatePricingRule(editingRule.value.id, buildRuleInput())
    else await createPricingRule(buildRuleInput())
    showRuleEditor.value = false
    appStore.showSuccess(t('admin.watch.pricingRuleSaved'))
    await loadAll()
  } catch (err) {
    ruleFormError.value = errorMessage(err, t('admin.watch.pricingRuleSaveFailed'))
  } finally {
    savingRule.value = false
  }
}

async function runRule(rule: WatchPricingRule) {
  runningRuleId.value = rule.id
  error.value = ''
  try {
    const result = await runPricingRule(rule.id)
    appStore.showSuccess(t('admin.watch.ruleRunCompleted', { status: statusText(result.status, result.error_code) }))
    await loadAll()
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.ruleRunFailed'))
  } finally {
    runningRuleId.value = null
  }
}

async function confirmDeleteRule() {
  if (!deletingRule.value) return
  try {
    await deletePricingRule(deletingRule.value.id)
    deletingRule.value = null
    appStore.showSuccess(t('common.deleted'))
    await loadAll()
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.pricingRuleDeleteFailed'))
  }
}

async function confirmRollback() {
  if (!pendingRollback.value || pendingRollback.value.next_value == null) return
  try {
    await rollbackPricing(pendingRollback.value.id, {
      expected_current_value: pendingRollback.value.next_value,
      confirmed: true,
      idempotency_key: operationKey('watch-rollback'),
    })
    pendingRollback.value = null
    appStore.showSuccess(t('admin.watch.rollbackCompleted'))
    await loadAll()
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.rollbackFailed'))
  }
}

function operationKey(prefix: string) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}:${random}`
}

function canRollback(audit: WatchPriceAudit) {
  return audit.action === 'applied' && audit.previous_value != null && audit.next_value != null && !audits.value.some((item) => item.rollback_of_id === audit.id && item.action === 'rolled_back')
}

function groupName(id?: number) {
  if (!id) return '-'
  return groups.value.find((group) => group.id === id)?.name || `#${id}`
}

function modeLabel(mode: WatchPriceMode) {
  return mode === 'model_price' ? t('admin.watch.modelMode') : t('admin.watch.groupMode')
}

function statusText(status?: string, errorCode?: string) {
  if (!status) return '-'
  const key = `admin.watch.ruleStatus_${status}`
  const label = t(key)
  const translated = label === key ? status : label
  return errorCode ? `${translated} · ${watchReasonText(t, errorCode, errorCode)}` : translated
}

function auditActionClass(action: string) {
  const base = 'inline-flex rounded-full px-2.5 py-1 text-xs font-medium '
  if (action === 'applied' || action === 'rolled_back') return base + 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (action === 'frozen' || action === 'conflict') return base + 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  if (action === 'failed') return base + 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  return base + 'bg-gray-100 text-gray-600 dark:bg-dark-700 dark:text-gray-300'
}

function accountCostStatusClass(healthy: boolean) {
  const base = 'inline-flex rounded-full px-2.5 py-1 text-xs font-medium '
  return healthy
    ? base + 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
    : base + 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
}

function pricingSourceLabel(source?: string) {
  if (source === 'official_probe') return t('admin.watch.pricingSourceOfficialProbe')
  if (source === 'watch_fallback') return t('admin.watch.pricingSourceWatchFallback')
  return t('admin.watch.pricingSourceUnresolved')
}

function pricingSourceClass(source?: string) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium '
  if (source === 'official_probe') return base + 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
  if (source === 'watch_fallback') return base + 'bg-gray-100 text-gray-700 dark:bg-dark-700 dark:text-gray-200'
  return base + 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'
}

function officialProbeStatusLabel(status?: string) {
  if (!status) return '-'
  const key = `admin.watch.officialProbeStatus_${status}`
  const label = t(key)
  return label === key ? status : label
}

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '-'
}

function formatValue(value?: number) {
  return value == null ? '-' : value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
}

onMounted(loadAll)
</script>

<style scoped>
.icon-action { @apply inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-dark-700 dark:hover:text-white; }
.watch-rule-form-grid { @apply grid gap-4 sm:grid-cols-2 xl:grid-cols-3; }
.watch-rule-field { @apply flex min-w-0 flex-col gap-1 text-sm text-gray-700 dark:text-gray-200; }
.watch-rule-input { @apply h-10 min-w-0; }
.watch-rule-checkbox { @apply flex min-h-10 items-center gap-2 rounded-md border border-gray-200 px-3 text-sm text-gray-700 dark:border-dark-700 dark:text-gray-200; }
</style>
