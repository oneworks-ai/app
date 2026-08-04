// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PluginContextValue } from '#~/plugins/plugin-context'

import { PluginStoreRoute } from '../src/routes/PluginStoreRoute'

const marketplaceScope = 'market:5b226f70656e61692d706c7567696e73222c226169727461626c65225d'

const mocks = vi.hoisted(() => ({
  catalogMutate: vi.fn(),
  marketplaceCatalog: undefined as { plugins: Array<Record<string, unknown>> } | undefined,
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  refreshPlugins: vi.fn(),
  syncPluginMarketplaceSelection: vi.fn()
}))

vi.mock('antd', () => ({
  App: { useApp: () => ({ message: { error: mocks.messageError, success: mocks.messageSuccess } }) },
  Empty: Object.assign(() => <div>Not found</div>, { PRESENTED_IMAGE_SIMPLE: null }),
  Spin: () => <div>Loading marketplace</div>
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { init: () => {}, type: '3rdParty' },
  useTranslation: () => ({
    i18n: { language: 'en', resolvedLanguage: 'en' },
    t: (key: string) => key
  })
}))

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: `/plugins/store/${marketplaceScope}`, search: '' }),
  useNavigate: () => vi.fn(),
  useParams: () => ({ scope: marketplaceScope })
}))

vi.mock('#~/api.js', () => ({ getApiErrorMessage: () => 'request failed' }))

vi.mock('swr', () => ({
  default: (key: unknown) => (
    Array.isArray(key) && key[0] === '/api/plugins/marketplace/catalog'
      ? {
        data: mocks.marketplaceCatalog,
        isLoading: mocks.marketplaceCatalog == null,
        mutate: mocks.catalogMutate
      }
      : { data: undefined, isLoading: false, mutate: vi.fn() }
  )
}))

vi.mock('#~/components/icons/MaterialSymbol', () => ({
  MaterialSymbol: () => <span />
}))

vi.mock('#~/components/layout/RouteContainerHeader', () => ({
  RouteContainerHeader: ({
    actionItems
  }: {
    actionItems: Array<{ disabled?: boolean; key: string; label: string; loading?: boolean; onSelect: () => void }>
  }) => (
    <header>
      {actionItems.map(item => (
        <button
          disabled={item.disabled}
          key={item.key}
          type='button'
          onClick={item.onSelect}
        >
          {item.label}
          {item.loading === true ? ' loading' : ''}
        </button>
      ))}
    </header>
  )
}))

vi.mock('#~/components/layout/RouteContainerLayout', () => ({
  RouteContainerLayout: ({ children, header }: { children: ReactNode; header: ReactNode }) => <>{header}{children}</>
}))

vi.mock('#~/components/layout/route-sidebar-context', () => ({
  useRouteSidebar: () => ({
    clearRouteSidebar: vi.fn(),
    hasRouteSidebarProvider: false,
    setRouteSidebar: vi.fn()
  })
}))

vi.mock('#~/components/layout/use-route-container-sidebar-opener', () => ({
  useRouteContainerSidebarOpener: () => ({ openRouteSidebar: vi.fn() })
}))

vi.mock('#~/components/plugins/MarketplacePluginDetailPanel', () => ({
  MarketplacePluginDetailPanel: () => <div>Catalog detail</div>
}))

vi.mock('#~/components/plugins/NativePluginDetailPanel', () => ({
  NativePluginDetailPanel: () => <div>Native detail</div>
}))

vi.mock('#~/components/plugins/PluginCreateLanding', () => ({
  PluginCreateLanding: () => <div>Create plugin</div>
}))

vi.mock('#~/components/plugins/PluginDetailPanel', () => ({
  PluginDetailPanel: (
    { plugin }: { plugin: { manifest?: { native?: { apps?: Array<{ capabilities?: string[] }> } } } }
  ) => (
    <div>
      Installed runtime detail
      {plugin.manifest?.native?.apps?.[0]?.capabilities?.join(', ')}
    </div>
  )
}))

vi.mock('#~/components/plugins/PluginDiagnostics', () => ({
  PluginDiagnostics: () => <div>Diagnostics</div>
}))

vi.mock('#~/components/plugins/PluginHomeView', () => ({
  PluginHomeView: () => <div>Plugin home</div>
}))

vi.mock('#~/components/plugins/PluginMarketplaceLanding', () => ({
  isMarketplacePluginInstallable: () => true,
  isPluginInstalledForTarget: () => false,
  PluginMarketplaceLanding: () => <div>Marketplace</div>
}))

vi.mock('#~/components/plugins/PluginRuntimeListView', () => ({
  PluginRuntimeListView: () => <div>Runtime list</div>
}))

vi.mock('#~/components/plugins/PluginStoreSidebarControls', () => ({
  buildPluginRouteSidebarGroups: () => [],
  PluginGroupModeControls: () => <span />,
  resolvePluginSourceGroup: () => 'project'
}))

vi.mock('#~/components/plugins/plugin-runtime-list-items', () => ({
  buildPluginListItems: () => [],
  createNativePluginRouteKey: () => 'native'
}))

vi.mock('#~/plugins/api', () => ({
  listNativeHostPlugins: vi.fn(),
  setPluginEnabled: vi.fn(),
  setPluginWatch: vi.fn()
}))

