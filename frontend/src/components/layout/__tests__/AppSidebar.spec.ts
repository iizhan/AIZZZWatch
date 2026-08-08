import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const componentPath = resolve(dirname(fileURLToPath(import.meta.url)), '../AppSidebar.vue')
const componentSource = readFileSync(componentPath, 'utf8')
const stylePath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../style.css')
const styleSource = readFileSync(stylePath, 'utf8')
const viewRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../views')

describe('AppSidebar custom SVG styles', () => {
  it('does not override uploaded SVG fill or stroke colors', () => {
    expect(componentSource).toContain('.sidebar-svg-icon {')
    expect(componentSource).toContain('color: currentColor;')
    expect(componentSource).toContain('display: block;')
    expect(componentSource).not.toContain('stroke: currentColor;')
    expect(componentSource).not.toContain('fill: none;')
  })
})

describe('AppSidebar scroll position persistence', () => {
  it('binds a template ref to the sidebar nav element', () => {
    expect(componentSource).toContain('ref="sidebarNavRef"')
    expect(componentSource).toContain('sidebar-nav')
  })

  it('declares sidebarNavRef in script setup', () => {
    expect(componentSource).toContain("const sidebarNavRef = ref<HTMLElement | null>(null)")
  })

  it('saves scroll position on beforeUnmount', () => {
    expect(componentSource).toContain('onBeforeUnmount')
    expect(componentSource).toContain('appStore.sidebarScrollTop')
    expect(componentSource).toContain('sidebarNavRef.value.scrollTop')
  })

  it('restores scroll position on mount', () => {
    expect(componentSource).toContain('onMounted')
    expect(componentSource).toContain('appStore.sidebarScrollTop')
    expect(componentSource).toContain('nextTick')
  })
})

describe('AppSidebar header styles', () => {
  it('does not clip the version badge dropdown', () => {
    const sidebarHeaderBlockMatch = styleSource.match(/\.sidebar-header\s*\{[\s\S]*?\n {2}\}/)
    const sidebarBrandBlockMatch = componentSource.match(/\.sidebar-brand\s*\{[\s\S]*?\n\}/)

    expect(sidebarHeaderBlockMatch).not.toBeNull()
    expect(sidebarBrandBlockMatch).not.toBeNull()
    expect(sidebarHeaderBlockMatch?.[0]).not.toContain('@apply overflow-hidden;')
    expect(sidebarBrandBlockMatch?.[0]).not.toContain('overflow: hidden;')
  })
})

describe('AppSidebar trial navigation', () => {
  it('puts the public board and bounty entries before API keys', () => {
    const navBuilderSource = componentSource.slice(
      componentSource.indexOf('function buildSelfNavItems'),
      componentSource.indexOf('function finalizeNav'),
    )
    const publicPricingIndex = navBuilderSource.indexOf("path: '/public-pricing'")
    const recommendationIndex = navBuilderSource.indexOf("path: '/recommendations'")
    const apiKeysIndex = navBuilderSource.indexOf("path: '/keys'")

    expect(publicPricingIndex).toBeGreaterThan(-1)
    expect(recommendationIndex).toBeGreaterThan(publicPricingIndex)
    expect(apiKeysIndex).toBeGreaterThan(recommendationIndex)
  })

  it('renders colored icons and localized trial badges for navigation items', () => {
    expect(componentSource).toContain(':class="item.iconClass"')
    expect(componentSource).toContain('class="sidebar-item-badge"')
    expect(componentSource).toContain("badge: t('nav.beta')")
    expect(componentSource).toContain("text-emerald-500 dark:text-emerald-400")
    expect(componentSource).toContain("text-amber-500 dark:text-amber-400")
  })

  it('keeps all trial pages inside the shared application layout', () => {
    const viewSources = [
      'user/PublicPricingView.vue',
      'user/RecommendationsView.vue',
      'admin/AdminRecommendationsView.vue',
    ].map((path) => readFileSync(resolve(viewRoot, path), 'utf8'))

    for (const source of viewSources) {
      expect(source).toContain("import AppLayout from '@/components/layout/AppLayout.vue'")
    }
  })
})
