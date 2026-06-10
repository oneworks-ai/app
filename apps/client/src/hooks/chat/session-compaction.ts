import type { WSEvent } from '@oneworks/core'

export type SessionCompactionStatus = 'compressing' | 'compressed'

export interface SessionCompactionInfo {
  id: string
  createdAt: number
  status: SessionCompactionStatus
  tokenCount?: number
  trigger?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value != null && !Array.isArray(value)
)

const readOptionalString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const readOptionalPositiveNumber = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
)

const readCompactionPayload = (value: unknown): SessionCompactionInfo | null => {
  if (!isRecord(value)) {
    return null
  }

  if (value.type !== 'context_compaction' && value.type !== 'contextCompaction') {
    return null
  }

  const id = readOptionalString(value.id) ?? `context-compaction-${Date.now()}`
  const createdAt = readOptionalPositiveNumber(value.createdAt) ?? Date.now()
  const tokenCount = readOptionalPositiveNumber(value.tokenCount)
  const trigger = readOptionalString(value.trigger)

  return {
    id,
    createdAt,
    status: 'compressing',
    ...(tokenCount == null ? {} : { tokenCount }),
    ...(trigger == null ? {} : { trigger })
  }
}

export const getSessionCompactionInfoFromEvent = (event: WSEvent): SessionCompactionInfo | null => {
  if (event.type !== 'adapter_event') {
    return null
  }

  const direct = readCompactionPayload(event.data)
  if (direct != null) {
    return direct
  }

  if (isRecord(event.data)) {
    return readCompactionPayload(event.data.runtimeEvent)
  }

  return null
}

const isAssistantMessageEvent = (event: WSEvent) => {
  if (event.type !== 'message') {
    return false
  }

  if ('message' in event && event.message != null) {
    return event.message.role === 'assistant'
  }

  return (event as { role?: unknown }).role === 'assistant'
}

export const isSessionCompactionCompleteStatus = (status?: string) => (
  status != null && status !== 'running' && status !== 'waiting_input'
)

export const markSessionCompactionsCompressed = (
  events: SessionCompactionInfo[]
): SessionCompactionInfo[] => {
  if (!events.some(event => event.status !== 'compressed')) {
    return events
  }

  return events.map(event => ({
    ...event,
    status: 'compressed'
  }))
}

export const getLatestSessionCompactionInfo = (
  events: SessionCompactionInfo[]
): SessionCompactionInfo | null => (
  events.reduce<SessionCompactionInfo | null>((latest, event) => (
    latest == null || event.createdAt >= latest.createdAt ? event : latest
  ), null)
)

export const upsertSessionCompactionEvent = (
  events: SessionCompactionInfo[],
  info: SessionCompactionInfo
): SessionCompactionInfo[] => {
  const next = events.filter(event => event.id !== info.id)
  next.push(info)
  return next.sort((left, right) => left.createdAt - right.createdAt)
}

export const resolveSessionCompactionStatus = (
  info: SessionCompactionInfo,
  sessionStatus?: string
): SessionCompactionStatus => (
  info.status === 'compressed' || isSessionCompactionCompleteStatus(sessionStatus)
    ? 'compressed'
    : 'compressing'
)

export const restoreSessionCompactionEventsFromHistoryEvents = (
  events: WSEvent[],
  sessionStatus?: string
): SessionCompactionInfo[] => {
  let compactEvents: SessionCompactionInfo[] = []

  for (const event of events) {
    const info = getSessionCompactionInfoFromEvent(event)
    if (info != null) {
      compactEvents = upsertSessionCompactionEvent(compactEvents, info)
      continue
    }

    if (isAssistantMessageEvent(event)) {
      compactEvents = markSessionCompactionsCompressed(compactEvents)
    }
  }

  if (isSessionCompactionCompleteStatus(sessionStatus)) {
    compactEvents = markSessionCompactionsCompressed(compactEvents)
  }

  return compactEvents
}

export const restoreSessionCompactionInfoFromHistoryEvents = (
  events: WSEvent[],
  sessionStatus?: string
): SessionCompactionInfo | null => {
  return getLatestSessionCompactionInfo(
    restoreSessionCompactionEventsFromHistoryEvents(events, sessionStatus)
  )
}
