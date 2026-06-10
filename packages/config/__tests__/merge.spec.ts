import { describe, expect, it } from 'vitest'

import { mergeConfigs } from '#~/merge.js'

describe('mergeConfigs', () => {
  it('merges layered config values with config-specific rules', () => {
    const merged = mergeConfigs(
      {
        defaultModel: 'base-model',
        adapters: {
          codex: {
            defaultModel: 'gpt-4.1',
            includeModels: ['gpt-4.1']
          }
        },
        env: {
          BASE_URL: 'https://base.example.com'
        },
        permissions: {
          allow: ['Read'],
          defaultMode: 'plan'
        },
        announcements: ['base'],
        defaultIncludeMcpServers: ['docs'],
        workspaces: {
          include: ['apps/*'],
          entries: {
            docs: 'docs'
          }
        },
        notifications: {
          events: {
            completed: {
              title: 'Base Title'
            }
          }
        },
        messageLinks: {
          externalLinkTarget: 'newTab',
          workspaceFileTarget: 'fileTab'
        },
        skills: [
          'frontend-design',
          {
            name: 'lynx-cat',
            registry: 'https://registry.example.com',
            source: 'example-source/lynx/skills',
            version: 'latest'
          }
        ],
        skillsMeta: {
          registries: ['https://registry.example.com'],
          sources: ['example-source/base']
        },
        skillRegistries: [
          {
            source: 'example-source/default/public',
            title: 'Team Tools'
          }
        ],
        marketplaces: {
          'team-tools': {
            type: 'claude-code',
            syncOnRun: true,
            plugins: {
              reviewer: {
                scope: 'review'
              }
            },
            options: {
              source: {
                source: 'settings',
                plugins: [
                  {
                    name: 'reviewer',
                    source: {
                      source: 'npm',
                      package: '@acme/reviewer'
                    }
                  }
                ]
              }
            }
          }
        },
        plugins: [
          {
            id: 'logger',
            enabled: false,
            options: {
              level: 'info'
            }
          }
        ]
      },
      {
        adapters: {
          codex: {
            excludeModels: ['gpt-4.1-mini']
          }
        },
        env: {
          API_KEY: 'secret'
        },
        permissions: {
          allow: ['Edit']
        },
        announcements: ['override'],
        defaultIncludeMcpServers: ['browser', 'docs'],
        workspaces: {
          include: ['services/*'],
          exclude: ['services/legacy'],
          entries: {
            web: {
              path: 'apps/web',
              description: 'Web app'
            }
          }
        },
        notifications: {
          events: {
            completed: {
              description: 'Child Description'
            }
          }
        },
        messageLinks: {
          workspaceFileOpener: 'cursor',
          imageLinkMode: 'link'
        },
        skills: {
          install: [
            {
              name: 'design-review',
              source: 'example-source/default/public',
              version: '1.0.3',
              rename: 'internal-review'
            }
          ]
        },
        skillsMeta: {
          bundled: false,
          registries: ['https://registry.internal.example.com'],
          sources: ['example-source/project']
        },
        skillRegistries: [
          {
            source: 'example-source/default/public',
            registry: 'https://registry.internal.example.com'
          },
          {
            source: 'example-source/release/public',
            title: 'Release Skills'
          }
        ],
        marketplaces: {
          'team-tools': {
            type: 'claude-code',
            enabled: false,
            plugins: {
              reviewer: {
                enabled: false
              },
              chrome: {
                scope: 'browser'
              }
            }
          }
        },
        plugins: [
          {
            id: 'chrome',
            options: {
              headless: true
            }
          }
        ]
      }
    )!

    expect(merged.defaultModel).toBe('base-model')
    expect(merged.adapters?.codex).toEqual({
      defaultModel: 'gpt-4.1',
      includeModels: ['gpt-4.1'],
      excludeModels: ['gpt-4.1-mini']
    })
    expect(merged.env).toEqual({
      BASE_URL: 'https://base.example.com',
      API_KEY: 'secret'
    })
    expect(merged.permissions).toEqual({
      allow: ['Read', 'Edit'],
      defaultMode: 'plan',
      deny: undefined,
      ask: undefined
    })
    expect(merged.announcements).toEqual(['base', 'override'])
    expect(merged.defaultIncludeMcpServers).toEqual(['docs', 'browser'])
    expect(merged.workspaces).toEqual({
      include: ['apps/*', 'services/*'],
      exclude: ['services/legacy'],
      entries: {
        docs: 'docs',
        web: {
          path: 'apps/web',
          description: 'Web app'
        }
      }
    })
    expect(merged.notifications?.events?.completed).toEqual({
      title: 'Base Title',
      description: 'Child Description'
    })
    expect(merged.messageLinks).toEqual({
      externalLinkTarget: 'newTab',
      workspaceFileTarget: 'fileTab',
      workspaceFileOpener: 'cursor',
      imageLinkMode: 'link'
    })
    expect(merged.skills).toEqual([
      'frontend-design',
      {
        name: 'lynx-cat',
        registry: 'https://registry.example.com',
        source: 'example-source/lynx/skills',
        version: 'latest'
      },
      {
        name: 'design-review',
        source: 'example-source/default/public',
        version: '1.0.3',
        rename: 'internal-review'
      }
    ])
    expect(merged.skillsMeta).toEqual({
      bundled: false,
      registries: ['https://registry.example.com', 'https://registry.internal.example.com'],
      sources: ['example-source/base', 'example-source/project'],
      homeBridge: undefined
    })
    expect(merged.skillRegistries).toEqual([
      {
        source: 'example-source/default/public',
        title: 'Team Tools',
        registry: 'https://registry.internal.example.com'
      },
      {
        source: 'example-source/release/public',
        title: 'Release Skills'
      }
    ])
    expect(merged.marketplaces).toEqual({
      'team-tools': {
        type: 'claude-code',
        enabled: false,
        syncOnRun: true,
        plugins: {
          reviewer: {
            enabled: false,
            scope: 'review'
          },
          chrome: {
            scope: 'browser'
          }
        },
        options: {
          source: {
            source: 'settings',
            plugins: [
              {
                name: 'reviewer',
                source: {
                  source: 'npm',
                  package: '@acme/reviewer'
                }
              }
            ]
          }
        }
      }
    })
    expect(merged.plugins).toEqual([
      {
        id: 'logger',
        enabled: false,
        options: {
          level: 'info'
        }
      },
      {
        id: 'chrome',
        options: {
          headless: true
        }
      }
    ])
  })

  it('appends list-based fields from layered conversation config', () => {
    const merged = mergeConfigs(
      {
        conversation: {
          startupPresets: [
            {
              title: 'Base preset',
              mode: 'agent',
              target: 'std/dev-planner'
            }
          ],
          builtinActions: [
            {
              title: 'Base action',
              prompt: 'Summarize the release scope.'
            }
          ],
          runCommands: [
            {
              id: 'base-dev',
              name: 'Base dev',
              script: 'pnpm dev'
            }
          ]
        }
      },
      {
        conversation: {
          startupPresets: [
            {
              title: 'Child preset',
              mode: 'spec',
              target: 'std/standard-dev-flow'
            }
          ],
          builtinActions: [
            {
              title: 'Child action',
              prompt: 'Fix the failing pipeline.'
            }
          ],
          runCommands: [
            {
              id: 'child-test',
              name: 'Child test',
              script: 'pnpm test'
            }
          ]
        }
      }
    )

    expect(merged.conversation?.startupPresets).toEqual([
      {
        title: 'Base preset',
        mode: 'agent',
        target: 'std/dev-planner'
      },
      {
        title: 'Child preset',
        mode: 'spec',
        target: 'std/standard-dev-flow'
      }
    ])
    expect(merged.conversation?.builtinActions).toEqual([
      {
        title: 'Base action',
        prompt: 'Summarize the release scope.'
      },
      {
        title: 'Child action',
        prompt: 'Fix the failing pipeline.'
      }
    ])
    expect(merged.conversation?.runCommands).toEqual([
      {
        id: 'base-dev',
        name: 'Base dev',
        script: 'pnpm dev'
      },
      {
        id: 'child-test',
        name: 'Child test',
        script: 'pnpm test'
      }
    ])
  })
})
