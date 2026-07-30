/* eslint-disable max-lines -- confirmation lifecycle and structurally awaitable transition compose one guard. */

import { ConfigProvider } from 'antd'
import type { App } from 'antd'
import { useCallback, useLayoutEffect, useRef } from 'react'
import type { ComponentType, KeyboardEvent, ReactNode } from 'react'

import { useCommittedScopeIdentity } from './committed-scope-identity'
import type { PermissionMode, PermissionModeOption } from './permission-mode'
import { isHighRiskPermissionMode } from './permission-mode'
import type {
  PermissionModeAcknowledgementScope,
  PermissionModeAcknowledgementStorage
} from './permission-mode-acknowledgement'
import {
  acknowledgeHighRiskPermissionMode,
  getPermissionModeAcknowledgementStorage,
  hasAcknowledgedHighRiskPermissionMode,
  revokeHighRiskPermissionModeAcknowledgement
} from './permission-mode-acknowledgement'
import type { ActivePermissionModeConfirmation } from './permission-mode-selection-settlement'
import { createPermissionModeSelectionSettlement } from './permission-mode-selection-settlement'
import type {
  PermissionModeTransitionStart,
  PermissionModeTransitionTerminalOutcome
} from './use-session-permission-mode-change'

export type PermissionModeSelectionResult =
  | 'selected'
  | 'confirmation-required'
  | 'transition-pending'
  | 'rejected'

export interface PermissionModeSelectionStart {
  accepted: boolean
  cancel?: () => Promise<PermissionModeTransitionTerminalOutcome>
  /** Commits a provisional accepted selection; idempotent and irreversible. */
  finalize?: () => Promise<PermissionModeTransitionTerminalOutcome>
  /** @deprecated Use finalize. Kept for existing request-handler consumers. */
  complete?: () => Promise<PermissionModeTransitionTerminalOutcome>
  completion: Promise<boolean>
  result: PermissionModeSelectionResult
}

export interface PermissionModeSelectionOptions {
  /** Keep a successful selection compensable until the outer transaction commits. */
  deferFinalize?: boolean
  isCurrent?: () => boolean
  onAfterConfirmationClose?: () => void
}

type ModalConfirm = ReturnType<typeof App.useApp>['modal']['confirm']

interface PermissionModeConfirmationFocusLifecycle {
  deactivate: () => void
  signal: AbortSignal
}

const createPermissionModeConfirmationFocusLifecycle = (): PermissionModeConfirmationFocusLifecycle => {
  const controller = new AbortController()
  return {
    deactivate: () => controller.abort(),
    signal: controller.signal
  }
}

function PermissionModeConfirmationFooter({
  CancelBtn,
  OkBtn
}: {
  CancelBtn: ComponentType
  OkBtn: ComponentType
}) {
  const actionsRef = useRef<HTMLDivElement>(null)

  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return

    const actions = actionsRef.current
    if (actions == null) return

    const actionsForLoop = getCompletePermissionConfirmationActions(actions)
    if (actionsForLoop == null) return
    const [first, last] = actionsForLoop

    const activeElement = document.activeElement
    if (activeElement !== first && activeElement !== last) return

    event.preventDefault()
    if (activeElement === first) last.focus()
    else first.focus()
  }

  return (
    <div
      ref={actionsRef}
      className='sender-permission-confirmation__actions'
      onKeyDownCapture={handleKeyDownCapture}
    >
      <ConfigProvider
        theme={{
          components: {
            Button: {
              defaultBg: 'var(--sender-permission-confirm-surface)',
              defaultColor: 'var(--sender-permission-confirm-text)'
            }
          }
        }}
      >
        <CancelBtn />
      </ConfigProvider>
      <OkBtn />
    </div>
  )
}

