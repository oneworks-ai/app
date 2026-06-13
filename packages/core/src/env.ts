import { cwd as processCwd, env as processEnv } from 'node:process'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'
import type { LogLevel } from '@oneworks/utils/log-level'
import { normalizeLogLevel } from '@oneworks/utils/log-level'

export type { LogLevel } from '@oneworks/utils/log-level'
export { normalizeLogLevel, resolveServerLogLevel } from '@oneworks/utils/log-level'

export interface ServerEnv {
  __ONEWORKS_PROJECT_SERVER_HOST__: string
  __ONEWORKS_PROJECT_SERVER_PORT__: number
  __ONEWORKS_PROJECT_SERVER_WS_PATH__: string
  __ONEWORKS_PROJECT_PUBLIC_BASE_URL__?: string
  __ONEWORKS_PROJECT_SERVER_ACTION_SECRET__?: string
  __ONEWORKS_PROJECT_SERVER_DATA_DIR__: string
  __ONEWORKS_PROJECT_SERVER_LOG_DIR__: string
  __ONEWORKS_PROJECT_SERVER_LOG_LEVEL__: LogLevel
  __ONEWORKS_PROJECT_SERVER_DEBUG__: boolean
  __ONEWORKS_PROJECT_SERVER_ALLOW_CORS__: boolean
  __ONEWORKS_PROJECT_SERVER_CORS_ORIGIN__?: string
  __ONEWORKS_PROJECT_SERVER_ROLE__?: 'manager' | 'workspace'
  __ONEWORKS_PROJECT_CLIENT_MODE__?: 'dev' | 'none' | 'static' | 'standalone' | 'independent' | 'desktop'
  __ONEWORKS_PROJECT_CLIENT_BASE__?: string
  __ONEWORKS_PROJECT_CLIENT_DIST_PATH__?: string
}

export function loadEnv(): ServerEnv {
  const defaultDataDir = resolveProjectHomePath(processCwd(), processEnv, 'server', 'data')
  const defaultLogDir = resolveProjectHomePath(processCwd(), processEnv, 'logs', 'server')
  const {
    __ONEWORKS_PROJECT_SERVER_HOST__ = 'localhost',
    __ONEWORKS_PROJECT_SERVER_PORT__ = '8787',
    __ONEWORKS_PROJECT_SERVER_WS_PATH__ = '/ws',
    __ONEWORKS_PROJECT_PUBLIC_BASE_URL__,
    __ONEWORKS_PROJECT_SERVER_ACTION_SECRET__,
    __ONEWORKS_PROJECT_SERVER_DATA_DIR__ = defaultDataDir,
    __ONEWORKS_PROJECT_SERVER_LOG_DIR__ = defaultLogDir,
    __ONEWORKS_PROJECT_SERVER_LOG_LEVEL__ = 'info',
    __ONEWORKS_PROJECT_SERVER_DEBUG__,
    __ONEWORKS_PROJECT_SERVER_ALLOW_CORS__,
    __ONEWORKS_PROJECT_SERVER_CORS_ORIGIN__,
    __ONEWORKS_PROJECT_SERVER_ROLE__ = 'workspace',
    __ONEWORKS_PROJECT_CLIENT_MODE__ = 'static',
    __ONEWORKS_PROJECT_CLIENT_BASE__,
    __ONEWORKS_PROJECT_CLIENT_DIST_PATH__
  } = processEnv || {}
  return {
    __ONEWORKS_PROJECT_SERVER_HOST__,
    __ONEWORKS_PROJECT_SERVER_PORT__: Number(__ONEWORKS_PROJECT_SERVER_PORT__),
    __ONEWORKS_PROJECT_SERVER_WS_PATH__,
    __ONEWORKS_PROJECT_PUBLIC_BASE_URL__,
    __ONEWORKS_PROJECT_SERVER_ACTION_SECRET__,
    __ONEWORKS_PROJECT_SERVER_DATA_DIR__,
    __ONEWORKS_PROJECT_SERVER_LOG_DIR__,
    __ONEWORKS_PROJECT_SERVER_LOG_LEVEL__: normalizeLogLevel(__ONEWORKS_PROJECT_SERVER_LOG_LEVEL__) ?? 'info',
    __ONEWORKS_PROJECT_SERVER_DEBUG__: __ONEWORKS_PROJECT_SERVER_DEBUG__ === 'true',
    __ONEWORKS_PROJECT_SERVER_ALLOW_CORS__: __ONEWORKS_PROJECT_SERVER_ALLOW_CORS__ != null
      ? __ONEWORKS_PROJECT_SERVER_ALLOW_CORS__ === 'true'
      : true,
    __ONEWORKS_PROJECT_SERVER_CORS_ORIGIN__,
    __ONEWORKS_PROJECT_SERVER_ROLE__: __ONEWORKS_PROJECT_SERVER_ROLE__ === 'manager' ? 'manager' : 'workspace',
    __ONEWORKS_PROJECT_CLIENT_MODE__: __ONEWORKS_PROJECT_CLIENT_MODE__ as ServerEnv['__ONEWORKS_PROJECT_CLIENT_MODE__'],
    __ONEWORKS_PROJECT_CLIENT_BASE__,
    __ONEWORKS_PROJECT_CLIENT_DIST_PATH__
  }
}
