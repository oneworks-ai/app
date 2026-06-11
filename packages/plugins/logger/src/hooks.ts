import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'

import { definePlugin } from '@oneworks/hooks'

interface LoggerLike {
  info: (...args: unknown[]) => void
  stream?: NodeJS.WritableStream
  paths?: {
    logFilePath?: string
    logsRoot?: string
    cachesRoot?: string
  }
}

interface ExternalLogPayloadRef {
  $loggerPayloadRef: true
  path: string
  hash: string
  bytes: number
  type: string
}

interface LoggerPluginOptions {
  externalizeLargePayloads: boolean
  largePayloadByteLimit: number
}

const asRecord = (value: unknown): Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)

const REDACTED = '[REDACTED]'
const DEFAULT_LARGE_LOG_PAYLOAD_BYTE_LIMIT = 64 * 1024
const SENSITIVE_KEY_PATTERN = /api[-_]?key|token|secret|authorization|password|cookie|session[-_]?token|bearer/i
const MARKDOWN_FENCE_LINE_PATTERN = /(^|\n)([ \t]{0,3})```/g

const resolveLoggerPluginOptions = (config: Record<string, unknown> = {}): LoggerPluginOptions => {
  const externalizeLargePayloads = config.externalizeLargePayloads !== false
  const largePayloadByteLimit = typeof config.largePayloadByteLimit === 'number' &&
      Number.isFinite(config.largePayloadByteLimit) &&
      config.largePayloadByteLimit >= 0
    ? Math.floor(config.largePayloadByteLimit)
    : DEFAULT_LARGE_LOG_PAYLOAD_BYTE_LIMIT

  return {
    externalizeLargePayloads,
    largePayloadByteLimit
  }
}

const sanitizeEnvRecord = (value: unknown) => {
  const record = asRecord(value)
  return {
    redacted: true,
    count: Object.keys(record).length,
    keys: Object.keys(record).sort()
  }
}

const escapeMarkdownFenceLines = (value: string) => (
  value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(
      MARKDOWN_FENCE_LINE_PATTERN,
      (_match, lineStart: string, indent: string) => `${lineStart}${indent}\\\`\\\`\\\``
    )
)

const formatLogText = (value: unknown) => escapeMarkdownFenceLines(String(value ?? ''))

const getValueType = (value: unknown) => {
  if (Array.isArray(value)) return 'array'
  if (value == null) return 'null'
  return typeof value
}

const getLoggerFilePath = (logger: LoggerLike) => {
  const loggerPath = logger.paths?.logFilePath
  if (typeof loggerPath === 'string') return loggerPath

  const streamPath = (logger.stream as unknown as { path?: unknown } | undefined)?.path
  return typeof streamPath === 'string' ? streamPath : undefined
}

const isPathInside = (parentPath: string, targetPath: string) => {
  const relativePath = relative(resolve(parentPath), resolve(targetPath))
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  )
}

const getLogPathParts = (logger: LoggerLike) => {
  const loggerFilePath = getLoggerFilePath(logger)
  if (loggerFilePath == null) return undefined

  const metadataLogsRoot = logger.paths?.logsRoot
  const metadataCachesRoot = logger.paths?.cachesRoot
  if (
    typeof metadataLogsRoot === 'string' &&
    typeof metadataCachesRoot === 'string' &&
    isPathInside(metadataLogsRoot, loggerFilePath)
  ) {
    return {
      loggerFilePath,
      payloadStoreDirectory: join(metadataCachesRoot, '.logger-payloads', 'sha256')
    }
  }

  const parts = loggerFilePath.split(/[\\/]/)
  const logsIndex = parts.lastIndexOf('logs')
  if (logsIndex === -1) return undefined

  return {
    loggerFilePath,
    payloadStoreDirectory: join(parts.slice(0, logsIndex).join(sep) || sep, 'caches', '.logger-payloads', 'sha256')
  }
}

const getPayloadDirectory = (logger: LoggerLike) => {
  const logPathParts = getLogPathParts(logger)
  if (logPathParts == null) return undefined

  const fileName = basename(logPathParts.loggerFilePath)
  const stem = fileName.endsWith('.log.md')
    ? fileName.slice(0, -'.log.md'.length)
    : fileName.replace(/\.[^.]+$/, '')

  return join(dirname(logPathParts.loggerFilePath), `${stem}.payloads`)
}

const getPayloadStoreDirectory = (logger: LoggerLike) => {
  const logPathParts = getLogPathParts(logger)
  if (logPathParts == null) return undefined

  return logPathParts.payloadStoreDirectory
}

const sanitizeFileSegment = (value: string) => (
  value
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'payload'
)

const serializePayload = (value: unknown) => `${JSON.stringify(value, null, 2) ?? 'null'}\n`

const hashPayloadText = (payloadText: string) => (
  createHash('sha256')
    .update(payloadText)
    .digest('hex')
)

