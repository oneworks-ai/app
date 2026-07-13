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
        diagnostics: [],
        plugins: adapter === 'codex'
          ? [
            {
              adapter: 'codex',
              capabilities: {},
              id: 'user-id',
              name: 'review',
              scope: 'user',
              source: { displayPath: '~/user-review', internalRoot: '/root/user', kind: 'installed-copy' },
              state: 'enabled'
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
    mocks.listAssets.mockImplementation(async (root: string) => [{ kind: 'skills', title: root, items: [] }])
  })

  it('reads only the root owned by the selected opaque id', async () => {
    const { listNativeHostPluginAssets } = await import('#~/services/plugins/native-host.js')

    await expect(listNativeHostPluginAssets('user-id')).resolves.toEqual([
      { kind: 'skills', title: '/root/user', items: [] }
    ])
    expect(mocks.listAssets).toHaveBeenCalledOnce()
    expect(mocks.listAssets).toHaveBeenCalledWith('/root/user')

    mocks.listAssets.mockClear()
    await expect(listNativeHostPluginAssets('project-id')).resolves.toEqual([
      { kind: 'skills', title: '/root/project', items: [] }
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
})
