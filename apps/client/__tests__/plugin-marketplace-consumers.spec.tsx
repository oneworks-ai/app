// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PluginMarketplaceCatalogPlugin, PluginMarketplaceCatalogResponse } from '@oneworks/types'

import { PluginMarketplaceLanding } from '#~/components/plugins/PluginMarketplaceLanding'
import type { MarketplacePluginSelectionController } from '#~/hooks/marketplace-plugin-selection'
import { PluginStoreRoute } from '#~/routes/PluginStoreRoute'
import { createMarketplacePluginRouteKey } from '#~/routes/plugin-routes'

const testState = vi.hoisted(() => ({
  catalog: undefined as PluginMarketplaceCatalogResponse | undefined,
  catalogMutate: vi.fn(),
  clearRouteSidebar: vi.fn(),
  getSelectionState: vi.fn(),
  location: { pathname: '/plugins/store', search: '' },
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  navigate: vi.fn(),
  params: { scope: '' },
  setRouteSidebar: vi.fn(),
  toggleSelection: vi.fn()
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
        }
      })
    }
  }
})
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en', resolvedLanguage: 'en' },
    t: (key: string) => key
  })
}))
vi.mock('react-router-dom', () => ({
  useLocation: () => testState.location,
  useNavigate: () => testState.navigate,
  useParams: () => testState.params
}))
vi.mock('swr', () => ({
  default: (key: unknown) => {
    if (key === '/api/config') {
      return { data: {}, mutate: vi.fn() }
    }
    if (Array.isArray(key) && key[0] === '/api/plugins/native') {
      return { data: { plugins: [] }, isLoading: false, mutate: vi.fn() }
    }
    if (Array.isArray(key) && key[0] === '/api/plugins/marketplace/catalog') {
      return {
        data: testState.catalog,
        isLoading: false,
        mutate: testState.catalogMutate
      }
    }
    return { data: undefined, isLoading: false, mutate: vi.fn() }
  }
}))

vi.mock('#~/components/action-search-toolbar/ActionSearchToolbar', () => ({
  ActionSearchToolbar: () => null
}))
vi.mock('#~/components/icons/MaterialSymbol', () => ({
  MaterialSymbol: ({ name }: { name: string }) => <span data-symbol={name} />
}))
vi.mock('#~/components/layout/RouteContainerHeader', () => ({
  RouteContainerHeader: ({
    actionItems
  }: {
    actionItems: Array<{
      disabled?: boolean
      key: string
      loading?: boolean
      onSelect: () => void
    }>
  }) => (
    <div data-testid='route-header-actions'>
      {actionItems.map(item => (
        <button
          key={item.key}
          type='button'
          data-action-key={item.key}
          data-loading={String(item.loading === true)}
          disabled={item.disabled}
          onClick={item.onSelect}
        />
      ))}
    </div>
  )
}))
vi.mock('#~/components/layout/RouteContainerLayout', () => ({
  RouteContainerLayout: ({
    children,
    header
  }: {
    children: React.ReactNode
    header: React.ReactNode
  }) => <>{header}{children}</>
}))
vi.mock('#~/components/layout/route-sidebar-context', () => ({
  useRouteSidebar: () => ({
    clearRouteSidebar: testState.clearRouteSidebar,
    hasRouteSidebarProvider: true,
    setRouteSidebar: testState.setRouteSidebar
  })
}))
vi.mock('#~/components/layout/use-route-container-sidebar-opener', () => ({
  useRouteContainerSidebarOpener: () => ({ openRouteSidebar: vi.fn() })
}))
vi.mock('#~/components/marketplace/MarketplaceCard', () => ({
  MarketplaceCapabilityTags: () => null,
  MarketplaceCard: ({
    actions,
    title
  }: {
    actions: React.ReactNode
    title: React.ReactNode
  }) =>
    <article>
      <h2>{title}</h2>
      {actions}
    </article>
}))
vi.mock('#~/components/marketplace/MarketplaceResults', () => ({
  MarketplaceResults: ({
    items,
    renderItem
  }: {
    items: PluginMarketplaceCatalogPlugin[]
    renderItem: (item: PluginMarketplaceCatalogPlugin) => React.ReactNode
  }) => <div>{items.map(item => <div key={item.name}>{renderItem(item)}</div>)}</div>
}))
vi.mock('#~/components/mobile-aware-select/MobileAwareSelect', () => ({
  MobileAwareSelect: () => null
}))
vi.mock('#~/components/plugins/MarketplacePluginDetailPanel', () => ({
  MarketplacePluginDetailPanel: ({ plugin }: { plugin: PluginMarketplaceCatalogPlugin }) => (
    <div data-testid='marketplace-detail'>{plugin.name}</div>
  )
}))
vi.mock('#~/components/plugins/NativePluginDetailPanel', () => ({
  NativePluginDetailPanel: () => null
}))
vi.mock('#~/components/plugins/PluginCreateLanding', () => ({ PluginCreateLanding: () => null }))
vi.mock('#~/components/plugins/PluginDetailPanel', () => ({ PluginDetailPanel: () => null }))
vi.mock('#~/components/plugins/PluginDiagnostics', () => ({ PluginDiagnostics: () => null }))
vi.mock('#~/components/plugins/PluginHomeView', () => ({ PluginHomeView: () => null }))
vi.mock('#~/components/plugins/PluginRuntimeListView', () => ({ PluginRuntimeListView: () => null }))
vi.mock('#~/components/plugins/PluginStoreSidebarControls', () => ({
  PluginGroupModeControls: () => null,
  buildPluginRouteSidebarGroups: () => [],
  resolvePluginSourceGroup: () => 'other'
}))
vi.mock('#~/hooks/use-marketplace-plugin-selection', () => ({
  useMarketplacePluginSelection: () => ({
    getState: testState.getSelectionState,
    toggle: testState.toggleSelection
  })
}))
vi.mock('#~/plugins/plugin-context', async (importOriginal) => ({
  ...await importOriginal<typeof import('#~/plugins/plugin-context')>(),
  usePluginContext: () => ({
    pluginServerBaseUrl: 'https://workspace-a.example',
    refreshPlugins: vi.fn(),
    reloadPlugin: vi.fn(),
    snapshot: {
      diagnostics: [],
      instances: []
    }
  })
}))
vi.mock('#~/plugins/route-plugin-chrome', () => ({
  useRoutePluginChrome: () => ({
    headerActions: [],
    sidebarContextMenuItems: []
  })
}))
vi.mock('#~/utils/model-provider-icons', () => ({
  renderIconRef: () => <span data-testid='plugin-icon' />
}))

