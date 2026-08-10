// @vitest-environment happy-dom
/* eslint-disable max-lines -- detail action tests cover lifecycle races in one mounted route fixture. */
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PluginRuntimeInstance } from '@oneworks/types'

import { ApiError } from '#~/api/base'
import {
  claimMarketplaceConvergenceAuthority,
  claimMarketplaceSelectionIntentAuthority,
  listMarketplaceSelectionAuthorities,
  publishMarketplaceSelectionAuthority,
  resolveMarketplaceServerKey,
  settleMarketplaceConvergence
} from '#~/plugins/marketplace-mutation-authority'
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
  getConfig: vi.fn(),
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
  messageInfo: vi.fn(),
  messageSuccess: vi.fn(),
  mutateCatalog: vi.fn(),
  mutateConfig: vi.fn(),
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
  routeParent: 'list' as 'legacy' | 'list' | 'store',
  serverBaseUrl: 'https://workspace.example',
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
          info: testState.messageInfo,
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
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'pluginStore.uninstall.projectScope') {
        return `${key}:${String(values?.marketplace)}:${String(values?.plugin)}`
      }
      if (key === 'pluginStore.uninstall.title') {
        return `${key}:${String(values?.name)}`
      }
      if (key === 'pluginStore.uninstall.indeterminate') {
        return 'Plugin removal status is still syncing with the server. ' +
          'The action will remain unavailable until the authoritative state is confirmed.'
      }
      return key
    }
  })
}))

vi.mock('react-router-dom', () => ({
  useLocation: () => ({
    pathname: testState.routeParent === 'legacy'
      ? `/plugins/${encodeURIComponent(testState.currentScope)}`
      : `/plugins/${testState.routeParent}/${encodeURIComponent(testState.currentScope)}`,
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
    mutate: Array.isArray(key) && key[0] === '/api/plugins/marketplace/catalog'
      ? testState.mutateCatalog
      : Array.isArray(key) && key[0] === '/api/config'
      ? testState.mutateConfig
      : vi.fn()
  })
}))

