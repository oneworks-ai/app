/* eslint-disable max-lines -- terminal pane state and lifecycle handlers are easier to reason about together. */
import type { TFunction } from 'i18next'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { TerminalShellKind } from '@oneworks/types'

import type {
  RestartTerminalHandler,
  RestartTerminalOptions
} from '#~/components/chat/terminal/@hooks/use-terminal-session'
import {
  DEFAULT_TERMINAL_ID,
  TERMINAL_SHELL_KINDS,
  createTerminalPane,
  getNextTerminalTitle,
  normalizeTerminalPanes,
  withExplicitTerminalPaneIds,
  withFixedTerminalTitles
} from '#~/components/chat/terminal/@utils/terminal-panes'
import type { TerminalPaneConfig, TerminalPaneSurface } from '#~/components/chat/terminal/@utils/terminal-panes'
import type { TerminalPaneInfo } from '#~/components/chat/terminal/ChatTerminalView'

interface InteractionTerminalPanesOptions {
  activeTerminalId?: string | null
  initialPanes?: TerminalPaneConfig[]
}

const normalizeInitialPanes = (panes: TerminalPaneConfig[] | undefined, t: TFunction) =>
  withFixedTerminalTitles(normalizeTerminalPanes(panes ?? [], { fallback: false }), t)

const resolveActiveTerminalId = (panes: TerminalPaneConfig[], activeTerminalId?: string | null) => (
  activeTerminalId != null && panes.some(pane => pane.id === activeTerminalId)
    ? activeTerminalId
    : panes[0]?.id ?? DEFAULT_TERMINAL_ID
)

const normalizeTerminalShellKind = (value: unknown): TerminalShellKind =>
  typeof value === 'string' && TERMINAL_SHELL_KINDS.includes(value as TerminalShellKind)
    ? value as TerminalShellKind
    : 'default'

