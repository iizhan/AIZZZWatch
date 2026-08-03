<template>
  <AppLayout>
    <div class="watch-surface space-y-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.mappingsTitle') }}</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('admin.watch.mappingsDescription') }}</p>
        </div>
        <button class="btn btn-secondary" type="button" :disabled="isBusy" @click="loadAll">
          <Icon name="refresh" size="sm" :class="{ 'animate-spin': refreshing }" />
          <span>{{ t('common.refresh') }}</span>
        </button>
      </div>

      <div v-if="visibleError" class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200" role="alert">
        <span>{{ visibleError }}</span>
        <button class="font-medium underline" type="button" :disabled="isBusy" @click="retryVisibleError">{{ t('admin.watch.retry') }}</button>
      </div>

      <section class="rounded-lg border border-gray-200 bg-white p-5 dark:border-dark-700 dark:bg-dark-800">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <label class="block w-full max-w-md text-sm text-gray-700 dark:text-gray-200">
            {{ t('admin.watch.targetGroup') }}
            <select v-model.number="targetGroupId" class="input mt-1 w-full" @change="handleTargetGroupChange">
              <option :value="0">{{ t('admin.watch.allActiveAccounts') }}</option>
              <option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option>
            </select>
          </label>
          <p class="max-w-3xl text-xs leading-5 text-gray-500 dark:text-gray-400">{{ t('admin.watch.mappingsHint') }}</p>
        </div>
      </section>

      <div class="border-b border-gray-200 dark:border-dark-700">
        <div class="flex min-w-0 gap-1 overflow-x-auto" role="tablist" :aria-label="t('admin.watch.mappingViews')">
          <button
            v-for="tab in mappingTabs"
            :id="`watch-mappings-tab-${tab.value}`"
            :key="tab.value"
            class="inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            :class="activeTab === tab.value ? 'border-primary-500 text-primary-600 dark:text-primary-300' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.value"
            :aria-controls="`watch-mappings-panel-${tab.value}`"
            @click="setActiveTab(tab.value)"
          >
            <Icon :name="tab.icon" size="sm" />
            <span>{{ t(tab.label) }}</span>
            <span v-if="tab.value === 'candidates' && scanResult" class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-dark-700 dark:text-gray-300">{{ filteredScanCandidates.length }}</span>
            <span v-if="tab.value === 'mappings' && view" class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-dark-700 dark:text-gray-300">{{ view.total }}</span>
          </button>
        </div>
      </div>

      <section
        v-if="activeTab === 'candidates'"
        id="watch-mappings-panel-candidates"
        class="rounded-lg border border-blue-200 bg-blue-50/70 p-5 dark:border-blue-900/50 dark:bg-blue-900/10"
        role="tabpanel"
        aria-labelledby="watch-mappings-tab-candidates"
      >
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <label class="block text-sm text-gray-700 dark:text-gray-200">
            {{ t('admin.watch.platform') }}
            <select v-model="candidateFilters.platform" class="input mt-1 w-full">
              <option value="">{{ t('admin.watch.allPlatforms') }}</option>
              <option v-for="platform in platformOptions" :key="platform.value" :value="platform.value">{{ platform.label }}</option>
            </select>
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-200">
            {{ t('admin.watch.candidateStatusFilter') }}
            <select v-model="candidateFilters.status" class="input mt-1 w-full" @change="handleCandidateStatusChange">
              <option value="">{{ t('admin.watch.allCandidateStatuses') }}</option>
              <option value="confirmable">{{ t('admin.watch.candidateStatus_confirmable') }}</option>
              <option value="needs_group">{{ t('admin.watch.candidateStatus_needs_group') }}</option>
              <option value="multiple_match">{{ t('admin.watch.candidateStatus_multiple_match') }}</option>
              <option value="unmatched">{{ t('admin.watch.candidateStatus_unmatched') }}</option>
              <option value="mapped">{{ t('admin.watch.candidateStatus_mapped') }}</option>
            </select>
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-200">
            {{ t('admin.watch.source') }}
            <select v-model.number="candidateFilters.source_id" class="input mt-1 w-full">
              <option :value="0">{{ t('admin.watch.allSources') }}</option>
              <option v-for="source in view?.sources || []" :key="source.id" :value="source.id">{{ source.name }}</option>
            </select>
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-200">
            {{ t('admin.watch.search') }}
            <input v-model.trim="candidateFilters.search" class="input mt-1 w-full" type="search" :placeholder="t('admin.watch.mappingSearchPlaceholder')" @keyup.enter="applyCandidateFilters" />
          </label>
          <div class="flex flex-wrap items-end gap-2 sm:col-span-2 xl:col-span-4">
            <button class="btn btn-primary h-10 min-w-[104px] whitespace-nowrap" type="button" :disabled="scanLoading" @click="applyCandidateFilters">
              <Icon name="filter" size="sm" />
              <span>{{ scanLoading ? t('common.loading') : t('admin.watch.applyFilters') }}</span>
            </button>
            <button class="btn btn-secondary h-10 min-w-[104px] whitespace-nowrap" type="button" :disabled="scanLoading" @click="resetCandidateFilters">
              {{ t('admin.watch.resetFilters') }}
            </button>
            <button class="btn btn-secondary h-10 min-w-[112px] whitespace-nowrap" type="button" :disabled="scanLoading" @click="runScan()">
              <Icon name="search" size="sm" :class="{ 'animate-pulse': scanLoading }" />
              <span>{{ scanLoading ? t('common.loading') : t('admin.watch.scanMappings') }}</span>
            </button>
          </div>
        </div>

        <div v-if="scanResult" class="mt-5 border-t border-blue-200 pt-5 dark:border-blue-900/50">

        <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.scanResultTitle') }}</h2>
            <p class="mt-1 text-xs text-gray-600 dark:text-gray-300">
              {{ t('admin.watch.scanResultHint', { ready: scanResult.ready_count, ambiguous: scanResult.ambiguous_count, mapped: scanResult.mapped_count }) }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="btn btn-secondary btn-sm" type="button" @click="selectReadyCandidates">{{ t('admin.watch.selectReadyMappings') }}</button>
            <button class="btn btn-primary btn-sm" type="button" :disabled="confirmingScan || selectedConfirmItems.length === 0" @click="confirmSelectedMappings">
              {{ confirmingScan ? t('common.saving') : t('admin.watch.confirmSelectedMappings', { count: selectedConfirmItems.length }) }}
            </button>
          </div>
        </div>

        <div v-if="filteredScanCandidates.length === 0" class="py-8 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('admin.watch.noScanCandidatesForFilters') }}</div>
        <div v-else class="overflow-hidden rounded-lg border border-blue-100 bg-white dark:border-blue-900/40 dark:bg-dark-800">
          <div class="max-h-[560px] overflow-auto">
            <table class="w-full min-w-[1680px] table-fixed text-left text-sm">
            <thead class="sticky top-0 z-10 bg-blue-50 text-xs text-blue-900 shadow-[0_1px_0_rgba(191,219,254,1)] dark:bg-blue-950 dark:text-blue-100 dark:shadow-[0_1px_0_rgba(30,58,138,0.8)]">
              <tr>
                <th class="w-[72px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.select') }}</th>
                <th class="w-[280px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.account') }}</th>
                <th class="w-[140px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.platform') }}</th>
                <th class="w-[200px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.source') }}</th>
                <th class="w-[220px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.sourceKey') }}</th>
                <th class="w-[280px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.sourceGroup') }}</th>
                <th class="w-[150px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.mappingStatus') }}</th>
                <th class="w-[330px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.reason') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-blue-50 dark:divide-dark-700">
              <tr v-for="candidate in visibleScanCandidates" :key="candidate.account_id" class="align-top">
                <td class="px-4 py-3">
                  <input
                    v-model="scanSelections[candidate.account_id]"
                    class="h-4 w-4 rounded border-gray-300 text-primary-600"
                    type="checkbox"
                    :disabled="!canSelectCandidate(candidate)"
                  />
                </td>
                <td class="px-4 py-3">
                  <div class="truncate font-medium text-gray-900 dark:text-white" :title="candidate.account_name">{{ candidate.account_name }}</div>
                  <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">#{{ candidate.account_id }}</div>
                  <div v-if="candidate.account_base_url" class="mt-1 max-w-[240px] truncate font-mono text-xs text-gray-400" :title="candidate.account_base_url">{{ candidate.account_base_url }}</div>
                  <p v-if="candidate.target_group_id && !candidate.in_target_group" class="mt-2 max-w-xs text-xs text-amber-600 dark:text-amber-300">
                    {{ watchReasonText(t, candidate.participation_reason) }}
                  </p>
                </td>
                <td class="px-4 py-3">
                  <span class="inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:bg-dark-700 dark:text-gray-200">
                    <PlatformIcon :platform="platformValue(candidate.platform)" size="xs" />
                    {{ platformLabel(candidate.platform) }}
                  </span>
                </td>
                <td class="px-4 py-3 text-gray-700 dark:text-gray-200">{{ candidate.source_name || '-' }}</td>
                <td class="px-4 py-3">
                  <div class="font-medium text-gray-900 dark:text-white">{{ candidate.source_key_label || '-' }}</div>
                  <div v-if="candidate.source_key_external_id" class="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400">{{ candidate.source_key_external_id }}</div>
                </td>
                <td class="px-4 py-3">
                  <select v-if="candidateNeedsGroupSelection(candidate)" v-model="scanGroupDrafts[candidate.account_id]" class="input w-full">
                    <option value="">{{ t('admin.watch.selectSourceGroup') }}</option>
                    <option v-for="group in candidate.groups || []" :key="group.external_id" :value="group.external_id">
                      {{ group.name }} · {{ formatNumber(group.final_cost) }}
                    </option>
                  </select>
                  <div v-else>
                    <div class="font-medium text-gray-900 dark:text-white">{{ candidate.source_group_name || '-' }}</div>
                    <div v-if="candidate.source_group_external_id" class="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400">{{ candidate.source_group_external_id }}</div>
                  </div>
                </td>
                <td class="px-4 py-3"><span :class="scanStatusClass(candidate.status)">{{ scanStatusText(candidate.status) }}</span></td>
                <td class="break-words px-4 py-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  <div>{{ watchReasonText(t, candidate.reason) }}</div>
                  <div v-if="candidate.target_group_id && !candidate.in_target_group" class="mt-1 text-amber-600 dark:text-amber-300">{{ t('admin.watch.targetGroupNonParticipant') }}</div>
                  <button v-if="candidateRequiresManualMapping(candidate)" class="mt-2 inline-flex items-center gap-1 font-medium text-primary-600 hover:text-primary-700 dark:text-primary-300" type="button" @click="goToManualMapping(candidate)">
                    <Icon name="arrowRight" size="xs" />
                    <span>{{ t('admin.watch.goToManualMapping') }}</span>
                  </button>
                </td>
              </tr>
            </tbody>
            </table>
          </div>
          <Pagination
            v-if="filteredScanCandidates.length > 0"
            :page="scanPagination.page"
            :total="filteredScanCandidates.length"
            :page-size="scanPagination.page_size"
            :page-size-options="mappingPageSizeOptions"
            @update:page="handleScanPageChange"
            @update:pageSize="handleScanPageSizeChange"
          />
        </div>
        </div>
        <div v-else class="py-12 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('admin.watch.scanCandidatesPrompt') }}</div>
      </section>

      <section
        v-if="activeTab === 'mappings'"
        id="watch-mappings-panel-mappings"
        class="rounded-lg border border-gray-200 bg-white p-5 dark:border-dark-700 dark:bg-dark-800"
        role="tabpanel"
        aria-labelledby="watch-mappings-tab-mappings"
      >
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.accountMappings') }}</h2>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.accountMappingsHint') }}</p>
          </div>
          <span v-if="view" class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.observedAt') }}: {{ formatDate(view.generated_at) }}</span>
        </div>

        <div class="mb-5 grid gap-4 border-y border-gray-100 py-4 sm:grid-cols-2 xl:grid-cols-4 dark:border-dark-700">
          <label class="block text-sm text-gray-700 dark:text-gray-200">
            {{ t('admin.watch.platform') }}
            <select v-model="mappingFilters.platform" class="input mt-1 w-full">
              <option value="">{{ t('admin.watch.allPlatforms') }}</option>
              <option v-for="platform in platformOptions" :key="platform.value" :value="platform.value">{{ platform.label }}</option>
            </select>
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-200">
            {{ t('admin.watch.mappingStatusFilter') }}
            <select v-model="mappingFilters.status" class="input mt-1 w-full">
              <option value="">{{ t('admin.watch.allMappingStatuses') }}</option>
              <option value="auto">{{ t('admin.watch.mappingFilterStatus_auto') }}</option>
              <option value="manual">{{ t('admin.watch.mappingFilterStatus_manual') }}</option>
              <option value="needs_confirmation">{{ t('admin.watch.mappingStatus_pending') }}</option>
              <option value="unmapped">{{ t('admin.watch.mappingStatus_unmapped') }}</option>
            </select>
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-200">
            {{ t('admin.watch.source') }}
            <select v-model.number="mappingFilters.source_id" class="input mt-1 w-full">
              <option :value="0">{{ t('admin.watch.allSources') }}</option>
              <option v-for="source in view?.sources || []" :key="source.id" :value="source.id">{{ source.name }}</option>
            </select>
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-200">
            {{ t('admin.watch.search') }}
            <input v-model.trim="mappingFilters.search" class="input mt-1 w-full" type="search" :placeholder="t('admin.watch.mappingSearchPlaceholder')" @keyup.enter="applyMappingFilters" />
          </label>
          <div class="flex flex-wrap items-end gap-2 sm:col-span-2 xl:col-span-4">
            <button class="btn btn-primary h-10 min-w-[104px] whitespace-nowrap" type="button" :disabled="loading" @click="applyMappingFilters">
              <Icon name="filter" size="sm" />
              <span>{{ loading ? t('common.loading') : t('admin.watch.applyFilters') }}</span>
            </button>
            <button class="btn btn-secondary h-10 min-w-[104px] whitespace-nowrap" type="button" :disabled="loading" @click="resetMappingFilters">
              {{ t('admin.watch.resetFilters') }}
            </button>
          </div>
        </div>

        <div v-if="highlightedMappingAccountId" class="mb-4 flex items-center justify-between gap-3 rounded-md border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700 dark:border-primary-900/50 dark:bg-primary-900/20 dark:text-primary-200" role="status">
          <span>{{ t('admin.watch.mappingAccountLocated', { id: highlightedMappingAccountId }) }}</span>
          <button class="font-medium underline" type="button" @click="clearMappingHighlight">{{ t('common.close') }}</button>
        </div>

        <div v-if="loading && !view" class="py-16 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('common.loading') }}</div>
        <div v-else-if="!view || view.accounts.length === 0" class="border-y border-gray-200 py-16 text-center text-sm text-gray-500 dark:border-dark-700 dark:text-gray-400">
          {{ t('admin.watch.noMappingAccounts') }}
        </div>
        <div v-else class="overflow-hidden border-y border-gray-200 dark:border-dark-700">
          <div class="max-h-[560px] overflow-auto">
            <table class="w-full min-w-[1560px] table-fixed text-left text-sm">
            <thead class="sticky top-0 z-10 bg-gray-50 text-xs text-gray-500 shadow-[0_1px_0_rgba(229,231,235,1)] dark:bg-dark-800 dark:text-gray-300 dark:shadow-[0_1px_0_rgba(55,65,81,1)]">
              <tr>
                <th class="w-[280px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.account') }}</th>
                <th class="w-[140px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.platform') }}</th>
                <th class="w-[230px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.source') }}</th>
                <th class="w-[240px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.sourceKey') }}</th>
                <th class="w-[240px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.sourceGroup') }}</th>
                <th class="w-[270px] whitespace-nowrap px-4 py-3 font-medium">{{ t('admin.watch.mappingStatus') }}</th>
                <th class="w-[160px] whitespace-nowrap px-4 py-3 text-right font-medium">{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-dark-700">
              <tr
                v-for="row in view.accounts"
                :key="row.account_id"
                :data-account-id="row.account_id"
                class="bg-white align-top transition-colors dark:bg-dark-800"
                :class="row.account_id === highlightedMappingAccountId ? 'bg-primary-50 ring-2 ring-inset ring-primary-400 dark:bg-primary-900/20' : ''"
              >
                <td class="px-4 py-3">
                  <div class="truncate font-medium text-gray-900 dark:text-white" :title="row.account_name">{{ row.account_name }}</div>
                  <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">#{{ row.account_id }}</div>
                  <div v-if="row.account_base_url" class="mt-1 max-w-[220px] truncate font-mono text-xs text-gray-400" :title="row.account_base_url">{{ row.account_base_url }}</div>
                  <p v-if="row.target_group_id && !row.in_target_group" class="mt-2 max-w-xs text-xs text-amber-600 dark:text-amber-300">
                    {{ watchReasonText(t, row.participation_reason) }}
                  </p>
                </td>
                <td class="px-4 py-3">
                  <span class="inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:bg-dark-700 dark:text-gray-200">
                    <PlatformIcon :platform="platformValue(row.platform)" size="xs" />
                    {{ platformLabel(row.platform) }}
                  </span>
                </td>
                <td class="px-4 py-3">
                  <select v-model.number="draftFor(row).source_id" class="input w-full" @change="onSourceChange(row)">
                    <option :value="0">{{ t('admin.watch.selectSource') }}</option>
                    <option v-for="source in view.sources" :key="source.id" :value="source.id">{{ source.name }}</option>
                  </select>
                </td>
                <td class="px-4 py-3">
                  <select v-model="draftFor(row).source_key_external_id" class="input w-full" :disabled="!draftFor(row).source_id || loadingSnapshotIds.has(draftFor(row).source_id)" @change="onKeyChange(row)">
                    <option value="">{{ loadingSnapshotIds.has(draftFor(row).source_id) ? t('common.loading') : t('admin.watch.selectSourceKey') }}</option>
                    <option v-for="key in keysFor(row)" :key="key.external_id" :value="key.external_id">{{ key.label }} · {{ key.external_id }}</option>
                  </select>
                  <p v-if="selectedKey(row)?.summary" class="mt-1 max-w-xs text-xs text-gray-500 dark:text-gray-400">{{ selectedKey(row)?.summary }}</p>
                </td>
                <td class="px-4 py-3">
                  <select v-model="draftFor(row).source_group_external_id" class="input w-full" :disabled="!draftFor(row).source_key_external_id">
                    <option value="">{{ t('admin.watch.autoOrSingleGroup') }}</option>
                    <option v-for="group in groupsFor(row)" :key="group.external_id" :value="group.external_id">{{ group.name }} · {{ formatNumber(effectiveGroupCost(row, group.external_id)) }}</option>
                  </select>
                </td>
                <td class="px-4 py-3">
                  <span :class="mappingStatusClass(row.mapping_status)">{{ mappingStatusText(row) }}</span>
                  <p v-if="row.reason" class="mt-1 max-w-xs text-xs text-amber-600 dark:text-amber-300">{{ watchReasonText(t, row.reason) }}</p>
                  <p v-if="row.target_group_id && !row.in_target_group" class="mt-1 max-w-xs text-xs text-amber-600 dark:text-amber-300">{{ t('admin.watch.targetGroupNonParticipant') }}</p>
                  <p v-if="mappingSaveBlockReason(row)" class="mt-1 max-w-xs text-xs text-amber-600 dark:text-amber-300">{{ mappingSaveBlockReason(row) }}</p>
                </td>
                <td class="px-4 py-3">
                  <div class="flex justify-end gap-2">
                    <button class="btn btn-primary btn-sm" type="button" :disabled="!canSave(row) || savingAccountId === row.account_id" @click="saveRow(row)">
                      {{ savingAccountId === row.account_id ? t('common.saving') : t('common.save') }}
                    </button>
                    <button v-if="row.mapping" class="btn btn-secondary btn-sm" type="button" :disabled="savingAccountId === row.account_id" @click="clearRow(row)">
                      {{ t('admin.watch.unbind') }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
            </table>
          </div>
          <Pagination
            v-if="view.total > 0"
            :page="view.page"
            :total="view.total"
            :page-size="view.page_size"
            :page-size-options="mappingPageSizeOptions"
            @update:page="handleMappingPageChange"
            @update:pageSize="handleMappingPageSizeChange"
          />
        </div>
      </section>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import AppLayout from '@/components/layout/AppLayout.vue'
import Icon from '@/components/icons/Icon.vue'
import Pagination from '@/components/common/Pagination.vue'
import PlatformIcon from '@/components/common/PlatformIcon.vue'
import { groupsAPI } from '@/api/admin/groups'
import { useAppStore } from '@/stores/app'
import { GROUP_PLATFORMS, type GroupPlatform } from '@/types'
import {
  confirmAccountMappingBatch,
  deleteAccountMapping,
  getSource,
  listAccountMappings,
  listSources,
  saveAccountMapping,
  scanAccountMappings,
  type WatchAccountMappingCandidate,
  type WatchAccountMappingFilters,
  type WatchAccountMappingRow,
  type WatchAccountMappingsView,
  type WatchAccountMappingScanResult,
  type WatchSourceGroupObservation,
  type WatchSourceKeyObservation,
  type WatchSourceSnapshot,
  type WatchSource,
} from '@/api/admin/watch'
import { watchReasonText } from './watchText'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
type MappingTab = 'candidates' | 'mappings'
type CandidateStatusFilter = '' | 'confirmable' | 'needs_group' | 'multiple_match' | 'unmatched' | 'mapped'
type MappingStatusFilter = '' | 'auto' | 'manual' | 'needs_confirmation' | 'unmapped'

function normalizeMappingTab(value: unknown): MappingTab {
  return value === 'mappings' ? 'mappings' : 'candidates'
}

const loading = ref(false)
const refreshing = ref(false)
const pageError = ref('')
const candidateError = ref('')
const mappingError = ref('')
const operationError = ref('')
const groups = ref<Array<{ id: number; name: string }>>([])
const view = ref<WatchAccountMappingsView | null>(null)
const sourceSnapshots = ref<Record<number, WatchSourceSnapshot>>({})
const loadingSnapshotIds = ref(new Set<number>())
const savingAccountId = ref<number | null>(null)
const scanLoading = ref(false)
const confirmingScan = ref(false)
const scanResult = ref<WatchAccountMappingScanResult | null>(null)
const activeTab = ref<MappingTab>(normalizeMappingTab(route.query.view))
const targetGroupId = ref(0)
const highlightedMappingAccountId = ref<number | null>(null)
const drafts = reactive<Record<number, { source_id: number; source_key_external_id: string; source_group_external_id: string }>>({})
const scanSelections = reactive<Record<number, boolean>>({})
const scanGroupDrafts = reactive<Record<number, string>>({})
const candidateFilters = reactive<{ platform: string; search: string; status: CandidateStatusFilter; source_id: number }>({
  platform: '',
  search: '',
  status: '',
  source_id: 0,
})
const mappingFilters = reactive<{ platform: string; search: string; status: MappingStatusFilter; source_id: number }>({
  platform: '',
  search: '',
  status: '',
  source_id: 0,
})
const mappingPagination = reactive({ page: 1, page_size: 20 })
const scanPagination = reactive({ page: 1, page_size: 20 })
const mappingPageSizeOptions = [20, 50, 100]
let sourceRefreshTimer: ReturnType<typeof setInterval> | undefined
let sourceRefreshInFlight = false
let terminalSourceBaselineReady = false
let pendingTerminalSourceRefresh = false
let lastMappingRefreshAt = Date.now()
const lastTerminalSourceMarkers = new Map<number, string>()
const sourceRefreshCoalesceMs = 10_000
const pendingSourceSnapshotRefreshIds = new Set<number>()
const sourceSnapshotVersions = new Map<number, number>()
const sourceSnapshotLoadCounts = new Map<number, number>()
let mappingRequestVersion = 0
let scanRequestVersion = 0
let targetGroupChangeVersion = 0

const platformNames: Record<GroupPlatform, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  grok: 'Grok',
  composite: 'Composite',
}
const platformOptions = GROUP_PLATFORMS.map((value) => ({ value, label: platformNames[value] }))
const mappingTabs: ReadonlyArray<{ value: MappingTab; label: string; icon: 'search' | 'link' }> = [
  { value: 'candidates', label: 'admin.watch.mappingTabCandidates', icon: 'search' },
  { value: 'mappings', label: 'admin.watch.mappingTabManagement', icon: 'link' },
]
const isBusy = computed(() => refreshing.value || loading.value || scanLoading.value || confirmingScan.value)
const visibleError = computed(() => operationError.value || pageError.value || (activeTab.value === 'candidates' ? candidateError.value : mappingError.value))
const filteredScanCandidates = computed(() => {
  const candidates = scanResult.value?.candidates || []
  if (!candidateFilters.status) return candidates
  return candidates.filter((candidate) => candidateMatchesStatus(candidate, candidateFilters.status))
})
const visibleScanCandidates = computed(() => {
  const start = (scanPagination.page - 1) * scanPagination.page_size
  return filteredScanCandidates.value.slice(start, start + scanPagination.page_size)
})

function activeMappingFilters(): WatchAccountMappingFilters {
  const serverStatus = mappingFilters.status === 'auto' || mappingFilters.status === 'manual'
    ? 'mapped'
    : mappingFilters.status || undefined
  return {
    target_group_id: targetGroupId.value || undefined,
    platform: mappingFilters.platform || undefined,
    search: mappingFilters.search || undefined,
    mapping_status: serverStatus,
    mapping_method: mappingFilters.status === 'auto' || mappingFilters.status === 'manual' ? mappingFilters.status : undefined,
    source_id: mappingFilters.source_id || undefined,
  }
}

function activeCandidateFilters(): WatchAccountMappingFilters {
  return {
    target_group_id: targetGroupId.value || undefined,
    platform: candidateFilters.platform || undefined,
    search: candidateFilters.search || undefined,
    source_id: candidateFilters.source_id || undefined,
  }
}

const selectedConfirmItems = computed(() => {
  const result = scanResult.value
  if (!result) return []
  return result.candidates
    .filter((candidate) => scanSelections[candidate.account_id] && canSelectCandidate(candidate))
    .map((candidate) => ({
      account_id: candidate.account_id,
      source_id: candidate.source_id || 0,
      source_key_external_id: candidate.source_key_external_id || '',
      source_group_external_id: candidate.source_group_external_id || scanGroupDrafts[candidate.account_id] || undefined,
      mapping_method: 'auto' as const,
    }))
    .filter((item) => item.source_id > 0 && item.source_key_external_id && item.source_group_external_id)
})

function errorMessage(err: any, fallback: string) {
  const message = err?.message || err?.response?.data?.message
  return message ? watchReasonText(t, message, message) : fallback
}

function draftFor(row: WatchAccountMappingRow) {
  if (!drafts[row.account_id]) {
    drafts[row.account_id] = {
      source_id: row.mapping?.source_id || row.auto_matched_source_id || 0,
      source_key_external_id: row.mapping?.source_key_external_id || '',
      source_group_external_id: row.mapping?.source_group_external_id || '',
    }
  }
  return drafts[row.account_id]
}

function hydrateDrafts() {
  if (!view.value) return
  for (const row of view.value.accounts) {
    drafts[row.account_id] = {
      source_id: row.mapping?.source_id || row.auto_matched_source_id || 0,
      source_key_external_id: row.mapping?.source_key_external_id || '',
      source_group_external_id: row.mapping?.source_group_external_id || '',
    }
  }
}

async function loadAll() {
  if (refreshing.value) return
  refreshing.value = true
  pageError.value = ''
  operationError.value = ''
  try {
    const nextGroups = await groupsAPI.getAll()
    groups.value = nextGroups.map((group) => ({ id: group.id, name: group.name }))
    await Promise.all([loadMappings(), runScan({ activateTab: false })])
  } catch (err) {
    pageError.value = errorMessage(err, t('admin.watch.mappingsLoadFailed'))
  } finally {
    refreshing.value = false
  }
}

async function loadMappings(): Promise<boolean> {
  const requestVersion = ++mappingRequestVersion
  loading.value = true
  mappingError.value = ''
  try {
    let nextView = await listAccountMappings({
      ...activeMappingFilters(),
      page: mappingPagination.page,
      page_size: mappingPagination.page_size,
    })
    if (requestVersion !== mappingRequestVersion) return false
    if (nextView.accounts.length === 0 && nextView.total > 0 && mappingPagination.page > 1) {
      mappingPagination.page = Math.max(nextView.pages, 1)
      nextView = await listAccountMappings({
        ...activeMappingFilters(),
        page: mappingPagination.page,
        page_size: mappingPagination.page_size,
      })
      if (requestVersion !== mappingRequestVersion) return false
    }
    view.value = nextView
    mappingPagination.page = view.value.page
    mappingPagination.page_size = view.value.page_size
    hydrateDrafts()
    await preloadMappedSources()
    return true
  } catch (err) {
    if (requestVersion === mappingRequestVersion) {
      mappingError.value = errorMessage(err, t('admin.watch.mappingsLoadFailed'))
    }
    return false
  } finally {
    if (requestVersion === mappingRequestVersion) {
      loading.value = false
    }
  }
}

async function applyMappingFilters() {
  mappingPagination.page = 1
  highlightedMappingAccountId.value = null
  await loadMappings()
}

async function resetMappingFilters() {
  Object.assign(mappingFilters, { platform: '', search: '', status: '', source_id: 0 })
  await applyMappingFilters()
}

async function applyCandidateFilters() {
  scanPagination.page = 1
  await runScan()
}

async function resetCandidateFilters() {
  Object.assign(candidateFilters, { platform: '', search: '', status: '', source_id: 0 })
  await applyCandidateFilters()
}

async function handleTargetGroupChange() {
  const changeVersion = ++targetGroupChangeVersion
  mappingPagination.page = 1
  scanPagination.page = 1
  highlightedMappingAccountId.value = null
  await loadMappings()
  if (changeVersion !== targetGroupChangeVersion) return
  await runScan({ activateTab: false })
}

async function handleMappingPageChange(page: number) {
  mappingPagination.page = page
  await loadMappings()
}

async function handleMappingPageSizeChange(pageSize: number) {
  mappingPagination.page_size = pageSize
  mappingPagination.page = 1
  await loadMappings()
}

function handleScanPageChange(page: number) {
  scanPagination.page = page
}

function handleScanPageSizeChange(pageSize: number) {
  scanPagination.page_size = pageSize
  scanPagination.page = 1
}

function resetScanPagination() {
  scanPagination.page = 1
}

function handleCandidateStatusChange() {
  resetScanPagination()
  selectReadyCandidates()
}

async function preloadMappedSources() {
  if (!view.value) return
  const sourceIds = [...new Set(view.value.accounts.map((row) => draftFor(row).source_id).filter((id) => id > 0))]
  await Promise.all(sourceIds.map((id) => ensureSnapshot(id).catch(() => undefined)))
}

async function ensureSnapshot(sourceId: number) {
  if (!sourceId || sourceSnapshots.value[sourceId]) return
  const snapshotVersion = sourceSnapshotVersions.get(sourceId) || 0
  sourceSnapshotLoadCounts.set(sourceId, (sourceSnapshotLoadCounts.get(sourceId) || 0) + 1)
  loadingSnapshotIds.value = new Set([...loadingSnapshotIds.value, sourceId])
  try {
    const snapshot = await getSource(sourceId)
    if ((sourceSnapshotVersions.get(sourceId) || 0) === snapshotVersion) {
      sourceSnapshots.value = { ...sourceSnapshots.value, [sourceId]: snapshot }
    }
  } finally {
    const remaining = Math.max((sourceSnapshotLoadCounts.get(sourceId) || 1) - 1, 0)
    if (remaining > 0) {
      sourceSnapshotLoadCounts.set(sourceId, remaining)
    } else {
      sourceSnapshotLoadCounts.delete(sourceId)
      const next = new Set(loadingSnapshotIds.value)
      next.delete(sourceId)
      loadingSnapshotIds.value = next
    }
  }
}

function invalidateSourceSnapshots(sourceIds: Iterable<number>) {
  const nextSnapshots = { ...sourceSnapshots.value }
  for (const sourceId of sourceIds) {
    delete nextSnapshots[sourceId]
    sourceSnapshotVersions.set(sourceId, (sourceSnapshotVersions.get(sourceId) || 0) + 1)
  }
  sourceSnapshots.value = nextSnapshots
}

async function onSourceChange(row: WatchAccountMappingRow) {
  const draft = draftFor(row)
  draft.source_key_external_id = ''
  draft.source_group_external_id = ''
  await ensureSnapshot(draft.source_id)
}

function onKeyChange(row: WatchAccountMappingRow) {
  draftFor(row).source_group_external_id = ''
}

function keysFor(row: WatchAccountMappingRow): WatchSourceKeyObservation[] {
  const snapshot = sourceSnapshots.value[draftFor(row).source_id]
  return snapshot?.source_keys || []
}

function selectedKey(row: WatchAccountMappingRow): WatchSourceKeyObservation | undefined {
  const draft = draftFor(row)
  return keysFor(row).find((key) => key.external_id === draft.source_key_external_id)
}

function groupsFor(row: WatchAccountMappingRow): WatchSourceGroupObservation[] {
  const draft = draftFor(row)
  const snapshot = sourceSnapshots.value[draft.source_id]
  if (!snapshot) return []
  const key = selectedKey(row)
  if (!key || key.group_external_ids.length === 0) return snapshot.groups
  const allowed = new Set(key.group_external_ids)
  return snapshot.groups.filter((group) => allowed.has(group.external_id))
}

function selectedKeyRequiresGroup(row: WatchAccountMappingRow) {
  const key = selectedKey(row)
  if (!key) return false
  return key.group_external_ids.length > 1 || (key.group_external_ids.length === 0 && groupsFor(row).length > 1)
}

function effectiveGroupCost(row: WatchAccountMappingRow, groupExternalId: string) {
  const snapshot = sourceSnapshots.value[draftFor(row).source_id]
  const group = snapshot?.groups.find((item) => item.external_id === groupExternalId)
  if (!snapshot || !group || snapshot.source.recharge_ratio <= 0) return undefined
  return (group.user_rate_multiplier ?? group.rate_multiplier) / snapshot.source.recharge_ratio
}

function mappingSaveBlockReason(row: WatchAccountMappingRow) {
  const draft = draftFor(row)
  if (!draft.source_id || !draft.source_key_external_id) return ''
  if (selectedKeyRequiresGroup(row) && !draft.source_group_external_id) {
    return t('admin.watch.selectSourceGroupRequired')
  }
  return ''
}

function canSave(row: WatchAccountMappingRow) {
  const draft = draftFor(row)
  return Boolean(draft.source_id && draft.source_key_external_id && !mappingSaveBlockReason(row))
}

async function runScan(options: { activateTab?: boolean } = {}) {
  const requestVersion = ++scanRequestVersion
  scanLoading.value = true
  candidateError.value = ''
  try {
    const nextResult = await scanAccountMappings(activeCandidateFilters())
    if (requestVersion !== scanRequestVersion) return
    scanResult.value = nextResult
    scanPagination.page = 1
    for (const candidate of scanResult.value.candidates) {
      scanSelections[candidate.account_id] = false
      scanGroupDrafts[candidate.account_id] = candidate.source_group_external_id || ''
    }
    selectReadyCandidates()
    if (options.activateTab !== false) {
      await setActiveTab('candidates')
    }
  } catch (err) {
    if (requestVersion === scanRequestVersion) {
      candidateError.value = errorMessage(err, t('admin.watch.mappingScanFailed'))
    }
  } finally {
    if (requestVersion === scanRequestVersion) {
      scanLoading.value = false
    }
  }
}

function canSelectCandidate(candidate: WatchAccountMappingCandidate) {
  if (candidate.target_group_id && !candidate.in_target_group) return false
  if (!candidate.source_id || !candidate.source_key_external_id) return false
  if (candidate.status === 'ready') return Boolean(candidate.source_group_external_id)
  if (candidate.status === 'needs_group' || candidate.status === 'needs_confirmation') return Boolean(candidate.source_group_external_id || scanGroupDrafts[candidate.account_id])
  return false
}

function candidateNeedsGroupSelection(candidate: WatchAccountMappingCandidate) {
  if (candidate.status !== 'needs_group' && candidate.status !== 'needs_confirmation') return false
  return (candidate.groups?.length || 0) > 1 || (!candidate.source_group_external_id && (candidate.groups?.length || 0) > 0)
}

function candidateRequiresManualMapping(candidate: WatchAccountMappingCandidate) {
  return candidate.status === 'unmatched' || candidate.status === 'multiple_match'
}

function candidateMatchesStatus(candidate: WatchAccountMappingCandidate, status: CandidateStatusFilter) {
  if (!status) return true
  if (status === 'confirmable') return canSelectCandidate(candidate)
  if (status === 'needs_group') return candidate.status === 'needs_group' || candidate.status === 'needs_confirmation'
  return candidate.status === status
}

function selectReadyCandidates() {
  for (const candidate of scanResult.value?.candidates || []) {
    scanSelections[candidate.account_id] = false
  }
  for (const candidate of filteredScanCandidates.value) {
    scanSelections[candidate.account_id] = (candidate.status === 'ready' || candidate.status === 'needs_group' || candidate.status === 'needs_confirmation') && canSelectCandidate(candidate)
  }
}

async function confirmSelectedMappings() {
  if (selectedConfirmItems.value.length === 0) return
  confirmingScan.value = true
  operationError.value = ''
  try {
    const result = await confirmAccountMappingBatch({ confirmed: true, items: selectedConfirmItems.value })
    const partialFailureMessage = result.failed.length > 0
      ? t('admin.watch.mappingBatchPartialFailed', { failed: result.failed.length, saved: result.saved.length })
      : ''
    if (!partialFailureMessage) {
      appStore.showSuccess(t('admin.watch.mappingBatchSaved', { count: result.saved.length }))
    }
    const firstSavedAccountId = result.saved[0]?.account_id
    if (firstSavedAccountId) {
      highlightedMappingAccountId.value = firstSavedAccountId
      Object.assign(mappingFilters, { platform: '', search: String(firstSavedAccountId), status: '', source_id: 0 })
      mappingPagination.page = 1
    }
    await loadMappings()
    await runScan({ activateTab: false })
    operationError.value = partialFailureMessage
    if (firstSavedAccountId) {
      await setActiveTab('mappings')
      await scrollToHighlightedMapping()
    }
  } catch (err) {
    operationError.value = errorMessage(err, t('admin.watch.mappingBatchSaveFailed'))
  } finally {
    confirmingScan.value = false
  }
}

function terminalSourceMarker(source: WatchSource) {
  const state = String(source.diagnostic_state || '').trim().toLowerCase()
  const status = String(source.last_check_status || '').trim().toLowerCase()
  const terminal = state === 'completed' || state === 'failed' || ['healthy', 'degraded', 'success', 'error'].includes(status)
  if (!terminal || !source.last_check_at) return ''
  return [source.id, source.last_check_at, status, source.last_error_code || ''].join(':')
}

function observeTerminalSourceChanges(sources: WatchSource[]) {
  const changedSourceIds: number[] = []
  for (const source of sources) {
    const marker = terminalSourceMarker(source)
    if (!marker) continue
    if (terminalSourceBaselineReady && lastTerminalSourceMarkers.get(source.id) !== marker) {
      changedSourceIds.push(source.id)
    }
    lastTerminalSourceMarkers.set(source.id, marker)
  }
  terminalSourceBaselineReady = true
  return changedSourceIds
}

async function refreshMappingsAfterSourceDiagnostics() {
  if (sourceRefreshInFlight || isBusy.value) return
  if (!view.value?.sources.length) return
  sourceRefreshInFlight = true
  try {
    const nextSources = await listSources()
    for (const sourceId of observeTerminalSourceChanges(nextSources)) {
      pendingSourceSnapshotRefreshIds.add(sourceId)
      pendingTerminalSourceRefresh = true
    }
    const refreshDue = pendingTerminalSourceRefresh && Date.now() - lastMappingRefreshAt >= sourceRefreshCoalesceMs
    if (refreshDue) {
      invalidateSourceSnapshots(pendingSourceSnapshotRefreshIds)
      await loadMappings()
      if (view.value) {
        view.value = { ...view.value, sources: nextSources }
      }
      await runScan({ activateTab: false })
      pendingTerminalSourceRefresh = false
      pendingSourceSnapshotRefreshIds.clear()
      lastMappingRefreshAt = Date.now()
    } else if (view.value) {
      view.value = { ...view.value, sources: nextSources }
    }
  } catch {
    // 静默轮询只负责诊断完成后的联动刷新；页面主错误由显式操作展示。
  } finally {
    sourceRefreshInFlight = false
  }
}

async function setActiveTab(tab: MappingTab) {
  activeTab.value = tab
  if (String(route.query.view || '') !== tab) {
    await router.replace({ query: { ...route.query, view: tab } })
  }
}

async function goToManualMapping(candidate: WatchAccountMappingCandidate) {
  highlightedMappingAccountId.value = null
  operationError.value = ''
  Object.assign(mappingFilters, {
    platform: candidate.platform || '',
    search: String(candidate.account_id),
    status: '',
    source_id: 0,
  })
  mappingPagination.page = 1
  await setActiveTab('mappings')
  const loaded = await loadMappings()
  if (loaded && view.value?.accounts.some((row) => row.account_id === candidate.account_id)) {
    highlightedMappingAccountId.value = candidate.account_id
    await scrollToHighlightedMapping()
  } else {
    operationError.value = t('admin.watch.mappingAccountNotFound', { id: candidate.account_id })
  }
}

async function scrollToHighlightedMapping() {
  await nextTick()
  if (!highlightedMappingAccountId.value) return
  const element = document.querySelector<HTMLElement>(`[data-account-id="${highlightedMappingAccountId.value}"]`)
  element?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
}

function clearMappingHighlight() {
  highlightedMappingAccountId.value = null
}

async function saveRow(row: WatchAccountMappingRow) {
  if (!canSave(row)) return
  const draft = draftFor(row)
  savingAccountId.value = row.account_id
  operationError.value = ''
  try {
    await saveAccountMapping(row.account_id, {
      source_id: draft.source_id,
      source_key_external_id: draft.source_key_external_id,
      source_group_external_id: draft.source_group_external_id || undefined,
      mapping_method: 'manual',
    })
    appStore.showSuccess(t('admin.watch.mappingSaved'))
    await loadMappings()
  } catch (err) {
    operationError.value = errorMessage(err, t('admin.watch.mappingSaveFailed'))
  } finally {
    savingAccountId.value = null
  }
}

async function clearRow(row: WatchAccountMappingRow) {
  savingAccountId.value = row.account_id
  operationError.value = ''
  try {
    await deleteAccountMapping(row.account_id)
    appStore.showSuccess(t('admin.watch.mappingDeleted'))
    await loadMappings()
  } catch (err) {
    operationError.value = errorMessage(err, t('admin.watch.mappingDeleteFailed'))
  } finally {
    savingAccountId.value = null
  }
}

async function retryVisibleError() {
  const retryPage = Boolean(pageError.value)
  operationError.value = ''
  pageError.value = ''
  if (retryPage) {
    await loadAll()
    return
  }
  if (activeTab.value === 'candidates') {
    await runScan({ activateTab: false })
    return
  }
  await loadMappings()
}

function mappingStatusText(row: WatchAccountMappingRow) {
  if (row.mapping_status === 'needs_confirmation') return t('admin.watch.mappingStatus_needs_confirmation')
  if (row.mapping_status === 'mapped' && row.mapping?.mapping_method === 'auto') return t('admin.watch.mappingStatus_auto_followed')
  if (row.mapping_status === 'mapped') return t('admin.watch.mappingStatus_mapped')
  if (row.mapping_status === 'auto_match_available') return t('admin.watch.mappingStatus_auto_match_available')
  return t('admin.watch.mappingStatus_unmapped')
}

function mappingStatusClass(status: string) {
  if (status === 'needs_confirmation') return 'inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
  const base = 'inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium '
  if (status === 'mapped') return base + 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (status === 'auto_match_available') return base + 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  return base + 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
}

function scanStatusText(status: WatchAccountMappingCandidate['status']) {
  return t(`admin.watch.scanStatus_${status}`)
}

function scanStatusClass(status: WatchAccountMappingCandidate['status']) {
  const base = 'inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium '
  if (status === 'ready') return base + 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (status === 'mapped') return base + 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (status === 'needs_confirmation') return base + 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  if (status === 'needs_group') return base + 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  if (status === 'multiple_match') return base + 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'
  return base + 'bg-gray-100 text-gray-600 dark:bg-dark-700 dark:text-gray-300'
}

function platformValue(value?: string): GroupPlatform | undefined {
  const normalized = String(value || '').trim().toLowerCase()
  return GROUP_PLATFORMS.find((platform) => platform === normalized)
}

function platformLabel(value?: string) {
  const platform = platformValue(value)
  return platform ? platformNames[platform] : value || '-'
}

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '-'
}

function formatNumber(value?: number) {
  return value == null ? '-' : new Intl.NumberFormat(locale.value, { maximumFractionDigits: 8 }).format(value)
}

watch(() => route.query.view, (value) => {
  activeTab.value = normalizeMappingTab(value)
})

onMounted(() => {
  loadAll()
  sourceRefreshTimer = setInterval(() => {
    refreshMappingsAfterSourceDiagnostics()
  }, 5000)
})

onBeforeUnmount(() => {
  if (sourceRefreshTimer) clearInterval(sourceRefreshTimer)
})
</script>
