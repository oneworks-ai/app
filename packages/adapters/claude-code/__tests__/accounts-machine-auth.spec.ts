import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveGlobalAdapterAccountDir } from '@oneworks/utils'

import {
  acquireClaudeAccountSessionLease,
  getClaudeAccounts,
  manageClaudeAccount,
  resolveClaudeRuntimeAccount
} from '../src/claude/accounts'
import {
  createClaudeAccountsTestContext as createContext,
  createClaudeAccountsTestHarness,
  readClaudeAccountsTestGlobalConfig as readGlobalConfig
} from './accounts.test-helpers'

const cliMock = vi.hoisted(() => ({
  path: '',
  beforeResolve: undefined as Promise<void> | undefined,
  onEnsure: undefined as (() => void) | undefined
}))

vi.mock('../src/claude/cli', () => ({
  ensureClaudeCliPath: vi.fn(async () => {
    cliMock.onEnsure?.()
    await cliMock.beforeResolve
    return cliMock.path
  })
}))

const { cleanup, createFakeClaudeCli, createTempDir } = createClaudeAccountsTestHarness()
const platformSpy = vi.spyOn(process, 'platform', 'get')

beforeEach(async () => {
  platformSpy.mockReturnValue('linux')
  cliMock.path = await createFakeClaudeCli()
  cliMock.beforeResolve = undefined
  cliMock.onEnsure = undefined
})

afterEach(async () => {
  await cleanup()
})

afterAll(() => {
  platformSpy.mockRestore()
})

