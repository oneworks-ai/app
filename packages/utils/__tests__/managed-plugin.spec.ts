import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getManagedPluginInstallDir,
  listManagedPluginInstalls,
  resolveManagedNpmRegistryAuthority,
  resolveManagedPluginInstallIdentity,
  resolveManagedPluginPublicPackageId,
  resolveManagedPluginScope
} from '#~/managed-plugin.js'

const tempDirs: string[] = []

const createManagedPluginWorkspace = async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-plugin-'))
  tempDirs.push(workspace)
  return {
    env: {
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: join(workspace, '.project-homes')
    },
    workspace
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('listManagedPluginInstalls', () => {
  it('canonicalizes safe npm registries and rejects credential-bearing authorities', () => {
    expect(resolveManagedNpmRegistryAuthority()).toBe('https://registry.npmjs.org')
    expect(resolveManagedNpmRegistryAuthority('https://REGISTRY.npmjs.org///'))
      .toBe('https://registry.npmjs.org')
    expect(() => resolveManagedNpmRegistryAuthority('https://user:secret@registry.example.test'))
      .toThrow(/credentials/i)
    expect(() => resolveManagedNpmRegistryAuthority('https://registry.example.test?token=secret'))
      .toThrow(/query/i)
    expect(() => resolveManagedNpmRegistryAuthority('https://registry.example.test/%E0%A4%A'))
      .toThrow(/malformed encoding/i)

    const identity = (registry?: string) =>
      resolveManagedPluginInstallIdentity({
        adapter: 'codex',
        name: 'docs',
        source: { registry, spec: 'docs@2.0.0', type: 'npm' }
      })
    expect(identity()).toBe(identity('https://registry.npmjs.org/'))
    expect(identity('https://registry.example.test')).not.toBe(identity('https://other.example.test'))
  })

  it('hashes unsafe npm selectors without returning them in public identity or scope labels', () => {
    for (
      const spec of [
        'docs@file:///data/private?token=secret',
        'docs@1.0.0/../../data/private',
        'docs@%2Fdata%2Fprivate',
        'docs@%E0%A4%A%2Fdata%2Fprivate'
      ]
    ) {
      const source = { spec, type: 'npm' as const }
      const scope = resolveManagedPluginScope({ adapter: 'codex', name: 'Bearer secret', source })
      const packageId = resolveManagedPluginPublicPackageId({ adapter: 'codex', name: 'Bearer secret', source })

      expect(scope).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/u)
      expect(scope).not.toContain('token')
      expect(scope).not.toContain('data')
      expect(packageId).toMatch(/^npm:plugin-[a-f0-9]{24}$/u)
      expect(packageId).not.toContain('secret')
      expect(packageId).not.toContain('data')
    }
  })

  it('keeps valid installs when another managed plugin config is invalid', async () => {
    const { env, workspace } = await createManagedPluginWorkspace()

    const goodInstallDir = getManagedPluginInstallDir(workspace, 'claude', 'good', env)
    await mkdir(goodInstallDir, { recursive: true })
    await writeFile(
      join(goodInstallDir, '.oneworks-plugin.json'),
      JSON.stringify(
        {
          version: 1,
          adapter: 'claude',
          name: 'good',
          installedAt: new Date().toISOString(),
          source: {
            type: 'path',
            path: './good'
          },
          nativePluginPath: 'native',
          oneworksPluginPath: 'oneworks'
        },
        null,
        2
      )
    )

    const badInstallDir = getManagedPluginInstallDir(workspace, 'claude', 'bad', env)
    await mkdir(badInstallDir, { recursive: true })
    await writeFile(
      join(badInstallDir, '.oneworks-plugin.json'),
      JSON.stringify(
        {
          version: 1,
          adapter: 'claude',
          name: '',
          installedAt: new Date().toISOString(),
          source: {
            type: 'path',
            path: './bad'
          },
          nativePluginPath: 'native',
          oneworksPluginPath: 'oneworks'
        },
        null,
        2
      )
    )

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const installs = await listManagedPluginInstalls(workspace, { env })

    expect(installs.map(install => install.config.name)).toEqual(['good'])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('skips installs whose managed paths escape the install directory', async () => {
    const { env, workspace } = await createManagedPluginWorkspace()

    const escapedInstallDir = getManagedPluginInstallDir(workspace, 'claude', 'escaped', env)
    await mkdir(escapedInstallDir, { recursive: true })
    await writeFile(
      join(escapedInstallDir, '.oneworks-plugin.json'),
      JSON.stringify(
        {
          version: 1,
          adapter: 'claude',
          name: 'escaped',
          installedAt: new Date().toISOString(),
          source: {
            type: 'path',
            path: './escaped'
          },
          nativePluginPath: '../../outside',
          oneworksPluginPath: 'oneworks'
        },
        null,
        2
      )
    )

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const installs = await listManagedPluginInstalls(workspace, { env })

    expect(installs).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toBe(
      'Skipping a managed plugin install because its metadata is invalid.'
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain(workspace)
  })

  it('accepts marketplace-backed managed plugin installs', async () => {
    const { env, workspace } = await createManagedPluginWorkspace()

    const reviewerInstallDir = getManagedPluginInstallDir(workspace, 'claude', 'reviewer', env)
    await mkdir(join(reviewerInstallDir, 'native'), { recursive: true })
    await mkdir(join(reviewerInstallDir, 'oneworks'), { recursive: true })
    await writeFile(
      join(reviewerInstallDir, '.oneworks-plugin.json'),
      JSON.stringify(
        {
          version: 1,
          adapter: 'claude',
          name: 'reviewer',
          installedAt: new Date().toISOString(),
          source: {
            type: 'marketplace',
            marketplace: 'team-tools',
            plugin: 'reviewer'
          },
          nativePluginPath: 'native',
          oneworksPluginPath: 'oneworks'
        },
        null,
        2
      )
    )

    const installs = await listManagedPluginInstalls(workspace, { env })

    expect(installs).toHaveLength(1)
    expect(installs[0]?.config.source).toEqual({
      type: 'marketplace',
      marketplace: 'team-tools',
      plugin: 'reviewer'
    })
  })

  it('accepts managed plugin installs for non-claude adapters', async () => {
    const { env, workspace } = await createManagedPluginWorkspace()

    const helperInstallDir = getManagedPluginInstallDir(workspace, 'codex', 'codex-helper', env)
    await mkdir(join(helperInstallDir, 'native'), { recursive: true })
    await mkdir(join(helperInstallDir, 'oneworks'), { recursive: true })
    await writeFile(
      join(helperInstallDir, '.oneworks-plugin.json'),
      JSON.stringify(
        {
          version: 1,
          adapter: 'codex',
          name: 'codex-helper',
          installedAt: new Date().toISOString(),
          source: {
            type: 'npm',
            spec: '@acme/codex-helper'
          },
          nativePluginPath: 'native',
          oneworksPluginPath: 'oneworks'
        },
        null,
        2
      )
    )

    const installs = await listManagedPluginInstalls(workspace, { adapter: 'codex', env })

    expect(installs).toHaveLength(1)
    expect(installs[0]?.config.adapter).toBe('codex')
  })

  it('migrates only the invalid legacy name-default scope and rejects other invalid explicit scopes', async () => {
    const { env, workspace } = await createManagedPluginWorkspace()
    const source = {
      marketplace: 'Team Marketplace',
      plugin: '@scope/Docs Plugin',
      type: 'marketplace' as const
    }
    const legacyInstallDir = getManagedPluginInstallDir(workspace, 'codex', 'legacy', env)
    const invalidInstallDir = getManagedPluginInstallDir(workspace, 'codex', 'invalid', env)
    await mkdir(join(legacyInstallDir, 'native'), { recursive: true })
    await mkdir(join(legacyInstallDir, 'oneworks'), { recursive: true })
    await mkdir(join(invalidInstallDir, 'native'), { recursive: true })
    await mkdir(join(invalidInstallDir, 'oneworks'), { recursive: true })
    const toConfig = (scope: string) => ({
      adapter: 'codex',
      installedAt: new Date().toISOString(),
      name: '@scope/Docs Plugin',
      nativePluginPath: 'native',
      oneworksPluginPath: 'oneworks',
      scope,
      source,
      version: 1
    })
    await writeFile(
      join(legacyInstallDir, '.oneworks-plugin.json'),
      JSON.stringify(toConfig('@scope/Docs Plugin'))
    )
    await writeFile(
      join(invalidInstallDir, '.oneworks-plugin.json'),
      JSON.stringify(toConfig('Invalid Explicit Scope'))
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const installs = await listManagedPluginInstalls(workspace, { adapter: 'codex', env })

    expect(installs).toHaveLength(1)
    expect(installs[0]?.config.scope).toBe(resolveManagedPluginScope({
      adapter: 'codex',
      name: '@scope/Docs Plugin',
      source
    }))
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
