import { createOneWorksCursorSvg } from '@oneworks/cursor'
import type { BrowserControlAgentActionState, BrowserControlPageCommandRequest } from '@oneworks/types'

const cursorDataUrls = new Map<string, string>()

export type BrowserControlAgentTabState = Exclude<BrowserControlAgentActionState, { phase: 'idle' }> & {
  browserPageId: string
  panelPageId: string
}

export type BrowserControlAgentTabStates = Record<string, BrowserControlAgentTabState>

export interface BrowserControlAgentSafetyTimerEntry {
  browserPageId: string
  operationId: string
  timer: number
}

export type BrowserControlAgentCommandOwner = 'ignore' | 'owned' | 'session-mismatch'

export const getBrowserControlAgentCursorDataUrl = (color: string) => {
  const cached = cursorDataUrls.get(color)
  if (cached != null) return cached
  const dataUrl = `data:image/svg+xml,${encodeURIComponent(createOneWorksCursorSvg({ color, size: 64 }))}`
  cursorDataUrls.set(color, dataUrl)
  return dataUrl
}

export const applyBrowserControlAgentTabState = (
  current: BrowserControlAgentTabStates,
  request: BrowserControlPageCommandRequest
): { applied: boolean; states: BrowserControlAgentTabStates } => {
  const command = request.command
  if (command.type !== 'set_agent_action_state') return { applied: false, states: current }
  const state = command.state
  const existing = current[request.panelPageId]

  if (state.phase === 'idle') {
    if (
      existing == null ||
      existing.browserPageId !== request.pageId ||
      existing.operation_id !== state.operation_id
    ) {
      return { applied: false, states: current }
    }
    const next = { ...current }
    delete next[request.panelPageId]
    return { applied: true, states: next }
  }

  if (
    state.phase === 'settle' && (
      existing == null ||
      existing.browserPageId !== request.pageId ||
      existing.operation_id !== state.operation_id
    )
  ) {
    return { applied: false, states: current }
  }

  return {
    applied: true,
    states: {
      ...current,
      [request.panelPageId]: {
        ...state,
        browserPageId: request.pageId,
        panelPageId: request.panelPageId
      }
    }
  }
}

export const resolveBrowserControlTabIcon = ({
  agentState,
  faviconUrl,
  hasCustomIcon
}: {
  agentState?: BrowserControlAgentTabState
  faviconUrl?: string
  hasCustomIcon: boolean
}) => {
  if (agentState != null) return { kind: 'agent' as const, state: agentState }
  if (!hasCustomIcon && faviconUrl != null && faviconUrl !== '') {
    return { kind: 'favicon' as const, url: faviconUrl }
  }
  return { kind: 'symbol' as const }
}

export const pruneBrowserControlAgentTabStates = (
  states: BrowserControlAgentTabStates,
  activePageIds: ReadonlySet<string>
) => Object.fromEntries(Object.entries(states).filter(([pageId]) => activePageIds.has(pageId)))

export const resolveBrowserControlAgentCommandOwner = ({
  pageIds,
  request,
  sessionId
}: {
  pageIds: ReadonlySet<string>
  request: BrowserControlPageCommandRequest
  sessionId?: string
}): BrowserControlAgentCommandOwner => {
  if (!pageIds.has(request.panelPageId)) return 'ignore'
  if (request.sessionId != null && request.sessionId !== sessionId) return 'session-mismatch'
  return 'owned'
}

export const updateBrowserControlAgentSafetyTimer = ({
  applied,
  clearTimer,
  onExpire,
  request,
  setTimer,
  timeoutMs,
  timers
}: {
  applied: boolean
  clearTimer: (timer: number) => void
  onExpire: (entry: Omit<BrowserControlAgentSafetyTimerEntry, 'timer'>) => void
  request: BrowserControlPageCommandRequest
  setTimer: (callback: () => void, timeoutMs: number) => number
  timeoutMs: number
  timers: Map<string, BrowserControlAgentSafetyTimerEntry>
}) => {
  if (!applied || request.command.type !== 'set_agent_action_state') return false
  const panelPageId = request.panelPageId
  const existing = timers.get(panelPageId)
  if (existing != null) clearTimer(existing.timer)
  timers.delete(panelPageId)
  if (request.command.state.phase === 'idle') return true

  const entry = {
    browserPageId: request.pageId,
    operationId: request.command.state.operation_id
  }
  const timer = setTimer(() => {
    const current = timers.get(panelPageId)
    if (
      current?.browserPageId !== entry.browserPageId ||
      current.operationId !== entry.operationId
    ) {
      return
    }
    timers.delete(panelPageId)
    onExpire(entry)
  }, timeoutMs)
  timers.set(panelPageId, { ...entry, timer })
  return true
}
