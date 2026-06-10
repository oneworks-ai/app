/* eslint-disable max-lines -- websocket lifecycle state is kept together for consistent reconnect behavior. */

import type { WSEvent } from '@oneworks/core'
import { createSocket } from './ws'
import type { WSHandlers } from './ws'

export class ConnectionManager {
  private sockets = new Map<string, WebSocket>()
  private subscribers = new Map<string, Set<WSHandlers>>()
  private disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private reconnectAttempts = new Map<string, number>()
  private connectionParams = new Map<string, string>()
  private connectionParamValues = new Map<string, Record<string, string>>()

  // Keep connection alive for 60 seconds after last subscriber leaves
  // This allows for quick navigation between sessions without reconnecting
  // and basic background task updates if the user quickly checks back
  private readonly DISCONNECT_DELAY = 60000
  private readonly RECONNECT_BASE_DELAY = 1000
  private readonly RECONNECT_MAX_DELAY = 15000

  /**
   * Connect to a session or reuse existing connection
   * @param sessionId The session ID to connect to
   * @param handlers Event handlers for this subscription
   * @returns A cleanup function to unsubscribe
   */
  connect(sessionId: string, handlers: WSHandlers, params?: Record<string, string>): () => void {
    // 1. Cancel any pending disconnect timer
    if (this.disconnectTimers.has(sessionId)) {
      clearTimeout(this.disconnectTimers.get(sessionId)!)
      this.disconnectTimers.delete(sessionId)
    }
    if (this.reconnectTimers.has(sessionId)) {
      clearTimeout(this.reconnectTimers.get(sessionId)!)
      this.reconnectTimers.delete(sessionId)
    }

    // 2. Add subscriber
    if (!this.subscribers.has(sessionId)) {
      this.subscribers.set(sessionId, new Set())
    }
    this.subscribers.get(sessionId)!.add(handlers)

    // 3. Ensure WebSocket is open
    const nextParams = this.normalizeParams({ sessionId, ...(params ?? {}) })
    const paramsKey = this.buildParamsKey(nextParams)
    const prevParamsKey = this.connectionParams.get(sessionId)
    let ws = this.sockets.get(sessionId)

    if (prevParamsKey != null && prevParamsKey !== paramsKey && ws) {
      this.sockets.delete(sessionId)
      this.closeSocket(ws)
      ws = undefined
    }

    // If socket doesn't exist or is closed/closing, create a new one
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      this.createConnection(sessionId, nextParams)
    } else if (ws.readyState === WebSocket.OPEN) {
      // If already open, trigger onOpen immediately for this new subscriber
      handlers.onOpen?.()
    }

