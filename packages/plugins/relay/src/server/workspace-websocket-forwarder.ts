/* eslint-disable max-lines -- workspace WebSocket channel lifecycle is kept together for relay tunneling. */
import { Buffer } from 'node:buffer'
import process from 'node:process'

import WebSocket from 'ws'

import type { RelayForwardingJob, RelayForwardingJobStatusUpdate } from './session-types.js'
import { isRecord, toString } from './utils.js'
import {
  RELAY_WORKSPACE_WS_CLOSE_MODE,
  RELAY_WORKSPACE_WS_OPEN_MODE,
  RELAY_WORKSPACE_WS_RECEIVE_MODE,
  RELAY_WORKSPACE_WS_SEND_MODE
} from './workspace-forwarding-modes.js'

const WORKSPACE_WS_OPEN_TIMEOUT_MS = 10_000
const WORKSPACE_WS_EVENT_QUEUE_LIMIT = 1_000
const WORKSPACE_WS_RECEIVE_LIMIT = 100

type RelayWorkspaceWebSocketEvent =
  | {
    type: 'close'
    code?: number
    reason?: string
  }
  | {
    type: 'error'
    message: string
  }
  | {
    type: 'message'
    dataBase64: string
    isBinary?: boolean
  }
  | {
    type: 'open'
  }

interface RelayWorkspaceWebSocketChannel {
  closed: boolean
  events: RelayWorkspaceWebSocketEvent[]
  socket: WebSocket
}

const workspaceWebSocketChannels = new Map<string, RelayWorkspaceWebSocketChannel>()

const isLocalHost = (host: string) => {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase()
  return normalized === '127.0.0.1' ||
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0.0.0.0'
}

const normalizeLoopbackHost = (host: string) => {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (normalized === '' || normalized === '0.0.0.0' || normalized === '::') return '127.0.0.1'
  return host
}

const normalizeWorkspaceServerBaseUrl = (rawBaseUrl?: string) => {
  if (rawBaseUrl != null && rawBaseUrl.trim() !== '') {
    const url = new URL(rawBaseUrl)
    if ((url.protocol !== 'http:' && url.protocol !== 'ws:') || !isLocalHost(url.hostname) || url.port === '') {
      throw new Error('workspace_ws_server_url_invalid')
    }
    url.protocol = 'ws:'
    url.hostname = normalizeLoopbackHost(url.hostname)
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    return url.toString()
  }

  const host = process.env.__ONEWORKS_PROJECT_SERVER_HOST__?.trim() || '127.0.0.1'
  const port = process.env.__ONEWORKS_PROJECT_SERVER_PORT__?.trim()
  if (port == null || port === '') {
    throw new Error('workspace_server_missing')
  }
  return `ws://${normalizeLoopbackHost(host)}:${port}`
}

const readRequest = (job: RelayForwardingJob) => {
  const parsed = JSON.parse(job.payload?.message ?? '{}') as unknown
  if (!isRecord(parsed)) throw new Error('workspace_ws_request_invalid')
  const channelId = toString(parsed.channelId)
  if (channelId === '') throw new Error('workspace_ws_channel_required')
  return {
    channelId,
    code: typeof parsed.code === 'number' && Number.isFinite(parsed.code)
      ? Math.max(1000, Math.min(4999, Math.floor(parsed.code)))
      : undefined,
    dataBase64: typeof parsed.dataBase64 === 'string' ? parsed.dataBase64 : undefined,
    isBinary: typeof parsed.isBinary === 'boolean' ? parsed.isBinary : false,
    path: toString(parsed.path),
    reason: toString(parsed.reason),
    serverBaseUrl: typeof parsed.serverBaseUrl === 'string' ? parsed.serverBaseUrl : undefined
  }
}

const rawMessageToBuffer = (data: WebSocket.RawData) => {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data)
}

const normalizeErrorCode = (error: unknown) => {
  const raw = error instanceof Error && error.message.trim() !== ''
    ? error.message
    : 'workspace_ws_forward_failed'
  return raw.trim().replace(/[^\w.:-]/g, '_').slice(0, 80) || 'workspace_ws_forward_failed'
}

