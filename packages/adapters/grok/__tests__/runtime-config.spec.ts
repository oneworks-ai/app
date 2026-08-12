import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as TOML from '@iarna/toml'
import { afterEach, describe, expect, it } from 'vitest'

import type { AdapterCtx, AdapterQueryOptions, ModelServiceApiProtocol, ModelServiceConfig } from '@oneworks/types'
import { createCodexSharedModelService } from '@oneworks/utils'

import { grokAdapterConfigSchema } from '../src/config-schema'
import { buildGrokCommonArgs, prepareGrokSession, resolveGrokSessionHome } from '../src/runtime/config'

const tempDirs: string[] = []

const createTempDir = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oneworks-grok-test-'))
  tempDirs.push(directory)
  return directory
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(tempDirs.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

const createCtx = (params: {
  modelServices?: Record<string, ModelServiceConfig>
  projectHome: string
  realGrokHome: string
  skillSource: string
}): AdapterCtx => ({
  ctxId: 'ctx-1',
  cwd: params.projectHome,
  env: {
    GROK_HOME: params.realGrokHome,
    __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: join(params.projectHome, '.project-home'),
    __ONEWORKS_PROJECT_ADAPTER_GROK_CLI_PATH__: '/usr/bin/grok',
    __ONEWORKS_PROJECT_GROK_NATIVE_HOOKS_AVAILABLE__: '0'
  },
  cache: {
    get: async () => undefined,
    set: async () => ({ cachePath: '' })
  },
  logger: {
    debug: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    stream: process.stderr
  },
  configs: [{
    adapters: {
      grok: {
        configContent: {
          ui: { screen_mode: 'minimal' }
        }
      }
    },
    modelServices: params.modelServices ?? {
      local: {
        apiBaseUrl: 'http://127.0.0.1:43177/v1/chat/completions',
        apiKey: 'local-secret',
        extra: {
          grok: { apiBackend: 'chat_completions' }
        }
      }
    }
  }],
  assets: {
    cwd: params.projectHome,
    pluginInstances: [],
    skills: [],
    channelLinks: [],
    mcpServers: {},
    hookPlugins: [],
    opencodeOverlayAssets: [],
    assets: [],
    rules: [],
    specs: [],
    entities: [],
    workspaces: [],
    defaultIncludeMcpServers: [],
    defaultExcludeMcpServers: []
  }
})

const createOptions = (skillSource: string): AdapterQueryOptions => ({
  type: 'create',
  runtime: 'cli',
  sessionId: '11111111-1111-4111-8111-111111111111',
  model: 'local,grok-test',
  effort: 'max',
  permissionMode: 'dontAsk',
  tools: { include: ['Read', 'Bash'], exclude: ['WebSearch'] },
  assetPlan: {
    adapter: 'grok',
    diagnostics: [],
    mcpServers: {
      files: {
        command: 'node',
        args: ['server.js'],
        env: { TOKEN: 'test' }
      }
    },
    overlays: [{
      assetId: 'skill:test',
      kind: 'skill',
      sourcePath: skillSource,
      targetPath: 'skills/test-skill'
    }]
  },
  onEvent: () => undefined
})

const prepareRoutedConfig = async (params: {
  model: string
  modelServices: Record<string, ModelServiceConfig>
}) => {
  const root = await createTempDir()
  const projectHome = join(root, 'project')
  const realGrokHome = join(root, 'real-grok')
  const skillSource = join(root, 'skill')
  await Promise.all([
    mkdir(projectHome, { recursive: true }),
    mkdir(realGrokHome, { recursive: true }),
    mkdir(skillSource, { recursive: true })
  ])
  const ctx = createCtx({
    modelServices: params.modelServices,
    projectHome,
    realGrokHome,
    skillSource
  })
  const prepared = await prepareGrokSession(ctx, {
    ...createOptions(skillSource),
    model: params.model
  })
  return {
    config: TOML.parse(await readFile(join(prepared.grokHome, 'config.toml'), 'utf8')) as Record<string, any>,
    prepared
  }
}

describe('grok runtime config', () => {
  it('isolates config while projecting auth, routed models, MCP, and skills', async () => {
    const root = await createTempDir()
    const projectHome = join(root, 'project')
    const realGrokHome = join(root, 'real-grok')
    const skillSource = join(root, 'skill')
    await Promise.all([
      mkdir(projectHome, { recursive: true }),
      mkdir(realGrokHome, { recursive: true }),
      mkdir(skillSource, { recursive: true })
    ])
    await writeFile(join(realGrokHome, 'auth.json'), '{"token":"real"}\n')
    await writeFile(join(realGrokHome, 'config.toml'), '[cli]\nauto_update = true\n')
    await writeFile(join(skillSource, 'SKILL.md'), '# Test\n')

    const ctx = createCtx({ projectHome, realGrokHome, skillSource })
    const options = createOptions(skillSource)
    const prepared = await prepareGrokSession(ctx, options)
    const config = TOML.parse(await readFile(join(prepared.grokHome, 'config.toml'), 'utf8')) as Record<string, any>

    expect(prepared.grokHome).toBe(resolveGrokSessionHome({ ctx, sessionId: options.sessionId }))
    expect(prepared.cliModel).toBe('oneworks-session')
    expect(prepared.spawnEnv.ONEWORKS_GROK_MODEL_API_KEY).toBe('local-secret')
    expect(config.cli.auto_update).toBe(false)
    expect(config.ui.screen_mode).toBe('minimal')
    expect(config.model['oneworks-session']).toEqual(expect.objectContaining({
      model: 'grok-test',
      base_url: 'http://127.0.0.1:43177/v1',
      env_key: 'ONEWORKS_GROK_MODEL_API_KEY',
      api_backend: 'chat_completions'
    }))
    expect(config.mcp_servers.files).toEqual(expect.objectContaining({
      command: 'node',
      args: ['server.js'],
      enabled: true
    }))
    expect(await readFile(join(prepared.grokHome, 'auth.json'), 'utf8')).toContain('real')
    expect(await readFile(join(prepared.grokHome, 'skills', 'test-skill', 'SKILL.md'), 'utf8')).toContain('Test')
  })

  it('resolves collection profiles for routed models', async () => {
    const { config, prepared } = await prepareRoutedConfig({
      model: 'gateway/team,gpt-5',
      modelServices: {
        gateway: {
          kind: 'collection',
          provider: 'openai',
          profiles: {
            team: {
              apiBaseUrl: 'https://responses.example.test/v1/responses',
              apiKey: 'profile-key',
              apiProtocol: 'openai-responses'
            }
          }
        }
      }
    })

    expect(prepared.spawnEnv.ONEWORKS_GROK_MODEL_API_KEY).toBe('profile-key')
    expect(config.model['oneworks-session']).toEqual(expect.objectContaining({
      model: 'gpt-5',
      base_url: 'https://responses.example.test/v1',
      api_backend: 'responses'
    }))
  })

  it.each(
    [
      ['openai-chat-completions', 'chat_completions', 'https://api.example.test/v1/chat/completions'],
      ['openai-responses', 'responses', 'https://api.example.test/v1/responses'],
      ['anthropic-messages', 'messages', 'https://api.example.test/v1/messages']
    ] as const
  )('maps the %s protocol to the Grok %s backend', async (apiProtocol, apiBackend, apiBaseUrl) => {
    const { config } = await prepareRoutedConfig({
      model: 'service,test-model',
      modelServices: {
        service: {
          apiBaseUrl,
          apiKey: 'test-key',
          apiProtocol
        }
      }
    })

    expect(config.model['oneworks-session']).toEqual(expect.objectContaining({
      api_backend: apiBackend,
      base_url: 'https://api.example.test/v1'
    }))
  })

  it.each(
    [
      'gemini-generate-content',
      'gemini-interactions'
    ] satisfies ModelServiceApiProtocol[]
  )('rejects the unsupported %s protocol', async (apiProtocol) => {
    await expect(prepareRoutedConfig({
      model: 'service,test-model',
      modelServices: {
        service: {
          apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'test-key',
          apiProtocol
        }
      }
    })).rejects.toThrow(`Grok adapter does not support ${apiProtocol} model services.`)
  })

  it('consumes the runtime-only Codex shared model service', async () => {
    const { config, prepared } = await prepareRoutedConfig({
      model: 'oneworks-codex,gpt-5.4',
      modelServices: {
        'oneworks-codex': createCodexSharedModelService({
          apiBaseUrl: 'http://127.0.0.1:43177/api/internal/codex-shared-model/v1',
          apiKey: 'shared-token'
        })
      }
    })

    expect(prepared.spawnEnv.ONEWORKS_GROK_MODEL_API_KEY).toBe('shared-token')
    expect(config.model['oneworks-session']).toEqual(expect.objectContaining({
      model: 'gpt-5.4',
      base_url: 'http://127.0.0.1:43177/api/internal/codex-shared-model/v1',
      api_backend: 'chat_completions'
    }))
  })

  it('builds native permission, effort, prompt, and tool flags without collisions', () => {
    const options = {
      ...createOptions('/skill'),
      systemPrompt: 'Use repository rules.',
      appendSystemPrompt: true
    }
    expect(buildGrokCommonArgs({
      adapterConfig: { disableAutoUpdate: true },
      cliModel: 'grok-code-fast-1',
      options
    })).toEqual([
      '--no-auto-update',
      '--model',
      'grok-code-fast-1',
      '--reasoning-effort',
      'xhigh',
      '--permission-mode',
      'dontAsk',
      '--rules',
      'Use repository rules.',
      '--tools',
      'Read,Bash',
      '--disallowed-tools',
      'WebSearch'
    ])
  })

  it('keeps the public effort contract aligned with the native xhigh ceiling', () => {
    expect(grokAdapterConfigSchema.parse({ effort: 'ultra' }).effort).toBe('ultra')
    const args = buildGrokCommonArgs({
      adapterConfig: {},
      options: {
        ...createOptions('/skill'),
        effort: 'ultra'
      }
    })
    expect(args).toContain('xhigh')
    expect(args).not.toContain('ultra')
  })
})
