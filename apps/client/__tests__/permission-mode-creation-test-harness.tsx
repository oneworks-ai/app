import { useMemo, useState } from 'react'

import type { Session } from '@oneworks/core'

import { Sender } from '#~/components/chat/sender/Sender'
import { createDraftPermissionModeIncarnation } from '#~/hooks/chat/permission-mode-acknowledgement'
import { deriveCanonicalPermissionModeOwner } from '#~/hooks/chat/permission-mode-owner'
import { useChatPermissionMode } from '#~/hooks/chat/use-chat-permission-mode'
import { useChatSessionActions } from '#~/hooks/chat/use-chat-session-actions'
import { useDraftPermissionModeLifecycle } from '#~/hooks/chat/use-draft-permission-mode-lifecycle'

const emptyHandler = () => undefined

export function PermissionModeCreationHarness({
  draftIdentity,
  workspaceFolder = '/workspace/default',
  session
}: {
  draftIdentity: string
  workspaceFolder?: string
  session?: Session
}) {
  const ownerIdentity = deriveCanonicalPermissionModeOwner({ workspaceFolder })
  const draftIncarnation = useMemo(createDraftPermissionModeIncarnation, [draftIdentity])
  const draftLifecycle = useDraftPermissionModeLifecycle({
    incarnation: draftIncarnation,
    ownerIdentity
  })
  const [createdSession, setCreatedSession] = useState<Session>()
  const activeSession = session ?? createdSession
  const {
    completePermissionModeDraftSessionCreation,
    createPermissionModeDraftCreationToken,
    discardPermissionModeDraftSessionCreation,
    permissionMode,
    permissionModeOptions,
    permissionModeTransitionPending,
    setPermissionMode
  } = useChatPermissionMode({
    draftIdentity,
    draftLifecycle,
    ownerIdentity,
    session: activeSession
  })
  const actions = useChatSessionActions({
    session: activeSession,
    modelForQuery: 'codex/test',
    hasAvailableModels: true,
    effort: 'default',
    permissionMode,
    workspaceConfigReady: true,
    completePermissionModeDraftSessionCreation,
    createPermissionModeDraftCreationToken,
    discardPermissionModeDraftSessionCreation,
    navigateOnCreate: false,
    onSessionCreated: setCreatedSession,
    onClearMessages: emptyHandler
  })

  return (
    <>
      <output
        data-testid='creation-permission-state'
        data-mode={permissionMode}
        data-session-status={activeSession?.status}
        data-is-thinking={actions.isThinking}
        aria-busy={permissionModeTransitionPending || actions.isCreating}
      />
      <Sender
        adapterOptions={[]}
        hideReferenceActions
        hideSelectionControls
        modelUnavailable={false}
        onInterrupt={actions.interrupt}
        onPermissionModeRequest={setPermissionMode}
        onSend={actions.send}
        onSendContent={actions.sendContent}
        permissionMode={permissionMode}
        permissionModeOptions={permissionModeOptions}
        permissionModeTransitionPending={permissionModeTransitionPending}
        selectedAdapter='codex'
        selectedModel='codex/test'
        sessionStatus={activeSession?.status}
      />
    </>
  )
}
