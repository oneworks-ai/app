import { atom } from 'jotai'

// 侧边栏宽度
export const sidebarWidthAtom = atom(
  Number(localStorage.getItem('sidebarWidth')) || 300
)

// 侧边栏是否正在缩放
export const isSidebarResizingAtom = atom<boolean>(false)

// 侧边栏是否折叠
export const isSidebarCollapsedAtom = atom(false)

export const isMobileSidebarOpenAtom = atom(false)

// 当前选中的会话 ID (全局 UI 状态，用于控制高亮等)
export const activeSessionIdAtom = atom<string | undefined>(undefined)

// 主题模式: 'light' | 'dark' | 'system'
export type ThemeMode = 'light' | 'dark' | 'system'

export const isThemeMode = (value: unknown): value is ThemeMode => {
  return value === 'light' || value === 'dark' || value === 'system'
}

export const normalizeThemeMode = (value: unknown): ThemeMode => (
  isThemeMode(value) ? value : 'system'
)

const themeBaseAtom = atom<ThemeMode>('system')

export const themeAtom = atom(
  get => get(themeBaseAtom),
  (_get, set, value: ThemeMode) => {
    set(themeBaseAtom, normalizeThemeMode(value))
  }
)

const getStoredBoolean = (key: string, defaultValue: boolean) => {
  try {
    const raw = localStorage.getItem(key)
    if (raw === 'true') return true
    if (raw === 'false') return false
  } catch {}

  return defaultValue
}

const createStoredBooleanAtom = (storageKey: string, defaultValue: boolean) => {
  const baseAtom = atom<boolean>(getStoredBoolean(storageKey, defaultValue))

  return atom(
    get => get(baseAtom),
    (_get, set, value: boolean) => {
      const nextValue = value === true
      set(baseAtom, nextValue)

      try {
        localStorage.setItem(storageKey, String(nextValue))
      } catch {}
    }
  )
}

const getStoredNonNegativeInteger = (key: string, defaultValue: number) => {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null || raw.trim() === '') return defaultValue

    const parsed = Number(raw)
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed
    }
  } catch {}

  return defaultValue
}

const createStoredNonNegativeIntegerAtom = (storageKey: string, defaultValue: number) => {
  const baseAtom = atom<number>(getStoredNonNegativeInteger(storageKey, defaultValue))

  return atom(
    get => get(baseAtom),
    (_get, set, value: number) => {
      const nextValue = Number.isInteger(value) && value >= 0
        ? value
        : defaultValue

      set(baseAtom, nextValue)

      try {
        localStorage.setItem(storageKey, String(nextValue))
      } catch {}
    }
  )
}

export type SenderHeaderDisplayMode = 'expanded' | 'collapsed'

const SENDER_HEADER_DISPLAY_STORAGE_KEY = 'oneworks_sender_header_default_display'

const isSenderHeaderDisplayMode = (
  value: string
): value is SenderHeaderDisplayMode => {
  return value === 'expanded' || value === 'collapsed'
}

const getStoredSenderHeaderDisplayMode = (): SenderHeaderDisplayMode => {
  try {
    const raw = localStorage.getItem(SENDER_HEADER_DISPLAY_STORAGE_KEY)
    if (raw != null && isSenderHeaderDisplayMode(raw)) {
      return raw
    }
  } catch {}

  return 'collapsed'
}

const senderHeaderDisplayBaseAtom = atom<SenderHeaderDisplayMode>(
  getStoredSenderHeaderDisplayMode()
)

export const senderHeaderDisplayAtom = atom(
  get => get(senderHeaderDisplayBaseAtom),
  (_get, set, value: SenderHeaderDisplayMode) => {
    const nextValue = isSenderHeaderDisplayMode(value)
      ? value
      : 'collapsed'

    set(senderHeaderDisplayBaseAtom, nextValue)

    try {
      localStorage.setItem(SENDER_HEADER_DISPLAY_STORAGE_KEY, nextValue)
    } catch {}
  }
)

const SHOW_ANNOUNCEMENTS_STORAGE_KEY = 'oneworks_show_announcements'
const SHOW_NEW_SESSION_STARTER_LIST_STORAGE_KEY = 'oneworks_show_new_session_starter_list'
const SESSION_LIST_SEARCH_THRESHOLD_STORAGE_KEY = 'oneworks_session_list_search_threshold'
const INTERACTION_PANEL_PINNED_TAB_LIMIT_STORAGE_KEY = 'oneworks_interaction_panel_pinned_tab_limit'
const DEFAULT_SESSION_LIST_SEARCH_THRESHOLD = 5
const DEFAULT_INTERACTION_PANEL_PINNED_TAB_LIMIT = 4

export const showAnnouncementsAtom = createStoredBooleanAtom(
  SHOW_ANNOUNCEMENTS_STORAGE_KEY,
  true
)

export const showNewSessionStarterListAtom = createStoredBooleanAtom(
  SHOW_NEW_SESSION_STARTER_LIST_STORAGE_KEY,
  true
)

export const sessionListSearchThresholdAtom = createStoredNonNegativeIntegerAtom(
  SESSION_LIST_SEARCH_THRESHOLD_STORAGE_KEY,
  DEFAULT_SESSION_LIST_SEARCH_THRESHOLD
)

export const interactionPanelPinnedTabLimitAtom = createStoredNonNegativeIntegerAtom(
  INTERACTION_PANEL_PINNED_TAB_LIMIT_STORAGE_KEY,
  DEFAULT_INTERACTION_PANEL_PINNED_TAB_LIMIT
)
