// @vitest-environment happy-dom
import { act, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationProvider } from '#~/notifications/NotificationProvider'
import { PluginContributionProvider } from '#~/plugins/PluginContributionProvider'
import { PluginProvider } from '#~/plugins/PluginProvider'
import { usePluginContext } from '#~/plugins/plugin-context'
import type {
  PluginContributionNavItem,
  PluginContributionWorkbenchAddMenuItem,
  PluginContributionWorkbenchTab
} from '#~/plugins/plugin-manifest'
import { buildPluginSidebarNavigationItems } from '#~/plugins/plugin-sidebar-navigation'
import { usePluginCommandExecutor, usePluginSlot } from '#~/plugins/plugin-slots'
import { AppRoutes } from '#~/routes/AppRoutes'
import { mergeRuntimeEnv } from '#~/runtime-config'
import type { RuntimeEnv } from '#~/runtime-config'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const transportState = vi.hoisted(() => ({
  requestUrls: [] as string[],
  workspaceGeneration: 'workspace-v1'
}))
const runtimeGlobal = globalThis as typeof globalThis & {
  __ONEWORKS_PROJECT_RUNTIME_ENV__?: RuntimeEnv
}

vi.mock('#~/homepage-preview/runtime-loader', () => ({
  handleHomepagePreviewFetchIfEnabled: vi.fn(async () => undefined)
}))

vi.mock('#~/ws.js', () => ({
  createSocket: vi.fn(() => ({
    addEventListener: vi.fn(),
    close: vi.fn(),
    readyState: WebSocket.OPEN
  }))
}))

vi.mock('#~/plugins/PluginHost', async () => {
  const { usePluginContext } = await import('#~/plugins/plugin-context')
  return {
    PluginRoute: () => {
      const { pluginServerBaseUrl } = usePluginContext()
      return <div data-testid='contributed-route'>{pluginServerBaseUrl}</div>
    }
  }
})

vi.mock('#~/routes/PluginStoreRoute', async () => {
  const { useCallback, useEffect, useState } = await import('react')
  const { getConfig } = await import('#~/api/config')
  const { usePluginContext } = await import('#~/plugins/plugin-context')
  const { listPluginMarketplaceCatalog } = await import('#~/plugins/marketplace-api')

  return {
    PluginStoreRoute: () => {
      const { pluginServerBaseUrl, refreshPlugins, snapshot } = usePluginContext()
      const [catalogState, setCatalogState] = useState('loading')

      const reload = useCallback(async () => {
        await refreshPlugins()
        const [catalog, config] = await Promise.all([
          listPluginMarketplaceCatalog({ serverBaseUrl: pluginServerBaseUrl }),
          getConfig({ serverBaseUrl: pluginServerBaseUrl })
        ])
        const airtable = catalog.plugins.find(item => item.name === 'airtable')
        const marketplaceKeys = Object.keys(
          config.sources?.project?.plugins?.marketplaces ?? {}
        ).sort()
        setCatalogState([
          catalog.versionGeneration,
          airtable?.installedSources?.join(',') ?? 'not-installed',
          marketplaceKeys.join(',')
        ].join('|'))
      }, [pluginServerBaseUrl, refreshPlugins])

      useEffect(() => {
        void reload()
      }, [reload])

      return (
        <div
          data-server-base-url={pluginServerBaseUrl}
          data-testid='plugin-management-route'
        >
          <span>{snapshot.instances.map(item => item.scope).sort().join(',')}</span>
          <span>{catalogState}</span>
          <button onClick={() => void reload()} type='button'>refresh</button>
        </div>
      )
    }
  }
})

const ok = (data: unknown) =>
  new Response(JSON.stringify({ data, success: true }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200
  })

const runtimePlugin = (
  scope: string,
  roles: Array<'manager' | 'workspace'>,
  contributions: Record<string, unknown> = {}
) => ({
  enabled: true,
  manifest: {
    name: scope,
    plugin: {
      contributions: { roles, surfaces: ['workspace'], ...contributions },
      server: { roles }
    },
    version: '1.0.0'
  },
  name: scope,
  requestId: scope,
  scope,
  sourceGroup: 'project',
  watch: { enabled: false }
})

