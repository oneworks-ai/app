import { Buffer } from 'node:buffer'
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdapterCtx, Config } from '@oneworks/types'
import { resolveGlobalAdapterAccountDir } from '@oneworks/utils'
import { withDirectoryInstallLock } from '@oneworks/utils/install-lock'

import {
  acquireClaudeAccountSessionLease,
  getClaudeAccounts,
  manageClaudeAccount,
  resolveClaudeRuntimeAccount
} from '../src/claude/accounts'

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

const tempDirs: string[] = []
const platformSpy = vi.spyOn(process, 'platform', 'get')

const createTempDir = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const createFakeClaudeCli = async () => {
  const dir = await createTempDir('ow-fake-claude-')
  const scriptPath = join(dir, 'claude')
  await writeFile(
    scriptPath,
    `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
;(async () => {
const args = process.argv.slice(2)
const configDir = process.env.CLAUDE_CONFIG_DIR
const realHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__
const sharedNativeCredential = process.env.FAKE_CLAUDE_SHARED_NATIVE === '1'
const nativeMarkerPath = sharedNativeCredential
  ? path.join(realHome, '.fake-claude-native-login.json')
  : configDir == null ? undefined : path.join(configDir, '.native-login')
if (process.env.FAKE_CLAUDE_COMMAND_LOG) {
  fs.appendFileSync(process.env.FAKE_CLAUDE_COMMAND_LOG, JSON.stringify(args) + '\\n')
}
if (!configDir) {
  if (!(args[0] === 'auth' && args[1] === 'status' && nativeMarkerPath && fs.existsSync(nativeMarkerPath))) {
    console.log(JSON.stringify({ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' }))
    process.exit(1)
  }
}
if (configDir) fs.mkdirSync(configDir, { recursive: true })
const credentialPath = configDir == null ? undefined : path.join(configDir, '.credentials.json')
const statePath = configDir == null ? undefined : path.join(configDir, '.claude.json')
if (args[0] === 'auth' && args[1] === 'login') {
  if (process.env.FAKE_CLAUDE_IGNORE_SIGTERM === '1') process.on('SIGTERM', () => {})
  process.stdout.write('login started\\n')
  const loginDelayMs = Number(process.env.FAKE_CLAUDE_LOGIN_DELAY_MS || 0)
  if (loginDelayMs > 0) await new Promise(resolve => setTimeout(resolve, loginDelayMs))
  if (process.env.FAKE_CLAUDE_DEVICE === '1' || sharedNativeCredential) fs.writeFileSync(nativeMarkerPath, JSON.stringify({
    email: process.env.FAKE_CLAUDE_LOGIN_EMAIL || 'ada@example.test',
    orgId: process.env.FAKE_CLAUDE_LOGIN_ORG_ID || 'org-test'
  }))
  else fs.writeFileSync(credentialPath, JSON.stringify({
    claudeAiOauth: { accessToken: process.env.FAKE_CLAUDE_LOGIN_TOKEN || 'test-token' }
  }))
  fs.writeFileSync(statePath, JSON.stringify({
    oauthAccount: {
      displayName: 'Ada',
      emailAddress: 'ada@example.test',
      accessToken: 'test-nested-secret'
    },
    cachedUsageUtilization: {
      accessToken: 'test-nested-secret',
      fetchedAtMs: 1700000000000,
      utilization: {
        five_hour: {
          utilization: 42,
          resets_at: '2030-01-01T00:00:00.000Z',
          accessToken: 'test-nested-secret'
        },
        seven_day: { utilization: 18, resets_at: '2030-01-07T00:00:00.000Z' },
        extra_usage: { is_enabled: true, utilization: 9, accessToken: 'test-nested-secret' }
      }
    }
  }))
  console.log('login complete')
  process.exit(0)
}
if (args[0] === 'auth' && args[1] === 'logout') {
  if (credentialPath) fs.rmSync(credentialPath, { force: true })
  if (nativeMarkerPath) fs.rmSync(nativeMarkerPath, { force: true })
  console.log('logout complete')
  process.exit(0)
}
if (args[0] === 'auth' && args[1] === 'status') {
  if (
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    process.env.ANTHROPIC_BASE_URL ||
    process.env.ANTHROPIC_CUSTOM_HEADERS ||
    process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN ||
    process.env.CLAUDE_CODE_OAUTH_SCOPES ||
    process.env.CLAUDE_CODE_OAUTH_TOKEN
  ) {
    console.log(JSON.stringify({
      loggedIn: true,
      authMethod: 'api_key',
      apiProvider: 'firstParty'
    }))
    process.exit(0)
  }
  const nativeLoggedIn = nativeMarkerPath != null && fs.existsSync(nativeMarkerPath)
  const loggedIn = nativeLoggedIn || (!sharedNativeCredential && credentialPath != null && fs.existsSync(credentialPath))
  let nativeIdentity = {}
  if (nativeLoggedIn) {
    try {
      nativeIdentity = JSON.parse(fs.readFileSync(nativeMarkerPath, 'utf8'))
    } catch {}
  }
  const readyStatus = {
    loggedIn: true,
    authMethod: 'claude.ai',
    apiProvider: 'firstParty',
    email: process.env.FAKE_CLAUDE_STATUS_EMAIL || nativeIdentity.email || 'ada@example.test',
    orgId: process.env.FAKE_CLAUDE_STATUS_ORG_ID || nativeIdentity.orgId || 'org-test',
    orgName: 'Example',
    subscriptionType: 'pro'
  }
  if (process.env.FAKE_CLAUDE_STATUS_MISSING_AUTH_METHOD === '1') delete readyStatus.authMethod
  if (process.env.FAKE_CLAUDE_STATUS_MISSING_PROVIDER === '1') delete readyStatus.apiProvider
  if (process.env.FAKE_CLAUDE_STATUS_MISSING_EMAIL === '1') delete readyStatus.email
  if (process.env.FAKE_CLAUDE_STATUS_MISSING_ORG_ID === '1') delete readyStatus.orgId
  console.log(JSON.stringify(loggedIn ? readyStatus : { loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' }))
  process.exit(loggedIn ? 0 : 1)
}
console.error('unsupported fake claude command')
process.exit(2)
})()
`
  )
  await chmod(scriptPath, 0o755)
  return scriptPath
}

