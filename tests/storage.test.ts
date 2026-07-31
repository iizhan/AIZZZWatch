import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataPath: string

async function importStorage(options: { failRename?: boolean } = {}) {
  vi.resetModules()
  vi.doUnmock('node:fs')
  vi.doMock('electron', () => ({
    app: {
      getPath: vi.fn(() => userDataPath)
    },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((value: string) => Buffer.from(value, 'utf8')),
      decryptString: vi.fn((value: Buffer) => value.toString('utf8'))
    }
  }))
  if (options.failRename) {
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
      return {
        ...actual,
        promises: {
          ...actual.promises,
          rename: vi.fn().mockRejectedValue(Object.assign(new Error('backup rename failed'), { code: 'EACCES' }))
        }
      }
    })
  }
  return import('../src/main/storage')
}

describe('station storage', () => {
  beforeEach(async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'aizzzwatch-storage-'))
  })

  afterEach(async () => {
    vi.doUnmock('electron')
    vi.doUnmock('node:fs')
    vi.resetModules()
    await rm(userDataPath, { recursive: true, force: true })
  })

  it('allows clearing a stale custom API base URL when editing a station', async () => {
    const { saveStation } = await importStorage()
    const [created] = await saveStation({
      name: '1for',
      baseUrl: 'https://1for.cc',
      apiBaseUrl: 'https://1for.cc',
      pollingIntervalMs: 30_000,
      rechargeRatio: 1,
      lowBalanceThreshold: 10,
      apiPaths: {}
    })

    const [updated] = await saveStation({
      id: created.id,
      name: '1for',
      baseUrl: 'https://1for.cc',
      apiBaseUrl: '',
      pollingIntervalMs: 30_000,
      rechargeRatio: 1,
      lowBalanceThreshold: 10,
      apiPaths: {}
    })

    expect(updated.baseUrl).toBe('https://1for.cc/api/v1')
    expect(updated.apiBaseUrl).toBe('https://1for.cc/api/v1')
  })

  it('keeps an existing custom API base URL when the field is omitted', async () => {
    const { saveStation } = await importStorage()
    const [created] = await saveStation({
      name: 'custom fork',
      baseUrl: 'https://relay.example.com',
      apiBaseUrl: 'https://relay.example.com/custom-api',
      pollingIntervalMs: 30_000,
      rechargeRatio: 1,
      lowBalanceThreshold: 10,
      apiPaths: {}
    })

    const [updated] = await saveStation({
      id: created.id,
      name: 'custom fork',
      baseUrl: 'https://relay.example.com',
      pollingIntervalMs: 30_000,
      rechargeRatio: 1,
      lowBalanceThreshold: 10,
      apiPaths: {}
    })

    expect(updated.apiBaseUrl).toBe('https://relay.example.com/custom-api')
  })

  it('clears a saved custom read mapping only when the edit explicitly includes it', async () => {
    const { saveStation } = await importStorage()
    const [created] = await saveStation({
      name: 'mapped station',
      baseUrl: 'https://relay.example.com/api/v1',
      pollingIntervalMs: 30_000,
      rechargeRatio: 1,
      lowBalanceThreshold: 10,
      apiPaths: {},
      readMapping: { version: 1, template: 'custom', capabilities: { profile: { objectPath: 'data', fields: { balance: 'credit_balance' } } } }
    })
    const [unchanged] = await saveStation({
      id: created.id,
      name: 'mapped station',
      baseUrl: 'https://relay.example.com/api/v1',
      pollingIntervalMs: 30_000,
      rechargeRatio: 1,
      lowBalanceThreshold: 10,
      apiPaths: {}
    })
    const [cleared] = await saveStation({
      id: created.id,
      name: 'mapped station',
      baseUrl: 'https://relay.example.com/api/v1',
      pollingIntervalMs: 30_000,
      rechargeRatio: 1,
      lowBalanceThreshold: 10,
      apiPaths: {},
      readMapping: undefined
    })

    expect(unchanged.readMapping?.capabilities.profile?.fields?.balance).toBe('credit_balance')
    expect(cleared.readMapping).toBeUndefined()
  })

  it('rejects custom read mappings on non-HTTPS stations', async () => {
    const { saveStation } = await importStorage()
    await expect(saveStation({
      name: 'insecure mapping',
      baseUrl: 'http://relay.example.com/api/v1',
      pollingIntervalMs: 30_000,
      rechargeRatio: 1,
      lowBalanceThreshold: 10,
      apiPaths: {},
      readMapping: { version: 1, template: 'custom', capabilities: { profile: { objectPath: 'data', fields: { balance: 'credits' } } } }
    })).rejects.toThrow('自定义读取映射仅允许 HTTPS 站点')
  })

  it('restores the standard Sub2API Key path when an old blank path is saved', async () => {
    const { saveStation } = await importStorage()
    const [created] = await saveStation({
      name: 'optional key route',
      baseUrl: 'https://relay.example.com/api/v1',
      pollingIntervalMs: 30_000,
      rechargeRatio: 1,
      lowBalanceThreshold: 10,
      apiPaths: { keys: '/keys' }
    })
    const [updated] = await saveStation({
      id: created.id,
      name: 'optional key route',
      baseUrl: 'https://relay.example.com/api/v1',
      pollingIntervalMs: 30_000,
      rechargeRatio: 1,
      lowBalanceThreshold: 10,
      apiPaths: { keys: '' }
    })

    expect(updated.apiPaths.keys).toBe('/keys?page=1&page_size=20&sort_by=created_at&sort_order=desc&timezone=Asia%2FShanghai')
  })

  it('uses adapter-specific default paths for Sub2API and NewAPI stations', async () => {
    const { saveStation } = await importStorage()
    const [sub2api] = await saveStation({
      name: 'Sub2API', baseUrl: 'https://relay.example.com/api/v1', adapterType: 'sub2api',
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {}
    })
    const stored = await saveStation({
      name: 'NewAPI', baseUrl: 'https://newapi.example.com', adapterType: 'newapi',
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {}
    })
    const newapi = stored.find((station) => station.name === 'NewAPI')

    expect(sub2api.apiPaths.keys).toBe('/keys?page=1&page_size=20&sort_by=created_at&sort_order=desc&timezone=Asia%2FShanghai')
    expect(newapi?.apiPaths).toMatchObject({
      profile: '/api/user/self',
      groups: '/api/user/self/groups',
      channels: '/api/pricing',
      keys: '/api/token/?p=0&size=100',
      authRefresh: '/api/user/auth/refresh'
    })
  })

  it('applies Krill defaults without replacing an operator-provided path', async () => {
    const { saveStation } = await importStorage()
    const [station] = await saveStation({
      name: 'Krill', baseUrl: 'https://www.krill-ai.net/api/v1', adapterType: 'sub2api',
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10,
      apiPaths: { profile: '/custom/profile' }
    })

    expect(station.apiPaths).toMatchObject({
      profile: '/custom/profile',
      balance: '/api/credits',
      groups: '/api/my/channels'
    })
  })

  it('upgrades a legacy NewAPI model probe path without replacing manual paths', async () => {
    const { saveStation } = await importStorage()
    const [created] = await saveStation({
      name: 'Legacy NewAPI', baseUrl: 'https://newapi.example.com', adapterType: 'newapi',
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10,
      apiPaths: { channels: '/api/models' }
    })
    const [updated] = await saveStation({
      id: created.id, name: 'Legacy NewAPI', baseUrl: 'https://newapi.example.com', adapterType: 'newapi',
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10,
      apiPaths: { channels: '/custom/pricing' }
    })

    expect(created.apiPaths.channels).toBe('/api/pricing')
    expect(updated.apiPaths.channels).toBe('/custom/pricing')
  })

  it('encrypts saved web login credentials without exposing them in public station data', async () => {
    const { publicStations, saveStation, stationLoginCredentials } = await importStorage()
    const stored = await saveStation({
      name: 'Saved login', baseUrl: 'https://relay.example.com/api/v1', loginAccount: 'member@example.com', loginPassword: 'password-test',
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {}
    })
    const station = stored[0]

    expect(station.loginAccount).not.toBe('member@example.com')
    expect(station.loginPassword).not.toBe('password-test')
    expect(publicStations(stored)[0]).toMatchObject({ hasSavedLoginCredentials: true })
    expect(publicStations(stored)[0]).not.toHaveProperty('loginAccount')
    expect(publicStations(stored)[0]).not.toHaveProperty('loginPassword')
    expect(stationLoginCredentials(station)).toEqual({ loginAccount: 'member@example.com', loginPassword: 'password-test' })
  })

  it('keeps the Cookie-session compatibility mode local while encrypting its Cookie value', async () => {
    const { publicStations, saveStation, stationTokens } = await importStorage()
    const [station] = await saveStation({
      name: 'OneAPI', baseUrl: 'https://nihao.dog', adapterType: 'newapi',
      sessionCookie: 'oneapi_session=opaque-cookie', sessionAuthMode: 'cookie-session', newApiSelectedUserId: '42',
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {}
    })

    expect(station.sessionAuthMode).toBe('cookie-session')
    expect(station.sessionCookie).not.toBe('oneapi_session=opaque-cookie')
    expect(station.newApiSelectedUserId).not.toBe('42')
    expect(stationTokens(station).sessionCookie).toBe('oneapi_session=opaque-cookie')
    expect(stationTokens(station).newApiSelectedUserId).toBe('42')
    expect(publicStations([station])[0]).toMatchObject({ hasSessionCookie: true })
    expect(publicStations([station])[0]).not.toHaveProperty('sessionCookie')
    expect(publicStations([station])[0]).not.toHaveProperty('sessionAuthMode')
  })

  it('replaces a prior NewAPI Bearer session when Cookie-session authorization succeeds', async () => {
    const { saveStation, stationTokens } = await importStorage()
    const [tokenStation] = await saveStation({
      name: 'OneAPI', baseUrl: 'https://nihao.dog', adapterType: 'newapi',
      accessToken: 'old-access-token', refreshToken: 'old-refresh-token', sessionCookie: 'old_session=opaque', sessionAuthMode: 'refresh-token',
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {}
    })
    const [cookieStation] = await saveStation({
      id: tokenStation.id, name: 'OneAPI', baseUrl: 'https://nihao.dog', adapterType: 'newapi',
      sessionCookie: 'oneapi_session=verified-cookie', sessionAuthMode: 'cookie-session',
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {}
    })

    expect(cookieStation.sessionAuthMode).toBe('cookie-session')
    expect(stationTokens(cookieStation)).toMatchObject({
      accessToken: undefined,
      refreshToken: undefined,
      sessionCookie: 'oneapi_session=verified-cookie'
    })
  })

  it('returns a Cookie-session NewAPI station to the standard contract when a JWT is pasted', async () => {
    const { saveStation, stationTokens } = await importStorage()
    const [cookieStation] = await saveStation({
      name: 'OneAPI', baseUrl: 'https://nihao.dog', adapterType: 'newapi',
      sessionCookie: 'oneapi_session=verified-cookie', sessionAuthMode: 'cookie-session', newApiSelectedUserId: '42',
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {}
    })
    const [tokenStation] = await saveStation({
      id: cookieStation.id, name: 'OneAPI', baseUrl: 'https://nihao.dog', adapterType: 'newapi', accessToken: 'manual-access-token',
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {}
    })

    expect(tokenStation.sessionAuthMode).toBe('refresh-token')
    expect(stationTokens(tokenStation).accessToken).toBe('manual-access-token')
    expect(stationTokens(tokenStation).newApiSelectedUserId).toBeUndefined()
  })

  it('clears a prior selected-user context when a fresh Cookie authorization has none', async () => {
    const { saveStation, stationTokens } = await importStorage()
    const [priorStation] = await saveStation({
      name: 'OneAPI', baseUrl: 'https://nihao.dog', adapterType: 'newapi',
      sessionCookie: 'oneapi_session=prior-cookie', sessionAuthMode: 'cookie-session', newApiSelectedUserId: '42',
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {}
    })
    const [reauthorizedStation] = await saveStation({
      id: priorStation.id, name: 'OneAPI', baseUrl: 'https://nihao.dog', adapterType: 'newapi',
      sessionCookie: 'oneapi_session=fresh-cookie', sessionAuthMode: 'cookie-session', newApiSelectedUserId: undefined,
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {}
    })

    expect(stationTokens(reauthorizedStation).newApiSelectedUserId).toBeUndefined()
  })

  it('clears both saved web login credential fields together', async () => {
    const { publicStations, saveStation, stationLoginCredentials } = await importStorage()
    const [created] = await saveStation({
      name: 'Saved login', baseUrl: 'https://relay.example.com/api/v1', loginAccount: 'member@example.com', loginPassword: 'password-test',
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {}
    })
    const [cleared] = await saveStation({
      id: created.id, name: 'Saved login', baseUrl: 'https://relay.example.com/api/v1', clearSavedLoginCredentials: true,
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {}
    })

    expect(publicStations([cleared])[0].hasSavedLoginCredentials).toBe(false)
    expect(stationLoginCredentials(cleared)).toEqual({})
  })

  it('keeps automatic reauthorization opt-in, local, and separate from credential values', async () => {
    const { publicStations, saveStation, updateStationAutoReauthStatus } = await importStorage()
    const [created] = await saveStation({
      name: 'Saved login', baseUrl: 'https://relay.example.com/api/v1', loginAccount: 'member@example.com', loginPassword: 'password-test', autoReauthEnabled: true,
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {}
    })
    const [updated] = await updateStationAutoReauthStatus(created.id, { state: 'manual-required', at: '2026-07-23T12:00:00.000Z' })
    const station = publicStations([updated])[0]

    expect(station).toMatchObject({ hasSavedLoginCredentials: true, autoReauthEnabled: true, autoReauthStatus: { state: 'manual-required', at: '2026-07-23T12:00:00.000Z' } })
    expect(station).not.toHaveProperty('loginAccount')
    expect(station).not.toHaveProperty('loginPassword')
  })

  it('reclassifies an interrupted persisted keepalive instead of resuming an in-flight login after restart', async () => {
    const { listStations, recoverInterruptedAutoReauthStatuses, saveStation, updateStationAutoReauthStatus } = await importStorage()
    const [created] = await saveStation({
      name: 'Restart-safe station', baseUrl: 'https://relay.example.com/api/v1', loginAccount: 'member@example.com', loginPassword: 'password-test', autoReauthEnabled: true,
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {}
    })
    await updateStationAutoReauthStatus(created.id, { state: 'pending', at: '2026-07-25T01:00:00.000Z', reason: 'session-expired', attempts: 2 })

    const recovered = await recoverInterruptedAutoReauthStatuses()
    expect(recovered[0].autoReauthStatus).toMatchObject({ state: 'interrupted', reason: 'application-restarted', attempts: 2 })
    await expect(listStations()).resolves.toMatchObject([{ autoReauthStatus: { state: 'interrupted', reason: 'application-restarted' } }])
  })

  it('requires saved credentials before enabling automatic reauthorization and disables it when credentials are cleared', async () => {
    const { publicStations, saveStation } = await importStorage()
    await expect(saveStation({
      name: 'No saved login', baseUrl: 'https://relay.example.com/api/v1', autoReauthEnabled: true,
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {}
    })).rejects.toThrow('开启自动重新登录前，必须先保存网页登录账号和密码')

    const [created] = await saveStation({
      name: 'Saved login', baseUrl: 'https://relay.example.com/api/v1', loginAccount: 'member@example.com', loginPassword: 'password-test', autoReauthEnabled: true,
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {}
    })
    const [cleared] = await saveStation({
      id: created.id, name: 'Saved login', baseUrl: 'https://relay.example.com/api/v1', clearSavedLoginCredentials: true,
      pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {}
    })

    expect(publicStations([cleared])[0]).toMatchObject({ hasSavedLoginCredentials: false, autoReauthEnabled: false })
  })

  it('preserves an explicitly configured same-origin API root for a custom mapping', async () => {
    const { listStations, saveStation } = await importStorage()
    const [saved] = await saveStation({
      name: 'Krill',
      baseUrl: 'https://www.krill-ai.net',
      apiBaseUrl: 'https://www.krill-ai.net/api',
      pollingIntervalMs: 30_000,
      rechargeRatio: 1,
      lowBalanceThreshold: 10,
      apiPaths: {
        profile: '/user/profile',
        groups: '/groups/available'
      },
      readMapping: { version: 1, template: 'custom', capabilities: {} }
    })

    expect(saved.baseUrl).toBe('https://www.krill-ai.net/api/v1')
    expect(saved.apiBaseUrl).toBe('https://www.krill-ai.net/api')

    const [reloaded] = await listStations()
    expect(reloaded.apiBaseUrl).toBe('https://www.krill-ai.net/api')

    const [updated] = await saveStation({
      id: saved.id,
      name: saved.name,
      baseUrl: saved.baseUrl,
      pollingIntervalMs: saved.pollingIntervalMs,
      rechargeRatio: saved.rechargeRatio,
      lowBalanceThreshold: saved.lowBalanceThreshold
    })
    expect(updated.apiBaseUrl).toBe('https://www.krill-ai.net/api')
  })

  it('keeps an explicitly configured nested API root instead of inferring a different default', async () => {
    const { saveStation } = await importStorage()
    const [saved] = await saveStation({
      name: 'aihub',
      baseUrl: 'https://aihub.top/api/api/v1',
      apiBaseUrl: 'https://aihub.top/api',
      pollingIntervalMs: 30_000,
      rechargeRatio: 1,
      lowBalanceThreshold: 10,
      apiPaths: { groups: '/groups/available' }
    })

    expect(saved.apiBaseUrl).toBe('https://aihub.top/api')
  })

  it('persists an explicit station role without requiring credentials', async () => {
    const { saveStation, publicStations } = await importStorage()
    const stored = await saveStation({
      name: '我的聚合站',
      baseUrl: 'https://mine.example.com/api/v1',
      stationRole: 'own',
      pollingIntervalMs: 30_000,
      rechargeRatio: 1,
      lowBalanceThreshold: 10,
      apiPaths: {}
    })

    expect(publicStations(stored)[0].stationRole).toBe('own')
  })

  it('persists a NewAPI adapter without forcing a Sub2API /api/v1 suffix', async () => {
    const { saveStation, publicStations } = await importStorage()
    const stored = await saveStation({
      name: 'NewAPI',
      baseUrl: 'https://newapi.example.com',
      adapterType: 'newapi',
      pollingIntervalMs: 30_000,
      rechargeRatio: 1,
      lowBalanceThreshold: 10,
      apiPaths: {}
    })

    expect(stored[0]).toMatchObject({ baseUrl: 'https://newapi.example.com', adapterType: 'newapi' })
    expect(publicStations(stored)[0].adapterType).toBe('newapi')
  })

  it('accepts same-origin HTTPS custom paths and rejects arbitrary remote paths', async () => {
    const { saveStation } = await importStorage()
    const [saved] = await saveStation({
      name: '鲨鱼辣椒',
      baseUrl: 'https://shayulajiao.xyz/api/v1',
      pollingIntervalMs: 30_000,
      rechargeRatio: 1,
      lowBalanceThreshold: 10,
      apiPaths: { balance: 'https://shayulajiao.xyz/api/credits' }
    })

    expect(saved.apiPaths.balance).toBe('https://shayulajiao.xyz/api/credits')
    await expect(saveStation({
      name: '错误路径',
      baseUrl: 'https://shayulajiao.xyz/api/v1',
      pollingIntervalMs: 30_000,
      rechargeRatio: 1,
      lowBalanceThreshold: 10,
      apiPaths: { balance: 'https://other.example/api/credits' }
    })).rejects.toThrow('必须与站点同源')
  })

  it('keeps legacy account upstream mappings with numeric ids stored as strings', async () => {
    const { getUiPreferences, saveAccountUpstreamMappings } = await importStorage()

    await saveAccountUpstreamMappings([
      {
        accountStationId: 'mine',
        accountId: '9',
        sourceStationId: 'source',
        sourceGroupId: '7',
        sourceKeyId: 'key-record-7',
        sourceKeyLabel: 'relay-openai',
        updatedAt: '2026-07-20T00:00:00.000Z'
      }
    ] as never)

    const preferences = await getUiPreferences()

    expect(preferences.accountUpstreamMappings).toEqual([
      {
        accountStationId: 'mine',
        accountId: 9,
        sourceStationId: 'source',
        sourceGroupId: 7,
        sourceKeyId: 'key-record-7',
        sourceKeyLabel: 'relay-openai',
        updatedAt: '2026-07-20T00:00:00.000Z'
      }
    ])
  })

  it('does not persist a credential-shaped upstream key id', async () => {
    const { getUiPreferences, saveAccountUpstreamMappings } = await importStorage()

    await saveAccountUpstreamMappings([{
      accountStationId: 'mine',
      accountId: 10,
      sourceStationId: 'source',
      sourceGroupId: 7,
      sourceKeyId: 'Bearer demo-credential',
      updatedAt: '2026-07-21T00:00:00.000Z'
    }])

    expect((await getUiPreferences()).accountUpstreamMappings[0]?.sourceKeyId).toBeUndefined()
  })

  it('persists the self-owned exempt cost kind without cost fields', async () => {
    const { getUiPreferences, saveAccountCostProfiles } = await importStorage()

    await saveAccountCostProfiles([{
      accountStationId: 'mine',
      accountId: 10,
      kind: 'self-owned-exempt',
      fixedCostAmount: 20,
      cycleDays: 30,
      variableCostMultiplier: 0.02,
      note: '自己的账号',
      updatedAt: '2026-07-22T00:00:00.000Z'
    }])

    expect((await getUiPreferences()).accountCostProfiles).toEqual([{
      accountStationId: 'mine',
      accountId: 10,
      kind: 'self-owned-exempt',
      fixedCostAmount: undefined,
      cycleDays: undefined,
      cycleStartedAt: undefined,
      variableCostMultiplier: undefined,
      note: '自己的账号',
      updatedAt: '2026-07-22T00:00:00.000Z'
    }])
  })

  it('loads older UI preferences without a time cost ledger', async () => {
    const { getUiPreferences } = await importStorage()
    await writeFile(join(userDataPath, 'ui-preferences.json'), JSON.stringify({
      hiddenGroupKeys: ['legacy:group'],
      accountUpstreamMappings: []
    }))

    expect(await getUiPreferences()).toMatchObject({
      hiddenGroupKeys: ['legacy:group'],
      timeCostLedger: { rateObservations: [], sourceKeyGroupObservations: [], mappingEvents: [], usageEntries: [], usageCoverage: [] }
    })
  })

  it('persists internal-use settings as local station and numeric user identifiers only', async () => {
    const { getUiPreferences, saveInternalUserProfiles } = await importStorage()
    await saveInternalUserProfiles([
      { accountStationId: 'mine', userId: 99, updatedAt: '2026-07-22T00:00:00.000Z' },
      { accountStationId: 'mine', userId: 99, updatedAt: '2026-07-22T01:00:00.000Z' },
      { accountStationId: '', userId: 100, updatedAt: '2026-07-22T00:00:00.000Z' }
    ])

    expect((await getUiPreferences()).internalUserProfiles).toEqual([
      { accountStationId: 'mine', userId: 99, updatedAt: '2026-07-22T00:00:00.000Z' }
    ])
  })

  it('persists operating-excluded group keys as a local de-duplicated preference', async () => {
    const { getUiPreferences, saveOperatingExcludedGroupKeys } = await importStorage()
    await saveOperatingExcludedGroupKeys(['mine:3', 'mine:3', '', 7] as never)

    expect((await getUiPreferences()).operatingExcludedGroupKeys).toEqual(['mine:3'])
  })

  it('records only safe mapping metadata and main-process usage entries in the local ledger', async () => {
    const { getUiPreferences, recordTimeCostLedgerSnapshot, saveAccountUpstreamMappings } = await importStorage()
    await saveAccountUpstreamMappings([{
      accountStationId: 'mine',
      accountId: 9,
      sourceStationId: 'source',
      sourceGroupId: 7,
      sourceKeyId: 'source-key-record-7',
      updatedAt: '2026-07-21T00:00:00.000Z'
    }])
    await recordTimeCostLedgerSnapshot({ id: 'source', rechargeRatio: 10 }, {
      stationId: 'source',
      stationName: 'Source',
      health: 'healthy',
      currency: 'USD',
      groups: [{ id: 7, name: 'OpenAI', platform: 'openai', rateMultiplier: 0.1, pricingAvailable: false }],
      sourceKeys: [{ id: 'source-key-record-7', label: 'key 7', groupIds: [7], groupNames: ['OpenAI'] }],
      accounts: [],
      priceCapability: 'available',
      lastSuccessAt: '2026-07-21T12:00:00.000Z'
    })
    await recordTimeCostLedgerSnapshot({ id: 'mine', rechargeRatio: 1 }, {
      stationId: 'mine',
      stationName: 'Mine',
      health: 'healthy',
      currency: 'USD',
      groups: [],
      accounts: [],
      adminConsole: { usage: [{ id: 'aggregate-only', total_cost: 99, api_key: 'must-not-persist' }] },
      priceCapability: 'available',
      lastSuccessAt: '2026-07-21T12:02:00.000Z'
    }, {
      entries: [{ id: 'mine:usage-record-1', accountStationId: 'mine', accountId: 9, usageAmount: 50, occurredAt: '2026-07-21T12:01:00.000Z' }],
      coverage: { accountStationId: 'mine', fetchedAt: '2026-07-21T12:02:00.000Z', state: 'complete', pagesFetched: 1, recordsSeen: 1, acceptedEntries: 1 }
    })

    const ledger = (await getUiPreferences()).timeCostLedger
    expect(ledger.rateObservations).toHaveLength(1)
    expect(ledger.sourceKeyGroupObservations).toHaveLength(1)
    expect(ledger.mappingEvents).toHaveLength(1)
    expect(ledger.usageEntries).toEqual([{ id: 'mine:usage-record-1', accountStationId: 'mine', accountId: 9, usageAmount: 50, occurredAt: '2026-07-21T12:01:00.000Z' }])
    expect(ledger.usageCoverage).toMatchObject([{ accountStationId: 'mine', state: 'complete', acceptedEntries: 1 }])
    expect(JSON.stringify(ledger)).not.toContain('Bearer')
    expect(JSON.stringify(ledger)).not.toContain('must-not-persist')
  })

  it('returns only the rate changes newly persisted by a snapshot write', async () => {
    const { recordTimeCostLedgerSnapshot } = await importStorage()
    const station = { id: 'source', name: 'Source', rechargeRatio: 1 }
    const baseline = {
      stationId: 'source', stationName: 'Source', health: 'healthy' as const, currency: 'USD' as const,
      groups: [{ id: 7, name: 'OpenAI', platform: 'openai', rateMultiplier: 0.02, pricingAvailable: false }],
      accounts: [], priceCapability: 'available' as const, lastSuccessAt: '2026-07-27T10:00:00.000Z'
    }
    const first = await recordTimeCostLedgerSnapshot(station, baseline)
    const changed = await recordTimeCostLedgerSnapshot(station, {
      ...baseline,
      groups: [{ ...baseline.groups[0], rateMultiplier: 0.03 }],
      lastSuccessAt: '2026-07-27T10:05:00.000Z'
    })

    expect(first.newGroupChangeEvents).toEqual([])
    expect(changed.newGroupChangeEvents).toMatchObject([{
      kind: 'rate-up', previousRate: 0.02, nextRate: 0.03, occurredAt: '2026-07-27T10:05:00.000Z'
    }])
    expect(changed.preferences.groupChangeEvents).toHaveLength(1)
  })
})

