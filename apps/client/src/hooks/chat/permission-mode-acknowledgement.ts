/* eslint-disable max-lines -- acknowledgement lifecycle, storage, and one-shot transfer form one security boundary. */

import type { Session } from '@oneworks/core'

import type { PermissionMode } from './permission-mode'
import { isHighRiskPermissionMode } from './permission-mode'

const PERMISSION_MODE_ACKNOWLEDGEMENT_STORAGE_KEY = 'oneworks_chat_acknowledged_high_risk_permission_modes'

export interface PermissionModeAcknowledgementStorage {
  getItem: (key: string) => string | null
  removeItem: (key: string) => void
  setItem: (key: string, value: string) => void
}

export interface DraftPermissionModeLifecycle {
  readonly kind: 'draft-permission-mode-lifecycle'
}

export interface DraftPermissionModeIncarnation {
  readonly kind: 'draft-permission-mode-incarnation'
}

export interface PermissionModeDraftCreationToken {
  readonly kind: 'permission-mode-draft-creation'
}

export type PermissionModeSessionIncarnation = Pick<Session, 'createdAt' | 'id'>

export type PermissionModeAcknowledgementScope =
  | {
    kind: 'ephemeral'
    lifecycle: DraftPermissionModeLifecycle
  }
  | {
    kind: 'session'
    legacySessionId: string
    ownerIdentity: string
    storageScopeId: string
  }

const draftAcknowledgements = new WeakMap<DraftPermissionModeLifecycle, Set<PermissionMode>>()
const draftCreationLifecycles = new WeakMap<PermissionModeDraftCreationToken, DraftPermissionModeLifecycle>()
const draftLifecycleCreationTokens = new WeakMap<
  DraftPermissionModeLifecycle,
  Set<PermissionModeDraftCreationToken>
>()

interface BoundDraftPermissionModeLifecycle extends DraftPermissionModeLifecycle {
  readonly incarnation: DraftPermissionModeIncarnation
  readonly ownerIdentity?: string
}

const asBoundDraftPermissionModeLifecycle = (
  lifecycle: DraftPermissionModeLifecycle
) => lifecycle as BoundDraftPermissionModeLifecycle

export const createDraftPermissionModeIncarnation = (): DraftPermissionModeIncarnation => {
  return Object.freeze({ kind: 'draft-permission-mode-incarnation' })
}

export const createDraftPermissionModeLifecycle = ({
  incarnation = createDraftPermissionModeIncarnation(),
  ownerIdentity
}: {
  incarnation?: DraftPermissionModeIncarnation
  ownerIdentity?: string
} = {}): DraftPermissionModeLifecycle => {
  return Object.freeze({
    kind: 'draft-permission-mode-lifecycle',
    incarnation,
    ownerIdentity
  })
}

export const retireDraftPermissionModeLifecycle = (
  lifecycle: DraftPermissionModeLifecycle
) => {
  draftAcknowledgements.delete(lifecycle)
  const tokens = draftLifecycleCreationTokens.get(lifecycle)
  if (tokens != null) {
    for (const token of tokens) draftCreationLifecycles.delete(token)
    draftLifecycleCreationTokens.delete(lifecycle)
  }
}

const getAcknowledgementStorageKey = (scopeId: string) => {
  return `${PERMISSION_MODE_ACKNOWLEDGEMENT_STORAGE_KEY}:${encodeURIComponent(scopeId)}`
}

export const buildPermissionModeSessionAcknowledgementScope = ({
  ownerIdentity,
  session
}: {
  ownerIdentity?: string
  session?: PermissionModeSessionIncarnation
}): Extract<PermissionModeAcknowledgementScope, { kind: 'session' }> | undefined => {
  const normalizedOwner = ownerIdentity?.trim()
  if (
    normalizedOwner == null ||
    normalizedOwner === '' ||
    session == null ||
    session.id === '' ||
    !Number.isFinite(session.createdAt)
  ) {
    return undefined
  }

  return {
    kind: 'session',
    legacySessionId: session.id,
    ownerIdentity: normalizedOwner,
    storageScopeId: [
      'session:v2',
      encodeURIComponent(normalizedOwner),
      encodeURIComponent(session.id),
      String(session.createdAt)
    ].join(':')
  }
}

const parseAcknowledgedModes = (raw: string | null): Set<PermissionMode> => {
  if (raw == null) return new Set()
  const values: unknown = JSON.parse(raw)
  if (!Array.isArray(values)) return new Set()
  return new Set(values.filter(
    (value): value is Extract<PermissionMode, 'dontAsk' | 'bypassPermissions'> =>
      typeof value === 'string' && isHighRiskPermissionMode(value)
  ))
}

const removeLegacySessionAcknowledgement = (
  scope: Extract<PermissionModeAcknowledgementScope, { kind: 'session' }>,
  storage: PermissionModeAcknowledgementStorage
) => {
  try {
    storage.removeItem(getAcknowledgementStorageKey(`session:${scope.legacySessionId}`))
  } catch {}
}

const readSessionAcknowledgements = (
  scope: Extract<PermissionModeAcknowledgementScope, { kind: 'session' }>,
  storage: PermissionModeAcknowledgementStorage
) => {
  removeLegacySessionAcknowledgement(scope, storage)
  try {
    return parseAcknowledgedModes(storage.getItem(getAcknowledgementStorageKey(scope.storageScopeId)))
  } catch {
    return undefined
  }
}

