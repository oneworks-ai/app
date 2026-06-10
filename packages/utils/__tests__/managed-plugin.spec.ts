import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { getManagedPluginInstallDir, listManagedPluginInstalls } from '#~/managed-plugin.js'

const tempDirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('listManagedPluginInstalls', () => {
  it('keeps valid installs when another managed plugin config is invalid', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-plugin-'))
    tempDirs.push(workspace)

    const goodInstallDir = getManagedPluginInstallDir(workspace, 'claude', 'good')
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

    const badInstallDir = getManagedPluginInstallDir(workspace, 'claude', 'bad')
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
    const installs = await listManagedPluginInstalls(workspace)

    expect(installs.map(install => install.config.name)).toEqual(['good'])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('skips installs whose managed paths escape the install directory', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-plugin-'))
    tempDirs.push(workspace)

    const escapedInstallDir = getManagedPluginInstallDir(workspace, 'claude', 'escaped')
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
    const installs = await listManagedPluginInstalls(workspace)

    expect(installs).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('must stay inside the install dir')
  })

  it('accepts marketplace-backed managed plugin installs', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-plugin-'))
    tempDirs.push(workspace)

    const reviewerInstallDir = getManagedPluginInstallDir(workspace, 'claude', 'reviewer')
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

    const installs = await listManagedPluginInstalls(workspace)

    expect(installs).toHaveLength(1)
    expect(installs[0]?.config.source).toEqual({
      type: 'marketplace',
      marketplace: 'team-tools',
      plugin: 'reviewer'
    })
  })

  it('accepts managed plugin installs for non-claude adapters', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-plugin-'))
    tempDirs.push(workspace)

    const helperInstallDir = getManagedPluginInstallDir(workspace, 'codex', 'codex-helper')
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

    const installs = await listManagedPluginInstalls(workspace, { adapter: 'codex' })

    expect(installs).toHaveLength(1)
    expect(installs[0]?.config.adapter).toBe('codex')
  })
})
