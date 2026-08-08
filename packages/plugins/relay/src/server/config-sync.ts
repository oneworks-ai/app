/* eslint-disable max-lines -- Relay config sync coordinates snapshots, global config, and document sync in one loop. */
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
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
  personalGlobalConfig?: RelayPersonalGlobalConfigSyncStatus
  projectRuleDocuments?: Record<string, RelayPersonalDocumentSyncStatus>
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

const readJsonFile = async (path: string): Promise<Record<string, unknown>> => {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'))
    return isRecord(value) ? value : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
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
      personalGlobalConfig,
      projectRuleDocuments,
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
