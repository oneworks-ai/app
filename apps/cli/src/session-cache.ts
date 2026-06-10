import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import type { RunTaskOptions } from '@oneworks/app-runtime'
import type { AdapterQueryOptions, Cache, TaskDetail } from '@oneworks/types'
import { migrateProjectHomeSegment, resolveProjectOoPath } from '@oneworks/utils'
import { getCache, getCachePath, setCache } from '@oneworks/utils/cache'

export type CliOutputFormat = 'text' | 'json' | 'stream-json'

export interface CliSessionResumeRecord {
  version: 1
  ctxId: string
  sessionId: string
  cwd: string
  description?: string
  createdAt: number
  updatedAt: number
  resolvedAdapter?: string
  taskOptions: RunTaskOptions
  adapterOptions: Omit<AdapterQueryOptions, 'description' | 'onEvent' | 'type'>
  outputFormat: CliOutputFormat
}

export interface CliSessionRecord {
  resume?: CliSessionResumeRecord
  detail?: TaskDetail
}

export interface CliSessionControlRecord {
  signal: 'SIGTERM' | 'SIGKILL'
  requestedAt: number
  expiresAt: number
}

declare module '@oneworks/types' {
  interface Cache {
    'cli-session': CliSessionResumeRecord
    'cli-session-control': CliSessionControlRecord
    detail: TaskDetail
  }
}

