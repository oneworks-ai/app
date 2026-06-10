import { join } from 'node:path'
import process from 'node:process'

import type { DevStartTarget } from './types'

export const repoRoot = process.cwd()
export const logDir = join(repoRoot, '.logs')
export const serviceChildArg = '--service-child'
export const clientBase = '/ui'

export const statePath = (target: DevStartTarget) => join(logDir, `dev-start-${target}.json`)
export const managerLogPath = (target: DevStartTarget) => join(logDir, `dev-start-${target}.log`)

export const normalizeText = (value: unknown) =>
  typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
export const log = (message: string) => console.log(`[dev-start] ${message}`)
