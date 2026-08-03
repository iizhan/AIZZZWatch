import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WatchMappingsView from '../WatchMappingsView.vue'

const {
  getGroupsMock,
  listAccountMappingsMock,
  scanAccountMappingsMock,
  listSourcesMock,
  confirmAccountMappingBatchMock,
} = vi.hoisted(() => ({
  getGroupsMock: vi.fn(),
  listAccountMappingsMock: vi.fn(),
  scanAccountMappingsMock: vi.fn(),
  listSourcesMock: vi.fn(),
  confirmAccountMappingBatchMock: vi.fn(),
}))

vi.mock('vue-i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({
    locale: ref('zh-CN'),
    t: (key: string) => key,
  }),
}))

vi.mock('@/api/admin/groups', () => ({
  default: { getAll: getGroupsMock },
  groupsAPI: { getAll: getGroupsMock },
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ showSuccess: vi.fn() }),
}))

vi.mock('@/api/admin/watch', () => ({
  confirmAccountMappingBatch: confirmAccountMappingBatchMock,
  deleteAccountMapping: vi.fn(),
  getSource: vi.fn(),
  listAccountMappings: listAccountMappingsMock,
  listSources: listSourcesMock,
  saveAccountMapping: vi.fn(),
  scanAccountMappings: scanAccountMappingsMock,
}))

const AppLayoutStub = defineComponent({ template: '<main><slot /></main>' })
const IconStub = defineComponent({ template: '<i />' })
const PlatformIconStub = defineComponent({
  props: ['platform'],
  template: '<i data-testid="platform-icon" :data-platform="platform" />',
})
const PaginationStub = defineComponent({
  props: ['page', 'total', 'pageSize', 'pageSizeOptions'],
  emits: ['update:page', 'update:pageSize'],
  template: `
    <div data-testid="pagination" :data-page="page" :data-total="total">
      <button data-testid="previous-page" @click="$emit('update:page', Number(page) - 1)">previous</button>
      <button data-testid="next-page" @click="$emit('update:page', Number(page) + 1)">next</button>
      <button data-testid="page-size-50" @click="$emit('update:pageSize', 50)">50</button>
    </div>
  `,
})

function mappingRow(id: number, platform = 'openai') {
  return {
    account_id: id,
    account_name: `Account ${id}`,
    platform,
    schedulable: true,
    account_base_url: `https://upstream-${id}.example/v1`,
    mapping_status: 'unmapped',
    in_target_group: true,
  }
}

function scanCandidate(id: number, platform = 'openai') {
  return {
    account_id: id,
    account_name: `Candidate ${id}`,
    platform,
    source_id: 1,
    source_name: 'Upstream',
    source_key_external_id: `key-${id}`,
    source_key_label: `Key ${id}`,
    source_group_external_id: 'group-a',
    source_group_name: 'Group A',
    status: 'ready',
    in_target_group: true,
  }
}

const rawSource = {
  id: 1,
  name: 'Upstream',
  adapter_type: 'sub2api',
  base_url: 'https://upstream.example',
  api_base_url: 'https://upstream.example',
  auth_mode: 'manual',
  recharge_ratio: 1,
  enabled: true,
  polling_interval_seconds: 60,
  request_timeout_seconds: 10,
  keepalive_enabled: true,
  keepalive_interval_seconds: 60,
  has_credential: true,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
}

async function mountView() {
  const wrapper = mount(WatchMappingsView, {
    global: {
      stubs: {
        AppLayout: AppLayoutStub,
        Icon: IconStub,
        Pagination: PaginationStub,
        PlatformIcon: PlatformIconStub,
      },
    },
  })
  await flushPromises()
  return wrapper
}

