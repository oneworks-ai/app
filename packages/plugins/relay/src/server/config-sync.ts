/* eslint-disable max-lines -- Relay config sync coordinates snapshots, global config, and document sync in one loop. */
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import { withCanonicalConfigWriteLock } from '@oneworks/config/write-lock'
import { DEFAULT_GLOBAL_OO_CONFIG_FILE, resolveGlobalOneWorksDir } from '@oneworks/utils/ai-path'

import { filterRelayConfigPatch, mergeRelayConfigPatches } from '../shared/config-assignment-patch.js'
import type { RelayConfigPatch, RelayConfigSafeField } from '../shared/config-assignment-types.js'
import type { RelayConfigSnapshot } from '../shared/config-assignment.js'
import {
  createRelayConfigSnapshotStore,
  normalizeRelayConfigSnapshot,
  writeRelayConfigSnapshotCaches,
  writeRelayConfigSnapshotSyncErrorCaches
} from '../shared/config-cache.js'
import type { ResolvedRelayServer } from './options.js'
import { readRelayPersonalDocumentSyncPreferences } from './personal-document-sync-preferences.js'
import type { RelayPersonalDocumentSyncPreferences } from './personal-document-sync-preferences.js'
import {
  createPersonalDocumentSyncStatus,
  syncRelayPersonalDocuments,
  syncRelayProjectRuleDocuments
} from './personal-document-sync.js'
import type { RelayPersonalDocumentSyncStatus, RelayPluginContext, RelayStoredServer } from './types.js'
import { isRecord, toString } from './utils.js'

export interface RelayConfigSyncResult {
  ok: boolean
  lastError: string | null
  lastSyncedAt: string | null
  personalDocuments?: RelayPersonalDocumentSyncStatus
  personalDiagnosticReporting?: RelayPersonalDiagnosticReportingSyncStatus
  personalGlobalConfig?: RelayPersonalGlobalConfigSyncStatus
  projectRuleDocuments?: Record<string, RelayPersonalDocumentSyncStatus>
  personalModelUsageReporting?: RelayPersonalModelUsageReportingSyncStatus
  snapshot?: RelayConfigSnapshot
  snapshotPath: string
}

interface RelayPersonalConfigSnapshotPayload {
  allowedFields?: RelayConfigSafeField[]
  configPatch?: RelayConfigPatch
  hash?: string
  updatedAt?: string
  version?: string
}

interface RelayPersonalGlobalConfigSyncStatus {
  appliedRemote: boolean
  hash?: string
  lastError: string | null
  pushedLocal: boolean
  updatedAt?: string
}

interface RelayPersonalModelUsageReportingSyncStatus {
  appliedRemote: boolean
  enabled: boolean
  lastError: string | null
  pushedLocal: boolean
  teams?: Record<string, ModelUsageReportingTeamPreference>
  updatedAt?: string
}

interface RelayPersonalDiagnosticReportingSyncStatus {
  appliedRemote: boolean
  enabled: boolean
  lastError: string | null
  pushedLocal: boolean
  updatedAt?: string
}

interface LocalPersonalGlobalConfigPatch {
  configPath: string
  configPatch?: RelayConfigPatch
}

interface ModelUsageReportingPreference {
  enabled: boolean
  explicit: boolean
  updatedAt?: string
}

type DiagnosticReportingPreference = ModelUsageReportingPreference

interface ModelUsageReportingTeamPreference {
  enabled: boolean
  mode: 'required' | 'optional'
  name: string
  slug: string
  teamId: string
  updatedAt?: string
  userCanControl: boolean
}

const PERSONAL_GLOBAL_CONFIG_FIELDS: RelayConfigSafeField[] = ['adapters']

const PROJECT_RULE_DOCUMENT_PREFERENCES: RelayPersonalDocumentSyncPreferences = {
  agents: true,
  ooAgents: false,
  ooRules: false
}

const stableJsonStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(',')}]`
  }
  if (!isRecord(value)) {
    return JSON.stringify(value)
  }

  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`).join(',')}}`
}

const hashLocalPersonalConfigPatch = (patch: RelayConfigPatch | undefined) => (
  patch == null ? undefined : `sha256:${createHash('sha256').update(stableJsonStringify(patch)).digest('hex')}`
)

const hasPublishablePersonalGlobalConfig = (patch: RelayConfigPatch | undefined) => {
  if (!isRecord(patch?.adapters)) return false
  return Object.values(patch.adapters).some((adapter) => {
    if (!isRecord(adapter)) return false
    if (isRecord(adapter.accountTombstones) && Object.keys(adapter.accountTombstones).length > 0) return true
    if (!isRecord(adapter.accounts)) return false
    return Object.values(adapter.accounts).some((account) => {
      if (!isRecord(account)) return false
      if (
        isRecord(account.state) && toString(account.state.encoding) === 'base64' && toString(account.state.token) !== ''
      ) {
        return true
      }
      if (!isRecord(account.auth)) return false
      const storage = toString(account.auth.storage) || 'inline'
      if (storage === 'inline') {
        return toString(account.auth.encoding) === 'base64' && toString(account.auth.token) !== ''
      }
      if (storage === 'secret') return toString(account.auth.ref) !== ''
      return storage === 'device' && toString(account.auth.type) !== ''
    })
  })
}

const readResponseJson = async (response: Response) => {
  const body = await response.json().catch(() => ({}))
  return isRecord(body) ? body : {}
}

const readSnapshotPayload = (body: Record<string, unknown>) => (
  isRecord(body.configSnapshot)
    ? body.configSnapshot
    : isRecord(body.snapshot)
    ? body.snapshot
    : body
)

const resolveSyncErrorMessage = (error: unknown) => (
  error instanceof Error ? error.message : String(error)
)

const resolveGlobalConfigPath = () =>
  resolve(
    resolveGlobalOneWorksDir(process.env),
    DEFAULT_GLOBAL_OO_CONFIG_FILE
  )

const normalizeIsoDate = (value: unknown) => {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined
}

const readJsonFile = async (path: string): Promise<Record<string, unknown>> => {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'))
    return isRecord(value) ? value : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

const readLocalModelUsageReportingPreference = async (): Promise<{
  configPath: string
  preference: ModelUsageReportingPreference
}> => {
  const configPath = resolveGlobalConfigPath()
  const config = await readJsonFile(configPath)
  const diagnostics = isRecord(config.diagnostics) ? config.diagnostics : {}
  const rawPreference = diagnostics.modelUsageReporting
  const fileStat = await stat(configPath).catch(() => undefined)
  if (typeof rawPreference === 'boolean') {
    return {
      configPath,
      preference: {
        enabled: rawPreference,
        explicit: true,
        updatedAt: fileStat?.mtime.toISOString()
      }
    }
  }
  if (isRecord(rawPreference) && typeof rawPreference.enabled === 'boolean') {
    return {
      configPath,
      preference: {
        enabled: rawPreference.enabled,
        explicit: true,
        updatedAt: normalizeIsoDate(rawPreference.updatedAt) ?? fileStat?.mtime.toISOString()
      }
    }
  }
  return {
    configPath,
    preference: { enabled: true, explicit: false }
  }
}

const readLocalDiagnosticReportingPreference = async (): Promise<{
  configPath: string
  preference: DiagnosticReportingPreference
}> => {
  const configPath = resolveGlobalConfigPath()
  const config = await readJsonFile(configPath)
  const diagnostics = isRecord(config.diagnostics) ? config.diagnostics : {}
  const rawPreference = diagnostics.reporting
  const fileStat = await stat(configPath).catch(() => undefined)
  if (typeof rawPreference === 'boolean') {
    return {
      configPath,
      preference: { enabled: rawPreference, explicit: true, updatedAt: fileStat?.mtime.toISOString() }
    }
  }
  if (isRecord(rawPreference) && typeof rawPreference.enabled === 'boolean') {
    return {
      configPath,
      preference: {
        enabled: rawPreference.enabled,
        explicit: true,
        updatedAt: normalizeIsoDate(rawPreference.updatedAt) ?? fileStat?.mtime.toISOString()
      }
    }
  }
  return { configPath, preference: { enabled: true, explicit: false } }
}

const writeLocalDiagnosticReportingPreference = async (
  configPath: string,
  preference: Pick<DiagnosticReportingPreference, 'enabled' | 'updatedAt'>
) => {
  const config = await readJsonFile(configPath)
  const diagnostics = isRecord(config.diagnostics) ? config.diagnostics : {}
  const rawPreference = isRecord(diagnostics.reporting) ? diagnostics.reporting : {}
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(
    configPath,
    `${
      JSON.stringify(
        {
          ...config,
          diagnostics: {
            ...diagnostics,
            reporting: {
              ...rawPreference,
              enabled: preference.enabled,
              ...(preference.updatedAt == null ? {} : { updatedAt: preference.updatedAt })
            }
          }
        },
        null,
        2
      )
    }\n`,
    { encoding: 'utf8', mode: 0o600 }
  )
}

const writeLocalModelUsageReportingPreference = async (
  configPath: string,
  preference: Pick<ModelUsageReportingPreference, 'enabled' | 'updatedAt'>
) => {
  const config = await readJsonFile(configPath)
  const diagnostics = isRecord(config.diagnostics) ? config.diagnostics : {}
  const rawPreference = isRecord(diagnostics.modelUsageReporting) ? diagnostics.modelUsageReporting : {}
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(
    configPath,
    `${
      JSON.stringify(
        {
          ...config,
          diagnostics: {
            ...diagnostics,
            modelUsageReporting: {
              ...rawPreference,
              enabled: preference.enabled,
              ...(preference.updatedAt == null ? {} : { updatedAt: preference.updatedAt })
            }
          }
        },
        null,
        2
      )
    }\n`,
    {
      encoding: 'utf8',
      mode: 0o600
    }
  )
}

const readLocalModelUsageReportingTeams = async () => {
  const configPath = resolveGlobalConfigPath()
  const config = await readJsonFile(configPath)
  const diagnostics = isRecord(config.diagnostics) ? config.diagnostics : {}
  const preference = isRecord(diagnostics.modelUsageReporting) ? diagnostics.modelUsageReporting : {}
  const teams = isRecord(preference.teams) ? preference.teams : {}
  return { configPath, preference, teams }
}

const writeLocalModelUsageReportingTeams = async (
  configPath: string,
  teams: Record<string, ModelUsageReportingTeamPreference>
) => {
  const config = await readJsonFile(configPath)
  const diagnostics = isRecord(config.diagnostics) ? config.diagnostics : {}
  const preference = isRecord(diagnostics.modelUsageReporting) ? diagnostics.modelUsageReporting : {}
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(
    configPath,
    `${
      JSON.stringify(
        {
          ...config,
          diagnostics: {
            ...diagnostics,
            modelUsageReporting: {
              ...preference,
              teams
            }
          }
        },
        null,
        2
      )
    }\n`,
    {
      encoding: 'utf8',
      mode: 0o600
    }
  )
}

const normalizeRemoteTeamPreference = (value: unknown): ModelUsageReportingTeamPreference | undefined => {
  if (!isRecord(value)) return undefined
  const teamId = toString(value.teamId)
  if (teamId === '') return undefined
  const userCanControl = value.userCanControl === true && value.mode === 'optional'
  return {
    enabled: userCanControl ? value.enabled !== false : true,
    mode: value.mode === 'optional' ? 'optional' : 'required',
    name: toString(value.name) || teamId,
    slug: toString(value.slug) || teamId,
    teamId,
    updatedAt: normalizeIsoDate(value.updatedAt),
    userCanControl
  }
}

export const applyRelayModelUsageReportingSettings = async (value: unknown) => {
  if (!isRecord(value) || !isRecord(value.personal) || typeof value.personal.enabled !== 'boolean') {
    throw new Error('Relay model usage settings payload is invalid.')
  }
  const personalUpdatedAt = normalizeIsoDate(value.personal.updatedAt) ?? new Date().toISOString()
  const { configPath } = await readLocalModelUsageReportingPreference()
  await writeLocalModelUsageReportingPreference(configPath, {
    enabled: value.personal.enabled,
    updatedAt: personalUpdatedAt
  })
  if (!Array.isArray(value.teams)) return
  const teams = Object.fromEntries(
    value.teams
      .map(normalizeRemoteTeamPreference)
      .filter((team): team is ModelUsageReportingTeamPreference => team != null)
      .map(team => [team.teamId, team])
  )
  await writeLocalModelUsageReportingTeams(configPath, teams)
}

export const applyRelayDataReportingSettings = async (value: unknown) => {
  if (!isRecord(value) || !isRecord(value.diagnosticReporting) || !isRecord(value.modelUsageReporting)) {
    throw new TypeError('Relay data reporting settings payload is invalid.')
  }
  if (typeof value.diagnosticReporting.enabled !== 'boolean') {
    throw new TypeError('Relay diagnostic reporting settings payload is invalid.')
  }
  const { configPath } = await readLocalDiagnosticReportingPreference()
  await writeLocalDiagnosticReportingPreference(configPath, {
    enabled: value.diagnosticReporting.enabled,
    updatedAt: normalizeIsoDate(value.diagnosticReporting.updatedAt) ?? new Date().toISOString()
  })
  await applyRelayModelUsageReportingSettings(value.modelUsageReporting)
}

const readRemoteModelUsageReportingTeams = async (params: {
  deviceToken: string
  server: ResolvedRelayServer
}) => {
  const response = await fetch(new URL('/api/profile/data-reporting-settings', params.server.remoteBaseUrl), {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${params.deviceToken}`
    }
  })
  const body = await readResponseJson(response)
  if (!response.ok) {
    throw new Error(toString(body.error) || `Relay team usage preference sync failed with ${response.status}.`)
  }
  const modelUsageReporting = isRecord(body.modelUsageReporting) ? body.modelUsageReporting : {}
  return (Array.isArray(modelUsageReporting.teams) ? modelUsageReporting.teams : [])
    .map(normalizeRemoteTeamPreference)
    .filter((team): team is ModelUsageReportingTeamPreference => team != null)
}

