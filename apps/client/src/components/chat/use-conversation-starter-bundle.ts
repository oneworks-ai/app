/* eslint-disable max-lines -- staged validation and atomic bundle ownership intentionally stay co-located. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { ChatMessageContent } from '@oneworks/core'
import type { ConversationStarterConfig } from '@oneworks/types'

import type { ChatSessionTargetDraft } from '#~/hooks/chat/chat-session-target'
import type { ChatSessionWorkspaceDraft } from '#~/hooks/chat/chat-session-workspace-draft'
import type { ChatEffort, EffortSelection } from '#~/hooks/chat/use-chat-effort'
import type { PermissionMode } from '#~/hooks/chat/use-chat-permission-mode'

import {
  buildConversationStarterInitialContent,
  buildConversationStarterTargetDraft,
  buildConversationStarterWorkspacePatch,
  captureConversationStarterConfig
} from './conversation-starter-apply'
import type { CapturedConversationStarterConfig } from './conversation-starter-apply'

export interface ConversationStarterSelectionValidation {
  catalogKey: string
  catalogRevision?: string
  error?: Error
  status: 'not-required' | 'pending' | 'ready' | 'failed'
}

export interface ConversationStarterBundleSnapshot {
  account?: string
  adapter?: string
  effortSelection: EffortSelection
  initialContent?: ChatMessageContent[]
  model?: string
  permissionMode: PermissionMode
  selectionValidation?: ConversationStarterSelectionValidation
  sessionTargetDraft: ChatSessionTargetDraft
  workspaceDraft: ChatSessionWorkspaceDraft
  workspaceDraftDirty: boolean
}

export interface ConversationStarterConfiguredFields {
  account: { present: boolean; value?: string }
  adapter: { present: boolean; value?: string }
  effort: { present: boolean; value?: ChatEffort }
  model: { present: boolean; value?: string }
}

interface ScopedConversationStarterBundle {
  configuredFields: ConversationStarterConfiguredFields
  scopeId: string
  snapshot: ConversationStarterBundleSnapshot
}

interface PendingConversationStarterBundle extends ScopedConversationStarterBundle {
  id: number
  invalidation?: {
    invalidate: (error: Error) => void
    promise: Promise<Error>
  }
  kind: 'application' | 'edit'
}

export interface PreparedConversationStarterBundle {
  catalogRevision: string
  id: number
  invalidated: Promise<Error>
  scopeId: string
}

export interface PreparedConversationStarterCommitValidation {
  account?: string
  catalogRevision?: string
  status: 'ready' | 'invalid'
}

interface PendingConversationStarterSettlement {
  id: number
  reject: (error: Error) => void
  resolve: (prepared: PreparedConversationStarterBundle | false) => void
  scopeId: string
}

const nonEmpty = (value: string | undefined) => {
  const normalized = value?.trim()
  return normalized == null || normalized === '' ? undefined : normalized
}

const createPreparedInvalidation = () => {
  let invalidate: (error: Error) => void = () => {}
  const promise = new Promise<Error>((resolve) => {
    invalidate = resolve
  })
  return { invalidate, promise }
}

const buildCapturedConversationStarterBundle = (
  starter: CapturedConversationStarterConfig,
  current: ConversationStarterBundleSnapshot
): {
  configuredFields: ConversationStarterConfiguredFields
  snapshot: ConversationStarterBundleSnapshot
} => {
  const account = starter.account
  const adapter = starter.adapter
  const effort = starter.effort
  const model = starter.model
  const configuredFields: ConversationStarterConfiguredFields = {
    account: { present: account !== undefined, value: nonEmpty(account) },
    adapter: { present: adapter !== undefined, value: nonEmpty(adapter) },
    effort: { present: effort !== undefined, value: effort },
    model: { present: model !== undefined, value: nonEmpty(model) }
  }
  const workspacePatch = buildConversationStarterWorkspacePatch(starter)
  return {
    configuredFields,
    snapshot: {
      account: configuredFields.account.present ? configuredFields.account.value : current.account,
      adapter: configuredFields.adapter.present ? configuredFields.adapter.value : current.adapter,
      effortSelection: configuredFields.effort.present
        ? configuredFields.effort.value === 'default'
          ? { effort: current.effortSelection.effort, source: 'fallback' }
          : {
            effort: configuredFields.effort.value ?? current.effortSelection.effort,
            source: 'starter'
          }
        : current.effortSelection,
      initialContent: buildConversationStarterInitialContent(starter),
      model: configuredFields.model.present ? configuredFields.model.value : current.model,
      permissionMode: starter.permissionMode ?? current.permissionMode,
      selectionValidation: {
        catalogKey: '',
        status: 'pending'
      },
      sessionTargetDraft: starter.mode == null
        ? current.sessionTargetDraft
        : buildConversationStarterTargetDraft(starter),
      workspaceDraft: workspacePatch == null
        ? current.workspaceDraft
        : { ...current.workspaceDraft, ...workspacePatch },
      workspaceDraftDirty: current.workspaceDraftDirty || workspacePatch != null
    }
  }
}

export const buildConversationStarterBundle = (
  starter: ConversationStarterConfig,
  current: ConversationStarterBundleSnapshot
) => buildCapturedConversationStarterBundle(captureConversationStarterConfig(starter), current)

export const useConversationStarterBundle = ({
  current,
  normalizeSnapshot,
  scopeId
}: {
  current: ConversationStarterBundleSnapshot
  normalizeSnapshot?: (
    snapshot: ConversationStarterBundleSnapshot,
    configuredFields: ConversationStarterConfiguredFields
  ) => ConversationStarterBundleSnapshot
  scopeId: string
}) => {
  const [committed, setCommitted] = useState<ScopedConversationStarterBundle | null>(null)
  const [pending, setPending] = useState<PendingConversationStarterBundle | null>(null)
  const pendingRef = useRef<PendingConversationStarterBundle | null>(null)
  const nextIdRef = useRef(0)
  const settlementRef = useRef<PendingConversationStarterSettlement | null>(null)
  const snapshot = committed?.scopeId === scopeId ? committed.snapshot : current
  const hasActiveStarter = committed?.scopeId === scopeId
  useLayoutEffect(() => {
    if (pending != null && pending.scopeId !== scopeId) {
      pending.invalidation?.invalidate(new Error('Conversation starter scope changed'))
      pendingRef.current = null
      setPending(null)
    } else {
      pendingRef.current = pending
    }
    const settlement = settlementRef.current
    if (settlement == null || settlement.scopeId === scopeId) return
    settlementRef.current = null
    settlement.resolve(false)
    setPending(currentPending => currentPending?.id === settlement.id ? null : currentPending)
  }, [pending, scopeId])
  useEffect(() => () => {
    pendingRef.current?.invalidation?.invalidate(new Error('Conversation starter unmounted'))
    pendingRef.current = null
    const settlement = settlementRef.current
    settlementRef.current = null
    settlement?.resolve(false)
  }, [])
  const prepareStarterBundle = useCallback((starter: CapturedConversationStarterConfig) => {
    if (pendingRef.current?.scopeId === scopeId) return Promise.resolve(false)
    // Build the complete candidate before exposing one staged validation owner.
    const built = buildCapturedConversationStarterBundle(starter, snapshot)
    const next = normalizeSnapshot?.(built.snapshot, built.configuredFields) ?? built.snapshot
    const id = ++nextIdRef.current
    const catalogKey = `${next.adapter ?? ''}\u0000${next.model ?? ''}`
    const candidate: PendingConversationStarterBundle = {
      configuredFields: built.configuredFields,
      id,
      kind: 'application',
      scopeId,
      snapshot: {
        ...next,
        selectionValidation: {
          catalogKey,
          status: next.adapter == null ? 'not-required' : 'pending'
        }
      }
    }
    pendingRef.current = candidate
    setPending(candidate)
    return new Promise<PreparedConversationStarterBundle | false>((resolve, reject) => {
      settlementRef.current = { id, reject, resolve, scopeId }
    })
  }, [normalizeSnapshot, scopeId, snapshot])
  const prepareStarterBundleUpdate = useCallback((
    update: (currentSnapshot: ConversationStarterBundleSnapshot) => ConversationStarterBundleSnapshot
  ) => {
    if (
      !hasActiveStarter ||
      pendingRef.current?.scopeId === scopeId ||
      committed?.scopeId !== scopeId
    ) {
      return Promise.resolve(false)
    }
    const next = update(committed.snapshot)
    const id = ++nextIdRef.current
    const catalogKey = `${next.adapter ?? ''}\u0000${next.model ?? ''}`
    const candidate: PendingConversationStarterBundle = {
      configuredFields: committed.configuredFields,
      id,
      kind: 'application',
      scopeId,
      snapshot: {
        ...next,
        selectionValidation: {
          catalogKey,
          status: next.adapter == null ? 'not-required' : 'pending'
        }
      }
    }
    pendingRef.current = candidate
    setPending(candidate)
    return new Promise<PreparedConversationStarterBundle | false>((resolve, reject) => {
      settlementRef.current = { id, reject, resolve, scopeId }
    })
  }, [committed, hasActiveStarter, scopeId])
  const settleStarterSelectionValidation = useCallback((result: {
    account?: string
    catalogKey: string
    catalogRevision: string
    error?: Error
    id: number
    status: 'ready' | 'failed'
  }) => {
    const settlement = settlementRef.current
    if (
      pending?.id !== result.id ||
      pending.scopeId !== scopeId ||
      pending.snapshot.selectionValidation?.catalogKey !== result.catalogKey ||
      (pending.kind === 'application' && settlement?.id !== result.id)
    ) {
      return false
    }

    if (result.status === 'failed') {
      settlementRef.current = null
      pendingRef.current = null
      setPending(null)
      settlement?.reject(
        result.error ?? new Error('Conversation starter account selection could not be validated')
      )
      return true
    }
    const validated: PendingConversationStarterBundle = {
      ...pending,
      snapshot: {
        ...pending.snapshot,
        account: result.account,
        selectionValidation: {
          catalogKey: result.catalogKey,
          catalogRevision: result.catalogRevision,
          status: 'ready'
        }
      }
    }
    if (pending.kind === 'application') {
      if (settlement == null) return false
      const invalidation = createPreparedInvalidation()
      validated.invalidation = invalidation
      settlementRef.current = null
      pendingRef.current = validated
      setPending(validated)
      settlement.resolve({
        catalogRevision: result.catalogRevision,
        id: pending.id,
        invalidated: invalidation.promise,
        scopeId
      })
      return true
    }

    pendingRef.current = null
    setPending(null)
    setCommitted({
      configuredFields: validated.configuredFields,
      scopeId,
      snapshot: validated.snapshot
    })
    return true
  }, [pending, scopeId])
  const invalidatePreparedStarterBundle = useCallback((
    preparedId: number,
    error: Error
  ) => {
    const preparedBundle = pendingRef.current
    if (
      preparedBundle?.id !== preparedId ||
      preparedBundle.kind !== 'application' ||
      preparedBundle.scopeId !== scopeId
    ) {
      return false
    }
    preparedBundle.invalidation?.invalidate(error)
    pendingRef.current = null
    setPending(null)
    return true
  }, [scopeId])
  const commitPreparedStarterBundle = useCallback((
    prepared: PreparedConversationStarterBundle,
    validation: PreparedConversationStarterCommitValidation
  ) => {
    const preparedBundle = pendingRef.current
    if (
      preparedBundle?.id !== prepared.id ||
      preparedBundle.kind !== 'application' ||
      preparedBundle.scopeId !== scopeId ||
      prepared.scopeId !== scopeId ||
      validation.status !== 'ready' ||
      validation.catalogRevision !== prepared.catalogRevision ||
      validation.account !== preparedBundle.snapshot.account ||
      preparedBundle.snapshot.selectionValidation?.catalogRevision !== prepared.catalogRevision ||
      preparedBundle.snapshot.selectionValidation?.status !== 'ready'
    ) {
      return false
    }
    setCommitted({
      configuredFields: preparedBundle.configuredFields,
      scopeId,
      snapshot: preparedBundle.snapshot
    })
    pendingRef.current = null
    setPending(null)
    return true
  }, [scopeId])
  const discardPreparedStarterBundle = useCallback((prepared: PreparedConversationStarterBundle) => {
    const preparedBundle = pendingRef.current
    if (
      preparedBundle?.id !== prepared.id ||
      preparedBundle.kind !== 'application' ||
      preparedBundle.scopeId !== scopeId ||
      prepared.scopeId !== scopeId
    ) {
      return false
    }
    pendingRef.current = null
    setPending(null)
    return true
  }, [scopeId])
  const clearStarterBundle = useCallback(() => {
    setCommitted(currentBundle => currentBundle?.scopeId === scopeId ? null : currentBundle)
  }, [scopeId])
  const updateStarterBundle = useCallback((
    update: (currentSnapshot: ConversationStarterBundleSnapshot) => ConversationStarterBundleSnapshot
  ) => {
    if (!hasActiveStarter) return false
    // Active starter edits have one candidate slot. A rapid second action is
    // explicitly consumed while the first validates instead of mutating the
    // visible baseline or creating a competing completion.
    if (pendingRef.current?.scopeId === scopeId) return true
    if (committed?.scopeId !== scopeId) return true
    const next = update(committed.snapshot)
    const catalogKey = `${next.adapter ?? ''}\u0000${next.model ?? ''}`
    const candidate: PendingConversationStarterBundle = {
      configuredFields: committed.configuredFields,
      id: ++nextIdRef.current,
      kind: 'edit',
      scopeId,
      snapshot: {
        ...next,
        selectionValidation: {
          catalogKey,
          status: next.adapter == null ? 'not-required' : 'pending'
        }
      }
    }
    pendingRef.current = candidate
    setPending(candidate)
    return true
  }, [committed, hasActiveStarter, scopeId])

  return {
    commitPreparedStarterBundle,
    clearStarterBundle,
    configuredFields: committed?.scopeId === scopeId ? committed.configuredFields : undefined,
    discardPreparedStarterBundle,
    hasActiveStarter,
    invalidatePreparedStarterBundle,
    pendingStarterBundle: pending?.scopeId === scopeId ? pending : undefined,
    prepareStarterBundle,
    prepareStarterBundleUpdate,
    settleStarterSelectionValidation,
    updateStarterBundle,
    snapshot
  }
}
