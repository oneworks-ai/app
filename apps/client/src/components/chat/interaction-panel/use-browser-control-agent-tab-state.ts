import { useEffect, useRef, useState } from 'react'

import {
  applyBrowserControlAgentTabState,
  pruneBrowserControlAgentTabStates,
  resolveBrowserControlAgentCommandOwner,
  updateBrowserControlAgentSafetyTimer
} from './browser-control-agent-tab-state'
import type {
  BrowserControlAgentSafetyTimerEntry,
  BrowserControlAgentTabStates
} from './browser-control-agent-tab-state'

const agentStateSafetyTimeoutMs = 8_000

export { getBrowserControlAgentCursorDataUrl, resolveBrowserControlTabIcon } from './browser-control-agent-tab-state'

export const useBrowserControlAgentTabState = ({
  pageIds,
  sessionId
}: {
  pageIds: string[]
  sessionId?: string
}) => {
  const [states, setStates] = useState<BrowserControlAgentTabStates>({})
  const pageIdsRef = useRef(new Set(pageIds))
  const sessionIdRef = useRef(sessionId)
  const statesRef = useRef(states)
  const timersRef = useRef(new Map<string, BrowserControlAgentSafetyTimerEntry>())
  pageIdsRef.current = new Set(pageIds)
  sessionIdRef.current = sessionId
  statesRef.current = states

  const clearSafetyTimer = (panelPageId: string) => {
    const entry = timersRef.current.get(panelPageId)
    if (entry != null) window.clearTimeout(entry.timer)
    timersRef.current.delete(panelPageId)
  }

  useEffect(() => {
    const activePageIds = new Set(pageIds)
    const next = pruneBrowserControlAgentTabStates(statesRef.current, activePageIds)
    if (Object.keys(next).length !== Object.keys(statesRef.current).length) {
      for (const pageId of Object.keys(statesRef.current)) {
        if (!activePageIds.has(pageId)) clearSafetyTimer(pageId)
      }
      statesRef.current = next
      setStates(next)
    }
  }, [pageIds])

  useEffect(() => {
    const dispose = window.oneworksDesktop?.onBrowserControlPageCommand?.((request) => {
      if (request.command.type !== 'set_agent_action_state') return
      const complete = (completion: {
        error?: { code: string; message: string }
        ok: boolean
        result?: unknown
      }) => {
        void window.oneworksDesktop?.completeBrowserControlPageCommand?.({
          ...completion,
          requestId: request.requestId
        })
      }
      const owner = resolveBrowserControlAgentCommandOwner({
        pageIds: pageIdsRef.current,
        request,
        sessionId: sessionIdRef.current
      })
      // A renderer may mount separate bottom/right dock workspaces. Only the
      // workspace that owns this stable panel page identity may acknowledge it.
      if (owner === 'ignore') return
      if (owner === 'session-mismatch') {
        complete({
          ok: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'The owning browser session is not active in this renderer.' }
        })
        return
      }

      const outcome = applyBrowserControlAgentTabState(statesRef.current, request)
      const phase = request.command.state.phase
      if (outcome.applied) {
        statesRef.current = outcome.states
        setStates(outcome.states)
        updateBrowserControlAgentSafetyTimer({
          applied: true,
          clearTimer: timer => window.clearTimeout(timer),
          onExpire: ({ browserPageId, operationId }) => {
            const current = statesRef.current[request.panelPageId]
            if (current?.browserPageId !== browserPageId || current.operation_id !== operationId) return
            const next = { ...statesRef.current }
            delete next[request.panelPageId]
            statesRef.current = next
            setStates(next)
          },
          request,
          setTimer: (callback, timeoutMs) => window.setTimeout(callback, timeoutMs),
          timeoutMs: agentStateSafetyTimeoutMs,
          timers: timersRef.current
        })
      }

      const acknowledge = () =>
        complete({
          ok: true,
          result: {
            applied: outcome.applied,
            page_id: request.pageId,
            panel_page_id: request.panelPageId,
            phase
          }
        })
      if (outcome.applied && phase !== 'idle') {
        window.requestAnimationFrame(acknowledge)
      } else {
        acknowledge()
      }
    })
    return () => {
      dispose?.()
      for (const entry of timersRef.current.values()) window.clearTimeout(entry.timer)
      timersRef.current.clear()
    }
  }, [])

  return states
}
