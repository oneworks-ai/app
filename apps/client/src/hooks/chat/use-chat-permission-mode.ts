/* eslint-disable max-lines -- public hook composes scope, persistence, transition, and confirmation ownership. */

import { App } from 'antd'
import { useCallback, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Session } from '@oneworks/core'

import { getApiErrorMessage } from '#~/api'

import type { PermissionMode } from './permission-mode'
import { buildPermissionModeOptions, isHighRiskPermissionMode, isPermissionMode } from './permission-mode'
import type { DraftPermissionModeLifecycle, PermissionModeDraftCreationToken } from './permission-mode-acknowledgement'
import {
  buildPermissionModeSessionAcknowledgementScope,
  consumePermissionModeDraftCreationAcknowledgements,
  createDraftPermissionModeIncarnation,
  createDraftPermissionModeLifecycle,
  discardPermissionModeDraftCreationToken,
  issuePermissionModeDraftCreationToken
} from './permission-mode-acknowledgement'
import { useDraftPermissionModeLifecycle } from './use-draft-permission-mode-lifecycle'
import type {
  PermissionModeSelectionOptions,
  PermissionModeSelectionStart
} from './use-permission-mode-selection-guard'
import { usePermissionModeSelectionGuard } from './use-permission-mode-selection-guard'
import { useSessionPermissionModeChange } from './use-session-permission-mode-change'

export type { PermissionMode, PermissionModeOption, PermissionModeRiskLevel } from './permission-mode'
export {
  buildPermissionModeOptions,
  getPermissionModeRiskLevel,
  isHighRiskPermissionMode,
  isPermissionMode
} from './permission-mode'
export type { PermissionModeDraftCreationToken } from './permission-mode-acknowledgement'
export type { PermissionModeSelectionStart } from './use-permission-mode-selection-guard'

const PERMISSION_MODE_STORAGE_KEY = 'oneworks_chat_permission_mode'

interface LowRiskPermissionModeWriteToken {
  attemptId: number
  previousValue: string | null
  scopeId: string
  writtenValue: PermissionMode
}

let activeLowRiskPermissionModeWrite: LowRiskPermissionModeWriteToken | undefined

const readPersistedLowRiskPermissionMode = (): PermissionMode => {
  try {
    const raw = localStorage.getItem(PERMISSION_MODE_STORAGE_KEY)
    return raw != null && isPermissionMode(raw) && !isHighRiskPermissionMode(raw)
      ? raw
      : 'default'
  } catch {
    return 'default'
  }
}

export type PermissionModeChangeHandler = (
  mode: PermissionMode
) => void | Promise<void>

export type PermissionModeRequestHandler = (
  mode: PermissionMode,
  options?: PermissionModeSelectionOptions
) => PermissionModeSelectionStart

export const requestPermissionModeChange = (
  {
    legacyHandler,
    onError,
    requestHandler
  }: {
    legacyHandler?: PermissionModeChangeHandler
    onError?: (error: unknown) => void
    requestHandler?: PermissionModeRequestHandler
  },
  mode: PermissionMode,
  options?: PermissionModeSelectionOptions
): PermissionModeSelectionStart => {
  const immediate = (
    selected: boolean,
    result: PermissionModeSelectionStart['result'] = selected ? 'selected' : 'rejected'
  ): PermissionModeSelectionStart => ({
    accepted: selected,
    completion: Promise.resolve(selected),
    result
  })
  if (requestHandler != null) {
    try {
      return requestHandler(mode, options)
    } catch (error) {
      onError?.(error)
      return immediate(false)
    }
  }
  if (legacyHandler == null) {
    return immediate(true)
  }
  try {
    const completion = legacyHandler(mode)
    if (completion != null) {
      return {
        accepted: true,
        completion: Promise.resolve(completion).then(
          () => true,
          (error) => {
            onError?.(error)
            return false
          }
        ),
        result: 'selected'
      }
    }
  } catch (error) {
    onError?.(error)
    return immediate(false)
  }
  return immediate(true)
}

interface ScopedPermissionModeState {
  authoritativeKey: string
  mode: PermissionMode
  scopeId: string
}

