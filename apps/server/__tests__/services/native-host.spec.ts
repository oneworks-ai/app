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
        diagnostics: [{
          code: 'workspace_path',
          level: 'warning',
          message:
            'Workspace /data/workspace file:///data/workspace %2Fdata%2Fworkspace %252Fdata%252Fworkspace file%3A%2F%2F%2Fdata%2Fworkspace file%253A%252F%252F%252Fdata%252Fworkspace /oauth/callback https://example.test/oauth/callback'
        }],
        plugins: adapter === 'codex'
          ? [
            {
              adapter: 'codex',
              capabilities: {},
              diagnostics: [{
                code: 'legacy_path',
                level: 'warning',
                message:
                  'Loaded /custom/native/user file:///custom/native/user %2Fcustom%2Fnative%2Fuser %252Fcustom%252Fnative%252Fuser file%3A%2F%2F%2Fcustom%2Fnative%2Fuser file%253A%252F%252F%252Fcustom%252Fnative%252Fuser /oauth/callback https://example.test/oauth/callback'
              }],
              id: 'user-id',
              name: 'review',
              scope: 'user',
              source: {
                displayPath: '~/user-review',
                internalRoot: '/custom/native/user',
                kind: 'installed-copy'
              },
              state: 'enabled'
            },
            {
              adapter: 'codex',
              capabilities: {},
              id: 'project-id',
              name: 'review',
              scope: 'project',
              source: {
                displayPath: './project-review',
                internalRoot: '/custom/native/project',
                kind: 'local-file'
              },
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
    mocks.loadConfigState.mockResolvedValue({ mergedConfig: {}, workspaceFolder: '/data/workspace' })
    mocks.listAssets.mockImplementation(async () => [{
      files: [{ content: 'safe', contentKind: 'text', path: 'skills/review/SKILL.md', size: 4 }],
      kind: 'skills'
    }])
  })

  it('reads only the root owned by the selected opaque id', async () => {
    const { listNativeHostPluginAssets } = await import('#~/services/plugins/native-host.js')

    await expect(listNativeHostPluginAssets('user-id')).resolves.toEqual([
      {
        files: [{ content: 'safe', contentKind: 'text', path: 'skills/review/SKILL.md', size: 4 }],
        kind: 'skills'
      }
    ])
    expect(mocks.listAssets).toHaveBeenCalledOnce()
    expect(mocks.listAssets).toHaveBeenCalledWith('/custom/native/user')

    mocks.listAssets.mockClear()
    await expect(listNativeHostPluginAssets('project-id')).resolves.toEqual([
      {
        files: [{ content: 'safe', contentKind: 'text', path: 'skills/review/SKILL.md', size: 4 }],
        kind: 'skills'
      }
    ])
    expect(mocks.listAssets).toHaveBeenCalledOnce()
    expect(mocks.listAssets).toHaveBeenCalledWith('/custom/native/project')
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

    expect(plugin).toMatchObject({
      diagnostics: [{
        message:
          'Loaded [local path] [local path] [local path] [local path] [local path] [local path] /oauth/callback https://example.test/oauth/callback'
      }],
      source: { kind: 'installed-copy' }
    })
    expect(result.diagnostics).toEqual([
      'codex',
      'claude-code',
      'gemini',
      'copilot',
      'kimi',
      'opencode'
    ].map(adapter => ({
      adapter,
      code: 'workspace_path',
      level: 'warning',
      message:
        'Workspace [local path] [local path] [local path] [local path] [local path] [local path] /oauth/callback https://example.test/oauth/callback'
    })))
    expect(plugin?.source).not.toHaveProperty('displayPath')
    expect(plugin?.source).not.toHaveProperty('internalRoot')
    expect(JSON.stringify(result)).not.toContain('/custom/native')
    expect(JSON.stringify(result)).not.toContain('/data/workspace')
  })

  it('redacts known filesystem roots through bounded encoded forms without corrupting routes or HTTP URLs', async () => {
    const { redactPrivateRoots } = await import('@oneworks/utils')
    const value = [
      '/data/workspace',
      '/custom/native',
      'file:///data/workspace',
      '%2fdata%2fworkspace',
      '%2Fdata%2Fworkspace',
      '%252fdata%252fworkspace',
      '%252Fdata%252Fworkspace',
      '/database/kept',
      '/oauth/callback',
      'https://example.test/data/workspace'
    ].join(' ')

    expect(redactPrivateRoots(value, ['/data', '/custom'])).toBe([
      '[local path]',
      '[local path]',
      '[local path]',
      '[local path]',
      '[local path]',
      '[local path]',
      '[local path]',
      '/database/kept',
      '/oauth/callback',
      'https://example.test/data/workspace'
    ].join(' '))
  })

  it('omits raw Codex app metadata content at the native public asset boundary', async () => {
    mocks.listAssets.mockResolvedValue([{
      files: [{
        content: '{"client_secret":"must-not-leak","path":"/custom/native/user"}',
        contentKind: 'text',
        path: 'apps/docs.app.json',
        size: 58
      }],
      kind: 'apps'
    }])
    const { listNativeHostPluginAssets } = await import('#~/services/plugins/native-host.js')

    const result = await listNativeHostPluginAssets('user-id')

    expect(result).toEqual([{
      files: [{ contentKind: 'text', path: 'apps/docs.app.json', size: 58 }],
      kind: 'apps'
    }])
    expect(JSON.stringify(result)).not.toContain('must-not-leak')
    expect(JSON.stringify(result)).not.toContain('/custom/native/user')
  })
})
