/* eslint-disable max-lines -- transactional failure cases share one authoritative service fixture. */

import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PluginMarketplaceUninstallStaleError,
  getPluginMarketplaceUninstallPlan,
  uninstallPluginMarketplacePlugin
} from '#~/services/plugins/marketplace-uninstall.js'

const mocks = vi.hoisted(() => ({
  commitManagedPluginRemoval: vi.fn(),
  getManagedPluginRemovalCompletion: vi.fn(),
  forgetRuntimeMutationState: vi.fn(),
  listManagedPluginInstalls: vi.fn(),
  load: vi.fn(),
  loadConfigState: vi.fn(),
  readConfigFileRevision: vi.fn(),
  recoverManagedPluginRemovals: vi.fn(),
  reload: vi.fn(),
  restoreManagedPluginRemoval: vi.fn(),
  stageManagedPluginRemoval: vi.fn(),
  stat: vi.fn(),
  updateConfigFile: vi.fn(),
  withManagedPluginMutationLock: vi.fn()
}))

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  stat: mocks.stat
}))

vi.mock('@oneworks/config', () => ({
  ConfigFileRevisionConflictError: class ConfigFileRevisionConflictError extends Error {},
  readConfigFileRevision: mocks.readConfigFileRevision,
  updateConfigFile: mocks.updateConfigFile
}))

vi.mock('@oneworks/managed-plugins', () => ({
  commitManagedPluginRemoval: mocks.commitManagedPluginRemoval,
  getManagedPluginRemovalCompletion: mocks.getManagedPluginRemovalCompletion,
  recoverManagedPluginRemovals: mocks.recoverManagedPluginRemovals,
  restoreManagedPluginRemoval: mocks.restoreManagedPluginRemoval,
  stageManagedPluginRemoval: mocks.stageManagedPluginRemoval,
  withManagedPluginMutationLock: mocks.withManagedPluginMutationLock
}))

vi.mock('@oneworks/utils/managed-plugin', () => ({
  getManagedPluginConfigPath: (installDir: string) => `${installDir}/.oneworks-plugin.json`,
  listManagedPluginInstalls: mocks.listManagedPluginInstalls
}))

vi.mock('#~/services/config/index.js', () => ({
  loadConfigState: mocks.loadConfigState
}))

vi.mock('#~/services/plugins/index.js', () => ({
  getPluginManager: () => ({
    forgetRuntimeMutationState: mocks.forgetRuntimeMutationState,
    getRecord: () => currentRecord,
    load: mocks.load,
    reload: mocks.reload
  })
}))

const install = {
  config: {
    version: 1 as const,
    adapter: 'claude',
    installedAt: '2026-07-30T00:00:00.000Z',
    name: 'reviewer',
    scope: 'review',
    source: {
      marketplace: 'team',
      plugin: 'reviewer',
      type: 'marketplace' as const
    },
    nativePluginPath: 'native',
    oneworksPluginPath: 'oneworks'
  },
  installDir: '/managed/claude/team--reviewer/install',
  nativePluginDir: '/managed/claude/team--reviewer/install/native',
  oneworksPluginDir: '/managed/claude/team--reviewer/install/oneworks'
}

const baseState = {
  workspaceFolder: '/workspace',
  mergedConfig: {},
  projectSource: {
    configPath: '/workspace/.oo.config.json',
    rawConfig: {
      plugins: [
        { id: 'sibling-runtime', scope: 'sibling' },
        {
          enabled: false,
          id: install.oneworksPluginDir,
          options: { retainedUntilUninstall: true },
          scope: 'review'
        }
      ],
      marketplaces: {
        team: {
          type: 'claude-code' as const,
          syncOnRun: true,
          options: {
            source: {
              path: '/catalog',
              source: 'directory' as const
            }
          },
          plugins: {
            reviewer: { enabled: true, scope: 'review' },
            sibling: { enabled: true, scope: 'sibling' }
          }
        }
      }
    }
  },
  globalSource: {
    rawConfig: {
      plugins: [{ id: 'global-sibling' }]
    },
    resolvedConfig: {
      plugins: [{ id: 'global-sibling' }]
    }
  },
  userSource: {
    rawConfig: {
      plugins: [{ id: 'user-sibling' }]
    },
    resolvedConfig: {
      plugins: [{ id: 'user-sibling' }]
    }
  }
}

