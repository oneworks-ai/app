import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => ({
  notification: undefined as undefined | ((method: string, params: Record<string, unknown>) => void),
  request: undefined as undefined | ((id: number, method: string, params: Record<string, unknown>) => void)
}))
const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  drain: vi.fn(async () => undefined),
  prepareHome: vi.fn(async () => ({
    homeDir: '/tmp/ow-shared-model',
    accountKey: 'work',
    reconcileCredentialOwner: undefined as (() => Promise<void>) | undefined
  })),
  release: vi.fn(),
  resolvePool: vi.fn(async () => ({ enabled: false, candidates: [], cooldownMs: 0 })),
  respond: vi.fn(),
  request: vi.fn(),
  unregisterThread: vi.fn(async () => undefined)
}))
const state = vi.hoisted(() => ({ toolCall: false }))
const requestedDynamicToolName = () => {
  const call = mocks.request.mock.calls.find(([method]) => method === 'thread/start')
  const params = call?.[1] as { dynamicTools?: Array<{ name?: string }> } | undefined
  return params?.dynamicTools?.[0]?.name
}

vi.mock('#~/paths.js', () => ({ resolveCodexBinaryPath: () => '/managed/codex' }))
vi.mock('#~/runtime/accounts.js', () => ({
  classifyCodexAccountPoolFailure: vi.fn(),
  markCodexAccountPoolFailure: vi.fn(),
  prepareCodexSessionHome: mocks.prepareHome,
  resolveCodexAccountPoolCandidates: mocks.resolvePool
}))
vi.mock('#~/runtime/app-server-pool.js', () => ({ acquireCodexAppServer: mocks.acquire }))
vi.mock('#~/runtime/config.js', () => ({
  resolveCodexAdapterConfig: () => ({ native: { shareBuiltinModels: true } })
}))
vi.mock('#~/runtime/network.js', () => ({
  applyCodexNetworkEnv: (env: unknown) => env,
  materializeCodexCaCertificate: async (value: unknown) => value,
  resolveCodexNetworkConfig: () => ({})
}))
vi.mock('#~/runtime/session-common.js', () => ({ buildFeatureArgs: () => [] }))
vi.mock('#~/runtime/stream.js', () => ({ resolveCodexAppServerClientInfo: () => ({ name: 'oneworks' }) }))

const ctx = {
  cache: { get: vi.fn(), set: vi.fn() },
  configs: [],
  ctxId: 'test',
  cwd: '/workspace',
  env: {},
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
} as any