const readDirSafe = async (target: string) => {
  try {
    return await fs.readdir(target, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

const readCacheFileAtPath = async <K extends keyof Cache>(target: string): Promise<Cache[K] | undefined> => {
  try {
    const content = await fs.readFile(target, 'utf-8')
    if (content.trim() === '') return undefined
    return JSON.parse(content) as Cache[K]
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' ||
      error instanceof SyntaxError
    ) {
      return undefined
    }
    throw error
  }
}

const getCacheFromRoot = async <K extends keyof Cache>(
  cacheRoot: string,
  ctxId: string,
  sessionId: string,
  key: K
) => readCacheFileAtPath<K>(path.resolve(cacheRoot, ctxId, sessionId, `${String(key)}.json`))

const resolveCliSessionCacheRoot = (cwd: string) => resolveProjectOoPath(cwd, process.env, 'caches')

const getRecordUpdatedAt = (record: CliSessionRecord) =>
  record.resume?.updatedAt ??
    record.detail?.endTime ??
    record.detail?.startTime ??
    0

const getRecordCreatedAt = (record: CliSessionRecord) =>
  record.resume?.createdAt ??
    record.detail?.startTime ??
    0

const isSessionDirNameMatch = (value: string, target: string) => value === target || value.startsWith(target)

const normalizeResumeCommandPrefix = (prefix: string | undefined) => {
  const normalizedPrefix = prefix?.trim()
  return normalizedPrefix == null || normalizedPrefix === '' ? 'oneworks' : normalizedPrefix
}

export const formatResumeCommand = (sessionId: string, prefix = process.env.__ONEWORKS_CLI_RESUME_COMMAND_PREFIX__) =>
  `${normalizeResumeCommandPrefix(prefix)} --resume ${sessionId}`
export const formatStopCommand = (sessionId: string) => `oneworks stop ${sessionId}`
export const formatKillCommand = (sessionId: string) => `oneworks kill ${sessionId}`
export const formatListCommand = (params?: {
  running?: boolean
  view?: string
}) => {
  const args = ['oneworks', 'list']
  if (params?.running) args.push('--running')
  if (params?.view != null && params.view !== '') args.push('--view', params.view)
  return args.join(' ')
}

export const resolveCliSessionId = (record: CliSessionRecord) =>
  record.resume?.sessionId ?? record.detail?.sessionId ?? ''

export const resolveCliSessionCtxId = (record: CliSessionRecord) => record.resume?.ctxId ?? record.detail?.ctxId ?? ''

export const resolveCliSessionAdapter = (record: CliSessionRecord) =>
  record.resume?.resolvedAdapter ??
    record.detail?.adapter ??
    record.resume?.taskOptions.adapter ??
    ''

export const resolveCliSessionModel = (record: CliSessionRecord) =>
  record.detail?.model ?? record.resume?.adapterOptions.model ?? ''

export const resolveCliSessionDescription = (record: CliSessionRecord) =>
  record.detail?.description ?? record.resume?.description ?? ''

export const resolveCliSessionUpdatedAt = (record: CliSessionRecord) => getRecordUpdatedAt(record)

export const listCliSessions = async (cwd: string): Promise<CliSessionRecord[]> => {
  const sessions: CliSessionRecord[] = []
  const seen = new Set<string>()
  await migrateProjectHomeSegment(cwd, process.env, 'caches')

  const cacheRoot = resolveCliSessionCacheRoot(cwd)
  const ctxEntries = await readDirSafe(cacheRoot)

  for (const ctxEntry of ctxEntries) {
    if (!ctxEntry.isDirectory()) continue

    const ctxId = ctxEntry.name
    const sessionEntries = await readDirSafe(path.resolve(cacheRoot, ctxId))

    for (const sessionEntry of sessionEntries) {
      if (!sessionEntry.isDirectory()) continue

      const sessionId = sessionEntry.name
      const sessionKey = `${ctxId}\0${sessionId}`
      if (seen.has(sessionKey)) continue

      const [resume, detail] = await Promise.all([
        getCacheFromRoot(cacheRoot, ctxId, sessionId, 'cli-session'),
        getCacheFromRoot(cacheRoot, ctxId, sessionId, 'detail')
      ])

      if (resume == null && detail == null) continue
      seen.add(sessionKey)
      sessions.push({ resume, detail })
    }
  }

  return sessions.sort((left, right) => getRecordUpdatedAt(right) - getRecordUpdatedAt(left))
}

export const resolveCliSession = async (cwd: string, id?: string): Promise<CliSessionRecord> => {
  const sessions = await listCliSessions(cwd)
  if (id == null || id.trim() === '') {
    const latest = [...sessions].sort((left, right) => getRecordCreatedAt(right) - getRecordCreatedAt(left))[0]
    if (latest != null) return latest
    throw new Error(`No sessions found. Start a session first or use "${formatListCommand({ view: 'full' })}".`)
  }

  const normalizedId = id.trim()

  const exactSessionMatch = sessions.find((record) =>
    (record.resume?.sessionId ?? record.detail?.sessionId) === normalizedId
  )
  if (exactSessionMatch != null) return exactSessionMatch

  const exactCtxMatches = sessions.filter((record) => (record.resume?.ctxId ?? record.detail?.ctxId) === normalizedId)
  if (exactCtxMatches.length === 1) return exactCtxMatches[0]!
  if (exactCtxMatches.length > 1) {
    throw new Error(`Session id "${id}" matches multiple task contexts. Use a session id instead.`)
  }

  const prefixMatches = sessions.filter((record) => {
    const sessionId = record.resume?.sessionId ?? record.detail?.sessionId
    const ctxId = record.resume?.ctxId ?? record.detail?.ctxId
    return (
      (sessionId != null && isSessionDirNameMatch(sessionId, normalizedId)) ||
      (ctxId != null && isSessionDirNameMatch(ctxId, normalizedId))
    )
  })

  if (prefixMatches.length === 1) return prefixMatches[0]!
  if (prefixMatches.length > 1) {
    const candidates = prefixMatches
      .map(resolveCliSessionId)
      .filter((value): value is string => value != null)
      .slice(0, 5)
      .join(', ')
    throw new Error(`Session id "${id}" is ambiguous: ${candidates}`)
  }

  throw new Error(
    `Session "${id}" not found. Use "${formatListCommand({ view: 'full' })}" to inspect available sessions.`
  )
}

export const writeCliSessionRecord = async (
  cwd: string,
  ctxId: string,
  sessionId: string,
  record: CliSessionRecord
) => {
  await Promise.all([
    record.resume == null
      ? Promise.resolve()
      : setCache(cwd, ctxId, sessionId, 'cli-session', record.resume),
    record.detail == null
      ? Promise.resolve()
      : setCache(cwd, ctxId, sessionId, 'detail', record.detail)
  ])
}

export const readCliSessionControl = (
  cwd: string,
  ctxId: string,
  sessionId: string
) => getCache(cwd, ctxId, sessionId, 'cli-session-control')

export const writeCliSessionControl = (
  cwd: string,
  ctxId: string,
  sessionId: string,
  control: CliSessionControlRecord
) => setCache(cwd, ctxId, sessionId, 'cli-session-control', control)

export const clearCliSessionControl = async (
  cwd: string,
  ctxId: string,
  sessionId: string
) => {
  await fs.rm(getCachePath(cwd, ctxId, sessionId, 'cli-session-control'), { force: true })
}

export const isCliSessionStopActive = (
  control: CliSessionControlRecord | undefined,
  endedAt: number
) => control != null && endedAt <= control.expiresAt
