import type { LogLevel } from '@oneworks/types'

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const satisfies readonly LogLevel[]

export type { LogLevel } from '@oneworks/types'

export function normalizeLogLevel(value: unknown): LogLevel | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return LOG_LEVELS.includes(normalized as LogLevel)
    ? normalized as LogLevel
    : undefined
}

export function resolveServerLogLevel(
  env: {
    __ONEWORKS_PROJECT_SERVER_LOG_LEVEL__?: unknown
    __ONEWORKS_PROJECT_SERVER_DEBUG__?: unknown
  },
  fallback: LogLevel = 'info'
): LogLevel {
  if (env.__ONEWORKS_PROJECT_SERVER_DEBUG__ === true || env.__ONEWORKS_PROJECT_SERVER_DEBUG__ === 'true') {
    return 'debug'
  }

  return normalizeLogLevel(env.__ONEWORKS_PROJECT_SERVER_LOG_LEVEL__) ?? fallback
}
