import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WatchSourcesView from '../WatchSourcesView.vue'

const {
  listSourcesMock,
  diagnoseSourceInputMock,
  startSourceInteractiveAuthMock,
  completeSourceInteractiveAuthMock,
  showSuccessMock,
  showWarningMock,
} = vi.hoisted(() => ({
  listSourcesMock: vi.fn(),
  diagnoseSourceInputMock: vi.fn(),
  startSourceInteractiveAuthMock: vi.fn(),
  completeSourceInteractiveAuthMock: vi.fn(),
  showSuccessMock: vi.fn(),
  showWarningMock: vi.fn(),
}))

vi.mock('vue-i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({
    locale: 'zh',
    t: (key: string, params?: Record<string, unknown>) => {
      const messages: Record<string, string> = {
        'admin.watch.interactiveAuth': '授权登录',
        'admin.watch.interactiveAuthTitle': '交互式授权登录',
        'admin.watch.interactiveAuthDescription': '在新窗口完成验证后回到这里粘贴 Token 或 Cookie。',
        'admin.watch.interactiveAuthSecurityHint': '系统不会自动读取第三方 HttpOnly Cookie。',
        'admin.watch.interactiveAuthModeSwitchHint': '保存后切换为手动凭据模式。',
        'admin.watch.interactiveAuthOpen': '打开上游登录页',
        'admin.watch.interactiveAuthComplete': '我已完成登录，保存凭据',
        'admin.watch.interactiveAuthSessionPaused': '授权会话已保留，点击继续完成登录。',
        'admin.watch.interactiveAuthResume': '继续授权',
        'admin.watch.interactiveAuthDiscard': '取消会话',
        'admin.watch.interactiveAuthSource': '授权站点',
        'admin.watch.interactiveAuthCredentialType': '凭据类型',
        'admin.watch.interactiveAuthUserAgent': 'User-Agent（可选）',
        'admin.watch.interactiveAuthValidate': '保存后立即验证',
        'admin.watch.interactiveAuthCredentialRequired': '请填写授权后获得的 Token 或 Cookie',
        'admin.watch.interactiveAuthValidated': '授权凭据已保存并验证成功',
        'admin.watch.interactiveAuthSaved': '授权凭据已保存',
        'admin.watch.interactiveAuthCredentialPlaceholderBearer': '粘贴 Bearer Token',
        'admin.watch.interactiveAuthCredentialPlaceholderApiKey': '粘贴 API Key',
        'admin.watch.interactiveAuthCredentialPlaceholderCookie': '粘贴 Cookie',
        'admin.watch.interactiveAuthExpiresAt': `会话有效期：${params?.time ?? ''}`,
        'admin.watch.sourcesTitle': '上游站点',
        'admin.watch.sourcesDescription': '管理上游站点',
        'admin.watch.source': '上游站点',
        'admin.watch.adapter': '适配器',
        'admin.watch.checkStatus': '检测状态',
        'admin.watch.lastCheck': '最近检测',
        'admin.watch.runCheck': '执行诊断',
        'admin.watch.diagnoseConfig': '检测接口',
        'admin.watch.diagnosing': '诊断中...',
        'admin.watch.diagnosticTitle': '接口检测结果',
        'admin.watch.diagnosticSummary': '已检测 {count} 个接口',
        'admin.watch.diagnosticEndpoint_login': '登录',
        'admin.watch.diagnosticEndpoint_profile': '用户信息/余额',
        'admin.watch.diagnosticEndpoint_groups': '分组',
        'admin.watch.diagnosticEndpoint_heartbeat': '保活',
        'admin.watch.diagnosticStatus_success': '成功',
        'admin.watch.diagnosticStatus_error': '失败',
        'admin.watch.diagnosticStatus_needs_auth': '需要授权',
        'admin.watch.diagnosticStatus_skipped': '跳过',
        'admin.watch.diagnosticStatus_pending': '准备中',
        'admin.watch.diagnosticHttp': 'HTTP',
        'admin.watch.diagnosticLatency': '耗时',
        'admin.watch.diagnosticReason': '结论',
        'admin.watch.diagnosticGeneratedAt': `检测时间：${params?.time ?? ''}`,
        'admin.watch.viewDiagnosticDetail': '查看详情',
        'admin.watch.diagnosticDetailTitle': '接口返回详情',
        'admin.watch.diagnosticContentType': '响应类型',
        'admin.watch.diagnosticResponseKeys': '响应字段',
        'admin.watch.diagnosticResponsePreview': '脱敏响应摘要',
        'admin.watch.diagnosticRedactionHint': '响应已脱敏',
        'common.actions': '操作',
        'common.balance': '余额',
        'common.refresh': '刷新',
        'common.cancel': '取消',
        'common.processing': '处理中',
      }
      return messages[key] ?? key
    },
  }),
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    showSuccess: showSuccessMock,
    showWarning: showWarningMock,
    showError: vi.fn(),
  }),
}))

