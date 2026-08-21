/* eslint-disable max-lines -- codex account coverage keeps migration and credential scenarios together. */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { withCanonicalConfigWriteLock } from '@oneworks/config'
import { bridgeRealHomeToMockHome } from '@oneworks/register/mock-home-bridge'
import type { AdapterCtx } from '@oneworks/types'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import {
  classifyCodexAccountPoolFailure,
  getCodexAccountDetail,
  getCodexAccounts,
  manageCodexAccount,
  markCodexAccountPoolFailure,
  prepareCodexSessionHome,
  resolveCodexAccountPoolCandidates
} from '#~/runtime/accounts.js'

const credentialFsRaceHooks = vi.hoisted(() => ({
  afterReadFile: undefined as
    | undefined
    | ((params: {
      path: string
    }) => Promise<void>),
  afterReadlink: undefined as
    | undefined
    | ((params: {
      fs: typeof import('node:fs/promises')
      path: string
      target: string
    }) => Promise<void>),
  beforeRename: undefined as
    | undefined
    | ((params: {
      fs: typeof import('node:fs/promises')
      sourcePath: string
      targetPath: string
    }) => Promise<void>),
  rejectCrossDirectoryRename: false,
  crossDirectoryRenameAttempts: 0
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const path = await import('node:path')
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const content = await (actual.readFile as (...params: typeof args) => ReturnType<typeof actual.readFile>)(...args)
      await credentialFsRaceHooks.afterReadFile?.({ path: String(args[0]) })
      return content
    },
    readlink: async (...args: Parameters<typeof actual.readlink>) => {
      const target = await (actual.readlink as (...params: typeof args) => ReturnType<typeof actual.readlink>)(...args)
      await credentialFsRaceHooks.afterReadlink?.({
        fs: actual,
        path: String(args[0]),
        target: String(target)
      })
      return target
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      const sourcePath = String(args[0])
      const targetPath = String(args[1])
      await credentialFsRaceHooks.beforeRename?.({
        fs: actual,
        sourcePath,
        targetPath
      })
      if (
        credentialFsRaceHooks.rejectCrossDirectoryRename &&
        path.dirname(sourcePath) !== path.dirname(targetPath)
      ) {
        credentialFsRaceHooks.crossDirectoryRenameAttempts += 1
        throw Object.assign(new Error('synthetic cross-device rename'), { code: 'EXDEV' })
      }
      return actual.rename(...args)
    }
  }
})

const tempDirs: string[] = []
const originalHome = process.env.HOME
const originalProjectRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

const countOccurrences = (content: string, search: string) => content.split(search).length - 1
const resolveTestMockHome = (workspace: string, realHome: string) =>
  resolveProjectHomePath(workspace, { HOME: realHome, __ONEWORKS_PROJECT_REAL_HOME__: realHome }, '.mock')
const fakeSuccessfulAccountProbe = `
if (process.argv[2] === 'app-server') {
  const readline = await import('node:readline')
  const input = readline.default.createInterface({ input: process.stdin })
  input.on('line', (line) => {
    const message = JSON.parse(line)
    if (message.id == null) return
    const result = message.method === 'account/read'
      ? { account: { type: 'chatgpt', planType: 'pro' } }
      : message.method === 'account/rateLimits/read'
      ? { rateLimits: { limitId: 'codex', planType: 'pro' } }
      : {}
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
  })
}
`