    this.connectionParams.set(sessionId, paramsKey)
    this.connectionParamValues.set(sessionId, nextParams)
    // 4. Return unsubscribe function
    return () => this.disconnect(sessionId, handlers)
  }

  private createConnection(sessionId: string, params: Record<string, string>) {
    const ws = createSocket({
      onOpen: () => {
        this.reconnectAttempts.delete(sessionId)
        this.broadcast(sessionId, 'onOpen')
      },
      onMessage: (data: WSEvent) => {
        this.broadcast(sessionId, 'onMessage', data)
      },
      onError: (err: Event) => {
        this.broadcast(sessionId, 'onError', err)
        if (this.sockets.get(sessionId) === ws) {
          this.closeSocket(ws)
        }
      },
      onClose: (event) => {
        this.broadcast(sessionId, 'onClose', event)
        if (this.sockets.get(sessionId) === ws) {
          this.sockets.delete(sessionId)
          if (this.shouldReconnect(sessionId, event)) {
            this.scheduleReconnect(sessionId)
          } else {
            this.reconnectAttempts.delete(sessionId)
          }
        }
      }
    }, params)

    this.sockets.set(sessionId, ws)
  }

  private scheduleReconnect(sessionId: string) {
    if (this.reconnectTimers.has(sessionId)) {
      return
    }

    const subs = this.subscribers.get(sessionId)
    const params = this.connectionParamValues.get(sessionId)
    if (subs == null || subs.size === 0 || params == null) {
      this.reconnectAttempts.delete(sessionId)
      return
    }

    const attempt = this.reconnectAttempts.get(sessionId) ?? 0
    const delay = Math.min(this.RECONNECT_BASE_DELAY * 2 ** attempt, this.RECONNECT_MAX_DELAY)
    this.reconnectAttempts.set(sessionId, attempt + 1)

    this.reconnectTimers.set(
      sessionId,
      setTimeout(() => {
        this.reconnectTimers.delete(sessionId)
        const activeSubs = this.subscribers.get(sessionId)
        if (activeSubs == null || activeSubs.size === 0) {
          this.reconnectAttempts.delete(sessionId)
          return
        }

        if (this.sockets.has(sessionId)) {
          return
        }

        this.createConnection(sessionId, params)
      }, delay)
    )
  }

  private disconnect(sessionId: string, handlers: WSHandlers) {
    const subs = this.subscribers.get(sessionId)
    if (subs) {
      subs.delete(handlers)

      // If no more subscribers, schedule disconnect
      if (subs.size === 0) {
        this.disconnectTimers.set(
          sessionId,
          setTimeout(() => {
            const ws = this.sockets.get(sessionId)
            if (ws) {
              this.sockets.delete(sessionId)
              this.closeSocket(ws)
            }
            this.disconnectTimers.delete(sessionId)
            this.reconnectAttempts.delete(sessionId)
            this.subscribers.delete(sessionId)
            this.connectionParams.delete(sessionId)
            this.connectionParamValues.delete(sessionId)
          }, this.DISCONNECT_DELAY)
        )
      }
    }
  }

  private broadcast(sessionId: string, method: keyof WSHandlers, data?: any) {
    const subs = this.subscribers.get(sessionId)
    if (subs) {
      // Create a copy to avoid issues if handlers unsubscribe during execution
      const handlers = Array.from(subs)
      handlers.forEach(h => {
        if (h[method]) {
          try {
            // @ts-ignore - Dynamic dispatch
            h[method](data)
          } catch (e) {
            console.error(`Error in ${method} handler for session ${sessionId}:`, e)
          }
        }
      })
    }
  }

  private shouldReconnect(sessionId: string, event: CloseEvent) {
    const subs = this.subscribers.get(sessionId)
    if (subs == null) {
      return false
    }

    return Array.from(subs).every(handler => handler.shouldReconnect?.(event) !== false)
  }

  /**
   * Manually close a connection if needed
   */
  close(sessionId: string) {
    const ws = this.sockets.get(sessionId)
    if (ws) {
      this.sockets.delete(sessionId)
      this.closeSocket(ws)
    }
    if (this.disconnectTimers.has(sessionId)) {
      clearTimeout(this.disconnectTimers.get(sessionId)!)
      this.disconnectTimers.delete(sessionId)
    }
    if (this.reconnectTimers.has(sessionId)) {
      clearTimeout(this.reconnectTimers.get(sessionId)!)
      this.reconnectTimers.delete(sessionId)
    }
    this.reconnectAttempts.delete(sessionId)
    this.subscribers.delete(sessionId)
    this.connectionParams.delete(sessionId)
    this.connectionParamValues.delete(sessionId)
  }

  /**
   * Send a message to the session
   */
  send(sessionId: string, data: any) {
    const ws = this.sockets.get(sessionId)
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(typeof data === 'string' ? data : JSON.stringify(data))
      return true
    }

    console.warn(`Cannot send message: Session ${sessionId} not connected or ready`)
    return false
  }

  private normalizeParams(params: Record<string, string>) {
    return Object.entries(params).reduce<Record<string, string>>((acc, [key, value]) => {
      if (value == null) return acc
      const trimmed = String(value).trim()
      if (trimmed === '') return acc
      acc[key] = trimmed
      return acc
    }, {})
  }

  private buildParamsKey(params: Record<string, string>) {
    return Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('&')
  }

  private closeSocket(ws: WebSocket) {
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      return
    }
    ws.close()
  }
}

export const connectionManager = new ConnectionManager()