vi.mock('@/api/admin/watch', () => ({
  applySourceImport: vi.fn(),
  completeSourceInteractiveAuth: completeSourceInteractiveAuthMock,
  createSource: vi.fn(),
  deleteSource: vi.fn(),
  diagnoseSource: vi.fn(),
  diagnoseSourceInput: diagnoseSourceInputMock,
  exportSources: vi.fn(),
  listSources: listSourcesMock,
  previewSourceImport: vi.fn(),
  startSourceInteractiveAuth: startSourceInteractiveAuthMock,
  updateSource: vi.fn(),
}))

const AppLayoutStub = defineComponent({
  name: 'AppLayout',
  template: '<main><slot /></main>',
})

const BaseDialogStub = defineComponent({
  name: 'BaseDialog',
  props: {
    show: Boolean,
    title: String,
    width: String,
  },
  template: '<section v-if="show" data-testid="base-dialog"><h2>{{ title }}</h2><slot /><slot name="footer" /></section>',
})

const ConfirmDialogStub = defineComponent({
  name: 'ConfirmDialog',
  props: {
    show: Boolean,
  },
  template: '<section v-if="show" data-testid="confirm-dialog" />',
})

const IconStub = defineComponent({
  name: 'Icon',
  template: '<span data-testid="icon" />',
})

const source = {
  id: 7,
  name: 'QA upstream',
  adapter_type: 'sub2api',
  base_url: 'https://upstream.example',
  api_base_url: 'https://upstream.example/api/v1',
  recharge_ratio: 1,
  low_balance_threshold: 0,
  polling_interval_seconds: 60,
  request_timeout_seconds: 15,
  auth_mode: 'password',
  profile_path: '/user/profile',
  groups_path: '/groups/available',
  heartbeat_path: '/user/profile',
  keepalive_enabled: true,
  keepalive_interval_seconds: 300,
  enabled: true,
  has_credential: false,
  has_login_credential: true,
  next_check_in_seconds: 60,
  check_due: false,
  next_keepalive_in_seconds: 300,
  keepalive_due: false,
  keepalive_active: false,
  created_at: '2026-07-31T00:00:00Z',
  updated_at: '2026-07-31T00:00:00Z',
}

async function mountView() {
  const wrapper = mount(WatchSourcesView, {
    global: {
      stubs: {
        AppLayout: AppLayoutStub,
        BaseDialog: BaseDialogStub,
        ConfirmDialog: ConfirmDialogStub,
        Icon: IconStub,
      },
    },
  })
  await flushPromises()
  return wrapper
}

