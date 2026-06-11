import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import type { InteractionPanelSessionPage } from './interaction-panel-session-pages'
import {
  INTERACTION_PANEL_SESSION_FOCUS_QUERY_PARAM,
  INTERACTION_PANEL_SESSION_QUERY_PARAM
} from './interaction-panel-session-query'

const getSessionIdsForPageIds = (pages: InteractionPanelSessionPage[], pageIds: Set<string>) => (
  new Set(pages.flatMap(page => pageIds.has(page.id) && page.sessionId != null ? [page.sessionId] : []))
)

export function useCloseInteractionPanelSessionPages({
  closeSessionPages,
  sessionPages
}: {
  closeSessionPages: (pageIds: Set<string>, sessionIds?: Set<string>) => void
  sessionPages: InteractionPanelSessionPage[]
}) {
  const location = useLocation()
  const navigate = useNavigate()

  return useCallback((pageIds: Set<string>) => {
    const sessionIds = getSessionIdsForPageIds(sessionPages, pageIds)
    closeSessionPages(pageIds, sessionIds)

    const querySessionId = new URLSearchParams(location.search).get(INTERACTION_PANEL_SESSION_QUERY_PARAM)?.trim()
    if (querySessionId == null || querySessionId === '' || !sessionIds.has(querySessionId)) return

    const nextParams = new URLSearchParams(location.search)
    nextParams.delete(INTERACTION_PANEL_SESSION_QUERY_PARAM)
    nextParams.delete(INTERACTION_PANEL_SESSION_FOCUS_QUERY_PARAM)
    const search = nextParams.toString()
    void navigate({
      pathname: location.pathname,
      search: search === '' ? '' : `?${search}`
    }, { replace: true })
  }, [closeSessionPages, location.pathname, location.search, navigate, sessionPages])
}
