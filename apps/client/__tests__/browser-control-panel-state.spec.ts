import { describe, expect, it } from 'vitest'

import type { SessionPanelState } from '@oneworks/types'

import { handleBrowserControlPageCommand } from '#~/components/chat/interaction-panel/browser-control-page-command-handler'
import type { BrowserControlPageCommandController } from '#~/components/chat/interaction-panel/browser-control-page-command-handler'
import { resolveBrowserControlNavigationHistorySync } from '#~/components/chat/interaction-panel/browser-control-navigation-history'
import {
  applyBrowserControlPanelLifecycleCommand,
  applyBrowserControlPanelLifecycleCommandToRef
} from '#~/components/chat/interaction-panel/browser-control-panel-state'
import { toWorkspaceDrawerIframeTabId } from '#~/components/chat/interaction-panel/interaction-panel-iframe-pages'

const createState = (): SessionPanelState => ({
  bottom: {
    activeTabId: 'bottom-page',
    tabs: [{ id: 'bottom-page', kind: 'web', title: 'Bottom', url: 'https://bottom.test' }]
  },
  right: {
    activeTabId: toWorkspaceDrawerIframeTabId('right-page'),
    tabs: [{
      id: toWorkspaceDrawerIframeTabId('right-page'),
      kind: 'web',
      title: 'Right',
      url: 'https://right.test'
    }]
  }
})

const createPageCommandController = (): BrowserControlPageCommandController => ({
  applyDeviceMode: async state => state,
  applyDevtools: async ({ dockSide = 'right', enabled }) => ({ dockSide, enabled }),
  clearNavigationHistory: async () => ({ history: ['https://example.test'], historyIndex: 0 }),
  devicePresets: [{ id: 'responsive', label: 'Responsive' }, { id: 'phone', label: 'Phone', height: 800, width: 400 }],
  pageId: 'panel-page',
  syncNavigationHistory: async ({ activeIndex, entries }) => ({
    history: entries.map(entry => entry.url),
    historyIndex: activeIndex
  }),
  state: {
    active: true,
    deviceMode: {
      device_pixel_ratio: 2,
      device_type: 'mobile' as const,
      enabled: false,
      height: 800,
      preset_id: 'responsive',
      width: 400,
      zoom: 'auto' as const
    },
    devtools: { dockSide: 'right' as const, enabled: false },
    history: ['https://example.test'],
    historyIndex: 0,
    panelPageId: 'panel-page',
    title: 'Page',
    url: 'https://example.test'
  }
})

