/* eslint-disable max-lines -- Relay config snapshot cache keeps normalization and persistence together. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type {
  RelayConfigAssignment,
  RelayConfigPatch,
  RelayConfigSnapshot,
  RelayConfigSnapshotSecretEnvelope
} from './config-assignment.js'
import {
  filterRelayConfigPatch,
  normalizeRelayConfigSafeFields,
  normalizeRelayConfigStringList
} from './config-assignment.js'

const CONFIG_SNAPSHOT_PATH = ['.local', 'plugins', 'relay', 'config-snapshot.json'] as const

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

const normalizeText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const normalizeNullableText = (value: unknown) => (
  value == null ? null : normalizeText(value)
)

const normalizeProfile = (value: unknown) => {
  if (!isRecord(value)) return undefined
  const id = normalizeText(value.id)
  const email = normalizeText(value.email)
  const name = normalizeText(value.name)
  if (id == null && email == null && name == null) return undefined
  return {
    ...(email == null ? {} : { email }),
    ...(id == null ? {} : { id }),
    ...(name == null ? {} : { name })
  }
}

const normalizeConfigPatch = (
  value: unknown,
  allowedFields: RelayConfigAssignment['allowedFields']
) => (
  isRecord(value) ? filterRelayConfigPatch(value as RelayConfigPatch, allowedFields) : undefined
)

const normalizeSecretEnvelope = (value: unknown): RelayConfigSnapshotSecretEnvelope | undefined => {
  if (!isRecord(value)) return undefined
  const secretVersion = Number(value.secretVersion)
  if (
    value.algorithm !== 'aes-256-gcm' ||
    typeof value.ciphertext !== 'string' ||
    typeof value.expiresAt !== 'string' ||
    typeof value.iv !== 'string' ||
    typeof value.keyId !== 'string' ||
    typeof value.recipientDeviceId !== 'string' ||
    typeof value.ref !== 'string' ||
    typeof value.secretId !== 'string' ||
    !Number.isFinite(secretVersion) ||
    typeof value.tag !== 'string' ||
    value.version !== 1
  ) {
    return undefined
  }
  return {
    algorithm: 'aes-256-gcm',
    ciphertext: value.ciphertext,
    expiresAt: value.expiresAt,
    iv: value.iv,
    keyId: value.keyId,
    recipientDeviceId: value.recipientDeviceId,
    ref: value.ref,
    secretId: value.secretId,
    secretVersion: Math.max(1, Math.trunc(secretVersion)),
    tag: value.tag,
    version: 1
  }
}

const normalizeSecretEnvelopes = (value: unknown) => (
  Array.isArray(value)
    ? value.map(normalizeSecretEnvelope).filter((secret): secret is RelayConfigSnapshotSecretEnvelope => secret != null)
    : []
)

const normalizeProjectRule = (value: unknown) => {
  if (!isRecord(value)) return undefined
  const allow = normalizeRelayConfigStringList(value.allow)
  const deny = normalizeRelayConfigStringList(value.deny)
  if (allow == null && deny == null) return undefined
  return {
    ...(allow == null ? {} : { allow }),
    ...(deny == null ? {} : { deny })
  }
}

const normalizeAssignment = (value: unknown, fallbackId: string): RelayConfigAssignment | undefined => {
  if (!isRecord(value)) return undefined
  const id = normalizeText(value.id) ?? fallbackId
  if (id === '') return undefined
  const allowedFields = normalizeRelayConfigSafeFields(value.allowedFields)
  const configPatch = normalizeConfigPatch(value.configPatch ?? value.config, allowedFields)
  const secrets = normalizeSecretEnvelopes(value.secrets)

  const inlineRules = Array.isArray(value.rules)
    ? value.rules
      .map((rule, index) => isRecord(rule) ? normalizeAssignment(rule, `${id}-rule-${index + 1}`) : undefined)
      .filter((rule): rule is RelayConfigAssignment => rule != null)
    : undefined
  const ruleIds = [
    ...(normalizeRelayConfigStringList(value.ruleIds) ?? []),
    ...(Array.isArray(value.rules)
      ? value.rules.filter((rule): rule is string => typeof rule === 'string' && rule.trim() !== '')
      : [])
  ]
  return {
    id,
    ...(allowedFields.length === 0
      ? {}
      : { allowedFields }),
    ...(configPatch == null
      ? {}
      : { configPatch }),
    ...(value.enabled === false ? { enabled: false } : {}),
    ...(normalizeText(value.mustRefreshAfter) == null
      ? {}
      : { mustRefreshAfter: normalizeText(value.mustRefreshAfter) }),
    ...(normalizeProjectRule(value.project) == null ? {} : { project: normalizeProjectRule(value.project) }),
    ...(ruleIds.length === 0 ? {} : { ruleIds }),
    ...(inlineRules == null || inlineRules.length === 0 ? {} : { rules: inlineRules }),
    ...(secrets.length === 0 ? {} : { secrets }),
    ...(normalizeText(value.updatedAt) == null ? {} : { updatedAt: normalizeText(value.updatedAt) }),
    ...(normalizeText(value.version) == null ? {} : { version: normalizeText(value.version) })
  }
}

const normalizeAssignmentList = (value: unknown, fallbackPrefix: string) => (
  Array.isArray(value)
    ? value
      .map((item, index) => normalizeAssignment(item, `${fallbackPrefix}-${index + 1}`))
      .filter((assignment): assignment is RelayConfigAssignment => assignment != null)
    : []
)

export const normalizeRelayConfigSnapshot = (value: unknown): RelayConfigSnapshot | undefined => {
  if (!isRecord(value)) return undefined
  const version = normalizeText(value.version)
  if (version == null) return undefined

  return {
    version,
    ...(normalizeProfile(value.account) == null ? {} : { account: normalizeProfile(value.account) }),
    assignments: normalizeAssignmentList(value.assignments, 'assignment'),
    ...(normalizeText(value.hash) == null ? {} : { hash: normalizeText(value.hash) }),
    lastAppliedAt: normalizeNullableText(value.lastAppliedAt) ?? null,
    lastError: normalizeNullableText(value.lastError) ?? null,
    lastSyncedAt: normalizeNullableText(value.lastSyncedAt) ?? null,
    matchedProject: typeof value.matchedProject === 'boolean'
      ? value.matchedProject
      : normalizeNullableText(value.matchedProject) ?? null,
    rules: normalizeAssignmentList(value.rules, 'rule'),
    ...(normalizeText(value.sourceServerId) == null ? {} : { sourceServerId: normalizeText(value.sourceServerId) }),
    ...(normalizeProfile(value.team) == null ? {} : { team: normalizeProfile(value.team) }),
    ...(normalizeText(value.updatedAt) == null ? {} : { updatedAt: normalizeText(value.updatedAt) })
  }
}

export const createRelayConfigSnapshotStore = (projectHome: string) => {
  const storeDir = join(projectHome, '.local', 'plugins', 'relay')
  const snapshotPath = join(projectHome, ...CONFIG_SNAPSHOT_PATH)

  const writeSnapshot = async (snapshot: RelayConfigSnapshot) => {
    const normalizedSnapshot = normalizeRelayConfigSnapshot(snapshot) ?? snapshot
    await mkdir(storeDir, { recursive: true })
    await writeFile(
      snapshotPath,
      `${JSON.stringify(normalizedSnapshot, null, 2)}\n`,
      {
        encoding: 'utf8',
        mode: 0o600
      }
    )
  }

  const readSnapshot = async () => {
    const content = await readFile(snapshotPath, 'utf8').catch(() => undefined)
    if (content == null) return undefined
    return normalizeRelayConfigSnapshot(parseJson(content))
  }

  const writeSyncError = async (params: {
    lastError: string
    lastSyncedAt?: string | null
    sourceServerId?: string
  }) => {
    const previous = await readSnapshot()
    await writeSnapshot({
      version: previous?.version ?? 'error',
      assignments: previous?.assignments ?? [],
      rules: previous?.rules ?? [],
      ...(previous?.account == null ? {} : { account: previous.account }),
      ...(previous?.hash == null ? {} : { hash: previous.hash }),
      lastAppliedAt: previous?.lastAppliedAt ?? null,
      lastError: params.lastError,
      lastSyncedAt: params.lastSyncedAt ?? previous?.lastSyncedAt ?? null,
      matchedProject: previous?.matchedProject ?? null,
      sourceServerId: params.sourceServerId ?? previous?.sourceServerId,
      ...(previous?.team == null ? {} : { team: previous.team }),
      ...(previous?.updatedAt == null ? {} : { updatedAt: previous.updatedAt })
    })
  }

  return {
    readSnapshot,
    snapshotPath,
    writeSnapshot,
    writeSyncError
  }
}
