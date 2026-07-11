/* eslint-disable max-lines -- process execution and legacy state discovery share lifecycle identity boundaries. */
import type { ChildProcess, SpawnSyncOptions } from 'node:child_process'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import process from 'node:process'

import { repoRoot, statePath } from './paths'
import { processCwd, processFingerprint } from './process-identity'
import type { DevStartState, DevStartTarget } from './types'

const jsonOutputEnabled = () => process.env.ONEWORKS_DEV_SERVICE_JSON === '1'

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
    stdio: options.stdio ?? (jsonOutputEnabled() ? ['ignore', 'pipe', 'pipe'] : 'inherit')
  })
  if (result.error != null) throw result.error
  if (!options.allowFailure && result.status !== 0) {
    const error = new Error(`${command} exited with status ${result.status ?? 'unknown'}.`)
    Object.assign(error, { command, status: result.status ?? 1 })
    throw error
  }
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

export const resolveLegacyElectronState = (
  candidates: DevStartState[],
  target: 'electron' | 'electron-workspace'
): DevStartState | undefined => {
  const liveProcesses = candidates.flatMap(candidate =>
    [
      candidate.servicePid,
      candidate.serverPid,
      candidate.clientPid,
      candidate.desktopPid,
      ...(candidate.components ?? []).map(component => component.pid)
    ].flatMap((pid) => {
      if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return []
      try {
        process.kill(pid, 0)
        if (candidate.root == null) return []
        const cwd = processCwd(pid)
        const ownerRoot = resolve(candidate.root)
        if (cwd == null || (resolve(cwd) !== ownerRoot && !resolve(cwd).startsWith(`${ownerRoot}${sep}`))) return []
        const fingerprint = processFingerprint(pid)
        const recordedFingerprint = candidate.components?.find(component => component.pid === pid)?.fingerprint
        if (recordedFingerprint != null && recordedFingerprint !== fingerprint) return []
        return fingerprint == null ? [] : [{ candidate, fingerprint, pid }]
      } catch {
        return []
      }
    })
  )
  const uniqueProcesses = new Map<string, typeof liveProcesses[number]>()
  for (const entry of liveProcesses) {
    const identity = `${entry.pid}:${entry.fingerprint}`
    if (!uniqueProcesses.has(identity)) uniqueProcesses.set(identity, entry)
  }
  const owners = [...uniqueProcesses.values()]
  if (owners.length === 1) return owners[0]!.candidate
  if (owners.length > 1) {
    return {
      components: owners.map((entry, index) => ({
        fingerprint: entry.fingerprint,
        id: `legacy-${target}-${index + 1}`,
        kind: 'process',
        metadata: {
          ownerRoot: entry.candidate.root ?? 'unknown'
        },
        pid: entry.pid
      })),
      error: `Multiple live legacy ${target} owners require one explicitly authorized unified stop.`,
      ownerRoot: owners.map(entry => entry.candidate.root ?? 'unknown').join(','),
      phase: 'failed',
      root: repoRoot,
      target
    }
  }
  return candidates.find(candidate => candidate.root === repoRoot) ?? candidates[0]
}

export const readState = (target: DevStartTarget) => {
  const value = readJson(statePath(target))
  if (value != null && typeof value === 'object') return value as DevStartState
  if (target !== 'electron' && target !== 'electron-workspace') return undefined

  // Electron state was worktree-local before it became a machine-scoped
  // single-instance resource. Discover legacy snapshots across git worktrees so
  // an upgrade cannot start a second Electron process or make the old one
  // impossible to stop explicitly.
  const worktrees = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe'
  })
  if (worktrees.status !== 0) return undefined
  const candidates = (worktrees.stdout ?? '')
    .split('\n')
    .filter(line => line.startsWith('worktree '))
    .map(line => join(line.slice('worktree '.length), '.logs', `dev-start-${target}.json`))
    .map(path => readJson(path))
    .filter((entry): entry is DevStartState => (
      entry != null && typeof entry === 'object' && (entry as DevStartState).target === target
    ))
  if (candidates.length === 0) return undefined
  return resolveLegacyElectronState(candidates, target)
}

export const writeJsonAtomic = (path: string, value: unknown) => {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(tempPath, path)
}

export const isPositivePid = (pid: number | undefined): pid is number =>
  typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && pid !== process.pid

export const waitForChildSpawn = async (child: ChildProcess, name: string) => {
  if (child.pid == null) throw new Error(`${name} did not receive a process id.`)
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      child.off('spawn', onSpawn)
      reject(error)
    }
    const onSpawn = () => {
      child.off('error', onError)
      resolve()
    }
    child.once('error', onError)
    child.once('spawn', onSpawn)
  })
  return child
}

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
