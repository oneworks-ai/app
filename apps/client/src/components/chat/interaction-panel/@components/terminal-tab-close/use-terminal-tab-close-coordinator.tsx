import type { TFunction } from 'i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { InteractionPanelTab } from '../../interaction-panel-tabs'
import type { InteractionTerminalPanesController } from '../../use-interaction-terminal-panes'
import { TerminalTabCloseFeedback, useTerminalCloseModalTransition } from './TerminalTabCloseFeedback'
import { capturePanelTabCloseFocus, usePanelTabCloseFocusScheduler } from './panel-tab-close-focus'
import type { PanelTabCloseFocusIntent } from './panel-tab-close-focus'
import type {
  PanelTabCloseExecutionResult,
  PanelTabClosePreflight,
  PanelTabClosePreflightHandle
} from './terminal-tab-close-types'
import type { FrozenPanelTabCloseRequest } from './use-panel-tab-close-requests'
import { useTerminalCloseFailureFeedback } from './use-terminal-close-failure-feedback'
import type { TerminalCloseMessageApi } from './use-terminal-close-failure-feedback'
interface ActiveCloseRequest {
  focusIntent: PanelTabCloseFocusIntent
  request: FrozenPanelTabCloseRequest
}
export function useTerminalTabCloseCoordinator({
  executeCloseRequest,
  externalFallbackLabel,
  getOwnerRoot,
  isCloseRequestInvalidated,
  message,
  ownerGeneration,
  ownerId,
  resolveCloseRequest,
  t,
  terminalPanes
}: {
  executeCloseRequest: (request: FrozenPanelTabCloseRequest) => PanelTabCloseExecutionResult
  externalFallbackLabel?: string
  getOwnerRoot: () => HTMLElement | null
  isCloseRequestInvalidated: (request: FrozenPanelTabCloseRequest) => boolean
  message: TerminalCloseMessageApi
  ownerGeneration: number
  ownerId: string
  resolveCloseRequest: (request: FrozenPanelTabCloseRequest) => InteractionPanelTab[]
  t: TFunction
  terminalPanes: InteractionTerminalPanesController
}) {
  const [confirming, setConfirming] = useState(false)
  const activeRequestRef = useRef<ActiveCloseRequest | null>(null)
  const preflightRef = useRef<PanelTabClosePreflightHandle | null>(null)
  const executingRef = useRef(false)
  const ownerKey = `${ownerId}:${ownerGeneration}`
  const previousOwnerKeyRef = useRef(ownerKey)
  const scheduleFocus = usePanelTabCloseFocusScheduler({ getRoot: getOwnerRoot, ownerGeneration, ownerId })
  const { announcement, announceFailure } = useTerminalCloseFailureFeedback({
    message,
    ownerGeneration,
    ownerId,
    t
  })
  const {
    hideModal,
    isClosing: isModalClosing,
    modalState,
    onAfterHidden: onModalAfterHidden,
    openModal
  } = useTerminalCloseModalTransition(scheduleFocus)
  const clearPreflight = useCallback(() => {
    const preflight = preflightRef.current
    preflightRef.current = null
    preflight?.close()
  }, [])
  const finishExecution = useCallback((
    active: ActiveCloseRequest,
    result: PanelTabCloseExecutionResult,
    afterModal: boolean
  ) => {
    if (result.failedTabIds.length > 0) announceFailure(result.failedTabIds.length)
    const preferredTabId = result.failedTabIds[0] ?? result.activeTabId
    activeRequestRef.current = null
    clearPreflight()
    executingRef.current = false
    setConfirming(false)
    if (afterModal) {
      hideModal({ intent: active.focusIntent, preferredTabId })
      return
    }
    scheduleFocus({ intent: active.focusIntent, preferredTabId })
  }, [announceFailure, clearPreflight, hideModal, scheduleFocus])
  const execute = useCallback((active: ActiveCloseRequest, afterModal: boolean) => {
    if (executingRef.current || activeRequestRef.current?.request.requestId !== active.request.requestId) return
    executingRef.current = true
    setConfirming(afterModal)
    const result = executeCloseRequest(active.request)
    finishExecution(active, result, afterModal)
  }, [executeCloseRequest, finishExecution])
  const proceed = useCallback((active: ActiveCloseRequest) => {
    if (activeRequestRef.current?.request.requestId !== active.request.requestId) return
    clearPreflight()
    const targetById = new Map(active.request.targets.map(target => [target.tabId, target]))
    const activeTerminalCount = resolveCloseRequest(active.request).filter((tab) => {
      if (tab.kind !== 'terminal') return false
      const target = targetById.get(tab.id)
      return target?.terminalId != null && target.terminalGeneration != null &&
        terminalPanes.requiresCloseConfirmation({
          generation: target.terminalGeneration,
          terminalId: target.terminalId
        })
    }).length
    if (activeTerminalCount === 0) {
      execute(active, false)
      return
    }
    openModal(activeTerminalCount)
  }, [clearPreflight, execute, openModal, resolveCloseRequest, terminalPanes])
  const cancel = useCallback((active: ActiveCloseRequest, afterModal: boolean) => {
    if (executingRef.current || activeRequestRef.current?.request.requestId !== active.request.requestId) return
    activeRequestRef.current = null
    clearPreflight()
    if (afterModal) {
      hideModal({ intent: active.focusIntent })
      return
    }
    scheduleFocus({ intent: active.focusIntent })
  }, [clearPreflight, hideModal, scheduleFocus])
  const requestClose = useCallback((
    request: FrozenPanelTabCloseRequest,
    preflight?: PanelTabClosePreflight
  ) => {
    if (
      request.targets.length === 0 ||
      activeRequestRef.current != null ||
      isModalClosing()
    ) return false
    const active = { focusIntent: capturePanelTabCloseFocus(getOwnerRoot(), externalFallbackLabel), request }
    activeRequestRef.current = active
    if (preflight == null) {
      proceed(active)
      return true
    }
    const handle = preflight({ cancel: () => cancel(active, false), proceed: () => proceed(active) })
    if (activeRequestRef.current?.request.requestId === request.requestId) {
      preflightRef.current = handle
    } else {
      handle.close()
    }
    return true
  }, [cancel, externalFallbackLabel, getOwnerRoot, isModalClosing, proceed])
  useEffect(() => {
    if (previousOwnerKeyRef.current === ownerKey) return
    previousOwnerKeyRef.current = ownerKey
    activeRequestRef.current = null
    executingRef.current = false
    clearPreflight()
    hideModal()
    setConfirming(false)
  }, [clearPreflight, hideModal, ownerKey])
  useEffect(() => {
    const active = activeRequestRef.current
    if (active == null || !isCloseRequestInvalidated(active.request)) return
    activeRequestRef.current = null
    executingRef.current = false
    const preflight = preflightRef.current
    if (preflight != null) {
      preflight.close(() => {
        if (preflightRef.current !== preflight) return
        preflightRef.current = null
        scheduleFocus({ intent: active.focusIntent })
      })
      return
    }
    if (modalState != null) {
      hideModal({ intent: active.focusIntent })
      return
    }
    scheduleFocus({ intent: active.focusIntent })
  }, [hideModal, isCloseRequestInvalidated, modalState, scheduleFocus])
  useEffect(() => clearPreflight, [clearPreflight])
  const terminalCount = modalState?.activeTerminalCount ?? 0
  const feedback = (
    <TerminalTabCloseFeedback
      key={modalState?.epoch ?? 'idle'}
      announcement={announcement}
      cancelText={t('common.cancel')}
      confirmContent={t('chat.interactionPanel.terminalCloseConfirmContent', { count: terminalCount })}
      confirmText={t('chat.interactionPanel.terminalCloseConfirmAction', { count: terminalCount })}
      confirmTitle={t('chat.interactionPanel.terminalCloseConfirmTitle', { count: terminalCount })}
      confirming={confirming}
      open={modalState?.open === true}
      transitionEpoch={modalState?.epoch ?? 0}
      onAfterHidden={onModalAfterHidden}
      onCancel={() => {
        const active = activeRequestRef.current
        if (active != null) cancel(active, true)
      }}
      onConfirm={() => {
        const active = activeRequestRef.current
        if (active != null) execute(active, true)
      }}
    />
  )
  return { feedback, requestClose }
}
