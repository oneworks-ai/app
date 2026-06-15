import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'
import { afterEach, describe, expect, it } from 'vitest'

import packageJson from '../package.json'
import { resolveConfig } from '../src/config.js'
import { createRelayConfigSnapshotStore } from '../src/shared/config-cache.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const createContext = (workspaceFolder: string, env: Record<string, string>) => ({
  cwd: workspaceFolder,
  env,
  jsonVariables: {
    WORKSPACE_FOLDER: workspaceFolder,
    __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceFolder
  },
  mergedConfig: {},
  plugin: {
    options: {}
  },
  projectConfig: undefined,
  userConfig: undefined
})

describe('relay config hook', () => {
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
    await snapshotStore.writeSnapshot({
      assignments: [
        {
          id: 'customer-a',
          allowedFields: ['modelServices', 'defaultModelService', 'recommendedModels'],
          configPatch: {
            defaultModelService: 'relay',
            mcpServers: {
              unsafe: {}
            },
            modelServices: {
              relay: {
                apiBaseUrl: 'https://relay.example/v1',
                apiKey: 'relay-key',
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
          }
        }
      ],
      hash: 'hash-1',
      lastError: null,
      lastSyncedAt: '2026-06-15T00:00:00.000Z',
      sourceServerId: 'prod',
      version: 'v1'
    })

    await expect(resolveConfig(createContext(workspaceFolder, env) as never)).resolves.toEqual({
      defaultModelService: 'relay',
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
