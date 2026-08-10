import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import {
  listMarketplaceSelectionAuthorities,
  subscribeMarketplaceSelectionAuthorities
} from '#~/plugins/marketplace-mutation-authority'

import type { MarketplaceSelectionViewAuthority } from '../@core/marketplace-plugin-selection'

export const useMarketplaceSelectionAuthorityState = ({
  contextKey,
  serverKey
}: {
  contextKey: string
  serverKey: string
}) => {
  const mountedRef = useRef(false)
  const serverKeyRef = useRef(serverKey)
  const contextKeyRef = useRef(contextKey)
  const serverRevisionRef = useRef(0)
  const contextRevisionRef = useRef(0)
  const viewPromisesRef = useRef(new Map<string, { promise: Promise<void>; token: object }>())
  const viewAuthoritiesRef = useRef(new Map<string, MarketplaceSelectionViewAuthority>())
  const authoritiesRef = useRef(new Map(listMarketplaceSelectionAuthorities(serverKey).map(item => [item.key, item])))
  const apiPendingRef = useRef(new Set<string>())
  const [stateRevision, setStateRevision] = useState(0)

  const emit = useCallback(() => {
    if (mountedRef.current) setStateRevision(current => current + 1)
  }, [])

  const syncAuthorities = useCallback(() => {
    const nextAuthorities = new Map(
      listMarketplaceSelectionAuthorities(serverKey).map(authority => [authority.key, authority])
    )
    authoritiesRef.current = nextAuthorities
    for (const key of viewAuthoritiesRef.current.keys()) {
      if (!nextAuthorities.has(key)) viewAuthoritiesRef.current.delete(key)
    }
    emit()
  }, [emit, serverKey])

  useLayoutEffect(() => {
    if (serverKeyRef.current !== serverKey) {
      serverKeyRef.current = serverKey
      serverRevisionRef.current += 1
      contextRevisionRef.current += 1
      viewPromisesRef.current.clear()
      viewAuthoritiesRef.current.clear()
      apiPendingRef.current.clear()
      syncAuthorities()
    }
    if (contextKeyRef.current !== contextKey) {
      contextKeyRef.current = contextKey
      contextRevisionRef.current += 1
      viewPromisesRef.current.clear()
      viewAuthoritiesRef.current.clear()
    }
  }, [contextKey, serverKey, syncAuthorities])

  useEffect(() => {
    mountedRef.current = true
    syncAuthorities()
    return () => {
      mountedRef.current = false
      serverRevisionRef.current += 1
      contextRevisionRef.current += 1
      viewPromisesRef.current.clear()
      viewAuthoritiesRef.current.clear()
      apiPendingRef.current.clear()
    }
  }, [syncAuthorities])

  useEffect(() => subscribeMarketplaceSelectionAuthorities(serverKey, syncAuthorities), [serverKey, syncAuthorities])

  return {
    apiPendingRef,
    authoritiesRef,
    contextRevisionRef,
    emit,
    mountedRef,
    serverKeyRef,
    serverRevisionRef,
    stateRevision,
    syncAuthorities,
    viewAuthoritiesRef,
    viewPromisesRef
  }
}
