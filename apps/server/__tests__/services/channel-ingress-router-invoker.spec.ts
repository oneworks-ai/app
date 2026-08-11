import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRouterModelInvoker } from '#~/services/channel-ingress-router/invoker.js'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('@oneworks/task', () => ({ run }))

const input = { adapter: 'gemini', context: [], model: 'gemini-2.5', text: 'hello' }

describe('channel ingress router invoker', () => {
  afterEach(() => vi.clearAllMocks())

  it('fails closed for unsupported adapters and invalid or extra JSON fields', async () => {
    const invoker = createRouterModelInvoker({ cwd: '/tmp' })
    await expect(invoker.invoke({ ...input, adapter: 'codex' })).resolves.toMatchObject({
      code: 'unsupported',
      ok: false
    })
    run.mockImplementation(async (_options, query) => {
      query.onEvent({
        type: 'message',
        data: { content: '{"decision":"observe","reason":"x","confidence":1,"entity":"bad"}' }
      })
      query.onEvent({ type: 'exit', data: { exitCode: 0 } })
      return { session: { kill: vi.fn() } }
    })
    await expect(invoker.invoke(input)).resolves.toMatchObject({ code: 'invalid_output', ok: false })
  })

  it('accepts exactly the four valid decision states', async () => {
    for (const decision of ['ignore', 'observe', 'create_child', 'defer'] as const) {
      run.mockImplementationOnce(async (_options, query) => {
        query.onEvent({
          type: 'message',
          data: { content: JSON.stringify({ confidence: 0.75, decision, reason: 'valid route' }) }
        })
        query.onEvent({ type: 'exit', data: { exitCode: 0 } })
        return { session: { kill: vi.fn(), flushHooks: vi.fn().mockResolvedValue(undefined) } }
      })
      await expect(createRouterModelInvoker({ cwd: '/tmp' }).invoke(input)).resolves.toMatchObject({
        ok: true,
        output: { decision }
      })
    }
  })

  it('rejects oversized output and late-kills sessions after startup timeout', async () => {
    const lateKill = vi.fn()
    run.mockImplementation(async (_options, query) => {
      await new Promise(resolve => setTimeout(resolve, 20))
      query.onEvent({ type: 'exit', data: { exitCode: 0 } })
      return { session: { kill: lateKill, flushHooks: vi.fn().mockResolvedValue(undefined) } }
    })
    const invoker = createRouterModelInvoker({ cwd: '/tmp', timeoutMs: 1 })
    await expect(invoker.invoke(input)).resolves.toMatchObject({ code: 'timeout', ok: false })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(lateKill).toHaveBeenCalledOnce()

    run.mockImplementation(async (_options, query) => {
      query.onEvent({ type: 'message', data: { content: 'x'.repeat(9000) } })
      query.onEvent({ type: 'exit', data: { exitCode: 0 } })
      return { session: { kill: vi.fn() } }
    })
    await expect(createRouterModelInvoker({ cwd: '/tmp' }).invoke(input)).resolves.toMatchObject({
      code: 'invalid_output',
      ok: false
    })
  })

  it('kills and flushes an active session when completion times out', async () => {
    const kill = vi.fn()
    const flushHooks = vi.fn().mockResolvedValue(undefined)
    run.mockImplementation(async () => ({ session: { kill, flushHooks } }))

    await expect(createRouterModelInvoker({ cwd: '/tmp', timeoutMs: 1 }).invoke(input)).resolves.toMatchObject({
      code: 'timeout',
      ok: false
    })
    expect(kill).toHaveBeenCalledOnce()
    expect(flushHooks).toHaveBeenCalledOnce()
  })
})
