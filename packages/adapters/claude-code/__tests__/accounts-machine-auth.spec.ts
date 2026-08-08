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

  it('marks device-bound auth missing after a spawned reauthentication fails without logging out', async () => {
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
    })).rejects.toThrow(/cannot be rolled back per account/i)

    expect(await readFile(commandLog, 'utf8')).not.toContain('["auth","logout"]')
    await expect(getClaudeAccounts(ctx, {})).resolves.toMatchObject({
      accounts: [expect.objectContaining({ key: 'device', status: 'missing' })]
    })
  })

  it('invalidates an older device binding when a new spawned login leaves machine auth uncertain', async () => {
    const cwd = await createTempDir('ow-claude-new-login-abort-workspace-')
    const realHome = await createTempDir('ow-claude-new-login-abort-home-')
    let ctx = createContext({ cwd, realHome, deviceCredential: true })
    await manageClaudeAccount(ctx, { action: 'add', account: 'device' })
    ctx = createContext({
      cwd,
      realHome,
      userConfig: await readGlobalConfig(realHome),
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
    })).rejects.toThrow(/cannot be rolled back per account/i)

    await expect(getClaudeAccounts(ctx, {})).resolves.toMatchObject({
      accounts: [expect.objectContaining({ key: 'device', status: 'missing' })]
    })
  })

  it('serializes device-bound sessions across accounts and exposes only the active machine binding', async () => {
    const cwd = await createTempDir('ow-claude-device-resource-workspace-')
    const realHome = await createTempDir('ow-claude-device-resource-home-')
    let ctx = createContext({ cwd, realHome, deviceCredential: true })

    await manageClaudeAccount(ctx, { action: 'add', account: 'device-a' })
    ctx = createContext({ cwd, realHome, deviceCredential: true, userConfig: await readGlobalConfig(realHome) })
    await manageClaudeAccount(ctx, { action: 'add', account: 'device-b' })
    ctx = createContext({ cwd, realHome, deviceCredential: true, userConfig: await readGlobalConfig(realHome) })

    await expect(getClaudeAccounts(ctx, {})).resolves.toMatchObject({
      accounts: expect.arrayContaining([
        expect.objectContaining({ key: 'device-a', status: 'missing' }),
        expect.objectContaining({ key: 'device-b', status: 'ready' })
      ])
    })

    const releaseDeviceSession = await acquireClaudeAccountSessionLease(ctx, 'device-b')
    await expect(manageClaudeAccount(ctx, {
      action: 'reauthenticate',
      account: 'device-a'
    })).rejects.toThrow(/native device authentication has active sessions/i)
    await releaseDeviceSession()
  })

  it('removes a device-bound account record without invoking machine-wide logout', async () => {
    const cwd = await createTempDir('ow-claude-device-remove-workspace-')
    const realHome = await createTempDir('ow-claude-device-remove-home-')
    const commandLog = join(await createTempDir('ow-claude-device-remove-log-'), 'commands.jsonl')
    let ctx = createContext({ cwd, realHome, deviceCredential: true })

    await manageClaudeAccount(ctx, { action: 'add', account: 'device' })
    ctx = createContext({
      cwd,
      realHome,
      userConfig: await readGlobalConfig(realHome),
      deviceCredential: true,
      commandLog
    })
    const removed = await manageClaudeAccount(ctx, { action: 'remove', account: 'device' })

    expect(removed.message).toMatch(/shared native credential store was left signed in/i)
    await expect(readFile(commandLog, 'utf8')).rejects.toThrow()
    expect((await readGlobalConfig(realHome)).adapters?.['claude-code']).toMatchObject({ accounts: {} })
  })

  it('treats a synced inline account as machine-bound on Darwin and never logs out another native identity', async () => {
    const cwd = await createTempDir('ow-claude-darwin-synced-workspace-')
    const realHome = await createTempDir('ow-claude-darwin-synced-home-')
    const commandLog = join(await createTempDir('ow-claude-darwin-synced-log-'), 'commands.jsonl')
    let ctx = createContext({ cwd, realHome })

    await manageClaudeAccount(ctx, { action: 'add', account: 'portable' })
    const globalConfig = await readGlobalConfig(realHome)
    expect((globalConfig.adapters?.['claude-code'] as any).accounts.portable.auth.storage).toBe('inline')

    platformSpy.mockReturnValue('darwin')
    const sharedNativeMarker = join(realHome, '.fake-claude-native-login.json')
    await writeFile(sharedNativeMarker, JSON.stringify({ email: 'other@example.test', orgId: 'org-other' }))
    ctx = createContext({
      cwd,
      realHome,
      userConfig: globalConfig,
      sharedNativeCredential: true,
      commandLog
    })

    await expect(resolveClaudeRuntimeAccount({
      ctx,
      requestedAccount: 'portable'
    })).rejects.toThrow(/not authenticated on this device/i)

    const releaseSystemSession = await acquireClaudeAccountSessionLease(ctx, 'system')
    await expect(manageClaudeAccount(ctx, {
      action: 'reauthenticate',
      account: 'portable'
    })).rejects.toThrow(/native device authentication has active sessions/i)
    await releaseSystemSession()

    await expect(manageClaudeAccount(ctx, {
      action: 'remove',
      account: 'system'
    })).rejects.toThrow(/read-only/i)
    const removed = await manageClaudeAccount(ctx, { action: 'remove', account: 'portable' })

    expect(removed.message).toMatch(/shared native credential store was left signed in/i)
    expect(JSON.parse(await readFile(sharedNativeMarker, 'utf8'))).toEqual({
      email: 'other@example.test',
      orgId: 'org-other'
    })
    await expect(readFile(commandLog, 'utf8')).rejects.toThrow()
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
      /cannot be rolled back per account/i
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
    ctx = createContext({ cwd, realHome, userConfig: reboundConfig, sharedNativeCredential: true, commandLog })

    const releaseSession = await acquireClaudeAccountSessionLease(ctx, 'portable')
    await expect(manageClaudeAccount(ctx, { action: 'add', account: 'other' })).rejects.toThrow(
      /native device authentication has active sessions/i
    )
    await releaseSession()
    expect((await readFile(commandLog, 'utf8')).trim().split('\n')).toEqual([
      '["auth","login","--claudeai"]',
      '["auth","status","--json"]'
    ])
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
    expect(accounts.accounts.find(account => account.key === 'device')).toMatchObject({ status: 'error' })
  })
})