const writeContentAddressedPayload = (storeDirectory: string, payloadText: string, hash: string) => {
  const payloadPath = join(storeDirectory, hash.slice(0, 2), hash.slice(2, 4), `${hash}.json`)
  if (existsSync(payloadPath)) return payloadPath

  mkdirSync(dirname(payloadPath), { recursive: true })
  const tempPath = join(dirname(payloadPath), `.${hash}.${process.pid}.${randomUUID()}.tmp`)

  try {
    writeFileSync(tempPath, payloadText, {
      encoding: 'utf8',
      flag: 'wx'
    })
    renameSync(tempPath, payloadPath)
  } catch (error) {
    if (existsSync(payloadPath)) return payloadPath
    throw error
  }

  return payloadPath
}

const linkPayloadReference = (targetPath: string, referencePath: string, payloadText: string) => {
  mkdirSync(dirname(referencePath), { recursive: true })
  if (existsSync(referencePath)) return

  const relativeTargetPath = relative(dirname(referencePath), targetPath)
  try {
    symlinkSync(relativeTargetPath, referencePath, 'file')
  } catch {
    if (existsSync(referencePath)) return
    try {
      writeFileSync(referencePath, payloadText, {
        encoding: 'utf8',
        flag: 'wx'
      })
    } catch {
      if (!existsSync(referencePath)) throw new Error(`Failed to create logger payload reference: ${referencePath}`)
    }
  }
}

const createPayloadReference = (
  logger: LoggerLike,
  value: unknown,
  label: string
): ExternalLogPayloadRef | undefined => {
  const payloadDirectory = getPayloadDirectory(logger)
  const payloadStoreDirectory = getPayloadStoreDirectory(logger)
  if (payloadDirectory == null || payloadStoreDirectory == null) return undefined

  const payloadText = serializePayload(value)
  const hash = hashPayloadText(payloadText)
  const bytes = Buffer.byteLength(payloadText, 'utf8')
  const payloadPath = join(
    payloadDirectory,
    `${Date.now()}-${randomUUID()}-${sanitizeFileSegment(label)}-${hash.slice(0, 12)}.json`
  )

  try {
    const storePayloadPath = writeContentAddressedPayload(payloadStoreDirectory, payloadText, hash)
    linkPayloadReference(storePayloadPath, payloadPath, payloadText)
  } catch {
    return undefined
  }

  return {
    $loggerPayloadRef: true,
    path: payloadPath,
    hash: `sha256:${hash}`,
    bytes,
    type: getValueType(value)
  }
}

const shouldExternalizePayload = (value: unknown, options: LoggerPluginOptions) => (
  options.externalizeLargePayloads &&
  Buffer.byteLength(serializePayload(value), 'utf8') > options.largePayloadByteLimit
)

const isExternalLogPayloadRef = (value: unknown): value is ExternalLogPayloadRef => (
  asRecord(value).$loggerPayloadRef === true &&
  typeof asRecord(value).path === 'string'
)

const formatExternalLogPayloadRef = (value: ExternalLogPayloadRef) => (
  `[payload externalized: ${value.path} (${value.bytes} bytes, ${value.type}, ${value.hash})]`
)

const sanitizeHookLogValue = (
  value: unknown,
  key?: string,
  seen: WeakSet<object> = new WeakSet()
): unknown => {
  if (key === 'env') return sanitizeEnvRecord(value)
  if (key != null && SENSITIVE_KEY_PATTERN.test(key)) return REDACTED

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    const result = value.map(item => sanitizeHookLogValue(item, undefined, seen))
    seen.delete(value)
    return result
  }

  if (value != null && typeof value === 'object') {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeHookLogValue(entryValue, entryKey, seen)
      ])
    )
  }

  return value
}

const externalizeLargeHookLogValue = (
  logger: LoggerLike,
  options: LoggerPluginOptions,
  value: unknown,
  key = 'payload'
): unknown => {
  if (typeof value === 'string') {
    if (!shouldExternalizePayload(value, options)) return value
    return createPayloadReference(logger, value, key) ?? value
  }

  if (Array.isArray(value)) {
    const mapped = value.map((item, index) => externalizeLargeHookLogValue(logger, options, item, `${key}-${index}`))
    if (!shouldExternalizePayload(mapped, options)) return mapped
    return createPayloadReference(logger, mapped, key) ?? mapped
  }

  if (value != null && typeof value === 'object') {
    const mapped = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        externalizeLargeHookLogValue(logger, options, entryValue, entryKey)
      ])
    )
    if (!shouldExternalizePayload(mapped, options)) return mapped
    return createPayloadReference(logger, mapped, key) ?? mapped
  }

  return value
}

const prepareHookLogValue = (
  logger: LoggerLike,
  options: LoggerPluginOptions,
  value: unknown,
  key?: string
) => externalizeLargeHookLogValue(logger, options, sanitizeHookLogValue(value, key), key)

const formatPreparedLogText = (value: unknown) => (
  isExternalLogPayloadRef(value)
    ? formatExternalLogPayloadRef(value)
    : formatLogText(value)
)

const logSanitizedInput = (
  logger: LoggerLike,
  options: LoggerPluginOptions,
  input: unknown
) => {
  logger.info(prepareHookLogValue(logger, options, input))
}

const summarizeObject = (value: unknown) => {
  const record = asRecord(value)
  return {
    keys: Object.keys(record).sort(),
    count: Object.keys(record).length
  }
}

