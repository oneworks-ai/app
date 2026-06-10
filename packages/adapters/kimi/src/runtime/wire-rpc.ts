import type { ChildProcess } from 'node:child_process'
import readline from 'node:readline'

import type { AdapterCtx } from '@oneworks/types'

export class KimiWireRpcError extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(`[${code}] ${message}`)
    this.name = 'KimiWireRpcError'
    this.code = code
    this.data = data
  }
}

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}

type NotificationHandler = (method: string, params: Record<string, unknown>) => void
type RequestHandler = (id: string, method: string, params: Record<string, unknown>) => void

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asRecord = (value: unknown): Record<string, unknown> => (
  isRecord(value) ? value : {}
)

export class KimiWireRpcClient {
  private idCounter = 0
  private pending = new Map<string, PendingRequest>()
  private notificationHandlers: NotificationHandler[] = []
  private requestHandlers: RequestHandler[] = []
  private readonly rl: readline.Interface

  constructor(
    private readonly proc: ChildProcess,
    private readonly logger: AdapterCtx['logger']
  ) {
    this.rl = readline.createInterface({ input: proc.stdout! })
    this.rl.on('line', (line) => {
      const trimmed = line.trim()
      if (trimmed === '') return
      this.logger.debug('[kimi wire rpc] recv', { line: trimmed })

      let message: Record<string, unknown>
      try {
        message = JSON.parse(trimmed) as Record<string, unknown>
      } catch (error) {
        this.logger.error('[kimi wire rpc] failed to parse JSON-RPC line', { line: trimmed, error })
        return
      }

      if (typeof message.method === 'string') {
        const params = asRecord(message.params)
        if (typeof message.id === 'string') {
          for (const handler of this.requestHandlers) {
            try {
              handler(message.id, message.method, params)
            } catch (error) {
              this.logger.error('[kimi wire rpc] request handler failed', { error })
            }
          }
          return
        }

        for (const handler of this.notificationHandlers) {
          try {
            handler(message.method, params)
          } catch (error) {
            this.logger.error('[kimi wire rpc] notification handler failed', { error })
          }
        }
        return
      }

      if (typeof message.id !== 'string') return

      const pending = this.pending.get(message.id)
      if (pending == null) {
        this.logger.warn('[kimi wire rpc] received response for unknown id', { id: message.id })
        return
      }
      this.pending.delete(message.id)

      if (isRecord(message.error)) {
        pending.reject(
          new KimiWireRpcError(
            typeof message.error.code === 'number' ? message.error.code : -32603,
            typeof message.error.message === 'string' ? message.error.message : 'Kimi Wire request failed',
            message.error.data
          )
        )
        return
      }

      pending.resolve(message.result)
    })
  }

  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = String(++this.idCounter)
    const message = {
      jsonrpc: '2.0',
      method,
      id,
      ...(params != null ? { params } : {})
    }

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject
      })
      const line = `${JSON.stringify(message)}\n`
      this.logger.debug('[kimi wire rpc] send', { line: line.trim() })
      this.proc.stdin!.write(line, (error) => {
        if (error != null) {
          this.pending.delete(id)
          reject(error)
        }
      })
    })
  }

  respond(id: string, result: unknown): void {
    const line = `${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`
    this.logger.debug('[kimi wire rpc] respond', { line: line.trim() })
    this.proc.stdin!.write(line)
  }

  respondError(id: string, error: { code: number; message: string; data?: unknown }): void {
    const line = `${
      JSON.stringify(
        {
          jsonrpc: '2.0',
          id,
          error: {
            code: error.code,
            message: error.message,
            ...(error.data !== undefined ? { data: error.data } : {})
          }
        }
      )
    }\n`
    this.logger.debug('[kimi wire rpc] respond error', { line: line.trim() })
    this.proc.stdin!.write(line)
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandlers.push(handler)
  }

  onRequest(handler: RequestHandler): void {
    this.requestHandlers.push(handler)
  }

  destroy(reason = 'Kimi Wire client destroyed'): void {
    this.rl.close()
    const error = new Error(reason)
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }
}
