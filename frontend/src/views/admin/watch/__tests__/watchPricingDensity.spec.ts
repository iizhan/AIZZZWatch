import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WatchPricingView from '../WatchPricingView.vue'

const { listPricingBoardMock, listSourcesMock, routerReplaceMock, routeMock } = vi.hoisted(() => ({
  listPricingBoardMock: vi.fn(),
  listSourcesMock: vi.fn(),
  routerReplaceMock: vi.fn(),
  routeMock: {
    path: '/admin/intelligent-ops/pricing',
    query: {} as Record<string, unknown>,
  },
}))

vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => ({ replace: routerReplaceMock }),
}))

vi.mock('vue-i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({
    locale: ref('zh-CN'),
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'admin.watch.noPricingRowsForFilters') return '当前筛选条件下暂无数据。'
      if (key === 'admin.watch.clearPricingFilters') return '清除筛选'
      if (key === 'admin.watch.modelPriceCount') return `${params?.count ?? 0} 项模型`
      if (key === 'admin.watch.accountCount') return `${params?.count ?? 0} 个账号`
      return key
    },
  }),
}))

vi.mock('@/api/admin/watch', () => ({
  getPricingHistory: vi.fn(),
  listPricingBoard: listPricingBoardMock,
  listSources: listSourcesMock,
}))

const AppLayoutStub = defineComponent({ template: '<main><slot /></main>' })
const IconStub = defineComponent({ template: '<i />' })
const BaseDialogStub = defineComponent({
  props: ['show'],
  template: '<div v-if="show"><slot /></div>',
})
const PaginationStub = defineComponent({
  props: ['page', 'total', 'pageSize', 'pageSizeOptions'],
  emits: ['update:page', 'update:pageSize'],
  template: `
    <div data-testid="pagination" :data-page="page" :data-total="total">
      <button data-testid="next-page" @click="$emit('update:page', Number(page) + 1)">next</button>
      <button data-testid="page-size-50" @click="$emit('update:pageSize', 50)">50</button>
    </div>
  `,
})

function pricingRow(id: number) {
  return {
    source_id: 1,
    source_name: 'Upstream',
    adapter_type: 'sub2api',
    group_external_id: `group-${id}`,
    group_name: `Group ${id}`,
    platform: 'openai',
    rate_multiplier: 0.3,
    recharge_ratio: 10,
    final_multiplier: 0.03,
    model_prices: [{
      platform: 'openai',
      model: `model-${id}`,
      input_price: 1,
      output_price: 2,
      per_request_price: null,
    }],
    in_use: id === 1,
    in_use_account_count: id === 1 ? 1 : 0,
    source_status: 'healthy',
    observed_at: '2026-08-01T00:00:00Z',
  }
}

async function mountView() {
  const wrapper = mount(WatchPricingView, {
    global: {
      stubs: {
        AppLayout: AppLayoutStub,
        BaseDialog: BaseDialogStub,
        Icon: IconStub,
        Pagination: PaginationStub,
      },
    },
  })
  await flushPromises()
  return wrapper
}

describe('WatchPricingView compact board', () => {
  beforeEach(() => {
    routeMock.query = {}
    routerReplaceMock.mockReset().mockResolvedValue(undefined)
    listSourcesMock.mockReset().mockResolvedValue([{ id: 1, name: 'Upstream' }])
    listPricingBoardMock.mockReset().mockResolvedValue({
      generated_at: '2026-08-01T00:00:00Z',
      rows: Array.from({ length: 25 }, (_, index) => pricingRow(index + 1)),
    })
  })

  it('keeps the header sticky and paginates the filtered board locally', async () => {
    const wrapper = await mountView()

    expect(wrapper.get('[data-testid="pricing-table-scroll"]').classes()).toContain('overflow-auto')
    expect(wrapper.get('thead').classes()).toContain('sticky')
    expect(wrapper.findAll('[data-testid="pricing-row"]')).toHaveLength(20)
    expect(wrapper.get('[data-testid="pagination"]').attributes('data-total')).toBe('25')
    expect(wrapper.text()).toContain('0.3 ÷ 10')

    await wrapper.get('[data-testid="next-page"]').trigger('click')
    expect(wrapper.findAll('[data-testid="pricing-row"]')).toHaveLength(5)
    expect(wrapper.findAll('[data-testid="pricing-row"]')[0].text()).toContain('Group 21')

    await wrapper.get('[data-testid="page-size-50"]').trigger('click')
    expect(wrapper.findAll('[data-testid="pricing-row"]')).toHaveLength(25)

    const modelButton = wrapper.findAll('button').find((button) => button.text().includes('1 项模型'))
    expect(modelButton).toBeTruthy()
    await modelButton!.trigger('click')
    expect(wrapper.text()).toContain('model-1')

    wrapper.unmount()
  })

  it('distinguishes an empty filtered result and clears the filters', async () => {
    routeMock.query = { in_use: 'true' }
    listPricingBoardMock.mockResolvedValue({ generated_at: '2026-08-01T00:00:00Z', rows: [] })
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('当前筛选条件下暂无数据。')
    const clearButton = wrapper.findAll('button').find((button) => button.text() === '清除筛选')
    expect(clearButton).toBeTruthy()
    await clearButton!.trigger('click')
    await flushPromises()
    expect(listPricingBoardMock).toHaveBeenLastCalledWith(expect.objectContaining({ in_use: 'all' }))

    wrapper.unmount()
  })
})
