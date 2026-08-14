import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { AdapterCtx, AdapterQueryOptions, ModelServiceConfig } from '@oneworks/types'

import '../src/adapter-config'
import { prepareGooseSession } from '../src/runtime/prepare'

const LEGACY_CLI_LOADER_ENV = ['__IS_', 'LOADER_CLI__'].join('')
const LEGACY_HOOK_LOADER_ENV = ['__IS_', 'ONEWORKS_HOOK_LOADER__'].join('')
const tempDirs: string[] = []

const createContext = async (params: {
  adapterConfig?: Record<string, unknown>
  env?: Record<string, string>
  modelServices?: Record<string, ModelServiceConfig>
} = {}) => {
  const root = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-prepare-'))
  tempDirs.push(root)
  const realConfig = resolve(root, 'real-goose-config')
  await mkdir(realConfig)
  await writeFile(
    resolve(realConfig, 'config.yaml'),
    [
      'GOOSE_PROVIDER: anthropic',
      'GOOSE_MODEL: claude-sonnet-4-6',
      ''
    ].join('\n'),
    'utf8'
  )
  await writeFile(resolve(realConfig, 'secrets.yaml'), 'ANTHROPIC_API_KEY: native-secret\n', 'utf8')
  const ctx = {
    ctxId: 'ctx-goose-prepare',
    cwd: root,
    env: {
      __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__: '/usr/bin/goose-fixture',
      __ONEWORKS_PROJECT_ADAPTER_GOOSE_CONFIG_DIR__: realConfig,
      __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: resolve(root, '.project-home'),
      ANTHROPIC_API_KEY: 'selected-provider-key',
      OPENAI_API_KEY: 'unrelated-provider-key',
      PROJECT_AUTH_TOKEN: 'unrelated-token',
      PROJECT_FLAG: 'preserved',
      ...params.env
    },
    cache: {
      get: async () => undefined,
      set: async () => ({ cachePath: '' })
    },
    configs: [{
      adapters: { goose: params.adapterConfig ?? {} },
      modelServices: params.modelServices ?? {}
    }],
    logger: {
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      stream: process.stderr
    }
  } as unknown as AdapterCtx
  return { ctx, realConfig, root }
}

const createOptions = (params: {
  assetPlan?: AdapterQueryOptions['assetPlan']
  model?: string
} = {}): AdapterQueryOptions => ({
  type: 'create',
  runtime: 'server',
  sessionId: '11111111-1111-4111-8111-111111111111',
  model: params.model,
  permissionMode: 'default',
  assetPlan: params.assetPlan,
  onEvent: () => undefined
})

