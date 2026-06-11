import './ChatHeader.scss'

import type { ChatMessage, Session, SessionStatus } from '@oneworks/core'
import type { SessionInfo } from '@oneworks/types'
import { App, Button, Dropdown, Input, Switch, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { ApiError, deleteSession, getApiErrorMessage, updateSession } from '../../api'
import type { SessionCompactionInfo } from '../../hooks/chat/session-compaction'
import { resolveSessionCompactionStatus } from '../../hooks/chat/session-compaction'
import { useResponsiveLayout } from '../../hooks/use-responsive-layout'
import { useQueryParams } from '../../hooks/useQueryParams'
import { resolvePluginContributionText } from '../../plugins/plugin-i18n'
import type { PluginContributionChatHeaderAction, PluginContributionMenuItem } from '../../plugins/plugin-manifest'
import { usePluginCommandExecutor, usePluginSlot } from '../../plugins/plugin-slots'
import { useRoutePluginHeaderActions } from '../../plugins/route-plugin-chrome'
import { isSidebarCollapsedAtom } from '../../store/index'
import { buildSessionUrl } from '../../utils/chat-links'
import { copyTextWithFeedback } from '../../utils/copy'
import { ConfigSectionPanel } from '../config'
import type { FieldSpec } from '../config/configSchema'
import { MaterialSymbol } from '../icons/MaterialSymbol'
import { RouteContainerHeader, RouteContainerHeaderActionButton } from '../layout/RouteContainerHeader'
import type { RouteContainerHeaderActionItem } from '../layout/RouteContainerHeader'
import { RoomPixelAvatar } from '../room-pixel-avatar/RoomPixelAvatar'
import { InteractionPanelWorkspaceActions } from './interaction-panel/InteractionPanelWorkspaceActions'
import type {
  InteractionPanelRunCommand,
  InteractionPanelRunCommandTaskStatus
} from './interaction-panel/interaction-panel-run-commands'
import { useInteractionPanelWorkspaceActionMenuItems } from './interaction-panel/interaction-panel-workspace-action-menu-items'
import { buildSessionMarkdown } from './session-markdown'
import {
  formatToolLabel,
  getSessionAssetWarnings,
  getSessionSelectionWarnings,
  getSessionToolGroups
} from './session-metadata'

export type ChatHeaderView = 'history' | 'timeline'
export type ChatHeaderRoomIconStatus = 'active' | 'waiting' | 'completed' | 'failed' | 'idle'
export type ChatHeaderMoreItems = NonNullable<MenuProps['items']>
export interface ChatHeaderModeSwitch {
  mode: 'session' | 'room'
  onOpenRoom: () => void
  onOpenSession: () => void
}

export interface ChatHeaderBreadcrumb {
  backLabel: string
  parentTitle: string
  onBack: () => void
}

interface SessionDebugItem {
  icon: string
  key: string
  label: string
  value: string
}

const DEBUG_MONO_KEYS = new Set([
  'sessionId',
  'contextCompactionId',
  'uuid',
  'leafUuid',
  'adapter',
  'model',
  'version',
  'cwd'
])
const HEADER_WORKSPACE_ACTIONS_MORE_WIDTH = 880

const normalizeTitle = (value?: string | null) => {
  const title = value?.trim()
  return title == null || title === '' ? undefined : title
}

const getDirectoryName = (value?: string | null) => {
  const normalized = value?.trim().replace(/[/\\]+$/, '')
  if (normalized == null || normalized === '') return undefined
  const segments = normalized.split(/[/\\]+/).filter(Boolean)
  return segments.at(-1) ?? normalized
}

export function ChatHeader({
  breadcrumb,
  displayTitle: displayTitleOverride,
  roomIconSeed,
  roomIconStatus,
  sessionCompactionInfo,
  sessionInfo,
  sessionId,
  sessionTitle,
  sessionStatus,
  isStarred,
  isArchived,
  messages = [],
  tags,
  lastMessage,
  lastUserMessage,
  activeView,
  enableTimelineView,
  historyTimelineHidden,
  isBottomPanelOpen,
  isWorkspaceDrawerOpen,
  isNewSessionActive,
  modeSwitch,
  moreItems,
  actionsOverride,
  projectWorkspaceFolder,
  runCommandTaskStatuses,
  showViewSwitches,
  terminalSessionId,
  onCreateSession,
  onOpenSidebar,
  onOpenSessionLog,
  onRunCommand,
  onTerminateRunCommandTask,
  onHistoryTimelineHiddenChange,
  onViewChange,
  onToggleBottomPanel,
  onToggleWorkspaceDrawer
}: {
  breadcrumb?: ChatHeaderBreadcrumb
  displayTitle?: string
  roomIconSeed?: string
  roomIconStatus?: ChatHeaderRoomIconStatus
  sessionCompactionInfo?: SessionCompactionInfo | null
  sessionInfo: SessionInfo | null
  sessionId?: string
  sessionTitle?: string
  sessionStatus?: SessionStatus
  isStarred?: boolean
  isArchived?: boolean
  messages?: ChatMessage[]
  tags?: string[]
  lastMessage?: string
  lastUserMessage?: string
  activeView: ChatHeaderView
  enableTimelineView?: boolean
  historyTimelineHidden?: boolean
  isBottomPanelOpen: boolean
  isWorkspaceDrawerOpen: boolean
  isNewSessionActive?: boolean
  modeSwitch?: ChatHeaderModeSwitch
  moreItems?: ChatHeaderMoreItems
  actionsOverride?: ReactNode
  projectWorkspaceFolder?: string
  runCommandTaskStatuses?: InteractionPanelRunCommandTaskStatus[]
  showViewSwitches?: boolean
  terminalSessionId?: string
  onCreateSession?: () => void
  onOpenSidebar?: () => void
  onOpenSessionLog?: () => void
  onRunCommand?: (command: InteractionPanelRunCommand) => void
  onTerminateRunCommandTask?: (terminalId: string) => void
  onHistoryTimelineHiddenChange?: (hidden: boolean) => void
  onViewChange: (view: ChatHeaderView) => void
  onToggleBottomPanel: () => void
  onToggleWorkspaceDrawer: () => void
}) {
  const { i18n, t } = useTranslation()
  const navigate = useNavigate()
  const { message, modal } = App.useApp()
  const { isCompactLayout, isTouchInteraction } = useResponsiveLayout()
  const isSidebarCollapsed = useAtomValue(isSidebarCollapsedAtom)
  const { searchParams, update: updateQuery } = useQueryParams<{ debug: string }>({
    keys: ['debug'],
    omit: {
      debug: value => value === ''
    }
  })
  const titleClickCountRef = useRef(0)
  const titleClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)
  const [headerWidth, setHeaderWidth] = useState<number | null>(null)
  const hasDebugQuery = searchParams.has('debug')
  const isDebugMode = searchParams.get('debug') === 'true'
  const shouldShowDebugButton = hasDebugQuery
  const hasSession = sessionId != null && sessionId !== ''
  const viewItems = [
    { value: 'history' as const, icon: 'history', title: t('chat.viewHistory') },
    ...(enableTimelineView === true
      ? [{ value: 'timeline' as const, icon: 'timeline', title: t('chat.viewTimeline') }]
      : [])
  ]
  const shouldShowViewSwitches = showViewSwitches ?? (hasSession && viewItems.length > 1)
  const isCreateSessionActive = isNewSessionActive ?? !hasSession
  const resolveTooltipTitle = (title: string) => isTouchInteraction ? undefined : title
  const isHeaderChromeCompact = isCompactLayout || isSidebarCollapsed

  const sessionRecordTitle = normalizeTitle(sessionTitle)
  const sessionInfoTitle = normalizeTitle(sessionInfo?.type === 'init' ? sessionInfo.title : undefined)
  const title = sessionRecordTitle ?? sessionInfoTitle
  const displayTitle = displayTitleOverride ?? (!hasSession
    ? t('chat.newSessionTitle')
    : title != null
    ? title
    : (lastUserMessage != null && lastUserMessage !== '')
    ? lastUserMessage
    : (lastMessage != null && lastMessage !== '')
    ? lastMessage
    : t('common.newChat'))
  const projectDirectoryName = hasSession ? undefined : getDirectoryName(projectWorkspaceFolder)
  const compactionStatus = sessionCompactionInfo == null
    ? null
    : resolveSessionCompactionStatus(sessionCompactionInfo, sessionStatus)
  const compactionLabel = compactionStatus == null
    ? ''
    : t(compactionStatus === 'compressing' ? 'chat.contextCompressingTitle' : 'chat.contextCompactedTitle')
  const compactionIndicator = sessionCompactionInfo == null
    ? null
    : (
      <Tooltip title={resolveTooltipTitle(compactionLabel)}>
        <MaterialSymbol
          className='chat-header-compact-indicator'
          name='layers'
          aria-label={compactionLabel}
          title={compactionLabel}
        />
      </Tooltip>
    )
  const projectDirectoryLabel = projectDirectoryName == null
    ? null
    : (
      <span className='chat-header-title-project' title={projectWorkspaceFolder}>
        {projectDirectoryName}
      </span>
    )
  const topLevelSessionIcon = breadcrumb == null && roomIconSeed == null
    ? <MaterialSymbol className='chat-header-session-icon' name='chat_bubble' filled aria-hidden='true' />
    : null
  const titleContent = (
    <span className='chat-header-title-content'>
      {topLevelSessionIcon}
      <span className='chat-header-title-text' title={displayTitle}>{displayTitle}</span>
      {projectDirectoryLabel}
      {compactionIndicator}
    </span>
  )
  const roomTitleIconSeed = normalizeTitle(roomIconSeed) ?? displayTitle
  const roomTitleIcon = modeSwitch?.mode === 'room'
    ? (
      <RoomPixelAvatar
        className={[
          'chat-header-room-icon',
          roomIconStatus != null ? `chat-header-room-icon--${roomIconStatus}` : ''
        ].filter(Boolean).join(' ')}
        seed={roomTitleIconSeed}
      />
    )
    : null
  const resolvedTitleContent = breadcrumb == null && roomTitleIcon != null
    ? (
      <span className='chat-header-title-content'>
        {roomTitleIcon}
        <span className='chat-header-title-text' title={displayTitle}>{displayTitle}</span>
        {projectDirectoryLabel}
        {compactionIndicator}
      </span>
    )
    : titleContent
  const toggleDebugMode = () => {
    updateQuery({ debug: isDebugMode ? 'false' : 'true' })
  }

  const activeViewItem = viewItems.find((item) => item.value === activeView) ?? viewItems[0]!

  const handleToggleStar = async () => {
    if (sessionId == null || sessionId === '') return
    try {
      await updateSession(sessionId, { isStarred: !isStarred })
      void message.success(isStarred ? t('common.unstarred') : t('common.starred'))
    } catch (err) {
      void message.error(getApiErrorMessage(err, t('common.operationFailed')))
    }
  }

  const handleToggleArchive = async () => {
    if (sessionId == null || sessionId === '') return
    try {
      await updateSession(sessionId, { isArchived: !isArchived })
      void message.success(isArchived ? t('common.restored') : t('common.archived'))
    } catch (err) {
      void message.error(getApiErrorMessage(err, t('common.operationFailed')))
    }
  }

  const sessionWorkspacePath = sessionInfo?.type === 'init' ? sessionInfo.cwd.trim() : ''
  const menuIcon = (icon: string, isFilled = false) => (
    <MaterialSymbol className='chat-header-icon' name={icon} filled={isFilled} />
  )
  const unsupportedLabel = (label: string) => (
    <Tooltip title={resolveTooltipTitle(t('common.notSupportedYet'))} placement='left'>
      <span>{label}</span>
    </Tooltip>
  )
  const disabledLabel = (label: string, reason: string) => (
    <Tooltip title={resolveTooltipTitle(reason)} placement='left'>
      <span>{label}</span>
    </Tooltip>
  )
  const copySessionText = (text: string, successMessage: string) => {
    void copyTextWithFeedback({
      text,
      messageApi: message,
      successMessage,
      failureMessage: t('common.copyFailed')
    })
  }

  const handleRenameSession = () => {
    if (sessionId == null || sessionId === '') return
    let nextTitle = sessionTitle ?? displayTitle

    modal.confirm({
      title: t('common.renameSession'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      content: (
        <Input
          autoFocus
          defaultValue={nextTitle}
          placeholder={t('chat.enterTitle')}
          onChange={(event) => {
            nextTitle = event.target.value
          }}
        />
      ),
      onOk: async () => {
        const normalizedTitle = nextTitle.trim()
        if (normalizedTitle === (sessionTitle ?? '').trim()) {
          return
        }

        try {
          await updateSession(sessionId, { title: normalizedTitle })
          void message.success(t('chat.titleUpdated'))
        } catch (err) {
          void message.error(getApiErrorMessage(err, t('common.operationFailed')))
          throw new Error('rename-session-failed')
        }
      }
    })
  }

  const handleCopySessionMarkdown = () => {
    if (sessionId == null || sessionId === '') return
    copySessionText(
      buildSessionMarkdown({
        messages,
        sessionId,
        title: displayTitle,
        workspacePath: sessionWorkspacePath
      }),
      t('common.sessionMarkdownCopied')
    )
  }

  const handleOpenInNewWindow = () => {
    if (sessionId == null || sessionId === '') return
    const sessionUrl = buildSessionUrl(sessionId, { sidebarCollapsed: true })
    const openWorkspaceWindow = window.oneworksDesktop?.openCurrentWorkspaceWindow
    if (openWorkspaceWindow != null) {
      void openWorkspaceWindow(sessionUrl).catch(() => {
        void message.error(t('common.operationFailed'))
      })
      return
    }

    window.open(sessionUrl, '_blank', 'noopener,noreferrer')
  }

  const canToggleHistoryTimeline = hasSession && onHistoryTimelineHiddenChange != null
  const sessionMoreItems: ChatHeaderMoreItems = [
    {
      key: 'star',
      label: isStarred ? t('common.unstar') : t('common.star'),
      icon: menuIcon(isStarred ? 'star' : 'star_border', isStarred),
      onClick: () => {
        void handleToggleStar()
      }
    },
    {
      key: 'rename',
      label: t('common.renameSession'),
      icon: menuIcon('edit'),
      onClick: handleRenameSession
    },
    {
      key: 'archive',
      label: isArchived ? t('common.restore') : t('common.archive'),
      icon: menuIcon(isArchived ? 'unarchive' : 'archive'),
      onClick: () => {
        void handleToggleArchive()
      }
    },
    ...(canToggleHistoryTimeline
      ? [
        { type: 'divider' as const },
        {
          key: 'hide-history-timeline',
          label: (
            <span className='chat-header-menu-toggle'>
              <span className='chat-header-menu-toggle__label'>
                {t('chat.hideHistoryTimeline')}
              </span>
              <Switch
                checked={historyTimelineHidden === true}
                size='small'
                onClick={(checked, event) => {
                  event?.stopPropagation()
                  onHistoryTimelineHiddenChange?.(checked)
                }}
              />
            </span>
          ),
          icon: menuIcon('timeline'),
          onClick: () => {
            onHistoryTimelineHiddenChange?.(!(historyTimelineHidden === true))
          }
        }
      ]
      : []),
    { type: 'divider' },
    {
      key: 'copy-workspace-path',
      label: sessionWorkspacePath === ''
        ? disabledLabel(t('common.copyWorkspacePath'), t('chat.workspacePathUnavailable'))
        : t('common.copyWorkspacePath'),
      icon: menuIcon('folder_open'),
      disabled: sessionWorkspacePath === '',
      onClick: () => {
        if (sessionWorkspacePath === '') return
        copySessionText(sessionWorkspacePath, t('common.workspacePathCopied'))
      }
    },
    {
      key: 'copy-session-id',
      label: t('common.copySessionId'),
      icon: menuIcon('fingerprint'),
      onClick: () => {
        if (sessionId == null || sessionId === '') return
        copySessionText(sessionId, t('common.sessionIdCopied'))
      }
    },
    {
      key: 'copy-session-link',
      label: t('common.copySessionLink'),
      icon: menuIcon('link'),
      onClick: () => {
        if (sessionId == null || sessionId === '') return
        copySessionText(buildSessionUrl(sessionId), t('common.sessionLinkCopied'))
      }
    },
    {
      key: 'copy-resume-command',
      label: t('common.copyResumeCommand'),
      icon: menuIcon('terminal'),
      onClick: () => {
        if (sessionId == null || sessionId === '') return
        copySessionText(`oneworks --resume ${sessionId}`, t('common.resumeCommandCopied'))
      }
    },
    {
      key: 'copy-session-markdown',
      label: t('common.copySessionMarkdown'),
      icon: menuIcon('markdown'),
      onClick: handleCopySessionMarkdown
    },
    { type: 'divider' },
    {
      key: 'fork-current-workspace',
      label: unsupportedLabel(t('common.forkCurrentWorkspace')),
      icon: menuIcon('call_split'),
      disabled: true
    },
    {
      key: 'derive-new-worktree',
      label: unsupportedLabel(t('common.deriveNewWorktree')),
      icon: menuIcon('account_tree'),
      disabled: true
    },
    {
      key: 'create-scheduled-task',
      label: unsupportedLabel(t('common.createScheduledTask')),
      icon: menuIcon('alarm_add'),
      disabled: true
    },
    { type: 'divider' },
    {
      key: 'open-in-new-window',
      label: t('common.openInNewWindow'),
      icon: menuIcon('open_in_new'),
      onClick: handleOpenInNewWindow
    }
  ]
  const resolvedMoreItems = moreItems ?? (hasSession ? sessionMoreItems : [])
  const compactViewItems: MenuProps['items'] = viewItems.map((item) => ({
    key: `view:${item.value}`,
    label: item.title,
    icon: <MaterialSymbol className='chat-header-icon' name={item.icon} filled={activeView === item.value} />,
    onClick: () => {
      onViewChange(item.value)
    }
  }))
  const debugMoreItems: ChatHeaderMoreItems = hasSession && shouldShowDebugButton
    ? [{
      key: 'debug',
      label: isDebugMode ? t('chat.debugDisable') : t('chat.debugEnable'),
      icon: <MaterialSymbol className='chat-header-icon' name='bug_report' filled={isDebugMode} />,
      onClick: toggleDebugMode
    }]
    : []
  const debugSessionLogItems: ChatHeaderMoreItems = hasSession && isDebugMode && onOpenSessionLog != null
    ? [{
      key: 'debug-session-log',
      label: t('chat.debugOpenSessionLog'),
      icon: <MaterialSymbol className='chat-header-icon' name='article' />,
      onClick: onOpenSessionLog
    }]
    : []
  const canShowWorkspaceActions = terminalSessionId != null && terminalSessionId !== '' && onRunCommand != null
  const shouldMoveWorkspaceActionsToMore = headerWidth != null && headerWidth < HEADER_WORKSPACE_ACTIONS_MORE_WIDTH
  const workspaceActionMoreItems = useInteractionPanelWorkspaceActionMenuItems({
    enabled: canShowWorkspaceActions && shouldMoveWorkspaceActionsToMore,
    runCommandTaskStatuses,
    terminalSessionId,
    onRunCommand
  })
  const pluginHeaderActions = usePluginSlot<PluginContributionChatHeaderAction>('chat.header.actions')
  const routePluginHeaderActions = useRoutePluginHeaderActions('chat')
  const pluginHeaderMoreItems = usePluginSlot<PluginContributionMenuItem>('chat.header.moreMenu')
  const executePluginCommand = usePluginCommandExecutor()
  const pluginLanguage = i18n.resolvedLanguage ?? i18n.language
  const pluginPayload = {
    sessionId,
    sessionTitle,
    terminalSessionId
  }
  const runPluginAction = (item: { command?: string; pluginScope: string; route?: string; href?: string }) => {
    if (item.command != null && executePluginCommand != null) {
      void executePluginCommand(item.pluginScope, item.command, pluginPayload)
      return
    }
    if (item.route != null) {
      void navigate(item.route)
      return
    }
    if (item.href != null) {
      window.open(item.href, '_blank', 'noopener,noreferrer')
    }
  }
  const resolvedPluginHeaderMoreItems: ChatHeaderMoreItems = pluginHeaderMoreItems.map(item => ({
    key: `plugin:${item.pluginScope}:${item.id}`,
    label: resolvePluginContributionText(item, 'title', pluginLanguage) ?? item.title,
    icon: <MaterialSymbol className='chat-header-icon' name={item.icon ?? 'layers'} />,
    onClick: () => runPluginAction(item)
  }))
  const resolvedPluginHeaderActions = pluginHeaderActions.map(item => {
    const label = resolvePluginContributionText(item, 'title', pluginLanguage) ?? item.title
    return {
      ...item,
      label
    }
  })
  const desktopMoreItems: ChatHeaderMoreItems = [
    ...resolvedMoreItems,
    ...resolvedPluginHeaderMoreItems,
    ...debugSessionLogItems
  ]
  const compactMoreItems: ChatHeaderMoreItems = [
    ...workspaceActionMoreItems,
    ...resolvedMoreItems,
    ...resolvedPluginHeaderMoreItems,
    ...debugSessionLogItems,
    ...(shouldShowDebugButton
      ? debugMoreItems
      : [])
  ]
  const shouldShowDesktopMoreActions = desktopMoreItems.length > 0
  const bottomPanelAction: RouteContainerHeaderActionItem = {
    icon: 'bottom_panel_open',
    key: 'chat-bottom-panel',
    label: t('chat.bottomPanelToggle'),
    onSelect: onToggleBottomPanel
  }
  const bottomPanelButton = isBottomPanelOpen ? null : <RouteContainerHeaderActionButton item={bottomPanelAction} />
  const workspaceActions = !canShowWorkspaceActions
    ? null
    : (
      <InteractionPanelWorkspaceActions
        containerClassName='chat-header-workspace-actions'
        iconClassName='chat-header-view-option material-symbols-rounded'
        menuIconClassName='chat-header-menu-icon material-symbols-rounded'
        runCommandTaskStatuses={runCommandTaskStatuses}
        terminalSessionId={terminalSessionId}
        onRunCommand={onRunCommand}
        onTerminateRunCommandTask={onTerminateRunCommandTask}
      />
    )
  const shouldShowCompactMoreActions = compactMoreItems.length > 0
  const workspaceDrawerAction: RouteContainerHeaderActionItem = {
    icon: 'right_panel_open',
    key: 'chat-workspace-drawer',
    label: t('chat.workspaceDrawerToggle'),
    onSelect: onToggleWorkspaceDrawer
  }
  const workspaceDrawerButton = isWorkspaceDrawerOpen
    ? null
    : <RouteContainerHeaderActionButton item={workspaceDrawerAction} />
  const modeSwitchTarget = modeSwitch == null
    ? undefined
    : modeSwitch.mode === 'room'
    ? {
      icon: 'chat_bubble',
      label: t('agentRoom.mode.session'),
      onClick: modeSwitch.onOpenSession
    }
    : {
      icon: 'forum',
      label: t('agentRoom.mode.room'),
      onClick: modeSwitch.onOpenRoom
    }
  const modeSwitchButton = modeSwitchTarget == null
    ? null
    : (
      <Tooltip title={resolveTooltipTitle(modeSwitchTarget.label)}>
        <Button
          type='text'
          className='route-container-header__action-button'
          title={modeSwitchTarget.label}
          aria-label={modeSwitchTarget.label}
          onClick={modeSwitchTarget.onClick}
          icon={<MaterialSymbol className='route-container-header__action-icon' name={modeSwitchTarget.icon} />}
        />
      </Tooltip>
    )

  useEffect(() => {
    return () => {
      if (titleClickTimerRef.current != null) {
        clearTimeout(titleClickTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const element = headerRef.current
    if (element == null || typeof ResizeObserver !== 'function') return

    const updateHeaderWidth = () => {
      setHeaderWidth(Math.round(element.getBoundingClientRect().width))
    }
    updateHeaderWidth()

    const observer = new ResizeObserver(updateHeaderWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const handleTitleClick = () => {
    if (titleClickTimerRef.current != null) {
      clearTimeout(titleClickTimerRef.current)
    }

    titleClickCountRef.current += 1

    if (titleClickCountRef.current >= 5) {
      titleClickCountRef.current = 0
      titleClickTimerRef.current = null
      toggleDebugMode()
      // eslint-disable-next-line no-console
      console.log('Session Full Info:', {
        sessionId,
        sessionTitle,
        isStarred,
        isArchived,
        tags,
        lastMessage,
        lastUserMessage,
        sessionInfo,
        sessionCompactionInfo
      })
      return
    }

    titleClickTimerRef.current = setTimeout(() => {
      titleClickCountRef.current = 0
      titleClickTimerRef.current = null
    }, 500)
  }

  const routeHeaderBreadcrumb = breadcrumb == null
    ? undefined
    : {
      ariaLabel: t('agentRoom.sessionBreadcrumbLabel', {
        roomTitle: breadcrumb.parentTitle,
        sessionTitle: displayTitle
      }),
      backLabel: breadcrumb.backLabel,
      currentTitle: displayTitle,
      parentTitle: breadcrumb.parentTitle,
      onBack: breadcrumb.onBack
    }
  const routeHeaderActions = actionsOverride != null
    ? actionsOverride
    : isHeaderChromeCompact
    ? (
      <>
        {shouldShowViewSwitches && (
          <Tooltip title={resolveTooltipTitle(activeViewItem.title)}>
            <Dropdown
              menu={{ items: compactViewItems }}
              overlayClassName='chat-header-actions-dropdown'
              placement='bottomRight'
              trigger={['click']}
            >
              <Button
                type='text'
                className='route-container-header__action-button'
                title={activeViewItem.title}
                aria-label={activeViewItem.title}
                icon={<MaterialSymbol className='route-container-header__action-icon' name={activeViewItem.icon} />}
              />
            </Dropdown>
          </Tooltip>
        )}
        {modeSwitchButton}
        {!shouldMoveWorkspaceActionsToMore && workspaceActions}
        {resolvedPluginHeaderActions.map(item => (
          <Tooltip key={`${item.pluginScope}:${item.id}`} title={resolveTooltipTitle(item.label)}>
            <Button
              type='text'
              className='route-container-header__action-button'
              title={item.label}
              aria-label={item.label}
              onClick={() => runPluginAction(item)}
              icon={<MaterialSymbol className='route-container-header__action-icon' name={item.icon ?? 'layers'} />}
            />
          </Tooltip>
        ))}
        {bottomPanelButton}
        {workspaceDrawerButton}
        {shouldShowCompactMoreActions && (
          <Tooltip title={resolveTooltipTitle(t('common.moreActions'))}>
            <Dropdown
              menu={{ items: compactMoreItems }}
              overlayClassName='chat-header-actions-dropdown'
              placement='bottomRight'
              trigger={['click']}
            >
              <Button
                type='text'
                className='route-container-header__action-button'
                title={t('common.moreActions')}
                aria-label={t('common.moreActions')}
                icon={<MaterialSymbol className='route-container-header__action-icon' name='more_vert' />}
              />
            </Dropdown>
          </Tooltip>
        )}
      </>
    )
    : (
      <>
        {shouldShowViewSwitches && viewItems.map(item => (
          <Tooltip key={item.value} title={resolveTooltipTitle(item.title)}>
            <Button
              type='text'
              className={`route-container-header__action-button ${activeView === item.value ? 'is-active' : ''}`}
              title={item.title}
              aria-label={item.title}
              onClick={() => {
                onViewChange(item.value)
              }}
              icon={<MaterialSymbol className='route-container-header__action-icon' name={item.icon} />}
            />
          </Tooltip>
        ))}
        {modeSwitchButton}
        {workspaceActions}
        {resolvedPluginHeaderActions.map(item => (
          <Tooltip key={`${item.pluginScope}:${item.id}`} title={resolveTooltipTitle(item.label)}>
            <Button
              type='text'
              className='route-container-header__action-button'
              title={item.label}
              aria-label={item.label}
              onClick={() => runPluginAction(item)}
              icon={<MaterialSymbol className='route-container-header__action-icon' name={item.icon ?? 'layers'} />}
            />
          </Tooltip>
        ))}
        {bottomPanelButton}
        {workspaceDrawerButton}
        {hasSession && shouldShowDebugButton && (
          <Tooltip title={resolveTooltipTitle(isDebugMode ? t('chat.debugDisable') : t('chat.debugEnable'))}>
            <Button
              type='text'
              className={`route-container-header__action-button ${isDebugMode ? 'is-debug-active' : ''}`}
              title={isDebugMode ? t('chat.debugDisable') : t('chat.debugEnable')}
              aria-label={isDebugMode ? t('chat.debugDisable') : t('chat.debugEnable')}
              onClick={toggleDebugMode}
              icon={
                <MaterialSymbol
                  className='route-container-header__action-icon'
                  name='bug_report'
                  filled={isDebugMode}
                />
              }
            />
          </Tooltip>
        )}
        {shouldShowDesktopMoreActions && (
          <Tooltip title={resolveTooltipTitle(t('common.moreActions'))}>
            <Dropdown
              menu={{ items: desktopMoreItems }}
              overlayClassName='chat-header-actions-dropdown'
              placement='bottomRight'
              trigger={['click']}
            >
              <Button
                type='text'
                className='route-container-header__action-button'
                title={t('common.moreActions')}
                aria-label={t('common.moreActions')}
                icon={<MaterialSymbol className='route-container-header__action-icon' name='more_vert' />}
              />
            </Dropdown>
          </Tooltip>
        )}
      </>
    )

  return (
    <RouteContainerHeader
      className='chat-route-header'
      compact={isHeaderChromeCompact}
      rootRef={headerRef}
      title={displayTitle}
      titleContent={routeHeaderBreadcrumb == null ? resolvedTitleContent : undefined}
      actionItems={routePluginHeaderActions}
      breadcrumb={routeHeaderBreadcrumb}
      leadingActions='auto'
      onCreateSession={isCreateSessionActive ? undefined : onCreateSession}
      onOpenSidebar={onOpenSidebar}
      onTitleClick={handleTitleClick}
      actions={<div className='chat-header-actions'>{routeHeaderActions}</div>}
    />
  )
}

export function SessionSettingsPanel({
  session,
  sessionCompactionInfo,
  sessionInfo,
  onClose
}: {
  session: Session
  sessionCompactionInfo?: SessionCompactionInfo | null
  sessionInfo: SessionInfo | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { isCompactLayout } = useResponsiveLayout()
  const { message, modal } = App.useApp()
  const { searchParams } = useQueryParams<{ debug: string }>({ keys: ['debug'] })
  const isDebugMode = searchParams.get('debug') === 'true'
  const sessionId = session.id
  const fields = useMemo<FieldSpec[]>(() => [
    {
      path: ['title'],
      type: 'string',
      defaultValue: '',
      icon: 'edit_note',
      labelKey: 'chat.title',
      placeholderKey: 'chat.enterTitle'
    },
    {
      path: ['tags'],
      type: 'string[]',
      defaultValue: [],
      icon: 'sell',
      labelKey: 'chat.tags'
    }
  ], [])
  const initialValue = useMemo(() => ({
    title: session.title ?? '',
    tags: session.tags ?? []
  }), [session.tags, session.title])
  const [draft, setDraft] = useState(initialValue)
  const [collapsedToolGroupKeys, setCollapsedToolGroupKeys] = useState<Record<string, boolean>>({})
  const draftsRef = useRef(initialValue)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef(false)
  const lastSavedRef = useRef<string | null>(null)

  useEffect(() => {
    setDraft(initialValue)
  }, [initialValue])

  useEffect(() => {
    draftsRef.current = draft
  }, [draft])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  const toolGroups = useMemo(() => getSessionToolGroups(sessionInfo), [sessionInfo])
  const assetWarnings = useMemo(() => getSessionAssetWarnings(sessionInfo), [sessionInfo])
  const selectionWarnings = useMemo(() => getSessionSelectionWarnings(sessionInfo), [sessionInfo])

  useEffect(() => {
    if (!isCompactLayout || toolGroups.length === 0) {
      return
    }

    setCollapsedToolGroupKeys((prev) => {
      const next = { ...prev }
      let changed = false

      for (const group of toolGroups) {
        if (!(group.key in next)) {
          next[group.key] = true
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [isCompactLayout, toolGroups])

  const debugItems = useMemo<SessionDebugItem[]>(() => {
    const emptyValue = t('chat.timelineEmptyValue')
    const booleanValue = (value: boolean | undefined) =>
      value ? t('chat.debugEnabledValue') : t('chat.debugDisabledValue')
    const tags = session.tags ?? []
    const items: SessionDebugItem[] = [
      {
        key: 'sessionId',
        label: t('chat.debugSessionId'),
        value: session.id,
        icon: 'fingerprint'
      },
      {
        key: 'view',
        label: t('chat.debugView'),
        value: t('chat.viewSettings'),
        icon: 'tune'
      },
      {
        key: 'starred',
        label: t('chat.debugStarred'),
        value: booleanValue(session.isStarred),
        icon: 'star'
      },
      {
        key: 'archived',
        label: t('chat.debugArchived'),
        value: booleanValue(session.isArchived),
        icon: 'archive'
      }
    ]

    if (tags.length > 0) {
      items.push({
        key: 'tags',
        label: t('chat.debugTags'),
        value: tags.join(', '),
        icon: 'sell'
      })
    }

    if (sessionInfo?.type === 'init') {
      items.push(
        {
          key: 'type',
          label: t('chat.debugType'),
          value: sessionInfo.type,
          icon: 'deployed_code'
        },
        {
          key: 'uuid',
          label: t('chat.debugUuid'),
          value: sessionInfo.uuid,
          icon: 'tag'
        },
        {
          key: 'adapter',
          label: t('chat.debugAdapter'),
          value: sessionInfo.adapter ?? emptyValue,
          icon: 'deployed_code'
        },
        {
          key: 'model',
          label: t('chat.debugModel'),
          value: sessionInfo.model,
          icon: 'model_training'
        },
        {
          key: 'effort',
          label: t('chat.debugEffort'),
          value: sessionInfo.effort ?? emptyValue,
          icon: 'psychology'
        },
        {
          key: 'version',
          label: t('chat.debugVersion'),
          value: sessionInfo.version,
          icon: 'deployed_code_update'
        },
        {
          key: 'tools',
          label: t('chat.debugTools'),
          value: String(sessionInfo.tools.length),
          icon: 'handyman'
        },
        {
          key: 'agents',
          label: t('chat.debugAgents'),
          value: String(sessionInfo.agents.length),
          icon: 'hub'
        },
        {
          key: 'cwd',
          label: t('chat.debugCwd'),
          value: sessionInfo.cwd,
          icon: 'folder_open'
        }
      )
    }

    if (sessionCompactionInfo != null) {
      const status = resolveSessionCompactionStatus(sessionCompactionInfo, session.status)
      items.push(
        {
          key: 'contextCompaction',
          label: t('chat.debugContextCompaction'),
          value: t(status === 'compressing' ? 'chat.contextCompressingTitle' : 'chat.contextCompactedTitle'),
          icon: 'layers'
        },
        {
          key: 'contextCompactionId',
          label: t('chat.debugContextCompactionId'),
          value: sessionCompactionInfo.id,
          icon: 'fingerprint'
        }
      )
      if (sessionCompactionInfo.tokenCount != null) {
        items.push({
          key: 'contextCompactionTokens',
          label: t('chat.debugContextCompactionTokens'),
          value: String(sessionCompactionInfo.tokenCount),
          icon: 'tag'
        })
      }
    }
    return items
  }, [
    session.id,
    session.isArchived,
    session.isStarred,
    session.status,
    session.tags,
    sessionCompactionInfo,
    sessionInfo,
    t
  ])

  const formatSelectionWarning = (warning: (typeof selectionWarnings)[number]) => {
    const reason = warning.reason === 'excluded'
      ? t('chat.selectionWarningReasonExcluded')
      : t('chat.selectionWarningReasonNotIncluded')

    return t('chat.selectionWarningFallback', {
      adapter: warning.adapter,
      requestedModel: warning.requestedModel,
      resolvedModel: warning.resolvedModel,
      reason
    })
  }

  const scheduleSave = (nextValue: { title: string; tags: string[] }) => {
    const serialized = JSON.stringify(nextValue ?? {})
    if (lastSavedRef.current === serialized) return
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = setTimeout(async () => {
      if (savingRef.current) return
      const currentValue = draftsRef.current
      const currentSerialized = JSON.stringify(currentValue ?? {})
      if (lastSavedRef.current === currentSerialized) return
      savingRef.current = true
      try {
        await updateSession(sessionId, {
          title: typeof currentValue.title === 'string' ? currentValue.title : '',
          tags: Array.isArray(currentValue.tags) ? currentValue.tags : []
        })
        lastSavedRef.current = currentSerialized
      } catch (err) {
        void message.error(getApiErrorMessage(err, t('common.operationFailed')))
      } finally {
        savingRef.current = false
      }
    }, 500)
  }

  const handleDraftChange = (nextValue: unknown) => {
    const nextRecord = (nextValue != null && typeof nextValue === 'object')
      ? nextValue as Record<string, unknown>
      : {}
    const nextDraft = {
      title: typeof nextRecord.title === 'string' ? nextRecord.title : '',
      tags: Array.isArray(nextRecord.tags)
        ? nextRecord.tags.filter(item => typeof item === 'string')
        : []
    }
    setDraft(nextDraft)
    scheduleSave(nextDraft)
  }

  const handleDelete = () => {
    const runDelete = async (force = false) => {
      await deleteSession(sessionId, { force })
      void message.success(t('common.deleteSuccess'))
      onClose()
    }

    modal.confirm({
      title: t('common.deleteSession'),
      content: t('common.deleteSessionConfirm'),
      okText: t('common.delete'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await runDelete()
        } catch (err) {
          if (err instanceof ApiError && err.code === 'session_worktree_not_clean') {
            modal.confirm({
              title: t('chat.sessionWorkspaceForceDeleteTitle'),
              content: t('chat.sessionWorkspaceForceDeleteDescription'),
              okText: t('common.delete'),
              okType: 'danger',
              cancelText: t('common.cancel'),
              onOk: async () => {
                try {
                  await runDelete(true)
                } catch (forceError) {
                  void message.error(getApiErrorMessage(forceError, t('common.deleteFailed')))
                }
              }
            })
            return
          }
          void message.error(getApiErrorMessage(err, t('common.deleteFailed')))
        }
      }
    })
  }

  const toggleToolGroup = (key: string) => {
    setCollapsedToolGroupKeys((prev) => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  return (
    <div className='session-settings-drawer'>
      <ConfigSectionPanel
        sectionKey='session'
        title={null}
        icon={undefined}
        fields={fields}
        value={draft}
        onChange={handleDraftChange}
        mergedModelServices={{}}
        mergedAdapters={{}}
        selectedModelService={undefined}
        t={t}
        className='session-settings-drawer__form'
      />

      <div className='settings-section session-runtime-section'>
        <div className='section-header'>
          <span className='material-symbols-rounded'>build</span>
          <span>{t('chat.availableTools')}</span>
        </div>

        {selectionWarnings.length > 0 && (
          <div className='session-info-note-list'>
            <div className='session-info-note-list__title'>{t('chat.selectionWarningsTitle')}</div>
            {selectionWarnings.map((warning, index) => (
              <div
                key={`${warning.adapter}:${warning.requestedModel}:${warning.resolvedModel}:${index}`}
                className='session-info-note session-info-note--warning'
              >
                <span className='material-symbols-rounded'>warning</span>
                <span>{formatSelectionWarning(warning)}</span>
              </div>
            ))}
          </div>
        )}

        {assetWarnings.length > 0 && (
          <div className='session-info-note-list'>
            <div className='session-info-note-list__title'>{t('chat.assetWarningsTitle')}</div>
            {assetWarnings.map((warning) => (
              <div key={warning.assetId} className='session-info-note'>
                <span className='material-symbols-rounded'>warning</span>
                <div className='session-info-note__content'>
                  <code>{warning.assetId}</code>
                  <span>{warning.reason}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {toolGroups.length > 0
          ? (
            <div className='session-tool-groups'>
              {toolGroups.map((group) => (
                <div key={group.key} className='session-tool-group-card'>
                  <button
                    type='button'
                    className='session-tool-group-card__header'
                    onClick={() => toggleToolGroup(group.key)}
                  >
                    <div className='session-tool-group-card__title'>
                      <span className='material-symbols-rounded'>{group.icon}</span>
                      <span>{t(group.labelKey)}</span>
                    </div>
                    <div className='session-tool-group-card__meta'>
                      <span className='session-tool-group-card__count'>{group.tools.length}</span>
                      <span className='material-symbols-rounded session-tool-group-card__expand'>
                        {collapsedToolGroupKeys[group.key] ? 'expand_more' : 'expand_less'}
                      </span>
                    </div>
                  </button>
                  {!collapsedToolGroupKeys[group.key] && (
                    <div className='session-tool-group-card__list'>
                      {group.tools.map(tool => (
                        <div key={tool} className='session-tool-row' title={formatToolLabel(tool)}>
                          <span className='session-tool-row__dot' />
                          <code>{formatToolLabel(tool)}</code>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
          : (
            <div className='session-settings-empty'>
              {t('chat.availableToolsEmpty')}
            </div>
          )}
      </div>

      {isDebugMode && debugItems.length > 0 && (
        <div className='settings-section session-debug-section'>
          <div className='section-header'>
            <span className='material-symbols-rounded'>bug_report</span>
            <span>{t('chat.debugSectionTitle')}</span>
          </div>

          <div className='session-debug-panel'>
            <div className='session-debug-list'>
              {debugItems.map(item => (
                <div key={item.key} className='session-debug-row'>
                  <span className='session-debug-row__label'>{item.label}</span>
                  <span
                    className={`session-debug-row__value ${DEBUG_MONO_KEYS.has(item.key) ? 'is-mono' : ''}`}
                  >
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className='settings-footer'>
        <div className='danger-zone'>
          <div className='delete-session-row'>
            <div className='delete-session-meta'>
              <div className='delete-session-title'>{t('chat.deleteSessionTitle')}</div>
              <div className='delete-session-desc'>{t('chat.deleteSessionDesc')}</div>
            </div>
            <Button
              danger
              type='primary'
              size='middle'
              icon={<span className='material-symbols-rounded'>delete_forever</span>}
              onClick={handleDelete}
              className='delete-session-btn'
            >
              {t('common.delete')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
