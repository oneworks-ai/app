import type { InteractionPanelTab } from './interaction-panel-tabs'

export interface InteractionPanelPinnedTabMeta {
  customIcon?: string
  customTitle?: string
  id: string
}

export interface InteractionPanelPinnedTab {
  customIcon?: string
  customTitle?: string
  icon: string
  id: string
  originalIcon: string
  originalTitle: string
  tab: InteractionPanelTab
  title: string
}

const buildPinnedTabsStorageKey = (sessionId: string) => `chatInteractionPinnedTabs:${sessionId}`

const normalizeText = (value: unknown) => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

const normalizePinnedTabMeta = (value: unknown): InteractionPanelPinnedTabMeta | null => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Partial<InteractionPanelPinnedTabMeta>
  const id = normalizeText(item.id)
  if (id == null) return null
  return {
    id,
    ...(normalizeText(item.customIcon) != null ? { customIcon: normalizeText(item.customIcon) } : {}),
    ...(normalizeText(item.customTitle) != null ? { customTitle: normalizeText(item.customTitle) } : {})
  }
}

export const arePinnedTabMetasEqual = (
  left: InteractionPanelPinnedTabMeta[],
  right: InteractionPanelPinnedTabMeta[]
) =>
  left.length === right.length &&
  left.every((item, index) =>
    item.id === right[index]?.id &&
    item.customIcon === right[index]?.customIcon &&
    item.customTitle === right[index]?.customTitle
  )

export const readInteractionPanelPinnedTabs = (sessionId: string): InteractionPanelPinnedTabMeta[] => {
  if (typeof window === 'undefined') return []

  try {
    const rawValue = window.localStorage.getItem(buildPinnedTabsStorageKey(sessionId))
    const parsedValue = rawValue == null ? [] : JSON.parse(rawValue)
    if (!Array.isArray(parsedValue)) return []
    return parsedValue
      .map(normalizePinnedTabMeta)
      .filter((item): item is InteractionPanelPinnedTabMeta => item != null)
  } catch {
    return []
  }
}

export const writeInteractionPanelPinnedTabs = (sessionId: string, pinnedTabs: InteractionPanelPinnedTabMeta[]) => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(buildPinnedTabsStorageKey(sessionId), JSON.stringify(pinnedTabs))
  } catch {
    // Pinned tabs are best-effort UI state.
  }
}

export const normalizePinnedTabsForOpenTabs = (
  tabs: InteractionPanelTab[],
  pinnedTabs: InteractionPanelPinnedTabMeta[]
) => {
  const tabIds = new Set(tabs.map(tab => tab.id))
  const seenIds = new Set<string>()
  return pinnedTabs.filter((item) => {
    if (!tabIds.has(item.id) || seenIds.has(item.id)) return false
    seenIds.add(item.id)
    return true
  })
}

export const buildPinnedTabView = (
  tab: InteractionPanelTab,
  meta: InteractionPanelPinnedTabMeta
): InteractionPanelPinnedTab => ({
  id: tab.id,
  tab,
  originalIcon: tab.icon,
  originalTitle: tab.label,
  icon: meta.customIcon ?? tab.icon,
  title: meta.customTitle ?? tab.label,
  ...(meta.customIcon != null ? { customIcon: meta.customIcon } : {}),
  ...(meta.customTitle != null ? { customTitle: meta.customTitle } : {})
})