describe('WatchSourcesView interactive authorization', () => {
  beforeEach(() => {
    listSourcesMock.mockReset().mockResolvedValue([source])
    diagnoseSourceInputMock.mockReset().mockResolvedValue({
      adapter_type: 'sub2api',
      base_url: source.base_url,
      api_base_url: source.api_base_url,
      auth_mode: 'manual',
      generated_at: '2026-07-31T00:00:00Z',
      endpoints: [{
        name: 'profile',
        method: 'GET',
        path: '/user/profile',
        url: `${source.api_base_url}/user/profile`,
        status: 'success',
        status_code: 200,
        content_type: 'application/json',
        latency_ms: 12,
        optional: false,
        json: true,
        response_keys: ['balance'],
        response_preview: '{"balance":0}',
        reason: '接口响应正常',
      }],
    })
    startSourceInteractiveAuthMock.mockReset().mockResolvedValue({
      session_id: 'session-1',
      source_id: 7,
      source_name: 'QA upstream',
      auth_url: 'https://upstream.example',
      status: 'pending',
      expires_at: '2026-07-31T00:10:00Z',
      created_at: '2026-07-31T00:00:00Z',
    })
    completeSourceInteractiveAuthMock.mockReset().mockResolvedValue({
      status: 'validated',
      source,
      snapshot: {
        source: { ...source, last_check_status: 'healthy' },
        groups: [],
        prices: [],
        source_keys: [],
      },
    })
    showSuccessMock.mockReset()
    showWarningMock.mockReset()
  })

  it('submits a normalized bearer credential from the interactive auth dialog', async () => {
    const wrapper = await mountView()

    await (wrapper.vm as unknown as { openInteractiveAuth: (value: typeof source) => Promise<void> }).openInteractiveAuth(source)
    await flushPromises()

    const dialog = wrapper.find('[data-testid="base-dialog"]')
    expect(dialog.text()).toContain('交互式授权登录')

    await dialog.find('textarea').setValue(' Bearer upstream-token ')
    await dialog.find('form').trigger('submit')
    await flushPromises()

    expect(completeSourceInteractiveAuthMock).toHaveBeenCalledWith(7, expect.objectContaining({
      session_id: 'session-1',
      credential_type: 'bearer',
      credential: {
        access_token: 'upstream-token',
        user_agent: undefined,
      },
      validate: true,
    }))
    expect(showSuccessMock).toHaveBeenCalledWith('授权凭据已保存并验证成功')
  })

  it('shows a Chinese inline error and does not submit when the credential is empty', async () => {
    const wrapper = await mountView()

    await (wrapper.vm as unknown as { openInteractiveAuth: (value: typeof source) => Promise<void> }).openInteractiveAuth(source)
    await flushPromises()
    await nextTick()

    const dialog = wrapper.find('[data-testid="base-dialog"]')
    await dialog.find('textarea').setValue('   ')
    await dialog.find('form').trigger('submit')
    await flushPromises()

    expect(completeSourceInteractiveAuthMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请填写授权后获得的 Token 或 Cookie')
  })

  it('auto-detects cookie and api key formats from pasted authorization text', async () => {
    const wrapper = await mountView()
    const vm = wrapper.vm as unknown as {
      autoDetectInteractiveCredential: () => void
      interactiveAuthForm: { credential_type: string; secret: string; user_agent: string }
    }

    vm.interactiveAuthForm.secret = 'Cookie: session=fake-session'
    vm.autoDetectInteractiveCredential()
    expect(vm.interactiveAuthForm.credential_type).toBe('cookie')
    expect(vm.interactiveAuthForm.secret).toBe('session=fake-session')

    vm.interactiveAuthForm.secret = 'x-api-key: fake-api-key'
    vm.autoDetectInteractiveCredential()
    expect(vm.interactiveAuthForm.credential_type).toBe('api_key')
    expect(vm.interactiveAuthForm.secret).toBe('fake-api-key')
  })

  it('auto-detects cookie and user agent from a pasted curl command', async () => {
    const wrapper = await mountView()
    const vm = wrapper.vm as unknown as {
      autoDetectInteractiveCredential: () => void
      interactiveAuthForm: { credential_type: string; secret: string; user_agent: string; extra_headers: Record<string, string> }
    }

    vm.interactiveAuthForm.secret = `curl 'https://upstream.example/api/user/self' \\
  -H 'accept: application/json' \\
  -H 'new-api-user: 123' \\
  -b 'session=fake-session; cf_clearance=fake-clearance' \\
  -H 'user-agent: Mozilla/5.0 Test Browser'`
    vm.autoDetectInteractiveCredential()

    expect(vm.interactiveAuthForm.credential_type).toBe('cookie')
    expect(vm.interactiveAuthForm.secret).toBe('session=fake-session; cf_clearance=fake-clearance')
    expect(vm.interactiveAuthForm.user_agent).toBe('Mozilla/5.0 Test Browser')
    expect(vm.interactiveAuthForm.extra_headers).toEqual({ 'new-api-user': '123' })
  })

  it('submits new-api-user with a pasted cookie curl command', async () => {
    const wrapper = await mountView()

    await (wrapper.vm as unknown as { openInteractiveAuth: (value: typeof source) => Promise<void> }).openInteractiveAuth(source)
    await flushPromises()

    const dialog = wrapper.find('[data-testid="base-dialog"]')
    await dialog.find('textarea').setValue(`curl 'https://upstream.example/api/user/self' \\
  -H 'new-api-user: 123' \\
  -b 'session=fake-session' \\
  -H 'user-agent: Mozilla/5.0 Test Browser'`)
    await dialog.find('form').trigger('submit')
    await flushPromises()

    expect(completeSourceInteractiveAuthMock).toHaveBeenCalledWith(7, expect.objectContaining({
      credential_type: 'cookie',
      credential: {
        cookie: 'session=fake-session',
        user_agent: 'Mozilla/5.0 Test Browser',
        extra_headers: { 'new-api-user': '123' },
      },
    }))
  })

  it('parses the full curl again on submit when input auto-detection has not run yet', async () => {
    const wrapper = await mountView()
    const vm = wrapper.vm as unknown as {
      openInteractiveAuth: (value: typeof source) => Promise<void>
      submitInteractiveAuth: () => Promise<void>
      interactiveAuthForm: { credential_type: string; secret: string; user_agent: string; extra_headers: Record<string, string> }
    }

    await vm.openInteractiveAuth(source)
    await flushPromises()

    vm.interactiveAuthForm.secret = `curl 'https://upstream.example/api/user/self' \\
  -H 'new-api-user: 123' \\
  -b 'session=fake-session' \\
  -H 'user-agent: Mozilla/5.0 Test Browser'`
    vm.interactiveAuthForm.extra_headers = {}
    await vm.submitInteractiveAuth()
    await flushPromises()

    expect(completeSourceInteractiveAuthMock).toHaveBeenCalledWith(7, expect.objectContaining({
      credential_type: 'cookie',
      credential: {
        cookie: 'session=fake-session',
        user_agent: 'Mozilla/5.0 Test Browser',
        extra_headers: { 'new-api-user': '123' },
      },
    }))
  })

  it('auto-detects bearer credentials from pasted multiline request headers', async () => {
    const wrapper = await mountView()
    const vm = wrapper.vm as unknown as {
      autoDetectInteractiveCredential: () => void
      interactiveAuthForm: { credential_type: string; secret: string; user_agent: string }
    }

    vm.interactiveAuthForm.secret = `Accept: application/json
Authorization: Bearer fake-bearer-token
User-Agent: Mozilla/5.0 Header Browser`
    vm.autoDetectInteractiveCredential()

    expect(vm.interactiveAuthForm.credential_type).toBe('bearer')
    expect(vm.interactiveAuthForm.secret).toBe('fake-bearer-token')
    expect(vm.interactiveAuthForm.user_agent).toBe('Mozilla/5.0 Header Browser')
  })

  it('runs a non-persistent endpoint diagnosis and renders the result dialog', async () => {
    const wrapper = await mountView()
    await (wrapper.vm as unknown as { openEdit: (value: typeof source) => Promise<void> }).openEdit(source)
    await flushPromises()

    await (wrapper.vm as unknown as { runPreviewDiagnosis: () => Promise<void> }).runPreviewDiagnosis()
    await flushPromises()

    expect(diagnoseSourceInputMock).toHaveBeenCalled()
    expect(wrapper.text()).toContain('接口检测结果')
    expect(wrapper.text()).toContain('用户信息/余额')
    expect(wrapper.text()).toContain('成功')
  })

  it('keeps the interactive auth session available after closing the dialog', async () => {
    const wrapper = await mountView()
    const vm = wrapper.vm as unknown as {
      openInteractiveAuth: (value: typeof source) => Promise<void>
      closeInteractiveAuthDialog: () => void
      resumeInteractiveAuthDialog: () => void
    }

    await vm.openInteractiveAuth(source)
    await flushPromises()
    vm.closeInteractiveAuthDialog()
    await flushPromises()

    expect(wrapper.text()).toContain('授权会话已保留，点击继续完成登录。')

    vm.resumeInteractiveAuthDialog()
    await flushPromises()
    expect(wrapper.find('[data-testid="base-dialog"]').text()).toContain('交互式授权登录')
  })
})
