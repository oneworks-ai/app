import type { Session, SessionStatus } from '@oneworks/core'
import { Button, Tag, Tooltip } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getAdapterDisplay } from '#~/resources/adapters.js'

import { SessionCard } from './SessionCard'
import { SessionContextMenu } from './SessionContextMenu'
import { getVisibleSidebarSessionTags } from './session-tags'
import { formatSidebarTimeDisplay } from './sidebar-time-display'
import { SIDEBAR_DETAIL_TOOLTIP_DELAY_SECONDS } from './sidebar-tooltip'

interface SessionItemProps {
  session: Session
  isActive: boolean
  isBatchMode: boolean
  isCompactLayout: boolean
  isSelected: boolean
  isTouchInteraction: boolean
  showMessagePreview: boolean
  hasChildren?: boolean
  isChildrenCollapsed?: boolean
  onSelect: (session: Session) => void
  onArchive: (id: string) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
  onRename: (id: string, title: string) => Promise<void>
  onStar: (id: string, isStarred: boolean) => void | Promise<void>
  onToggleChildren?: (id: string) => void
  onToggleSelect: (id: string) => void
}

type PendingSessionAction = 'archive' | null

export function SessionItem({
  session,
  isActive,
  isBatchMode,
  hasChildren = false,
  isChildrenCollapsed = false,
  isCompactLayout,
  isSelected,
  isTouchInteraction,
  showMessagePreview,
  onSelect,
  onArchive,
  onDelete,
  onRename,
  onStar,
  onToggleChildren,
  onToggleSelect
}: SessionItemProps) {
  const { t, i18n } = useTranslation()
  const automationPrefix = 'automation:'
  const itemContentRef = useRef<HTMLDivElement | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingSessionAction>(null)
  const showCompactActionMenu = isCompactLayout || isTouchInteraction
  const resolveTooltipTitle = (title: string) => isTouchInteraction ? undefined : title

  useEffect(() => {
    if (pendingAction == null) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const nextTarget = event.target
      if (!(nextTarget instanceof Node)) {
        setPendingAction(null)
        return
      }

      if (!itemContentRef.current?.contains(nextTarget)) {
        setPendingAction(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [pendingAction])

  const timeDisplay = useMemo(() => {
    return formatSidebarTimeDisplay(session.createdAt, i18n.resolvedLanguage ?? i18n.language)
  }, [session.createdAt, i18n.language, i18n.resolvedLanguage])

  const archiveActionLabel = session.isArchived ? t('common.restore') : t('common.archive')
  const archiveConfirmLabel = t('common.confirmAction', { action: archiveActionLabel })
  const sessionTags = getVisibleSidebarSessionTags(session.tags)
  const visibleTags = isCompactLayout ? sessionTags.slice(0, 1) : sessionTags
  const hiddenTagCount = Math.max(sessionTags.length - visibleTags.length, 0)
  const parseAutomationTag = useMemo(() => {
    return (tag: string) => {
      if (!tag.startsWith(automationPrefix)) return null
      const parts = tag.split(':')
      if (parts.length < 3) return null
      return {
        ruleId: parts[1],
        ruleTitle: parts.slice(2).join(':')
      }
    }
  }, [automationPrefix])
  const tooltipTags = sessionTags
    .map((tag) => parseAutomationTag(tag)?.ruleTitle ?? tag)
    .map((tag) => tag.trim())
    .filter(Boolean)

  const displayTitle = (session.title != null && session.title !== '')
    ? session.title
    : (session.lastUserMessage != null && session.lastUserMessage !== '')
    ? session.lastUserMessage
    : t('common.newChat')
  const adapterDisplay = session.adapter != null && session.adapter !== ''
    ? getAdapterDisplay(session.adapter)
    : undefined
  const titleTooltipContent = isTouchInteraction
    ? undefined
    : (
      <div className='session-title-tooltip'>
        <div className='session-title-tooltip__title'>
          {displayTitle}
        </div>
        <div className='session-title-tooltip__time'>
          {t('common.createdAt')}: {timeDisplay.full}
        </div>
        {tooltipTags.length > 0 && (
          <div className='session-title-tooltip__tags'>
            <span className='session-title-tooltip__label'>{t('common.tags')}:</span>
            <span className='session-title-tooltip__tag-list'>{tooltipTags.join(', ')}</span>
          </div>
        )}
      </div>
    )

  const lastMessageSnippet = useMemo(() => {
    if (session.lastMessage == null || session.lastMessage === '') return null
    return session.lastMessage.length > 60 ? `${session.lastMessage.slice(0, 60)}...` : session.lastMessage
  }, [session.lastMessage])
  const childToggleLabel = isChildrenCollapsed ? t('common.expandChildren') : t('common.collapseChildren')
  const childToggleButton = hasChildren && onToggleChildren != null
    ? (
      <Tooltip title={resolveTooltipTitle(childToggleLabel)}>
        <Button
          type='text'
          size='small'
          className={`action-btn session-child-toggle ${isChildrenCollapsed ? 'collapsed' : ''}`}
          aria-label={childToggleLabel}
          onClick={(event) => {
            event.stopPropagation()
            onToggleChildren(session.id)
          }}
          icon={<span className='material-symbols-rounded'>chevron_right</span>}
        />
      </Tooltip>
    )
    : null
  const moreActionsLabel = t('common.moreActions')
  const moreActionsButton = (
    <SessionContextMenu
      session={session}
      trigger={['click']}
      onArchive={onArchive}
      onDelete={onDelete}
      onRename={onRename}
      onStar={onStar}
    >
      <Tooltip title={resolveTooltipTitle(moreActionsLabel)}>
        <Button
          type='text'
          size='small'
          className='action-btn action-btn--more'
          aria-label={moreActionsLabel}
          onClick={(event) => {
            event.stopPropagation()
          }}
          icon={<span className='material-symbols-rounded'>more_horiz</span>}
        />
      </Tooltip>
    </SessionContextMenu>
  )
  const shouldShowMessagePreview = showMessagePreview && !isCompactLayout && lastMessageSnippet != null

  const getStatusIcon = (status?: SessionStatus) => {
    if (!status) {
      return <div className={`status-dot ${isActive ? 'active' : ''}`} />
    }

    let icon = ''
    let color = ''
    const title = t(`common.status.${status}`)

    switch (status) {
      case 'completed':
        icon = 'check_circle'
        color = '#52c41a' // Green
        break
      case 'terminated':
        icon = 'remove_circle'
        color = '#bfbfbf' // Grey
        break
      case 'failed':
        icon = 'cancel'
        color = '#ff4d4f' // Red
        break
      case 'running':
        icon = 'sync'
        color = '#1890ff' // Blue
        break
      case 'waiting_input':
        return (
          <Tooltip title={resolveTooltipTitle(title)}>
            <div className='waiting-input-indicator' />
          </Tooltip>
        )
      default:
        return <div className={`status-dot ${isActive ? 'active' : ''}`} />
    }

    return (
      <Tooltip title={resolveTooltipTitle(title)}>
        <span
          className={`material-symbols-rounded status-icon ${status === 'running' ? 'spin' : ''} ${
            isActive ? 'filled' : ''
          }`}
          style={{
            color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {icon}
        </span>
      </Tooltip>
    )
  }

  const handleConfirmableActionClick = (action: Exclude<PendingSessionAction, null>) => {
    if (pendingAction === action) {
      setPendingAction(null)
      void onArchive(session.id)
      return
    }

    setPendingAction(action)
  }

  return (
    <SessionContextMenu
      session={session}
      onArchive={onArchive}
      onDelete={onDelete}
      onRename={onRename}
      onStar={onStar}
    >
      <SessionCard
        onClick={() => isBatchMode ? onToggleSelect(session.id) : onSelect(session)}
        onMouseLeave={() => setPendingAction(null)}
        onDoubleClick={() => {
          // eslint-disable-next-line no-console
          console.log('Session Details:', session)
        }}
        className={`session-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${
          session.isStarred ? 'starred' : ''
        } ${hasChildren ? 'session-item--has-children' : ''} ${isCompactLayout ? 'session-item--compact' : ''} ${
          showCompactActionMenu ? 'session-item--touch' : ''
        }`}
        contentRef={itemContentRef}
        leading={
          <div className={`session-leading ${adapterDisplay?.icon != null ? 'has-adapter' : ''}`}>
            {adapterDisplay?.icon != null && (
              <img
                className='session-adapter-icon'
                src={adapterDisplay.icon}
                alt=''
                aria-hidden='true'
              />
            )}
            <div className={`status-indicator ${adapterDisplay?.icon != null ? 'is-overlay' : ''}`}>
              {getStatusIcon(session.status)}
            </div>
          </div>
        }
        title={
          <Tooltip title={titleTooltipContent} mouseEnterDelay={SIDEBAR_DETAIL_TOOLTIP_DELAY_SECONDS}>
            <span className='session-title-text'>
              {displayTitle}
            </span>
          </Tooltip>
        }
        headerSide={!isBatchMode && (
          <>
            {!isCompactLayout && (
              <Tooltip
                title={resolveTooltipTitle(timeDisplay.full)}
                mouseEnterDelay={SIDEBAR_DETAIL_TOOLTIP_DELAY_SECONDS}
              >
                <span className='time-display'>
                  {timeDisplay.relative}
                </span>
              </Tooltip>
            )}
            {showCompactActionMenu
              ? (
                <>
                  {childToggleButton}
                  {moreActionsButton}
                </>
              )
              : (
                <div className='session-item-actions'>
                  {childToggleButton}
                  <Tooltip
                    title={resolveTooltipTitle(session.isStarred ? t('common.unstar') : t('common.star'))}
                  >
                    <Button
                      type='text'
                      size='small'
                      className={`action-btn star-btn ${session.isStarred ? 'starred' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setPendingAction(null)
                        void onStar(session.id, !session.isStarred)
                      }}
                      icon={
                        <span
                          className={`material-symbols-rounded ${session.isStarred ? 'filled' : ''}`}
                        >
                          star
                        </span>
                      }
                    />
                  </Tooltip>
                  <Tooltip
                    title={resolveTooltipTitle(
                      pendingAction === 'archive' ? archiveConfirmLabel : archiveActionLabel
                    )}
                  >
                    <Button
                      type='text'
                      size='small'
                      className={`action-btn archive-btn ${pendingAction === 'archive' ? 'is-confirming' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleConfirmableActionClick('archive')
                      }}
                    >
                      <span className='material-symbols-rounded'>
                        {session.isArchived ? 'unarchive' : 'archive'}
                      </span>
                      {pendingAction === 'archive' && (
                        <span className='action-btn__label'>{archiveConfirmLabel}</span>
                      )}
                    </Button>
                  </Tooltip>
                  {moreActionsButton}
                </div>
              )}
          </>
        )}
        infoClassName={isBatchMode ? '' : 'with-actions'}
        lastMessage={shouldShowMessagePreview && (
          <div className='session-card-footer'>
            <div className='last-message'>
              {lastMessageSnippet}
            </div>
          </div>
        )}
        tags={visibleTags.length > 0 && (
          <div className='tags-container'>
            {visibleTags.map((tag: string) => {
              const automationTag = parseAutomationTag(tag)
              if (automationTag) {
                const href = `/automation?rule=${encodeURIComponent(automationTag.ruleId)}`
                return (
                  <Tooltip
                    key={tag}
                    title={resolveTooltipTitle(automationTag.ruleTitle)}
                  >
                    <Tag
                      className='session-tag session-tag--automation'
                      onClick={(event) => event.stopPropagation()}
                    >
                      <a
                        className='session-tag__link'
                        href={href}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {automationTag.ruleTitle}
                      </a>
                    </Tag>
                  </Tooltip>
                )
              }
              return (
                <Tooltip
                  key={tag}
                  title={resolveTooltipTitle(tag)}
                >
                  <Tag className='session-tag'>
                    <span className='session-tag__text'>
                      {tag}
                    </span>
                  </Tag>
                </Tooltip>
              )
            })}
            {hiddenTagCount > 0 && (
              <Tag className='session-tag session-tag--count'>
                +{hiddenTagCount}
              </Tag>
            )}
          </div>
        )}
      />
    </SessionContextMenu>
  )
}
