import type { TFunction } from 'i18next'

import { normalizeTerminalPanes, withFixedTerminalTitles } from '#~/components/chat/terminal/@utils/terminal-panes'
import type { TerminalPaneConfig } from '#~/components/chat/terminal/@utils/terminal-panes'

const buildTerminalStorageKey = (sessionId: string) => `chatTerminalPaneIds:${sessionId}`

export const readInteractionTerminalPanes = (sessionId: string, t: TFunction): TerminalPaneConfig[] => {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const rawValue = window.localStorage.getItem(buildTerminalStorageKey(sessionId))
    if (rawValue == null) {
      return []
    }

    const parsedValue = JSON.parse(rawValue)
    if (Array.isArray(parsedValue) && parsedValue.length === 0) {
      return []
    }

    return withFixedTerminalTitles(normalizeTerminalPanes(parsedValue, { fallback: false }), t)
  } catch {
    return []
  }
}

export const writeInteractionTerminalPanes = (
  sessionId: string,
  panes: TerminalPaneConfig[]
) => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(buildTerminalStorageKey(sessionId), JSON.stringify(panes))
  } catch {
    // Local storage is a convenience cache; failing to persist should not break the panel.
  }
}
