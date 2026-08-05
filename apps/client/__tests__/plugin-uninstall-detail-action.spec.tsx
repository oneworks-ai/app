// @vitest-environment happy-dom
/* eslint-disable max-lines -- detail action tests cover lifecycle races in one mounted route fixture. */
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PluginRuntimeInstance } from '@oneworks/types'

import { ApiError } from '#~/api/base'
import { PluginStoreRoute } from '#~/routes/PluginStoreRoute'
import { createMarketplacePluginRouteKey } from '#~/routes/plugin-routes'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const testState = vi.hoisted(() => ({
  catalog: { plugins: [], sources: [] } as { plugins: Array<Record<string, unknown>>; sources: unknown[] },
  clearRouteSidebar: vi.fn(),
  confirm: vi.fn(),
  confirmConfig: undefined as Record<string, unknown> | undefined,
  config: { sources: {} } as Record<string, unknown>,
  currentScope: 'review',
  destroyModal: vi.fn(),
  globalMutate: vi.fn(),
  getPlan: vi.fn(),
  instances: [{
    enabled: true,
    name: 'reviewer',
    requestId: '/managed/reviewer',
    scope: 'review',
    sourceGroup: 'project',
    watch: { enabled: false }
  }] as PluginRuntimeInstance[],
  listCatalog: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  navigate: vi.fn(),
  plan: {
    available: true,
    deleteItems: [
      'project-marketplace-declaration',
      'project-runtime-override',
      'managed-install'
    ],
    identity: {
      adapter: 'claude',
      marketplace: 'team',
      plugin: 'reviewer',
      scope: 'review'
    },
    retainItems: [
      'global-config',
      'user-config',
      'sibling-plugins',
      'managed-plugin-data',
      'user-data-and-accounts',
      'shared-package-cache'
    ],
    token: 'a'.repeat(64)
  } as {
    available: boolean
    deleteItems?: string[]
    identity?: Record<string, string>
    reason?: string
    retainItems?: string[]
    token?: string
  },
  refreshPlugins: vi.fn(),
  reloadPlugin: vi.fn(),
  routeParent: 'list' as 'list' | 'store',
  setRouteSidebar: vi.fn(),
  syncSelection: vi.fn(),
  uninstall: vi.fn()
}))

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>()
  return {
    ...actual,
    App: {
      useApp: () => ({
        message: {
          error: testState.messageError,
          success: testState.messageSuccess
        },
        modal: {
          confirm: testState.confirm
        }
      })
    }
  }
})

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    i18n: {
      language: 'en',
      resolvedLanguage: 'en'
    },
    t: (key: string) => key
  })
}))

vi.mock('react-router-dom', () => ({
  useLocation: () => ({
    pathname: `/plugins/${testState.routeParent}/${encodeURIComponent(testState.currentScope)}`,
    search: ''
  }),
  useNavigate: () => testState.navigate,
  useParams: () => ({ scope: testState.currentScope })
}))

vi.mock('swr', () => ({
  default: (key: unknown) => ({
    data: Array.isArray(key) && key[0] === '/api/plugins/marketplace/catalog'
      ? testState.catalog
      : Array.isArray(key) && key[0] === '/api/config'
      ? testState.config
      : Array.isArray(key) && key[0] === '/api/plugins/native'
      ? { plugins: [] }
      : undefined,
    isLoading: false,
    mutate: vi.fn()
  }),
  useSWRConfig: () => ({
    mutate: testState.globalMutate
  })
}))

vi.mock('#~/components/icons/MaterialSymbol', () => ({
  MaterialSymbol: ({ name }: { name: string }) => <span>{name}</span>
}))

