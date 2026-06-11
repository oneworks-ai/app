import { useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'

import {
  INTERACTION_PANEL_SESSION_FOCUS_QUERY_PARAM,
  INTERACTION_PANEL_SESSION_QUERY_PARAM
} from './interaction-panel-session-query'

export function useInteractionPanelQuerySessionTab({
  enabled,
  onFoldChange,
  onOpenSessionPage
}: {
  enabled: boolean
  onFoldChange: (isFolded: boolean) => void
  onOpenSessionPage: (sessionId: string, title: string, options?: { focusRequestId?: string }) => void
}) {
  const location = useLocation()
  const onFoldChangeRef = useRef(onFoldChange)
  const onOpenSessionPageRef = useRef(onOpenSessionPage)
  const querySessionId = useMemo(() => {
    const value = new URLSearchParams(location.search).get(INTERACTION_PANEL_SESSION_QUERY_PARAM)?.trim()
    return value == null || value === '' ? undefined : value
  }, [location.search])
  const queryFocusRequestId = useMemo(() => {
    const value = new URLSearchParams(location.search).get(INTERACTION_PANEL_SESSION_FOCUS_QUERY_PARAM)?.trim()
    return value == null || value === '' ? undefined : value
  }, [location.search])

  useEffect(() => {
    onFoldChangeRef.current = onFoldChange
    onOpenSessionPageRef.current = onOpenSessionPage
  }, [onFoldChange, onOpenSessionPage])

  useEffect(() => {
    if (!enabled) return
    if (querySessionId == null) return
    onFoldChangeRef.current(false)
    onOpenSessionPageRef.current(querySessionId, querySessionId, { focusRequestId: queryFocusRequestId })
  }, [enabled, queryFocusRequestId, querySessionId])
}
