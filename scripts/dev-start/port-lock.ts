import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

import { normalizeText, repoRoot, sleep } from './paths'

const PORT_LOCK_TIMEOUT_MS = 120_000
const PORT_LOCK_STALE_MS = 5_000
const PORT_LOCK_POLL_MS = 200

const isPidRunning = (pid: unknown) => {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const resolvePortLockPath = () => {
  const realHome = normalizeText(process.env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    normalizeText(process.env.HOME) ??
    homedir() ??
    repoRoot
  return join(resolve(realHome), '.oneworks/dev-start-port-resolution.lock')
}

const readLockOwner = async (lockPath: string) => {
  try {
    const value = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')) as unknown
    return value != null && typeof value === 'object' && !Array.isArray(value)
      ? value as { pid?: unknown; startedAt?: unknown }
      : undefined
  } catch {
    return undefined
  }
}

const acquirePortLock = async () => {
  const lockPath = resolvePortLockPath()
  const startedAt = Date.now()

  while (Date.now() - startedAt < PORT_LOCK_TIMEOUT_MS) {
    try {
      await mkdir(dirname(lockPath), { recursive: true })
      await mkdir(lockPath, { recursive: false })
      await writeFile(
        join(lockPath, 'owner.json'),
        `${JSON.stringify({ pid: process.pid, startedAt: Date.now() }, null, 2)}\n`
      )
      return async () => {
        await rm(lockPath, { recursive: true, force: true })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const owner = await readLockOwner(lockPath)
      const lockStat = await stat(lockPath).catch(() => undefined)
      const startedAtValue = typeof owner?.startedAt === 'number' ? owner.startedAt : lockStat?.mtimeMs ?? Date.now()
      if (!isPidRunning(owner?.pid) && Date.now() - startedAtValue > PORT_LOCK_STALE_MS) {
        await rm(lockPath, { recursive: true, force: true })
        continue
      }
      await sleep(PORT_LOCK_POLL_MS)
    }
  }

  throw new Error('Timed out waiting for dev-start port resolution lock.')
}

export const withDevStartPortLock = async <T>(fn: () => Promise<T>) => {
  const release = await acquirePortLock()
  try {
    return await fn()
  } finally {
    await release()
  }
}
