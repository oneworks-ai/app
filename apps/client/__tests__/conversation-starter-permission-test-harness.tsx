import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { ChatMessageContent } from '@oneworks/core'
import type { ConversationStarterConfig } from '@oneworks/types'

import { NewSessionGuideStarterList } from '#~/components/chat/NewSessionGuideStarterList'
import { useConversationStarterApplication } from '#~/components/chat/use-conversation-starter-application'
import { useConversationStarterBundle } from '#~/components/chat/use-conversation-starter-bundle'
import { DEFAULT_CHAT_SESSION_TARGET_DRAFT } from '#~/hooks/chat/chat-session-target'
import { DEFAULT_CHAT_SESSION_WORKSPACE_DRAFT } from '#~/hooks/chat/chat-session-workspace-draft'
import { createDraftPermissionModeLifecycle } from '#~/hooks/chat/permission-mode-acknowledgement'
import type { ChatEffort } from '#~/hooks/chat/use-chat-effort'
import type { PermissionModeRequestHandler } from '#~/hooks/chat/use-chat-permission-mode'
import { useChatPermissionMode } from '#~/hooks/chat/use-chat-permission-mode'

const conversationStarter: ConversationStarterConfig = {
  title: 'High risk starter',
  prompt: 'Run the configured starter',
  account: 'starter-account',
  adapter: 'starter-adapter',
  effort: 'high',
  files: ['starter-file.md'],
  model: 'starter-model',
  mode: 'workspace',
  permissionMode: 'bypassPermissions',
  target: 'starter-target',
  worktree: {
    create: true,
    environment: 'starter-environment'
  }
}