const runtimePlugins = (origin: 'manager' | 'workspace' | 'workspace-2') => {
  const workspaceTitle = origin === 'workspace-2' ? 'Workspace navigation v2' : 'Workspace navigation'
  const plugins = [
    runtimePlugin('manager-runtime', ['manager'], {
      navItems: [{ id: 'manager-nav', title: 'Manager navigation', route: '/plugins/manager-runtime/view' }],
      routes: [{ clientView: 'view', id: 'view', title: 'Manager view' }],
      workbenchAddMenu: [{ id: 'manager-add', tab: 'manager-tab', title: 'Manager add menu' }],
      workbenchTabs: [{ clientView: 'view', id: 'manager-tab', title: 'Manager workbench tab' }]
    }),
    runtimePlugin('workspace-runtime', ['workspace'], {
      navItems: [{
        actions: [{ command: 'workspace-command', id: 'workspace-command', title: 'Workspace command' }],
        id: 'workspace-nav',
        route: '/plugins/workspace-runtime/view',
        title: workspaceTitle
      }],
      routes: [{ clientView: 'view', id: 'view', title: 'Workspace view' }],
      workbenchAddMenu: [{ id: 'workspace-add', tab: 'workspace-tab', title: 'Workspace add menu' }],
      workbenchTabs: [{ clientView: 'view', id: 'workspace-tab', title: 'Workspace workbench tab' }]
    }),
    runtimePlugin('dual-runtime', ['manager', 'workspace'], {
      navItems: [{
        id: 'dual-nav',
        title: origin === 'manager' ? 'Dual navigation from manager' : 'Dual navigation from workspace'
      }]
    }),
    runtimePlugin('launcher-runtime', ['manager', 'workspace'], {
      navItems: [{ id: 'launcher-nav', surfaces: ['launcher'], title: 'Launcher navigation' }]
    })
  ]
  return origin === 'manager' ? plugins : plugins.filter(plugin => plugin.scope !== 'manager-runtime')
}

const catalog = (origin: 'manager' | 'workspace') => ({
  plugins: [{
    builtIn: true,
    configSource: 'project',
    declared: true,
    enabled: true,
    ...(origin === 'manager' ? { installedSources: ['project'] } : {}),
    marketplace: 'openai-plugins',
    marketplaceEnabled: true,
    marketplaceType: 'codex',
    name: 'airtable',
    sourceLabel: `${origin}-source`,
    sourceType: 'git-subdir'
  }],
  sources: [],
  versionGeneration: origin === 'manager' ? 'manager-v1' : transportState.workspaceGeneration
})

function ShellProbe() {
  const navigate = useNavigate()
  const { pluginServerBaseUrl, snapshot } = usePluginContext()
  const pluginNavItems = usePluginSlot<PluginContributionNavItem>('nav.items')
  const pluginWorkbenchAddMenu = usePluginSlot<PluginContributionWorkbenchAddMenuItem>('workbench.addMenu')
  const pluginWorkbenchTabs = usePluginSlot<PluginContributionWorkbenchTab>('workbench.tabs')
  const executePluginCommand = usePluginCommandExecutor()
  const navigationItems = useMemo(() =>
    buildPluginSidebarNavigationItems({
      executeCommand: executePluginCommand,
      items: pluginNavItems,
      language: 'en',
      navigate: route => void navigate(route),
      pathname: globalThis.location.pathname
    }), [executePluginCommand, navigate, pluginNavItems])
  return (
    <>
      <div data-server-base-url={pluginServerBaseUrl} data-testid='manager-shell'>
        {snapshot.instances.map(item => item.scope).sort().join(',')}
      </div>
      <nav aria-label='Plugin navigation'>
        {navigationItems.map(item => (
          <span key={item.key}>
            <button data-testid={item.key} onClick={item.onSelect} type='button'>{item.label}</button>
            {item.actions?.map(action => (
              <button data-testid={action.key} key={action.key} onClick={action.onSelect} type='button'>
                {action.label}
              </button>
            ))}
          </span>
        ))}
      </nav>
      <div data-testid='workbench-add-menu'>
        {pluginWorkbenchAddMenu.map(item => item.title).join(',')}
      </div>
      <div data-testid='workbench-tabs'>
        {pluginWorkbenchTabs.map(item => item.title).join(',')}
      </div>
    </>
  )
}