afterEach(async () => {
  credentialFsRaceHooks.afterReadFile = undefined
  credentialFsRaceHooks.afterReadlink = undefined
  credentialFsRaceHooks.beforeRename = undefined
  credentialFsRaceHooks.rejectCrossDirectoryRename = false
  credentialFsRaceHooks.crossDirectoryRenameAttempts = 0
  if (originalHome == null) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
  if (originalProjectRealHome == null) {
    delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
  } else {
    process.env.__ONEWORKS_PROJECT_REAL_HOME__ = originalProjectRealHome
  }
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const createTestCtx = (
  workspace: string,
  overrides: Partial<Pick<AdapterCtx, 'env' | 'configs' | 'logger' | 'cache'>> & {
    cacheStore?: Map<string, unknown>
  } = {}
): AdapterCtx => {
  const cacheStore = overrides.cacheStore ?? new Map<string, unknown>()

  return {
    ctxId: 'ctx',
    cwd: workspace,
    env: overrides.env ?? {
      HOME: resolveTestMockHome(workspace, join(workspace, 'missing-real-home')),
      __ONEWORKS_PROJECT_REAL_HOME__: join(workspace, 'missing-real-home')
    },
    cache: overrides.cache ?? {
      set: async (key: any, value: unknown) => {
        cacheStore.set(String(key), value)
        return { cachePath: '' }
      },
      get: async (key: any) => cacheStore.get(String(key)) as never
    },
    logger: overrides.logger ?? {
      stream: new PassThrough(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    },
    configs: overrides.configs ?? []
  }
}

const createManagedInlineCredentialFixture = async (params: {
  accountId: string
  prefix: string
}) => {
  const workspace = await mkdtemp(join(tmpdir(), params.prefix))
  const realHome = join(workspace, 'real-home')
  const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
  const initialAuthContent = `${
    JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: { account_id: params.accountId, refresh_token: 'initial' }
    })
  }\n`
  const configuredAccount = {
    generation: `synthetic-${params.accountId}-generation`,
    credentialRevision: '1:00000000-0000-4000-8000-000000000001',
    auth: {
      type: 'codex-auth-json',
      encoding: 'base64',
      token: Buffer.from(initialAuthContent, 'utf8').toString('base64')
    }
  }
  const globalConfig = {
    adapters: {
      codex: {
        defaultAccount: 'work',
        accounts: { work: configuredAccount }
      }
    }
  }
  tempDirs.push(workspace)
  await mkdir(join(realHome, '.oneworks'), { recursive: true })
  await writeFile(globalConfigPath, JSON.stringify(globalConfig))
  return {
    configuredAccount,
    ctx: createTestCtx(workspace, {
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      configs: [globalConfig as any]
    }),
    globalConfigPath,
    initialAuthContent,
    workspace
  }
}

describe('prepareCodexSessionHome', () => {
  it('imports the current Codex auth from process HOME when project real home is not set', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-real-home-fallback-'))
    const realHome = join(workspace, 'real-home')
    const authContent = '{"auth_mode":"chatgpt"}\n'
    tempDirs.push(workspace)

    delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
    process.env.HOME = realHome
    await mkdir(join(realHome, '.codex'), { recursive: true })
    await writeFile(join(realHome, '.codex', 'auth.json'), authContent)

    const ctx = createTestCtx(workspace, {
      env: {
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/usr/bin/false'
      }
    })
    const result = await prepareCodexSessionHome({
      ctx,
      sessionId: 'session'
    })
    const authFilePath = result.authFilePath

    expect(authFilePath).toBeDefined()
    expect(await readFile(authFilePath!, 'utf8')).toBe(authContent)
    expect(await readlink(join(result.homeDir, '.codex', 'auth.json'))).toBe(authFilePath)
  })

  it('ignores legacy workspace stored accounts when selecting an account', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-account-meta-race-'))
    tempDirs.push(workspace)

    const ctx = createTestCtx(workspace)
    const accountDir = resolveProjectHomePath(
      workspace,
      ctx.env,
      '.local',
      'adapters',
      'codex',
      'accounts',
      'stored'
    )
    await mkdir(accountDir, { recursive: true })
    await writeFile(join(accountDir, 'auth.json'), '{}\n')
    await writeFile(join(accountDir, 'meta.json'), '{"title":')

    await expect(prepareCodexSessionHome({
      ctx,
      sessionId: 'session',
      account: 'stored'
    })).rejects.toThrow('Codex account "stored" is not available.')
  })

  it('shares, flushes, and reuses one rotated credential owner including an atomic-rename probe', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-global-auth-'))
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const fakeCodexPath = join(workspace, 'fake-codex-app-server.mjs')
    const probeAuthTypePath = join(workspace, 'probe-auth-type.txt')
    const probeAuthPathOutput = join(workspace, 'probe-auth-path.txt')
    const probeAccountReadParamsPath = join(workspace, 'probe-account-read-params.json')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const authContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_global","refresh_token":"initial"}}\n'
    const probeRotatedAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_global","refresh_token":"probe-rotated"}}\n'
    tempDirs.push(workspace)

    const configuredAccount = {
      title: 'Work',
      generation: 'synthetic-generation',
      credentialRevision: '1:00000000-0000-4000-8000-000000000001',
      auth: {
        type: 'codex-auth-json',
        encoding: 'base64',
        token: Buffer.from(authContent, 'utf8').toString('base64')
      }
    }
    const globalConfig = {
      adapters: {
        codex: {
          defaultAccount: 'work',
          accounts: { work: configuredAccount }
        }
      }
    }
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(globalConfig))
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { lstatSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import readline from 'node:readline'

const authPath = join(process.env.HOME, '.codex', 'auth.json')
writeFileSync(${JSON.stringify(probeAuthTypePath)}, lstatSync(authPath).isFile() ? 'file' : 'other')
writeFileSync(${JSON.stringify(probeAuthPathOutput)}, authPath)
const input = readline.createInterface({ input: process.stdin })
const respond = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
input.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id == null) return
  if (message.method === 'account/read') {
    writeFileSync(${JSON.stringify(probeAccountReadParamsPath)}, JSON.stringify(message.params ?? {}))
    const replacementPath = authPath + '.next'
    writeFileSync(replacementPath, ${JSON.stringify(probeRotatedAuthContent)})
    renameSync(replacementPath, authPath)
    respond(message.id, { account: { type: 'chatgpt', planType: 'pro' } })
    return
  }
  if (message.method === 'account/rateLimits/read') {
    respond(message.id, { rateLimits: { limitId: 'codex', planType: 'pro' } })
    return
  }
  respond(message.id, {})
})
`
    )
    await chmod(fakeCodexPath, 0o755)
    const ctx = createTestCtx(workspace, {
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
      },
      configs: [globalConfig as any]
    })

    const [first, second] = await Promise.all([
      prepareCodexSessionHome({ ctx, sessionId: 'session-a' }),
      prepareCodexSessionHome({ ctx, sessionId: 'session-b' })
    ])
    const firstSessionAuthPath = join(first.homeDir, '.codex', 'auth.json')
    const secondSessionAuthPath = join(second.homeDir, '.codex', 'auth.json')

    expect(first.accountKey).toBe('work')
    expect(first.authFilePath).toBe(second.authFilePath)
    expect(first.authFilePath).not.toBe(firstSessionAuthPath)
    expect(await readlink(firstSessionAuthPath)).toBe(first.authFilePath)
    expect(await readlink(secondSessionAuthPath)).toBe(first.authFilePath)
    expect(await readFile(firstSessionAuthPath, 'utf8')).toBe(authContent)
    expect((await lstat(firstSessionAuthPath)).isSymbolicLink()).toBe(true)
    if (process.platform !== 'win32') {
      expect((await stat(first.authFilePath!)).mode & 0o777).toBe(0o600)
      expect((await stat(firstSessionAuthPath)).ino).toBe((await stat(secondSessionAuthPath)).ino)
    }

    const rotatedAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_global","refresh_token":"rotated"}}\n'
    await writeFile(firstSessionAuthPath, rotatedAuthContent)
    expect((await lstat(firstSessionAuthPath)).isSymbolicLink()).toBe(true)
    expect(await readFile(first.authFilePath!, 'utf8')).toBe(rotatedAuthContent)

    const staleInlinePrepare = await prepareCodexSessionHome({
      ctx,
      sessionId: 'session-stale-inline-before-flush'
    })
    const configBeforeLifecycleFlush = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    expect(staleInlinePrepare.authFilePath).toBe(first.authFilePath)
    expect(await readFile(staleInlinePrepare.authFilePath!, 'utf8')).toBe(rotatedAuthContent)
    expect(Buffer.from(configBeforeLifecycleFlush.adapters.codex.accounts.work.auth.token, 'base64').toString('utf8'))
      .toBe(rotatedAuthContent)
    expect(configBeforeLifecycleFlush.adapters.codex.accounts.work.credentialRevision)
      .not.toBe(configuredAccount.credentialRevision)

    await first.reconcileCredentialOwner?.()
    const flushedConfig = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    const flushedAccount = flushedConfig.adapters.codex.accounts.work
    expect(Buffer.from(flushedAccount.auth.token, 'base64').toString('utf8')).toBe(rotatedAuthContent)
    expect(flushedAccount.credentialRevision).not.toBe(configuredAccount.credentialRevision)
    expect(flushedAccount.credentialRevision).toMatch(/^2:/u)
    expect(flushedAccount.generation).toBe(configuredAccount.generation)

    const [later, concurrentLater] = await Promise.all([
      prepareCodexSessionHome({ ctx, sessionId: 'session-c' }),
      prepareCodexSessionHome({ ctx, sessionId: 'session-concurrent-c' })
    ])
    expect(later.authFilePath).toBe(first.authFilePath)
    expect(concurrentLater.authFilePath).toBe(first.authFilePath)
    expect(await readFile(later.authFilePath!, 'utf8')).toBe(rotatedAuthContent)

    const managerOwned = await prepareCodexSessionHome({
      ctx,
      sessionId: 'session-manager-a',
      appServerProfileKey: 'shared-profile',
      sharedAppServerHome: true
    })
    expect(managerOwned.authFilePath).toBe(first.authFilePath)
    await getCodexAccounts(ctx, { refresh: true })
    expect(await readFile(probeAuthTypePath, 'utf8')).toBe('file')
    const probeAuthPath = await readFile(probeAuthPathOutput, 'utf8')
    expect(probeAuthPath).not.toBe(first.authFilePath)
    await expect(lstat(probeAuthPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.parse(await readFile(probeAccountReadParamsPath, 'utf8'))).not.toHaveProperty('refreshToken')
    expect(await readFile(first.authFilePath!, 'utf8')).toBe(probeRotatedAuthContent)
    const probeFlushedConfig = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    expect(Buffer.from(probeFlushedConfig.adapters.codex.accounts.work.auth.token, 'base64').toString('utf8'))
      .toBe(probeRotatedAuthContent)

    const secondDevice = join(workspace, 'second-device')
    const secondRealHome = join(secondDevice, 'real-home')
    await mkdir(join(secondRealHome, '.oneworks'), { recursive: true })
    await writeFile(
      join(secondRealHome, '.oneworks', '.oo.config.json'),
      JSON.stringify(probeFlushedConfig)
    )
    const secondDevicePrepared = await prepareCodexSessionHome({
      ctx: createTestCtx(secondDevice, {
        env: {
          HOME: resolveTestMockHome(secondDevice, secondRealHome),
          __ONEWORKS_PROJECT_REAL_HOME__: secondRealHome
        },
        configs: [probeFlushedConfig]
      }),
      sessionId: 'session-second-device'
    })
    expect(secondDevicePrepared.authFilePath).not.toBe(first.authFilePath)
    expect(await readFile(secondDevicePrepared.authFilePath!, 'utf8')).toBe(probeRotatedAuthContent)

    const replacementAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_global","refresh_token":"replacement"}}\n'
    const probeFlushedAccount = probeFlushedConfig.adapters.codex.accounts.work
    probeFlushedAccount.auth.token = Buffer.from(replacementAuthContent, 'utf8').toString('base64')
    probeFlushedAccount.credentialRevision = '99:00000000-0000-4000-8000-000000000099'
    await writeFile(globalConfigPath, JSON.stringify(probeFlushedConfig))
    const replacement = await prepareCodexSessionHome({ ctx, sessionId: 'session-d' })
    const replacementManagerOwned = await prepareCodexSessionHome({
      ctx,
      sessionId: 'session-manager-b',
      appServerProfileKey: 'shared-profile',
      sharedAppServerHome: true
    })
    expect(replacement.authFilePath).not.toBe(first.authFilePath)
    expect(replacementManagerOwned.authFilePath).toBe(replacement.authFilePath)
    expect(replacementManagerOwned.homeDir).not.toBe(managerOwned.homeDir)
    expect(await readFile(replacement.authFilePath!, 'utf8')).toBe(replacementAuthContent)
  })

  it('reconciles atomic replacements without cross-directory rename across every lifecycle home', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-global-auth-atomic-lifecycle-'))
    const realHome = join(workspace, 'real-home')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    let expectedAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_atomic","refresh_token":"initial"}}\n'
    const configuredAccount = {
      generation: 'synthetic-atomic-generation',
      credentialRevision: '1:00000000-0000-4000-8000-000000000001',
      auth: {
        type: 'codex-auth-json',
        encoding: 'base64',
        token: Buffer.from(expectedAuthContent, 'utf8').toString('base64')
      }
    }
    const globalConfig = {
      adapters: {
        codex: {
          defaultAccount: 'work',
          accounts: { work: configuredAccount }
        }
      }
    }
    tempDirs.push(workspace)
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(globalConfig))
    const ctx = createTestCtx(workspace, {
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      configs: [globalConfig as any]
    })
    const consumers = [
      { label: 'direct', options: {} },
      {
        label: 'stream',
        options: { appServerProfileKey: 'stream-profile', sharedAppServerHome: true }
      },
      {
        label: 'model-sharing',
        options: { appServerProfileKey: 'model-sharing-v1', sharedAppServerHome: false }
      },
      {
        label: 'shared-model',
        options: { appServerProfileKey: 'shared-model-service-v1', sharedAppServerHome: false }
      }
    ] as const
    let ownerPath: string | undefined
    credentialFsRaceHooks.rejectCrossDirectoryRename = true

    for (const [index, consumer] of consumers.entries()) {
      const prepared = await prepareCodexSessionHome({
        ctx,
        sessionId: `session-${consumer.label}`,
        ...consumer.options
      })
      ownerPath ??= prepared.authFilePath
      expect(prepared.authFilePath).toBe(ownerPath)
      const authPath = join(prepared.homeDir, '.codex', 'auth.json')
      expect(await readFile(authPath, 'utf8')).toBe(expectedAuthContent)

      const nextAuthContent = `${
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: {
            account_id: 'acct_atomic',
            refresh_token: `${consumer.label}-${index + 1}`
          }
        })
      }\n`
      const replacementPath = join(prepared.homeDir, '.codex', `auth-${consumer.label}.next`)
      await writeFile(replacementPath, nextAuthContent)
      await rename(replacementPath, authPath)
      expect((await lstat(authPath)).isFile()).toBe(true)

      await prepared.reconcileCredentialOwner?.()

      expect((await lstat(authPath)).isSymbolicLink()).toBe(true)
      expect(await readlink(authPath)).toBe(ownerPath)
      expect(await readFile(ownerPath!, 'utf8')).toBe(nextAuthContent)
      const persisted = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
      expect(Buffer.from(persisted.adapters.codex.accounts.work.auth.token, 'base64').toString('utf8'))
        .toBe(nextAuthContent)
      expectedAuthContent = nextAuthContent
    }
    expect(credentialFsRaceHooks.crossDirectoryRenameAttempts).toBe(0)
  })

  it('retries when the observed regular candidate becomes a symlink before atomic claim', async () => {
    const fixture = await createManagedInlineCredentialFixture({
      accountId: 'acct_claim_swap',
      prefix: 'ow-codex-global-auth-claim-swap-'
    })
    const prepared = await prepareCodexSessionHome({
      ctx: fixture.ctx,
      sessionId: 'session-a',
      appServerProfileKey: 'shared-profile',
      sharedAppServerHome: true
    })
    const authPath = join(prepared.homeDir, '.codex', 'auth.json')
    const rotatedAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_claim_swap","refresh_token":"candidate"}}\n'
    const replacementPath = `${authPath}.next`
    await writeFile(replacementPath, rotatedAuthContent)
    await rename(replacementPath, authPath)

    credentialFsRaceHooks.beforeRename = async ({ fs, sourcePath, targetPath }) => {
      if (sourcePath !== authPath || !targetPath.includes('.oneworks-candidate-')) return
      credentialFsRaceHooks.beforeRename = undefined
      await fs.rm(sourcePath, { force: true })
      await fs.symlink(prepared.authFilePath!, sourcePath, 'file')
    }
    await prepared.reconcileCredentialOwner?.()

    expect((await lstat(authPath)).isSymbolicLink()).toBe(true)
    expect(await readlink(authPath)).toBe(prepared.authFilePath)
    expect(await readFile(prepared.authFilePath!, 'utf8')).toBe(fixture.initialAuthContent)
    const persisted = JSON.parse(await readFile(fixture.globalConfigPath, 'utf8')) as any
    expect(Buffer.from(persisted.adapters.codex.accounts.work.auth.token, 'base64').toString('utf8'))
      .toBe(fixture.initialAuthContent)
  })

  it('claims replacements injected after readlink on existing and newly created symlinks', async () => {
    const fixture = await createManagedInlineCredentialFixture({
      accountId: 'acct_readlink_swap',
      prefix: 'ow-codex-global-auth-readlink-swap-'
    })
    const first = await prepareCodexSessionHome({
      ctx: fixture.ctx,
      sessionId: 'session-a',
      appServerProfileKey: 'shared-profile',
      sharedAppServerHome: true
    })
    const sharedAuthPath = join(first.homeDir, '.codex', 'auth.json')
    const firstRotation =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_readlink_swap","refresh_token":"first"}}\n'
    credentialFsRaceHooks.afterReadlink = async ({ fs, path, target }) => {
      if (path !== sharedAuthPath || target !== first.authFilePath) return
      credentialFsRaceHooks.afterReadlink = undefined
      await fs.rm(path, { force: true })
      await fs.writeFile(path, firstRotation)
    }

    const second = await prepareCodexSessionHome({
      ctx: fixture.ctx,
      sessionId: 'session-b',
      appServerProfileKey: 'shared-profile',
      sharedAppServerHome: true
    })
    expect(second.homeDir).toBe(first.homeDir)
    expect((await lstat(sharedAuthPath)).isSymbolicLink()).toBe(true)
    expect(await readFile(first.authFilePath!, 'utf8')).toBe(firstRotation)

    const secondRotation =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_readlink_swap","refresh_token":"second"}}\n'
    let newlyCreatedAuthPath: string | undefined
    credentialFsRaceHooks.afterReadlink = async ({ fs, path, target }) => {
      if (path === sharedAuthPath || target !== first.authFilePath) return
      credentialFsRaceHooks.afterReadlink = undefined
      newlyCreatedAuthPath = path
      await fs.rm(path, { force: true })
      await fs.writeFile(path, secondRotation)
    }
    const direct = await prepareCodexSessionHome({
      ctx: fixture.ctx,
      sessionId: 'session-direct-new-link'
    })

    expect(newlyCreatedAuthPath).toBe(join(direct.homeDir, '.codex', 'auth.json'))
    expect((await lstat(newlyCreatedAuthPath!)).isSymbolicLink()).toBe(true)
    expect(await readFile(first.authFilePath!, 'utf8')).toBe(secondRotation)
    const persisted = JSON.parse(await readFile(fixture.globalConfigPath, 'utf8')) as any
    expect(Buffer.from(persisted.adapters.codex.accounts.work.auth.token, 'base64').toString('utf8'))
      .toBe(secondRotation)
  })

  it('adopts an atomic replacement before a second shared-profile prepare can rebind the auth path', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-global-auth-prepare-race-'))
    const realHome = join(workspace, 'real-home')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const initialIdentityPayload = Buffer.from(JSON.stringify({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_prepare_race',
        organizations: [{ id: 'org-known', is_default: true }]
      }
    })).toString('base64url')
    const initialAuthContent = `${
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          account_id: 'acct_prepare_race',
          id_token: `header.${initialIdentityPayload}.signature`,
          refresh_token: 'initial'
        }
      })
    }\n`
    const rotatedAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_prepare_race","refresh_token":"rotated"}}\n'
    const globalConfig = {
      adapters: {
        codex: {
          defaultAccount: 'work',
          accounts: {
            work: {
              generation: 'synthetic-prepare-race-generation',
              credentialRevision: '1:00000000-0000-4000-8000-000000000001',
              auth: {
                type: 'codex-auth-json',
                encoding: 'base64',
                token: Buffer.from(initialAuthContent, 'utf8').toString('base64')
              }
            }
          }
        }
      }
    }
    tempDirs.push(workspace)
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(globalConfig))
    const ctx = createTestCtx(workspace, {
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      configs: [globalConfig as any]
    })
    const first = await prepareCodexSessionHome({
      ctx,
      sessionId: 'session-a',
      appServerProfileKey: 'shared-profile',
      sharedAppServerHome: true
    })
    const authPath = join(first.homeDir, '.codex', 'auth.json')
    const replacementPath = `${authPath}.next`
    await writeFile(replacementPath, rotatedAuthContent)
    await rename(replacementPath, authPath)
    expect((await lstat(authPath)).isFile()).toBe(true)

    const second = await prepareCodexSessionHome({
      ctx,
      sessionId: 'session-b',
      appServerProfileKey: 'shared-profile',
      sharedAppServerHome: true
    })

    expect(second.homeDir).toBe(first.homeDir)
    expect((await lstat(authPath)).isSymbolicLink()).toBe(true)
    expect(await readFile(first.authFilePath!, 'utf8')).toBe(rotatedAuthContent)
    const persisted = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    expect(Buffer.from(persisted.adapters.codex.accounts.work.auth.token, 'base64').toString('utf8'))
      .toBe(rotatedAuthContent)
    await first.reconcileCredentialOwner?.()
    expect(await readFile(first.authFilePath!, 'utf8')).toBe(rotatedAuthContent)
  })

  it('rejects an atomic replacement with a conflicting explicit organization', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-global-auth-org-conflict-'))
    const realHome = join(workspace, 'real-home')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const createAuthContent = (organizationId: string, refreshToken: string) => {
      const payload = Buffer.from(JSON.stringify({
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'acct_org_conflict',
          organizations: [{ id: organizationId, is_default: true }]
        }
      })).toString('base64url')
      return `${
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: {
            account_id: 'acct_org_conflict',
            id_token: `header.${payload}.signature`,
            refresh_token: refreshToken
          }
        })
      }\n`
    }
    const initialAuthContent = createAuthContent('org-a', 'initial')
    const conflictingAuthContent = createAuthContent('org-b', 'conflicting')
    const configuredAccount = {
      generation: 'synthetic-org-conflict-generation',
      credentialRevision: '1:00000000-0000-4000-8000-000000000001',
      auth: {
        type: 'codex-auth-json',
        encoding: 'base64',
        token: Buffer.from(initialAuthContent, 'utf8').toString('base64')
      }
    }
    const globalConfig = {
      adapters: {
        codex: {
          defaultAccount: 'work',
          accounts: { work: configuredAccount }
        }
      }
    }
    tempDirs.push(workspace)
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(globalConfig))
    const ctx = createTestCtx(workspace, {
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      configs: [globalConfig as any]
    })
    const prepared = await prepareCodexSessionHome({
      ctx,
      sessionId: 'session-a',
      appServerProfileKey: 'shared-profile',
      sharedAppServerHome: true
    })
    const authPath = join(prepared.homeDir, '.codex', 'auth.json')
    const replacementPath = `${authPath}.next`
    await writeFile(replacementPath, conflictingAuthContent)
    await rename(replacementPath, authPath)

    await expect(prepareCodexSessionHome({
      ctx,
      sessionId: 'session-b',
      appServerProfileKey: 'shared-profile',
      sharedAppServerHome: true
    })).rejects.toThrow(/changed credential identity/iu)

    expect((await lstat(authPath)).isFile()).toBe(true)
    expect(await readFile(authPath, 'utf8')).toBe(conflictingAuthContent)
    expect(await readFile(prepared.authFilePath!, 'utf8')).toBe(initialAuthContent)
    const persisted = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    expect(Buffer.from(persisted.adapters.codex.accounts.work.auth.token, 'base64').toString('utf8'))
      .toBe(initialAuthContent)
  })

  it('preserves and rejects an atomic replacement from a different account identity', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-global-auth-cross-account-'))
    const realHome = join(workspace, 'real-home')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const initialAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_owner","refresh_token":"initial"}}\n'
    const otherAccountAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_other","refresh_token":"other"}}\n'
    const configuredAccount = {
      generation: 'synthetic-cross-account-generation',
      credentialRevision: '1:00000000-0000-4000-8000-000000000001',
      auth: {
        type: 'codex-auth-json',
        encoding: 'base64',
        token: Buffer.from(initialAuthContent, 'utf8').toString('base64')
      }
    }
    const globalConfig = {
      adapters: {
        codex: {
          defaultAccount: 'work',
          accounts: { work: configuredAccount }
        }
      }
    }
    tempDirs.push(workspace)
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(globalConfig))
    const ctx = createTestCtx(workspace, {
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      configs: [globalConfig as any]
    })
    const prepared = await prepareCodexSessionHome({
      ctx,
      sessionId: 'session-a',
      appServerProfileKey: 'shared-profile',
      sharedAppServerHome: true
    })
    const authPath = join(prepared.homeDir, '.codex', 'auth.json')
    const replacementPath = `${authPath}.next`
    await writeFile(replacementPath, otherAccountAuthContent)
    await rename(replacementPath, authPath)

    await expect(prepareCodexSessionHome({
      ctx,
      sessionId: 'session-b',
      appServerProfileKey: 'shared-profile',
      sharedAppServerHome: true
    })).rejects.toThrow(/changed credential identity/iu)

    expect((await lstat(authPath)).isFile()).toBe(true)
    expect(await readFile(authPath, 'utf8')).toBe(otherAccountAuthContent)
    expect(await readFile(prepared.authFilePath!, 'utf8')).toBe(initialAuthContent)
    const persisted = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    expect(Buffer.from(persisted.adapters.codex.accounts.work.auth.token, 'base64').toString('utf8'))
      .toBe(initialAuthContent)
    expect(persisted.adapters.codex.accounts.work.credentialRevision)
      .toBe(configuredAccount.credentialRevision)
  })

  it('fails closed on an incomplete owner write and flushes after the same session link finishes it', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-global-auth-owner-incomplete-'))
    const realHome = join(workspace, 'real-home')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const initialAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_incomplete","refresh_token":"initial"}}\n'
    const configuredAccount = {
      generation: 'synthetic-incomplete-generation',
      credentialRevision: '1:00000000-0000-4000-8000-000000000001',
      auth: {
        type: 'codex-auth-json',
        encoding: 'base64',
        token: Buffer.from(initialAuthContent, 'utf8').toString('base64')
      }
    }
    const globalConfig = {
      adapters: {
        codex: {
          defaultAccount: 'work',
          accounts: { work: configuredAccount }
        }
      }
    }
    tempDirs.push(workspace)
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(globalConfig))
    const ctx = createTestCtx(workspace, {
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      configs: [globalConfig as any]
    })

    const prepared = await prepareCodexSessionHome({ ctx, sessionId: 'session-a' })
    const sessionAuthPath = join(prepared.homeDir, '.codex', 'auth.json')
    await writeFile(sessionAuthPath, '{"auth_mode":"chatgpt","tokens":')

    await expect(prepared.reconcileCredentialOwner?.())
      .rejects.toThrow(/credential owner is incomplete or invalid/iu)
    const unchangedConfig = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    expect(unchangedConfig.adapters.codex.accounts.work.credentialRevision)
      .toBe(configuredAccount.credentialRevision)
    expect(Buffer.from(unchangedConfig.adapters.codex.accounts.work.auth.token, 'base64').toString('utf8'))
      .toBe(initialAuthContent)
    expect((await lstat(sessionAuthPath)).isSymbolicLink()).toBe(true)

    const rotatedAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_incomplete","refresh_token":"rotated"}}\n'
    await writeFile(sessionAuthPath, rotatedAuthContent)
    await prepared.reconcileCredentialOwner?.()
    const reconciledConfig = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    const recovered = await prepareCodexSessionHome({ ctx, sessionId: 'session-recovered' })

    expect(recovered.authFilePath).toBe(prepared.authFilePath)
    expect(await readFile(recovered.authFilePath!, 'utf8')).toBe(rotatedAuthContent)
    expect(Buffer.from(reconciledConfig.adapters.codex.accounts.work.auth.token, 'base64').toString('utf8'))
      .toBe(rotatedAuthContent)
  })

  it('does not let a failed live probe or a later prepare bypass verified rotation persistence', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-global-auth-probe-failure-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex-probe-failure.mjs')
    const probeAuthPathOutput = join(workspace, 'probe-auth-path.txt')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const initialAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_probe_failure","refresh_token":"initial"}}\n'
    const rotatedAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_probe_failure","refresh_token":"unverified"}}\n'
    const configuredAccount = {
      generation: 'synthetic-probe-failure-generation',
      credentialRevision: '1:00000000-0000-4000-8000-000000000001',
      auth: {
        type: 'codex-auth-json',
        encoding: 'base64',
        token: Buffer.from(initialAuthContent, 'utf8').toString('base64')
      }
    }
    const globalConfig = {
      adapters: {
        codex: {
          defaultAccount: 'work',
          accounts: { work: configuredAccount }
        }
      }
    }
    tempDirs.push(workspace)
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(globalConfig))
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import readline from 'node:readline'

const authPath = join(process.env.HOME, '.codex', 'auth.json')
writeFileSync(${JSON.stringify(probeAuthPathOutput)}, authPath)
const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id == null) return
  if (message.method === 'account/read') {
    writeFileSync(authPath, ${JSON.stringify(rotatedAuthContent)})
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: { account: { type: 'chatgpt', planType: 'pro' } }
    }) + '\\n')
    return
  }
  if (message.method === 'account/rateLimits/read') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32000, message: 'synthetic quota validation failed' }
    }) + '\\n')
    return
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }) + '\\n')
})
`
    )
    await chmod(fakeCodexPath, 0o755)
    const ctx = createTestCtx(workspace, {
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
      },
      configs: [globalConfig as any]
    })

    const sessionStartedBeforeProbe = await prepareCodexSessionHome({
      ctx,
      sessionId: 'session-started-before-failed-probe'
    })
    const accounts = await getCodexAccounts(ctx, { refresh: true })
    expect(accounts.accounts.find(account => account.key === 'work')?.status).toBe('error')
    const failedProbeAuthPath = await readFile(probeAuthPathOutput, 'utf8')
    await expect(lstat(failedProbeAuthPath)).rejects.toMatchObject({ code: 'ENOENT' })
    const afterFailure = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    expect(Buffer.from(afterFailure.adapters.codex.accounts.work.auth.token, 'base64').toString('utf8'))
      .toBe(initialAuthContent)
    expect(afterFailure.adapters.codex.accounts.work.credentialRevision)
      .toBe(configuredAccount.credentialRevision)

    expect(await readFile(sessionStartedBeforeProbe.authFilePath!, 'utf8')).toBe(initialAuthContent)
    await sessionStartedBeforeProbe.reconcileCredentialOwner?.()
    const afterPreExistingLifecycleTeardown = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    expect(
      Buffer.from(
        afterPreExistingLifecycleTeardown.adapters.codex.accounts.work.auth.token,
        'base64'
      ).toString('utf8')
    ).toBe(initialAuthContent)
    expect(afterPreExistingLifecycleTeardown.adapters.codex.accounts.work.credentialRevision)
      .toBe(configuredAccount.credentialRevision)

    const prepared = await prepareCodexSessionHome({ ctx, sessionId: 'session-after-failed-probe' })
    expect(await readFile(prepared.authFilePath!, 'utf8')).toBe(initialAuthContent)
    const afterPrepare = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    expect(Buffer.from(afterPrepare.adapters.codex.accounts.work.auth.token, 'base64').toString('utf8'))
      .toBe(initialAuthContent)
    expect(afterPrepare.adapters.codex.accounts.work.credentialRevision)
      .toBe(configuredAccount.credentialRevision)

    await prepared.reconcileCredentialOwner?.()
    const afterUnrelatedLifecycleTeardown = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    expect(
      Buffer.from(
        afterUnrelatedLifecycleTeardown.adapters.codex.accounts.work.auth.token,
        'base64'
      ).toString('utf8')
    ).toBe(initialAuthContent)
    expect(afterUnrelatedLifecycleTeardown.adapters.codex.accounts.work.credentialRevision)
      .toBe(configuredAccount.credentialRevision)
  })

  it('recovers from an incomplete old owner only after a new canonical source selects a new lineage', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-global-auth-incomplete-lineage-'))
    const realHome = join(workspace, 'real-home')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const initialAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_lineage","refresh_token":"initial"}}\n'
    const replacementAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_lineage","refresh_token":"replacement"}}\n'
    const configuredAccount = {
      generation: 'synthetic-incomplete-lineage-generation',
      credentialRevision: '1:00000000-0000-4000-8000-000000000001',
      auth: {
        type: 'codex-auth-json',
        encoding: 'base64',
        token: Buffer.from(initialAuthContent, 'utf8').toString('base64')
      }
    }
    const globalConfig = {
      adapters: {
        codex: {
          defaultAccount: 'work',
          accounts: { work: configuredAccount }
        }
      }
    }
    tempDirs.push(workspace)
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(globalConfig))
    const ctx = createTestCtx(workspace, {
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      configs: [globalConfig as any]
    })

    const first = await prepareCodexSessionHome({ ctx, sessionId: 'session-a' })
    await writeFile(join(first.homeDir, '.codex', 'auth.json'), '{"auth_mode":"chatgpt","tokens":')
    await expect(prepareCodexSessionHome({ ctx, sessionId: 'session-same-lineage' }))
      .rejects.toThrow(/credential owner is incomplete or invalid/iu)

    configuredAccount.generation = 'synthetic-replacement-generation'
    configuredAccount.credentialRevision = '1:00000000-0000-4000-8000-000000000002'
    configuredAccount.auth.token = Buffer.from(replacementAuthContent, 'utf8').toString('base64')
    await writeFile(globalConfigPath, JSON.stringify(globalConfig))

    const recovered = await prepareCodexSessionHome({ ctx, sessionId: 'session-new-lineage' })
    expect(recovered.authFilePath).not.toBe(first.authFilePath)
    expect(await readFile(recovered.authFilePath!, 'utf8')).toBe(replacementAuthContent)
  })

  it('rebinds the same session home from an old managed owner to a genuine new owner', async () => {
    const fixture = await createManagedInlineCredentialFixture({
      accountId: 'acct_same_session_lineage',
      prefix: 'ow-codex-same-session-lineage-'
    })
    const first = await prepareCodexSessionHome({ ctx: fixture.ctx, sessionId: 'shared-session' })
    const sessionAuthPath = join(first.homeDir, '.codex', 'auth.json')
    const oldOwnerPath = first.authFilePath!
    const replacementAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_same_session_lineage","refresh_token":"replacement"}}\n'

    fixture.configuredAccount.generation = 'synthetic-same-session-replacement-generation'
    fixture.configuredAccount.credentialRevision = '1:00000000-0000-4000-8000-000000000002'
    fixture.configuredAccount.auth.token = Buffer.from(replacementAuthContent, 'utf8').toString('base64')
    await writeFile(
      fixture.globalConfigPath,
      JSON.stringify({
        adapters: {
          codex: {
            defaultAccount: 'work',
            accounts: { work: fixture.configuredAccount }
          }
        }
      })
    )

    const replacement = await prepareCodexSessionHome({
      ctx: fixture.ctx,
      sessionId: 'shared-session'
    })

    expect(replacement.authFilePath).not.toBe(oldOwnerPath)
    expect(await readlink(sessionAuthPath)).toBe(replacement.authFilePath)
    expect(await readFile(sessionAuthPath, 'utf8')).toBe(replacementAuthContent)
    expect(await readFile(oldOwnerPath, 'utf8')).toBe(fixture.initialAuthContent)
  })

  it.each(['real-home', 'authFile'] as const)(
    'rebinds the same session home from %s to a managed inline owner',
    async (sourceKind) => {
      const workspace = await mkdtemp(join(tmpdir(), `ow-codex-${sourceKind}-to-inline-`))
      const realHome = join(workspace, 'real-home')
      const mockHome = resolveTestMockHome(workspace, realHome)
      const explicitAuthPath = join(workspace, 'explicit-auth.json')
      const initialAuthPath = sourceKind === 'real-home'
        ? join(realHome, '.codex', 'auth.json')
        : explicitAuthPath
      const initialAuthContent =
        `{"auth_mode":"chatgpt","tokens":{"account_id":"acct_${sourceKind}","refresh_token":"initial"}}\n`
      const inlineAuthContent =
        `{"auth_mode":"chatgpt","tokens":{"account_id":"acct_${sourceKind}_inline","refresh_token":"inline"}}\n`
      const configuredAccount: Record<string, unknown> = sourceKind === 'authFile'
        ? { authFile: explicitAuthPath }
        : {}
      const initialConfig = sourceKind === 'authFile'
        ? { adapters: { codex: { defaultAccount: 'work', accounts: { work: configuredAccount } } } }
        : {}
      const ctx = createTestCtx(workspace, {
        env: {
          HOME: mockHome,
          __ONEWORKS_PROJECT_REAL_HOME__: realHome
        },
        configs: [initialConfig as any]
      })
      tempDirs.push(workspace)
      await mkdir(dirname(initialAuthPath), { recursive: true })
      await writeFile(initialAuthPath, initialAuthContent)

      const first = await prepareCodexSessionHome({ ctx, sessionId: 'shared-session' })
      const sessionAuthPath = join(first.homeDir, '.codex', 'auth.json')
      expect(await readlink(sessionAuthPath)).toBe(initialAuthPath)

      delete configuredAccount.authFile
      Object.assign(configuredAccount, {
        generation: `synthetic-${sourceKind}-inline-generation`,
        credentialRevision: '1:00000000-0000-4000-8000-000000000001',
        auth: {
          type: 'codex-auth-json',
          encoding: 'base64',
          token: Buffer.from(inlineAuthContent, 'utf8').toString('base64')
        }
      })
      const inlineConfig = {
        adapters: {
          codex: {
            defaultAccount: 'work',
            accounts: { work: configuredAccount }
          }
        }
      }
      ctx.configs = [inlineConfig as any]
      await mkdir(join(realHome, '.oneworks'), { recursive: true })
      await writeFile(join(realHome, '.oneworks', '.oo.config.json'), JSON.stringify(inlineConfig))

      const replacement = await prepareCodexSessionHome({ ctx, sessionId: 'shared-session' })

      expect(replacement.accountKey).toBe('work')
      expect(replacement.authFilePath).not.toBe(initialAuthPath)
      expect(await readlink(sessionAuthPath)).toBe(replacement.authFilePath)
      expect(await readFile(sessionAuthPath, 'utf8')).toBe(inlineAuthContent)
      expect(await readFile(initialAuthPath, 'utf8')).toBe(initialAuthContent)
    }
  )

  it('fails closed after the whole owner cache directory disappears and recovers only from a new source revision', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-global-auth-owner-recovery-'))
    const realHome = join(workspace, 'real-home')
    const initialAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_recovery","refresh_token":"initial"}}\n'
    const configuredAccount = {
      credentialRevision: '1:synthetic-initial',
      auth: {
        type: 'codex-auth-json',
        encoding: 'base64',
        token: Buffer.from(initialAuthContent, 'utf8').toString('base64')
      }
    }
    tempDirs.push(workspace)
    const ctx = createTestCtx(workspace, {
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      configs: [{
        adapters: {
          codex: {
            defaultAccount: 'work',
            accounts: { work: configuredAccount }
          }
        }
      } as any]
    })

    const first = await prepareCodexSessionHome({ ctx, sessionId: 'session-a' })
    await rm(dirname(first.authFilePath!), { recursive: true })
    await expect(prepareCodexSessionHome({ ctx, sessionId: 'session-b' }))
      .rejects.toThrow(/lost its local credential owner/i)

    const replacementAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_recovery","refresh_token":"replacement"}}\n'
    configuredAccount.credentialRevision = '2:synthetic-replacement'
    configuredAccount.auth.token = Buffer.from(replacementAuthContent, 'utf8').toString('base64')
    const recovered = await prepareCodexSessionHome({ ctx, sessionId: 'session-c' })

    expect(recovered.authFilePath).not.toBe(first.authFilePath)
    expect(await readFile(recovered.authFilePath!, 'utf8')).toBe(replacementAuthContent)
  })

  it('removes an isolated probe HOME when credential-owner setup fails before cleanup transfers', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-probe-home-setup-failure-'))
    const realHome = join(workspace, 'real-home')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const authContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_setup_failure","refresh_token":"initial"}}\n'
    const globalConfig = {
      adapters: {
        codex: {
          defaultAccount: 'work',
          accounts: {
            work: {
              generation: 'setup-failure-generation',
              credentialRevision: '1:setup-failure',
              auth: {
                type: 'codex-auth-json',
                encoding: 'base64',
                token: Buffer.from(authContent, 'utf8').toString('base64')
              }
            }
          }
        }
      }
    }
    const ctx = createTestCtx(workspace, {
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      configs: [globalConfig as any]
    })
    tempDirs.push(workspace)
    await mkdir(dirname(globalConfigPath), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(globalConfig))

    const prepared = await prepareCodexSessionHome({ ctx, sessionId: 'initialize-owner' })
    await rm(dirname(prepared.authFilePath!), { recursive: true, force: true })

    await expect(manageCodexAccount(ctx, {
      action: 'consume-reset-credit',
      account: 'work',
      operationId: 'setup-failure-cleanup'
    })).rejects.toThrow(/lost its local credential owner/iu)

    const probeHomeRoot = resolveProjectHomePath(
      workspace,
      ctx.env,
      'caches',
      ctx.ctxId,
      'adapter-codex-accounts'
    )
    const remainingProbeHomes = await readdir(probeHomeRoot).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    expect(remainingProbeHomes).toEqual([])
  })

  it('does not flush a rotated owner after the canonical account generation is deleted', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-global-auth-owner-deleted-'))
    const realHome = join(workspace, 'real-home')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const generation = 'synthetic-deleted-generation'
    const initialAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_deleted","refresh_token":"initial"}}\n'
    const configuredAccount = {
      generation,
      credentialRevision: '1:00000000-0000-4000-8000-000000000001',
      auth: {
        type: 'codex-auth-json',
        encoding: 'base64',
        token: Buffer.from(initialAuthContent, 'utf8').toString('base64')
      }
    }
    const globalConfig = {
      adapters: {
        codex: {
          defaultAccount: 'work',
          accounts: { work: configuredAccount }
        }
      }
    }
    tempDirs.push(workspace)
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(globalConfig))
    const ctx = createTestCtx(workspace, {
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      configs: [globalConfig as any]
    })

    const prepared = await prepareCodexSessionHome({ ctx, sessionId: 'session-a' })
    const sessionAuthPath = join(prepared.homeDir, '.codex', 'auth.json')
    const rotatedAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_deleted","refresh_token":"rotated"}}\n'
    await writeFile(sessionAuthPath, rotatedAuthContent)

    await withCanonicalConfigWriteLock(globalConfigPath, async (targetPath) => {
      const deletedConfig = JSON.parse(await readFile(targetPath, 'utf8')) as any
      delete deletedConfig.adapters.codex.accounts.work
      deletedConfig.adapters.codex.accountTombstones = { work: [generation] }
      await writeFile(targetPath, JSON.stringify(deletedConfig))
    })

    await expect(prepared.reconcileCredentialOwner?.())
      .rejects.toThrow(/changed or was removed|deleted/iu)
    const persisted = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    expect(persisted.adapters.codex.accounts.work).toBeUndefined()
    expect(persisted.adapters.codex.accountTombstones.work).toEqual([generation])
    expect(await readFile(prepared.authFilePath!, 'utf8')).toBe(rotatedAuthContent)
  })

  it('uses a matching real-home credential without changing the configured account key', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-global-auth-local-refresh-'))
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const configuredAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_global","refresh_token":"old"}}\n'
    const realHomeAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_global","refresh_token":"current"}}\n'
    const realHomeAuthPath = join(realHome, '.codex', 'auth.json')
    tempDirs.push(workspace)
    await mkdir(join(realHome, '.codex'), { recursive: true })
    await writeFile(realHomeAuthPath, realHomeAuthContent)

    const ctx = createTestCtx(workspace, {
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      configs: [{
        adapters: {
          codex: {
            defaultAccount: 'work',
            accounts: {
              work: {
                title: 'Work',
                organizationId: 'org_global',
                auth: {
                  type: 'codex-auth-json',
                  encoding: 'base64',
                  token: Buffer.from(configuredAuthContent, 'utf8').toString('base64')
                }
              }
            }
          }
        }
      } as any]
    })

    const result = await prepareCodexSessionHome({
      ctx,
      sessionId: 'session'
    })
    const sessionAuthPath = join(result.homeDir, '.codex', 'auth.json')

    expect(result.accountKey).toBe('work')
    expect(result.authFilePath).toBe(realHomeAuthPath)
    expect(await readlink(sessionAuthPath)).toBe(realHomeAuthPath)
    expect(await readFile(sessionAuthPath, 'utf8')).toBe(realHomeAuthContent)
  })

  it('does not adopt or dedupe a real-home credential when both identities lack accountId', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-missing-account-id-real-home-'))
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const buildAuthContent = (refreshToken: string) => {
      const payload = Buffer.from(JSON.stringify({
        email: 'shared@example.com',
        'https://api.openai.com/auth': {
          organizations: [{ id: 'org_shared', is_default: true, title: 'Shared Org' }]
        }
      })).toString('base64url')
      return `${
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: {
            id_token: `header.${payload}.signature`,
            refresh_token: refreshToken
          }
        })
      }\n`
    }
    const configuredAuthContent = buildAuthContent('configured')
    const realHomeAuthContent = buildAuthContent('real-home')
    const realHomeAuthPath = join(realHome, '.codex', 'auth.json')
    const configs: [any] = [{
      adapters: {
        codex: {
          defaultAccount: 'work',
          accounts: {
            work: {
              auth: {
                type: 'codex-auth-json',
                encoding: 'base64',
                token: Buffer.from(configuredAuthContent, 'utf8').toString('base64')
              }
            }
          }
        }
      }
    } as any]
    const ctx = createTestCtx(workspace, {
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      configs
    })
    tempDirs.push(workspace)
    await mkdir(join(realHome, '.codex'), { recursive: true })
    await writeFile(realHomeAuthPath, realHomeAuthContent)

    const catalog = await getCodexAccounts(ctx, {})
    const prepared = await prepareCodexSessionHome({ ctx, sessionId: 'session' })
    const sessionAuthPath = join(prepared.homeDir, '.codex', 'auth.json')

    expect(catalog.accounts).toHaveLength(2)
    expect(prepared.accountKey).toBe('work')
    expect(prepared.authFilePath).not.toBe(realHomeAuthPath)
    expect(await readFile(sessionAuthPath, 'utf8')).toBe(configuredAuthContent)
  })

  it('keeps exact-auth-digest equivalence separate when accountId is missing', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-missing-account-id-exact-auth-'))
    const realHome = join(workspace, 'real-home')
    const realHomeAuthPath = join(realHome, '.codex', 'auth.json')
    const authContent = '{"auth_mode":"chatgpt","tokens":{"refresh_token":"same-bytes"}}\n'
    const ctx = createTestCtx(workspace, {
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      configs: [{
        adapters: {
          codex: {
            defaultAccount: 'work',
            accounts: {
              work: {
                auth: {
                  type: 'codex-auth-json',
                  encoding: 'base64',
                  token: Buffer.from(authContent, 'utf8').toString('base64')
                }
              }
            }
          }
        }
      } as any]
    })
    tempDirs.push(workspace)
    await mkdir(dirname(realHomeAuthPath), { recursive: true })
    await writeFile(realHomeAuthPath, authContent)

    const catalog = await getCodexAccounts(ctx, {})
    const prepared = await prepareCodexSessionHome({ ctx, sessionId: 'session' })

    expect(catalog.accounts).toHaveLength(1)
    expect(prepared.accountKey).toBe('work')
    expect(prepared.authFilePath).toBe(realHomeAuthPath)
  })

  it('rejects a real-home override when matching account ids have conflicting organizations', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-global-auth-organization-boundary-'))
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const configuredAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_global","refresh_token":"configured"}}\n'
    const realHomeJwtPayload = Buffer.from(JSON.stringify({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_global',
        organizations: [{ id: 'org_real', is_default: true }]
      }
    })).toString('base64url')
    const realHomeAuthContent = `${
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          account_id: 'acct_global',
          id_token: `header.${realHomeJwtPayload}.signature`,
          refresh_token: 'real-home'
        }
      })
    }\n`
    const realHomeAuthPath = join(realHome, '.codex', 'auth.json')
    tempDirs.push(workspace)
    await mkdir(join(realHome, '.codex'), { recursive: true })
    await writeFile(realHomeAuthPath, realHomeAuthContent)

    const result = await prepareCodexSessionHome({
      ctx: createTestCtx(workspace, {
        env: {
          HOME: mockHome,
          __ONEWORKS_PROJECT_REAL_HOME__: realHome
        },
        configs: [{
          adapters: {
            codex: {
              defaultAccount: 'work',
              accounts: {
                work: {
                  organizationId: 'org_configured',
                  auth: {
                    type: 'codex-auth-json',
                    encoding: 'base64',
                    token: Buffer.from(configuredAuthContent, 'utf8').toString('base64')
                  }
                }
              }
            }
          }
        } as any]
      }),
      sessionId: 'session'
    })
    const sessionAuthPath = join(result.homeDir, '.codex', 'auth.json')

    expect(result.accountKey).toBe('work')
    expect(result.authFilePath).not.toBe(realHomeAuthPath)
    expect(await readlink(sessionAuthPath)).toBe(result.authFilePath)
    expect(await readFile(sessionAuthPath, 'utf8')).toBe(configuredAuthContent)
  })

  it('does not replace a configured credential with a different real-home account', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-global-auth-account-boundary-'))
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const configuredAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_work","refresh_token":"work"}}\n'
    const realHomeAuthPath = join(realHome, '.codex', 'auth.json')
    tempDirs.push(workspace)
    await mkdir(join(realHome, '.codex'), { recursive: true })
    await writeFile(
      realHomeAuthPath,
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_personal","refresh_token":"personal"}}\n'
    )

    const result = await prepareCodexSessionHome({
      ctx: createTestCtx(workspace, {
        env: {
          HOME: mockHome,
          __ONEWORKS_PROJECT_REAL_HOME__: realHome
        },
        configs: [{
          adapters: {
            codex: {
              defaultAccount: 'work',
              accounts: {
                work: {
                  auth: {
                    type: 'codex-auth-json',
                    encoding: 'base64',
                    token: Buffer.from(configuredAuthContent, 'utf8').toString('base64')
                  }
                }
              }
            }
          }
        } as any]
      }),
      sessionId: 'session'
    })
    const sessionAuthPath = join(result.homeDir, '.codex', 'auth.json')

    expect(result.accountKey).toBe('work')
    expect(result.authFilePath).not.toBe(sessionAuthPath)
    expect(await readlink(sessionAuthPath)).toBe(result.authFilePath)
    expect((await lstat(sessionAuthPath)).isSymbolicLink()).toBe(true)
    expect(await readFile(sessionAuthPath, 'utf8')).toBe(configuredAuthContent)
  })

  it('links real home git config into the isolated Codex session home', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-session-home-'))
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    tempDirs.push(workspace)

    await mkdir(join(realHome, '.cache', 'codex'), { recursive: true })
    await mkdir(join(realHome, '.config', 'git'), { recursive: true })
    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(join(realHome, '.lark-cli'), { recursive: true })
    await mkdir(join(realHome, 'Library', 'Keychains'), { recursive: true })
    await mkdir(join(realHome, 'Library', 'Application Support', 'lark-cli'), { recursive: true })
    await mkdir(join(realHome, 'Library', 'Application Support', 'other-tool'), { recursive: true })
    await mkdir(join(mockHome, '.codex'), { recursive: true })
    await writeFile(join(realHome, '.cache', 'codex', 'cache.txt'), 'cache\n')
    await writeFile(join(realHome, '.gitconfig'), '[user]\n\tname = real\n')
    await writeFile(join(realHome, '.config', 'git', 'config'), '[alias]\n\tco = checkout\n')
    await writeFile(join(realHome, '.codex', 'config.toml'), 'model = "real"\n')
    await writeFile(join(realHome, '.lark-cli', 'config.json'), '{"profile":"real"}\n')
    await writeFile(join(realHome, 'Library', 'Keychains', 'login.keychain-db'), 'keychain\n')
    await writeFile(join(realHome, 'Library', 'Application Support', 'lark-cli', 'token.enc'), 'token\n')
    await writeFile(join(realHome, 'Library', 'Application Support', 'other-tool', 'auth.json'), 'auth\n')
    await writeFile(join(mockHome, '.codex', 'config.toml'), 'model = "mock"\n')
    bridgeRealHomeToMockHome({ realHome, mockHome })

    const result = await prepareCodexSessionHome({
      ctx: {
        cwd: workspace,
        env: {
          HOME: mockHome,
          __ONEWORKS_PROJECT_REAL_HOME__: realHome
        },
        ctxId: 'ctx',
        configs: []
      },
      sessionId: 'session'
    })

    expect(await readlink(join(result.homeDir, '.gitconfig'))).toBe(join(mockHome, '.gitconfig'))
    expect(await readlink(join(result.homeDir, '.config', 'git'))).toBe(join(mockHome, '.config', 'git'))
    expect(await readlink(join(result.homeDir, '.cache'))).toBe(join(mockHome, '.cache'))
    expect(await readlink(join(result.homeDir, '.lark-cli', 'config.json'))).toBe(
      join(mockHome, '.lark-cli', 'config.json')
    )
    if (process.platform === 'darwin') {
      expect(await readlink(join(result.homeDir, 'Library', 'Keychains'))).toBe(
        join(mockHome, 'Library', 'Keychains')
      )
      expect(await readFile(join(result.homeDir, 'Library', 'Keychains', 'login.keychain-db'), 'utf8')).toBe(
        'keychain\n'
      )
      expect(await readlink(join(result.homeDir, 'Library', 'Application Support'))).toBe(
        join(mockHome, 'Library', 'Application Support')
      )
      expect(await readFile(join(result.homeDir, 'Library', 'Application Support', 'lark-cli', 'token.enc'), 'utf8'))
        .toBe(
          'token\n'
        )
      expect(await readFile(join(result.homeDir, 'Library', 'Application Support', 'other-tool', 'auth.json'), 'utf8'))
        .toBe(
          'auth\n'
        )
    }
    expect(await readFile(join(result.homeDir, '.lark-cli', 'config.json'), 'utf8')).toBe('{"profile":"real"}\n')
    await expect(readlink(join(result.homeDir, '.codex', 'config.toml'))).rejects.toMatchObject({ code: 'EINVAL' })
    expect(await readFile(join(result.homeDir, '.codex', 'config.toml'), 'utf8')).toContain('model = "mock"')
    expect(await readFile(join(realHome, '.codex', 'config.toml'), 'utf8')).toBe('model = "real"\n')
  })

  it('keeps global Codex runtime caches out of the isolated session home', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-session-home-pruned-'))
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    tempDirs.push(workspace)

    await mkdir(join(mockHome, '.codex', '.tmp', 'plugins', 'ngs-analysis'), { recursive: true })
    await mkdir(join(mockHome, '.codex', 'plugins', 'cache'), { recursive: true })
    await mkdir(join(mockHome, '.codex', 'vendor_imports', 'skills'), { recursive: true })
    await mkdir(join(mockHome, '.codex', 'worktrees', 'old-session'), { recursive: true })
    await mkdir(join(mockHome, '.codex', 'cache', 'remote_plugin_catalog'), { recursive: true })
    await writeFile(join(mockHome, '.codex', 'config.toml'), 'model = "mock"\n')

    const result = await prepareCodexSessionHome({
      ctx: {
        cwd: workspace,
        env: {
          HOME: mockHome,
          __ONEWORKS_PROJECT_REAL_HOME__: realHome
        },
        ctxId: 'ctx',
        configs: []
      },
      sessionId: 'session'
    })

    const sessionCodexHome = join(result.homeDir, '.codex')
    for (const entry of ['.tmp', 'plugins', 'vendor_imports', 'worktrees', 'cache']) {
      await expect(lstat(join(sessionCodexHome, entry))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    await expect(readlink(join(sessionCodexHome, 'config.toml'))).rejects.toMatchObject({ code: 'EINVAL' })
    expect(await readFile(join(sessionCodexHome, 'config.toml'), 'utf8')).toContain('model = "mock"')
  })

  it('prunes stale Codex global-state bridges from an existing isolated session home', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-session-home-stale-'))
    const realHome = join(workspace, 'missing-real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    tempDirs.push(workspace)

    await mkdir(join(mockHome, '.codex', 'archived_sessions'), { recursive: true })
    await mkdir(join(mockHome, '.codex', 'cache'), { recursive: true })
    await mkdir(join(mockHome, '.codex', 'log'), { recursive: true })
    await mkdir(join(mockHome, '.codex', 'sqlite'), { recursive: true })
    await mkdir(join(mockHome, '.codex', 'sessions'), { recursive: true })
    await writeFile(join(mockHome, '.codex', 'config.toml'), 'model = "mock"\n')
    await writeFile(join(mockHome, '.codex', 'history.jsonl'), '{"event":"history"}\n')
    await writeFile(join(mockHome, '.codex', 'session_index.jsonl'), '{"event":"index"}\n')
    await writeFile(join(mockHome, '.codex', 'state_5.sqlite'), 'mock state\n')
    await writeFile(join(mockHome, '.codex', 'logs_2.sqlite'), 'mock logs\n')
    await writeFile(join(mockHome, '.codex', 'goals_1.sqlite'), 'mock goals\n')
    await writeFile(join(mockHome, '.codex', 'memories_1.sqlite'), 'mock memories\n')

    const ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'ctxId' | 'configs'> = {
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      ctxId: 'ctx',
      configs: []
    }

    const first = await prepareCodexSessionHome({ ctx, sessionId: 'session' })
    const firstCodexHome = join(first.homeDir, '.codex')
    const staleEntries = [
      'archived_sessions',
      'cache',
      'history.jsonl',
      'log',
      'session_index.jsonl',
      'sqlite',
      'state_5.sqlite',
      'logs_2.sqlite',
      'goals_1.sqlite',
      'memories_1.sqlite'
    ]
    for (const entry of staleEntries) {
      await symlink(join(mockHome, '.codex', entry), join(firstCodexHome, entry))
    }

    const second = await prepareCodexSessionHome({ ctx, sessionId: 'session' })
    const secondCodexHome = join(second.homeDir, '.codex')

    for (const entry of staleEntries) {
      await expect(lstat(join(secondCodexHome, entry))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    await expect(readlink(join(secondCodexHome, 'config.toml'))).rejects.toMatchObject({ code: 'EINVAL' })
    await expect(readlink(join(secondCodexHome, 'sessions'))).rejects.toMatchObject({ code: 'EINVAL' })
    expect((await stat(join(secondCodexHome, 'sessions'))).isDirectory()).toBe(true)
  })

  it('normalizes unsupported service tiers from shared Codex config during session home preparation', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-session-config-compat-'))
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    tempDirs.push(workspace)

    await mkdir(join(mockHome, '.codex'), { recursive: true })
    await writeFile(
      join(mockHome, '.codex', 'config.toml'),
      [
        'model = "gpt-5.5"',
        '',
        '# BEGIN VIBE FORGE MANAGED CODEX ROOT CONFIG',
        'service_tier = "default"',
        '# END VIBE FORGE MANAGED CODEX ROOT CONFIG',
        ''
      ].join('\n')
    )

    const result = await prepareCodexSessionHome({
      ctx: {
        cwd: workspace,
        env: {
          HOME: mockHome,
          __ONEWORKS_PROJECT_REAL_HOME__: realHome
        },
        ctxId: 'ctx',
        configs: []
      },
      sessionId: 'session'
    })

    const sessionConfigContent = await readFile(join(result.homeDir, '.codex', 'config.toml'), 'utf8')
    const mockConfigContent = await readFile(join(mockHome, '.codex', 'config.toml'), 'utf8')

    expect(mockConfigContent).toContain('service_tier = "default"')
    expect(sessionConfigContent).not.toContain('service_tier = "default"')
    expect(sessionConfigContent).toContain('model = "gpt-5.5"')
  })

  it('keeps Codex session storage local to each isolated session home', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-session-share-'))
    const realHome = join(workspace, 'missing-real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    tempDirs.push(workspace)

    const ctxBase: Pick<AdapterCtx, 'cwd' | 'env' | 'ctxId' | 'configs'> = {
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      ctxId: 'ctx',
      configs: []
    }

    const first = await prepareCodexSessionHome({ ctx: ctxBase, sessionId: 'session-a' })
    const second = await prepareCodexSessionHome({ ctx: ctxBase, sessionId: 'session-b' })

    expect(first.homeDir).not.toBe(second.homeDir)

    await expect(readlink(join(first.homeDir, '.codex', 'sessions'))).rejects.toMatchObject({ code: 'EINVAL' })
    await expect(readlink(join(second.homeDir, '.codex', 'sessions'))).rejects.toMatchObject({ code: 'EINVAL' })
    expect((await stat(join(first.homeDir, '.codex', 'sessions'))).isDirectory()).toBe(true)
    expect((await stat(join(second.homeDir, '.codex', 'sessions'))).isDirectory()).toBe(true)

    const rolloutBytes = '{"event":"start"}\n'
    await writeFile(join(first.homeDir, '.codex', 'sessions', 'rollout.jsonl'), rolloutBytes)
    await expect(readFile(join(second.homeDir, '.codex', 'sessions', 'rollout.jsonl'), 'utf8')).rejects
      .toMatchObject({ code: 'ENOENT' })
  })

  it('shares an app-server home across session contexts and preserves every trusted cwd', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-app-server-home-'))
    const firstCwd = join(workspace, 'workspace-a')
    const secondCwd = join(workspace, 'workspace-b')
    const realHome = join(workspace, 'missing-real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    tempDirs.push(workspace)
    await Promise.all([mkdir(firstCwd), mkdir(secondCwd)])
    const commonEnv = {
      HOME: mockHome,
      __ONEWORKS_PROJECT_REAL_HOME__: realHome,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspace
    }

    const [first, second] = await Promise.all([
      prepareCodexSessionHome({
        ctx: { cwd: firstCwd, env: commonEnv, ctxId: 'session-a', configs: [] },
        sessionId: 'session-a',
        appServerProfileKey: 'shared-profile'
      }),
      prepareCodexSessionHome({
        ctx: { cwd: secondCwd, env: commonEnv, ctxId: 'session-b', configs: [] },
        sessionId: 'session-b',
        appServerProfileKey: 'shared-profile'
      })
    ])

    expect(first.homeDir).toBe(second.homeDir)
    const config = await readFile(join(first.homeDir, '.codex', 'config.toml'), 'utf8')
    expect(config).toContain(`[projects.${JSON.stringify(firstCwd)}]`)
    expect(config).toContain(`[projects.${JSON.stringify(secondCwd)}]`)
  })

  it('uses a machine-shared app-server home without linking workspace skills or hooks', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'ow-codex-global-app-server-home-'))
    const firstCwd = join(fixture, 'workspace-a')
    const secondCwd = join(fixture, 'workspace-b')
    const realHome = join(fixture, 'real-home')
    tempDirs.push(fixture)
    await Promise.all([mkdir(firstCwd), mkdir(secondCwd), mkdir(realHome)])
    const createCtx = (cwd: string) => ({
      cwd,
      env: {
        HOME: resolveTestMockHome(cwd, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      ctxId: cwd.endsWith('a') ? 'ctx-a' : 'ctx-b',
      configs: [] as AdapterCtx['configs']
    })

    const [first, second] = await Promise.all([
      prepareCodexSessionHome({
        ctx: createCtx(firstCwd),
        sessionId: 'session-a',
        appServerProfileKey: 'shared-profile',
        nativeHooksAvailable: true,
        sharedAppServerHome: true
      }),
      prepareCodexSessionHome({
        ctx: createCtx(secondCwd),
        sessionId: 'session-b',
        appServerProfileKey: 'shared-profile',
        nativeHooksAvailable: true,
        sharedAppServerHome: true
      })
    ])

    expect(first.homeDir).toBe(second.homeDir)
    await expect(lstat(join(first.homeDir, '.agents', 'skills'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(first.homeDir, '.codex', 'skills'))).rejects.toMatchObject({ code: 'ENOENT' })
    const hooks = JSON.parse(await readFile(join(first.homeDir, '.codex', 'hooks.json'), 'utf8')) as {
      hooks: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>
    }
    const managedCommands = Object.values(hooks.hooks).flatMap(groups =>
      groups.flatMap(group => group.hooks?.map(hook => hook.command) ?? [])
    ).filter(command => command?.includes('call-hook.js'))
    expect(managedCommands).toHaveLength(Object.keys(hooks.hooks).length)
    expect(managedCommands.every(command => !command?.includes('HOME='))).toBe(true)
    const config = await readFile(join(first.homeDir, '.codex', 'config.toml'), 'utf8')
    expect(config).toContain(`[projects.${JSON.stringify(firstCwd)}]`)
    expect(config).toContain(`[projects.${JSON.stringify(secondCwd)}]`)
  })

  it('trusts Codex native hooks through the isolated session home path', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-session-hooks-'))
    const realHome = join(workspace, 'missing-real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    tempDirs.push(workspace)

    await mkdir(join(mockHome, '.codex'), { recursive: true })
    await writeFile(join(mockHome, '.codex', 'config.toml'), 'model = "mock"\n')
    await writeFile(
      join(mockHome, '.codex', 'hooks.json'),
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [{
              matcher: '^Bash$',
              hooks: [{
                type: 'command',
                command: '/tmp/call-hook.js',
                timeout: 600,
                statusMessage: 'running oneworks PreToolUse hook'
              }]
            }]
          }
        },
        null,
        2
      )
    )

    const result = await prepareCodexSessionHome({
      ctx: {
        cwd: workspace,
        env: {
          HOME: mockHome,
          __ONEWORKS_PROJECT_REAL_HOME__: realHome
        },
        ctxId: 'ctx',
        configs: []
      },
      sessionId: 'session-a'
    })

    const configContent = await readFile(join(result.homeDir, '.codex', 'config.toml'), 'utf8')
    const stateHeader = `[hooks.state.${
      JSON.stringify(`${join(result.homeDir, '.codex', 'hooks.json')}:pre_tool_use:0:0`)
    }]`
    expect(await readlink(join(result.homeDir, '.codex', 'hooks.json'))).toBe(join(mockHome, '.codex', 'hooks.json'))
    expect(countOccurrences(configContent, stateHeader)).toBe(1)
    expect(configContent).toContain('trusted_hash = "sha256:')
  })

  it('keeps Codex runtime sqlite state and session storage local', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-runtime-state-'))
    const realHome = join(workspace, 'missing-real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    tempDirs.push(workspace)

    await mkdir(join(mockHome, '.codex', 'state'), { recursive: true })
    await mkdir(join(mockHome, '.codex', 'sqlite'), { recursive: true })
    await mkdir(join(mockHome, '.codex', 'sessions'), { recursive: true })
    await writeFile(join(mockHome, '.codex', 'state_5.sqlite'), 'mock state\n')
    await writeFile(join(mockHome, '.codex', 'state_5.sqlite-wal'), 'mock state wal\n')
    await writeFile(join(mockHome, '.codex', 'state_5.sqlite-shm'), 'mock state shm\n')
    await writeFile(join(mockHome, '.codex', 'state_5.sqlite-journal'), 'mock state journal\n')
    await writeFile(join(mockHome, '.codex', 'state-metadata.json'), 'mock state metadata\n')
    await writeFile(join(mockHome, '.codex', 'logs_2.sqlite'), 'mock logs\n')
    await writeFile(join(mockHome, '.codex', 'logs_2.sqlite-wal'), 'mock logs wal\n')
    await writeFile(join(mockHome, '.codex', 'logs_2.sqlite-shm'), 'mock logs shm\n')
    await writeFile(join(mockHome, '.codex', 'logs_2.sqlite-journal'), 'mock logs journal\n')
    await writeFile(join(mockHome, '.codex', 'logs_events.jsonl'), 'mock logs events\n')

    const result = await prepareCodexSessionHome({
      ctx: {
        cwd: workspace,
        env: {
          HOME: mockHome,
          __ONEWORKS_PROJECT_REAL_HOME__: realHome
        },
        ctxId: 'ctx',
        configs: []
      },
      sessionId: 'session'
    })
    const sessionCodexHome = join(result.homeDir, '.codex')

    for (
      const entry of [
        'state',
        'sqlite',
        'state_5.sqlite',
        'state_5.sqlite-wal',
        'state_5.sqlite-shm',
        'state_5.sqlite-journal',
        'state-metadata.json',
        'logs_2.sqlite',
        'logs_2.sqlite-wal',
        'logs_2.sqlite-shm',
        'logs_2.sqlite-journal',
        'logs_events.jsonl'
      ]
    ) {
      await expect(lstat(join(sessionCodexHome, entry))).rejects.toMatchObject({ code: 'ENOENT' })
    }

    await expect(readlink(join(sessionCodexHome, 'sessions'))).rejects.toMatchObject({ code: 'EINVAL' })
    expect((await stat(join(sessionCodexHome, 'sessions'))).isDirectory()).toBe(true)

    await writeFile(join(sessionCodexHome, 'state_5.sqlite'), 'local state\n')
    await mkdir(join(sessionCodexHome, 'state'), { recursive: true })
    await writeFile(join(sessionCodexHome, 'state', 'store.json'), 'local state dir\n')

    expect(await readFile(join(sessionCodexHome, 'state_5.sqlite'), 'utf8')).toBe('local state\n')
    expect(await readFile(join(mockHome, '.codex', 'state_5.sqlite'), 'utf8')).toBe('mock state\n')
    await expect(readFile(join(mockHome, '.codex', 'state', 'store.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('does not backfill legacy workspace Codex rollouts before replacing isolated session storage', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-session-migrate-'))
    const realHome = join(workspace, 'missing-real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    tempDirs.push(workspace)

    const legacyHome = join(workspace, '.oo', 'caches', 'ctx', 'session-a', 'adapter-codex-home')
    const legacyRollout = join(legacyHome, '.codex', 'sessions', 'rollout.jsonl')
    const rolloutBytes = '{"event":"legacy"}\n'
    await mkdir(join(legacyHome, '.codex', 'sessions'), { recursive: true })
    await writeFile(legacyRollout, rolloutBytes)

    const result = await prepareCodexSessionHome({
      ctx: {
        cwd: workspace,
        env: {
          HOME: mockHome,
          __ONEWORKS_PROJECT_REAL_HOME__: realHome
        },
        ctxId: 'ctx',
        configs: []
      },
      sessionId: 'session-a'
    })

    await expect(readFile(join(mockHome, '.codex', 'sessions', 'rollout.jsonl'), 'utf8')).rejects
      .toMatchObject({ code: 'ENOENT' })
    await expect(readFile(legacyRollout, 'utf8')).resolves.toBe(rolloutBytes)
    await expect(readlink(join(result.homeDir, '.codex', 'sessions'))).rejects.toMatchObject({ code: 'EINVAL' })
    expect((await stat(join(result.homeDir, '.codex', 'sessions'))).isDirectory()).toBe(true)
  })
})

