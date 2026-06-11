import type { ChildProcess, SpawnSyncOptions } from 'node:child_process'
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'

import { repoRoot, statePath } from './paths'
import type { DevStartState, DevStartTarget } from './types'

export const runSync = (
  command: string,
  args: string[],
  options: {
    allowFailure?: boolean
    cwd?: string
    env?: NodeJS.ProcessEnv
    stdio?: SpawnSyncOptions['stdio']
  } = {}
) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: options.stdio ?? 'inherit'
  })
  if (result.error != null) throw result.error
  if (!options.allowFailure && result.status !== 0) process.exit(result.status ?? 1)
  return result
}

export const readSync = (
  command: string,
  args: string[],
  options: {
    cwd?: string
    env?: NodeJS.ProcessEnv
  } = {}
) => {
  const result = runSync(command, args, {
    ...options,
    allowFailure: true,
    stdio: 'pipe'
  })
  if (result.status !== 0 || result.stdout == null) return undefined
  return result.stdout.toString().trim()
}

export const readJson = (path: string) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

export const readState = (target: DevStartTarget) => {
  const value = readJson(statePath(target))
  if (value == null || typeof value !== 'object') return undefined
  return value as DevStartState
}

export const writeJsonAtomic = (path: string, value: unknown) => {
  const tempPath = `${path}.tmp-${process.pid}`
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(tempPath, path)
}

export const isPositivePid = (pid: number | undefined): pid is number =>
  typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && pid !== process.pid

export const killPid = (pid: number | undefined) => {
  if (!isPositivePid(pid)) return
  try {
    process.kill(pid, 'SIGTERM')
  } catch {}
}

export const openAppendFd = (path: string) => {
  mkdirSync(dirname(path), { recursive: true })
  return openSync(path, 'a')
}

export const spawnLogged = ({
  args,
  command,
  cwd,
  env,
  logPath
}: {
  args: string[]
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
  logPath: string
}) => {
  const logFd = openAppendFd(logPath)
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', logFd, logFd]
  })
  child.once('close', () => closeSync(logFd))
  return child
}

export const spawnDetachedLogged = ({
  args,
  command,
  cwd,
  env,
  logPath
}: {
  args: string[]
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
  logPath: string
}): ChildProcess => {
  const logFd = openAppendFd(logPath)
  const child = spawn(command, args, {
    cwd,
    detached: true,
    env,
    stdio: ['ignore', logFd, logFd]
  })
  closeSync(logFd)
  child.unref()
  return child
}