function ContributionBridgeHarness({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(true)
  const [workspaceServerBaseUrl, setWorkspaceServerBaseUrl] = useState('https://workspace.example')
  const content = (
    <>
      <button data-testid='toggle-contributions' onClick={() => setEnabled(value => !value)} type='button'>
        toggle
      </button>
      <button
        data-testid='switch-workspace-runtime'
        onClick={() => setWorkspaceServerBaseUrl('https://workspace-2.example')}
        type='button'
      >
        switch workspace
      </button>
      {children}
    </>
  )

  return enabled
    ? (
      <PluginContributionProvider
        runtimeServerBaseUrl={workspaceServerBaseUrl}
        runtimeSource='current'
        surface='workspace'
      >
        {content}
      </PluginContributionProvider>
    )
    : content
}

const renderRoutes = (container: HTMLElement, path: string): Root => {
  const root = createRoot(container)
  act(() => {
    root.render(
      <NotificationProvider>
        <MemoryRouter initialEntries={[path]}>
          <PluginProvider runtimeSource='manager'>
            <ContributionBridgeHarness>
              <ShellProbe />
              <AppRoutes />
            </ContributionBridgeHarness>
          </PluginProvider>
        </MemoryRouter>
      </NotificationProvider>
    )
  })
  return root
}

const waitFor = async (assertion: () => void) => {
  let lastError: unknown
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
      })
    }
  }
  throw lastError
}

