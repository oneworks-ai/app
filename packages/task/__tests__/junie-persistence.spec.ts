import { Buffer } from 'node:buffer'
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { JUNIE_AUTH_ENV_KEYS } from '@oneworks/adapter-junie/auth-env'
import type { AdapterOutputEvent } from '@oneworks/types'
import { getCachePath } from '@oneworks/utils/cache'

import { run } from '#~/run.js'

vi.mock('@oneworks/types/adapter-package', async importOriginal => {
  const actual = await importOriginal<typeof import('@oneworks/types/adapter-package')>()
  return {
    ...actual,
    loadAdapter: async (type: string) => {
      if (type.includes('junie')) return (await import('../../adapters/junie/src/index.js')).default
      return {
        query: async (_ctx: unknown, options: { onEvent: (event: AdapterOutputEvent) => void }) => {
          queueMicrotask(() => options.onEvent({ type: 'exit', data: { exitCode: 0 } }))
          return { emit: () => undefined, kill: () => undefined }
        }
      }
    }
  }
})

const fakeSourceUrl = new URL('../../adapters/junie/__fixtures__/fake-junie.mjs', import.meta.url)
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))

const waitFor = async (predicate: () => boolean, timeoutMs = 15_000) => {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for Junie run-level lifecycle')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const readTextTree = async (root: string): Promise<string> => {
  const entries = await readdir(root, { withFileTypes: true })
  const chunks: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) chunks.push(await readTextTree(path))
    else if (entry.isFile()) chunks.push(await readFile(path, 'utf8'))
  }
  return chunks.join('\n')
}

