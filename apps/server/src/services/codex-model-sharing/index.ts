import { Buffer } from 'node:buffer'

import type { ServerEnv } from '@oneworks/core'
import type { AdapterModelSharingBridge } from '@oneworks/types'
import type { WebSocket } from 'ws'

import { createLogger } from '@oneworks/utils/create-logger'

import { createServerAdapterAccountContext } from '#~/services/adapter-accounts.js'

export const CODEX_MODEL_SHARING_WS_PATH = '/api/adapters/codex/app-server'
export const CODEX_MODEL_SHARING_MAX_MESSAGE_BYTES = 16 * 1024 * 1024
export const CODEX_MODEL_SHARING_MAX_CONNECTIONS = 4
export const CODEX_MODEL_SHARING_MAX_BUFFERED_BYTES = 16 * 1024 * 1024
const WEBSOCKET_OPEN = 1
let activeConnectionCount = 0

export const isLoopbackSocketAddress = (address: string | undefined) => (
  address === '::1' ||
  address?.startsWith('127.') === true ||
  address?.startsWith('::ffff:127.') === true
)

const normalizeAccount = (value: string | null) => {
  const account = value?.trim()
  if (account == null || account === '' || account === 'auto') return undefined
  return account
}

export const handleCodexModelSharingSocket = async (params: {
  ws: WebSocket
  env: ServerEnv
  sessionId: string
  account: string | null
}) => {
  const { ws, sessionId } = params
  if (activeConnectionCount >= CODEX_MODEL_SHARING_MAX_CONNECTIONS) {
    ws.close(1013, 'Codex model sharing is busy')
    return
  }
  activeConnectionCount += 1
  const abortController = new AbortController()
  let pendingBytes = 0
  let closed = false
  let releasedConnectionSlot = false
  let logger: ReturnType<typeof createLogger> | undefined
  let bridge: AdapterModelSharingBridge | undefined

  const closeWithFailure = (error: unknown) => {
    if (closed) return
    closed = true
    releaseConnectionSlot()
    abortController.abort()
    bridge?.close()
    logger?.warn(
      { errorName: error instanceof Error ? error.name : 'Error' },
      '[codex-model-sharing] Bridge closed after a protocol or runtime failure'
    )
    if (ws.readyState === WEBSOCKET_OPEN) ws.close(1011, 'Codex app-server bridge failed')
  }

  function releaseConnectionSlot() {
    if (releasedConnectionSlot) return
    releasedConnectionSlot = true
    activeConnectionCount = Math.max(0, activeConnectionCount - 1)
  }

  const bridgePromise = (async () => {
    const { workspaceFolder, adapter, adapterCtx } = await createServerAdapterAccountContext('codex')
    if (adapter.createModelSharingBridge == null) {
      throw new Error('The installed Codex adapter does not support built-in model sharing.')
    }
    logger = createLogger(
      workspaceFolder,
      'server/codex-model-sharing',
      'server',
      sessionId,
      'info',
      adapterCtx.env
    )
    return adapter.createModelSharingBridge(adapterCtx, {
      sessionId,
      account: normalizeAccount(params.account),
      signal: abortController.signal,
      onMessage: (message) => {
        if (ws.readyState !== WEBSOCKET_OPEN) return
        if (ws.bufferedAmount + Buffer.byteLength(message) > CODEX_MODEL_SHARING_MAX_BUFFERED_BYTES) {
          closeWithFailure(new Error('Codex app-server client is not consuming output.'))
          return
        }
        ws.send(message, error => {
          if (error != null) closeWithFailure(error)
        })
      },
      onError: closeWithFailure,
      onExit: (code, signal) => {
        if (closed) return
        closed = true
        releaseConnectionSlot()
        const normalExit = code === 0 || signal === 'SIGTERM'
        ws.close(normalExit ? 1000 : 1011, normalExit ? 'Codex app-server closed' : 'Codex app-server exited')
      }
    }).then((nextBridge) => {
      if (closed) {
        nextBridge.close()
        throw new DOMException('The Codex model-sharing client disconnected.', 'AbortError')
      }
      return nextBridge
    })
  })().then((nextBridge) => {
    bridge = nextBridge
    return nextBridge
  })

  // Register transport listeners before awaiting adapter/config loading. The
  // official CLI sends `initialize` immediately after the WebSocket upgrade.
  ws.on('message', (raw, isBinary) => {
    if (closed) return
    if (isBinary) {
      closeWithFailure(new Error('Binary Codex app-server messages are not supported.'))
      return
    }
    const message = Buffer.isBuffer(raw)
      ? raw
      : Array.isArray(raw)
      ? Buffer.concat(raw)
      : Buffer.from(raw as ArrayBuffer)
    pendingBytes += message.byteLength
    if (pendingBytes > CODEX_MODEL_SHARING_MAX_MESSAGE_BYTES) {
      closeWithFailure(new Error('Pending Codex app-server messages exceed the 16 MiB limit.'))
      return
    }
    void bridgePromise
      .then(nextBridge => nextBridge.send(message))
      .then(() => {
        pendingBytes -= message.byteLength
      })
      .catch(closeWithFailure)
  })
  ws.on('close', () => {
    releaseConnectionSlot()
    if (closed) return
    closed = true
    abortController.abort()
    bridge?.close()
  })
  ws.on('error', closeWithFailure)

  try {
    await bridgePromise
  } catch (error) {
    closeWithFailure(error)
    releaseConnectionSlot()
  }
}