describe('codex shared model executor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handlers.notification = undefined
    handlers.request = undefined
    state.toolCall = false
    mocks.request.mockImplementation(async (method: string) => {
      if (method === 'thread/start') return { thread: { id: 'thread-1' } }
      if (method === 'thread/inject_items') return {}
      if (method === 'turn/start') {
        queueMicrotask(() => {
          if (state.toolCall) {
            handlers.request?.(7, 'item/tool/call', {
              threadId: 'thread-1',
              turnId: 'turn-1',
              callId: 'call_weather',
              tool: requestedDynamicToolName(),
              arguments: { city: 'Shanghai' }
            })
            queueMicrotask(() =>
              handlers.notification?.('turn/completed', {
                turn: { status: 'interrupted' }
              })
            )
            return
          }
          handlers.notification?.('rawResponseItem/completed', {
            item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] }
          })
          handlers.notification?.('rawResponse/completed', {
            usage: { inputTokens: 2, cachedInputTokens: 1, outputTokens: 3, reasoningOutputTokens: 1 }
          })
          handlers.notification?.('turn/completed', { turn: { status: 'completed' } })
        })
        return { turn: { id: 'turn-1' } }
      }
      return {}
    })
    mocks.acquire.mockResolvedValue({
      rpc: { request: mocks.request, respond: mocks.respond },
      registerThread: vi.fn(async (_id, _cwd, next) => {
        handlers.notification = next.onNotification
        handlers.request = next.onRequest
      }),
      unregisterThread: mocks.unregisterThread,
      onExit: vi.fn(),
      runThreadSetup: vi.fn(async (task: () => Promise<unknown>) => await task()),
      drain: mocks.drain,
      release: mocks.release
    })
  })

  it('runs full Responses history through the official app-server and preserves usage', async () => {
    const { executeCodexSharedModel } = await import('#~/shared-model.js')
    const result = await executeCodexSharedModel(ctx, {
      sessionId: 'shared-1',
      request: {
        model: 'gpt-example',
        max_output_tokens: 123,
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }]
      }
    })

    expect(mocks.request).toHaveBeenCalledWith(
      'thread/inject_items',
      expect.objectContaining({
        threadId: 'thread-1'
      })
    )
    expect(result.response).toMatchObject({
      status: 'completed',
      model: 'gpt-example',
      output: [{ type: 'message', role: 'assistant' }],
      usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 }
    })
    expect(result.accountKey).toBe('work')
    expect(mocks.request).toHaveBeenCalledWith(
      'turn/start',
      expect.objectContaining({ maxOutputTokens: 123 })
    )
  })

  it('releases the shared-model lease after lifecycle reconciliation rejects', async () => {
    const reconcileCredentialOwner = vi.fn(async () => {
      throw new Error('synthetic reconciliation failure')
    })
    mocks.prepareHome.mockResolvedValueOnce({
      homeDir: '/tmp/ow-shared-model',
      accountKey: 'work',
      reconcileCredentialOwner
    })
    const { executeCodexSharedModel } = await import('#~/shared-model.js')

    await expect(executeCodexSharedModel(ctx, {
      sessionId: 'shared-reconciliation-failure',
      request: {
        model: 'gpt-example',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }]
      }
    })).resolves.toMatchObject({ accountKey: 'work' })

    expect(mocks.drain).toHaveBeenCalledOnce()
    expect(reconcileCredentialOwner).toHaveBeenCalledOnce()
    expect(mocks.release).toHaveBeenCalledOnce()
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      '[codex shared model] credential owner reconciliation failed during teardown',
      expect.objectContaining({ error: 'synthetic reconciliation failure' })
    )
  })

  it('reconciles exactly once and preserves an app-server acquisition error', async () => {
    const reconcileCredentialOwner = vi.fn(async () => {
      throw new Error('synthetic reconciliation failure')
    })
    mocks.prepareHome.mockResolvedValueOnce({
      homeDir: '/tmp/ow-shared-model',
      accountKey: 'work',
      reconcileCredentialOwner
    })
    mocks.acquire.mockRejectedValueOnce(new Error('synthetic acquisition failure'))
    const { executeCodexSharedModel } = await import('#~/shared-model.js')

    await expect(executeCodexSharedModel(ctx, {
      sessionId: 'shared-acquisition-failure',
      request: {
        model: 'gpt-example',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }]
      }
    })).rejects.toThrow('synthetic acquisition failure')

    expect(reconcileCredentialOwner).toHaveBeenCalledOnce()
    expect(mocks.drain).not.toHaveBeenCalled()
    expect(mocks.release).not.toHaveBeenCalled()
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      '[codex shared model] credential owner reconciliation failed after app-server acquisition',
      expect.objectContaining({ error: 'synthetic reconciliation failure' })
    )
  })

  it('returns caller-owned dynamic tool calls instead of executing native tools', async () => {
    state.toolCall = true
    const { executeCodexSharedModel } = await import('#~/shared-model.js')
    const result = await executeCodexSharedModel(ctx, {
      sessionId: 'shared-tools',
      request: {
        model: 'gpt-example',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'weather' }] }],
        tools: [{ type: 'function', name: 'weather', parameters: { type: 'object' } }]
      }
    })

    expect(mocks.request).toHaveBeenCalledWith(
      'thread/start',
      expect.objectContaining({
        dynamicTools: [expect.objectContaining({ name: expect.stringMatching(/^owt_[a-f0-9]{16}_weather$/) })],
        experimentalRawEvents: true
      })
    )
    expect(mocks.request).toHaveBeenCalledWith(
      'turn/interrupt',
      expect.objectContaining({
        threadId: 'thread-1',
        turnId: 'turn-1'
      })
    )
    expect(result.response.output).toMatchObject([{
      type: 'function_call',
      call_id: 'call_weather',
      name: 'weather',
      arguments: '{"city":"Shanghai"}'
    }])
    expect(mocks.respond).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ success: false })
    )
  })

  it('aliases reserved tool names in history and restores them in output', async () => {
    state.toolCall = true
    const { executeCodexSharedModel } = await import('#~/shared-model.js')
    const originalName = 'mcp__browser_browser-driver__execute_in_app_browser_workflow'
    const result = await executeCodexSharedModel(ctx, {
      sessionId: 'shared-reserved-tools',
      request: {
        model: 'gpt-example',
        input: [{
          type: 'function_call',
          call_id: 'previous_call',
          name: originalName,
          arguments: '{}'
        }],
        tools: [{ type: 'function', name: originalName, parameters: { type: 'object' } }]
      }
    })

    const dynamicName = requestedDynamicToolName()
    expect(dynamicName).toMatch(/^owt_[a-f0-9]{16}_/)
    expect(dynamicName).not.toContain('mcp__')
    expect(mocks.request).toHaveBeenCalledWith('thread/inject_items', {
      threadId: 'thread-1',
      items: [expect.objectContaining({ name: dynamicName })]
    })
    expect(result.response.output).toMatchObject([{ name: originalName }])
  })

  it('fails closed when serial tool calls are required', async () => {
    const { executeCodexSharedModel } = await import('#~/shared-model.js')
    await expect(executeCodexSharedModel(ctx, {
      sessionId: 'shared-serial-tools',
      request: {
        model: 'gpt-example',
        input: [],
        parallel_tool_calls: false
      }
    })).rejects.toThrow('cannot guarantee serial tool calls')
  })
})
