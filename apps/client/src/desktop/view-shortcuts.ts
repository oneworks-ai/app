import { isShortcutMatch } from '#~/utils/shortcutUtils'

export const DESKTOP_VIEW_SHORTCUT_EVENT = 'oneworks:desktop-view-shortcut'

export const desktopViewShortcutActions = [
  'toggle-sidebar',
  'toggle-terminal',
  'toggle-file-tree',
  'open-browser-tab',
  'reload-browser-page',
  'toggle-side-panel',
  'find',
  'previous-chat',
  'next-chat',
  'back',
  'forward'
] as const

export type DesktopViewShortcutAction = typeof desktopViewShortcutActions[number]
export type DesktopViewShortcutSource = 'app-shell' | 'monaco'

export interface DesktopViewShortcutEventDetail {
  action: DesktopViewShortcutAction
  source?: DesktopViewShortcutSource
}

export const desktopViewShortcutSpecs: Array<{
  action: DesktopViewShortcutAction
  shortcut: string
}> = [
  { action: 'toggle-sidebar', shortcut: 'mod+b' },
  { action: 'toggle-terminal', shortcut: 'mod+j' },
  { action: 'toggle-file-tree', shortcut: 'mod+shift+e' },
  { action: 'open-browser-tab', shortcut: 'mod+t' },
  { action: 'reload-browser-page', shortcut: 'mod+r' },
  { action: 'toggle-side-panel', shortcut: 'mod+alt+b' },
  { action: 'find', shortcut: 'mod+f' },
  { action: 'previous-chat', shortcut: 'mod+shift+[' },
  { action: 'next-chat', shortcut: 'mod+shift+]' },
  { action: 'back', shortcut: 'mod+[' },
  { action: 'forward', shortcut: 'mod+]' }
]

const desktopViewShortcutActionSet = new Set<string>(desktopViewShortcutActions)

export const isDesktopViewShortcutAction = (value: unknown): value is DesktopViewShortcutAction => (
  typeof value === 'string' && desktopViewShortcutActionSet.has(value)
)

export const emitDesktopViewShortcut = (
  action: DesktopViewShortcutAction,
  options: { source?: DesktopViewShortcutSource } = {}
) => {
  const detail: DesktopViewShortcutEventDetail = options.source == null
    ? { action }
    : { action, source: options.source }

  window.dispatchEvent(
    new CustomEvent<DesktopViewShortcutEventDetail>(DESKTOP_VIEW_SHORTCUT_EVENT, {
      detail
    })
  )
}

export const getDesktopViewShortcut = (action: DesktopViewShortcutAction) =>
  desktopViewShortcutSpecs.find(item => item.action === action)?.shortcut

export const getDesktopViewShortcutActionFromEvent = (
  event: KeyboardEvent,
  isMac: boolean
): DesktopViewShortcutAction | null => (
  desktopViewShortcutSpecs.find(item => isShortcutMatch(event, item.shortcut, isMac))?.action ?? null
)

export const addDesktopViewShortcutListener = (
  listener: (action: DesktopViewShortcutAction, detail: DesktopViewShortcutEventDetail) => void
) => {
  const handleShortcut = (event: Event) => {
    const detail = (event as CustomEvent<DesktopViewShortcutEventDetail>).detail
    const action = detail?.action
    if (!isDesktopViewShortcutAction(action)) return
    listener(action, detail)
  }

  window.addEventListener(DESKTOP_VIEW_SHORTCUT_EVENT, handleShortcut)
  return () => window.removeEventListener(DESKTOP_VIEW_SHORTCUT_EVENT, handleShortcut)
}
