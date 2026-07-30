/* eslint-disable max-lines -- one starter transaction owns validation, permission, focus, and scope cleanup. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { ConversationStarterConfig } from '@oneworks/types'

import type { CommittedScopeIdentity } from '#~/hooks/chat/committed-scope-identity'
import { useCommittedScopeIdentity } from '#~/hooks/chat/committed-scope-identity'
import { requestPermissionModeChange } from '#~/hooks/chat/use-chat-permission-mode'
import type { PermissionModeRequestHandler, PermissionModeSelectionStart } from '#~/hooks/chat/use-chat-permission-mode'

import { captureConversationStarterConfig } from './conversation-starter-apply'
import type { CapturedConversationStarterConfig } from './conversation-starter-apply'
import type {
  PreparedConversationStarterBundle,
  PreparedConversationStarterCommitValidation
} from './use-conversation-starter-bundle'

interface PendingStarterApplication {
  id: number
  scopeIdentity: CommittedScopeIdentity
}

export function useConversationStarterApplication({
  commitPreparedStarterBundle,
  discardPreparedStarterBundle,
  getPreparedStarterValidation,
  onError,
  onPermissionModeChange,
  permissionModeTransitionPending,
  prepareStarterBundle,
  sessionId
}: {
  commitPreparedStarterBundle: (
    prepared: PreparedConversationStarterBundle,
    validation: PreparedConversationStarterCommitValidation
  ) => boolean
  discardPreparedStarterBundle: (prepared: PreparedConversationStarterBundle) => boolean
  getPreparedStarterValidation: (
    prepared: PreparedConversationStarterBundle
  ) => PreparedConversationStarterCommitValidation
  onError?: (error: unknown) => void
  onPermissionModeChange: PermissionModeRequestHandler
  permissionModeTransitionPending: boolean
  prepareStarterBundle: (
    starter: CapturedConversationStarterConfig
  ) => Promise<PreparedConversationStarterBundle | false>
  sessionId?: string
}) {
  const [starterApplicationPending, setStarterApplicationPending] = useState(false)
  const mountedRef = useRef(true)
  const pendingApplicationRef = useRef<PendingStarterApplication | null>(null)
  const sequenceRef = useRef(0)
  const scopeId = sessionId ?? 'draft'
  const {
    getCommittedScopeIdentity,
    isCommittedScopeIdentityCurrent
  } = useCommittedScopeIdentity(scopeId)

  useLayoutEffect(() => {
    const pendingApplication = pendingApplicationRef.current
    if (
      pendingApplication == null ||
      isCommittedScopeIdentityCurrent(pendingApplication.scopeIdentity)
    ) {
      return
    }

    pendingApplicationRef.current = null
    setStarterApplicationPending(false)
  }, [isCommittedScopeIdentityCurrent, scopeId])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      pendingApplicationRef.current = null
      sequenceRef.current += 1
    }
  }, [])

  const applyConversationStarter = useCallback(async (
    starter: ConversationStarterConfig
  ) => {
    if (
      sessionId != null ||
      permissionModeTransitionPending ||
      pendingApplicationRef.current != null
    ) {
      return false
    }

    const applicationId = ++sequenceRef.current
    const scopeIdentity = getCommittedScopeIdentity()
    if (scopeIdentity.scopeId !== scopeId) return false
    const focusTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    pendingApplicationRef.current = {
      id: applicationId,
      scopeIdentity
    }
    setStarterApplicationPending(true)
    let applied = false
    let prepared: PreparedConversationStarterBundle | undefined
    let permissionSelection: PermissionModeSelectionStart | undefined
    let permissionSelectionAccepted = false
    let permissionCancellationRequested = false
    const cancelAcceptedPermissionSelection = async () => {
      if (!permissionSelectionAccepted || permissionCancellationRequested) return
      permissionCancellationRequested = true
      try {
        await permissionSelection?.cancel?.()
      } catch (cancelError) {
        onError?.(cancelError)
      }
    }
    try {
      const capturedStarter = captureConversationStarterConfig(starter)
      const preparation = await prepareStarterBundle(capturedStarter)
      if (preparation === false) return false
      prepared = preparation
      const preparedBundle = preparation
      if (
        sequenceRef.current !== applicationId ||
        !isCommittedScopeIdentityCurrent(scopeIdentity) ||
        scopeIdentity.scopeId !== 'draft'
      ) {
        return false
      }

      const requestedPermissionMode = capturedStarter.permissionMode
      if (requestedPermissionMode != null) {
        permissionSelection = requestPermissionModeChange(
          {
            onError,
            requestHandler: onPermissionModeChange
          },
          requestedPermissionMode,
          {
            deferFinalize: true,
            isCurrent: () => {
              const validation = getPreparedStarterValidation(preparedBundle)
              return validation.status === 'ready' &&
                validation.catalogRevision === preparedBundle.catalogRevision
            }
          }
        )
        permissionSelectionAccepted = permissionSelection.accepted
        const outcome = await Promise.race([
          permissionSelection.completion.then(selected => ({
            kind: 'permission' as const,
            selected
          })),
          preparedBundle.invalidated.then(error => ({
            error,
            kind: 'invalidated' as const
          }))
        ])
        if (outcome.kind === 'invalidated') {
          await cancelAcceptedPermissionSelection()
          onError?.(outcome.error)
          return false
        }
        if (!outcome.selected) return false
      }
      if (
        sequenceRef.current !== applicationId ||
        !isCommittedScopeIdentityCurrent(scopeIdentity) ||
        scopeIdentity.scopeId !== 'draft'
      ) {
        return false
      }

      applied = commitPreparedStarterBundle(
        preparedBundle,
        getPreparedStarterValidation(preparedBundle)
      )
      if (!applied) {
        onError?.(new Error('Conversation starter validation changed before commit'))
      } else {
        // The permission selection remains provisional until the complete
        // bundle (and its Recent update inside the commit owner) is durable.
        await permissionSelection?.finalize?.()
      }
      return applied
    } catch (error) {
      onError?.(error)
      return false
    } finally {
      // A selected permission mode is only committed as part of this starter
      // transaction. Any later failed scope/catalog/commit check must cancel
      // this exact selection before dropping its prepared bundle.
      if (!applied && permissionSelectionAccepted) {
        await cancelAcceptedPermissionSelection()
      }
      if (!applied && prepared != null) {
        discardPreparedStarterBundle(prepared)
      }
      if (
        mountedRef.current &&
        pendingApplicationRef.current?.id === applicationId
      ) {
        pendingApplicationRef.current = null
        setStarterApplicationPending(false)
      }
      if (
        !applied &&
        isCommittedScopeIdentityCurrent(scopeIdentity) &&
        focusTarget?.isConnected === true
      ) {
        window.requestAnimationFrame(() => focusTarget.focus())
      }
    }
  }, [
    commitPreparedStarterBundle,
    discardPreparedStarterBundle,
    getPreparedStarterValidation,
    getCommittedScopeIdentity,
    isCommittedScopeIdentityCurrent,
    onPermissionModeChange,
    onError,
    permissionModeTransitionPending,
    prepareStarterBundle,
    scopeId,
    sessionId
  ])

  return {
    applyConversationStarter,
    starterApplicationPending: starterApplicationPending || permissionModeTransitionPending
  }
}