describe('codex automatic account pool', () => {
  const inlineAuth = (accountId: string) => ({
    type: 'codex-auth-json',
    encoding: 'base64',
    token: Buffer.from(JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: { account_id: accountId }
    })).toString('base64')
  })

  it('orders ready accounts by priority and excludes disabled or cooling accounts', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-account-pool-'))
    const cacheStore = new Map<string, unknown>()
    tempDirs.push(workspace)
    const ctx = createTestCtx(workspace, {
      cacheStore,
      configs: [{
        adapters: {
          codex: {
            defaultAccount: 'backup',
            accountPool: { enabled: true, cooldownMs: 60_000 },
            accounts: {
              primary: { priority: 100, auth: inlineAuth('acct-primary') },
              backup: { priority: 50, auth: inlineAuth('acct-backup') },
              paused: { priority: 1000, disabled: true, auth: inlineAuth('acct-paused') }
            }
          }
        }
      } as any]
    })

    const initial = await resolveCodexAccountPoolCandidates(ctx, 'gpt-5.4')
    expect(initial.candidates.map(candidate => candidate.key)).toEqual(['primary', 'backup'])

    await markCodexAccountPoolFailure({
      ctx,
      candidate: initial.candidates[0]!,
      model: 'gpt-5.4',
      cooldownMs: 60_000,
      reason: 'rate_limit'
    })

    expect((await resolveCodexAccountPoolCandidates(ctx, 'gpt-5.4')).candidates.map(candidate => candidate.key))
      .toEqual(['backup'])
    const anotherSessionCtx = createTestCtx(workspace, {
      cacheStore: new Map<string, unknown>(),
      configs: ctx.configs
    })
    expect(
      (await resolveCodexAccountPoolCandidates(anotherSessionCtx, 'gpt-5.4')).candidates.map(candidate => candidate.key)
    ).toEqual(['backup'])
    expect((await resolveCodexAccountPoolCandidates(ctx, 'gpt-5.5')).candidates.map(candidate => candidate.key))
      .toEqual(['primary', 'backup'])
  })

  it('uses the configured default account when callers explicitly opt out of the Auto pool', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-account-default-'))
    tempDirs.push(workspace)
    const result = await prepareCodexSessionHome({
      ctx: createTestCtx(workspace, {
        configs: [{
          adapters: {
            codex: {
              defaultAccount: 'backup',
              accountPool: { enabled: true },
              accounts: {
                primary: { priority: 100, auth: inlineAuth('acct-primary') },
                backup: { priority: 10, auth: inlineAuth('acct-backup') }
              }
            }
          }
        } as any]
      }),
      sessionId: 'shared-client',
      useAccountPool: false
    })

    expect(result.accountKey).toBe('backup')
  })

  it('invalidates cooldown state when credentials change', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-account-pool-credential-'))
    const cacheStore = new Map<string, unknown>()
    tempDirs.push(workspace)
    const config = {
      adapters: {
        codex: {
          accountPool: { enabled: true, cooldownMs: 60_000 },
          accounts: {
            work: { priority: 100, auth: inlineAuth('acct-old') }
          }
        }
      }
    }
    const ctx = createTestCtx(workspace, { cacheStore, configs: [config as any] })
    const [candidate] = (await resolveCodexAccountPoolCandidates(ctx, 'gpt-5.4')).candidates
    await markCodexAccountPoolFailure({
      ctx,
      candidate: candidate!,
      model: 'gpt-5.4',
      cooldownMs: 60_000,
      reason: 'auth'
    })
    expect((await resolveCodexAccountPoolCandidates(ctx, 'gpt-5.4')).candidates).toEqual([])

    config.adapters.codex.accounts.work.auth = inlineAuth('acct-new')
    expect((await resolveCodexAccountPoolCandidates(ctx, 'gpt-5.4')).candidates.map(entry => entry.key))
      .toEqual(['work'])
  })

  it('classifies only retry-safe account failures', () => {
    expect(classifyCodexAccountPoolFailure(new Error('429 rate limit exceeded'), 60_000))
      .toEqual({ reason: 'rate_limit', cooldownMs: 60_000 })
    expect(classifyCodexAccountPoolFailure(new Error('401 Unauthorized'), 60_000))
      .toEqual({ reason: 'auth', cooldownMs: 15 * 60_000 })
    expect(classifyCodexAccountPoolFailure(new Error('503 temporarily unavailable'), 60_000))
      .toEqual({ reason: 'transient', cooldownMs: 30_000 })
    expect(classifyCodexAccountPoolFailure(new Error('Malformed tool response'), 60_000))
      .toBeUndefined()
  })
})

