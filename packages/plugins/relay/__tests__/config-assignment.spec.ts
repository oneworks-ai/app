import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import {
  filterRelayConfigPatch,
  matchesRelayConfigProject,
  resolveRelayConfigPatchForProject
} from '../src/shared/config-assignment.js'

describe('relay config assignment', () => {
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
          apiBaseUrl: 'https://relay.example.com/v1'
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

  it('preserves base64 Codex auth payloads while sanitizing unrelated adapter secrets', () => {
    const token = Buffer.from('{"auth_mode":"chatgpt"}\n', 'utf8').toString('base64')

    expect(filterRelayConfigPatch(
      {
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
          accounts: {
            work: {
              auth: {
                encoding: 'base64',
                token,
                type: 'codex-auth-json'
              },
              title: 'Work'
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
