<template>
  <div class="relative" ref="popoverRef">
    <button
      type="button"
      class="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500/50 dark:text-dark-300 dark:hover:bg-dark-800 dark:hover:text-white"
      :title="t('admin.watch.watchPriceNotifications')"
      :aria-label="t('admin.watch.watchPriceNotifications')"
      @click="open = !open"
    >
      <Icon name="bell" size="sm" />
      <span
        v-if="unreadCount > 0"
        class="absolute -right-0.5 -top-0.5 min-w-[1rem] rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-4 text-white"
      >
        {{ unreadCount > 9 ? '9+' : unreadCount }}
      </span>
    </button>

    <transition name="dropdown">
      <div
        v-if="open"
        class="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-dark-700 dark:bg-dark-800"
      >
        <div class="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-dark-700">
          <div>
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.watchPriceNotifications') }}</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.watchPriceNotificationsHint') }}</p>
          </div>
          <button
            type="button"
            class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-dark-700 dark:hover:text-gray-200"
            :title="t('common.refresh')"
            :aria-label="t('common.refresh')"
            @click="pollChanges(true)"
          >
            <Icon name="refresh" size="sm" :class="{ 'animate-spin': loading }" />
          </button>
        </div>
        <div v-if="recentChanges.length === 0" class="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          {{ t('admin.watch.noWatchPriceNotifications') }}
        </div>
        <div v-else class="max-h-96 divide-y divide-gray-100 overflow-y-auto dark:divide-dark-700">
          <button
            v-for="change in recentChanges"
            :key="change.id"
            type="button"
            class="block w-full px-4 py-3 text-left transition hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:hover:bg-dark-700/60 dark:focus:bg-dark-700/60"
            @click="openChange(change)"
          >
            <div class="flex items-start gap-3">
              <span :class="change.change_kind === 'increase' ? increaseIconClass : decreaseIconClass">
                <Icon :name="change.change_kind === 'increase' ? 'arrowUp' : 'arrowDown'" size="xs" />
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="truncate text-sm font-medium text-gray-900 dark:text-white">{{ change.source_name }}</span>
                  <span :class="change.change_kind === 'increase' ? increaseTextClass : decreaseTextClass">
                    {{ change.change_kind === 'increase' ? t('admin.watch.increase') : t('admin.watch.decrease') }}
                  </span>
                </div>
                <div class="mt-1 truncate text-xs text-gray-500 dark:text-gray-400" :title="change.group_name || change.group_external_id">
                  {{ change.group_name || change.group_external_id }}
                </div>
                <div class="mt-1 font-mono text-xs text-gray-700 dark:text-gray-200">
                  {{ formatValue(change.previous_value) }} → {{ formatValue(change.next_value) }}
                </div>
                <time class="mt-1 block text-xs text-gray-400 dark:text-gray-500">{{ formatDate(change.observed_at) }}</time>
              </div>
            </div>
          </button>
        </div>
      </div>
    </transition>

    <Teleport to="body">
      <div class="pointer-events-none fixed right-4 top-20 z-[9998] space-y-3" aria-live="polite" aria-atomic="true">
        <transition-group
          enter-active-class="transition ease-out duration-300"
          enter-from-class="opacity-0 translate-x-full"
          enter-to-class="opacity-100 translate-x-0"
          leave-active-class="transition ease-in duration-200"
          leave-from-class="opacity-100 translate-x-0"
          leave-to-class="opacity-0 translate-x-full"
        >
          <button
            v-for="change in popupChanges"
            :key="change.id"
            type="button"
            class="pointer-events-auto block min-w-[320px] max-w-md rounded-xl border bg-white p-4 text-left shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-primary-500/50 dark:bg-dark-800"
            :class="change.change_kind === 'increase' ? 'border-red-200 dark:border-red-900/50' : 'border-emerald-200 dark:border-emerald-900/50'"
            @click="openChange(change)"
          >
            <div class="flex items-start gap-3">
              <span :class="change.change_kind === 'increase' ? increaseIconClass : decreaseIconClass">
                <Icon :name="change.change_kind === 'increase' ? 'arrowUp' : 'arrowDown'" size="sm" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold text-gray-900 dark:text-white">
                  {{ change.change_kind === 'increase' ? t('admin.watch.priceIncreaseNotification') : t('admin.watch.priceDecreaseNotification') }}
                </p>
                <p class="mt-1 truncate text-sm text-gray-600 dark:text-gray-300" :title="`${change.source_name} · ${change.group_name || change.group_external_id}`">
                  {{ change.source_name }} · {{ change.group_name || change.group_external_id }}
                </p>
                <p class="mt-1 font-mono text-sm text-gray-900 dark:text-white">
                  {{ formatValue(change.previous_value) }} → {{ formatValue(change.next_value) }}
                </p>
                <time class="mt-1 block text-xs text-gray-500 dark:text-gray-400">{{ formatDate(change.observed_at) }}</time>
              </div>
              <span class="mt-0.5 text-xs text-primary-600 dark:text-primary-300">{{ t('admin.watch.viewHistory') }}</span>
            </div>
          </button>
        </transition-group>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import Icon from '@/components/icons/Icon.vue'