describe('getCodexAccounts', () => {
  it('ignores legacy workspace metadata JSON files', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-account-invalid-meta-'))
    const accountDir = join(workspace, '.oo', '.local', 'adapters', 'codex', 'accounts', 'partial')
    const logger = {
      stream: new PassThrough(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }
    tempDirs.push(workspace)

    await mkdir(accountDir, { recursive: true })
    await writeFile(join(accountDir, 'meta.json'), '')

    const ctx = createTestCtx(workspace, { logger })
    await expect(getCodexAccounts(ctx, {})).resolves.toMatchObject({
      accounts: []
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

describe('manageCodexAccount', () => {
  it('requires a caller-stable operation ID before consuming a reset credit', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-reset-credit-operation-id-'))
    tempDirs.push(workspace)

    await expect(manageCodexAccount(createTestCtx(workspace), {
      action: 'consume-reset-credit',
      account: 'work'
    })).rejects.toThrow('requires an operation ID')
  })

  it('shows every Codex rate-limit bucket and consumes an earned reset credit', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-reset-credit-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex-app-server.mjs')
    const authFilePath = join(workspace, 'auth.json')
    tempDirs.push(workspace)

    await writeFile(authFilePath, '{"auth_mode":"chatgpt"}\n')
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import readline from 'node:readline'

let availableCount = 2
const buildRateLimits = () => ({
  rateLimits: {
    limitId: 'codex',
    primary: {
      usedPercent: 2,
      windowDurationMins: 10080,
      resetsAt: 1785902972
    },
    planType: 'pro'
  },
  rateLimitsByLimitId: {
    codex: {
      limitId: 'codex',
      primary: {
        usedPercent: 2,
        windowDurationMins: 10080,
        resetsAt: 1785902972
      },
      planType: 'pro'
    },
    codex_bengalfox: {
      limitId: 'codex_bengalfox',
      limitName: 'GPT-5.3-Codex-Spark',
      primary: {
        usedPercent: 0,
        windowDurationMins: 10080,
        resetsAt: 1785913033
      },
      planType: 'pro'
    }
  },
  rateLimitResetCredits: {
    availableCount,
    ...(availableCount > 1 ? {
      credits: [{
        id: 'credit-a',
        resetType: 'weekly',
        status: 'available',
        title: 'Weekly reset',
        description: 'Earned reset credit',
        grantedAt: 1785200000,
        expiresAt: 1786500000
      }]
    } : {})
  }
})

const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id == null) return

  let result = {}
  if (message.method === 'account/read') {
    result = {
      account: {
        type: 'chatgpt',
        email: 'work@example.com',
        planType: 'pro'
      }
    }
  } else if (message.method === 'account/rateLimits/read') {
    result = buildRateLimits()
  } else if (message.method === 'account/rateLimitResetCredit/consume') {
    const valid = message.params?.creditId === 'credit-a' &&
      typeof message.params?.idempotencyKey === 'string' &&
      message.params.idempotencyKey.length > 0
    if (valid) availableCount = 1
    result = { outcome: valid ? 'reset' : 'noCredit' }
  }

  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: message.id,
    result
  }) + '\\n')
})
`
    )
    await chmod(fakeCodexPath, 0o755)

    const ctx = createTestCtx(workspace, {
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
      },
      configs: [{
        adapters: {
          codex: {
            accounts: {
              work: {
                title: 'Work',
                authFile: authFilePath
              }
            }
          }
        }
      } as any]
    })

    const detail = await getCodexAccountDetail(ctx, {
      account: 'work',
      refresh: true
    })
    expect(detail.account.quota?.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'primary-usage',
        label: '7d used',
        value: '2%'
      }),
      expect.objectContaining({
        id: 'codex-bengalfox-primary-usage',
        label: 'GPT-5.3-Codex-Spark · 7d used',
        value: '0%'
      })
    ]))
    expect(detail.account.quota?.rateLimitResetCredits).toMatchObject({
      availableCount: 2,
      canConsume: true,
      credits: [
        expect.objectContaining({
          id: 'credit-a',
          status: 'available',
          title: 'Weekly reset'
        })
      ]
    })

    const result = await manageCodexAccount(ctx, {
      action: 'consume-reset-credit',
      account: 'work',
      creditId: 'credit-a',
      operationId: 'reset-credit-operation-a'
    })
    expect(result.outcome).toBe('reset')
    expect(result.account?.quota?.rateLimitResetCredits?.availableCount).toBe(1)
    expect(result.account?.quota?.rateLimitResetCredits?.credits).toBeUndefined()
  })

  it('keeps a successful reset outcome when account and quota refresh fail afterward', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-reset-credit-read-failure-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex-app-server.mjs')
    const authFilePath = join(workspace, 'auth.json')
    const operationMarkerPath = join(workspace, 'operation-id.txt')
    tempDirs.push(workspace)

    await writeFile(authFilePath, '{"auth_mode":"chatgpt"}\n')
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id == null) return

  if (message.method === 'account/rateLimitResetCredit/consume') {
    writeFileSync(${JSON.stringify(operationMarkerPath)}, message.params.idempotencyKey)
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: { outcome: 'reset' }
    }) + '\\n')
    return
  }

  if (message.method === 'account/read' || message.method === 'account/rateLimits/read') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32000, message: 'snapshot unavailable' }
    }) + '\\n')
    return
  }

  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: message.id,
    result: {}
  }) + '\\n')
})
`
    )
    await chmod(fakeCodexPath, 0o755)

    const result = await manageCodexAccount(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [{
          adapters: {
            codex: {
              accounts: {
                work: { authFile: authFilePath }
              }
            }
          }
        } as any]
      }),
      {
        action: 'consume-reset-credit',
        account: 'work',
        operationId: 'reset-credit-read-failure'
      }
    )

    expect(result.outcome).toBe('reset')
    expect(result.account?.quota).toBeUndefined()
    expect(result.message).toContain('Refresh the quota')
    await expect(readFile(operationMarkerPath, 'utf8')).resolves.toBe('reset-credit-read-failure')
  })

  it('retries a disconnected consumption with the same operation ID without consuming twice', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-reset-credit-disconnect-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex-app-server.mjs')
    const authFilePath = join(workspace, 'auth.json')
    const statePath = join(workspace, 'consume-state.json')
    tempDirs.push(workspace)

    await writeFile(authFilePath, '{"auth_mode":"chatgpt"}\n')
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id == null) return

  let result = {}
  if (message.method === 'account/rateLimitResetCredit/consume') {
    const state = existsSync(${JSON.stringify(statePath)})
      ? JSON.parse(readFileSync(${JSON.stringify(statePath)}, 'utf8'))
      : { consumeCalls: 0, consumptions: 0, operationIds: [], operations: {} }
    const operationId = message.params.idempotencyKey
    state.consumeCalls += 1
    state.operationIds.push(operationId)
    if (state.operations[operationId] == null) {
      state.operations[operationId] = 'reset'
      state.consumptions += 1
    }
    writeFileSync(${JSON.stringify(statePath)}, JSON.stringify(state))
    if (state.consumeCalls === 1) {
      process.exit(0)
      return
    }
    result = { outcome: state.operations[operationId] }
  } else if (message.method === 'account/read') {
    result = { account: { type: 'chatgpt', planType: 'pro' } }
  } else if (message.method === 'account/rateLimits/read') {
    result = {
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 0, windowDurationMins: 10080 },
        planType: 'pro'
      },
      rateLimitResetCredits: { availableCount: 0 }
    }
  }

  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: message.id,
    result
  }) + '\\n')
})
`
    )
    await chmod(fakeCodexPath, 0o755)

    const ctx = createTestCtx(workspace, {
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
      },
      configs: [{
        adapters: {
          codex: {
            accounts: {
              work: { authFile: authFilePath }
            }
          }
        }
      } as any]
    })
    const options = {
      action: 'consume-reset-credit' as const,
      account: 'work',
      operationId: 'reset-credit-disconnected-request'
    }

    await expect(manageCodexAccount(ctx, options)).rejects.toThrow()
    const retryResult = await manageCodexAccount(ctx, options)
    const state = JSON.parse(await readFile(statePath, 'utf8')) as {
      consumeCalls: number
      consumptions: number
      operationIds: string[]
    }

    expect(retryResult.outcome).toBe('reset')
    expect(state).toMatchObject({
      consumeCalls: 2,
      consumptions: 1,
      operationIds: [
        'reset-credit-disconnected-request',
        'reset-credit-disconnected-request'
      ]
    })
  })

  it('returns the successful reset outcome when global metadata persistence fails', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-reset-credit-persist-failure-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex-app-server.mjs')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const authContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_persist"}}\n'
    const globalConfig = {
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: {
                type: 'codex-auth-json',
                encoding: 'base64',
                token: Buffer.from(authContent, 'utf8').toString('base64')
              }
            }
          }
        }
      }
    }
    tempDirs.push(workspace)

    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(globalConfig))
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { mkdirSync, rmSync } from 'node:fs'
import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id == null) return

  let result = {}
  if (message.method === 'account/rateLimitResetCredit/consume') {
    rmSync(${JSON.stringify(globalConfigPath)}, { force: true })
    mkdirSync(${JSON.stringify(globalConfigPath)}, { recursive: true })
    result = { outcome: 'reset' }
  } else if (message.method === 'account/read') {
    result = { account: { type: 'chatgpt', planType: 'pro' } }
  } else if (message.method === 'account/rateLimits/read') {
    result = {
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 0, windowDurationMins: 10080 },
        planType: 'pro'
      },
      rateLimitResetCredits: { availableCount: 0 }
    }
  }

  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: message.id,
    result
  }) + '\\n')
})
`
    )
    await chmod(fakeCodexPath, 0o755)

    const result = await manageCodexAccount(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [globalConfig as any]
      }),
      {
        action: 'consume-reset-credit',
        account: 'work',
        operationId: 'reset-credit-persist-failure'
      }
    )

    expect(result.outcome).toBe('reset')
    expect(result.account?.quota?.rateLimitResetCredits?.availableCount).toBe(0)
  })

  it('persists the successful reset snapshot even when the quota cache fails', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-reset-credit-cache-failure-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex-app-server.mjs')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const authContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_cache_failure"}}\n'
    const globalConfig = {
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: {
                type: 'codex-auth-json',
                encoding: 'base64',
                token: Buffer.from(authContent, 'utf8').toString('base64')
              }
            }
          }
        }
      }
    }
    tempDirs.push(workspace)

    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(globalConfig))
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id == null) return

  let result = {}
  if (message.method === 'account/rateLimitResetCredit/consume') {
    result = { outcome: 'reset' }
  } else if (message.method === 'account/read') {
    result = { account: { type: 'chatgpt', planType: 'pro' } }
  } else if (message.method === 'account/rateLimits/read') {
    result = {
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 0, windowDurationMins: 10080 },
        planType: 'pro'
      },
      rateLimitResetCredits: { availableCount: 0 }
    }
  }

  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: message.id,
    result
  }) + '\\n')
})
`
    )
    await chmod(fakeCodexPath, 0o755)

    const result = await manageCodexAccount(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [globalConfig as any],
        cache: {
          get: async () => {
            throw new Error('cache unavailable')
          },
          set: async () => {
            throw new Error('cache unavailable')
          }
        }
      }),
      {
        action: 'consume-reset-credit',
        account: 'work',
        operationId: 'reset-credit-cache-failure'
      }
    )

    const persistedConfig = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    expect(result.outcome).toBe('reset')
    expect(persistedConfig.adapters.codex.accounts.work.quota.rateLimitResetCredits.availableCount).toBe(0)
  })

  it('does not let a stale refresh overwrite a replaced global credential', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-stale-refresh-credential-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex-app-server.mjs')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const oldAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_old"}}\n'
    const newAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_new"}}\n'
    const buildGlobalConfig = (authContent: string) => ({
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: {
                type: 'codex-auth-json',
                encoding: 'base64',
                token: Buffer.from(authContent, 'utf8').toString('base64')
              }
            }
          }
        }
      }
    })
    const staleConfig = buildGlobalConfig(oldAuthContent)
    tempDirs.push(workspace)

    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(buildGlobalConfig(newAuthContent)))
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id == null) return

  let result = {}
  if (message.method === 'account/read') {
    result = { account: { type: 'chatgpt', planType: 'pro' } }
  } else if (message.method === 'account/rateLimits/read') {
    result = {
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 33, windowDurationMins: 10080 },
        planType: 'pro'
      }
    }
  }

  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: message.id,
    result
  }) + '\\n')
})
`
    )
    await chmod(fakeCodexPath, 0o755)

    const detail = await getCodexAccountDetail(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [staleConfig as any]
      }),
      {
        account: 'work',
        refresh: true
      }
    )

    const persistedConfig = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    const persistedAccount = persistedConfig.adapters.codex.accounts.work
    expect(detail.account.quota?.metrics).toContainEqual(expect.objectContaining({
      id: 'primary-usage',
      value: '33%'
    }))
    expect(Buffer.from(persistedAccount.auth.token, 'base64').toString('utf8')).toBe(newAuthContent)
    expect(persistedAccount.quota).toBeUndefined()
  })

  it('rejects a stale reset-credit request after its global credential is replaced', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-stale-consume-credential-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex-app-server.mjs')
    const consumeMarkerPath = join(workspace, 'consume.marker')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const oldAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_old"}}\n'
    const newAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_new"}}\n'
    const buildGlobalConfig = (authContent: string) => ({
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: {
                type: 'codex-auth-json',
                encoding: 'base64',
                token: Buffer.from(authContent, 'utf8').toString('base64')
              }
            }
          }
        }
      }
    })
    const staleConfig = buildGlobalConfig(oldAuthContent)
    tempDirs.push(workspace)

    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(staleConfig))
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id == null) return

  if (message.method === 'account/rateLimitResetCredit/consume') {
    writeFileSync(${JSON.stringify(consumeMarkerPath)}, 'consumed')
  }
  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: message.id,
    result: message.method === 'account/rateLimitResetCredit/consume'
      ? { outcome: 'reset' }
      : {}
  }) + '\\n')
})
`
    )
    await chmod(fakeCodexPath, 0o755)

    let releaseCanonicalLock = () => {}
    let markCanonicalLockAcquired = () => {}
    const canonicalLockRelease = new Promise<void>((resolvePromise) => {
      releaseCanonicalLock = resolvePromise
    })
    const canonicalLockAcquired = new Promise<void>((resolvePromise) => {
      markCanonicalLockAcquired = resolvePromise
    })
    const heldLock = withCanonicalConfigWriteLock(globalConfigPath, async () => {
      markCanonicalLockAcquired()
      await canonicalLockRelease
    })
    await canonicalLockAcquired

    const consumeOutcome = manageCodexAccount(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [staleConfig as any]
      }),
      {
        action: 'consume-reset-credit',
        account: 'work',
        operationId: 'stale-reset-credit-request'
      }
    ).then(
      () => ({ error: undefined }),
      (error: unknown) => ({ error })
    )

    await writeFile(globalConfigPath, JSON.stringify(buildGlobalConfig(newAuthContent)))
    releaseCanonicalLock()
    await heldLock

    const { error } = await consumeOutcome
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('changed while this reset-credit request was waiting')
    await expect(readFile(consumeMarkerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(
    [
      'same-bytes-new-generation',
      'newer-revision',
      'auth-file-switch',
      'tombstone'
    ] as const
  )('rejects reset-credit when the full credential CAS changes via %s', async (scenario) => {
    const workspace = await mkdtemp(join(tmpdir(), `ow-codex-reset-cas-${scenario}-`))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex-app-server.mjs')
    const explicitAuthPath = join(workspace, 'replacement-auth.json')
    const consumeMarkerPath = join(workspace, 'consume.marker')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const authContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_reset_cas"}}\n'
    const configuredAccount: Record<string, unknown> = {
      generation: 'generation-a',
      credentialRevision: '1:revision-a',
      auth: {
        type: 'codex-auth-json',
        encoding: 'base64',
        token: Buffer.from(authContent, 'utf8').toString('base64')
      }
    }
    const staleConfig = {
      adapters: {
        codex: {
          accounts: { work: configuredAccount }
        }
      }
    }
    tempDirs.push(workspace)
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(explicitAuthPath, authContent)
    await writeFile(globalConfigPath, JSON.stringify(staleConfig))
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'account/rateLimitResetCredit/consume') {
    writeFileSync(${JSON.stringify(consumeMarkerPath)}, 'consumed')
  }
  if (message.id != null) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }) + '\\n')
  }
})
`
    )
    await chmod(fakeCodexPath, 0o755)

    let releaseCanonicalLock = () => {}
    let markCanonicalLockAcquired = () => {}
    const canonicalLockRelease = new Promise<void>(resolvePromise => {
      releaseCanonicalLock = resolvePromise
    })
    const canonicalLockAcquired = new Promise<void>(resolvePromise => {
      markCanonicalLockAcquired = resolvePromise
    })
    const heldLock = withCanonicalConfigWriteLock(globalConfigPath, async () => {
      markCanonicalLockAcquired()
      await canonicalLockRelease
    })
    await canonicalLockAcquired

    const consuming = manageCodexAccount(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [staleConfig as any]
      }),
      {
        action: 'consume-reset-credit',
        account: 'work',
        operationId: `reset-cas-${scenario}`
      }
    )

    const replacementAccount = structuredClone(configuredAccount)
    const replacementConfig: any = {
      adapters: {
        codex: {
          accounts: { work: replacementAccount }
        }
      }
    }
    if (scenario === 'same-bytes-new-generation') {
      replacementAccount.generation = 'generation-b'
    } else if (scenario === 'newer-revision') {
      replacementAccount.credentialRevision = '2:revision-b'
    } else if (scenario === 'auth-file-switch') {
      delete replacementAccount.auth
      replacementAccount.authFile = explicitAuthPath
    } else {
      replacementConfig.adapters.codex.accountTombstones = { work: ['generation-a'] }
    }
    await writeFile(globalConfigPath, JSON.stringify(replacementConfig))
    releaseCanonicalLock()
    await heldLock

    await expect(consuming).rejects.toThrow(/changed.*reset-credit request/iu)
    await expect(readFile(consumeMarkerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['replacement', 'removal'] as const)(
    'rejects reset-credit when a pure real-home credential changes via %s',
    async (scenario) => {
      const workspace = await mkdtemp(join(tmpdir(), `ow-codex-reset-real-home-${scenario}-`))
      const realHome = join(workspace, 'real-home')
      const realAuthPath = join(realHome, '.codex', 'auth.json')
      const fakeCodexPath = join(workspace, 'fake-codex-app-server.mjs')
      const consumeMarkerPath = join(workspace, 'consume.marker')
      const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
      const oldAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_realhome","refresh_token":"old"}}\n'
      const newAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_realhome","refresh_token":"new"}}\n'
      tempDirs.push(workspace)
      await mkdir(dirname(realAuthPath), { recursive: true })
      await mkdir(dirname(globalConfigPath), { recursive: true })
      await writeFile(realAuthPath, oldAuthContent)
      await writeFile(globalConfigPath, '{}')
      await writeFile(
        fakeCodexPath,
        `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(consumeMarkerPath)}, 'spawned')
`
      )
      await chmod(fakeCodexPath, 0o755)

      let releaseCanonicalLock = () => {}
      let markCanonicalLockAcquired = () => {}
      let markDescriptorRead = () => {}
      const canonicalLockRelease = new Promise<void>(resolvePromise => {
        releaseCanonicalLock = resolvePromise
      })
      const canonicalLockAcquired = new Promise<void>(resolvePromise => {
        markCanonicalLockAcquired = resolvePromise
      })
      const descriptorRead = new Promise<void>(resolvePromise => {
        markDescriptorRead = resolvePromise
      })
      credentialFsRaceHooks.afterReadFile = async ({ path }) => {
        if (path === realAuthPath) markDescriptorRead()
      }
      const heldLock = withCanonicalConfigWriteLock(globalConfigPath, async () => {
        markCanonicalLockAcquired()
        await canonicalLockRelease
      })
      await canonicalLockAcquired

      const consuming = manageCodexAccount(
        createTestCtx(workspace, {
          env: {
            HOME: resolveTestMockHome(workspace, realHome),
            __ONEWORKS_PROJECT_REAL_HOME__: realHome,
            __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
          },
          configs: [{} as any]
        }),
        {
          action: 'consume-reset-credit',
          account: 'account-realhome',
          operationId: `real-home-${scenario}`
        }
      )

      await descriptorRead
      if (scenario === 'replacement') await writeFile(realAuthPath, newAuthContent)
      else await rm(realAuthPath)
      releaseCanonicalLock()
      await heldLock

      await expect(consuming).rejects.toThrow(/changed.*reset-credit request/iu)
      await expect(readFile(consumeMarkerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it('rejects reset-credit when a global inline account adopted real-home and that source changes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-reset-adopted-real-home-'))
    const realHome = join(workspace, 'real-home')
    const realAuthPath = join(realHome, '.codex', 'auth.json')
    const fakeCodexPath = join(workspace, 'fake-codex-app-server.mjs')
    const consumeMarkerPath = join(workspace, 'consume.marker')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const inlineAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_adopt","refresh_token":"portable"}}\n'
    const realAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_adopt","refresh_token":"local-old"}}\n'
    const replacementAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_adopt","refresh_token":"local-new"}}\n'
    const globalConfig = {
      adapters: {
        codex: {
          accounts: {
            work: {
              generation: 'generation-adopt',
              credentialRevision: '1:adopt',
              auth: {
                type: 'codex-auth-json',
                encoding: 'base64',
                token: Buffer.from(inlineAuthContent, 'utf8').toString('base64')
              }
            }
          }
        }
      }
    }
    tempDirs.push(workspace)
    await mkdir(dirname(realAuthPath), { recursive: true })
    await mkdir(dirname(globalConfigPath), { recursive: true })
    await writeFile(realAuthPath, realAuthContent)
    await writeFile(globalConfigPath, JSON.stringify(globalConfig))
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(consumeMarkerPath)}, 'spawned')
`
    )
    await chmod(fakeCodexPath, 0o755)

    let releaseCanonicalLock = () => {}
    let markCanonicalLockAcquired = () => {}
    let markDescriptorRead = () => {}
    const canonicalLockRelease = new Promise<void>(resolvePromise => {
      releaseCanonicalLock = resolvePromise
    })
    const canonicalLockAcquired = new Promise<void>(resolvePromise => {
      markCanonicalLockAcquired = resolvePromise
    })
    const descriptorRead = new Promise<void>(resolvePromise => {
      markDescriptorRead = resolvePromise
    })
    credentialFsRaceHooks.afterReadFile = async ({ path }) => {
      if (path === realAuthPath) markDescriptorRead()
    }
    const heldLock = withCanonicalConfigWriteLock(globalConfigPath, async () => {
      markCanonicalLockAcquired()
      await canonicalLockRelease
    })
    await canonicalLockAcquired

    const consuming = manageCodexAccount(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [globalConfig as any]
      }),
      {
        action: 'consume-reset-credit',
        account: 'work',
        operationId: 'adopted-real-home-replacement'
      }
    )

    await descriptorRead
    await writeFile(realAuthPath, replacementAuthContent)
    releaseCanonicalLock()
    await heldLock

    await expect(consuming).rejects.toThrow(/changed.*reset-credit request/iu)
    await expect(readFile(consumeMarkerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('binds reset-credit to the exact materialized bytes across an A-to-B-to-A source race', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-reset-materialized-aba-'))
    const realHome = join(workspace, 'real-home')
    const realAuthPath = join(realHome, '.codex', 'auth.json')
    const fakeCodexPath = join(workspace, 'fake-codex-app-server.mjs')
    const consumeMarkerPath = join(workspace, 'consume.marker')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const authContentA = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_aba_a","refresh_token":"a"}}\n'
    const authContentB = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_aba_b","refresh_token":"b"}}\n'
    tempDirs.push(workspace)
    await mkdir(dirname(realAuthPath), { recursive: true })
    await mkdir(dirname(globalConfigPath), { recursive: true })
    await writeFile(realAuthPath, authContentA)
    await writeFile(globalConfigPath, '{}')
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(consumeMarkerPath)}, 'spawned')
`
    )
    await chmod(fakeCodexPath, 0o755)

    let sourceReads = 0
    credentialFsRaceHooks.afterReadFile = async ({ path }) => {
      if (path !== realAuthPath) return
      sourceReads += 1
      if (sourceReads === 2) await writeFile(realAuthPath, authContentB)
      if (sourceReads === 3) await writeFile(realAuthPath, authContentA)
    }

    await expect(manageCodexAccount(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [undefined, {} as any]
      }),
      {
        action: 'consume-reset-credit',
        account: 'account-acctabaa',
        operationId: 'materialized-aba'
      }
    )).rejects.toThrow(/changed.*reset-credit request/iu)

    expect(sourceReads).toBeGreaterThanOrEqual(4)
    expect(await readFile(realAuthPath, 'utf8')).toBe(authContentA)
    await expect(readFile(consumeMarkerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['delete', 'tombstone'] as const)(
    'rejects reset-credit when a canonical authFile account changes via %s before capture',
    async (scenario) => {
      const workspace = await mkdtemp(join(tmpdir(), `ow-codex-reset-auth-file-${scenario}-`))
      const realHome = join(workspace, 'real-home')
      const configuredAuthPath = join(workspace, 'configured-auth.json')
      const fakeCodexPath = join(workspace, 'fake-codex-app-server.mjs')
      const consumeMarkerPath = join(workspace, 'consume.marker')
      const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
      const authContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_auth_file"}}\n'
      const configuredAccount = {
        authFile: configuredAuthPath,
        generation: 'generation-auth-file',
        credentialRevision: '1:auth-file'
      }
      const globalConfig: any = {
        adapters: {
          codex: {
            accounts: { work: configuredAccount }
          }
        }
      }
      tempDirs.push(workspace)
      await mkdir(dirname(globalConfigPath), { recursive: true })
      await writeFile(configuredAuthPath, authContent)
      await writeFile(globalConfigPath, JSON.stringify(globalConfig))
      await writeFile(
        fakeCodexPath,
        `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(consumeMarkerPath)}, 'spawned')
`
      )
      await chmod(fakeCodexPath, 0o755)

      let releaseCanonicalLock = () => {}
      let markCanonicalLockAcquired = () => {}
      let markDescriptorRead = () => {}
      const canonicalLockRelease = new Promise<void>(resolvePromise => {
        releaseCanonicalLock = resolvePromise
      })
      const canonicalLockAcquired = new Promise<void>(resolvePromise => {
        markCanonicalLockAcquired = resolvePromise
      })
      const descriptorRead = new Promise<void>(resolvePromise => {
        markDescriptorRead = resolvePromise
      })
      credentialFsRaceHooks.afterReadFile = async ({ path }) => {
        if (path === configuredAuthPath) markDescriptorRead()
      }
      const heldLock = withCanonicalConfigWriteLock(globalConfigPath, async () => {
        markCanonicalLockAcquired()
        await canonicalLockRelease
      })
      await canonicalLockAcquired

      const consuming = manageCodexAccount(
        createTestCtx(workspace, {
          env: {
            HOME: resolveTestMockHome(workspace, realHome),
            __ONEWORKS_PROJECT_REAL_HOME__: realHome,
            __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
          },
          configs: [undefined, globalConfig]
        }),
        {
          action: 'consume-reset-credit',
          account: 'work',
          operationId: `canonical-auth-file-${scenario}`
        }
      )

      await descriptorRead
      const replacementConfig = structuredClone(globalConfig)
      if (scenario === 'delete') {
        delete replacementConfig.adapters.codex.accounts.work
      } else {
        replacementConfig.adapters.codex.accountTombstones = {
          work: ['generation-auth-file']
        }
      }
      await writeFile(globalConfigPath, JSON.stringify(replacementConfig))
      releaseCanonicalLock()
      await heldLock

      await expect(consuming).rejects.toThrow(/changed.*reset-credit request/iu)
      await expect(readFile(consumeMarkerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it('releases the canonical config lock when reset-credit RPC hangs', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-reset-credit-timeout-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex-app-server.mjs')
    const consumeMarkerPath = join(workspace, 'consume.marker')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const authContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_timeout"}}\n'
    const globalConfig = {
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: {
                type: 'codex-auth-json',
                encoding: 'base64',
                token: Buffer.from(authContent, 'utf8').toString('base64')
              }
            }
          }
        }
      }
    }
    tempDirs.push(workspace)

    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(globalConfig))
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id == null) return

  if (message.method === 'account/rateLimitResetCredit/consume') {
    writeFileSync(${JSON.stringify(consumeMarkerPath)}, 'received')
    return
  }
  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: message.id,
    result: {}
  }) + '\\n')
})
`
    )
    await chmod(fakeCodexPath, 0o755)

    await expect(manageCodexAccount(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath,
          // Leave enough startup headroom for the spawned fixture under full-suite load;
          // the assertion still exercises the bounded timeout and lock-release path.
          __ONEWORKS_PROJECT_ADAPTER_CODEX_RESET_CREDIT_OPERATION_TIMEOUT_MS__: '3000'
        },
        configs: [globalConfig as any]
      }),
      {
        action: 'consume-reset-credit',
        account: 'work',
        operationId: 'reset-credit-timeout'
      }
    )).rejects.toThrow('timed out after 3000ms')

    await expect(readFile(consumeMarkerPath, 'utf8')).resolves.toBe('received')
    await expect(withCanonicalConfigWriteLock(
      globalConfigPath,
      async () => 'released'
    )).resolves.toBe('released')
  })

  it('does not restore removed inline auth from a stale refresh descriptor', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-stale-refresh-removed-auth-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex-app-server.mjs')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const oldAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_removed"}}\n'
    const authDigest = createHash('sha256').update(oldAuthContent).digest('hex')
    const staleConfig = {
      adapters: {
        codex: {
          accounts: {
            work: {
              authDigest,
              auth: {
                type: 'codex-auth-json',
                encoding: 'base64',
                token: Buffer.from(oldAuthContent, 'utf8').toString('base64')
              }
            }
          }
        }
      }
    }
    const currentConfig = {
      adapters: {
        codex: {
          accounts: {
            work: {
              authDigest
            }
          }
        }
      }
    }
    tempDirs.push(workspace)

    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(currentConfig))
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id == null) return

  let result = {}
  if (message.method === 'account/read') {
    result = { account: { type: 'chatgpt', planType: 'pro' } }
  } else if (message.method === 'account/rateLimits/read') {
    result = {
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 44, windowDurationMins: 10080 },
        planType: 'pro'
      }
    }
  }

  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: message.id,
    result
  }) + '\\n')
})
`
    )
    await chmod(fakeCodexPath, 0o755)

    await getCodexAccountDetail(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [staleConfig as any]
      }),
      {
        account: 'work',
        refresh: true
      }
    )

    const persistedConfig = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    const persistedAccount = persistedConfig.adapters.codex.accounts.work
    expect(persistedAccount.auth).toBeUndefined()
    expect(persistedAccount.authDigest).toBe(authDigest)
    expect(persistedAccount.quota).toBeUndefined()
  })

  it('keeps fresh real-home reset credit details across partial probes without reviving changed cards', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-reset-credit-cache-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex-app-server.mjs')
    const markerPath = join(workspace, 'count-only.marker')
    const authFilePath = join(realHome, '.codex', 'auth.json')
    const sharedCache = new Map<string, unknown>()
    tempDirs.push(workspace)

    await mkdir(join(realHome, '.codex'), { recursive: true })
    await writeFile(
      authFilePath,
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_cache","refresh_token":"initial"}}\n'
    )
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import readline from 'node:readline'

const probeIndex = existsSync(${JSON.stringify(markerPath)})
  ? Number(readFileSync(${JSON.stringify(markerPath)}, 'utf8'))
  : 0
writeFileSync(${JSON.stringify(markerPath)}, String(probeIndex + 1))

const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id == null) return

  let result = {}
  if (message.method === 'account/read') {
    writeFileSync(
      process.env.HOME + '/.codex/auth.json',
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          account_id: 'acct_cache',
          refresh_token: 'refreshed-' + probeIndex
        }
      }) + '\\n'
    )
    result = {
      account: {
        type: 'chatgpt',
        email: 'work@example.com',
        planType: 'pro'
      }
    }
  } else if (message.method === 'account/rateLimits/read') {
    result = {
      rateLimits: {
        limitId: 'codex',
        primary: {
          usedPercent: 2,
          windowDurationMins: 10080,
          resetsAt: 1785902972
        },
        planType: 'pro'
      },
      ...(probeIndex === 2 ? {} : {
        rateLimitResetCredits: {
          availableCount: probeIndex >= 4 ? 1 : 2,
          ...(probeIndex === 0 ? {
          credits: [
            {
              id: 'credit-a',
              status: 'available',
              title: 'Full reset',
              grantedAt: 1785200000,
              expiresAt: 4102444800
            },
            {
              id: 'credit-b',
              status: 'available',
              title: 'Full reset',
              grantedAt: 1785600000,
              expiresAt: 4102444800
            }
          ]
          } : {})
        }
      })
    }
  }

  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: message.id,
    result
  }) + '\\n')
})
`
    )
    await chmod(fakeCodexPath, 0o755)

    const createCtx = () =>
      createTestCtx(workspace, {
        cacheStore: sharedCache,
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        }
      })

    const first = await getCodexAccounts(createCtx(), { refresh: true })
    const accountKey = first.accounts[0]?.key
    expect(accountKey).toBeDefined()
    const cachedAfterAuthRotation = await getCodexAccountDetail(createCtx(), {
      account: accountKey!
    })
    expect(cachedAfterAuthRotation.account.quota?.rateLimitResetCredits?.credits).toMatchObject([
      expect.objectContaining({ id: 'credit-a' }),
      expect.objectContaining({ id: 'credit-b' })
    ])

    const second = await getCodexAccountDetail(createCtx(), {
      account: accountKey!,
      refresh: true
    })

    expect(second.account.quota?.rateLimitResetCredits).toMatchObject({
      availableCount: 2,
      credits: [
        expect.objectContaining({
          id: 'credit-a',
          grantedAt: 1785200000,
          expiresAt: 4102444800
        }),
        expect.objectContaining({
          id: 'credit-b',
          grantedAt: 1785600000,
          expiresAt: 4102444800
        })
      ]
    })

    const third = await getCodexAccountDetail(createCtx(), {
      account: accountKey!,
      refresh: true
    })
    expect(third.account.quota?.rateLimitResetCredits?.credits).toMatchObject([
      expect.objectContaining({ id: 'credit-a' }),
      expect.objectContaining({ id: 'credit-b' })
    ])

    const cachedQuotas = sharedCache.get('adapter.codex.account-quotas') as Record<
      string,
      { resetCreditDetailsCapturedAt?: number }
    >
    for (const entry of Object.values(cachedQuotas)) {
      entry.resetCreditDetailsCapturedAt = Date.now() - 5 * 60 * 1000 - 1
    }

    const fourth = await getCodexAccountDetail(createCtx(), {
      account: accountKey!,
      refresh: true
    })
    expect(fourth.account.quota?.rateLimitResetCredits).toEqual({
      availableCount: 2,
      canConsume: true
    })

    const fifth = await getCodexAccountDetail(createCtx(), {
      account: accountKey!,
      refresh: true
    })
    expect(fifth.account.quota?.rateLimitResetCredits).toEqual({
      availableCount: 1,
      canConsume: true
    })
  })

  it('does not reuse expired reset credit details from global config on non-refresh reads', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-reset-credit-global-cache-'))
    const authContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_stale"}}\n'
    const staleUpdatedAt = Date.now() - 6 * 60 * 1000
    tempDirs.push(workspace)

    const detail = await getCodexAccountDetail(
      createTestCtx(workspace, {
        configs: [{
          adapters: {
            codex: {
              defaultAccount: 'work',
              accounts: {
                work: {
                  auth: {
                    type: 'codex-auth-json',
                    encoding: 'base64',
                    token: Buffer.from(authContent, 'utf8').toString('base64')
                  },
                  quota: {
                    updatedAt: staleUpdatedAt,
                    rateLimitResetCredits: {
                      availableCount: 2,
                      canConsume: true,
                      credits: [
                        {
                          id: 'credit-a',
                          status: 'available',
                          expiresAt: 4102444800
                        },
                        {
                          id: 'credit-b',
                          status: 'available',
                          expiresAt: 4102444800
                        }
                      ]
                    }
                  }
                }
              }
            }
          }
        } as any]
      }),
      { account: 'work' }
    )

    expect(detail.account.quota?.rateLimitResetCredits).toEqual({
      availableCount: 2,
      canConsume: true,
      credits: undefined
    })
  })

  it('keeps the original reset-credit capture timestamp across persistence and cache restart', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-reset-credit-capture-ttl-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex-app-server.mjs')
    const probeObservationPath = join(workspace, 'probe-observation.json')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const authContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_capture"}}\n'
    const baseNow = Date.now()
    const capturedAt = baseNow - 4 * 60 * 1000
    const globalConfig = {
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: {
                type: 'codex-auth-json',
                encoding: 'base64',
                token: Buffer.from(authContent, 'utf8').toString('base64')
              },
              quota: {
                updatedAt: capturedAt,
                rateLimitResetCredits: {
                  availableCount: 2,
                  canConsume: true,
                  credits: [
                    { id: 'credit-a', status: 'available', expiresAt: 4102444800 },
                    { id: 'credit-b', status: 'available', expiresAt: 4102444800 }
                  ]
                }
              },
              resetCreditDetailsCapturedAt: capturedAt
            }
          }
        }
      }
    }
    tempDirs.push(workspace)

    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(globalConfig))
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import readline from 'node:readline'

const probeAuthPath = join(process.env.CODEX_HOME, 'auth.json')
writeFileSync(${JSON.stringify(probeObservationPath)}, JSON.stringify({
  authPath: probeAuthPath,
  homeDir: process.env.HOME,
  mode: statSync(probeAuthPath).mode & 0o777
}))

const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id == null) return

  let result = {}
  if (message.method === 'account/read') {
    result = { account: { type: 'chatgpt', planType: 'pro' } }
  } else if (message.method === 'account/rateLimits/read') {
    result = {
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 4, windowDurationMins: 10080 },
        planType: 'pro'
      },
      rateLimitResetCredits: { availableCount: 2 }
    }
  }

  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: message.id,
    result
  }) + '\\n')
})
`
    )
    await chmod(fakeCodexPath, 0o755)

    const refreshed = await getCodexAccountDetail(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [globalConfig as any]
      }),
      { account: 'work', refresh: true }
    )
    expect(refreshed.account.quota?.rateLimitResetCredits?.credits).toHaveLength(2)
    if (process.platform !== 'win32') {
      const observation = JSON.parse(await readFile(probeObservationPath, 'utf8')) as {
        authPath: string
        homeDir: string
        mode: number
      }
      expect(observation.authPath).toBe(join(observation.homeDir, '.codex', 'auth.json'))
      expect(observation.homeDir).toContain('detail-work-')
      expect(observation.mode).toBe(0o600)
      await expect(stat(observation.homeDir)).rejects.toMatchObject({ code: 'ENOENT' })
    }

    const persistedConfig = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    const persistedAccount = persistedConfig.adapters.codex.accounts.work
    expect(persistedAccount.resetCreditDetailsCapturedAt).toBe(capturedAt)
    expect(persistedAccount.quota.updatedAt).toBeGreaterThan(capturedAt)

    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(baseNow + 2 * 60 * 1000)
    try {
      const restarted = await getCodexAccountDetail(
        createTestCtx(workspace, {
          cacheStore: new Map(),
          env: {
            HOME: resolveTestMockHome(workspace, realHome),
            __ONEWORKS_PROJECT_REAL_HOME__: realHome
          },
          configs: [persistedConfig]
        }),
        { account: 'work' }
      )

      expect(restarted.account.quota?.rateLimitResetCredits).toEqual({
        availableCount: 2,
        canConsume: true,
        credits: undefined
      })
    } finally {
      dateNow.mockRestore()
    }
  })

  it('isolates and removes cached quota when identity, organization, or auth source changes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-quota-fingerprint-'))
    tempDirs.push(workspace)

    for (const scenario of ['identity', 'organization', 'authFile', 'authFileContent'] as const) {
      const accountKey = `work-${scenario}`
      const firstAuthFilePath = join(workspace, `${scenario}-first-auth.json`)
      const secondAuthFilePath = join(workspace, `${scenario}-second-auth.json`)
      const sharedCache = new Map<string, unknown>()
      await writeFile(
        firstAuthFilePath,
        '{"auth_mode":"chatgpt","tokens":{"refresh_token":"first"}}\n'
      )
      await writeFile(
        secondAuthFilePath,
        '{"auth_mode":"chatgpt","tokens":{"refresh_token":"first"}}\n'
      )

      const createAccountCtx = (account: Record<string, unknown>) =>
        createTestCtx(workspace, {
          cacheStore: sharedCache,
          configs: [{
            adapters: {
              codex: {
                accounts: {
                  [accountKey]: account
                }
              }
            }
          } as any]
        })
      const initialAccount = {
        accountId: 'acct-a',
        organizationId: 'org-a',
        authFile: firstAuthFilePath,
        quota: {
          summary: `cached-${scenario}`,
          updatedAt: Date.now()
        }
      }

      const first = await getCodexAccountDetail(createAccountCtx(initialAccount), {
        account: accountKey
      })
      expect(first.account.quota?.summary).toBe(`cached-${scenario}`)

      const replacementAccount: Record<string, unknown> = {
        accountId: scenario === 'identity' ? 'acct-b' : 'acct-a',
        organizationId: scenario === 'organization' ? 'org-b' : 'org-a',
        authFile: scenario === 'authFile' ? secondAuthFilePath : firstAuthFilePath
      }
      if (scenario === 'authFileContent') {
        await writeFile(
          firstAuthFilePath,
          '{"auth_mode":"chatgpt","tokens":{"refresh_token":"second"}}\n'
        )
      }

      const replacement = await getCodexAccountDetail(createAccountCtx(replacementAccount), {
        account: accountKey
      })
      expect(
        Object.keys(
          (sharedCache.get('adapter.codex.account-quotas') as Record<string, unknown> | undefined) ?? {}
        ),
        scenario
      ).toEqual([])
      expect(replacement.account.quota, scenario).toBeUndefined()
    }
  })

  it('removes quota cache entries when a global account is deleted', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-quota-cache-remove-'))
    const realHome = join(workspace, 'real-home')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const sharedCache = new Map<string, unknown>()
    const authContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_remove"}}\n'
    const globalConfig = {
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: {
                type: 'codex-auth-json',
                encoding: 'base64',
                token: Buffer.from(authContent, 'utf8').toString('base64')
              },
              quota: {
                summary: 'cached-remove',
                updatedAt: Date.now()
              }
            }
          }
        }
      }
    }
    tempDirs.push(workspace)

    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(globalConfig))
    const ctx = createTestCtx(workspace, {
      cacheStore: sharedCache,
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      configs: [globalConfig as any]
    })

    const detail = await getCodexAccountDetail(ctx, { account: 'work' })
    expect(detail.account.quota?.summary).toBe('cached-remove')
    expect(
      Object.keys(sharedCache.get('adapter.codex.account-quotas') as Record<string, unknown>)
    ).toHaveLength(1)

    await manageCodexAccount(ctx, {
      action: 'remove',
      account: 'work'
    })

    expect(sharedCache.get('adapter.codex.account-quotas')).toEqual({})
    const removedConfig = JSON.parse(await readFile(globalConfigPath, 'utf8'))
    expect(removedConfig.adapters.codex.accounts).toEqual({})
    expect(removedConfig.adapters.codex.accountTombstones.work).toEqual([expect.any(String)])
  })

  it('serializes concurrent quota probes through cache and global metadata persistence', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-quota-concurrent-persist-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex-app-server.mjs')
    const probeCounterPath = join(workspace, 'probe-count.txt')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const authContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_concurrent"}}\n'
    const globalConfig = {
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: {
                type: 'codex-auth-json',
                encoding: 'base64',
                token: Buffer.from(authContent, 'utf8').toString('base64')
              }
            }
          }
        }
      }
    }
    tempDirs.push(workspace)

    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(globalConfig))
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import readline from 'node:readline'

