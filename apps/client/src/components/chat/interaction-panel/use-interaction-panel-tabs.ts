/* eslint-disable max-lines -- tab state coordinates terminal, file, website, and session resources. */
import type { TFunction } from 'i18next'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { TerminalShellKind } from '@oneworks/types'

import { isTerminalPaneOnSurface } from '#~/components/chat/terminal/@utils/terminal-panes'
import type { TerminalPaneConfig } from '#~/components/chat/terminal/@utils/terminal-panes'
import type { WorkspaceDrawerView } from '#~/components/chat/workspace-drawer/workspace-drawer-types'
import type { WorkspaceDrawerViewItem } from '#~/components/chat/workspace-drawer/workspace-drawer-view-items'
import type { ChatRouteBottomPanelState } from '#~/hooks/chat/use-chat-route-bottom-panel'
import type { PluginContributionWorkbenchTab } from '#~/plugins/plugin-manifest'
import { usePluginSlot } from '#~/plugins/plugin-slots'

import type { OpenInteractionPanelIframeUrlOptions } from './interaction-panel-iframe-pages'
import {
  areInteractionPanelPluginPagesEqual,
  createInteractionPanelPluginPage,
  normalizeInteractionPanelPluginPages,
  resolveInteractionPanelPluginTabDefinition
} from './interaction-panel-plugin-pages'
import type { InteractionPanelPluginPage } from './interaction-panel-plugin-pages'
import {
  closeWorkspaceFileTabsForScope,
  containsActiveTab,
  getFallbackTabAfterClose,
  getTabsForCloseScope,
  resolveOpenFilePath,
  toActiveInteractionTab
} from './interaction-panel-tab-groups'
import type { InteractionPanelTabCloseScope } from './interaction-panel-tab-groups'
import {
  INTERACTION_PANEL_MOBILE_DEBUG_CONFIG_KEY,
  INTERACTION_PANEL_MOBILE_DEBUG_NO_DEVICES_KEY,
  parseInteractionPanelMobileDebugDeviceMenuKey
} from './interaction-panel-tab-menu'
import { buildInteractionPanelTabs, toWorkspaceDrawerInteractionTabId } from './interaction-panel-tabs'
import type { ActiveInteractionTab, InteractionPanelTab } from './interaction-panel-tabs'
import { useCloseInteractionPanelSessionPages } from './use-clear-interaction-panel-session-query'
import { useInteractionPanelIframePages } from './use-interaction-panel-iframe-pages'
import { useInteractionPanelMobileDebugPages } from './use-interaction-panel-mobile-debug-pages'
import { useInteractionPanelSessionPages } from './use-interaction-panel-session-pages'
import { useInteractionPanelTabOrder } from './use-interaction-panel-tab-order'
import type { InteractionTerminalPanesController } from './use-interaction-terminal-panes'