describe('browser control panel lifecycle', () => {
  it('handles list_device_presets through the mounted-page handler and acks exactly once', () => {
    const completions: unknown[] = []
    const handled = handleBrowserControlPageCommand({
      complete: completion => completions.push(completion),
      controller: createPageCommandController(),
      request: {
        command: { type: 'list_device_presets' },
        pageId: 'browser-page',
        panelPageId: 'panel-page',
        requestId: 'request-1'
      }
    })

    expect(handled).toBe(true)
    expect(completions).toHaveLength(1)
    expect(completions[0]).toEqual({
      ok: true,
      result: {
        page_id: 'browser-page',
        presets: [
          { id: 'responsive', label: 'Responsive' },
          { id: 'phone', label: 'Phone', height: 800, width: 400 }
        ]
      }
    })
  })

  it('acks set_device_mode only after the page state commit resolves', async () => {
    let resolveCommit: ((value: BrowserControlPageCommandController['state']['deviceMode']) => void) | undefined
    const controller = createPageCommandController()
    controller.applyDeviceMode = state => new Promise(resolve => {
      resolveCommit = () => resolve(state)
    })
    const completions: unknown[] = []

    handleBrowserControlPageCommand({
      complete: completion => completions.push(completion),
      controller,
      request: {
        command: { type: 'set_device_mode', enabled: true, preset_id: 'phone' },
        pageId: 'browser-page',
        panelPageId: 'panel-page',
        requestId: 'request-2'
      }
    })

    expect(completions).toHaveLength(0)
    resolveCommit?.(controller.state.deviceMode)
    await Promise.resolve()
    expect(completions).toHaveLength(1)
    expect(completions[0]).toMatchObject({
      ok: true,
      result: { device_mode: { enabled: true, height: 800, preset_id: 'phone', width: 400 } }
    })
  })

  it('acks clear_navigation_history only after the persisted page commit resolves', async () => {
    let resolveCommit: ((value: { history: string[]; historyIndex: number }) => void) | undefined
    const controller = createPageCommandController()
    controller.state.history = ['https://one.test', 'https://example.test']
    controller.state.historyIndex = 1
    controller.clearNavigationHistory = () => new Promise(resolve => {
      resolveCommit = resolve
    })
    const completions: unknown[] = []

    handleBrowserControlPageCommand({
      complete: completion => completions.push(completion),
      controller,
      request: {
        command: { type: 'clear_navigation_history' },
        pageId: 'browser-page',
        panelPageId: 'panel-page',
        requestId: 'request-clear'
      }
    })

    expect(completions).toHaveLength(0)
    resolveCommit?.({ history: ['https://example.test'], historyIndex: 0 })
    await Promise.resolve()
    expect(completions).toEqual([{
      ok: true,
      result: {
        current_index: 0,
        current_url: 'https://example.test',
        page_id: 'browser-page',
        total_entries: 1
      }
    }])
  })

  it('persists native history order while synchronizing its active index after navigation', async () => {
    const synchronized = resolveBrowserControlNavigationHistorySync({
      activeIndex: 0,
      currentUrl: 'https://a.test',
      entries: [{ url: 'https://a.test' }, { url: 'https://b.test' }]
    })
    expect(synchronized).toEqual({
      currentUrl: 'https://a.test/',
      history: ['https://a.test/', 'https://b.test/'],
      historyIndex: 0
    })

    let resolveCommit: ((value: { history: string[]; historyIndex: number }) => void) | undefined
    const controller = createPageCommandController()
    controller.state.history = ['https://a.test/', 'https://b.test/']
    controller.state.historyIndex = 1
    controller.syncNavigationHistory = () => new Promise(resolve => {
      resolveCommit = resolve
    })
    const completions: unknown[] = []
    handleBrowserControlPageCommand({
      complete: completion => completions.push(completion),
      controller,
      request: {
        command: {
          type: 'sync_navigation_history',
          active_index: 0,
          current_url: 'https://a.test',
          entries: [{ url: 'https://a.test' }, { url: 'https://b.test' }]
        },
        pageId: 'browser-page',
        panelPageId: 'panel-page',
        requestId: 'request-sync'
      }
    })
    expect(completions).toHaveLength(0)
    resolveCommit?.({ history: synchronized.history, historyIndex: synchronized.historyIndex })
    await Promise.resolve()
    expect(completions).toEqual([{
      ok: true,
      result: {
        current_index: 0,
        current_url: 'https://a.test/',
        page_id: 'browser-page',
        total_entries: 2
      }
    }])
  })

  it('rejects a page command whose owning session is not active', () => {
    const controller = createPageCommandController()
    controller.sessionId = 'session-1'
    const completions: unknown[] = []

    const handled = handleBrowserControlPageCommand({
      complete: completion => completions.push(completion),
      controller,
      request: {
        command: { type: 'get_page_view_state' },
        pageId: 'browser-page',
        panelPageId: 'panel-page',
        requestId: 'request-3',
        sessionId: 'session-2'
      }
    })

    expect(handled).toBe(true)
    expect(completions).toEqual([{
      ok: false,
      error: {
        code: 'SESSION_NOT_FOUND',
        message: 'The owning browser session is not active in this renderer.'
      }
    }])
  })

  it('returns the controller authoritative persisted device mode in page view state', () => {
    const controller = createPageCommandController()
    controller.state.deviceMode = {
      device_pixel_ratio: 3,
      device_type: 'desktop',
      enabled: true,
      height: 900,
      preset_id: 'responsive',
      width: 1440,
      zoom: 0.75
    }
    const completions: Array<{ result?: unknown }> = []

    handleBrowserControlPageCommand({
      complete: completion => completions.push(completion),
      controller,
      request: {
        command: { type: 'get_page_view_state' },
        pageId: 'browser-page',
        panelPageId: 'panel-page',
        requestId: 'request-view'
      }
    })

    expect(completions[0]?.result).toMatchObject({
      device_mode: controller.state.deviceMode,
      page_id: 'browser-page',
      panel_page_id: 'panel-page'
    })
  })

  it('resolves encoded right tabs and moves them to bottom without changing the logical page id', () => {
    const outcome = applyBrowserControlPanelLifecycleCommand({
      command: { type: 'move', placement: 'bottom' },
      createPageId: () => 'unused',
      panelPageId: 'right-page',
      state: createState()
    })

    expect(outcome.error).toBeUndefined()
    expect(outcome.state.right.tabs).toHaveLength(0)
    expect(outcome.state.bottom.activeTabId).toBe('right-page')
    expect(outcome.state.bottom.tabs.at(-1)).toMatchObject({ id: 'right-page', kind: 'web' })
  })

  it('duplicates a bottom tab into right using the persisted right-side id prefix', () => {
    const outcome = applyBrowserControlPanelLifecycleCommand({
      command: { type: 'duplicate', placement: 'right' },
      createPageId: () => 'copy-page',
      panelPageId: 'bottom-page',
      state: createState()
    })

    expect(outcome.state.right.activeTabId).toBe(toWorkspaceDrawerIframeTabId('copy-page'))
    expect(outcome.state.right.tabs.at(-1)).toMatchObject({
      id: toWorkspaceDrawerIframeTabId('copy-page'),
      url: 'https://bottom.test'
    })
    expect(outcome.result).toMatchObject({ panel_page_id: 'copy-page', placement: 'right' })
  })

  it('returns an explicit error when the source tab no longer exists', () => {
    const state = createState()
    const outcome = applyBrowserControlPanelLifecycleCommand({
      command: { type: 'close' },
      createPageId: () => 'unused',
      panelPageId: 'missing-page',
      state
    })

    expect(outcome.state).toBe(state)
    expect(outcome.error).toEqual({
      code: 'PANEL_PAGE_NOT_FOUND',
      message: 'The browser panel tab is unavailable.'
    })
  })

  it('applies consecutive lifecycle commands against the synchronously updated authoritative ref', () => {
    const stateRef = { current: createState() }
    const move = applyBrowserControlPanelLifecycleCommandToRef({
      command: { type: 'move', placement: 'bottom' },
      createPageId: () => 'unused',
      panelPageId: 'right-page',
      stateRef
    })
    expect(move.error).toBeUndefined()
    expect(stateRef.current.bottom.tabs.some(tab => tab.id === 'right-page')).toBe(true)

    const close = applyBrowserControlPanelLifecycleCommandToRef({
      command: { type: 'close' },
      createPageId: () => 'unused',
      panelPageId: 'right-page',
      stateRef
    })
    expect(close.error).toBeUndefined()
    expect(stateRef.current.bottom.tabs.some(tab => tab.id === 'right-page')).toBe(false)
    expect(stateRef.current.right.tabs).toHaveLength(0)
  })
})
