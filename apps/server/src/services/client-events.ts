import { EventEmitter } from 'node:events'

export type ClientEventChannel = 'agent-rooms' | 'config' | 'sessions' | 'workspace'

export interface ClientEventPayload {
  [key: string]: unknown
  type: string
}

export interface ClientEvent extends ClientEventPayload {
  channel: ClientEventChannel
  id: string
  emittedAt: number
}

type ClientEventListener = (event: ClientEvent) => void

const clientEvents = new EventEmitter()
let nextClientEventId = 1

export const publishClientEvent = (
  channel: ClientEventChannel,
  payload: ClientEventPayload
) => {
  const event: ClientEvent = {
    ...payload,
    channel,
    id: String(nextClientEventId++),
    emittedAt: Date.now()
  }
  clientEvents.emit('event', event)
}

export const subscribeClientEvents = (
  listener: ClientEventListener,
  options: { channels?: Set<ClientEventChannel> } = {}
) => {
  const wrapped: ClientEventListener = (event) => {
    if (options.channels != null && !options.channels.has(event.channel)) {
      return
    }
    listener(event)
  }
  clientEvents.on('event', wrapped)
  return () => {
    clientEvents.off('event', wrapped)
  }
}
