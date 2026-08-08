import './ArchiveView.scss'

import type { Session } from '@oneworks/core'
import { App, Button, Checkbox, Empty, Input, List, Popconfirm, Space, Tag, Tooltip } from 'antd'
import dayjs from 'dayjs'
import React, { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { RouteContainerHeader } from '#~/components/layout/RouteContainerHeader'
import { RouteContainerLayout } from '#~/components/layout/RouteContainerLayout'
import { useRouteContainerSidebarOpener } from '#~/components/layout/use-route-container-sidebar-opener'
import { useRoutePluginChrome } from '#~/plugins/route-plugin-chrome'

import { deleteSession, getApiErrorMessage, listSessions, updateSession } from '../api'

export function ArchiveView() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { isCompactView, openRouteSidebar } = useRouteContainerSidebarOpener()
  const { data: sessionsRes, mutate } = useSWR<{ sessions: Session[] }>(
    '/api/sessions/archived',
    async () => listSessions('archived')
  )
  const sessions: Session[] = sessionsRes?.sessions ?? []

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBatchMode, setIsBatchMode] = useState(false)
  const [deleteConfirmSessionId, setDeleteConfirmSessionId] = useState<string>()
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())
  const pendingDeleteIdsRef = useRef<Set<string>>(new Set())
  const { headerActions: routePluginHeaderActions } = useRoutePluginChrome('archive')

  const filteredSessions = useMemo(() => {
    if (searchQuery.trim() === '') return sessions
    const query = searchQuery.toLowerCase()
    return sessions.filter((s: Session): boolean => {
      const title = s.title ?? ''
      const lastMsg = s.lastMessage ?? ''
      const lastUserMsg = s.lastUserMessage ?? ''
      const tags = (s.tags ?? []).join(' ')
      const searchStr = `${title} ${s.id} ${lastMsg} ${lastUserMsg} ${tags}`.toLowerCase()
      return searchStr.includes(query)
    })
  }, [sessions, searchQuery])

  const handleRestore = async (id: string) => {
    try {
      await updateSession(id, { isArchived: false })
      void message.success(t('common.restoreSuccess', 'Restored successfully'))
      void mutate()
    } catch (err) {
      void message.error(getApiErrorMessage(err, t('common.restoreFailed', 'Failed to restore')))
    }
  }

  const deleteArchivedSessions = async (
    ids: string[],
    feedback: { error: string; success: string }
  ) => {
    const uniqueIds = Array.from(new Set(ids))
    if (
      uniqueIds.length === 0 ||
      uniqueIds.some(id => pendingDeleteIdsRef.current.has(id))
    ) {
      return
    }

    uniqueIds.forEach(id => pendingDeleteIdsRef.current.add(id))
    setPendingDeleteIds(new Set(pendingDeleteIdsRef.current))

    const results = await Promise.allSettled(uniqueIds.map(async id => deleteSession(id)))
    const deletedIds = uniqueIds.filter((_, index) => results[index]?.status === 'fulfilled')
    const failedIds = uniqueIds.filter((_, index) => results[index]?.status === 'rejected')

    if (deletedIds.length > 0) {
      const deletedIdSet = new Set(deletedIds)
      await mutate(
        current =>
          current == null
            ? current
            : { ...current, sessions: current.sessions.filter(session => !deletedIdSet.has(session.id)) },
        { revalidate: false }
      )
      void mutate()
    }

    if (failedIds.length === 0) {
      void message.success(feedback.success)
    } else {
      const firstFailureIndex = uniqueIds.findIndex(id => failedIds.includes(id))
      const firstFailure = results[firstFailureIndex]
      const error = firstFailure?.status === 'rejected' ? firstFailure.reason : undefined
      void message.error(getApiErrorMessage(error, feedback.error))
    }

    uniqueIds.forEach(id => pendingDeleteIdsRef.current.delete(id))
    setPendingDeleteIds(new Set(pendingDeleteIdsRef.current))

    return { deletedIds, failedIds }
  }

  const handleDelete = async (id: string) => {
    const result = await deleteArchivedSessions([id], {
      error: t('common.deleteFailed', 'Failed to delete'),
      success: t('common.deleteSuccess', 'Deleted successfully')
    })
    if (result?.failedIds.length === 0) {
      setDeleteConfirmSessionId(current => current === id ? undefined : current)
    }
  }

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setSelectedIds(next)
  }

  const handleSelectAll = (selected: boolean) => {
    if (selected) {
      setSelectedIds(new Set(filteredSessions.map(s => s.id)))
    } else {
      setSelectedIds(new Set())
    }
  }

  const handleBatchRestore = async () => {
    try {
      await Promise.all(Array.from(selectedIds).map(async (id) => updateSession(id, { isArchived: false })))
      void message.success(t('common.batchRestoreSuccess', 'Batch restored successfully'))
      setSelectedIds(new Set())
      setIsBatchMode(false)
      void mutate()
    } catch (err) {
      void message.error(getApiErrorMessage(err, t('common.batchRestoreFailed', 'Failed to restore some sessions')))
    }
  }

  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds)
    const result = await deleteArchivedSessions(ids, {
      error: t('common.batchDeleteFailed', 'Failed to delete some sessions'),
      success: t('common.batchDeleteSuccess', 'Batch deleted successfully')
    })
    if (result == null) return

    if (result.failedIds.length === 0) {
      setSelectedIds(new Set())
      setIsBatchMode(false)
    } else {
      setSelectedIds(new Set(result.failedIds))
    }
  }

  const isAllSelected = filteredSessions.length > 0 && selectedIds.size === filteredSessions.length
  const hasPendingDelete = pendingDeleteIds.size > 0
  return (
    <RouteContainerLayout
      className={`archive-view ${isCompactView ? 'archive-view--compact' : ''}`}
      bodyClassName='archive-view__body'
      contentInset
      header={
        <RouteContainerHeader
          actionItems={routePluginHeaderActions}
          icon='archive'
          onOpenSidebar={openRouteSidebar}
          title={t('common.archivedSessions')}
        />
      }
    >
      <div className='archive-view__toolbar'>
        {isBatchMode && (
          <div className='archive-view__select-all'>
            <Tooltip title={isAllSelected ? t('common.deselectAll') : t('common.selectAll')}>
              <Checkbox
                checked={isAllSelected}
                disabled={hasPendingDelete}
                indeterminate={selectedIds.size > 0 && selectedIds.size < filteredSessions.length}
                onChange={(e) => handleSelectAll(e.target.checked)}
              />
            </Tooltip>
          </div>
        )}
        <Input
          prefix={<span className='material-symbols-rounded archive-view__search-icon'>search</span>}
          placeholder={t('common.search')}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          allowClear
          className='archive-view__search-input'
        />
        <Space size={6} className='archive-view__toolbar-actions'>
          {isBatchMode
            ? (
              <>
                <span className='archive-view__batch-info'>
                  {t('common.selectedCount', { count: selectedIds.size })}
                </span>
                <Tooltip title={t('common.cancel')}>
                  <Button
                    icon={
                      <span className='material-symbols-rounded archive-view__action-icon'>
                        close
                      </span>
                    }
                    onClick={() => {
                      setIsBatchMode(false)
                      setSelectedIds(new Set())
                    }}
                    disabled={hasPendingDelete}
                    className='archive-view__icon-button'
                  />
                </Tooltip>
                <Tooltip title={t('common.batchRestore')}>
                  <Button
                    type='primary'
                    icon={
                      <span className='material-symbols-rounded archive-view__action-icon'>
                        unarchive
                      </span>
                    }
                    onClick={() => {
                      void handleBatchRestore()
                    }}
                    disabled={selectedIds.size === 0 || hasPendingDelete}
                    className='archive-view__icon-button'
                  />
                </Tooltip>
                <Popconfirm
                  title={t('common.deleteConfirm', { count: selectedIds.size })}
                  onConfirm={() => {
                    void handleBatchDelete()
                  }}
                  disabled={selectedIds.size === 0 || hasPendingDelete}
                >
                  <Tooltip title={t('common.batchDelete')}>
                    <Button
                      danger
                      icon={
                        <span className='material-symbols-rounded archive-view__action-icon'>
                          delete_sweep
                        </span>
                      }
                      disabled={selectedIds.size === 0 || hasPendingDelete}
                      loading={hasPendingDelete}
                      className='archive-view__icon-button'
                    />
                  </Tooltip>
                </Popconfirm>
              </>
            )
            : (
              <Tooltip title={t('common.batchMode')}>
                <Button
                  icon={
                    <span className='material-symbols-rounded archive-view__action-icon'>
                      checklist
                    </span>
                  }
                  onClick={() => setIsBatchMode(true)}
                  disabled={sessions.length === 0 || hasPendingDelete}
                  className='archive-view__icon-button'
                />
              </Tooltip>
            )}
        </Space>
      </div>
      <div className='archive-view__list'>
        {filteredSessions.length === 0
          ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={searchQuery ? t('common.noSessions') : t('common.noArchivedSessions')}
            />
          )
          : (
            <List
              itemLayout='horizontal'
              dataSource={filteredSessions}
              renderItem={(session) => {
                const displayTitle = (session.title != null && session.title !== '')
                  ? session.title
                  : (session.lastMessage != null && session.lastMessage !== '')
                  ? session.lastMessage
                  : t('common.newChat')
                const sessionTags = session.tags ?? []
                const visibleTags = isCompactView ? sessionTags.slice(0, 1) : sessionTags
                const hiddenTagCount = Math.max(sessionTags.length - visibleTags.length, 0)

                return (
                  <List.Item
                    className={[
                      'archive-view__item',
                      selectedIds.has(session.id) ? 'archive-view__item--selected' : '',
                      isBatchMode ? 'archive-view__item--batch' : '',
                      deleteConfirmSessionId === session.id ? 'archive-view__item--confirming' : ''
                    ].filter(Boolean).join(' ')}
                    onClick={() => isBatchMode && !hasPendingDelete && handleToggleSelect(session.id)}
                  >
                    <div className='archive-view__item-row'>
                      {isBatchMode && (
                        <div className='archive-view__item-select'>
                          <Checkbox
                            checked={selectedIds.has(session.id)}
                            disabled={hasPendingDelete}
                            onChange={() => handleToggleSelect(session.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      )}
                      <span className='material-symbols-rounded archive-view__item-icon'>
                        chat_bubble
                      </span>
                      <div className='archive-view__item-main'>
                        <span className='archive-view__item-title'>{displayTitle}</span>
                        <div className='archive-view__item-meta'>
                          {visibleTags.length > 0 && (
                            <div className='archive-view__item-tags'>
                              {visibleTags.map((tag: string) => (
                                <Tag key={tag} className='archive-view__item-tag'>{tag}</Tag>
                              ))}
                              {hiddenTagCount > 0 && (
                                <span className='archive-view__item-tag-count'>+{hiddenTagCount}</span>
                              )}
                            </div>
                          )}
                          <span className='archive-view__item-time'>
                            {dayjs(session.createdAt).format('YYYY-MM-DD HH:mm')}
                          </span>
                        </div>
                      </div>

                      {!isBatchMode && (
                        <div className='archive-view__item-actions'>
                          <Tooltip title={t('common.restore')}>
                            <Button
                              type='text'
                              size='small'
                              className='archive-view__item-action-button'
                              icon={
                                <span className='material-symbols-rounded archive-view__action-icon'>unarchive</span>
                              }
                              disabled={pendingDeleteIds.has(session.id)}
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleRestore(session.id)
                              }}
                            />
                          </Tooltip>
                          <Popconfirm
                            title={t('common.deleteSessionConfirm')}
                            open={deleteConfirmSessionId === session.id}
                            onOpenChange={(open) => {
                              if (open) {
                                setDeleteConfirmSessionId(session.id)
                              } else if (!pendingDeleteIdsRef.current.has(session.id)) {
                                setDeleteConfirmSessionId(undefined)
                              }
                            }}
                            onCancel={() => {
                              if (!pendingDeleteIdsRef.current.has(session.id)) {
                                setDeleteConfirmSessionId(undefined)
                              }
                            }}
                            onConfirm={(e) => {
                              e?.stopPropagation()
                              void handleDelete(session.id)
                            }}
                            okButtonProps={{ loading: pendingDeleteIds.has(session.id) }}
                          >
                            <Button
                              type='text'
                              size='small'
                              danger
                              className='archive-view__item-action-button'
                              icon={<span className='material-symbols-rounded archive-view__action-icon'>delete</span>}
                              aria-label={t('common.delete')}
                              disabled={pendingDeleteIds.has(session.id)}
                              loading={pendingDeleteIds.has(session.id)}
                            />
                          </Popconfirm>
                        </div>
                      )}
                    </div>
                  </List.Item>
                )
              }}
            />
          )}
      </div>
    </RouteContainerLayout>
  )
}
