/* eslint-disable max-lines -- sidebar list coordinates regular rows, plugin groups, selection, and collapse state. */
import './SessionList.scss'

import { Checkbox, List, Tooltip } from 'antd'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import type { Session } from '@oneworks/core'

import { renderIconAsset } from '#~/components/icons/IconAsset'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import type { PendingSessionCreationContext } from '#~/hooks/chat/session-creation-context'
import type { SidebarSessionSortOrder } from '#~/hooks/use-sidebar-query-state'
import type { PluginContributionSessionGroupAction } from '#~/plugins/plugin-manifest'
import { usePluginCommandExecutor, usePluginSlot } from '#~/plugins/plugin-slots'

import { RoomListRow } from './RoomListRow'
import { SessionItem } from './SessionItem'
import type { SidebarConversationGroup, SidebarRoomItem } from './conversation-items'
import { buildGroupedSidebarConversationItems, getCollapsibleSidebarSessionIds } from './conversation-items'

interface SessionListProps {
  sessions: Session[]
  rooms?: SidebarRoomItem[]
  activeId?: string
  hasActiveFilters: boolean
  isBatchMode: boolean
  isCompactLayout: boolean
  selectedIds: Set<string>
  isTouchInteraction: boolean
  showSessionCardMessage: boolean
  sortOrder: SidebarSessionSortOrder
  searchQuery?: string
  onArchiveRoom: (id: string, isArchived: boolean) => void | Promise<void>
  onFavoriteRoom: (id: string, isFavorited: boolean) => void | Promise<void>
  onSelectRoom: (room: SidebarRoomItem) => void
  onCreateSession: (context?: PendingSessionCreationContext) => void | Promise<void>
  onSelectSession: (session: Session) => void
  onArchiveSession: (id: string) => void | Promise<void>
  onDeleteSession: (id: string) => void | Promise<void>
  onRenameSession: (id: string, title: string) => Promise<void>
  onStarSession: (id: string, isStarred: boolean) => void | Promise<void>
  onToggleSelect: (id: string) => void
}

