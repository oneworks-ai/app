import { describe, expect, it } from 'vitest'

import {
  createInteractionPanelPluginPage,
  normalizeInteractionPanelPluginPages,
  resolveInteractionPanelPluginTabDefinition
} from '#~/components/chat/interaction-panel/interaction-panel-plugin-pages'
import { toActiveInteractionTab } from '#~/components/chat/interaction-panel/interaction-panel-tab-groups'
import { buildInteractionPanelTabs, isActiveTab } from '#~/components/chat/interaction-panel/interaction-panel-tabs'
import {
  DEFAULT_TERMINAL_ID,
  DEFAULT_TERMINAL_PANE_SURFACE,
  createTerminalPane,
  normalizeTerminalPanes,
  withExplicitTerminalPaneIds
} from '#~/components/chat/terminal/@utils/terminal-panes'

describe('interaction panel tabs', () => {
  it('builds terminal panes as dockable top-level windows', () => {
    const tabs = buildInteractionPanelTabs({
      filePaths: ['src/App.tsx'],
      iframePages: [],
      terminalInfoById: {},
      terminalPanes: [
        { id: 'term-1', title: 'Terminal 1', shellKind: 'default' },
        { id: 'term-2', title: 'Terminal 2', shellKind: 'zsh' }
      ]
    })

    expect(tabs.map(tab => tab.id)).toEqual(['term-1', 'term-2', 'file:src/App.tsx'])
    expect(tabs[0]).toMatchObject({
      icon: 'terminal',
      kind: 'terminal',
      label: 'Terminal 1'
    })
  })

  it('renders plugin tabs only after a workbench page instance is created', () => {
    const page = createInteractionPanelPluginPage({
      id: 'bottom',
      title: 'Plugin Demo',
      icon: 'terminal',
      clientView: 'panel',
      pluginScope: 'demo'
    }, 'en')

    expect(buildInteractionPanelTabs({
      filePaths: [],
      iframePages: [],
      pluginPages: [],
      terminalInfoById: {},
      terminalPanes: []
    })).toEqual([])

    expect(page).toBeDefined()
    const tabs = buildInteractionPanelTabs({
      filePaths: [],
      iframePages: [],
      pluginPages: [page!],
      terminalInfoById: {},
      terminalPanes: []
    })

    expect(tabs).toEqual([{
      id: page!.id,
      kind: 'plugin',
      icon: 'terminal',
      label: 'Plugin Demo',
      pluginScope: 'demo',
      tabId: 'bottom',
      viewId: 'panel',
      canClose: true
    }])
    expect(toActiveInteractionTab(tabs[0]!)).toEqual({ kind: 'plugin', id: page!.id })
  })

  it('drops opened plugin tab pages when their workbench contribution is no longer available', () => {
    const page = createInteractionPanelPluginPage({
      id: 'bottom',
      title: 'Plugin Demo',
      titleI18n: { 'zh-Hans': '插件 Demo' },
      clientView: 'panel',
      pluginScope: 'demo'
    }, 'zh')

    expect(page).toBeDefined()
    expect(normalizeInteractionPanelPluginPages([page!], [{
      id: 'bottom',
      title: 'Plugin Demo updated',
      icon: 'deployed_code',
      clientView: 'panel-v2',
      pluginScope: 'demo',
      titleI18n: { 'zh-Hans': '插件 Demo 已更新' }
    }], 'zh')).toEqual([{
      ...page!,
      title: '插件 Demo 已更新',
      icon: 'deployed_code',
      viewId: 'panel-v2'
    }])
    expect(page!.title).toBe('插件 Demo')
    expect(normalizeInteractionPanelPluginPages([page!], [], 'zh')).toEqual([])
  })

  it('falls back to a plugin scope single workbench tab only when requested', () => {
    const definitions = [{
      id: 'bottom',
      title: 'Plugin Demo',
      clientView: 'panel',
      pluginScope: 'demo'
    }]

    expect(resolveInteractionPanelPluginTabDefinition({
      pluginScope: 'demo',
      tabId: 'home',
      tabs: definitions
    })).toBeUndefined()
    expect(resolveInteractionPanelPluginTabDefinition({
      fallbackToSingle: true,
      pluginScope: 'demo',
      tabId: 'home',
      tabs: definitions
    })).toEqual(definitions[0])
    expect(resolveInteractionPanelPluginTabDefinition({
      fallbackToSingle: true,
      pluginScope: 'demo',
      tabId: 'home',
      tabs: [
        ...definitions,
        { id: 'second', title: 'Second', clientView: 'second-panel', pluginScope: 'demo' }
      ]
    })).toBeUndefined()
  })

  it('keeps individual terminal windows active by id', () => {
    const tabs = buildInteractionPanelTabs({
      filePaths: [],
      iframePages: [],
      terminalInfoById: {},
      terminalPanes: [
        { id: 'term-1', title: 'Terminal 1', shellKind: 'default' },
        { id: 'term-2', title: 'Terminal 2', shellKind: 'bash' }
      ]
    })
    const terminalTab = tabs.find(tab => tab.id === 'term-2')

    expect(terminalTab).toBeDefined()
    expect(isActiveTab(terminalTab!, { kind: 'terminal', id: 'term-2' })).toBe(true)
    expect(toActiveInteractionTab(terminalTab!)).toEqual({ kind: 'terminal', id: 'term-2' })
  })

  it('creates explicit terminal ids for new and legacy default panes', () => {
    const [initialPane] = normalizeTerminalPanes(null)
    const [legacyPane] = normalizeTerminalPanes([
      { id: DEFAULT_TERMINAL_ID, title: 'Terminal 1', shellKind: 'default' }
    ])

    expect(initialPane?.id).toMatch(/^term-/)
    expect(legacyPane?.id).toMatch(/^term-/)
    expect(initialPane?.id).not.toBe(DEFAULT_TERMINAL_ID)
    expect(legacyPane?.id).not.toBe(DEFAULT_TERMINAL_ID)
  })

  it('can keep empty terminal pane storage empty', () => {
    expect(normalizeTerminalPanes(null, { fallback: false })).toEqual([])
    expect(normalizeTerminalPanes([], { fallback: false })).toEqual([])
    expect(normalizeTerminalPanes([{ id: '', title: '', shellKind: 'default' }], { fallback: false })).toEqual([])
  })

  it('keeps terminal pane surface placement in shared route state', () => {
    const [legacyPane, drawerPane] = normalizeTerminalPanes([
      { id: 'legacy', title: 'Terminal 1', shellKind: 'default' },
      { id: 'drawer', title: 'Terminal 2', shellKind: 'default', surface: 'workspace-drawer' }
    ], { fallback: false })
    const createdDrawerPane = createTerminalPane('default', 'Terminal 3', undefined, undefined, 'workspace-drawer')

    expect(legacyPane?.surface).toBe(DEFAULT_TERMINAL_PANE_SURFACE)
    expect(drawerPane?.surface).toBe('workspace-drawer')
    expect(createdDrawerPane.surface).toBe('workspace-drawer')
  })

  it('migrates existing default panes before adding more terminals', () => {
    const [pane] = withExplicitTerminalPaneIds([
      { id: DEFAULT_TERMINAL_ID, title: 'Terminal 1', shellKind: 'default' }
    ])

    expect(pane?.id).toMatch(/^term-/)
    expect(pane?.title).toBe('Terminal 1')
  })
})
