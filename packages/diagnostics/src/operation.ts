/* eslint-disable max-lines -- the client and operation state machine are kept together as one contract. */
import { DIAGNOSTIC_SCHEMA_VERSION } from './types.js'
import type {
  DiagnosticContext,
  DiagnosticEvent,
  DiagnosticEventKind,
  DiagnosticExporter,
  DiagnosticFailure,
  DiagnosticFailureDomain,
  DiagnosticOperationOutcome,
  DiagnosticOperationSnapshot,
  DiagnosticResource
} from './types.js'

const DIAGNOSTIC_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/u
const DIAGNOSTIC_TYPE_PATTERN = /^[A-Za-z][\w.-]*$/u
const DIAGNOSTIC_FINGERPRINT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u
const MAX_DIAGNOSTIC_NAME_LENGTH = 96
const FAILURE_DOMAINS: ReadonlySet<DiagnosticFailureDomain> = new Set([
  'adapter',
  'auth',
  'client',
  'config',
  'network',
  'plugin',
  'process',
  'provider',
  'renderer',
  'server',
  'storage',
  'unknown'
])

const assertDiagnosticName = (value: string, label: string) => {
  if (value.length > MAX_DIAGNOSTIC_NAME_LENGTH || !DIAGNOSTIC_NAME_PATTERN.test(value)) {
    throw new Error(`${label} must be a stable lowercase dotted identifier.`)
  }
  return value
}

const cleanContext = (context: DiagnosticContext | undefined): DiagnosticContext => {
  const cleaned: DiagnosticContext = {}
  if (context == null) return cleaned

  for (const [key, value] of Object.entries(context)) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed === '') continue
    cleaned[key as keyof DiagnosticContext] = trimmed.slice(0, 256)
  }
  return cleaned
}

const hasRestrictedContext = (context: DiagnosticContext) => Object.keys(context).length > 0

const durationBetween = (startedAt: string, endedAt: string) => {
  const durationMs = Date.parse(endedAt) - Date.parse(startedAt)
  return Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
}

const cleanFailureType = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length <= MAX_DIAGNOSTIC_NAME_LENGTH && DIAGNOSTIC_TYPE_PATTERN.test(trimmed)
    ? trimmed
    : undefined
}

const cloneFailure = (failure: DiagnosticFailure | undefined) => {
  if (failure == null) return undefined
  const type = cleanFailureType(failure.type)
  const fingerprint = typeof failure.fingerprint === 'string' &&
      DIAGNOSTIC_FINGERPRINT_PATTERN.test(failure.fingerprint)
    ? failure.fingerprint
    : undefined
  return {
    code: assertDiagnosticName(failure.code, 'Diagnostic failure code'),
    domain: FAILURE_DOMAINS.has(failure.domain) ? failure.domain : 'unknown',
    ...(fingerprint == null ? {} : { fingerprint }),
    ...(typeof failure.retryable === 'boolean' ? { retryable: failure.retryable } : {}),
    ...(type == null ? {} : { type })
  }
}

const cloneOperation = (operation: DiagnosticOperationSnapshot): DiagnosticOperationSnapshot => ({
  ...operation,
  ...(operation.failure == null ? {} : { failure: cloneFailure(operation.failure) })
})

export interface DiagnosticClientOptions {
  context?: DiagnosticContext
  createId?: () => string
  exporters?: readonly DiagnosticExporter[]
  now?: () => Date
  onExporterError?: (error: unknown) => void
  resource: DiagnosticResource
}

export interface StartDiagnosticOperationOptions {
  context?: DiagnosticContext
  operationId?: string
}

export interface CompleteDiagnosticOperationOptions {
  failure?: DiagnosticFailure
  outcome: DiagnosticOperationOutcome
}

export interface DiagnosticOperation {
  abandon: (failure?: DiagnosticFailure) => DiagnosticEvent | undefined
  cancel: (failure?: DiagnosticFailure) => DiagnosticEvent | undefined
  complete: (options: CompleteDiagnosticOperationOptions) => DiagnosticEvent | undefined
  degrade: (failure: DiagnosticFailure) => DiagnosticEvent | undefined
  fail: (failure: DiagnosticFailure) => DiagnosticEvent | undefined
  getSnapshot: () => DiagnosticOperationSnapshot
  isReady: () => boolean
  isTerminal: () => boolean
  ready: (stage?: string) => DiagnosticEvent | undefined
  stable: () => DiagnosticEvent | undefined
  stage: (name: string) => DiagnosticEvent | undefined
  succeed: () => DiagnosticEvent | undefined
  timeout: (failure: DiagnosticFailure) => DiagnosticEvent | undefined
}

