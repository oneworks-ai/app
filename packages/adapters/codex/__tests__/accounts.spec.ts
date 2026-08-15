/* eslint-disable max-lines -- codex account coverage keeps migration and credential scenarios together. */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

const tempDirs: string[] = []
const originalHome = process.env.HOME
const originalProjectRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

const countOccurrences = (content: string, search: string) => content.split(search).length - 1
const resolveTestMockHome = (workspace: string, realHome: string) =>
  resolveProjectHomePath(workspace, { HOME: realHome, __ONEWORKS_PROJECT_REAL_HOME__: realHome }, '.mock')

afterEach(async () => {
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

  it('materializes global config Codex auth into the isolated session home', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-global-auth-'))
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const authContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_global"}}\n'
    tempDirs.push(workspace)

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

    const result = await prepareCodexSessionHome({
      ctx,
      sessionId: 'session'
    })
    const sessionAuthPath = join(result.homeDir, '.codex', 'auth.json')

    expect(result.accountKey).toBe('work')
    expect(result.authFilePath).toBe(sessionAuthPath)
    expect(await readFile(sessionAuthPath, 'utf8')).toBe(authContent)
    expect((await lstat(sessionAuthPath)).isSymbolicLink()).toBe(false)
    if (process.platform !== 'win32') {
      expect((await stat(sessionAuthPath)).mode & 0o777).toBe(0o600)
    }
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
    expect(result.authFilePath).toBe(sessionAuthPath)
    expect((await lstat(sessionAuthPath)).isSymbolicLink()).toBe(false)
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
        'auth-source.json'
      )
      expect((await stat(probeAuthPath)).mode & 0o777).toBe(0o600)
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

process.exit(1)
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

process.exit(1)
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

process.exit(1)
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
