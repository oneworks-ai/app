import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  importWorktreeEnvironmentsFromAdapter,
  listWorktreeEnvironmentImporters
} from '#~/services/worktree-environment-import.js'

const mocks = vi.hoisted(() => ({
  composeWorkspaceConfigSchemaBundle: vi.fn(),
  createWorktreeEnvironmentIfAbsent: vi.fn(),
  discover: vi.fn(),
  loadConfigState: vi.fn(),
  tryLoadAdapterWorktreeEnvironmentImportCapability: vi.fn()
}))

vi.mock('@oneworks/config', async importOriginal => ({
  ...await importOriginal<typeof import('@oneworks/config')>(),
  composeWorkspaceConfigSchemaBundle: mocks.composeWorkspaceConfigSchemaBundle
}))

vi.mock('@oneworks/types', async importOriginal => ({
  ...await importOriginal<typeof import('@oneworks/types')>(),
  tryLoadAdapterWorktreeEnvironmentImportCapability: mocks.tryLoadAdapterWorktreeEnvironmentImportCapability
}))

vi.mock('#~/services/config/index.js', () => ({
  loadConfigState: mocks.loadConfigState
}))

vi.mock('#~/services/worktree-environments.js', async importOriginal => ({
  ...await importOriginal<typeof import('#~/services/worktree-environments.js')>(),
  createWorktreeEnvironmentIfAbsent: mocks.createWorktreeEnvironmentIfAbsent
}))

describe('worktree environment adapter import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.composeWorkspaceConfigSchemaBundle.mockResolvedValue({
      extensions: { adapters: ['codex'] }
    })
    mocks.loadConfigState.mockResolvedValue({
      mergedConfig: { adapters: {}, defaultAdapter: 'codex' },
      workspaceFolder: '/workspace'
    })
    mocks.tryLoadAdapterWorktreeEnvironmentImportCapability.mockImplementation(async (specifier: string) => (
      specifier === 'codex'
        ? {
          descriptor: {
            title: 'Codex environments',
            description: 'Codex local environment files',
            supportedSources: ['project', 'user']
          },
          discover: mocks.discover
        }
        : undefined
    ))
    mocks.createWorktreeEnvironmentIfAbsent.mockImplementation(async ({ id }) => ({
      created: true,
      environmentId: id
    }))
  })

  it('lists only adapter packages that expose the environment import capability', async () => {
    await expect(listWorktreeEnvironmentImporters()).resolves.toEqual({
      importers: [{
        adapterKey: 'codex',
        description: 'Codex local environment files',
        runtimeAdapter: 'codex',
        supportedSources: ['project', 'user'],
        title: 'Codex environments'
      }]
    })
  })

  it('persists validated candidates without returning scripts, native ids, or paths', async () => {
    mocks.discover.mockResolvedValue({
      found: true,
      skippedActionCount: 2,
      skippedEnvironmentCount: 1,
      environments: [{
        displayName: 'Node',
        scripts: { create: 'export TOKEN="secret-native"' },
        sourceId: 'environment.toml',
        suggestedId: 'node',
        warnings: ['shell_compatibility_unverified']
      }]
    })

    const result = await importWorktreeEnvironmentsFromAdapter({
      adapterKey: 'codex',
      source: 'user'
    })

    expect(result).toEqual({
      adapterKey: 'codex',
      environmentCount: 1,
      existingEnvironmentIds: [],
      found: true,
      importedEnvironmentIds: ['node'],
      skippedActionCount: 2,
      skippedEnvironmentCount: 1,
      source: 'user',
      warningCount: 1
    })
    expect(mocks.discover).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/workspace',
      source: 'user'
    }))
    expect(mocks.createWorktreeEnvironmentIfAbsent).toHaveBeenCalledWith({
      id: 'node',
      scripts: { create: 'export TOKEN="secret-native"' },
      source: 'user',
      workspaceFolder: '/workspace'
    })
    expect(JSON.stringify(result)).not.toContain('secret-native')
    expect(JSON.stringify(result)).not.toContain('environment.toml')
    expect(JSON.stringify(result)).not.toContain('/workspace')
  })

  it('reports existing ids without merging or overwriting them', async () => {
    mocks.discover.mockResolvedValue({
      found: true,
      skippedActionCount: 0,
      skippedEnvironmentCount: 0,
      environments: [{
        scripts: { create: 'printf "native\\n"' },
        sourceId: 'environment.toml',
        suggestedId: 'existing',
        warnings: []
      }]
    })
    mocks.createWorktreeEnvironmentIfAbsent.mockResolvedValue({
      created: false,
      environmentId: 'existing'
    })

    await expect(importWorktreeEnvironmentsFromAdapter({
      adapterKey: 'codex',
      source: 'project'
    })).resolves.toMatchObject({
      existingEnvironmentIds: ['existing'],
      importedEnvironmentIds: []
    })
  })

  it('canonicalizes the local presentation suffix before project writes', async () => {
    mocks.discover.mockResolvedValue({
      found: true,
      skippedActionCount: 0,
      skippedEnvironmentCount: 0,
      environments: [{
        scripts: { create: 'valid' },
        sourceId: 'environment.toml',
        suggestedId: 'node.local',
        warnings: []
      }]
    })

    await expect(importWorktreeEnvironmentsFromAdapter({
      adapterKey: 'codex',
      source: 'project'
    })).resolves.toMatchObject({ importedEnvironmentIds: ['node'] })
    expect(mocks.createWorktreeEnvironmentIfAbsent).toHaveBeenCalledWith(expect.objectContaining({
      id: 'node',
      source: 'project'
    }))
  })

  it('rejects duplicate canonical ids before writing any environment', async () => {
    mocks.discover.mockResolvedValue({
      found: true,
      skippedActionCount: 0,
      skippedEnvironmentCount: 0,
      environments: [
        {
          scripts: { create: 'first' },
          sourceId: 'environment.toml',
          suggestedId: 'node',
          warnings: []
        },
        {
          scripts: { create: 'second' },
          sourceId: 'environment-1.toml',
          suggestedId: 'node.local',
          warnings: []
        }
      ]
    })

    await expect(importWorktreeEnvironmentsFromAdapter({
      adapterKey: 'codex',
      source: 'user'
    })).rejects.toMatchObject({ code: 'invalid_worktree_environment_import_result' })
    expect(mocks.createWorktreeEnvironmentIfAbsent).not.toHaveBeenCalled()
  })

  it('rejects global and malformed discovery results before writing', async () => {
    await expect(importWorktreeEnvironmentsFromAdapter({
      adapterKey: 'codex',
      source: 'global'
    })).rejects.toMatchObject({ code: 'invalid_import_source' })

    mocks.discover.mockResolvedValue({
      found: true,
      skippedActionCount: 0,
      skippedEnvironmentCount: 0,
      environments: [{
        scripts: { create: 'valid', unknown: 'unsafe' },
        sourceId: 'environment.toml',
        suggestedId: '../escape',
        warnings: []
      }]
    })
    await expect(importWorktreeEnvironmentsFromAdapter({
      adapterKey: 'codex',
      source: 'project'
    })).rejects.toMatchObject({ code: 'invalid_worktree_environment_import_result' })
    expect(mocks.createWorktreeEnvironmentIfAbsent).not.toHaveBeenCalled()
  })
})
