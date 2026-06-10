import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import {
  migrateProjectHomeSegment,
  resolveLegacyProjectHomeSegmentPaths,
  resolveProjectHomePath
} from '@oneworks/utils'

import type { RuntimeSessionMetadata, RuntimeSessionState, RuntimeSessionStore, RuntimeStoreIndex } from './types.js'
import { createWorkspaceRuntimeEnv } from './workspace-env.js'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asString = (value: unknown) => typeof value === 'string' && value.trim() !== '' ? value : undefined

const unique = (values: string[]) => Array.from(new Set(values.map(value => path.resolve(value))))

const resolveRuntimeOptions = (options: {
  cwd?: string
  env?: NodeJS.ProcessEnv
  homeDir?: string
} = {}) => {
  const cwd = options.cwd == null ? process.cwd() : path.resolve(options.cwd)
  const rawEnv = options.env ?? process.env
  const envWithHome = options.homeDir == null || rawEnv.HOME != null || rawEnv.__ONEWORKS_PROJECT_REAL_HOME__ != null
    ? rawEnv
    : { ...rawEnv, HOME: options.homeDir }
  const env = options.cwd == null
    ? envWithHome
    : createWorkspaceRuntimeEnv(cwd, envWithHome)
  return { cwd, env }
}

export function resolveRuntimeRoots(options: {
  cwd?: string
  env?: NodeJS.ProcessEnv
  homeDir?: string
} = {}) {
  const { cwd, env } = resolveRuntimeOptions(options)
  const roots = [
    resolveProjectHomePath(cwd, env, 'runtime'),
    ...resolveLegacyProjectHomeSegmentPaths(cwd, env, 'runtime').sourceDirs
  ].filter((value): value is string => value != null && value.trim() !== '')

  return unique(roots)
}

export async function migrateRuntimeRoots(options: {
  cwd?: string
  env?: NodeJS.ProcessEnv
  homeDir?: string
} = {}) {
  const { cwd, env } = resolveRuntimeOptions(options)
  await migrateProjectHomeSegment(cwd, env, 'runtime')
}

export function resolveLegacyRuntimeRoots(options: {
  cwd?: string
  env?: NodeJS.ProcessEnv
  homeDir?: string
} = {}) {
  const { cwd, env } = resolveRuntimeOptions(options)
  return resolveLegacyProjectHomeSegmentPaths(cwd, env, 'runtime').sourceDirs
}

export async function readRuntimeStoreIndex(root: string): Promise<RuntimeStoreIndex | undefined> {
  try {
    const content = await readFile(path.join(root, 'index.json'), 'utf8')
    const parsed = JSON.parse(content) as unknown
    if (!isRecord(parsed)) {
      return undefined
    }

    const sessions = isRecord(parsed.sessions)
      ? Object.fromEntries(
        Object.entries(parsed.sessions).flatMap(([sessionId, entry]) => {
          if (!isRecord(entry)) {
            return []
          }
          const storePath = asString(entry.storePath)
          if (storePath == null) {
            return []
          }

          return [[sessionId, {
            storePath,
            ...(asString(entry.cwd) != null ? { cwd: asString(entry.cwd) } : {}),
            ...(asString(entry.status) != null ? { status: asString(entry.status) } : {}),
            ...(typeof entry.updatedAt === 'number' ? { updatedAt: entry.updatedAt } : {})
          }]]
        })
      )
      : undefined

    return {
      ...(asString(parsed.protocolVersion) != null ? { protocolVersion: asString(parsed.protocolVersion) } : {}),
      ...(sessions != null ? { sessions } : {})
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

async function resolveStorePath(root: string, declaredPath: string) {
  if (path.isAbsolute(declaredPath)) {
    return declaredPath
  }

  return path.resolve(root, declaredPath)
}

async function listSessionStoresFromDirectory(root: string): Promise<RuntimeSessionStore[]> {
  const sessionsDir = path.join(root, 'sessions')
  let entries: string[]
  try {
    entries = await readdir(sessionsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }

  const stores: RuntimeSessionStore[] = []
  for (const entry of entries) {
    const storePath = path.join(sessionsDir, entry)
    const info = await stat(storePath).catch(() => undefined)
    if (info?.isDirectory() !== true) {
      continue
    }

    stores.push({
      sessionId: entry,
      root,
      storePath,
      commandsPath: path.join(storePath, 'commands.jsonl'),
      eventsPath: path.join(storePath, 'events.jsonl'),
      metaPath: path.join(storePath, 'meta.json'),
      statePath: path.join(storePath, 'state.json')
    })
  }
  return stores
}

export async function discoverRuntimeSessionStores(roots: string[]): Promise<RuntimeSessionStore[]> {
  const stores = new Map<string, RuntimeSessionStore>()

  for (const root of roots) {
    const rootStores = new Map<string, RuntimeSessionStore>()
    const index = await readRuntimeStoreIndex(root)
    for (const [sessionId, entry] of Object.entries(index?.sessions ?? {})) {
      const storePath = await resolveStorePath(root, entry.storePath)
      rootStores.set(sessionId, {
        sessionId,
        root,
        storePath,
        commandsPath: path.join(storePath, 'commands.jsonl'),
        eventsPath: path.join(storePath, 'events.jsonl'),
        metaPath: path.join(storePath, 'meta.json'),
        statePath: path.join(storePath, 'state.json')
      })
    }

    for (const store of await listSessionStoresFromDirectory(root)) {
      rootStores.set(store.sessionId, store)
    }

    for (const [sessionId, store] of rootStores) {
      if (!stores.has(sessionId)) {
        stores.set(sessionId, store)
      }
    }
  }

  return Array.from(stores.values())
}

export async function readRuntimeSessionState(
  store: RuntimeSessionStore
): Promise<RuntimeSessionState | undefined> {
  try {
    const parsed = JSON.parse(await readFile(store.statePath, 'utf8')) as unknown
    if (!isRecord(parsed)) {
      return undefined
    }

    return {
      ...parsed,
      sessionId: asString(parsed.sessionId) ?? store.sessionId
    } as RuntimeSessionState
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

export async function readRuntimeSessionMetadata(
  store: RuntimeSessionStore
): Promise<RuntimeSessionMetadata | undefined> {
  try {
    const parsed = JSON.parse(await readFile(store.metaPath, 'utf8')) as unknown
    if (!isRecord(parsed)) {
      return undefined
    }

    return {
      ...parsed,
      sessionId: asString(parsed.sessionId) ?? store.sessionId
    } as RuntimeSessionMetadata
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}