import { listPriceChanges, type WatchPriceChange } from '@/api/admin/watch'

const MAX_SEEN_STORAGE_KEY = 'watch.priceChanges.maxSeenId'
const POLL_INTERVAL_MS = 30_000
const POPUP_TTL_MS = 12_000
const RECENT_LIMIT = 20

const { t, locale } = useI18n()
const router = useRouter()
const open = ref(false)
const loading = ref(false)
const recentChanges = ref<WatchPriceChange[]>([])
const popupChanges = ref<WatchPriceChange[]>([])
const unreadIds = ref(new Set<number>())
const popoverRef = ref<HTMLElement | null>(null)
let initialized = false
let pollTimer: ReturnType<typeof setInterval> | undefined
let inFlight = false
let maxSeenId = readMaxSeenId()
const notifiedIds = new Set<number>()

const unreadCount = computed(() => unreadIds.value.size)
const increaseIconClass = 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-200'
const decreaseIconClass = 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-200'
const increaseTextClass = 'shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-200'
const decreaseTextClass = 'shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'

function readMaxSeenId() {
  try {
    return Number.parseInt(localStorage.getItem(MAX_SEEN_STORAGE_KEY) || '0', 10) || 0
  } catch {
    return 0
  }
}

function writeMaxSeenId(value: number) {
  maxSeenId = Math.max(maxSeenId, value)
  try {
    localStorage.setItem(MAX_SEEN_STORAGE_KEY, String(maxSeenId))
  } catch {
    // localStorage 不可用时退化为本页内存去重。
  }
}

async function pollChanges(manual = false) {
  if (inFlight) return
  inFlight = true
  loading.value = true
  try {
    if (!initialized) {
      const baseline = await listPriceChanges({ limit: RECENT_LIMIT })
      recentChanges.value = baseline
      const latest = Math.max(maxSeenId, ...baseline.map((change) => change.id), 0)
      writeMaxSeenId(latest)
      initialized = true
      return
    }

    const changes = await listPriceChanges({ after_id: maxSeenId, limit: 50 })
    if (changes.length === 0) return
    const ordered = [...changes].sort((a, b) => a.id - b.id)
    for (const change of ordered) {
      if (change.id <= maxSeenId || notifiedIds.has(change.id)) continue
      notifiedIds.add(change.id)
      unreadIds.value = new Set([...unreadIds.value, change.id])
      showPopup(change)
    }
    recentChanges.value = [...ordered.reverse(), ...recentChanges.value]
      .filter((change, index, all) => all.findIndex((item) => item.id === change.id) === index)
      .slice(0, RECENT_LIMIT)
    writeMaxSeenId(Math.max(...ordered.map((change) => change.id), maxSeenId))
  } catch {
    if (manual) {
      // 保持 Header 轻量，不弹全局错误；用户可在价格页看到接口错误。
      console.warn('watch price change notification refresh failed')
    }
  } finally {
    loading.value = false
    inFlight = false
  }
}

function showPopup(change: WatchPriceChange) {
  popupChanges.value = [...popupChanges.value.filter((item) => item.id !== change.id), change]
  window.setTimeout(() => {
    popupChanges.value = popupChanges.value.filter((item) => item.id !== change.id)
  }, POPUP_TTL_MS)
}

function openChange(change: WatchPriceChange) {
  open.value = false
  popupChanges.value = popupChanges.value.filter((item) => item.id !== change.id)
  unreadIds.value = new Set([...unreadIds.value].filter((id) => id !== change.id))
  router.push({
    path: '/admin/intelligent-ops/pricing',
    query: {
      source_id: String(change.source_id),
      history_source_id: String(change.source_id),
      history_group_external_id: change.group_external_id,
      history_platform: change.platform || undefined,
      history_model: change.model || undefined,
      history_component: change.component || 'group_multiplier',
    },
  })
}

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '-'
}

function formatValue(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-'
  return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
}

function handleClickOutside(event: MouseEvent) {
  if (popoverRef.value && !popoverRef.value.contains(event.target as Node)) {
    open.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  pollChanges()
  pollTimer = setInterval(() => pollChanges(), POLL_INTERVAL_MS)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
  if (pollTimer) clearInterval(pollTimer)
})
</script>