vi.mock('#~/components/layout/RouteContainerHeader', () => ({
  RouteContainerHeader: (props: {
    actionItems: Array<{
      disabled?: boolean
      key: string
      label: string
      onSelect: () => void
    }>
    breadcrumb?: { parentTitle?: string }
    title?: string
  }) => (
    <div>
      <span>{props.title}</span>
      <span>{props.breadcrumb?.parentTitle}</span>
      {props.actionItems.map(action => (
        <button
          data-action-key={action.key}
          disabled={action.disabled}
          key={action.key}
          onClick={action.onSelect}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}))

vi.mock('#~/components/layout/RouteContainerLayout', () => ({
  RouteContainerLayout: (props: { children: ReactNode; header: ReactNode }) => (
    <div>
      {props.header}
      {props.children}
    </div>
  )
}))

vi.mock('#~/components/layout/route-sidebar-context', () => ({
  useRouteSidebar: () => ({
    clearRouteSidebar: testState.clearRouteSidebar,
    hasRouteSidebarProvider: false,
    setRouteSidebar: testState.setRouteSidebar
  })
}))

vi.mock('#~/components/layout/use-route-container-sidebar-opener', () => ({
  useRouteContainerSidebarOpener: () => ({
    openRouteSidebar: vi.fn()
  })
}))

vi.mock('#~/components/plugins/MarketplacePluginDetailPanel', () => ({
  MarketplacePluginDetailPanel: () => null
}))
vi.mock('#~/components/plugins/NativePluginDetailPanel', () => ({
  NativePluginDetailPanel: () => null
}))
vi.mock('#~/components/plugins/PluginCreateLanding', () => ({
  PluginCreateLanding: () => null
}))
vi.mock('#~/components/plugins/PluginDetailPanel', () => ({
  PluginDetailPanel: () => <div>plugin detail</div>
}))
vi.mock('#~/components/plugins/PluginDiagnostics', () => ({
  PluginDiagnostics: () => null
}))
vi.mock('#~/components/plugins/PluginHomeView', () => ({
  PluginHomeView: () => null
}))
vi.mock('#~/components/plugins/PluginMarketplaceLanding', async (importOriginal) => ({
  ...await importOriginal<typeof import('#~/components/plugins/PluginMarketplaceLanding')>(),
  PluginMarketplaceLanding: () => null
}))
vi.mock('#~/components/plugins/PluginRuntimeListView', () => ({
  PluginRuntimeListView: () => null
}))
vi.mock('#~/components/plugins/PluginStoreSidebarControls', () => ({
  PluginGroupModeControls: () => null,
  buildPluginRouteSidebarGroups: () => [],
  resolvePluginSourceGroup: () => 'project'
}))
vi.mock('#~/components/plugins/plugin-runtime-list-items', () => ({
  buildPluginListItems: () => [],
  createNativePluginRouteKey: () => ''
}))

vi.mock('#~/plugins/api', () => ({
  listNativeHostPlugins: vi.fn(),
  setPluginEnabled: vi.fn(),
  setPluginWatch: vi.fn()
}))

vi.mock('#~/plugins/marketplace-api', () => ({
  getPluginMarketplaceUninstallPlan: testState.getPlan,
  listPluginMarketplaceCatalog: testState.listCatalog,
  resolvePluginMarketplaceVersions: vi.fn(),
  syncPluginMarketplaceSelection: testState.syncSelection,
  uninstallPluginMarketplacePlugin: testState.uninstall
}))

vi.mock('#~/plugins/plugin-context', () => ({
  usePluginContext: () => ({
    pluginServerBaseUrl: 'https://workspace.example',
    refreshPlugins: testState.refreshPlugins,
    reloadPlugin: testState.reloadPlugin,
    snapshot: {
      diagnostics: [],
      instances: testState.instances
    }
  })
}))

vi.mock('#~/plugins/route-plugin-chrome', () => ({
  useRoutePluginChrome: () => ({
    headerActions: [],
    sidebarContextMenuItems: []
  })
}))

vi.mock('#~/utils/copy', () => ({
  copyTextWithFeedback: vi.fn()
}))

let container: HTMLDivElement
let root: Root | undefined

const renderRoute = async () => {
  await act(async () => {
    root!.render(<PluginStoreRoute />)
  })
}

const clickUninstall = async () => {
  const button = container.querySelector<HTMLButtonElement>('[data-action-key="marketplace-install-project"]')
  if (button == null) throw new Error('Expected uninstall detail action')
  await act(async () => {
    button.click()
  })
}

const getConfirmCallback = (name: 'onCancel' | 'onOk') => {
  const callback = testState.confirmConfig?.[name]
  if (typeof callback !== 'function') throw new Error(`Expected modal ${name} callback`)
  return callback as () => Promise<void> | void
}

describe('plugin store route marketplace uninstall detail action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testState.currentScope = createMarketplacePluginRouteKey('team', 'reviewer')
    testState.catalog = {
      plugins: [{
        configSource: 'project',
        declared: true,
        enabled: true,
        installable: true,
        installedSources: ['project'],
        marketplace: 'team',
        marketplaceEnabled: true,
        marketplaceType: 'claude-code',
        name: 'reviewer',
        sourceLabel: './plugins/reviewer',
        sourceType: 'directory'
      }],
      sources: []
    }
    testState.config = {
      sources: {
        project: {
          plugins: {
            marketplaces: {
              team: {
                enabled: true,
                plugins: { reviewer: { enabled: true, scope: 'review' } },
                type: 'claude-code'
              }
            }
          }
        }
      }
    }
    testState.routeParent = 'store'
    testState.instances = []
    testState.plan = {
      available: true,
      deleteItems: [
        'project-marketplace-declaration',
        'project-runtime-override',
        'managed-install'
      ],
      identity: {
        adapter: 'claude',
        marketplace: 'team',
        plugin: 'reviewer',
        scope: 'review'
      },
      retainItems: [
        'global-config',
        'user-config',
        'sibling-plugins',
        'managed-plugin-data',
        'user-data-and-accounts',
        'shared-package-cache'
      ],
      token: 'a'.repeat(64)
    }
    testState.confirmConfig = undefined
    testState.confirm.mockImplementation((config: Record<string, unknown>) => {
      testState.confirmConfig = config
      return {
        destroy: testState.destroyModal,
        update: vi.fn()
      }
    })
    testState.uninstall.mockResolvedValue({
      identity: testState.plan.identity,
      removed: true
    })
    testState.getPlan.mockImplementation(() => Promise.resolve(testState.plan))
    testState.refreshPlugins.mockResolvedValue(undefined)
    testState.listCatalog.mockResolvedValue({ plugins: [], sources: [] })
    testState.globalMutate.mockResolvedValue(undefined)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    if (root != null) {
      await act(async () => {
        root?.unmount()
      })
    }
    root = undefined
    container.remove()
  })

  it('never exposes a destructive action for a selected runtime-list instance', async () => {
    testState.routeParent = 'list'
    testState.currentScope = 'review'
    testState.instances = [{
      enabled: true,
      name: 'reviewer',
      requestId: '/managed/reviewer',
      scope: 'review',
      sourceGroup: 'project',
      watch: { enabled: false }
    }]
    testState.config = { sources: { project: { plugins: { marketplaces: {} } } } }
    await renderRoute()

    expect(container.querySelector('[data-action-key="plugin-uninstall"]')).toBeNull()
    expect(testState.uninstall).not.toHaveBeenCalled()
  })

  it.each(
    [
      ['global', 'global'],
      ['local', 'localDev']
    ] as const
  )('hides uninstall for a %s runtime that collides with a configured project scope', async (
    _label,
    sourceGroup
  ) => {
    testState.routeParent = 'list'
    testState.currentScope = 'review'
    testState.instances = [{
      enabled: true,
      name: 'reviewer',
      requestId: '/managed/reviewer',
      scope: 'review',
      ...(sourceGroup == null ? {} : { sourceGroup }),
      watch: { enabled: false }
    }]
    await renderRoute()

    expect(container.querySelector('[data-action-key="plugin-uninstall"]')).toBeNull()
    expect(testState.getPlan).not.toHaveBeenCalled()
    expect(testState.uninstall).not.toHaveBeenCalled()
  })

  it('hides uninstall for an omitted-scope direct project runtime collision', async () => {
    testState.routeParent = 'list'
    testState.currentScope = 'direct-reviewer'
    testState.instances = [{
      enabled: true,
      name: 'direct-reviewer',
      requestId: 'direct-reviewer',
      scope: 'direct-reviewer',
      sourceGroup: 'project',
      watch: { enabled: false }
    }]
    testState.config = {
      sources: {
        project: {
          plugins: {
            marketplaces: {
              team: {
                enabled: true,
                plugins: { reviewer: { enabled: true, scope: 'direct-reviewer' } },
                type: 'claude-code'
              }
            },
            plugins: [{ id: 'direct-reviewer' }]
          }
        }
      }
    }
    await renderRoute()

    expect(container.querySelector('[data-action-key="plugin-uninstall"]')).toBeNull()
    expect(testState.getPlan).not.toHaveBeenCalled()
    expect(testState.uninstall).not.toHaveBeenCalled()
  })

  it('uses Cancel as the default and performs no mutation when cancelled', async () => {
    await renderRoute()
    await clickUninstall()

    expect(testState.confirmConfig).toMatchObject({
      autoFocusButton: 'cancel',
      okButtonProps: { danger: true }
    })
    await getConfirmCallback('onCancel')()
    expect(testState.getPlan).not.toHaveBeenCalled()
    expect(testState.uninstall).not.toHaveBeenCalled()
  })

  it('routes an installed marketplace detail removal through confirmation before uninstalling', async () => {
    testState.routeParent = 'store'
    testState.currentScope = createMarketplacePluginRouteKey('openai-plugins', 'airtable')
    testState.catalog = {
      plugins: [{
        builtIn: true,
        declared: true,
        enabled: true,
        installable: true,
        installedSources: ['project'],
        marketplace: 'openai-plugins',
        marketplaceEnabled: true,
        marketplaceType: 'codex',
        name: 'airtable',
        sourceLabel: './plugins/airtable',
        sourceType: 'git-subdir'
      }],
      sources: []
    }
    testState.config = {
      sources: {
        project: {
          plugins: {
            marketplaces: {
              'openai-plugins': {
                enabled: true,
                plugins: { airtable: { enabled: true, scope: 'airtable' } },
                type: 'codex'
              }
            }
          }
        }
      }
    }
    testState.plan = {
      ...testState.plan,
      identity: {
        adapter: 'codex',
        marketplace: 'openai-plugins',
        plugin: 'airtable',
        scope: 'airtable'
      }
    }
    await renderRoute()

    const button = container.querySelector<HTMLButtonElement>('[data-action-key="marketplace-install-project"]')
    if (button == null) throw new Error('Expected installed marketplace project action')
    await act(async () => {
      button.click()
    })
    expect(testState.confirmConfig).toMatchObject({
      autoFocusButton: 'cancel',
      okButtonProps: { danger: true }
    })
    await getConfirmCallback('onCancel')()
    expect(testState.getPlan).not.toHaveBeenCalled()
    expect(testState.syncSelection).not.toHaveBeenCalled()
    expect(testState.uninstall).not.toHaveBeenCalled()

    await act(async () => {
      button.click()
      await getConfirmCallback('onOk')()
    })
    expect(testState.uninstall).toHaveBeenCalledWith(
      'airtable',
      testState.plan.token,
      expect.objectContaining({ serverBaseUrl: 'https://workspace.example' })
    )
    expect(testState.getPlan).toHaveBeenCalledWith(
      'airtable',
      expect.objectContaining({ serverBaseUrl: 'https://workspace.example' })
    )
    expect(testState.syncSelection).not.toHaveBeenCalled()
    expect(testState.navigate).toHaveBeenCalledWith('/plugins/list')
  })

  it('deduplicates confirm while pending, then refreshes runtime and catalog before navigating', async () => {
    let resolveUninstall: (() => void) | undefined
    testState.uninstall.mockReturnValue(
      new Promise((resolve) => {
        resolveUninstall = () =>
          resolve({
            identity: testState.plan.identity,
            removed: true
          })
      })
    )
    await renderRoute()
    await clickUninstall()
    const onOk = getConfirmCallback('onOk')

    let first: Promise<void> | undefined
    let second: Promise<void> | undefined
    await act(async () => {
      first = Promise.resolve(onOk())
      second = Promise.resolve(onOk())
      await Promise.resolve()
    })
    expect(testState.uninstall).toHaveBeenCalledTimes(1)
    resolveUninstall?.()
    await act(async () => {
      await Promise.all([first, second])
    })
    expect(testState.refreshPlugins).toHaveBeenCalledTimes(1)
    expect(testState.listCatalog).toHaveBeenCalledWith({
      serverBaseUrl: 'https://workspace.example'
    })
    expect(testState.globalMutate).toHaveBeenCalledTimes(1)
    expect(testState.navigate).toHaveBeenCalledWith('/plugins/list')
    expect(testState.messageSuccess).toHaveBeenCalledWith('pluginStore.uninstall.success')
    const navigateOrder = testState.navigate.mock.invocationCallOrder.at(-1) ?? 0
    expect(testState.refreshPlugins.mock.invocationCallOrder[0]).toBeLessThan(navigateOrder)
    expect(testState.listCatalog.mock.invocationCallOrder[0]).toBeLessThan(navigateOrder)
    expect(testState.globalMutate.mock.invocationCallOrder[0]).toBeLessThan(navigateOrder)
  })

  it('completes feedback and navigation when authoritative refresh removes its marketplace identity', async () => {
    let resolveCatalog: (() => void) | undefined
    let resolveRefresh: (() => void) | undefined
    testState.refreshPlugins.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRefresh = resolve
      })
    )
    testState.listCatalog.mockReturnValue(
      new Promise((resolve) => {
        resolveCatalog = () => resolve({ plugins: [], sources: [] })
      })
    )
    await renderRoute()
    await clickUninstall()
    let pending: Promise<void> | undefined
    await act(async () => {
      pending = Promise.resolve(getConfirmCallback('onOk')())
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(testState.uninstall).toHaveBeenCalledTimes(1)

    testState.config = { sources: { project: { plugins: { marketplaces: {} } } } }
    testState.catalog = { plugins: [], sources: [] }
    await renderRoute()
    expect(container.querySelector('[data-action-key="marketplace-install-project"]')).toBeNull()

    await act(async () => {
      resolveRefresh?.()
      resolveCatalog?.()
      await pending
    })
    expect(testState.messageSuccess).toHaveBeenCalledWith('pluginStore.uninstall.success')
    expect(testState.navigate).toHaveBeenCalledWith('/plugins/list')
  })

  it('keeps a failed request retryable and succeeds on the next confirm', async () => {
    testState.uninstall
      .mockRejectedValueOnce(new Error('request failed'))
      .mockResolvedValueOnce({
        identity: testState.plan.identity,
        removed: true
      })
    await renderRoute()
    await clickUninstall()
    const onOk = getConfirmCallback('onOk')

    let failure: unknown
    await act(async () => {
      try {
        await onOk()
      } catch (error) {
        failure = error
      }
    })
    expect(failure).toEqual(new Error('request failed'))
    expect(testState.messageError).toHaveBeenCalledWith('request failed')
    expect(testState.navigate).not.toHaveBeenCalled()

    await act(async () => {
      await onOk()
    })
    expect(testState.uninstall).toHaveBeenCalledTimes(2)
    expect(testState.navigate).toHaveBeenCalledWith('/plugins/list')
  })

  it('closes a stale quote and requires a fresh confirmation before retrying', async () => {
    testState.uninstall.mockRejectedValueOnce(
      new ApiError(409, {
        code: 'plugin_uninstall_plan_stale',
        message: 'The uninstall plan is stale. Request a new plan and retry.'
      })
    )
    await renderRoute()
    await clickUninstall()

    await act(async () => {
      await getConfirmCallback('onOk')()
    })

    expect(testState.getPlan).toHaveBeenCalledTimes(1)
    expect(testState.destroyModal).toHaveBeenCalled()
    expect(testState.messageError).toHaveBeenCalledWith('pluginStore.uninstall.stale')
    expect(testState.navigate).not.toHaveBeenCalled()
    testState.plan = { ...testState.plan, token: 'c'.repeat(64) }
    await clickUninstall()
    await act(async () => {
      await getConfirmCallback('onOk')()
    })
    expect(testState.getPlan).toHaveBeenCalledTimes(2)
    expect(testState.uninstall).toHaveBeenCalledTimes(2)
    expect(testState.navigate).toHaveBeenCalledWith('/plugins/list')
  })

  it('fails closed when the quoted identity does not match the configured managed tuple', async () => {
    testState.plan = {
      ...testState.plan,
      identity: {
        adapter: 'claude',
        marketplace: 'other',
        plugin: 'victim',
        scope: 'review'
      }
    }
    await renderRoute()
    await clickUninstall()

    await expect(act(async () => getConfirmCallback('onOk')())).rejects.toThrow('pluginStore.uninstall.failed')
    expect(testState.uninstall).not.toHaveBeenCalled()
    expect(testState.navigate).not.toHaveBeenCalled()
  })

  it('keeps a newer scope operation pending when an older operation finishes late', async () => {
    let resolveFirst: (() => void) | undefined
    let resolveSecond: (() => void) | undefined
    testState.uninstall
      .mockImplementationOnce(() =>
        new Promise((resolve) => {
          resolveFirst = () => resolve({ identity: testState.plan.identity, removed: true })
        })
      )
      .mockImplementationOnce(() =>
        new Promise((resolve) => {
          resolveSecond = () => resolve({ identity: testState.plan.identity, removed: true })
        })
      )
    await renderRoute()
    await clickUninstall()
    let first: Promise<void> | undefined
    await act(async () => {
      first = Promise.resolve(getConfirmCallback('onOk')())
      await Promise.resolve()
    })

    testState.currentScope = createMarketplacePluginRouteKey('team', 'other')
    testState.catalog = {
      plugins: [{
        configSource: 'project',
        declared: true,
        enabled: true,
        installable: true,
        installedSources: ['project'],
        marketplace: 'team',
        marketplaceEnabled: true,
        marketplaceType: 'claude-code',
        name: 'other',
        sourceLabel: './plugins/other',
        sourceType: 'directory'
      }],
      sources: []
    }
    testState.config = {
      sources: {
        project: {
          plugins: {
            marketplaces: {
              team: {
                enabled: true,
                plugins: {
                  other: { enabled: true, scope: 'other' },
                  reviewer: { enabled: true, scope: 'review' }
                },
                type: 'claude-code'
              }
            }
          }
        }
      }
    }
    testState.plan = {
      ...testState.plan,
      identity: {
        adapter: 'claude',
        marketplace: 'team',
        plugin: 'other',
        scope: 'other'
      },
      token: 'b'.repeat(64)
    }
    await renderRoute()
    await clickUninstall()
    const secondOnOk = getConfirmCallback('onOk')
    let second: Promise<void> | undefined
    await act(async () => {
      second = Promise.resolve(secondOnOk())
      await Promise.resolve()
    })
    await act(async () => {
      await secondOnOk()
    })
    expect(testState.uninstall).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveFirst?.()
      await first
    })
    await act(async () => {
      await secondOnOk()
    })
    expect(testState.uninstall).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveSecond?.()
      await second
    })
  })

  it('navigates after a successful uninstall even when post-success refresh reports a warning', async () => {
    testState.refreshPlugins.mockRejectedValueOnce(new Error('refresh failed'))
    await renderRoute()
    await clickUninstall()

    await act(async () => {
      await getConfirmCallback('onOk')()
    })

    expect(testState.navigate).toHaveBeenCalledWith('/plugins/list')
    expect(testState.messageError).toHaveBeenCalledWith('pluginStore.uninstall.refreshFailed')
    expect(testState.messageSuccess).not.toHaveBeenCalled()
  })

  it('invalidates a stale confirmation when the scope changes', async () => {
    await renderRoute()
    await clickUninstall()
    const staleOnOk = getConfirmCallback('onOk')

    testState.currentScope = 'other'
    await renderRoute()
    await act(async () => {
      await staleOnOk()
    })

    expect(testState.destroyModal).toHaveBeenCalled()
    expect(testState.uninstall).not.toHaveBeenCalled()
  })

  it('aborts a pending uninstall on unmount without stale feedback or navigation', async () => {
    let requestSignal: AbortSignal | undefined
    testState.uninstall.mockImplementation((
      _scope: string,
      _token: string,
      options: { signal?: AbortSignal }
    ) =>
      new Promise((_resolve, reject) => {
        requestSignal = options.signal
        options.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })
    )
    await renderRoute()
    await clickUninstall()
    let pending: Promise<void> | undefined
    await act(async () => {
      pending = Promise.resolve(getConfirmCallback('onOk')())
      await Promise.resolve()
    })

    await act(async () => {
      root?.unmount()
    })
    root = undefined
    await expect(pending).resolves.toBeUndefined()
    expect(requestSignal?.aborted).toBe(true)
    expect(testState.messageError).not.toHaveBeenCalled()
    expect(testState.navigate).not.toHaveBeenCalled()
  })

  it('projects the Marketplace public envelope before route header and breadcrumb rendering', async () => {
    const sentinel = 'route-envelope-private-sentinel'
    const privatePath = `/${sentinel}/plugins/reviewer`
    testState.catalog = {
      plugins: [{
        configSource: 'project',
        declared: true,
        displayName: privatePath,
        enabled: true,
        installable: true,
        installedSources: ['project'],
        marketplace: 'team',
        marketplaceEnabled: true,
        marketplaceType: 'claude-code',
        name: 'reviewer',
        sourceLabel: privatePath,
        sourceType: 'directory'
      }],
      sources: []
    }

    await renderRoute()
    expect(container.textContent).toContain('reviewer')
    expect(container.textContent).not.toContain(sentinel)
  })
})