const updateRemoteTeamModelUsageReportingPreference = async (params: {
  deviceToken: string
  enabled: boolean
  server: ResolvedRelayServer
  teamId: string
}) => {
  const response = await fetch(new URL('/api/profile/data-reporting-settings', params.server.remoteBaseUrl), {
    body: JSON.stringify({ teamEnabled: params.enabled, teamId: params.teamId }),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${params.deviceToken}`,
      'content-type': 'application/json'
    },
    method: 'PATCH'
  })
  const body = await readResponseJson(response)
  if (!response.ok) {
    throw new Error(toString(body.error) || `Relay team usage preference update failed with ${response.status}.`)
  }
  const modelUsageReporting = isRecord(body.modelUsageReporting) ? body.modelUsageReporting : {}
  return (Array.isArray(modelUsageReporting.teams) ? modelUsageReporting.teams : [])
    .map(normalizeRemoteTeamPreference)
    .find(team => team?.teamId === params.teamId)
}

const syncRelayTeamModelUsageReporting = async (params: {
  deviceToken: string
  server: ResolvedRelayServer
}) => {
  const [local, remoteTeams] = await Promise.all([
    readLocalModelUsageReportingTeams(),
    readRemoteModelUsageReportingTeams(params)
  ])
  const nextTeams: Record<string, ModelUsageReportingTeamPreference> = {}
  let pushedLocal = false
  for (const remoteTeam of remoteTeams) {
    const rawLocalTeam = local.teams[remoteTeam.teamId]
    const localTeam: Record<string, unknown> | undefined = isRecord(rawLocalTeam)
      ? rawLocalTeam
      : undefined
    const localEnabled = typeof localTeam?.enabled === 'boolean' ? localTeam.enabled : undefined
    const localUpdatedAt = Date.parse(normalizeIsoDate(localTeam?.updatedAt) ?? '')
    const remoteUpdatedAt = Date.parse(remoteTeam.updatedAt ?? '')
    if (
      remoteTeam.userCanControl &&
      localEnabled != null &&
      localEnabled !== remoteTeam.enabled &&
      Number.isFinite(localUpdatedAt) &&
      (!Number.isFinite(remoteUpdatedAt) || localUpdatedAt > remoteUpdatedAt)
    ) {
      const updated = await updateRemoteTeamModelUsageReportingPreference({
        deviceToken: params.deviceToken,
        enabled: localEnabled,
        server: params.server,
        teamId: remoteTeam.teamId
      })
      nextTeams[remoteTeam.teamId] = updated ?? { ...remoteTeam, enabled: localEnabled }
      pushedLocal = true
    } else {
      nextTeams[remoteTeam.teamId] = remoteTeam
    }
  }
  if (stableJsonStringify(local.teams) !== stableJsonStringify(nextTeams)) {
    await writeLocalModelUsageReportingTeams(local.configPath, nextTeams)
  }
  return { pushedLocal, teams: nextTeams }
}

const readRemoteModelUsageReportingPreference = async (params: {
  deviceToken: string
  server: ResolvedRelayServer
}): Promise<ModelUsageReportingPreference> => {
  const response = await fetch(new URL('/api/profile/data-reporting-settings', params.server.remoteBaseUrl), {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${params.deviceToken}`
    }
  })
  const body = await readResponseJson(response)
  if (!response.ok) {
    throw new Error(toString(body.error) || `Relay model usage preference sync failed with ${response.status}.`)
  }
  const modelUsageReporting = isRecord(body.modelUsageReporting) ? body.modelUsageReporting : {}
  const personal = isRecord(modelUsageReporting.personal) ? modelUsageReporting.personal : {}
  return {
    enabled: personal.enabled !== false,
    explicit: true,
    updatedAt: normalizeIsoDate(personal.updatedAt)
  }
}

