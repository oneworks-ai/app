/* eslint-disable max-lines -- protocol negotiation, dispatch, and single-finalization state share one owner. */
import { uuid } from '@oneworks/utils/uuid'

import { JsonlDecoder } from './jsonl'
import { FACTORY_API_VERSION, FACTORY_PROTOCOL_VERSION } from './types'
import type { DroidProcess, FactoryIncoming, FactoryNotification, FactoryRequest, FactoryResponse } from './types'

interface PendingRequest {
  method: string
  reject: (error: Error) => void
  resolve: (value: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}

interface DroidJsonRpcClientOptions {
  maxJsonlFrameBytes?: number
  postExitDrainTimeoutMs?: number
  redact?: (value: string) => string
  requestTimeoutMs?: number
}

interface ProcessOutcome {
  code: number | null
  signal: NodeJS.Signals | null
}

const MAX_STDERR_LENGTH = 64 * 1024

const protocolError = (actual: unknown) =>
  new Error(
    `Factory Droid protocol version mismatch: expected ${FACTORY_PROTOCOL_VERSION}, received ${
      String(actual ?? 'missing')
    }.`
  )

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const validateSessionSnapshot = (value: unknown, method: string) => {
  if (!isRecord(value)) throw new Error(`Factory Droid ${method} returned a malformed result.`)
  if (!isRecord(value.session) || !Array.isArray(value.session.messages)) {
    throw new Error(`Factory Droid ${method} returned a malformed session snapshot.`)
  }
  if (!isRecord(value.settings)) {
    throw new Error(`Factory Droid ${method} returned malformed session settings.`)
  }
  if (typeof value.sessionId !== 'string' || value.sessionId.trim() === '') {
    throw new Error(`Factory Droid ${method} returned no native session id.`)
  }
}

export class DroidJsonRpcClient {
  private readonly decoder: JsonlDecoder
  private readonly notificationListeners = new Set<(event: FactoryNotification) => void>()
  private readonly requestListeners = new Set<(request: FactoryRequest) => void>()
  private readonly errorListeners = new Set<(error: Error) => void>()
  private readonly exitListeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>()
  private readonly pending = new Map<string, PendingRequest>()
  private readonly postExitDrainTimeoutMs: number
  private readonly redact: (value: string) => string
  private readonly timeoutMs: number
  private closePromise?: Promise<void>
  private closed = false
  private drainTimeout?: ReturnType<typeof setTimeout>
  private exitOutcome?: ProcessOutcome
  private failed = false
  private finalized = false
  private readonly finalizationWaiters = new Set<() => void>()
  private stderr = ''

  constructor(private readonly process: DroidProcess, options: number | DroidJsonRpcClientOptions = {}) {
    const resolvedOptions = typeof options === 'number' ? { requestTimeoutMs: options } : options
    this.timeoutMs = resolvedOptions.requestTimeoutMs ?? 30_000
    this.decoder = new JsonlDecoder(resolvedOptions.maxJsonlFrameBytes)
    this.postExitDrainTimeoutMs = resolvedOptions.postExitDrainTimeoutMs ?? 500
    this.redact = resolvedOptions.redact ?? (value => value)
    process.stdout.setEncoding('utf8')
    process.stderr.setEncoding('utf8')
    process.stdout.on('data', (chunk: string) => this.consume(chunk))
    process.stderr.on('data', (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-MAX_STDERR_LENGTH)
    })
    process.on('error', error => this.failOnce(error))
    process.on('exit', (code, signal) => {
      this.recordExit(code, signal)
    })
    process.on('close', (code, signal) => {
      this.finalizeProcess({ code, signal })
    })
  }

  private recordExit(code: number | null, signal: NodeJS.Signals | null) {
    if (this.exitOutcome != null || this.finalized) return
    this.closed = true
    this.exitOutcome = { code, signal }
    this.drainTimeout = setTimeout(() => {
      this.finalizeProcess(this.exitOutcome!)
    }, this.postExitDrainTimeoutMs)
  }

  private finalizeProcess(fallbackOutcome: ProcessOutcome) {
    if (this.finalized) return
    this.finalized = true
    this.closed = true
    if (this.drainTimeout != null) clearTimeout(this.drainTimeout)
    const outcome = this.exitOutcome ?? fallbackOutcome
    try {
      this.consumeRecords(this.decoder.finish())
    } catch (error) {
      this.failOnce(error instanceof Error ? error : new Error(String(error)))
    }
    this.rejectPending(this.safeError(`Factory Droid exited before responding (code ${outcome.code ?? 'unknown'}).`))
    this.exitListeners.forEach(listener => listener(outcome.code, outcome.signal))
    this.finalizationWaiters.forEach(resolve => resolve())
    this.finalizationWaiters.clear()
  }

  get capturedStderr() {
    return this.redact(this.stderr)
  }

  get pendingRequestCount() {
    return this.pending.size
  }

  onNotification(listener: (event: FactoryNotification) => void) {
    this.notificationListeners.add(listener)
    return () => this.notificationListeners.delete(listener)
  }

