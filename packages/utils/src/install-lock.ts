import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

const DEFAULT_LOCK_TIMEOUT_MS = 30_000
const DEFAULT_LOCK_RETRY_MS = 100
const LOCK_METADATA_FILENAME = '.oneworks-lock.json'

export class DirectoryInstallLockBusyError extends Error {
  constructor(public readonly lockDir: string) {
    super(`Timed out waiting for install lock ${lockDir}`)
    this.name = 'DirectoryInstallLockBusyError'
  }
}

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const writeLockMetadata = async (lockDir: string) => {
  await writeFile(
    resolve(lockDir, LOCK_METADATA_FILENAME),
    JSON.stringify({
      createdAt: Date.now(),
      pid: process.pid
    }),
    'utf8'
  )
}

const clearStaleLock = async (lockDir: string, timeoutMs: number) => {
  const lockStat = await stat(lockDir).catch(() => undefined)
  if (lockStat == null) return false

  const metadata = await readFile(resolve(lockDir, LOCK_METADATA_FILENAME), 'utf8')
    .then(content => JSON.parse(content) as { createdAt?: number; pid?: number })
    .catch(() => undefined)
  const createdAt = typeof metadata?.createdAt === 'number' ? metadata.createdAt : lockStat.mtimeMs
  if (Date.now() - createdAt < timeoutMs) {
    return false
  }

  if (typeof metadata?.pid === 'number' && isProcessAlive(metadata.pid)) {
    return false
  }

  await rm(lockDir, { recursive: true, force: true })
  return true
}

export const withDirectoryInstallLock = async <T>(params: {
  lockDir: string
  retryMs?: number
  staleTimeoutMs?: number
  timeoutMs?: number
  waitTimeoutMs?: number
}, callback: () => Promise<T>) => {
  const staleTimeoutMs = params.staleTimeoutMs ?? params.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS
  const waitTimeoutMs = params.waitTimeoutMs ?? params.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS
  const retryMs = params.retryMs ?? DEFAULT_LOCK_RETRY_MS
  const start = Date.now()

  await mkdir(dirname(params.lockDir), { recursive: true })

  while (true) {
    try {
      await mkdir(params.lockDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (await clearStaleLock(params.lockDir, staleTimeoutMs)) {
        continue
      }
      if (Date.now() - start >= waitTimeoutMs) {
        throw new DirectoryInstallLockBusyError(params.lockDir)
      }
      await delay(retryMs)
      continue
    }

    try {
      await writeLockMetadata(params.lockDir)
    } catch (error) {
      await rm(params.lockDir, { recursive: true, force: true })
      throw error
    }
    break
  }

  try {
    return await callback()
  } finally {
    await rm(params.lockDir, { recursive: true, force: true })
  }
}