const isPotentialPermissionConfirmationControl = (element: HTMLElement) => {
  const tagName = element.tagName.toLowerCase()
  return (
    tagName === 'button' ||
    tagName === 'input' ||
    tagName === 'select' ||
    tagName === 'textarea' ||
    (tagName === 'a' && element.hasAttribute('href')) ||
    element.getAttribute('contenteditable') === 'true' ||
    element.hasAttribute('tabindex')
  )
}

const getCompletePermissionConfirmationActions = (container: HTMLElement) => {
  const controls: HTMLElement[] = []
  const collectControls = (parent: HTMLElement) => {
    for (const child of Array.from(parent.children)) {
      const element = child as HTMLElement
      if (isPotentialPermissionConfirmationControl(element)) controls.push(element)
      collectControls(element)
    }
  }
  collectControls(container)

  // This footer owns the loop only while its complete interactive shape is
  // precisely the two visible, enabled Ant actions. A future control (even
  // disabled or hidden) falls back to the dialog's normal focus management.
  if (
    controls.length !== 2 || controls.some(control => {
      const style = getComputedStyle(control)
      return (
        control.tagName !== 'BUTTON' ||
        control.hasAttribute('disabled') ||
        (control as HTMLButtonElement).disabled ||
        control.hasAttribute('hidden') ||
        control.getAttribute('aria-hidden') === 'true' ||
        style.display === 'none' ||
        style.visibility === 'hidden'
      )
    })
  ) return null

  return controls as [HTMLButtonElement, HTMLButtonElement]
}

const getPermissionModeConfirmationFocusEndpoints = (
  modal: HTMLElement,
  root: HTMLElement
) => {
  const children = Array.from(modal.children) as HTMLElement[]
  const start = children[0]
  const end = children.at(-1)
  const isEndpoint = (element: HTMLElement | undefined) =>
    element?.tagName === 'DIV' &&
    element.getAttribute('tabindex') === '0' &&
    (element.getAttribute('aria-hidden') == null || element.getAttribute('aria-hidden') === 'true')

  // rc-dialog places its two focus sentinels as the dialog's direct first and
  // last children. The render root lives inside the start sentinel. Structural
  // ownership avoids treating arbitrary roleless tabindex content as a trap.
  if (!isEndpoint(start) || !isEndpoint(end) || start === end || !start.contains(root)) return null
  return { end, start }
}