const probeIndex = existsSync(${JSON.stringify(probeCounterPath)})
  ? Number(readFileSync(${JSON.stringify(probeCounterPath)}, 'utf8'))
  : 0
writeFileSync(${JSON.stringify(probeCounterPath)}, String(probeIndex + 1))

const input = readline.createInterface({ input: process.stdin })
const respond = (id, result) => {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
}
input.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id == null) return

  if (message.method === 'account/read') {
    respond(message.id, { account: { type: 'chatgpt', planType: 'pro' } })
    return
  }
  if (message.method === 'account/rateLimits/read') {
    const result = {
      rateLimits: {
        limitId: 'codex',
        primary: {
          usedPercent: probeIndex === 0 ? 10 : 20,
          windowDurationMins: 10080
        },
        planType: 'pro'
      }
    }
    setTimeout(() => respond(message.id, result), probeIndex === 0 ? 150 : 0)
    return
  }

  respond(message.id, {})
})
`
    )
    await chmod(fakeCodexPath, 0o755)

    const ctx = createTestCtx(workspace, {
      cacheStore: new Map(),
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
      },
      configs: [globalConfig as any]
    })
    const results = await Promise.all([
      getCodexAccountDetail(ctx, { account: 'work', refresh: true }),
      getCodexAccountDetail(ctx, { account: 'work', refresh: true })
    ])
    const usageValues = results
      .map(result => result.account.quota?.metrics?.find(metric => metric.id === 'primary-usage')?.value)
      .sort()

    expect(usageValues).toEqual(['10%', '20%'])
    await expect(readFile(probeCounterPath, 'utf8')).resolves.toBe('2')

    const persistedConfig = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    const persistedUsage = persistedConfig.adapters.codex.accounts.work.quota.metrics
      .find((metric: { id?: string }) => metric.id === 'primary-usage')
    expect(persistedUsage?.value).toBe('20%')
  })

  it('reauthenticates a Codex account in place in the global OneWorks config', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-login-global-'))
    const realHome = join(workspace, 'real-home')
    const ambientCodexHome = join(workspace, 'ambient-codex-home')
    const fakeCodexPath = join(workspace, 'fake-codex.mjs')
    const authContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_login"}}\n'
    tempDirs.push(workspace)

    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.argv[2] === 'login') {
  if (!process.argv.includes('cli_auth_credentials_store="file"')) process.exit(2)
  mkdirSync(process.env.CODEX_HOME, { recursive: true })
  writeFileSync(join(process.env.CODEX_HOME, 'auth.json'), ${JSON.stringify(authContent)})
  process.exit(0)
}

${fakeSuccessfulAccountProbe}
if (process.argv[2] !== 'app-server') process.exit(1)
`
    )
    await chmod(fakeCodexPath, 0o755)
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    const existingConfig = {
      adapters: {
        codex: {
          accounts: {
            Work_Account: {
              title: 'Old Work',
              authFile: '/tmp/old-codex-auth.json'
            }
          }
        }
      }
    }
    await writeFile(
      join(realHome, '.oneworks', '.oo.config.json'),
      JSON.stringify(existingConfig)
    )

    const ctx = createTestCtx(workspace, {
      env: {
        CODEX_HOME: ambientCodexHome,
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
      },
      configs: [existingConfig as any]
    })

    const progressPhases: string[] = []
    const result = await manageCodexAccount(ctx, {
      action: 'reauthenticate',
      account: 'Work_Account',
      onProgress: event => {
        if (event.phase != null) progressPhases.push(event.phase)
      }
    })

    const globalConfig = JSON.parse(
      await readFile(join(realHome, '.oneworks', '.oo.config.json'), 'utf8')
    ) as any
    const storedAccount = globalConfig.adapters.codex.accounts.Work_Account

    expect(result.accountKey).toBe('Work_Account')
    expect(result.artifacts).toBeUndefined()
    expect(storedAccount.source).toBe('codex-login')
    expect(storedAccount.auth).toMatchObject({
      type: 'codex-auth-json',
      encoding: 'base64'
    })
    expect(storedAccount.authFile).toBeUndefined()
    expect(Buffer.from(storedAccount.auth.token, 'base64').toString('utf8')).toBe(authContent)
    expect(globalConfig.adapters.codex.accounts['work-account']).toBeUndefined()
    await expect(stat(join(ambientCodexHome, 'auth.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(result.message).toContain('Reauthenticated Codex account')
    expect(progressPhases).toEqual([
      'preparing',
      'awaiting-authorization',
      'verifying',
      'saving'
    ])

    progressPhases.length = 0
    await manageCodexAccount(ctx, {
      action: 'add',
      onProgress: event => {
        if (event.phase != null) progressPhases.push(event.phase)
      }
    })
    expect(progressPhases).toEqual([
      'preparing',
      'awaiting-authorization',
      'verifying',
      'saving'
    ])
  })

  it('does not reuse an existing login key from email and organization when accountId is missing', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-login-missing-account-id-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex.mjs')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const jwtPayload = Buffer.from(JSON.stringify({
      email: 'shared@example.com',
      'https://api.openai.com/auth': {
        organizations: [{ id: 'org_shared', is_default: true, title: 'Shared Org' }]
      }
    })).toString('base64url')
    const buildAuthContent = (refreshToken: string) =>
      `${
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: {
            id_token: `header.${jwtPayload}.signature`,
            refresh_token: refreshToken
          }
        })
      }\n`
    const existingAuthContent = buildAuthContent('existing')
    const loginAuthContent = buildAuthContent('login')
    const generatedKey = 'chatgpt-shared-example-com-shared-org-rgshared'
    const existingConfig = {
      adapters: {
        codex: {
          accounts: {
            [generatedKey]: {
              auth: {
                type: 'codex-auth-json',
                encoding: 'base64',
                token: Buffer.from(existingAuthContent, 'utf8').toString('base64')
              }
            }
          }
        }
      }
    }
    tempDirs.push(workspace)
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(existingConfig))
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.argv[2] === 'login') {
  mkdirSync(process.env.CODEX_HOME, { recursive: true })
  writeFileSync(join(process.env.CODEX_HOME, 'auth.json'), ${JSON.stringify(loginAuthContent)})
  process.exit(0)
}

