import type { WSEvent } from '@oneworks/core'

import { createHomepagePreviewSocketIfEnabled } from '#~/homepage-preview/runtime-loader'
import { createServerUrl, createServerUrlFromBase, getServerWsPath, normalizeServerBaseUrl } from '#~/runtime-config.js'

import { getAuthToken } from './api/auth-token'

export interface WSHandlers<TMessage = WSEvent> {
  onOpen?: () => void
  onMessage?: (data: TMessage) => void
  onError?: (err: Event) => void
  onClose?: (event: CloseEvent) => void
  shouldReconnect?: (event: CloseEvent) => boolean
}

export interface WSOptions {
  serverBaseUrl?: string
}

export const createWebSocketUrl = (params?: Record<string, string>, options: WSOptions = {}) => {
  const normalizedServerBaseUrl = normalizeServerBaseUrl(options.serverBaseUrl)
  const url = new URL(
    normalizedServerBaseUrl == null
      ? createServerUrl(getServerWsPath())
      : createServerUrlFromBase(normalizedServerBaseUrl, getServerWsPath())
  )
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

const toMessageText = async (data: MessageEvent['data']) => {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data)
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return await data.text()
  }
  return String(data)
}

export function createSocket<TMessage = WSEvent>(
  handlers: WSHandlers<TMessage>,
  params?: Record<string, string>,
  options?: WSOptions
) {
  const url = createWebSocketUrl(params, options)
  const ws = createHomepagePreviewSocketIfEnabled(url) ?? new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  ws.addEventListener('open', () => handlers.onOpen?.())
  ws.addEventListener('message', (ev) => {
    try {
      void toMessageText(ev.data)
        .then((text) => {
          const data = JSON.parse(text) as unknown
          handlers.onMessage?.(data as TMessage)
        })
        .catch((error: unknown) => {
          console.error(error)
        })
    } catch (e) {
      console.error(e)
    }
  })
  ws.addEventListener('error', (err) => handlers.onError?.(err))
  ws.addEventListener('close', (ev) => handlers.onClose?.(ev))
  return ws
}
