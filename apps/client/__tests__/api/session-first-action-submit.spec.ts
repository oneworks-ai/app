import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueuedMessage, deleteQueuedMessage, sendSessionMessage } from '#~/api/sessions'

const ACTION_ID = 'client-action-00000000-0000-4000-8000-000000000001'

const mocks = vi.hoisted(() => ({
  terminated: vi.fn(),
  submit: vi.fn(async <T>(
    _sessionId: string,
    transport: (clientActionId?: string) => Promise<T>
  ) => await transport(ACTION_ID))
}))

vi.mock('#~/diagnostics/desktop-first-action/submit', () => ({
  submitWithDesktopFirstAction: mocks.submit
}))

vi.mock('#~/diagnostics/desktop-first-action/runtime', () => ({
  markDesktopFirstActionTerminated: mocks.terminated
}))

vi.mock('#~/homepage-preview/runtime-loader', () => ({
  handleHomepagePreviewFetchIfEnabled: () => undefined
}))

vi.mock('#~/runtime-config.js', () => ({
  createServerUrl: (path: string) => new URL(path.replace(/^\/+/, ''), 'http://api.example.com:8787/').toString(),
  getServerBaseUrl: () => 'http://api.example.com:8787'
}))

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200
  })

describe('session first-action submit transport', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('coordinates direct session sends used by the sender and annotation UI', async () => {
    fetchMock.mockResolvedValueOnce(ok({ ok: true }))

    await sendSessionMessage('session-1', 'hello', { permissionMode: 'default' })

    expect(mocks.submit).toHaveBeenCalledWith('session-1', expect.any(Function), undefined)
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(JSON.parse(String(init?.body))).toEqual({
      clientActionId: ACTION_ID,
      permissionMode: 'default',
      text: 'hello'
    })
  })

  it('coordinates a queued sender submit and persists its anonymous action ID', async () => {
    fetchMock.mockResolvedValueOnce(ok({ queuedMessages: { next: [], steer: [] } }))

    await createQueuedMessage('session-1', 'next', [{ type: 'text', text: 'later' }])

    expect(mocks.submit).toHaveBeenCalledWith('session-1', expect.any(Function), undefined)
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(JSON.parse(String(init?.body))).toEqual({
      clientActionId: ACTION_ID,
      content: [{ type: 'text', text: 'later' }],
      mode: 'next'
    })
  })

  it('settles a queued first action when the user deletes it', async () => {
    fetchMock.mockResolvedValueOnce(ok({ queuedMessages: { next: [], steer: [] } }))

    await deleteQueuedMessage('session-1', ACTION_ID)

    expect(mocks.terminated).toHaveBeenCalledWith('session-1', ACTION_ID)
  })
})
