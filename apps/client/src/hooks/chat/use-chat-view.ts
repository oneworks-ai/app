import { useCallback, useEffect } from 'react'

import type { ChatHeaderView } from '#~/components/chat/ChatHeader.js'
import { useQueryParams } from '#~/hooks/useQueryParams.js'

export const normalizeChatView = (
  value: string,
  options: {
    enableTimelineView?: boolean
  } = {}
): ChatHeaderView => {
  if (value === 'timeline') {
    return options.enableTimelineView === true ? 'timeline' : 'history'
  }
  if (value === 'history') {
    return value
  }
  return 'history'
}

type ChatTerminalPanelState = 'closed' | 'fold' | 'open'

const normalizeTerminalPanelState = (value: string, legacyTerminalView: boolean): ChatTerminalPanelState => {
  if (value === 'fold') {
    return 'fold'
  }
  if (value === 'true' || legacyTerminalView) {
    return 'open'
  }
  return 'closed'
}

export function useChatView({
  enableTimelineView
}: {
  enableTimelineView?: boolean
} = {}) {
  const { values: queryValues, update: updateQuery } = useQueryParams<{ terminal: string; view: string }>({
    keys: ['view', 'terminal'],
    defaults: {
      view: 'history',
      terminal: ''
    },
    omit: {
      view: (value) => value === 'history',
      terminal: (value) => value === '' || value === 'false'
    }
  })

  const legacyTerminalView = queryValues.view === 'terminal'
  const activeView = normalizeChatView(legacyTerminalView ? 'history' : queryValues.view, { enableTimelineView })
  const terminalPanelState = normalizeTerminalPanelState(queryValues.terminal, legacyTerminalView)
  const isTerminalOpen = terminalPanelState !== 'closed'
  const isTerminalPanelFolded = terminalPanelState === 'fold'

  const setActiveView = useCallback((view: ChatHeaderView) => {
    updateQuery({ view })
  }, [updateQuery])

  const setIsTerminalOpen = useCallback((nextOpen: boolean) => {
    updateQuery({ terminal: nextOpen ? 'true' : 'false' })
  }, [updateQuery])

  const setIsTerminalPanelFolded = useCallback((nextFolded: boolean) => {
    updateQuery({ terminal: nextFolded ? 'fold' : 'true' })
  }, [updateQuery])

  useEffect(() => {
    if (enableTimelineView == null) {
      return
    }
    if (activeView !== queryValues.view) {
      updateQuery({ view: activeView })
    }
  }, [activeView, enableTimelineView, queryValues.view, updateQuery])

  useEffect(() => {
    if (legacyTerminalView) {
      updateQuery({
        view: 'history',
        terminal: 'true'
      })
    }
  }, [legacyTerminalView, updateQuery])

  return {
    activeView,
    isTerminalPanelFolded,
    isTerminalOpen,
    setActiveView,
    setIsTerminalOpen,
    setIsTerminalPanelFolded
  }
}
