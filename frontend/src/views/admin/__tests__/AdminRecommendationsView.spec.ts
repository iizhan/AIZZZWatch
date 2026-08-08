import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminRecommendationsView from '../AdminRecommendationsView.vue'

const { adminDecideMock, adminListMock, adminListModelsMock, adminListPublicPricingMock, adminSaveModelMock, adminSavePublicPricingMock } = vi.hoisted(() => ({
  adminDecideMock: vi.fn(),
  adminListMock: vi.fn(),
  adminListModelsMock: vi.fn(),
  adminListPublicPricingMock: vi.fn(),
  adminSaveModelMock: vi.fn(),
  adminSavePublicPricingMock: vi.fn(),
}))

vi.mock('@/api/recommendations', () => ({
  recommendationAPI: {
    adminDecide: adminDecideMock,
    adminList: adminListMock,
    adminListModels: adminListModelsMock,
    adminListPublicPricing: adminListPublicPricingMock,
    adminSaveModel: adminSaveModelMock,
    adminSavePublicPricing: adminSavePublicPricingMock,
  },
}))

vi.mock('vue-i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({
    locale: { value: 'zh-CN' },
    t: (key: string) => ({
      'admin.recommendations.review': '审核',
      'admin.recommendations.confirm': '确认处理',
      'admin.recommendations.adjustmentReasonRequired': '奖励类型与用户申请不一致，请填写调整说明',
      'admin.recommendations.amountPositive': '一次性奖励金额必须大于 0',
    } as Record<string, string>)[key] || key,
  }),
}))

const AppLayoutStub = defineComponent({ template: '<main><slot /></main>' })
const pendingItem = {
  id: 7,
  user_id: 42,
  site_url: 'https://example.com',
  model_key: 'claude',
  submitted_multiplier: 0.05,
  requested_reward_type: 'profit_share',
  status: 'pending',
  created_at: '2026-08-07T00:00:00Z',
}

describe('AdminRecommendationsView', () => {
  beforeEach(() => {
    adminDecideMock.mockReset().mockResolvedValue({ data: {} })
    adminListMock.mockReset().mockResolvedValue({ data: [pendingItem] })
    adminListModelsMock.mockReset().mockResolvedValue({ data: [] })
    adminListPublicPricingMock.mockReset().mockResolvedValue({ data: [] })
    adminSaveModelMock.mockReset().mockResolvedValue({ data: {} })
    adminSavePublicPricingMock.mockReset().mockResolvedValue({ data: {} })
  })

  it('requires an explanation when the accepted reward type differs from the request', async () => {
    const wrapper = mount(AdminRecommendationsView, { global: { stubs: { AppLayout: AppLayoutStub, Teleport: true } } })
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '审核')!.trigger('click')
    const dialog = wrapper.get('form')
    await wrapper.get<HTMLSelectElement>('#recommendation-reward-type').setValue('one_time_credit')
    await nextTick()
    await wrapper.get<HTMLInputElement>('#recommendation-one-time-amount').setValue('5')
    await wrapper.get('#recommendation-decision-reason').setValue('采纳该站点')
    await dialog.trigger('submit')
    await flushPromises()

    expect(adminDecideMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('奖励类型与用户申请不一致，请填写调整说明')

    await wrapper.get('#recommendation-adjustment-reason').setValue('稳定性适合一次性奖励')
    await dialog.trigger('submit')
    await flushPromises()
    expect(adminDecideMock).toHaveBeenCalledWith(7, expect.objectContaining({
      adopted: true,
      reward_type: 'one_time_credit',
      amount: 5,
      reason: '采纳该站点',
      admin_note: '稳定性适合一次性奖励',
    }))
  })

  it('loads all decision states when the status filter is cleared', async () => {
    const wrapper = mount(AdminRecommendationsView, { global: { stubs: { AppLayout: AppLayoutStub, Teleport: true } } })
    await flushPromises()
    const statusFilter = wrapper.findAll<HTMLSelectElement>('select').find((select) => select.element.value === 'pending')
    expect(statusFilter).toBeTruthy()
    await statusFilter!.setValue('')
    await flushPromises()
    expect(adminListMock).toHaveBeenLastCalledWith(undefined)
  })
})