const updateRemoteModelUsageReportingPreference = async (params: {
  deviceToken: string
  enabled: boolean
  server: ResolvedRelayServer
}) => {
  const response = await fetch(new URL('/api/profile/data-reporting-settings', params.server.remoteBaseUrl), {
    body: JSON.stringify({ personalEnabled: params.enabled }),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${params.deviceToken}`,
      'content-type': 'application/json'
    },
    method: 'PATCH'
  })
  const body = await readResponseJson(response)
  if (!response.ok) {
    throw new Error(toString(body.error) || `Relay model usage preference update failed with ${response.status}.`)
  }
  const modelUsageReporting = isRecord(body.modelUsageReporting) ? body.modelUsageReporting : {}
  const personal = isRecord(modelUsageReporting.personal) ? modelUsageReporting.personal : {}
  return {
    enabled: personal.enabled !== false,
    updatedAt: normalizeIsoDate(personal.updatedAt)
  }
}

const syncRelayPersonalModelUsageReporting = async (params: {
  deviceToken: string
  server: ResolvedRelayServer
}): Promise<RelayPersonalModelUsageReportingSyncStatus> => {
  const [local, remote] = await Promise.all([
    readLocalModelUsageReportingPreference(),
    readRemoteModelUsageReportingPreference(params)
  ])
  if (!local.preference.explicit) {
    if (!remote.enabled) {
      await writeLocalModelUsageReportingPreference(local.configPath, remote)
    }
    return {
      appliedRemote: !remote.enabled,
      enabled: remote.enabled,
      lastError: null,
      pushedLocal: false,
      updatedAt: remote.updatedAt
    }
  }
  if (local.preference.enabled === remote.enabled) {
    return {
      appliedRemote: false,
      enabled: remote.enabled,
      lastError: null,
      pushedLocal: false,
      updatedAt: remote.updatedAt ?? local.preference.updatedAt
    }
  }

  const localUpdatedAt = Date.parse(local.preference.updatedAt ?? '')
  const remoteUpdatedAt = Date.parse(remote.updatedAt ?? '')
  if (Number.isFinite(localUpdatedAt) && (!Number.isFinite(remoteUpdatedAt) || localUpdatedAt > remoteUpdatedAt)) {
    const updated = await updateRemoteModelUsageReportingPreference({
      deviceToken: params.deviceToken,
      enabled: local.preference.enabled,
      server: params.server
    })
    await writeLocalModelUsageReportingPreference(local.configPath, updated)
    return {
      appliedRemote: false,
      enabled: updated.enabled,
      lastError: null,
      pushedLocal: true,
      updatedAt: updated.updatedAt
    }
  }

  await writeLocalModelUsageReportingPreference(local.configPath, remote)
  return {
    appliedRemote: true,
    enabled: remote.enabled,
    lastError: null,
    pushedLocal: false,
    updatedAt: remote.updatedAt
  }
}

const readRemoteDiagnosticReportingPreference = async (params: {
  deviceToken: string
  server: ResolvedRelayServer
}): Promise<DiagnosticReportingPreference> => {
  const response = await fetch(new URL('/api/profile/data-reporting-settings', params.server.remoteBaseUrl), {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${params.deviceToken}`
    }
  })
  const body = await readResponseJson(response)
  if (!response.ok) {
    throw new Error(
      toString(body.error) || `Relay diagnostic reporting preference sync failed with ${response.status}.`
    )
  }
  const diagnostic = isRecord(body.diagnosticReporting) ? body.diagnosticReporting : {}
  return {
    enabled: diagnostic.enabled !== false,
    explicit: true,
    updatedAt: normalizeIsoDate(diagnostic.updatedAt)
  }
}