${fakeSuccessfulAccountProbe}
if (process.argv[2] !== 'app-server') process.exit(1)
`
    )
    await chmod(fakeCodexPath, 0o755)

    const result = await manageCodexAccount(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [existingConfig as any]
      }),
      { action: 'add' }
    )
    const persistedConfig = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any

    expect(result.accountKey).not.toBe(generatedKey)
    expect(result.accountKey).toMatch(new RegExp(`^${generatedKey}-[a-f0-9]{12}`))
    expect(Object.keys(persistedConfig.adapters.codex.accounts)).toHaveLength(2)
    expect(
      Buffer.from(
        persistedConfig.adapters.codex.accounts[generatedKey].auth.token,
        'base64'
      ).toString('utf8')
    ).toBe(existingAuthContent)
  })

  it('uses final credential bytes instead of stale probe identity when allocating a login collision', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-login-byte-identity-collision-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex.mjs')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const occupantAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct-a"}}\n'
    const finalAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct-b"}}\n'
    const finalDigest = createHash('sha256').update(finalAuthContent).digest('hex')
    const generatedKey = 'account-a'
    const existingConfig = {
      adapters: {
        codex: {
          accounts: {
            [generatedKey]: {
              auth: {
                type: 'codex-auth-json',
                encoding: 'base64',
                token: Buffer.from(occupantAuthContent, 'utf8').toString('base64')
              },
              accountId: 'acct-a'
            }
          }
        }
      }
    }
    tempDirs.push(workspace)
    await mkdir(dirname(globalConfigPath), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(existingConfig))
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.argv[2] === 'login') {
  mkdirSync(process.env.CODEX_HOME, { recursive: true })
  writeFileSync(join(process.env.CODEX_HOME, 'auth.json'), ${JSON.stringify(occupantAuthContent)})
  process.exit(0)
}

if (process.argv[2] === 'app-server') {
  const readline = await import('node:readline')
  const input = readline.default.createInterface({ input: process.stdin })
  input.on('line', (line) => {
    const message = JSON.parse(line)
    if (message.id == null) return
    if (message.method === 'initialize') {
      writeFileSync(join(process.env.CODEX_HOME, 'auth.json'), ${JSON.stringify(finalAuthContent)})
    }
    const result = message.method === 'account/read'
      ? { account: { type: 'chatgpt', planType: 'pro' } }
      : message.method === 'account/rateLimits/read'
      ? { rateLimits: { limitId: 'codex', planType: 'pro' } }
      : {}
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
  })
} else {
  process.exit(1)
}
`
    )
    await chmod(fakeCodexPath, 0o755)

    const result = await manageCodexAccount(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [existingConfig as any]
      }),
      { action: 'add' }
    )
    const persistedConfig = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    const allocatedKey = `${generatedKey}-${finalDigest.slice(0, 12)}`

    expect(result.accountKey).toBe(allocatedKey)
    expect(
      Buffer.from(
        persistedConfig.adapters.codex.accounts[generatedKey].auth.token,
        'base64'
      ).toString('utf8')
    ).toBe(occupantAuthContent)
    expect(
      Buffer.from(
        persistedConfig.adapters.codex.accounts[allocatedKey].auth.token,
        'base64'
      ).toString('utf8')
    ).toBe(finalAuthContent)
  })

  it('does not overwrite a generated-key occupant whose authFile changes after discovery', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-login-auth-file-collision-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex.mjs')
    const existingAuthPath = join(workspace, 'existing-auth.json')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const incomingAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_login_a"}}\n'
    const replacementAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_occupant_b"}}\n'
    const incomingDigest = createHash('sha256').update(incomingAuthContent).digest('hex')
    const existingConfig = {
      adapters: {
        codex: {
          accounts: {
            work: {
              authFile: existingAuthPath,
              authDigest: incomingDigest,
              accountId: 'acct_login_a'
            }
          }
        }
      }
    }
    tempDirs.push(workspace)
    await mkdir(dirname(globalConfigPath), { recursive: true })
    await writeFile(existingAuthPath, incomingAuthContent)
    await writeFile(globalConfigPath, JSON.stringify(existingConfig))
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.argv[2] === 'login') {
  mkdirSync(process.env.CODEX_HOME, { recursive: true })
  writeFileSync(join(process.env.CODEX_HOME, 'auth.json'), ${JSON.stringify(incomingAuthContent)})
  process.exit(0)
}

