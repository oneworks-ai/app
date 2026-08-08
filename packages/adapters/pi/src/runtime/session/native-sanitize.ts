import { z } from 'zod'

const safeNumber = z.number().finite().nonnegative().optional().catch(undefined)
const safeBoolean = z.boolean().optional().catch(undefined)
const safeString = z.string().optional().catch(undefined)

const nativeSettingsSchema = z.object({
  branchSummary: z.object({ reserveTokens: safeNumber, skipPrompt: safeBoolean }).optional().catch(undefined),
  compaction: z.object({
    enabled: safeBoolean,
    keepRecentTokens: safeNumber,
    reserveTokens: safeNumber
  }).optional().catch(undefined),
  defaultModel: safeString,
  defaultProvider: safeString,
  defaultThinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    .optional().catch(undefined),
  followUpMode: z.enum(['all', 'one-at-a-time']).optional().catch(undefined),
  hideThinkingBlock: safeBoolean,
  httpIdleTimeoutMs: safeNumber,
  images: z.object({ autoResize: safeBoolean, blockImages: safeBoolean }).optional().catch(undefined),
  markdown: z.object({
    codeBlockIndent: safeString,
    mermaid: z.enum(['off', 'final', 'streaming']).optional().catch(undefined)
  }).optional().catch(undefined),
  quietStartup: safeBoolean,
  retry: z.object({
    baseDelayMs: safeNumber,
    enabled: safeBoolean,
    maxRetries: safeNumber,
    provider: z.object({
      maxRetries: safeNumber,
      maxRetryDelayMs: safeNumber,
      timeoutMs: safeNumber
    }).optional().catch(undefined)
  }).optional().catch(undefined),
  showCacheMissNotices: safeBoolean,
  steeringMode: z.enum(['all', 'one-at-a-time']).optional().catch(undefined),
  terminal: z.object({
    clearOnShrink: safeBoolean,
    imageWidthCells: safeNumber,
    showImages: safeBoolean,
    showTerminalProgress: safeBoolean
  }).optional().catch(undefined),
  thinkingBudgets: z.object({
    high: safeNumber,
    low: safeNumber,
    medium: safeNumber,
    minimal: safeNumber
  }).optional().catch(undefined),
  transport: z.enum(['sse', 'websocket', 'websocket-cached', 'auto']).optional().catch(undefined),
  warnings: z.object({ anthropicExtraUsage: safeBoolean }).optional().catch(undefined),
  websocketConnectTimeoutMs: safeNumber
})

export const asRecord = (value: unknown): Record<string, unknown> | undefined => (
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
)

export const sanitizePiNativeSettings = (settings: Record<string, unknown>) => (
  JSON.parse(JSON.stringify(nativeSettingsSchema.parse(settings))) as Record<string, unknown>
)

const isCommandValue = (value: unknown) => typeof value === 'string' && value.startsWith('!')

export const sanitizePiNativeAuth = (auth: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(auth).filter(([, credential]) => {
      if (isCommandValue(credential)) return false
      const record = asRecord(credential)
      return record?.type !== 'api_key' || !isCommandValue(record.key)
    })
  )

const sanitizePiNativeModelValue = (value: unknown, key?: string): unknown => {
  if (key === 'apiKey' && isCommandValue(value)) return undefined
  if (key === 'headers') {
    const headers = asRecord(value)
    if (headers == null) return undefined
    return Object.fromEntries(
      Object.entries(headers).filter((entry): entry is [string, string] => (
        typeof entry[1] === 'string' && !isCommandValue(entry[1])
      ))
    )
  }
  if (Array.isArray(value)) return value.map(item => sanitizePiNativeModelValue(item))
  const record = asRecord(value)
  if (record == null) return value
  return Object.fromEntries(
    Object.entries(record)
      .map(([childKey, child]) => [childKey, sanitizePiNativeModelValue(child, childKey)] as const)
      .filter((entry): entry is [string, Exclude<unknown, undefined>] => entry[1] !== undefined)
  )
}

export const sanitizePiNativeModels = (models: Record<string, unknown>) => (
  sanitizePiNativeModelValue(models) as Record<string, unknown>
)
