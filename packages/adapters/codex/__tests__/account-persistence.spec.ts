/* eslint-disable max-lines -- credential persistence scenarios keep login, refresh, and CAS fixtures together. */
import { Buffer } from 'node:buffer'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AdapterCtx } from '@oneworks/types'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'
import { resolveManagedNpmCliPaths } from '@oneworks/utils/managed-npm-cli'

import { CODEX_CLI_PACKAGE, CODEX_CLI_VERSION } from '#~/paths.js'
import { getCodexAccountDetail, manageCodexAccount } from '#~/runtime/accounts.js'

const tempDirs: string[] = []

const resolveTestMockHome = (workspace: string, realHome: string) =>
  resolveProjectHomePath(workspace, { HOME: realHome, __ONEWORKS_PROJECT_REAL_HOME__: realHome }, '.mock')

const createTestCtx = (
  workspace: string,
  overrides: Partial<Pick<AdapterCtx, 'env' | 'configs'>> = {}
): AdapterCtx => {
  const cacheStore = new Map<string, unknown>()

  return {
    ctxId: 'ctx',
    cwd: workspace,
    env: overrides.env ?? {
      HOME: resolveTestMockHome(workspace, join(workspace, 'missing-real-home')),
      __ONEWORKS_PROJECT_REAL_HOME__: join(workspace, 'missing-real-home')
    },
    cache: {
      set: async (key: any, value: unknown) => {
        cacheStore.set(String(key), value)
        return { cachePath: '' }
      },
      get: async (key: any) => cacheStore.get(String(key)) as never
    },
    logger: {
      stream: new PassThrough(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    },
    configs: overrides.configs ?? []
  }
}

const writeFakeCodexLogin = async (params: {
  path: string
  authContent: string
  refreshedAuthContent?: string
  failProbeMethod?: 'account/read' | 'account/rateLimits/read'
  expectedProbeAuthContent?: string
  mutateConfigOnAccountRead?: {
    path: string
    accountKey: string
    generation: string
    credentialRevision: string
  }
}) => {
  await writeFile(
    params.path,
    `#!/usr/bin/env node
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import readline from 'node:readline'

if (process.argv.includes('--version')) {
  process.stdout.write('codex-cli 0.130.0\\n')
  process.exit(0)
}

if (process.argv[2] === 'login') {
  mkdirSync(join(process.env.HOME, '.codex'), { recursive: true })
  writeFileSync(join(process.env.HOME, '.codex', 'auth.json'), ${JSON.stringify(params.authContent)})
  process.exit(0)
}

if (process.argv[2] === 'app-server') {
  const input = readline.createInterface({ input: process.stdin })
  input.on('line', (line) => {
    const message = JSON.parse(line)
    if (message.id == null) return

    if (message.method === 'account/read' && ${JSON.stringify(params.expectedProbeAuthContent)} != null) {
      const codexHome = process.env.CODEX_HOME || join(process.env.HOME, '.codex')
      const actualAuth = readFileSync(join(codexHome, 'auth.json'), 'utf8')
      if (actualAuth !== ${JSON.stringify(params.expectedProbeAuthContent)}) {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32000, message: 'wrong_probe_account' }
        }) + '\\n')
        return
      }
    }
    if (message.method === 'account/read' && ${JSON.stringify(params.refreshedAuthContent)} != null) {
      const codexHome = process.env.CODEX_HOME || join(process.env.HOME, '.codex')
      const authPath = join(codexHome, 'auth.json')
      const replacementPath = authPath + '.replacement'
      writeFileSync(replacementPath, ${JSON.stringify(params.refreshedAuthContent)})
      renameSync(replacementPath, authPath)
    }
    const configMutation = ${JSON.stringify(params.mutateConfigOnAccountRead)}
    if (message.method === 'account/read' && configMutation != null) {
      const config = JSON.parse(readFileSync(configMutation.path, 'utf8'))
      const account = config.adapters.codex.accounts[configMutation.accountKey]
      account.generation = configMutation.generation
      account.credentialRevision = configMutation.credentialRevision
      writeFileSync(configMutation.path, JSON.stringify(config))
    }
    if (message.method === ${JSON.stringify(params.failProbeMethod)}) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32000, message: 'token_expired' }
      }) + '\\n')
      return
    }

    const result = message.method === 'account/read'
      ? { account: { type: 'chatgpt', planType: 'pro' } }
      : message.method === 'account/rateLimits/read'
      ? { rateLimits: { limitId: 'codex', planType: 'pro' } }
      : {}
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
  })
}

if (process.argv[2] !== 'app-server') process.exit(1)
`
  )
  await chmod(params.path, 0o755)
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('codex account persistence', () => {
  it('does not persist generated account titles', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-login-generated-title-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex.mjs')
    const authContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_default"}}\n'
    tempDirs.push(workspace)
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFakeCodexLogin({ path: fakeCodexPath, authContent })

    const ctx = createTestCtx(workspace, {
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
      }
    })

    const result = await manageCodexAccount(ctx, {
      action: 'add',
      account: 'default'
    })

    const globalConfig = JSON.parse(
      await readFile(join(realHome, '.oneworks', '.oo.config.json'), 'utf8')
    ) as any
    const storedAccount = globalConfig.adapters.codex.accounts.default

    expect(result.accountKey).toBe('default')
    expect(storedAccount).not.toHaveProperty('title')
    expect(storedAccount.auth).toMatchObject({
      type: 'codex-auth-json',
      encoding: 'base64'
    })
    expect(Buffer.from(storedAccount.auth.token, 'base64').toString('utf8')).toBe(authContent)
  })

  it('keeps custom account titles', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-login-custom-title-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex.mjs')
    const authContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_work"}}\n'
    tempDirs.push(workspace)
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(
      join(realHome, '.oneworks', '.oo.config.json'),
      '{"adapters":{"codex":{"accounts":{"work":{"title":"Old Work"}}}}}'
    )
    await writeFakeCodexLogin({ path: fakeCodexPath, authContent })

    const ctx = createTestCtx(workspace, {
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
      }
    })

    await manageCodexAccount(ctx, {
      action: 'add',
      account: 'work'
    })

    const globalConfig = JSON.parse(
      await readFile(join(realHome, '.oneworks', '.oo.config.json'), 'utf8')
    ) as any
    expect(globalConfig.adapters.codex.accounts.work.title).toBe('Old Work')
  })

  it('runs login from the managed CLI cache when the app PATH has no codex binary', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-login-managed-cli-'))
    const realHome = join(workspace, 'real-home')
    const authContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_managed"}}\n'
    const env = {
      HOME: resolveTestMockHome(workspace, realHome),
      __ONEWORKS_PROJECT_REAL_HOME__: realHome
    }
    const managedPaths = resolveManagedNpmCliPaths({
      adapterKey: 'codex',
      binaryName: 'codex',
      cwd: workspace,
      env,
      packageName: CODEX_CLI_PACKAGE,
      version: CODEX_CLI_VERSION
    })
    tempDirs.push(workspace)
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await mkdir(managedPaths.binDir, { recursive: true })
    await writeFakeCodexLogin({
      path: managedPaths.binaryPath,
      authContent
    })

    const result = await manageCodexAccount(
      createTestCtx(workspace, {
        env,
        configs: [{
          adapters: {
            codex: {
              cli: { source: 'managed' }
            }
          }
        } as any]
      }),
      {
        action: 'add',
        account: 'managed'
      }
    )

    expect(result.accountKey).toBe('managed')
    const globalConfig = JSON.parse(
      await readFile(join(realHome, '.oneworks', '.oo.config.json'), 'utf8')
    ) as any
    expect(
      Buffer.from(
        globalConfig.adapters.codex.accounts.managed.auth.token,
        'base64'
      ).toString('utf8')
    ).toBe(authContent)
  })

  it('does not save login credentials when the official account probe fails', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-login-probe-failure-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex.mjs')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const oldAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_old"}}\n'
    const loginAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_new"}}\n'
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
    await writeFakeCodexLogin({
      path: fakeCodexPath,
      authContent: loginAuthContent,
      failProbeMethod: 'account/read'
    })

    await expect(manageCodexAccount(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [existingConfig as any]
      }),
      {
        action: 'reauthenticate',
        account: 'work'
      }
    )).rejects.toThrow('token_expired')

    const persistedConfig = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    const persistedAuth = persistedConfig.adapters.codex.accounts.work.auth
    expect(Buffer.from(persistedAuth.token, 'base64').toString('utf8')).toBe(oldAuthContent)
  })

  it('verifies login credentials in the isolated CODEX_HOME and removes the login probe home', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-login-isolated-home-'))
    const realHome = join(workspace, 'real-home')
    const ambientCodexHome = join(workspace, 'ambient-codex-home')
    const fakeCodexPath = join(workspace, 'fake-codex.mjs')
    const loginAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_target"}}\n'
    const ambientAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_other"}}\n'
    tempDirs.push(workspace)
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await mkdir(ambientCodexHome, { recursive: true })
    await writeFile(join(ambientCodexHome, 'auth.json'), ambientAuthContent)
    await writeFakeCodexLogin({
      path: fakeCodexPath,
      authContent: loginAuthContent,
      expectedProbeAuthContent: loginAuthContent
    })
    const env = {
      CODEX_HOME: ambientCodexHome,
      HOME: resolveTestMockHome(workspace, realHome),
      __ONEWORKS_PROJECT_REAL_HOME__: realHome,
      __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
    }

    const result = await manageCodexAccount(createTestCtx(workspace, { env }), {
      action: 'add',
      account: 'target'
    })

    expect(result.account?.status).toBe('ready')
    await expect(readFile(join(ambientCodexHome, 'auth.json'), 'utf8')).resolves.toBe(ambientAuthContent)
    const probeRoot = resolveProjectHomePath(
      workspace,
      env,
      'caches',
      'ctx',
      'adapter-codex-accounts'
    )
    const probeEntries = await readdir(probeRoot).catch(() => [])
    expect(probeEntries.filter(entry => entry.startsWith('login'))).toEqual([])
  })

  it('persists credentials rotated by a successful refresh probe', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-refresh-rotation-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex.mjs')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const oldAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_work","refresh_token":"old"}}\n'
    const refreshedAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_work","refresh_token":"new"}}\n'
    const existingConfig = {
      adapters: {
        codex: {
          accounts: {
            work: {
              generation: 'generation-stable',
              credentialRevision: '2:stable',
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
    await writeFakeCodexLogin({
      path: fakeCodexPath,
      authContent: oldAuthContent,
      refreshedAuthContent
    })

    const result = await getCodexAccountDetail(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [existingConfig as any]
      }),
      { account: 'work', refresh: true }
    )

    expect(result.account.status).toBe('ready')
    const persistedConfig = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    const persistedAccount = persistedConfig.adapters.codex.accounts.work
    expect(Buffer.from(persistedAccount.auth.token, 'base64').toString('utf8')).toBe(refreshedAuthContent)
    expect(persistedAccount.generation).toBe('generation-stable')
    expect(persistedAccount.credentialRevision).not.toBe('2:stable')
    if (process.platform !== 'win32') {
      const probeAuthPath = resolveProjectHomePath(
        workspace,
        {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        'caches',
        'ctx',
        'adapter-codex-accounts',
        'detail-work',
        '.codex',
        'auth.json'
      )
      expect((await stat(probeAuthPath)).mode & 0o777).toBe(0o600)
    }
  })

  it('does not let an older refresh cross a replacement generation with identical auth', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-refresh-generation-race-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex.mjs')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const oldAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_work","refresh_token":"same"}}\n'
    const refreshedAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_work","refresh_token":"rotated"}}\n'
    const existingConfig = {
      adapters: {
        codex: {
          accounts: {
            work: {
              generation: 'generation-a',
              credentialRevision: '1:revision-a',
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
    await writeFakeCodexLogin({
      path: fakeCodexPath,
      authContent: oldAuthContent,
      refreshedAuthContent,
      mutateConfigOnAccountRead: {
        path: globalConfigPath,
        accountKey: 'work',
        generation: 'generation-b',
        credentialRevision: '1:revision-b'
      }
    })

    const result = await getCodexAccountDetail(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [existingConfig as any]
      }),
      { account: 'work', refresh: true }
    )

    expect(result.account.status).toBe('error')
    expect(result.account.description).toContain('changed while sign-in was in progress')
    const persistedConfig = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    const persistedAccount = persistedConfig.adapters.codex.accounts.work
    expect(Buffer.from(persistedAccount.auth.token, 'base64').toString('utf8')).toBe(oldAuthContent)
    expect(persistedAccount.generation).toBe('generation-b')
    expect(persistedAccount.credentialRevision).toBe('1:revision-b')
  })

  it('does not replace stored credentials when refresh validation fails', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-refresh-failure-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex.mjs')
    const globalConfigPath = join(realHome, '.oneworks', '.oo.config.json')
    const oldAuthContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_work","refresh_token":"old"}}\n'
    const unverifiedAuthContent =
      '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_work","refresh_token":"unverified"}}\n'
    const existingConfig = {
      adapters: {
        codex: {
          accounts: {
            work: {
              credentialRevision: '4:stable',
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
    await writeFakeCodexLogin({
      path: fakeCodexPath,
      authContent: oldAuthContent,
      refreshedAuthContent: unverifiedAuthContent,
      failProbeMethod: 'account/rateLimits/read'
    })

    const result = await getCodexAccountDetail(
      createTestCtx(workspace, {
        env: {
          HOME: resolveTestMockHome(workspace, realHome),
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
        },
        configs: [existingConfig as any]
      }),
      { account: 'work', refresh: true }
    )

    expect(result.account.status).toBe('error')
    expect(result.account.description).toContain('token_expired')
    const persistedConfig = JSON.parse(await readFile(globalConfigPath, 'utf8')) as any
    const persistedAccount = persistedConfig.adapters.codex.accounts.work
    expect(Buffer.from(persistedAccount.auth.token, 'base64').toString('utf8')).toBe(oldAuthContent)
    expect(persistedAccount.credentialRevision).toBe('4:stable')
  })
})
