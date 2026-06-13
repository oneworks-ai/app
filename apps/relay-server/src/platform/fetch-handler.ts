import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { createRelayHandler } from '../server.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayTelemetry } from '../telemetry/metrics.js'
import type { RelayServerArgs } from '../types.js'

class RelayFetchIncomingMessage {
  headers: IncomingMessage['headers']
  method: string
  socket = {
    remoteAddress: 'fetch'
  }
  url: string

  constructor(
    request: Request,
    private readonly body: Uint8Array
  ) {
    this.method = request.method
    const url = new URL(request.url)
    this.url = `${url.pathname}${url.search}`
    this.headers = Object.fromEntries(request.headers.entries())
  }

  async *[Symbol.asyncIterator]() {
    if (this.body.byteLength > 0) yield Buffer.from(this.body)
  }
}

class RelayFetchServerResponse extends EventEmitter {
  headers = new Headers()
  headersSent = false
  statusCode = 200
  private body: Uint8Array[] = []
  private responsePromise: Promise<Response>
  private resolveResponse!: (response: Response) => void
  private rejectResponse!: (error: unknown) => void

  constructor() {
    super()
    this.responsePromise = new Promise((resolve, reject) => {
      this.resolveResponse = resolve
      this.rejectResponse = reject
    })
  }

  destroy(error?: Error) {
    this.rejectResponse(error ?? new Error('Response destroyed.'))
  }

  end(chunk?: unknown) {
    if (chunk != null) this.write(chunk)
    this.headersSent = true
    this.emit('finish')
    this.resolveResponse(
      new Response(Buffer.concat(this.body), {
        headers: this.headers,
        status: this.statusCode
      })
    )
  }

  toResponse = async () => await this.responsePromise

  write(chunk: unknown) {
    if (typeof chunk === 'string') {
      this.body.push(Buffer.from(chunk))
    } else if (Buffer.isBuffer(chunk)) {
      this.body.push(chunk)
    } else if (chunk instanceof Uint8Array) {
      this.body.push(chunk)
    }
  }

  writeHead(statusCode: number, headers: Record<string, number | string | string[]> = {}) {
    this.statusCode = statusCode
    this.headersSent = true
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        for (const item of value) this.headers.append(key, item)
      } else {
        this.headers.set(key, String(value))
      }
    }
  }
}

export const createRelayFetchHandler = (
  args: RelayServerArgs,
  options: {
    storeRepository: RelayStoreRepository
    telemetry?: RelayTelemetry
  }
) => {
  const handler = createRelayHandler(args, options.telemetry, options.storeRepository)
  return async (request: Request) => {
    const body = new Uint8Array(await request.arrayBuffer())
    const req = new RelayFetchIncomingMessage(request, body) as unknown as IncomingMessage
    const response = new RelayFetchServerResponse()
    const res = response as unknown as ServerResponse
    void handler(req, res).catch(error => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : new Error(String(error)))
        return
      }
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      response.end(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`)
    })
    return await response.toResponse()
  }
}
