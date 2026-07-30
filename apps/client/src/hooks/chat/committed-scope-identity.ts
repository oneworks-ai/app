import { useCallback, useLayoutEffect, useRef } from 'react'

export interface CommittedScopeIdentity {
  generation: number
  scopeId: string
}

export const useCommittedScopeIdentity = (scopeId: string) => {
  const committedScopeRef = useRef<CommittedScopeIdentity>({
    generation: 0,
    scopeId
  })

  useLayoutEffect(() => {
    const committedScope = committedScopeRef.current
    if (committedScope.scopeId === scopeId) return

    committedScopeRef.current = {
      generation: committedScope.generation + 1,
      scopeId
    }
  }, [scopeId])

  const getCommittedScopeIdentity = useCallback(() => {
    return committedScopeRef.current
  }, [])
  const isCommittedScopeIdentityCurrent = useCallback((
    identity: CommittedScopeIdentity
  ) => {
    return committedScopeRef.current === identity
  }, [])

  return {
    getCommittedScopeIdentity,
    isCommittedScopeIdentityCurrent
  }
}
