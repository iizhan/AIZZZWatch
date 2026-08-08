import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RecommendationsView from '../RecommendationsView.vue'

const { createMock, getModelsMock, listMineMock, transferMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  getModelsMock: vi.fn(),
  listMineMock: vi.fn(),
  transferMock: vi.fn(),
}))

vi.mock('@/api/recommendations', () => ({
  recommendationAPI: {
    create: createMock,
    getModels: getModelsMock,
    listMine: listMineMock,
    transfer: transferMock,
  },
}))

vi.mock('vue-i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({
    locale: { value: 'zh-CN' },
    t: (key: string, params?: Record<string, unknown>) => {
      const messages: Record<string, string> = {
        'recommendations.title': '揭榜悬赏',
        'recommendations.rules': '分红按正向毛利的 1% 计算，默认 90 天、累计上限 100 美元。',
        'recommendations.transfer': '划转可用分红',
        'recommendations.submit': '提交推荐',
        'recommendations.submitSuccess': '推荐已提交，等待管理员审核',
		'recommendations.profitReward': `可划转 ${params?.available} / 累计 ${params?.total}`,
		'recommendations.adjustmentNote': `奖励调整说明：${params?.note}`,
      }
      return messages[key] || key
    },
  }),
}))

const AppLayoutStub = defineComponent({ template: '<main><slot /></main>' })

describe('RecommendationsView', () => {
  beforeEach(() => {
    createMock.mockReset().mockResolvedValue({ data: {} })
    getModelsMock.mockReset().mockResolvedValue({ data: [{ key: 'claude', name: 'Claude', sort_order: 10, enabled: true }] })
    listMineMock.mockReset().mockResolvedValue({ data: [{
      id: 7,
      user_id: 42,
      site_url: 'https://example.com',
      model_key: 'claude',
      submitted_multiplier: 0.05,
      requested_reward_type: 'profit_share',
      status: 'adopted',
      decision_reason: '已接入',
      created_at: '2026-08-07T00:00:00Z',
		reward: { id: 8, recommendation_id: 7, reward_type: 'profit_share', amount: 1.2, share_percent: 1, cap_amount: 100, transferred_amount: 0, available_amount: 1.2, admin_note: '奖励类型已按稳定性调整' },
    }] })
    transferMock.mockReset().mockResolvedValue({ data: { transferred_amount: 1.2 } })
  })

  it('shows the fixed reward rules and transferable earnings without embedding the public pricing board', async () => {
    const wrapper = mount(RecommendationsView, { global: { stubs: { AppLayout: AppLayoutStub } } })
    await flushPromises()

    expect(wrapper.text()).toContain('正向毛利的 1%')
    expect(wrapper.text()).toContain('可划转 1.2000 / 累计 1.2000')
    expect(wrapper.text()).toContain('奖励调整说明：奖励类型已按稳定性调整')
    expect(wrapper.text()).not.toContain('稳定 Claude')

    const transferButton = wrapper.findAll('button').find((button) => button.text() === '划转可用分红')
    expect(transferButton?.attributes('disabled')).toBeUndefined()
    await transferButton!.trigger('click')
    await flushPromises()
    expect(transferMock).toHaveBeenCalledTimes(1)
  })

  it('submits the selected model and reward preference', async () => {
    const wrapper = mount(RecommendationsView, { global: { stubs: { AppLayout: AppLayoutStub } } })
    await flushPromises()
    const form = wrapper.get('form')
    await form.get<HTMLInputElement>('input[type="url"]').setValue('https://recommended.example/path')
    await form.get<HTMLInputElement>('input[type="number"]').setValue('0.04')
    await form.get<HTMLSelectElement>('select').setValue('claude')
    await form.findAll<HTMLSelectElement>('select')[1].setValue('one_time_credit')
    await form.trigger('submit')
    await flushPromises()

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      site_url: 'https://recommended.example/path',
      model_key: 'claude',
      multiplier: 0.04,
      reward_type: 'one_time_credit',
    }))
  })
})
