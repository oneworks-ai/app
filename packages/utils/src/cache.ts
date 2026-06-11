import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import type { Cache } from '@oneworks/types'

import { resolveProjectOoPath } from './ai-path'
import { migrateProjectHomeSegment } from './project-home-migration'

const ADAPTER_RESUME_CACHE_KEYS = new Set<string>([
  'adapter.codex.threads',
  'adapter.claude-code.resume-state',
  'adapter.copilot.session',
  'adapter.gemini.session',
  'adapter.opencode.session'
])

const shouldMigrateBeforeCacheWrite = (key: keyof Cache) => ADAPTER_RESUME_CACHE_KEYS.has(String(key))

export const getCachePath = (
  cwd: string,
  taskId: string,
  sessionId: string | undefined,
  key: keyof Cache,
  env: Record<string, string | null | undefined> = process.env
) => {
  const taskDir = resolveProjectOoPath(cwd, env, 'caches', taskId)
  const cacheDir = sessionId ? resolve(taskDir, sessionId) : taskDir
  return resolve(cacheDir, `${key}.json`)
}

const getCachePathFromRoot = (
  cacheRoot: string,
  taskId: string,
  sessionId: string | undefined,
  key: keyof Cache
) => {
  const taskDir = resolve(cacheRoot, taskId)
  const cacheDir = sessionId ? resolve(taskDir, sessionId) : taskDir
  return resolve(cacheDir, `${key}.json`)
}

export const setCache = async <K extends keyof Cache>(
  cwd: string,
  taskId: string,
  sessionId: string | undefined,
  key: K,
  value: Cache[K],
  env: Record<string, string | null | undefined> = process.env
) => {
  if (shouldMigrateBeforeCacheWrite(key)) {
    await migrateProjectHomeSegment(cwd, env, 'caches')
  }
  const cachePath = getCachePath(cwd, taskId, sessionId, key, env)
  const cacheDir = dirname(cachePath)
  try {
    await fs.access(cacheDir)
  } catch {
    await fs.mkdir(cacheDir, { recursive: true })
  }
  const tempPath = `${cachePath}.${randomUUID()}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), {
    flag: 'w'
  })
  await fs.rename(tempPath, cachePath)
  return { cachePath }
}

export const getCache = async <K extends keyof Cache>(
  cwd: string,
  taskId: string,
  sessionId: string | undefined,
  key: K,
  env: Record<string, string | null | undefined> = process.env
): Promise<Cache[K] | undefined> => {
  await migrateProjectHomeSegment(cwd, env, 'caches')
  const cachePath = getCachePath(cwd, taskId, sessionId, key, env)
  return readCacheFile(cachePath)
}

const readCacheFile = async <K extends keyof Cache>(
  cachePath: string
): Promise<Cache[K] | undefined> => {
  try {
    await fs.access(cachePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
  const content = await fs.readFile(cachePath, 'utf-8')

  if (content.trim() === '') {
    return undefined
  }

  try {
    return JSON.parse(content) as Cache[K]
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined
    }
    throw error
  }
}

const readDirSafe = async (targetPath: string) => {
  try {
    return await fs.readdir(targetPath, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

export const getCacheWithLegacyFallback = async <K extends keyof Cache>(
  cwd: string,
  taskId: string,
  sessionId: string | undefined,
  key: K,
  env: Record<string, string | null | undefined> = process.env
): Promise<Cache[K] | undefined> => {
  const current = await getCache(cwd, taskId, sessionId, key, env)
  if (current !== undefined || sessionId == null || !ADAPTER_RESUME_CACHE_KEYS.has(String(key))) {
    return current
  }

  const cacheRoot = resolveProjectOoPath(cwd, env, 'caches')
  const candidates: Array<{ ctxId: string; mtimeMs: number; value: Cache[K] }> = []

  const ctxEntries = await readDirSafe(cacheRoot)
  for (const ctxEntry of ctxEntries) {
    if (!ctxEntry.isDirectory() || ctxEntry.name === taskId) continue

    const migratedPath = getCachePathFromRoot(cacheRoot, ctxEntry.name, sessionId, key)
    let mtimeMs = 0
    try {
      mtimeMs = (await fs.stat(migratedPath)).mtimeMs
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue
      }
      throw error
    }

    const value = await readCacheFile<K>(migratedPath)
    if (value !== undefined) {
      candidates.push({ ctxId: ctxEntry.name, mtimeMs, value })
    }
  }

  const restored = candidates.sort((left, right) =>
    right.mtimeMs - left.mtimeMs || left.ctxId.localeCompare(right.ctxId)
  )[0]?.value
  if (restored === undefined) {
    return undefined
  }

  await setCache(cwd, taskId, sessionId, key, restored, env)
  return restored
}