describe('claude machine-bound account auth', () => {
  it('adopts the first existing Darwin Desktop login without starting another login flow', async () => {
    const cwd = await createTempDir('ow-claude-existing-desktop-workspace-')
    const realHome = await createTempDir('ow-claude-existing-desktop-home-')
    const mockHome = await createTempDir('ow-claude-existing-desktop-mock-home-')
    const commandLog = join(await createTempDir('ow-claude-existing-desktop-log-'), 'commands.jsonl')
    platformSpy.mockReturnValue('darwin')
    await writeFile(
      join(realHome, '.fake-claude-native-login.json'),
      JSON.stringify({ email: 'desktop@example.test', orgId: 'org-desktop' })
    )
    await writeFile(
      join(realHome, '.claude.json'),
      JSON.stringify({
        oauthAccount: {
          accountUuid: 'account-current',
          displayName: 'Desktop User',
          emailAddress: 'desktop@example.test'
        },
        cachedUsageUtilization: {
          accountUuid: 'account-previous',
          fetchedAtMs: Date.now(),
          utilization: {
            five_hour: { utilization: 91, resets_at: '2030-01-01T00:00:00.000Z' }
          }
        }
      })
    )
    let ctx = createContext({
      cwd,
      realHome,
      home: mockHome,
      inheritedConfigDir: join(mockHome, 'wrong-profile'),
      sharedNativeCredential: true,
      commandLog,
      requireDefaultConfigDirForNative: true,
      requireRealHomeForIdentity: true
    })
    const progress = vi.fn()
    const added = await manageClaudeAccount(ctx, {
      action: 'add',
      account: 'desktop',
      onProgress: progress
    })
    expect(added).toMatchObject({
      accountKey: 'desktop',
      account: {
        email: 'desktop@example.test',
        status: 'ready',
        quota: undefined
      },
      message: expect.stringMatching(/existing machine-wide Claude login/i)
    })
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/existing machine-wide Claude login/i)
    }))
    expect((await readFile(commandLog, 'utf8')).trim().split('\n')).toEqual([
      '["auth","status","--json"]'
    ])
    const globalConfig = await readGlobalConfig(realHome)
    expect((globalConfig.adapters?.['claude-code'] as any).accounts.desktop).toMatchObject({
      auth: {
        storage: 'device',
        type: 'claude-native-credential-store',
        portability: 'device-bound'
      },
      email: 'desktop@example.test',
      organizationId: 'org-desktop'
    })
    ctx = createContext({
      cwd,
      realHome,
      home: mockHome,
      inheritedConfigDir: join(mockHome, 'wrong-profile'),
      sharedNativeCredential: true,
      userConfig: globalConfig,
      requireDefaultConfigDirForNative: true,
      requireRealHomeForIdentity: true
    })
    const accounts = await getClaudeAccounts(ctx, {})
    expect(accounts).toMatchObject({
      defaultAccount: 'desktop',
      accounts: expect.arrayContaining([
        expect.objectContaining({ key: 'desktop', status: 'ready', quota: undefined })
      ])
    })
    expect(accounts.accounts.map(account => account.key)).toEqual(['desktop'])
    await expect(resolveClaudeRuntimeAccount({ ctx, requestedAccount: 'desktop' }))
      .resolves.toEqual({ accountKey: 'desktop', credentialHome: 'default', managed: true })
  })

  it('marks native credentials as device-bound and requires login on a second device', async () => {
    const cwd = await createTempDir('ow-claude-device-workspace-')
    const firstHome = await createTempDir('ow-claude-first-home-')
    const firstCtx = createContext({ cwd, realHome: firstHome, deviceCredential: true })

    await manageClaudeAccount(firstCtx, { action: 'add', account: 'device' })
    const globalConfig = await readGlobalConfig(firstHome)
    expect((globalConfig.adapters?.['claude-code'] as any).accounts.device.auth).toMatchObject({
      storage: 'device',
      type: 'claude-native-credential-store',
      portability: 'device-bound'
    })

    const secondHome = await createTempDir('ow-claude-second-home-')
    const secondCtx = createContext({
      cwd,
      realHome: secondHome,
      userConfig: globalConfig,
      authOverride: true
    })
    await mkdir(join(secondHome, '.oneworks'), { recursive: true })
    await writeFile(join(secondHome, '.oneworks', '.oo.config.json'), JSON.stringify(globalConfig))
    const secondConfigDir = join(
      resolveGlobalAdapterAccountDir(secondCtx.env, 'claude-code', 'device'),
      'config'
    )
    await mkdir(secondConfigDir, { recursive: true })
    await writeFile(
      join(secondConfigDir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'stale-token' } })
    )
    await expect(resolveClaudeRuntimeAccount({
      ctx: secondCtx,
      requestedAccount: 'device'
    })).rejects.toThrow(/not authenticated on this device/i)
    await expect(access(join(secondConfigDir, '.credentials.json'))).rejects.toThrow()

    const accounts = await getClaudeAccounts(secondCtx, {})
    expect(accounts.accounts[0]).toMatchObject({ key: 'device', status: 'missing' })
  })

  it('keeps an existing device-bound login when reauthentication is aborted before spawn', async () => {
    const cwd = await createTempDir('ow-claude-device-abort-workspace-')
    const realHome = await createTempDir('ow-claude-device-abort-home-')
    let ctx = createContext({ cwd, realHome, deviceCredential: true })

    await manageClaudeAccount(ctx, { action: 'add', account: 'device' })
    const globalConfig = await readGlobalConfig(realHome)
    ctx = createContext({ cwd, realHome, deviceCredential: true, userConfig: globalConfig })
    const controller = new AbortController()
    controller.abort()

    await expect(manageClaudeAccount(ctx, {
      action: 'reauthenticate',
      account: 'device',
      signal: controller.signal
    })).rejects.toMatchObject({ name: 'AbortError' })

    const configDir = join(
      resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'device'),
      'config'
    )
    await expect(access(join(configDir, '.native-login'))).resolves.toBeUndefined()
    await expect(getClaudeAccounts(ctx, {})).resolves.toMatchObject({
      accounts: [expect.objectContaining({ key: 'device', status: 'ready' })]
    })
  })

  it('does not start device-bound reauthentication when aborted during CLI resolution', async () => {
    const cwd = await createTempDir('ow-claude-device-resolve-abort-workspace-')
    const realHome = await createTempDir('ow-claude-device-resolve-abort-home-')
    let ctx = createContext({ cwd, realHome, deviceCredential: true })

    await manageClaudeAccount(ctx, { action: 'add', account: 'device' })
    const globalConfig = await readGlobalConfig(realHome)
    ctx = createContext({ cwd, realHome, deviceCredential: true, userConfig: globalConfig })

    let releaseEnsure!: () => void
    let markEnsureStarted!: () => void
    cliMock.beforeResolve = new Promise<void>((resolve) => {
      releaseEnsure = resolve
    })
    const ensureStarted = new Promise<void>((resolve) => {
      markEnsureStarted = resolve
    })
    cliMock.onEnsure = markEnsureStarted
    const controller = new AbortController()
    const reauthenticate = manageClaudeAccount(ctx, {
      action: 'reauthenticate',
      account: 'device',
      signal: controller.signal
    })

    await ensureStarted
    controller.abort()
    releaseEnsure()
    await expect(reauthenticate).rejects.toMatchObject({ name: 'AbortError' })

    const configDir = join(
      resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'device'),
      'config'
    )
    await expect(access(join(configDir, '.native-login'))).resolves.toBeUndefined()
    await expect(getClaudeAccounts(ctx, {})).resolves.toMatchObject({
      accounts: [expect.objectContaining({ key: 'device', status: 'ready' })]
    })
  })

  it('marks isolated device-bound auth missing after a spawned reauthentication fails', async () => {
    const cwd = await createTempDir('ow-claude-device-spawn-abort-workspace-')
    const realHome = await createTempDir('ow-claude-device-spawn-abort-home-')
    const commandLog = join(await createTempDir('ow-claude-device-spawn-abort-log-'), 'commands.jsonl')
    let ctx = createContext({ cwd, realHome, deviceCredential: true })

    await manageClaudeAccount(ctx, { action: 'add', account: 'device' })
    const globalConfig = await readGlobalConfig(realHome)
    ctx = createContext({
      cwd,
      realHome,
      userConfig: globalConfig,
      deviceCredential: true,
      commandLog,
      ignoreLoginSigterm: true,
      loginDelayMs: 300
    })
    const controller = new AbortController()

    await expect(manageClaudeAccount(ctx, {
      action: 'reauthenticate',
      account: 'device',
      signal: controller.signal,
      onProgress: (event) => {
        if (event.stream === 'stdout' && event.message.includes('login started')) controller.abort()
      }
    })).rejects.toThrow(/isolated device credential cannot be rolled back/i)

    expect(await readFile(commandLog, 'utf8')).toContain('["auth","logout"]')
    await expect(getClaudeAccounts(ctx, {})).resolves.toMatchObject({
      accounts: [expect.objectContaining({ key: 'device', status: 'missing' })]
    })
  })

  it('keeps an existing isolated account ready when another isolated login is aborted', async () => {
    const cwd = await createTempDir('ow-claude-new-login-abort-workspace-')
    const realHome = await createTempDir('ow-claude-new-login-abort-home-')
    let ctx = createContext({ cwd, realHome, deviceCredential: true })
    await manageClaudeAccount(ctx, { action: 'add', account: 'device' })
    ctx = createContext({
      cwd,
      realHome,
      userConfig: await readGlobalConfig(realHome),
      deviceCredential: true,
      ignoreLoginSigterm: true,
      loginDelayMs: 300
    })
    const controller = new AbortController()

    await expect(manageClaudeAccount(ctx, {
      action: 'add',
      account: 'new-account',
      signal: controller.signal,
      onProgress: (event) => {
        if (event.stream === 'stdout' && event.message.includes('login started')) controller.abort()
      }
    })).rejects.toThrow(/isolated device credential cannot be rolled back/i)

    await expect(getClaudeAccounts(ctx, {})).resolves.toMatchObject({
      accounts: [expect.objectContaining({ key: 'device', status: 'ready' })]
    })
  })

  it.each([
    ['email', { statusMissingEmail: true }],
    ['organization', { statusMissingOrgId: true }]
  ])('does not persist a first Darwin machine login whose status omits %s', async (_label, statusOptions) => {
    const cwd = await createTempDir('ow-claude-darwin-incomplete-identity-workspace-')
    const realHome = await createTempDir('ow-claude-darwin-incomplete-identity-home-')
    platformSpy.mockReturnValue('darwin')
    const ctx = createContext({
      cwd,
      realHome,
      sharedNativeCredential: true,
      ...statusOptions
    })

    await expect(manageClaudeAccount(ctx, { action: 'add', account: 'incomplete' })).rejects.toThrow(
      /isolated device credential cannot be rolled back/i
    )

    await expect(readGlobalConfig(realHome)).rejects.toThrow()
    const bindingPath = join(
      dirname(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'incomplete')),
      '.oneworks-device-auth-binding.json'
    )
    await expect(access(bindingPath)).rejects.toThrow()
  })

  it('converts a synced inline snapshot to device auth before leasing it on Darwin', async () => {
    const cwd = await createTempDir('ow-claude-darwin-inline-session-workspace-')
    const realHome = await createTempDir('ow-claude-darwin-inline-session-home-')
    const commandLog = join(await createTempDir('ow-claude-darwin-inline-session-log-'), 'commands.jsonl')
    let ctx = createContext({ cwd, realHome })

    await manageClaudeAccount(ctx, { action: 'add', account: 'portable' })
    const originalConfig = await readGlobalConfig(realHome)
    const originalAccount = (originalConfig.adapters?.['claude-code'] as any).accounts.portable
    platformSpy.mockReturnValue('darwin')
    ctx = createContext({
      cwd,
      realHome,
      userConfig: originalConfig,
      sharedNativeCredential: true,
      deviceCredential: true,
      loginEmail: 'portable@example.test',
      loginOrgId: 'org-portable',
      commandLog
    })
    await manageClaudeAccount(ctx, { action: 'reauthenticate', account: 'portable' })
    const reboundConfig = await readGlobalConfig(realHome)
    const reboundAccount = (reboundConfig.adapters?.['claude-code'] as any).accounts.portable
    expect(reboundAccount.auth).toMatchObject({
      storage: 'device',
      type: 'claude-native-credential-store',
      portability: 'device-bound'
    })
    expect(reboundAccount.auth.token).toBeUndefined()
    expect(reboundAccount.authDigest).not.toBe(originalAccount.authDigest)
    expect(reboundAccount.credentialRevision).not.toBe(originalAccount.credentialRevision)
    const configDir = join(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'portable'), 'config')
    await expect(access(join(configDir, '.credentials.json'))).rejects.toThrow()
    await expect(access(join(configDir, '.oneworks-credential-revision'))).rejects.toThrow()
    ctx = createContext({
      cwd,
      realHome,
      userConfig: reboundConfig,
      sharedNativeCredential: true,
      deviceCredential: true,
      loginEmail: 'other@example.test',
      loginOrgId: 'org-other',
      commandLog
    })

    const releaseSession = await acquireClaudeAccountSessionLease(ctx, 'portable')
    await expect(manageClaudeAccount(ctx, { action: 'add', account: 'other' }))
      .resolves.toMatchObject({ accountKey: 'other' })
    await releaseSession()
    const commands = (await readFile(commandLog, 'utf8')).trim().split('\n')
    expect(commands.filter(command => command === '["auth","login","--claudeai"]')).toHaveLength(2)
    expect(commands.filter(command => command === '["auth","status","--json"]').length).toBeGreaterThanOrEqual(2)
  })

  it('rejects an old Darwin binding after the shared native login changes organization', async () => {
    const cwd = await createTempDir('ow-claude-darwin-identity-workspace-')
    const realHome = await createTempDir('ow-claude-darwin-identity-home-')
    platformSpy.mockReturnValue('darwin')
    let ctx = createContext({ cwd, realHome, sharedNativeCredential: true })

    await manageClaudeAccount(ctx, { action: 'add', account: 'device' })
    const globalConfig = await readGlobalConfig(realHome)
    expect((globalConfig.adapters?.['claude-code'] as any).accounts.device).toMatchObject({
      email: 'ada@example.test',
      organizationId: 'org-test'
    })

    await writeFile(
      join(realHome, '.fake-claude-native-login.json'),
      JSON.stringify({ email: 'ada@example.test', orgId: 'org-other' })
    )
    ctx = createContext({ cwd, realHome, userConfig: globalConfig, sharedNativeCredential: true })

    await expect(resolveClaudeRuntimeAccount({
      ctx,
      requestedAccount: 'device'
    })).rejects.toThrow(/not authenticated on this device/i)
    const accounts = await getClaudeAccounts(ctx, {})
    expect(accounts.accounts.find(account => account.key === 'device')).toMatchObject({ status: 'missing' })
    expect(accounts.accounts.find(account => account.key === 'system')).toMatchObject({ status: 'ready' })
  })
})