export function SessionList({
  sessions,
  rooms = [],
  activeId,
  hasActiveFilters,
  isBatchMode,
  isCompactLayout,
  selectedIds,
  isTouchInteraction,
  showSessionCardMessage,
  sortOrder,
  searchQuery,
  onArchiveRoom,
  onFavoriteRoom,
  onSelectRoom,
  onCreateSession,
  onSelectSession,
  onArchiveSession,
  onDeleteSession,
  onRenameSession,
  onStarSession,
  onToggleSelect
}: SessionListProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const executePluginCommand = usePluginCommandExecutor()
  const pluginSessionGroups = usePluginSlot<SidebarConversationGroup>('sessions.groups')
  const collapsibleSessionIds = useMemo(() =>
    getCollapsibleSidebarSessionIds({
      rooms,
      sessions
    }), [rooms, sessions])
  const defaultCollapsedSessionIdsRef = useRef(new Set(collapsibleSessionIds))
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set(collapsibleSessionIds))
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const idsToCollapse = Array.from(collapsibleSessionIds).filter(id => !defaultCollapsedSessionIdsRef.current.has(id))
    if (idsToCollapse.length === 0) return

    for (const id of idsToCollapse) {
      defaultCollapsedSessionIdsRef.current.add(id)
    }

    setCollapsedIds((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const id of idsToCollapse) {
        if (next.has(id)) continue
        next.add(id)
        changed = true
      }
      return changed ? next : prev
    })
  }, [collapsibleSessionIds])

  const conversationItems = buildGroupedSidebarConversationItems({
    collapsedIds,
    collapsedGroupIds,
    groups: pluginSessionGroups,
    rooms,
    sessions,
    sortOrder
  })

  const resolveTooltipTitle = (title?: string) => isTouchInteraction ? undefined : title

  const handleGroupAction = async (
    group: SidebarConversationGroup,
    action: PluginContributionSessionGroupAction
  ) => {
    if (action.disabled === true) return

    if (action.createSession != null) {
      await onCreateSession({
        source: {
          groupId: group.id,
          label: group.title,
          pluginScope: group.pluginScope
        },
        tags: action.createSession.tags,
        title: action.createSession.title
      })
      return
    }

    if (action.command != null) {
      await executePluginCommand?.(group.pluginScope, action.command, {
        actionId: action.id,
        groupId: group.id
      })
      return
    }

    if (action.route != null) {
      void navigate(action.route)
      return
    }

    if (action.href != null) {
      window.open(action.href, '_blank', 'noopener,noreferrer')
    }
  }

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleGroupCollapse = (id: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <div className='session-list-container'>
      <div className='session-list-scroll'>
        <List
          className='session-list'
          size='small'
          locale={{
            emptyText: <div className='empty-text'>
              {searchQuery || hasActiveFilters ? t('common.noSessions') : t('common.startNewChat')}
            </div>
          }}
          dataSource={conversationItems}
          renderItem={(item) => {
            if (item.kind === 'group') {
              const toggleLabel = item.isCollapsed ? t('common.expandGroup') : t('common.collapseGroup')
              const titleLabel = item.hasChildren ? `${item.group.title} ${toggleLabel}` : item.group.title
              return (
                <div
                  className={[
                    'session-list-group',
                    item.isCollapsed ? 'is-collapsed' : ''
                  ].filter(Boolean).join(' ')}
                >
                  <button
                    type='button'
                    className='session-list-group__title'
                    aria-label={titleLabel}
                    aria-expanded={item.hasChildren ? !item.isCollapsed : undefined}
                    disabled={!item.hasChildren}
                    title={item.hasChildren ? toggleLabel : undefined}
                    onClick={() => toggleGroupCollapse(item.id)}
                  >
                    {item.group.icon != null && renderIconAsset({
                      active: false,
                      className: 'session-list-group__icon',
                      icon: item.group.icon
                    })}
                    <span className='session-list-group__text'>{item.group.title}</span>
                    {item.hasChildren && (
                      <MaterialSymbol
                        className='session-list-group__chevron'
                        name='expand_more'
                      />
                    )}
                  </button>
                  {(item.group.actions?.length ?? 0) > 0 && (
                    <span className='session-list-group__actions'>
                      {item.group.actions?.map(action => (
                        <Tooltip key={action.id} title={resolveTooltipTitle(action.title)}>
                          <button
                            type='button'
                            className={[
                              'session-list-group__action',
                              action.danger === true ? 'is-danger' : ''
                            ].filter(Boolean).join(' ')}
                            disabled={action.disabled === true}
                            aria-label={action.title ?? action.id}
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleGroupAction(item.group, action)
                            }}
                          >
                            {renderIconAsset({
                              active: false,
                              className: 'session-list-group__action-icon',
                              icon: action.icon ?? 'more_horiz'
                            })}
                          </button>
                        </Tooltip>
                      ))}
                    </span>
                  )}
                </div>
              )
            }

            if (item.kind === 'room') {
              return (
                <RoomListRow
                  activeId={activeId}
                  isBatchMode={isBatchMode}
                  isCompactLayout={isCompactLayout}
                  isTouchInteraction={isTouchInteraction}
                  room={item.room}
                  selectedIds={selectedIds}
                  onArchiveRoom={onArchiveRoom}
                  onFavoriteRoom={onFavoriteRoom}
                  onSelectRoom={onSelectRoom}
                  onToggleSelect={onToggleSelect}
                />
              )
            }

            return (
              <div
                className={[
                  'session-row',
                  item.depth > 0 ? 'has-parent' : '',
                  activeId === item.session.id ? 'is-active' : '',
                  selectedIds.has(item.session.id) ? 'is-selected' : ''
                ].filter(Boolean).join(' ')}
                style={{ '--session-depth': item.depth } as React.CSSProperties}
              >
                <div className='session-row-main'>
                  {isBatchMode && (
                    <div
                      className='session-select-toggle'
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        checked={selectedIds.has(item.session.id)}
                        onChange={() => onToggleSelect(item.session.id)}
                      />
                    </div>
                  )}
                  <SessionItem
                    session={item.session}
                    isActive={activeId === item.session.id}
                    isBatchMode={isBatchMode}
                    hasChildren={item.hasChildren && !isBatchMode}
                    isChildrenCollapsed={collapsedIds.has(item.session.id)}
                    isCompactLayout={isCompactLayout}
                    isSelected={selectedIds.has(item.session.id)}
                    isTouchInteraction={isTouchInteraction}
                    showMessagePreview={showSessionCardMessage}
                    onSelect={onSelectSession}
                    onArchive={onArchiveSession}
                    onDelete={onDeleteSession}
                    onRename={onRenameSession}
                    onStar={onStarSession}
                    onToggleChildren={item.hasChildren && !isBatchMode ? toggleCollapse : undefined}
                    onToggleSelect={onToggleSelect}
                  />
                </div>
              </div>
            )
          }}
        />
      </div>
    </div>
  )
}
