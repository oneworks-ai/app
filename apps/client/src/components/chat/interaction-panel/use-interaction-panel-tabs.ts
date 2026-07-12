/* eslint-disable max-lines -- tab state bridges persisted session panel tabs with existing panel renderers. */
import type { TFunction } from 'i18next'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import type { Session, SessionPanelTab } from '@oneworks/core'
import type { TerminalShellKind } from '@oneworks/types'

import type { TerminalPaneConfig } from '#~/components/chat/terminal/@utils/terminal-panes'
import { getWorkspaceFileIconMeta } from '#~/components/chat/workspace-drawer/workspace-drawer-icons'
import type { WorkspaceDrawerView } from '#~/components/chat/workspace-drawer/workspace-drawer-types'
import type { WorkspaceDrawerViewItem } from '#~/components/chat/workspace-drawer/workspace-drawer-view-items'
import type { ChatRouteBottomPanelState } from '#~/hooks/chat/use-chat-route-bottom-panel'
import type { PluginContributionWorkbenchTab } from '#~/plugins/plugin-manifest'
import { usePluginSlot } from '#~/plugins/plugin-slots'

import type { InteractionPanelIframePage } from './InteractionPanelIframeView'
import {
  createIframePage,
  navigateIframePageHistory,
  normalizeFrameUrl,
  selectIframePageHistoryIndex,
  updateIframePageMetadata,
  updateIframePageUrl
} from './interaction-panel-iframe-pages'
import type { OpenInteractionPanelIframeUrlOptions } from './interaction-panel-iframe-pages'
import { createInteractionPanelMobileDebugPage } from './interaction-panel-mobile-debug-pages'
import type { InteractionPanelMobileDebugPage } from './interaction-panel-mobile-debug-pages'
import {
  areInteractionPanelPluginPagesEqual,
  createInteractionPanelPluginPage,
  normalizeInteractionPanelPluginPages,
  resolveInteractionPanelPluginTabDefinition
} from './interaction-panel-plugin-pages'
import type { InteractionPanelPluginPage } from './interaction-panel-plugin-pages'
import { createInteractionPanelSessionPage } from './interaction-panel-session-pages'
import type { InteractionPanelSessionPage } from './interaction-panel-session-pages'
import { getFallbackTabAfterClose, getTabsForCloseScope } from './interaction-panel-tab-groups'
import type { InteractionPanelTabCloseScope } from './interaction-panel-tab-groups'
import {
  INTERACTION_PANEL_MOBILE_DEBUG_CONFIG_KEY,
  INTERACTION_PANEL_MOBILE_DEBUG_NO_DEVICES_KEY,
  parseInteractionPanelMobileDebugDeviceMenuKey
} from './interaction-panel-tab-menu'
import type { InteractionPanelTabMovePlacement } from './interaction-panel-tab-order'
import { getFileName, toWorkspaceDrawerInteractionTabId } from './interaction-panel-tabs'
import type { ActiveInteractionTab, InteractionPanelTab } from './interaction-panel-tabs'
import { useCloseInteractionPanelSessionPages } from './use-clear-interaction-panel-session-query'
import type { InteractionTerminalPanesController } from './use-interaction-terminal-panes'
import type { SessionPanelStateController } from './use-session-panel-state'

const PAGE_DEBUGGER_TAB_ID = 'page-debugger'

const terminalShellKinds = new Set<TerminalShellKind>(['default', 'zsh', 'bash', 'sh'])

const isTerminalShellKind = (value: unknown): value is TerminalShellKind =>
  typeof value === 'string' && terminalShellKinds.has(value as TerminalShellKind)

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const getRunCommandIcon = (runCommand: unknown) => {
  if (!isObjectRecord(runCommand)) return undefined
  return typeof runCommand.icon === 'string' && runCommand.icon.trim() !== '' ? runCommand.icon : undefined
}

const getTerminalTabShellKind = (tab: Extract<SessionPanelTab, { kind: 'terminal' }>) =>
  isTerminalShellKind(tab.shellKind) ? tab.shellKind : 'default'

