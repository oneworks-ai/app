// @vitest-environment happy-dom
/* eslint-disable max-lines -- detail action tests cover lifecycle races in one mounted route fixture. */
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '#~/api/base'
import { PluginStoreRoute } from '#~/routes/PluginStoreRoute'

const testState = vi.hoisted(() => ({
  clearRouteSidebar: vi.fn(),
  confirm: vi.fn(),
  confirmConfig: undefined as Record<string, unknown> | undefined,
  currentScope: 'review',
  destroyModal: vi.fn(),
  globalMutate: vi.fn(),
  instances: [{
    enabled: true,
    name: 'reviewer',
    requestId: '/managed/reviewer',
    scope: 'review',
    sourceGroup: 'project',
    watch: { enabled: false }
  }],
  listCatalog: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  mutatePlan: vi.fn(),
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
  setRouteSidebar: vi.fn(),
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

vi.mock('react-i18next', () => ({
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
    pathname: `/plugins/list/${encodeURIComponent(testState.currentScope)}`,
    search: ''
  }),
  useNavigate: () => testState.navigate,
  useParams: () => ({ scope: testState.currentScope })
}))

vi.mock('swr', () => ({
  default: (key: readonly unknown[] | null) => ({
    data: Array.isArray(key) && key[0] === '/api/plugins/uninstall-plan'
      ? testState.plan
      : Array.isArray(key) && key[0] === '/api/plugins/native'
      ? { plugins: [] }
      : undefined,
    isLoading: false,
    mutate: Array.isArray(key) && key[0] === '/api/plugins/uninstall-plan'
      ? testState.mutatePlan
      : vi.fn()
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
  }) => (
    <div>
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
vi.mock('#~/components/plugins/PluginMarketplaceLanding', () => ({
  PluginMarketplaceLanding: () => null,
  isMarketplacePluginInstallable: () => true,
  isPluginInstalledForTarget: () => false
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
  getPluginMarketplaceUninstallPlan: vi.fn(),
  listPluginMarketplaceCatalog: testState.listCatalog,
  resolvePluginMarketplaceVersions: vi.fn(),
  syncPluginMarketplaceSelection: vi.fn(),
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

vi.mock('#~/plugins/plugin-presentation', () => ({
  getPluginPresentationSearchText: () => 'reviewer',
  resolvePluginDisplayName: () => 'Reviewer',
  resolvePluginPresentationIcon: () => 'extension'
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
  const button = container.querySelector<HTMLButtonElement>('[data-action-key="plugin-uninstall"]')
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
    testState.currentScope = 'review'
    testState.instances = [{
      enabled: true,
      name: 'reviewer',
      requestId: '/managed/reviewer',
      scope: 'review',
      sourceGroup: 'project',
      watch: { enabled: false }
    }]
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
    testState.refreshPlugins.mockResolvedValue(undefined)
    testState.listCatalog.mockResolvedValue({ plugins: [], sources: [] })
    testState.globalMutate.mockResolvedValue(undefined)
    testState.mutatePlan.mockResolvedValue(testState.plan)
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

  it('hides uninstall for a server-authoritative unavailable reason', async () => {
    testState.plan = {
      available: false,
      reason: 'local-plugin'
    }
    await renderRoute()

    expect(container.querySelector('[data-action-key="plugin-uninstall"]')).toBeNull()
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
    expect(testState.uninstall).not.toHaveBeenCalled()
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

  it('keeps a failed confirmation retryable and succeeds on the next confirm', async () => {
    testState.uninstall
      .mockRejectedValueOnce(new Error('cleanup failed'))
      .mockResolvedValueOnce({
        identity: testState.plan.identity,
        removed: true
      })
    await renderRoute()
    await clickUninstall()
    const onOk = getConfirmCallback('onOk')

    await expect(act(async () => {
      await onOk()
    })).rejects.toThrow('cleanup failed')
    expect(testState.messageError).toHaveBeenCalledWith('cleanup failed')
    expect(testState.navigate).not.toHaveBeenCalled()

    await act(async () => {
      await onOk()
    })
    expect(testState.uninstall).toHaveBeenCalledTimes(2)
    expect(testState.navigate).toHaveBeenCalledWith('/plugins/list')
  })

  it('refreshes a stale plan and requires a fresh confirmation before retrying', async () => {
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

    expect(testState.mutatePlan).toHaveBeenCalledTimes(2)
    expect(testState.destroyModal).toHaveBeenCalled()
    expect(testState.messageError).toHaveBeenCalledWith('pluginStore.uninstall.stale')
    expect(testState.navigate).not.toHaveBeenCalled()
  })

  it('suppresses a stale cached plan when its authoritative refresh fails', async () => {
    testState.uninstall.mockRejectedValueOnce(
      new ApiError(409, {
        code: 'plugin_uninstall_plan_stale',
        message: 'stale'
      })
    )
    testState.mutatePlan
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('plan refresh failed'))
    await renderRoute()
    await clickUninstall()

    await act(async () => {
      await getConfirmCallback('onOk')()
    })

    expect(testState.mutatePlan).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-action-key="plugin-uninstall"]')).toBeNull()
    expect(testState.messageError).toHaveBeenCalledWith('pluginStore.uninstall.stale')
  })

  it('restores the action when a later authoritative SWR plan update succeeds', async () => {
    testState.uninstall.mockRejectedValueOnce(
      new ApiError(409, { code: 'plugin_uninstall_plan_stale', message: 'stale' })
    )
    testState.mutatePlan
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('plan refresh failed'))
    await renderRoute()
    await clickUninstall()
    await act(async () => {
      await getConfirmCallback('onOk')()
    })
    expect(container.querySelector('[data-action-key="plugin-uninstall"]')).toBeNull()

    testState.plan = { ...testState.plan, token: 'c'.repeat(64) }
    await renderRoute()
    expect(container.querySelector('[data-action-key="plugin-uninstall"]')).not.toBeNull()
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
    const first = Promise.resolve(getConfirmCallback('onOk')())

    testState.currentScope = 'other'
    testState.instances = [
      ...testState.instances,
      {
        enabled: true,
        name: 'other',
        requestId: '/managed/other',
        scope: 'other',
        sourceGroup: 'project',
        watch: { enabled: false }
      }
    ]
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
    const second = Promise.resolve(secondOnOk())
    await act(async () => {
      await secondOnOk()
    })
    expect(testState.uninstall).toHaveBeenCalledTimes(2)

    resolveFirst?.()
    await first
    await act(async () => {
      await secondOnOk()
    })
    expect(testState.uninstall).toHaveBeenCalledTimes(2)

    resolveSecond?.()
    await second
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
    const pending = Promise.resolve(getConfirmCallback('onOk')())

    await act(async () => {
      root?.unmount()
    })
    root = undefined
    await expect(pending).resolves.toBeUndefined()
    expect(requestSignal?.aborted).toBe(true)
    expect(testState.messageError).not.toHaveBeenCalled()
    expect(testState.navigate).not.toHaveBeenCalled()
  })
})