export function useInteractionPanelTabs({
  bottomPanel,
  canCreateSessionTab,
  language,
  terminalPanes,
  terminalSessionId,
  workspaceDrawerItems = [],
  t
}: {
  bottomPanel: ChatRouteBottomPanelState
  canCreateSessionTab: boolean
  language: string
  terminalPanes: InteractionTerminalPanesController
  terminalSessionId: string
  workspaceDrawerItems?: WorkspaceDrawerViewItem[]
  t: TFunction
}) {
  const iframePageState = useInteractionPanelIframePages({ terminalSessionId, t })
  const mobileDebugPageState = useInteractionPanelMobileDebugPages()
  const sessionPageState = useInteractionPanelSessionPages(terminalSessionId)
  const pluginWorkbenchTabs = usePluginSlot<PluginContributionWorkbenchTab>('workbench.tabs')
  const closeInteractionPanelSessionPages = useCloseInteractionPanelSessionPages(sessionPageState)
  const [pluginPages, setPluginPages] = useState<InteractionPanelPluginPage[]>([])
  const [workspaceDrawerViews, setWorkspaceDrawerViews] = useState<WorkspaceDrawerView[]>([])
  const bottomTerminalPanes = useMemo(
    () => terminalPanes.panes.filter(pane => isTerminalPaneOnSurface(pane, 'bottom')),
    [terminalPanes.panes]
  )
  const [activeTab, setActiveTab] = useState<ActiveInteractionTab | null>(null)
  const workspaceDrawerItemByKey = useMemo(
    () => new Map<WorkspaceDrawerView, WorkspaceDrawerViewItem>(workspaceDrawerItems.map(item => [item.key, item])),
    [workspaceDrawerItems]
  )

  const resolveFallbackTab = ({
    fallbackTerminalId,
    excludedIframeId
  }: {
    excludedIframeId?: string
    fallbackTerminalId?: string | null
  } = {}): ActiveInteractionTab | null => {
    const terminalId = fallbackTerminalId === undefined ? bottomTerminalPanes[0]?.id : fallbackTerminalId
    if (terminalId != null) return { kind: 'terminal', id: terminalId }
    const filePath = resolveOpenFilePath(bottomPanel)
    if (filePath != null) return { kind: 'file', path: filePath }
    const iframeId = iframePageState.iframePages.find(page => page.id !== excludedIframeId)?.id
    if (iframeId != null) return { kind: 'iframe', id: iframeId }
    const mobileDebugPageId = mobileDebugPageState.mobileDebugPages[0]?.id
    if (mobileDebugPageId != null) return { kind: 'mobile-debug', id: mobileDebugPageId }
    const sessionPageId = canCreateSessionTab ? sessionPageState.sessionPages[0]?.id : undefined
    if (sessionPageId != null) return { kind: 'session', id: sessionPageId }
    const pluginPageId = pluginPages[0]?.id
    if (pluginPageId != null) return { kind: 'plugin', id: pluginPageId }
    const workspaceDrawerView = workspaceDrawerViews[0]
    return workspaceDrawerView == null ? null : {
      kind: 'workspace-drawer',
      id: toWorkspaceDrawerInteractionTabId(workspaceDrawerView)
    }
  }

  const applyFallbackTab = (fallbackTab: ActiveInteractionTab | null) => {
    setActiveTab(fallbackTab)
  }

  useEffect(() => {
    if (
      activeTab == null || activeTab.kind !== 'terminal' || bottomTerminalPanes.some(pane => pane.id === activeTab.id)
    ) {
      return
    }

    applyFallbackTab(resolveFallbackTab({ fallbackTerminalId: null }))
  }, [activeTab, bottomTerminalPanes])

  useEffect(() => {
    const selectedPath = bottomPanel.selectedWorkspaceFilePath
    if (selectedPath != null && bottomPanel.openWorkspaceFilePaths.includes(selectedPath)) {
      setActiveTab({ kind: 'file', path: selectedPath })
    }
  }, [bottomPanel.openWorkspaceFilePaths, bottomPanel.selectedWorkspaceFilePath])

  useEffect(() => {
    if (activeTab == null || activeTab.kind !== 'file' || bottomPanel.openWorkspaceFilePaths.includes(activeTab.path)) {
      return
    }

    applyFallbackTab(resolveFallbackTab())
  }, [activeTab, bottomPanel.openWorkspaceFilePaths, resolveFallbackTab])

  useEffect(() => {
    setWorkspaceDrawerViews(current => current.filter(view => workspaceDrawerItemByKey.has(view)))
  }, [workspaceDrawerItemByKey])

  const unorderedTabs = useMemo(() => {
    const workspaceDrawerTabs: InteractionPanelTab[] = workspaceDrawerViews.flatMap(view => {
      const item = workspaceDrawerItemByKey.get(view)
      if (item == null) return []

      return [{
        canClose: true as const,
        icon: item.icon,
        id: toWorkspaceDrawerInteractionTabId(view),
        kind: 'workspace-drawer' as const,
        label: item.label,
        view
      }]
    })

    return [
      ...buildInteractionPanelTabs({
        filePaths: bottomPanel.openWorkspaceFilePaths,
        iframePages: iframePageState.iframePages,
        mobileDebugPages: mobileDebugPageState.mobileDebugPages,
        pluginPages,
        sessionPages: canCreateSessionTab ? sessionPageState.sessionPages : [],
        terminalInfoById: terminalPanes.infoById,
        terminalPanes: bottomTerminalPanes
      }),
      ...workspaceDrawerTabs
    ]
  }, [
    bottomPanel.openWorkspaceFilePaths,
    canCreateSessionTab,
    iframePageState.iframePages,
    mobileDebugPageState.mobileDebugPages,
    pluginPages,
    sessionPageState.sessionPages,
    terminalPanes.infoById,
    bottomTerminalPanes,
    workspaceDrawerItemByKey,
    workspaceDrawerViews
  ])
  const { handleMoveTab, tabs } = useInteractionPanelTabOrder({
    tabs: unorderedTabs,
    terminalSessionId
  })

  useEffect(() => {
    if (activeTab == null) return
    const fallbackTab = tabs[0]
    if (fallbackTab == null || containsActiveTab(activeTab, tabs)) return
    setActiveTab(toActiveInteractionTab(fallbackTab))
  }, [activeTab, tabs])

  const activateTab = (tab: InteractionPanelTab) => {
    if (tab.kind === 'terminal') {
      terminalPanes.setActiveTerminalId(tab.id)
      bottomPanel.handleSelectBottomPanelView('terminal')
      setActiveTab({ kind: 'terminal', id: tab.id })
      return
    }

    if (tab.kind === 'file') {
      bottomPanel.handleSelectWorkspaceFile(tab.path)
      setActiveTab({ kind: 'file', path: tab.path })
      return
    }

    bottomPanel.handleSelectBottomPanelView('terminal')
    setActiveTab({ kind: tab.kind, id: tab.id })
  }

  const addTerminal = (
    shellKind?: TerminalShellKind,
    options: {
      initialCommand?: string
      runCommand?: TerminalPaneConfig['runCommand']
      title?: string
    } = {}
  ) => {
    const nextPane = terminalPanes.addTerminal(shellKind, { ...options, surface: 'bottom' })
    bottomPanel.handleSelectBottomPanelView('terminal')
    setActiveTab({ kind: 'terminal', id: nextPane.id })
    return nextPane
  }

  const handleAddMenuClick = ({ key }: { key: string }) => {
    if (key === 'session') {
      if (!canCreateSessionTab) return

      const nextPage = sessionPageState.addSessionPage(
        t('chat.interactionPanel.sessionTitle', { index: sessionPageState.sessionPages.length + 1 })
      )
      bottomPanel.handleSelectBottomPanelView('terminal')
      setActiveTab({ kind: 'session', id: nextPage.id })
      return
    }

    if (key === 'iframe') {
      const nextPage = iframePageState.addIframePage()
      bottomPanel.handleSelectBottomPanelView('terminal')
      setActiveTab({ kind: 'iframe', id: nextPage.id })
      return
    }

    if (
      key === 'mobile-debug' ||
      key === INTERACTION_PANEL_MOBILE_DEBUG_CONFIG_KEY ||
      key === INTERACTION_PANEL_MOBILE_DEBUG_NO_DEVICES_KEY
    ) {
      const nextPage = mobileDebugPageState.addMobileDebugPage(t('chat.interactionPanel.mobileDebugTitle'), {
        mode: 'config',
        selectedDeviceId: undefined,
        selectedDeviceLabel: t('chat.interactionPanel.mobileDebugConfig')
      })
      bottomPanel.handleSelectBottomPanelView('terminal')
      setActiveTab({ kind: 'mobile-debug', id: nextPage.id })
      return
    }

    const mobileDebugDevice = parseInteractionPanelMobileDebugDeviceMenuKey(key)
    if (mobileDebugDevice != null) {
      const device = mobileDebugPageState.mobileDebugPages
        .flatMap(page => page.deviceOptions ?? [])
        .find(option => option.id === mobileDebugDevice.id)
      const nextPage = mobileDebugPageState.addMobileDebugPage(t('chat.interactionPanel.mobileDebugTitle'), {
        mode: 'targets',
        selectedDeviceId: mobileDebugDevice.id,
        selectedDeviceLabel: device?.label ?? mobileDebugDevice.label ?? mobileDebugDevice.id
      })
      bottomPanel.handleSelectBottomPanelView('terminal')
      setActiveTab({ kind: 'mobile-debug', id: nextPage.id })
      return
    }

    addTerminal()
  }

  useEffect(() => {
    setPluginPages((current) => {
      const nextPages = normalizeInteractionPanelPluginPages(current, pluginWorkbenchTabs, language)
      return areInteractionPanelPluginPagesEqual(current, nextPages) ? current : nextPages
    })
  }, [language, pluginWorkbenchTabs])

  const openPluginTab = (scope: string, tabId?: string, options: { fallbackToSingle?: boolean } = {}) => {
    const tab = resolveInteractionPanelPluginTabDefinition({
      fallbackToSingle: options.fallbackToSingle,
      pluginScope: scope,
      tabId,
      tabs: pluginWorkbenchTabs
    })
    if (tab == null) return null
    const nextPage = createInteractionPanelPluginPage(tab, language)
    if (nextPage == null) return null
    bottomPanel.handleSelectBottomPanelView('terminal')
    setPluginPages(current => [...current, nextPage])
    setActiveTab({ kind: 'plugin', id: nextPage.id })
    return nextPage
  }

  const openIframeUrl = (url: string, options?: OpenInteractionPanelIframeUrlOptions) => {
    const nextPage = iframePageState.openIframeUrl(url, options)
    bottomPanel.handleSelectBottomPanelView('terminal')
    setActiveTab({ kind: 'iframe', id: nextPage.id })
    return nextPage
  }

  const openWorkspaceDrawerView = (view: WorkspaceDrawerView) => {
    const item = workspaceDrawerItemByKey.get(view)
    if (item == null) return null

    bottomPanel.handleSelectBottomPanelView('terminal')
    setWorkspaceDrawerViews(current => current.includes(view) ? current : [...current, view])
    setActiveTab({ kind: 'workspace-drawer', id: toWorkspaceDrawerInteractionTabId(view) })
    return item
  }

  const openSessionPage = useCallback((sessionId: string, title: string, options: { focusRequestId?: string } = {}) => {
    if (!canCreateSessionTab) return
    const page = sessionPageState.openSessionPage(sessionId, title, options)
    if (page == null) return
    bottomPanel.handleSelectBottomPanelView('terminal')
    setActiveTab(current =>
      current?.kind === 'session' && current.id === page.id ? current : { kind: 'session', id: page.id }
    )
  }, [bottomPanel.handleSelectBottomPanelView, canCreateSessionTab, sessionPageState.openSessionPage])

  const handleCloseTab = (tab: InteractionPanelTab) => handleCloseTabGroup(tab, 'current')

  const handleCloseTabGroup = (anchorTab: InteractionPanelTab, scope: InteractionPanelTabCloseScope) => {
    const targetTabs = getTabsForCloseScope(tabs, anchorTab, scope)
    if (targetTabs.length <= 0) {
      return
    }

    const closeableTargetTabs = targetTabs.filter(tab => tab.canClose)
    const targetTerminalIds = closeableTargetTabs.filter(tab => tab.kind === 'terminal').map(tab => tab.id)
    const targetIframeIds = new Set(closeableTargetTabs.filter(tab => tab.kind === 'iframe').map(tab => tab.id))
    const targetMobileDebugIds = new Set(
      closeableTargetTabs.filter(tab => tab.kind === 'mobile-debug').map(tab => tab.id)
    )
    const targetSessionPageIds = new Set(closeableTargetTabs.filter(tab => tab.kind === 'session').map(tab => tab.id))
    const targetPluginPageIds = new Set(closeableTargetTabs.filter(tab => tab.kind === 'plugin').map(tab => tab.id))
    const targetWorkspaceDrawerViews = new Set(
      closeableTargetTabs.filter(tab => tab.kind === 'workspace-drawer').map(tab => tab.view)
    )
    terminalPanes.closeTerminals(targetTerminalIds)
    closeWorkspaceFileTabsForScope({ bottomPanel, targetTabs: closeableTargetTabs })
    iframePageState.closeIframePages(targetIframeIds)
    mobileDebugPageState.closeMobileDebugPages(targetMobileDebugIds)
    closeInteractionPanelSessionPages(targetSessionPageIds)
    setPluginPages(current => current.filter(page => !targetPluginPageIds.has(page.id)))
    setWorkspaceDrawerViews(current => current.filter(view => !targetWorkspaceDrawerViews.has(view)))

    if (activeTab != null && containsActiveTab(activeTab, closeableTargetTabs)) {
      const fallbackTab = getFallbackTabAfterClose(tabs, closeableTargetTabs, anchorTab)
      applyFallbackTab(fallbackTab == null ? null : toActiveInteractionTab(fallbackTab))
    }
  }

  return {
    activeTab,
    activateTab,
    addTerminal,
    handleAddMenuClick,
    handleCloseTab,
    handleCloseTabGroup,
    handleIframeMetadataChange: iframePageState.handleIframeMetadataChange,
    handleIframeNavigateHistory: iframePageState.handleIframeNavigateHistory,
    handleIframeSelectHistory: iframePageState.handleIframeSelectHistory,
    handleIframeUrlChange: iframePageState.handleIframeUrlChange,
    handleMoveTab,
    iframePages: iframePageState.iframePages,
    mobileDebugPages: mobileDebugPageState.mobileDebugPages,
    openIframeUrl,
    openPluginTab,
    openSessionPage,
    openWorkspaceDrawerView,
    sessionPages: sessionPageState.sessionPages,
    tabs,
    updateMobileDebugPage: mobileDebugPageState.updateMobileDebugPage,
    updateSessionPage: sessionPageState.updateSessionPage
  }
}
