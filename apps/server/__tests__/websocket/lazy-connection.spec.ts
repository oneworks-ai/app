import type { IncomingMessage } from 'node:http'

import { describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'

import type { ServerEnv } from '@oneworks/core'

import { createLazyWebSocketConnectionHandler } from '../../src/websocket/lazy-connection.js'

const ws = {} as WebSocket
const request = {} as IncomingMessage
const env = {} as ServerEnv

describe('createLazyWebSocketConnectionHandler', () => {
  it('does not load the protocol stack before the first connection', () => {
    const load = vi.fn(async () => vi.fn(async () => undefined))

    createLazyWebSocketConnectionHandler(load)

    expect(load).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent connection imports and dispatches every connection', async () => {
    let resolveHandler: ((handler: ReturnType<typeof vi.fn>) => void) | undefined
    const handler = vi.fn(async () => undefined)
    const load = vi.fn(() =>
      new Promise<typeof handler>(resolve => {
        resolveHandler = resolve
      })
    )
    const lazyHandler = createLazyWebSocketConnectionHandler(load)

    const first = lazyHandler(ws, request, env)
    const second = lazyHandler(ws, request, env)
    resolveHandler?.(handler)
    await Promise.all([first, second])

    expect(load).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('allows a later connection to retry after an import failure', async () => {
    const handler = vi.fn(async () => undefined)
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('chunk unavailable'))
      .mockResolvedValueOnce(handler)
    const lazyHandler = createLazyWebSocketConnectionHandler(load)

    await expect(lazyHandler(ws, request, env)).rejects.toThrow('chunk unavailable')
    await lazyHandler(ws, request, env)

    expect(load).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenCalledOnce()
  })
})
