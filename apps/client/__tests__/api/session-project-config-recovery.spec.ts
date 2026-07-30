import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  openSessionProjectConfig,
  retrySessionProjectConfig
} from '#~/api/sessions'

vi.mock('#~/runtime-config.js', () => ({
  createServerUrl: (path: string) => {
    const relativePath = path.replace(/^\/+/, '')
    return new URL(relativePath, 'http://api.example.com:8787/').toString()
  },
  getServerBaseUrl: () => 'http://api.example.com:8787'
}))

const makeJsonResponse = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' }
})

describe('session project config recovery API', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends only the session identity for open and retry requests', async () => {
    const openResponse = {
      ok: true,
      opener: {
        available: true,
        id: 'vscode',
        source: 'path',
        title: 'Visual Studio Code'
      },
      path: '.codex/config.toml'
    }
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse(openResponse))
      .mockResolvedValueOnce(makeJsonResponse({ ok: true, queued: true }))

    await expect(openSessionProjectConfig('session-a')).resolves.toEqual(openResponse)
    await expect(retrySessionProjectConfig('session-a')).resolves.toEqual({ ok: true, queued: true })

    expect(fetchMock.mock.calls[0]).toEqual([
      'http://api.example.com:8787/api/sessions/session-a/project-config/open',
      expect.objectContaining({
        credentials: 'include',
        method: 'POST'
      })
    ])
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body')
    expect(fetchMock.mock.calls[1]).toEqual([
      'http://api.example.com:8787/api/sessions/session-a/retry-project-config',
      expect.objectContaining({
        credentials: 'include',
        method: 'POST'
      })
    ])
    expect(fetchMock.mock.calls[1]?.[1]).not.toHaveProperty('body')
  })

  it('rejects a malformed successful retry response instead of showing queued', async () => {
    fetchMock.mockResolvedValue(makeJsonResponse({ ok: true, queued: false }))

    await expect(retrySessionProjectConfig('session-a')).rejects.toThrow(
      'Project config recovery returned an invalid response.'
    )
  })

  it('rejects a malformed open response instead of reporting false success', async () => {
    fetchMock.mockResolvedValue(makeJsonResponse({ opened: true }))

    await expect(openSessionProjectConfig('session-a')).rejects.toThrow()
  })
})