const pushEvent = (channelId: string, event: RelayWorkspaceWebSocketEvent) => {
  const channel = workspaceWebSocketChannels.get(channelId)
  if (channel == null) return
  channel.events.push(event)
  if (channel.events.length > WORKSPACE_WS_EVENT_QUEUE_LIMIT) {
    channel.events.splice(0, channel.events.length - WORKSPACE_WS_EVENT_QUEUE_LIMIT)
  }
}

const readChannelEvents = (channelId: string) => {
  const channel = workspaceWebSocketChannels.get(channelId)
  if (channel == null) {
    return [{
      type: 'close',
      code: 1006,
      reason: 'Workspace WebSocket channel is not available.'
    }] satisfies RelayWorkspaceWebSocketEvent[]
  }

  const events = channel.events.splice(0, WORKSPACE_WS_RECEIVE_LIMIT)
  if (channel.closed && channel.events.length === 0) {
    workspaceWebSocketChannels.delete(channelId)
  }
  return events
}

const openWorkspaceWebSocket = async (job: RelayForwardingJob) => {
  const request = readRequest(job)
  if (request.path === '' || !request.path.startsWith('/')) {
    throw new Error('workspace_ws_path_invalid')
  }

  workspaceWebSocketChannels.get(request.channelId)?.socket.close(1000, 'Replaced by a new relay channel.')
  workspaceWebSocketChannels.delete(request.channelId)

  const url = new URL(request.path, normalizeWorkspaceServerBaseUrl(request.serverBaseUrl))
  const socket = new WebSocket(url)
  const channel: RelayWorkspaceWebSocketChannel = {
    closed: false,
    events: [],
    socket
  }
  workspaceWebSocketChannels.set(request.channelId, channel)

  socket.on('message', (data, isBinary) => {
    pushEvent(request.channelId, {
      type: 'message',
      dataBase64: rawMessageToBuffer(data).toString('base64'),
      isBinary
    })
  })
  socket.on('close', (code, reason) => {
    channel.closed = true
    pushEvent(request.channelId, {
      type: 'close',
      code,
      reason: reason.toString()
    })
  })
  socket.on('error', (error) => {
    pushEvent(request.channelId, {
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('workspace_ws_open_timeout'))
    }, WORKSPACE_WS_OPEN_TIMEOUT_MS)

    socket.once('open', () => {
      clearTimeout(timer)
      pushEvent(request.channelId, { type: 'open' })
      resolve()
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

const sendWorkspaceWebSocketMessage = (job: RelayForwardingJob) => {
  const request = readRequest(job)
  const channel = workspaceWebSocketChannels.get(request.channelId)
  if (channel == null || channel.socket.readyState !== WebSocket.OPEN) {
    throw new Error('workspace_ws_not_open')
  }
  if (request.dataBase64 == null) {
    throw new Error('workspace_ws_message_required')
  }
  const message = Buffer.from(request.dataBase64, 'base64')
  channel.socket.send(request.isBinary ? message : message.toString('utf8'))
}

const closeWorkspaceWebSocket = (job: RelayForwardingJob) => {
  const request = readRequest(job)
  const channel = workspaceWebSocketChannels.get(request.channelId)
  if (channel == null) return
  channel.socket.close(request.code ?? 1000, request.reason || 'Relay workspace WebSocket closed.')
}

export const forwardLocalRelayWorkspaceWebSocketJob = async (
  job: RelayForwardingJob
): Promise<RelayForwardingJobStatusUpdate> => {
  try {
    if (job.mode === RELAY_WORKSPACE_WS_OPEN_MODE) {
      await openWorkspaceWebSocket(job)
      return { result: { ok: true }, status: 'succeeded' }
    }
    if (job.mode === RELAY_WORKSPACE_WS_SEND_MODE) {
      sendWorkspaceWebSocketMessage(job)
      return { result: { ok: true }, status: 'succeeded' }
    }
    if (job.mode === RELAY_WORKSPACE_WS_CLOSE_MODE) {
      closeWorkspaceWebSocket(job)
      return { result: { ok: true }, status: 'succeeded' }
    }
    if (job.mode === RELAY_WORKSPACE_WS_RECEIVE_MODE) {
      const request = readRequest(job)
      return {
        result: {
          events: readChannelEvents(request.channelId)
        },
        status: 'succeeded'
      }
    }
    return {
      errorCode: 'workspace_ws_mode_invalid',
      status: 'failed'
    }
  } catch (error) {
    return {
      errorCode: normalizeErrorCode(error),
      status: 'failed'
    }
  }
}
