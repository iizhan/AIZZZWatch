import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WatchMappingsView from '../WatchMappingsView.vue'

const {
  getGroupsMock,
  listAccountMappingsMock,
  scanAccountMappingsMock,
  listSourcesMock,
  getSourceMock,
  confirmAccountMappingBatchMock,
  routerReplaceMock,
  routeMock,
} = vi.hoisted(() => ({
  getGroupsMock: vi.fn(),
  listAccountMappingsMock: vi.fn(),
  scanAccountMappingsMock: vi.fn(),
  listSourcesMock: vi.fn(),
  getSourceMock: vi.fn(),
  confirmAccountMappingBatchMock: vi.fn(),
  routerReplaceMock: vi.fn(),
  routeMock: {
    path: '/admin/intelligent-ops/mappings',
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
  getSource: getSourceMock,
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
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
    routeMock.query = {}
    routerReplaceMock.mockReset().mockResolvedValue(undefined)
    getGroupsMock.mockReset().mockResolvedValue([{ id: 7, name: 'Target' }])
    listSourcesMock.mockReset().mockResolvedValue([{ ...rawSource, diagnostic_state: 'waiting' }])
    getSourceMock.mockReset().mockResolvedValue({ source: rawSource, source_keys: [], groups: [], prices: [] })
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

  it('renders one accessible tab panel at a time with sticky headers and platform labels', async () => {
    const wrapper = await mountView()
    const tabs = wrapper.findAll('[role="tab"]')

    expect(tabs).toHaveLength(2)
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    expect(wrapper.findAll('thead')).toHaveLength(1)
    expect(wrapper.find('thead').classes()).toContain('sticky')
    expect(wrapper.findAllComponents(PaginationStub)).toHaveLength(1)
    expect(wrapper.findComponent(PaginationStub).props('pageSizeOptions').join(',')).toBe('20,50,100')
    expect(wrapper.find('[data-platform="grok"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Grok')

    await tabs[1].trigger('click')
    expect(tabs[1].attributes('aria-selected')).toBe('true')
    expect(wrapper.findAll('thead')).toHaveLength(1)
    expect(wrapper.find('thead').classes()).toContain('sticky')
    expect(wrapper.find('[data-platform="openai"]').exists()).toBe(true)
    expect(routerReplaceMock).toHaveBeenCalledWith({ query: { view: 'mappings' } })

    wrapper.unmount()
  })

  it('paginates scan candidates locally without losing a selection from another page', async () => {
    const wrapper = await mountView()
    const paginations = wrapper.findAll('[data-testid="pagination"]')
    expect(paginations).toHaveLength(1)

    const firstCheckbox = wrapper.findAll<HTMLInputElement>('tbody input[type="checkbox"]')[0]
    expect(firstCheckbox.element.checked).toBe(true)
    await firstCheckbox.setValue(false)

    await paginations[0].find('[data-testid="next-page"]').trigger('click')
    const scanRows = wrapper.findAll('tbody')[0].findAll('tr')
    expect(scanRows).toHaveLength(5)
    expect(scanRows[0].text()).toContain('Candidate 21')

    await wrapper.find('[data-testid="pagination"]').find('[data-testid="previous-page"]').trigger('click')
    expect(wrapper.findAll<HTMLInputElement>('tbody input[type="checkbox"]')[0].element.checked).toBe(false)

    wrapper.unmount()
  })

  it('requests a new server page and resets to page one when page size changes', async () => {
    const wrapper = await mountView()
    await wrapper.find('#watch-mappings-tab-mappings').trigger('click')
    const mappingPagination = wrapper.find('[data-testid="pagination"]')

    await mappingPagination.find('[data-testid="next-page"]').trigger('click')
    await flushPromises()
    expect(listAccountMappingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, page_size: 20 }))
    expect(wrapper.text()).toContain('Anthropic')

    await wrapper.find('[data-testid="pagination"]').find('[data-testid="page-size-50"]').trigger('click')
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
    expect(wrapper.find('#watch-mappings-panel-mappings').exists()).toBe(true)
    expect(wrapper.find('[data-account-id="1"]').classes()).toContain('ring-2')
    wrapper.unmount()
  })

  it('keeps candidate and mapping filters independent', async () => {
    const wrapper = await mountView()
    const candidatePanel = wrapper.find('#watch-mappings-panel-candidates')
    await candidatePanel.find<HTMLInputElement>('input[type="search"]').setValue('Candidate 1')
    const candidateSelects = candidatePanel.findAll<HTMLSelectElement>('select')
    await candidateSelects[0].setValue('grok')
    await candidateSelects[2].setValue('1')

    const candidateApply = candidatePanel.findAll('button').find((button) => button.text().includes('admin.watch.applyFilters'))
    await candidateApply!.trigger('click')
    await flushPromises()
    expect(scanAccountMappingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Candidate 1', platform: 'grok', source_id: 1 }))

    await wrapper.find('#watch-mappings-tab-mappings').trigger('click')
    const mappingPanel = wrapper.find('#watch-mappings-panel-mappings')
    await mappingPanel.find<HTMLInputElement>('input[type="search"]').setValue('Account 2')
    const mappingSelects = mappingPanel.findAll<HTMLSelectElement>('select')
    await mappingSelects[1].setValue('needs_confirmation')
    await mappingSelects[2].setValue('1')
    const mappingApply = mappingPanel.findAll('button').find((button) => button.text().includes('admin.watch.applyFilters'))
    await mappingApply!.trigger('click')
    await flushPromises()

    expect(listAccountMappingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Account 2', mapping_status: 'needs_confirmation', source_id: 1 }))
    await wrapper.find('#watch-mappings-tab-candidates').trigger('click')
    expect(wrapper.find<HTMLInputElement>('#watch-mappings-panel-candidates input[type="search"]').element.value).toBe('Candidate 1')
    wrapper.unmount()
  })

  it('routes an unmatched candidate to a located manual mapping without making it confirmable', async () => {
    scanAccountMappingsMock.mockResolvedValue({
      generated_at: '2026-08-01T00:00:00Z',
      candidates: [{
        ...scanCandidate(9),
        source_id: undefined,
        source_name: undefined,
        source_key_external_id: undefined,
        source_group_external_id: undefined,
        status: 'unmatched',
        reason: 'no source matches account base url',
      }],
      ready_count: 0,
      ambiguous_count: 0,
      mapped_count: 0,
    })
    listAccountMappingsMock.mockResolvedValue({
      generated_at: '2026-08-01T00:00:00Z',
      accounts: [mappingRow(9)],
      sources: [{ ...rawSource }],
      total: 1,
      page: 1,
      page_size: 20,
      pages: 1,
    })

    const wrapper = await mountView()
    expect(wrapper.find<HTMLInputElement>('tbody input[type="checkbox"]').element.disabled).toBe(true)
    const manualButton = wrapper.findAll('button').find((button) => button.text().includes('admin.watch.goToManualMapping'))
    await manualButton!.trigger('click')
    await flushPromises()

    expect(wrapper.find('#watch-mappings-panel-mappings').exists()).toBe(true)
    expect(listAccountMappingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: '9', platform: 'openai' }))
    expect(wrapper.find('[data-account-id="9"]').classes()).toContain('ring-2')
    expect(confirmAccountMappingBatchMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('routes a multiple-match candidate to manual mapping instead of presenting an unsafe confirmation', async () => {
    scanAccountMappingsMock.mockResolvedValue({
      generated_at: '2026-08-01T00:00:00Z',
      candidates: [{
        ...scanCandidate(10),
        source_group_external_id: undefined,
        source_group_name: undefined,
        status: 'multiple_match',
        reason: 'account upstream key matches multiple source key records',
      }],
      ready_count: 0,
      ambiguous_count: 1,
      mapped_count: 0,
    })
    listAccountMappingsMock.mockResolvedValue({
      generated_at: '2026-08-01T00:00:00Z',
      accounts: [mappingRow(10)],
      sources: [{ ...rawSource }],
      total: 1,
      page: 1,
      page_size: 20,
      pages: 1,
    })

    const wrapper = await mountView()
    expect(wrapper.find<HTMLInputElement>('tbody input[type="checkbox"]').element.disabled).toBe(true)
    const manualButton = wrapper.findAll('button').find((button) => button.text().includes('admin.watch.goToManualMapping'))
    expect(manualButton).toBeTruthy()
    await manualButton!.trigger('click')
    await flushPromises()

    expect(wrapper.find('#watch-mappings-panel-mappings').exists()).toBe(true)
    expect(listAccountMappingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: '10', platform: 'openai' }))
    expect(wrapper.find('[data-account-id="10"]').classes()).toContain('ring-2')
    expect(confirmAccountMappingBatchMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('clears hidden ready selections when the candidate status filter changes', async () => {
    const wrapper = await mountView()
    const candidatePanel = wrapper.find('#watch-mappings-panel-candidates')
    expect(wrapper.findAll<HTMLInputElement>('tbody input[type="checkbox"]')[0].element.checked).toBe(true)

    const statusSelect = candidatePanel.findAll<HTMLSelectElement>('select')[1]
    await statusSelect.setValue('unmatched')

    const confirmButton = candidatePanel.findAll('button').find((button) => button.text().includes('admin.watch.confirmSelectedMappings'))
    expect(confirmButton?.attributes('disabled')).toBeDefined()
    expect(confirmAccountMappingBatchMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('restores the selected tab from the view query', async () => {
    routeMock.query = { view: 'mappings', source: 'kept' }
    const wrapper = await mountView()

    expect(wrapper.find('#watch-mappings-panel-mappings').exists()).toBe(true)
    await wrapper.find('#watch-mappings-tab-candidates').trigger('click')
    expect(routerReplaceMock).toHaveBeenCalledWith({ query: { view: 'candidates', source: 'kept' } })
    wrapper.unmount()
  })

  it('delegates automatic and manual mapping filters to the paginated server API', async () => {
    listAccountMappingsMock.mockImplementation(async (params: { page?: number; page_size?: number; mapping_status?: string }) => {
      const page = params.page || 1
      const rows = [{ ...mappingRow(2), mapping_status: 'mapped', mapping: { account_id: 2, source_id: 1, source_key_external_id: 'key-2', mapping_method: 'manual', group_binding_state: 'confirmed', created_at: '', updated_at: '' } }]
      return {
        generated_at: '2026-08-01T00:00:00Z',
        accounts: rows,
        sources: [{ ...rawSource }],
        total: 1,
        page,
        page_size: params.page_size || 20,
        pages: 1,
      }
    })

    const wrapper = await mountView()
    await wrapper.find('#watch-mappings-tab-mappings').trigger('click')
    const mappingPanel = wrapper.find('#watch-mappings-panel-mappings')
    await mappingPanel.findAll<HTMLSelectElement>('select')[1].setValue('manual')
    const apply = mappingPanel.findAll('button').find((button) => button.text().includes('admin.watch.applyFilters'))
    await apply!.trigger('click')
    await flushPromises()

    expect(listAccountMappingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, page_size: 20, mapping_status: 'mapped', mapping_method: 'manual' }))
    expect(wrapper.find('[data-account-id="2"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('selects a needs-group candidate after the operator chooses a concrete group', async () => {
    scanAccountMappingsMock.mockResolvedValue({
      generated_at: '2026-08-01T00:00:00Z',
      candidates: [{
        ...scanCandidate(4),
        status: 'needs_group',
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
    const wrapper = await mountView()
    const checkbox = wrapper.find<HTMLInputElement>('tbody input[type="checkbox"]')
    expect(checkbox.element.disabled).toBe(true)

    await wrapper.find<HTMLSelectElement>('tbody select').setValue('group-b')
    expect(checkbox.element.disabled).toBe(false)
    const selectReady = wrapper.findAll('button').find((button) => button.text().includes('admin.watch.selectReadyMappings'))
    await selectReady!.trigger('click')

    expect(checkbox.element.checked).toBe(true)
    expect(wrapper.findAll('button').find((button) => button.text().includes('admin.watch.confirmSelectedMappings'))?.attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('ignores an older target-group response that arrives after the latest selection', async () => {
    const wrapper = await mountView()
    const oldResponse = deferred<any>()
    const latestResponse = deferred<any>()
    listAccountMappingsMock.mockImplementation((params: { target_group_id?: number; page_size?: number }) => {
      return params.target_group_id === 7 ? oldResponse.promise : latestResponse.promise
    })
    const targetGroup = wrapper.find<HTMLSelectElement>('select')

    await targetGroup.setValue('7')
    await targetGroup.setValue('0')
    latestResponse.resolve({
      generated_at: '2026-08-01T00:00:02Z', accounts: [mappingRow(22)], sources: [{ ...rawSource }], total: 1, page: 1, page_size: 20, pages: 1,
    })
    await flushPromises()
    oldResponse.resolve({
      generated_at: '2026-08-01T00:00:01Z', accounts: [mappingRow(11)], sources: [{ ...rawSource }], total: 1, page: 1, page_size: 20, pages: 1,
    })
    await flushPromises()

    await wrapper.find('#watch-mappings-tab-mappings').trigger('click')
    expect(wrapper.find('[data-account-id="22"]').exists()).toBe(true)
    expect(wrapper.find('[data-account-id="11"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps a partial batch failure visible after refreshing both tabs', async () => {
    confirmAccountMappingBatchMock.mockResolvedValue({
      saved: [{ account_id: 1 }],
      failed: [{ account_id: 2, reason: 'account upstream key no longer matches' }],
      updated_at: '2026-08-01T00:00:00Z',
    })
    const wrapper = await mountView()
    const confirmButton = wrapper.findAll('button').find((button) => button.text().includes('admin.watch.confirmSelectedMappings'))
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toContain('admin.watch.mappingBatchPartialFailed')
    wrapper.unmount()
  })

  it('does not show a candidate scan failure on the mapping-management tab', async () => {
    routeMock.query = { view: 'mappings' }
    scanAccountMappingsMock.mockRejectedValue(new Error('source scan failed'))
    const wrapper = await mountView()

    expect(wrapper.find('#watch-mappings-panel-mappings').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('rescans once for a terminal diagnostic after ignoring its transient checking state', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T00:00:00Z'))
    listAccountMappingsMock.mockResolvedValue({
      generated_at: '2026-08-01T00:00:00Z',
      accounts: [{
        ...mappingRow(1),
        mapping_status: 'mapped',
        mapping: { account_id: 1, source_id: 1, source_key_external_id: 'key-1', source_group_external_id: 'group-a', mapping_method: 'manual', group_binding_state: 'confirmed', created_at: '', updated_at: '' },
      }],
      sources: [{ ...rawSource }],
      total: 1,
      page: 1,
      page_size: 20,
      pages: 1,
    })
    const wrapper = await mountView()
    try {
      expect(listAccountMappingsMock).toHaveBeenCalledTimes(1)
      expect(scanAccountMappingsMock).toHaveBeenCalledTimes(1)
      expect(getSourceMock).toHaveBeenCalledTimes(1)

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
      expect(getSourceMock).toHaveBeenCalledTimes(2)

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
