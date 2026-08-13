// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RouteContainerPanelDockWorkspace } from '#~/components/layout/RouteContainerPanelTabs'

const dock = vi.hoisted(() => ({
  api: null as any,
  onDidRemovePanel: null as null | ((panel: any) => void)
}))

vi.mock('dockview', async () => {
  const React = await import('react')
  return {
    DockviewReact: (props: any) => {
      React.useEffect(() => {
        props.onReady({ api: dock.api })
      }, [props.onReady])
      return <div data-testid='shared-dockview' />
    }
  }
})

const createPanel = (id: string) => ({
  api: {
    renderer: 'always',
    setActive: vi.fn(),
    setRenderer: vi.fn(),
    setTitle: vi.fn(),
    updateParameters: vi.fn()
  },
  id
})

const createApi = (initialLayout: any) => {
  let layout = initialLayout
  let panels = Object.keys(initialLayout.panels).map(createPanel)
  let onDidLayoutChange: null | (() => void) = null
  const api = {
    activePanel: panels[0],
    addPanel: vi.fn(({ id }: { id: string }) => panels.push(createPanel(id))),
    fromJSON: vi.fn((nextLayout: any) => {
      layout = nextLayout
      panels = Object.keys(nextLayout.panels).map(createPanel)
    }),
    getPanel: vi.fn((id: string) => panels.find(panel => panel.id === id)),
    get panels() {
      return panels
    },
    layout: vi.fn(),
    onDidActivePanelChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidLayoutChange: vi.fn((listener: () => void) => {
      onDidLayoutChange = listener
      return { dispose: vi.fn() }
    }),
    onDidRemovePanel: vi.fn((listener: (panel: any) => void) => {
      dock.onDidRemovePanel = listener
      return { dispose: vi.fn() }
    }),
    removePanel: vi.fn((panel: any) => panels = panels.filter(item => item !== panel)),
    toJSON: vi.fn(() => layout)
  }
  return {
    api,
    removeFromDockview: (id: string) => {
      const removed = panels.find(panel => panel.id === id)!
      panels = panels.filter(panel => panel.id !== id)
      layout = { ...layout, panels: Object.fromEntries(panels.map(panel => [panel.id, {}])) }
      onDidLayoutChange?.()
      dock.onDidRemovePanel?.(removed)
    }
  }
}

describe('routeContainerPanelDockWorkspace native close veto', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each(['native group', 'floating group'])('restores the settled layout after a vetoed %s removal', async (kind) => {
    const settledLayout = {
      floatingGroups: kind === 'floating group' ? [{ id: 'floating-a' }] : [],
      panels: { 'tab-a': {}, 'tab-b': {} }
    }
    const fake = createApi(settledLayout)
    dock.api = fake.api
    const onTabChange = vi.fn()
    const onTabClose = vi.fn(() => false)
    await act(async () =>
      root.render(
        <RouteContainerPanelDockWorkspace
          activeTab='tab-a'
          ariaLabel='Test dock'
          closable
          openedTabs={['tab-a', 'tab-b']}
          tabs={[
            { content: 'A', icon: 'terminal', key: 'tab-a', label: 'A', title: 'A' },
            { content: 'B', icon: 'terminal', key: 'tab-b', label: 'B', title: 'B' }
          ]}
          onTabChange={onTabChange}
          onTabClose={onTabClose}
        />
      )
    )
    await act(async () => vi.advanceTimersByTime(80))
    fake.api.fromJSON.mockClear()
    await act(async () => fake.removeFromDockview('tab-a'))
    expect(onTabClose).toHaveBeenCalledWith('tab-a')
    expect(onTabChange).not.toHaveBeenCalled()
    expect(fake.api.fromJSON).toHaveBeenCalledWith(settledLayout, { reuseExistingPanels: true })
    expect(fake.api.panels.map((panel: any) => panel.id)).toEqual(['tab-a', 'tab-b'])
  })
})
