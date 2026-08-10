<template>
  <BaseDialog :show="show" :title="operation === 'add' ? t('admin.users.deposit') : t('admin.users.withdraw')" width="narrow" @close="$emit('close')">
    <form v-if="user" id="balance-form" @submit.prevent="handleBalanceSubmit" class="space-y-5">
      <div class="flex items-center gap-3 rounded-xl bg-gray-50 p-4 dark:bg-dark-700">
        <div class="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100"><span class="text-lg font-medium text-primary-700">{{ user.email.charAt(0).toUpperCase() }}</span></div>
        <div class="flex-1"><p class="font-medium text-gray-900 dark:text-gray-100">{{ user.email }}</p><p class="text-sm text-gray-500 dark:text-gray-400">{{ t('admin.users.currentBalance') }}: ${{ formatBalance(user.balance) }}</p></div>
      </div>
      <div>
        <label for="balance-principal-input" class="input-label">{{ operation === 'add' ? t('admin.users.rechargePrincipal') : t('admin.users.withdrawAmount') }}</label>
        <div class="relative flex gap-2">
          <div class="relative flex-1"><div class="absolute left-3 top-1/2 -translate-y-1/2 font-medium text-gray-500">$</div><input id="balance-principal-input" v-model.number="form.amount" data-test="principal-input" type="number" step="any" min="0" required class="input pl-8" /></div>
          <button v-if="operation === 'subtract'" type="button" @click="fillAllBalance" class="btn btn-secondary whitespace-nowrap">{{ t('admin.users.withdrawAll') }}</button>
        </div>
      </div>
      <div v-if="operation === 'add'">
        <label for="balance-bonus-input" class="input-label">{{ t('admin.users.rechargeBonus') }} <span class="font-normal text-gray-400">({{ t('common.optional') }})</span></label>
        <div class="relative">
          <div class="absolute left-3 top-1/2 -translate-y-1/2 font-medium text-gray-500">$</div>
          <input id="balance-bonus-input" v-model.number="form.bonusAmount" data-test="bonus-input" type="number" step="any" class="input pl-8" :aria-invalid="Boolean(bonusError)" :aria-describedby="bonusError ? 'recharge-bonus-error' : 'recharge-bonus-hint'" />
        </div>
        <p v-if="bonusError" id="recharge-bonus-error" role="alert" class="mt-1 text-sm text-red-600 dark:text-red-400">{{ bonusError }}</p>
        <p v-else id="recharge-bonus-hint" class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('admin.users.rechargeBonusHint') }}</p>
      </div>
      <div><label for="balance-notes-input" class="input-label">{{ t('admin.users.notes') }}</label><textarea id="balance-notes-input" v-model="form.notes" rows="3" class="input"></textarea></div>
      <div v-if="form.amount > 0" class="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
        <div v-if="operation === 'add'" class="flex items-center justify-between text-sm"><span class="text-gray-700 dark:text-gray-300">{{ t('admin.users.creditedTotal') }}:</span><span data-test="credited-total" class="font-semibold text-gray-900 dark:text-gray-100">${{ formatBalance(calculateCreditedTotal()) }}</span></div>
        <div class="flex items-center justify-between text-sm"><span class="text-gray-700 dark:text-gray-300">{{ t('admin.users.newBalance') }}:</span><span data-test="new-balance" class="font-bold text-gray-900 dark:text-gray-100">${{ formatBalance(calculateNewBalance()) }}</span></div>
      </div>
    </form>
    <template #footer>
      <div class="flex justify-end gap-3">
        <button @click="$emit('close')" class="btn btn-secondary">{{ t('common.cancel') }}</button>
        <button data-test="submit" type="submit" form="balance-form" :disabled="submitting || !form.amount || form.amount <= 0 || form.bonusAmount < 0" class="btn" :class="operation === 'add' ? 'bg-emerald-600 text-white' : 'btn-danger'">{{ submitting ? t('common.saving') : t('common.confirm') }}</button>
      </div>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { adminAPI } from '@/api/admin'
