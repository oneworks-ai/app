import { useCallback, useRef } from 'react'

import type { InteractionPanelTab } from '../../interaction-panel-tabs'
import type { InteractionTerminalPanesController } from '../../use-interaction-terminal-panes'

export interface FrozenPanelTabCloseTarget {
  kind: InteractionPanelTab['kind']
  label: string
  tabGeneration: number
  tabId: string
  terminalGeneration?: number
  terminalId?: string
}

export interface FrozenPanelTabCloseRequest {
  anchorTabId?: string
  ownerGeneration: number
  ownerId: string
  requestId: number
  targets: FrozenPanelTabCloseTarget[]
}

interface PanelTabGenerationEntry {
  fingerprint: string
  generation: number
}

const getTabFingerprint = (tab: InteractionPanelTab) => {
  if (tab.kind === 'terminal') return `${tab.kind}:${tab.terminalId}`
  if (tab.kind === 'file') return `${tab.kind}:${tab.path}`
  return tab.kind
}

export function usePanelTabCloseRequests({
  ownerGeneration,
  ownerId,
  tabs,
  terminalPanes
}: {
  ownerGeneration: number
  ownerId: string
  tabs: InteractionPanelTab[]
  terminalPanes: InteractionTerminalPanesController
}) {
  const stateRef = useRef({
    nextGeneration: 0,
    nextRequestId: 0,
    ownerKey: '',
    tabGenerationById: new Map<string, PanelTabGenerationEntry>()
  })
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const ownerKey = `${ownerId}:${ownerGeneration}`
  const state = stateRef.current

  if (state.ownerKey !== ownerKey) {
    state.ownerKey = ownerKey
    state.tabGenerationById.clear()
  }

  const currentIds = new Set(tabs.map(tab => tab.id))
  for (const tabId of state.tabGenerationById.keys()) {
    if (!currentIds.has(tabId)) state.tabGenerationById.delete(tabId)
  }
  for (const tab of tabs) {
    const fingerprint = getTabFingerprint(tab)
    const current = state.tabGenerationById.get(tab.id)
    if (current?.fingerprint === fingerprint) continue
    state.nextGeneration += 1
    state.tabGenerationById.set(tab.id, { fingerprint, generation: state.nextGeneration })
  }

  const createCloseRequest = useCallback((
    targetTabs: InteractionPanelTab[],
    anchorTabId?: string
  ): FrozenPanelTabCloseRequest => {
    const seen = new Set<string>()
    const targets = targetTabs.flatMap((tab): FrozenPanelTabCloseTarget[] => {
      if (seen.has(tab.id)) return []
      seen.add(tab.id)
      const tabGeneration = stateRef.current.tabGenerationById.get(tab.id)?.generation
      if (tabGeneration == null) return []
      if (tab.kind !== 'terminal') {
        return [{ kind: tab.kind, label: tab.label, tabGeneration, tabId: tab.id }]
      }

      const terminalGeneration = terminalPanes.getTerminalGeneration(tab.terminalId)
      return [{
        kind: tab.kind,
        label: tab.label,
        tabGeneration,
        tabId: tab.id,
        ...(terminalGeneration == null ? {} : { terminalGeneration }),
        terminalId: tab.terminalId
      }]
    })
    stateRef.current.nextRequestId += 1
    return {
      ...(anchorTabId == null ? {} : { anchorTabId }),
      ownerGeneration,
      ownerId,
      requestId: stateRef.current.nextRequestId,
      targets
    }
  }, [ownerGeneration, ownerId, terminalPanes])

  const resolveCloseRequest = useCallback((request: FrozenPanelTabCloseRequest) => {
    if (request.ownerId !== ownerId || request.ownerGeneration !== ownerGeneration) return []
    const targetById = new Map(request.targets.map(target => [target.tabId, target]))
    return tabsRef.current.filter((tab) => {
      const target = targetById.get(tab.id)
      if (target == null || target.kind !== tab.kind) return false
      if (stateRef.current.tabGenerationById.get(tab.id)?.generation !== target.tabGeneration) return false
      if (tab.kind !== 'terminal') return true
      if (target.terminalId !== tab.terminalId) return false
      const currentTerminalGeneration = terminalPanes.getTerminalGeneration(tab.terminalId)
      return currentTerminalGeneration == null || target.terminalGeneration === currentTerminalGeneration
    })
  }, [ownerGeneration, ownerId, terminalPanes])

  const isCloseRequestInvalidated = useCallback((request: FrozenPanelTabCloseRequest) => {
    if (request.ownerId !== ownerId || request.ownerGeneration !== ownerGeneration) return true
    const currentTabById = new Map(tabsRef.current.map(tab => [tab.id, tab]))
    return request.targets.some((target) => {
      const tab = currentTabById.get(target.tabId)
      if (tab == null) return false
      if (stateRef.current.tabGenerationById.get(tab.id)?.generation !== target.tabGeneration) return true
      if (tab.kind !== 'terminal' || target.kind !== 'terminal' || target.terminalId !== tab.terminalId) return false
      const currentTerminalGeneration = terminalPanes.getTerminalGeneration(tab.terminalId)
      return currentTerminalGeneration != null && currentTerminalGeneration !== target.terminalGeneration
    })
  }, [ownerGeneration, ownerId, terminalPanes])

  return { createCloseRequest, isCloseRequestInvalidated, resolveCloseRequest }
}