const updateRemoteDiagnosticReportingPreference = async (params: {
  deviceToken: string
  enabled: boolean
  server: ResolvedRelayServer
}) => {
  const response = await fetch(new URL('/api/profile/data-reporting-settings', params.server.remoteBaseUrl), {
    body: JSON.stringify({ diagnosticEnabled: params.enabled }),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${params.deviceToken}`,
      'content-type': 'application/json'
    },
    method: 'PATCH'
  })
  const body = await readResponseJson(response)
  if (!response.ok) {
    throw new Error(
      toString(body.error) || `Relay diagnostic reporting preference update failed with ${response.status}.`
    )
  }
  const diagnostic = isRecord(body.diagnosticReporting) ? body.diagnosticReporting : {}
  return {
    enabled: diagnostic.enabled !== false,
    updatedAt: normalizeIsoDate(diagnostic.updatedAt)
  }
}

const syncRelayPersonalDiagnosticReporting = async (params: {
  deviceToken: string
  server: ResolvedRelayServer
}): Promise<RelayPersonalDiagnosticReportingSyncStatus> => {
  const [local, remote] = await Promise.all([
    readLocalDiagnosticReportingPreference(),
    readRemoteDiagnosticReportingPreference(params)
  ])
  if (!local.preference.explicit) {
    await writeLocalDiagnosticReportingPreference(local.configPath, remote)
    return {
      appliedRemote: true,
      enabled: remote.enabled,
      lastError: null,
      pushedLocal: false,
      updatedAt: remote.updatedAt
    }
  }
  if (local.preference.enabled === remote.enabled) {
    return {
      appliedRemote: false,
      enabled: remote.enabled,
      lastError: null,
      pushedLocal: false,
      updatedAt: remote.updatedAt ?? local.preference.updatedAt
    }
  }
  const localUpdatedAt = Date.parse(local.preference.updatedAt ?? '')
  const remoteUpdatedAt = Date.parse(remote.updatedAt ?? '')
  if (Number.isFinite(localUpdatedAt) && (!Number.isFinite(remoteUpdatedAt) || localUpdatedAt > remoteUpdatedAt)) {
    const updated = await updateRemoteDiagnosticReportingPreference({
      deviceToken: params.deviceToken,
      enabled: local.preference.enabled,
      server: params.server
    })
    await writeLocalDiagnosticReportingPreference(local.configPath, updated)
    return {
      appliedRemote: false,
      enabled: updated.enabled,
      lastError: null,
      pushedLocal: true,
      updatedAt: updated.updatedAt
    }
  }
  await writeLocalDiagnosticReportingPreference(local.configPath, remote)
  return {
    appliedRemote: true,
    enabled: remote.enabled,
    lastError: null,
    pushedLocal: false,
    updatedAt: remote.updatedAt
  }
}

const readLocalPersonalGlobalConfigPatch = async (): Promise<LocalPersonalGlobalConfigPatch> => {
  const configPath = resolveGlobalConfigPath()
  const config = await readJsonFile(configPath)
  const configPatch = filterRelayConfigPatch(config as RelayConfigPatch, PERSONAL_GLOBAL_CONFIG_FIELDS)
  return {
    configPath,
    ...(configPatch == null ? {} : { configPatch })
  }
}

const writeLocalPersonalGlobalConfigPatch = async (
  configPath: string,
  configPatch: RelayConfigPatch
) => {
  await withCanonicalConfigWriteLock(configPath, async (targetPath) => {
    const config = await readJsonFile(targetPath)
    const merged = mergeRelayConfigPatches(config as RelayConfigPatch, configPatch) ?? configPatch
    const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
    await mkdir(dirname(targetPath), { recursive: true })
    try {
      await writeFile(tempPath, `${JSON.stringify({ ...config, ...merged }, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600
      })
      await rename(tempPath, targetPath)
      await chmod(targetPath, 0o600)
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined)
    }
  })
}

