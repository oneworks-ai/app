import { useEffect, useRef } from 'react'

import type { Session } from '@oneworks/core'

import { isMessageBranchOfRootSession, isMessageBranchSession } from '#~/utils/message-branch-session'

export function useActiveMessageBranchSession({
  branchLineageLoading,
  branchSessionId,
  branchSessionLoading,
  queryBranchSession,
  rootSessionId,
  sessions
}: {
  branchLineageLoading: boolean
  branchSessionId?: string
  branchSessionLoading: boolean
  queryBranchSession?: Session
  rootSessionId?: string
  sessions: Session[]
}) {
  const lastRenderableBranchRef = useRef<Session | undefined>(undefined)
  const canRenderQueryBranch = queryBranchSession != null &&
    isMessageBranchSession(queryBranchSession) &&
    (
      branchLineageLoading ||
      isMessageBranchOfRootSession(queryBranchSession, rootSessionId, sessions)
    )
  const shouldHoldPreviousBranch = branchSessionId != null &&
    (branchSessionLoading || branchLineageLoading)
  const activeBranchSession = canRenderQueryBranch
    ? queryBranchSession
    : shouldHoldPreviousBranch
    ? lastRenderableBranchRef.current
    : undefined

  useEffect(() => {
    if (canRenderQueryBranch) {
      lastRenderableBranchRef.current = queryBranchSession
      return
    }
    if (branchSessionId == null) {
      lastRenderableBranchRef.current = undefined
    }
  }, [branchSessionId, canRenderQueryBranch, queryBranchSession])

  return activeBranchSession
}
