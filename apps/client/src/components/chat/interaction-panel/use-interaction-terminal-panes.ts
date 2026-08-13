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

export interface InteractionTerminalCloseTarget {
  generation: number
  terminalId: string
}

interface TerminalCapabilityRegistration<Handler> {
  generation: number
  handler: Handler
}

export interface InteractionTerminalCloseResult {
  closedTerminalIds: string[]
  failedTerminalIds: string[]
  ignoredTerminalIds: string[]
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

const getTerminalRuntimeFingerprint = (pane: TerminalPaneConfig) =>
  JSON.stringify({
    runCommand: pane.runCommand == null
      ? null
      : { commandId: pane.runCommand.commandId, script: pane.runCommand.script },
    shellKind: pane.shellKind
  })

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
  const infoByIdRef = useRef(infoById)
  const [generation, setGeneration] = useState(1)
  const [, setTerminalRevision] = useState(0)
  const generationRef = useRef(generation)
  const nextTerminalGenerationRef = useRef(0)
  const terminalGenerationByIdRef = useRef(new Map<string, number>())
  const terminalRuntimeFingerprintByIdRef = useRef(new Map<string, string>())
  const seenTerminalIdsRef = useRef(new Set<string>())
  const terminalGenerationsInitializedRef = useRef(false)
  if (!terminalGenerationsInitializedRef.current) {
    terminalGenerationsInitializedRef.current = true
    for (const pane of panes) {
      nextTerminalGenerationRef.current += 1
      terminalGenerationByIdRef.current.set(pane.id, nextTerminalGenerationRef.current)
      terminalRuntimeFingerprintByIdRef.current.set(pane.id, getTerminalRuntimeFingerprint(pane))
      seenTerminalIdsRef.current.add(pane.id)
    }
  }
  const initialPanesKeyRef = useRef(initialPanesKey)
  const sessionIdRef = useRef(sessionId)
  const tRef = useRef(t)
  const pendingRestartByIdRef = useRef(
    new Map<string, {
      initialCommand?: string
      options?: RestartTerminalOptions
    }>()
  )
  const pendingProcessReadyByIdRef = useRef(
    new Map<string, { generation: number; sourceGeneration: number }>()
  )
  const processPidByIdRef = useRef(new Map<string, number>())
  const restartHandlersRef = useRef(
    new Map<string, TerminalCapabilityRegistration<RestartTerminalHandler>>()
  )
  const terminateHandlersRef = useRef(
    new Map<string, TerminalCapabilityRegistration<() => boolean>>()
  )

  useEffect(() => {
    panesRef.current = panes
  }, [panes])

  useEffect(() => {
    infoByIdRef.current = infoById
  }, [infoById])

  useEffect(() => {
    tRef.current = t
  }, [t])

