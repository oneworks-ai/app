import type { RelayDiagnosticEvent } from '../types.js'

interface FirstActionOperation {
  acceptedAt?: string
  responseAt?: string
  sessionId?: string
  startedAt?: string
  succeeded: boolean
  successAt?: string
  terminal: boolean
}

const percentile = (values: number[], percentage: number) => {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentage) - 1)]
}

const durationBetween = (startedAt: string | undefined, endedAt: string | undefined) => {
  if (startedAt == null || endedAt == null) return undefined
  const durationMs = Date.parse(endedAt) - Date.parse(startedAt)
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined
}

const summarizeDurations = (values: Array<number | undefined>) => {
  const durations = values.filter((value): value is number => value != null)
  return {
    p50DurationMs: percentile(durations, 0.5),
    p95DurationMs: percentile(durations, 0.95)
  }
}

const earlierTimestamp = (current: string | undefined, next: string) => (
  current == null || next < current ? next : current
)

export const summarizeFirstActionEvents = (events: RelayDiagnosticEvent[]) => {
  const startupStartedAtBySession = new Map<string, string>()
  const operations = new Map<string, FirstActionOperation>()

  for (const event of events) {
    if (
      event.source === 'oneworks' &&
      event.category === 'startup' &&
      event.eventName === 'oneworks.diagnostic.operation.started' &&
      event.sessionId != null
    ) {
      startupStartedAtBySession.set(
        event.sessionId,
        earlierTimestamp(startupStartedAtBySession.get(event.sessionId), event.occurredAt)
      )
    }
    if (event.source !== 'oneworks' || event.category !== 'first-action') continue

    const key = event.operationId ?? event.id
    const operation = operations.get(key) ?? { succeeded: false, terminal: false }
    operation.sessionId ??= event.sessionId
    if (event.eventName === 'oneworks.diagnostic.operation.started') {
      operation.startedAt = earlierTimestamp(operation.startedAt, event.occurredAt)
    }
    if (event.stage === 'submit.accepted') {
      operation.acceptedAt = earlierTimestamp(operation.acceptedAt, event.occurredAt)
    }
    if (event.stage === 'first.response.received') {
      operation.responseAt = earlierTimestamp(operation.responseAt, event.occurredAt)
    }
    if (event.stage === 'first.success') {
      operation.successAt = earlierTimestamp(operation.successAt, event.occurredAt)
    }
    if (event.eventName === 'oneworks.diagnostic.operation.completed') {
      operation.terminal = true
      if (event.outcome === 'success') {
        operation.succeeded = true
        operation.successAt ??= event.occurredAt
      }
    }
    operations.set(key, operation)
  }

  const values = [...operations.values()]
  const terminal = values.filter(operation => operation.terminal)
  const successes = terminal.filter(operation => operation.succeeded).length
  return {
    appStartToSubmit: summarizeDurations(values.map(operation =>
      durationBetween(
        operation.sessionId == null ? undefined : startupStartedAtBySession.get(operation.sessionId),
        operation.startedAt
      )
    )),
    attempts: values.length,
    pendingAttempts: values.length - terminal.length,
    submitToAccepted: summarizeDurations(values.map(operation =>
      durationBetween(
        operation.startedAt,
        operation.acceptedAt
      )
    )),
    submitToResponse: summarizeDurations(values.map(operation =>
      durationBetween(
        operation.startedAt,
        operation.responseAt
      )
    )),
    submitToSuccess: summarizeDurations(values.map(operation =>
      durationBetween(
        operation.startedAt,
        operation.successAt
      )
    )),
    successRate: terminal.length === 0 ? undefined : successes / terminal.length,
    terminalAttempts: terminal.length
  }
}