import type { AdminUser } from '@/types'
import BaseDialog from '@/components/common/BaseDialog.vue'

const props = defineProps<{ show: boolean, user: AdminUser | null, operation: 'add' | 'subtract' }>()
const emit = defineEmits(['close', 'success']); const { t } = useI18n(); const appStore = useAppStore()

const submitting = ref(false)
const bonusError = ref('')
const idempotencyKey = ref('')
const form = reactive({ amount: 0, bonusAmount: 0, notes: '' })
watch(() => props.show, (v) => {
  if (v) {
    form.amount = 0
    form.bonusAmount = 0
    form.notes = ''
    bonusError.value = ''
    idempotencyKey.value = ''
  }
})
watch(() => form.bonusAmount, (value) => {
  bonusError.value = Number(value) < 0 ? t('admin.users.rechargeBonusInvalid') : ''
})

// 格式化余额：显示完整精度，去除尾部多余的0
const formatBalance = (value: number) => {
  if (value === 0) return '0.00'
  // 最多保留8位小数，去除尾部的0
  const formatted = value.toFixed(8).replace(/\.?0+$/, '')
  // 确保至少有2位小数
  const parts = formatted.split('.')
  if (parts.length === 1) return formatted + '.00'
  if (parts[1].length === 1) return formatted + '0'
  return formatted
}

// 填入全部余额
const fillAllBalance = () => {
  if (props.user) {
    form.amount = props.user.balance
  }
}

const normalizedBonusAmount = () => {
  const value = Number(form.bonusAmount)
  return Number.isFinite(value) ? value : 0
}

const calculateCreditedTotal = () => Number(form.amount) + (props.operation === 'add' ? normalizedBonusAmount() : 0)

const calculateNewBalance = () => {
  if (!props.user) return 0
  const result = props.operation === 'add' ? props.user.balance + calculateCreditedTotal() : props.user.balance - form.amount
  // 避免浮点数精度问题导致的 -0.00 显示
  return Math.abs(result) < 1e-10 ? 0 : result
}
const handleBalanceSubmit = async () => {
  if (!props.user) return
  if (!form.amount || form.amount <= 0) {
    appStore.showError(t('admin.users.amountRequired'))
    return
  }
  const bonusAmount = normalizedBonusAmount()
  if (props.operation === 'add' && bonusAmount < 0) {
    bonusError.value = t('admin.users.rechargeBonusInvalid')
    return
  }
  // 退款时验证金额不超过实际余额
  if (props.operation === 'subtract' && form.amount > props.user.balance) {
    appStore.showError(t('admin.users.insufficientBalance'))
    return
  }
  submitting.value = true
  try {
    if (!idempotencyKey.value) {
      const randomPart = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`
      idempotencyKey.value = `admin-recharge-${props.user.id}-${randomPart}`
    }
    await adminAPI.users.updateBalance(props.user.id, {
      balance: form.amount,
      bonus_amount: props.operation === 'add' ? bonusAmount : 0,
      operation: props.operation,
      notes: form.notes,
      idempotencyKey: idempotencyKey.value
    })
    appStore.showSuccess(t('common.success')); emit('success'); emit('close')
  } catch (e: any) {
    console.error('Failed to update balance:', e)
    const errorKeyByCode: Record<string, string> = {
      ADMIN_RECHARGE_PRINCIPAL_INVALID: 'admin.users.rechargePrincipalInvalid',
      ADMIN_RECHARGE_BONUS_INVALID: 'admin.users.rechargeBonusInvalid',
      ADMIN_RECHARGE_BONUS_OPERATION_INVALID: 'admin.users.rechargeBonusOperationInvalid',
      ADMIN_RECHARGE_IDEMPOTENCY_CONFLICT: 'admin.users.rechargeIdempotencyConflict'
    }
    const localizedKey = errorKeyByCode[String(e?.code || '')]
    appStore.showError(localizedKey ? t(localizedKey) : (e?.message || e?.response?.data?.detail || t('common.error')))
  } finally { submitting.value = false }
}
</script>