const plugin: PluginMarketplaceCatalogPlugin = {
  declared: false,
  enabled: false,
  marketplace: 'team-tools',
  marketplaceEnabled: true,
  marketplaceType: 'codex',
  name: 'review',
  sourceLabel: 'team/review',
  sourceType: 'github'
}

let container: HTMLDivElement
let root: Root

const render = async (node: React.ReactNode) => {
  await act(async () => root.render(node))
}

describe('plugin marketplace production consumers', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    testState.catalog = {
      plugins: [plugin],
      sources: [],
      versionGeneration: 'generation-1'
    }
    testState.catalogMutate.mockReset()
    testState.clearRouteSidebar.mockReset()
    testState.getSelectionState.mockReset()
    testState.getSelectionState.mockReturnValue({ installed: false, pending: false })
    testState.location.pathname = '/plugins/store'
    testState.location.search = ''
    testState.messageError.mockReset()
    testState.messageSuccess.mockReset()
    testState.navigate.mockReset()
    testState.params.scope = ''
    testState.setRouteSidebar.mockReset()
    testState.toggleSelection.mockReset()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('wires the landing card actions to the shared selection controller', async () => {
    const controller: MarketplacePluginSelectionController = {
      getState: testState.getSelectionState,
      toggle: testState.toggleSelection
    }
    await render(
      <PluginMarketplaceLanding
        marketplaceSelection={controller}
        query=''
        onOpenPlugin={vi.fn()}
        onQueryChange={vi.fn()}
      />
    )

    const projectAction = container.querySelector<HTMLButtonElement>(
      'button[aria-label="pluginStore.installMarketplacePluginProject"]'
    )
    expect(projectAction).not.toBeNull()
    await act(async () => projectAction?.click())

    expect(testState.getSelectionState).toHaveBeenCalledWith(plugin, 'project')
    expect(testState.getSelectionState).toHaveBeenCalledWith(plugin, 'global')
    expect(testState.toggleSelection).toHaveBeenCalledWith(plugin, 'project')
  })

  it('wires the marketplace detail header to the same selection controller state and action', async () => {
    const routeKey = createMarketplacePluginRouteKey(plugin.marketplace, plugin.name)
    testState.params.scope = routeKey
    testState.location.pathname = `/plugins/store/${encodeURIComponent(routeKey)}`
    testState.getSelectionState.mockImplementation(
      (_plugin: PluginMarketplaceCatalogPlugin, target: 'global' | 'project') => ({
        installed: target === 'project',
        pending: target === 'project'
      })
    )
    await render(<PluginStoreRoute />)

    const projectAction = container.querySelector<HTMLButtonElement>(
      'button[data-action-key="marketplace-install-project"]'
    )
    const globalAction = container.querySelector<HTMLButtonElement>(
      'button[data-action-key="marketplace-install-global"]'
    )
    expect(container.querySelector('[data-testid="marketplace-detail"]')?.textContent).toBe(plugin.name)
    expect(projectAction?.dataset.loading).toBe('true')
    expect(projectAction?.disabled).toBe(false)
    expect(globalAction?.disabled).toBe(true)
    await act(async () => projectAction?.click())
    expect(testState.toggleSelection).toHaveBeenCalledWith(plugin, 'project')
  })
})
