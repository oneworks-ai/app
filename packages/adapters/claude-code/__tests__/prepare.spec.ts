/* eslint-disable max-lines -- prepare tests cover multiple native CLI routing paths */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'
import { getManagedPluginInstallDir } from '@oneworks/utils/managed-plugin'

import { ensureClaudeCodeRouterReady } from '../src/ccr/daemon'
import { resolveClaudeRuntimeAccount } from '../src/claude/accounts'
import { prepareClaudeExecution } from '../src/claude/prepare'

vi.mock('../src/ccr/paths', () => ({
  CLAUDE_CODE_CLI_COMPATIBILITY_RANGE: '>=0.0.0-test',
  CLAUDE_CODE_CLI_PACKAGE: '@anthropic-ai/claude-code',
  CLAUDE_CODE_CLI_VERSION: '0.0.0-test',
  resolveClaudeCodeSystemBinaryPaths: vi.fn(async () => []),
  resolveClaudeCliPath: vi.fn(() => '/mock/claude')
}))

vi.mock('@oneworks/utils/managed-npm-cli', () => ({
  ensureManagedNpmCli: vi.fn(async ({ bundledPath }: { bundledPath?: string }) => bundledPath ?? '/mock/claude')
}))

vi.mock('../src/ccr/daemon', () => ({
  ensureClaudeCodeRouterReady: vi.fn()
}))

vi.mock('../src/claude/accounts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/claude/accounts')>(),
  resolveClaudeRuntimeAccount: vi.fn(async () => ({}))
}))

