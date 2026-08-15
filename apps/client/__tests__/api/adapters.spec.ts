import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { streamAdapterAccountAction } from '#~/api/adapter-account-action-stream'

vi.mock('#~/homepage-preview/runtime-loader', () => ({
  handleHomepagePreviewFetchIfEnabled: () => undefined
}))

vi.mock('#~/runtime-config.js', () => ({
  createServerUrl: (path: string) => new URL(path.replace(/^\/+/, ''), 'http://api.example.com/').toString(),
  getServerBaseUrl: () => 'http://api.example.com'
}))

const encoder = new TextEncoder()

const createReader = (chunks: string[]) => {
  let index = 0
  const cancel = vi.fn(async () => undefined)
  return {
    reader: {
      read: vi.fn(async () =>
        index < chunks.length
          ? { done: false, value: encoder.encode(chunks[index++]) }
          : { done: true, value: undefined }
      ),
      cancel,
      releaseLock: vi.fn()
    },
    cancel
  }
}

const createResponse = (reader: ReturnType<typeof createReader>['reader']) =>
  ({
    ok: true,
    status: 200,
    body: { getReader: () => reader }
  }) as unknown as Response

describe('adapter account action stream api', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses progress and result events across arbitrary chunk boundaries', async () => {
    const payload = [
      'data: {"type":"progress","phase":"preparing"}\n\n',
      'data: {"type":"progress","phase":"awaiting-authorization"}\n\n',
      'data: {"type":"result","result":{"accountKey":"work"}}\n\n'
    ].join('')
    const chunks = Array.from({ length: payload.length }, (_, index) => payload.slice(index, index + 1))
    const { reader } = createReader(chunks)
    fetchMock.mockResolvedValue(createResponse(reader))
    const phases: string[] = []

    await expect(streamAdapterAccountAction({
      adapter: 'codex',
      options: { action: 'add' },
      onProgress: event => {
        if (event.phase != null) phases.push(event.phase)
      }
    })).resolves.toMatchObject({ accountKey: 'work' })
    expect(phases).toEqual(['preparing', 'awaiting-authorization'])
  })

  it.each([
    ['malformed event', 'data: {not-json}\n\n'],
    ['invalid event shape', 'data: {"type":"progress","phase":"unsafe"}\n\n'],
    ['server error event', 'data: {"type":"error","error":{"code":"login_failed","message":"nope","status":400}}\n\n']
  ])('cancels the reader on %s', async (_label, frame) => {
    const { reader, cancel } = createReader([frame])
    fetchMock.mockResolvedValue(createResponse(reader))

    await expect(streamAdapterAccountAction({
      adapter: 'codex',
      options: { action: 'add' },
      onProgress: vi.fn()
    })).rejects.toBeInstanceOf(Error)
    expect(cancel).toHaveBeenCalledOnce()
    expect(reader.releaseLock).toHaveBeenCalledOnce()
  })

  it('bounds an oversized buffered event and cancels the reader', async () => {
    const { reader, cancel } = createReader([`data: ${'x'.repeat(64 * 1024)}\n`])
    fetchMock.mockResolvedValue(createResponse(reader))

    await expect(streamAdapterAccountAction({
      adapter: 'codex',
      options: { action: 'add' },
      onProgress: vi.fn()
    })).rejects.toThrow('oversized')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('cancels the reader when the request is aborted during parsing', async () => {
    const abortController = new AbortController()
    const cancel = vi.fn(async () => undefined)
    const read = vi.fn(() =>
      new Promise<never>((_resolve, reject) => {
        abortController.signal.addEventListener('abort', () => reject(abortController.signal.reason), { once: true })
      })
    )
    const reader = { read, cancel, releaseLock: vi.fn() }
    fetchMock.mockResolvedValue(createResponse(reader))

    const request = streamAdapterAccountAction({
      adapter: 'codex',
      options: { action: 'add' },
      onProgress: vi.fn(),
      signal: abortController.signal
    })
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    abortController.abort(new Error('aborted'))

    await expect(request).rejects.toThrow('aborted')
    expect(cancel).toHaveBeenCalledOnce()
    expect(reader.releaseLock).toHaveBeenCalledOnce()
  })
})
