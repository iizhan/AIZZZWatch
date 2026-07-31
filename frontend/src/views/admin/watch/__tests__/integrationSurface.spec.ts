import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import zh from '@/i18n/locales/zh'

const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')

describe('Intelligent Operations integration surface', () => {
  it('keeps legacy Watch URLs and registers guarded operational routes', () => {
    const router = read('../../../../router/index.ts')
    expect(router).toContain("path: '/admin/watch'")
    expect(router).toContain("redirect: '/admin/intelligent-ops/overview'")

    for (const path of ['/admin/intelligent-ops/overview', '/admin/intelligent-ops/sources', '/admin/intelligent-ops/pricing', '/admin/intelligent-ops/mappings', '/admin/intelligent-ops/operations', '/admin/intelligent-ops/auto-pricing', '/admin/intelligent-ops/keepalive', '/admin/intelligent-ops/integration']) {
      const routeStart = router.indexOf(`path: '${path}'`)
      const route = router.slice(routeStart, router.indexOf('\n  },', routeStart))
      expect(routeStart).toBeGreaterThan(-1)
      expect(route).toContain('requiresAuth: true')
      expect(route).toContain('requiresAdmin: true')
    }

    const pricingRouteStart = router.indexOf("path: '/admin/intelligent-ops/pricing'")
    const pricingRoute = router.slice(pricingRouteStart, router.indexOf('\n  },', pricingRouteStart))
    expect(pricingRoute).toContain('requiresAuth: true')
    expect(pricingRoute).toContain('requiresAdmin: true')

    const legacyChangesStart = router.indexOf("path: '/admin/intelligent-ops/changes'")
    const legacyChangesRoute = router.slice(legacyChangesStart, router.indexOf('\n  },', legacyChangesStart))
    expect(legacyChangesStart).toBeGreaterThan(-1)
    expect(legacyChangesRoute).toContain("redirect: '/admin/intelligent-ops/pricing'")
    expect(legacyChangesRoute).not.toContain('component:')
    expect(legacyChangesRoute).not.toContain('titleKey:')
  })

  it('groups the eight primary Watch pages under an expand-only Intelligent Operations menu', () => {
    const sidebar = read('../../../../components/layout/AppSidebar.vue')
    const groupStart = sidebar.indexOf("path: '/admin/intelligent-ops'")
    const groupEnd = sidebar.indexOf("path: '/admin/channels'", groupStart)
    const group = sidebar.slice(groupStart, groupEnd)
    const primaryChildren = [
      '/admin/intelligent-ops/overview',
      '/admin/intelligent-ops/sources',
      '/admin/intelligent-ops/pricing',
      '/admin/intelligent-ops/mappings',
      '/admin/intelligent-ops/operations',
      '/admin/intelligent-ops/auto-pricing',
      '/admin/intelligent-ops/keepalive',
      '/admin/intelligent-ops/integration'
    ]

    expect(group).toContain('expandOnly: true')
    for (const path of primaryChildren) {
      expect(group).toContain(`path: '${path}'`)
    }
    expect(group).not.toContain("path: '/admin/intelligent-ops/changes'")
    expect((group.match(/path: '\/admin\/intelligent-ops\//g) ?? []).length).toBe(primaryChildren.length)
  })

  it('renders both child pages inside the official AppLayout', () => {
    const overview = read('../WatchOverviewView.vue')
    const sources = read('../WatchSourcesView.vue')
    const pricing = read('../WatchPricingView.vue')
    const mappings = read('../WatchMappingsView.vue')
    const operations = read('../WatchOperationsView.vue')
    const autoPricing = read('../WatchAutoPricingView.vue')
    const keepalive = read('../WatchKeepaliveView.vue')
    const integration = read('../WatchIntegrationView.vue')
    const changes = read('../WatchChangesView.vue')

    for (const page of [overview, sources, pricing, mappings, operations, autoPricing, keepalive, integration, changes]) {
      expect(page).toContain('<AppLayout>')
      expect(page).toContain("import AppLayout from '@/components/layout/AppLayout.vue'")
    }
  })

  it('keeps navigation and Watch locale trees symmetric', () => {
    expect(zh.nav.intelligentOperations).toBeTruthy()
    expect(en.nav.intelligentOperations).toBeTruthy()
    expect(zh.nav.operationsOverview).toBeTruthy()
    expect(en.nav.operationsOverview).toBeTruthy()
    expect(zh.nav.upstreamSources).toBeTruthy()
    expect(en.nav.upstreamSources).toBeTruthy()
    expect(zh.nav.aggregatedPricing).toBeTruthy()
    expect(en.nav.aggregatedPricing).toBeTruthy()
    expect(zh.nav.accountMappings).toBeTruthy()
    expect(en.nav.accountMappings).toBeTruthy()
    expect(zh.nav.costProfit).toBeTruthy()
    expect(en.nav.costProfit).toBeTruthy()
    expect(zh.nav.autoPricing).toBeTruthy()
    expect(en.nav.autoPricing).toBeTruthy()
    expect(zh.nav.keepaliveCenter).toBeTruthy()
    expect(en.nav.keepaliveCenter).toBeTruthy()
    expect(zh.nav.integrationDiagnostics).toBeTruthy()
    expect(en.nav.integrationDiagnostics).toBeTruthy()
    expect(zh.nav.priceChanges).toBeTruthy()
    expect(en.nav.priceChanges).toBeTruthy()
    expect(Object.keys(zh.admin.watch)).toEqual(Object.keys(en.admin.watch))
  })
})
