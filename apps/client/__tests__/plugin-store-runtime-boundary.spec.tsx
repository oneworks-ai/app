// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PluginProvider } from '#~/plugins/PluginProvider'
import { AppRoutes } from '#~/routes/AppRoutes'

const marketplaceScope = 'market:5b226f70656e61692d706c7567696e73222c226169727461626c65225d'

vi.mock('#~/plugins/PluginProvider', () => ({
  PluginProvider: ({ children, runtimeSource }: { children: ReactNode; runtimeSource?: string }) => (
    <section data-runtime-source={runtimeSource ?? 'default'}>{children}</section>
  )
}))

vi.mock('#~/plugins/PluginHost', () => ({
  PluginRoute: () => <div>plugin-contributed-route</div>
}))

vi.mock('#~/routes/PluginStoreRoute', () => ({
  PluginStoreRoute: () => <div>plugin-management-route</div>
}))

vi.mock('#~/components/layout/desktop-workspace-startup-ready', () => ({
  useDesktopWorkspaceStartupReady: vi.fn()
}))

vi.mock('#~/hooks/use-experiments', () => ({
  useExperimentsState: () => ({ experiments: {}, isLoading: false })
}))

describe('workspace plugin store runtime boundary', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    container = undefined
    root = undefined
  })

  const renderRoute = async (path: string) => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={[path]}>
          <PluginProvider runtimeSource='manager'>
            <AppRoutes />
          </PluginProvider>
        </MemoryRouter>
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(container?.textContent).not.toBe(''))
    return container
  }

  it.each([
    '/plugins/list',
    `/plugins/store/${marketplaceScope}`
  ])('routes %s through the current workspace runtime under the manager shell', async (path) => {
    const rendered = await renderRoute(path)
    const runtimeBoundaries = [...rendered.querySelectorAll<HTMLElement>('[data-runtime-source]')]

    expect(runtimeBoundaries.map(element => element.dataset.runtimeSource)).toEqual(['manager', 'current'])
    expect(runtimeBoundaries[1]?.textContent).toContain('plugin-management-route')
  })

  it('leaves plugin-contributed routes owned by the outer manager runtime', async () => {
    const rendered = await renderRoute('/plugins/example/route-id')
    const runtimeBoundaries = [...rendered.querySelectorAll<HTMLElement>('[data-runtime-source]')]

    expect(runtimeBoundaries.map(element => element.dataset.runtimeSource)).toEqual(['manager'])
    expect(rendered.textContent).toContain('plugin-contributed-route')
    expect(rendered.textContent).not.toContain('plugin-management-route')
  })
})