describe('WatchMappingsView pagination and platform presentation', () => {
  beforeEach(() => {
    getGroupsMock.mockReset().mockResolvedValue([{ id: 7, name: 'Target' }])
    listSourcesMock.mockReset().mockResolvedValue([{ ...rawSource, diagnostic_state: 'waiting' }])
    listAccountMappingsMock.mockReset().mockImplementation(async (params: { page?: number; page_size?: number; platform?: string }) => {
      const page = params.page || 1
      const platform = params.platform || (page === 1 ? 'openai' : 'anthropic')
      return {
        generated_at: '2026-08-01T00:00:00Z',
        accounts: [mappingRow(page, platform)],
        sources: [{ ...rawSource }],
        total: 25,
        page,
        page_size: params.page_size || 20,
        pages: 2,
      }
    })
    const candidates = Array.from({ length: 25 }, (_, index) => scanCandidate(index + 1, index === 0 ? 'grok' : 'openai'))
    scanAccountMappingsMock.mockReset().mockResolvedValue({
      generated_at: '2026-08-01T00:00:00Z',
      candidates,
      ready_count: candidates.length,
      ambiguous_count: 0,
      mapped_count: 0,
    })
    confirmAccountMappingBatchMock.mockReset().mockResolvedValue({ saved: [], failed: [], updated_at: '2026-08-01T00:00:00Z' })
  })

  it('keeps both table headers sticky and presents platform as an explicit icon label', async () => {
    const wrapper = await mountView()
    const headers = wrapper.findAll('thead')
    const paginations = wrapper.findAllComponents(PaginationStub)

    expect(headers).toHaveLength(2)
    expect(headers.every((header) => header.classes().includes('sticky'))).toBe(true)
    expect(paginations).toHaveLength(2)
    expect(paginations.every((pagination) => pagination.props('pageSizeOptions').join(',') === '20,50,100')).toBe(true)
    expect(wrapper.find('[data-platform="grok"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Grok')
    expect(wrapper.find('[data-platform="openai"]').exists()).toBe(true)
    const actionButtons = wrapper.findAll('section')[0].findAll('button')
    expect(actionButtons.slice(-2).every((button) => button.classes().includes('h-10') && button.classes().includes('whitespace-nowrap'))).toBe(true)

    wrapper.unmount()
  })

  it('paginates scan candidates locally without losing a selection from another page', async () => {
    const wrapper = await mountView()
    const paginations = wrapper.findAll('[data-testid="pagination"]')
    expect(paginations).toHaveLength(2)

    const firstCheckbox = wrapper.findAll<HTMLInputElement>('tbody input[type="checkbox"]')[0]
    expect(firstCheckbox.element.checked).toBe(true)
    await firstCheckbox.setValue(false)

    await paginations[0].find('[data-testid="next-page"]').trigger('click')
    const scanRows = wrapper.findAll('tbody')[0].findAll('tr')
    expect(scanRows).toHaveLength(5)
    expect(scanRows[0].text()).toContain('Candidate 21')

    await wrapper.findAll('[data-testid="pagination"]')[0].find('[data-testid="previous-page"]').trigger('click')
    expect(wrapper.findAll<HTMLInputElement>('tbody input[type="checkbox"]')[0].element.checked).toBe(false)

    wrapper.unmount()
  })

  it('requests a new server page and resets to page one when page size changes', async () => {
    const wrapper = await mountView()
    const mappingPagination = wrapper.findAll('[data-testid="pagination"]')[1]

    await mappingPagination.find('[data-testid="next-page"]').trigger('click')
    await flushPromises()
    expect(listAccountMappingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, page_size: 20 }))
    expect(wrapper.text()).toContain('Anthropic')

    await wrapper.findAll('[data-testid="pagination"]')[1].find('[data-testid="page-size-50"]').trigger('click')
    await flushPromises()
    expect(listAccountMappingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, page_size: 50 }))

    wrapper.unmount()
  })

  it('allows a pending group-change candidate after the operator selects its current group', async () => {
    scanAccountMappingsMock.mockResolvedValue({
      generated_at: '2026-08-01T00:00:00Z',
      candidates: [{
        ...scanCandidate(1),
        status: 'needs_confirmation',
        source_group_external_id: undefined,
        source_group_name: undefined,
        groups: [
          { external_id: 'group-b', name: 'Group B', final_cost: 0.2 },
          { external_id: 'group-c', name: 'Group C', final_cost: 0.3 },
        ],
      }],
      ready_count: 0,
      ambiguous_count: 1,
      mapped_count: 0,
    })
    confirmAccountMappingBatchMock.mockResolvedValue({
      saved: [{ account_id: 1 }],
      failed: [],
      updated_at: '2026-08-01T00:00:00Z',
    })

    const wrapper = await mountView()
    const checkbox = wrapper.find<HTMLInputElement>('tbody input[type="checkbox"]')
    expect(checkbox.element.disabled).toBe(true)

    const groupSelect = wrapper.find<HTMLSelectElement>('tbody select')
    await groupSelect.setValue('group-b')
    expect(checkbox.element.disabled).toBe(false)
    await checkbox.setValue(true)

    const confirmButton = wrapper.findAll('button').find((button) => button.text().includes('admin.watch.confirmSelectedMappings'))
    expect(confirmButton).toBeTruthy()
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(confirmAccountMappingBatchMock).toHaveBeenCalledWith({
      confirmed: true,
      items: [{
        account_id: 1,
        source_id: 1,
        source_key_external_id: 'key-1',
        source_group_external_id: 'group-b',
        mapping_method: 'auto',
      }],
    })
    wrapper.unmount()
  })

  it('sends account search, mapping status, and source filters to both views', async () => {
    const wrapper = await mountView()
    await wrapper.find<HTMLInputElement>('input[type="search"]').setValue('Account 1')
    const filterSelects = wrapper.findAll<HTMLSelectElement>('section').at(0)!.findAll('select')
    await filterSelects[2].setValue('needs_confirmation')
    await filterSelects[3].setValue('1')

    const applyButton = wrapper.findAll('button').find((button) => button.text().includes('admin.watch.applyFilters'))
    await applyButton!.trigger('click')
    await flushPromises()

    const expected = expect.objectContaining({ search: 'Account 1', mapping_status: 'needs_confirmation', source_id: 1 })
    expect(listAccountMappingsMock).toHaveBeenLastCalledWith(expected)
    expect(scanAccountMappingsMock).toHaveBeenLastCalledWith(expected)
    wrapper.unmount()
  })

  it('rescans once for a terminal diagnostic after ignoring its transient checking state', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T00:00:00Z'))
    const wrapper = await mountView()
    try {
      expect(listAccountMappingsMock).toHaveBeenCalledTimes(1)
      expect(scanAccountMappingsMock).toHaveBeenCalledTimes(1)

      listSourcesMock.mockResolvedValue([{ ...rawSource, diagnostic_state: 'completed', last_check_status: 'healthy', last_check_at: '2026-08-01T00:00:00Z' }])
      await (wrapper.vm as unknown as { refreshMappingsAfterSourceDiagnostics: () => Promise<void> }).refreshMappingsAfterSourceDiagnostics()
      await flushPromises()

      vi.setSystemTime(new Date('2026-08-01T00:00:05Z'))
      listSourcesMock.mockResolvedValue([{ ...rawSource, diagnostic_state: 'checking', last_check_status: 'checking', last_check_at: '2026-08-01T00:00:05Z' }])
      await (wrapper.vm as unknown as { refreshMappingsAfterSourceDiagnostics: () => Promise<void> }).refreshMappingsAfterSourceDiagnostics()
      await flushPromises()
      expect(listAccountMappingsMock).toHaveBeenCalledTimes(1)
      expect(scanAccountMappingsMock).toHaveBeenCalledTimes(1)

      vi.setSystemTime(new Date('2026-08-01T00:00:10Z'))
      listSourcesMock.mockResolvedValue([{ ...rawSource, diagnostic_state: 'failed', last_check_status: 'error', last_check_at: '2026-08-01T00:00:05.100Z', last_error_code: 'timeout' }])
      await (wrapper.vm as unknown as { refreshMappingsAfterSourceDiagnostics: () => Promise<void> }).refreshMappingsAfterSourceDiagnostics()
      await flushPromises()
      expect(listAccountMappingsMock).toHaveBeenCalledTimes(2)
      expect(scanAccountMappingsMock).toHaveBeenCalledTimes(2)

      vi.setSystemTime(new Date('2026-08-01T00:00:20Z'))
      await (wrapper.vm as unknown as { refreshMappingsAfterSourceDiagnostics: () => Promise<void> }).refreshMappingsAfterSourceDiagnostics()
      await flushPromises()
      expect(listAccountMappingsMock).toHaveBeenCalledTimes(2)
      expect(scanAccountMappingsMock).toHaveBeenCalledTimes(2)
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
    }
  })
})
