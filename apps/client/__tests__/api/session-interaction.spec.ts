import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { respondSessionInteraction } from '#~/api/sessions'

vi.mock('#~/runtime-config.js', () => ({
  createServerUrl: (path: string) => new URL(path.replace(/^\/+/, ''), 'http://api.example.com:8787/').toString(),
  getServerBaseUrl: () => 'http://api.example.com:8787'
}))

describe('session interaction api', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('preserves ordered multi-select arrays through the HTTP boundary', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      })
    )

    await expect(respondSessionInteraction('sess-1', 'ask-1', ['runtime', 'history'])).resolves.toEqual({ ok: true })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      type: 'interaction_response',
      id: 'ask-1',
      data: ['runtime', 'history']
    })
  })

  it('rejects when the interaction request times out', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    )

    const response = respondSessionInteraction('sess-1', 'ask-1', [], { timeoutMs: 20 })
    const rejection = expect(response).rejects.toMatchObject({
      name: 'ApiError',
      code: 'request_timeout'
    })
    await vi.advanceTimersByTimeAsync(20)
    await rejection
  })
})
