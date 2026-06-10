import type { IncomingMessage, ServerResponse } from 'node:http'

import { readRequestBody, sendJson } from '../http.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayTelemetry } from '../telemetry/metrics.js'
import { recordRelayTraceEvent, traceContextFromRequest } from '../telemetry/trace.js'
import type { RelayServerArgs, RelayStore } from '../types.js'
import { canAccessForwardingSession, canUpdateDeviceSnapshot } from './auth.js'
import { sendForbidden } from './http.js'
import { getDeviceSessionSnapshot, updateDeviceSessionSnapshot } from './jobs.js'
import { persistStore, requireDeviceAccess } from './route-context.js'
import { normalizeForwardingSessions } from './store.js'

export const handleListSessions = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  deviceId: string
) => {
  const access = requireDeviceAccess(req, res, args, store, deviceId)
  if (access == null) return
  const snapshot = getDeviceSessionSnapshot(store, deviceId)
  const sessions = snapshot.sessions.filter(session => canAccessForwardingSession(access.actor, access.device, session))
  sendJson(res, 200, {
    deviceId,
    sessions,
    updatedAt: snapshot.updatedAt
  }, args.allowOrigin)
}

export const handleSnapshotUpdate = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  deviceId: string,
  telemetry?: RelayTelemetry
) => {
  const access = requireDeviceAccess(req, res, args, store, deviceId)
  if (access == null) return
  if (!canUpdateDeviceSnapshot(access.actor, access.device)) {
    sendForbidden(res, args)
    return
  }
  const body = await readRequestBody(req)
  const snapshot = updateDeviceSessionSnapshot(store, {
    deviceId,
    sessions: normalizeForwardingSessions(deviceId, body.sessions),
    updatedAt: new Date().toISOString()
  })
  await persistStore(storeRepository, store)
  recordRelayTraceEvent(telemetry, 'info', 'relay.forwarding.sessions_snapshot', {
    ...traceContextFromRequest(req),
    deviceId,
    sessionCount: snapshot.sessions.length,
    userId: access.device.userId
  })
  sendJson(res, 200, snapshot, args.allowOrigin)
}
