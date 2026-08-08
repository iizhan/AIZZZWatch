import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PublicPricingView from '../PublicPricingView.vue'

const { getPublicPricingMock } = vi.hoisted(() => ({
  getPublicPricingMock: vi.fn(),
}))

vi.mock('@/api/recommendations', () => ({
  recommendationAPI: {
    getPublicPricing: getPublicPricingMock,
  },
}))

vi.mock('vue-i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({
    locale: { value: 'zh-CN' },
    t: (key: string) => ({
      'nav.beta': '试用',
      'recommendations.publicPricingPageTitle': '公示榜',
      'recommendations.publicPricingDescription': '倍率随最新监测结果动态更新。',
      'recommendations.publicPricingLoadError': '公示倍率加载失败，请稍后重试',
      'recommendations.loading': '加载中…',
      'recommendations.noPublicPricing': '暂无公示倍率',
      'recommendations.name': '名称',
      'recommendations.platform': '平台',
      'recommendations.currentMultiplier': '当前倍率',
      'recommendations.observedAt': '检测时间',
    }[key] || key),
  }),
}))

const AppLayoutStub = defineComponent({ template: '<main><slot /></main>' })

describe('PublicPricingView', () => {
  beforeEach(() => {
    getPublicPricingMock.mockReset().mockResolvedValue({
      data: [{
        id: 1,
        public_name: '稳定 Claude',
        platform: 'anthropic',
        effective_multiplier: 0.07,
        observed_at: '2026-08-07T00:00:00Z',
      }],
    })
  })

  it('shows the published multiplier and trial badge on its own page', async () => {
    const wrapper = mount(PublicPricingView, { global: { stubs: { AppLayout: AppLayoutStub } } })
    await flushPromises()

    expect(wrapper.text()).toContain('公示榜')
    expect(wrapper.text()).toContain('试用')
    expect(wrapper.text()).toContain('稳定 Claude')
    expect(wrapper.text()).toContain('0.07')
  })

  it('shows a localized page error when published rates cannot load', async () => {
    getPublicPricingMock.mockRejectedValueOnce(new Error('公示倍率加载失败，请稍后重试'))
    const wrapper = mount(PublicPricingView, { global: { stubs: { AppLayout: AppLayoutStub } } })
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('公示倍率加载失败')
  })
})
