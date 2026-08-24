import { describe, expect, it } from 'vitest'

import { buildInlineConfigContent, resolveOpenCodeModel } from '#~/runtime/common.js'

describe('openCode config and model helpers', () => {
  it('builds inline config overrides for permissions, mcp, tools, and instructions', () => {
    const config = buildInlineConfigContent({
      envConfigContent: {
        instructions: ['CONTRIBUTING.md']
      },
      adapterConfigContent: {
        provider: {
          existing: {
            name: 'Existing'
          }
        }
      },
      permissionMode: 'default',
      tools: {
        exclude: ['write']
      },
      mcpServers: {
        include: ['local-docs']
      },
      availableMcpServers: {
        'local-docs': {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-everything']
        }
      },
      systemPromptFile: '/tmp/system.md',
      providerConfig: {
        custom: {
          npm: '@ai-sdk/openai-compatible'
        }
      }
    })

    expect(config).toMatchObject({
      instructions: ['CONTRIBUTING.md', '/tmp/system.md'],
      permission: {
        '*': 'allow',
        bash: 'ask',
        edit: 'deny',
        task: 'ask'
      },
      tools: {
        write: false
      },
      mcp: {
        'local-docs': {
          type: 'local',
          command: ['npx', '-y', '@modelcontextprotocol/server-everything'],
          enabled: true
        }
      },
      provider: {
        existing: {
          name: 'Existing'
        },
        custom: {
          npm: '@ai-sdk/openai-compatible'
        }
      }
    })
  })
  it('maps custom model services to an OpenCode provider/model pair', () => {
    const result = resolveOpenCodeModel('gateway,gpt-5', {
      gateway: {
        apiBaseUrl: 'https://example.test/v1',
        apiKey: 'secret',
        title: 'Gateway',
        timeoutMs: 600000,
        maxOutputTokens: 8192
      }
    })

    expect(result.cliModel).toBe('gateway/gpt-5')
    expect(result.providerConfig).toMatchObject({
      gateway: {
        npm: '@ai-sdk/openai-compatible',
        options: {
          apiKey: 'secret',
          baseURL: 'https://example.test/v1',
          timeout: 600000,
          chunkTimeout: 600000
        },
        models: {
          'gpt-5': {
            name: 'gpt-5',
            limit: {
              output: 8192
            },
            options: {
              maxOutputTokens: 8192
            }
          }
        }
      }
    })
  })

  it('requires an explicit SDK package for non-OpenAI protocols', () => {
    expect(() =>
      resolveOpenCodeModel('anthropic,claude-sonnet', {
        anthropic: {
          apiBaseUrl: 'https://api.anthropic.com/v1',
          apiProtocol: 'anthropic-messages',
          apiKey: 'secret'
        }
      })
    ).toThrow(/requires an explicit extra\.opencode\.npm package/)
  })

  it('maps a Provider Profile to a collision-safe OpenCode provider id', () => {
    const result = resolveOpenCodeModel('deepseek/work,deepseek-chat', {
      deepseek: {
        kind: 'collection',
        provider: 'deepseek',
        profiles: {
          work: { apiKey: 'work-key' }
        }
      }
    })

    expect(result.cliModel).toMatch(/^deepseek-work-[a-f0-9]{8}\/deepseek-chat$/u)
    const providerId = result.cliModel?.split('/')[0]
    expect(result.providerConfig?.[providerId ?? '']).toMatchObject({
      options: {
        apiKey: 'work-key',
        baseURL: 'https://api.deepseek.com'
      }
    })
  })

  it('preserves provider prefix when explicit service syntax has no local mapping', () => {
    expect(resolveOpenCodeModel('openrouter,claude-sonnet-4.5', {})).toEqual({
      cliModel: 'openrouter/claude-sonnet-4.5',
      providerConfig: undefined
    })
  })

  it('does not inject permission overrides when no runtime permission inputs are provided', () => {
    expect(buildInlineConfigContent({})).not.toHaveProperty('permission')
  })

  it('preserves inherited string permission config when runtime permission is unset', () => {
    expect(buildInlineConfigContent({
      adapterConfigContent: {
        permission: 'ask'
      }
    })).toMatchObject({
      permission: 'ask'
    })
  })
})
