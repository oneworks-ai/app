import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { buildRelayConfigShareDraft } from '../src/shared/config-share-draft.js'

describe('relay config share draft', () => {
  it('builds a sanitized draft with secret upload previews from selected config', () => {
    const draft = buildRelayConfigShareDraft({
      config: {
        general: {
          defaultModelService: 'openai',
          env: {
            SHOULD_NOT_SHARE: 'nope'
          },
          recommendedModels: [
            {
              model: 'gpt-4.1',
              service: 'openai'
            },
            {
              model: 'ghost',
              service: 'missing'
            }
          ],
          skillRegistries: [
            {
              registry: 'https://registry.npmjs.org',
              source: 'npm',
              title: 'npm'
            }
          ],
          skills: [
            {
              name: 'docs-search',
              registry: 'https://registry.npmjs.org'
            }
          ],
          skillsMeta: {
            homeBridge: {
              roots: ['/Users/local/skills']
            },
            sources: ['npm']
          }
        },
        mcp: {
          mcpServers: {
            local: {
              command: 'node'
            }
          }
        },
        modelServices: {
          openai: {
            apiBaseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-local-secret',
            models: ['gpt-4.1'],
            title: 'OpenAI'
          }
        },
        plugins: {
          plugins: [
            {
              enabled: true,
              id: '@oneworks/plugin-demo',
              options: {
                color: 'blue',
                token: 'plugin-secret'
              },
              scope: 'demo'
            }
          ]
        },
        workspaces: {
          entries: {
            local: '/Users/local/project'
          }
        }
      },
      pluginSchemas: {
        demo: {
          properties: {
            options: {
              properties: {
                token: {
                  type: 'string',
                  writeOnly: true
                }
              },
              type: 'object'
            }
          },
          type: 'object'
        }
      }
    })
    const serialized = JSON.stringify(draft)

    expect(draft.configPatch).toMatchObject({
      modelServices: {
        openai: {
          apiBaseUrl: 'https://api.openai.com/v1',
          models: ['gpt-4.1'],
          title: 'OpenAI'
        }
      },
      plugins: [
        {
          enabled: true,
          id: '@oneworks/plugin-demo',
          options: {
            color: 'blue'
          },
          scope: 'demo'
        }
      ],
      recommendedModels: [
        {
          model: 'gpt-4.1',
          service: 'openai'
        }
      ],
      skillRegistries: [
        {
          registry: 'https://registry.npmjs.org',
          source: 'npm',
          title: 'npm'
        }
      ],
      skills: [
        {
          name: 'docs-search',
          registry: 'https://registry.npmjs.org'
        }
      ],
      skillsMeta: {
        sources: ['npm']
      }
    })
    expect(draft.allowedFields).toEqual([
      'modelServices',
      'recommendedModels',
      'plugins',
      'skills',
      'skillsMeta',
      'skillRegistries'
    ])
    expect(draft.secretItems).toEqual([
      expect.objectContaining({
        path: 'modelServices.openai.apiKey',
        ref: 'modelServices.openai.apiKey',
        uploadRequired: true
      }),
      expect.objectContaining({
        path: 'plugins[0].options.token',
        ref: '/plugins/0/options/token',
        uploadRequired: true
      })
    ])
    expect(draft.pendingSecretRefs).toMatchObject({
      'modelServices.openai.apiKey': {
        sourcePath: 'modelServices.openai.apiKey',
        uploadRequired: true
      },
      '/plugins/0/options/token': {
        sourcePath: 'plugins[0].options.token',
        uploadRequired: true
      }
    })
    expect(draft.rejectedFields).toEqual(expect.arrayContaining([
      'general.defaultModelService',
      'general.env',
      'mcp',
      'skillsMeta.homeBridge.roots',
      'workspaces'
    ]))
    expect(draft.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'model_service_not_visible',
        path: 'recommendedModels[1].service',
        severity: 'error'
      }),
      expect.objectContaining({
        code: 'secret_detected',
        path: 'modelServices.openai.apiKey',
        severity: 'warning'
      }),
      expect.objectContaining({
        code: 'secret_detected',
        path: 'plugins[0].options.token',
        severity: 'warning'
      })
    ]))
    expect(serialized).not.toContain('sk-local-secret')
    expect(serialized).not.toContain('plugin-secret')
    expect(serialized).not.toContain('SHOULD_NOT_SHARE')
    expect(serialized).not.toContain('/Users/local')
  })

  it('returns only explicit safe fields when a narrower field list is requested', () => {
    const draft = buildRelayConfigShareDraft({
      allowedFields: ['modelServices'],
      config: {
        defaultModelService: 'openai',
        modelServices: {
          openai: {
            apiBaseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-local-secret'
          }
        },
        plugins: [
          {
            enabled: true,
            id: 'demo',
            scope: 'demo'
          }
        ]
      }
    })

    expect(draft.allowedFields).toEqual(['modelServices'])
    expect(draft.configPatch).toEqual({
      modelServices: {
        openai: {
          apiBaseUrl: 'https://api.openai.com/v1'
        }
      }
    })
    expect(draft.secretItems).toHaveLength(1)
    expect(JSON.stringify(draft)).not.toContain('sk-local-secret')
  })

  it('rejects adapter config from team share drafts', () => {
    const token = Buffer.from('{"auth_mode":"chatgpt"}\n', 'utf8').toString('base64')
    const draft = buildRelayConfigShareDraft({
      allowedFields: ['adapters'],
      config: {
        adapters: {
          codex: {
            accounts: {
              work: {
                auth: {
                  encoding: 'base64',
                  token,
                  type: 'codex-auth-json'
                },
                authFile: '/Users/local/.codex/auth.json',
                title: 'Work'
              }
            },
            defaultAccount: 'work'
          }
        }
      }
    })

    expect(draft).toMatchObject({
      allowedFields: [],
      pendingSecretRefs: {},
      rejectedFields: ['adapters'],
      secretItems: []
    })
    expect(draft.configPatch).toBeUndefined()
    expect(draft.issues).toContainEqual(expect.objectContaining({
      code: 'rejected_root',
      path: 'adapters',
      severity: 'error'
    }))
    expect(JSON.stringify(draft)).not.toContain('/Users/local')
    expect(JSON.stringify(draft)).not.toContain(token)
  })
})