const toPanelActiveTab = (tab: SessionPanelTab): ActiveInteractionTab => {
  if (tab.kind === 'web') return { kind: 'iframe', id: tab.id }
  if (tab.kind === 'file') return { kind: 'file', path: tab.path }
  return { kind: tab.kind, id: tab.id }
}

const toIframePage = (tab: Extract<SessionPanelTab, { kind: 'web' }>): InteractionPanelIframePage => ({
  ...(tab.browserControlRequestId == null ? {} : { browserControlRequestId: tab.browserControlRequestId }),
  ...(tab.deviceToolbarOpen == null ? {} : { deviceToolbarOpen: tab.deviceToolbarOpen }),
  ...(tab.devtoolsDockSide == null ? {} : { devtoolsDockSide: tab.devtoolsDockSide }),
  id: tab.id,
  title: tab.title,
  url: tab.url,
  ...(tab.faviconUrl == null ? {} : { faviconUrl: tab.faviconUrl }),
  ...(tab.history == null ? {} : { history: tab.history }),
  ...(tab.historyIndex == null ? {} : { historyIndex: tab.historyIndex }),
  ...(tab.inspectOpen == null ? {} : { inspectOpen: tab.inspectOpen }),
  ...(tab.viewport == null ? {} : { viewport: tab.viewport }),
  ...(tab.variant == null ? {} : { variant: tab.variant })
})

const toWebPanelTab = (page: InteractionPanelIframePage): Extract<SessionPanelTab, { kind: 'web' }> => ({
  ...(page.browserControlRequestId == null ? {} : { browserControlRequestId: page.browserControlRequestId }),
  ...(page.deviceToolbarOpen == null ? {} : { deviceToolbarOpen: page.deviceToolbarOpen }),
  ...(page.devtoolsDockSide == null ? {} : { devtoolsDockSide: page.devtoolsDockSide }),
  id: page.id,
  kind: 'web',
  title: page.title,
  url: page.url,
  ...(page.faviconUrl == null ? {} : { faviconUrl: page.faviconUrl }),
  ...(page.history == null ? {} : { history: page.history }),
  ...(page.historyIndex == null ? {} : { historyIndex: page.historyIndex }),
  ...(page.inspectOpen == null ? {} : { inspectOpen: page.inspectOpen }),
  ...(page.viewport == null ? {} : { viewport: page.viewport }),
  ...(page.variant == null ? {} : { variant: page.variant })
})

const toMobileDebugPage = (
  tab: Extract<SessionPanelTab, { kind: 'mobile-debug' }>
): InteractionPanelMobileDebugPage => {
  const state = isObjectRecord(tab.state) ? tab.state : {}
  return {
    id: tab.id,
    title: tab.title,
    ...(Array.isArray(state.deviceOptions) ? { deviceOptions: state.deviceOptions as any } : {}),
    ...(state.mode === 'config' || state.mode === 'targets' ? { mode: state.mode } : {}),
    ...(typeof state.selectedDeviceId === 'string' ? { selectedDeviceId: state.selectedDeviceId } : {}),
    ...(typeof state.selectedDeviceLabel === 'string' ? { selectedDeviceLabel: state.selectedDeviceLabel } : {})
  }
}

const toMobileDebugPanelTab = (
  page: InteractionPanelMobileDebugPage
): Extract<SessionPanelTab, { kind: 'mobile-debug' }> => ({
  id: page.id,
  kind: 'mobile-debug',
  title: page.title,
  state: {
    ...(page.deviceOptions == null ? {} : { deviceOptions: page.deviceOptions }),
    ...(page.mode == null ? {} : { mode: page.mode }),
    ...(page.selectedDeviceId == null ? {} : { selectedDeviceId: page.selectedDeviceId }),
    ...(page.selectedDeviceLabel == null ? {} : { selectedDeviceLabel: page.selectedDeviceLabel })
  }
})

const toSessionPage = (tab: Extract<SessionPanelTab, { kind: 'session' }>): InteractionPanelSessionPage => ({
  id: tab.id,
  title: tab.title,
  ...(tab.focusRequestId == null ? {} : { focusRequestId: tab.focusRequestId }),
  ...(tab.sessionId == null ? {} : { sessionId: tab.sessionId })
})

