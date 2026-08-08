import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listAssets: vi.fn(),
  loadConfigState: vi.fn()
}))

vi.mock('#~/services/config/index.js', () => ({
  loadConfigState: mocks.loadConfigState
}))

vi.mock('@oneworks/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@oneworks/types')>()
  return {
    ...actual,
    resolveAdapterRuntimeTarget: (adapter: string) => ({ loadSpecifier: adapter }),
    loadAdapterNativePluginManager: async (adapter: string) => ({
      adapter,
      discover: async () => ({
        diagnostics: adapter === 'codex'
          ? [{
            adapter: 'codex',
            code: 'untrusted_path',
            level: 'warning',
            message: '/private/unrelated'
          }]
          : [],
        plugins: adapter === 'codex'
          ? [
            {
              adapter: 'codex',
              capabilities: {},
              description: '/private/unrelated',
              id: 'user-id',
              name: 'review',
              scope: 'user',
              source: { displayPath: '~/user-review', internalRoot: '/root/user', kind: 'installed-copy' },
              state: 'enabled',
              version: 'https://alice:s3cret@example.test/path'
            },
            {
              adapter: 'codex',
              capabilities: {},
              id: 'project-id',
              name: 'review',
              scope: 'project',
              source: { displayPath: './project-review', internalRoot: '/root/project', kind: 'local-file' },
              state: 'enabled'
            },
            {
              adapter: 'codex',
              capabilities: {},
              id: 'rootless-id',
              name: 'review',
              scope: 'project',
              source: { displayPath: './missing', kind: 'local-file' },
              state: 'enabled'
            },
            {
              adapter: 'codex',
              capabilities: {},
              id: 'unsafe-source-kind',
              name: 'review',
              scope: 'project',
              source: { kind: '/private/workspace' },
              state: 'enabled'
            },
            {
              adapter: 'codex',
              capabilities: {},
              id: 'unsafe-state',
              name: 'review',
              scope: 'project',
              source: { kind: 'local-file' },
              state: 'sk%252Dabcdefghijklmnop'
            }
          ]
          : []
      })
    })
  }
})

vi.mock('@oneworks/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@oneworks/utils')>()
  return {
    ...actual,
    listNativeHostPluginAssetsWithin: mocks.listAssets
  }
})

describe('native host plugin asset identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadConfigState.mockResolvedValue({ mergedConfig: {}, workspaceFolder: '/workspace' })
    mocks.listAssets.mockImplementation(async () => [{
      files: [{ contentKind: 'text', path: 'skills/review/SKILL.md', size: 4 }],
      kind: 'skills'
    }])
  })

  it('reads only the root owned by the selected opaque id', async () => {
    const { listNativeHostPluginAssets } = await import('#~/services/plugins/native-host.js')

    await expect(listNativeHostPluginAssets('user-id')).resolves.toEqual([
      { files: [{ contentKind: 'text', path: 'skills/review/SKILL.md', size: 4 }], kind: 'skills' }
    ])
    expect(mocks.listAssets).toHaveBeenCalledOnce()
    expect(mocks.listAssets).toHaveBeenCalledWith('/root/user')

    mocks.listAssets.mockClear()
    await expect(listNativeHostPluginAssets('project-id')).resolves.toEqual([
      { files: [{ contentKind: 'text', path: 'skills/review/SKILL.md', size: 4 }], kind: 'skills' }
    ])
    expect(mocks.listAssets).toHaveBeenCalledOnce()
    expect(mocks.listAssets).toHaveBeenCalledWith('/root/project')
  })

  it('fails closed for rootless or stale ids instead of falling back by name', async () => {
    const { listNativeHostPluginAssets } = await import('#~/services/plugins/native-host.js')

    await expect(listNativeHostPluginAssets('rootless-id')).resolves.toEqual([])
    await expect(listNativeHostPluginAssets('stale-id')).resolves.toBeUndefined()
    expect(mocks.listAssets).not.toHaveBeenCalled()
  })

  it('returns fresh native plugin objects without installation roots', async () => {
    const { listNativeHostPlugins } = await import('#~/services/plugins/native-host.js')

    const result = await listNativeHostPlugins()
    const plugin = result.plugins.find(item => item.id === 'user-id')

    expect(plugin?.source).toEqual({ kind: 'installed-copy' })
    expect(plugin?.source).not.toHaveProperty('displayPath')
    expect(plugin?.source).not.toHaveProperty('internalRoot')
    expect(plugin).not.toHaveProperty('description')
    expect(plugin).not.toHaveProperty('version')
    expect(result.plugins.map(item => item.id)).not.toContain('unsafe-source-kind')
    expect(result.plugins.map(item => item.id)).not.toContain('unsafe-state')
    expect(result.diagnostics).toEqual([{
      adapter: 'codex',
      code: 'untrusted_path',
      level: 'warning',
      message: 'Native plugin diagnostic was redacted.'
    }])
    expect(JSON.stringify(result)).not.toContain('/root/user')
    expect(JSON.stringify(result)).not.toContain('/workspace')
    expect(JSON.stringify(result)).not.toContain('s3cret')
    expect(JSON.stringify(result)).not.toContain('/private/unrelated')
  })

  it('omits raw Codex app metadata content at the native public asset boundary', async () => {
    mocks.listAssets.mockResolvedValue([{
      files: [{
        content: '{"client_secret":"must-not-leak","path":"/root/user"}',
        contentKind: 'text',
        path: 'apps/docs.app.json',
        size: 52
      }],
      kind: 'apps'
    }])
    const { listNativeHostPluginAssets } = await import('#~/services/plugins/native-host.js')

    const result = await listNativeHostPluginAssets('user-id')

    expect(result).toEqual([{
      files: [{ contentKind: 'text', path: 'apps/docs.app.json', size: 52 }],
      kind: 'apps'
    }])
    expect(JSON.stringify(result)).not.toContain('must-not-leak')
    expect(JSON.stringify(result)).not.toContain('/root/user')
  })
})
