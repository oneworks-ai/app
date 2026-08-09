import { DIAGNOSTIC_SCHEMA_VERSION } from './types.js'
import type {
  DiagnosticContext,
  DiagnosticResource,
  ModelUsageEvent,
  ModelUsageExporter,
  ModelUsageSource
} from './types.js'

const SAFE_DIMENSION = /^[A-Za-z\d][\w.:/-]{0,159}$/u
const MAX_TOKEN_COUNT = 1_000_000_000_000

const cleanDimension = (value: string, label: string) => {
  const cleaned = value.trim()
  if (!SAFE_DIMENSION.test(cleaned) || cleaned.includes('://') || cleaned.includes('..')) {
    throw new Error(`${label} must be a stable content-free identifier.`)
  }
  return cleaned
}

const cleanTokenCount = (value: number | undefined) => {
  if (value == null) return 0
  return Number.isFinite(value) ? Math.min(MAX_TOKEN_COUNT, Math.max(0, Math.trunc(value))) : 0
}

const cleanContext = (context: DiagnosticContext | undefined): DiagnosticContext => {
  if (context == null) return {}
  const cleaned: DiagnosticContext = {}
  for (const [key, value] of Object.entries(context)) {
    if (typeof value !== 'string' || value.trim() === '') continue
    cleaned[key as keyof DiagnosticContext] = value.trim().slice(0, 256)
  }
  return cleaned
}

export interface RecordModelUsageInput {
  adapter?: string
  cacheCreationInputTokens?: number
  cachedInputTokens?: number
  context?: DiagnosticContext
  durationMs?: number
  eventId?: string
  inputTokens?: number
  model: string
  modelService: string
  occurredAt?: Date
  outputTokens?: number
  requestCount?: number
  source?: ModelUsageSource
  success?: boolean
}

export interface ModelUsageClientOptions {
  createId?: () => string
  exporters?: readonly ModelUsageExporter[]
  now?: () => Date
  onExporterError?: (error: unknown) => void
  resource: DiagnosticResource
}

export interface ModelUsageClient {
  flush: () => Promise<void>
  record: (input: RecordModelUsageInput) => ModelUsageEvent
}

export const createModelUsageClient = (options: ModelUsageClientOptions): ModelUsageClient => {
  const exporters = [...(options.exporters ?? [])]
  const createId = options.createId ?? (() => globalThis.crypto.randomUUID())
  const now = options.now ?? (() => new Date())
  const pending = new Set<Promise<void>>()

  const dispatch = (event: ModelUsageEvent) => {
    for (const exporter of exporters) {
      try {
        const result = exporter.exportModelUsage(event)
        if (result == null || typeof (result as Promise<void>).then !== 'function') continue
        const task = Promise.resolve(result)
          .catch(error => options.onExporterError?.(error))
          .finally(() => pending.delete(task))
        pending.add(task)
      } catch (error) {
        options.onExporterError?.(error)
      }
    }
  }

  return {
    flush: async () => {
      await Promise.all([...pending])
      await Promise.all(exporters.map(async exporter => await exporter.flush?.()))
    },
    record: input => {
      const event: ModelUsageEvent = {
        adapter: input.adapter == null ? undefined : cleanDimension(input.adapter, 'Adapter'),
        cacheCreationInputTokens: cleanTokenCount(input.cacheCreationInputTokens),
        cachedInputTokens: cleanTokenCount(input.cachedInputTokens),
        context: cleanContext(input.context),
        durationMs: input.durationMs == null ? undefined : cleanTokenCount(input.durationMs),
        eventId: input.eventId?.trim() || createId(),
        inputTokens: cleanTokenCount(input.inputTokens),
        model: cleanDimension(input.model, 'Model'),
        modelService: cleanDimension(input.modelService, 'Model service'),
        occurredAt: (input.occurredAt ?? now()).toISOString(),
        outputTokens: cleanTokenCount(input.outputTokens),
        requestCount: Math.max(1, cleanTokenCount(input.requestCount ?? 1)),
        resource: { ...options.resource },
        schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
        source: input.source ?? 'oneworks',
        success: input.success ?? true
      }
      dispatch(event)
      return event
    }
  }
}
