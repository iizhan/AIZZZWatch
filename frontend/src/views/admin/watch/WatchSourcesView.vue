<template>
  <AppLayout>
    <div class="watch-surface space-y-6">
      <div v-if="interactiveAuthSession && !showInteractiveAuthDialog" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-100">
        <div>
          <div class="font-medium">{{ t('admin.watch.interactiveAuthSessionPaused') }}</div>
          <div class="mt-1 text-xs text-amber-700 dark:text-amber-200">{{ interactiveAuthSource?.name || '-' }} · {{ interactiveAuthSession.auth_url }}</div>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="btn btn-secondary" type="button" @click="resumeInteractiveAuthDialog">{{ t('admin.watch.interactiveAuthResume') }}</button>
          <button class="btn btn-secondary" type="button" @click="discardInteractiveAuthSession">{{ t('admin.watch.interactiveAuthDiscard') }}</button>
        </div>
      </div>

      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">{{ t('admin.watch.sourcesTitle') }}</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('admin.watch.sourcesDescription') }}</p>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-secondary" type="button" :disabled="loading" @click="() => loadSources()">
            <Icon name="refresh" size="sm" :class="{ 'animate-spin': loading }" />
            <span>{{ t('common.refresh') }}</span>
          </button>
          <button class="btn btn-secondary" type="button" @click="openImportDialog">
            <Icon name="upload" size="sm" />
            <span>{{ t('admin.watch.importSources') }}</span>
          </button>
          <button class="btn btn-secondary" type="button" @click="openExportDialog">
            <Icon name="download" size="sm" />
            <span>{{ t('admin.watch.exportSources') }}</span>
          </button>
          <button class="btn btn-primary" type="button" @click="openCreate">
            <Icon name="plus" size="sm" />
            <span>{{ t('admin.watch.addSource') }}</span>
          </button>
        </div>
      </div>

      <div v-if="error" class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200" role="alert">
        <span>{{ error }}</span>
        <button class="font-medium underline" type="button" @click="() => loadSources()">{{ t('admin.watch.retry') }}</button>
      </div>

      <div v-if="loading && sources.length === 0" class="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
        {{ t('common.loading') }}
      </div>
      <div v-else-if="sources.length === 0" class="border-y border-gray-200 py-16 text-center dark:border-dark-700">
        <Icon name="server" size="xl" class="mx-auto text-gray-400" />
        <p class="mt-3 text-sm font-medium text-gray-700 dark:text-gray-200">{{ t('admin.watch.noSources') }}</p>
        <button class="btn btn-primary mt-4" type="button" @click="openCreate">{{ t('admin.watch.addFirstSource') }}</button>
      </div>
      <div v-else class="overflow-x-auto border-y border-gray-200 dark:border-dark-700">
        <table class="min-w-full text-left text-sm">
          <thead class="bg-gray-50 text-xs text-gray-500 dark:bg-dark-800/70 dark:text-gray-400">
            <tr>
              <th class="px-4 py-3 font-medium">{{ t('admin.watch.source') }}</th>
              <th class="px-4 py-3 font-medium">{{ t('admin.watch.adapter') }}</th>
              <th class="px-4 py-3 font-medium">{{ t('admin.watch.checkStatus') }}</th>
              <th class="px-4 py-3 font-medium">{{ t('common.balance') }}</th>
              <th class="px-4 py-3 font-medium">{{ t('admin.watch.lastCheck') }}</th>
              <th class="px-4 py-3 text-right font-medium">{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-dark-700">
            <tr v-for="source in sources" :key="source.id" class="bg-white dark:bg-dark-800">
              <td class="px-4 py-3">
                <div class="font-medium text-gray-900 dark:text-white">{{ source.name }}</div>
                <div class="mt-0.5 max-w-xs truncate text-xs text-gray-500 dark:text-gray-400" :title="source.base_url">{{ source.base_url }}</div>
              </td>
              <td class="px-4 py-3">
                <div class="uppercase text-gray-700 dark:text-gray-200">{{ source.adapter_type }}</div>
                <div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ adapterSummary(source.adapter_type) }}</div>
                <div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ source.has_credential ? t('admin.watch.credentialConfigured') : t('admin.watch.credentialMissing') }}</div>
                <div v-if="source.auth_mode === 'password' && source.login_username_hint" class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.savedLoginAccount', { account: source.login_username_hint }) }}</div>
              </td>
              <td class="px-4 py-3">
                <span :class="diagnosticStateClass(source)">{{ diagnosticStateLabel(source) }}</span>
                <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {{ t('admin.watch.latestResult') }}:
                  <span :class="statusClass(source.last_check_status)">{{ statusLabel(source.last_check_status) }}</span>
                </div>
                <div v-if="diagnosticStateReason(source)" class="mt-1 text-xs text-red-600 dark:text-red-400">{{ diagnosticStateReason(source) }}</div>
                <div class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {{ t('admin.watch.keepaliveStatus') }}:
                  <span :class="statusClass(source.last_keepalive_status)">{{ statusLabel(source.last_keepalive_status) }}</span>
                </div>
                <div v-if="source.last_keepalive_error_code" class="mt-1 text-xs text-red-600 dark:text-red-400">{{ diagnosticErrorLabel(source.last_keepalive_error_code) }}</div>
              </td>
              <td class="px-4 py-3 font-mono text-gray-700 dark:text-gray-200">{{ formatNumber(source.last_balance) }}</td>
              <td class="px-4 py-3 text-gray-500 dark:text-gray-400">
                <div>{{ formatDate(source.last_check_at) }}</div>
                <div v-if="source.last_latency_ms != null" class="mt-0.5 text-xs">{{ source.last_latency_ms }} ms</div>
                <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ nextDiagnosisText(source) }}</div>
              </td>
              <td class="px-4 py-3">
                <div class="flex justify-end gap-1">
                  <button class="icon-action" type="button" :title="t('admin.watch.runCheck')" :aria-label="t('admin.watch.runCheck')" :disabled="checkingId === source.id" @click="runCheck(source)">
                    <Icon name="play" size="sm" :class="{ 'animate-pulse': checkingId === source.id }" />
                  </button>
                  <button class="icon-action" type="button" :title="t('admin.watch.interactiveAuth')" :aria-label="t('admin.watch.interactiveAuth')" :disabled="interactiveAuthBusy" @click="openInteractiveAuth(source)">
                    <Icon name="key" size="sm" />
                  </button>
                  <button class="icon-action" type="button" :title="t('common.edit')" :aria-label="t('common.edit')" @click="openEdit(source)"><Icon name="edit" size="sm" /></button>
                  <button class="icon-action text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20" type="button" :title="t('common.delete')" :aria-label="t('common.delete')" @click="deletingSource = source"><Icon name="trash" size="sm" /></button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <BaseDialog :show="showEditor" :title="editingSource ? t('admin.watch.editSource') : t('admin.watch.addSource')" width="wide" @close="closeEditor">
      <form id="watch-source-form" class="watch-surface space-y-5" @submit.prevent="saveSource">
        <div v-if="formError" class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200" role="alert">{{ formError }}</div>
        <div class="grid gap-4 md:grid-cols-2">
          <label class="block"><span class="input-label">{{ t('common.name') }}</span><input v-model.trim="form.name" class="input" required maxlength="100" /></label>
          <label class="block"><span class="input-label">{{ t('admin.watch.adapter') }}</span><select v-model="form.adapter_type" class="input"><option value="sub2api">Sub2API</option><option value="newapi">New API</option><option value="custom">Custom</option></select></label>
          <label class="block md:col-span-2"><span class="input-label">{{ t('admin.watch.baseUrl') }}</span><input v-model.trim="form.base_url" class="input font-mono" type="url" placeholder="https://example.com" required /></label>
          <label class="block md:col-span-2"><span class="input-label">{{ t('admin.watch.apiBaseUrl') }} <span class="font-normal text-gray-400">({{ t('common.optional') }})</span></span><input v-model.trim="form.api_base_url" class="input font-mono" type="url" :placeholder="apiBasePlaceholder" /></label>
          <fieldset class="md:col-span-2 rounded-lg border border-gray-200 p-4 dark:border-dark-700">
            <legend class="px-1 text-sm font-medium text-gray-900 dark:text-white">{{ t('admin.watch.endpointPaths') }}</legend>
            <p class="mb-4 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.endpointPathsHint') }}</p>
            <div class="grid gap-4 md:grid-cols-2">
              <label class="block"><span class="input-label">{{ t('admin.watch.profilePath') }}</span><input v-model.trim="form.profile_path" class="input font-mono" required /></label>
              <label class="block"><span class="input-label">{{ t('admin.watch.groupsPath') }}</span><input v-model.trim="form.groups_path" class="input font-mono" required /></label>
              <label class="block"><span class="input-label">{{ t('admin.watch.ratesPath') }} <span class="font-normal text-gray-400">({{ t('common.optional') }})</span></span><input v-model.trim="form.rates_path" class="input font-mono" /></label>
              <label class="block"><span class="input-label">{{ t('admin.watch.pricingPath') }} <span class="font-normal text-gray-400">({{ t('common.optional') }})</span></span><input v-model.trim="form.pricing_path" class="input font-mono" /></label>
              <label class="block"><span class="input-label">{{ t('admin.watch.keysPath') }} <span class="font-normal text-gray-400">({{ t('common.optional') }})</span></span><input v-model.trim="form.keys_path" class="input font-mono" /></label>
              <label class="block"><span class="input-label">{{ t('admin.watch.loginPath') }} <span class="font-normal text-gray-400">({{ t('common.optional') }})</span></span><input v-model.trim="form.login_path" class="input font-mono" /></label>
              <label class="block md:col-span-2"><span class="input-label">{{ t('admin.watch.heartbeatPath') }}</span><input v-model.trim="form.heartbeat_path" class="input font-mono" required /></label>
            </div>
          </fieldset>
          <details class="md:col-span-2 rounded-lg border border-gray-200 p-4 dark:border-dark-700" :open="hasReadMappingInput">
            <summary class="cursor-pointer text-sm font-medium text-gray-900 dark:text-white">{{ t('admin.watch.readMapping') }}</summary>
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.watch.readMappingHint') }}</p>
            <div class="mt-4 space-y-5">
              <div>
                <h5 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ t('admin.watch.mappingProfile') }}</h5>
                <div class="mt-3 grid gap-4 md:grid-cols-2">
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingObjectPath') }}</span><input v-model.trim="form.profile_object_path" class="input font-mono" placeholder="data.user" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingBalancePath') }}</span><input v-model.trim="form.profile_balance_path" class="input font-mono" placeholder="balance" /></label>
                </div>
              </div>
              <div>
                <h5 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ t('admin.watch.mappingGroups') }}</h5>
                <div class="mt-3 grid gap-4 md:grid-cols-2">
                  <label class="block md:col-span-2"><span class="input-label">{{ t('admin.watch.mappingRecordsPath') }}</span><input v-model.trim="form.groups_records_path" class="input font-mono" placeholder="data.groups" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingGroupIdPath') }}</span><input v-model.trim="form.group_id_path" class="input font-mono" placeholder="id" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingGroupNamePath') }}</span><input v-model.trim="form.group_name_path" class="input font-mono" placeholder="name" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingPlatformPath') }}</span><input v-model.trim="form.group_platform_path" class="input font-mono" placeholder="platform" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingRatePath') }}</span><input v-model.trim="form.group_rate_path" class="input font-mono" placeholder="rate_multiplier" /></label>
                </div>
              </div>
              <div>
                <h5 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ t('admin.watch.mappingRates') }}</h5>
                <div class="mt-3 grid gap-4 md:grid-cols-2">
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingRecordsPath') }}</span><input v-model.trim="form.rates_records_path" class="input font-mono" placeholder="data.rates" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingRecordMode') }}</span><select v-model="form.rates_record_mode" class="input"><option value="list">{{ t('admin.watch.mappingRecordModeList') }}</option><option value="keyed_map">{{ t('admin.watch.mappingRecordModeKeyedMap') }}</option></select></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingGroupIdPath') }}</span><input v-model.trim="form.rates_group_id_path" class="input font-mono" placeholder="group_id" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingRatePath') }}</span><input v-model.trim="form.rates_rate_path" class="input font-mono" placeholder="rate_multiplier" /></label>
                </div>
              </div>
              <div>
                <h5 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ t('admin.watch.mappingPricing') }}</h5>
                <div class="mt-3 grid gap-4 md:grid-cols-2">
                  <label class="block md:col-span-2"><span class="input-label">{{ t('admin.watch.mappingRecordsPath') }}</span><input v-model.trim="form.pricing_records_path" class="input font-mono" placeholder="data.models" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingGroupIdPath') }}</span><input v-model.trim="form.pricing_group_id_path" class="input font-mono" placeholder="group_id" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingPlatformPath') }}</span><input v-model.trim="form.pricing_platform_path" class="input font-mono" placeholder="platform" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingModelPath') }}</span><input v-model.trim="form.pricing_model_path" class="input font-mono" placeholder="model" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingInputPricePath') }}</span><input v-model.trim="form.pricing_input_path" class="input font-mono" placeholder="pricing.input_price" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingOutputPricePath') }}</span><input v-model.trim="form.pricing_output_path" class="input font-mono" placeholder="pricing.output_price" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingPerRequestPath') }}</span><input v-model.trim="form.pricing_per_request_path" class="input font-mono" placeholder="pricing.per_request_price" /></label>
                </div>
              </div>
              <div>
                <h5 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ t('admin.watch.mappingKeys') }}</h5>
                <div class="mt-3 grid gap-4 md:grid-cols-2">
                  <label class="block md:col-span-2"><span class="input-label">{{ t('admin.watch.mappingRecordsPath') }}</span><input v-model.trim="form.keys_records_path" class="input font-mono" placeholder="data.tokens" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingKeyIdPath') }}</span><input v-model.trim="form.key_id_path" class="input font-mono" placeholder="id" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingKeyNamePath') }}</span><input v-model.trim="form.key_name_path" class="input font-mono" placeholder="name" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingKeyStatusPath') }}</span><input v-model.trim="form.key_status_path" class="input font-mono" placeholder="status" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingKeyValuePath') }}</span><input v-model.trim="form.key_value_path" class="input font-mono" placeholder="api_key" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingKeyGroupIdsPath') }}</span><input v-model.trim="form.key_group_ids_path" class="input font-mono" placeholder="group_ids" /></label>
                  <label class="block"><span class="input-label">{{ t('admin.watch.mappingKeyGroupNamesPath') }}</span><input v-model.trim="form.key_group_names_path" class="input font-mono" placeholder="group_names" /></label>
                </div>
              </div>
            </div>
          </details>
          <div class="rounded-lg border border-blue-100 bg-blue-50/70 p-4 text-sm text-blue-800 md:col-span-2 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-100">
            <div class="font-medium">{{ adapterCapabilityTitle }}</div>
            <ul class="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">
              <li v-for="item in adapterCapabilityItems" :key="item">{{ item }}</li>
            </ul>
          </div>
          <label class="block"><span class="input-label">{{ t('admin.watch.rechargeRatio') }}</span><input v-model.number="form.recharge_ratio" class="input" type="number" min="0.00000001" step="0.00000001" required /></label>
          <label class="block"><span class="input-label">{{ t('admin.watch.lowBalanceThreshold') }}</span><input v-model.number="form.low_balance_threshold" class="input" type="number" min="0" step="0.01" required /></label>
          <label class="block"><span class="input-label">{{ t('admin.watch.pollingInterval') }}</span><input v-model.number="form.polling_interval_seconds" class="input" type="number" min="30" max="3600" required /></label>
          <label class="block"><span class="input-label">{{ t('admin.watch.requestTimeout') }}</span><input v-model.number="form.request_timeout_seconds" class="input" type="number" min="3" max="60" required /></label>
          <label class="block"><span class="input-label">{{ t('admin.watch.keepaliveInterval') }}</span><input v-model.number="form.keepalive_interval_seconds" class="input" type="number" min="30" max="86400" required /></label>
          <label class="mt-7 inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input v-model="form.keepalive_enabled" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-primary-600" />{{ t('admin.watch.keepaliveEnabled') }}</label>
          <label class="inline-flex items-start gap-2 text-sm text-gray-700 md:col-span-2 dark:text-gray-200">
            <input v-model="form.auto_follow_key_group" type="checkbox" class="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600" />
            <span><span class="font-medium">{{ t('admin.watch.autoFollowKeyGroup') }}</span><span class="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">{{ t('admin.watch.autoFollowKeyGroupHint') }}</span></span>
          </label>
        </div>

        <div class="border-t border-gray-200 pt-5 dark:border-dark-700">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div><h4 class="text-sm font-medium text-gray-900 dark:text-white">{{ t('admin.watch.credential') }}</h4><p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ credentialHint }}</p></div>
            <label class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input v-model="form.enabled" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-primary-600" />{{ t('common.enabled') }}</label>
          </div>
          <div class="mt-4 grid gap-4 md:grid-cols-2">
            <label class="block">
              <span class="input-label">{{ t('admin.watch.authMode') }}</span>
              <select v-model="form.auth_mode" class="input">
                <option value="manual">{{ t('admin.watch.authModeManual') }}</option>
                <option value="password">{{ t('admin.watch.authModePassword') }}</option>
              </select>
            </label>
            <div class="flex items-end text-xs text-gray-500 dark:text-gray-400">{{ authModeHint }}</div>

            <template v-if="form.auth_mode === 'password'">
              <label class="block"><span class="input-label">{{ t('admin.watch.loginUsername') }}</span><input v-model.trim="form.login_username" class="input" autocomplete="username" :placeholder="savedLoginPlaceholder" :required="!editingSource?.has_login_credential" /></label>
              <label class="block"><span class="input-label">{{ t('admin.watch.loginPassword') }}</span><input v-model="form.login_password" class="input" type="password" autocomplete="new-password" :placeholder="editingSource?.has_login_credential ? t('admin.watch.passwordSavedPlaceholder') : ''" :required="!editingSource?.has_login_credential" /></label>
              <label class="block md:col-span-2"><span class="input-label">User-Agent <span class="font-normal text-gray-400">({{ t('common.optional') }})</span></span><input v-model.trim="form.user_agent" class="input" /></label>
              <p v-if="editingSource?.has_login_credential" class="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 md:col-span-2 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200">{{ savedLoginText }}</p>
              <p class="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 md:col-span-2 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">{{ t('admin.watch.passwordAuthSecurityHint') }}</p>
            </template>
            <template v-else>
              <label class="block"><span class="input-label">{{ t('admin.watch.credentialType') }}</span><select v-model="form.credential_type" class="input"><option value="bearer">Bearer Token</option><option value="api_key">API Key</option><option value="cookie">Cookie</option></select></label>
              <label class="block"><span class="input-label">{{ t('admin.watch.newCredential') }} <span class="font-normal text-gray-400">({{ t('common.optional') }})</span></span><input v-model="form.secret" class="input" type="password" autocomplete="new-password" /></label>
              <label class="block md:col-span-2"><span class="input-label">User-Agent <span class="font-normal text-gray-400">({{ t('common.optional') }})</span></span><input v-model.trim="form.user_agent" class="input" /></label>
            </template>
          </div>
          <label v-if="editingSource?.has_credential && form.auth_mode === 'manual'" class="mt-4 inline-flex items-center gap-2 text-sm text-red-600 dark:text-red-400"><input v-model="form.clear_credential" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-red-600" />{{ t('admin.watch.clearCredential') }}</label>
        </div>
      </form>
      <template #footer>
        <div class="flex items-center justify-between gap-3">
          <div class="text-xs text-gray-500 dark:text-gray-400">
            <span v-if="diagnosticReport">{{ t('admin.watch.diagnosticGeneratedAt', { time: formatDate(diagnosticReport.generated_at) }) }}</span>
          </div>
          <div class="flex justify-end gap-3">
            <button class="btn btn-secondary" type="button" :disabled="diagnosing" @click="runPreviewDiagnosis">
              <Icon name="sync" size="sm" :class="{ 'animate-spin': diagnosing }" />
              {{ diagnosing ? t('admin.watch.diagnosing') : t('admin.watch.diagnoseConfig') }}
            </button>
            <button class="btn btn-secondary" type="button" @click="closeEditor">{{ t('common.cancel') }}</button>
            <button class="btn btn-primary" type="submit" form="watch-source-form" :disabled="saving">{{ saving ? t('admin.watch.savingAndChecking') : t('common.save') }}</button>
          </div>
        </div>
      </template>
    </BaseDialog>

    <BaseDialog :show="Boolean(diagnosticReport)" :title="t('admin.watch.diagnosticTitle')" width="wide" @close="diagnosticReport = null">
      <div v-if="diagnosticReport" class="space-y-4">
        <div class="rounded-lg border border-blue-100 bg-blue-50/70 p-3 text-sm text-blue-800 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-100">
          {{ t('admin.watch.diagnosticSummary', { adapter: diagnosticReport.adapter_type, count: diagnosticReport.endpoints.length }) }}
        </div>
        <div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-dark-700">
          <table class="min-w-[900px] text-left text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 dark:bg-dark-800/70 dark:text-gray-400">
              <tr>
                <th class="px-3 py-2 font-medium">{{ t('admin.watch.diagnosticEndpoint') }}</th>
                <th class="px-3 py-2 font-medium">{{ t('admin.watch.diagnosticStatus') }}</th>
                <th class="px-3 py-2 font-medium">{{ t('admin.watch.diagnosticHttp') }}</th>
                <th class="px-3 py-2 font-medium">{{ t('admin.watch.diagnosticLatency') }}</th>
                <th class="px-3 py-2 font-medium">{{ t('admin.watch.diagnosticReason') }}</th>
                <th class="px-3 py-2 text-right font-medium">{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-dark-700">
              <tr v-for="item in diagnosticReport.endpoints" :key="`${item.name}-${item.path}`">
                <td class="px-3 py-3">
                  <div class="font-medium text-gray-900 dark:text-white">{{ diagnosticEndpointLabel(item.name) }}</div>
                  <div class="mt-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400" :title="item.url">{{ item.method }} {{ item.path || '-' }}</div>
                </td>
                <td class="px-3 py-3"><span :class="diagnosticStatusClass(item.status)">{{ diagnosticStatusLabel(item.status) }}</span></td>
                <td class="px-3 py-3 text-gray-600 dark:text-gray-300">{{ item.status_code || '-' }}<span v-if="item.content_type" class="ml-2 text-xs text-gray-400">{{ item.content_type }}</span></td>
                <td class="px-3 py-3 text-gray-600 dark:text-gray-300">{{ item.latency_ms }} ms</td>
                <td class="max-w-[360px] px-3 py-3 text-xs text-gray-600 dark:text-gray-300">{{ item.reason || '-' }}</td>
                <td class="px-3 py-3 text-right">
                  <button class="btn btn-secondary px-2 py-1 text-xs" type="button" @click="diagnosticDetail = item">{{ t('admin.watch.viewDiagnosticDetail') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </BaseDialog>

    <BaseDialog :show="Boolean(diagnosticDetail)" :title="t('admin.watch.diagnosticDetailTitle')" width="normal" @close="diagnosticDetail = null">
      <div v-if="diagnosticDetail" class="space-y-4 text-sm">
        <div class="font-medium text-gray-900 dark:text-white">{{ diagnosticEndpointLabel(diagnosticDetail.name) }} · {{ diagnosticDetail.path || '-' }}</div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div><div class="text-xs text-gray-500">{{ t('admin.watch.diagnosticStatus') }}</div><div class="mt-1">{{ diagnosticStatusLabel(diagnosticDetail.status) }}</div></div>
          <div><div class="text-xs text-gray-500">{{ t('admin.watch.diagnosticHttp') }}</div><div class="mt-1">{{ diagnosticDetail.status_code || '-' }}</div></div>
          <div><div class="text-xs text-gray-500">{{ t('admin.watch.diagnosticContentType') }}</div><div class="mt-1">{{ diagnosticDetail.content_type || '-' }}</div></div>
          <div><div class="text-xs text-gray-500">{{ t('admin.watch.diagnosticResponseKeys') }}</div><div class="mt-1 break-all">{{ diagnosticDetail.response_keys?.join(', ') || '-' }}</div></div>
        </div>
        <div>
          <div class="text-xs text-gray-500">{{ t('admin.watch.diagnosticResponsePreview') }}</div>
          <pre class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-gray-900 p-3 text-xs text-gray-100">{{ diagnosticDetail.response_preview || '-' }}</pre>
        </div>
        <p class="text-xs text-amber-700 dark:text-amber-300">{{ t('admin.watch.diagnosticRedactionHint') }}</p>
      </div>
    </BaseDialog>

    <BaseDialog :show="showExportDialog" :title="t('admin.watch.exportSources')" width="normal" @close="closeExportDialog">
      <form id="watch-source-export-form" class="watch-surface space-y-5" @submit.prevent="submitExport">
        <div v-if="portableError" class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200" role="alert">{{ portableError }}</div>
        <p class="text-sm text-gray-600 dark:text-gray-300">{{ t('admin.watch.exportSourcesHint', { count: sources.length }) }}</p>
        <label class="block">
          <span class="input-label">{{ t('admin.watch.portablePassword') }}</span>
          <input v-model="exportPassword" class="input" type="password" minlength="12" required autocomplete="new-password" />
        </label>
        <p class="text-xs text-amber-700 dark:text-amber-300">{{ t('admin.watch.portablePasswordWarning') }}</p>
      </form>
      <template #footer>
        <div class="flex justify-end gap-3">
          <button class="btn btn-secondary" type="button" @click="closeExportDialog">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" type="submit" form="watch-source-export-form" :disabled="portableBusy || sources.length === 0">
            {{ portableBusy ? t('common.processing') : t('admin.watch.exportSources') }}
          </button>
        </div>
      </template>
    </BaseDialog>

    <BaseDialog :show="showImportDialog" :title="t('admin.watch.importSources')" width="wide" @close="closeImportDialog">
      <form id="watch-source-import-form" class="watch-surface space-y-5" @submit.prevent="applyImport">
        <div v-if="portableError" class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200" role="alert">{{ portableError }}</div>
        <div class="grid gap-4 md:grid-cols-2">
          <label class="block">
            <span class="input-label">{{ t('admin.watch.importPackageFile') }}</span>
            <input ref="importFileInput" class="input" type="file" accept=".json,application/json" @change="handleImportFile" />
            <span v-if="importFileName" class="mt-1 block truncate text-xs text-gray-500 dark:text-gray-400">{{ importFileName }}</span>
          </label>
          <label class="block">
            <span class="input-label">{{ t('admin.watch.portablePassword') }}</span>
            <input v-model="importPassword" class="input" type="password" minlength="12" required autocomplete="current-password" />
          </label>
        </div>
        <p class="text-xs text-amber-700 dark:text-amber-300">{{ t('admin.watch.importSourcesHint') }}</p>
        <div v-if="importPreview" class="overflow-x-auto rounded-lg border border-gray-200 dark:border-dark-700">
          <table class="min-w-[900px] text-left text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 dark:bg-dark-800/70 dark:text-gray-400">
              <tr>
                <th class="px-3 py-2 font-medium">{{ t('admin.watch.importSourceName') }}</th>
                <th class="px-3 py-2 font-medium">{{ t('admin.watch.adapter') }}</th>
                <th class="px-3 py-2 font-medium">{{ t('admin.watch.baseUrl') }}</th>
                <th class="px-3 py-2 font-medium">{{ t('admin.watch.importCredentials') }}</th>
                <th class="px-3 py-2 font-medium">{{ t('admin.watch.importAction') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-dark-700">
              <tr v-for="item in importPreview.items" :key="item.index">
                <td class="px-3 py-3">
                  <div class="font-medium text-gray-900 dark:text-white">{{ item.name || '-' }}</div>
                  <div v-if="item.reason" class="mt-1 text-xs text-amber-700 dark:text-amber-300">{{ item.reason }}</div>
                </td>
                <td class="px-3 py-3 uppercase text-gray-700 dark:text-gray-200">{{ item.adapter_type }}</td>
                <td class="max-w-xs truncate px-3 py-3 font-mono text-xs text-gray-600 dark:text-gray-300" :title="item.base_url">{{ item.base_url }}</td>
                <td class="px-3 py-3 text-xs text-gray-600 dark:text-gray-300">
                  {{ item.has_credential || item.has_login_credential ? t('admin.watch.importCredentialsIncluded') : t('admin.watch.importCredentialsMissing') }}
                </td>
                <td class="px-3 py-3">
                  <div class="flex items-center gap-2">
                    <select v-model="ensureImportDecision(item).action" class="input min-w-[120px]" :disabled="item.default_action === 'invalid'">
                      <option value="create">{{ t('admin.watch.importCreate') }}</option>
                      <option value="skip">{{ t('admin.watch.importSkip') }}</option>
                      <option v-if="item.existing_source_id" value="overwrite">{{ t('admin.watch.importOverwrite') }}</option>
                      <option value="rename">{{ t('admin.watch.importRename') }}</option>
                    </select>
                    <input v-if="ensureImportDecision(item).action === 'rename'" v-model.trim="ensureImportDecision(item).name" class="input min-w-[180px]" :placeholder="t('admin.watch.importNewName')" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="importResult" class="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200">
          {{ t('admin.watch.importResultSummary', importResult) }}
        </div>
      </form>
      <template #footer>
        <div class="flex justify-end gap-3">
          <button class="btn btn-secondary" type="button" @click="closeImportDialog">{{ t('common.cancel') }}</button>
          <button class="btn btn-secondary" type="button" :disabled="portableBusy || !importPackage || !importPassword" @click="previewImport">{{ portableBusy ? t('common.processing') : t('admin.watch.previewImport') }}</button>
          <button class="btn btn-primary" type="submit" form="watch-source-import-form" :disabled="portableBusy || !importPreview">{{ t('admin.watch.confirmImport') }}</button>
        </div>
      </template>
    </BaseDialog>

    <BaseDialog :show="showInteractiveAuthDialog" :title="t('admin.watch.interactiveAuthTitle')" width="wide" @close="closeInteractiveAuthDialog">
      <form id="watch-source-interactive-auth-form" class="watch-surface space-y-5" @submit.prevent="submitInteractiveAuth">
        <div v-if="interactiveAuthError" class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200" role="alert">{{ interactiveAuthError }}</div>
        <div class="rounded-lg border border-blue-100 bg-blue-50/70 p-4 text-sm text-blue-800 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-100">
          <div class="flex items-start gap-3">
            <Icon name="shield" size="md" class="mt-0.5 flex-shrink-0" />
            <div class="space-y-2">
              <p class="font-medium">{{ t('admin.watch.interactiveAuthDescription') }}</p>
              <p class="text-xs leading-5">{{ t('admin.watch.interactiveAuthSecurityHint') }}</p>
              <p class="text-xs leading-5">{{ t('admin.watch.interactiveAuthModeSwitchHint') }}</p>
            </div>
          </div>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <div>
            <span class="input-label">{{ t('admin.watch.interactiveAuthSource') }}</span>
            <div class="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-dark-700 dark:bg-dark-900 dark:text-gray-200">
              <div class="font-medium">{{ interactiveAuthSource?.name || '-' }}</div>
              <div class="mt-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400" :title="interactiveAuthSession?.auth_url">{{ interactiveAuthSession?.auth_url || '-' }}</div>
            </div>
          </div>
          <div>
            <span class="input-label">{{ t('admin.watch.interactiveAuthExpiresAt', { time: interactiveAuthExpiresText }) }}</span>
            <button class="btn btn-secondary w-full justify-center" type="button" :disabled="!interactiveAuthSession || interactiveAuthBusy" @click="openUpstreamAuthWindow">
              <Icon name="externalLink" size="sm" />
              <span>{{ t('admin.watch.interactiveAuthOpen') }}</span>
            </button>
          </div>
          <label class="block">
            <span class="input-label">{{ t('admin.watch.interactiveAuthCredentialType') }}</span>
            <select v-model="interactiveAuthForm.credential_type" class="input">
              <option value="bearer">Bearer Token</option>
              <option value="api_key">API Key</option>
              <option value="cookie">Cookie</option>
            </select>
          </label>
          <label class="block">
            <span class="input-label">{{ t('admin.watch.interactiveAuthUserAgent') }}</span>
            <input v-model.trim="interactiveAuthForm.user_agent" class="input" maxlength="512" />
          </label>
          <label class="block md:col-span-2">
            <span class="input-label">{{ interactiveAuthCredentialLabel }}</span>
            <textarea v-model="interactiveAuthForm.secret" class="input min-h-[120px] resize-y font-mono text-xs" autocomplete="off" spellcheck="false" :placeholder="interactiveAuthSecretPlaceholder" maxlength="65536" @input="autoDetectInteractiveCredential" />
            <p v-if="interactiveAuthDetectedHint" class="mt-1 text-xs text-blue-700 dark:text-blue-300">{{ interactiveAuthDetectedHint }}</p>
          </label>
          <label class="inline-flex items-center gap-2 text-sm text-gray-700 md:col-span-2 dark:text-gray-200">
            <input v-model="interactiveAuthValidate" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-primary-600" />
            {{ t('admin.watch.interactiveAuthValidate') }}
          </label>
        </div>
      </form>
      <template #footer>
        <div class="flex justify-end gap-3">
          <button class="btn btn-secondary" type="button" :disabled="interactiveAuthBusy" @click="closeInteractiveAuthDialog">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" type="submit" form="watch-source-interactive-auth-form" :disabled="interactiveAuthBusy || !interactiveAuthSession">
            {{ interactiveAuthBusy ? t('common.processing') : t('admin.watch.interactiveAuthComplete') }}
          </button>
        </div>
      </template>
    </BaseDialog>

    <ConfirmDialog :show="Boolean(deletingSource)" :title="t('admin.watch.deleteSource')" :message="t('admin.watch.deleteSourceConfirm', { name: deletingSource?.name || '' })" :confirm-text="t('common.delete')" danger @confirm="confirmDelete" @cancel="deletingSource = null" />
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import Icon from '@/components/icons/Icon.vue'
import { useAppStore } from '@/stores/app'
import { applySourceImport, completeSourceInteractiveAuth, createSource, deleteSource, diagnoseSource, diagnoseSourceInput, exportSources as exportWatchSources, listSources, previewSourceImport, startSourceInteractiveAuth, updateSource, type WatchCredentialType, type WatchReadRecordMode, type WatchSource, type WatchSourceAdapter, type WatchSourceAuthMode, type WatchSourceCredential, type WatchSourceDiagnosticReport, type WatchSourceEndpointDiagnostic, type WatchSourceImportDecision, type WatchSourceImportPreviewItem, type WatchSourceImportResult, type WatchSourceInput, type WatchSourceInteractiveAuthSession, type WatchSourcePortableEnvelope, type WatchSourceReadMapping, type WatchSourceSnapshot } from '@/api/admin/watch'
import { watchReasonText, watchStatusLabel } from './watchText'

const { t, locale } = useI18n()
const appStore = useAppStore()
const sources = ref<WatchSource[]>([])
const loading = ref(false)
const saving = ref(false)
const checkingId = ref<number | null>(null)
const error = ref('')
const formError = ref('')
const showEditor = ref(false)
const editingSource = ref<WatchSource | null>(null)
const deletingSource = ref<WatchSource | null>(null)
const showExportDialog = ref(false)
const showImportDialog = ref(false)
const portableBusy = ref(false)
const portableError = ref('')
const exportPassword = ref('')
const importPassword = ref('')
const importFileName = ref('')
const importPackage = ref<WatchSourcePortableEnvelope | null>(null)
const importPreview = ref<Awaited<ReturnType<typeof previewSourceImport>> | null>(null)
const importResult = ref<WatchSourceImportResult | null>(null)
const importFileInput = ref<HTMLInputElement | null>(null)
const importDecisions = reactive<Record<number, WatchSourceImportDecision>>({})
const showInteractiveAuthDialog = ref(false)
const interactiveAuthSource = ref<WatchSource | null>(null)
const interactiveAuthSession = ref<WatchSourceInteractiveAuthSession | null>(null)
const interactiveAuthBusy = ref(false)
const interactiveAuthError = ref('')
const interactiveAuthDetectedHint = ref('')
const interactiveAuthValidate = ref(true)
const interactiveAuthForm = reactive({
  credential_type: 'bearer' as WatchCredentialType,
  secret: '',
  user_agent: '',
  extra_headers: {} as Record<string, string>
})
const diagnosing = ref(false)
const diagnosticReport = ref<WatchSourceDiagnosticReport | null>(null)
const diagnosticDetail = ref<WatchSourceEndpointDiagnostic | null>(null)
const nowTick = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | undefined
let sourceRefreshTimer: ReturnType<typeof setInterval> | undefined
const form = reactive({
  name: '',
  adapter_type: 'sub2api' as WatchSourceAdapter,
  base_url: '',
  api_base_url: '',
  recharge_ratio: 1,
  low_balance_threshold: 0,
  polling_interval_seconds: 60,
  request_timeout_seconds: 15,
  keepalive_enabled: true,
  keepalive_interval_seconds: 300,
  auto_follow_key_group: true,
  profile_path: '/user/profile',
  groups_path: '/groups/available',
  rates_path: '/groups/rates',
  pricing_path: '/channels/available',
  keys_path: '',
  login_path: '/auth/login',
  heartbeat_path: '/user/profile',
  profile_object_path: '',
  profile_balance_path: '',
  groups_records_path: '',
  group_id_path: '',
  group_name_path: '',
  group_platform_path: '',
  group_rate_path: '',
  rates_records_path: '',
  rates_record_mode: 'list' as WatchReadRecordMode,
  rates_group_id_path: '',
  rates_rate_path: '',
  pricing_records_path: '',
  pricing_group_id_path: '',
  pricing_platform_path: '',
  pricing_model_path: '',
  pricing_input_path: '',
  pricing_output_path: '',
  pricing_per_request_path: '',
  keys_records_path: '',
  key_id_path: '',
  key_name_path: '',
  key_status_path: '',
  key_value_path: '',
  key_group_ids_path: '',
  key_group_names_path: '',
  enabled: true,
  auth_mode: 'manual' as WatchSourceAuthMode,
  login_username: '',
  login_email: '',
  login_password: '',
  credential_type: 'bearer' as WatchCredentialType,
  secret: '',
  user_agent: '',
  clear_credential: false
})

const credentialHint = computed(() => {
  if (form.auth_mode === 'password') return editingSource.value?.has_login_credential ? t('admin.watch.passwordCredentialPreserved') : t('admin.watch.passwordCredentialHint')
  return editingSource.value?.has_credential ? t('admin.watch.credentialPreserved') : t('admin.watch.credentialRequiredHint')
})
const authModeHint = computed(() => form.auth_mode === 'password' ? t('admin.watch.authModePasswordHint') : t('admin.watch.authModeManualHint'))
const savedLoginPlaceholder = computed(() => {
  const hint = editingSource.value?.login_username_hint
  return hint ? t('admin.watch.savedLoginAccount', { account: hint }) : ''
})
const savedLoginText = computed(() => {
  const hint = editingSource.value?.login_username_hint
  return hint ? t('admin.watch.passwordCredentialPreservedWithAccount', { account: hint }) : t('admin.watch.passwordCredentialPreserved')
})
const apiBasePlaceholder = computed(() => form.adapter_type === 'newapi' ? 'https://example.com' : 'https://example.com/api/v1')
const adapterCapabilityTitle = computed(() => t(`admin.watch.adapterCapability_${form.adapter_type}_title`))
const adapterCapabilityItems = computed(() => [
  t(`admin.watch.adapterCapability_${form.adapter_type}_auth`),
  t(`admin.watch.adapterCapability_${form.adapter_type}_groups`),
  t(`admin.watch.adapterCapability_${form.adapter_type}_pricing`)
])
const hasReadMappingInput = computed(() => Boolean(buildReadMapping()))
const interactiveAuthCredentialLabel = computed(() => {
  if (interactiveAuthForm.credential_type === 'api_key') return 'API Key'
  if (interactiveAuthForm.credential_type === 'cookie') return 'Cookie'
  return 'Bearer Token'
})
const interactiveAuthSecretPlaceholder = computed(() => {
  if (interactiveAuthForm.credential_type === 'api_key') return t('admin.watch.interactiveAuthCredentialPlaceholderApiKey')
  if (interactiveAuthForm.credential_type === 'cookie') return t('admin.watch.interactiveAuthCredentialPlaceholderCookie')
  return t('admin.watch.interactiveAuthCredentialPlaceholderBearer')
})
const interactiveAuthExpiresText = computed(() => formatDate(interactiveAuthSession.value?.expires_at))

const defaultPathMap: Record<WatchSourceAdapter, Pick<typeof form, 'profile_path' | 'groups_path' | 'rates_path' | 'pricing_path' | 'keys_path' | 'login_path' | 'heartbeat_path'>> = {
  sub2api: {
    profile_path: '/user/profile',
    groups_path: '/groups/available',
    rates_path: '/groups/rates',
    pricing_path: '/channels/available',
    keys_path: '',
    login_path: '/auth/login',
    heartbeat_path: '/user/profile'
  },
  newapi: {
    profile_path: '/api/user/self',
    groups_path: '/api/user/self/groups',
    rates_path: '',
    pricing_path: '/api/pricing',
    keys_path: '/api/token/?p=0&size=100',
    login_path: '/api/user/login',
    heartbeat_path: '/api/user/self'
  },
  custom: {
    profile_path: '/user/profile',
    groups_path: '/groups/available',
    rates_path: '/groups/rates',
    pricing_path: '/channels/available',
    keys_path: '',
    login_path: '/auth/login',
    heartbeat_path: '/user/profile'
  }
}

watch(() => form.adapter_type, (adapter) => {
  if (!editingSource.value) {
    Object.assign(form, defaultPathMap[adapter])
    resetReadMappingForm()
  }
})

function emptyReadMappingForm() {
  return {
    profile_object_path: '',
    profile_balance_path: '',
    groups_records_path: '',
    group_id_path: '',
    group_name_path: '',
    group_platform_path: '',
    group_rate_path: '',
    rates_records_path: '',
    rates_record_mode: 'list' as WatchReadRecordMode,
    rates_group_id_path: '',
    rates_rate_path: '',
    pricing_records_path: '',
    pricing_group_id_path: '',
    pricing_platform_path: '',
    pricing_model_path: '',
    pricing_input_path: '',
    pricing_output_path: '',
    pricing_per_request_path: '',
    keys_records_path: '',
    key_id_path: '',
    key_name_path: '',
    key_status_path: '',
    key_value_path: '',
    key_group_ids_path: '',
    key_group_names_path: ''
  }
}

function resetReadMappingForm() {
  Object.assign(form, emptyReadMappingForm())
}

function fillReadMappingForm(mapping?: WatchSourceReadMapping) {
  resetReadMappingForm()
  const capabilities = mapping?.capabilities || {}
  form.profile_object_path = capabilities.profile?.object_path || ''
  form.profile_balance_path = capabilities.profile?.fields?.balance || ''
  form.groups_records_path = capabilities.groups?.records_path || ''
  form.group_id_path = capabilities.groups?.fields?.id || ''
  form.group_name_path = capabilities.groups?.fields?.name || ''
  form.group_platform_path = capabilities.groups?.fields?.platform || ''
  form.group_rate_path = capabilities.groups?.fields?.rate_multiplier || ''
  form.rates_records_path = capabilities.rates?.records_path || ''
  form.rates_record_mode = capabilities.rates?.record_mode || 'list'
  form.rates_group_id_path = capabilities.rates?.fields?.group_id || ''
  form.rates_rate_path = capabilities.rates?.fields?.rate_multiplier || ''
  form.pricing_records_path = capabilities.channels?.records_path || ''
  form.pricing_group_id_path = capabilities.channels?.fields?.group_id || ''
  form.pricing_platform_path = capabilities.channels?.fields?.platform || ''
  form.pricing_model_path = capabilities.channels?.fields?.model || ''
  form.pricing_input_path = capabilities.channels?.fields?.input_price || ''
  form.pricing_output_path = capabilities.channels?.fields?.output_price || ''
  form.pricing_per_request_path = capabilities.channels?.fields?.per_request_price || ''
  form.keys_records_path = capabilities.keys?.records_path || ''
  form.key_id_path = capabilities.keys?.fields?.id || ''
  form.key_name_path = capabilities.keys?.fields?.name || ''
  form.key_status_path = capabilities.keys?.fields?.status || ''
  form.key_value_path = capabilities.keys?.fields?.key_value || ''
  form.key_group_ids_path = capabilities.keys?.fields?.group_ids || ''
  form.key_group_names_path = capabilities.keys?.fields?.group_names || ''
}

function compactFields(fields: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(fields)
    .flatMap(([key, value]) => {
      const trimmed = value?.trim()
      return trimmed ? [[key, trimmed] as const] : []
    })) as Record<string, string>
}

function buildCapability(options: { objectPath?: string; recordsPath?: string; recordMode?: WatchReadRecordMode; fields?: Record<string, string | undefined> }) {
  const fields = compactFields(options.fields || {})
  const capability = {
    object_path: options.objectPath?.trim() || undefined,
    records_path: options.recordsPath?.trim() || undefined,
    record_mode: options.recordMode,
    fields: Object.keys(fields).length > 0 ? fields : undefined
  }
  if (!capability.object_path && !capability.records_path && !capability.fields) return undefined
  if (!capability.records_path && capability.record_mode) delete capability.record_mode
  return capability
}

function buildReadMapping(): WatchSourceReadMapping | undefined {
  const capabilities: NonNullable<WatchSourceReadMapping['capabilities']> = {}
  const profile = buildCapability({
    objectPath: form.profile_object_path,
    fields: { balance: form.profile_balance_path }
  })
  if (profile) capabilities.profile = profile
  const groups = buildCapability({
    recordsPath: form.groups_records_path,
    fields: {
      id: form.group_id_path,
      name: form.group_name_path,
      platform: form.group_platform_path,
      rate_multiplier: form.group_rate_path
    }
  })
  if (groups) capabilities.groups = groups
  const rates = buildCapability({
    recordsPath: form.rates_records_path,
    recordMode: form.rates_record_mode,
    fields: {
      group_id: form.rates_group_id_path,
      rate_multiplier: form.rates_rate_path
    }
  })
  if (rates) capabilities.rates = rates
  const channels = buildCapability({
    recordsPath: form.pricing_records_path,
    fields: {
      group_id: form.pricing_group_id_path,
      platform: form.pricing_platform_path,
      model: form.pricing_model_path,
      input_price: form.pricing_input_path,
      output_price: form.pricing_output_path,
      per_request_price: form.pricing_per_request_path
    }
  })
  if (channels) capabilities.channels = channels
  const keys = buildCapability({
    recordsPath: form.keys_records_path,
    fields: {
      id: form.key_id_path,
      name: form.key_name_path,
      status: form.key_status_path,
      key_value: form.key_value_path,
      group_ids: form.key_group_ids_path,
      group_names: form.key_group_names_path
    }
  })
  if (keys) capabilities.keys = keys
  return Object.keys(capabilities).length > 0 ? { version: 1, template: form.adapter_type, capabilities } : undefined
}

function errorMessage(err: any, fallback: string) {
  const message = err?.message || err?.response?.data?.message
  return message ? watchReasonText(t, message, message) : fallback
}

function diagnosticErrorLabel(code?: string) {
  if (!code) return ''
  const key = `admin.watch.errorCode_${code}`
  const translated = t(key)
  return translated === key ? code : `${translated} (${code})`
}

function diagnosticWarning(snapshot: WatchSourceSnapshot) {
  const status = snapshot.source.last_check_status
  if (status !== 'error' && status !== 'degraded') return ''
  return diagnosticErrorLabel(snapshot.source.last_error_code || snapshot.check?.error_code)
}

function resetForm() {
  Object.assign(form, {
    name: '',
    adapter_type: 'sub2api',
    base_url: '',
    api_base_url: '',
    recharge_ratio: 1,
    low_balance_threshold: 0,
    polling_interval_seconds: 60,
    request_timeout_seconds: 15,
    keepalive_enabled: true,
    keepalive_interval_seconds: 300,
    auto_follow_key_group: true,
    ...defaultPathMap.sub2api,
    ...emptyReadMappingForm(),
    enabled: true,
    auth_mode: 'manual',
    login_username: '',
    login_email: '',
    login_password: '',
    credential_type: 'bearer',
    secret: '',
    user_agent: '',
    clear_credential: false
  })
}

function openCreate() {
  editingSource.value = null
  resetForm()
  formError.value = ''
  diagnosticReport.value = null
  diagnosticDetail.value = null
  showEditor.value = true
}

function openEdit(source: WatchSource) {
  editingSource.value = source
  Object.assign(form, {
    name: source.name,
    adapter_type: source.adapter_type,
    base_url: source.base_url,
    api_base_url: source.api_base_url,
    recharge_ratio: source.recharge_ratio,
    low_balance_threshold: source.low_balance_threshold,
    polling_interval_seconds: source.polling_interval_seconds,
    request_timeout_seconds: source.request_timeout_seconds,
    keepalive_enabled: source.keepalive_enabled,
    keepalive_interval_seconds: source.keepalive_interval_seconds,
    auto_follow_key_group: source.auto_follow_key_group !== false,
    profile_path: source.profile_path || defaultPathMap[source.adapter_type].profile_path,
    groups_path: source.groups_path || defaultPathMap[source.adapter_type].groups_path,
    rates_path: source.rates_path || defaultPathMap[source.adapter_type].rates_path,
    pricing_path: source.pricing_path || defaultPathMap[source.adapter_type].pricing_path,
    keys_path: source.keys_path || defaultPathMap[source.adapter_type].keys_path,
    login_path: source.login_path || defaultPathMap[source.adapter_type].login_path,
    heartbeat_path: source.heartbeat_path || defaultPathMap[source.adapter_type].heartbeat_path,
    enabled: source.enabled,
    auth_mode: source.auth_mode || 'manual',
    login_username: '',
    login_email: '',
    login_password: '',
    credential_type: source.credential_type || 'bearer',
    secret: '',
    user_agent: '',
    clear_credential: false
  })
  fillReadMappingForm(source.read_mapping)
  formError.value = ''
  diagnosticReport.value = null
  diagnosticDetail.value = null
  showEditor.value = true
}

function clearSensitiveFormFields() {
  form.secret = ''
  form.login_password = ''
}

function closeEditor() {
  if (!saving.value && !diagnosing.value) {
    clearSensitiveFormFields()
    showEditor.value = false
    diagnosticReport.value = null
    diagnosticDetail.value = null
  }
}

async function runPreviewDiagnosis() {
  const formElement = document.getElementById('watch-source-form') as HTMLFormElement | null
  if (formElement && !formElement.reportValidity()) return
  diagnosing.value = true
  formError.value = ''
  diagnosticReport.value = null
  diagnosticDetail.value = null
  try {
    diagnosticReport.value = await diagnoseSourceInput(buildInput())
  } catch (err) {
    formError.value = errorMessage(err, t('admin.watch.diagnoseConfigFailed'))
  } finally {
    diagnosing.value = false
  }
}

function buildInput(): WatchSourceInput {
  const input: WatchSourceInput = {
    name: form.name,
    adapter_type: form.adapter_type,
    base_url: form.base_url,
    api_base_url: form.api_base_url || undefined,
    recharge_ratio: form.recharge_ratio,
    low_balance_threshold: form.low_balance_threshold,
    polling_interval_seconds: form.polling_interval_seconds,
    request_timeout_seconds: form.request_timeout_seconds,
    keepalive_enabled: form.keepalive_enabled,
    keepalive_interval_seconds: form.keepalive_interval_seconds,
    auto_follow_key_group: form.auto_follow_key_group,
    profile_path: form.profile_path,
    groups_path: form.groups_path,
    rates_path: form.rates_path || undefined,
    pricing_path: form.pricing_path || undefined,
    keys_path: form.keys_path || undefined,
    login_path: form.login_path || undefined,
    heartbeat_path: form.heartbeat_path,
    read_mapping: buildReadMapping(),
    enabled: form.enabled,
    auth_mode: form.auth_mode,
    credential_type: form.credential_type,
    clear_credential: form.auth_mode === 'manual' ? form.clear_credential : false
  }
  if (form.auth_mode === 'password') {
    input.login_username = form.login_username
    input.login_email = form.login_username
    input.login_password = form.login_password
    input.credential_type = 'bearer'
    if (form.user_agent) input.credential = { user_agent: form.user_agent }
    return input
  }
  if (form.secret) {
    input.credential = {
      access_token: form.credential_type === 'bearer' ? form.secret : undefined,
      api_key: form.credential_type === 'api_key' ? form.secret : undefined,
      cookie: form.credential_type === 'cookie' ? form.secret : undefined,
      user_agent: form.user_agent || undefined
    }
  }
  return input
}

function openExportDialog() {
  portableError.value = ''
  exportPassword.value = ''
  showExportDialog.value = true
}

function closeExportDialog() {
  if (portableBusy.value) return
  exportPassword.value = ''
  portableError.value = ''
  showExportDialog.value = false
}

async function submitExport() {
  portableBusy.value = true
  portableError.value = ''
  try {
    const envelope = await exportWatchSources({ password: exportPassword.value, include_credentials: true })
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `sub2api-watch-sources-${new Date().toISOString().slice(0, 10)}.json`
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    appStore.showSuccess(t('admin.watch.exportSourcesSuccess'))
    closeExportDialog()
  } catch (err) {
    portableError.value = errorMessage(err, t('admin.watch.exportSourcesFailed'))
  } finally {
    portableBusy.value = false
  }
}

function openImportDialog() {
  portableError.value = ''
  importPassword.value = ''
  importFileName.value = ''
  importPackage.value = null
  importPreview.value = null
  importResult.value = null
  Object.keys(importDecisions).forEach((key) => delete importDecisions[Number(key)])
  showImportDialog.value = true
}

function closeImportDialog() {
  if (portableBusy.value) return
  importPassword.value = ''
  importPackage.value = null
  importPreview.value = null
  importResult.value = null
  portableError.value = ''
  showImportDialog.value = false
}

async function handleImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  portableError.value = ''
  importPreview.value = null
  importResult.value = null
  importFileName.value = file.name
  try {
    const parsed = JSON.parse(await file.text()) as WatchSourcePortableEnvelope
    importPackage.value = parsed
  } catch {
    importPackage.value = null
    portableError.value = t('admin.watch.importPackageInvalid')
  }
}

function ensureImportDecision(item: WatchSourceImportPreviewItem): WatchSourceImportDecision {
  if (!importDecisions[item.index]) {
    importDecisions[item.index] = {
      index: item.index,
      action: item.default_action === 'invalid' ? 'skip' : item.default_action,
      name: item.name
    }
  }
  return importDecisions[item.index]
}

async function previewImport() {
  if (!importPackage.value) return
  portableBusy.value = true
  portableError.value = ''
  importResult.value = null
  try {
    importPreview.value = await previewSourceImport({ package: importPackage.value, password: importPassword.value })
    Object.keys(importDecisions).forEach((key) => delete importDecisions[Number(key)])
    importPreview.value.items.forEach((item) => ensureImportDecision(item))
  } catch (err) {
    importPreview.value = null
    portableError.value = errorMessage(err, t('admin.watch.importPreviewFailed'))
  } finally {
    portableBusy.value = false
  }
}

async function applyImport() {
  if (!importPackage.value || !importPreview.value) return
  const decisions = importPreview.value.items.map((item) => ensureImportDecision(item))
  const invalidRename = decisions.find((decision) => decision.action === 'rename' && !decision.name?.trim())
  if (invalidRename) {
    portableError.value = t('admin.watch.importRenameRequired')
    return
  }
  portableBusy.value = true
  portableError.value = ''
  try {
    importResult.value = await applySourceImport({
      package: importPackage.value,
      password: importPassword.value,
      decisions
    })
    await loadSources()
    if (importResult.value.failed > 0) {
      appStore.showWarning(t('admin.watch.importCompletedWithFailures', { failed: importResult.value.failed }))
    } else {
      appStore.showSuccess(t('admin.watch.importSuccess'))
    }
  } catch (err) {
    portableError.value = errorMessage(err, t('admin.watch.importFailed'))
  } finally {
    portableBusy.value = false
  }
}

async function openInteractiveAuth(source: WatchSource) {
  interactiveAuthBusy.value = true
  interactiveAuthError.value = ''
  interactiveAuthDetectedHint.value = ''
  interactiveAuthSource.value = source
  interactiveAuthSession.value = null
  interactiveAuthValidate.value = true
  Object.assign(interactiveAuthForm, {
    credential_type: source.credential_type || 'bearer',
    secret: '',
    user_agent: '',
    extra_headers: {}
  })
  showInteractiveAuthDialog.value = true
  try {
    interactiveAuthSession.value = await startSourceInteractiveAuth(source.id)
  } catch (err) {
    interactiveAuthError.value = errorMessage(err, t('admin.watch.interactiveAuthStartFailed'))
  } finally {
    interactiveAuthBusy.value = false
  }
}

function closeInteractiveAuthDialog() {
  if (interactiveAuthBusy.value) return
  interactiveAuthError.value = ''
  interactiveAuthDetectedHint.value = ''
  showInteractiveAuthDialog.value = false
}

function resumeInteractiveAuthDialog() {
  if (!interactiveAuthSession.value || interactiveAuthBusy.value) return
  showInteractiveAuthDialog.value = true
}

function discardInteractiveAuthSession() {
  if (interactiveAuthBusy.value) return
  Object.assign(interactiveAuthForm, { secret: '', user_agent: '', extra_headers: {} })
  interactiveAuthError.value = ''
  interactiveAuthDetectedHint.value = ''
  interactiveAuthSession.value = null
  interactiveAuthSource.value = null
  showInteractiveAuthDialog.value = false
}

function openUpstreamAuthWindow() {
  const authURL = interactiveAuthSession.value?.auth_url
  if (!authURL) return
  const opened = window.open(authURL, '_blank', 'noopener,noreferrer,width=1100,height=800')
  if (!opened) {
    interactiveAuthError.value = t('admin.watch.interactiveAuthPopupBlocked')
  }
}

function normalizeInteractiveSecret() {
  let secret = interactiveAuthForm.secret.trim()
  if (interactiveAuthForm.credential_type === 'bearer' && /^bearer\s+/i.test(secret)) {
    secret = secret.replace(/^bearer\s+/i, '').trim()
  }
  return secret
}

function cleanPastedCredentialValue(value: string | undefined) {
  return (value || '')
    .trim()
    .replace(/\\\r?\n/g, '')
    .replace(/\\(['"\\])/g, '$1')
    .replace(/\\$/g, '')
    .trim()
}

function extractCurlFlagValue(raw: string, flagPattern: RegExp) {
  flagPattern.lastIndex = 0
  const match = flagPattern.exec(raw)
  if (!match) return ''
  return cleanPastedCredentialValue(match[1] || match[2] || match[3])
}

function extractPastedHeader(raw: string, headerName: string) {
  const escapedName = headerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const directMatch = raw.match(new RegExp(`(?:^|[\\r\\n])\\s*${escapedName}\\s*:\\s*([^\\r\\n]+)`, 'i'))
  if (directMatch) return cleanPastedCredentialValue(directMatch[1])

  const headerFlagPattern = /(?:^|\s)-H\s+(?:"((?:\\.|[^"])*)"|'([^']*)'|([^\s\\]+))/gi
  let match: RegExpExecArray | null
  while ((match = headerFlagPattern.exec(raw))) {
    const headerLine = cleanPastedCredentialValue(match[1] || match[2] || match[3])
    const separatorIndex = headerLine.indexOf(':')
    if (separatorIndex <= 0) continue
    if (headerLine.slice(0, separatorIndex).trim().toLowerCase() === headerName.toLowerCase()) {
      return cleanPastedCredentialValue(headerLine.slice(separatorIndex + 1))
    }
  }

  return ''
}

function extractPastedCookie(raw: string) {
  const headerCookie = extractPastedHeader(raw, 'cookie')
  if (headerCookie) return headerCookie
  return extractCurlFlagValue(raw, /(?:^|\s)(?:-b|--cookie)\s+(?:"((?:\\.|[^"])*)"|'([^']*)'|([^\s\\]+))/i)
    || extractCurlFlagValue(raw, /(?:^|\s)--cookie=(?:"((?:\\.|[^"])*)"|'([^']*)'|([^\s\\]+))/i)
}

function looksLikePastedHTTPAuthorization(raw: string) {
  return /^\s*curl\s/i.test(raw)
    || /(?:^|[\r\n])\s*(?:authorization|cookie|x-api-key|api-key|new-api-user|user-agent)\s*:/i.test(raw)
    || /(?:^|\s)(?:-H|-b|--header|--cookie)(?:\s|=)/i.test(raw)
}

function autoDetectInteractiveCredential(event?: Event) {
  const raw = ((event?.target as HTMLTextAreaElement | null)?.value || interactiveAuthForm.secret).trim()
  const userAgent = extractPastedHeader(raw, 'user-agent')
  if (userAgent) {
    interactiveAuthForm.user_agent = userAgent
  }
  const newApiUser = extractPastedHeader(raw, 'new-api-user')
  if (newApiUser) {
    interactiveAuthForm.extra_headers = { 'new-api-user': newApiUser }
  } else if (looksLikePastedHTTPAuthorization(raw)) {
    interactiveAuthForm.extra_headers = {}
  }

  const cookie = extractPastedCookie(raw)
  const apiKey = extractPastedHeader(raw, 'x-api-key') || extractPastedHeader(raw, 'api-key')
  const authorization = extractPastedHeader(raw, 'authorization')
  const bearerMatch = authorization.match(/^bearer\s+(.+)$/i) || raw.match(/(?:^|\s)bearer\s+([^\s'"]+)/i)
  if (cookie) {
    interactiveAuthForm.credential_type = 'cookie'
    interactiveAuthForm.secret = cookie
    interactiveAuthDetectedHint.value = t('admin.watch.interactiveAuthDetectedCookie')
    return
  }
  if (apiKey) {
    interactiveAuthForm.credential_type = 'api_key'
    interactiveAuthForm.secret = apiKey
    interactiveAuthDetectedHint.value = t('admin.watch.interactiveAuthDetectedApiKey')
    return
  }
  if (bearerMatch) {
    interactiveAuthForm.credential_type = 'bearer'
    interactiveAuthForm.secret = cleanPastedCredentialValue(bearerMatch[1])
    interactiveAuthDetectedHint.value = t('admin.watch.interactiveAuthDetectedBearer')
    return
  }
  if (/^bearer\s+/i.test(raw)) {
    interactiveAuthForm.credential_type = 'bearer'
    interactiveAuthForm.secret = raw.replace(/^bearer\s+/i, '').trim()
    interactiveAuthDetectedHint.value = t('admin.watch.interactiveAuthDetectedBearer')
  }
}

function buildInteractiveCredential(): WatchSourceCredential | null {
  const secret = normalizeInteractiveSecret()
  if (!secret) return null
  const credential: WatchSourceCredential = {
    user_agent: interactiveAuthForm.user_agent.trim() || undefined
  }
  if (interactiveAuthForm.extra_headers['new-api-user']) {
    credential.extra_headers = { 'new-api-user': interactiveAuthForm.extra_headers['new-api-user'] }
  }
  if (interactiveAuthForm.credential_type === 'api_key') credential.api_key = secret
  else if (interactiveAuthForm.credential_type === 'cookie') credential.cookie = secret
  else credential.access_token = secret
  return credential
}

async function submitInteractiveAuth() {
  const source = interactiveAuthSource.value
  const session = interactiveAuthSession.value
  if (!source || !session) return
  autoDetectInteractiveCredential()
  const credential = buildInteractiveCredential()
  if (!credential) {
    interactiveAuthError.value = t('admin.watch.interactiveAuthCredentialRequired')
    return
  }
  interactiveAuthBusy.value = true
  interactiveAuthError.value = ''
  try {
    const result = await completeSourceInteractiveAuth(source.id, {
      session_id: session.session_id,
      credential_type: interactiveAuthForm.credential_type,
      credential,
      validate: interactiveAuthValidate.value
    })
    Object.assign(interactiveAuthForm, { secret: '', user_agent: '', extra_headers: {} })
    await loadSources()
    const warning = result.snapshot ? diagnosticWarning(result.snapshot) : ''
    if (warning) {
      appStore.showWarning(t('admin.watch.interactiveAuthSavedCheckWarning', { message: warning }))
    } else if (result.status === 'validated') {
      appStore.showSuccess(t('admin.watch.interactiveAuthValidated'))
    } else {
      appStore.showSuccess(t('admin.watch.interactiveAuthSaved'))
    }
    interactiveAuthBusy.value = false
    closeInteractiveAuthDialog()
  } catch (err) {
    interactiveAuthError.value = errorMessage(err, t('admin.watch.interactiveAuthFailed'))
  } finally {
    interactiveAuthBusy.value = false
  }
}

async function loadSources(options: { silent?: boolean } = {}) {
  if (options.silent && loading.value) return
  if (!options.silent) {
    loading.value = true
    error.value = ''
  }
  try {
    sources.value = await listSources()
  } catch (err) {
    if (!options.silent) error.value = errorMessage(err, t('admin.watch.sourcesLoadFailed'))
  } finally {
    if (!options.silent) loading.value = false
  }
}

async function saveSource() {
  saving.value = true
  formError.value = ''
  try {
    const saved = editingSource.value
      ? await updateSource(editingSource.value.id, buildInput())
      : await createSource(buildInput())
    clearSensitiveFormFields()
    showEditor.value = false
    checkingId.value = saved.id
    appStore.showSuccess(t('admin.watch.sourceSavedAndChecking'))
    let postSaveError = ''
    try {
      const snapshot = await diagnoseSource(saved.id)
      const warning = diagnosticWarning(snapshot)
      if (warning) {
        postSaveError = t('admin.watch.sourceSavedCheckWarning', { message: warning })
        appStore.showWarning(postSaveError)
      } else {
        appStore.showSuccess(t('admin.watch.sourceSavedAndChecked'))
      }
    } catch (diagnoseErr) {
      const message = errorMessage(diagnoseErr, t('admin.watch.checkFailed'))
      postSaveError = t('admin.watch.sourceSavedCheckFailed', { message })
      appStore.showError(postSaveError)
    }
    await loadSources()
    if (postSaveError) error.value = postSaveError
  } catch (err) {
    formError.value = errorMessage(err, t('admin.watch.sourceSaveFailed'))
  } finally {
    checkingId.value = null
    saving.value = false
  }
}

async function runCheck(source: WatchSource) {
  checkingId.value = source.id
  error.value = ''
  try {
    const snapshot = await diagnoseSource(source.id)
    const warning = diagnosticWarning(snapshot)
    if (warning) {
      error.value = t('admin.watch.checkCompletedWithWarning', { message: warning })
      appStore.showWarning(error.value)
    } else {
      appStore.showSuccess(t('admin.watch.checkCompleted'))
    }
    await loadSources()
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.checkFailed'))
  } finally {
    checkingId.value = null
  }
}

async function confirmDelete() {
  if (!deletingSource.value) return
  const id = deletingSource.value.id
  try {
    await deleteSource(id)
    deletingSource.value = null
    appStore.showSuccess(t('common.deleted'))
    await loadSources()
  } catch (err) {
    error.value = errorMessage(err, t('admin.watch.sourceDeleteFailed'))
  }
}

function adapterSummary(adapter: WatchSourceAdapter) {
  return t(`admin.watch.adapterSummary_${adapter}`)
}

function diagnosticEndpointLabel(name: string) {
  const key = `admin.watch.diagnosticEndpoint_${name}`
  const translated = t(key)
  return translated === key ? name : translated
}

function diagnosticStatusLabel(status: string) {
  const key = `admin.watch.diagnosticStatus_${status}`
  const translated = t(key)
  return translated === key ? status : translated
}

function diagnosticStatusClass(status: string) {
  const base = 'inline-flex rounded-full px-2.5 py-1 text-xs font-medium '
  if (status === 'success') return base + 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (status === 'interactive_auth') return base + 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  if (status === 'needs_auth') return base + 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
  if (status === 'error') return base + 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  return base + 'bg-gray-100 text-gray-600 dark:bg-dark-700 dark:text-gray-300'
}

function statusLabel(status?: string) {
  return watchStatusLabel(t, status)
}

function statusClass(status?: string) {
  const base = 'inline-flex rounded-full px-2.5 py-1 text-xs font-medium '
  if (status === 'checking') return base + 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (status === 'healthy' || status === 'success') return base + 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (status === 'degraded') return base + 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  if (status === 'error') return base + 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  return base + 'bg-gray-100 text-gray-600 dark:bg-dark-700 dark:text-gray-300'
}

function diagnosticStateLabel(source: WatchSource) {
  const state = source.diagnostic_state || 'waiting'
  const key = `admin.watch.diagnosticState_${state}`
  const translated = t(key)
  return translated === key ? state : translated
}

function diagnosticStateReason(source: WatchSource) {
  const reason = source.diagnostic_state_reason || source.last_error_code
  if (!reason || source.diagnostic_state === 'waiting') return ''
  return watchReasonText(t, reason, diagnosticErrorLabel(reason) || reason)
}

function diagnosticStateClass(source: WatchSource) {
  const base = 'inline-flex rounded-full px-2.5 py-1 text-xs font-medium '
  if (source.diagnostic_state === 'checking') return base + 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (source.diagnostic_state === 'completed') return base + 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (source.diagnostic_state === 'failed') return base + 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  return base + 'bg-gray-100 text-gray-600 dark:bg-dark-700 dark:text-gray-300'
}

function secondsUntilNext(source: WatchSource) {
  if (!source.enabled || !source.next_check_at) return undefined
  return Math.max(0, Math.ceil((new Date(source.next_check_at).getTime() - nowTick.value) / 1000))
}

function formatDuration(seconds: number) {
  if (seconds <= 0) return t('admin.watch.diagnosticDueNow')
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes <= 0) return `${rest}s`
  return `${minutes}m ${rest.toString().padStart(2, '0')}s`
}

function nextDiagnosisText(source: WatchSource) {
  if (!source.enabled) return t('admin.watch.diagnosticDisabled')
  if (source.diagnostic_state === 'checking' || checkingId.value === source.id) return t('admin.watch.diagnosticQuerying')
  const seconds = secondsUntilNext(source)
  if (seconds == null) return t('admin.watch.diagnosticWaiting')
  return t('admin.watch.nextDiagnosisIn', { time: formatDuration(seconds) })
}

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '-'
}

function formatNumber(value?: number) {
  return value == null ? '-' : new Intl.NumberFormat(locale.value, { maximumFractionDigits: 8 }).format(value)
}

onMounted(() => {
  loadSources()
  tickTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 1000)
  sourceRefreshTimer = setInterval(() => {
    loadSources({ silent: true })
  }, 5000)
})

onBeforeUnmount(() => {
  if (tickTimer) clearInterval(tickTimer)
  if (sourceRefreshTimer) clearInterval(sourceRefreshTimer)
})
</script>

<style scoped>
.icon-action { @apply inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-dark-700 dark:hover:text-white; }
</style>
