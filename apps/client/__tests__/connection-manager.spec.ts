import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConnectionManager } from '#~/connectionManager'

type ListenerMap = Partial<Record<keyof WebSocketEventMap, Array<(event: Event) => void>>>

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readonly listeners: ListenerMap = {}
  readonly sent: string[] = []
  readyState = MockWebSocket.CONNECTING

  constructor(readonly url: string) {
    mockSockets.push(this)
  }

  addEventListener(type: keyof WebSocketEventMap, listener: (event: Event) => void) {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener]
  }

  send(data: string) {
    this.sent.push(data)
  }

  close(code = 1000, reason = '') {
    if (this.readyState === MockWebSocket.CLOSED) return
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', { code, reason })
  }

  open() {
    this.readyState = MockWebSocket.OPEN
    this.emit('open')
  }

  error() {
    this.emit('error')
  }

  message(data: unknown) {
    this.emit('message', { data: JSON.stringify(data) })
  }

  private emit(type: keyof WebSocketEventMap, init?: { code?: number; data?: string; reason?: string }) {
    for (const listener of this.listeners[type] ?? []) {
      listener(Object.assign(new Event(type), init))
    }
  }
}

const mockSockets: MockWebSocket[] = []

const createStorage = (): Storage => {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, value)
    }
  }
}

describe('connection manager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSockets.length = 0
    vi.stubGlobal('WebSocket', MockWebSocket)
    vi.stubGlobal('localStorage', createStorage())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reconnects a subscribed session after the server closes the socket', () => {
    const manager = new ConnectionManager()
    const onClose = vi.fn()
    const onOpen = vi.fn()

    manager.connect('session-1', { onClose, onOpen }, { model: 'gpt-5.2' })

    expect(mockSockets).toHaveLength(1)
    expect(mockSockets[0].url).toContain('sessionId=session-1')
    expect(mockSockets[0].url).toContain('model=gpt-5.2')

    mockSockets[0].open()
    mockSockets[0].close(1006)

    expect(onClose).toHaveBeenCalledOnce()
    expect(mockSockets).toHaveLength(1)

    vi.advanceTimersByTime(999)
    expect(mockSockets).toHaveLength(1)

    vi.advanceTimersByTime(1)
    expect(mockSockets).toHaveLength(2)
    expect(mockSockets[1].url).toContain('sessionId=session-1')
    expect(mockSockets[1].url).toContain('model=gpt-5.2')

    mockSockets[1].open()
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('does not reconnect after the last subscriber leaves', () => {
    const manager = new ConnectionManager()
    const cleanup = manager.connect('session-1', {})

    expect(mockSockets).toHaveLength(1)

    cleanup()
    mockSockets[0].close()
    vi.advanceTimersByTime(1000)

    expect(mockSockets).toHaveLength(1)
  })

  it('does not reconnect when a subscriber marks the close as unrecoverable', () => {
    const manager = new ConnectionManager()
    const onClose = vi.fn()

    manager.connect('session-1', {
      onClose,
      shouldReconnect: event => event.code !== 1008
    })

    mockSockets[0].close(1008, 'Login required')
    vi.advanceTimersByTime(1000)

    expect(onClose).toHaveBeenCalledOnce()
    expect(onClose.mock.calls[0]?.[0]).toMatchObject({
      code: 1008,
      reason: 'Login required'
    })
    expect(mockSockets).toHaveLength(1)
  })

  it('does not reconnect after the subscriber observes a fatal session error', () => {
    const manager = new ConnectionManager()
    let fatalSessionError = false

    manager.connect('session-1', {
      onMessage: (data) => {
        fatalSessionError = data.type === 'error' &&
          data.data != null &&
          typeof data.data === 'object' &&
          'fatal' in data.data &&
          data.data.fatal !== false
      },
      shouldReconnect: () => !fatalSessionError
    })

    mockSockets[0].message({
      type: 'error',
      data: {
        message: 'Codex login expired.',
        fatal: true
      }
    })
    mockSockets[0].close(1011, 'adapter failed')
    vi.advanceTimersByTime(1000)

    expect(fatalSessionError).toBe(true)
    expect(mockSockets).toHaveLength(1)
  })
})
