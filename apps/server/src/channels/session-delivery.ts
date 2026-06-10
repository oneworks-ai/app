import type { ChatMessage, WSEvent } from '@oneworks/core'

export const CHANNEL_SESSION_STOP_EVENT_TYPE = 'channel_session_stop'

export interface ChannelSessionStopEventData {
  source: 'server'
  type: typeof CHANNEL_SESSION_STOP_EVENT_TYPE
  message?: ChatMessage
}

export const buildChannelSessionStopEvent = (message?: ChatMessage): WSEvent => ({
  type: 'adapter_event',
  data: {
    source: 'server',
    type: CHANNEL_SESSION_STOP_EVENT_TYPE,
    ...(message != null ? { message } : {})
  } satisfies ChannelSessionStopEventData
})

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const isChannelSessionStopEvent = (
  event: WSEvent
): event is Extract<WSEvent, { type: 'adapter_event' }> & { data: ChannelSessionStopEventData } => (
  event.type === 'adapter_event' &&
  isRecord(event.data) &&
  event.data.source === 'server' &&
  event.data.type === CHANNEL_SESSION_STOP_EVENT_TYPE
)
