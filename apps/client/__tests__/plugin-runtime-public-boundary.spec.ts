import { describe, expect, it, vi } from 'vitest'

import { listPluginRuntimeEndpoints } from '#~/plugins/api'

const apiMocks = vi.hoisted(() => ({
  fetchApiJson: vi.fn(),
  fetchApiResponse: vi.fn()
}))

vi.mock('#~/api/base', () => ({
  buildApiUrl: (path: string) => path,
  ...apiMocks
}))

describe('public plugin runtime boundary', () => {
  it('rebuilds the public runtime endpoint list without private roots', async () => {
    apiMocks.fetchApiResponse.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          endpoints: [{
            current: true,
            id: 'workspace:docs',
            projectHome: '/private/project',
            role: 'workspace',
            serverBaseUrl: 'http://127.0.0.1:8787',
            startedAt: '2026-07-30T00:00:00.000Z',
            status: 'online',
            unknownPrivateMetadata: '/private/unknown',
            workspaceFolder: '/private/workspace',
            workspaceId: 'docs'
          }]
        }),
        { status: 200 }
      )
    )

    await expect(listPluginRuntimeEndpoints()).resolves.toEqual([{
      current: true,
      id: 'workspace:docs',
      role: 'workspace',
      serverBaseUrl: 'http://127.0.0.1:8787',
      startedAt: '2026-07-30T00:00:00.000Z',
      status: 'online',
      workspaceId: 'docs'
    }])
  })

  it('fails closed for malformed public runtime endpoint lists', async () => {
    for (
      const value of [
        { endpoints: {} },
        { endpoints: [{ id: 'missing-role' }] },
        { endpoints: [{ id: 'workspace:docs', role: 'private' }] },
        { endpoints: [{ id: 'workspace:docs', role: 'workspace', startedAt: '/private/workspace' }] },
        { endpoints: [{ id: 'workspace:docs', role: 'workspace', serverBaseUrl: 'file:///private/other' }] },
        { endpoints: [{ id: 'workspace:docs', role: 'workspace', serverBaseUrl: 'https://secret@example.com' }] },
        { endpoints: [{ id: 'workspace:docs', role: 'workspace', serverBaseUrl: 42 }] }
      ]
    ) {
      apiMocks.fetchApiResponse.mockResolvedValueOnce(
        new Response(JSON.stringify(value), { status: 200 })
      )
      await expect(listPluginRuntimeEndpoints()).rejects.toThrow(/runtime endpoints|runtime metadata/i)
    }
  })
})
