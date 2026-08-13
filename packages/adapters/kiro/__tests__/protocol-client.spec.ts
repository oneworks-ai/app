import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { KiroAcpClient } from '../src/protocol/client'
import type { AcpMessage, KiroAcpProcess } from '../src/protocol/types'

const createFakeProcess = () => {
  const proc = new EventEmitter() as KiroAcpProcess
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  Object.assign(proc, {
    stdin,
    stdout,
    stderr,
    kill: vi.fn(() => true)
  })
  const requests: AcpMessage[] = []
  stdin.setEncoding('utf8')
  stdin.on('data', (chunk: string) => {
    for (const record of chunk.trim().split('\n')) {
      if (record !== '') requests.push(JSON.parse(record) as AcpMessage)
    }
  })
  return { proc, requests, stdout }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('kiro ACP request timeouts', () => {
  it('keeps a successful prompt pending beyond 30 seconds without an adapter timeout', async () => {
    vi.useFakeTimers()
    const fake = createFakeProcess()
    const client = new KiroAcpClient(fake.proc, 30_000)
    let settlements = 0
    const response = client.request<{ stopReason: string }>(
      'session/prompt',
      { sessionId: 'native-1', content: [] }
    ).finally(() => {
      settlements += 1
    })

    await vi.advanceTimersByTimeAsync(31_000)
    expect(settlements).toBe(0)
    const prompt = fake.requests.find(request => request.method === 'session/prompt')
    fake.stdout.write(`${
      JSON.stringify({
        jsonrpc: '2.0',
        id: prompt?.id,
        result: { stopReason: 'end_turn' }
      })
    }\n`)

    await expect(response).resolves.toEqual({ stopReason: 'end_turn' })
    expect(settlements).toBe(1)
  })

  it('retains bounded timeouts for startup and control requests', async () => {
    vi.useFakeTimers()
    const fake = createFakeProcess()
    const client = new KiroAcpClient(fake.proc, 30_000)
    const response = client.request('initialize', {})
    const assertion = expect(response).rejects.toThrow('timed out after 30000ms')

    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
  })

  it('settles an in-flight prompt once when cancellation returns a response', async () => {
    vi.useFakeTimers()
    const fake = createFakeProcess()
    const client = new KiroAcpClient(fake.proc, 30_000)
    let settlements = 0
    const response = client.request(
      'session/prompt',
      { sessionId: 'native-1', content: [] },
      { timeoutMs: null }
    ).finally(() => {
      settlements += 1
    })
    await client.notify('session/cancel', { sessionId: 'native-1' })
    const prompt = fake.requests.find(request => request.method === 'session/prompt')
    const wireResponse = `${JSON.stringify({ jsonrpc: '2.0', id: prompt?.id, result: { stopReason: 'cancelled' } })}\n`
    fake.stdout.write(wireResponse)
    fake.stdout.write(wireResponse)

    await expect(response).resolves.toEqual({ stopReason: 'cancelled' })
    expect(settlements).toBe(1)
  })

  it('rejects an unbounded prompt once when the child exits', async () => {
    vi.useFakeTimers()
    const fake = createFakeProcess()
    const client = new KiroAcpClient(fake.proc, 30_000)
    let settlements = 0
    const response = client.request(
      'session/prompt',
      { sessionId: 'native-1', content: [] },
      { timeoutMs: null }
    ).finally(() => {
      settlements += 1
    })
    const assertion = expect(response).rejects.toThrow('exited before responding')

    fake.proc.emit('exit', 9, null)
    fake.proc.emit('exit', 9, null)

    await assertion
    expect(settlements).toBe(1)
  })
})
