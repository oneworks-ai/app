import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { DroidJsonRpcClient } from '../src/runtime/protocol/client'
import { JsonlDecoder } from '../src/runtime/protocol/jsonl'
import { FACTORY_API_VERSION, FACTORY_PROTOCOL_VERSION } from '../src/runtime/protocol/types'
import { DroidDiagnosticRedactor } from '../src/runtime/redaction'

class FakeProcess extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  kill = vi.fn(() => true)
}

const wireResponse = (params: {
  id: string
  result: unknown
  protocolVersion?: string
}) => ({
  jsonrpc: '2.0',
  type: 'response',
  factoryApiVersion: FACTORY_API_VERSION,
  ...(params.protocolVersion == null ? {} : { factoryProtocolVersion: params.protocolVersion }),
  id: params.id,
  result: params.result
})

const nextRequest = async (process: FakeProcess) => {
  const chunks: Buffer[] = []
  return await new Promise<Record<string, unknown>>((resolve) => {
    process.stdin.once('data', (chunk: Buffer) => {
      chunks.push(chunk)
      resolve(JSON.parse(Buffer.concat(chunks).toString('utf8').trim()))
    })
  })
}

describe('droid JSON-RPC client', () => {
  it('bounds complete and split JSONL frames at the configured byte limit', () => {
    const exact = new JsonlDecoder(8)
    expect(exact.push('1234')).toEqual([])
    expect(exact.push('5678\n')).toEqual(['12345678'])

    const oversized = new JsonlDecoder(8)
    expect(oversized.push('1234')).toEqual([])
    expect(() => oversized.push('56789')).toThrow('exceeded 8 bytes')
    expect(oversized.finish()).toEqual([])

    const exactAtEof = new JsonlDecoder(8)
    expect(exactAtEof.push('12345678')).toEqual([])
    expect(exactAtEof.finish()).toEqual(['12345678'])
  })

  it('fails one oversized unterminated frame once, clears pending RPC, and ignores later recovery bytes', async () => {
    const process = new FakeProcess()
    const client = new DroidJsonRpcClient(process as never, {
      maxJsonlFrameBytes: 64,
      requestTimeoutMs: 500
    })
    const errors: Error[] = []
    const exits: Array<number | null> = []
    client.onError(error => errors.push(error))
    client.onExit(code => exits.push(code))
    const pending = client.request('oversized', {})
    const request = await nextRequest(process)
    process.stdout.write('x'.repeat(32))
    process.stdout.write('x'.repeat(33))
    process.stdout.write(`${
      JSON.stringify(wireResponse({
        id: String(request.id),
        result: { ignored: true },
        protocolVersion: FACTORY_PROTOCOL_VERSION
      }))
    }\n`)
    process.emit('exit', 1, null)
    process.emit('close', 1, null)
    process.emit('close', 1, null)

    await expect(pending).rejects.toThrow('exceeded 64 bytes')
    expect(errors).toHaveLength(1)
    expect(exits).toEqual([1])
    expect(client.pendingRequestCount).toBe(0)
  })

  it('uses unique request ids and clears pending promises on responses', async () => {
    const process = new FakeProcess()
    const client = new DroidJsonRpcClient(process as never, 500)
    const first = client.request('first', {})
    const firstRequest = await nextRequest(process)
    process.stdout.write(`${
      JSON.stringify(wireResponse({
        id: String(firstRequest.id),
        result: { ok: 1 },
        protocolVersion: FACTORY_PROTOCOL_VERSION
      }))
    }\n`)
    await expect(first).resolves.toEqual({ ok: 1 })

    const second = client.request('second', {})
    const secondRequest = await nextRequest(process)
    expect(secondRequest.id).not.toBe(firstRequest.id)
    process.stdout.write(`${
      JSON.stringify(wireResponse({
        id: String(secondRequest.id),
        result: { ok: 2 },
        protocolVersion: FACTORY_PROTOCOL_VERSION
      }))
    }\n`)
    await expect(second).resolves.toEqual({ ok: 2 })
    expect(client.pendingRequestCount).toBe(0)
    process.emit('exit', 0, null)
  })

  it.each([
    [undefined, 'missing'],
    ['0.0.0', '0.0.0']
  ])('terminates explicitly when peer protocol is %s', async (peerVersion, label) => {
    const process = new FakeProcess()
    const client = new DroidJsonRpcClient(process as never, 500)
    const errors: Error[] = []
    client.onError(error => errors.push(error))
    const pending = client.request('droid.initialize_session', {})
    const request = await nextRequest(process)
    process.stdout.write(`${
      JSON.stringify(wireResponse({
        id: String(request.id),
        result: {},
        protocolVersion: peerVersion
      }))
    }\n`)
    await expect(pending).rejects.toThrow(`received ${label}`)
    expect(errors).toHaveLength(1)
    expect(client.pendingRequestCount).toBe(0)
    process.emit('exit', 1, null)
    process.emit('close', 1, null)
  })

  it('rejects a malformed initialize response in the production response validator', async () => {
    const process = new FakeProcess()
    const client = new DroidJsonRpcClient(process as never, 500)
    const errors: Error[] = []
    client.onError(error => errors.push(error))
    const pending = client.request('droid.initialize_session', {})
    const request = await nextRequest(process)
    process.stdout.write(`${
      JSON.stringify(wireResponse({
        id: String(request.id),
        result: { sessionId: 'native-without-snapshot' },
        protocolVersion: FACTORY_PROTOCOL_VERSION
      }))
    }\n`)
    await expect(pending).rejects.toThrow('malformed session snapshot')
    expect(errors).toHaveLength(1)
    expect(client.pendingRequestCount).toBe(0)
    process.emit('exit', 1, null)
  })

  it('rejects a load snapshot without an authoritative native session id', async () => {
    const process = new FakeProcess()
    const client = new DroidJsonRpcClient(process as never, 500)
    const pending = client.request('droid.load_session', { sessionId: 'expected-native' })
    const request = await nextRequest(process)
    process.stdout.write(`${
      JSON.stringify(wireResponse({
        id: String(request.id),
        result: { session: { messages: [] }, settings: {} },
        protocolVersion: FACTORY_PROTOCOL_VERSION
      }))
    }\n`)
    await expect(pending).rejects.toThrow('returned no native session id')
    expect(client.pendingRequestCount).toBe(0)
    process.emit('exit', 1, null)
  })

  it('settles spawn error, nonzero exit, and duplicate close only once', async () => {
    const process = new FakeProcess()
    const client = new DroidJsonRpcClient(process as never, 500)
    const errors: Error[] = []
    const exits: Array<number | null> = []
    client.onError(error => errors.push(error))
    client.onExit(code => exits.push(code))
    const pending = client.request('pending', {})
    await nextRequest(process)
    process.emit('error', new Error('spawn failed'))
    process.emit('exit', 7, null)
    process.emit('close', 7, null)
    await expect(pending).rejects.toThrow('spawn failed')
    expect(errors.map(error => error.message)).toEqual(['spawn failed'])
    expect(exits).toEqual([7])
    expect(client.pendingRequestCount).toBe(0)
  })

  it('drains a complete final response delivered after exit and before close', async () => {
    const process = new FakeProcess()
    const client = new DroidJsonRpcClient(process as never, {
      postExitDrainTimeoutMs: 100,
      requestTimeoutMs: 500
    })
    const exits: Array<number | null> = []
    const notifications: string[] = []
    client.onExit(code => exits.push(code))
    client.onNotification(notification => notifications.push(notification.method))
    const pending = client.request('response-after-exit', {})
    const request = await nextRequest(process)
    process.emit('exit', 0, null)
    process.stdout.write(`${
      JSON.stringify(wireResponse({
        id: String(request.id),
        result: { ok: true },
        protocolVersion: FACTORY_PROTOCOL_VERSION
      }))
    }\n`)
    process.stdout.write(`${
      JSON.stringify({
        jsonrpc: '2.0',
        type: 'notification',
        factoryApiVersion: FACTORY_API_VERSION,
        factoryProtocolVersion: FACTORY_PROTOCOL_VERSION,
        method: 'droid.session_notification',
        params: { notification: { type: 'agent_turn_completed', reason: 'completed' } }
      })
    }\n`)
    await expect(pending).resolves.toEqual({ ok: true })
    expect(notifications).toEqual(['droid.session_notification'])
    expect(exits).toEqual([])
    process.emit('close', 0, null)
    expect(exits).toEqual([0])
    expect(client.pendingRequestCount).toBe(0)
  })

  it('drains final JSONL split across the exit boundary before close', async () => {
    const process = new FakeProcess()
    const client = new DroidJsonRpcClient(process as never, {
      postExitDrainTimeoutMs: 100,
      requestTimeoutMs: 500
    })
    const pending = client.request('split-response', {})
    const request = await nextRequest(process)
    const frame = `${
      JSON.stringify(wireResponse({
        id: String(request.id),
        result: { split: true },
        protocolVersion: FACTORY_PROTOCOL_VERSION
      }))
    }\n`
    const boundary = Math.floor(frame.length / 2)
    process.stdout.write(frame.slice(0, boundary))
    process.emit('exit', 0, null)
    process.stdout.write(frame.slice(boundary))
    process.emit('close', 0, null)
    await expect(pending).resolves.toEqual({ split: true })
    expect(client.pendingRequestCount).toBe(0)
  })

  it('fails a truncated final frame at close and settles pending once', async () => {
    const process = new FakeProcess()
    const client = new DroidJsonRpcClient(process as never, {
      postExitDrainTimeoutMs: 100,
      requestTimeoutMs: 500
    })
    const errors: Error[] = []
    const exits: Array<number | null> = []
    client.onError(error => errors.push(error))
    client.onExit(code => exits.push(code))
    const pending = client.request('truncated-at-close', {})
    await nextRequest(process)
    process.stdout.write('{"jsonrpc":"2.0","context":"TRUNCATED_CONTEXT"')
    process.emit('exit', 3, null)
    process.emit('close', 3, null)
    await expect(pending).rejects.toThrow('TRUNCATED_CONTEXT')
    expect(errors).toHaveLength(1)
    expect(exits).toEqual([3])
    expect(client.pendingRequestCount).toBe(0)
  })

  it('uses a bounded post-exit fallback when close never arrives', async () => {
    const process = new FakeProcess()
    const client = new DroidJsonRpcClient(process as never, {
      postExitDrainTimeoutMs: 20,
      requestTimeoutMs: 500
    })
    const exits: Array<number | null> = []
    client.onExit(code => exits.push(code))
    const pending = client.request('no-close', {})
    await nextRequest(process)
    process.emit('exit', 9, null)
    await expect(pending).rejects.toThrow('code 9')
    expect(exits).toEqual([9])
    expect(client.pendingRequestCount).toBe(0)
  })

  it('redacts peer error data, malformed frames, and stderr at every client boundary', async () => {
    const apiKey = 'factory-exact-api-secret-123456'
    const token = 'factory-exact-token-secret-654321'
    const shaped = 'factory_live_credentialshaped123456789'
    const redactor = new DroidDiagnosticRedactor([apiKey, token])
    const process = new FakeProcess()
    const client = new DroidJsonRpcClient(process as never, {
      postExitDrainTimeoutMs: 100,
      redact: redactor.redact,
      requestTimeoutMs: 500
    })
    const pending = client.request('peer-error', {})
    const request = await nextRequest(process)
    process.stderr.write(`useful stderr ${token} Bearer ${shaped}`)
    process.stdout.write(`${
      JSON.stringify({
        ...wireResponse({
          id: String(request.id),
          result: undefined,
          protocolVersion: FACTORY_PROTOCOL_VERSION
        }),
        error: {
          code: -32_001,
          message: `useful peer context ${apiKey}`,
          data: { token: shaped }
        }
      })
    }\n`)
    await expect(pending).rejects.toThrow('useful peer context [REDACTED]')
    await expect(pending).rejects.not.toThrow(apiKey)
    await expect(pending).rejects.not.toThrow(shaped)
    expect(client.capturedStderr).toContain('useful stderr')
    expect(client.capturedStderr).not.toContain(token)
    expect(client.capturedStderr).not.toContain(shaped)
    process.emit('exit', 1, null)
    process.emit('close', 1, null)

    const malformedProcess = new FakeProcess()
    const malformedClient = new DroidJsonRpcClient(malformedProcess as never, {
      redact: redactor.redact,
      requestTimeoutMs: 500
    })
    const errors: Error[] = []
    malformedClient.onError(error => errors.push(error))
    const malformedPending = malformedClient.request('malformed-secret', {})
    await nextRequest(malformedProcess)
    malformedProcess.stdout.write(`{"context":"useful malformed ${apiKey}","token":"${shaped}"`)
    malformedProcess.emit('exit', 2, null)
    malformedProcess.emit('close', 2, null)
    await expect(malformedPending).rejects.toThrow('useful malformed [REDACTED]')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).not.toContain(apiKey)
    expect(errors[0]!.message).not.toContain(shaped)
  })
})
