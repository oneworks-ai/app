import { useEffect, useState } from 'react'

import type { Session } from '@oneworks/core'

export const useArchiveDeleteConfirmation = (isBatchMode: boolean, visibleSessions: Session[]) => {
  const [deleteConfirmSessionId, setDeleteConfirmSessionId] = useState<string>()

  useEffect(() => {
    if (
      isBatchMode ||
      (deleteConfirmSessionId != null && !visibleSessions.some(session => session.id === deleteConfirmSessionId))
    ) {
      setDeleteConfirmSessionId(undefined)
    }
  }, [deleteConfirmSessionId, isBatchMode, visibleSessions])

  return { deleteConfirmSessionId, setDeleteConfirmSessionId }
}
