import { Buffer } from 'node:buffer'
import path from 'node:path'

export type MemoryScope = 'global' | 'channel' | 'session' | 'user'
export type MemoryAction = 'get' | 'list' | 'patch' | 'set'

export interface MemoryCommandOptions {
  channel?: string
  content?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  filter?: string
  path?: string
  scope?: string
}

export interface MemoryCommandResult {
  output: string
}

export interface MemoryContext {
  channelId?: string
  channelKey?: string
  channelRef?: string
  channelSessionType?: string
  channelType?: string
  root: string
  senderId?: string
  sessionId?: string
}

export interface MemoryTarget {
  dir: string
  displayId?: string
  filePath: string
  memoryPath: string
  scope: MemoryScope
}

export const DEFAULT_MEMORY_PATH = 'README.md'
export const META_FILE_NAME = '.oneworks-mem.json'

const MEMORY_SCOPES = new Set<MemoryScope>(['global', 'channel', 'session', 'user'])

export const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export const normalizeScope = (value: string | undefined): MemoryScope => {
  const scope = trimNonEmpty(value) ?? 'channel'
  if (MEMORY_SCOPES.has(scope as MemoryScope)) return scope as MemoryScope
  throw new Error(`Unsupported memory scope: ${scope}. Supported: global, channel, session, user.`)
}

export const ensureRelativeMemoryPath = (value: string | undefined) => {
  const raw = trimNonEmpty(value) ?? DEFAULT_MEMORY_PATH
  if (raw.includes('\0')) throw new Error('Memory path cannot contain NUL bytes.')
  if (path.isAbsolute(raw)) throw new Error('Memory path must be relative.')

  const normalized = path.posix.normalize(raw.replaceAll('\\', '/')).replace(/^\.\//u, '')
  if (
    normalized === '' ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error('Memory path must stay inside the selected memory id.')
  }
  return normalized
}

export const toStorageSegment = (value: string) => Buffer.from(value, 'utf8').toString('base64url')

export const fromStorageSegment = (value: string) => {
  try {
    return Buffer.from(value, 'base64url').toString('utf8')
  } catch {
    return value
  }
}

export const formatTargetLabel = (target: MemoryTarget) =>
  [
    target.scope,
    target.displayId,
    target.memoryPath
  ].filter(Boolean).join(':')
