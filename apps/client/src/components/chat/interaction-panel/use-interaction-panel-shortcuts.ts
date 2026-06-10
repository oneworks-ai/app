import { useEffect } from 'react'

import { isShortcutMatch } from '#~/utils/shortcutUtils'

import {
  INTERACTION_PANEL_NEW_IFRAME_SHORTCUT,
  INTERACTION_PANEL_NEW_TERMINAL_SHORTCUT,
  INTERACTION_PANEL_OPEN_FILE_SHORTCUT
} from './interaction-panel-shortcuts'

export function useInteractionPanelShortcuts({
  enabled,
  isMac,
  onNewIframe,
  onNewTerminal,
  onOpenResource
}: {
  enabled: boolean
  isMac: boolean
  onNewIframe: () => void
  onNewTerminal: () => void
  onOpenResource: () => void
}) {
  useEffect(() => {
    if (!enabled) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcuts = [
        { shortcut: INTERACTION_PANEL_OPEN_FILE_SHORTCUT, run: onOpenResource },
        { shortcut: INTERACTION_PANEL_NEW_TERMINAL_SHORTCUT, run: onNewTerminal },
        { shortcut: INTERACTION_PANEL_NEW_IFRAME_SHORTCUT, run: onNewIframe }
      ]
      const matchedShortcut = shortcuts.find(item => isShortcutMatch(event, item.shortcut, isMac))
      if (matchedShortcut == null) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      matchedShortcut.run()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [enabled, isMac, onNewIframe, onNewTerminal, onOpenResource])
}
