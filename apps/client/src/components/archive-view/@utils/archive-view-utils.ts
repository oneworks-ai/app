import type { KeyboardEvent } from 'react'

import type { Session } from '@oneworks/core'

type Translate = (key: string) => string

export const filterArchivedSessions = (sessions: Session[], searchQuery: string) => {
  if (searchQuery.trim() === '') return sessions

  const query = searchQuery.toLowerCase()
  return sessions.filter((session): boolean => {
    const title = session.title ?? ''
    const lastMessage = session.lastMessage ?? ''
    const lastUserMessage = session.lastUserMessage ?? ''
    const tags = (session.tags ?? []).join(' ')
    return `${title} ${session.id} ${lastMessage} ${lastUserMessage} ${tags}`.toLowerCase().includes(query)
  })
}

export const getArchiveSessionDetails = (session: Session, isCompactView: boolean, t: Translate) => {
  const displayTitle = session.title || session.lastMessage || t('common.newChat')
  const sessionTags = session.tags ?? []
  const visibleTags = isCompactView ? sessionTags.slice(0, 1) : sessionTags
  return {
    displayTitle,
    hiddenTagCount: Math.max(sessionTags.length - visibleTags.length, 0),
    visibleTags
  }
}

export const getArchiveSessionClassName = (
  id: string,
  selectedIds: Set<string>,
  isBatchMode: boolean,
  deleteConfirmSessionId?: string
) =>
  [
    'archive-view__item',
    selectedIds.has(id) ? 'archive-view__item--selected' : '',
    isBatchMode ? 'archive-view__item--batch' : '',
    deleteConfirmSessionId === id ? 'archive-view__item--confirming' : ''
  ].filter(Boolean).join(' ')

export const toggleArchiveSelection = (ids: Set<string>, id: string) => {
  const next = new Set(ids)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export const getArchiveSelection = (selected: boolean, sessions: Session[]) =>
  selected ? new Set(sessions.map(session => session.id)) : new Set<string>()

export const shouldOpenArchiveDeleteFromKey = (
  event: KeyboardEvent<HTMLElement>,
  hasPendingDelete: boolean
) => {
  if (hasPendingDelete || (event.key !== 'Enter' && event.key !== ' ')) return false
  event.preventDefault()
  event.stopPropagation()
  if (event.repeat) return false
  return true
}

export const createArchiveKeyboardAction = (
  disabled: boolean,
  action: (event: KeyboardEvent<HTMLElement>) => void
) =>
(event: KeyboardEvent<HTMLElement>) => {
  if (shouldOpenArchiveDeleteFromKey(event, disabled)) action(event)
}
