/* eslint-disable max-lines -- one transition owns optimistic state, compensation, and CAS persistence undo. */

import { useCallback, useLayoutEffect, useRef } from 'react'

import { updateSession } from '#~/api.js'

import type { CommittedScopeIdentity } from './committed-scope-identity'
import { useCommittedScopeIdentity } from './committed-scope-identity'
import type { PermissionMode } from './permission-mode'

export interface PermissionModeTransitionStart {
  accepted: boolean
  cancel?: () => Promise<PermissionModeTransitionTerminalOutcome>
  complete?: () => Promise<PermissionModeTransitionTerminalOutcome>
  completion: Promise<boolean>
}

export type PermissionModeTransitionTerminalOutcome =
  | 'not-selected'
  | 'compensated'
  | 'compensation-failed-selected-remains'
  | 'finalized'

export interface PermissionModeTransitionSuccessCleanup {
  commit: () => void
  undo: () => void
}

interface PendingPermissionModeTransition {
  attemptId: number
  scopeIdentity: CommittedScopeIdentity
}

export function useSessionPermissionModeChange({
  onCompensationError,
  onInitialUpdateError,
  onPendingAttempt,
  onPendingChange,
  onSuccess,
  permissionMode,
  scopeId,
  sessionId,
  setPermissionMode
}: {
  onCompensationError: () => void
  onInitialUpdateError: () => void
  onPendingAttempt: () => void
  onPendingChange: (pending: boolean) => void
  onSuccess: (
    mode: PermissionMode,
    ownership: {
      attemptId: number
      isCurrentAttemptOwner: () => boolean
      scopeId: string
    }
  ) => void | PermissionModeTransitionSuccessCleanup
  permissionMode: PermissionMode
  scopeId: string
  sessionId: string | undefined
  setPermissionMode: (mode: PermissionMode) => void
}) {
  const attemptSequenceRef = useRef(0)
  const mountedRef = useRef(true)
  const {
    getCommittedScopeIdentity,
    isCommittedScopeIdentityCurrent
  } = useCommittedScopeIdentity(scopeId)
  const modeRef = useRef({
    mode: permissionMode,
    scopeIdentity: getCommittedScopeIdentity()
  })
  const pendingTransitionRef = useRef<PendingPermissionModeTransition | null>(null)
  const completedAttemptRef = useRef<PendingPermissionModeTransition | null>(null)

  useLayoutEffect(() => {
    const scopeIdentity = getCommittedScopeIdentity()
    modeRef.current = { mode: permissionMode, scopeIdentity }
    // Keep a completed attempt available for its one-shot remote compensation.
    // A scope change may arrive between a successful permission update and the
    // starter transaction that consumes it; cancelling that transaction must
    // still restore the *old* session before this hook permits another update.
  }, [getCommittedScopeIdentity, onPendingChange, permissionMode, scopeId])

  useLayoutEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // A request may resolve after this component has gone away. Keep its
      // owner long enough for the guard's existing completion callback to
      // consume the same cancellation promise and compensate that session.
    }
  }, [])

  return useCallback((mode: PermissionMode): PermissionModeTransitionStart => {
    const scopeIdentity = getCommittedScopeIdentity()
    if (scopeIdentity.scopeId !== scopeId) {
      onPendingAttempt()
      return {
        accepted: false,
        completion: Promise.resolve(false)
      }
    }

    const pendingTransition = pendingTransitionRef.current
    if (pendingTransition != null) {
      onPendingAttempt()
      return {
        accepted: false,
        completion: Promise.resolve(false)
      }
    }

    const attemptId = ++attemptSequenceRef.current
    const previousMode = modeRef.current.scopeIdentity === scopeIdentity
      ? modeRef.current.mode
      : permissionMode
    const attempt = { attemptId, scopeIdentity }
    completedAttemptRef.current = null
    pendingTransitionRef.current = attempt
    modeRef.current = { mode, scopeIdentity }
    setPermissionMode(mode)
    onPendingChange(true)

    const isCurrentAttempt = () => {
      return mountedRef.current &&
        isCommittedScopeIdentityCurrent(scopeIdentity) &&
        pendingTransitionRef.current?.attemptId === attemptId
    }
    let completedSuccessfully = false
    let successCleanup: PermissionModeTransitionSuccessCleanup | undefined
    let terminalState: 'provisional' | 'finalizing' | 'finalized' | 'cancelling' | 'canceled' | 'failed-cancel' =
      'provisional'
    let terminalPromise: Promise<PermissionModeTransitionTerminalOutcome> | undefined
    let retainCompletedStaleSuccess = false
    const rollbackOptimisticMode = () => {
      if (
        !mountedRef.current ||
        !isCommittedScopeIdentityCurrent(scopeIdentity) ||
        modeRef.current.scopeIdentity !== scopeIdentity ||
        modeRef.current.mode !== mode
      ) return
      modeRef.current = { mode: previousMode, scopeIdentity }
      setPermissionMode(previousMode)
    }
    const compensateRuntime = async () => {
      if (sessionId != null && sessionId !== '') {
        try {
          const compensated = await updateSession(sessionId, { permissionMode: previousMode })
          if (compensated === false) {
            if (mountedRef.current && isCommittedScopeIdentityCurrent(scopeIdentity)) {
              onCompensationError()
            }
            return false
          }
        } catch (error) {
          if (
            mountedRef.current &&
            isCommittedScopeIdentityCurrent(scopeIdentity) &&
            modeRef.current.scopeIdentity === scopeIdentity &&
            modeRef.current.mode === mode
          ) {
            onCompensationError()
          }
          return false
        }
      }
      rollbackOptimisticMode()
      return true
    }
    let completion: Promise<boolean>
    const isCurrentAttemptOwner = () => {
      return mountedRef.current &&
        isCommittedScopeIdentityCurrent(scopeIdentity) &&
        completedAttemptRef.current?.attemptId === attemptId
    }
    const ownsCompletedAttempt = () => completedAttemptRef.current?.attemptId === attemptId
    const releaseCompensationOwnership = () => {
      if (pendingTransitionRef.current?.attemptId === attemptId) {
        pendingTransitionRef.current = null
      }
      if (mountedRef.current) onPendingChange(false)
      if (ownsCompletedAttempt()) completedAttemptRef.current = null
    }
    const retainCompensationOwnership = () => {
      const pendingTransition = pendingTransitionRef.current
      if (pendingTransition != null && pendingTransition.attemptId !== attemptId) {
        return false
      }
      pendingTransitionRef.current = attempt
      if (
        mountedRef.current &&
        isCommittedScopeIdentityCurrent(scopeIdentity)
      ) {
        onPendingChange(true)
      }
      return true
    }
    const complete = (): Promise<PermissionModeTransitionTerminalOutcome> => {
      if (terminalPromise != null) return terminalPromise
      terminalState = 'finalizing'
      terminalPromise = completion.then((selected) => {
        if (!selected || terminalState !== 'finalizing') return 'not-selected'
        successCleanup?.commit()
        successCleanup = undefined
        if (ownsCompletedAttempt()) completedAttemptRef.current = null
        terminalState = 'finalized'
        return 'finalized'
      })
      return terminalPromise
    }
    const cancel = (): Promise<PermissionModeTransitionTerminalOutcome> => {
      if (terminalPromise != null) {
        return terminalPromise
      }
      terminalState = 'cancelling'
      terminalPromise = (async () => {
        const selected = await completion
        if (!selected || !completedSuccessfully) {
          terminalState = 'canceled'
          releaseCompensationOwnership()
          return 'not-selected'
        }
        if (!ownsCompletedAttempt() || !retainCompensationOwnership()) {
          terminalState = 'failed-cancel'
          return 'compensation-failed-selected-remains'
        }
        const compensated = await compensateRuntime()
        if (compensated) {
          rollbackOptimisticMode()
          successCleanup?.undo()
          terminalState = 'canceled'
        } else {
          // The remote mode did not change back. Keep the optimistic selected
          // mode and its exact persistence token as the truthful local state.
          successCleanup?.commit()
          terminalState = 'failed-cancel'
        }
        successCleanup = undefined
        releaseCompensationOwnership()
        return compensated ? 'compensated' : 'compensation-failed-selected-remains'
      })()
      return terminalPromise
    }
    completion = (async () => {
      try {
        if (sessionId != null && sessionId !== '') {
          const updated = await updateSession(sessionId, { permissionMode: mode })
          if (updated === false) throw new Error('Permission mode update was rejected')
        }
        if (isCurrentAttempt()) {
          completedAttemptRef.current = attempt
          const cleanup = onSuccess(mode, {
            attemptId,
            isCurrentAttemptOwner,
            scopeId
          })
          if (cleanup != null) successCleanup = cleanup
        } else if (
          sessionId != null &&
          sessionId !== '' &&
          pendingTransitionRef.current?.attemptId === attemptId
        ) {
          // The request belongs to the old scope, but it has changed the
          // server. Keep its serial owner until the guard consumes the same
          // one-shot cancellation promise and compensates that exact session.
          completedAttemptRef.current = attempt
          retainCompletedStaleSuccess = true
        }
        completedSuccessfully = true
        return true
      } catch (error) {
        if (isCurrentAttempt()) {
          modeRef.current = { mode: previousMode, scopeIdentity }
          setPermissionMode(previousMode)
          onInitialUpdateError()
        }
        return false
      } finally {
        if (!retainCompletedStaleSuccess && terminalState !== 'cancelling') {
          if (pendingTransitionRef.current?.attemptId === attemptId) {
            pendingTransitionRef.current = null
          }
          if (mountedRef.current) onPendingChange(false)
        }
      }
    })()

    return { accepted: true, cancel, complete, completion }
  }, [
    getCommittedScopeIdentity,
    isCommittedScopeIdentityCurrent,
    onPendingAttempt,
    onPendingChange,
    onSuccess,
    permissionMode,
    scopeId,
    sessionId,
    setPermissionMode
  ])
}
