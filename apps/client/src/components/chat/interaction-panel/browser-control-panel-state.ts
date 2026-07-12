import type { SessionPanelArea, SessionPanelAreaState, SessionPanelState, SessionPanelTab } from '@oneworks/types'

import { fromWorkspaceDrawerIframeTabId, toWorkspaceDrawerIframeTabId } from './interaction-panel-iframe-pages'

type PanelLifecycleCommand =
  | { type: 'close' }
  | { type: 'duplicate'; placement?: SessionPanelArea }
  | { type: 'move'; placement: SessionPanelArea }
  | { type: 'show' }

export interface BrowserControlPanelLifecycleResult {
  openedArea?: SessionPanelArea
  result?: Record<string, unknown>
  state: SessionPanelState
  error?: { code: string; message: string }
}

const toStoredTabId = (area: SessionPanelArea, panelPageId: string) =>
  area === 'right' ? toWorkspaceDrawerIframeTabId(panelPageId) : panelPageId

const toPanelPageId = (area: SessionPanelArea, tabId: string) =>
  area === 'right' ? fromWorkspaceDrawerIframeTabId(tabId) : tabId

const replaceArea = (
  state: SessionPanelState,
  area: SessionPanelArea,
  next: SessionPanelAreaState
): SessionPanelState => ({ ...state, [area]: next })

const removeTab = (area: SessionPanelAreaState, tabId: string): SessionPanelAreaState => {
  const tabs = area.tabs.filter(tab => tab.id !== tabId)
  return {
    ...(area.layout == null ? {} : { layout: area.layout }),
    tabs,
    ...(area.activeTabId !== tabId
      ? { activeTabId: area.activeTabId }
      : tabs[0] == null
      ? {}
      : { activeTabId: tabs[0].id })
  }
}

const addActiveTab = (area: SessionPanelAreaState, tab: SessionPanelTab): SessionPanelAreaState => ({
  ...(area.layout == null ? {} : { layout: area.layout }),
  tabs: [...area.tabs.filter(current => current.id !== tab.id), tab],
  activeTabId: tab.id
})

export const applyBrowserControlPanelLifecycleCommand = ({
  command,
  createPageId,
  panelPageId,
  state
}: {
  command: PanelLifecycleCommand
  createPageId: () => string
  panelPageId: string
  state: SessionPanelState
}): BrowserControlPanelLifecycleResult => {
  const sourceArea = (['bottom', 'right'] as const).find(area =>
    state[area].tabs.some(tab => tab.kind === 'web' && toPanelPageId(area, tab.id) === panelPageId)
  )
  if (sourceArea == null) {
    return {
      state,
      error: { code: 'PANEL_PAGE_NOT_FOUND', message: 'The browser panel tab is unavailable.' }
    }
  }

  const sourceTabId = toStoredTabId(sourceArea, panelPageId)
  const sourceTab = state[sourceArea].tabs.find(tab => tab.kind === 'web' && tab.id === sourceTabId)
  if (sourceTab == null || sourceTab.kind !== 'web') {
    return {
      state,
      error: { code: 'PANEL_PAGE_SOURCE_MISSING', message: 'The browser panel tab source is unavailable.' }
    }
  }

  if (command.type === 'close') {
    return {
      state: replaceArea(state, sourceArea, removeTab(state[sourceArea], sourceTabId)),
      result: { closed: true, panel_page_id: panelPageId }
    }
  }

  if (command.type === 'show') {
    return {
      openedArea: sourceArea,
      state: replaceArea(state, sourceArea, { ...state[sourceArea], activeTabId: sourceTabId }),
      result: { panel_page_id: panelPageId, placement: sourceArea, shown: true }
    }
  }

  if (command.type === 'duplicate') {
    const targetArea = command.placement ?? sourceArea
    const duplicatePageId = createPageId()
    const duplicateTabId = toStoredTabId(targetArea, duplicatePageId)
    const { browserControlRequestId: _requestId, ...copy } = sourceTab
    return {
      openedArea: targetArea,
      state: replaceArea(state, targetArea, addActiveTab(state[targetArea], { ...copy, id: duplicateTabId })),
      result: {
        duplicated: true,
        panel_page_id: duplicatePageId,
        placement: targetArea,
        page_id_changed: true
      }
    }
  }

  const targetArea = command.placement
  if (targetArea === sourceArea) {
    return {
      openedArea: targetArea,
      state: replaceArea(state, sourceArea, { ...state[sourceArea], activeTabId: sourceTabId }),
      result: { moved: false, panel_page_id: panelPageId, placement: targetArea, page_id_changed: false }
    }
  }

  const targetTabId = toStoredTabId(targetArea, panelPageId)
  const withoutSource = replaceArea(state, sourceArea, removeTab(state[sourceArea], sourceTabId))
  return {
    openedArea: targetArea,
    state: replaceArea(
      withoutSource,
      targetArea,
      addActiveTab(withoutSource[targetArea], {
        ...sourceTab,
        id: targetTabId
      })
    ),
    result: { moved: true, panel_page_id: panelPageId, placement: targetArea, page_id_changed: true }
  }
}

export const applyBrowserControlPanelLifecycleCommandToRef = ({
  stateRef,
  ...input
}: Omit<Parameters<typeof applyBrowserControlPanelLifecycleCommand>[0], 'state'> & {
  stateRef: { current: SessionPanelState }
}) => {
  const outcome = applyBrowserControlPanelLifecycleCommand({ ...input, state: stateRef.current })
  if (outcome.error == null) stateRef.current = outcome.state
  return outcome
}
