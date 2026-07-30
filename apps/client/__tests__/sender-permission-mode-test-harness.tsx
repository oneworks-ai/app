import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'

import type { SenderProps } from '#~/components/chat/sender/@types/sender-props'
import { Sender } from '#~/components/chat/sender/Sender'
import { createDraftPermissionModeIncarnation } from '#~/hooks/chat/permission-mode-acknowledgement'
import { deriveCanonicalPermissionModeOwner } from '#~/hooks/chat/permission-mode-owner'
import type {
  PermissionMode,
  PermissionModeDraftCreationToken,
  PermissionModeRequestHandler,
  PermissionModeSelectionStart
} from '#~/hooks/chat/use-chat-permission-mode'
import { useChatPermissionMode } from '#~/hooks/chat/use-chat-permission-mode'
import { useDraftPermissionModeLifecycle } from '#~/hooks/chat/use-draft-permission-mode-lifecycle'

const emptyHandler = () => undefined

export function ActualSenderPermissionHarness({
  authoritativeMode,
  draftIdentity,
  workspaceFolder = '/workspace/default',
  sessionId,
  sessionCreatedAt = 1,
  onLayoutMode,
  onLayoutUnmount,
  onPassiveUnmount,
  onPermissionSelection,
  legacyPermissionModeChange,
  deferPermissionSelectionFinalize = false,
  selectionControlsDisabled = false,
  suspendAfterPermissionHook
}: {
  authoritativeMode?: PermissionMode
  draftIdentity: string
  workspaceFolder?: string
  sessionId?: string
  sessionCreatedAt?: number
  onLayoutMode?: (mode: PermissionMode, pending: boolean) => void
  onLayoutUnmount?: () => void
  onPassiveUnmount?: () => void
  onPermissionSelection?: (selection: PermissionModeSelectionStart) => void
  legacyPermissionModeChange?: SenderProps['onPermissionModeChange']
  deferPermissionSelectionFinalize?: boolean
  selectionControlsDisabled?: boolean
  suspendAfterPermissionHook?: Promise<never>
}) {
  const ownerIdentity = deriveCanonicalPermissionModeOwner({ workspaceFolder })
  const draftIncarnation = useMemo(createDraftPermissionModeIncarnation, [draftIdentity])
  const draftLifecycle = useDraftPermissionModeLifecycle({
    incarnation: draftIncarnation,
    ownerIdentity
  })
  const {
    permissionMode,
    permissionModeOptions,
    permissionModeTransitionPending,
    setPermissionMode
  } = useChatPermissionMode({
    draftIdentity,
    draftLifecycle,
    ownerIdentity,
    session: sessionId == null
      ? undefined
      : {
        createdAt: sessionCreatedAt,
        id: sessionId,
        permissionMode: authoritativeMode
      }
  })

  useLayoutEffect(() => {
    onLayoutMode?.(permissionMode, permissionModeTransitionPending)
  }, [onLayoutMode, permissionMode, permissionModeTransitionPending])
  useLayoutEffect(() => () => onLayoutUnmount?.(), [onLayoutUnmount])
  useEffect(() => () => onPassiveUnmount?.(), [onPassiveUnmount])
  const requestPermissionModeChange: PermissionModeRequestHandler = (mode, options) => {
    const selection = setPermissionMode(mode, {
      ...options,
      deferFinalize: deferPermissionSelectionFinalize || options?.deferFinalize
    })
    onPermissionSelection?.(selection)
    return selection
  }

  if (suspendAfterPermissionHook != null) {
    throw suspendAfterPermissionHook
  }

  return (
    <>
      <output
        data-testid='actual-sender-state'
        data-mode={permissionMode}
        aria-busy={permissionModeTransitionPending}
      />
      <Sender
        adapterOptions={[]}
        hideSelectionControls
        modelUnavailable={false}
        onInterrupt={emptyHandler}
        onPermissionModeChange={legacyPermissionModeChange}
        onPermissionModeRequest={legacyPermissionModeChange == null ? requestPermissionModeChange : undefined}
        onSend={() => true}
        onSendContent={() => true}
        permissionMode={permissionMode}
        permissionModeOptions={permissionModeOptions}
        permissionModeTransitionPending={permissionModeTransitionPending}
        selectedAdapter='codex'
        selectedModel='gpt-test'
        selectionControlsDisabled={selectionControlsDisabled}
      />
    </>
  )
}

export function PermissionHarness({
  authoritativeMode,
  draftIdentity,
  workspaceFolder = '/workspace/default',
  sessionId,
  sessionCreatedAt = 1,
  deferStarterFinalize = false
}: {
  authoritativeMode?: PermissionMode
  draftIdentity: string
  workspaceFolder?: string
  sessionId?: string
  sessionCreatedAt?: number
  deferStarterFinalize?: boolean
}) {
  const ownerIdentity = deriveCanonicalPermissionModeOwner({ workspaceFolder })
  const draftIncarnation = useMemo(createDraftPermissionModeIncarnation, [draftIdentity])
  const draftLifecycle = useDraftPermissionModeLifecycle({
    incarnation: draftIncarnation,
    ownerIdentity
  })
  const draftCreationTokenRef = useRef<PermissionModeDraftCreationToken>()
  const {
    completePermissionModeDraftSessionCreation,
    createPermissionModeDraftCreationToken,
    permissionMode,
    permissionModeOptions,
    permissionModeTransitionPending,
    setPermissionMode
  } = useChatPermissionMode({
    draftIdentity,
    draftLifecycle,
    ownerIdentity,
    session: sessionId == null
      ? undefined
      : {
        createdAt: sessionCreatedAt,
        id: sessionId,
        permissionMode: authoritativeMode
      }
  })

  return (
    <div>
      <output
        data-testid='permission-state'
        data-mode={permissionMode}
        aria-busy={permissionModeTransitionPending}
      />
      <button data-testid='starter-entry' onClick={() => setPermissionMode('dontAsk')}>
        starter dont ask
      </button>
      <button
        data-testid='starter-bypass-entry'
        onClick={() => setPermissionMode('bypassPermissions', { deferFinalize: deferStarterFinalize })}
      >
        starter bypass
      </button>
      <button
        data-testid='issue-draft-creation'
        onClick={() => {
          draftCreationTokenRef.current = createPermissionModeDraftCreationToken()
        }}
      >
        issue creation
      </button>
      <button
        data-testid='complete-draft-creation'
        onClick={() => {
          if (sessionId != null) {
            completePermissionModeDraftSessionCreation(
              draftCreationTokenRef.current,
              { createdAt: sessionCreatedAt, id: sessionId }
            )
          }
        }}
      >
        complete creation
      </button>
      <Sender
        adapterOptions={[]}
        hideSelectionControls
        modelUnavailable={false}
        onInterrupt={emptyHandler}
        onPermissionModeRequest={setPermissionMode}
        onSend={() => true}
        onSendContent={() => true}
        permissionMode={permissionMode}
        permissionModeOptions={permissionModeOptions}
        permissionModeTransitionPending={permissionModeTransitionPending}
        selectedAdapter='codex'
        selectedModel='gpt-test'
      />
    </div>
  )
}
