import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

import type { PromptAssetResolution, ResolvedPromptAssetOptions, WorkspaceAssetBundle } from '@oneworks/types'
import { resolveProjectOoPath } from '@oneworks/utils'

const CACHE_VERSION = 1
const CACHE_DIR = 'workspace-query-options'
const DISABLE_CACHE_ENV = 'ONEWORKS_DISABLE_QUERY_OPTIONS_CACHE'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

interface SnapshotEntry {
  kind: 'dir' | 'file' | 'missing' | 'other'
  mtimeMs?: number
  size?: number
}

interface QueryOptionsCacheEntry {
  cacheKey: string
  data: PromptAssetResolution
  resolvedOptions: ResolvedPromptAssetOptions
  snapshots: Record<string, SnapshotEntry>
  version: typeof CACHE_VERSION
}

export interface QueryOptionsCacheInput {
  adapter?: string
  config: unknown
  cwd: string
  input?: unknown
  model?: string
  name?: string
  plugins?: unknown
  type?: 'spec' | 'entity'
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeJson = (value: unknown): JsonValue => {
  if (value == null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(normalizeJson)
  if (!isRecord(value)) return String(value)

  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map(key => [key, normalizeJson(value[key])])
  )
}

const hashValue = (value: unknown) => createHash('sha256').update(JSON.stringify(normalizeJson(value))).digest('hex')

export const isQueryOptionsCacheEnabled = (input?: { updateConfiguredSkills?: boolean }) => (
  process.env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER__ === '1' &&
  process.env[DISABLE_CACHE_ENV] !== '1' &&
  input?.updateConfiguredSkills !== true
)

export const buildQueryOptionsCacheKey = (input: QueryOptionsCacheInput) =>
  hashValue({
    version: CACHE_VERSION,
    adapter: input.adapter,
    config: input.config,
    cwd: resolve(input.cwd),
    input: input.input,
    model: input.model,
    name: input.name,
    plugins: input.plugins,
    type: input.type
  })

const getCachePath = (cwd: string, cacheKey: string) =>
  resolveProjectOoPath(cwd, process.env, 'caches', CACHE_DIR, `${cacheKey}.json`)

const snapshotPath = async (targetPath: string): Promise<SnapshotEntry> => {
  try {
    const stats = await stat(targetPath)
    return {
      kind: stats.isDirectory() ? 'dir' : stats.isFile() ? 'file' : 'other',
      mtimeMs: stats.mtimeMs,
      size: stats.size
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'missing' }
    }
    throw error
  }
}

const hasSameSnapshot = (left: SnapshotEntry, right: SnapshotEntry) => (
  left.kind === right.kind &&
  left.mtimeMs === right.mtimeMs &&
  left.size === right.size
)

const addIfNonEmpty = (paths: Set<string>, value: string | undefined) => {
  if (value == null || value.trim() === '') return
  paths.add(resolve(value))
}

const addAssetWatchPaths = (paths: Set<string>, bundle: WorkspaceAssetBundle) => {
  for (const asset of bundle.assets) {
    addIfNonEmpty(paths, asset.sourcePath)
    addIfNonEmpty(paths, dirname(asset.sourcePath))
    addIfNonEmpty(paths, asset.instancePath)
  }
  const addPlugin = (plugin: WorkspaceAssetBundle['pluginInstances'][number]) => {
    addIfNonEmpty(paths, plugin.instancePath)
    addIfNonEmpty(paths, plugin.rootDir)
    plugin.children.forEach(addPlugin)
  }
  bundle.pluginInstances.forEach(addPlugin)
}

const addWorkspaceWatchPaths = (paths: Set<string>, cwd: string) => {
  for (const subpath of ['rules', 'specs', 'entities', 'skills', 'workspaces', 'agents', 'commands', 'modes']) {
    addIfNonEmpty(paths, resolveProjectOoPath(cwd, process.env, subpath))
  }
  addIfNonEmpty(paths, join(cwd, 'AGENTS.md'))
}

export const buildQueryOptionsCacheSnapshots = async (cwd: string, bundle: WorkspaceAssetBundle) => {
  const paths = new Set<string>()
  addWorkspaceWatchPaths(paths, cwd)
  addAssetWatchPaths(paths, bundle)

  const snapshots: Record<string, SnapshotEntry> = {}
  await Promise.all(
    Array.from(paths)
      .sort((left, right) => left.localeCompare(right))
      .map(async (targetPath) => {
        snapshots[targetPath] = await snapshotPath(targetPath)
      })
  )
  return snapshots
}

const validateSnapshots = async (snapshots: Record<string, SnapshotEntry>) => {
  for (const [targetPath, expected] of Object.entries(snapshots)) {
    if (!hasSameSnapshot(await snapshotPath(targetPath), expected)) {
      return false
    }
  }
  return true
}

export const readQueryOptionsCache = async (
  cwd: string,
  cacheKey: string
): Promise<[PromptAssetResolution, ResolvedPromptAssetOptions] | undefined> => {
  try {
    const parsed = JSON.parse(await readFile(getCachePath(cwd, cacheKey), 'utf8')) as unknown
    if (!isRecord(parsed) || parsed.version !== CACHE_VERSION || parsed.cacheKey !== cacheKey) {
      return undefined
    }

    const entry = parsed as unknown as QueryOptionsCacheEntry
    if (!await validateSnapshots(entry.snapshots)) {
      return undefined
    }

    return [entry.data, entry.resolvedOptions]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
      return undefined
    }
    throw error
  }
}

export const writeQueryOptionsCache = async (params: {
  cacheKey: string
  cwd: string
  data: PromptAssetResolution
  resolvedOptions: ResolvedPromptAssetOptions
}) => {
  const bundle = params.resolvedOptions.assetBundle
  if (bundle == null) return

  const entry: QueryOptionsCacheEntry = {
    version: CACHE_VERSION,
    cacheKey: params.cacheKey,
    data: params.data,
    resolvedOptions: params.resolvedOptions,
    snapshots: await buildQueryOptionsCacheSnapshots(params.cwd, bundle)
  }
  const cachePath = getCachePath(params.cwd, params.cacheKey)
  await mkdir(dirname(cachePath), { recursive: true })
  const tempPath = `${cachePath}.${randomUUID()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(entry, null, 2)}\n`, 'utf8')
  await rename(tempPath, cachePath)
}
