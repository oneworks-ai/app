import { performance } from 'node:perf_hooks'
import process from 'node:process'

import type { Config } from '@oneworks/types'

import { createLogger } from './create-logger'

export const STARTUP_PROFILE_ENV_NAME = 'ONEWORKS_STARTUP_PROFILE'
export const STARTUP_PROFILE_CONSOLE_ENV_NAME = 'ONEWORKS_STARTUP_PROFILE_CONSOLE'
export const STARTUP_PROFILE_LOG_ENV_NAME = 'ONEWORKS_STARTUP_PROFILE_LOG'
export const STARTUP_PROFILE_THRESHOLD_ENV_NAME = 'ONEWORKS_STARTUP_PROFILE_THRESHOLD_MS'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off'])

const parseBooleanEnv = (value: string | null | undefined) => {
  const normalized = value?.trim().toLowerCase()
  if (normalized == null || normalized === '') return undefined
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  return undefined
}

const parseThreshold = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

const normalizeConfig = (config: Config | undefined) => {
  const startupProfile = config?.diagnostics?.startupProfile
  if (typeof startupProfile === 'boolean') {
    return {
      enabled: startupProfile
    }
  }

  if (startupProfile != null && typeof startupProfile === 'object' && !Array.isArray(startupProfile)) {
    return startupProfile
  }

  return undefined
}

export interface StartupProfilerOptions {
  config?: Config
  cwd: string
  ctxId?: string
  env?: Record<string, string | null | undefined>
  sessionId?: string
}

export interface StartupProfiler {
  enabled: boolean
  mark: (name: string, startedAt: number, details?: Record<string, unknown>) => void
  now: () => number
}

export const nowStartupMs = () => performance.now()

export const createStartupProfiler = (options: StartupProfilerOptions): StartupProfiler => {
  const env = options.env ?? process.env
  const envEnabled = parseBooleanEnv(env[STARTUP_PROFILE_ENV_NAME])
  const config = normalizeConfig(options.config)
  const enabled = envEnabled ?? config?.enabled ?? false
  const thresholdMs = parseThreshold(env[STARTUP_PROFILE_THRESHOLD_ENV_NAME]) ?? parseThreshold(config?.thresholdMs) ??
    0

  if (!enabled) {
    return {
      enabled: false,
      mark: () => {},
      now: nowStartupMs
    }
  }

  const writeConsole = parseBooleanEnv(env[STARTUP_PROFILE_CONSOLE_ENV_NAME]) ?? config?.console ?? envEnabled === true
  const writeLog = parseBooleanEnv(env[STARTUP_PROFILE_LOG_ENV_NAME]) ?? config?.log ?? true
  const logger = writeLog
    ? createLogger(
      options.cwd,
      `${options.ctxId ?? env.__ONEWORKS_PROJECT_CTX_ID__ ?? options.sessionId ?? 'startup'}/startup`,
      options.sessionId ?? env.__ONEWORKS_PROJECT_SESSION_ID__ ?? 'default',
      '',
      'info',
      env
    )
    : undefined

  const mark = (name: string, startedAt: number, details: Record<string, unknown> = {}) => {
    const durationMs = nowStartupMs() - startedAt
    if (durationMs < thresholdMs) {
      return
    }

    const payload = {
      name,
      durationMs: Number(durationMs.toFixed(1)),
      ...details
    }
    if (writeConsole) {
      console.error(`[ow startup] ${name} ${payload.durationMs}ms`)
    }
    logger?.info(payload, '[startup-profile]')
  }

  return {
    enabled: true,
    mark,
    now: nowStartupMs
  }
}