const readPersonalConfigPayload = (body: Record<string, unknown>): RelayPersonalConfigSnapshotPayload | undefined => {
  const payload = isRecord(body.personalConfigSnapshot)
    ? body.personalConfigSnapshot
    : isRecord(body.personalConfig)
    ? body.personalConfig
    : undefined
  if (payload == null) return undefined
  return {
    allowedFields: Array.isArray(payload.allowedFields)
      ? payload.allowedFields.filter((field): field is RelayConfigSafeField => (
        typeof field === 'string' && PERSONAL_GLOBAL_CONFIG_FIELDS.includes(field as RelayConfigSafeField)
      ))
      : undefined,
    configPatch: filterRelayConfigPatch(
      payload.configPatch as RelayConfigPatch | undefined,
      PERSONAL_GLOBAL_CONFIG_FIELDS
    ),
    hash: toString(payload.hash) || undefined,
    updatedAt: toString(payload.updatedAt) || undefined,
    version: toString(payload.version) || undefined
  }
}

export const syncRelayPersonalGlobalConfig = async (params: {
  deviceToken: string
  server: ResolvedRelayServer
}): Promise<RelayPersonalGlobalConfigSyncStatus> => {
  const local = await readLocalPersonalGlobalConfigPatch()
  const response = await fetch(new URL('/api/relay/config/global', params.server.remoteBaseUrl), {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${params.deviceToken}`
    }
  })
  const body = await readResponseJson(response)
  if (!response.ok) {
    throw new Error(toString(body.error) || `Relay personal config sync failed with ${response.status}.`)
  }

  const remote = readPersonalConfigPayload(body)
  if (remote?.configPatch == null && local.configPatch == null) {
    return { appliedRemote: false, lastError: null, pushedLocal: false }
  }

  let canonical = remote
  let pushedLocal = false
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const mergedPatch = mergeRelayConfigPatches(canonical?.configPatch, local.configPatch, {
      credentialTieWinner: 'left'
    }) ?? local.configPatch ?? canonical?.configPatch
    const mergedHash = hashLocalPersonalConfigPatch(mergedPatch)
    const canonicalPatchHash = hashLocalPersonalConfigPatch(canonical?.configPatch)
    if (
      mergedPatch == null ||
      mergedHash === canonicalPatchHash ||
      !hasPublishablePersonalGlobalConfig(mergedPatch)
    ) {
      break
    }

    const updated = await putRelayPersonalGlobalConfig({
      baseHash: canonical?.hash,
      configPatch: mergedPatch,
      deviceToken: params.deviceToken,
      server: params.server
    })
    if (!updated.conflict) {
      if (updated.snapshot?.configPatch == null) {
        throw new Error('Relay personal config update did not return a canonical snapshot.')
      }
      canonical = updated.snapshot
      pushedLocal = true
      break
    }
    if (attempt === 1) {
      throw new Error('Relay personal config changed again while retrying the update.')
    }
    if (updated.snapshot == null) {
      throw new Error('Relay personal config conflict did not return the canonical snapshot.')
    }
    canonical = updated.snapshot
  }

  const canonicalPatch = canonical?.configPatch
  const appliedRemote = canonicalPatch != null && (
    pushedLocal ||
    hashLocalPersonalConfigPatch(local.configPatch) !== hashLocalPersonalConfigPatch(canonicalPatch)
  )
  if (canonicalPatch != null && appliedRemote) {
    await writeLocalPersonalGlobalConfigPatch(local.configPath, canonicalPatch)
  }
  return {
    appliedRemote,
    hash: canonical?.hash,
    lastError: null,
    pushedLocal,
    updatedAt: canonical?.updatedAt
  }
}

const putRelayPersonalGlobalConfig = async (params: {
  baseHash?: string
  configPatch: RelayConfigPatch
  deviceToken: string
  server: ResolvedRelayServer
}): Promise<{
  conflict: boolean
  snapshot?: RelayPersonalConfigSnapshotPayload
}> => {
  const response = await fetch(new URL('/api/relay/config/global', params.server.remoteBaseUrl), {
    body: JSON.stringify({
      allowedFields: PERSONAL_GLOBAL_CONFIG_FIELDS,
      ...(params.baseHash == null ? {} : { baseHash: params.baseHash }),
      configPatch: params.configPatch
    }),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${params.deviceToken}`,
      'content-type': 'application/json'
    },
    method: 'PUT'
  })
  const body = await readResponseJson(response)
  if (response.status === 409) {
    return {
      conflict: true,
      snapshot: readPersonalConfigPayload(body)
    }
  }
  if (!response.ok) {
    throw new Error(toString(body.error) || `Relay personal config update failed with ${response.status}.`)
  }
  return {
    conflict: false,
    snapshot: readPersonalConfigPayload(body)
  }
}

