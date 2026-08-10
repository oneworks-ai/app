import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'

import lockfile from 'proper-lockfile'

import { resolveProjectOoPath } from './ai-path'

import { isBarePermissionKey, normalizePermissionToolName } from './permission-tool'

export { CANONICAL_PERMISSION_TOOL_KEYS, isBarePermissionKey, normalizePermissionToolName } from './permission-tool'
export type { CanonicalPermissionToolKey, PermissionToolSubject } from './permission-tool'

export interface SessionPermissionState {
  allow: string[]
  deny: string[]
  onceAllow: string[]
  onceDeny: string[]
}

const uniqueStrings = (values: string[]) => [...new Set(values)]

export const createEmptySessionPermissionState = (): SessionPermissionState => ({
  allow: [],
  deny: [],
  onceAllow: [],
  onceDeny: []
})

export const normalizeSessionPermissionState = (value: unknown): SessionPermissionState => {
  const record = value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  const normalizeList = (input: unknown) =>
    uniqueStrings(
      Array.isArray(input)
        ? input
          .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
          .map(item => normalizePermissionToolName(item)?.key ?? item.trim())
        : []
    )

  return {
    allow: normalizeList(record.allow),
    deny: normalizeList(record.deny),
    onceAllow: normalizeList(record.onceAllow),
    onceDeny: normalizeList(record.onceDeny)
  }
}

export const parseStrictPermissionMirror = (
  content: string,
  expected: { adapter: string; sessionId: string }
): SessionPermissionState => {
  return parseStrictPermissionMirrorDocument(content, expected).permissionState
}

export const parseStrictPermissionMirrorDocument = (
  content: string,
  expected: { adapter: string; sessionId: string }
): { mirror: Record<string, unknown>; permissionState: SessionPermissionState } => {
  const value = JSON.parse(content) as unknown
  const mirror = value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
  const state = mirror?.permissionState
  const isStringArray = (input: unknown): input is string[] => (
    Array.isArray(input) && input.every(item => typeof item === 'string')
  )
  if (
    mirror?.adapter !== expected.adapter ||
    mirror.sessionId !== expected.sessionId ||
    state == null ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    !isStringArray((state as Record<string, unknown>).allow) ||
    !isStringArray((state as Record<string, unknown>).deny) ||
    !isStringArray((state as Record<string, unknown>).onceAllow) ||
    !isStringArray((state as Record<string, unknown>).onceDeny)
  ) {
    throw new Error('Permission mirror has an invalid identity or permission state.')
  }
  return { mirror, permissionState: normalizeSessionPermissionState(state) }
}

export const splitManagedPermissionKeys = (values: string[] | undefined) => {
  const bare: string[] = []
  const other: string[] = []

  for (const raw of values ?? []) {
    const trimmed = raw.trim()
    if (trimmed === '') continue
    const normalized = normalizePermissionToolName(trimmed)?.key ?? trimmed
    if (isBarePermissionKey(normalized)) {
      bare.push(normalized)
    } else {
      other.push(trimmed)
    }
  }

  return {
    bare: uniqueStrings(bare),
    other: uniqueStrings(other)
  }
}

export const resolvePermissionMirrorPath = (
  cwd: string,
  adapter: string,
  sessionId: string,
  env: Record<string, string | null | undefined> = process.env
) => resolveProjectOoPath(cwd, env, '.mock', 'permission-state', adapter, `${sessionId}.json`)

const PRIVATE_PERMISSION_MIRROR_LOCK_DEADLINE_MS = 30_000

const waitFor = async (milliseconds: number) => await new Promise(resolve => setTimeout(resolve, milliseconds))

/**
 * Serializes private permission mirror read-modify-write operations with Pi's
 * upstream-compatible proper-lockfile protocol. The lock is deliberately on
 * the mirror path, so every runtime shares one recovery and ownership domain.
 */
export const withPrivatePermissionMirrorLock = async <Result>(
  mirrorPath: string,
  callback: () => Promise<Result>
) => {
  const parent = dirname(mirrorPath)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  await chmod(parent, 0o700)

  const deadline = Date.now() + PRIVATE_PERMISSION_MIRROR_LOCK_DEADLINE_MS
  let retryDelay = 50
  let release: (() => Promise<void>) | undefined
  while (release == null) {
    try {
      release = await lockfile.lock(mirrorPath, {
        realpath: false,
        retries: 0,
        stale: PRIVATE_PERMISSION_MIRROR_LOCK_DEADLINE_MS
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ELOCKED' || Date.now() >= deadline) throw error
      const remaining = deadline - Date.now()
      const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(retryDelay / 4)))
      await waitFor(Math.min(retryDelay + jitter, remaining))
      retryDelay = Math.min(retryDelay * 2, 2_000)
    }
  }

  try {
    return await callback()
  } finally {
    await release()
  }
}

export const writePrivatePermissionMirror = async (mirrorPath: string, content: string) => {
  const parent = dirname(mirrorPath)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  await chmod(parent, 0o700)
  const tempPath = `${mirrorPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    await writeFile(tempPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(tempPath, mirrorPath)
    await chmod(mirrorPath, 0o600)
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined)
  }
}
