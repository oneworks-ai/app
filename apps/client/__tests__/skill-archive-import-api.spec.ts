import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { importSkillArchive } from '#~/api/knowledge'

vi.mock('#~/homepage-preview/runtime-loader', () => ({
  handleHomepagePreviewFetchIfEnabled: () => undefined
}))

vi.mock('#~/runtime-config.js', () => ({
  createServerUrl: (path: string) => new URL(path, 'http://api.example.com:8787/').toString(),
  getServerBaseUrl: () => 'http://api.example.com:8787'
}))

const makeResponse = () =>
  new Response(JSON.stringify({ fileCount: 1, targetDir: '.oo/skills' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })

describe('skill archive import api', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => makeResponse())
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends the selected scope and keeps project as the default', async () => {
    const file = new File(['archive'], 'skills.zip', { type: 'application/zip' })

    await importSkillArchive(file, 'global')
    await importSkillArchive(file)
    await importSkillArchive(file, 'global', { force: true })

    const globalHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    const projectHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers)
    const forcedHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers)
    expect(globalHeaders.get('x-file-name')).toBe('skills.zip')
    expect(globalHeaders.get('x-skill-target')).toBe('global')
    expect(globalHeaders.has('x-skill-force')).toBe(false)
    expect(projectHeaders.get('x-skill-target')).toBe('project')
    expect(forcedHeaders.get('x-skill-force')).toBe('true')
  })
})
