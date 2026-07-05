import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AdapterCtx } from '@oneworks/types'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { getCodexAccounts } from '#~/runtime/accounts.js'

const tempDirs: string[] = []

const resolveTestMockHome = (workspace: string, realHome: string) =>
  resolveProjectHomePath(workspace, { HOME: realHome, __ONEWORKS_PROJECT_REAL_HOME__: realHome }, '.mock')

const buildTestJwt = (payload: Record<string, unknown>) => (
  `e30.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.sig`
)

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

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('codex account titles', () => {
  it('does not surface generic Codex titles from global config accounts', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-generic-title-'))
    const realHome = join(workspace, 'real-home')
    const authContent = `${
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          account_id: 'acct_owner',
          id_token: buildTestJwt({
            email: 'owner@example.test',
            'https://api.openai.com/auth': {
              chatgpt_account_id: 'acct_owner',
              chatgpt_plan_type: 'plus'
            }
          })
        }
      })
    }\n`
    tempDirs.push(workspace)
    await mkdir(realHome, { recursive: true })

    const ctx = createTestCtx(workspace, {
      env: {
        HOME: resolveTestMockHome(workspace, realHome),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      configs: [{
        adapters: {
          codex: {
            defaultAccount: 'default',
            accounts: {
              default: {
                title: 'Codex',
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

    await expect(getCodexAccounts(ctx, {})).resolves.toMatchObject({
      defaultAccount: 'default',
      accounts: [
        {
          key: 'default',
          title: 'owner@example.test · Plus',
          status: 'ready',
          isDefault: true
        }
      ]
    })
  })
})
