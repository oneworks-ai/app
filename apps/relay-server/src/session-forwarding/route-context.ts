import type { IncomingMessage, ServerResponse } from 'node:http'

import { sendJson } from '../http.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayTelemetry } from '../telemetry/metrics.js'
import { recordRelayTraceEvent } from '../telemetry/trace.js'
import type { RelayForwardingJob, RelayServerArgs, RelayStore } from '../types.js'
import { canAccessDevice, canAccessForwardingJob, resolveSessionForwardingActor } from './auth.js'
import { sendDeviceNotFound, sendForbidden, sendUnauthorized } from './http.js'
import { getDeviceSessionSnapshot, getSessionForwardingJob, updateSessionForwardingJob } from './jobs.js'
import { getForwardingPayload } from './payloads.js'

export const findDevice = (store: RelayStore, deviceId: string) => store.devices.find(device => device.id === deviceId)

export const persistStore = async (storeRepository: RelayStoreRepository, store: RelayStore) => {
  await storeRepository.write(store)
}

export const requireDeviceAccess = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  deviceId: string
) => {
  const actor = resolveSessionForwardingActor(req, args, store, deviceId)
  if (actor == null) {
    sendUnauthorized(res, args)
    return undefined
  }
  const device = findDevice(store, deviceId)
  if (device == null) {
    sendDeviceNotFound(res, args)
    return undefined
  }
  if (!canAccessDevice(actor, device)) {
    sendForbidden(res, args)
    return undefined
  }
  return { actor, device }
}

export const expireMissingPayload = (job: RelayForwardingJob, telemetry?: RelayTelemetry) => {
  if (job.status !== 'queued' || getForwardingPayload(job.id) != null) return false
  updateSessionForwardingJob(job, {
    status: 'failed',
    errorCode: 'payload_expired'
  })
  telemetry?.metrics.recordJobExpired({
    deviceId: job.deviceId,
    jobId: job.id
  })
  recordRelayTraceEvent(telemetry, 'warn', 'relay.forwarding.payload_expired', {
    deviceId: job.deviceId,
    jobId: job.id,
    requestId: job.requestId,
    sessionId: job.sessionId,
    traceId: job.traceId,
    userId: job.userId
  })
  return true
}

export const resolveJobAccess = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  jobId: string,
  telemetry?: RelayTelemetry
) => {
  const job = getSessionForwardingJob(store, jobId)
  if (job == null) {
    sendJson(res, 404, { error: 'Forwarding job not found.' }, args.allowOrigin)
    return undefined
  }
  const device = findDevice(store, job.deviceId)
  if (device == null) {
    sendDeviceNotFound(res, args)
    return undefined
  }
  const actor = resolveSessionForwardingActor(req, args, store, job.deviceId)
  if (actor == null) {
    sendUnauthorized(res, args)
    return undefined
  }
  const snapshot = getDeviceSessionSnapshot(store, job.deviceId)
  const session = snapshot.sessions.find(item => item.id === job.sessionId)
  if (!canAccessForwardingJob(actor, device, job, session)) {
    sendForbidden(res, args)
    return undefined
  }
  if (expireMissingPayload(job, telemetry)) {
    await persistStore(storeRepository, store)
  }
  return {
    actor,
    device,
    session,
    job
  }
}
