import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import UserBalanceModal from '../UserBalanceModal.vue'

const { updateBalance, showSuccess, showError } = vi.hoisted(() => ({
  updateBalance: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: { users: { updateBalance } }
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ showSuccess, showError })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key })
}))

const user = {
  id: 42,
  email: 'user@example.com',
  balance: 10
} as any

const mountModal = () => mount(UserBalanceModal, {
  props: { show: true, user, operation: 'add' },
  global: {
    stubs: {
      BaseDialog: {
        props: ['show', 'title'],
        emits: ['close'],
        template: '<div v-if="show"><slot /><slot name="footer" /></div>'
      }
    }
  }
})

describe('UserBalanceModal administrator recharge bonus', () => {
  beforeEach(() => {
    updateBalance.mockReset()
    showSuccess.mockReset()
    showError.mockReset()
    updateBalance.mockResolvedValue({ ...user, balance: 130 })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('submits principal and bonus and previews the credited total', async () => {
    const wrapper = mountModal()
    await wrapper.get('[data-test="principal-input"]').setValue('100')
    await wrapper.get('[data-test="bonus-input"]').setValue('20')

    expect(wrapper.get('[data-test="credited-total"]').text()).toContain('$120.00')
    expect(wrapper.get('[data-test="new-balance"]').text()).toContain('$130.00')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(updateBalance).toHaveBeenCalledWith(42, {
      balance: 100,
      bonus_amount: 20,
      operation: 'add',
      notes: '',
      idempotencyKey: 'admin-recharge-42-11111111-1111-4111-8111-111111111111'
    })
    expect(wrapper.emitted('success')).toHaveLength(1)
  })

  it('shows a localized inline error and does not submit a negative bonus', async () => {
    const wrapper = mountModal()
    await wrapper.get('[data-test="principal-input"]').setValue('100')
    await wrapper.get('[data-test="bonus-input"]').setValue('-1')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.get('[role="alert"]').text()).toBe('admin.users.rechargeBonusInvalid')
    expect(updateBalance).not.toHaveBeenCalled()
  })

  it('treats an empty optional bonus as zero', async () => {
    const wrapper = mountModal()
    await wrapper.get('[data-test="principal-input"]').setValue('100')
    await wrapper.get('[data-test="bonus-input"]').setValue('')

    expect(wrapper.get('[data-test="credited-total"]').text()).toContain('$100.00')
    expect(wrapper.get('[data-test="new-balance"]').text()).toContain('$110.00')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(updateBalance).toHaveBeenCalledWith(42, expect.objectContaining({ bonus_amount: 0 }))
  })

  it('reuses the same idempotency key after an ambiguous failure', async () => {
    updateBalance.mockRejectedValueOnce(new Error('network timeout')).mockResolvedValueOnce({ ...user, balance: 130 })
    const wrapper = mountModal()
    await wrapper.get('[data-test="principal-input"]').setValue('100')
    await wrapper.get('[data-test="bonus-input"]').setValue('20')

    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(updateBalance).toHaveBeenCalledTimes(2)
    expect(updateBalance.mock.calls[1][1].idempotencyKey).toBe(updateBalance.mock.calls[0][1].idempotencyKey)
  })

  it('maps backend recharge validation codes to localized feedback', async () => {
    updateBalance.mockRejectedValueOnce({ code: 'ADMIN_RECHARGE_BONUS_INVALID' })
    const wrapper = mountModal()
    await wrapper.get('[data-test="principal-input"]').setValue('100')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(showError).toHaveBeenCalledWith('admin.users.rechargeBonusInvalid')
  })
})
