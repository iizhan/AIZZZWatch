import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import Pagination from '../Pagination.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const SelectStub = defineComponent({
  name: 'PaginationSelectStub',
  props: ['modelValue', 'options'],
  emits: ['update:modelValue'],
  template: '<div data-testid="page-size-select" />',
})

describe('Pagination page size options', () => {
  it('honors explicit pageSizeOptions instead of merging global defaults', () => {
    const wrapper = mount(Pagination, {
      props: {
        total: 120,
        page: 1,
        pageSize: 20,
        pageSizeOptions: [20, 50, 100],
      },
      global: {
        stubs: {
          Icon: true,
          Select: SelectStub,
        },
      },
    })

    expect(wrapper.findComponent(SelectStub).props('options')).toEqual([
      { value: 20, label: '20' },
      { value: 50, label: '50' },
      { value: 100, label: '100' },
    ])

    wrapper.findComponent(SelectStub).vm.$emit('update:modelValue', 100)
    expect(wrapper.emitted('update:pageSize')).toEqual([[100]])
  })
})