interface ScopedPendingState {
  pending: boolean
  scopeId: string
}

export function useChatPermissionMode({
  draftIdentity,
  draftLifecycle: suppliedDraftLifecycle,
  ownerIdentity,
  session
}: {
  draftIdentity?: string
  draftLifecycle?: DraftPermissionModeLifecycle
  ownerIdentity?: string
  session?: Pick<Session, 'createdAt' | 'id' | 'permissionMode'>
} = {}) {
  const { t } = useTranslation()
  const { message, modal } = App.useApp()
  const reactIdentity = useId()
  const fallbackDraftIncarnation = useMemo(createDraftPermissionModeIncarnation, [])
  const fallbackDraftLifecycle = useDraftPermissionModeLifecycle({
    incarnation: fallbackDraftIncarnation,
    ownerIdentity
  })
  const draftLifecycle = suppliedDraftLifecycle ?? fallbackDraftLifecycle
  const unboundSessionLifecycle = useMemo(
    createDraftPermissionModeLifecycle,
    [session?.createdAt, session?.id]
  )
  const resolvedDraftIdentity = draftIdentity?.trim() || `component:${reactIdentity}`
  const draftScopeId = `draft:v2:${resolvedDraftIdentity}`
  const persistentSessionScope = useMemo(
    () =>
      buildPermissionModeSessionAcknowledgementScope({
        ownerIdentity,
        session
      }),
    [ownerIdentity, session?.createdAt, session?.id]
  )
  const acknowledgementScope = session == null
    ? { kind: 'ephemeral' as const, lifecycle: draftLifecycle }
    : persistentSessionScope ?? { kind: 'ephemeral' as const, lifecycle: unboundSessionLifecycle }
  const acknowledgementScopeId = session == null
    ? draftScopeId
    : persistentSessionScope?.storageScopeId ?? `session:unbound:${reactIdentity}:${session.id}:${session.createdAt}`
  const authoritativeMode = session == null
    ? readPersistedLowRiskPermissionMode()
    : session.permissionMode != null && isPermissionMode(session.permissionMode)
    ? session.permissionMode
    : 'default'
  const authoritativeKey = session == null
    ? acknowledgementScopeId
    : `${acknowledgementScopeId}:${authoritativeMode}`
  const [scopedMode, setScopedMode] = useState<ScopedPermissionModeState>(() => ({
    authoritativeKey,
    mode: authoritativeMode,
    scopeId: acknowledgementScopeId
  }))
  const [scopedPending, setScopedPending] = useState<ScopedPendingState>(() => ({
    pending: false,
    scopeId: acknowledgementScopeId
  }))
  const permissionMode = scopedMode.scopeId === acknowledgementScopeId &&
      scopedMode.authoritativeKey === authoritativeKey
    ? scopedMode.mode
    : authoritativeMode
  // A transition owner is serial across scopes. Rendering a new scope as
  // enabled while an old scope still owns a remote update would invite an
  // interaction the event-time gate must reject, so expose the owner directly
  // until its exact attempt settles.
  const permissionModeTransitionPending = scopedPending.pending
  const applyPermissionMode = useCallback((value?: string) => {
    const mode = value != null && isPermissionMode(value) ? value : 'default'
    setScopedMode({
      authoritativeKey,
      mode,
      scopeId: acknowledgementScopeId
    })
  }, [acknowledgementScopeId, authoritativeKey])
  const setPermissionModeTransitionPending = useCallback((pending: boolean) => {
    setScopedPending({
      pending,
      scopeId: acknowledgementScopeId
    })
  }, [acknowledgementScopeId])

  const persistLowRiskPermissionMode = useCallback((
    mode: PermissionMode,
    ownership: { attemptId: number; scopeId: string }
  ) => {
    if (isHighRiskPermissionMode(mode)) return
    let previousValue: string | null
    try {
      previousValue = localStorage.getItem(PERMISSION_MODE_STORAGE_KEY)
      localStorage.setItem(PERMISSION_MODE_STORAGE_KEY, mode)
    } catch {
      return
    }
    const writeToken: LowRiskPermissionModeWriteToken = {
      attemptId: ownership.attemptId,
      previousValue,
      scopeId: ownership.scopeId,
      writtenValue: mode
    }
    activeLowRiskPermissionModeWrite = writeToken
    return {
      commit: () => {
        if (activeLowRiskPermissionModeWrite === writeToken) {
          activeLowRiskPermissionModeWrite = undefined
        }
      },
      undo: () => {
        if (activeLowRiskPermissionModeWrite !== writeToken) return
        activeLowRiskPermissionModeWrite = undefined
        try {
          if (localStorage.getItem(PERMISSION_MODE_STORAGE_KEY) !== writeToken.writtenValue) {
            return
          }
          if (writeToken.previousValue == null) {
            localStorage.removeItem(PERMISSION_MODE_STORAGE_KEY)
          } else {
            localStorage.setItem(PERMISSION_MODE_STORAGE_KEY, writeToken.previousValue)
          }
        } catch {}
      }
    }
  }, [])
  const createPermissionModeDraftCreationToken = useCallback((): PermissionModeDraftCreationToken | undefined => {
    if (session != null) return undefined
    return issuePermissionModeDraftCreationToken(draftLifecycle)
  }, [draftLifecycle, session])
  const completePermissionModeDraftSessionCreation = useCallback((
    token: PermissionModeDraftCreationToken | undefined,
    createdSession: Pick<Session, 'createdAt' | 'id'>
  ) => {
    if (token == null) return false
    const targetScope = buildPermissionModeSessionAcknowledgementScope({
      ownerIdentity,
      session: createdSession
    })
    if (targetScope == null) {
      discardPermissionModeDraftCreationToken(token)
      return false
    }
    return consumePermissionModeDraftCreationAcknowledgements(
      token,
      targetScope
    )
  }, [ownerIdentity])
  const discardPermissionModeDraftSessionCreation = useCallback((
    token: PermissionModeDraftCreationToken | undefined
  ) => {
    discardPermissionModeDraftCreationToken(token)
  }, [])

  const permissionModeOptions = useMemo(() => buildPermissionModeOptions(t), [t])
  const notifyPermissionModeUpdateError = useCallback((error: unknown) => {
    void message.error({
      content: getApiErrorMessage(error, t('chat.permissionModes.updateFailed')),
      key: 'chat-permission-mode-update-failed'
    })
  }, [message, t])
  const notifyPermissionModeCompensationError = useCallback(() => {
    void message.error({
      content: t('chat.permissionModes.compensationFailedSelectedRemains'),
      key: 'chat-permission-mode-compensation-failed'
    })
  }, [message, t])
  const notifyPermissionModeInitialUpdateError = useCallback(() => {
    void message.error({
      content: t('chat.permissionModes.initialUpdateFailed'),
      key: 'chat-permission-mode-initial-update-failed'
    })
  }, [message, t])
  const notifyPermissionModeTransitionPending = useCallback(() => {
    void message.warning({
      content: t('chat.permissionModes.transitionPending'),
      key: 'chat-permission-mode-transition-pending'
    })
  }, [message, t])
  const transitionPermissionMode = useSessionPermissionModeChange({
    onCompensationError: notifyPermissionModeCompensationError,
    onInitialUpdateError: notifyPermissionModeInitialUpdateError,
    onPendingAttempt: notifyPermissionModeTransitionPending,
    onPendingChange: setPermissionModeTransitionPending,
    onSuccess: persistLowRiskPermissionMode,
    permissionMode,
    scopeId: acknowledgementScopeId,
    sessionId: session?.id,
    setPermissionMode: applyPermissionMode
  })
  const requestPermissionModeChange = usePermissionModeSelectionGuard({
    acknowledgementScope,
    confirmModal: modal.confirm,
    onSelect: transitionPermissionMode,
    permissionModeOptions,
    scopeId: acknowledgementScopeId,
    t
  })

  return {
    permissionMode,
    permissionModeTransitionPending,
    createPermissionModeDraftCreationToken,
    completePermissionModeDraftSessionCreation,
    discardPermissionModeDraftSessionCreation,
    setPermissionMode: requestPermissionModeChange,
    permissionModeOptions
  }
}
