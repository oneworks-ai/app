import type { InteractionPanelTab } from './interaction-panel-tabs'

export type InteractionPanelTabMovePlacement = 'after' | 'before'

const buildTabOrderStorageKey = (sessionId: string) => `chatInteractionTabOrder:${sessionId}`

export const areInteractionPanelTabOrdersEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((id, index) => id === right[index])

export const readInteractionPanelTabOrder = (sessionId: string): string[] => {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const rawValue = window.localStorage.getItem(buildTabOrderStorageKey(sessionId))
    if (rawValue == null) {
      return []
    }

    const parsedValue = JSON.parse(rawValue)
    return Array.isArray(parsedValue)
      ? parsedValue.filter((id): id is string => typeof id === 'string' && id !== '')
      : []
  } catch {
    return []
  }
}

export const writeInteractionPanelTabOrder = (sessionId: string, order: string[]) => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(buildTabOrderStorageKey(sessionId), JSON.stringify(order))
  } catch {
    // Tab order is a convenience cache; failing to persist should not break the panel.
  }
}

export const normalizeInteractionPanelTabOrder = (tabs: InteractionPanelTab[], order: string[]) => {
  const tabIds = new Set(tabs.map(tab => tab.id))
  const seenIds = new Set<string>()
  const normalizedOrder = order.filter((id) => {
    if (!tabIds.has(id) || seenIds.has(id)) {
      return false
    }

    seenIds.add(id)
    return true
  })

  for (const tab of tabs) {
    if (!seenIds.has(tab.id)) {
      normalizedOrder.push(tab.id)
      seenIds.add(tab.id)
    }
  }

  return normalizedOrder
}

export const orderInteractionPanelTabs = (tabs: InteractionPanelTab[], order: string[]) => {
  const tabsById = new Map(tabs.map(tab => [tab.id, tab]))
  return normalizeInteractionPanelTabOrder(tabs, order)
    .map(id => tabsById.get(id))
    .filter((tab): tab is InteractionPanelTab => tab != null)
}

export const moveInteractionPanelTabOrder = ({
  order,
  placement,
  sourceId,
  tabs,
  targetId
}: {
  order: string[]
  placement: InteractionPanelTabMovePlacement
  sourceId: string
  tabs: InteractionPanelTab[]
  targetId: string
}) => {
  if (sourceId === targetId) {
    return normalizeInteractionPanelTabOrder(tabs, order)
  }

  const normalizedOrder = normalizeInteractionPanelTabOrder(tabs, order).filter(id => id !== sourceId)
  const targetIndex = normalizedOrder.indexOf(targetId)
  if (targetIndex < 0) {
    return normalizeInteractionPanelTabOrder(tabs, order)
  }

  normalizedOrder.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, sourceId)
  return normalizedOrder
}
