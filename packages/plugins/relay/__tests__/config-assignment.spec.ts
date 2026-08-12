/* eslint-disable max-lines -- config assignment normalization and merge invariants share one fixture surface. */
import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import {
  filterRelayConfigPatch,
  matchesRelayConfigProject,
  mergeRelayConfigPatches,
  normalizeRelayGitRepositoryIdentity,
  relayGitRepositoryIdentitiesEqual,
  resolveRelayConfigPatchForProject
} from '../src/shared/config-assignment.js'

describe('relay config assignment', () => {
  it('normalizes standard Git remote identities and rejects ambiguous repository names', () => {
    expect(normalizeRelayGitRepositoryIdentity('https://github.com/OneWorks-AI/app.git')).toBe(
      'github.com/OneWorks-AI/app'
    )
    expect(normalizeRelayGitRepositoryIdentity('git@github.com:oneworks-ai/app.git')).toBe(
      'github.com/oneworks-ai/app'
    )
    expect(normalizeRelayGitRepositoryIdentity('ssh://git@git.example.com/platform/app.git')).toBe(
      'git.example.com/platform/app'
    )
    expect(normalizeRelayGitRepositoryIdentity('ssh://git@github.com:22/OneWorks-AI/App.git')).toBe(
      'github.com/OneWorks-AI/App'
    )
    expect(normalizeRelayGitRepositoryIdentity('oneworks-ai/app')).toBeUndefined()
    expect(normalizeRelayGitRepositoryIdentity('https://github.com/oneworks-ai/app?ref=main')).toBeUndefined()
  })

  it('matches a canonical assignment against discovered Git remote identities', () => {
    expect(matchesRelayConfigProject(
      { project: { allow: ['github.com/oneworks-ai/app'] } },
      { gitRepositories: ['git@github.com:oneworks-ai/app.git'] }
    )).toBe(true)
    expect(matchesRelayConfigProject(
      { project: { allow: ['github.com/oneworks-ai/other'] } },
      { gitRepositories: ['https://github.com/oneworks-ai/app.git'] }
    )).toBe(false)
  })

  it('uses provider-aware repository path casing', () => {
    expect(relayGitRepositoryIdentitiesEqual(
      'github.com/OneWorks-AI/App',
      'ssh://git@github.com:22/oneworks-ai/app.git'
    )).toBe(true)
    expect(relayGitRepositoryIdentitiesEqual(
      'git.example.com/Platform/App',
      'git.example.com/platform/app'
    )).toBe(false)
    expect(matchesRelayConfigProject(
      { project: { allow: ['git.example.com/Platform/App'] } },
      { gitRepositories: ['ssh://git@git.example.com/platform/app.git'] }
    )).toBe(false)
  })

  it('matches project allow and deny rules with deny taking precedence', () => {
    expect(matchesRelayConfigProject(
      {
        project: {
          allow: ['team-*'],
          deny: ['team-secret']
        }
      },
      { projectId: 'team-app' }
    )).toBe(true)

    expect(matchesRelayConfigProject(
      {
        project: {
          allow: ['team-*'],
          deny: ['team-secret']
        }
      },
      { projectId: 'team-secret' }
    )).toBe(false)

    expect(matchesRelayConfigProject(
      {
        project: {
          allow: ['/workspaces/customer-a']
        }
      },
      { workspaceFolder: '/workspaces/customer-b' }
    )).toBe(false)
  })

  it('filters config patches to safe allowed fields only', () => {
    expect(filterRelayConfigPatch(
      {
        defaultModelService: 'relay',
        env: {
          SECRET: 'nope'
        },
        mcpServers: {
          dangerous: {}
        },
        modelServices: {
          relay: {
            apiBaseUrl: 'https://relay.example.com/v1',
            apiProtocol: 'anthropic-messages',
            apiKey: 'secret'
          }
        },
        permissions: {
          allow: ['Nope']
        },
        plugins: {
          relay: { enabled: true }
        },
        recommendedModels: [{ model: 'relay-model' }]
      },
      ['modelServices', 'plugins', 'recommendedModels']
    )).toEqual({
      modelServices: {
        relay: {
          apiBaseUrl: 'https://relay.example.com/v1',
          apiProtocol: 'anthropic-messages'
        }
      },
      plugins: {
        relay: { enabled: true }
      },
      recommendedModels: [{ model: 'relay-model' }]
    })
    expect(JSON.stringify(filterRelayConfigPatch(
      {
        modelServices: {
          relay: {
            apiBaseUrl: 'https://relay.example.com/v1',
            apiKey: 'secret'
          }
        }
      },
      ['modelServices']
    ))).not.toContain('secret')
  })

  it('preserves generic account envelopes while sanitizing unrelated adapter secrets', () => {
    const token = Buffer.from('{"auth_mode":"chatgpt"}\n', 'utf8').toString('base64')
    const stateToken = Buffer.from('{"oauthAccount":{"displayName":"Ada"}}', 'utf8').toString('base64')

    expect(filterRelayConfigPatch(
      {
        adapters: {
          codex: {
            accounts: {
              work: {
                auth: {
                  encoding: 'base64',
                  token,
                  type: 'codex-auth-json',
                  version: -1
                },
                authFile: '/Users/local/.codex/auth.json',
                disabled: false,
                priority: 100,
                title: 'Work'
              }
            },
            accountPool: {
              cooldownMs: 120000,
              enabled: true,
              strategy: 'sticky-priority'
            },
            defaultAccount: 'work'
          },
          'claude-code': {
            defaultAccount: 'personal',
            accounts: {
              personal: {
                auth: {
                  storage: 'device',
                  type: 'claude-native-credential-store',
                  version: 1,
                  portability: 'device-bound',
                  binding: 'device-binding'
                },
                state: {
                  storage: 'inline',
                  type: 'claude-account-state-json',
                  version: 1,
                  portability: 'portable',
                  encoding: 'base64',
                  token: stateToken
                },
                displayName: 'Ada',
                apiKey: 'nope'
              }
            }
          },
          other: {
            token: 'nope'
          }
        }
      },
      ['adapters']
    )).toEqual({
      adapters: {
        codex: {
          defaultAccount: 'work',
          accountPool: {
            cooldownMs: 120000,
            enabled: true,
            strategy: 'sticky-priority'
          },
          accounts: {
            work: {
              auth: {
                encoding: 'base64',
                token,
                type: 'codex-auth-json'
              },
              disabled: false,
              priority: 100,
              title: 'Work'
            }
          }
        },
        'claude-code': {
          defaultAccount: 'personal',
          accounts: {
            personal: {
              auth: {
                storage: 'device',
                type: 'claude-native-credential-store',
                version: 1,
                portability: 'device-bound',
                binding: 'device-binding'
              },
              state: {
                storage: 'inline',
                type: 'claude-account-state-json',
                version: 1,
                portability: 'portable',
                encoding: 'base64',
                token: stateToken
              },
              displayName: 'Ada'
            }
          }
        }
      }
    })
  })

  it('limits legacy untyped auth to Codex and keeps portable credentials when device cards merge', () => {
    const token = Buffer.from('{"refresh_token":"portable"}', 'utf8').toString('base64')
    const filtered = filterRelayConfigPatch({
      adapters: {
        codex: {
          accounts: {
            legacy: { auth: { encoding: 'base64', token } }
          }
        },
        third_party: {
          accounts: {
            unsafe: { auth: { encoding: 'base64', token } },
            devicePrivate: {
              auth: {
                encoding: 'base64',
                portability: 'device-bound',
                storage: 'inline',
                token,
                type: 'third-party-device-credential'
              }
            }
          }
        }
      }
    }, ['adapters'])

    expect(filtered).toEqual({
      adapters: {
        codex: {
          accounts: {
            legacy: {
              auth: {
                encoding: 'base64',
                token,
                type: 'codex-auth-json'
              }
            }
          }
        }
      }
    })

    expect(mergeRelayConfigPatches({
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: { encoding: 'base64', token, type: 'codex-auth-json' }
            }
          }
        }
      }
    }, {
      adapters: {
        'claude-code': {
          accounts: {
            personal: {
              auth: {
                binding: 'device',
                portability: 'device-bound',
                storage: 'device',
                type: 'claude-native-credential-store'
              }
            }
          }
        },
        codex: {
          accounts: {
            work: {
              auth: {
                binding: 'device',
                portability: 'device-bound',
                storage: 'device',
                type: 'codex-device'
              },
              title: 'Synced card'
            }
          }
        }
      }
    })).toEqual({
      adapters: {
        'claude-code': {
          accounts: {
            personal: {
              auth: {
                binding: 'device',
                portability: 'device-bound',
                storage: 'device',
                type: 'claude-native-credential-store'
              }
            }
          }
        },
        codex: {
          accounts: {
            work: {
              auth: { encoding: 'base64', token, type: 'codex-auth-json' },
              title: 'Synced card'
            }
          }
        }
      }
    })
  })

  it('keeps account deletion tombstones until a newer account revision recreates the key', () => {
    expect(filterRelayConfigPatch({
      adapters: {
        codex: { accountTombstones: { deleted: 'generation-deleted', invalid: 20 } }
      }
    }, ['adapters'])).toEqual({
      adapters: {
        codex: { accountTombstones: { deleted: ['generation-deleted'] } }
      }
    })

    expect(mergeRelayConfigPatches({
      adapters: {
        codex: {
          defaultAccount: 'deleted',
          accounts: {
            deleted: { generation: 'generation-deleted', title: 'Old', updatedAt: 999 },
            recreated: { generation: 'generation-new', title: 'New', updatedAt: 30 }
          }
        }
      }
    }, {
      adapters: {
        codex: {
          accountTombstones: {
            deleted: 'generation-deleted',
            recreated: 'generation-old'
          }
        }
      }
    })).toEqual({
      adapters: {
        codex: {
          accounts: {
            recreated: { generation: 'generation-new', title: 'New', updatedAt: 30 }
          },
          accountTombstones: {
            deleted: ['generation-deleted'],
            recreated: ['generation-old']
          }
        }
      }
    })
  })

  it('retains every deleted generation and never mixes credentials across account generations', () => {
    const currentToken = Buffer.from('current-generation').toString('base64')
    const staleToken = Buffer.from('stale-generation').toString('base64')
    const merged = mergeRelayConfigPatches({
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: { encoding: 'base64', token: currentToken, type: 'codex-auth-json' },
              credentialRevision: '1:00000000-0000-0000-0000-000000000001',
              generation: 'generation-two'
            }
          },
          accountTombstones: { work: ['generation-one'] }
        }
      }
    }, {
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: { encoding: 'base64', token: staleToken, type: 'codex-auth-json' },
              credentialRevision: '10:00000000-0000-0000-0000-000000000010',
              generation: 'generation-one'
            }
          },
          accountTombstones: { work: ['generation-one'] }
        }
      }
    })

    expect(merged?.adapters?.codex).toEqual({
      accounts: {
        work: {
          auth: { encoding: 'base64', token: currentToken, type: 'codex-auth-json' },
          credentialRevision: '1:00000000-0000-0000-0000-000000000001',
          generation: 'generation-two'
        }
      },
      accountTombstones: { work: ['generation-one'] }
    })

    expect(
      mergeRelayConfigPatches(merged, {
        adapters: {
          codex: { accountTombstones: { work: ['generation-two'] } }
        }
      })?.adapters?.codex
    ).toEqual({
      accounts: {},
      accountTombstones: { work: ['generation-one', 'generation-two'] }
    })
  })

  it('uses explicit authority for legacy credentials without causal revisions', () => {
    const current = {
      adapters: {
        codex: {
          accounts: {
            work: { auth: { encoding: 'base64', token: 'current', type: 'codex-auth-json' } }
          }
        }
      }
    }
    const stale = {
      adapters: {
        codex: {
          accounts: {
            work: { auth: { encoding: 'base64', token: 'stale', type: 'codex-auth-json' } }
          }
        }
      }
    }

    expect(
      (mergeRelayConfigPatches(current, stale, {
        credentialTieWinner: 'left'
      })?.adapters?.codex as any).accounts.work.auth.token
    ).toBe('current')
    expect(
      (mergeRelayConfigPatches(stale, current, {
        credentialTieWinner: 'right'
      })?.adapters?.codex as any).accounts.work.auth.token
    ).toBe('current')
  })

  it('selects credentials by credential revision instead of config file recency', () => {
    const currentToken = Buffer.from('current-token').toString('base64')
    const staleToken = Buffer.from('stale-token').toString('base64')
    expect(mergeRelayConfigPatches({
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: { encoding: 'base64', token: currentToken, type: 'codex-auth-json' },
              credentialRevision: '2:00000000-0000-0000-0000-000000000002',
              credentialUpdatedAt: 20,
              generation: 'generation-work',
              title: 'Remote current',
              updatedAt: 20
            }
          }
        }
      }
    }, {
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: { encoding: 'base64', token: staleToken, type: 'codex-auth-json' },
              credentialRevision: '1:00000000-0000-0000-0000-000000000001',
              credentialUpdatedAt: 10,
              generation: 'generation-work',
              title: 'Locally refreshed metadata',
              updatedAt: 999
            }
          }
        }
      }
    })).toMatchObject({
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: { token: currentToken },
              credentialRevision: '2:00000000-0000-0000-0000-000000000002',
              title: 'Locally refreshed metadata',
              updatedAt: 999
            }
          }
        }
      }
    })
  })

  it('resolves matching assignments into a merged safe patch', () => {
    const result = resolveRelayConfigPatchForProject(
      {
        version: 'v1',
        assignments: [
          {
            id: 'base',
            allowedFields: ['modelServices'],
            configPatch: {
              defaultModelService: 'relay-base',
              modelServices: {
                'relay-base': {
                  apiBaseUrl: 'https://base.example.com/v1',
                  apiKey: 'base-key'
                }
              },
              permissions: {
                allow: ['Nope']
              }
            }
          },
          {
            id: 'project',
            allowedFields: ['modelServices', 'recommendedModels'],
            configPatch: {
              defaultModelService: 'relay-project',
              modelServices: {
                'relay-project': {
                  apiBaseUrl: 'https://project.example.com/v1',
                  apiKey: 'project-key'
                }
              },
              recommendedModels: [{ model: 'project-model', service: 'relay-project' }]
            },
            project: {
              allow: ['customer-a']
            }
          },
          {
            id: 'disabled',
            configPatch: {
              defaultModelService: 'disabled'
            },
            enabled: false
          },
          {
            id: 'denied',
            configPatch: {
              defaultModelService: 'denied'
            },
            project: {
              deny: ['customer-a']
            }
          }
        ]
      },
      { projectId: 'customer-a' }
    )

    expect(result).toEqual({
      allowedFields: ['modelServices', 'recommendedModels'],
      matchedAssignmentIds: ['base', 'project'],
      patch: {
        modelServices: {
          'relay-base': {
            apiBaseUrl: 'https://base.example.com/v1'
          },
          'relay-project': {
            apiBaseUrl: 'https://project.example.com/v1'
          }
        },
        recommendedModels: [{ model: 'project-model', service: 'relay-project' }]
      }
    })
  })

  it('resolves plugin, marketplace, and skill fields from team profiles', () => {
    const result = resolveRelayConfigPatchForProject(
      {
        version: 'v2',
        assignments: [
          {
            id: 'team-profile',
            allowedFields: ['plugins', 'marketplaces', 'skills', 'skillsMeta', 'skillRegistries'],
            configPatch: {
              env: { SECRET: 'nope' },
              marketplaces: { official: { enabled: true } },
              plugins: { relay: { enabled: true } },
              skillRegistries: ['https://skills.example.com'],
              skills: ['team-skill'],
              skillsMeta: { source: 'team' }
            }
          },
          {
            id: 'team-profile-override',
            allowedFields: ['plugins', 'skills'],
            configPatch: {
              plugins: { github: { enabled: true } },
              skills: ['override-skill']
            }
          }
        ]
      },
      { projectId: 'customer-a' }
    )

    expect(result.patch).toEqual({
      marketplaces: { official: { enabled: true } },
      plugins: {
        github: { enabled: true },
        relay: { enabled: true }
      },
      skillRegistries: ['https://skills.example.com'],
      skills: ['team-skill', 'override-skill'],
      skillsMeta: { source: 'team' }
    })
    expect(JSON.stringify(result.patch)).not.toContain('SECRET')
  })

  it('resolves assignment rule references from snapshot rules', () => {
    const result = resolveRelayConfigPatchForProject(
      {
        version: 'v1',
        assignments: [
          {
            id: 'team-assignment',
            ruleIds: ['team-rule'],
            project: {
              allow: ['workspace-a']
            }
          }
        ],
        rules: [
          {
            id: 'team-rule',
            configPatch: {
              defaultModelService: 'relay-team',
              modelServices: {
                'relay-team': {
                  apiBaseUrl: 'https://team.example.com/v1',
                  apiKey: 'team-key'
                }
              }
            }
          }
        ]
      },
      { workspaceFolder: '/workspaces/workspace-a' }
    )

    expect(result).toMatchObject({
      matchedAssignmentIds: ['team-rule'],
      patch: {
        modelServices: {
          'relay-team': {
            apiBaseUrl: 'https://team.example.com/v1'
          }
        }
      }
    })
  })
})
