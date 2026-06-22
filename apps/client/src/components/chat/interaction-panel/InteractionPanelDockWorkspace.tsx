/* eslint-disable max-lines -- Chat dock business bindings stay colocated while common chrome lives in RouteContainerPanelDockWorkspace. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { App } from 'antd'

import { buildWorkbenchCreateMenuItems, toWorkbenchDrawerViewMenuKey } from '#~/components/chat/workbench-create-menu'
import type {
  WorkspaceFileCodeCommentDraftState
} from '#~/components/chat/workspace-file-editor/workspace-file-code-comment-controller'
import { isWorkspaceMarkdownPreviewPath } from '#~/components/chat/workspace-file-editor/workspace-file-editor-language'
import type {
  WorkspaceMarkdownPreviewMode
} from '#~/components/chat/workspace-file-editor/workspace-file-editor-language'
import { RouteContainerPanelDockWorkspace } from '#~/components/layout/RouteContainerPanelTabs'
import type {
  RouteContainerPanelDockActionItem,
  RouteContainerPanelDockChromeActionsConfig,
  RouteContainerPanelDockTabItem,
  RouteContainerPanelTabMenuContext
} from '#~/components/layout/RouteContainerPanelTabs'
import type { PluginContributionWorkbenchAddMenuItem } from '#~/plugins/plugin-manifest'
import { usePluginSlot } from '#~/plugins/plugin-slots'

import { InteractionPanelDockPanelContentBody } from './InteractionPanelDockPanelContent'
import type { InteractionPanelDockWorkspaceProps } from './InteractionPanelDockWorkspace.types'
import { InteractionPanelDockContext } from './interaction-panel-dock-context'
import { buildInteractionPanelDockTabContextMenuItems } from './interaction-panel-dock-tab-context-menu'
import { getTabsForCloseScope } from './interaction-panel-tab-groups'
import type { InteractionPanelTabCloseScope } from './interaction-panel-tab-groups'
import { buildInteractionPanelTabHeaderActions } from './interaction-panel-tab-header-actions'
import { isActiveTab } from './interaction-panel-tabs'
import type { InteractionPanelTab } from './interaction-panel-tabs'
import { useCopyTextWithFeedback } from './use-copy-text-with-feedback'
import { useInteractionPanelMobileDebugDeviceOptions } from './use-interaction-panel-mobile-debug-device-options'

const MARKDOWN_PREVIEW_MODE_OPTIONS: Array<{
  icon: string
  mode: WorkspaceMarkdownPreviewMode
  titleKey: string
}> = [
  { icon: 'code', mode: 'editor', titleKey: 'chat.interactionPanel.markdownEditorMode' },
  { icon: 'vertical_split', mode: 'split', titleKey: 'chat.interactionPanel.markdownSplitMode' },
  { icon: 'article', mode: 'preview', titleKey: 'chat.interactionPanel.markdownPreviewMode' }
]

export function InteractionPanelDockWorkspace({
  activeTab,
  activeSessionFocusRequestId,
  activeSessionFocusSessionId,
  bottomPanel,
  canCreateSessionTab,
  canFullscreenPanel,
  canPinMoreTabs,
  iframePages,
  isPanelFullscreen,
  isPanelMinimized,
  isVisible,
  layout,
  markdownPreviewMode,
  mobileDebugPages,
  pinnedTabs,
  projectUrlHistoryKey,
  sessionId,
  sessionPages,
  sessionUrlHistoryKey,
  tabs,
  terminalPanes,
  terminalSessionId,
  workspaceDrawerCreateItems,
  workspaceDrawerCreateSelectedKeys,
  workspaceDrawerState,
  workspaceFileFocusRequest,
  workspaceRootPath,
  openResourceShortcut,
  getTabHeaderActions,
  onAddMenuClick,
  onActivateTab,
  onCloseTab,
  onCloseTabGroup,
  onCloseWorkspaceFilePaths,
  onEditPinnedTab,
  onIframeMetadataChange,
  onIframeNavigateHistory,
  onIframeSelectHistory,
  onIframeUrlChange,
  onLayoutChange,
  onLocateWorkspacePath,
  onMarkdownPreviewModeChange,
  onMobileDebugPageChange,
  onNewSession,
  onNewTerminal,
  onOpenIframeUrl,
  onPanelExpand,
  onPanelClose,
  onPanelAction,
  onPinTab,
  onPluginTabStateChange,
  onRunCommand,
  onReferenceAnnotations,
  onReferenceFileComments,
  hasPendingAnnotationReferences,
  pendingAnnotationPreview,
  pendingAnnotations,
  pendingFileComments,
  onSelectWorkspaceFilePath,
  onSessionPageChange,
  onTogglePanelFullscreen,
  onUnpinTab
}: InteractionPanelDockWorkspaceProps) {
  const { i18n, t } = useTranslation()
  const { message, modal } = App.useApp()
  const [fileCommentDraftStateByPath, setFileCommentDraftStateByPath] = useState<
    Record<string, WorkspaceFileCodeCommentDraftState>
  >({})
  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
  const tabById = useMemo(() => Object.fromEntries(tabs.map(tab => [tab.id, tab])), [tabs])
  const iframePageById = useMemo(() => Object.fromEntries(iframePages.map(page => [page.id, page])), [iframePages])
  const pinnedTabById = useMemo(() => Object.fromEntries(pinnedTabs.map(tab => [tab.id, tab])), [pinnedTabs])
  const mobileDebugPage = mobileDebugPages[0]
  const { deviceOptions, refreshDeviceOptions } = useInteractionPanelMobileDebugDeviceOptions(
    mobileDebugPage?.deviceOptions
  )
  const pluginAddMenuItems = usePluginSlot<PluginContributionWorkbenchAddMenuItem>('workbench.addMenu')
  const pluginLanguage = i18n.resolvedLanguage ?? i18n.language
  const addMenuItems = useMemo(
    () =>
      buildWorkbenchCreateMenuItems(t, isMac, {
        canCreateSessionTab,
        language: pluginLanguage,
        mobileDebugDevices: deviceOptions,
        openResourceShortcut,
        pluginMenuItems: pluginAddMenuItems,
        selectedMobileDebugDeviceId: mobileDebugPage?.selectedDeviceId,
        workspaceDrawerItems: workspaceDrawerCreateItems
      }),
    [
      canCreateSessionTab,
      deviceOptions,
      isMac,
      mobileDebugPage?.selectedDeviceId,
      openResourceShortcut,
      pluginAddMenuItems,
      pluginLanguage,
      t,
      workspaceDrawerCreateItems
    ]
  )
  const copyContextText = useCopyTextWithFeedback(t('common.copyFailed'), message)
  const activeTabId = useMemo(() => tabs.find(tab => isActiveTab(tab, activeTab))?.id ?? tabs[0]?.id ?? null, [
    activeTab,
    tabs
  ])
  const createMenuSelectedKeys = useMemo(() => [
    ...(workspaceDrawerCreateSelectedKeys ?? []),
    ...tabs
      .filter((tab): tab is Extract<InteractionPanelDockWorkspaceProps['tabs'][number], { kind: 'workspace-drawer' }> =>
        tab.kind === 'workspace-drawer'
      )
      .map(tab => toWorkbenchDrawerViewMenuKey(tab.view))
  ], [tabs, workspaceDrawerCreateSelectedKeys])
  useEffect(() => {
    const openFilePaths = new Set(
      tabs
        .filter((tab): tab is Extract<InteractionPanelDockWorkspaceProps['tabs'][number], { kind: 'file' }> =>
          tab.kind === 'file'
        )
        .map(tab => tab.path)
    )
    setFileCommentDraftStateByPath((previous) => {
      const nextEntries = Object.entries(previous).filter(([path]) => openFilePaths.has(path))
      if (nextEntries.length === Object.keys(previous).length) return previous
      return Object.fromEntries(nextEntries)
    })
  }, [tabs])
  const handleWorkspaceFileCommentDraftStateChange = useCallback((
    path: string,
    state: WorkspaceFileCodeCommentDraftState
  ) => {
    setFileCommentDraftStateByPath((previous) => {
      const previousState = previous[path]
      if (previousState?.hasContent === state.hasContent && previousState.hasDraft === state.hasDraft) {
        return previous
      }
      if (!state.hasDraft) {
        if (previousState == null) return previous
        const nextState = { ...previous }
        delete nextState[path]
        return nextState
      }
      return {
        ...previous,
        [path]: state
      }
    })
  }, [])
  const confirmFileCommentDraftClose = useCallback((targetTabs: InteractionPanelTab[], action: () => void) => {
    const targetFileDraftStates = targetTabs
      .filter((tab): tab is Extract<InteractionPanelTab, { kind: 'file' }> => tab.kind === 'file')
      .map(tab => fileCommentDraftStateByPath[tab.path])
      .filter((state): state is WorkspaceFileCodeCommentDraftState => state?.hasDraft === true)

    if (targetFileDraftStates.length === 0) {
      return false
    }

    modal.confirm({
      title: t('chat.fileComments.discardDraftTitle'),
      content: targetFileDraftStates.some(state => state.hasContent)
        ? t('chat.fileComments.discardDraftContent')
        : t('chat.fileComments.discardDraftEmptyContent'),
      okText: t('chat.fileComments.discardDraftOk'),
      cancelText: t('common.cancel'),
      onOk: action
    })
    return true
  }, [fileCommentDraftStateByPath, modal, t])
  const runWithFileCommentDraftCloseGuard = useCallback((
    targetTabs: InteractionPanelTab[],
    action: () => void
  ) => {
    if (!confirmFileCommentDraftClose(targetTabs, action)) {
      action()
    }
  }, [confirmFileCommentDraftClose])
  const dockTabs = useMemo<Array<RouteContainerPanelDockTabItem<string>>>(() =>
    tabs.map(tab => {
      const pinnedTab = pinnedTabById[tab.id]
      const title = pinnedTab?.title ?? tab.label
      const showFavicon = tab.kind === 'iframe' && tab.faviconUrl != null && tab.faviconUrl !== '' &&
        pinnedTab?.customIcon == null

      return {
        activeIcon: pinnedTab?.icon ?? tab.icon,
        content: ({ isVisible: isTabVisible }) => (
          <InteractionPanelDockPanelContentBody isPanelVisible={isTabVisible} tabId={tab.id} />
        ),
        icon: pinnedTab?.icon ?? tab.icon,
        iconNode: showFavicon
          ? (
            <img
              className='chat-interaction-panel__dock-tab-favicon'
              src={tab.faviconUrl}
              alt=''
              draggable={false}
            />
          )
          : undefined,
        key: tab.id,
        label: title,
        title: pinnedTab?.originalTitle ?? title
      }
    }), [pinnedTabById, tabs])
  const fullscreenLabel = isPanelFullscreen ? t('common.exitFullscreen') : t('common.enterFullscreen')
  const panelMinimizeLabel = t(
    isPanelMinimized ? 'chat.interactionPanel.expandPanel' : 'chat.interactionPanel.minimizePanel'
  )
  const panelCloseLabel = t('chat.interactionPanel.hidePanel')
  const panelChromeActions = useMemo<RouteContainerPanelDockChromeActionsConfig>(() => ({
    ...(canFullscreenPanel
      ? {
        fullscreen: {
          active: isPanelFullscreen,
          label: fullscreenLabel,
          onSelect: onTogglePanelFullscreen
        }
      }
      : {}),
    minimize: {
      icon: isPanelMinimized ? 'bottom_panel_open' : 'bottom_panel_close',
      label: panelMinimizeLabel,
      onSelect: isPanelMinimized ? onPanelExpand : onPanelAction
    },
    close: {
      label: panelCloseLabel,
      onSelect: onPanelClose
    }
  }), [
    canFullscreenPanel,
    fullscreenLabel,
    isPanelFullscreen,
    isPanelMinimized,
    panelCloseLabel,
    onPanelClose,
    onPanelExpand,
    onPanelAction,
    onTogglePanelFullscreen,
    panelMinimizeLabel
  ])

  const getHeaderActions = useCallback(({
    groupActiveTabKey,
    isTopRightGroup
  }: {
    groupActiveTabKey: string | null
    isTopRightGroup: boolean
  }): RouteContainerPanelDockActionItem[] => {
    const groupActiveTab = groupActiveTabKey == null ? undefined : tabById[groupActiveTabKey]
    const customTabActions = getTabHeaderActions?.({
      activeTab,
      groupActiveTab,
      groupActiveTabKey,
      isTopRightGroup
    }) ?? []
    const tabActions = buildInteractionPanelTabHeaderActions({
      onRunCommand,
      t,
      tab: groupActiveTab,
      workspaceRootPath
    }).map(action => ({
      icon: action.icon,
      key: action.key,
      label: action.label,
      onSelect: action.run
    }))
    const canRenderMarkdown = groupActiveTab?.kind === 'file' && isWorkspaceMarkdownPreviewPath(groupActiveTab.path)
    const markdownActions: RouteContainerPanelDockActionItem[] = canRenderMarkdown
      ? MARKDOWN_PREVIEW_MODE_OPTIONS.map(option => ({
        active: markdownPreviewMode === option.mode,
        icon: option.icon,
        key: `markdown:${option.mode}`,
        label: t(option.titleKey),
        onSelect: () => onMarkdownPreviewModeChange(option.mode)
      }))
      : []

    return [...tabActions, ...customTabActions, ...markdownActions]
  }, [
    activeTab,
    getTabHeaderActions,
    markdownPreviewMode,
    onMarkdownPreviewModeChange,
    onRunCommand,
    t,
    tabById,
    workspaceRootPath
  ])

  const handleCloseTabGroup = useCallback((tab: InteractionPanelTab, scope: InteractionPanelTabCloseScope) => {
    runWithFileCommentDraftCloseGuard(
      getTabsForCloseScope(tabs, tab, scope),
      () => onCloseTabGroup(tab, scope)
    )
  }, [onCloseTabGroup, runWithFileCommentDraftCloseGuard, tabs])

  const getTabContextMenuItems = useCallback(
    (context: RouteContainerPanelTabMenuContext<string>) =>
      buildInteractionPanelDockTabContextMenuItems({
        allTabs: tabs,
        canPinMoreTabs,
        iframePage: iframePageById[context.tab.key],
        onCopyText: copyContextText,
        onCloseTabGroup: handleCloseTabGroup,
        onEditPinnedTab,
        onNewTerminal,
        onPinTab,
        onUnpinTab,
        pinnedTab: pinnedTabById[context.tab.key],
        t,
        tab: tabById[context.tab.key],
        workspaceRootPath
      }),
    [
      canPinMoreTabs,
      copyContextText,
      handleCloseTabGroup,
      iframePageById,
      onEditPinnedTab,
      onNewTerminal,
      onPinTab,
      onUnpinTab,
      pinnedTabById,
      t,
      tabById,
      tabs,
      workspaceRootPath
    ]
  )

  const handleTabChange = useCallback((tabKey: string | null) => {
    if (tabKey == null) return
    const tab = tabById[tabKey]
    if (tab != null) onActivateTab(tab)
  }, [onActivateTab, tabById])

  const handleTabClose = useCallback((tabKey: string) => {
    const tab = tabById[tabKey]
    if (tab != null) {
      if (confirmFileCommentDraftClose([tab], () => onCloseTab(tab))) return false
      onCloseTab(tab)
    }
    return undefined
  }, [confirmFileCommentDraftClose, onCloseTab, tabById])

  const contextValue = {
    activeTab,
    activeSessionFocusRequestId,
    activeSessionFocusSessionId,
    bottomPanel,
    canCreateSessionTab,
    canFullscreenPanel,
    canPinMoreTabs,
    iframePages,
    isPanelFullscreen,
    isVisible,
    markdownPreviewMode,
    mobileDebugPages,
    pinnedTabs,
    pinnedTabById,
    projectUrlHistoryKey,
    sessionId,
    sessionPages,
    sessionUrlHistoryKey,
    tabById,
    hasPendingAnnotationReferences,
    terminalPanes,
    terminalSessionId,
    workspaceDrawerState,
    workspaceFileFocusRequest,
    workspaceRootPath,
    onAddMenuClick,
    onCloseTab: (tab: InteractionPanelTab) => runWithFileCommentDraftCloseGuard([tab], () => onCloseTab(tab)),
    onCloseTabGroup: handleCloseTabGroup,
    onCloseWorkspaceFilePaths,
    onEditPinnedTab,
    onIframeMetadataChange,
    onIframeNavigateHistory,
    onIframeSelectHistory,
    onIframeUrlChange,
    onLocateWorkspacePath,
    onMarkdownPreviewModeChange,
    onWorkspaceFileCommentDraftStateChange: handleWorkspaceFileCommentDraftStateChange,
    onMobileDebugPageChange,
    onNewSession,
    onNewTerminal,
    onOpenIframeUrl,
    onPanelClose,
    onPanelAction,
    onPinTab,
    onPluginTabStateChange,
    onRunCommand,
    onReferenceAnnotations,
    onReferenceFileComments,
    pendingAnnotationPreview,
    pendingAnnotations,
    pendingFileComments,
    onSelectWorkspaceFilePath,
    onSessionPageChange,
    onTogglePanelFullscreen,
    onUnpinTab
  }

  return (
    <InteractionPanelDockContext.Provider value={contextValue}>
      <RouteContainerPanelDockWorkspace
        activeTab={activeTabId}
        ariaLabel={t('chat.interactionPanel.addTab')}
        className='chat-interaction-panel__dock-workspace'
        closable
        closeLabel={() => t('common.close')}
        createMenuItems={addMenuItems}
        createMenuLabel={t('chat.interactionPanel.addTab')}
        createMenuSelectedKeys={createMenuSelectedKeys}
        disableFloatingGroups
        getHeaderActions={getHeaderActions}
        getTabContextMenuItems={getTabContextMenuItems}
        labelMode='responsive'
        layout={layout}
        minOpenTabs={0}
        openedTabs={tabs.map(tab => tab.id)}
        panelChromeActions={panelChromeActions}
        panelKey='chat-interaction-panel'
        storageKey={`chat-interaction-panel:${terminalSessionId}`}
        tabs={dockTabs}
        onCreateMenuClick={onAddMenuClick}
        onCreateMenuOpenChange={(open) => {
          if (open) void refreshDeviceOptions()
        }}
        onLayoutChange={onLayoutChange}
        onTabChange={handleTabChange}
        onTabClose={handleTabClose}
      />
    </InteractionPanelDockContext.Provider>
  )
}