const toSessionPanelTab = (page: InteractionPanelSessionPage): Extract<SessionPanelTab, { kind: 'session' }> => ({
  id: page.id,
  kind: 'session',
  title: page.title,
  ...(page.focusRequestId == null ? {} : { focusRequestId: page.focusRequestId }),
  ...(page.sessionId == null ? {} : { sessionId: page.sessionId })
})

const toPluginPage = (tab: Extract<SessionPanelTab, { kind: 'plugin' }>): InteractionPanelPluginPage => ({
  icon: tab.icon ?? 'layers',
  id: tab.id,
  pluginScope: tab.pluginScope,
  tabId: tab.tabId,
  title: tab.title,
  viewId: tab.viewId
})

const toPluginPanelTab = (
  page: InteractionPanelPluginPage,
  previous?: Extract<SessionPanelTab, { kind: 'plugin' }>
): Extract<SessionPanelTab, { kind: 'plugin' }> => ({
  id: page.id,
  kind: 'plugin',
  icon: page.icon,
  pluginScope: page.pluginScope,
  tabId: page.tabId,
  title: page.title,
  viewId: page.viewId,
  ...(previous?.state === undefined ? {} : { state: previous.state }),
  ...(previous?.stateVersion == null ? {} : { stateVersion: previous.stateVersion })
})

const toInteractionTab = ({
  tab,
  terminalInfoById,
  workspaceDrawerItemByKey
}: {
  tab: SessionPanelTab
  terminalInfoById: InteractionTerminalPanesController['infoById']
  workspaceDrawerItemByKey: Map<WorkspaceDrawerView, WorkspaceDrawerViewItem>
}): InteractionPanelTab | null => {
  if (tab.kind === 'terminal') {
    return {
      canClose: true,
      icon: getRunCommandIcon(tab.runCommand) ?? (terminalInfoById[tab.terminalId]?.isExited === true
        ? 'terminal_off'
        : 'terminal'),
      id: tab.id,
      kind: 'terminal',
      label: tab.title,
      shellKind: getTerminalTabShellKind(tab)
    }
  }

  if (tab.kind === 'file') {
    return {
      canClose: true,
      icon: getWorkspaceFileIconMeta(getFileName(tab.path)).icon,
      id: tab.id,
      kind: 'file',
      label: tab.title,
      path: tab.path
    }
  }

  if (tab.kind === 'web') {
    return {
      canClose: true,
      faviconUrl: tab.faviconUrl,
      icon: 'language',
      id: tab.id,
      kind: 'iframe',
      label: tab.title
    }
  }

  if (tab.kind === 'mobile-debug') {
    const page = toMobileDebugPage(tab)
    return {
      canClose: true,
      icon: 'phonelink_setup',
      id: tab.id,
      kind: 'mobile-debug',
      label: page.selectedDeviceLabel == null ? page.title : `${page.title} / ${page.selectedDeviceLabel}`
    }
  }

  if (tab.kind === 'page-debugger') {
    return {
      canClose: true,
      icon: 'data_object',
      id: tab.id,
      kind: 'page-debugger',
      label: tab.title
    }
  }

  if (tab.kind === 'session') {
    return {
      canClose: true,
      icon: 'chat',
      id: tab.id,
      kind: 'session',
      label: tab.title,
      sessionId: tab.sessionId
    }
  }

  if (tab.kind === 'plugin') {
    return {
      canClose: true,
      icon: tab.icon ?? 'layers',
      id: tab.id,
      kind: 'plugin',
      label: tab.title,
      pluginScope: tab.pluginScope,
      ...(tab.state === undefined ? {} : { state: tab.state }),
      ...(tab.stateVersion == null ? {} : { stateVersion: tab.stateVersion }),
      tabId: tab.tabId,
      viewId: tab.viewId
    }
  }

  const item = workspaceDrawerItemByKey.get(tab.view as WorkspaceDrawerView)
  if (item == null) return null
  return {
    canClose: true,
    icon: item.icon,
    id: tab.id,
    kind: 'workspace-drawer',
    label: item.label,
    view: tab.view as WorkspaceDrawerView
  }
}