export const syncRelayConfigSnapshot = async (params: {
  ctx: RelayPluginContext
  server: ResolvedRelayServer
  storedServer: RelayStoredServer | undefined
}): Promise<RelayConfigSyncResult> => {
  const snapshotStore = createRelayConfigSnapshotStore(params.ctx.projectHome)
  const deviceToken = params.storedServer?.deviceToken ?? ''
  const now = new Date().toISOString()

  try {
    if (deviceToken === '') {
      throw new Error('No relay device token is available for config sync.')
    }

    let personalGlobalConfig: RelayPersonalGlobalConfigSyncStatus | undefined
    let personalDiagnosticReporting: RelayPersonalDiagnosticReportingSyncStatus | undefined
    let personalModelUsageReporting: RelayPersonalModelUsageReportingSyncStatus | undefined
    let personalDocuments: RelayPersonalDocumentSyncStatus | undefined
    try {
      personalGlobalConfig = await syncRelayPersonalGlobalConfig({
        deviceToken,
        server: params.server
      })
    } catch (error) {
      const message = resolveSyncErrorMessage(error)
      params.ctx.logger.warn(
        { err: error, scope: params.ctx.scope, serverId: params.server.id },
        '[relay] personal global config sync failed'
      )
      personalGlobalConfig = {
        appliedRemote: false,
        lastError: message,
        pushedLocal: false
      }
    }
    try {
      personalDiagnosticReporting = await syncRelayPersonalDiagnosticReporting({
        deviceToken,
        server: params.server
      })
    } catch (error) {
      const message = resolveSyncErrorMessage(error)
      params.ctx.logger.warn(
        { err: error, scope: params.ctx.scope, serverId: params.server.id },
        '[relay] personal diagnostic reporting preference sync failed'
      )
      personalDiagnosticReporting = {
        appliedRemote: false,
        enabled: true,
        lastError: message,
        pushedLocal: false
      }
    }
    try {
      const personalPreference = await syncRelayPersonalModelUsageReporting({
        deviceToken,
        server: params.server
      })
      const teamPreferences = await syncRelayTeamModelUsageReporting({
        deviceToken,
        server: params.server
      })
      personalModelUsageReporting = {
        ...personalPreference,
        pushedLocal: personalPreference.pushedLocal || teamPreferences.pushedLocal,
        teams: teamPreferences.teams
      }
    } catch (error) {
      const message = resolveSyncErrorMessage(error)
      params.ctx.logger.warn(
        { err: error, scope: params.ctx.scope, serverId: params.server.id },
        '[relay] personal model usage preference sync failed'
      )
      personalModelUsageReporting = {
        appliedRemote: false,
        enabled: true,
        lastError: message,
        pushedLocal: false
      }
    }
    try {
      personalDocuments = await syncRelayPersonalDocuments({
        accountId: params.storedServer?.account?.id,
        deviceToken,
        server: params.server,
        storedServer: params.storedServer
      })
    } catch (error) {
      const message = resolveSyncErrorMessage(error)
      params.ctx.logger.warn(
        { err: error, scope: params.ctx.scope, serverId: params.server.id },
        '[relay] personal document sync failed'
      )
      personalDocuments = createPersonalDocumentSyncStatus(
        readRelayPersonalDocumentSyncPreferences(params.storedServer),
        { lastError: message }
      )
    }

    const response = await fetch(new URL('/api/relay/config-snapshot', params.server.remoteBaseUrl), {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${deviceToken}`
      }
    })
    const body = await readResponseJson(response)
    if (!response.ok) {
      throw new Error(toString(body.error) || `Relay config snapshot failed with ${response.status}.`)
    }

    const snapshot = normalizeRelayConfigSnapshot({
      ...readSnapshotPayload(body),
      lastError: null,
      lastSyncedAt: now,
      sourceServerId: toString(readSnapshotPayload(body).sourceServerId) || params.server.id
    })
    if (snapshot == null) {
      throw new Error('Relay config snapshot payload is invalid.')
    }

    const projectRuleDocuments: Record<string, RelayPersonalDocumentSyncStatus> = {}
    for (const assignment of snapshot.assignments ?? []) {
      const teamId = assignment.provenance?.teamId?.trim()
      if (assignment.id === '' || teamId == null || teamId === '') continue
      try {
        projectRuleDocuments[assignment.id] = await syncRelayProjectRuleDocuments({
          assignmentId: assignment.id,
          preferences: PROJECT_RULE_DOCUMENT_PREFERENCES,
          server: params.server,
          sessionToken: params.storedServer?.sessionToken ?? '',
          teamId
        })
      } catch (error) {
        const message = resolveSyncErrorMessage(error)
        params.ctx.logger.warn(
          {
            assignmentId: assignment.id,
            err: error,
            scope: params.ctx.scope,
            serverId: params.server.id,
            teamId
          },
          '[relay] project rule document sync failed'
        )
        projectRuleDocuments[assignment.id] = createPersonalDocumentSyncStatus(
          PROJECT_RULE_DOCUMENT_PREFERENCES,
          { lastError: message }
        )
      }
    }

    const snapshotPaths = await writeRelayConfigSnapshotCaches({
      projectHome: params.ctx.projectHome,
      snapshot
    })
    return {
      ok: true,
      lastError: null,
      lastSyncedAt: snapshot.lastSyncedAt ?? now,
      personalDocuments,
      personalDiagnosticReporting,
      personalGlobalConfig,
      projectRuleDocuments,
      personalModelUsageReporting,
      snapshot,
      snapshotPath: snapshotPaths.globalSnapshotPath
    }
  } catch (error) {
    const message = resolveSyncErrorMessage(error)
    params.ctx.logger.warn(
      { err: error, scope: params.ctx.scope, serverId: params.server.id },
      '[relay] config snapshot sync failed'
    )
    const snapshotPaths = await writeRelayConfigSnapshotSyncErrorCaches({
      lastError: message,
      projectHome: params.ctx.projectHome,
      sourceServerId: params.server.id
    })
    const snapshot = await snapshotStore.readSnapshot()
    return {
      ok: false,
      lastError: message,
      lastSyncedAt: snapshot?.lastSyncedAt ?? null,
      ...(snapshot == null ? {} : { snapshot }),
      snapshotPath: snapshotPaths.globalSnapshotPath
    }
  }
}