export const getPermissionModeAcknowledgementStorage = (): PermissionModeAcknowledgementStorage | undefined => {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export const hasAcknowledgedHighRiskPermissionMode = (
  mode: PermissionMode,
  scope: PermissionModeAcknowledgementScope,
  storage: PermissionModeAcknowledgementStorage | undefined = getPermissionModeAcknowledgementStorage()
) => {
  if (!isHighRiskPermissionMode(mode)) return false
  if (scope.kind === 'ephemeral') {
    return draftAcknowledgements.get(scope.lifecycle)?.has(mode) === true
  }
  return storage != null && readSessionAcknowledgements(scope, storage)?.has(mode) === true
}

export const acknowledgeHighRiskPermissionMode = (
  mode: PermissionMode,
  scope: PermissionModeAcknowledgementScope,
  storage: PermissionModeAcknowledgementStorage | undefined = getPermissionModeAcknowledgementStorage()
) => {
  if (!isHighRiskPermissionMode(mode)) return false
  if (scope.kind === 'ephemeral') {
    const acknowledgedModes = draftAcknowledgements.get(scope.lifecycle) ?? new Set()
    acknowledgedModes.add(mode)
    draftAcknowledgements.set(scope.lifecycle, acknowledgedModes)
    return true
  }
  if (storage == null) return false

  const acknowledgedModes = readSessionAcknowledgements(scope, storage)
  if (acknowledgedModes == null) return false
  acknowledgedModes.add(mode)
  try {
    storage.setItem(
      getAcknowledgementStorageKey(scope.storageScopeId),
      JSON.stringify([...acknowledgedModes])
    )
    return true
  } catch {
    return false
  }
}

export const revokeHighRiskPermissionModeAcknowledgement = (
  mode: PermissionMode,
  scope: PermissionModeAcknowledgementScope,
  storage: PermissionModeAcknowledgementStorage | undefined = getPermissionModeAcknowledgementStorage()
) => {
  if (!isHighRiskPermissionMode(mode)) return false
  if (scope.kind === 'ephemeral') {
    const acknowledgedModes = draftAcknowledgements.get(scope.lifecycle)
    if (acknowledgedModes == null) return true
    acknowledgedModes.delete(mode)
    if (acknowledgedModes.size === 0) draftAcknowledgements.delete(scope.lifecycle)
    return true
  }
  if (storage == null) return false
  const acknowledgedModes = readSessionAcknowledgements(scope, storage)
  if (acknowledgedModes == null) return false
  acknowledgedModes.delete(mode)
  try {
    if (acknowledgedModes.size === 0) {
      storage.removeItem(getAcknowledgementStorageKey(scope.storageScopeId))
    } else {
      storage.setItem(
        getAcknowledgementStorageKey(scope.storageScopeId),
        JSON.stringify([...acknowledgedModes])
      )
    }
    return true
  } catch {
    return false
  }
}

export const issuePermissionModeDraftCreationToken = (
  lifecycle: DraftPermissionModeLifecycle
): PermissionModeDraftCreationToken => {
  const token = Object.freeze({ kind: 'permission-mode-draft-creation' as const })
  draftCreationLifecycles.set(token, lifecycle)
  const tokens = draftLifecycleCreationTokens.get(lifecycle) ?? new Set()
  tokens.add(token)
  draftLifecycleCreationTokens.set(lifecycle, tokens)
  return token
}

export const discardPermissionModeDraftCreationToken = (
  token: PermissionModeDraftCreationToken | undefined
) => {
  if (token == null) return
  const lifecycle = draftCreationLifecycles.get(token)
  draftCreationLifecycles.delete(token)
  if (lifecycle == null) return
  const tokens = draftLifecycleCreationTokens.get(lifecycle)
  tokens?.delete(token)
  if (tokens?.size === 0) draftLifecycleCreationTokens.delete(lifecycle)
}

export const consumePermissionModeDraftCreationAcknowledgements = (
  token: PermissionModeDraftCreationToken,
  targetScope: Extract<PermissionModeAcknowledgementScope, { kind: 'session' }>,
  storage: PermissionModeAcknowledgementStorage | undefined = getPermissionModeAcknowledgementStorage()
) => {
  const sourceLifecycle = draftCreationLifecycles.get(token)
  if (sourceLifecycle == null) return false

  draftCreationLifecycles.delete(token)
  const sourceTokens = draftLifecycleCreationTokens.get(sourceLifecycle)
  sourceTokens?.delete(token)
  if (sourceTokens?.size === 0) draftLifecycleCreationTokens.delete(sourceLifecycle)
  const sourceModes = new Set(draftAcknowledgements.get(sourceLifecycle) ?? [])
  // Retire source authorization before any target storage operation.
  draftAcknowledgements.delete(sourceLifecycle)
  const sourceOwnerIdentity = asBoundDraftPermissionModeLifecycle(sourceLifecycle).ownerIdentity
  if (
    storage == null ||
    sourceModes.size === 0 ||
    sourceOwnerIdentity == null ||
    sourceOwnerIdentity !== targetScope.ownerIdentity
  ) {
    return false
  }

  const targetModes = readSessionAcknowledgements(targetScope, storage)
  if (targetModes == null) return false
  for (const mode of sourceModes) targetModes.add(mode)
  try {
    storage.setItem(
      getAcknowledgementStorageKey(targetScope.storageScopeId),
      JSON.stringify([...targetModes])
    )
    return true
  } catch {
    try {
      storage.removeItem(getAcknowledgementStorageKey(targetScope.storageScopeId))
    } catch {}
    return false
  }
}
