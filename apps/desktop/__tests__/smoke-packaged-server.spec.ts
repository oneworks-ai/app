import { EventEmitter } from 'node:events'
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const requireModule = createRequire(import.meta.url)
const {
  readServerText,
  serverRequestTimeoutMs,
  resolvePositiveTimeoutMs
} = requireModule('../scripts/smoke-packaged-server.cjs') as {
  readServerText: (
    port: number,
    requestPath: string,
    label: string,
    options?: {
      httpGet?: typeof import('node:http').get
      timeoutMs?: number
    }
  ) => Promise<string>
  serverRequestTimeoutMs: number
  resolvePositiveTimeoutMs: (
    env: NodeJS.ProcessEnv,
    name: string,
    fallbackMs: number
  ) => number
}

describe('packaged server smoke timeouts', () => {
  it('uses the request timeout fallback for cold plugin compilation', () => {
    expect(
      resolvePositiveTimeoutMs(
        {},
        'ONEWORKS_DESKTOP_SMOKE_REQUEST_TIMEOUT_MS',
        30000
      )
    ).toBe(30000)
  })

  it('accepts an explicit positive request timeout', () => {
    expect(
      resolvePositiveTimeoutMs(
        { ONEWORKS_DESKTOP_SMOKE_REQUEST_TIMEOUT_MS: '45000' },
        'ONEWORKS_DESKTOP_SMOKE_REQUEST_TIMEOUT_MS',
        30000
      )
    ).toBe(45000)
  })

  it.each(['0', '-1', '1.5', '30e3', '30000ms', 'invalid'])(
    'rejects invalid request timeout %s',
    value => {
      expect(() =>
        resolvePositiveTimeoutMs(
          { ONEWORKS_DESKTOP_SMOKE_REQUEST_TIMEOUT_MS: value },
          'ONEWORKS_DESKTOP_SMOKE_REQUEST_TIMEOUT_MS',
          30000
        )
      ).toThrow(
        'ONEWORKS_DESKTOP_SMOKE_REQUEST_TIMEOUT_MS must be a positive integer'
      )
    }
  )

  it('wires the 30 second default into packaged server HTTP reads', async () => {
    let capturedOptions: RequestOptions | undefined
    const httpGet = ((
      options: RequestOptions,
      onResponse: (response: IncomingMessage) => void
    ) => {
      capturedOptions = options
      const request = new EventEmitter()
      const response = new EventEmitter()
      Object.assign(request, {
        destroy: (error?: Error) => {
          if (error != null) request.emit('error', error)
          return request
        }
      })
      Object.assign(response, {
        setEncoding: () => response,
        statusCode: 200
      })

      queueMicrotask(() => {
        onResponse(response as unknown as IncomingMessage)
        response.emit('data', 'compiled-source')
        response.emit('end')
      })

      return request as unknown as ClientRequest
    }) as typeof import('node:http').get

    await expect(
      readServerText(
        43110,
        '/api/plugins/china-red-theme/client-source/index.ts',
        'cold plugin source',
        { httpGet }
      )
    ).resolves.toBe('compiled-source')
    expect(serverRequestTimeoutMs).toBe(30000)
    expect(capturedOptions?.timeout).toBe(serverRequestTimeoutMs)
  })
})
