import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WatchAutoPricingView from '../WatchAutoPricingView.vue'

const {
  createPricingRuleMock,
  deletePricingRuleMock,
  listPriceAuditsMock,
  listPricingRulesMock,
  previewPricingMock,
  rollbackPricingMock,
  runPricingRuleMock,
  updatePricingRuleMock,
  applyPricingMock,
  getGroupsMock,
  showSuccessMock,
} = vi.hoisted(() => ({
  createPricingRuleMock: vi.fn(),
  deletePricingRuleMock: vi.fn(),
  listPriceAuditsMock: vi.fn(),
  listPricingRulesMock: vi.fn(),
  previewPricingMock: vi.fn(),
  rollbackPricingMock: vi.fn(),
  runPricingRuleMock: vi.fn(),
  updatePricingRuleMock: vi.fn(),
  applyPricingMock: vi.fn(),
  getGroupsMock: vi.fn(),
  showSuccessMock: vi.fn(),
}))

vi.mock('vue-i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({
    locale: 'zh',
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'admin.watch.reason_adjustment_step_must_be_positive') return '单次调价步长必须大于 0'
      if (key === 'admin.watch.pricingRuleSaved') return '自动调价规则已保存'
      if (key === 'admin.watch.ruleRunCompleted') return `规则运行完成：${params?.status ?? ''}`
      if (key === 'admin.watch.officialProbeStatus_ok') return '有效'
      return key
    },
  }),
}))

vi.mock('@/api/admin/groups', () => ({
  default: {
    getAll: getGroupsMock,
  },
  groupsAPI: {
    getAll: getGroupsMock,
  },
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    showSuccess: showSuccessMock,
  }),
}))

vi.mock('@/api/admin/watch', () => ({
  applyPricing: applyPricingMock,
  createPricingRule: createPricingRuleMock,
  deletePricingRule: deletePricingRuleMock,
  listPriceAudits: listPriceAuditsMock,
  listPricingRules: listPricingRulesMock,
  previewPricing: previewPricingMock,
  rollbackPricing: rollbackPricingMock,
  runPricingRule: runPricingRuleMock,
  updatePricingRule: updatePricingRuleMock,
}))

const AppLayoutStub = defineComponent({
  name: 'AppLayout',
  template: '<main><slot /></main>',
})

const BaseDialogStub = defineComponent({
  name: 'BaseDialog',
  props: {
    show: Boolean,
    title: String,
    width: String,
  },
  template: '<section v-if="show" data-testid="base-dialog"><slot /><slot name="footer" /></section>',
})

const ConfirmDialogStub = defineComponent({
  name: 'ConfirmDialog',
  props: {
    show: Boolean,
  },
  template: '<section v-if="show" data-testid="confirm-dialog" />',
})

const IconStub = defineComponent({
  name: 'Icon',
  template: '<span data-testid="icon" />',
})

async function mountView() {
  const wrapper = mount(WatchAutoPricingView, {
    global: {
      stubs: {
        AppLayout: AppLayoutStub,
        BaseDialog: BaseDialogStub,
        ConfirmDialog: ConfirmDialogStub,
        Icon: IconStub,
      },
    },
  })
  await flushPromises()
  ;(wrapper.vm as unknown as { openCreateRule: () => void }).openCreateRule()
  await nextTick()
  return wrapper
}

async function fillRequiredRuleFields(wrapper: ReturnType<typeof mount>, adjustmentStep: string) {
  const form = wrapper.find<HTMLFormElement>('#watch-pricing-rule-form')
  const inputs = form.findAll<HTMLInputElement>('input')
  const selects = form.findAll<HTMLSelectElement>('select')

  await inputs[0].setValue('QA_AUTO_STEP_VISIBLE')
  await selects[0].setValue('1')
  await inputs[1].setValue('300')
  await inputs[2].setValue(adjustmentStep)

  return form
}

describe('WatchAutoPricingView rule form adjustment step', () => {
  beforeEach(() => {
    createPricingRuleMock.mockReset().mockResolvedValue({})
    deletePricingRuleMock.mockReset().mockResolvedValue({})
    listPriceAuditsMock.mockReset().mockResolvedValue([])
    listPricingRulesMock.mockReset().mockResolvedValue([])
    previewPricingMock.mockReset().mockResolvedValue(null)
    rollbackPricingMock.mockReset().mockResolvedValue({})
    runPricingRuleMock.mockReset().mockResolvedValue({ status: 'skipped' })
    updatePricingRuleMock.mockReset().mockResolvedValue({})
    applyPricingMock.mockReset().mockResolvedValue({})
    getGroupsMock.mockReset().mockResolvedValue([{ id: 1, name: 'ces' }])
    showSuccessMock.mockReset()
  })

  it('allows 0.001 as a valid adjustment step and includes it in the create payload', async () => {
    const wrapper = await mountView()
    const form = await fillRequiredRuleFields(wrapper, '0.001')
    const adjustmentStepInput = form.find<HTMLInputElement>('input[type="number"][step="any"]')

    expect(adjustmentStepInput.exists()).toBe(true)
    expect(adjustmentStepInput.element.validity.stepMismatch).toBe(false)

    await form.trigger('submit')
    await flushPromises()

    expect(createPricingRuleMock).toHaveBeenCalledTimes(1)
    expect(createPricingRuleMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'QA_AUTO_STEP_VISIBLE',
      target_group_id: 1,
      interval_seconds: 300,
      adjustment_step: 0.001,
      enabled: false,
    }))
  })

  it('shows a Chinese inline error and does not submit when adjustment step is not positive', async () => {
    const wrapper = await mountView()
    const form = await fillRequiredRuleFields(wrapper, '0')

    await form.trigger('submit')
    await flushPromises()

    expect(createPricingRuleMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('单次调价步长必须大于 0')
  })

  it('renders official probe priority, Watch fallback, and evidence mismatch in the cost table', async () => {
    previewPricingMock.mockResolvedValue({
      mode: 'group_multiplier',
      current_value: 0.052,
      target_value: 0.07,
      proposed_value: 0.07,
      frozen: false,
      cost_rows: [{
        account_id: 391,
        account_name: 'probe-account',
        platform: 'openai',
        source_id: 9,
        source_name: 'source-a',
        source_key_external_id: 'key-1',
        source_key_label: 'Key A',
        source_group_external_id: 'group-a',
        source_group_name: 'Team A',
        official_probe_multiplier: 0.06,
        watch_fallback_multiplier: 0.052,
        recharge_ratio: 1,
        effective_cost: 0.06,
        pricing_source: 'official_probe',
        official_probe_status: 'ok',
        evidence_mismatch: true,
        downward_safe: true,
        healthy: true,
      }],
    })
    const wrapper = await mountView()
    await wrapper.find<HTMLSelectElement>('select').setValue('1')
    const previewButton = wrapper.findAll('button').find((button) => button.text() === 'admin.watch.runPreview')

    expect(previewButton).toBeTruthy()
    await previewButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('probe-account')
    expect(wrapper.text()).toContain('admin.watch.pricingSourceOfficialProbe')
    expect(wrapper.text()).toContain('admin.watch.evidenceMismatch')
    expect(wrapper.text()).toContain('有效')
    expect(wrapper.text()).toContain('0.06')
    expect(wrapper.text()).toContain('0.052')
  })
})