let currentRecord: {
  instance: {
    sourceGroup: 'builtIn' | 'global' | 'localDev' | 'project'
  }
  raw: {
    packageId?: string
    requestId: string
    rootDir: string
    scope?: string
    sourceType: 'directory' | 'package'
  }
} | undefined

const tempDirs: string[] = []

afterEach(async () => {
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { force: true, recursive: true })))
})

const fileRevision = (ino: bigint) => ({
  ctimeNs: '1',
  dev: '1',
  ino: ino.toString(),
  mtimeNs: ino.toString(),
  size: '100'
})

describe('plugin marketplace uninstall service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentRecord = {
      instance: { sourceGroup: 'project' },
      raw: {
        requestId: install.oneworksPluginDir,
        rootDir: install.oneworksPluginDir,
        scope: 'review',
        sourceType: 'directory'
      }
    }
    mocks.loadConfigState.mockResolvedValue(baseState)
    mocks.listManagedPluginInstalls.mockResolvedValue([install])
    mocks.recoverManagedPluginRemovals.mockResolvedValue([])
    mocks.withManagedPluginMutationLock.mockImplementation(
      (_params: unknown, callback: () => Promise<unknown>) => callback()
    )
    mocks.readConfigFileRevision.mockResolvedValue(fileRevision(1n))
    mocks.load.mockResolvedValue(undefined)
    mocks.reload.mockResolvedValue(undefined)
    mocks.updateConfigFile.mockResolvedValue({ configPath: '/workspace/.oo.config.json' })
    mocks.stageManagedPluginRemoval.mockResolvedValue({
      cwd: '/workspace',
      identity: {
        adapter: 'claude',
        installedAt: install.config.installedAt,
        marketplace: 'team',
        name: 'reviewer',
        plugin: 'reviewer',
        scope: 'review'
      },
      operationId: 'a'.repeat(64)
    })
    mocks.commitManagedPluginRemoval.mockResolvedValue(undefined)
    mocks.restoreManagedPluginRemoval.mockResolvedValue(undefined)
    mocks.getManagedPluginRemovalCompletion.mockResolvedValue(undefined)
  })

  it('returns a path-free authoritative plan with exact delete and retain semantics', async () => {
    const plan = await getPluginMarketplaceUninstallPlan('review')

    expect(plan).toEqual({
      available: true,
      deleteItems: [
        'project-marketplace-declaration',
        'project-runtime-override',
        'managed-install'
      ],
      identity: {
        adapter: 'claude',
        marketplace: 'team',
        plugin: 'reviewer',
        scope: 'review'
      },
      retainItems: [
        'global-config',
        'user-config',
        'sibling-plugins',
        'managed-plugin-data',
        'user-data-and-accounts',
        'shared-package-cache'
      ],
      token: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
    expect(JSON.stringify(plan)).not.toContain('/managed/')
    expect(JSON.stringify(plan)).not.toContain('/workspace/')
  })

  it('removes only the exact project declaration and runtime override while retaining siblings', async () => {
    const plan = await getPluginMarketplaceUninstallPlan('review')
    if (!plan.available) throw new Error('Expected available plan')
    await uninstallPluginMarketplacePlugin({ scope: 'review', token: plan.token })

    expect(mocks.updateConfigFile).toHaveBeenCalledWith({
      expectedRevision: fileRevision(1n),
      resolveValue: expect.any(Function),
      workspaceFolder: '/workspace',
      source: 'project',
      section: 'plugins'
    })
    const resolver = mocks.updateConfigFile.mock.calls[0]?.[0]?.resolveValue
    expect(resolver?.(baseState.projectSource.rawConfig)).toEqual({
      plugins: [{ id: 'sibling-runtime', scope: 'sibling' }],
      marketplaces: {
        team: {
          type: 'claude-code',
          syncOnRun: true,
          options: {
            source: {
              path: '/catalog',
              source: 'directory'
            }
          },
          plugins: {
            sibling: { enabled: true, scope: 'sibling' }
          }
        }
      }
    })
    expect(mocks.forgetRuntimeMutationState).toHaveBeenCalledWith('review')
    expect(mocks.commitManagedPluginRemoval).toHaveBeenCalledTimes(1)
    expect(mocks.restoreManagedPluginRemoval).not.toHaveBeenCalled()
    expect(mocks.updateConfigFile).toHaveBeenCalledTimes(1)
    expect(baseState.globalSource.rawConfig).toEqual({
      plugins: [{ id: 'global-sibling' }]
    })
    expect(baseState.userSource.rawConfig).toEqual({
      plugins: [{ id: 'user-sibling' }]
    })
  })

  it('rejects a grant-equivalent stale token when the authoritative file revision changed', async () => {
    const plan = await getPluginMarketplaceUninstallPlan('review')
    if (!plan.available) throw new Error('Expected available plan')
    mocks.readConfigFileRevision.mockResolvedValue(fileRevision(2n))

    await expect(uninstallPluginMarketplacePlugin({
      scope: 'review',
      token: plan.token
    })).rejects.toBeInstanceOf(PluginMarketplaceUninstallStaleError)
    expect(mocks.stageManagedPluginRemoval).not.toHaveBeenCalled()
    expect(mocks.updateConfigFile).not.toHaveBeenCalled()
  })

  it('restores the quarantined install when the config write fails after rename', async () => {
    const plan = await getPluginMarketplaceUninstallPlan('review')
    if (!plan.available) throw new Error('Expected available plan')
    mocks.updateConfigFile.mockRejectedValueOnce(new Error('write failed'))

    await expect(uninstallPluginMarketplacePlugin({
      scope: 'review',
      token: plan.token
    })).rejects.toThrow('write failed')
    expect(mocks.stageManagedPluginRemoval).toHaveBeenCalledTimes(1)
    expect(mocks.restoreManagedPluginRemoval).toHaveBeenCalledTimes(1)
    expect(mocks.reload).not.toHaveBeenCalled()
  })

  it('rolls back a real managed-removal transaction when the service config write faults', async () => {
    const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    const managed = await vi.importActual<typeof import('@oneworks/managed-plugins')>('@oneworks/managed-plugins')
    const managedUtils = await vi.importActual<typeof import('@oneworks/utils/managed-plugin')>(
      '@oneworks/utils/managed-plugin'
    )
    const workspace = await fs.mkdtemp(path.join(tmpdir(), 'ow-uninstall-service-'))
    tempDirs.push(workspace)
    const installDir = managedUtils.getManagedPluginInstallDir(workspace, 'claude', 'team--reviewer', process.env)
    await fs.mkdir(path.join(installDir, 'native'), { recursive: true })
    await fs.mkdir(path.join(installDir, 'oneworks'), { recursive: true })
    await fs.writeFile(path.join(installDir, 'oneworks', 'plugin.json'), '{}\n')
    await fs.writeFile(
      managedUtils.getManagedPluginConfigPath(installDir),
      `${
        JSON.stringify({
          adapter: 'claude',
          installedAt: '2026-07-30T00:00:00.000Z',
          name: 'reviewer',
          nativePluginPath: 'native',
          oneworksPluginPath: 'oneworks',
          scope: 'review',
          source: { marketplace: 'team', plugin: 'reviewer', type: 'marketplace' },
          version: 1
        })
      }\n`
    )
    const realInstall = await managedUtils.readManagedPluginInstall(installDir)
    if (realInstall == null) throw new Error('Expected real managed install')
    const state = {
      ...baseState,
      projectSource: {
        configPath: path.join(workspace, '.oo.config.json'),
        rawConfig: {
          marketplaces: { team: { plugins: { reviewer: { enabled: true, scope: 'review' } }, type: 'claude-code' } },
          plugins: [{ id: realInstall.oneworksPluginDir, scope: 'review' }]
        }
      },
      workspaceFolder: workspace
    }
    currentRecord = {
      instance: { sourceGroup: 'project' },
      raw: {
        requestId: realInstall.oneworksPluginDir,
        rootDir: realInstall.oneworksPluginDir,
        scope: 'review',
        sourceType: 'directory'
      }
    }
    mocks.loadConfigState.mockResolvedValue(state)
    mocks.listManagedPluginInstalls.mockResolvedValue([realInstall])
    mocks.stageManagedPluginRemoval.mockImplementation(managed.stageManagedPluginRemoval)
    mocks.restoreManagedPluginRemoval.mockImplementation(managed.restoreManagedPluginRemoval)
    mocks.updateConfigFile.mockRejectedValueOnce(new Error('injected config fault'))

    const plan = await getPluginMarketplaceUninstallPlan('review')
    if (!plan.available) throw new Error('Expected available plan')
    await expect(uninstallPluginMarketplacePlugin({ scope: 'review', token: plan.token }))
      .rejects.toThrow('injected config fault')
    await expect(fs.stat(realInstall.installDir)).resolves.toBeDefined()
  })

  it('compensates the exact project section when the post-write revision read fails', async () => {
    mocks.readConfigFileRevision.mockReset()
    for (let index = 0; index < 6; index += 1) {
      mocks.readConfigFileRevision.mockResolvedValueOnce(fileRevision(1n))
    }
    mocks.readConfigFileRevision.mockRejectedValueOnce(new Error('revision read failed'))
    const plan = await getPluginMarketplaceUninstallPlan('review')
    if (!plan.available) throw new Error('Expected available plan')

    await expect(uninstallPluginMarketplacePlugin({
      scope: 'review',
      token: plan.token
    })).rejects.toThrow('revision read failed')
    expect(mocks.updateConfigFile).toHaveBeenCalledTimes(2)
    const compensation = mocks.updateConfigFile.mock.calls[1]?.[0]?.resolveValue
    const removedSection = mocks.updateConfigFile.mock.calls[0]?.[0]?.resolveValue(baseState.projectSource.rawConfig)
    expect(compensation?.(removedSection)).toEqual({
      plugins: baseState.projectSource.rawConfig.plugins,
      marketplaces: baseState.projectSource.rawConfig.marketplaces
    })
    expect(mocks.restoreManagedPluginRemoval).toHaveBeenCalledTimes(1)
  })

  it('does not report cleanup failure as success and lets the same token finish idempotently', async () => {
    const plan = await getPluginMarketplaceUninstallPlan('review')
    if (!plan.available) throw new Error('Expected available plan')
    mocks.commitManagedPluginRemoval.mockRejectedValueOnce(new Error('cleanup failed'))

    await expect(uninstallPluginMarketplacePlugin({
      scope: 'review',
      token: plan.token
    })).rejects.toThrow('cleanup failed')
    expect(mocks.restoreManagedPluginRemoval).not.toHaveBeenCalled()

    mocks.recoverManagedPluginRemovals.mockResolvedValueOnce([{
      action: 'cleaned',
      identity: {
        adapter: 'claude',
        installedAt: install.config.installedAt,
        marketplace: 'team',
        name: 'reviewer',
        plugin: 'reviewer',
        scope: 'review'
      },
      operationId: plan.token
    }])
    await expect(uninstallPluginMarketplacePlugin({
      scope: 'review',
      token: plan.token
    })).resolves.toEqual({
      identity: {
        adapter: 'claude',
        marketplace: 'team',
        plugin: 'reviewer',
        scope: 'review'
      },
      removed: true
    })
  })

  it.each([
    ['package-plugin', { packageId: '@oneworks/plugin-logger', sourceType: 'package' as const }, 'project'],
    ['global-plugin', { sourceType: 'directory' as const }, 'global'],
    ['local-plugin', { sourceType: 'directory' as const }, 'localDev']
  ])('returns stable %s unavailable reason', async (reason, raw, sourceGroup) => {
    mocks.listManagedPluginInstalls.mockResolvedValue([])
    currentRecord = {
      instance: { sourceGroup: sourceGroup as 'global' | 'localDev' | 'project' },
      raw: {
        requestId: 'other',
        rootDir: 'other',
        scope: 'review',
        ...raw
      }
    }

    await expect(getPluginMarketplaceUninstallPlan('review')).resolves.toEqual({
      available: false,
      reason
    })
  })

  it('returns stable ambiguity and mismatch reasons without mutating state', async () => {
    mocks.listManagedPluginInstalls.mockResolvedValue([
      install,
      {
        ...install,
        installDir: '/managed/claude/team--reviewer-copy/install',
        nativePluginDir: '/managed/claude/team--reviewer-copy/install/native',
        oneworksPluginDir: '/managed/claude/team--reviewer-copy/install/oneworks'
      }
    ])
    await expect(getPluginMarketplaceUninstallPlan('review')).resolves.toEqual({
      available: false,
      reason: 'ambiguous-managed-install'
    })

    mocks.listManagedPluginInstalls.mockResolvedValue([install])
    currentRecord = {
      instance: { sourceGroup: 'project' },
      raw: {
        requestId: '/different/plugin',
        rootDir: '/different/plugin',
        scope: 'review',
        sourceType: 'directory'
      }
    }
    await expect(getPluginMarketplaceUninstallPlan('review')).resolves.toEqual({
      available: false,
      reason: 'managed-install-mismatch'
    })
    expect(mocks.updateConfigFile).not.toHaveBeenCalled()
  })

  it('refuses to delete an install still referenced by retained global or user sources', async () => {
    mocks.loadConfigState.mockResolvedValue({
      ...baseState,
      globalSource: {
        ...baseState.globalSource,
        resolvedConfig: {
          marketplaces: {
            team: {
              type: 'claude-code',
              plugins: {
                reviewer: { enabled: true, scope: 'review' }
              }
            }
          }
        }
      }
    })

    await expect(getPluginMarketplaceUninstallPlan('review')).resolves.toEqual({
      available: false,
      reason: 'source-conflict'
    })
    expect(mocks.stageManagedPluginRemoval).not.toHaveBeenCalled()
    expect(mocks.updateConfigFile).not.toHaveBeenCalled()
  })

  it('refuses a retained runtime reference to the same install even with a different scope', async () => {
    mocks.loadConfigState.mockResolvedValue({
      ...baseState,
      userSource: {
        ...baseState.userSource,
        resolvedConfig: {
          plugins: [{ id: install.oneworksPluginDir, scope: 'other-scope' }]
        }
      }
    })

    await expect(getPluginMarketplaceUninstallPlan('review')).resolves.toEqual({
      available: false,
      reason: 'source-conflict'
    })
  })

  it('refuses a project runtime reference to the same install with a different scope', async () => {
    mocks.loadConfigState.mockResolvedValue({
      ...baseState,
      projectSource: {
        ...baseState.projectSource,
        rawConfig: {
          ...baseState.projectSource.rawConfig,
          plugins: [
            ...baseState.projectSource.rawConfig.plugins,
            { id: install.oneworksPluginDir, scope: 'other-scope' }
          ]
        }
      }
    })

    await expect(getPluginMarketplaceUninstallPlan('review')).resolves.toEqual({
      available: false,
      reason: 'source-conflict'
    })
  })

  it('returns a completion receipt for a same-token replay after a lost response', async () => {
    mocks.getManagedPluginRemovalCompletion.mockResolvedValue({
      completedAt: '2026-07-30T00:00:01.000Z',
      identity: {
        adapter: 'claude',
        installedAt: install.config.installedAt,
        marketplace: 'team',
        name: 'reviewer',
        plugin: 'reviewer',
        scope: 'review'
      },
      operationId: 'a'.repeat(64),
      version: 1
    })

    await expect(uninstallPluginMarketplacePlugin({
      scope: 'review',
      token: 'a'.repeat(64)
    })).resolves.toEqual({
      identity: {
        adapter: 'claude',
        marketplace: 'team',
        plugin: 'reviewer',
        scope: 'review'
      },
      removed: true
    })
    expect(mocks.stageManagedPluginRemoval).not.toHaveBeenCalled()
  })
})
