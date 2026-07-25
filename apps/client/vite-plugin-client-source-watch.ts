import { statSync, unwatchFile, watchFile } from 'node:fs'
import type { Stats } from 'node:fs'
import path from 'node:path'

import type { Plugin, ViteDevServer } from 'vite'

const stripQuery = (id: string) => id.split('?', 1)[0] ?? id

const isPathInside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export const isVersionedPluginClientEntry = (id: string) => {
  if (id.startsWith('\0')) return false
  const queryIndex = id.indexOf('?')
  if (queryIndex < 0) return false
  return new URLSearchParams(id.slice(queryIndex + 1)).has('pluginVersion')
}

interface PluginClientSourceWatchOptions {
  nativeGraceMs?: number
  pollIntervalMs?: number
}

type WatchFileListener = (current: Stats, previous: Stats) => void

export const pluginClientSourceWatch = ({
  nativeGraceMs = 75,
  pollIntervalMs = 250
}: PluginClientSourceWatchOptions = {}): Plugin => {
  let server: ViteDevServer | undefined
  let hostRoot: string | undefined
  const fallbackEmits = new Set<string>()
  const nativeChanges = new Map<string, { mtimeMs: number; size: number }>()
  const pendingFallbacks = new Map<string, ReturnType<typeof setTimeout>>()
  const sourceRoots = new Set<string>()
  const watchedFiles = new Map<string, WatchFileListener>()

  const handleWatcherChange = (fileName: string) => {
    const resolved = path.resolve(fileName)
    if (fallbackEmits.delete(resolved)) return
    if (!watchedFiles.has(resolved)) return
    try {
      const current = statSync(resolved)
      nativeChanges.set(resolved, { mtimeMs: current.mtimeMs, size: current.size })
    } catch {
      nativeChanges.delete(resolved)
    }
  }

  const stopWatching = () => {
    pendingFallbacks.forEach(timer => clearTimeout(timer))
    pendingFallbacks.clear()
    watchedFiles.forEach((listener, fileName) => unwatchFile(fileName, listener))
    watchedFiles.clear()
    fallbackEmits.clear()
    nativeChanges.clear()
    sourceRoots.clear()
    server?.watcher.off('change', handleWatcherChange)
  }

  const watchSourceFile = (fileName: string) => {
    if (server == null || watchedFiles.has(fileName)) return
    const listener: WatchFileListener = (current, previous) => {
      if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return
      const existing = pendingFallbacks.get(fileName)
      if (existing != null) clearTimeout(existing)
      pendingFallbacks.set(
        fileName,
        setTimeout(() => {
          pendingFallbacks.delete(fileName)
          const nativeChange = nativeChanges.get(fileName)
          if (
            nativeChange != null &&
            nativeChange.mtimeMs === current.mtimeMs &&
            nativeChange.size === current.size
          ) {
            nativeChanges.delete(fileName)
            return
          }
          fallbackEmits.add(fileName)
          server?.watcher.emit('change', fileName)
        }, nativeGraceMs)
      )
    }
    watchedFiles.set(fileName, listener)
    watchFile(fileName, { interval: pollIntervalMs, persistent: false }, listener)
  }

  return {
    apply: 'serve',
    name: 'oneworks-plugin-client-source-watch',
    configureServer(currentServer) {
      server = currentServer
      hostRoot = path.resolve(server.config.root)
      server.watcher.on('change', handleWatcherChange)
      server.httpServer?.once('close', stopWatching)
    },
    transform(_source, id) {
      if (server == null || hostRoot == null || id.startsWith('\0')) return null
      const fileName = path.resolve(stripQuery(id))
      if (isPathInside(hostRoot, fileName)) return null

      if (isVersionedPluginClientEntry(id)) {
        const sourceRoot = path.dirname(fileName)
        sourceRoots.add(sourceRoot)
        server.watcher.add(sourceRoot)
      }
      if ([...sourceRoots].some(root => isPathInside(root, fileName))) watchSourceFile(fileName)
      return null
    }
  }
}