export function ConversationStarterPermissionHarness({
  onPermissionModeChange,
  sessionId,
  suspendAfterStarterHook,
  throwOnApply
}: {
  onPermissionModeChange?: PermissionModeRequestHandler
  sessionId?: string
  suspendAfterStarterHook?: Promise<never>
  throwOnApply?: boolean
}) {
  const draftLifecycle = useMemo(createDraftPermissionModeLifecycle, [])
  const starter = useMemo(() => {
    if (throwOnApply !== true) return conversationStarter
    const invalidStarter = { ...conversationStarter }
    Object.defineProperty(invalidStarter, 'account', {
      get: () => {
        throw new Error('invalid starter account')
      }
    })
    return invalidStarter
  }, [throwOnApply])
  const [applicationError, setApplicationError] = useState('')
  const [account] = useState('')
  const [adapter] = useState('')
  const [effort] = useState<ChatEffort>('default')
  const [initialContent] = useState<ChatMessageContent[] | undefined>()
  const [model] = useState('')
  const [sessionTargetDraft] = useState(
    DEFAULT_CHAT_SESSION_TARGET_DRAFT
  )
  const [workspaceDraft] = useState(
    DEFAULT_CHAT_SESSION_WORKSPACE_DRAFT
  )
  const [workspaceDraftDirty] = useState(false)
  const {
    permissionMode,
    permissionModeTransitionPending,
    setPermissionMode
  } = useChatPermissionMode({
    draftIdentity: 'starter-workspace',
    draftLifecycle,
    session: sessionId == null
      ? undefined
      : {
        createdAt: 1,
        id: sessionId,
        permissionMode: 'default'
      }
  })
  const {
    commitPreparedStarterBundle,
    discardPreparedStarterBundle,
    pendingStarterBundle,
    prepareStarterBundle,
    settleStarterSelectionValidation,
    snapshot: starterBundle,
    updateStarterBundle
  } = useConversationStarterBundle({
    current: {
      account,
      adapter,
      effortSelection: {
        effort: effort === 'default' ? 'medium' : effort,
        source: 'fallback'
      },
      initialContent,
      model,
      permissionMode,
      sessionTargetDraft,
      workspaceDraft,
      workspaceDraftDirty
    },
    scopeId: sessionId == null ? 'draft' : `session:${sessionId}`
  })
  useEffect(() => {
    if (
      pendingStarterBundle == null ||
      pendingStarterBundle.snapshot.selectionValidation?.status === 'ready'
    ) return
    settleStarterSelectionValidation({
      account: pendingStarterBundle.snapshot.account,
      catalogKey: pendingStarterBundle.snapshot.selectionValidation?.catalogKey ?? '',
      catalogRevision: 'test-ready',
      id: pendingStarterBundle.id,
      status: 'ready'
    })
  }, [pendingStarterBundle, settleStarterSelectionValidation])
  const preparedValidationRef = useRef({
    account: pendingStarterBundle?.snapshot.account,
    catalogRevision: 'test-ready',
    status: 'ready' as const
  })
  useLayoutEffect(() => {
    preparedValidationRef.current = {
      account: pendingStarterBundle?.snapshot.account,
      catalogRevision: 'test-ready',
      status: 'ready'
    }
  }, [pendingStarterBundle?.snapshot.account])
  const {
    applyConversationStarter,
    starterApplicationPending
  } = useConversationStarterApplication({
    commitPreparedStarterBundle,
    discardPreparedStarterBundle,
    getPreparedStarterValidation: () => preparedValidationRef.current,
    onError: error =>
      setApplicationError(
        error instanceof Error ? error.message : String(error)
      ),
    onPermissionModeChange: onPermissionModeChange ?? setPermissionMode,
    permissionModeTransitionPending,
    prepareStarterBundle,
    sessionId
  })

  if (suspendAfterStarterHook != null) {
    throw suspendAfterStarterHook
  }

  const appliedBundle = starterBundle.initialContent == null
    ? ''
    : JSON.stringify(starterBundle)

  return (
    <>
      <output
        data-testid='starter-transaction-state'
        data-applied={appliedBundle}
        data-error={applicationError}
        data-mode={starterBundle.permissionMode}
        aria-busy={starterApplicationPending}
      />
      <output data-testid='starter-create-payload' data-payload={appliedBundle} />
      <output data-testid='starter-queued-payload' data-payload={appliedBundle} />
      <button
        data-testid='edit-starter-account'
        onClick={() => updateStarterBundle(current => ({ ...current, account: 'edited-account' }))}
      />
      <button
        data-testid='edit-starter-adapter'
        onClick={() =>
          updateStarterBundle(current => ({
            ...current,
            account: undefined,
            adapter: 'edited-adapter'
          }))}
      />
      <button
        data-testid='edit-starter-effort'
        onClick={() =>
          updateStarterBundle(current => ({
            ...current,
            effortSelection: { effort: 'low', source: 'user' }
          }))}
      />
      <button
        data-testid='edit-starter-model'
        onClick={() => updateStarterBundle(current => ({ ...current, model: 'edited-model' }))}
      />
      <button
        data-testid='edit-starter-permission'
        onClick={() => updateStarterBundle(current => ({ ...current, permissionMode: 'dontAsk' }))}
      />
      <button
        data-testid='edit-starter-target'
        onClick={() =>
          updateStarterBundle(current => ({
            ...current,
            sessionTargetDraft: { type: 'spec', name: 'edited-target' }
          }))}
      />
      <button
        data-testid='edit-starter-workspace'
        onClick={() =>
          updateStarterBundle(current => ({
            ...current,
            workspaceDraft: { ...current.workspaceDraft, createWorktree: false },
            workspaceDraftDirty: true
          }))}
      />
      <button
        data-testid='edit-starter-content'
        onClick={() =>
          updateStarterBundle(current => ({
            ...current,
            initialContent: [{ type: 'text', text: 'edited-content' }]
          }))}
      />
      <NewSessionGuideStarterList
        startupPresets={[starter]}
        builtinActions={[]}
        disabled={starterApplicationPending}
        onApplyStarter={applyConversationStarter}
      />
    </>
  )
}