vi.mock('#~/api.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('#~/api.js')>(),
  getConfig: testState.getConfig
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
    pluginServerBaseUrl: testState.serverBaseUrl,
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

const indeterminateCopy = 'Plugin removal status is still syncing with the server. ' +
  'The action will remain unavailable until the authoritative state is confirmed.'

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
    testState.serverBaseUrl = 'https://workspace.example'
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
    testState.refreshPlugins.mockResolvedValue({ applied: true })
    testState.listCatalog.mockResolvedValue({ plugins: [], sources: [] })
    testState.getConfig.mockImplementation(async () => testState.config)
    testState.mutateCatalog.mockResolvedValue(undefined)
    testState.mutateConfig.mockResolvedValue(undefined)
    testState.syncSelection.mockResolvedValue(undefined)
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

  it('projects danger-dialog text while preserving the exact stable-detail identity', async () => {
    const marketplaceSentinel = 'synthetic-detail-credential-sentinel'
    const pluginSentinel = 'synthetic-detail-private-sentinel'
    const marketplace = `credential://${marketplaceSentinel}:secret@public.invalid/catalog`
    const plugin = `/synthetic-detail-root/${pluginSentinel}`
    const scope = 'synthetic-detail-scope'
    testState.currentScope = createMarketplacePluginRouteKey(marketplace, plugin)
    testState.catalog = {
      plugins: [{
        builtIn: true,
        configSource: 'project',
        declared: true,
        displayName: 'Synthetic detail plugin',
        enabled: true,
        installable: true,
        installedSources: ['project'],
        marketplace,
        marketplaceEnabled: true,
        marketplaceTitle: 'Synthetic catalog',
        marketplaceType: 'claude-code',
        name: plugin,
        sourceLabel: './plugins/synthetic',
        sourceType: 'directory'
      }],
      sources: []
    }
    testState.config = {
      sources: {
        project: {
          plugins: {
            marketplaces: {
              [marketplace]: {
                enabled: true,
                plugins: { [plugin]: { enabled: true, scope } },
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
        marketplace,
        plugin,
        scope
      },
      token: 'd'.repeat(64)
    }
    await renderRoute()

    const button = container.querySelector<HTMLButtonElement>('[data-action-key="marketplace-install-project"]')
    if (button == null) throw new Error('Expected authoritative stable-detail removal action')
    await act(async () => {
      button.click()
    })
    const content = renderToStaticMarkup(testState.confirmConfig?.content as ReactNode)
    expect(`${String(testState.confirmConfig?.title)}${content}`).not.toContain(marketplaceSentinel)
    expect(`${String(testState.confirmConfig?.title)}${content}`).not.toContain(pluginSentinel)
    expect(content).toContain('[private]')
    await getConfirmCallback('onCancel')()
    expect(testState.getPlan).not.toHaveBeenCalled()

    await act(async () => {
      button.click()
      await getConfirmCallback('onOk')()
    })
    expect(testState.getPlan).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ serverBaseUrl: 'https://workspace.example' })
    )
    expect(testState.uninstall).toHaveBeenCalledWith(
      scope,
      'd'.repeat(64),
      expect.objectContaining({ serverBaseUrl: 'https://workspace.example' })
    )
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

  it('uses the authoritative managed runtime scope after a catalog detail reload', async () => {
    const marketplace = 'claude-plugins-official'
    const plugin = 'agent-sdk-dev'
    const scope = 'claude-claude-plugins-official-agent-sd-57d7f45af4cc574479565430'
    testState.routeParent = 'store'
    testState.currentScope = createMarketplacePluginRouteKey(marketplace, plugin)
    testState.catalog = {
      plugins: [{
        builtIn: true,
        configSource: 'project',
        declared: true,
        enabled: true,
        installable: true,
        installedSources: ['project'],
        marketplace,
        marketplaceEnabled: true,
        marketplaceType: 'claude-code',
        name: plugin,
        sourceLabel: './plugins/agent-sdk-dev',
        sourceType: 'directory'
      }],
      sources: []
    }
    testState.config = {
      sources: {
        project: {
          plugins: {
            marketplaces: {
              [marketplace]: {
                enabled: true,
                plugins: { [plugin]: { enabled: true } },
                type: 'claude-code'
              }
            }
          }
        }
      }
    }
    testState.instances = [{
      enabled: true,
      name: plugin,
      packageId: `${plugin}@${marketplace}`,
      requestId: `${plugin}@${marketplace}`,
      scope,
      source: {
        adapter: 'claude',
        kind: 'marketplace',
        marketplace,
        plugin
      },
      sourceGroup: 'project',
      watch: { enabled: false }
    }]
    testState.plan = {
      ...testState.plan,
      identity: {
        adapter: 'claude',
        marketplace,
        plugin,
        scope
      },
      token: 'e'.repeat(64)
    }
    await renderRoute()

    await clickUninstall()
    await act(async () => {
      await getConfirmCallback('onOk')()
    })

    expect(testState.getPlan).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ serverBaseUrl: 'https://workspace.example' })
    )
    expect(testState.uninstall).toHaveBeenCalledWith(
      scope,
      'e'.repeat(64),
      expect.objectContaining({ serverBaseUrl: 'https://workspace.example' })
    )
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
    expect(testState.mutateCatalog).toHaveBeenCalledTimes(1)
    expect(testState.mutateConfig).toHaveBeenCalledTimes(1)
    expect(testState.navigate).toHaveBeenCalledWith('/plugins/list')
    expect(testState.messageSuccess).toHaveBeenCalledWith('pluginStore.uninstall.success')
    const navigateOrder = testState.navigate.mock.invocationCallOrder.at(-1) ?? 0
    expect(testState.refreshPlugins.mock.invocationCallOrder[0]).toBeLessThan(navigateOrder)
    expect(testState.listCatalog.mock.invocationCallOrder[0]).toBeLessThan(navigateOrder)
    expect(testState.mutateCatalog.mock.invocationCallOrder[0]).toBeLessThan(navigateOrder)
    expect(testState.mutateConfig.mock.invocationCallOrder[0]).toBeLessThan(navigateOrder)
  })

  it('rebinds one pending detail uninstall across same-identity store and list surfaces', async () => {
    let requestSignal: AbortSignal | undefined
    let resolveUninstall: (() => void) | undefined
    testState.uninstall.mockImplementationOnce((
      _scope: string,
      _token: string,
      options: { signal?: AbortSignal }
    ) => {
      requestSignal = options.signal
      return new Promise((resolve) => {
        resolveUninstall = () =>
          resolve({
            identity: testState.plan.identity,
            removed: true
          })
      })
    })
    await renderRoute()
    await clickUninstall()
    let pending: Promise<void> | undefined
    await act(async () => {
      pending = Promise.resolve(getConfirmCallback('onOk')())
      await vi.waitFor(() => expect(testState.uninstall).toHaveBeenCalledTimes(1))
    })

    testState.routeParent = 'legacy'
    await renderRoute()
    const removalAction = container.querySelector<HTMLButtonElement>(
      '[data-action-key="marketplace-install-project"]'
    )
    if (removalAction == null) throw new Error('Expected rebound marketplace removal action')
    expect(requestSignal?.aborted).toBe(false)
    expect(removalAction.disabled).toBe(true)
    await act(async () => {
      removalAction.click()
    })
    expect(testState.confirm).toHaveBeenCalledTimes(1)
    expect(testState.getPlan).toHaveBeenCalledTimes(1)
    expect(testState.uninstall).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveUninstall?.()
      await pending
    })
    expect(testState.refreshPlugins).toHaveBeenCalledTimes(1)
    expect(testState.listCatalog).toHaveBeenCalledTimes(1)
    expect(testState.getConfig).toHaveBeenCalledTimes(1)
    expect(testState.messageSuccess).not.toHaveBeenCalled()
    expect(testState.messageError).not.toHaveBeenCalled()
    expect(testState.navigate).not.toHaveBeenCalledWith('/plugins/list')
  })

  it('completes feedback and navigation when authoritative refresh removes its marketplace identity', async () => {
    let resolveCatalog: (() => void) | undefined
    let resolveRefresh: (() => void) | undefined
    testState.refreshPlugins.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = () => resolve({ applied: true })
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

  it('keeps committed detail removal disabled and suppresses stale results after a newer install intent', async () => {
    let resolveCatalog: (() => void) | undefined
    let resolveConfig: (() => void) | undefined
    let resolveRuntime: (() => void) | undefined
    testState.listCatalog.mockReturnValue(
      new Promise((resolve) => {
        resolveCatalog = () => resolve(testState.catalog)
      })
    )
    testState.getConfig.mockReturnValue(
      new Promise((resolve) => {
        resolveConfig = () => resolve(testState.config)
      })
    )
    testState.refreshPlugins.mockReturnValue(
      new Promise((resolve) => {
        resolveRuntime = () => resolve({ applied: true })
      })
    )
    await renderRoute()
    await clickUninstall()
    let pending: Promise<void> | undefined
    await act(async () => {
      pending = Promise.resolve(getConfirmCallback('onOk')())
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })
    expect(testState.uninstall).toHaveBeenCalledTimes(1)
    expect(testState.refreshPlugins).toHaveBeenCalledTimes(1)

    testState.catalog = {
      ...testState.catalog,
      plugins: testState.catalog.plugins.map(item => ({ ...item, installedSources: [] }))
    }
    await renderRoute()
    const removalAction = container.querySelector<HTMLButtonElement>(
      '[data-action-key="marketplace-install-project"]'
    )
    expect(removalAction?.textContent).toBe('pluginStore.removeMarketplacePlugin')
    expect(removalAction?.disabled).toBe(true)
    removalAction?.click()
    expect(testState.syncSelection).not.toHaveBeenCalled()

    const serverKey = resolveMarketplaceServerKey(testState.serverBaseUrl)
    const newerIntent = claimMarketplaceSelectionIntentAuthority(serverKey, {
      marketplace: 'team',
      plugin: 'reviewer',
      target: 'project'
    })
    const newerSelection = publishMarketplaceSelectionAuthority(serverKey, {
      enabled: true,
      marketplace: 'team',
      plugin: 'reviewer',
      target: 'project'
    }, 'confirmed')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(newerIntent.isCurrent()).toBe(true)
    expect(newerSelection.isCurrent()).toBe(true)

    await act(async () => {
      resolveCatalog?.()
      resolveConfig?.()
      resolveRuntime?.()
      await pending
    })
    expect(testState.mutateCatalog).not.toHaveBeenCalled()
    expect(testState.mutateConfig).not.toHaveBeenCalled()
    expect(testState.messageSuccess).not.toHaveBeenCalled()
    expect(testState.messageError).not.toHaveBeenCalled()
    expect(testState.navigate).not.toHaveBeenCalled()
    const runtimeAuthority = testState.refreshPlugins.mock.calls[0]?.[0] as { isCurrent?: () => boolean } | undefined
    expect(runtimeAuthority?.isCurrent?.()).toBe(false)
    expect(listMarketplaceSelectionAuthorities(serverKey)).toEqual([newerSelection])
    newerIntent.release()
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

  it('reconciles a committed detail removal after a request timeout loses the response', async () => {
    testState.uninstall.mockImplementationOnce(async () => {
      testState.config = { sources: { project: { plugins: { marketplaces: {} } } } }
      testState.catalog = { plugins: [], sources: [] }
      throw new ApiError(408, {
        code: 'request_timeout',
        message: 'Request timed out.'
      })
    })
    await renderRoute()
    await clickUninstall()

    await act(async () => {
      await getConfirmCallback('onOk')()
    })

    expect(testState.uninstall).toHaveBeenCalledTimes(1)
    expect(testState.getConfig).toHaveBeenCalledTimes(1)
    expect(testState.listCatalog).toHaveBeenCalledTimes(1)
    expect(testState.refreshPlugins).toHaveBeenCalledTimes(1)
    expect(testState.mutateConfig).toHaveBeenCalledTimes(1)
    expect(testState.mutateCatalog).toHaveBeenCalledTimes(1)
    expect(testState.messageSuccess).toHaveBeenCalledWith('pluginStore.uninstall.success')
    expect(testState.messageError).not.toHaveBeenCalled()
    expect(testState.navigate).toHaveBeenCalledWith('/plugins/list')
  })

  it('keeps split detail roots indeterminate across a same-server scope handoff', async () => {
    vi.useFakeTimers()
    try {
      const installedCatalog = testState.catalog
      const removedConfig = { sources: { project: { plugins: { marketplaces: {} } } } }
      const removedCatalog = {
        ...testState.catalog,
        plugins: testState.catalog.plugins.map(item => ({ ...item, installedSources: [] }))
      }
      testState.uninstall.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      testState.getConfig
        .mockResolvedValueOnce(removedConfig)
        .mockResolvedValueOnce(removedConfig)
      testState.listCatalog
        .mockResolvedValueOnce(installedCatalog)
        .mockResolvedValueOnce(removedCatalog)
      await renderRoute()
      await clickUninstall()
      let pending: Promise<void> | undefined
      await act(async () => {
        pending = Promise.resolve(getConfirmCallback('onOk')())
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })

      expect(testState.messageInfo).toHaveBeenCalledWith(indeterminateCopy)
      expect(testState.messageSuccess).not.toHaveBeenCalled()
      expect(testState.messageError).not.toHaveBeenCalled()
      expect(testState.navigate).not.toHaveBeenCalled()
      expect(
        container.querySelector<HTMLButtonElement>(
          '[data-action-key="marketplace-install-project"]'
        )?.disabled
      ).toBe(true)
      const status = container.querySelector<HTMLElement>('[role="status"]')
      expect(status?.textContent).toBe(indeterminateCopy)
      expect(status?.getAttribute('aria-live')).toBe('polite')
      expect(status?.getAttribute('aria-atomic')).toBe('true')

      testState.currentScope = createMarketplacePluginRouteKey('team', 'other')
      await renderRoute()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250)
        await pending
      })
      expect(testState.getConfig).toHaveBeenCalledTimes(2)
      expect(testState.listCatalog).toHaveBeenCalledTimes(2)
      expect(testState.mutateConfig).toHaveBeenCalledTimes(2)
      expect(testState.mutateCatalog).toHaveBeenCalledTimes(2)
      expect(testState.messageSuccess).not.toHaveBeenCalled()
      expect(testState.messageError).not.toHaveBeenCalled()
      expect(testState.navigate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rebinds response-loss ownership across same-identity store and list surfaces', async () => {
    vi.useFakeTimers()
    try {
      const installedCatalog = testState.catalog
      const removedConfig = { sources: { project: { plugins: { marketplaces: {} } } } }
      const removedCatalog = {
        ...testState.catalog,
        plugins: testState.catalog.plugins.map(item => ({ ...item, installedSources: [] }))
      }
      testState.uninstall.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      testState.getConfig
        .mockResolvedValueOnce(removedConfig)
        .mockResolvedValueOnce(removedConfig)
      testState.listCatalog
        .mockResolvedValueOnce(installedCatalog)
        .mockResolvedValueOnce(removedCatalog)
      await renderRoute()
      await clickUninstall()
      let pending: Promise<void> | undefined
      await act(async () => {
        pending = Promise.resolve(getConfirmCallback('onOk')())
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })
      expect(testState.messageInfo).toHaveBeenCalledWith(indeterminateCopy)
      expect(testState.uninstall).toHaveBeenCalledTimes(1)

      testState.routeParent = 'legacy'
      await renderRoute()
      const removalAction = container.querySelector<HTMLButtonElement>(
        '[data-action-key="marketplace-install-project"]'
      )
      if (removalAction == null) throw new Error('Expected rebound marketplace removal action')
      expect(removalAction.disabled).toBe(true)
      expect(container.querySelector<HTMLElement>('[role="status"]')?.textContent).toBe(
        indeterminateCopy
      )
      await act(async () => {
        removalAction.click()
      })
      expect(testState.confirm).toHaveBeenCalledTimes(1)
      expect(testState.getPlan).toHaveBeenCalledTimes(1)
      expect(testState.uninstall).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250)
        await pending
      })
      expect(testState.getConfig).toHaveBeenCalledTimes(2)
      expect(testState.listCatalog).toHaveBeenCalledTimes(2)
      expect(testState.mutateConfig).toHaveBeenCalledTimes(2)
      expect(testState.mutateCatalog).toHaveBeenCalledTimes(2)
      expect(testState.messageInfo).toHaveBeenCalledTimes(1)
      expect(testState.messageSuccess).not.toHaveBeenCalled()
      expect(testState.messageError).not.toHaveBeenCalled()
      expect(testState.navigate).not.toHaveBeenCalledWith('/plugins/list')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps response-loss detail owned when a newer failed round supersedes runtime apply', async () => {
    vi.useFakeTimers()
    try {
      let resolveRuntime: (() => void) | undefined
      const removedConfig = { sources: { project: { plugins: { marketplaces: {} } } } }
      const removedCatalog = {
        ...testState.catalog,
        plugins: testState.catalog.plugins.map(item => ({ ...item, installedSources: [] }))
      }
      testState.uninstall.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      testState.getConfig.mockResolvedValueOnce(removedConfig)
      testState.listCatalog.mockResolvedValueOnce(removedCatalog)
      testState.refreshPlugins.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRuntime = () => resolve({ applied: true })
        })
      )
      await renderRoute()
      await clickUninstall()
      let pending: Promise<void> | undefined
      await act(async () => {
        pending = Promise.resolve(getConfirmCallback('onOk')())
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })
      expect(testState.mutateConfig).toHaveBeenCalledTimes(1)
      expect(testState.mutateCatalog).toHaveBeenCalledTimes(1)
      expect(testState.refreshPlugins).toHaveBeenCalledTimes(1)

      const newerAuthority = claimMarketplaceConvergenceAuthority(
        resolveMarketplaceServerKey(testState.serverBaseUrl)
      )
      await settleMarketplaceConvergence(newerAuthority, () => [
        Promise.reject(new Error('newer config failed')),
        Promise.reject(new Error('newer catalog failed')),
        Promise.reject(new Error('newer runtime failed'))
      ])
      await act(async () => {
        resolveRuntime?.()
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })

      expect(testState.messageInfo).toHaveBeenCalledTimes(1)
      expect(testState.messageSuccess).not.toHaveBeenCalled()
      expect(testState.messageError).not.toHaveBeenCalled()
      expect(testState.navigate).not.toHaveBeenCalled()
      expect(
        container.querySelector<HTMLButtonElement>(
          '[data-action-key="marketplace-install-project"]'
        )?.disabled
      ).toBe(true)

      await act(async () => {
        root?.unmount()
      })
      root = undefined
      await expect(pending).resolves.toBeUndefined()
      expect(testState.messageInfo).toHaveBeenCalledTimes(1)
      expect(testState.messageSuccess).not.toHaveBeenCalled()
      expect(testState.navigate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps response-loss detail owned when an ordinary provider refresh supersedes runtime apply', async () => {
    vi.useFakeTimers()
    try {
      let isMarketplaceRuntimeCurrent: (() => boolean) | undefined
      let resolveUninstallRuntime: (() => void) | undefined
      const removedConfig = { sources: { project: { plugins: { marketplaces: {} } } } }
      const removedCatalog = {
        ...testState.catalog,
        plugins: testState.catalog.plugins.map(item => ({ ...item, installedSources: [] }))
      }
      testState.uninstall.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      testState.getConfig.mockResolvedValueOnce(removedConfig)
      testState.listCatalog.mockResolvedValueOnce(removedCatalog)
      testState.refreshPlugins
        .mockImplementationOnce((options?: { isCurrent?: () => boolean }) => {
          isMarketplaceRuntimeCurrent = options?.isCurrent
          return new Promise((resolve) => {
            resolveUninstallRuntime = () => resolve({ applied: false })
          })
        })
        .mockResolvedValueOnce({ applied: true })

      await renderRoute()
      await clickUninstall()
      let pending: Promise<void> | undefined
      await act(async () => {
        pending = Promise.resolve(getConfirmCallback('onOk')())
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })
      expect(isMarketplaceRuntimeCurrent?.()).toBe(true)

      await act(async () => {
        await expect(testState.refreshPlugins()).resolves.toEqual({ applied: true })
        expect(isMarketplaceRuntimeCurrent?.()).toBe(true)
        resolveUninstallRuntime?.()
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })

      const status = container.querySelector<HTMLElement>('[role="status"]')
      expect(status?.textContent).toBe(indeterminateCopy)
      expect(status?.getAttribute('aria-live')).toBe('polite')
      expect(status?.getAttribute('aria-atomic')).toBe('true')
      expect(testState.messageInfo).toHaveBeenCalledTimes(1)
      expect(testState.messageSuccess).not.toHaveBeenCalled()
      expect(testState.messageError).not.toHaveBeenCalled()
      expect(testState.navigate).not.toHaveBeenCalled()
      expect(
        container.querySelector<HTMLButtonElement>(
          '[data-action-key="marketplace-install-project"]'
        )?.disabled
      ).toBe(true)

      await act(async () => {
        root?.unmount()
      })
      root = undefined
      await expect(pending).resolves.toBeUndefined()
      expect(testState.messageSuccess).not.toHaveBeenCalled()
      expect(testState.navigate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops active response-loss reconciliation on unmount without terminal feedback', async () => {
    vi.useFakeTimers()
    try {
      let requestSignal: AbortSignal | undefined
      testState.uninstall.mockImplementationOnce((
        _scope: string,
        _token: string,
        options: { signal?: AbortSignal }
      ) => {
        requestSignal = options.signal
        return Promise.reject(new TypeError('Failed to fetch'))
      })
      testState.listCatalog.mockResolvedValueOnce(testState.catalog)
      testState.getConfig.mockResolvedValueOnce(testState.config)
      await renderRoute()
      await clickUninstall()
      let pending: Promise<void> | undefined
      await act(async () => {
        pending = Promise.resolve(getConfirmCallback('onOk')())
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })
      expect(testState.messageInfo).toHaveBeenCalledWith(indeterminateCopy)
      expect(testState.getConfig).toHaveBeenCalledTimes(1)
      expect(testState.listCatalog).toHaveBeenCalledTimes(1)

      await act(async () => {
        root?.unmount()
      })
      root = undefined
      await expect(pending).resolves.toBeUndefined()
      expect(requestSignal?.aborted).toBe(true)
      expect(testState.getConfig).toHaveBeenCalledTimes(1)
      expect(testState.listCatalog).toHaveBeenCalledTimes(1)
      expect(testState.messageSuccess).not.toHaveBeenCalled()
      expect(testState.messageError).not.toHaveBeenCalled()
      expect(testState.navigate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
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

  it('never revives old convergence after the same detail tuple moves A to B to A', async () => {
    let resolveCatalog: (() => void) | undefined
    let resolveConfig: (() => void) | undefined
    let resolveRuntime: (() => void) | undefined
    let requestSignal: AbortSignal | undefined
    testState.uninstall.mockImplementation((
      _scope: string,
      _token: string,
      options: { signal?: AbortSignal }
    ) => {
      requestSignal = options.signal
      return Promise.resolve({ identity: testState.plan.identity, removed: true })
    })
    testState.listCatalog.mockReturnValue(
      new Promise((resolve) => {
        resolveCatalog = () => resolve({ plugins: [], sources: [] })
      })
    )
    testState.getConfig.mockReturnValue(
      new Promise((resolve) => {
        resolveConfig = () => resolve(testState.config)
      })
    )
    testState.refreshPlugins.mockReturnValue(
      new Promise((resolve) => {
        resolveRuntime = () => resolve({ applied: true })
      })
    )
    await renderRoute()
    await clickUninstall()
    let pending: Promise<void> | undefined
    await act(async () => {
      pending = Promise.resolve(getConfirmCallback('onOk')())
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(testState.refreshPlugins).toHaveBeenCalledTimes(1)
    expect(testState.listCatalog).toHaveBeenCalledTimes(1)
    expect(testState.getConfig).toHaveBeenCalledTimes(1)

    testState.serverBaseUrl = 'https://other-workspace.example/'
    await renderRoute()
    expect(requestSignal?.aborted).toBe(true)
    const runtimeAuthority = testState.refreshPlugins.mock.calls[0]?.[0] as {
      isCurrent?: () => boolean
    }
    expect(runtimeAuthority.isCurrent?.()).toBe(false)
    testState.serverBaseUrl = 'https://workspace.example'
    await renderRoute()
    expect(runtimeAuthority.isCurrent?.()).toBe(false)
    await act(async () => {
      resolveCatalog?.()
      resolveConfig?.()
      resolveRuntime?.()
      await pending
    })

    expect(testState.mutateCatalog).not.toHaveBeenCalled()
    expect(testState.mutateConfig).not.toHaveBeenCalled()
    expect(testState.messageSuccess).not.toHaveBeenCalled()
    expect(testState.messageError).not.toHaveBeenCalled()
    expect(testState.navigate).not.toHaveBeenCalled()
  })

  it('continues server convergence without old-view writes after a same-server scope handoff', async () => {
    let resolveCatalog: (() => void) | undefined
    let resolveConfig: (() => void) | undefined
    let resolveRuntime: (() => void) | undefined
    testState.listCatalog.mockReturnValue(
      new Promise((resolve) => {
        resolveCatalog = () => resolve({ plugins: [], sources: [] })
      })
    )
    testState.getConfig.mockReturnValue(
      new Promise((resolve) => {
        resolveConfig = () => resolve(testState.config)
      })
    )
    testState.refreshPlugins.mockReturnValue(
      new Promise((resolve) => {
        resolveRuntime = () => resolve({ applied: true })
      })
    )
    await renderRoute()
    await clickUninstall()
    let pending: Promise<void> | undefined
    await act(async () => {
      pending = Promise.resolve(getConfirmCallback('onOk')())
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(testState.refreshPlugins).toHaveBeenCalledTimes(1)
    expect(testState.listCatalog).toHaveBeenCalledTimes(1)
    expect(testState.getConfig).toHaveBeenCalledTimes(1)

    testState.currentScope = createMarketplacePluginRouteKey('team', 'other')
    await renderRoute()
    const runtimeAuthority = testState.refreshPlugins.mock.calls[0]?.[0] as {
      isCurrent?: () => boolean
    }
    expect(runtimeAuthority.isCurrent?.()).toBe(true)
    await act(async () => {
      resolveCatalog?.()
      resolveConfig?.()
      resolveRuntime?.()
      await pending
    })

    expect(testState.mutateCatalog).toHaveBeenCalledTimes(1)
    expect(testState.mutateConfig).toHaveBeenCalledTimes(1)
    expect(testState.messageSuccess).not.toHaveBeenCalled()
    expect(testState.messageError).not.toHaveBeenCalled()
    expect(testState.navigate).not.toHaveBeenCalled()
  })

  it('continues response-loss reconciliation without old-view writes after a same-server scope handoff', async () => {
    let rejectResponseLoss: (() => void) | undefined
    let resolveCatalog: (() => void) | undefined
    let resolveConfig: (() => void) | undefined
    let resolveRuntime: (() => void) | undefined
    let requestSignal: AbortSignal | undefined
    testState.uninstall.mockImplementationOnce((
      _scope: string,
      _token: string,
      options: { signal?: AbortSignal }
    ) =>
      new Promise((_resolve, reject) => {
        requestSignal = options.signal
        const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'))
        options.signal?.addEventListener('abort', rejectAbort, { once: true })
        rejectResponseLoss = () => {
          options.signal?.removeEventListener('abort', rejectAbort)
          reject(new TypeError('Failed to fetch'))
        }
      })
    )
    testState.listCatalog.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCatalog = () => resolve({ plugins: [], sources: [] })
      })
    )
    testState.getConfig.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveConfig = () => resolve({ sources: { project: { plugins: { marketplaces: {} } } } })
      })
    )
    testState.refreshPlugins.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRuntime = () => resolve({ applied: true })
      })
    )
    await renderRoute()
    await clickUninstall()
    let pending: Promise<void> | undefined
    await act(async () => {
      pending = Promise.resolve(getConfirmCallback('onOk')())
      await vi.waitFor(() => expect(testState.uninstall).toHaveBeenCalledTimes(1))
    })
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-action-key="marketplace-install-project"]'
      )?.disabled
    ).toBe(true)

    testState.currentScope = createMarketplacePluginRouteKey('team', 'other')
    await renderRoute()
    expect(requestSignal?.aborted).toBe(false)
    await act(async () => {
      rejectResponseLoss?.()
      await vi.waitFor(() => expect(testState.refreshPlugins).toHaveBeenCalledTimes(1))
    })
    const runtimeAuthority = testState.refreshPlugins.mock.calls[0]?.[0] as {
      isCurrent?: () => boolean
    }
    expect(runtimeAuthority.isCurrent?.()).toBe(true)
    await act(async () => {
      resolveCatalog?.()
      resolveConfig?.()
      resolveRuntime?.()
      await pending
    })

    expect(testState.mutateCatalog).toHaveBeenCalledTimes(1)
    expect(testState.mutateConfig).toHaveBeenCalledTimes(1)
    expect(testState.messageSuccess).not.toHaveBeenCalled()
    expect(testState.messageError).not.toHaveBeenCalled()
    expect(testState.navigate).not.toHaveBeenCalled()
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
    expect(testState.refreshPlugins).not.toHaveBeenCalled()
    expect(testState.listCatalog).not.toHaveBeenCalled()
    expect(testState.getConfig).not.toHaveBeenCalled()
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
