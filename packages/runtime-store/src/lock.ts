import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { link, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, join } from 'node:path'
import process from 'node:process'

import type { RuntimeOwnerMetadata } from './types'

export interface RuntimeLockHandle {
  path: string
  assertOwned: () => Promise<void>
  refresh: () => Promise<void>
  release: () => Promise<void>
}

export interface RuntimeLockOptions {
  autoRefresh?: boolean
  isStale?: (metadata: Record<string, unknown> | undefined) => boolean
  liveOwnerGraceMs?: number
  staleMs?: number
  testHooks?: {
    afterCreateBeforeBarrierScan?: (path: string) => Promise<void> | void
    afterReclaimBarrierAcquired?: (path: string) => Promise<void> | void
  }
  timeoutMs?: number
}

export interface RuntimeLockRequest {
  path: string
  metadata: Record<string, unknown>
}

export class RuntimeStoreLockError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeStoreLockError'
  }
}

const sleep = async (ms: number) => {
  await new Promise(resolve => setTimeout(resolve, ms))
}

const createAtomicExclusiveFile = async (path: string, content: string) => {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.create`
  try {
    await writeFile(tempPath, content, { flag: 'wx' })
    await link(tempPath, path)
  } finally {
    await rm(tempPath, { force: true })
  }
}

const removeClaimedFile = async (
  path: string,
  observed: ObservedLock,
  ownerId?: string
) => {
  const quarantinePath = `${path}.${process.pid}.${randomUUID()}.quarantine`
  try {
    await rename(path, quarantinePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }

  const claimed = await readObservedLock(quarantinePath)
  if (matchesObservedLock(claimed, observed, ownerId)) {
    await rm(quarantinePath, { force: true })
    return true
  }

  try {
    await link(quarantinePath, path)
    await rm(quarantinePath, { force: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    // A newer owner already occupies the live name. Keep the mismatched inode
    // quarantined for dead-owner cleanup instead of deleting either owner.
  }
  return false
}

const readLockMetadata = async <T>(path: string) => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

interface ObservedLock {
  dev: number
  ino: number
  metadata?: Record<string, unknown>
}

const readObservedLock = async (path: string): Promise<ObservedLock | undefined> => {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, 'r')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    const [raw, openedStat] = await Promise.all([
      handle.readFile('utf8'),
      handle.stat()
    ])
    let pathStat: Awaited<ReturnType<typeof stat>>
    try {
      pathStat = await stat(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    if (openedStat.dev !== pathStat.dev || openedStat.ino !== pathStat.ino) return undefined
    let metadata: Record<string, unknown> | undefined
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>
      }
    } catch {
      metadata = undefined
    }
    return { dev: openedStat.dev, ino: openedStat.ino, metadata }
  } finally {
    await handle.close()
  }
}

const matchesObservedLock = (
  current: ObservedLock | undefined,
  observed: ObservedLock,
  ownerId?: string
) => current != null &&
  current.dev === observed.dev &&
  current.ino === observed.ino &&
  (ownerId == null || current.metadata?.ownerId === ownerId)

const cleanupAbandonedLockArtifacts = async (path: string) => {
  const directory = dirname(path)
  const prefix = `${basename(path)}.`
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return
  }
  for (const entry of entries) {
    if (
      !entry.startsWith(prefix) ||
      !(
        entry.endsWith('.create') ||
        entry.endsWith('.tmp') ||
        entry.endsWith('.quarantine')
      )
    ) {
      continue
    }
    const artifactPath = join(directory, entry)
    const observed = await readObservedLock(artifactPath)
    if (observed == null) continue
    const metadata = observed.metadata
    const createdAt = typeof metadata?.createdAt === 'number' ? metadata.createdAt : 0
    if (Date.now() - createdAt > 60_000 && isDeadArtifactOwner(metadata)) {
      await removeClaimedFile(
        artifactPath,
        observed,
        typeof metadata?.ownerId === 'string' ? metadata.ownerId : undefined
      )
    }
  }
}

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const readProcessStartedAt = (pid: number) => {
  try {
    const value = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1_000
    }).trim()
    const startedAt = Date.parse(value)
    return Number.isFinite(startedAt) ? startedAt : undefined
  } catch {
    return undefined
  }
}

const currentProcessStartedAt =
  readProcessStartedAt(process.pid) ??
  Math.round(Date.now() - process.uptime() * 1_000)

const isRecordedProcessAlive = (metadata: Record<string, unknown>) => {
  if (
    metadata.host !== hostname() ||
    typeof metadata.pid !== 'number' ||
    !isProcessAlive(metadata.pid)
  ) {
    return false
  }
  if (typeof metadata.processStartedAt !== 'number') {
    return undefined
  }
  const actualStartedAt = readProcessStartedAt(metadata.pid)
  if (actualStartedAt == null) {
    return undefined
  }
  return Math.abs(actualStartedAt - metadata.processStartedAt) <= 2_000
}

// Artifact files are part of the lock protocol too.  A reused PID must not
// keep a crashed creator/reclaimer alive forever, nor may it authorize us to
// remove a live replacement.  New artifacts always carry this exact identity;
// legacy records without it remain conservative while their PID is alive.
const isDeadArtifactOwner = (metadata: Record<string, unknown> | undefined) => {
  if (metadata == null || typeof metadata.pid !== 'number') return true
  if (metadata.host !== hostname()) return false
  if (!isProcessAlive(metadata.pid)) return true
  return isRecordedProcessAlive(metadata) === false
}

const isSameProcess = (metadata: Record<string, unknown>) =>
  metadata.host === hostname() &&
  metadata.pid === process.pid &&
  metadata.processStartedAt === currentProcessStartedAt

const hasLiveSameHostLeaseOwner = (
  metadata: Record<string, unknown>,
  liveOwnerGraceMs: number
) => {
  const identityAlive = isRecordedProcessAlive(metadata)
  if (identityAlive != null) return identityAlive
  if (
    metadata.host === hostname() &&
    typeof metadata.pid === 'number' &&
    typeof metadata.processStartedAt === 'number' &&
    isProcessAlive(metadata.pid)
  ) {
    return true
  }
  const createdAt = typeof metadata.createdAt === 'number' ? metadata.createdAt : 0
  return isSameProcess(metadata) || (
    metadata.host === hostname() &&
    typeof metadata.pid === 'number' &&
    isProcessAlive(metadata.pid) &&
    Date.now() - createdAt <= liveOwnerGraceMs
  )
}

export const isRuntimeOwnerStale = (
  metadata: RuntimeOwnerMetadata | undefined,
  options: RuntimeLockOptions = {}
) => {
  if (metadata == null) {
    return true
  }

  const staleMs = options.staleMs ?? 30_000
  if (Date.now() - metadata.updatedAt <= staleMs) {
    return false
  }

  if (typeof metadata.pid !== 'number') {
    return true
  }

  const identityAlive = isRecordedProcessAlive(metadata)
  if (identityAlive === false) {
    return true
  }
  if (identityAlive === true) return false
  if (
    metadata.host === hostname() &&
    typeof metadata.processStartedAt === 'number' &&
    isProcessAlive(metadata.pid)
  ) return false

  const liveOwnerGraceMs = options.liveOwnerGraceMs ?? Math.max(staleMs * 4, 60_000)
  return Date.now() - metadata.createdAt > liveOwnerGraceMs
}

const assertLockOwned = async (path: string, ownerId: string) => {
  const current = await readLockMetadata<{ ownerId?: string }>(path)
  if (current?.ownerId !== ownerId) {
    throw new RuntimeStoreLockError(`Lock ownership lost: ${path}`)
  }
}

const listReclaimBarriers = async (path: string) => {
  const directory = dirname(path)
  const prefix = `${basename(path)}.reclaim.`
  const entries = await readdir(directory).catch(() => [] as string[])
  const barriers: Array<{ path: string; observed: ObservedLock }> = []
  for (const entry of entries.filter(entry => entry.startsWith(prefix)).sort()) {
    const barrierPath = join(directory, entry)
    const observed = await readObservedLock(barrierPath)
    if (observed == null) continue
    const metadata = observed.metadata
    const createdAt = typeof metadata?.createdAt === 'number' ? metadata.createdAt : 0
    const dead = isDeadArtifactOwner(metadata)
    if (dead && Date.now() - createdAt > 50) {
      await removeClaimedFile(
        barrierPath,
        observed,
        typeof metadata?.ownerId === 'string' ? metadata.ownerId : undefined
      )
      continue
    }
    barriers.push({ path: barrierPath, observed })
  }
  return barriers
}

const waitForNoReclaimBarrier = async (path: string, startedAt: number, timeoutMs: number) => {
  while ((await listReclaimBarriers(path)).length > 0) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new RuntimeStoreLockError(`Timed out waiting for reclaim barrier: ${path}`)
    }
    await sleep(10)
  }
}

const acquireReclaimBarrier = async (path: string, timeoutMs = 30_000) => {
  const token = randomUUID()
  const startedAt = Date.now()
  const barrierPath = `${path}.reclaim.${token}`
  const metadata = {
    ownerId: token,
    pid: process.pid,
    host: hostname(),
    processStartedAt: currentProcessStartedAt,
    createdAt: startedAt,
    updatedAt: startedAt
  }
  await createAtomicExclusiveFile(barrierPath, JSON.stringify(metadata))
  const observed = await readObservedLock(barrierPath)
  if (observed == null) {
    throw new RuntimeStoreLockError(`Reclaim barrier disappeared: ${barrierPath}`)
  }
  while (true) {
    const barriers = await listReclaimBarriers(path)
    if (barriers[0]?.path === barrierPath) {
      return async () => {
        const current = await readObservedLock(barrierPath)
        if (matchesObservedLock(current, observed, token)) {
          await removeClaimedFile(barrierPath, observed, token)
        }
      }
    }
    if (!barriers.some(barrier => barrier.path === barrierPath)) {
      throw new RuntimeStoreLockError(`Reclaim barrier ownership lost: ${barrierPath}`)
    }
    if (Date.now() - startedAt >= timeoutMs) {
      const current = await readObservedLock(barrierPath)
      if (matchesObservedLock(current, observed, token)) {
        await removeClaimedFile(barrierPath, observed, token)
      }
      throw new RuntimeStoreLockError(`Timed out acquiring reclaim barrier: ${path}`)
    }
    await sleep(10)
  }
}

const refreshOwnedLock = async (
  path: string,
  ownerId: string,
  metadata: Record<string, unknown>
) => {
  const releaseGuard = await acquireReclaimBarrier(path)
  const tempPath = `${path}.${ownerId}.${randomUUID()}.tmp`
  try {
    const observed = await readObservedLock(path)
    if (observed?.metadata?.ownerId !== ownerId) {
      throw new RuntimeStoreLockError(`Lock ownership lost: ${path}`)
    }
    await writeFile(
      tempPath,
      JSON.stringify({ ...metadata, updatedAt: Date.now() }, null, 2),
      { flag: 'wx' }
    )
    const reasserted = await readObservedLock(path)
    if (!matchesObservedLock(reasserted, observed, ownerId)) {
      throw new RuntimeStoreLockError(`Lock ownership changed during refresh: ${path}`)
    }
    await rename(tempPath, path)
  } finally {
    await rm(tempPath, { force: true })
    await releaseGuard()
  }
  await assertLockOwned(path, ownerId)
}

const releaseOwnedLock = async (path: string, ownerId: string) => {
  const releaseGuard = await acquireReclaimBarrier(path)
  try {
    const observed = await readObservedLock(path)
    if (observed?.metadata?.ownerId !== ownerId) return
    const reasserted = await readObservedLock(path)
    if (matchesObservedLock(reasserted, observed, ownerId)) {
      await removeClaimedFile(path, observed, ownerId)
    }
  } finally {
    await releaseGuard()
  }
}

const reclaimObservedLock = async (
  path: string,
  observed: ObservedLock,
  options: RuntimeLockOptions
) => {
  const releaseGuard = await acquireReclaimBarrier(path)
  try {
    await options.testHooks?.afterReclaimBarrierAcquired?.(path)
    const ownerId = typeof observed.metadata?.ownerId === 'string'
      ? observed.metadata.ownerId
      : undefined
    const reasserted = await readObservedLock(path)
    if (!matchesObservedLock(reasserted, observed, ownerId)) return false
    return removeClaimedFile(path, observed, ownerId)
  } finally {
    await releaseGuard()
  }
}

export const acquireLockFile = async (
  path: string,
  metadata: Record<string, unknown>,
  options: RuntimeLockOptions = {}
): Promise<RuntimeLockHandle> => {
  const timeoutMs = options.timeoutMs ?? 2_000
  const staleMs = options.staleMs ?? 5_000
  const liveOwnerGraceMs = options.liveOwnerGraceMs ?? Math.max(staleMs * 4, 60_000)
  const ownerId = randomUUID()
  const start = Date.now()
  await mkdir(dirname(path), { recursive: true })
  await cleanupAbandonedLockArtifacts(path)

  while (true) {
    await waitForNoReclaimBarrier(path, start, timeoutMs)
    const now = Date.now()
    const nextMetadata = {
      ...metadata,
      ownerId,
      pid: process.pid,
      host: hostname(),
      processStartedAt: currentProcessStartedAt,
      createdAt: now,
      updatedAt: now
    }
    try {
      await createAtomicExclusiveFile(path, JSON.stringify(nextMetadata, null, 2))
      const created = await readObservedLock(path)
      await options.testHooks?.afterCreateBeforeBarrierScan?.(path)
      const barriersAfterCreate = await listReclaimBarriers(path)
      if (barriersAfterCreate.length > 0) {
        if (created?.metadata?.ownerId === ownerId) {
          await removeClaimedFile(path, created, ownerId)
        }
        await sleep(10)
        continue
      }
      let released = false
      let refreshError: unknown
      let pendingRefresh = Promise.resolve()
      const refresh = async () => {
        if (released) {
          throw new RuntimeStoreLockError(`Cannot refresh released lock: ${path}`)
        }
        await refreshOwnedLock(path, ownerId, nextMetadata)
      }
      const refreshIntervalMs = Math.max(10, Math.floor(staleMs / 3))
      const refreshTimer = options.autoRefresh === false
        ? undefined
        : setInterval(() => {
            pendingRefresh = pendingRefresh
              .then(refresh)
              .catch((error) => {
                refreshError = error
              })
          }, refreshIntervalMs)
      refreshTimer?.unref()
      return {
        path,
        assertOwned: async () => {
          if (refreshError != null) {
            throw refreshError
          }
          await pendingRefresh
          await assertLockOwned(path, ownerId)
        },
        refresh,
        release: async () => {
          released = true
          if (refreshTimer != null) clearInterval(refreshTimer)
          await pendingRefresh
          await releaseOwnedLock(path, ownerId)
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }

      const observed = await readObservedLock(path)
      const current = observed?.metadata
      const updatedAt = typeof current?.updatedAt === 'number' ? current.updatedAt : 0
      const leaseExpired = Date.now() - updatedAt > staleMs
      const isStale = options.isStale?.(current) ??
        (leaseExpired && (current == null || !hasLiveSameHostLeaseOwner(current, liveOwnerGraceMs)))
      if (isStale && observed != null && await reclaimObservedLock(path, observed, options)) {
        continue
      }

      if (Date.now() - start >= timeoutMs) {
        throw new RuntimeStoreLockError(`Timed out acquiring lock: ${path}`)
      }
      await sleep(10)
    }
  }
}

export const acquireLockFiles = async (
  requests: RuntimeLockRequest[],
  options: RuntimeLockOptions = {}
) => {
  const ordered = [...requests].sort((left, right) => left.path.localeCompare(right.path))
  const locks: RuntimeLockHandle[] = []
  try {
    for (const request of ordered) {
      locks.push(await acquireLockFile(request.path, request.metadata, options))
    }
  } catch (error) {
    await Promise.allSettled(locks.reverse().map(lock => lock.release()))
    throw error
  }

  return {
    getLock: (lockPath: string) => locks.find(lock => lock.path === lockPath),
    assertOwned: async () => {
      for (const lock of locks) {
        await lock.assertOwned()
      }
    },
    release: async () => {
      for (const lock of [...locks].reverse()) {
        await lock.release()
      }
    }
  }
}

export const createOwnerMetadata = (runtimeId: string): RuntimeOwnerMetadata => ({
  runtimeId,
  pid: process.pid,
  host: hostname(),
  processStartedAt: currentProcessStartedAt,
  createdAt: Date.now(),
  updatedAt: Date.now()
})
