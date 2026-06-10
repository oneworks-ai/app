import { useCallback, useEffect, useRef, useState } from 'react'

import {
  createInteractionPanelSessionPage,
  readInteractionPanelSessionPages,
  writeInteractionPanelSessionPages
} from './interaction-panel-session-pages'
import type { InteractionPanelSessionPage } from './interaction-panel-session-pages'

export function useInteractionPanelSessionPages(terminalSessionId: string) {
  const terminalSessionIdRef = useRef(terminalSessionId)
  const [sessionPages, setSessionPages] = useState(() => readInteractionPanelSessionPages(terminalSessionId))

  useEffect(() => {
    if (terminalSessionIdRef.current === terminalSessionId) return
    terminalSessionIdRef.current = terminalSessionId
    setSessionPages(readInteractionPanelSessionPages(terminalSessionId))
  }, [terminalSessionId])

  useEffect(() => {
    writeInteractionPanelSessionPages(terminalSessionId, sessionPages)
  }, [sessionPages, terminalSessionId])

  const addSessionPage = useCallback((title: string) => {
    const nextPage = createInteractionPanelSessionPage(title)
    setSessionPages(current => [...current, nextPage])
    return nextPage
  }, [])

  const closeSessionPages = useCallback((pageIds: Set<string>, sessionIds: Set<string> = new Set()) => {
    if (pageIds.size <= 0 && sessionIds.size <= 0) return
    setSessionPages(current =>
      current.filter(page => !pageIds.has(page.id) && (page.sessionId == null || !sessionIds.has(page.sessionId)))
    )
  }, [])

  const openSessionPage = useCallback((
    sessionId: string,
    title: string,
    options: { focusRequestId?: string } = {}
  ) => {
    const normalizedSessionId = sessionId.trim()
    const focusRequestId = options.focusRequestId?.trim()
    const existingPage = sessionPages.find(page => page.sessionId === normalizedSessionId)
    if (existingPage != null) {
      if (focusRequestId != null && focusRequestId !== '') {
        setSessionPages(current =>
          current.map(page => page.id === existingPage.id ? { ...page, focusRequestId } : page)
        )
      }
      return focusRequestId == null || focusRequestId === '' ? existingPage : { ...existingPage, focusRequestId }
    }

    const nextPage = createInteractionPanelSessionPage(title, normalizedSessionId, focusRequestId)
    setSessionPages(current =>
      current.some(page => page.sessionId === normalizedSessionId) ? current : [...current, nextPage]
    )
    return nextPage
  }, [sessionPages])

  const updateSessionPage = useCallback((
    pageId: string,
    updater: (page: InteractionPanelSessionPage) => InteractionPanelSessionPage
  ) => {
    setSessionPages(current => current.map(page => page.id === pageId ? updater(page) : page))
  }, [])

  return {
    addSessionPage,
    closeSessionPages,
    openSessionPage,
    sessionPages,
    updateSessionPage
  }
}
