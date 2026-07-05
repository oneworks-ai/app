import { Buffer } from 'node:buffer'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AdapterCtx } from '@oneworks/types'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { manageCodexAccount } from '#~/runtime/accounts.js'

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
}) => {
  await writeFile(
    params.path,
    `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.argv[2] === 'login') {
  mkdirSync(join(process.env.HOME, '.codex'), { recursive: true })
  writeFileSync(join(process.env.HOME, '.codex', 'auth.json'), ${JSON.stringify(params.authContent)})
  process.exit(0)
}

process.exit(1)
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
})
