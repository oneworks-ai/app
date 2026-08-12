import { describe, expect, it, vi } from 'vitest'

const executeSharedModel = vi.fn(async () => ({
  response: {
    id: 'resp_1',
    status: 'completed',
    model: 'gpt-example',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
  }
}))

vi.mock('#~/services/adapter-accounts.js', () => ({
  createServerAdapterAccountContext: vi.fn(async () => ({
    adapter: { executeSharedModel },
    adapterCtx: { configState: { mergedConfig: { adapters: { codex: { shareBuiltinModels: true } } } } }
  }))
}))

const createCtx = (token: string, body: Record<string, unknown>) => ({
  get: vi.fn((name: string) => name === 'Authorization' ? `Bearer ${token}` : ''),
  request: { body },
  req: { once: vi.fn() },
  res: { once: vi.fn(), writableEnded: false },
  set: vi.fn(),
  state: {},
  status: 0,
  body: undefined,
  type: undefined
})

describe('codex shared model route', () => {
  it('requires the runtime-only token and returns raw Chat JSON', async () => {
    const { codexSharedModelRouter } = await import('#~/routes/codex-shared-model.js')
    const router = codexSharedModelRouter({
      __ONEWORKS_PROJECT_CODEX_SHARED_MODEL_TOKEN__: 'secret'
    } as any)
    const layer = router.stack.find(item => item.path === '/v1/chat/completions')!

    const rejected = createCtx('wrong', { model: 'gpt-example', messages: [] })
    await layer.stack[0]!(rejected as any, vi.fn())
    expect(rejected.status).toBe(401)
    expect(executeSharedModel).not.toHaveBeenCalled()

    const accepted = createCtx('secret', {
      model: 'gpt-example',
      messages: [{ role: 'user', content: 'hello' }]
    })
    await layer.stack[0]!(accepted as any, vi.fn())
    expect(accepted.status).toBe(200)
    expect(accepted.body).toMatchObject({
      object: 'chat.completion',
      choices: [{ message: { content: 'hello' } }]
    })
    expect(accepted.state).toEqual({ skipApiEnvelope: true })
  })

  it('returns an SSE-shaped Chat stream without API envelope', async () => {
    const { codexSharedModelRouter } = await import('#~/routes/codex-shared-model.js')
    const router = codexSharedModelRouter({
      __ONEWORKS_PROJECT_CODEX_SHARED_MODEL_TOKEN__: 'secret'
    } as any)
    const layer = router.stack.find(item => item.path === '/v1/chat/completions')!
    const ctx = createCtx('secret', {
      model: 'gpt-example',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true
    })

    await layer.stack[0]!(ctx as any, vi.fn())

    expect(ctx.type).toBe('text/event-stream')
    expect(ctx.body).toContain('chat.completion.chunk')
    expect(ctx.body).toContain('data: [DONE]')
  })
})