const stationBase = { pollingIntervalMs: 30_000, rechargeRatio: 1, lowBalanceThreshold: 10, apiPaths: {} }

describe('station storage durability', () => {
  beforeEach(async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'aizzzwatch-storage-durability-'))
  })

  afterEach(async () => {
    vi.doUnmock('electron')
    vi.resetModules()
    await rm(userDataPath, { recursive: true, force: true })
  })

  it('serializes concurrent saveStation calls so no station update is lost', async () => {
    const { saveStation, listStations, stationTokens } = await importStorage()
    await saveStation({ name: 'A', baseUrl: 'https://a.example.com', accessToken: 'old-A', ...stationBase })
    await saveStation({ name: 'B', baseUrl: 'https://b.example.com', accessToken: 'old-B', ...stationBase })
    const [stationA, stationB] = await listStations()

    // Mirrors stations:refresh's Promise.all(...map(refreshStation)), where
    // each station independently rotates its access token via saveStation().
    await Promise.all([
      saveStation({ id: stationA.id, name: 'A', baseUrl: stationA.baseUrl, accessToken: 'rotated-A', ...stationBase }),
      saveStation({ id: stationB.id, name: 'B', baseUrl: stationB.baseUrl, accessToken: 'rotated-B', ...stationBase })
    ])

    const after = await listStations()
    expect(after.map((station) => stationTokens(station).accessToken)).toEqual(['rotated-A', 'rotated-B'])
  })

  it('applies every save in a burst of interleaved concurrent writes', async () => {
    const { saveStation, listStations, stationTokens } = await importStorage()
    await saveStation({ name: 'A', baseUrl: 'https://a.example.com', accessToken: 'seed', ...stationBase })
    await saveStation({ name: 'B', baseUrl: 'https://b.example.com', accessToken: 'seed', ...stationBase })
    const [stationA, stationB] = await listStations()

    await Promise.all(Array.from({ length: 5 }, (_, i) => [
      saveStation({ id: stationA.id, name: 'A', baseUrl: stationA.baseUrl, accessToken: `A-${i}`, ...stationBase }),
      saveStation({ id: stationB.id, name: 'B', baseUrl: stationB.baseUrl, accessToken: `B-${i}`, ...stationBase })
    ]).flat())

    const after = await listStations()
    expect(after).toHaveLength(2)
    expect(stationTokens(after.find((station) => station.name === 'A')!).accessToken).toBe('A-4')
    expect(stationTokens(after.find((station) => station.name === 'B')!).accessToken).toBe('B-4')
  })

  it('never leaves stations.json partially written if a save is interrupted before rename', async () => {
    const { saveStation, listStations } = await importStorage()
    await saveStation({ name: 'A', baseUrl: 'https://a.example.com', accessToken: 'tok', ...stationBase })
    const file = join(userDataPath, 'stations.json')
    const before = await readFile(file, 'utf8')

    // A crash between the temp-file write and the rename must never be
    // observable: the real file only ever contains a complete document.
    await writeFile(`${file}.deadbeef.tmp`, '{"garbage')

    const recovered = await listStations()
    expect(recovered).toHaveLength(1)
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  it('backs up a corrupted stations.json instead of silently discarding it', async () => {
    const { saveStation, listStations } = await importStorage()
    await saveStation({ name: 'A', baseUrl: 'https://a.example.com', accessToken: 'tok', ...stationBase })
    const file = join(userDataPath, 'stations.json')
    const good = await readFile(file, 'utf8')
    const truncated = good.slice(0, Math.floor(good.length / 2))
    await writeFile(file, truncated)

    expect(await listStations()).toHaveLength(0)

    // The next ordinary save must not permanently erase the corrupted
    // original — it should already be preserved as a backup by this point.
    await saveStation({ name: 'C', baseUrl: 'https://c.example.com', ...stationBase })

    const backups = (await readdir(userDataPath)).filter((entry) => entry.startsWith('stations.json.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(await readFile(join(userDataPath, backups[0]), 'utf8')).toBe(truncated)
  })

  it('backs up a corrupted ui-preferences.json instead of silently discarding it', async () => {
    const { saveHiddenGroupKeys, getUiPreferences } = await importStorage()
    await saveHiddenGroupKeys(['group-a'])
    const file = join(userDataPath, 'ui-preferences.json')
    const good = await readFile(file, 'utf8')
    const truncated = good.slice(0, Math.floor(good.length / 2))
    await writeFile(file, truncated)

    expect((await getUiPreferences()).hiddenGroupKeys).toEqual([])

    const backups = (await readdir(userDataPath)).filter((entry) => entry.startsWith('ui-preferences.json.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(await readFile(join(userDataPath, backups[0]), 'utf8')).toBe(truncated)
  })

  it('blocks station writes when a corrupted stations file cannot be moved aside', async () => {
    const storage = await importStorage()
    await storage.saveStation({ name: 'A', baseUrl: 'https://a.example.com', accessToken: 'tok', ...stationBase })
    const file = join(userDataPath, 'stations.json')
    const truncated = (await readFile(file, 'utf8')).slice(0, 24)
    await writeFile(file, truncated)

    const guardedStorage = await importStorage({ failRename: true })
    await expect(guardedStorage.listStations()).rejects.toThrow('无法备份')
    await expect(guardedStorage.saveStation({ name: 'B', baseUrl: 'https://b.example.com', ...stationBase })).rejects.toThrow('无法备份')
    expect(await readFile(file, 'utf8')).toBe(truncated)
  })

  it.each(['[]', 'null', 'true'])('backs up a parseable but invalid UI preferences document (%s)', async (invalidDocument) => {
    const { saveHiddenGroupKeys, getUiPreferences } = await importStorage()
    await saveHiddenGroupKeys(['group-a'])
    const file = join(userDataPath, 'ui-preferences.json')
    await writeFile(file, invalidDocument)

    expect((await getUiPreferences()).hiddenGroupKeys).toEqual([])
    const backups = (await readdir(userDataPath)).filter((entry) => entry.startsWith('ui-preferences.json.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(await readFile(join(userDataPath, backups[0]), 'utf8')).toBe(invalidDocument)
  })
})
