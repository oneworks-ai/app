/* eslint-disable max-lines -- session panel state keeps normalization, merge, and persistence semantics together. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  Session,
  SessionPanelArea,
  SessionPanelAreaState,
  SessionPanelState,
  SessionPanelTab
} from '@oneworks/core'

import { getSession, updateSession } from '#~/api'
import { getServerBaseUrl } from '#~/runtime-config'

const emptyArea = (): SessionPanelAreaState => ({ tabs: [] })
const SESSION_PANEL_STATE_PERSIST_DELAY_MS = 120

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const normalizeArea = (value: unknown): SessionPanelAreaState => {
  const input = isObjectRecord(value) ? value : {}
  const tabs = Array.isArray(input.tabs)
    ? input.tabs.filter((tab): tab is SessionPanelTab => isObjectRecord(tab) && typeof tab.id === 'string')
    : []
  const activeTabId = typeof input.activeTabId === 'string' && tabs.some(tab => tab.id === input.activeTabId)
    ? input.activeTabId
    : undefined
  const layout = isObjectRecord(input.layout) ? input.layout : undefined
  return {
    tabs,
    ...(layout == null ? {} : { layout }),
    ...(activeTabId == null ? {} : { activeTabId })
  }
}

export const normalizeSessionPanelState = (value: unknown): SessionPanelState => {
  const input = isObjectRecord(value) ? value : {}
  return {
    bottom: normalizeArea(input.bottom),
    right: normalizeArea(input.right)
  }
}

const ensureActiveTab = (area: SessionPanelAreaState): SessionPanelAreaState => {
  if (area.activeTabId != null && area.tabs.some(tab => tab.id === area.activeTabId)) {
    return area
  }

  const activeTabId = area.tabs[0]?.id
  return {
    ...(area.layout == null ? {} : { layout: area.layout }),
    tabs: area.tabs,
    ...(activeTabId == null ? {} : { activeTabId })
  }
}

const stableSerializeValue = (value: unknown): string =>
  JSON.stringify(value, (_key, input) => {
    if (!isObjectRecord(input)) return input

    return Object.fromEntries(
      Object.entries(input).sort(([left], [right]) => left.localeCompare(right))
    )
  }) ?? 'undefined'

const serializePanelState = (value: SessionPanelState) => stableSerializeValue(value)

const serializeArea = (value: SessionPanelAreaState) => stableSerializeValue(value)

const tabIdSet = (tabs: SessionPanelTab[]) => new Set(tabs.map(tab => tab.id))

const haveSameTabIds = (left: SessionPanelTab[], right: SessionPanelTab[]) => {
  if (left.length !== right.length) return false

  const rightIds = tabIdSet(right)
  return left.every(tab => rightIds.has(tab.id))
}

const mergePanelTabs = (
  baseTabs: SessionPanelTab[],
  nextTabs: SessionPanelTab[],
  latestTabs: SessionPanelTab[]
) => {
  const nextById = new Map(nextTabs.map(tab => [tab.id, tab]))
  const nextIds = new Set(nextById.keys())
  const removedIds = new Set(baseTabs.filter(tab => !nextIds.has(tab.id)).map(tab => tab.id))
  const merged: SessionPanelTab[] = []
  const seen = new Set<string>()

  for (const latestTab of latestTabs) {
    if (removedIds.has(latestTab.id)) continue
    seen.add(latestTab.id)
    merged.push(nextById.get(latestTab.id) ?? latestTab)
  }

  for (const nextTab of nextTabs) {
    if (seen.has(nextTab.id)) continue
    seen.add(nextTab.id)
    merged.push(nextTab)
  }

  return merged
}

const resolveMergedActiveTabId = (
  nextArea: SessionPanelAreaState,
  latestArea: SessionPanelAreaState,
  tabs: SessionPanelTab[]
) => {
  if (nextArea.activeTabId != null && tabs.some(tab => tab.id === nextArea.activeTabId)) {
    return nextArea.activeTabId
  }

  if (latestArea.activeTabId != null && tabs.some(tab => tab.id === latestArea.activeTabId)) {
    return latestArea.activeTabId
  }

  return tabs[0]?.id
}

const mergePanelAreaForPersist = (
  baseArea: SessionPanelAreaState,
  nextArea: SessionPanelAreaState,
  latestArea: SessionPanelAreaState
): SessionPanelAreaState => {
  const tabs = mergePanelTabs(baseArea.tabs, nextArea.tabs, latestArea.tabs)
  const activeTabId = resolveMergedActiveTabId(nextArea, latestArea, tabs)
  const didChangeLayout = serializeArea({ layout: nextArea.layout, tabs: [] }) !==
    serializeArea({ layout: baseArea.layout, tabs: [] })
  const layout = didChangeLayout && haveSameTabIds(nextArea.tabs, tabs)
    ? nextArea.layout
    : latestArea.layout ?? nextArea.layout

  return {
    tabs,
    ...(layout == null ? {} : { layout }),
    ...(activeTabId == null ? {} : { activeTabId })
  }
}

const mergePanelStateForPersist = (
  baseState: SessionPanelState,
  nextState: SessionPanelState,
  latestState: SessionPanelState
): SessionPanelState => ({
  bottom: serializeArea(baseState.bottom) === serializeArea(nextState.bottom)
    ? latestState.bottom
    : mergePanelAreaForPersist(baseState.bottom, nextState.bottom, latestState.bottom),
  right: serializeArea(baseState.right) === serializeArea(nextState.right)
    ? latestState.right
    : mergePanelAreaForPersist(baseState.right, nextState.right, latestState.right)
})

export interface SessionPanelStateController {
  panelState: SessionPanelState
  setPanelState: (updater: (current: SessionPanelState) => SessionPanelState) => void
  updateArea: (
    area: SessionPanelArea,
    updater: (current: SessionPanelAreaState) => SessionPanelAreaState
  ) => void
}

interface PendingPanelStatePersist {
  baseState: SessionPanelState
  nextState: SessionPanelState
}

const isPanelStateDebugEnabled = () => {
  try {
    return new URLSearchParams(window.location?.search ?? '').get('oneworks_debug') === '1'
  } catch {
    return false
  }
}

const logPanelStateDebug = (message: string, data?: unknown) => {
  if (!isPanelStateDebugEnabled()) return
  try {
    const debugGlobal = window as typeof window & {
      __oneworksDebugEvents?: Array<{ at: number; data?: unknown; message: string; scope: string }>
    }
    const events = debugGlobal.__oneworksDebugEvents ?? []
    events.push({ at: Date.now(), data, message, scope: 'panel-state' })
    if (events.length > 1000) events.splice(0, events.length - 1000)
    debugGlobal.__oneworksDebugEvents = events
  } catch {
    // Debug buffer should never affect the app.
  }
  void data
  void message
}

const summarizeAreaForDebug = (area: SessionPanelAreaState) => {
  const layout = isObjectRecord(area.layout) ? area.layout : {}
  const grid = isObjectRecord(layout.grid) ? layout.grid : {}
  const root = isObjectRecord(grid.root) ? grid.root : {}
  return {
    activeTabId: area.activeTabId,
    gridHeight: grid.height,
    gridWidth: grid.width,
    rootSize: root.size,
    tabs: area.tabs.map(tab => ({ id: tab.id, kind: tab.kind }))
  }
}

export function useSessionPanelState(session?: Session, fallbackSessionId?: string): SessionPanelStateController {
  const [panelState, setPanelState] = useState<SessionPanelState>(() => normalizeSessionPanelState(session?.panelState))
  const lastSessionStateKeyRef = useRef<string | null>(null)
  const pendingPersistRef = useRef<PendingPanelStatePersist | null>(null)
  const persistTimerRef = useRef<number | null>(null)
  const inFlightPersistKeyRef = useRef<string | null>(null)
  const completedPersistKeyRef = useRef<string | null>(
    serializePanelState(normalizeSessionPanelState(session?.panelState))
  )
  const sessionId = session?.id ?? fallbackSessionId
  const persistedStateKey = useMemo(() => stableSerializeValue(session?.panelState ?? null), [session?.panelState])

  useEffect(() => {
    const nextKey = `${sessionId ?? ''}:${persistedStateKey}`
    if (lastSessionStateKeyRef.current === nextKey) return

    const nextState = normalizeSessionPanelState(session?.panelState)
    lastSessionStateKeyRef.current = nextKey
    completedPersistKeyRef.current = serializePanelState(nextState)
    pendingPersistRef.current = null
    inFlightPersistKeyRef.current = null
    if (persistTimerRef.current != null) {
      window.clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
    setPanelState(current => serializePanelState(current) === serializePanelState(nextState) ? current : nextState)
  }, [persistedStateKey, session?.panelState, sessionId])

  useEffect(() => () => {
    if (persistTimerRef.current != null) {
      window.clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
  }, [])

  const runPersistPanelState = useCallback((baseState: SessionPanelState, nextState: SessionPanelState) => {
    if (sessionId == null || sessionId === '') {
      logPanelStateDebug('skip persist without session id')
      return
    }

    const nextStateKey = serializePanelState(nextState)
    if (completedPersistKeyRef.current === nextStateKey || inFlightPersistKeyRef.current === nextStateKey) {
      logPanelStateDebug('skip persist duplicate key', {
        inFlight: inFlightPersistKeyRef.current === nextStateKey,
        nextKeyLength: nextStateKey.length,
        previousCompletedKeyLength: completedPersistKeyRef.current?.length ?? null,
        sessionId
      })
      return
    }

    inFlightPersistKeyRef.current = nextStateKey
    void (async () => {
      logPanelStateDebug('persist start', {
        bottom: summarizeAreaForDebug(nextState.bottom),
        nextKeyLength: nextStateKey.length,
        previousKeyLength: completedPersistKeyRef.current?.length ?? null,
        right: summarizeAreaForDebug(nextState.right),
        serverBaseUrl: getServerBaseUrl(),
        sessionId
      })
      const latestSession = await getSession(sessionId)
      const latestState = normalizeSessionPanelState(latestSession.session.panelState)
      const mergedState = mergePanelStateForPersist(baseState, nextState, latestState)
      const mergedStateKey = serializePanelState(mergedState)
      if (completedPersistKeyRef.current === mergedStateKey) {
        logPanelStateDebug('skip persist merged unchanged', {
          mergedKeyLength: mergedStateKey.length,
          sessionId
        })
        return
      }

      await updateSession(sessionId, { panelState: mergedState })
      completedPersistKeyRef.current = mergedStateKey
      logPanelStateDebug('persist done', {
        bottom: summarizeAreaForDebug(mergedState.bottom),
        mergedKeyLength: mergedStateKey.length,
        right: summarizeAreaForDebug(mergedState.right),
        serverBaseUrl: getServerBaseUrl(),
        sessionId
      })
    })().catch((err: unknown) => {
      console.error('[chat] failed to persist session panel state:', err)
    }).finally(() => {
      if (inFlightPersistKeyRef.current === nextStateKey) {
        inFlightPersistKeyRef.current = null
      }
    })
  }, [sessionId])

  const persistPanelState = useCallback((baseState: SessionPanelState, nextState: SessionPanelState) => {
    pendingPersistRef.current = { baseState, nextState }
    logPanelStateDebug('schedule persist', {
      bottom: summarizeAreaForDebug(nextState.bottom),
      delayMs: SESSION_PANEL_STATE_PERSIST_DELAY_MS,
      nextKeyLength: serializePanelState(nextState).length,
      right: summarizeAreaForDebug(nextState.right),
      sessionId
    })

    if (persistTimerRef.current != null) {
      window.clearTimeout(persistTimerRef.current)
      logPanelStateDebug('reschedule persist', { sessionId })
    }

    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null
      const pendingPersist = pendingPersistRef.current
      pendingPersistRef.current = null
      if (pendingPersist == null) return

      runPersistPanelState(pendingPersist.baseState, pendingPersist.nextState)
    }, SESSION_PANEL_STATE_PERSIST_DELAY_MS)
  }, [runPersistPanelState])

  const commitPanelState = useCallback((
    updater: (current: SessionPanelState) => SessionPanelState
  ) => {
    setPanelState((current) => {
      const nextState = normalizeSessionPanelState(updater(current))
      if (serializePanelState(nextState) === serializePanelState(current)) {
        logPanelStateDebug('commit ignored unchanged', {
          bottom: summarizeAreaForDebug(current.bottom),
          right: summarizeAreaForDebug(current.right),
          sessionId
        })
        return current
      }
      logPanelStateDebug('commit', {
        current: {
          bottom: summarizeAreaForDebug(current.bottom),
          right: summarizeAreaForDebug(current.right)
        },
        next: {
          bottom: summarizeAreaForDebug(nextState.bottom),
          right: summarizeAreaForDebug(nextState.right)
        },
        sessionId
      })
      persistPanelState(current, nextState)
      return nextState
    })
  }, [persistPanelState])

  const updateArea = useCallback((
    area: SessionPanelArea,
    updater: (current: SessionPanelAreaState) => SessionPanelAreaState
  ) => {
    commitPanelState(current => ({
      ...current,
      [area]: ensureActiveTab(normalizeArea(updater(current[area] ?? emptyArea())))
    }))
  }, [commitPanelState])

  return {
    panelState,
    setPanelState: commitPanelState,
    updateArea
  }
}
