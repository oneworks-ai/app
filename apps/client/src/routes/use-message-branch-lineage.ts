import { useEffect, useState } from 'react'

import type { Session } from '@oneworks/core'

import { getSession } from '#~/api'

interface BranchLineageState {
  branchSession?: Session
  branchSessionId?: string
  isLoading: boolean
  rootSessionId?: string
  sessions: Session[]
}

const mergeSessions = (sessions: Session[], extraSessions: Array<Session | undefined>) => {
  const sessionMap = new Map(sessions.map(session => [session.id, session]))
  for (const session of extraSessions) {
    if (session != null && session.id !== '') {
      sessionMap.set(session.id, session)
    }
  }
  return [...sessionMap.values()]
}

export function useMessageBranchLineage({
  branchSession,
  branchSessionId,
  session,
  sessions
}: {
  branchSession?: Session
  branchSessionId?: string
  session?: Session
  sessions?: Session[]
}) {
  const [state, setState] = useState<BranchLineageState>({ isLoading: false, sessions: [] })
  const rootSessionId = session?.id

  useEffect(() => {
    if (rootSessionId == null || rootSessionId === '') {
      setState({ isLoading: false, sessions: [] })
      return
    }
    if (branchSessionId == null) {
      setState(current =>
        current.rootSessionId === rootSessionId
          ? { ...current, branchSession: undefined, branchSessionId: undefined, isLoading: false }
          : { isLoading: false, rootSessionId, sessions: [] }
      )
      return
    }
    if (branchSession == null || branchSession.id !== branchSessionId) {
      setState(current =>
        current.rootSessionId === rootSessionId
          ? { ...current, branchSessionId, isLoading: true }
          : { branchSessionId, isLoading: true, rootSessionId, sessions: [] }
      )
      return
    }

    let cancelled = false
    const knownSessions = new Map<string, Session>()
    for (const item of sessions ?? []) {
      knownSessions.set(item.id, item)
    }
    for (const item of [session, branchSession]) {
      if (item != null && item.id !== '') {
        knownSessions.set(item.id, item)
      }
    }

    setState(current => ({
      branchSession,
      branchSessionId,
      isLoading: true,
      rootSessionId,
      sessions: mergeSessions(current.rootSessionId === rootSessionId ? current.sessions : [], [branchSession])
    }))

    const loadLineage = async () => {
      const lineageSessions: Session[] = []
      const seenIds = new Set<string>([branchSession.id])
      let current: Session | undefined = branchSession

      while (current != null) {
        const sourceSessionId: string | undefined = current.messageBranchSourceSessionId?.trim()
        if (sourceSessionId == null || sourceSessionId === '' || seenIds.has(sourceSessionId)) {
          break
        }

        seenIds.add(sourceSessionId)
        let sourceSession = knownSessions.get(sourceSessionId)
        if (sourceSession == null) {
          try {
            sourceSession = (await getSession(sourceSessionId)).session
          } catch {
            break
          }
        }
        if (sourceSession == null) {
          break
        }

        knownSessions.set(sourceSession.id, sourceSession)
        lineageSessions.push(sourceSession)
        current = sourceSession
      }

      if (!cancelled) {
        setState(current => ({
          branchSession,
          branchSessionId,
          isLoading: false,
          rootSessionId,
          sessions: mergeSessions(
            current.rootSessionId === rootSessionId ? current.sessions : [],
            [branchSession, ...lineageSessions]
          )
        }))
      }
    }

    void loadLineage()

    return () => {
      cancelled = true
    }
  }, [branchSession, branchSessionId, rootSessionId, session, sessions])

  const hasRootContext = state.rootSessionId === rootSessionId
  const keepPreviousLineage = branchSessionId != null &&
    (branchSession == null || state.branchSessionId !== branchSessionId || state.isLoading)

  return {
    branchSession: branchSession ?? (state.branchSessionId === branchSessionId ? state.branchSession : undefined),
    isLoading: keepPreviousLineage,
    sessions: hasRootContext ? state.sessions : []
  }
}
