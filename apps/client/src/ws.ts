import type { WSEvent } from '@oneworks/core'

import { createHomepagePreviewSocketIfEnabled } from '#~/homepage-preview/runtime-loader'
import { createServerUrl, getServerWsPath } from '#~/runtime-config.js'

import { getAuthToken } from './api/auth-token'

export interface WSHandlers<TMessage = WSEvent> {
  onOpen?: () => void
  onMessage?: (data: TMessage) => void
  onError?: (err: Event) => void
  onClose?: (event: CloseEvent) => void
  shouldReconnect?: (event: CloseEvent) => boolean
}

export const createWebSocketUrl = (params?: Record<string, string>) => {
  const url = new URL(createServerUrl(getServerWsPath()))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

  const authToken = getAuthToken()
  if (authToken != null) {
    url.searchParams.set('authToken', authToken)
  }

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
  }

  return url.toString()
}

export function createSocket<TMessage = WSEvent>(handlers: WSHandlers<TMessage>, params?: Record<string, string>) {
  const url = createWebSocketUrl(params)
  const ws = createHomepagePreviewSocketIfEnabled(url) ?? new WebSocket(url)
  ws.addEventListener('open', () => handlers.onOpen?.())
  ws.addEventListener('message', (ev) => {
    try {
      const data = JSON.parse(String(ev.data)) as unknown
      handlers.onMessage?.(data as TMessage)
    } catch (e) {
      console.error(e)
    }
  })
  ws.addEventListener('error', (err) => handlers.onError?.(err))
  ws.addEventListener('close', (ev) => handlers.onClose?.(ev))
  return ws
}
