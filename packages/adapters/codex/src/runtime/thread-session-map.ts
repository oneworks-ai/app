import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'

import type { TaskRuntime } from '@oneworks/types'

export interface CodexThreadSessionBinding {
  env?: Record<string, string>
  runtime: TaskRuntime
  sessionId: string
}

type CodexThreadSessionMap = Record<string, CodexThreadSessionBinding>

const pendingKey = (cwd: string) => `__oneworks_pending__:${cwd}`

const updateChains = new Map<string, Promise<void>>()

const readThreadSessionMap = async (path: string): Promise<CodexThreadSessionMap> => {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as CodexThreadSessionMap
      : {}
  } catch {
    return {}
  }
}

const writeThreadSessionMap = async (path: string, value: CodexThreadSessionMap) => {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(tempPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(tempPath, path)
  } finally {
    await unlink(tempPath).catch(() => undefined)
  }
}

const updateThreadSessionMap = (
  path: string,
  update: (current: CodexThreadSessionMap) => CodexThreadSessionMap
) => {
  const previous = updateChains.get(path) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await writeThreadSessionMap(path, update(await readThreadSessionMap(path)))
    })
  updateChains.set(path, next)
  return next.finally(() => {
    if (updateChains.get(path) === next) updateChains.delete(path)
  })
}

export const registerCodexThreadSession = (
  path: string,
  threadId: string,
  binding: CodexThreadSessionBinding
) => updateThreadSessionMap(path, current => ({
  ...current,
  [threadId]: binding
}))

export const unregisterCodexThreadSession = (
  path: string,
  threadId: string,
  sessionId: string
) => updateThreadSessionMap(path, current => {
  if (current[threadId]?.sessionId !== sessionId) return current
  const { [threadId]: _removed, ...rest } = current
  return rest
})

export const registerPendingCodexThreadSession = (
  path: string,
  cwd: string,
  binding: CodexThreadSessionBinding
) => registerCodexThreadSession(path, pendingKey(cwd), binding)

export const unregisterPendingCodexThreadSession = (
  path: string,
  cwd: string,
  sessionId: string
) => unregisterCodexThreadSession(path, pendingKey(cwd), sessionId)

export const resolveCodexThreadSession = async (
  path: string | undefined,
  threadId: string,
  cwd?: string
) => {
  if (path == null) return undefined
  const current = await readThreadSessionMap(path)
  return current[threadId] ?? (cwd == null ? undefined : current[pendingKey(cwd)])
}
