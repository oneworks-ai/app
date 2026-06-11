import { Command } from 'commander'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetConfigCache } from '@oneworks/config'

import { resolveManagedPluginSource } from '#~/commands/@core/plugin-source.js'
import { registerPluginCommand, resolvePluginCommandAdapter } from '#~/commands/plugin.js'

const { addAdapterPluginMock } = vi.hoisted(() => ({
  addAdapterPluginMock: vi.fn()
}))

vi.mock('#~/commands/@core/plugin-install.js', () => ({
  addAdapterPlugin: addAdapterPluginMock
}))

const tempDirs: string[] = []

afterEach(async () => {
  resetConfigCache()
  vi.clearAllMocks()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('plugin command helpers', () => {
  it('uses merged config defaultAdapter when --adapter is omitted', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-command-'))
    tempDirs.push(cwd)

    await writeFile(
      path.join(cwd, '.oo.config.yaml'),
      [
        'defaultAdapter: codex'
      ].join('\n')
    )

    await expect(resolvePluginCommandAdapter(undefined, cwd)).resolves.toBe('codex')
    await expect(resolvePluginCommandAdapter('claude', cwd)).resolves.toBe('claude')
    await expect(resolvePluginCommandAdapter('adapter-codex', cwd)).resolves.toBe('codex')
  })

  it('maps claude-code defaults to the managed plugin adapter id', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-command-'))
    tempDirs.push(cwd)

    await writeFile(
      path.join(cwd, '.oo.config.yaml'),
      [
        'defaultAdapter: claude-code'
      ].join('\n')
    )

    await expect(resolvePluginCommandAdapter(undefined, cwd)).resolves.toBe('claude')
  })

  it('parses -A for plugin add and forwards the managed adapter id', async () => {
    addAdapterPluginMock.mockResolvedValue(undefined)

    const program = new Command()
    registerPluginCommand(program)

    await program.parseAsync(['plugin', '-A', 'claude', 'add', 'demo@team-tools'], { from: 'user' })

    expect(addAdapterPluginMock).toHaveBeenCalledWith(
      'claude',
      expect.objectContaining({
        cwd: process.cwd(),
        env: expect.objectContaining({
          __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: process.cwd(),
          __ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__: process.cwd()
        }),
        source: 'demo@team-tools',
        force: false,
        scope: undefined
      })
    )
  })

  it('supports explicit npm: specs for ambiguous unscoped package sources', async () => {
    await expect(resolveManagedPluginSource(process.cwd(), 'npm:reviewer@team-tools')).resolves.toEqual({
      type: 'npm',
      spec: 'reviewer@team-tools'
    })
  })
})
