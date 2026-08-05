// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PluginContextValue } from '#~/plugins/plugin-context'

import { PluginStoreRoute } from '../src/routes/PluginStoreRoute'

const marketplaceScope = 'market:5b226f70656e61692d706c7567696e73222c226169727461626c65225d'

const mocks = vi.hoisted(() => ({
  catalogMutate: vi.fn(),
  marketplaceCatalogError: undefined as Error | undefined,
  marketplaceCatalog: undefined as { plugins: Array<Record<string, unknown>> } | undefined,
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  pluginInstances: [] as Array<Record<string, unknown>>,
  refreshPlugins: vi.fn(),
  syncPluginMarketplaceSelection: vi.fn()
}))

const createInstalledRuntimePlugin = () => ({
  enabled: true,
  manifest: {
    native: {
      adapter: 'codex',
      apps: [{
        capabilities: ['Read', 'Write'],
        id: 'asdk_app_693ca6ce2db08191bb52d66743c65184',
        name: 'airtable'
      }]
    }
  },
  name: 'airtable',
  requestId: 'airtable@openai-plugins',
  scope: 'codex-openai-plugins-airtable-52fa4877979453b87dbb90a4',
  source: {
    adapter: 'codex',
    kind: 'marketplace',
    marketplace: 'openai-plugins',
    plugin: 'airtable'
  },
  version: '0.1.3'
})

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
        error: mocks.marketplaceCatalogError,
        isLoading: mocks.marketplaceCatalog == null && mocks.marketplaceCatalogError == null,
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
    { plugin }: {
      plugin: {
        manifest?: {
          native?: {
            apps?: Array<{
              authentication?: Record<string, unknown>
              capabilities?: string[]
              connectionRequirements?: Record<string, unknown>
              name?: string
              permissions?: string[]
            }>
          }
        }
      }
    }
  ) => {
    const app = plugin.manifest?.native?.apps?.[0]
    return (
      <div>
        Installed runtime detail
        <span>App: {app?.name ?? 'null'}</span>
        <span>Capabilities: {app?.capabilities?.join(', ') ?? 'null'}</span>
        <span>Permissions: {app?.permissions?.join(', ') ?? 'null'}</span>
        <span>Authentication: {app?.authentication == null ? 'null' : JSON.stringify(app.authentication)}</span>
        <span>
          Connection requirements: {app?.connectionRequirements == null
            ? 'null'
            : JSON.stringify(app.connectionRequirements)}
        </span>
      </div>
    )
  }
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
      instances: mocks.pluginInstances
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

  beforeEach(() => {
    mocks.pluginInstances = [createInstalledRuntimePlugin()]
  })

  afterEach(() => {
    mocks.catalogMutate.mockReset()
    mocks.marketplaceCatalog = undefined
    mocks.marketplaceCatalogError = undefined
    mocks.messageError.mockReset()
    mocks.messageSuccess.mockReset()
    mocks.refreshPlugins.mockReset()
    mocks.syncPluginMarketplaceSelection.mockReset()
    act(() => root?.unmount())
    container?.remove()
    container = undefined
    root = undefined
  })

  it('matches the API-shaped runtime identity independently of catalog loading or source errors', async () => {
    mocks.marketplaceCatalogError = new Error('catalog source unavailable')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<PluginStoreRoute />)
    })

    expect(container.textContent).toContain('Installed runtime detail')
    expect(container.textContent).toContain('App: airtable')
    expect(container.textContent).toContain('Capabilities: Read, Write')
    expect(container.textContent).toContain('Permissions: null')
    expect(container.textContent).toContain('Authentication: null')
    expect(container.textContent).toContain('Connection requirements: null')
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

  it('shows authoritative runtime metadata after project install without waiting for catalog revalidation', async () => {
    const events: string[] = []
    let releaseRefresh: (() => void) | undefined
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    mocks.pluginInstances = []
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
    mocks.refreshPlugins.mockImplementation(async () => {
      events.push('refresh-started')
      await refreshGate
      mocks.pluginInstances = [createInstalledRuntimePlugin()]
      events.push('runtime-authoritative')
    })
    mocks.catalogMutate.mockImplementation(() => {
      events.push('catalog-revalidation-started')
      return new Promise(() => {})
    })
    mocks.messageSuccess.mockImplementation(() => {
      events.push('success-shown')
    })
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

    expect(mocks.refreshPlugins).toHaveBeenCalledOnce()
    expect(events).toEqual(['refresh-started'])
    expect(mocks.catalogMutate).not.toHaveBeenCalled()
    expect(mocks.messageSuccess).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Catalog detail')
    expect(container.textContent).not.toContain('Installed runtime detail')

    await act(async () => {
      releaseRefresh?.()
      await refreshGate
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Installed runtime detail')
    expect(container.textContent).toContain('App: airtable')
    expect(container.textContent).toContain('Capabilities: Read, Write')
    expect(container.textContent).toContain('Permissions: null')
    expect(container.textContent).toContain('Authentication: null')
    expect(container.textContent).toContain('Connection requirements: null')
    expect(container.textContent).not.toContain('Catalog detail')
    expect(events).toEqual([
      'refresh-started',
      'runtime-authoritative',
      'catalog-revalidation-started',
      'success-shown'
    ])
    expect(mocks.catalogMutate).toHaveBeenCalledOnce()
    expect(mocks.messageSuccess).toHaveBeenCalledWith('pluginStore.marketplacePluginInstalledProject')
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
