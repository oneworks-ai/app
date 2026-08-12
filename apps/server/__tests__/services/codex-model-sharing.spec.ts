import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import {
  CODEX_MODEL_SHARING_MAX_BUFFERED_BYTES,
  handleCodexModelSharingSocket,
  isLoopbackSocketAddress
} from '#~/services/codex-model-sharing/index.js'
import { isCodexModelSharingUpgradePath, shouldAllowTokenlessCodexModelSharing } from '#~/websocket/server.js'

const mocks = vi.hoisted(() => ({
  bridgeClose: vi.fn(),
  bridgeSend: vi.fn(async () => undefined),
  createModelSharingBridge: vi.fn(),
  createServerAdapterAccountContext: vi.fn()
}))

vi.mock('#~/services/adapter-accounts.js', () => ({
  createServerAdapterAccountContext: mocks.createServerAdapterAccountContext
}))

class MockWebSocket extends EventEmitter {
  bufferedAmount = 0
  readyState = 1
  close = vi.fn()
  send = vi.fn((_message: string, callback?: (error?: Error) => void) => callback?.())
}

describe('codex model sharing transport', () => {
  it('accepts tokenless access only from real loopback socket addresses', () => {
    expect(isLoopbackSocketAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackSocketAddress('::1')).toBe(true)
    expect(isLoopbackSocketAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackSocketAddress('10.0.0.9')).toBe(false)
    expect(isLoopbackSocketAddress(undefined)).toBe(false)
    expect(shouldAllowTokenlessCodexModelSharing({
      remoteAddress: '127.0.0.1',
      headers: {}
    })).toBe(true)
    expect(shouldAllowTokenlessCodexModelSharing({
      remoteAddress: '127.0.0.1',
      headers: { origin: 'https://evil.example' }
    })).toBe(false)
    expect(shouldAllowTokenlessCodexModelSharing({
      remoteAddress: '10.0.0.9',
      headers: {}
    })).toBe(false)
  })

  it('mounts the bridge on the existing PM WebSocket server only for manager role', () => {
    const baseEnv = {
      __ONEWORKS_PROJECT_SERVER_WS_PATH__: '/ws'
    } as any
    expect(isCodexModelSharingUpgradePath('/api/adapters/codex/app-server', {
      ...baseEnv,
      __ONEWORKS_PROJECT_SERVER_ROLE__: 'manager'
    })).toBe(true)
    expect(isCodexModelSharingUpgradePath('/api/adapters/codex/app-server', {
      ...baseEnv,
      __ONEWORKS_PROJECT_SERVER_ROLE__: 'workspace'
    })).toBe(false)
    expect(isCodexModelSharingUpgradePath('/v1/responses', {
      ...baseEnv,
      __ONEWORKS_PROJECT_SERVER_ROLE__: 'manager'
    })).toBe(false)
  })

  it('queues the official CLI initialize frame while adapter context is still loading', async () => {
    vi.clearAllMocks()
    let releaseContext: (() => void) | undefined
    const contextReady = new Promise<void>((resolve) => {
      releaseContext = resolve
    })
    mocks.createServerAdapterAccountContext.mockImplementation(async () => {
      await contextReady
      return {
        workspaceFolder: '/workspace',
        adapterCtx: { env: {} },
        adapter: { createModelSharingBridge: mocks.createModelSharingBridge }
      }
    })
    mocks.createModelSharingBridge.mockResolvedValue({
      close: mocks.bridgeClose,
      send: mocks.bridgeSend
    })
    const ws = new MockWebSocket()

    const handling = handleCodexModelSharingSocket({
      ws: ws as any,
      env: {} as any,
      sessionId: 'sharing-session',
      account: null
    })
    ws.emit('message', Buffer.from('{"id":1,"method":"initialize"}'), false)
    releaseContext?.()
    await handling

    expect(mocks.bridgeSend).toHaveBeenCalledWith(Buffer.from('{"id":1,"method":"initialize"}'))
    expect(ws.close).not.toHaveBeenCalled()
    ws.emit('close')
  })

  it('closes a slow client before unbounded app-server output can accumulate', async () => {
    vi.clearAllMocks()
    let onMessage: ((message: string) => void) | undefined
    mocks.createServerAdapterAccountContext.mockResolvedValue({
      workspaceFolder: '/workspace',
      adapterCtx: { env: {} },
      adapter: { createModelSharingBridge: mocks.createModelSharingBridge }
    })
    mocks.createModelSharingBridge.mockImplementation(async (_ctx, options) => {
      onMessage = options.onMessage
      return {
        close: mocks.bridgeClose,
        send: mocks.bridgeSend
      }
    })
    const ws = new MockWebSocket()
    ws.bufferedAmount = CODEX_MODEL_SHARING_MAX_BUFFERED_BYTES
    await handleCodexModelSharingSocket({
      ws: ws as any,
      env: {} as any,
      sessionId: 'slow-client',
      account: null
    })

    onMessage?.('{"method":"large"}')

    expect(mocks.bridgeClose).toHaveBeenCalledOnce()
    expect(ws.close).toHaveBeenCalledWith(1011, 'Codex app-server bridge failed')
  })
})