const createContext = (params: {
  cwd: string
  realHome: string
  userConfig?: Config
  deviceCredential?: boolean
  sharedNativeCredential?: boolean
  authOverride?: boolean
  commandLog?: string
  ignoreLoginSigterm?: boolean
  loginDelayMs?: number
  loginToken?: string
  loginEmail?: string
  loginOrgId?: string
  statusMissingAuthMethod?: boolean
  statusMissingProvider?: boolean
  statusMissingEmail?: boolean
  statusMissingOrgId?: boolean
  statusEmail?: string
  statusOrgId?: string
}): AdapterCtx => ({
  ctxId: 'claude-account-test',
  cwd: params.cwd,
  env: {
    __ONEWORKS_PROJECT_REAL_HOME__: params.realHome,
    ...(params.deviceCredential ? { FAKE_CLAUDE_DEVICE: '1' } : {}),
    ...(params.sharedNativeCredential ? { FAKE_CLAUDE_SHARED_NATIVE: '1' } : {}),
    ...(params.authOverride
      ? {
        ANTHROPIC_API_KEY: 'must-not-bypass-selected-account',
        ANTHROPIC_AUTH_TOKEN: 'must-not-bypass-selected-account',
        ANTHROPIC_BASE_URL: 'https://must-not-bypass-selected-account.example',
        ANTHROPIC_CUSTOM_HEADERS: 'x-must-not-bypass: true',
        CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'must-not-bypass-selected-account',
        CLAUDE_CODE_OAUTH_SCOPES: 'must-not-bypass-selected-account',
        CLAUDE_CODE_OAUTH_TOKEN: 'must-not-bypass-selected-account'
      }
      : {}),
    ...(params.commandLog == null ? {} : { FAKE_CLAUDE_COMMAND_LOG: params.commandLog }),
    ...(params.ignoreLoginSigterm ? { FAKE_CLAUDE_IGNORE_SIGTERM: '1' } : {}),
    ...(params.loginDelayMs == null ? {} : { FAKE_CLAUDE_LOGIN_DELAY_MS: String(params.loginDelayMs) }),
    ...(params.loginToken == null ? {} : { FAKE_CLAUDE_LOGIN_TOKEN: params.loginToken }),
    ...(params.loginEmail == null ? {} : { FAKE_CLAUDE_LOGIN_EMAIL: params.loginEmail }),
    ...(params.loginOrgId == null ? {} : { FAKE_CLAUDE_LOGIN_ORG_ID: params.loginOrgId }),
    ...(params.statusMissingAuthMethod ? { FAKE_CLAUDE_STATUS_MISSING_AUTH_METHOD: '1' } : {}),
    ...(params.statusMissingProvider ? { FAKE_CLAUDE_STATUS_MISSING_PROVIDER: '1' } : {}),
    ...(params.statusMissingEmail ? { FAKE_CLAUDE_STATUS_MISSING_EMAIL: '1' } : {}),
    ...(params.statusMissingOrgId ? { FAKE_CLAUDE_STATUS_MISSING_ORG_ID: '1' } : {}),
    ...(params.statusEmail == null ? {} : { FAKE_CLAUDE_STATUS_EMAIL: params.statusEmail }),
    ...(params.statusOrgId == null ? {} : { FAKE_CLAUDE_STATUS_ORG_ID: params.statusOrgId })
  },
  cache: {
    get: vi.fn(async () => undefined) as AdapterCtx['cache']['get'],
    set: vi.fn(async () => ({ cachePath: '' })) as AdapterCtx['cache']['set']
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  } as unknown as AdapterCtx['logger'],
  configs: [{}, params.userConfig ?? {}]
})

