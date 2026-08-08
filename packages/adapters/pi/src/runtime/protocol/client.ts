import { uuid } from '@oneworks/utils/uuid'

import { JsonlDecoder } from './jsonl'
import type { PiProcess, PiRpcCommand, PiRpcEvent, PiRpcResponse } from './types'

interface PendingRequest {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}

const MAX_STDERR_LENGTH = 64 * 1024

export class PiRpcClient {
  private readonly decoder = new JsonlDecoder()
  private readonly eventListeners = new Set<(event: PiRpcEvent) => void>()
  private readonly errorListeners = new Set<(error: Error) => void>()
  private readonly exitListeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>()
  private readonly pending = new Map<string, PendingRequest>()
  private closePromise?: Promise<void>
  private closed = false
  private exited = false
  private stderr = ''

  constructor(private readonly process: PiProcess, private readonly timeoutMs = 30_000) {
    process.stdout.setEncoding('utf8')
    process.stderr.setEncoding('utf8')
    process.stdout.on('data', (chunk: string) => this.consume(chunk))
    process.stderr.on('data', (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-MAX_STDERR_LENGTH)
    })
    process.on('error', error => this.fail(error))
    process.on('exit', (code, signal) => {
      this.closed = true
      this.exited = true
      this.consumeRecords(this.decoder.finish())
      this.rejectPending(new Error(`Pi process exited before responding (code ${code ?? 'unknown'}).`))
      this.exitListeners.forEach(listener => listener(code, signal))
    })
  }

  get capturedStderr() {
    return this.stderr
  }

  onEvent(listener: (event: PiRpcEvent) => void) {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  onError(listener: (error: Error) => void) {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void) {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  async request<T = unknown>(command: PiRpcCommand): Promise<T> {
    if (this.closed) throw new Error('Pi RPC process is closed.')
    const id = command.id ?? `oneworks-${uuid()}`
    const response = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Pi RPC command "${command.type}" timed out after ${this.timeoutMs}ms.`))
      }, this.timeoutMs)
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timeout })
    })
    try {
      await this.write({ ...command, id })
    } catch (error) {
      const pending = this.pending.get(id)
      if (pending != null) {
        clearTimeout(pending.timeout)
        this.pending.delete(id)
        pending.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    return response
  }

  async notify(command: PiRpcCommand) {
    if (this.closed) throw new Error('Pi RPC process is closed.')
    await this.write(command)
  }

  close() {
    this.closePromise ??= this.closeProcess()
    return this.closePromise
  }

  private async closeProcess() {
    if (this.exited) return
    this.closed = true
    this.rejectPending(new Error('Pi RPC process closed.'))
    this.process.stdin.end()
    if (await this.waitForExit(750)) return
    this.process.kill('SIGTERM')
    if (await this.waitForExit(1_000)) return
    this.process.kill('SIGKILL')
    await this.waitForExit(1_000)
  }

  private async write(command: PiRpcCommand) {
    await new Promise<void>((resolve, reject) => {
      this.process.stdin.write(`${JSON.stringify(command)}\n`, error => error == null ? resolve() : reject(error))
    })
  }

  private consume(chunk: string) {
    this.consumeRecords(this.decoder.push(chunk))
  }

  private consumeRecords(records: string[]) {
    for (const record of records) {
      try {
        const value = JSON.parse(record) as PiRpcEvent | PiRpcResponse
        if (value.type === 'response') this.resolveResponse(value as PiRpcResponse)
        else this.eventListeners.forEach(listener => listener(value as PiRpcEvent))
      } catch (error) {
        this.fail(new Error(`Pi emitted invalid JSONL: ${error instanceof Error ? error.message : String(error)}`))
      }
    }
  }

  private resolveResponse(response: PiRpcResponse) {
    if (response.id == null) return
    const pending = this.pending.get(response.id)
    if (pending == null) return
    clearTimeout(pending.timeout)
    this.pending.delete(response.id)
    if (response.success) pending.resolve(response.data)
    else pending.reject(new Error(response.error ?? `Pi RPC command "${response.command}" failed.`))
  }

  private fail(error: Error) {
    this.rejectPending(error)
    this.errorListeners.forEach(listener => listener(error))
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
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
