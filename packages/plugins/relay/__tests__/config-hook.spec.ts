import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'
import { afterEach, describe, expect, it } from 'vitest'

import packageJson from '../package.json'
import { readRelayGitRepositoryIdentities, resolveConfig } from '../src/config.js'
import { createRelayDeviceStore } from '../src/server/store.js'
import { createRelayConfigSnapshotStore, createRelayGlobalConfigSnapshotStore } from '../src/shared/config-cache.js'
import { encryptRelayConfigSnapshotSecretEnvelope } from '../src/shared/config-secrets.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const createContext = (
  workspaceFolder: string,
  env: Record<string, string>,
  systemPrompt?: string
) => ({
  cwd: workspaceFolder,
  env,
  jsonVariables: {
    WORKSPACE_FOLDER: workspaceFolder,
    __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceFolder
  },
  mergedConfig: systemPrompt == null ? {} : { systemPrompt },
  plugin: {
    options: {}
  },
  projectConfig: undefined,
  userConfig: undefined
})

describe('relay config hook', () => {
  it('matches project assignments from the workspace Git remote', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-relay-config-hook-git-remote-'))
    tempDirs.push(root)
    const workspaceFolder = join(root, 'workspace-git-remote')
    const home = join(root, 'home')
    const env = {
      __ONEWORKS_PROJECT_REAL_HOME__: home,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceFolder
    }
    await mkdir(workspaceFolder, { recursive: true })
    execFileSync('git', ['init', workspaceFolder], { stdio: 'ignore' })
    execFileSync(
      'git',
      ['-C', workspaceFolder, 'remote', 'add', 'origin', 'git@github.com:oneworks-ai/app.git'],
      { stdio: 'ignore' }
    )
    await expect(readRelayGitRepositoryIdentities(workspaceFolder)).resolves.toEqual([
      'github.com/oneworks-ai/app'
    ])
    const projectHome = resolveProjectHomePath(workspaceFolder, env)
    await createRelayConfigSnapshotStore(projectHome).writeSnapshot({
      assignments: [{
        allowedFields: ['skills'],
        configPatch: { skills: ['git-remote-skill'] },
        id: 'git-remote-assignment',
        project: { allow: ['github.com/oneworks-ai/app'] }
      }],
      lastError: null,
      lastSyncedAt: '2026-07-10T00:00:00.000Z',
      version: 'v1'
    })

    await expect(resolveConfig(createContext(workspaceFolder, env) as never)).resolves.toEqual({
      skills: ['git-remote-skill']
    })
    await expect(createRelayConfigSnapshotStore(projectHome).readSnapshot()).resolves.toMatchObject({
      matchedProject: true
    })
  })

  it('returns safe config fields from the local snapshot for matching projects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-relay-config-hook-'))
    tempDirs.push(root)
    const workspaceFolder = join(root, 'workspace-a')
    const home = join(root, 'home')
    const env = {
      __ONEWORKS_PROJECT_REAL_HOME__: home,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceFolder
    }
    const projectHome = resolveProjectHomePath(workspaceFolder, env)
    const snapshotStore = createRelayConfigSnapshotStore(projectHome)
    await createRelayDeviceStore(projectHome).writeStore({
      deviceId: 'device-1',
      deviceName: 'Device 1',
      deviceSecret: 'device-secret',
      servers: {
        prod: {
          deviceToken: 'device-token',
          id: 'prod',
          remoteBaseUrl: 'https://relay.example'
        }
      }
    })
    await snapshotStore.writeSnapshot({
      assignments: [
        {
          id: 'customer-a',
          allowedFields: ['modelServices', 'recommendedModels'],
          configPatch: {
            defaultModelService: 'relay',
            mcpServers: {
              unsafe: {}
            },
            modelServices: {
              relay: {
                apiBaseUrl: 'https://relay.example/v1',
                models: ['relay-model']
              }
            },
            permissions: {
              allow: ['Shell(*)']
            },
            recommendedModels: [
              {
                model: 'relay-model',
                service: 'relay'
              }
            ]
          },
          project: {
            allow: [basename(workspaceFolder)]
          },
          secrets: [
            encryptRelayConfigSnapshotSecretEnvelope({
              deviceToken: 'device-token',
              expiresAt: '2999-01-01T00:00:00.000Z',
              plaintext: 'relay-key',
              recipientDeviceId: 'device-1',
              ref: 'modelServices.relay.apiKey',
              secretId: 'secret-1',
              secretVersion: 1
            })
          ]
        }
      ],
      hash: 'hash-1',
      lastError: null,
      lastSyncedAt: '2026-06-15T00:00:00.000Z',
      sourceServerId: 'prod',
      version: 'v1'
    })

    await expect(resolveConfig(createContext(workspaceFolder, env) as never)).resolves.toEqual({
      modelServices: {
        relay: {
          apiBaseUrl: 'https://relay.example/v1',
          apiKey: 'relay-key',
          models: ['relay-model']
        }
      },
      recommendedModels: [
        {
          model: 'relay-model',
          service: 'relay'
        }
      ]
    })
    await expect(snapshotStore.readSnapshot()).resolves.toMatchObject({
      lastAppliedAt: expect.any(String),
      matchedProject: true
    })
    expect(JSON.stringify(await snapshotStore.readSnapshot())).not.toContain('relay-key')
  })

  it('guides matched projects to their independent synced document directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-relay-config-hook-project-docs-'))
    tempDirs.push(root)
    const workspaceFolder = join(root, 'workspace-project-docs')
    const home = join(root, 'home')
    const env = {
      __ONEWORKS_PROJECT_REAL_HOME__: home,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceFolder
    }
    const projectHome = resolveProjectHomePath(workspaceFolder, env)
    const documentDirectory = join(
      home,
      '.oo/teams/team-1/project-rules/assignment-1'
    )
    await mkdir(join(documentDirectory, 'rules'), { recursive: true })
    await writeFile(join(documentDirectory, 'AGENTS.md'), '# Project Rule Guide\n', 'utf8')
    await writeFile(join(documentDirectory, 'rules/review.md'), '# Review Rules\n', 'utf8')
    await createRelayConfigSnapshotStore(projectHome).writeSnapshot({
      assignments: [{
        allowedFields: ['skills'],
        configPatch: { skills: ['project-skill'] },
        id: 'assignment-1',
        project: { allow: [basename(workspaceFolder)] },
        provenance: {
          assignmentId: 'assignment-1',
          fields: ['skills'],
          mode: 'default',
          profileId: 'profile-1',
          profileName: 'Base Profile',
          teamId: 'team-1',
          teamName: 'Team One',
          version: 1,
          versionId: 'version-1'
        }
      }],
      lastError: null,
      lastSyncedAt: '2026-07-10T00:00:00.000Z',
      version: 'v1'
    })

    const config = await resolveConfig(
      createContext(workspaceFolder, env, 'Keep the existing prompt.') as never
    )

    expect(config).toMatchObject({ skills: ['project-skill'] })
    expect(config?.systemPrompt).toContain('Keep the existing prompt.')
    expect(config?.systemPrompt).toContain(
      '~/.oo/teams/team-1/project-rules/assignment-1/AGENTS.md'
    )
    expect(config?.systemPrompt).toContain(
      '~/.oo/teams/team-1/project-rules/assignment-1/rules/'
    )
  })

  it('ignores Codex adapter accounts from relay-managed team snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-relay-config-hook-codex-'))
    tempDirs.push(root)
    const workspaceFolder = join(root, 'workspace-codex')
    const home = join(root, 'home')
    const env = {
      __ONEWORKS_PROJECT_REAL_HOME__: home,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceFolder
    }
    const projectHome = resolveProjectHomePath(workspaceFolder, env)
    const token = Buffer.from('{"auth_mode":"chatgpt"}\n', 'utf8').toString('base64')
    await createRelayGlobalConfigSnapshotStore(env).writeSnapshot({
      assignments: [
        {
          allowedFields: ['adapters'],
          configPatch: {
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
          },
          id: 'codex'
        }
      ],
      lastError: null,
      lastSyncedAt: '2026-06-15T00:00:00.000Z',
      version: 'v1'
    })

    await expect(resolveConfig(createContext(workspaceFolder, env) as never)).resolves.toBeUndefined()
    await expect(createRelayConfigSnapshotStore(projectHome).readSnapshot()).resolves.toMatchObject({
      lastAppliedAt: null,
      matchedProject: false
    })
  })

  it('composes model service overlays while ignoring adapter accounts from team snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-relay-config-hook-team-overlay-'))
    tempDirs.push(root)
    const workspaceFolder = join(root, 'workspace-team-overlay')
    const home = join(root, 'home')
    const env = {
      __ONEWORKS_PROJECT_REAL_HOME__: home,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceFolder
    }
    const projectHome = resolveProjectHomePath(workspaceFolder, env)
    const token = Buffer.from('{"auth_mode":"chatgpt","account_id":"acct_personal"}\n', 'utf8').toString('base64')
    const globalStore = createRelayGlobalConfigSnapshotStore(env)
    await globalStore.writeSnapshot({
      assignments: [
        {
          allowedFields: ['adapters', 'modelServices'],
          configPatch: {
            adapters: {
              codex: {
                accounts: {
                  personal: {
                    auth: {
                      encoding: 'base64',
                      token,
                      type: 'codex-auth-json'
                    },
                    email: 'personal@example.com'
                  }
                }
              }
            },
            defaultModelService: 'personal-model',
            modelServices: {
              personal: {
                apiBaseUrl: 'https://personal.example.com/v1'
              }
            }
          },
          id: 'personal-global'
        },
        {
          allowedFields: ['modelServices', 'recommendedModels'],
          configPatch: {
            defaultModelService: 'team-model',
            modelServices: {
              team: {
                apiBaseUrl: 'https://team.example.com/v1',
                models: ['team-model']
              }
            },
            recommendedModels: [
              {
                model: 'team-model',
                service: 'team'
              }
            ]
          },
          id: 'team-overlay',
          provenance: {
            assignmentId: 'team-overlay',
            fields: ['modelServices', 'recommendedModels'],
            mode: 'default',
            profileId: 'team-profile',
            profileName: 'Team Shared Models',
            teamId: 'team-1',
            teamName: 'Team One',
            version: 1,
            versionId: 'team-version-1'
          }
        }
      ],
      hash: 'hash-team-overlay',
      lastError: null,
      lastSyncedAt: '2026-06-15T00:00:00.000Z',
      version: 'v-team-overlay'
    })

    await expect(resolveConfig(createContext(workspaceFolder, env) as never)).resolves.toEqual({
      modelServices: {
        personal: {
          apiBaseUrl: 'https://personal.example.com/v1'
        },
        team: {
          apiBaseUrl: 'https://team.example.com/v1',
          models: ['team-model']
        }
      },
      recommendedModels: [
        {
          model: 'team-model',
          service: 'team'
        }
      ]
    })
    await expect(globalStore.readSnapshot()).resolves.toMatchObject({
      lastAppliedAt: null,
      matchedProject: null
    })
    await expect(createRelayConfigSnapshotStore(projectHome).readSnapshot()).resolves.toMatchObject({
      lastAppliedAt: expect.any(String),
      matchedProject: true
    })
  })

  it('returns undefined when there is no cache or the project is denied', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-relay-config-hook-denied-'))
    tempDirs.push(root)
    const workspaceFolder = join(root, 'workspace-denied')
    const home = join(root, 'home')
    const env = {
      __ONEWORKS_PROJECT_REAL_HOME__: home,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceFolder
    }
    const projectHome = resolveProjectHomePath(workspaceFolder, env)

    await expect(resolveConfig(createContext(workspaceFolder, env) as never)).resolves.toBeUndefined()

    const snapshotStore = createRelayConfigSnapshotStore(projectHome)
    await snapshotStore.writeSnapshot({
      assignments: [
        {
          id: 'denied',
          configPatch: {
            defaultModelService: 'relay'
          },
          project: {
            deny: [basename(workspaceFolder)]
          }
        }
      ],
      lastError: null,
      lastSyncedAt: '2026-06-15T00:00:00.000Z',
      version: 'v1'
    })

    await expect(resolveConfig(createContext(workspaceFolder, env) as never)).resolves.toBeUndefined()
    await expect(snapshotStore.readSnapshot()).resolves.toMatchObject({
      lastAppliedAt: null,
      matchedProject: false
    })
  })

  it('skips locally disabled team config profiles when resolving config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-relay-config-hook-disabled-source-'))
    tempDirs.push(root)
    const workspaceFolder = join(root, 'workspace-disabled-source')
    const home = join(root, 'home')
    const env = {
      __ONEWORKS_PROJECT_REAL_HOME__: home,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceFolder
    }
    const projectHome = resolveProjectHomePath(workspaceFolder, env)
    await createRelayDeviceStore(projectHome).writeStore({
      deviceId: 'device-1',
      deviceName: 'Device 1',
      deviceSecret: 'device-secret',
      servers: {
        prod: {
          configDisabledSources: {
            assignmentIds: [],
            profileIds: ['profile-disabled'],
            teamIds: []
          },
          deviceToken: 'device-token',
          id: 'prod',
          remoteBaseUrl: 'https://relay.example'
        }
      }
    })
    const snapshotStore = createRelayConfigSnapshotStore(projectHome)
    await snapshotStore.writeSnapshot({
      assignments: [
        {
          id: 'assignment-disabled',
          allowedFields: ['modelServices'],
          configPatch: {
            modelServices: {
              relay: {
                apiBaseUrl: 'https://relay.example/v1'
              }
            }
          },
          provenance: {
            assignmentId: 'assignment-disabled',
            fields: ['modelServices'],
            mode: 'default',
            profileId: 'profile-disabled',
            profileName: 'Disabled Profile',
            teamId: 'team-1',
            teamName: 'Team One',
            version: 1,
            versionId: 'version-disabled'
          }
        }
      ],
      hash: 'hash-disabled',
      lastError: null,
      lastSyncedAt: '2026-06-15T00:00:00.000Z',
      sourceServerId: 'prod',
      version: 'v-disabled'
    })

    await expect(resolveConfig(createContext(workspaceFolder, env) as never)).resolves.toBeUndefined()
    await expect(snapshotStore.readSnapshot()).resolves.toMatchObject({
      matchedProject: false
    })
  })

  it('declares the real package config export and config hook entry', () => {
    expect(packageJson.configHook).toEqual({
      entry: './dist/config.cjs'
    })
    expect(packageJson.exports['./config']).toMatchObject({
      __oneworks__: {
        import: './src/config.ts',
        require: './src/config.cts'
      },
      default: {
        import: './dist/config.js',
        require: './dist/config.cjs'
      }
    })
  })
})