function PermissionModeConfirmationFocusBoundary({
  children,
  isCurrent,
  lifecycle
}: {
  children: ReactNode
  isCurrent: () => boolean
  lifecycle: PermissionModeConfirmationFocusLifecycle
}) {
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    const modal = root?.closest<HTMLElement>('.sender-permission-confirm-modal')
    if (root == null || modal == null) return
    const confirmationRoot = root
    const confirmationModal = modal

    let disposed = false
    let firstFrame: number | undefined
    let secondFrame: number | undefined
    let overlayFocusWindowActive = true
    let overlayFocusWindowTimeout: ReturnType<typeof globalThis.setTimeout> | undefined
    let initialFocusPhase = true
    let redirectingFocus = false
    let userMovedFocus = false
    const isOverlayFocusWindowCurrent = () =>
      overlayFocusWindowActive &&
      !disposed &&
      !lifecycle.signal.aborted &&
      isCurrent() &&
      !userMovedFocus
    const deactivateOverlayFocusWindow = () => {
      if (!overlayFocusWindowActive) return
      overlayFocusWindowActive = false
      if (overlayFocusWindowTimeout != null) globalThis.clearTimeout(overlayFocusWindowTimeout)
      if (firstFrame != null) window.cancelAnimationFrame(firstFrame)
      if (secondFrame != null) window.cancelAnimationFrame(secondFrame)
      confirmationModal.removeEventListener('focusin', redirectOverlaySentinelFocus, true)
    }
    const dispose = () => {
      if (disposed) return
      disposed = true
      deactivateOverlayFocusWindow()
      confirmationModal.removeEventListener('keydown', redirectPendingTrapFocus, true)
      lifecycle.signal.removeEventListener('abort', dispose)
    }

    const getActions = () => {
      const actions = confirmationRoot.querySelector<HTMLElement>('.sender-permission-confirmation__actions')
      return actions == null ? null : getCompletePermissionConfirmationActions(actions)
    }
    const focusCancelFromModalEndpoint = () => {
      if (!isOverlayFocusWindowCurrent()) return

      const activeElement = document.activeElement
      const endpoints = getPermissionModeConfirmationFocusEndpoints(confirmationModal, confirmationRoot)
      const actions = getActions()
      initialFocusPhase = false
      if ((activeElement !== endpoints?.start && activeElement !== endpoints?.end) || actions == null) return
      if (!isOverlayFocusWindowCurrent()) return
      redirectingFocus = true
      actions[0].focus()
      redirectingFocus = false
      deactivateOverlayFocusWindow()
    }

    // A compact Drawer can restore its trap focus after Ant's initial
    // autoFocusButton. Let both mounted overlays finish their focus cleanup,
    // then normalize only this confirm's scoped panel once.
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(focusCancelFromModalEndpoint)
    })
    const redirectPendingTrapFocus = (event: Event) => {
      const keyboardEvent = event as Event & { key?: string; shiftKey?: boolean }
      if (
        event.type !== 'keydown' ||
        keyboardEvent.key !== 'Tab' ||
        disposed ||
        lifecycle.signal.aborted ||
        !isCurrent()
      ) return
      const endpoints = getPermissionModeConfirmationFocusEndpoints(confirmationModal, confirmationRoot)
      if (event.target !== endpoints?.start && event.target !== endpoints?.end) return
      const actions = getActions()
      if (actions == null) return
      event.preventDefault()
      if (keyboardEvent.shiftKey === true) actions[1].focus()
      else actions[0].focus()
    }
    function redirectOverlaySentinelFocus(event: Event) {
      const endpoints = getPermissionModeConfirmationFocusEndpoints(confirmationModal, confirmationRoot)
      const actions = getActions()
      if (actions == null) return
      if (event.target === endpoints?.start || event.target === endpoints?.end) {
        if (!isOverlayFocusWindowCurrent()) return
        redirectingFocus = true
        actions[0].focus()
        redirectingFocus = false
        deactivateOverlayFocusWindow()
        return
      }
      if (
        !redirectingFocus &&
        confirmationModal.contains(event.target as Node) &&
        (!initialFocusPhase || event.target !== actions[0])
      ) {
        userMovedFocus = true
        deactivateOverlayFocusWindow()
      }
    }
    overlayFocusWindowTimeout = globalThis.setTimeout(deactivateOverlayFocusWindow, 160)
    confirmationModal.addEventListener('keydown', redirectPendingTrapFocus, true)
    confirmationModal.addEventListener('focusin', redirectOverlaySentinelFocus, true)
    lifecycle.signal.addEventListener('abort', dispose, { once: true })
    if (lifecycle.signal.aborted) dispose()

    return dispose
  }, [isCurrent, lifecycle])

  return <div ref={rootRef}>{children}</div>
}

