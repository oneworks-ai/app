// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationProvider } from '#~/notifications/NotificationProvider'
import { PluginProvider } from '#~/plugins/PluginProvider'
import { usePluginContext } from '#~/plugins/plugin-context'
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

const runtimePlugin = (scope: string, withRoute = false) => ({
  enabled: true,
  ...(withRoute
    ? {
      manifest: {
        name: scope,
        plugin: {
          contributions: {
            roles: ['workspace'],
            routes: [{ clientView: 'view', id: 'view', title: 'Workspace view' }]
          }
        },
        version: '1.0.0'
      }
    }
    : {}),
  name: scope,
  requestId: scope,
  scope,
  sourceGroup: 'project',
  watch: { enabled: false }
})

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
  const { pluginServerBaseUrl, snapshot } = usePluginContext()
  return (
    <div data-server-base-url={pluginServerBaseUrl} data-testid='manager-shell'>
      {snapshot.instances.map(item => item.scope).sort().join(',')}
    </div>
  )
}

const renderRoutes = (container: HTMLElement, path: string): Root => {
  const root = createRoot(container)
  act(() => {
    root.render(
      <NotificationProvider>
        <PluginProvider runtimeSource='manager'>
          <ShellProbe />
          <MemoryRouter initialEntries={[path]}>
            <AppRoutes />
          </MemoryRouter>
        </PluginProvider>
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
        const origin = url.origin === 'https://manager.example' ? 'manager' : 'workspace'
        if (url.pathname === '/api/plugins') {
          return ok({ plugins: [runtimePlugin(`${origin}-runtime`, origin === 'workspace')] })
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