  onRequest(listener: (request: FactoryRequest) => void) {
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

  async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (this.closed) throw new Error('Factory Droid JSON-RPC process is closed.')
    const id = `oneworks-${uuid()}`
    const response = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Factory Droid request "${method}" timed out after ${this.timeoutMs}ms.`))
      }, this.timeoutMs)
      this.pending.set(id, { method, resolve: value => resolve(value as T), reject, timeout })
    })
    try {
      await this.write({ ...this.base(), type: 'request', id, method, ...(params == null ? {} : { params }) })
    } catch (error) {
      this.rejectRequest(id, error instanceof Error ? error : new Error(String(error)))
    }
    return response
  }

  respond(id: string, result: unknown) {
    return this.write({ ...this.base(), type: 'response', id, result })
  }

  respondError(id: string, error: { code: number; message: string; data?: unknown }) {
    return this.write({ ...this.base(), type: 'response', id, error })
  }

  close() {
    this.closePromise ??= this.closeProcess()
    return this.closePromise
  }

  private base() {
    return {
      jsonrpc: '2.0' as const,
      factoryApiVersion: FACTORY_API_VERSION,
      factoryProtocolVersion: FACTORY_PROTOCOL_VERSION
    }
  }

  private async closeProcess() {
    if (this.finalized) return
    this.closed = true
    if (this.exitOutcome == null) {
      this.rejectPending(this.safeError('Factory Droid JSON-RPC process closed.'))
      this.process.stdin.end()
    }
    if (await this.waitForFinalization(750)) return
    this.process.kill('SIGTERM')
    if (await this.waitForFinalization(1_000)) return
    this.process.kill('SIGKILL')
    await this.waitForFinalization(1_000)
  }

  private async write(message: object) {
    if (this.closed) throw new Error('Factory Droid JSON-RPC process is closed.')
    await new Promise<void>((resolve, reject) => {
      this.process.stdin.write(`${JSON.stringify(message)}\n`, error => error == null ? resolve() : reject(error))
    })
  }

  private consume(chunk: string) {
    if (this.failed || this.finalized) return
    try {
      this.consumeRecords(this.decoder.push(chunk))
    } catch (error) {
      this.failOnce(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private consumeRecords(records: string[]) {
    for (const record of records) {
      try {
        const incoming = JSON.parse(record) as FactoryIncoming
        this.validateEnvelope(incoming)
        if (incoming.type === 'response') {
          this.resolveResponse(incoming as FactoryResponse)
        } else if (incoming.type === 'request') {
          this.requestListeners.forEach(listener => listener(incoming as FactoryRequest))
        } else if (incoming.type === 'notification') {
          this.notificationListeners.forEach(listener => listener(incoming as FactoryNotification))
        } else {
          throw new Error('Factory Droid emitted an unknown JSON-RPC envelope.')
        }
      } catch (error) {
        this.failOnce(
          this.safeError(
            `Factory Droid emitted invalid JSONL: ${error instanceof Error ? error.message : String(error)}. Frame: ${
              record.slice(0, 1_024)
            }`
          )
        )
      }
    }
  }

  private validateEnvelope(incoming: FactoryIncoming) {
    if (incoming.jsonrpc !== '2.0') {
      throw new Error(`Factory Droid emitted unsupported JSON-RPC version ${String(incoming.jsonrpc)}.`)
    }
    if (incoming.factoryApiVersion !== FACTORY_API_VERSION) {
      throw new Error(
        `Factory Droid API version mismatch: expected ${FACTORY_API_VERSION}, received ${
          String(incoming.factoryApiVersion ?? 'missing')
        }.`
      )
    }
    if (incoming.factoryProtocolVersion !== FACTORY_PROTOCOL_VERSION) {
      throw protocolError(incoming.factoryProtocolVersion)
    }
  }

  private resolveResponse(response: FactoryResponse) {
    const pending = this.pending.get(response.id)
    if (pending == null) return
    if (
      response.error == null && (
        pending.method === 'droid.initialize_session' || pending.method === 'droid.load_session'
      )
    ) {
      validateSessionSnapshot(response.result, pending.method)
    }
    clearTimeout(pending.timeout)
    this.pending.delete(response.id)
    if (response.error == null) pending.resolve(response.result)
    else {
      const details = response.error.data == null ? '' : ` Data: ${JSON.stringify(response.error.data)}`
      pending.reject(this.safeError(
        `${response.error.message ?? `Factory Droid request "${pending.method}" failed.`}${details}`
      ))
    }
  }

  private rejectRequest(id: string, error: Error) {
    const pending = this.pending.get(id)
    if (pending == null) return
    clearTimeout(pending.timeout)
    this.pending.delete(id)
    pending.reject(this.safeError(error))
  }

  private failOnce(error: Error) {
    if (this.failed) return
    this.failed = true
    this.closed = true
    const safeError = this.safeError(error)
    this.rejectPending(safeError)
    this.errorListeners.forEach(listener => listener(safeError))
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private safeError(value: unknown) {
    const source = value instanceof Error ? value : new Error(String(value))
    const error = new Error(this.redact(source.message))
    error.name = source.name
    if (source.stack != null) error.stack = this.redact(source.stack)
    return error
  }

  private waitForFinalization(timeoutMs: number) {
    if (this.finalized) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      const onFinalize = () => {
        clearTimeout(timeout)
        resolve(true)
      }
      const timeout = setTimeout(() => {
        this.finalizationWaiters.delete(onFinalize)
        resolve(this.finalized)
      }, timeoutMs)
      this.finalizationWaiters.add(onFinalize)
    })
  }
}
