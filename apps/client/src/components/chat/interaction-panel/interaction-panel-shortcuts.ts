import { getShortcutDisplayTokens } from '#~/utils/shortcutUtils'

export const INTERACTION_PANEL_OPEN_FILE_SHORTCUT = 'mod+p'
export const INTERACTION_PANEL_NEW_TERMINAL_SHORTCUT = 'mod+alt+t'
export const INTERACTION_PANEL_NEW_IFRAME_SHORTCUT = 'mod+alt+w'

export const formatInteractionPanelShortcut = (shortcut: string, isMac: boolean) => {
  const tokens = getShortcutDisplayTokens(shortcut, isMac)
  return tokens.map(token => token.value).join(isMac ? '' : '+')
}