describe('junie run-level persistence boundary', () => {
  let workspace: string | undefined

  afterEach(async () => {
    vi.unstubAllEnvs()
    if (workspace != null) await rm(workspace, { recursive: true, force: true })
    workspace = undefined
  })

  it(
    'keeps credentials runtime-only across create/resume base, hook, log, child, and native config artifacts',
    async () => {
      workspace = await mkdtemp(join(tmpdir(), 'ow-junie-v5-run-'))
      const fakePath = join(workspace, 'bin', 'junie')
      await mkdir(dirname(fakePath), { recursive: true })
      await copyFile(fakeSourceUrl, fakePath)
      await chmod(fakePath, 0o755)

      const secret = 'credential-v5-run-level'
      const authSecrets = Object.fromEntries(
        JUNIE_AUTH_ENV_KEYS.map(key => [key, `credential-v6-run-${key.toLowerCase()}`])
      )
      const processAuthKeys = new Set(JUNIE_AUTH_ENV_KEYS.filter((_, index) => index % 2 === 0))
      for (const key of processAuthKeys) vi.stubEnv(key, authSecrets[key])
      const primaryAuthSecret = authSecrets.JUNIE_API_KEY!
      const secondaryAuthSecret = authSecrets.OPENAI_API_KEY!
      const backupSecret = 'credential-v7-backup-alias'
      const mixedAuthUrl = `https://user:${encodeURIComponent(primaryAuthSecret)}@example.invalid/route/${
        encodeURIComponent(primaryAuthSecret)
      }?OPENAI_API_KEY=${encodeURIComponent(secondaryAuthSecret)}&keep=visible#${
        encodeURIComponent(secondaryAuthSecret)
      }`
      const safePath = process.env.PATH ?? '/usr/bin'
      const encoded = Buffer.from(JSON.stringify({ apiKey: secret, region: 'ap' })).toString('base64')
      const encodedAuth = Buffer.from(JSON.stringify({ echo: primaryAuthSecret, region: 'auth-ap' }))
        .toString('base64')
      await writeFile(
        join(workspace, '.oo.config.json'),
        JSON.stringify(
          {
            defaultAdapter: 'primaryJunie',
            plugins: [{ id: 'logger' }],
            adapters: {
              primaryJunie: {
                packageId: '@oneworks/adapter-junie',
                provider: 'anthropic',
                configContent: {
                  apiKey: 'x',
                  password: '',
                  emptyLabel: '',
                  shortCode: 'x',
                  region: 'us-east-1',
                  byok: {
                    provider: 'anthropic',
                    anthropic: { apiKey: secret, baseUrl: 'https://api.example.invalid/v1' }
                  },
                  json: JSON.stringify({ authorization: `Bearer ${secret}`, model: 'safe-model' }),
                  uri: `https://user:${secret}@example.invalid/v1?token=${secret}&region=eu`,
                  form: `api_key=${secret}&region=ap`,
                  encoded,
                  authEcho: primaryAuthSecret,
                  authJsonEcho: JSON.stringify({ echo: primaryAuthSecret, region: 'auth-us' }),
                  authUriEcho: `https://example.invalid?value=${encodeURIComponent(primaryAuthSecret)}&region=auth-eu`,
                  mixedAuthUrl,
                  encodedAuth
                }
              },
              backupJunie: {
                packageId: '@oneworks/adapter-junie',
                configContent: {
                  apiKey: backupSecret,
                  region: 'backup-region'
                }
              }
            }
          },
          null,
          2
        )
      )

      const ctxId = 'ctx-junie-v5-run'
      const sessionId = 'session-junie-v5-run'
      const env = {
        __ONEWORKS_PROJECT_PACKAGE_DIR__: repositoryRoot,
        __ONEWORKS_PROJECT_ADAPTER_JUNIE_CLI_PATH__: fakePath,
        __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: join(workspace, '.oo'),
        __ONEWORKS_PROJECT_REAL_HOME__: join(workspace, 'real-home'),
        ONEWORKS_HOOK_PERSISTENT_WORKER: '0',
        PATH: safePath,
        LANG: 'C.UTF-8',
        HTTPS_PROXY: 'https://proxy.example.invalid',
        JUNIE_LITELLM_URL: 'https://litellm.example.invalid/v1',
        ...Object.fromEntries(
          JUNIE_AUTH_ENV_KEYS.filter(key => !processAuthKeys.has(key)).map(key => [key, authSecrets[key]])
        ),
        AUTH_JSON_ECHO: JSON.stringify({ JUNIE_API_KEY: primaryAuthSecret, region: 'env-us' }),
        AUTH_FORM_ECHO: `OPENAI_API_KEY=${authSecrets.OPENAI_API_KEY}&region=env-eu`,
        AUTH_BASE64_ECHO: Buffer.from(primaryAuthSecret).toString('base64'),
        AUTH_MIXED_URL: mixedAuthUrl,
        AUTH_MIXED_JSON: JSON.stringify({ mixedAuthUrl, keep: 'env-json' }),
        AUTH_MIXED_BASE64: Buffer.from(JSON.stringify({ mixedAuthUrl, keep: 'env-base64' })).toString('base64')
      }
      const lifecycleRuns = []
      for (const type of ['create', 'resume'] as const) {
        const events: AdapterOutputEvent[] = []
        const result = await run({ adapter: 'primaryJunie', ctxId, cwd: workspace, env }, {
          type,
          runtime: 'server',
          sessionId,
          description: `scenario:success`,
          onEvent: event => events.push(event)
        })
        await waitFor(() => events.some(event => event.type === 'exit'))
        await result.session.flushHooks?.()
        expect(events.at(-1)).toEqual({ type: 'exit', data: { exitCode: 0 } })
        expect(JSON.stringify(result.ctx.configState)).toContain(secret)
        expect(JSON.stringify(result.ctx.configState)).toContain(mixedAuthUrl)
        for (const [key, value] of Object.entries(authSecrets)) {
          expect(result.ctx.env).toHaveProperty(key, value)
        }
        lifecycleRuns.push(result)
      }

      const basePath = getCachePath(workspace, ctxId, sessionId, 'base', env)
      const baseText = await readFile(basePath, 'utf8')
      const base = JSON.parse(baseText) as {
        env: Record<string, unknown>
        configState: {
          projectSource: {
            rawConfig: {
              adapters: {
                primaryJunie: { configContent: Record<string, unknown> }
                backupJunie: { configContent: Record<string, unknown> }
              }
            }
          }
        }
      }
      expect(baseText).not.toContain(secret)
      expect(baseText).not.toContain(backupSecret)
      for (const [key, value] of Object.entries(authSecrets)) {
        expect(baseText).not.toContain(key)
        expect(baseText).not.toContain(value)
      }
      expect(baseText).not.toContain(Buffer.from(primaryAuthSecret).toString('base64'))
      expect(base).toMatchObject({
        env: {
          PATH: safePath,
          LANG: 'C.UTF-8',
          HTTPS_PROXY: 'https://proxy.example.invalid',
          JUNIE_LITELLM_URL: 'https://litellm.example.invalid/v1'
        }
      })
      expect(base.configState.projectSource.rawConfig.adapters.primaryJunie.configContent).toMatchObject({
        emptyLabel: '',
        shortCode: 'x',
        region: 'us-east-1',
        byok: {
          provider: 'anthropic',
          anthropic: { baseUrl: 'https://api.example.invalid/v1' }
        }
      })
      expect(base.configState.projectSource.rawConfig.adapters.primaryJunie.configContent.mixedAuthUrl).toEqual(
        expect.stringMatching(/\/route\/\[REDACTED\].*keep=visible.*#\[REDACTED\]/u)
      )
      expect(base.configState.projectSource.rawConfig.adapters.primaryJunie.configContent).not.toHaveProperty('apiKey')
      expect(base.configState.projectSource.rawConfig.adapters.backupJunie.configContent).toEqual({
        region: 'backup-region'
      })

      const calls = (await readFile(join(workspace, '.fake-junie-calls.jsonl'), 'utf8'))
        .trim().split('\n').map(line =>
          JSON.parse(line) as {
            args: string[]
            authPresence: Record<string, boolean>
            env: Record<string, unknown>
          }
        )
      expect(calls).toHaveLength(2)
      expect(calls[0]?.args).toEqual(expect.arrayContaining(['--task', 'scenario:success']))
      expect(calls[1]?.args).toEqual(expect.arrayContaining(['--session-id=session-fake-native', '--resume']))
      expect(JSON.stringify(calls)).not.toContain(secret)
      for (const value of Object.values(authSecrets)) expect(JSON.stringify(calls)).not.toContain(value)
      for (const call of calls) {
        expect(call.authPresence).toMatchObject({
          JUNIE_API_KEY: true,
          JUNIE_ANTHROPIC_API_KEY: true,
          ANTHROPIC_API_KEY: true
        })
        for (const key of JUNIE_AUTH_ENV_KEYS) {
          if (['JUNIE_API_KEY', 'JUNIE_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'].includes(key)) continue
          expect(call.authPresence[key]).toBe(false)
        }
      }
      const configFlagIndex = calls[1]!.args.indexOf('--config-location')
      const stagedConfigPath = calls[1]!.args[configFlagIndex + 1]!
      const stagedConfig = await readFile(stagedConfigPath, 'utf8')
      expect(stagedConfig).not.toContain(secret)
      expect(stagedConfig).not.toContain(primaryAuthSecret)
      expect(stagedConfig).not.toContain(secondaryAuthSecret)
      expect(JSON.parse(stagedConfig)).toMatchObject({
        emptyLabel: '',
        shortCode: 'x',
        region: 'us-east-1',
        byok: {
          provider: 'anthropic',
          anthropic: { baseUrl: 'https://api.example.invalid/v1' }
        }
      })

      const durableArtifacts = await readTextTree(join(workspace, '.oo'))
      expect(durableArtifacts).not.toContain(secret)
      expect(durableArtifacts).not.toContain(backupSecret)
      for (const value of Object.values(authSecrets)) expect(durableArtifacts).not.toContain(value)
      expect(durableArtifacts).toContain('TaskStart')
      expect(durableArtifacts).toContain('TaskStop')
      expect(lifecycleRuns).toHaveLength(2)
    },
    45_000
  )

  it.each(['create', 'resume'] as const)(
    'scrubs cross-adapter Junie config views during an actual non-Junie %s run',
    async type => {
      workspace = await mkdtemp(join(tmpdir(), `ow-junie-v7-cross-${type}-`))
      const classifiedSecrets = {
        direct: `credential-v7-direct-junie-${type}`,
        inherited: `credential-v7-inherited-junie-${type}`,
        literal: `credential-v7-literal-junie-${type}`,
        path: `credential-v7-path-junie-${type}`,
        supersededUser: `credential-v7-superseded-user-${type}`,
        user: `credential-v7-user-junie-${type}`
      }
      const unrelatedSecrets = {
        conflicting: `credential-v7-conflicting-codex-${type}`,
        missing: `credential-v7-missing-package-${type}`,
        supersededConflict: `credential-v7-superseded-conflict-${type}`,
        supersededTombstone: `credential-v7-superseded-tombstone-${type}`,
        supersededUserConflict: `credential-v7-superseded-user-conflict-${type}`,
        tombstoned: `credential-v7-tombstoned-package-${type}`,
        userConflict: `credential-v7-user-conflicting-${type}`
      }
      const codexValue = `credential-v6-selected-codex-${type}`
      const localJuniePackage = join(workspace, 'local-junie-adapter')
      await mkdir(localJuniePackage, { recursive: true })
      await writeFile(
        join(localJuniePackage, 'package.json'),
        JSON.stringify({
          name: '@oneworks/adapter-junie',
          version: '1.0.0'
        })
      )
      await writeFile(
        join(workspace, 'base-adapters.json'),
        JSON.stringify({
          adapters: {
            inheritedJunie: {
              packageId: '@oneworks/adapter-junie',
              configContent: { apiKey: classifiedSecrets.inherited, region: 'inherited-region' }
            },
            conflicting: {
              packageId: '@oneworks/adapter-junie',
              configContent: { apiKey: unrelatedSecrets.supersededConflict }
            },
            tombstoned: {
              packageId: '@oneworks/adapter-junie',
              configContent: { apiKey: unrelatedSecrets.supersededTombstone }
            },
            userJunie: {
              packageId: '@oneworks/adapter-junie',
              configContent: { apiKey: classifiedSecrets.supersededUser }
            },
            userConflict: {
              packageId: '@oneworks/adapter-junie',
              configContent: { apiKey: unrelatedSecrets.supersededUserConflict }
            }
          }
        })
      )
      await writeFile(
        join(workspace, '.oo.config.json'),
        JSON.stringify(
          {
            extend: './base-adapters.json',
            defaultAdapter: 'codex',
            plugins: [{ id: 'logger' }],
            adapters: {
              codex: {
                configContent: { apiKey: codexValue, region: 'codex-region' }
              },
              junie: {
                configContent: {
                  apiKey: classifiedSecrets.literal,
                  byok: { openai: classifiedSecrets.literal },
                  json: JSON.stringify({ token: classifiedSecrets.literal, region: 'junie-json-region' }),
                  region: 'junie-region'
                }
              },
              directJunie: {
                packageId: '@oneworks/adapter-junie',
                configContent: { apiKey: classifiedSecrets.direct, region: 'direct-region' }
              },
              pathJunie: {
                packageId: './local-junie-adapter',
                configContent: { apiKey: classifiedSecrets.path, region: 'path-region' }
              },
              conflicting: {
                packageId: '@oneworks/adapter-codex',
                configContent: { apiKey: unrelatedSecrets.conflicting, region: 'conflicting-region' }
              },
              tombstoned: {
                packageId: null,
                configContent: { apiKey: unrelatedSecrets.tombstoned, region: 'tombstoned-region' }
              },
              missing: {
                configContent: { apiKey: unrelatedSecrets.missing, region: 'missing-region' }
              }
            }
          },
          null,
          2
        )
      )
      await writeFile(
        join(workspace, '.oo.dev.config.json'),
        JSON.stringify({
          adapters: {
            userJunie: {
              configContent: { apiKey: classifiedSecrets.user, region: 'user-region' }
            },
            userConflict: {
              packageId: '@oneworks/adapter-codex',
              configContent: { apiKey: unrelatedSecrets.userConflict, region: 'user-conflicting-region' }
            }
          }
        })
      )

      const ctxId = `ctx-junie-v6-cross-${type}`
      const sessionId = `session-junie-v6-cross-${type}`
      const env = {
        __ONEWORKS_PROJECT_PACKAGE_DIR__: repositoryRoot,
        __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: join(workspace, '.oo'),
        __ONEWORKS_PROJECT_REAL_HOME__: join(workspace, 'real-home'),
        ONEWORKS_HOOK_PERSISTENT_WORKER: '0'
      }
      const events: AdapterOutputEvent[] = []
      const result = await run({ adapter: 'codex', ctxId, cwd: workspace, env }, {
        type,
        runtime: 'server',
        sessionId,
        description: 'cross-adapter persistence',
        onEvent: event => events.push(event)
      })
      await waitFor(() => events.some(event => event.type === 'exit'))
      await result.session.flushHooks?.()

      for (const secret of Object.values(classifiedSecrets)) {
        expect(JSON.stringify(result.ctx.configState)).toContain(secret)
      }
      expect(JSON.stringify(result.ctx.configState)).toContain(codexValue)
      const basePath = getCachePath(workspace, ctxId, sessionId, 'base', env)
      const baseText = await readFile(basePath, 'utf8')
      const base = JSON.parse(baseText) as {
        assets?: { configs?: Array<{ adapters?: Record<string, { configContent?: unknown }> }> }
        configs: Array<{ adapters?: Record<string, { configContent?: unknown }> }>
        configState: {
          mergedConfig: { adapters?: Record<string, { configContent?: unknown }> }
          projectSource?: {
            rawConfig?: { adapters?: Record<string, { configContent?: unknown }> }
            resolvedConfig?: { adapters?: Record<string, { configContent?: unknown }> }
            resolvedExtendSources?: Array<{
              rawConfig?: { adapters?: Record<string, { configContent?: unknown }> }
            }>
          }
        }
      }
      for (const secret of Object.values(classifiedSecrets)) expect(baseText).not.toContain(secret)
      for (const secret of Object.values(unrelatedSecrets)) expect(baseText).not.toContain(secret)
      expect(baseText).not.toContain(codexValue)
      expect(base.configs[0]?.adapters?.junie?.configContent).toMatchObject({
        byok: {},
        json: JSON.stringify({ region: 'junie-json-region' }),
        region: 'junie-region'
      })
      expect(base.configs[0]?.adapters?.codex?.configContent).toEqual({
        region: 'codex-region'
      })
      expect(base.assets?.configs?.[0]?.adapters?.junie?.configContent).toMatchObject({
        region: 'junie-region'
      })
      expect(base.configState.mergedConfig.adapters?.junie?.configContent).toMatchObject({ region: 'junie-region' })
      expect(base.configState.projectSource?.rawConfig?.adapters?.junie?.configContent).toMatchObject({
        region: 'junie-region'
      })
      expect(base.configState.projectSource?.resolvedConfig?.adapters?.junie?.configContent).toMatchObject({
        region: 'junie-region'
      })
      for (const adapterKey of ['directJunie', 'inheritedJunie', 'pathJunie', 'userJunie']) {
        expect(base.configState.mergedConfig.adapters?.[adapterKey]?.configContent).toMatchObject({
          region: expect.stringContaining('region')
        })
      }
      expect(
        base.configState.projectSource?.resolvedExtendSources?.[0]?.rawConfig?.adapters
          ?.inheritedJunie?.configContent
      ).toEqual({ region: 'inherited-region' })

      const durableArtifacts = await readTextTree(join(workspace, '.oo'))
      for (const secret of Object.values(classifiedSecrets)) expect(durableArtifacts).not.toContain(secret)
      for (const secret of Object.values(unrelatedSecrets)) expect(durableArtifacts).not.toContain(secret)
      expect(durableArtifacts).not.toContain(codexValue)
      expect(durableArtifacts).toContain('TaskStart')
      expect(durableArtifacts).toContain('TaskStop')
      expect(events.at(-1)).toEqual({ type: 'exit', data: { exitCode: 0 } })
    },
    30_000
  )
})