const readGlobalConfig = async (realHome: string) =>
  JSON.parse(
    await readFile(join(realHome, '.oneworks', '.oo.config.json'), 'utf8')
  ) as Config

const waitForPath = async (filePath: string) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(filePath)
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`)
}

beforeEach(async () => {
  platformSpy.mockReturnValue('linux')
  cliMock.path = await createFakeClaudeCli()
  cliMock.beforeResolve = undefined
  cliMock.onEnsure = undefined
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

afterAll(() => {
  platformSpy.mockRestore()
})

describe('claude account lifecycle', () => {
  it('serializes same-key adds before a second official login can change credentials', async () => {
    const cwd = await createTempDir('ow-claude-concurrent-workspace-')
    const realHome = await createTempDir('ow-claude-concurrent-home-')
    const ctx = createContext({ cwd, realHome })
    const progress = vi.fn()

    const outcomes = await Promise.allSettled([
      manageClaudeAccount(ctx, { action: 'add', account: 'shared', onProgress: progress }),
      manageClaudeAccount(ctx, { action: 'add', account: 'shared', onProgress: progress })
    ])

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find(outcome => outcome.status === 'rejected')
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ message: expect.stringMatching(/already exists/i) })
    })
    expect(
      progress.mock.calls.filter(([event]) =>
        event.stream === 'status' && event.message.includes('Starting official Claude login')
      )
    ).toHaveLength(1)

    const globalConfig = await readGlobalConfig(realHome)
    expect(Object.keys((globalConfig.adapters?.['claude-code'] as any).accounts)).toEqual(['shared'])
  })

  it('uses official auth commands, stores portable credentials, and exposes cached usage', async () => {
    const cwd = await createTempDir('ow-claude-workspace-')
    const realHome = await createTempDir('ow-claude-home-')
    let ctx = createContext({ cwd, realHome })
    const progress = vi.fn()

    const added = await manageClaudeAccount(ctx, {
      action: 'add',
      account: 'Work Account',
      onProgress: progress
    })

    expect(added.accountKey).toBe('work-account')
    expect(added.account).toMatchObject({
      email: 'ada@example.test',
      planType: 'pro',
      status: 'ready',
      quota: {
        summary: '5-hour usage: 42% · 7-day usage: 18%'
      }
    })
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      stream: 'status',
      message: expect.stringContaining('official Claude login')
    }))

    const globalConfig = await readGlobalConfig(realHome)
    const storedAccount = (globalConfig.adapters?.['claude-code'] as any).accounts['work-account']
    expect(storedAccount).toMatchObject({
      auth: {
        storage: 'inline',
        type: 'claude-credentials-json',
        portability: 'portable',
        encoding: 'base64'
      },
      state: {
        type: 'claude-account-state-json',
        portability: 'portable',
        encoding: 'base64'
      },
      source: 'claude-auth-login'
    })
    expect(Buffer.from(storedAccount.auth.token, 'base64').toString('utf8')).toContain('test-token')
    expect(Buffer.from(storedAccount.state.token, 'base64').toString('utf8')).not.toContain('test-nested-secret')
    expect(storedAccount.quota.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'extra-usage', value: '9%' })
    ]))

    ctx = createContext({ cwd, realHome, userConfig: globalConfig })
    const accountConfigDir = join(
      resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'work-account'),
      'config'
    )
    await writeFile(
      join(accountConfigDir, '.claude.json'),
      JSON.stringify({
        oauthAccount: { displayName: 'Ada' },
        cachedUsageUtilization: {
          fetchedAtMs: 1700000001000,
          utilization: {
            five_hour: { utilization: 7, resets_at: '2030-01-01T00:00:00.000Z' }
          }
        }
      })
    )
    await writeFile(
      join(accountConfigDir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'refreshed-token' } })
    )
    const accounts = await getClaudeAccounts(ctx, {})
    expect(accounts).toMatchObject({
      defaultAccount: 'work-account',
      accounts: [{
        key: 'work-account',
        status: 'ready',
        quota: { summary: '5-hour usage: 7%' }
      }]
    })
    await manageClaudeAccount(ctx, { action: 'refresh', account: 'work-account' })
    const refreshedConfig = await readGlobalConfig(realHome)
    const refreshedAccount = (refreshedConfig.adapters?.['claude-code'] as any).accounts['work-account']
    expect(refreshedAccount.credentialRevision).not.toBe(storedAccount.credentialRevision)
    expect(Buffer.from(refreshedAccount.auth.token, 'base64').toString('utf8')).toContain('refreshed-token')
    ctx = createContext({ cwd, realHome, userConfig: refreshedConfig })
    await expect(resolveClaudeRuntimeAccount({
      ctx,
      requestedAccount: 'work-account'
    })).resolves.toMatchObject({
      accountKey: 'work-account',
      configDir: join(
        resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'work-account'),
        'config'
      )
    })

    const releaseSessionLease = await acquireClaudeAccountSessionLease(ctx, 'work-account')
    await expect(manageClaudeAccount(ctx, {
      action: 'remove',
      account: 'work-account'
    })).rejects.toThrow(/active sessions/i)
    await releaseSessionLease()
    await manageClaudeAccount(ctx, { action: 'remove', account: 'work-account' })
    const removedConfig = await readGlobalConfig(realHome)
    expect((removedConfig.adapters?.['claude-code'] as any).accounts).toEqual({})
    expect((removedConfig.adapters?.['claude-code'] as any).accountTombstones['work-account'])
      .toEqual([storedAccount.generation])
    await expect(access(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'work-account'))).rejects.toThrow()
    await expect(resolveClaudeRuntimeAccount({
      ctx,
      requestedAccount: 'work-account'
    })).rejects.toThrow(/deleted before this operation/i)
    await expect(access(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'work-account'))).rejects.toThrow()
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

  it('kills an aborted login before recovery and prevents a delayed portable credential overwrite', async () => {
    const cwd = await createTempDir('ow-claude-portable-late-write-workspace-')
    const realHome = await createTempDir('ow-claude-portable-late-write-home-')
    let ctx = createContext({ cwd, realHome })

    await manageClaudeAccount(ctx, { action: 'add', account: 'portable' })
    const globalConfig = await readGlobalConfig(realHome)
    ctx = createContext({
      cwd,
      realHome,
      userConfig: globalConfig,
      ignoreLoginSigterm: true,
      loginDelayMs: 300,
      loginToken: 'late-token'
    })
    const controller = new AbortController()

    await expect(manageClaudeAccount(ctx, {
      action: 'reauthenticate',
      account: 'portable',
      signal: controller.signal,
      onProgress: (event) => {
        if (event.stream === 'stdout' && event.message.includes('login started')) controller.abort()
      }
    })).rejects.toMatchObject({ name: 'AbortError' })

    const configDir = join(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'portable'), 'config')
    const assertRestoredSnapshot = async () => {
      const credential = await readFile(join(configDir, '.credentials.json'), 'utf8')
      expect(credential).toContain('test-token')
      expect(credential).not.toContain('late-token')
      expect(await readFile(join(configDir, '.oneworks-credential-revision'), 'utf8')).not.toBe('')
    }
    await assertRestoredSnapshot()
    await new Promise(resolve => setTimeout(resolve, 350))
    await assertRestoredSnapshot()
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

  it('waits for a killed Darwin reauthentication before marking synced inline auth missing', async () => {
    const cwd = await createTempDir('ow-claude-darwin-abort-workspace-')
    const realHome = await createTempDir('ow-claude-darwin-abort-home-')
    const commandLog = join(await createTempDir('ow-claude-darwin-abort-log-'), 'commands.jsonl')
    let ctx = createContext({ cwd, realHome })

    await manageClaudeAccount(ctx, { action: 'add', account: 'portable' })
    const globalConfig = await readGlobalConfig(realHome)
    platformSpy.mockReturnValue('darwin')
    ctx = createContext({
      cwd,
      realHome,
      userConfig: globalConfig,
      sharedNativeCredential: true,
      commandLog,
      ignoreLoginSigterm: true,
      loginDelayMs: 300
    })
    const controller = new AbortController()

    await expect(manageClaudeAccount(ctx, {
      action: 'reauthenticate',
      account: 'portable',
      signal: controller.signal,
      onProgress: (event) => {
        if (event.stream === 'stdout' && event.message.includes('login started')) controller.abort()
      }
    })).rejects.toThrow(/cannot be rolled back per account/i)

    const commands = await readFile(commandLog, 'utf8')
    expect(commands).toContain('["auth","login","--claudeai"]')
    expect(commands).not.toContain('["auth","logout"]')
    await new Promise(resolve => setTimeout(resolve, 350))
    await expect(access(join(realHome, '.fake-claude-native-login.json'))).rejects.toThrow()
    const configDir = join(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'portable'), 'config')
    expect(await readFile(join(configDir, '.credentials.json'), 'utf8')).toContain('test-token')
    expect(await readFile(join(configDir, '.oneworks-credential-revision'), 'utf8')).not.toBe('')
    const accounts = await getClaudeAccounts(ctx, {})
    expect(accounts.accounts.find(account => account.key === 'portable')).toMatchObject({ status: 'missing' })
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

  it.each([
    ['missing', undefined],
    ['unknown', { storage: 'future', type: 'future-credential' }],
    ['malformed', {
      storage: 'inline',
      type: 'claude-credentials-json',
      encoding: 'base64',
      portability: 'portable',
      token: Buffer.from('not-json', 'utf8').toString('base64')
    }]
  ])('purges stale materialized credentials for a %s managed auth envelope', async (key, auth) => {
    const cwd = await createTempDir(`ow-claude-${key}-envelope-workspace-`)
    const realHome = await createTempDir(`ow-claude-${key}-envelope-home-`)
    const account = {
      ...(auth == null ? {} : { auth }),
      generation: `generation-${key}`,
      credentialRevision: '1:00000000-0000-4000-8000-000000000001'
    }
    const userConfig = {
      adapters: {
        'claude-code': {
          accounts: { [key]: account },
          defaultAccount: key
        }
      }
    } as unknown as Config
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(join(realHome, '.oneworks', '.oo.config.json'), JSON.stringify(userConfig))
    const ctx = createContext({ cwd, realHome, userConfig })
    const configDir = join(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', key), 'config')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, '.credentials.json'), JSON.stringify({ stale: true }))
    await writeFile(join(configDir, '.oneworks-credential-revision'), 'stale-generation')

    await expect(resolveClaudeRuntimeAccount({
      ctx,
      requestedAccount: key
    })).rejects.toThrow(/credential|storage mode/i)
    await expect(access(join(configDir, '.credentials.json'))).rejects.toThrow()
    await expect(access(join(configDir, '.oneworks-credential-revision'))).rejects.toThrow()
  })

  it.each([
    ['auth method', { statusMissingAuthMethod: true }],
    ['provider', { statusMissingProvider: true }],
    ['email', { statusMissingEmail: true }],
    ['organization', { statusMissingOrgId: true }],
    ['organization identity', { statusOrgId: 'org-other' }]
  ])('fails closed when official managed auth status has invalid or missing %s', async (_label, statusOptions) => {
    const cwd = await createTempDir('ow-claude-status-schema-workspace-')
    const realHome = await createTempDir('ow-claude-status-schema-home-')
    let ctx = createContext({ cwd, realHome })
    await manageClaudeAccount(ctx, { action: 'add', account: 'portable' })
    ctx = createContext({
      cwd,
      realHome,
      userConfig: await readGlobalConfig(realHome),
      ...statusOptions
    })

    await expect(resolveClaudeRuntimeAccount({
      ctx,
      requestedAccount: 'portable'
    })).rejects.toThrow(/not authenticated on this device/i)
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

  it('checks the expected generation inside the global config lock before removal', async () => {
    const cwd = await createTempDir('ow-claude-remove-cas-workspace-')
    const realHome = await createTempDir('ow-claude-remove-cas-home-')
    const commandLog = join(await createTempDir('ow-claude-remove-cas-log-'), 'commands.jsonl')
    let ctx = createContext({ cwd, realHome })
    await manageClaudeAccount(ctx, { action: 'add', account: 'portable' })
    const configPath = join(realHome, '.oneworks', '.oo.config.json')
    ctx = createContext({
      cwd,
      realHome,
      userConfig: await readGlobalConfig(realHome),
      commandLog
    })

    let removal!: Promise<unknown>
    await withDirectoryInstallLock({ lockDir: `${configPath}.oneworks-write-lock` }, async () => {
      removal = manageClaudeAccount(ctx, { action: 'remove', account: 'portable' })
      const accountDir = resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'portable')
      await waitForPath(`${accountDir}.oneworks-operation-lock`)
      await new Promise(resolve => setTimeout(resolve, 25))
      const changed = await readGlobalConfig(realHome) as any
      changed.adapters['claude-code'].accounts.portable.generation = 'generation-raced'
      await writeFile(configPath, JSON.stringify(changed))
    })

    await expect(removal).rejects.toThrow(/changed while removal was waiting/i)
    await expect(readFile(commandLog, 'utf8')).rejects.toThrow()
    expect((await readGlobalConfig(realHome)).adapters?.['claude-code']).toMatchObject({
      accounts: { portable: { generation: 'generation-raced' } }
    })
  })

  it('reports unresolved secret references as missing on this device', async () => {
    const cwd = await createTempDir('ow-claude-secret-workspace-')
    const realHome = await createTempDir('ow-claude-secret-home-')
    const userConfig = {
      adapters: {
        'claude-code': {
          accounts: {
            secret: {
              auth: {
                portability: 'portable',
                ref: 'secret://personal/claude-code/secret/1',
                storage: 'secret',
                type: 'claude-credentials-json'
              },
              generation: 'generation-secret',
              title: 'Secret account'
            }
          },
          defaultAccount: 'secret'
        }
      }
    } as Config
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(join(realHome, '.oneworks', '.oo.config.json'), JSON.stringify(userConfig))
    const ctx = createContext({ cwd, realHome, userConfig })

    await expect(getClaudeAccounts(ctx, {})).resolves.toMatchObject({
      accounts: [{ key: 'secret', status: 'missing' }]
    })
    await expect(resolveClaudeRuntimeAccount({
      ctx,
      requestedAccount: 'secret'
    })).rejects.toThrow(/not available on this device/i)
  })
})
