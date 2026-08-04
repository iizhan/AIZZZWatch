import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WatchOperationsView from '../WatchOperationsView.vue'

const {
  applyRateCompensationMock,
  getOperationsReportMock,
  listRateAnomaliesMock,
  previewRateCompensationMock,
  showSuccessMock,
} = vi.hoisted(() => ({
  applyRateCompensationMock: vi.fn(),
  getOperationsReportMock: vi.fn(),
  listRateAnomaliesMock: vi.fn(),
  previewRateCompensationMock: vi.fn(),
  showSuccessMock: vi.fn(),
}))

vi.mock('vue-i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({ locale: 'zh-CN', t: (key: string) => key }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ showSuccess: showSuccessMock }),
}))

vi.mock('@/api/admin/watch', () => ({
  applyRateCompensation: applyRateCompensationMock,
  getOperationsReport: getOperationsReportMock,
  listRateAnomalies: listRateAnomaliesMock,
  previewRateCompensation: previewRateCompensationMock,
}))

const AppLayoutStub = defineComponent({
  name: 'AppLayout',
  template: '<main><slot /></main>',
})

const BaseDialogStub = defineComponent({
  name: 'BaseDialog',
  props: { show: Boolean },
  emits: ['close'],
  template: '<section v-if="show" data-testid="compensation-dialog"><slot /><slot name="footer" /></section>',
})

const IconStub = defineComponent({ name: 'Icon', template: '<span />' })

const anomaly = {
  id: 17,
  pricing_rule_id: 3,
  target_group_id: 23,
  group_name: 'Team A',
  kind: 'overpriced',
  status: 'resolved',
  current_value: 0.52,
  target_value: 0.07,
  highest_upstream_cost: 0.06,
  pricing_source: 'official_probe',
  official_probe_count: 1,
  watch_fallback_count: 0,
  evidence_mismatch_count: 1,
  detected_at: '2026-08-03T11:00:00Z',
  last_observed_at: '2026-08-03T12:00:00Z',
  resolved_at: '2026-08-03T12:00:00Z',
  created_at: '2026-08-03T11:00:00Z',
  updated_at: '2026-08-03T12:00:00Z',
}

describe('WatchOperationsView compensation flow', () => {
  beforeEach(() => {
    applyRateCompensationMock.mockReset().mockResolvedValue({ applied_count: 1, compensated_amount: 0.61 })
    getOperationsReportMock.mockReset().mockResolvedValue({
      generated_at: '2026-08-03T12:00:00Z',
      window_days: 7,
      summary: {
        window_start: '2026-07-27T12:00:00Z',
        window_end: '2026-08-03T12:00:00Z',
        request_count: 0,
        loss_request_count: 0,
        unresolved_request_count: 0,
        account_count: 0,
        group_count: 0,
        revenue: 0,
        estimated_upstream_cost: 0,
        gross_profit: 0,
      },
      alerts: [],
    })
    listRateAnomaliesMock.mockReset().mockResolvedValue([anomaly])
    previewRateCompensationMock.mockReset().mockResolvedValue({
      anomaly,
      window_start: anomaly.detected_at,
      window_end: anomaly.resolved_at,
      user_count: 2,
      eligible_count: 1,
      request_count: 3,
      actual_cost: 1.4,
      expected_cost: 0.79,
      candidate_amount: 0.61,
      unresolved_request_count: 1,
      generated_at: '2026-08-03T12:01:00Z',
      rows: [
        { user_id: 25, username: 'eligible-user', email: '', request_count: 2, eligible_request_count: 2, unresolved_request_count: 0, actual_cost: 1.2, expected_cost: 0.59, candidate_amount: 0.61, eligible: true, already_compensated: false },
        { user_id: 31, username: 'review-user', email: '', request_count: 1, eligible_request_count: 0, unresolved_request_count: 1, actual_cost: 0.2, expected_cost: 0, candidate_amount: 0, eligible: false, reason: 'unsupported or ambiguous usage is excluded and requires review', already_compensated: false },
      ],
    })
    showSuccessMock.mockReset()
  })

  it('excludes unresolved rows and requires explicit confirmation before applying selected users', async () => {
    const wrapper = mount(WatchOperationsView, {
      global: { stubs: { AppLayout: AppLayoutStub, BaseDialog: BaseDialogStub, Icon: IconStub } },
    })
    await flushPromises()

    const previewButton = wrapper.findAll('button').find((button) => button.text() === 'admin.watch.previewCompensation')
    expect(previewButton).toBeTruthy()
    await previewButton!.trigger('click')
    await flushPromises()

    const dialog = wrapper.get('[data-testid="compensation-dialog"]')
    const checkboxes = dialog.findAll<HTMLInputElement>('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(3)
    expect(checkboxes[0].element.checked).toBe(true)
    expect(checkboxes[1].element.disabled).toBe(true)
    expect(checkboxes[1].element.checked).toBe(false)
    expect(dialog.text()).toContain('admin.watch.compensationReasonPartial')

    const confirmButton = dialog.findAll('button').find((button) => button.text() === 'admin.watch.confirmCompensation')
    expect(confirmButton).toBeTruthy()
    expect(confirmButton!.attributes('disabled')).toBeDefined()
    await checkboxes[2].setValue(true)
    expect(confirmButton!.attributes('disabled')).toBeUndefined()
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(applyRateCompensationMock).toHaveBeenCalledTimes(1)
    expect(applyRateCompensationMock).toHaveBeenCalledWith(17, expect.objectContaining({
      user_ids: [25],
      confirmed: true,
      reason: 'admin.watch.defaultCompensationReason',
      idempotency_key: expect.stringMatching(/^watch-rate-comp:17:/),
    }))
    expect(showSuccessMock).toHaveBeenCalledTimes(1)
  })
})
