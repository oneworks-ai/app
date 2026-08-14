/* eslint-disable max-lines -- JSON-RPC request, response, and process settlement share one state owner. */
import { uuid } from '@oneworks/utils/uuid'

import type { AcpMessage, KiroAcpProcess } from './types'

interface PendingRequest {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
  timeout?: ReturnType<typeof setTimeout>
}

interface RequestOptions {
  /** `null` keeps a long-running request pending until response, cancellation, or process exit. */
  timeoutMs?: number | null
}

export class AcpProtocolError extends Error {
  constructor(message: string, readonly code: number, readonly data?: unknown) {
    super(message)
    this.name = 'AcpProtocolError'
  }
}

export class KiroAcpClient {
  private readonly notificationListeners = new Set<(method: string, params: unknown) => void>()
  private readonly requestListeners = new Set<(message: AcpMessage) => void>()
  private readonly errorListeners = new Set<(error: Error) => void>()
  private readonly exitListeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>()
  private readonly pending = new Map<string, PendingRequest>()
  private buffer = ''
  private closePromise?: Promise<void>
  private closed = false
  private exited = false

  constructor(private readonly process: KiroAcpProcess, private readonly timeoutMs = 30_000) {
    process.stdout.setEncoding('utf8')
    process.stdout.on('data', (chunk: string) => this.consume(chunk))
    process.stderr.on('data', () => undefined)
    process.on('error', error => this.fail(error))
    process.on('exit', (code, signal) => {
      this.closed = true
      this.exited = true
      this.flush()
      this.rejectPending(new Error(`Kiro ACP process exited before responding (code ${code ?? 'unknown'}).`))
      this.exitListeners.forEach(listener => listener(code, signal))
    })
  }

  onNotification(listener: (method: string, params: unknown) => void) {
    this.notificationListeners.add(listener)
    return () => this.notificationListeners.delete(listener)
  }

  onRequest(listener: (message: AcpMessage) => void) {
    this.requestListeners.add(listener)
    return () => this.requestListeners.delete(listener)
  }

  onError(listener: (error: Error) => void) {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void) {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  async request<T = unknown>(method: string, params: unknown, options: RequestOptions = {}): Promise<T> {
    if (this.closed) throw new Error('Kiro ACP process is closed.')
    const id = `oneworks-${uuid()}`
    const response = new Promise<T>((resolve, reject) => {
      const defaultTimeoutMs = method === 'session/prompt' ? null : this.timeoutMs
      const timeoutMs = options.timeoutMs === undefined ? defaultTimeoutMs : options.timeoutMs
      const timeout = timeoutMs == null
        ? undefined
        : setTimeout(() => {
          this.pending.delete(id)
          reject(new Error(`Kiro ACP request "${method}" timed out after ${timeoutMs}ms.`))
        }, timeoutMs)
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timeout })
    })
    try {
      await this.write({ jsonrpc: '2.0', id, method, params })
    } catch (error) {
      const pending = this.pending.get(id)
      if (pending != null) {
        if (pending.timeout != null) clearTimeout(pending.timeout)
        this.pending.delete(id)
        pending.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    return response
  }

  notify(method: string, params: unknown) {
    if (this.closed) return Promise.reject(new Error('Kiro ACP process is closed.'))
    return this.write({ jsonrpc: '2.0', method, params })
  }

  respond(id: number | string, result: unknown) {
    return this.write({ jsonrpc: '2.0', id, result })
  }

  respondError(id: number | string, code: number, message: string) {
    return this.write({ jsonrpc: '2.0', id, error: { code, message } })
  }

  close() {
    this.closePromise ??= this.closeProcess()
    return this.closePromise
  }

  private async closeProcess() {
    if (this.exited) return
    this.closed = true
    this.rejectPending(new Error('Kiro ACP process closed.'))
    this.process.stdin.end()
    if (await this.waitForExit(750)) return
    this.process.kill('SIGTERM')
    if (await this.waitForExit(1_000)) return
    this.process.kill('SIGKILL')
    await this.waitForExit(1_000)
  }

  private write(message: AcpMessage) {
    return new Promise<void>((resolve, reject) => {
      this.process.stdin.write(`${JSON.stringify(message)}\n`, error => error == null ? resolve() : reject(error))
    })
  }

  private consume(chunk: string) {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const record = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (record !== '') this.consumeRecord(record)
      index = this.buffer.indexOf('\n')
    }
  }

  private flush() {
    const record = this.buffer.trim()
    this.buffer = ''
    if (record !== '') this.consumeRecord(record)
  }

  private consumeRecord(record: string) {
    try {
      const message = JSON.parse(record) as AcpMessage
      if (message.jsonrpc !== '2.0') throw new Error('missing jsonrpc 2.0 marker')
      if (message.method != null && message.id != null) {
        this.requestListeners.forEach(listener => listener(message))
      } else if (message.method != null) {
        this.notificationListeners.forEach(listener => listener(message.method!, message.params))
      } else if (message.id != null) {
        this.resolveResponse(message)
      }
    } catch (error) {
      this.fail(new Error(`Kiro ACP emitted invalid JSONL: ${error instanceof Error ? error.message : String(error)}`))
    }
  }

  private resolveResponse(message: AcpMessage) {
    const id = String(message.id)
    const pending = this.pending.get(id)
    if (pending == null) return
    if (pending.timeout != null) clearTimeout(pending.timeout)
    this.pending.delete(id)
    if (message.error != null) {
      pending.reject(new AcpProtocolError(message.error.message, message.error.code, message.error.data))
    } else {
      pending.resolve(message.result)
    }
  }

  private fail(error: Error) {
    this.rejectPending(error)
    this.errorListeners.forEach(listener => listener(error))
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      if (pending.timeout != null) clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private waitForExit(timeoutMs: number) {
    if (this.exited) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      const onExit = () => {
        clearTimeout(timeout)
        resolve(true)
      }
      const timeout = setTimeout(() => {
        this.process.off('exit', onExit)
        resolve(this.exited)
      }, timeoutMs)
      this.process.once('exit', onExit)
    })
  }
}
