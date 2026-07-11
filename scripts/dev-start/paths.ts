import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

import type { DevStartTarget } from './types'

export const repoRoot = process.cwd()
export const logDir = join(repoRoot, '.logs')
export const normalizeText = (value: unknown) =>
  typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined
export const machineServiceDir = join(
  resolve(normalizeText(process.env.__ONEWORKS_PROJECT_REAL_HOME__) ?? process.env.HOME ?? homedir()),
  '.oneworks/dev-service'
)
export const serviceChildArg = '--service-child'
export const clientBase = '/ui'

export const isMachineScopedTarget = (target: DevStartTarget) => (
  target === 'android-emulator' || target === 'electron' || target === 'electron-workspace'
)

export const targetStateDir = (target: DevStartTarget) => isMachineScopedTarget(target) ? machineServiceDir : logDir

export const statePath = (target: DevStartTarget) => join(targetStateDir(target), `dev-start-${target}.json`)
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
export const eventsPath = (target: DevStartTarget) =>
  join(
    targetStateDir(target),
    `dev-start-${target}.events.jsonl`
  )
export const resourceKey = (target: DevStartTarget) => (
  target === 'electron' || target === 'electron-workspace'
    ? 'electron-family'
    : target === 'web' || target === 'daemon'
    ? 'manager-family'
    : target
)
export const leasePath = (target: DevStartTarget) =>
  join(
    target === 'electron' || target === 'electron-workspace' ? machineServiceDir : targetStateDir(target),
    target === 'electron' || target === 'electron-workspace'
      ? 'dev-start-electron-family.operation.lock'
      : `dev-start-${resourceKey(target)}.operation.lock`
  )
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
export const log = (message: string) => {
  if (process.env.ONEWORKS_DEV_SERVICE_JSON !== '1') console.log(`[dev-start] ${message}`)
}
