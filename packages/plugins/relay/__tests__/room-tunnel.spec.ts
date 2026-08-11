import { describe, expect, it } from 'vitest'

import { createRelayRoomTunnel } from '../src/server/room-tunnel.js'

describe('relay Room tunnel', () => {
  it('rejects a Room request that lacks the stable operation identifier', () => {
    const tunnel = createRelayRoomTunnel()

    expect(tunnel.handleFrame({
      action: 'send',
      principal: { id: 'user-2', type: 'user' },
      requestId: 'request-1',
      shareId: 'share-1',
      type: 'room-request'
    })).toBe(false)
  })

  it('does not queue descriptor traffic while disconnected and sends a single live response', async () => {
    const tunnel = createRelayRoomTunnel()
    const connectionStates: boolean[] = []
    const unsubscribe = tunnel.subscribeConnection(connected => connectionStates.push(connected))
    expect(tunnel.isConnected()).toBe(false)
    expect(tunnel.publishDescriptor({ shareId: 'share-1' })).toBe(false)

    const frames: string[] = []
    const send = (frame: string) => frames.push(frame)
    tunnel.setTransport(send)
    expect(tunnel.isConnected()).toBe(true)
    tunnel.setRequestHandler(async request => ({ acceptedFor: request.principal.id }))
    expect(tunnel.publishDescriptor({ shareId: 'share-1' })).toBe(true)
    expect(tunnel.handleFrame({
      action: 'send',
      body: { content: 'live only' },
      operationId: 'operation-1',
      principal: { id: 'user-2', type: 'user' },
      requestId: 'request-1',
      shareId: 'share-1',
      type: 'room-request'
    })).toBe(true)
    await new Promise(resolve => setImmediate(resolve))
    expect(frames.map(frame => JSON.parse(frame))).toEqual([
      { descriptor: { shareId: 'share-1' }, type: 'room-descriptor' },
      {
        body: { acceptedFor: 'user-2' },
        ok: true,
        requestId: 'request-1',
        shareId: 'share-1',
        type: 'room-response'
      }
    ])

    tunnel.clearTransport(send)
    expect(tunnel.isConnected()).toBe(false)
    expect(tunnel.publishDescriptor({ shareId: 'share-2' })).toBe(false)
    expect(frames).toHaveLength(2)
    expect(connectionStates).toEqual([true, false])
    unsubscribe()
  })
})
