import type { ScopedMutator } from 'swr'

import type { Session } from '@oneworks/core'

import { getSessionCacheKey } from '#~/api'

interface SessionListResponse {
  sessions: Session[]
}

interface SessionDetailResponse {
  session: Session
}

interface DeletedSessionUpdate {
  id: string
  isDeleted: boolean
}

export type SessionUpdate = Session | DeletedSessionUpdate

export const isDeletedSessionUpdate = (update: SessionUpdate): update is DeletedSessionUpdate => {
  return 'isDeleted' in update && update.isDeleted
}

const sortSessions = (sessions: Session[]) => {
  return [...sessions].sort((a, b) => {
    const starredDelta = Number(b.isStarred === true) - Number(a.isStarred === true)
    if (starredDelta !== 0) return starredDelta
    return (b.createdAt ?? 0) - (a.createdAt ?? 0)
  })
}

export const mergeSessionList = (
  prev: SessionListResponse | undefined,
  updatedSession: SessionUpdate,
  filter: 'active' | 'archived'
) => {
  if (prev?.sessions == null) return prev

  if (isDeletedSessionUpdate(updatedSession)) {
    return {
      ...prev,
      sessions: prev.sessions.filter((session) => session.id !== updatedSession.id)
    }
  }

  const session = updatedSession
  const shouldInclude = filter === 'archived'
    ? session.isArchived === true
    : session.isArchived !== true
  const existing = prev.sessions.find((session) => session.id === updatedSession.id)

  if (!shouldInclude) {
    return {
      ...prev,
      sessions: prev.sessions.filter((session) => session.id !== updatedSession.id)
    }
  }

  const nextSessions = existing
    ? prev.sessions.map((currentSession) =>
      currentSession.id === updatedSession.id ? { ...currentSession, ...session } : currentSession
    )
    : [session, ...prev.sessions]

  return {
    ...prev,
    sessions: sortSessions(nextSessions)
  }
}

export const mergeSessionDetail = (
  prev: SessionDetailResponse | undefined,
  updatedSession: SessionUpdate
) => {
  if (isDeletedSessionUpdate(updatedSession)) {
    return prev?.session.id === updatedSession.id ? undefined : prev
  }

  if (prev?.session == null) {
    return { session: updatedSession }
  }

  return prev.session.id === updatedSession.id
    ? { ...prev, session: { ...prev.session, ...updatedSession } }
    : prev
}

export function updateSessionCaches(
  mutate: ScopedMutator,
  updatedSession: SessionUpdate
) {
  void mutate('/api/sessions', (prev: SessionListResponse | undefined) => {
    return mergeSessionList(prev, updatedSession, 'active')
  }, false)

  void mutate('/api/sessions/archived', (prev: SessionListResponse | undefined) => {
    return mergeSessionList(prev, updatedSession, 'archived')
  }, false)

  void mutate(getSessionCacheKey(updatedSession.id), (prev: SessionDetailResponse | undefined) => {
    return mergeSessionDetail(prev, updatedSession)
  }, false)
}

const isAdapterConfigCacheKey = (key: unknown) => {
  if (Array.isArray(key)) {
    return key[0] === '/api/adapters'
  }

  return typeof key === 'string' && key.startsWith('/api/adapters/')
}

export const isConfigRelatedDerivedCacheKey = (key: unknown) => {
  if (Array.isArray(key)) {
    return key[0] === 'worktree-environment' || key[0] === '/api/adapters'
  }

  return isAdapterConfigCacheKey(key)
}

export async function revalidateConfigRelatedCaches(mutate: ScopedMutator) {
  await Promise.all([
    mutate('/api/config'),
    mutate('worktree-environments'),
    mutate(isConfigRelatedDerivedCacheKey)
  ])
}
