import fs from 'node:fs'
import path from 'node:path'
import process, { cwd as processCwd } from 'node:process'

import pino from 'pino'

import { loadEnv } from '@oneworks/core'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'
import { resolveServerLogLevel } from '@oneworks/utils/log-level'

const env = loadEnv()
const logLevel = resolveServerLogLevel(env)
const resolveServerLogDir = () => {
  const configuredLogDir = process.env.__ONEWORKS_PROJECT_SERVER_LOG_DIR__?.trim()
  if (configuredLogDir == null || configuredLogDir === '') {
    return resolveProjectHomePath(processCwd(), process.env, 'logs', 'server')
  }

  return path.isAbsolute(configuredLogDir)
    ? configuredLogDir
    : path.join(processCwd(), configuredLogDir)
}
const __ONEWORKS_PROJECT_SERVER_LOG_DIR__ = resolveServerLogDir()

// Ensure base log directory exists
if (!fs.existsSync(__ONEWORKS_PROJECT_SERVER_LOG_DIR__)) {
  fs.mkdirSync(__ONEWORKS_PROJECT_SERVER_LOG_DIR__, { recursive: true })
}

/**
 * Get a logger instance for a specific session and log type
 */
export function getSessionLogger(sessionId: string, type: 'server' | 'claude.cli.spawn') {
  const sessionDir = path.join(__ONEWORKS_PROJECT_SERVER_LOG_DIR__, sessionId)

  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true })
  }

  const logFile = path.join(sessionDir, `${type}.log.jsonl`)

  return pino(
    {
      level: logLevel,
      base: null, // Remove default pid and hostname for cleaner jsonl
      timestamp: pino.stdTimeFunctions.isoTime
    },
    pino.destination({
      dest: logFile,
      sync: true // 使用同步写入确保实时性，且避免丢失
    })
  )
}

// Default global logger for general server logs (not session-specific)
export const logger = pino({
  level: logLevel,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true
    }
  }
})