export const usePermissionModeSelectionGuard = ({
  confirmModal,
  onSelect,
  permissionModeOptions,
  acknowledgementScope,
  scopeId,
  t
}: {
  confirmModal: ModalConfirm
  onSelect: (mode: PermissionMode) => PermissionModeTransitionStart
  permissionModeOptions: PermissionModeOption[]
  acknowledgementScope: PermissionModeAcknowledgementScope
  scopeId: string
  t: (key: string, options?: Record<string, string>) => string
}) => {
  const activeConfirmationRef = useRef<ActivePermissionModeConfirmation | null>(null)
  const confirmationSequenceRef = useRef(0)
  const mountedRef = useRef(true)
  const {
    getCommittedScopeIdentity,
    isCommittedScopeIdentityCurrent
  } = useCommittedScopeIdentity(scopeId)
  const invalidateActiveConfirmation = useCallback(() => {
    const activeConfirmation = activeConfirmationRef.current
    if (activeConfirmation == null) return Promise.resolve()

    // The active confirmation stays owned until the underlying transition has
    // finished cancelling. This keeps a new scope from starting an update that
    // could be overtaken by the old transition's remote compensation.
    return activeConfirmation.cancel?.() ?? Promise.resolve()
  }, [])

  useLayoutEffect(() => {
    const activeConfirmation = activeConfirmationRef.current
    if (
      activeConfirmation != null &&
      !isCommittedScopeIdentityCurrent(activeConfirmation.scopeToken)
    ) {
      void invalidateActiveConfirmation().catch(() => undefined)
    }
  }, [invalidateActiveConfirmation, isCommittedScopeIdentityCurrent, scopeId])

  useLayoutEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      void invalidateActiveConfirmation().catch(() => undefined)
    }
  }, [invalidateActiveConfirmation])

  return useCallback((
    mode: PermissionMode,
    options?: PermissionModeSelectionOptions
  ): PermissionModeSelectionStart => {
    const scopeToken = getCommittedScopeIdentity()
    const settlement = createPermissionModeSelectionSettlement()
    const start = (
      result: PermissionModeSelectionResult,
      accepted: boolean,
      cancel?: () => Promise<PermissionModeTransitionTerminalOutcome>,
      finalize?: () => Promise<PermissionModeTransitionTerminalOutcome>
    ): PermissionModeSelectionStart => ({
      accepted,
      cancel,
      complete: finalize,
      finalize,
      completion: settlement.completion,
      result
    })
    if (activeConfirmationRef.current != null) {
      settlement.settle(false)
      return start('transition-pending', false)
    }
    const selectForCurrentScope = () => {
      if (
        !mountedRef.current ||
        scopeToken.scopeId !== scopeId ||
        !isCommittedScopeIdentityCurrent(scopeToken) ||
        options?.isCurrent?.() === false
      ) {
        settlement.settle(false)
        return start('rejected', false)
      }

      const transition = onSelect(mode)
      if (!transition.accepted) {
        settlement.settle(false)
        return start('transition-pending', false)
      }
      const selectionId = ++confirmationSequenceRef.current
      const activeSelection: ActivePermissionModeConfirmation = {
        id: selectionId,
        scopeToken,
        settle: settlement.settle
      }
      activeConfirmationRef.current = activeSelection
      let cancellation: Promise<PermissionModeTransitionTerminalOutcome> | undefined
      let terminalPromise: Promise<PermissionModeTransitionTerminalOutcome> | undefined
      let cancelOutcome: PermissionModeTransitionTerminalOutcome = 'not-selected'
      let finalized = false
      const cancelTransition = (): Promise<PermissionModeTransitionTerminalOutcome> => {
        if (cancellation != null) return cancellation
        if (terminalPromise != null) return terminalPromise
        cancellation = (async () => {
          try {
            cancelOutcome = await transition.cancel?.() ?? 'not-selected'
            return cancelOutcome
          } finally {
            // Failed compensation leaves the selected mode authoritative.
            settlement.settle(cancelOutcome === 'compensation-failed-selected-remains')
            if (activeConfirmationRef.current?.id === selectionId) {
              activeConfirmationRef.current = null
            }
          }
        })()
        terminalPromise = cancellation
        return cancellation
      }
      activeSelection.cancel = cancelTransition
      const finalizeTransition = (): Promise<PermissionModeTransitionTerminalOutcome> => {
        if (terminalPromise != null) return terminalPromise
        finalized = true
        const complete = transition.complete
        const finalization = (complete == null
          ? Promise.resolve<PermissionModeTransitionTerminalOutcome>('not-selected')
          : complete()).then((outcome) => {
            if (activeConfirmationRef.current?.id === selectionId) {
              activeConfirmationRef.current = null
            }
            settlement.settle(true)
            return outcome
          })
        terminalPromise = finalization
        return finalization
      }
      void transition.completion.then(async (selected) => {
        if (
          selected &&
          mountedRef.current &&
          isCommittedScopeIdentityCurrent(scopeToken) &&
          options?.isCurrent?.() !== false
        ) {
          if (options?.deferFinalize === true) settlement.settle(true)
          else await finalizeTransition()
          return
        }
        void cancelTransition().catch(() => undefined)
      }, () => {
        void cancelTransition().catch(() => undefined)
      })
      return start('selected', true, cancelTransition, finalizeTransition)
    }

    const storage: PermissionModeAcknowledgementStorage | undefined = getPermissionModeAcknowledgementStorage()
    if (
      !isHighRiskPermissionMode(mode) ||
      hasAcknowledgedHighRiskPermissionMode(mode, acknowledgementScope, storage)
    ) {
      return selectForCurrentScope()
    }

    const option = permissionModeOptions.find(candidate => candidate.value === mode)
    const confirmationId = ++confirmationSequenceRef.current
    const focusLifecycle = createPermissionModeConfirmationFocusLifecycle()
    const activeConfirmation: ActivePermissionModeConfirmation = {
      id: confirmationId,
      scopeToken,
      settle: settlement.settle
    }
    let acknowledgementCommitted = false
    let cancellation: Promise<PermissionModeTransitionTerminalOutcome> | undefined
    let terminalPromise: Promise<PermissionModeTransitionTerminalOutcome> | undefined
    let finalized = false
    let provisional = false
    let transitionFinalize: (() => Promise<PermissionModeTransitionTerminalOutcome>) | undefined
    activeConfirmationRef.current = activeConfirmation
    const cancelConfirmation = (): Promise<PermissionModeTransitionTerminalOutcome> => {
      focusLifecycle.deactivate()
      if (cancellation != null) return cancellation
      if (terminalPromise != null) return terminalPromise
      cancellation = (async () => {
        let cancelOutcome: PermissionModeTransitionTerminalOutcome = 'not-selected'
        try {
          cancelOutcome = await activeConfirmation.cancelTransition?.() ?? 'not-selected'
          return cancelOutcome
        } finally {
          // Only a successful remote compensation makes it safe to revoke an
          // acknowledgement created by this confirmation. A failed undo keeps
          // the selected high-risk mode and its acknowledgement aligned.
          if (cancelOutcome === 'compensated' && acknowledgementCommitted) {
            revokeHighRiskPermissionModeAcknowledgement(mode, acknowledgementScope, storage)
            acknowledgementCommitted = false
          }
          settlement.settle(cancelOutcome === 'compensation-failed-selected-remains')
          activeConfirmation.destroy?.()
          if (activeConfirmationRef.current?.id === confirmationId) {
            activeConfirmationRef.current = null
          }
        }
      })()
      terminalPromise = cancellation
      return cancellation
    }
    activeConfirmation.cancel = cancelConfirmation
    const finalizeConfirmation = (): Promise<PermissionModeTransitionTerminalOutcome> => {
      focusLifecycle.deactivate()
      if (terminalPromise != null) return terminalPromise
      finalized = true
      const finalization = (transitionFinalize == null
        ? Promise.resolve<PermissionModeTransitionTerminalOutcome>('not-selected')
        : transitionFinalize()).then((outcome) => {
          if (activeConfirmationRef.current?.id === confirmationId) {
            activeConfirmationRef.current = null
          }
          settlement.settle(true)
          return outcome
        })
      terminalPromise = finalization
      return finalization
    }
    const modalHandle = confirmModal({
      autoFocusButton: 'cancel',
      className: 'sender-permission-confirm-modal',
      title: t('chat.permissionModes.confirmation.title'),
      content: (
        <div className='sender-permission-confirmation'>
          <strong>{option?.label}</strong>
          <span>{option?.description}</span>
          <span className='sender-permission-confirmation__impact'>
            {t(`chat.permissionModes.confirmation.${mode}Impact`)}
          </span>
        </div>
      ),
      okText: t('chat.permissionModes.confirmation.confirm'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      footer: (_originNode, { CancelBtn, OkBtn }) => (
        <PermissionModeConfirmationFooter CancelBtn={CancelBtn} OkBtn={OkBtn} />
      ),
      modalRender: node => (
        <PermissionModeConfirmationFocusBoundary
          lifecycle={focusLifecycle}
          isCurrent={() =>
            activeConfirmationRef.current?.id === confirmationId &&
            mountedRef.current &&
            scopeToken.scopeId === scopeId &&
            isCommittedScopeIdentityCurrent(scopeToken) &&
            options?.isCurrent?.() !== false}
        >
          {node}
        </PermissionModeConfirmationFocusBoundary>
      ),
      onOk: async () => {
        focusLifecycle.deactivate()
        if (
          activeConfirmationRef.current?.id !== confirmationId ||
          !mountedRef.current ||
          scopeToken.scopeId !== scopeId ||
          !isCommittedScopeIdentityCurrent(scopeToken) ||
          options?.isCurrent?.() === false
        ) {
          settlement.settle(false)
          return
        }

        const transition = onSelect(mode)
        if (!transition.accepted) {
          settlement.settle(false)
          return
        }
        activeConfirmation.cancelTransition = transition.cancel
        transitionFinalize = transition.complete
        const selected = await transition.completion
        if (
          selected &&
          activeConfirmationRef.current?.id === confirmationId &&
          mountedRef.current &&
          isCommittedScopeIdentityCurrent(scopeToken) &&
          options?.isCurrent?.() !== false
        ) {
          acknowledgementCommitted = acknowledgeHighRiskPermissionMode(
            mode,
            acknowledgementScope,
            storage
          )
          if (acknowledgementCommitted) {
            provisional = options?.deferFinalize === true
            if (provisional) settlement.settle(true)
            else await finalizeConfirmation()
            return
          }
          await transition.cancel?.()
          settlement.settle(false)
          return
        }
        if (selected) await transition.cancel?.()
        settlement.settle(false)
      },
      onCancel: () => {
        focusLifecycle.deactivate()
        void cancelConfirmation().catch(() => undefined)
      },
      afterClose: () => {
        focusLifecycle.deactivate()
        const isLatestConfirmation = confirmationSequenceRef.current === confirmationId
        const hasNewerActiveConfirmation = activeConfirmationRef.current != null &&
          activeConfirmationRef.current.id !== confirmationId
        if (
          cancellation == null &&
          !provisional &&
          activeConfirmationRef.current?.id === confirmationId
        ) {
          activeConfirmationRef.current = null
        }
        if (cancellation == null && !settlement.hasSettled()) settlement.settle(false)
        if (
          isLatestConfirmation &&
          !hasNewerActiveConfirmation &&
          isCommittedScopeIdentityCurrent(scopeToken)
        ) {
          options?.onAfterConfirmationClose?.()
        }
      }
    })
    activeConfirmation.destroy = () => {
      focusLifecycle.deactivate()
      modalHandle?.destroy()
    }
    if (
      activeConfirmationRef.current?.id !== confirmationId ||
      !isCommittedScopeIdentityCurrent(scopeToken)
    ) {
      activeConfirmation.destroy()
    }
    return start('confirmation-required', true, cancelConfirmation, finalizeConfirmation)
  }, [
    confirmModal,
    acknowledgementScope,
    getCommittedScopeIdentity,
    isCommittedScopeIdentityCurrent,
    onSelect,
    permissionModeOptions,
    scopeId,
    t
  ])
}
