import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  arePinnedTabMetasEqual,
  buildPinnedTabView,
  normalizePinnedTabsForOpenTabs,
  readInteractionPanelPinnedTabs,
  writeInteractionPanelPinnedTabs
} from './interaction-panel-pinned-tabs'
import type { InteractionPanelPinnedTabMeta } from './interaction-panel-pinned-tabs'
import type { InteractionPanelTab } from './interaction-panel-tabs'

const sanitizePinnedTabLimit = (value: number) => Math.max(0, Math.floor(value))

const normalizePinnedTabEdits = (edits: { customIcon?: string; customTitle?: string }) => {
  const customIcon = edits.customIcon?.trim()
  const customTitle = edits.customTitle?.trim()
  return {
    ...(customIcon != null && customIcon !== '' ? { customIcon } : {}),
    ...(customTitle != null && customTitle !== '' ? { customTitle } : {})
  }
}

export function useInteractionPanelPinnedTabs({
  maxPinnedTabs,
  tabs,
  terminalSessionId
}: {
  maxPinnedTabs: number
  tabs: InteractionPanelTab[]
  terminalSessionId: string
}) {
  const [pinnedMetas, setPinnedMetas] = useState(() => readInteractionPanelPinnedTabs(terminalSessionId))
  const normalizedMaxPinnedTabs = sanitizePinnedTabLimit(maxPinnedTabs)

  const updatePinnedMetas = useCallback((
    updater: (current: InteractionPanelPinnedTabMeta[]) => InteractionPanelPinnedTabMeta[]
  ) => {
    setPinnedMetas((current) => {
      const next = updater(current)
      writeInteractionPanelPinnedTabs(terminalSessionId, next)
      return next
    })
  }, [terminalSessionId])

  useEffect(() => {
    setPinnedMetas(readInteractionPanelPinnedTabs(terminalSessionId))
  }, [terminalSessionId])

  useEffect(() => {
    const nextPinnedMetas = normalizePinnedTabsForOpenTabs(tabs, pinnedMetas)
    if (!arePinnedTabMetasEqual(nextPinnedMetas, pinnedMetas)) {
      setPinnedMetas(nextPinnedMetas)
      writeInteractionPanelPinnedTabs(terminalSessionId, nextPinnedMetas)
    }
  }, [pinnedMetas, tabs, terminalSessionId])

  const visiblePinnedMetas = useMemo(
    () => normalizePinnedTabsForOpenTabs(tabs, pinnedMetas).slice(0, normalizedMaxPinnedTabs),
    [normalizedMaxPinnedTabs, pinnedMetas, tabs]
  )
  const pinnedIds = useMemo(() => new Set(visiblePinnedMetas.map(item => item.id)), [visiblePinnedMetas])
  const tabsById = useMemo(() => new Map(tabs.map(tab => [tab.id, tab])), [tabs])
  const pinnedTabs = useMemo(() =>
    visiblePinnedMetas
      .map((meta) => {
        const tab = tabsById.get(meta.id)
        return tab == null ? null : buildPinnedTabView(tab, meta)
      })
      .filter((item): item is NonNullable<typeof item> => item != null), [tabsById, visiblePinnedMetas])

  const pinTab = useCallback((tab: InteractionPanelTab, options: { replaceOldest?: boolean } = {}) => {
    updatePinnedMetas((current) => {
      const openPinnedTabs = normalizePinnedTabsForOpenTabs(tabs, current)
      if (openPinnedTabs.some(item => item.id === tab.id) || normalizedMaxPinnedTabs <= 0) {
        return current
      }
      const nextOpenPinnedTabs = [...openPinnedTabs, { id: tab.id }]
      if (nextOpenPinnedTabs.length <= normalizedMaxPinnedTabs) {
        return nextOpenPinnedTabs
      }
      return options.replaceOldest === true
        ? nextOpenPinnedTabs.slice(-normalizedMaxPinnedTabs)
        : current
    })
  }, [normalizedMaxPinnedTabs, tabs, updatePinnedMetas])

  return {
    canPinMoreTabs: visiblePinnedMetas.length < normalizedMaxPinnedTabs,
    pinnedTabs,
    unpinnedTabs: tabs.filter(tab => !pinnedIds.has(tab.id)),
    pinTab,
    unpinTab: (tab: InteractionPanelTab) => updatePinnedMetas(current => current.filter(item => item.id !== tab.id)),
    updatePinnedTab: (tab: InteractionPanelTab, edits: { customIcon?: string; customTitle?: string }) =>
      updatePinnedMetas(current =>
        current.map(item => item.id === tab.id ? { id: item.id, ...normalizePinnedTabEdits(edits) } : item)
      )
  }
}