export interface DiagnosticClient {
  flush: () => Promise<void>
  startOperation: (name: string, options?: StartDiagnosticOperationOptions) => DiagnosticOperation
}

export const diagnosticFailureFromError = (
  error: unknown,
  input: {
    code: string
    domain?: DiagnosticFailureDomain
    retryable?: boolean
  }
): DiagnosticFailure => {
  const type = error instanceof Error ? cleanFailureType(error.name) : undefined
  return {
    code: assertDiagnosticName(input.code, 'Diagnostic failure code'),
    domain: input.domain ?? 'unknown',
    ...(input.retryable == null ? {} : { retryable: input.retryable }),
    ...(type == null ? {} : { type })
  }
}

export const createDiagnosticClient = (options: DiagnosticClientOptions): DiagnosticClient => {
  const exporters = [...(options.exporters ?? [])]
  const now = options.now ?? (() => new Date())
  const createId = options.createId ?? (() => globalThis.crypto.randomUUID())
  const baseContext = cleanContext(options.context)
  const pending = new Set<Promise<void>>()

  const dispatch = (event: DiagnosticEvent) => {
    for (const exporter of exporters) {
      try {
        const result = exporter.export(event)
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

  const createEvent = (
    kind: DiagnosticEventKind,
    context: DiagnosticContext,
    operation: DiagnosticOperationSnapshot,
    timestamp: string
  ): DiagnosticEvent => ({
    context: { ...context },
    dataClass: hasRestrictedContext(context) ? 'restricted' : 'safe',
    eventId: createId(),
    kind,
    operation: cloneOperation(operation),
    resource: { ...options.resource },
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    timestamp
  })

  const startOperation = (
    rawName: string,
    operationOptions: StartDiagnosticOperationOptions = {}
  ): DiagnosticOperation => {
    const name = assertDiagnosticName(rawName, 'Diagnostic operation name')
    const context = {
      ...baseContext,
      ...cleanContext(operationOptions.context)
    }
    const startedAt = now().toISOString()
    const operation: DiagnosticOperationSnapshot = {
      id: operationOptions.operationId?.trim() || createId(),
      name,
      stageSequence: 0,
      startedAt
    }
    let lastStageAt = startedAt
    let ready = false
    let terminal = false

    const emit = (kind: DiagnosticEventKind, timestamp = now().toISOString()) => {
      const event = createEvent(kind, context, operation, timestamp)
      dispatch(event)
      return event
    }

    emit('operation.started', startedAt)

    const stage = (rawStage: string) => {
      if (terminal) return undefined
      const stageName = assertDiagnosticName(rawStage, 'Diagnostic stage name')
      const timestamp = now().toISOString()
      operation.stage = stageName
      operation.stageDurationMs = durationBetween(lastStageAt, timestamp)
      operation.stageSequence += 1
      lastStageAt = timestamp
      return emit('operation.stage', timestamp)
    }

    const markReady = (readyStage?: string) => {
      if (terminal || ready) return undefined
      if (readyStage != null && operation.stage !== readyStage) stage(readyStage)
      const timestamp = now().toISOString()
      ready = true
      operation.durationMs = durationBetween(startedAt, timestamp)
      operation.readyAt = timestamp
      return emit('operation.ready', timestamp)
    }

    const complete = ({ failure, outcome }: CompleteDiagnosticOperationOptions) => {
      if (terminal) return undefined
      const cleanedFailure = cloneFailure(failure)
      const timestamp = now().toISOString()
      terminal = true
      operation.completedAt = timestamp
      operation.durationMs = durationBetween(startedAt, timestamp)
      operation.failure = cleanedFailure
      operation.outcome = outcome
      return emit('operation.completed', timestamp)
    }

    return {
      abandon: failure => complete({ failure, outcome: 'abandoned' }),
      cancel: failure => complete({ failure, outcome: 'cancelled' }),
      complete,
      degrade: failure => complete({ failure, outcome: 'degraded' }),
      fail: failure => complete({ failure, outcome: 'error' }),
      getSnapshot: () => cloneOperation(operation),
      isReady: () => ready,
      isTerminal: () => terminal,
      ready: markReady,
      stable: () => complete({ outcome: 'success' }),
      stage,
      succeed: () => complete({ outcome: 'success' }),
      timeout: failure => complete({ failure, outcome: 'timeout' })
    }
  }

  return {
    flush: async () => {
      await Promise.all([...pending])
      await Promise.all(exporters.map(async exporter => await exporter.flush?.()))
    },
    startOperation
  }
}