${fakeSuccessfulAccountProbe}
if (process.argv[2] !== 'app-server') process.exit(1)
`
    )
    await chmod(fakeCodexPath, 0o755)

    let replaced = false
    credentialFsRaceHooks.afterReadFile = async ({ path }) => {
      if (path !== existingAuthPath || replaced) return
      replaced = true
      await writeFile(existingAuthPath, replacementAuthContent)
    }

    const result = await manageCodexAccount(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [undefined, existingConfig as any]
      }),
      { action: 'add' }
    )
    const persistedConfig = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any

    expect(result.accountKey).toBe(`work-${incomingDigest.slice(0, 12)}`)
    expect(persistedConfig.adapters.codex.accounts.work.authFile).toBe(existingAuthPath)
    expect(await readFile(existingAuthPath, 'utf8')).toBe(replacementAuthContent)
    expect(
      Buffer.from(
        persistedConfig.adapters.codex.accounts[result.accountKey!].auth.token,
        'base64'
      ).toString('utf8')
    ).toBe(incomingAuthContent)
  })

  it('does not recreate an account deleted while reauthentication is in progress', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-reauth-delete-race-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex.mjs')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const oldAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_old"}}\n'
    const loginAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_login"}}\n'
    const existingConfig = {
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: {
                type: 'codex-auth-json',
                encoding: 'base64',
                token: Buffer.from(oldAuthContent, 'utf8').toString('base64')
              }
            }
          }
        }
      }
    }
    tempDirs.push(workspace)

    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(existingConfig))
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.argv[2] === 'login') {
  mkdirSync(process.env.CODEX_HOME, { recursive: true })
  writeFileSync(join(process.env.CODEX_HOME, 'auth.json'), ${JSON.stringify(loginAuthContent)})
  const config = JSON.parse(readFileSync(${JSON.stringify(globalConfigPath)}, 'utf8'))
  delete config.adapters.codex.accounts.work
  writeFileSync(${JSON.stringify(globalConfigPath)}, JSON.stringify(config))
  process.exit(0)
}

${fakeSuccessfulAccountProbe}
if (process.argv[2] !== 'app-server') process.exit(1)
`
    )
    await chmod(fakeCodexPath, 0o755)

    await expect(manageCodexAccount(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [existingConfig as any]
      }),
      { action: 'reauthenticate', account: 'work' }
    )).rejects.toThrow('changed while sign-in was in progress')

    const persistedConfig = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    expect(persistedConfig.adapters.codex.accounts.work).toBeUndefined()
  })

  it('does not overwrite a newer credential when an older reauthentication finishes later', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-reauth-superseded-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex.mjs')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const oldAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_old"}}\n'
    const loginAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_login"}}\n'
    const newerAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_newer"}}\n'
    const existingConfig = {
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: {
                type: 'codex-auth-json',
                encoding: 'base64',
                token: Buffer.from(oldAuthContent, 'utf8').toString('base64')
              }
            }
          }
        }
      }
    }
    tempDirs.push(workspace)

    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(globalConfigPath, JSON.stringify(existingConfig))
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.argv[2] === 'login') {
  mkdirSync(process.env.CODEX_HOME, { recursive: true })
  writeFileSync(join(process.env.CODEX_HOME, 'auth.json'), ${JSON.stringify(loginAuthContent)})
  const config = JSON.parse(readFileSync(${JSON.stringify(globalConfigPath)}, 'utf8'))
  config.adapters.codex.accounts.work.auth.token = Buffer
    .from(${JSON.stringify(newerAuthContent)}, 'utf8')
    .toString('base64')
  writeFileSync(${JSON.stringify(globalConfigPath)}, JSON.stringify(config))
  process.exit(0)
}

${fakeSuccessfulAccountProbe}
if (process.argv[2] !== 'app-server') process.exit(1)
`
    )
    await chmod(fakeCodexPath, 0o755)

    await expect(manageCodexAccount(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [existingConfig as any]
      }),
      { action: 'reauthenticate', account: 'work' }
    )).rejects.toThrow('changed while sign-in was in progress')

    const persistedConfig = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    const persistedAuth = persistedConfig.adapters.codex.accounts.work.auth
    expect(Buffer.from(persistedAuth.token, 'base64').toString('utf8')).toBe(newerAuthContent)
  })
})
