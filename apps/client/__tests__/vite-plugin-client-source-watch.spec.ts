import { EventEmitter, once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { isVersionedPluginClientEntry, pluginClientSourceWatch } from '../vite-plugin-client-source-watch.js'

describe('plugin client source watcher', () => {
  it('recognizes versioned plugin entries without matching regular or virtual modules', () => {
    expect(isVersionedPluginClientEntry('/repo/plugin/client/src/index.tsx?pluginVersion=1')).toBe(true)
    expect(isVersionedPluginClientEntry('C:\\repo\\plugin\\client\\src\\index.tsx?pluginVersion=2')).toBe(true)
    expect(isVersionedPluginClientEntry('/repo/plugin/client/src/index.tsx')).toBe(false)
    expect(isVersionedPluginClientEntry('\0virtual:entry?pluginVersion=1')).toBe(false)
  })

  it('watches only sources beneath an external versioned plugin entry', () => {
    const add = vi.fn()
    const watcher = Object.assign(new EventEmitter(), { add })
    const httpServer = new EventEmitter()
    const plugin = pluginClientSourceWatch()
    expect(plugin.configureServer).toBeTypeOf('function')
    expect(plugin.transform).toBeTypeOf('function')
    ;(plugin.configureServer as (server: unknown) => void)({
      config: { root: '/repo/apps/client' },
      httpServer,
      watcher
    })
    ;(plugin.transform as (source: string, id: string) => unknown)(
      '',
      '/repo/apps/client/src/main.tsx?pluginVersion=3'
    )
    ;(plugin.transform as (source: string, id: string) => unknown)(
      '',
      '/repo/packages/plugins/demo/client/src/view.tsx'
    )
    ;(plugin.transform as (source: string, id: string) => unknown)(
      '',
      '/repo/packages/plugins/demo/client/src/index.tsx?pluginVersion=3'
    )
    ;(plugin.transform as (source: string, id: string) => unknown)(
      '',
      '/repo/packages/plugins/demo/client/src/view.tsx'
    )

    expect(add).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledWith('/repo/packages/plugins/demo/client/src')
    httpServer.emit('close')
  })

  it('emits a scoped change when native file events miss an atomic save', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'oneworks-plugin-watch-'))
    const sourceDir = path.join(root, 'plugin', 'client', 'src')
    const fileName = path.join(sourceDir, 'view.tsx')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(fileName, 'before')

    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
    const httpServer = new EventEmitter()
    const plugin = pluginClientSourceWatch({ nativeGraceMs: 5, pollIntervalMs: 10 })
    ;(plugin.configureServer as (server: unknown) => void)({
      config: { root: path.join(root, 'apps', 'client') },
      httpServer,
      watcher
    })
    ;(plugin.transform as (source: string, id: string) => unknown)('', `${sourceDir}/index.tsx?pluginVersion=1`)
    ;(plugin.transform as (source: string, id: string) => unknown)('', fileName)

    try {
      await new Promise(resolve => setTimeout(resolve, 20))
      const changed = once(watcher, 'change')
      writeFileSync(fileName, 'after')
      const [changedFile] = await Promise.race([
        changed,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('poll timeout')), 1_000))
      ])
      expect(changedFile).toBe(fileName)
    } finally {
      httpServer.emit('close')
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('does not emit a fallback change after the native watcher handled the same save', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'oneworks-plugin-watch-native-'))
    const sourceDir = path.join(root, 'plugin', 'client', 'src')
    const entryName = path.join(sourceDir, 'index.tsx')
    const fileName = path.join(sourceDir, 'view.tsx')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(entryName, 'entry')
    writeFileSync(fileName, 'before')

    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
    const httpServer = new EventEmitter()
    const plugin = pluginClientSourceWatch({ nativeGraceMs: 20, pollIntervalMs: 10 })
    ;(plugin.configureServer as (server: unknown) => void)({
      config: { root: path.join(root, 'apps', 'client') },
      httpServer,
      watcher
    })
    ;(plugin.transform as (source: string, id: string) => unknown)('', `${entryName}?pluginVersion=1`)
    ;(plugin.transform as (source: string, id: string) => unknown)('', fileName)

    let changeCount = 0
    watcher.on('change', () => {
      changeCount += 1
    })
    try {
      await new Promise(resolve => setTimeout(resolve, 20))
      writeFileSync(fileName, 'after')
      watcher.emit('change', fileName)
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(changeCount).toBe(1)
    } finally {
      httpServer.emit('close')
      rmSync(root, { force: true, recursive: true })
    }
  })
})
