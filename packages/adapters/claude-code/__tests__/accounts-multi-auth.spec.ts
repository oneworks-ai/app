import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { acquireClaudeAccountSessionLease, getClaudeAccounts, manageClaudeAccount } from '../src/claude/accounts'
import {
  createClaudeAccountsTestContext as createContext,
  createClaudeAccountsTestHarness,
  readClaudeAccountsTestGlobalConfig as readGlobalConfig
} from './accounts.test-helpers'

const cliMock = vi.hoisted(() => ({ path: '' }))

vi.mock('../src/claude/cli', () => ({
  ensureClaudeCliPath: vi.fn(async () => cliMock.path)
}))

const { cleanup, createFakeClaudeCli, createTempDir } = createClaudeAccountsTestHarness()
const platformSpy = vi.spyOn(process, 'platform', 'get')

beforeEach(async () => {
  platformSpy.mockReturnValue('darwin')
  cliMock.path = await createFakeClaudeCli()
})

afterEach(async () => {
  await cleanup()
})

afterAll(() => {
  platformSpy.mockRestore()
})

describe('claude concurrent account auth', () => {
  it('runs two isolated device-bound accounts concurrently on Darwin', async () => {
    const cwd = await createTempDir('ow-claude-device-resource-workspace-')
    const realHome = await createTempDir('ow-claude-device-resource-home-')
    let ctx = createContext({
      cwd,
      realHome,
      deviceCredential: true,
      loginEmail: 'device-a@example.test',
      loginOrgId: 'org-a'
    })

    await manageClaudeAccount(ctx, { action: 'add', account: 'device-a' })
    ctx = createContext({
      cwd,
      realHome,
      deviceCredential: true,
      loginEmail: 'device-b@example.test',
      loginOrgId: 'org-b',
      userConfig: await readGlobalConfig(realHome)
    })
    await manageClaudeAccount(ctx, { action: 'add', account: 'device-b' })
    ctx = createContext({ cwd, realHome, deviceCredential: true, userConfig: await readGlobalConfig(realHome) })

    await expect(getClaudeAccounts(ctx, {})).resolves.toMatchObject({
      accounts: expect.arrayContaining([
        expect.objectContaining({ key: 'device-a', email: 'device-a@example.test', status: 'ready' }),
        expect.objectContaining({ key: 'device-b', email: 'device-b@example.test', status: 'ready' })
      ])
    })

    const releaseDeviceA = await acquireClaudeAccountSessionLease(ctx, 'device-a')
    const releaseDeviceB = await acquireClaudeAccountSessionLease(ctx, 'device-b')
    await releaseDeviceB()
    await releaseDeviceA()
  })

  it('keeps the Desktop account active while adding, running, and removing an isolated account', async () => {
    const cwd = await createTempDir('ow-claude-desktop-isolated-workspace-')
    const realHome = await createTempDir('ow-claude-desktop-isolated-home-')
    const commandLog = join(await createTempDir('ow-claude-desktop-isolated-log-'), 'commands.jsonl')
    const desktopMarker = join(realHome, '.fake-claude-native-login.json')
    await writeFile(desktopMarker, JSON.stringify({ email: 'desktop@example.test', orgId: 'org-desktop' }))
    let ctx = createContext({
      cwd,
      realHome,
      sharedNativeCredential: true,
      deviceCredential: true,
      commandLog
    })

    await manageClaudeAccount(ctx, { action: 'add', account: 'desktop' })
    ctx = createContext({
      cwd,
      realHome,
      sharedNativeCredential: true,
      deviceCredential: true,
      loginEmail: 'work@example.test',
      loginOrgId: 'org-work',
      userConfig: await readGlobalConfig(realHome),
      commandLog
    })

    const releaseDesktop = await acquireClaudeAccountSessionLease(ctx, 'desktop')
    await manageClaudeAccount(ctx, { action: 'add', account: 'work' })
    ctx = createContext({
      cwd,
      realHome,
      sharedNativeCredential: true,
      deviceCredential: true,
      userConfig: await readGlobalConfig(realHome),
      commandLog
    })
    const releaseWork = await acquireClaudeAccountSessionLease(ctx, 'work')
    const accounts = await getClaudeAccounts(ctx, {})
    expect(accounts.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'desktop', email: 'desktop@example.test', status: 'ready' }),
      expect.objectContaining({ key: 'work', email: 'work@example.test', status: 'ready' })
    ]))
    expect(accounts.accounts.map(account => account.key)).not.toContain('system')

    await releaseWork()
    await expect(manageClaudeAccount(ctx, { action: 'remove', account: 'work' }))
      .resolves.toMatchObject({ message: expect.stringMatching(/logged out and removed/i) })
    await releaseDesktop()

    expect(JSON.parse(await readFile(desktopMarker, 'utf8'))).toEqual({
      email: 'desktop@example.test',
      orgId: 'org-desktop'
    })
    expect(await readFile(commandLog, 'utf8')).toContain('["auth","logout"]')
    ctx = createContext({
      cwd,
      realHome,
      sharedNativeCredential: true,
      deviceCredential: true,
      userConfig: await readGlobalConfig(realHome)
    })
    await expect(getClaudeAccounts(ctx, {})).resolves.toMatchObject({
      accounts: [expect.objectContaining({ key: 'desktop', status: 'ready' })]
    })
    const commandsBeforeDesktopRemoval = await readFile(commandLog, 'utf8')
    await expect(manageClaudeAccount(ctx, { action: 'remove', account: 'desktop' }))
      .resolves.toMatchObject({ message: expect.stringMatching(/shared native credential store was left signed in/i) })
    expect(await readFile(commandLog, 'utf8')).toBe(commandsBeforeDesktopRemoval)
    expect(JSON.parse(await readFile(desktopMarker, 'utf8'))).toEqual({
      email: 'desktop@example.test',
      orgId: 'org-desktop'
    })
  })

  it('rejects an isolated login that duplicates the Desktop identity', async () => {
    const cwd = await createTempDir('ow-claude-duplicate-workspace-')
    const realHome = await createTempDir('ow-claude-duplicate-home-')
    const commandLog = join(await createTempDir('ow-claude-duplicate-log-'), 'commands.jsonl')
    await writeFile(
      join(realHome, '.fake-claude-native-login.json'),
      JSON.stringify({ email: 'same@example.test', orgId: 'org-same' })
    )
    let ctx = createContext({ cwd, realHome, sharedNativeCredential: true, deviceCredential: true })
    await manageClaudeAccount(ctx, { action: 'add', account: 'desktop' })
    ctx = createContext({
      cwd,
      realHome,
      sharedNativeCredential: true,
      deviceCredential: true,
      loginEmail: 'same@example.test',
      loginOrgId: 'org-same',
      userConfig: await readGlobalConfig(realHome),
      commandLog
    })

    await expect(manageClaudeAccount(ctx, { action: 'add', account: 'duplicate' }))
      .rejects.toThrow(/already (connected|available)/i)
    expect(await readFile(commandLog, 'utf8')).toContain('["auth","logout"]')
    ctx = createContext({
      cwd,
      realHome,
      sharedNativeCredential: true,
      deviceCredential: true,
      userConfig: await readGlobalConfig(realHome)
    })
    const accounts = await getClaudeAccounts(ctx, {})
    expect(accounts.accounts.map(account => account.key)).toEqual(['desktop'])
  })

  it('commits only one of two concurrent logins for the same identity', async () => {
    const cwd = await createTempDir('ow-claude-concurrent-duplicate-workspace-')
    const realHome = await createTempDir('ow-claude-concurrent-duplicate-home-')
    await writeFile(
      join(realHome, '.fake-claude-native-login.json'),
      JSON.stringify({ email: 'desktop@example.test', orgId: 'org-desktop' })
    )
    let ctx = createContext({ cwd, realHome, sharedNativeCredential: true, deviceCredential: true })
    await manageClaudeAccount(ctx, { action: 'add', account: 'desktop' })
    ctx = createContext({
      cwd,
      realHome,
      sharedNativeCredential: true,
      deviceCredential: true,
      loginEmail: 'duplicate@example.test',
      loginOrgId: 'org-duplicate',
      userConfig: await readGlobalConfig(realHome)
    })

    const outcomes = await Promise.allSettled([
      manageClaudeAccount(ctx, { action: 'add', account: 'duplicate-a' }),
      manageClaudeAccount(ctx, { action: 'add', account: 'duplicate-b' })
    ])
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1)
    expect(outcomes.find(outcome => outcome.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ message: expect.stringMatching(/already connected/i) })
    })

    ctx = createContext({
      cwd,
      realHome,
      sharedNativeCredential: true,
      deviceCredential: true,
      userConfig: await readGlobalConfig(realHome)
    })
    const accounts = await getClaudeAccounts(ctx, {})
    expect(accounts.accounts).toHaveLength(2)
    expect(accounts.accounts.filter(account => account.email === 'duplicate@example.test')).toHaveLength(1)
  })

  it('prefers the ready Desktop login over a missing synced card for the same identity', async () => {
    const cwd = await createTempDir('ow-claude-synced-duplicate-workspace-')
    const firstHome = await createTempDir('ow-claude-synced-duplicate-first-home-')
    const firstCtx = createContext({
      cwd,
      realHome: firstHome,
      deviceCredential: true,
      loginEmail: 'shared@example.test',
      loginOrgId: 'org-shared'
    })
    await manageClaudeAccount(firstCtx, { action: 'add', account: 'synced' })
    const globalConfig = await readGlobalConfig(firstHome)

    const secondHome = await createTempDir('ow-claude-synced-duplicate-second-home-')
    await mkdir(join(secondHome, '.oneworks'), { recursive: true })
    await writeFile(join(secondHome, '.oneworks', '.oo.config.json'), JSON.stringify(globalConfig))
    await writeFile(
      join(secondHome, '.fake-claude-native-login.json'),
      JSON.stringify({ email: 'shared@example.test', orgId: 'org-shared' })
    )
    const secondCtx = createContext({
      cwd,
      realHome: secondHome,
      sharedNativeCredential: true,
      deviceCredential: true,
      userConfig: globalConfig
    })

    await expect(getClaudeAccounts(secondCtx, {})).resolves.toMatchObject({
      defaultAccount: 'system',
      accounts: [expect.objectContaining({
        key: 'system',
        email: 'shared@example.test',
        status: 'ready',
        isDefault: true
      })]
    })
  })

  it('normalizes historical duplicate managed cards and remaps the default account', async () => {
    const cwd = await createTempDir('ow-claude-historical-duplicate-workspace-')
    const realHome = await createTempDir('ow-claude-historical-duplicate-home-')
    let ctx = createContext({
      cwd,
      realHome,
      deviceCredential: true,
      loginEmail: 'history@example.test',
      loginOrgId: 'org-history'
    })
    await manageClaudeAccount(ctx, { action: 'add', account: 'work' })
    const globalConfig = await readGlobalConfig(realHome)
    const claudeConfig = globalConfig.adapters?.['claude-code'] as any
    claudeConfig.accounts['work-copy'] = {
      ...claudeConfig.accounts.work,
      generation: 'historical-copy-generation'
    }
    claudeConfig.defaultAccount = 'work-copy'
    await writeFile(join(realHome, '.oneworks', '.oo.config.json'), JSON.stringify(globalConfig))
    ctx = createContext({ cwd, realHome, deviceCredential: true, userConfig: globalConfig })

    await expect(getClaudeAccounts(ctx, {})).resolves.toMatchObject({
      defaultAccount: 'work',
      accounts: [expect.objectContaining({
        key: 'work',
        email: 'history@example.test',
        status: 'ready',
        isDefault: true
      })]
    })
  })

  it('keeps an isolated account record when logout is cancelled before spawn', async () => {
    const cwd = await createTempDir('ow-claude-cancel-remove-workspace-')
    const realHome = await createTempDir('ow-claude-cancel-remove-home-')
    let ctx = createContext({ cwd, realHome, deviceCredential: true })
    await manageClaudeAccount(ctx, { action: 'add', account: 'work' })
    ctx = createContext({
      cwd,
      realHome,
      deviceCredential: true,
      userConfig: await readGlobalConfig(realHome)
    })
    const controller = new AbortController()
    controller.abort()

    await expect(manageClaudeAccount(ctx, {
      action: 'remove',
      account: 'work',
      signal: controller.signal
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect((await readGlobalConfig(realHome)).adapters?.['claude-code']).toMatchObject({
      accounts: { work: expect.any(Object) }
    })
    await expect(getClaudeAccounts(ctx, {})).resolves.toMatchObject({
      accounts: [expect.objectContaining({ key: 'work', status: 'ready' })]
    })
  })

  it('refuses a new profile when the installed CLI carries a machine-wide credential into it', async () => {
    const cwd = await createTempDir('ow-claude-machine-wide-workspace-')
    const realHome = await createTempDir('ow-claude-machine-wide-home-')
    const commandLog = join(await createTempDir('ow-claude-machine-wide-log-'), 'commands.jsonl')
    await writeFile(
      join(realHome, '.fake-claude-native-login.json'),
      JSON.stringify({ email: 'desktop@example.test', orgId: 'org-desktop' })
    )
    let ctx = createContext({ cwd, realHome, machineWideNativeCredential: true })
    await manageClaudeAccount(ctx, { action: 'add', account: 'desktop' })
    ctx = createContext({
      cwd,
      realHome,
      machineWideNativeCredential: true,
      userConfig: await readGlobalConfig(realHome),
      commandLog
    })

    await expect(manageClaudeAccount(ctx, { action: 'add', account: 'work' }))
      .rejects.toThrow(/cannot safely prove that the profile is independent/i)
    expect(await readFile(commandLog, 'utf8')).not.toContain('["auth","login","--claudeai"]')
    await expect(getClaudeAccounts(ctx, {})).resolves.toMatchObject({
      accounts: [expect.objectContaining({ key: 'desktop', status: 'ready' })]
    })
  })

  it('fails closed when the default profile cannot be probed before an isolated login', async () => {
    const cwd = await createTempDir('ow-claude-probe-failure-workspace-')
    const realHome = await createTempDir('ow-claude-probe-failure-home-')
    const commandLog = join(await createTempDir('ow-claude-probe-failure-log-'), 'commands.jsonl')
    let ctx = createContext({ cwd, realHome, deviceCredential: true })
    await manageClaudeAccount(ctx, { action: 'add', account: 'existing' })
    ctx = createContext({
      cwd,
      realHome,
      deviceCredential: true,
      invalidDefaultStatus: true,
      userConfig: await readGlobalConfig(realHome),
      commandLog
    })

    await expect(manageClaudeAccount(ctx, { action: 'add', account: 'work' }))
      .rejects.toThrow(/invalid JSON/i)
    expect(await readFile(commandLog, 'utf8')).not.toContain('["auth","login","--claudeai"]')
    expect((await readGlobalConfig(realHome)).adapters?.['claude-code']).toMatchObject({
      accounts: { existing: expect.any(Object) }
    })
  })

  it('fails closed before login when the default credential identity is incomplete', async () => {
    const cwd = await createTempDir('ow-claude-incomplete-peer-workspace-')
    const realHome = await createTempDir('ow-claude-incomplete-peer-home-')
    const commandLog = join(await createTempDir('ow-claude-incomplete-peer-log-'), 'commands.jsonl')
    await writeFile(
      join(realHome, '.fake-claude-native-login.json'),
      JSON.stringify({ email: 'desktop@example.test', orgId: 'org-desktop' })
    )
    const ctx = createContext({
      cwd,
      realHome,
      sharedNativeCredential: true,
      deviceCredential: true,
      defaultStatusMissingEmail: true,
      commandLog
    })

    await expect(manageClaudeAccount(ctx, { action: 'add', account: 'work' }))
      .rejects.toThrow(/email and organization/i)
    expect(await readFile(commandLog, 'utf8')).not.toContain('["auth","login","--claudeai"]')
  })

  it('does not logout a new profile when peer isolation becomes unverifiable after login', async () => {
    const cwd = await createTempDir('ow-claude-post-login-peer-workspace-')
    const realHome = await createTempDir('ow-claude-post-login-peer-home-')
    const commandLog = join(await createTempDir('ow-claude-post-login-peer-log-'), 'commands.jsonl')
    const ctx = createContext({
      cwd,
      realHome,
      deviceCredential: true,
      invalidDefaultStatusAfterLogin: true,
      commandLog
    })

    await expect(manageClaudeAccount(ctx, { action: 'add', account: 'work' }))
      .rejects.toThrow(/could not verify that profile "work" stayed isolated/i)
    const commands = await readFile(commandLog, 'utf8')
    expect(commands).toContain('["auth","login","--claudeai"]')
    expect(commands).not.toContain('["auth","logout"]')
    await expect(readGlobalConfig(realHome)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