describe('plugin management workspace transport', () => {
  let container: HTMLDivElement
  let originalRuntimeEnv: RuntimeEnv | undefined
  let root: Root | undefined

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    originalRuntimeEnv = runtimeGlobal.__ONEWORKS_PROJECT_RUNTIME_ENV__
    transportState.requestUrls.length = 0
    transportState.workspaceGeneration = 'workspace-v1'
    globalThis.history.replaceState({}, '', '/ui/w/w_isolated123/')
    mergeRuntimeEnv({
      __ONEWORKS_PROJECT_MANAGER_SERVER_BASE_URL__: 'https://manager.example',
      __ONEWORKS_PROJECT_SERVER_BASE_URL__: 'https://workspace.example',
      __ONEWORKS_PROJECT_SERVER_ROLE__: 'workspace',
      __ONEWORKS_PROJECT_WORKSPACE_ID__: 'w_isolated123'
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
        transportState.requestUrls.push(url.toString())
        const runtimeOrigin = url.origin === 'https://manager.example'
          ? 'manager'
          : url.origin === 'https://workspace-2.example'
          ? 'workspace-2'
          : 'workspace'
        const origin = runtimeOrigin === 'manager' ? 'manager' : 'workspace'
        if (url.pathname === '/api/plugins') {
          return ok({
            plugins: runtimePlugins(runtimeOrigin),
            runtime: {
              id: `${runtimeOrigin}-endpoint`,
              role: runtimeOrigin === 'manager' ? 'manager' : 'workspace',
              status: 'online'
            }
          })
        }
        if (url.pathname.includes('/commands/')) {
          return ok({ origin: runtimeOrigin })
        }
        if (url.pathname === '/api/plugins/marketplace/catalog') {
          return ok(catalog(origin))
        }
        if (url.pathname === '/api/config') {
          return ok({
            sources: {
              project: {
                plugins: {
                  marketplaces: {
                    [`${origin}-source`]: { enabled: true, type: 'codex' }
                  }
                }
              }
            }
          })
        }
        throw new Error(`Unexpected request: ${url.toString()}`)
      })
    )
  })

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
    }
    container.remove()
    runtimeGlobal.__ONEWORKS_PROJECT_RUNTIME_ENV__ = originalRuntimeEnv
    globalThis.history.replaceState({}, '', '/')
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('keeps management catalog, refresh, and remount on the workspace while the shell stays on manager', async () => {
    root = renderRoutes(container, '/plugins/store/market:%5Bopenai-plugins%2Cairtable%5D')

    await waitFor(() => {
      expect(container.querySelector('[data-testid="manager-shell"]')?.textContent).toContain('manager-runtime')
      expect(container.querySelector('[data-testid="plugin-management-route"]')?.textContent)
        .toContain('workspace-v1|not-installed|workspace-source')
    })

    const route = container.querySelector('[data-testid="plugin-management-route"]')
    expect(route?.getAttribute('data-server-base-url')).toBe('https://workspace.example')
    expect(route?.textContent).toContain('workspace-runtime')
    expect(route?.textContent).not.toContain('manager-runtime')
    expect(route?.textContent).not.toContain('manager-v1')

    transportState.workspaceGeneration = 'workspace-v2'
    await act(async () => {
      route?.querySelector('button')?.click()
    })
    await waitFor(() => {
      expect(route?.textContent).toContain('workspace-v2|not-installed|workspace-source')
    })

    act(() => root?.unmount())
    container.replaceChildren()
    root = renderRoutes(container, '/plugins/list')
    await waitFor(() => {
      expect(container.querySelector('[data-testid="plugin-management-route"]')?.textContent)
        .toContain('workspace-v2|not-installed|workspace-source')
    })

    const catalogAndConfigRequests = transportState.requestUrls.filter(url => (
      url.includes('/api/config') || url.includes('/api/plugins/marketplace/catalog')
    ))
    expect(catalogAndConfigRequests.length).toBeGreaterThanOrEqual(4)
    expect(catalogAndConfigRequests.every(url => url.startsWith('https://workspace.example/'))).toBe(true)
  })

  it('discovers workspace host chrome without replacing manager ownership or leaking launcher contributions', async () => {
    root = renderRoutes(container, '/')

    await waitFor(() => {
      expect(container.querySelector('[data-testid="plugin:manager-runtime:manager-nav"]')?.textContent)
        .toBe('Manager navigation')
      expect(container.querySelector('[data-testid="plugin:workspace-runtime:workspace-nav"]')?.textContent)
        .toBe('Workspace navigation')
    })

    const navigationText = container.querySelector('nav')?.textContent ?? ''
    expect(navigationText).toContain('Dual navigation from manager')
    expect(navigationText).not.toContain('Dual navigation from workspace')
    expect(navigationText.match(/Dual navigation from manager/gu)).toHaveLength(1)
    expect(navigationText).not.toContain('Launcher navigation')
    expect(container.querySelector('[data-testid="workbench-add-menu"]')?.textContent)
      .toBe('Manager add menu')
    expect(container.querySelector('[data-testid="workbench-tabs"]')?.textContent)
      .toBe('Manager workbench tab')

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="workspace-runtime:workspace-nav:workspace-command"]'
      )?.click()
    })
    await waitFor(() => {
      expect(transportState.requestUrls.some(url => (
        url.startsWith('https://workspace.example/') && url.includes('/commands/workspace-command')
      ))).toBe(true)
    })
    expect(transportState.requestUrls.some(url => (
      url.startsWith('https://manager.example/') && url.includes('/commands/workspace-command')
    ))).toBe(false)
  })

  it('replaces supplemental contributions on runtime change and removes them on bridge unmount', async () => {
    root = renderRoutes(container, '/')
    await waitFor(() => {
      expect(container.querySelector('[data-testid="plugin:workspace-runtime:workspace-nav"]')?.textContent)
        .toBe('Workspace navigation')
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="switch-workspace-runtime"]')?.click()
    })
    await waitFor(() => {
      expect(container.querySelector('[data-testid="plugin:workspace-runtime:workspace-nav"]')?.textContent)
        .toBe('Workspace navigation v2')
    })
    expect((container.querySelector('nav')?.textContent ?? '').match(/Workspace navigation/gu)).toHaveLength(1)

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="workspace-runtime:workspace-nav:workspace-command"]'
      )?.click()
    })
    await waitFor(() => {
      expect(transportState.requestUrls.some(url => (
        url.startsWith('https://workspace-2.example/') && url.includes('/commands/workspace-command')
      ))).toBe(true)
    })
    expect(transportState.requestUrls.some(url => (
      url.startsWith('https://workspace.example/') && url.includes('/commands/workspace-command')
    ))).toBe(false)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="toggle-contributions"]')?.click()
    })
    await waitFor(() => {
      expect(container.querySelector('[data-testid="plugin:workspace-runtime:workspace-nav"]')).toBeNull()
    })
    expect(container.querySelector('[data-testid="plugin:manager-runtime:manager-nav"]')?.textContent)
      .toBe('Manager navigation')
    expect(container.querySelector('nav')?.textContent).toContain('Dual navigation from manager')
    expect(container.querySelector('nav')?.textContent).not.toContain('Workspace navigation v2')
  })

  it('retains manager ownership for plugin-contributed routes', async () => {
    root = renderRoutes(container, '/plugins/manager-runtime/view')
    await waitFor(() => {
      expect(container.querySelector('[data-testid="contributed-route"]')?.textContent)
        .toBe('https://manager.example')
    })
  })

  it('uses the workspace runtime for workspace-contributed routes', async () => {
    root = renderRoutes(container, '/plugins/workspace-runtime/view')
    await waitFor(() => {
      expect(container.querySelector('[data-testid="contributed-route"]')?.textContent)
        .toBe('https://workspace.example')
    })
  })
})
