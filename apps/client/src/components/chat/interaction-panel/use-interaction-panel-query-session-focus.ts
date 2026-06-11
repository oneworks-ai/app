import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'

import {
  INTERACTION_PANEL_SESSION_FOCUS_QUERY_PARAM,
  INTERACTION_PANEL_SESSION_QUERY_PARAM
} from './interaction-panel-session-query'

export function useInteractionPanelQuerySessionFocus() {
  const location = useLocation()

  return useMemo(() => {
    const params = new URLSearchParams(location.search)
    const sessionId = params.get(INTERACTION_PANEL_SESSION_QUERY_PARAM)?.trim()
    const focusRequestId = params.get(INTERACTION_PANEL_SESSION_FOCUS_QUERY_PARAM)?.trim()
    return {
      focusRequestId: focusRequestId == null || focusRequestId === '' ? undefined : focusRequestId,
      sessionId: sessionId == null || sessionId === '' ? undefined : sessionId
    }
  }, [location.search])
}
