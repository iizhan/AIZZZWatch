import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WatchPriceChangeBell from './WatchPriceChangeBell.vue'

const { listPriceChangesMock, listRateAnomaliesMock, routerPushMock } = vi.hoisted(() => ({
  listPriceChangesMock: vi.fn(),
  listRateAnomaliesMock: vi.fn(),
  routerPushMock: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: 'zh-CN', t: (key: string) => key }),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPushMock }),
}))

vi.mock('@/api/admin/watch', () => ({
  listPriceChanges: listPriceChangesMock,
  listRateAnomalies: listRateAnomaliesMock,
}))

const IconStub = defineComponent({ name: 'Icon', template: '<span />' })

function rateAnomaly(id: number) {
  return {
    id,
    target_group_id: 23,
    group_name: `Team ${id}`,
    kind: 'underpriced',
    status: 'open',
    current_value: 0.052,
    target_value: 0.07,
    highest_upstream_cost: 0.06,
    pricing_source: 'official_probe',
    official_probe_count: 1,
    watch_fallback_count: 0,
    evidence_mismatch_count: 0,
    detected_at: '2026-08-03T12:00:00Z',
    last_observed_at: '2026-08-03T12:00:00Z',
    created_at: '2026-08-03T12:00:00Z',
    updated_at: '2026-08-03T12:00:00Z',
  }
}

describe('WatchPriceChangeBell anomaly notifications', () => {
  beforeEach(() => {
    localStorage.clear()
    listPriceChangesMock.mockReset().mockResolvedValue([])
    listRateAnomaliesMock.mockReset()
      .mockResolvedValueOnce([rateAnomaly(1)])
      .mockResolvedValue([rateAnomaly(2), rateAnomaly(1)])
    routerPushMock.mockReset()
  })

  it('establishes an initial baseline, deduplicates new anomaly IDs, and routes to the incident', async () => {
    const wrapper = mount(WatchPriceChangeBell, {
      global: {
        stubs: { Icon: IconStub, Teleport: true, Transition: false, TransitionGroup: false },
      },
    })
    await flushPromises()

    expect(wrapper.text()).not.toContain('Team 1')
    await wrapper.get('button[aria-label="admin.watch.watchOperationsNotifications"]').trigger('click')
    expect(wrapper.text()).toContain('Team 1')
    expect(wrapper.text()).not.toMatch(/>1</)

    const refreshButton = wrapper.get('button[aria-label="common.refresh"]')
    await refreshButton.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Team 2')

    await refreshButton.trigger('click')
    await flushPromises()
    const teamTwoButtons = wrapper.findAll('button').filter((button) => button.text().includes('Team 2'))
    expect(teamTwoButtons.length).toBeGreaterThan(0)
    await teamTwoButtons[0].trigger('click')

    expect(routerPushMock).toHaveBeenCalledWith({
      path: '/admin/intelligent-ops/operations',
      query: { anomaly_id: '2' },
    })
    wrapper.unmount()
  })
})
