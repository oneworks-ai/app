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
        plugins: [{ id: 'unexpected' }],
        recommendedModels: [{ model: 'relay-model' }]
      },
      ['modelServices', 'recommendedModels']
    )).toEqual({
      modelServices: {
        relay: {
          apiBaseUrl: 'https://relay.example.com/v1',
          apiKey: 'secret'
        }
      },
      recommendedModels: [{ model: 'relay-model' }]
    })
  })

  it('resolves matching assignments into a merged safe patch', () => {
    const result = resolveRelayConfigPatchForProject(
      {
        version: 'v1',
        assignments: [
          {
            id: 'base',
            allowedFields: ['modelServices', 'defaultModelService'],
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
      allowedFields: ['modelServices', 'defaultModelService', 'recommendedModels'],
      matchedAssignmentIds: ['base', 'project'],
      patch: {
        defaultModelService: 'relay-base',
        modelServices: {
          'relay-base': {
            apiBaseUrl: 'https://base.example.com/v1',
            apiKey: 'base-key'
          },
          'relay-project': {
            apiBaseUrl: 'https://project.example.com/v1',
            apiKey: 'project-key'
          }
        },
        recommendedModels: [{ model: 'project-model', service: 'relay-project' }]
      }
    })
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
        defaultModelService: 'relay-team',
        modelServices: {
          'relay-team': {
            apiBaseUrl: 'https://team.example.com/v1',
            apiKey: 'team-key'
          }
        }
      }
    })
  })
})
