/* eslint-disable max-lines -- Relay config sync coordinates snapshots, global config, and document sync in one loop. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

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
import { createPersonalDocumentSyncStatus, syncRelayPersonalDocuments } from './personal-document-sync.js'
import type { RelayPersonalDocumentSyncStatus, RelayPluginContext, RelayStoredServer } from './types.js'
import { isRecord, toString } from './utils.js'

export interface RelayConfigSyncResult {
  ok: boolean
  lastError: string | null
  lastSyncedAt: string | null
  personalDocuments?: RelayPersonalDocumentSyncStatus
  personalGlobalConfig?: RelayPersonalGlobalConfigSyncStatus
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

interface LocalPersonalGlobalConfigPatch {
  configPath: string
  configPatch?: RelayConfigPatch
  updatedAt?: string
}

const PERSONAL_GLOBAL_CONFIG_FIELDS: RelayConfigSafeField[] = ['adapters']

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
  const codex = isRecord(patch?.adapters) && isRecord(patch.adapters.codex)
    ? patch.adapters.codex
    : undefined
  const accounts = isRecord(codex?.accounts) ? codex.accounts : undefined
  if (accounts == null) return false

  return Object.values(accounts).some(account => {
    if (!isRecord(account) || !isRecord(account.auth)) return false
    const auth = account.auth
    return toString(auth.encoding) === 'base64' &&
      toString(auth.token) !== '' &&
      (toString(auth.type) === '' || toString(auth.type) === 'codex-auth-json')
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

const readJsonFile = async (path: string): Promise<Record<string, unknown>> => {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'))
    return isRecord(value) ? value : {}
  } catch {
    return {}
  }
}

const readLocalPersonalGlobalConfigPatch = async (): Promise<LocalPersonalGlobalConfigPatch> => {
  const configPath = resolveGlobalConfigPath()
  const config = await readJsonFile(configPath)
  const configPatch = filterRelayConfigPatch(config as RelayConfigPatch, PERSONAL_GLOBAL_CONFIG_FIELDS)
  const fileStat = await stat(configPath).catch(() => undefined)
  return {
    configPath,
    ...(configPatch == null ? {} : { configPatch }),
    ...(fileStat == null ? {} : { updatedAt: fileStat.mtime.toISOString() })
  }
}

const writeLocalPersonalGlobalConfigPatch = async (
  configPath: string,
  configPatch: RelayConfigPatch
) => {
  const config = await readJsonFile(configPath)
  const merged = mergeRelayConfigPatches(config as RelayConfigPatch, configPatch) ?? configPatch
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify({ ...config, ...merged }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
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

const localPatchIsNewer = (
  localUpdatedAt: string | undefined,
  remoteUpdatedAt: string | undefined
) => {
  if (localUpdatedAt == null) return false
  if (remoteUpdatedAt == null) return true
  return Date.parse(localUpdatedAt) > Date.parse(remoteUpdatedAt) + 1000
}

const syncRelayPersonalGlobalConfig = async (params: {
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
  const remotePatch = remote?.configPatch
  const localHash = hashLocalPersonalConfigPatch(local.configPatch)
  const remoteHash = hashLocalPersonalConfigPatch(remotePatch)

  if (remotePatch == null && local.configPatch == null) {
    return { appliedRemote: false, lastError: null, pushedLocal: false }
  }
  if (remotePatch == null && local.configPatch != null && hasPublishablePersonalGlobalConfig(local.configPatch)) {
    const updated = await putRelayPersonalGlobalConfig({
      configPatch: local.configPatch,
      deviceToken: params.deviceToken,
      server: params.server
    })
    return {
      appliedRemote: false,
      hash: updated.hash,
      lastError: null,
      pushedLocal: true,
      updatedAt: updated.updatedAt
    }
  }
  if (remotePatch == null) {
    return { appliedRemote: false, lastError: null, pushedLocal: false }
  }
  if (remotePatch != null && local.configPatch == null) {
    await writeLocalPersonalGlobalConfigPatch(local.configPath, remotePatch)
    return {
      appliedRemote: true,
      hash: remote?.hash,
      lastError: null,
      pushedLocal: false,
      updatedAt: remote?.updatedAt
    }
  }
  if (localHash === remoteHash) {
    return {
      appliedRemote: false,
      hash: remote?.hash,
      lastError: null,
      pushedLocal: false,
      updatedAt: remote?.updatedAt
    }
  }
  if (
    localPatchIsNewer(local.updatedAt, remote?.updatedAt) &&
    local.configPatch != null &&
    hasPublishablePersonalGlobalConfig(local.configPatch)
  ) {
    const updated = await putRelayPersonalGlobalConfig({
      baseHash: remote?.hash,
      configPatch: local.configPatch,
      deviceToken: params.deviceToken,
      server: params.server
    })
    return {
      appliedRemote: false,
      hash: updated.hash,
      lastError: null,
      pushedLocal: true,
      updatedAt: updated.updatedAt
    }
  }
  if (remotePatch != null) {
    await writeLocalPersonalGlobalConfigPatch(local.configPath, remotePatch)
  }
  return {
    appliedRemote: remotePatch != null,
    hash: remote?.hash,
    lastError: null,
    pushedLocal: false,
    updatedAt: remote?.updatedAt
  }
}

const putRelayPersonalGlobalConfig = async (params: {
  baseHash?: string
  configPatch: RelayConfigPatch
  deviceToken: string
  server: ResolvedRelayServer
}): Promise<RelayPersonalConfigSnapshotPayload> => {
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
  if (!response.ok) {
    throw new Error(toString(body.error) || `Relay personal config update failed with ${response.status}.`)
  }
  return readPersonalConfigPayload(body) ?? {}
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

    const snapshotPaths = await writeRelayConfigSnapshotCaches({
      projectHome: params.ctx.projectHome,
      snapshot
    })
    return {
      ok: true,
      lastError: null,
      lastSyncedAt: snapshot.lastSyncedAt ?? now,
      personalDocuments,
      personalGlobalConfig,
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
