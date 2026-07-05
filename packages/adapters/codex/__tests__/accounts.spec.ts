/* eslint-disable max-lines -- codex account coverage keeps migration and credential scenarios together. */
import { Buffer } from 'node:buffer'
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { bridgeRealHomeToMockHome } from '@oneworks/register/mock-home-bridge'
import type { AdapterCtx } from '@oneworks/types'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { getCodexAccounts, manageCodexAccount, prepareCodexSessionHome } from '#~/runtime/accounts.js'

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
  overrides: Partial<Pick<AdapterCtx, 'env' | 'configs' | 'logger'>> = {}
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
  it('stores Codex login auth in the global OneWorks config', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-login-global-'))
    const realHome = join(workspace, 'real-home')
    const fakeCodexPath = join(workspace, 'fake-codex.mjs')
    const authContent = '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_login"}}\n'
    tempDirs.push(workspace)

    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.argv[2] === 'login') {
  mkdirSync(join(process.env.HOME, '.codex'), { recursive: true })
  writeFileSync(join(process.env.HOME, '.codex', 'auth.json'), ${JSON.stringify(authContent)})
  process.exit(0)
}

process.exit(1)
`
    )
    await chmod(fakeCodexPath, 0o755)
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(
      join(realHome, '.oneworks', '.oo.config.json'),
      '{"adapters":{"codex":{"accounts":{"work":{"title":"Old Work","authFile":"/tmp/old-codex-auth.json"}}}}}'
    )

    const ctx = createTestCtx(workspace, {
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
      }
    })

    const result = await manageCodexAccount(ctx, {
      action: 'add',
      account: 'work'
    })

    const globalConfig = JSON.parse(
      await readFile(join(realHome, '.oneworks', '.oo.config.json'), 'utf8')
    ) as any
    const storedAccount = globalConfig.adapters.codex.accounts.work

    expect(result.accountKey).toBe('work')
    expect(result.artifacts).toBeUndefined()
    expect(storedAccount.source).toBe('codex-login')
    expect(storedAccount.auth).toMatchObject({
      type: 'codex-auth-json',
      encoding: 'base64'
    })
    expect(storedAccount.authFile).toBeUndefined()
    expect(Buffer.from(storedAccount.auth.token, 'base64').toString('utf8')).toBe(authContent)
  })
})