describe('prepareClaudeExecution', () => {
  let settingsSnapshot: Record<string, any> | undefined
  const originalProjectHomeProjectsDir = process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__

  const prepareWithOfficialModelService = async (params: {
    apiBaseUrl?: string
    apiKey?: string
    extra?: Record<string, unknown>
    model: string
    models?: string[]
    provider?: string
    serviceKey?: string
  }) => {
    const serviceKey = params.serviceKey ?? 'official'
    const cacheSet = vi.fn(async (key: string, value: unknown) => {
      if (key === 'adapter.claude-code.settings') {
        settingsSnapshot = value as Record<string, any>
      }

      return {
        cachePath: `/tmp/${key}.json`
      }
    })

    return await prepareClaudeExecution({
      ctxId: `ctx-${serviceKey}`,
      cwd: '/repo',
      env: {},
      cache: {
        set: cacheSet as any,
        get: vi.fn(async () => undefined) as any
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      } as any,
      configs: [{}, {
        modelServices: {
          [serviceKey]: {
            ...(params.apiBaseUrl != null ? { apiBaseUrl: params.apiBaseUrl } : {}),
            apiKey: params.apiKey ?? 'official-key',
            ...(params.extra != null ? { extra: params.extra } : {}),
            ...(params.models != null ? { models: params.models } : {}),
            ...(params.provider != null ? { provider: params.provider } : {})
          }
        }
      }]
    }, {
      type: 'create',
      runtime: 'server',
      sessionId: `sess-${serviceKey}`,
      model: `${serviceKey},${params.model}`,
      onEvent: vi.fn()
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveClaudeRuntimeAccount).mockResolvedValue({})
    settingsSnapshot = undefined
    if (originalProjectHomeProjectsDir == null) {
      delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
    } else {
      process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = originalProjectHomeProjectsDir
    }
  })

  it.each(
    [
      [
        'isolated',
        {
          accountKey: 'work',
          configDir: '/private/account-config',
          credentialHome: 'isolated',
          managed: true
        },
        '/private/account-config'
      ],
      ['system-login reference', { accountKey: 'work', credentialHome: 'default', managed: true }, undefined]
    ] as const
  )('scrubs auth overrides for a selected %s managed account', async (
    _kind,
    runtimeAccount,
    expectedConfigDir
  ) => {
    vi.mocked(resolveClaudeRuntimeAccount).mockResolvedValue(runtimeAccount)

    const prepared = await prepareClaudeExecution({
      ctxId: 'ctx-account',
      cwd: '/repo',
      env: {
        ANTHROPIC_API_KEY: 'must-not-win',
        ANTHROPIC_AUTH_TOKEN: 'must-not-win',
        ANTHROPIC_BASE_URL: 'https://must-not-win.example',
        ANTHROPIC_CUSTOM_HEADERS: 'x-must-not-win: true',
        CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'must-not-win',
        CLAUDE_CODE_OAUTH_SCOPES: 'must-not-win',
        CLAUDE_CODE_OAUTH_TOKEN: 'must-not-win',
        CLAUDE_CODE_USE_BEDROCK: '1',
        CLAUDE_CONFIG_DIR: '/ctx-must-not-win'
      },
      cache: {
        set: vi.fn(async (key: string, value: unknown) => {
          if (key === 'adapter.claude-code.settings') settingsSnapshot = value as Record<string, any>
          return { cachePath: `/tmp/${key}.json` }
        }) as any,
        get: vi.fn(async () => undefined) as any
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      } as any,
      configs: [{}, {
        env: {
          ANTHROPIC_API_KEY: 'settings-must-not-win',
          CLAUDE_CODE_USE_VERTEX: '1'
        },
        adapters: {
          'claude-code': {
            nativeEnv: {
              CLAUDE_CONFIG_DIR: '/native-must-not-win'
            },
            settingsContent: {
              apiKeyHelper: '/must/not/run',
              env: {
                CLAUDE_CONFIG_DIR: '/settings-must-not-win',
                ANTHROPIC_AUTH_TOKEN: 'raw-settings-must-not-win',
                ANTHROPIC_BASE_URL: 'https://raw-settings-must-not-win.example',
                ANTHROPIC_CUSTOM_HEADERS: 'x-raw-settings-must-not-win: true',
                CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'raw-settings-must-not-win',
                CLAUDE_CODE_OAUTH_SCOPES: 'raw-settings-must-not-win',
                CLAUDE_CODE_OAUTH_TOKEN: 'raw-settings-must-not-win'
              }
            }
          }
        }
      }]
    }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'sess-account',
      account: 'work',
      onEvent: vi.fn()
    })

    expect(resolveClaudeRuntimeAccount).toHaveBeenCalledWith(expect.objectContaining({
      requestedAccount: 'work'
    }))
    expect(prepared.accountKey).toBe('work')
    expect(prepared.env.CLAUDE_CONFIG_DIR).toBe(expectedConfigDir)
    expect(prepared.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(prepared.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(prepared.env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(prepared.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
    expect(prepared.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN).toBeUndefined()
    expect(prepared.env.CLAUDE_CODE_OAUTH_SCOPES).toBeUndefined()
    expect(prepared.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(prepared.env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(settingsSnapshot?.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(settingsSnapshot?.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(settingsSnapshot?.env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(settingsSnapshot?.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
    expect(settingsSnapshot?.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN).toBeUndefined()
    expect(settingsSnapshot?.env.CLAUDE_CODE_OAUTH_SCOPES).toBeUndefined()
    expect(settingsSnapshot?.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(settingsSnapshot?.env.CLAUDE_CODE_USE_VERTEX).toBeUndefined()
    expect(settingsSnapshot?.env.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(settingsSnapshot?.apiKeyHelper).toBeUndefined()
  })

  it('keeps the explicit system account on the default profile across all config layers', async () => {
    vi.mocked(resolveClaudeRuntimeAccount).mockResolvedValue({
      accountKey: 'system',
      credentialHome: 'default'
    })

    const prepared = await prepareClaudeExecution({
      ctxId: 'ctx-system-account',
      cwd: '/repo',
      env: {
        ANTHROPIC_API_KEY: 'system-override-remains',
        CLAUDE_CONFIG_DIR: '/ctx-foreign-profile'
      },
      cache: {
        set: vi.fn(async (key: string, value: unknown) => {
          if (key === 'adapter.claude-code.settings') settingsSnapshot = value as Record<string, any>
          return { cachePath: `/tmp/${key}.json` }
        }) as any,
        get: vi.fn(async () => undefined) as any
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      } as any,
      configs: [{}, {
        adapters: {
          'claude-code': {
            nativeEnv: {
              CLAUDE_CONFIG_DIR: '/native-foreign-profile'
            },
            settingsContent: {
              env: {
                CLAUDE_CONFIG_DIR: '/settings-foreign-profile'
              }
            }
          }
        }
      }]
    }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'sess-system-account',
      account: 'system',
      onEvent: vi.fn()
    })

    expect(prepared.env.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(prepared.env.ANTHROPIC_API_KEY).toBe('system-override-remains')
    expect(settingsSnapshot?.env.CLAUDE_CONFIG_DIR).toBeUndefined()
  })

  it('rejects router models when a managed Claude account is selected', async () => {
    vi.mocked(resolveClaudeRuntimeAccount).mockResolvedValue({
      accountKey: 'work',
      credentialHome: 'default',
      managed: true
    })

    await expect(prepareClaudeExecution({
      ctxId: 'ctx-router-account',
      cwd: '/repo',
      env: {},
      cache: {
        set: vi.fn(async () => ({ cachePath: '/tmp/settings.json' })) as any,
        get: vi.fn(async () => undefined) as any
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      } as any,
      configs: [{}, {}]
    }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'sess-router-account',
      account: 'work',
      model: 'kimi,kimi-k2.5',
      onEvent: vi.fn()
    })).rejects.toThrow(/cannot be combined with Claude Code Router/i)
    expect(ensureClaudeCodeRouterReady).not.toHaveBeenCalled()
  })

  it('disables the native AskUserQuestion tool for server runtime sessions', async () => {
    const cacheSet = vi.fn(async (key: string, value: unknown) => {
      if (key === 'adapter.claude-code.settings') {
        settingsSnapshot = value as Record<string, any>
      }

      return {
        cachePath: `/tmp/${key}.json`
      }
    })

    const prepared = await prepareClaudeExecution({
      ctxId: 'ctx-1',
      cwd: '/repo',
      env: {},
      cache: {
        set: cacheSet as any,
        get: vi.fn(async () => undefined) as any
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      } as any,
      configs: [{}, {}]
    }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'sess-1',
      tools: {
        include: ['AskUserQuestion', 'Read']
      },
      onEvent: vi.fn()
    })

    expect(prepared.cliPath).toBe('/mock/claude')
    expect(settingsSnapshot?.permissions.allow).toContain('Read')
    expect(settingsSnapshot?.permissions.allow).not.toContain('AskUserQuestion')
    expect(settingsSnapshot?.permissions.deny).toContain('AskUserQuestion')
  })

  it('passes bypassPermissions through to the Claude CLI in headless mode', async () => {
    const prepared = await prepareClaudeExecution({
      ctxId: 'ctx-1',
      cwd: '/repo',
      env: {},
      cache: {
        set: vi.fn(async (key: string) => ({
          cachePath: `/tmp/${key}.json`
        })) as any,
        get: vi.fn(async () => undefined) as any
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      } as any,
      configs: [{}, {}]
    }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'sess-2',
      permissionMode: 'bypassPermissions',
      onEvent: vi.fn()
    })

    expect(prepared.args).toContain('--dangerously-skip-permissions')
    expect(prepared.args).not.toContain('--permission-mode')
  })

  it('uses DeepSeek official Anthropic API directly instead of Claude Code Router', async () => {
    const cacheSet = vi.fn(async (key: string, value: unknown) => {
      if (key === 'adapter.claude-code.settings') {
        settingsSnapshot = value as Record<string, any>
      }

      return {
        cachePath: `/tmp/${key}.json`
      }
    })

    const prepared = await prepareClaudeExecution({
      ctxId: 'ctx-deepseek',
      cwd: '/repo',
      env: {},
      cache: {
        set: cacheSet as any,
        get: vi.fn(async () => undefined) as any
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      } as any,
      configs: [{}, {
        modelServices: {
          deepseek: {
            provider: 'deepseek',
            apiKey: 'deepseek-key'
          }
        }
      }]
    }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'sess-deepseek',
      model: 'deepseek,deepseek-v4-flash',
      onEvent: vi.fn()
    })

    expect(ensureClaudeCodeRouterReady).not.toHaveBeenCalled()
    expect(prepared.args).toContain('--model')
    expect(prepared.args[prepared.args.indexOf('--model') + 1]).toBe('deepseek-v4-flash')
    expect(settingsSnapshot?.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'deepseek-key',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_MODEL: 'deepseek-v4-flash'
    })
  })

  it('uses Kimi official Anthropic API directly instead of Claude Code Router', async () => {
    const cacheSet = vi.fn(async (key: string, value: unknown) => {
      if (key === 'adapter.claude-code.settings') {
        settingsSnapshot = value as Record<string, any>
      }

      return {
        cachePath: `/tmp/${key}.json`
      }
    })

    const prepared = await prepareClaudeExecution({
      ctxId: 'ctx-kimi',
      cwd: '/repo',
      env: {},
      cache: {
        set: cacheSet as any,
        get: vi.fn(async () => undefined) as any
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      } as any,
      configs: [{}, {
        modelServices: {
          kimi: {
            provider: 'moonshot-cn',
            apiKey: 'kimi-key'
          }
        }
      }]
    }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'sess-kimi',
      model: 'kimi,kimi-k2.7-code',
      onEvent: vi.fn()
    })

    expect(ensureClaudeCodeRouterReady).not.toHaveBeenCalled()
    expect(prepared.args).toContain('--model')
    expect(prepared.args[prepared.args.indexOf('--model') + 1]).toBe('kimi-k2.7-code')
    expect(settingsSnapshot?.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'kimi-key',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_MODEL: 'kimi-k2.7-code',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-k2.7-code',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-k2.7-code',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-k2.7-code',
      CLAUDE_CODE_SUBAGENT_MODEL: 'kimi-k2.7-code',
      ENABLE_TOOL_SEARCH: 'false',
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: '262144'
    })
  })

  it('derives Kimi international Anthropic base URL from OpenAI chat endpoint overrides', async () => {
    const cacheSet = vi.fn(async (key: string, value: unknown) => {
      if (key === 'adapter.claude-code.settings') {
        settingsSnapshot = value as Record<string, any>
      }

      return {
        cachePath: `/tmp/${key}.json`
      }
    })

    await prepareClaudeExecution({
      ctxId: 'ctx-kimi-intl',
      cwd: '/repo',
      env: {},
      cache: {
        set: cacheSet as any,
        get: vi.fn(async () => undefined) as any
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      } as any,
      configs: [{}, {
        modelServices: {
          kimi: {
            apiBaseUrl: 'https://api.moonshot.ai/v1/chat/completions',
            apiKey: 'kimi-key',
            models: ['kimi-k2.7-code']
          }
        }
      }]
    }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'sess-kimi-intl',
      model: 'kimi,kimi-k2.7-code',
      onEvent: vi.fn()
    })

    expect(ensureClaudeCodeRouterReady).not.toHaveBeenCalled()
    expect(settingsSnapshot?.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://api.moonshot.ai/anthropic',
      ANTHROPIC_MODEL: 'kimi-k2.7-code'
    })
  })

  it.each([
    {
      name: 'Anthropic',
      provider: 'anthropic',
      model: 'claude-fable-5',
      expectedEnv: {
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
        ANTHROPIC_API_KEY: 'official-key',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'claude-fable-5'
      }
    },
    {
      name: 'Alibaba Qwen pay-as-you-go',
      provider: 'qwen',
      model: 'qwen3.7-max',
      expectedEnv: {
        ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'official-key',
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_MODEL: 'qwen3.7-max',
        CLAUDE_CODE_SUBAGENT_MODEL: 'qwen3.7-max'
      }
    },
    {
      name: 'Alibaba Qwen Coding Plan override',
      apiBaseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
      provider: 'qwen',
      model: 'qwen3.7-plus',
      expectedEnv: {
        ANTHROPIC_BASE_URL: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
        ANTHROPIC_MODEL: 'qwen3.7-plus'
      }
    },
    {
      name: 'Alibaba Qwen Coding Plan provider',
      provider: 'qwen-coding-plan',
      model: 'qwen3.7-plus',
      expectedEnv: {
        ANTHROPIC_BASE_URL: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
        ANTHROPIC_MODEL: 'qwen3.7-plus'
      }
    },
    {
      name: 'Kimi Code',
      provider: 'kimi-code',
      model: 'kimi-for-coding',
      expectedEnv: {
        ANTHROPIC_BASE_URL: 'https://api.kimi.com/coding/',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_API_KEY: 'official-key',
        ANTHROPIC_MODEL: 'kimi-for-coding'
      }
    },
    {
      name: 'Zhipu GLM long context',
      provider: 'zhipu',
      model: 'glm-5.2[1m]',
      expectedEnv: {
        ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
        ANTHROPIC_MODEL: 'glm-5.2[1m]',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.2[1m]',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.2[1m]',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.5-air',
        ENABLE_TOOL_SEARCH: '0',
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000'
      }
    },
    {
      name: 'Zhipu GLM Coding Plan',
      provider: 'zhipu-coding-plan',
      model: 'GLM-5.2',
      expectedEnv: {
        ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
        ANTHROPIC_MODEL: 'GLM-5.2',
        ENABLE_TOOL_SEARCH: '0',
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1'
      }
    },
    {
      name: 'MiniMax China',
      apiBaseUrl: 'https://api.minimaxi.com/v1',
      provider: 'minimax',
      model: 'MiniMax-M3',
      expectedEnv: {
        ANTHROPIC_BASE_URL: 'https://api.minimaxi.com/anthropic',
        ANTHROPIC_MODEL: 'MiniMax-M3',
        API_TIMEOUT_MS: '3000000',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '512000'
      }
    },
    {
      name: 'MiniMax Token Plan',
      provider: 'minimax-token-plan',
      model: 'MiniMax-M3',
      expectedEnv: {
        ANTHROPIC_BASE_URL: 'https://api.minimax.io/anthropic',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_API_KEY: 'official-key',
        ANTHROPIC_MODEL: 'MiniMax-M3',
        API_TIMEOUT_MS: '3000000',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '512000'
      }
    },
    {
      name: 'Tencent TokenHub Coding Plan',
      provider: 'tencent-tokenhub-coding-plan',
      model: 'tc-code-latest',
      expectedEnv: {
        ANTHROPIC_BASE_URL: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
        ANTHROPIC_MODEL: 'tc-code-latest'
      }
    },
    {
      name: 'Volcengine Ark Coding Plan',
      provider: 'volcengine-ark-coding-plan',
      model: 'glm-5.1',
      expectedEnv: {
        ANTHROPIC_BASE_URL: 'https://ark.cn-beijing.volces.com/api/coding',
        ANTHROPIC_MODEL: 'glm-5.1'
      }
    },
    {
      name: 'Baidu Qianfan Coding Plan',
      provider: 'baidu-qianfan-coding-plan',
      model: 'qianfan-code-latest',
      expectedEnv: {
        ANTHROPIC_BASE_URL: 'https://qianfan.baidubce.com/anthropic/coding',
        ANTHROPIC_MODEL: 'qianfan-code-latest'
      }
    },
    {
      name: 'OpenRouter',
      provider: 'openrouter',
      model: '~anthropic/claude-sonnet-latest',
      expectedEnv: {
        ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
        ANTHROPIC_MODEL: '~anthropic/claude-sonnet-latest'
      }
    },
    {
      name: 'Requesty',
      provider: 'requesty',
      model: 'anthropic/claude-fable-5',
      expectedEnv: {
        ANTHROPIC_BASE_URL: 'https://router.requesty.ai',
        ANTHROPIC_MODEL: 'anthropic/claude-fable-5'
      }
    },
    {
      name: 'Vercel AI Gateway',
      provider: 'vercel-ai-gateway',
      model: 'anthropic/claude-sonnet-4.6',
      expectedEnv: {
        ANTHROPIC_BASE_URL: 'https://ai-gateway.vercel.sh',
        ANTHROPIC_MODEL: 'anthropic/claude-sonnet-4.6'
      }
    }
  ])('uses $name official Anthropic API directly instead of Claude Code Router', async (params) => {
    const prepared = await prepareWithOfficialModelService(params)

    expect(ensureClaudeCodeRouterReady).not.toHaveBeenCalled()
    expect(prepared.args).toContain('--model')
    expect(prepared.args[prepared.args.indexOf('--model') + 1]).toBe(params.model)
    expect(settingsSnapshot?.env).toMatchObject({
      ANTHROPIC_AUTH_TOKEN: 'official-key',
      ANTHROPIC_API_KEY: '',
      ...params.expectedEnv
    })
  })

  it('passes Portkey custom provider headers for Claude Code gateway routing', async () => {
    const prepared = await prepareWithOfficialModelService({
      provider: 'portkey',
      model: 'claude-sonnet-4-20250514',
      extra: {
        claudeCode: {
          portkeyProvider: '@anthropic-prod'
        }
      }
    })

    expect(ensureClaudeCodeRouterReady).not.toHaveBeenCalled()
    expect(prepared.args[prepared.args.indexOf('--model') + 1]).toBe('claude-sonnet-4-20250514')
    expect(settingsSnapshot?.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://api.portkey.ai',
      ANTHROPIC_AUTH_TOKEN: 'official-key',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_CUSTOM_HEADERS: 'x-portkey-api-key: official-key\nx-portkey-provider: @anthropic-prod'
    })
  })

  it('keeps explicit resume sessions in resume mode even when resume-state cache is missing', async () => {
    const prepared = await prepareClaudeExecution({
      ctxId: 'ctx-1',
      cwd: '/repo',
      env: {},
      cache: {
        set: vi.fn(async (key: string) => ({
          cachePath: `/tmp/${key}.json`
        })) as any,
        get: vi.fn(async () => undefined) as any
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      } as any,
      configs: [{}, {}]
    }, {
      type: 'resume',
      runtime: 'cli',
      sessionId: 'sess-resume',
      onEvent: vi.fn()
    })

    expect(prepared.executionType).toBe('resume')
    expect(prepared.args).toContain('--resume')
    expect(prepared.args).toContain('sess-resume')
    expect(prepared.args).not.toContain('--session-id')
  })

  it('falls back to create only when resume-state explicitly marks resume as unavailable', async () => {
    const prepared = await prepareClaudeExecution({
      ctxId: 'ctx-1',
      cwd: '/repo',
      env: {},
      cache: {
        set: vi.fn(async (key: string) => ({
          cachePath: `/tmp/${key}.json`
        })) as any,
        get: vi.fn(async (key: string) =>
          key === 'adapter.claude-code.resume-state'
            ? { canResume: false }
            : undefined
        ) as any
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      } as any,
      configs: [{}, {}]
    }, {
      type: 'resume',
      runtime: 'cli',
      sessionId: 'sess-create-fallback',
      onEvent: vi.fn()
    })

    expect(prepared.executionType).toBe('create')
    expect(prepared.args).toContain('--session-id')
    expect(prepared.args).toContain('sess-create-fallback')
    expect(prepared.args).not.toContain('--resume')
  })

  it('stages managed Claude plugins into the session cache and passes --plugin-dir', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'claude-prepare-'))
    const env = {
      HOME: cwd,
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: join(cwd, '.oneworks-projects')
    }
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
    const installDir = getManagedPluginInstallDir(cwd, 'claude', 'demo', env)
    await mkdir(join(installDir, 'native/.claude-plugin'), { recursive: true })
    await mkdir(join(installDir, 'oneworks'), { recursive: true })
    await writeFile(
      join(installDir, '.oneworks-plugin.json'),
      JSON.stringify(
        {
          version: 1,
          adapter: 'claude',
          name: 'demo',
          scope: 'demo',
          installedAt: new Date().toISOString(),
          source: {
            type: 'path',
            path: './demo'
          },
          nativePluginPath: 'native',
          oneworksPluginPath: 'oneworks'
        },
        null,
        2
      )
    )
    await writeFile(join(installDir, 'native/.claude-plugin/plugin.json'), JSON.stringify({ name: 'demo' }))

    const prepared = await prepareClaudeExecution({
      ctxId: 'ctx-plugins',
      cwd,
      env,
      cache: {
        set: vi.fn(async (key: string) => ({
          cachePath: `/tmp/${key}.json`
        })) as any,
        get: vi.fn(async () => undefined) as any
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      } as any,
      configs: [{}, {}]
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'sess-plugins',
      onEvent: vi.fn()
    })

    const pluginDirIndex = prepared.args.findIndex(arg => arg === '--plugin-dir')
    expect(pluginDirIndex).toBeGreaterThan(-1)
    const stagedPluginDir = prepared.args[pluginDirIndex + 1]
    expect(stagedPluginDir).toContain(
      resolveProjectHomePath(
        cwd,
        env,
        'caches',
        'ctx-plugins',
        'sess-plugins',
        '.claude-plugins'
      )
    )
  })

  it('deep merges settingsContent across layered adapter config entries', async () => {
    const cacheSet = vi.fn(async (key: string, value: unknown) => {
      if (key === 'adapter.claude-code.settings') {
        settingsSnapshot = value as Record<string, any>
      }

      return {
        cachePath: `/tmp/${key}.json`
      }
    })

    await prepareClaudeExecution({
      ctxId: 'ctx-merge',
      cwd: '/repo',
      env: {},
      cache: {
        set: cacheSet as any,
        get: vi.fn(async () => undefined) as any
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      } as any,
      configs: [{
        adapters: {
          'claude-code': {
            settingsContent: {
              outputStyle: {
                tone: 'concise',
                bullets: true
              }
            }
          }
        }
      }, {
        adapters: {
          'claude-code': {
            settingsContent: {
              outputStyle: {
                bullets: false
              },
              approvals: {
                mode: 'plan'
              }
            }
          }
        }
      }]
    } as any, {
      type: 'create',
      runtime: 'server',
      sessionId: 'sess-merge',
      onEvent: vi.fn()
    })

    expect(settingsSnapshot?.outputStyle).toEqual({
      tone: 'concise',
      bullets: false
    })
    expect(settingsSnapshot?.approvals).toEqual({
      mode: 'plan'
    })
  })
})
