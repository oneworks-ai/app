import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, posix, resolve, sep, win32 } from 'node:path'
import process from 'node:process'

import type { DevStartTarget } from './types'

export const repoRoot = process.cwd()
export const logDir = join(repoRoot, '.logs')
export const normalizeText = (value: unknown) =>
  typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined
export const normalizeFilesystemPath = (value: unknown) => {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const windowsFamily = /^[a-z]:[\\/]/iu.test(value) || value.startsWith('\\') || (
    sep === '\\' && !value.startsWith('/')
  )
  const root = windowsFamily ? win32.parse(value).root : posix.parse(value).root
  let end = value.length
  while (end > root.length) {
    const character = value[end - 1]
    if (character !== '/' && (!windowsFamily || character !== '\\')) break
    end -= 1
  }
  return value.slice(0, end)
}
export const machineServiceDir = join(
  resolve(
    normalizeFilesystemPath(process.env.__ONEWORKS_PROJECT_REAL_HOME__) ??
      normalizeFilesystemPath(process.env.HOME) ?? homedir()
  ),
  '.oneworks/dev-service'
)
export const worktreeRegistryDir = join(machineServiceDir, 'worktrees')
export const serviceChildArg = '--service-child'
export const clientBase = '/ui'

export const isMachineScopedTarget = (target: DevStartTarget) => (
  target === 'android-emulator' || target === 'electron' || target === 'electron-workspace'
)

export const worktreeServiceDir = (root = repoRoot) =>
  join(
    worktreeRegistryDir,
    createHash('sha256').update(resolve(root)).digest('hex').slice(0, 24)
  )

export const targetStateDir = (target: DevStartTarget, root = repoRoot) => (
  isMachineScopedTarget(target) ? machineServiceDir : join(resolve(root), '.logs')
)

export const legacyStatePath = (target: DevStartTarget, root = repoRoot) => (
  join(targetStateDir(target, root), `dev-start-${target}.json`)
)
export const statePath = (target: DevStartTarget, root = repoRoot) =>
  join(
    isMachineScopedTarget(target) ? machineServiceDir : worktreeServiceDir(root),
    `dev-start-${target}.json`
  )
export const managerLogPath = (target: DevStartTarget) =>
  join(
    targetStateDir(target),
    `dev-start-${target}.log`
  )
export const componentLogPath = (target: DevStartTarget, component: string) =>
  join(
    targetStateDir(target),
    `dev-start-${target}.${component}.log`
  )
export const eventsPath = (target: DevStartTarget, root = repoRoot) =>
  join(
    targetStateDir(target, root),
    `dev-start-${target}.events.jsonl`
  )
export const resourceKey = (target: DevStartTarget) => (
  target === 'electron' || target === 'electron-workspace'
    ? 'electron-family'
    : target === 'web' || target === 'daemon'
    ? 'manager-family'
    : target
)
export const registryEventsPath = (target: DevStartTarget, root = repoRoot) =>
  join(
    isMachineScopedTarget(target) ? machineServiceDir : worktreeServiceDir(root),
    `dev-start-${target}.events.jsonl`
  )
export const leasePath = (target: DevStartTarget, root = repoRoot) =>
  join(
    target === 'electron' || target === 'electron-workspace'
      ? machineServiceDir
      : worktreeServiceDir(root),
    target === 'electron' || target === 'electron-workspace'
      ? 'dev-start-electron-family.operation.lock'
      : `dev-start-${resourceKey(target)}.operation.lock`
  )
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
export const log = (message: string) => {
  if (process.env.ONEWORKS_DEV_SERVICE_JSON !== '1') console.log(`[dev-start] ${message}`)
}
