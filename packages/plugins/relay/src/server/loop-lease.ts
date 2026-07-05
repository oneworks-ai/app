/* eslint-disable max-lines -- loop lease keeps cross-process locking and stale lease cleanup together. */
import { createHash } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { isRecord, toString } from './utils.js'

const DEFAULT_LOOP_LEASE_TTL_MS = 45_000
const DEFAULT_LOOP_LEASE_REFRESH_MS = 15_000
const LOOP_LEASE_LOCK_TIMEOUT_MS = 1_000
const LOOP_LEASE_LOCK_STALE_MS = 10_000

export interface RelayLoopLease {
  connectionKey: string
  release: () => void
}

interface RelayLoopLeaseManagerOptions {
  leaseRoot?: string
  ownerId: string
  projectHome?: string
  refreshMs?: number
  ttlMs?: number
}

interface RelayLoopLeaseFile {
  connectionKey: string
  expiresAt: number
  ownerId: string
  pid: number
  updatedAt: number
}

const sleep = async (ms: number) => {
  await new Promise(resolve => setTimeout(resolve, ms))
}

const toLeaseFileName = (connectionKey: string) => (
  `${createHash('sha256').update(connectionKey).digest('hex')}.json`
)

const readLoopLeaseRootOverride = () => {
  const value = process.env.__ONEWORKS_RELAY_LOOP_LEASE_ROOT__?.trim()
  return value === '' ? undefined : value
}

const defaultLoopLeaseRoot = () => readLoopLeaseRootOverride() ?? join(homedir(), '.oneworks', 'relay', 'loop-leases')

const normalizeLeaseFile = (value: unknown): RelayLoopLeaseFile | undefined => {
  if (!isRecord(value)) return undefined
  const connectionKey = toString(value.connectionKey)
  const ownerId = toString(value.ownerId)
  const pid = Number(value.pid)
  const updatedAt = Number(value.updatedAt)
  const expiresAt = Number(value.expiresAt)
  if (
    connectionKey === '' ||
    ownerId === '' ||
    !Number.isFinite(pid) ||
    !Number.isFinite(updatedAt) ||
    !Number.isFinite(expiresAt)
  ) return undefined
  return {
    connectionKey,
    expiresAt,
    ownerId,
    pid,
    updatedAt
  }
}

const isProcessAlive = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return isRecord(error) && toString(error.code) === 'EPERM'
  }
}

const readLeaseFile = async (path: string) => {
  const content = await readFile(path, 'utf8').catch(() => '')
  if (content.trim() === '') return undefined
  try {
    return normalizeLeaseFile(JSON.parse(content))
  } catch {
    return undefined
  }
}

const readLeaseFileSync = (path: string) => {
  try {
    const content = readFileSync(path, 'utf8')
    if (content.trim() === '') return undefined
    return normalizeLeaseFile(JSON.parse(content))
  } catch {
    return undefined
  }
}

const writeLeaseFile = async (
  path: string,
  input: {
    connectionKey: string
    ownerId: string
    ttlMs: number
  }
) => {
  const updatedAt = Date.now()
  await writeFile(
    path,
    `${
      JSON.stringify(
        {
          connectionKey: input.connectionKey,
          expiresAt: updatedAt + input.ttlMs,
          ownerId: input.ownerId,
          pid: process.pid,
          updatedAt
        },
        null,
        2
      )
    }\n`,
    {
      encoding: 'utf8',
      mode: 0o600
    }
  )
}

const acquireLeaseFileLock = async (lockDir: string) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= LOOP_LEASE_LOCK_TIMEOUT_MS) {
    try {
      await mkdir(lockDir)
      return async () => {
        await rm(lockDir, { recursive: true, force: true })
      }
    } catch (error) {
      if (!isRecord(error) || toString(error.code) !== 'EEXIST') throw error
      const lockStat = await stat(lockDir).catch(() => undefined)
      if (lockStat != null && Date.now() - lockStat.mtimeMs > LOOP_LEASE_LOCK_STALE_MS) {
        await rm(lockDir, { recursive: true, force: true }).catch(() => undefined)
        continue
      }
      await sleep(25)
    }
  }
  return undefined
}

export const createRelayLoopLeaseManager = (options: RelayLoopLeaseManagerOptions) => {
  const ownerId = options.ownerId
  const leaseDir = options.leaseRoot ?? defaultLoopLeaseRoot()
  const ttlMs = Math.max(250, Math.floor(options.ttlMs ?? DEFAULT_LOOP_LEASE_TTL_MS))
  const refreshMs = Math.max(1_000, Math.floor(options.refreshMs ?? DEFAULT_LOOP_LEASE_REFRESH_MS))

  const leasePathForKey = (connectionKey: string) => join(leaseDir, toLeaseFileName(connectionKey))

  const acquire = async (connectionKey: string): Promise<RelayLoopLease | undefined> => {
    await mkdir(leaseDir, { recursive: true })
    const leasePath = leasePathForKey(connectionKey)
    const lockRelease = await acquireLeaseFileLock(`${leasePath}.lock`)
    if (lockRelease == null) return undefined
    try {
      const existing = await readLeaseFile(leasePath)
      if (
        existing != null &&
        existing.ownerId !== ownerId &&
        existing.expiresAt > Date.now() &&
        isProcessAlive(existing.pid)
      ) {
        return undefined
      }
      await writeLeaseFile(leasePath, { connectionKey, ownerId, ttlMs })
    } finally {
      await lockRelease()
    }

    let released = false
    let timer: ReturnType<typeof setInterval> | undefined
    const refresh = async () => {
      if (released) return
      const current = await readLeaseFile(leasePath)
      if (current != null && current.ownerId !== ownerId) {
        released = true
        if (timer != null) clearInterval(timer)
        return
      }
      await writeLeaseFile(leasePath, { connectionKey, ownerId, ttlMs })
    }
    timer = setInterval(() => {
      void refresh().catch(() => undefined)
    }, refreshMs)
    ;(timer as { unref?: () => void }).unref?.()

    return {
      connectionKey,
      release: () => {
        if (released) return
        released = true
        if (timer != null) clearInterval(timer)
        const current = readLeaseFileSync(leasePath)
        if (current?.ownerId === ownerId) {
          rmSync(leasePath, { force: true })
        }
      }
    }
  }

  return {
    acquire
  }
}