const moveTabs = (
  tabs: SessionPanelTab[],
  sourceId: string,
  targetId: string,
  placement: InteractionPanelTabMovePlacement
) => {
  if (sourceId === targetId) return tabs
  const sourceIndex = tabs.findIndex(tab => tab.id === sourceId)
  const targetIndex = tabs.findIndex(tab => tab.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0) return tabs

  const nextTabs = [...tabs]
  const [sourceTab] = nextTabs.splice(sourceIndex, 1)
  if (sourceTab == null) return tabs
  const nextTargetIndex = nextTabs.findIndex(tab => tab.id === targetId)
  if (nextTargetIndex < 0) return tabs
  nextTabs.splice(nextTargetIndex + (placement === 'after' ? 1 : 0), 0, sourceTab)
  return nextTabs
}

export function useInteractionPanelTabs({
  bottomPanel,
  canCreateSessionTab,
  language,
  panelStateController,
  session,
  terminalPanes,
  workspaceDrawerItems = [],
  t
}: {
  bottomPanel: ChatRouteBottomPanelState
  canCreateSessionTab: boolean
  language: string
  panelStateController: SessionPanelStateController
  session?: Session
  terminalPanes: InteractionTerminalPanesController
  terminalSessionId: string
  workspaceDrawerItems?: WorkspaceDrawerViewItem[]
  t: TFunction
}) {
  const location = useLocation()
  const { panelState, updateArea } = panelStateController
  const bottomArea = panelState.bottom
  const panelTabs = bottomArea.tabs
  const [runtimeActiveTabId, setRuntimeActiveTabId] = useState<string | null>(null)
  const consumedBottomTabOverrideKeyRef = useRef<string | null>(null)
  const bottomTabOverride = useMemo(() => {
    const value = new URLSearchParams(location.search).get('bottomTab')?.trim()
    return value == null || value === '' ? undefined : value
  }, [location.search])
  const pluginWorkbenchTabs = usePluginSlot<PluginContributionWorkbenchTab>('workbench.tabs')
  const workspaceDrawerItemByKey = useMemo(
    () => new Map<WorkspaceDrawerView, WorkspaceDrawerViewItem>(workspaceDrawerItems.map(item => [item.key, item])),
    [workspaceDrawerItems]
  )
  const iframePages = useMemo(() =>
    panelTabs
      .filter((tab): tab is Extract<SessionPanelTab, { kind: 'web' }> => tab.kind === 'web')
      .map(toIframePage), [panelTabs])
  const mobileDebugPages = useMemo(() =>
    panelTabs
      .filter((tab): tab is Extract<SessionPanelTab, { kind: 'mobile-debug' }> => tab.kind === 'mobile-debug')
      .map(toMobileDebugPage), [panelTabs])
  const sessionPages = useMemo(() =>
    panelTabs
      .filter((tab): tab is Extract<SessionPanelTab, { kind: 'session' }> => tab.kind === 'session')
      .map(toSessionPage), [panelTabs])
  const pluginPages = useMemo(() =>
    panelTabs
      .filter((tab): tab is Extract<SessionPanelTab, { kind: 'plugin' }> => tab.kind === 'plugin')
      .map(toPluginPage), [panelTabs])
  const tabs = useMemo(() =>
    panelTabs
      .map(tab => toInteractionTab({ tab, terminalInfoById: terminalPanes.infoById, workspaceDrawerItemByKey }))
      .filter((tab): tab is InteractionPanelTab => tab != null), [
    panelTabs,
    terminalPanes.infoById,
    workspaceDrawerItemByKey
  ])
  useEffect(() => {
    const sessionKey = session?.id ?? ''
    if (bottomTabOverride == null) {
      if (consumedBottomTabOverrideKeyRef.current !== sessionKey) {
        consumedBottomTabOverrideKeyRef.current = sessionKey
        setRuntimeActiveTabId(null)
      }
      return
    }

    const overrideKey = `${sessionKey}:${bottomTabOverride}`
    if (consumedBottomTabOverrideKeyRef.current === overrideKey) return
    if (panelTabs.length <= 0) return
    consumedBottomTabOverrideKeyRef.current = overrideKey
    setRuntimeActiveTabId(panelTabs.some(tab => tab.id === bottomTabOverride) ? bottomTabOverride : null)
  }, [bottomTabOverride, panelTabs, session?.id])

  const activePanelTab = panelTabs.find(tab => tab.id === runtimeActiveTabId) ??
    panelTabs.find(tab => tab.id === bottomArea.activeTabId) ??
    panelTabs[0]
  const activeTab = activePanelTab == null ? null : toPanelActiveTab(activePanelTab)

  const updateBottomArea = useCallback((
    updater: (tabs: SessionPanelTab[], activeTabId?: string) => {
      activeTabId?: string
      tabs: SessionPanelTab[]
    }
  ) => {
    updateArea('bottom', (area) => {
      const next = updater(area.tabs, area.activeTabId)
      return {
        ...(area.layout == null ? {} : { layout: area.layout }),
        tabs: next.tabs,
        ...(next.activeTabId == null ? {} : { activeTabId: next.activeTabId })
      }
    })
  }, [updateArea])

  const activateTabById = useCallback((tabId: string) => {
    setRuntimeActiveTabId(null)
    updateBottomArea(current => ({
      tabs: current,
      activeTabId: tabId
    }))
  }, [updateBottomArea])

  const upsertPanelTab = useCallback((tab: SessionPanelTab) => {
    updateBottomArea((current) => {
      const existingIndex = current.findIndex(item => item.id === tab.id)
      const tabs = existingIndex < 0
        ? [...current, tab]
        : current.map(item => item.id === tab.id ? tab : item)
      return { tabs, activeTabId: tab.id }
    })
  }, [updateBottomArea])

  const closeInteractionPanelSessionPages = useCloseInteractionPanelSessionPages({
    closeSessionPages: () => undefined,
    sessionPages
  })

  useEffect(() => {
    const nextPages = normalizeInteractionPanelPluginPages(pluginPages, pluginWorkbenchTabs, language)
    if (areInteractionPanelPluginPagesEqual(pluginPages, nextPages)) return

    updateBottomArea((current, activeTabId) => {
      const nextPageById = new Map(nextPages.map(page => [page.id, page]))
      const tabs = current.flatMap((tab): SessionPanelTab[] => {
        if (tab.kind !== 'plugin') return [tab]
        const nextPage = nextPageById.get(tab.id)
        return nextPage == null ? [] : [toPluginPanelTab(nextPage, tab)]
      })
      return {
        tabs,
        activeTabId: activeTabId != null && tabs.some(tab => tab.id === activeTabId) ? activeTabId : tabs[0]?.id
      }
    })
  }, [language, pluginPages, pluginWorkbenchTabs, updateBottomArea])

  const activateTab = (tab: InteractionPanelTab) => {
    if (tab.kind === 'terminal') {
      terminalPanes.setActiveTerminalId(tab.id)
      bottomPanel.handleSelectBottomPanelView('terminal')
      activateTabById(tab.id)
      return
    }

    if (tab.kind === 'file') {
      bottomPanel.handleSelectWorkspaceFile(tab.path)
      activateTabById(tab.id)
      return
    }

    bottomPanel.handleSelectBottomPanelView('terminal')
    activateTabById(tab.id)
  }

  const openWorkspaceFile = (path: string) => {
    const tab: SessionPanelTab = {
      id: `file:${path}`,
      kind: 'file',
      path,
      title: getFileName(path)
    }
    bottomPanel.handleOpenWorkspaceFile(path)
    upsertPanelTab(tab)
    return tab
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
    upsertPanelTab({
      id: nextPane.id,
      kind: 'terminal',
      terminalId: nextPane.id,
      title: nextPane.title,
      ...(nextPane.runCommand == null ? {} : { runCommand: nextPane.runCommand }),
      ...(nextPane.shellKind == null ? {} : { shellKind: nextPane.shellKind })
    })
    return nextPane
  }

  const handleAddMenuClick = ({ key }: { key: string }) => {
    if (key === 'session') {
      if (!canCreateSessionTab) return

      const nextPage = createInteractionPanelSessionPage(
        t('chat.interactionPanel.sessionTitle', { index: sessionPages.length + 1 })
      )
      bottomPanel.handleSelectBottomPanelView('terminal')
      upsertPanelTab(toSessionPanelTab(nextPage))
      return
    }

    if (key === 'iframe') {
      const nextPage = createIframePage(t('chat.interactionPanel.iframeTitle', { index: iframePages.length + 1 }))
      bottomPanel.handleSelectBottomPanelView('terminal')
      upsertPanelTab(toWebPanelTab(nextPage))
      return
    }

    if (key === 'page-debugger') {
      bottomPanel.handleSelectBottomPanelView('terminal')
      upsertPanelTab({
        id: PAGE_DEBUGGER_TAB_ID,
        kind: 'page-debugger',
        title: t('chat.interactionPanel.pageDebuggerListTitle')
      })
      return
    }

    if (
      key === 'mobile-debug' ||
      key === INTERACTION_PANEL_MOBILE_DEBUG_CONFIG_KEY ||
      key === INTERACTION_PANEL_MOBILE_DEBUG_NO_DEVICES_KEY
    ) {
      const existingPage = mobileDebugPages[0]
      const nextPage = {
        ...(existingPage ?? createInteractionPanelMobileDebugPage(t('chat.interactionPanel.mobileDebugTitle'))),
        mode: 'config' as const,
        selectedDeviceId: undefined,
        selectedDeviceLabel: t('chat.interactionPanel.mobileDebugConfig')
      }
      bottomPanel.handleSelectBottomPanelView('terminal')
      upsertPanelTab(toMobileDebugPanelTab(nextPage))
      return
    }

    const mobileDebugDevice = parseInteractionPanelMobileDebugDeviceMenuKey(key)
    if (mobileDebugDevice != null) {
      const existingPage = mobileDebugPages[0]
      const device = mobileDebugPages
        .flatMap(page => page.deviceOptions ?? [])
        .find(option => option.id === mobileDebugDevice.id)
      const nextPage = {
        ...(existingPage ?? createInteractionPanelMobileDebugPage(t('chat.interactionPanel.mobileDebugTitle'))),
        mode: 'targets' as const,
        selectedDeviceId: mobileDebugDevice.id,
        selectedDeviceLabel: device?.label ?? mobileDebugDevice.label ?? mobileDebugDevice.id
      }
      bottomPanel.handleSelectBottomPanelView('terminal')
      upsertPanelTab(toMobileDebugPanelTab(nextPage))
      return
    }

    addTerminal()
  }

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
    upsertPanelTab(toPluginPanelTab(nextPage))
    return nextPage
  }

  const openIframeUrl = (url: string, options: OpenInteractionPanelIframeUrlOptions = {}) => {
    const normalizedUrl = normalizeFrameUrl(url)
    const optionFaviconUrl = options.faviconUrl?.trim()
    const optionTitle = options.title?.trim()
    const existingTab = options.openMode === 'new-tab'
      ? undefined
      : panelTabs.find((tab): tab is Extract<SessionPanelTab, { kind: 'web' }> =>
        tab.kind === 'web' && normalizeFrameUrl(tab.url) === normalizedUrl
      )

    if (existingTab != null) {
      const existingPage = toIframePage(existingTab)
      const shouldUpdateFavicon = options.variant === 'mobile-debug-devtools'
        ? existingPage.faviconUrl !== optionFaviconUrl
        : optionFaviconUrl != null && optionFaviconUrl !== '' && existingPage.faviconUrl !== optionFaviconUrl
      const nextPage = {
        ...existingPage,
        ...(options.browserControlRequestId == null
          ? {}
          : { browserControlRequestId: options.browserControlRequestId }),
        ...(shouldUpdateFavicon ? { faviconUrl: optionFaviconUrl } : {}),
        ...(optionTitle == null || optionTitle === '' ? {} : { title: optionTitle }),
        ...(options.variant == null ? {} : { variant: options.variant })
      }
      const nextTab = toWebPanelTab(nextPage)
      if (nextTab !== existingTab) upsertPanelTab(nextTab)
      bottomPanel.handleSelectBottomPanelView('terminal')
      activateTabById(existingTab.id)
      return nextPage
    }

    const nextPage = updateIframePageUrl(
      createIframePage(
        optionTitle || t('chat.interactionPanel.iframeTitle', { index: iframePages.length + 1 }),
        options
      ),
      normalizedUrl
    )
    bottomPanel.handleSelectBottomPanelView('terminal')
    upsertPanelTab(toWebPanelTab(nextPage))
    return nextPage
  }

  const openWorkspaceDrawerView = (view: WorkspaceDrawerView) => {
    const item = workspaceDrawerItemByKey.get(view)
    if (item == null) return null

    bottomPanel.handleSelectBottomPanelView('terminal')
    upsertPanelTab({
      id: toWorkspaceDrawerInteractionTabId(view),
      kind: 'workspace-drawer',
      title: item.label,
      view
    })
    return item
  }

  const openSessionPage = useCallback((sessionId: string, title: string, options: { focusRequestId?: string } = {}) => {
    if (!canCreateSessionTab) return
    const existingPage = sessionPages.find(page => page.sessionId === sessionId)
    const page = existingPage ?? createInteractionPanelSessionPage(title, sessionId, options.focusRequestId)
    const nextPage = {
      ...page,
      ...(options.focusRequestId == null ? {} : { focusRequestId: options.focusRequestId }),
      title
    }
    bottomPanel.handleSelectBottomPanelView('terminal')
    upsertPanelTab(toSessionPanelTab(nextPage))
  }, [bottomPanel, canCreateSessionTab, sessionPages, upsertPanelTab])

  const handleCloseTab = (tab: InteractionPanelTab) => handleCloseTabGroup(tab, 'current')

  const handleCloseWorkspaceFilePaths = (paths: string[]) => {
    const pathSet = new Set(paths.filter(path => path.trim() !== ''))
    if (pathSet.size <= 0) return

    bottomPanel.handleCloseWorkspaceFileTabs([...pathSet])
    updateBottomArea((current, activeTabId) => {
      const firstClosedIndex = current.findIndex(tab => tab.kind === 'file' && pathSet.has(tab.path))
      const targetIds = new Set(
        current
          .filter(tab => tab.kind === 'file' && pathSet.has(tab.path))
          .map(tab => tab.id)
      )
      const nextTabs = current.filter(tab => !targetIds.has(tab.id))
      const nextActiveTabId = activeTabId != null && !targetIds.has(activeTabId)
        ? activeTabId
        : nextTabs[Math.min(Math.max(firstClosedIndex, 0), nextTabs.length - 1)]?.id
      return {
        tabs: nextTabs,
        ...(nextActiveTabId == null ? {} : { activeTabId: nextActiveTabId })
      }
    })
  }

  const handleSelectWorkspaceFilePath = (path: string) => {
    const existingTab = panelTabs.find((tab): tab is Extract<SessionPanelTab, { kind: 'file' }> =>
      tab.kind === 'file' && tab.path === path
    )
    if (existingTab == null) {
      openWorkspaceFile(path)
      return
    }

    bottomPanel.handleSelectWorkspaceFile(path)
    activateTabById(existingTab.id)
  }

  const handleCloseTabGroup = (anchorTab: InteractionPanelTab, scope: InteractionPanelTabCloseScope) => {
    const targetTabs = getTabsForCloseScope(tabs, anchorTab, scope)
    if (targetTabs.length <= 0) return

    const closeableTargetTabs = targetTabs.filter(tab => tab.canClose)
    const targetIds = new Set(closeableTargetTabs.map(tab => tab.id))
    const targetTerminalIds = closeableTargetTabs.filter(tab => tab.kind === 'terminal').map(tab => tab.id)
    const targetSessionPageIds = new Set(closeableTargetTabs.filter(tab => tab.kind === 'session').map(tab => tab.id))
    const targetFilePaths = closeableTargetTabs
      .filter((tab): tab is Extract<InteractionPanelTab, { kind: 'file' }> => tab.kind === 'file')
      .map(tab => tab.path)
    terminalPanes.closeTerminals(targetTerminalIds)
    bottomPanel.handleCloseWorkspaceFileTabs(targetFilePaths)
    closeInteractionPanelSessionPages(targetSessionPageIds)

    const fallbackTab = getFallbackTabAfterClose(tabs, closeableTargetTabs, anchorTab)
    updateBottomArea(current => {
      const nextTabs = current.filter(tab => !targetIds.has(tab.id))
      return {
        tabs: nextTabs,
        activeTabId: fallbackTab == null || targetIds.has(fallbackTab.id) ? nextTabs[0]?.id : fallbackTab.id
      }
    })
  }

  const handleMoveTab = useCallback((
    sourceId: string,
    targetId: string,
    placement: InteractionPanelTabMovePlacement
  ) => {
    updateBottomArea((current, activeTabId) => ({
      tabs: moveTabs(current, sourceId, targetId, placement),
      activeTabId
    }))
  }, [updateBottomArea])

  const updateWebTab = (
    pageId: string,
    updater: (page: InteractionPanelIframePage) => InteractionPanelIframePage
  ) => {
    updateBottomArea((current, activeTabId) => ({
      tabs: current.map(tab =>
        tab.kind === 'web' && tab.id === pageId ? toWebPanelTab(updater(toIframePage(tab))) : tab
      ),
      activeTabId
    }))
  }

  return {
    activeTab,
    activateTab,
    addTerminal,
    handleAddMenuClick,
    handleCloseTab,
    handleCloseTabGroup,
    handleCloseWorkspaceFilePaths,
    handleIframeMetadataChange: (pageId: string, metadata: { faviconUrl?: string; title?: string }) =>
      updateWebTab(pageId, page => updateIframePageMetadata(page, metadata)),
    handleIframeNavigateHistory: (pageId: string, delta: -1 | 1) =>
      updateWebTab(pageId, page => navigateIframePageHistory(page, delta)),
    handleIframeSelectHistory: (pageId: string, index: number) =>
      updateWebTab(pageId, page => selectIframePageHistoryIndex(page, index)),
    handleIframeUrlChange: (pageId: string, url: string) =>
      updateWebTab(pageId, page => updateIframePageUrl(page, url)),
    handleIframePageChange: (
      pageId: string,
      updater: (page: InteractionPanelIframePage) => InteractionPanelIframePage
    ) => updateWebTab(pageId, updater),
    handleMoveTab,
    iframePages,
    mobileDebugPages,
    openIframeUrl,
    openPluginTab,
    openSessionPage,
    openWorkspaceDrawerView,
    openWorkspaceFile,
    handleSelectWorkspaceFilePath,
    sessionPages,
    tabs,
    updatePluginTabState: (tabId: string, state: unknown) => {
      updateBottomArea((current, activeTabId) => ({
        tabs: current.map(tab => tab.kind === 'plugin' && tab.id === tabId ? { ...tab, state } : tab),
        activeTabId
      }))
    },
    updateMobileDebugPage: (
      pageId: string,
      updater: (page: InteractionPanelMobileDebugPage) => InteractionPanelMobileDebugPage
    ) => {
      updateBottomArea((current, activeTabId) => ({
        tabs: current.map(tab =>
          tab.kind === 'mobile-debug' && tab.id === pageId
            ? toMobileDebugPanelTab(updater(toMobileDebugPage(tab)))
            : tab
        ),
        activeTabId
      }))
    },
    updateSessionPage: (
      pageId: string,
      updater: (page: InteractionPanelSessionPage) => InteractionPanelSessionPage
    ) => {
      updateBottomArea((current, activeTabId) => ({
        tabs: current.map(tab =>
          tab.kind === 'session' && tab.id === pageId ? toSessionPanelTab(updater(toSessionPage(tab))) : tab
        ),
        activeTabId
      }))
    }
  }
}
