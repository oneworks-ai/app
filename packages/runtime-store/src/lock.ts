import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname } from 'node:path'
import process from 'node:process'

import type { RuntimeOwnerMetadata } from './types'

export interface RuntimeLockHandle {
  path: string
  refresh: () => Promise<void>
  release: () => Promise<void>
}

export interface RuntimeLockOptions {
  isStale?: (metadata: Record<string, unknown> | undefined) => boolean
  staleMs?: number
  timeoutMs?: number
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

const readLockMetadata = async <T>(path: string) => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return undefined
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

  return !isProcessAlive(metadata.pid)
}

export const acquireLockFile = async (
  path: string,
  metadata: Record<string, unknown>,
  options: RuntimeLockOptions = {}
): Promise<RuntimeLockHandle> => {
  const timeoutMs = options.timeoutMs ?? 2_000
  const staleMs = options.staleMs ?? 5_000
  const ownerId = randomUUID()
  const start = Date.now()
  await mkdir(dirname(path), { recursive: true })

  while (true) {
    const nextMetadata = { ...metadata, ownerId, updatedAt: Date.now() }
    try {
      await writeFile(path, JSON.stringify(nextMetadata, null, 2), { flag: 'wx' })
      return {
        path,
        refresh: async () => {
          await writeFile(path, JSON.stringify({ ...nextMetadata, updatedAt: Date.now() }, null, 2))
        },
        release: async () => {
          const current = await readLockMetadata<{ ownerId?: string }>(path)
          if (current?.ownerId === ownerId) {
            await rm(path, { force: true })
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }

      const current = await readLockMetadata<Record<string, unknown>>(path)
      const updatedAt = typeof current?.updatedAt === 'number' ? current.updatedAt : 0
      const isStale = options.isStale?.(current) ?? Date.now() - updatedAt > staleMs
      if (isStale) {
        await rm(path, { force: true })
        continue
      }

      if (Date.now() - start >= timeoutMs) {
        throw new RuntimeStoreLockError(`Timed out acquiring lock: ${path}`)
      }
      await sleep(10)
    }
  }
}

export const createOwnerMetadata = (runtimeId: string): RuntimeOwnerMetadata => ({
  runtimeId,
  pid: process.pid,
  host: hostname(),
  createdAt: Date.now(),
  updatedAt: Date.now()
})
