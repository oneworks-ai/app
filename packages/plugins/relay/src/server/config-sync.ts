import type { RelayConfigSnapshot } from '../shared/config-assignment.js'
import { createRelayConfigSnapshotStore, normalizeRelayConfigSnapshot } from '../shared/config-cache.js'
import type { ResolvedRelayServer } from './options.js'
import type { RelayPluginContext, RelayStoredServer } from './types.js'
import { isRecord, toString } from './utils.js'

export interface RelayConfigSyncResult {
  ok: boolean
  lastError: string | null
  lastSyncedAt: string | null
  snapshot?: RelayConfigSnapshot
  snapshotPath: string
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

    await snapshotStore.writeSnapshot(snapshot)
    return {
      ok: true,
      lastError: null,
      lastSyncedAt: snapshot.lastSyncedAt ?? now,
      snapshot,
      snapshotPath: snapshotStore.snapshotPath
    }
  } catch (error) {
    const message = resolveSyncErrorMessage(error)
    params.ctx.logger.warn(
      { err: error, scope: params.ctx.scope, serverId: params.server.id },
      '[relay] config snapshot sync failed'
    )
    await snapshotStore.writeSyncError({
      lastError: message,
      sourceServerId: params.server.id
    })
    const snapshot = await snapshotStore.readSnapshot()
    return {
      ok: false,
      lastError: message,
      lastSyncedAt: snapshot?.lastSyncedAt ?? null,
      ...(snapshot == null ? {} : { snapshot }),
      snapshotPath: snapshotStore.snapshotPath
    }
  }
}