export function useInteractionTerminalPanes(
  sessionId: string,
  t: TFunction,
  options: InteractionTerminalPanesOptions = {}
) {
  const initialPanesKey = JSON.stringify(options.initialPanes ?? [])
  const [panes, setPanes] = useState<TerminalPaneConfig[]>(() => normalizeInitialPanes(options.initialPanes, t))
  const [activeTerminalId, setActiveTerminalId] = useState(() =>
    resolveActiveTerminalId(panes, options.activeTerminalId)
  )
  const [infoById, setInfoById] = useState<Record<string, TerminalPaneInfo>>({})
  const [runTaskRunningById, setRunTaskRunningById] = useState<Record<string, boolean>>({})
  const panesRef = useRef(panes)
  const initialPanesKeyRef = useRef(initialPanesKey)
  const sessionIdRef = useRef(sessionId)
  const tRef = useRef(t)
  const pendingRestartByIdRef = useRef(
    new Map<string, {
      initialCommand?: string
      options?: RestartTerminalOptions
    }>()
  )
  const restartHandlersRef = useRef(new Map<string, RestartTerminalHandler>())
  const terminateHandlersRef = useRef(new Map<string, () => boolean>())

  useEffect(() => {
    panesRef.current = panes
  }, [panes])

  useEffect(() => {
    tRef.current = t
  }, [t])

  useEffect(() => {
    if (sessionIdRef.current === sessionId && initialPanesKeyRef.current === initialPanesKey) {
      return
    }

    sessionIdRef.current = sessionId
    initialPanesKeyRef.current = initialPanesKey
    const nextPanes = normalizeInitialPanes(options.initialPanes, tRef.current)
    setPanes(nextPanes)
    setActiveTerminalId(resolveActiveTerminalId(nextPanes, options.activeTerminalId))
    setInfoById({})
    setRunTaskRunningById({})
    pendingRestartByIdRef.current.clear()
    restartHandlersRef.current.clear()
    terminateHandlersRef.current.clear()
  }, [initialPanesKey, options.activeTerminalId, options.initialPanes, sessionId])

  useEffect(() => {
    setActiveTerminalId(current => {
      if (current === options.activeTerminalId || options.activeTerminalId == null) {
        return current
      }
      return panes.some(pane => pane.id === options.activeTerminalId) ? options.activeTerminalId : current
    })
  }, [options.activeTerminalId, panes])

  const removeExitedTerminal = useCallback((terminalId: string) => {
    setPanes((current) => {
      const removedIndex = current.findIndex(pane => pane.id === terminalId)
      if (removedIndex < 0) {
        return current
      }

      const nextPanes = current.filter(pane => pane.id !== terminalId)
      const fallbackId = nextPanes[Math.min(removedIndex, nextPanes.length - 1)]?.id ?? DEFAULT_TERMINAL_ID
      pendingRestartByIdRef.current.delete(terminalId)
      restartHandlersRef.current.delete(terminalId)
      terminateHandlersRef.current.delete(terminalId)
      setInfoById((infoCurrent) => {
        const nextInfo = { ...infoCurrent }
        delete nextInfo[terminalId]
        return nextInfo
      })
      setRunTaskRunningById((runningCurrent) => {
        const nextRunning = { ...runningCurrent }
        delete nextRunning[terminalId]
        return nextRunning
      })
      setActiveTerminalId(currentActiveId => currentActiveId === terminalId ? fallbackId : currentActiveId)
      return nextPanes
    })
  }, [])

  const flushPendingRestart = useCallback((terminalId: string) => {
    if (!pendingRestartByIdRef.current.has(terminalId)) {
      return
    }

    const handler = restartHandlersRef.current.get(terminalId)
    if (handler == null) {
      return
    }

    const pendingRestart = pendingRestartByIdRef.current.get(terminalId)
    const accepted = handler(pendingRestart?.initialCommand, pendingRestart?.options)
    if (accepted) {
      pendingRestartByIdRef.current.delete(terminalId)
    }
  }, [])

  const handleInfoChange = useCallback((terminalId: string, info: TerminalPaneInfo) => {
    setInfoById(current => ({ ...current, [terminalId]: info }))
    if (info.isExited) {
      setRunTaskRunningById((current) => {
        if (current[terminalId] !== true) {
          return current
        }
        return { ...current, [terminalId]: false }
      })
    }
    const pane = panesRef.current.find(item => item.id === terminalId)
    if (info.isExited && pane?.runCommand == null) {
      removeExitedTerminal(terminalId)
      return
    }

    flushPendingRestart(terminalId)
  }, [flushPendingRestart, removeExitedTerminal])

  const handleRestartChange = useCallback((
    terminalId: string,
    handler: RestartTerminalHandler | null
  ) => {
    if (handler == null) {
      restartHandlersRef.current.delete(terminalId)
      return
    }

    restartHandlersRef.current.set(terminalId, handler)
    flushPendingRestart(terminalId)
  }, [flushPendingRestart])

  const handleTerminateChange = useCallback((terminalId: string, handler: (() => boolean) | null) => {
    if (handler == null) {
      terminateHandlersRef.current.delete(terminalId)
      return
    }

    terminateHandlersRef.current.set(terminalId, handler)
  }, [])

  const addTerminal = useCallback((
    shellKind: TerminalShellKind = 'default',
    options: {
      initialCommand?: string
      runCommand?: TerminalPaneConfig['runCommand']
      surface?: TerminalPaneSurface
      title?: string
    } = {}
  ) => {
    const explicitPanes = withExplicitTerminalPaneIds(panesRef.current)
    const title = options.title?.trim()
    const pane = createTerminalPane(
      normalizeTerminalShellKind(shellKind),
      title == null || title === '' ? getNextTerminalTitle(explicitPanes, t) : title,
      options.initialCommand,
      options.runCommand,
      options.surface
    )
    setPanes(current => {
      const explicitPanes = withExplicitTerminalPaneIds(current)
      const nextPanes = withFixedTerminalTitles([...explicitPanes, pane], t)
      return nextPanes
    })
    setActiveTerminalId(pane.id)
    return pane
  }, [t])

  const markInitialCommandSent = useCallback((terminalId: string) => {
    const pane = panesRef.current.find(item => item.id === terminalId)
    if (pane?.runCommand != null) {
      setRunTaskRunningById(current => ({ ...current, [terminalId]: true }))
    }
    setPanes(current =>
      current.map((pane) => {
        if (pane.id !== terminalId || pane.initialCommand == null) {
          return pane
        }
        const { initialCommand: _initialCommand, ...nextPane } = pane
        return nextPane
      })
    )
  }, [])

  const closeTerminals = useCallback((terminalIds: string[]): string | null => {
    const terminalIdSet = new Set(terminalIds)
    if (terminalIdSet.size <= 0) {
      return activeTerminalId
    }

    const firstRemovedIndex = panes.findIndex(pane => terminalIdSet.has(pane.id))
    const nextPanes = panes.filter(pane => !terminalIdSet.has(pane.id))
    const fallbackId = nextPanes[Math.min(Math.max(firstRemovedIndex, 0), nextPanes.length - 1)]?.id ?? null
    for (const terminalId of terminalIdSet) {
      void terminateHandlersRef.current.get(terminalId)?.()
      pendingRestartByIdRef.current.delete(terminalId)
      restartHandlersRef.current.delete(terminalId)
      terminateHandlersRef.current.delete(terminalId)
    }
    setInfoById(current => {
      const next = { ...current }
      for (const terminalId of terminalIdSet) {
        delete next[terminalId]
      }
      return next
    })
    setRunTaskRunningById(current => {
      const next = { ...current }
      for (const terminalId of terminalIdSet) {
        delete next[terminalId]
      }
      return next
    })
    setPanes(nextPanes)
    setActiveTerminalId(current => terminalIdSet.has(current) ? fallbackId ?? DEFAULT_TERMINAL_ID : current)
    return fallbackId
  }, [activeTerminalId, panes])

  const closeTerminal = useCallback((terminalId: string): string | null => {
    return closeTerminals([terminalId])
  }, [closeTerminals])

  const restartTerminal = useCallback((
    terminalId: string,
    initialCommand?: string,
    options?: RestartTerminalOptions
  ) => {
    const handler = restartHandlersRef.current.get(terminalId)
    if (handler != null) {
      const accepted = handler(initialCommand, options)
      if (accepted) {
        return true
      }
    }

    pendingRestartByIdRef.current.set(terminalId, { initialCommand, options })
    for (const delay of [0, 100, 250, 500, 1000, 2000, 4000]) {
      window.setTimeout(() => flushPendingRestart(terminalId), delay)
    }
    return false
  }, [flushPendingRestart])

  const terminateTerminal = useCallback((terminalId: string) => {
    const terminated = terminateHandlersRef.current.get(terminalId)?.() ?? false
    if (terminated) {
      setRunTaskRunningById(current => ({ ...current, [terminalId]: false }))
    }
    return terminated
  }, [])

  return {
    activeTerminalId,
    addTerminal,
    closeTerminal,
    closeTerminals,
    handleInfoChange,
    handleRestartChange,
    handleTerminateChange,
    infoById,
    markInitialCommandSent,
    panes,
    restartTerminal,
    runTaskRunningById,
    setActiveTerminalId,
    terminateTerminal
  }
}

export type InteractionTerminalPanesController = ReturnType<typeof useInteractionTerminalPanes>