const summarizePromptData = (value: unknown) => {
  if (typeof value === 'string') {
    return {
      type: 'string',
      length: value.length
    }
  }

  if (Array.isArray(value)) {
    return {
      type: 'array',
      count: value.length
    }
  }

  if (value != null && typeof value === 'object') {
    return {
      type: 'object',
      ...summarizeObject(value)
    }
  }

  return {
    type: typeof value
  }
}

const logGenerateSystemPromptInput = (
  logger: LoggerLike,
  input: unknown
) => {
  const record = asRecord(input)
  logger.info({
    cwd: record.cwd,
    sessionId: record.sessionId,
    type: record.type,
    name: record.name,
    data: summarizePromptData(record.data)
  })
}

const logTaskStartInput = (
  logger: LoggerLike,
  input: unknown
) => {
  const record = asRecord(input)
  const options = asRecord(record.options)
  const adapterOptions = asRecord(record.adapterOptions)
  logger.info({
    adapter: record.adapter,
    cwd: record.cwd,
    sessionId: record.sessionId,
    options: {
      adapter: options.adapter,
      cwd: options.cwd,
      ctxId: options.ctxId,
      updateConfiguredSkills: options.updateConfiguredSkills
    },
    adapterOptions: {
      type: adapterOptions.type,
      runtime: adapterOptions.runtime,
      sessionId: adapterOptions.sessionId,
      model: adapterOptions.model,
      effort: adapterOptions.effort,
      permissionMode: adapterOptions.permissionMode,
      mode: adapterOptions.mode,
      hasSystemPrompt: typeof adapterOptions.systemPrompt === 'string' && adapterOptions.systemPrompt !== '',
      promptAssetIds: adapterOptions.promptAssetIds
    }
  })
}

export default (config: Record<string, unknown> = {}) => {
  const loggerOptions = resolveLoggerPluginOptions(config)

  return definePlugin({
    name: 'logger',
    GenerateSystemPrompt: ({ logger }, input, next) => {
      logGenerateSystemPromptInput(logger, input)
      return next()
    },
    StartTasks: ({ logger }, input, next) => {
      logSanitizedInput(logger, loggerOptions, input)
      return next()
    },
    TaskStart: ({ logger }, input, next) => {
      logTaskStartInput(logger, input)
      return next()
    },
    TaskStop: ({ logger }, input, next) => {
      logSanitizedInput(logger, loggerOptions, input)
      return next()
    },
    SessionStart: ({ logger }, input, next) => {
      logSanitizedInput(logger, loggerOptions, input)
      return next()
    },
    UserPromptSubmit: ({ logger }, input, next) => {
      logSanitizedInput(logger, loggerOptions, input)
      return next()
    },
    PreToolUse: ({ logger }, input, next) => {
      logger.info(
        input.adapter ?? 'unknown-adapter',
        input.toolName,
        prepareHookLogValue(logger, loggerOptions, input.toolInput, 'toolInput')
      )
      return next()
    },
    PostToolUse: ({ logger }, input, next) => {
      switch (input.toolName) {
        case 'Bash':
        case 'adapter:codex:Bash': {
          const toolInput = asRecord(prepareHookLogValue(logger, loggerOptions, input.toolInput, 'toolInput'))
          const toolResponse = asRecord(prepareHookLogValue(logger, loggerOptions, input.toolResponse, 'toolResponse'))
          const description = formatPreparedLogText(toolInput.description)
          const command = formatPreparedLogText(toolInput.command)
          const stdout = formatPreparedLogText(toolResponse.stdout ?? input.toolResponse ?? '<no stdout>')
          const stderr = formatPreparedLogText(toolResponse.stderr ?? '<no stderr>')
          logger.info(
            input.toolName,
            description,
            '\n```text\n' +
              `isImage: ${toolResponse.isImage ?? ''}\n` +
              `interrupted: ${toolResponse.interrupted ?? ''}\n` +
              `> ${command}\n\n` +
              `stdout: ${stdout}\n` +
              '-----------------------------------------\n' +
              `stderr: ${stderr}\n` +
              '\n```'
          )
          break
        }
        default:
          logger.info(input.toolName, {
            args: prepareHookLogValue(logger, loggerOptions, input.toolInput, 'toolInput'),
            resp: prepareHookLogValue(logger, loggerOptions, input.toolResponse ?? {}, 'toolResponse'),
            adapter: input.adapter,
            hookSource: input.hookSource
          })
      }
      return next()
    },
    Stop: ({ logger }, input, next) => {
      logSanitizedInput(logger, loggerOptions, input)
      return next()
    },
    SessionEnd: ({ logger }, input, next) => {
      logSanitizedInput(logger, loggerOptions, input)
      return next()
    },
    PreCompact: ({ logger }, input, next) => {
      logSanitizedInput(logger, loggerOptions, input)
      return next()
    },
    Notification: ({ logger }, input, next) => {
      logSanitizedInput(logger, loggerOptions, input)
      return next()
    },
    SubagentStop: ({ logger }, input, next) => {
      logSanitizedInput(logger, loggerOptions, input)
      return next()
    }
  })
}