vi.mock('#~/plugins/marketplace-api', () => ({
  listPluginMarketplaceCatalog: vi.fn(),
  resolvePluginMarketplaceVersions: vi.fn(),
  syncPluginMarketplaceSelection: mocks.syncPluginMarketplaceSelection
}))

vi.mock('#~/plugins/plugin-context', () => ({
  usePluginContext: () => ({
    pluginServerBaseUrl: undefined,
    refreshPlugins: mocks.refreshPlugins,
    reloadPlugin: vi.fn(),
    snapshot: {
      diagnostics: [],
      instances: [{
        enabled: true,
        manifest: {
          native: {
            adapter: 'codex',
            apps: [{ capabilities: ['tables:read'], id: 'airtable' }]
          }
        },
        requestId: 'airtable',
        scope: 'installed-airtable',
        source: {
          adapter: 'codex',
          kind: 'marketplace',
          marketplace: 'openai-plugins',
          plugin: 'airtable'
        }
      }]
    } as unknown as PluginContextValue['snapshot']
  } satisfies Partial<PluginContextValue>)
}))

vi.mock('#~/plugins/route-plugin-chrome', () => ({
  useRoutePluginChrome: () => ({ headerActions: [], sidebarContextMenuItems: [] })
}))

vi.mock('#~/utils/copy', () => ({ copyTextWithFeedback: vi.fn() }))

describe('pluginStoreRoute', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(() => {
    mocks.catalogMutate.mockReset()
    mocks.marketplaceCatalog = undefined
    mocks.messageError.mockReset()
    mocks.messageSuccess.mockReset()
    mocks.refreshPlugins.mockReset()
    mocks.syncPluginMarketplaceSelection.mockReset()
    act(() => root?.unmount())
    container?.remove()
    container = undefined
    root = undefined
  })

  it('shows matching installed runtime metadata while the marketplace catalog is loading', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<PluginStoreRoute />)
    })

    expect(container.textContent).toContain('Installed runtime detail')
    expect(container.textContent).toContain('tables:read')
    expect(container.textContent).not.toContain('Loading marketplace')
    expect(container.textContent).not.toContain('Not found')
  })

  it('keeps each marketplace action authoritative while catalog revalidation is stalled', async () => {
    mocks.marketplaceCatalog = {
      plugins: [{
        declared: false,
        enabled: false,
        installable: true,
        marketplace: 'openai-plugins',
        marketplaceEnabled: true,
        marketplaceType: 'codex',
        name: 'airtable',
        sourceLabel: './plugins/airtable',
        sourceType: 'path'
      }]
    }
    mocks.syncPluginMarketplaceSelection.mockResolvedValue({ results: [] })
    mocks.refreshPlugins.mockResolvedValue(undefined)
    mocks.catalogMutate.mockReturnValue(new Promise(() => {}))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<PluginStoreRoute />)
    })

    const projectButton = [...container.querySelectorAll('button')].find(button => (
      button.textContent === 'pluginStore.installMarketplacePluginProject'
    ))
    expect(projectButton).toBeDefined()

    await act(async () => {
      projectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.syncPluginMarketplaceSelection).toHaveBeenCalledWith(
      'openai-plugins',
      'airtable',
      true,
      'project',
      { serverBaseUrl: undefined }
    )
    expect(mocks.catalogMutate).toHaveBeenCalledOnce()
    expect(mocks.messageSuccess).toHaveBeenCalledWith('pluginStore.marketplacePluginInstalledProject')
    expect(projectButton?.textContent).toBe('pluginStore.removeMarketplacePlugin')

    await act(async () => {
      projectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.syncPluginMarketplaceSelection).toHaveBeenLastCalledWith(
      'openai-plugins',
      'airtable',
      false,
      'project',
      { serverBaseUrl: undefined }
    )
    expect(mocks.catalogMutate).toHaveBeenCalledTimes(2)
    expect(projectButton?.textContent).toBe('pluginStore.installMarketplacePluginProject')
  })

  it('keeps the committed selection when runtime refresh fails', async () => {
    mocks.marketplaceCatalog = {
      plugins: [{
        declared: false,
        enabled: false,
        installable: true,
        marketplace: 'openai-plugins',
        marketplaceEnabled: true,
        marketplaceType: 'codex',
        name: 'airtable',
        sourceLabel: './plugins/airtable',
        sourceType: 'path'
      }]
    }
    mocks.syncPluginMarketplaceSelection.mockResolvedValue({ results: [] })
    mocks.refreshPlugins.mockRejectedValue(new Error('transient snapshot failure'))
    mocks.catalogMutate.mockResolvedValue(undefined)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<PluginStoreRoute />)
    })

    const projectButton = [...container.querySelectorAll('button')].find(button => (
      button.textContent === 'pluginStore.installMarketplacePluginProject'
    ))
    expect(projectButton).toBeDefined()

    await act(async () => {
      projectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.catalogMutate).toHaveBeenCalledOnce()
    expect(mocks.messageError).not.toHaveBeenCalled()
    expect(mocks.messageSuccess).toHaveBeenCalledWith('pluginStore.marketplacePluginInstalledProject')
    expect(projectButton?.textContent).toBe('pluginStore.removeMarketplacePlugin')
  })
})