describe('goose isolated runtime preparation', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
  })

  it('isolates Goose and XDG roots, stages skills, maps MCP, and symlinks only selected native auth', async () => {
    const { ctx, realConfig, root } = await createContext()
    const skillSource = resolve(root, 'skill-source')
    await mkdir(skillSource)
    await writeFile(resolve(skillSource, 'SKILL.md'), '# Fixture skill\n', 'utf8')
    const prepared = await prepareGooseSession(
      ctx,
      createOptions({
        assetPlan: {
          adapter: 'goose',
          diagnostics: [],
          mcpServers: {
            files: {
              command: '/usr/bin/env',
              args: ['node', 'server.js'],
              env: {
                MCP_TOKEN: 'scoped',
                NODE_OPTIONS: '--require /private/host-loader.cjs',
                NODE_PATH: '/private/host-node-modules',
                [LEGACY_CLI_LOADER_ENV]: 'true',
                [LEGACY_HOOK_LOADER_ENV]: 'true',
                __ONEWORKS_CLI_HELPER_LOADER_ACTIVE__: 'true',
                __ONEWORKS_HOOK_LOADER_ACTIVE__: 'true',
                __ONEWORKS_PROJECT_REGISTER_LOADER__: 'file:///private/project-loader.mjs'
              }
            },
            remote: { type: 'http', url: 'https://mcp.example.test', headers: { Authorization: 'Bearer scoped' } }
          },
          overlays: [{
            assetId: 'skill:fixture',
            kind: 'skill',
            sourcePath: skillSource,
            targetPath: 'skills/fixture'
          }]
        } as never
      })
    )

    const gooseRoot = prepared.spawnEnv.GOOSE_PATH_ROOT!
    expect(gooseRoot).toContain(resolve(root, '.project-home'))
    expect(prepared.spawnEnv).toMatchObject({
      ANTHROPIC_API_KEY: 'selected-provider-key',
      GOOSE_MODEL: 'claude-sonnet-4-6',
      GOOSE_PROVIDER: 'anthropic',
      PROJECT_FLAG: 'preserved',
      XDG_CACHE_HOME: resolve(gooseRoot, 'xdg', 'cache'),
      XDG_CONFIG_HOME: resolve(gooseRoot, 'xdg', 'config'),
      XDG_DATA_HOME: resolve(gooseRoot, 'xdg', 'data'),
      XDG_STATE_HOME: resolve(gooseRoot, 'xdg', 'state')
    })
    expect(prepared.spawnEnv).not.toHaveProperty('OPENAI_API_KEY')
    expect(prepared.spawnEnv).not.toHaveProperty('PROJECT_AUTH_TOKEN')

    const secretsPath = resolve(gooseRoot, 'config', 'secrets.yaml')
    expect((await lstat(secretsPath)).isSymbolicLink()).toBe(true)
    expect(await readlink(secretsPath)).toBe(resolve(realConfig, 'secrets.yaml'))
    const skillPath = resolve(gooseRoot, '.agents', 'skills', 'fixture')
    expect((await lstat(skillPath)).isSymbolicLink()).toBe(true)
    expect(prepared.mcpServers).toEqual([
      {
        name: 'files',
        command: '/usr/bin/env',
        args: ['node', 'server.js'],
        env: [{ name: 'MCP_TOKEN', value: 'scoped' }]
      },
      {
        type: 'http',
        name: 'remote',
        url: 'https://mcp.example.test',
        headers: [{ name: 'Authorization', value: 'Bearer scoped' }]
      }
    ])
  })

  it('does not bridge native secrets when explicitly disabled', async () => {
    const { ctx } = await createContext({ adapterConfig: { inheritNativeAuth: false } })
    const prepared = await prepareGooseSession(ctx, createOptions())
    const secretsPath = resolve(prepared.spawnEnv.GOOSE_PATH_ROOT!, 'config', 'secrets.yaml')
    await expect(lstat(secretsPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('routes a supported model service without writing its API key to provider config', async () => {
    const { ctx } = await createContext({
      modelServices: {
        service: {
          apiBaseUrl: 'https://api.example.test/v1/chat/completions',
          apiKey: 'routed-secret',
          apiProtocol: 'openai-chat-completions'
        }
      }
    })
    const prepared = await prepareGooseSession(ctx, createOptions({ model: 'service,test-model' }))
    const providerPath = resolve(
      prepared.spawnEnv.GOOSE_PATH_ROOT!,
      'config',
      'custom_providers',
      'oneworks.json'
    )
    const providerConfig = JSON.parse(await readFile(providerPath, 'utf8')) as Record<string, unknown>

    expect(prepared.spawnEnv.ONEWORKS_GOOSE_MODEL_API_KEY).toBe('routed-secret')
    expect(prepared.spawnEnv).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(JSON.stringify(providerConfig)).not.toContain('routed-secret')
    expect(providerConfig).toMatchObject({
      engine: 'openai',
      api_key_env: 'ONEWORKS_GOOSE_MODEL_API_KEY',
      base_url: 'https://api.example.test/v1'
    })
  })

  it('fails explicitly for unsupported SSE MCP and model-service protocols', async () => {
    const { ctx } = await createContext({
      modelServices: {
        gemini: {
          apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'gemini-secret',
          apiProtocol: 'gemini-generate-content'
        }
      }
    })
    await expect(prepareGooseSession(
      ctx,
      createOptions({
        assetPlan: {
          adapter: 'goose',
          diagnostics: [],
          mcpServers: { events: { type: 'sse', url: 'https://mcp.example.test/events' } },
          overlays: []
        } as never
      })
    )).rejects.toThrow('does not support the selected SSE MCP server')
    await expect(prepareGooseSession(ctx, createOptions({ model: 'gemini,test-model' })))
      .rejects.toThrow('does not support gemini-generate-content model services')
  })
})
