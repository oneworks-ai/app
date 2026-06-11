const electronModifierByShortcutToken: Record<string, string> = {
  alt: 'Alt',
  cmd: 'Command',
  command: 'Command',
  control: 'Control',
  ctrl: 'Control',
  meta: 'Command',
  mod: 'CommandOrControl',
  option: 'Alt',
  shift: 'Shift'
}

const electronKeyByShortcutToken: Record<string, string> = {
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  arrowup: 'Up',
  backspace: 'Backspace',
  del: 'Delete',
  delete: 'Delete',
  enter: 'Enter',
  esc: 'Esc',
  escape: 'Esc',
  space: 'Space',
  tab: 'Tab'
}

const normalizeShortcutToken = (token: string) => token.trim().toLowerCase()
const isModifierShortcutToken = (token: string) => electronModifierByShortcutToken[token] != null

const resolveElectronShortcutToken = (token: string) => {
  const normalized = normalizeShortcutToken(token)
  const modifier = electronModifierByShortcutToken[normalized]
  if (modifier != null) return modifier

  const key = electronKeyByShortcutToken[normalized]
  if (key != null) return key

  if (/^[a-z\d]$/.test(normalized)) {
    return normalized.toUpperCase()
  }
  if (/^f(?:[1-9]|1\d|2[0-4])$/.test(normalized)) {
    return normalized.toUpperCase()
  }
  return null
}

export const toElectronAccelerator = (shortcut: string) => {
  const tokens = shortcut.split('+').map(normalizeShortcutToken).filter(Boolean)
  if (tokens.length === 0) return null

  const acceleratorTokens = tokens.map(resolveElectronShortcutToken)
  if (acceleratorTokens.some(token => token == null)) return null

  const hasPrimaryModifier = tokens.some(token => (
    token === 'mod' ||
    token === 'cmd' ||
    token === 'command' ||
    token === 'meta' ||
    token === 'ctrl' ||
    token === 'control' ||
    token === 'alt' ||
    token === 'option'
  ))
  if (!hasPrimaryModifier) return null
  if (!tokens.some(token => !isModifierShortcutToken(token))) return null

  return acceleratorTokens.join('+')
}