  useEffect(() => {
    const sessionChanged = sessionIdRef.current !== sessionId
    if (!sessionChanged && initialPanesKeyRef.current === initialPanesKey) {
      return
    }

    sessionIdRef.current = sessionId
    initialPanesKeyRef.current = initialPanesKey
    const nextPanes = normalizeInitialPanes(options.initialPanes, tRef.current)
    const prunedTerminalIds = new Set<string>()
    let ownerReplaced = sessionChanged

    if (sessionChanged) {
      terminalGenerationByIdRef.current.clear()
      terminalRuntimeFingerprintByIdRef.current.clear()
      seenTerminalIdsRef.current.clear()
      for (const pane of nextPanes) {
        nextTerminalGenerationRef.current += 1
        terminalGenerationByIdRef.current.set(pane.id, nextTerminalGenerationRef.current)
        terminalRuntimeFingerprintByIdRef.current.set(pane.id, getTerminalRuntimeFingerprint(pane))
        seenTerminalIdsRef.current.add(pane.id)
      }
      for (const pane of panesRef.current) prunedTerminalIds.add(pane.id)
    } else {
      const nextTerminalIds = new Set(nextPanes.map(pane => pane.id))
      for (const pane of panesRef.current) {
        if (nextTerminalIds.has(pane.id)) continue
        prunedTerminalIds.add(pane.id)
        terminalGenerationByIdRef.current.delete(pane.id)
        terminalRuntimeFingerprintByIdRef.current.delete(pane.id)
      }
      for (const pane of nextPanes) {
        const fingerprint = getTerminalRuntimeFingerprint(pane)
        const previousFingerprint = terminalRuntimeFingerprintByIdRef.current.get(pane.id)
        if (previousFingerprint === fingerprint) continue

        if (previousFingerprint != null || seenTerminalIdsRef.current.has(pane.id)) {
          ownerReplaced = true
          prunedTerminalIds.add(pane.id)
        }
        nextTerminalGenerationRef.current += 1
        terminalGenerationByIdRef.current.set(pane.id, nextTerminalGenerationRef.current)
        terminalRuntimeFingerprintByIdRef.current.set(pane.id, fingerprint)
        seenTerminalIdsRef.current.add(pane.id)
      }
    }

    for (const terminalId of prunedTerminalIds) {
      pendingRestartByIdRef.current.delete(terminalId)
      pendingProcessReadyByIdRef.current.delete(terminalId)
      processPidByIdRef.current.delete(terminalId)
      restartHandlersRef.current.delete(terminalId)
      terminateHandlersRef.current.delete(terminalId)
    }
    if (prunedTerminalIds.size > 0) {
      setInfoById(current => {
        const next = { ...current }
        for (const terminalId of prunedTerminalIds) delete next[terminalId]
        infoByIdRef.current = next
        return next
      })
      setRunTaskRunningById(current => {
        const next = { ...current }
        for (const terminalId of prunedTerminalIds) delete next[terminalId]
        return next
      })
    }
    if (ownerReplaced) {
      generationRef.current += 1
      setGeneration(generationRef.current)
    }
    panesRef.current = nextPanes
    setPanes(nextPanes)
    setActiveTerminalId(current =>
      resolveActiveTerminalId(
        nextPanes,
        options.activeTerminalId ?? (sessionChanged ? null : current)
      )
    )
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
      pendingProcessReadyByIdRef.current.delete(terminalId)
      processPidByIdRef.current.delete(terminalId)
      restartHandlersRef.current.delete(terminalId)
      terminateHandlersRef.current.delete(terminalId)
      terminalGenerationByIdRef.current.delete(terminalId)
      terminalRuntimeFingerprintByIdRef.current.delete(terminalId)
      setInfoById((infoCurrent) => {
        const nextInfo = { ...infoCurrent }
        delete nextInfo[terminalId]
        infoByIdRef.current = nextInfo
        return nextInfo
      })
      setRunTaskRunningById((runningCurrent) => {
        const nextRunning = { ...runningCurrent }
        delete nextRunning[terminalId]
        return nextRunning
      })
      setActiveTerminalId(currentActiveId => currentActiveId === terminalId ? fallbackId : currentActiveId)
      panesRef.current = nextPanes
      return nextPanes
    })
  }, [])

  const flushPendingRestart = useCallback((terminalId: string) => {
    if (!pendingRestartByIdRef.current.has(terminalId)) {
      return
    }

    const generation = terminalGenerationByIdRef.current.get(terminalId)
    const registration = restartHandlersRef.current.get(terminalId)
    if (generation == null || registration?.generation !== generation) {
      return
    }

    const pendingRestart = pendingRestartByIdRef.current.get(terminalId)
    const accepted = registration.handler(pendingRestart?.initialCommand, pendingRestart?.options)
    if (accepted) {
      pendingRestartByIdRef.current.delete(terminalId)
    }
  }, [])

  const isCurrentTerminalTarget = useCallback((target: InteractionTerminalCloseTarget) => (
    terminalGenerationByIdRef.current.get(target.terminalId) === target.generation &&
    panesRef.current.some(pane => pane.id === target.terminalId)
  ), [])

  const handleInfoChange = useCallback((target: InteractionTerminalCloseTarget, info: TerminalPaneInfo) => {
    if (!isCurrentTerminalTarget(target)) return
    const { terminalId } = target
    infoByIdRef.current = { ...infoByIdRef.current, [terminalId]: info }
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
  }, [flushPendingRestart, isCurrentTerminalTarget, removeExitedTerminal])

  const handleRestartChange = useCallback((
    target: InteractionTerminalCloseTarget,
    handler: RestartTerminalHandler
  ) => {
    if (!isCurrentTerminalTarget(target)) return () => undefined
    restartHandlersRef.current.set(target.terminalId, { generation: target.generation, handler })
    flushPendingRestart(target.terminalId)
    return () => {
      const current = restartHandlersRef.current.get(target.terminalId)
      if (current?.generation === target.generation && current.handler === handler) {
        restartHandlersRef.current.delete(target.terminalId)
      }
    }
  }, [flushPendingRestart, isCurrentTerminalTarget])

  const handleTerminateChange = useCallback((
    target: InteractionTerminalCloseTarget,
    handler: () => boolean
  ) => {
    if (!isCurrentTerminalTarget(target)) return () => undefined
    terminateHandlersRef.current.set(target.terminalId, { generation: target.generation, handler })
    return () => {
      const current = terminateHandlersRef.current.get(target.terminalId)
      if (current?.generation === target.generation && current.handler === handler) {
        terminateHandlersRef.current.delete(target.terminalId)
      }
    }
  }, [isCurrentTerminalTarget])

  const advanceTerminalProcessGeneration = useCallback((target: InteractionTerminalCloseTarget) => {
    if (!isCurrentTerminalTarget(target)) return
    nextTerminalGenerationRef.current += 1
    const nextGeneration = nextTerminalGenerationRef.current
    terminalGenerationByIdRef.current.set(target.terminalId, nextGeneration)
    pendingProcessReadyByIdRef.current.set(target.terminalId, {
      generation: nextGeneration,
      sourceGeneration: target.generation
    })
    const restartRegistration = restartHandlersRef.current.get(target.terminalId)
    if (restartRegistration?.generation === target.generation) {
      restartHandlersRef.current.set(target.terminalId, { ...restartRegistration, generation: nextGeneration })
    }
    const terminateRegistration = terminateHandlersRef.current.get(target.terminalId)
    if (terminateRegistration?.generation === target.generation) {
      terminateHandlersRef.current.set(target.terminalId, { ...terminateRegistration, generation: nextGeneration })
    }
    const currentInfo = infoByIdRef.current[target.terminalId]
    if (currentInfo?.isExited === true) {
      const nextInfo = { ...infoByIdRef.current, [target.terminalId]: { ...currentInfo, isExited: false } }
      infoByIdRef.current = nextInfo
      setInfoById(nextInfo)
    }
    setTerminalRevision(current => current + 1)
  }, [isCurrentTerminalTarget])

  const handleProcessReady = useCallback((target: InteractionTerminalCloseTarget, pid?: number) => {
    const currentGeneration = terminalGenerationByIdRef.current.get(target.terminalId)
    const pendingReady = pendingProcessReadyByIdRef.current.get(target.terminalId)
    if (
      currentGeneration == null ||
      (target.generation !== currentGeneration && (
        pendingReady?.generation !== currentGeneration || pendingReady.sourceGeneration !== target.generation
      ))
    ) {
      return
    }
    const previousPid = processPidByIdRef.current.get(target.terminalId)
    if (pid != null) processPidByIdRef.current.set(target.terminalId, pid)
    if (pendingReady?.generation === currentGeneration) {
      pendingProcessReadyByIdRef.current.delete(target.terminalId)
      return
    }
    if (pid == null || previousPid == null || pid === previousPid || target.generation !== currentGeneration) return
    advanceTerminalProcessGeneration(target)
    pendingProcessReadyByIdRef.current.delete(target.terminalId)
  }, [advanceTerminalProcessGeneration])

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
    nextTerminalGenerationRef.current += 1
    terminalGenerationByIdRef.current.set(pane.id, nextTerminalGenerationRef.current)
    terminalRuntimeFingerprintByIdRef.current.set(pane.id, getTerminalRuntimeFingerprint(pane))
    seenTerminalIdsRef.current.add(pane.id)
    setPanes(current => {
      const explicitPanes = withExplicitTerminalPaneIds(current)
      const nextPanes = withFixedTerminalTitles([...explicitPanes, pane], t)
      panesRef.current = nextPanes
      return nextPanes
    })
    setActiveTerminalId(pane.id)
    return pane
  }, [t])

  const markInitialCommandSent = useCallback((target: InteractionTerminalCloseTarget) => {
    if (!isCurrentTerminalTarget(target)) return
    const { terminalId } = target
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
  }, [isCurrentTerminalTarget])

  const handleExit = useCallback((target: InteractionTerminalCloseTarget) => {
    if (!isCurrentTerminalTarget(target)) return
    removeExitedTerminal(target.terminalId)
  }, [isCurrentTerminalTarget, removeExitedTerminal])

  const getTerminalGeneration = useCallback(
    (terminalId: string) => terminalGenerationByIdRef.current.get(terminalId),
    []
  )

  const requiresCloseConfirmation = useCallback((target: InteractionTerminalCloseTarget) => (
    terminalGenerationByIdRef.current.get(target.terminalId) === target.generation &&
    panesRef.current.some(pane => pane.id === target.terminalId) &&
    infoByIdRef.current[target.terminalId]?.isExited !== true
  ), [])

  const closeTerminalTargets = useCallback((
    targets: InteractionTerminalCloseTarget[]
  ): InteractionTerminalCloseResult => {
    const closedTerminalIds: string[] = []
    const failedTerminalIds: string[] = []
    const ignoredTerminalIds: string[] = []
    const seen = new Set<string>()

    for (const target of targets) {
      if (seen.has(target.terminalId)) continue
      seen.add(target.terminalId)
      if (
        terminalGenerationByIdRef.current.get(target.terminalId) !== target.generation ||
        !panesRef.current.some(pane => pane.id === target.terminalId)
      ) {
        ignoredTerminalIds.push(target.terminalId)
        continue
      }

      const terminate = terminateHandlersRef.current.get(target.terminalId)
      if (infoByIdRef.current[target.terminalId]?.isExited === true) {
        closedTerminalIds.push(target.terminalId)
        continue
      }
      if (terminate?.generation !== target.generation) {
        failedTerminalIds.push(target.terminalId)
        continue
      }

      try {
        if (terminate.handler()) {
          closedTerminalIds.push(target.terminalId)
        } else {
          failedTerminalIds.push(target.terminalId)
        }
      } catch {
        failedTerminalIds.push(target.terminalId)
      }
    }

    const terminalIdSet = new Set(closedTerminalIds)
    if (terminalIdSet.size <= 0) {
      return { closedTerminalIds, failedTerminalIds, ignoredTerminalIds }
    }

    const currentPanes = panesRef.current
    const firstRemovedIndex = currentPanes.findIndex(pane => terminalIdSet.has(pane.id))
    const nextPanes = currentPanes.filter(pane => !terminalIdSet.has(pane.id))
    const fallbackId = nextPanes[Math.min(Math.max(firstRemovedIndex, 0), nextPanes.length - 1)]?.id ?? null
    for (const terminalId of terminalIdSet) {
      pendingRestartByIdRef.current.delete(terminalId)
      pendingProcessReadyByIdRef.current.delete(terminalId)
      processPidByIdRef.current.delete(terminalId)
      restartHandlersRef.current.delete(terminalId)
      terminateHandlersRef.current.delete(terminalId)
      terminalGenerationByIdRef.current.delete(terminalId)
      terminalRuntimeFingerprintByIdRef.current.delete(terminalId)
    }
    setInfoById(current => {
      const next = { ...current }
      for (const terminalId of terminalIdSet) {
        delete next[terminalId]
      }
      infoByIdRef.current = next
      return next
    })
    setRunTaskRunningById(current => {
      const next = { ...current }
      for (const terminalId of terminalIdSet) {
        delete next[terminalId]
      }
      return next
    })
    panesRef.current = nextPanes
    setPanes(nextPanes)
    setActiveTerminalId(current => terminalIdSet.has(current) ? fallbackId ?? DEFAULT_TERMINAL_ID : current)
    return { closedTerminalIds, failedTerminalIds, ignoredTerminalIds }
  }, [])

  const closeTerminals = useCallback((terminalIds: string[]): string | null => {
    const targets = terminalIds.flatMap((terminalId): InteractionTerminalCloseTarget[] => {
      const targetGeneration = terminalGenerationByIdRef.current.get(terminalId)
      return targetGeneration == null ? [] : [{ generation: targetGeneration, terminalId }]
    })
    const result = closeTerminalTargets(targets)
    const remainingPanes = panesRef.current
    if (result.closedTerminalIds.length === 0) return activeTerminalId
    return remainingPanes.find(pane => pane.id === activeTerminalId)?.id ?? remainingPanes[0]?.id ?? null
  }, [activeTerminalId, closeTerminalTargets])

  const closeTerminal = useCallback((terminalId: string): string | null => {
    return closeTerminals([terminalId])
  }, [closeTerminals])

  const restartTerminal = useCallback((
    terminalId: string,
    initialCommand?: string,
    options?: RestartTerminalOptions
  ) => {
    const generation = terminalGenerationByIdRef.current.get(terminalId)
    const registration = restartHandlersRef.current.get(terminalId)
    if (generation != null && registration?.generation === generation) {
      const accepted = registration.handler(initialCommand, options)
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
    const generation = terminalGenerationByIdRef.current.get(terminalId)
    const registration = terminateHandlersRef.current.get(terminalId)
    const terminated = generation != null && registration?.generation === generation
      ? registration.handler()
      : false
    if (terminated) {
      setRunTaskRunningById(current => ({ ...current, [terminalId]: false }))
    }
    return terminated
  }, [])

  return {
    activeTerminalId,
    addTerminal,
    closeTerminal,
    closeTerminalTargets,
    closeTerminals,
    generation,
    getTerminalGeneration,
    handleExit,
    handleInfoChange,
    handleProcessReady,
    handleProcessRestartAccepted: advanceTerminalProcessGeneration,
    handleRestartChange,
    handleTerminateChange,
    infoById,
    markInitialCommandSent,
    panes,
    restartTerminal,
    requiresCloseConfirmation,
    runTaskRunningById,
    setActiveTerminalId,
    terminateTerminal
  }
}

export type InteractionTerminalPanesController = ReturnType<typeof useInteractionTerminalPanes>
