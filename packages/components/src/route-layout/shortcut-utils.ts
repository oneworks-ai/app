import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

export interface ShortcutDisplayToken {
  compact: boolean
  value: string
}

const normalizeKey = (key: string) => {
  if (key === ' ') return 'space'
  if (key === '{') return '['
  if (key === '}') return ']'
  return key.toLowerCase()
}

export const formatShortcutLabel = (shortcut: string | undefined, isMac: boolean) => {
  if (shortcut == null || shortcut.trim() === '') return ''
  const tokens = shortcut.split('+').map(token => token.trim()).filter(Boolean)
  return tokens.map((token) => {
    const lower = token.toLowerCase()
    if (lower === 'mod') return isMac ? '⌘' : 'Ctrl'
    if (lower === 'cmd' || lower === 'command' || lower === 'meta') return '⌘'
    if (lower === 'ctrl' || lower === 'control') return 'Ctrl'
    if (lower === 'alt' || lower === 'option') return 'Alt'
    if (lower === 'shift') return 'Shift'
    if (lower === 'space') return 'Space'
    if (lower === 'enter') return 'Enter'
    if (lower === 'escape' || lower === 'esc') return 'Esc'
    if (lower === 'tab') return 'Tab'
    if (lower === 'backspace') return 'Backspace'
    if (lower === 'delete' || lower === 'del') return 'Delete'
    if (lower === 'arrowup') return 'Up'
    if (lower === 'arrowdown') return 'Down'
    if (lower === 'arrowleft') return 'Left'
    if (lower === 'arrowright') return 'Right'
    if (token.length === 1) return token.toUpperCase()
    return token.charAt(0).toUpperCase() + token.slice(1)
  }).join('+')
}

export const getShortcutDisplayTokens = (shortcut: string | undefined, isMac: boolean): ShortcutDisplayToken[] => {
  if (shortcut == null || shortcut.trim() === '') return []

  const tokens = shortcut.split('+').map(token => token.trim()).filter(Boolean)
  return tokens.map((token) => {
    const lower = token.toLowerCase()

    if (lower === 'mod') {
      return { value: isMac ? '⌘' : 'Ctrl', compact: isMac }
    }
    if (lower === 'cmd' || lower === 'command' || lower === 'meta') {
      return { value: '⌘', compact: true }
    }
    if (lower === 'ctrl' || lower === 'control') {
      return { value: isMac ? '⌃' : 'Ctrl', compact: isMac }
    }
    if (lower === 'alt' || lower === 'option') {
      return { value: isMac ? '⌥' : 'Alt', compact: isMac }
    }
    if (lower === 'shift') {
      return { value: isMac ? '⇧' : 'Shift', compact: isMac }
    }
    if (lower === 'space') {
      return { value: 'Space', compact: false }
    }
    if (lower === 'enter') {
      return { value: 'Enter', compact: false }
    }
    if (lower === 'escape' || lower === 'esc') {
      return { value: isMac ? '⎋' : 'Esc', compact: isMac }
    }
    if (lower === 'tab') {
      return { value: isMac ? '⇥' : 'Tab', compact: isMac }
    }
    if (lower === 'backspace') {
      return { value: isMac ? '⌫' : 'Backspace', compact: isMac }
    }
    if (lower === 'delete' || lower === 'del') {
      return { value: isMac ? '⌦' : 'Delete', compact: isMac }
    }
    if (lower === 'arrowup') {
      return { value: '↑', compact: true }
    }
    if (lower === 'arrowdown') {
      return { value: '↓', compact: true }
    }
    if (lower === 'arrowleft') {
      return { value: '←', compact: true }
    }
    if (lower === 'arrowright') {
      return { value: '→', compact: true }
    }
    if (token.length === 1) {
      return { value: token.toUpperCase(), compact: true }
    }

    return {
      compact: false,
      value: token.charAt(0).toUpperCase() + token.slice(1)
    }
  })
}

export const isShortcutMatch = (
  event: KeyboardEvent | ReactKeyboardEvent,
  shortcut: string | undefined,
  isMac: boolean
) => {
  if (shortcut == null || shortcut.trim() === '') return false
  const tokens = shortcut.split('+').map(token => token.trim()).filter(Boolean)
  const expected = {
    altKey: false,
    ctrlKey: false,
    key: '',
    metaKey: false,
    shiftKey: false
  }
  for (const token of tokens) {
    const lower = token.toLowerCase()
    if (lower === 'cmd' || lower === 'command' || lower === 'meta') expected.metaKey = true
    else if (lower === 'ctrl' || lower === 'control') expected.ctrlKey = true
    else if (lower === 'alt' || lower === 'option') expected.altKey = true
    else if (lower === 'shift') expected.shiftKey = true
    else if (lower === 'mod') {
      if (isMac) expected.metaKey = true
      else expected.ctrlKey = true
    } else expected.key = normalizeKey(lower)
  }
  if (expected.key === '') return false
  if (event.metaKey !== expected.metaKey) return false
  if (event.ctrlKey !== expected.ctrlKey) return false
  if (event.altKey !== expected.altKey) return false
  if (event.shiftKey !== expected.shiftKey) return false
  return normalizeKey(event.key) === expected.key
}
