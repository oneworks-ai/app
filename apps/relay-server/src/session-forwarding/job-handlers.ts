import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { readRequestBody, sendJson } from '../http.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayTelemetry } from '../telemetry/metrics.js'
import { recordRelayTraceEvent, traceContextFromRequest } from '../telemetry/trace.js'
import type { RelayServerArgs, RelayStore } from '../types.js'
import {
  canAccessForwardingJob,
  canReadForwardingJobResult,
  canSubmitForwardingSession,
  canUpdateForwardingJob
} from './auth.js'
import {
  normalizeErrorCode,
  parseJobStatus,
  parseLimit,
  parseListStatus,
  publicForwardingJob,
  sendForbidden,
  toOptionalString
} from './http.js'
import {
  createSessionForwardingJob,
  getDeviceSessionSnapshot,
  listSessionForwardingJobs,
  updateSessionForwardingJob
} from './jobs.js'
import {
  clearForwardingPayload,
  clearForwardingResult,
  consumeForwardingPayload,
  consumeForwardingResult,
  getForwardingPayload,
  hasForwardingResult,
  measurePayloadSize,
  rememberForwardingPayload,
  rememberForwardingResult
} from './payloads.js'
import { expireMissingPayload, persistStore, requireDeviceAccess, resolveJobAccess } from './route-context.js'

export const handleSubmitJob = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  deviceId: string,
  sessionId: string,
  telemetry?: RelayTelemetry
) => {
  const access = requireDeviceAccess(req, res, args, store, deviceId)
  if (access == null) return
  const body = await readRequestBody(req)
  const requestTrace = traceContextFromRequest(req)
  const message = toOptionalString(body.message) ?? toOptionalString(body.content)
  if (message == null) {
    sendJson(res, 400, { error: 'Message content is required.' }, args.allowOrigin)
    return
  }

  const snapshot = getDeviceSessionSnapshot(store, deviceId)
  const session = snapshot.sessions.find(item => item.id === sessionId)
  if (session == null) {
    sendJson(res, 404, { error: 'Session not found.' }, args.allowOrigin)
    return
  }
  if (!canSubmitForwardingSession(access.actor, access.device, session)) {
    sendForbidden(res, args)
    return
  }

  const payloadSizeBytes = measurePayloadSize(message)
  const requestId = toOptionalString(body.requestId) ?? requestTrace.requestId
  const job = createSessionForwardingJob(store, {
    deviceId,
    sessionId,
    payloadSizeBytes,
    requestId,
    traceId: toOptionalString(body.traceId) ?? requestTrace.traceId ?? randomUUID(),
    userId: access.actor.kind === 'session' ? access.actor.user.id : undefined
  })
  rememberForwardingPayload(job.id, {
    message,
    requestId: job.requestId
  })
  await persistStore(storeRepository, store)
  telemetry?.metrics.recordJobSubmitted({
    deviceId,
    jobId: job.id
  })
  recordRelayTraceEvent(telemetry, 'info', 'relay.forwarding.job_submitted', {
    deviceId,
    jobId: job.id,
    payloadSizeBytes,
    requestId: job.requestId,
    sessionId,
    traceId: job.traceId,
    userId: job.userId
  })
  sendJson(res, 202, { job: publicForwardingJob(job, { payloadSizeBytes }) }, args.allowOrigin)
}

export const handleListJobs = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL,
  deviceId: string,
  telemetry?: RelayTelemetry
) => {
  const access = requireDeviceAccess(req, res, args, store, deviceId)
  if (access == null) return
  const snapshot = getDeviceSessionSnapshot(store, deviceId)
  let changed = false
  const jobs = listSessionForwardingJobs(store, {
    deviceId,
    status: parseListStatus(url.searchParams.get('status')) ?? 'active',
    limit: parseLimit(url.searchParams.get('limit'))
  }).filter(job =>
    canAccessForwardingJob(
      access.actor,
      access.device,
      job,
      snapshot.sessions.find(session => session.id === job.sessionId)
    )
  ).map(job => {
    if (access.actor.kind === 'device' && job.status === 'queued') {
      const payload = consumeForwardingPayload(job.id)
      if (payload == null) {
        changed = true
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
        return publicForwardingJob(job)
      }
      changed = true
      updateSessionForwardingJob(job, {
        status: 'claimed',
        claimedByDeviceId: access.actor.device.id
      })
      telemetry?.metrics.recordJobClaimed({
        deviceId: job.deviceId,
        jobId: job.id
      })
      recordRelayTraceEvent(telemetry, 'info', 'relay.forwarding.job_claimed', {
        deviceId: access.actor.device.id,
        jobId: job.id,
        payloadSizeBytes: job.payloadSizeBytes,
        requestId: job.requestId,
        sessionId: job.sessionId,
        traceId: job.traceId,
        userId: job.userId
      })
      return publicForwardingJob(job, { payload })
    }
    const payload = getForwardingPayload(job.id)
    if (expireMissingPayload(job, telemetry)) changed = true
    return publicForwardingJob(job, { payloadSizeBytes: payload?.payloadSize })
  })
  if (changed) {
    await persistStore(storeRepository, store)
  }
  sendJson(res, 200, { jobs }, args.allowOrigin)
}

export const handleGetJob = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  jobId: string,
  telemetry?: RelayTelemetry
) => {
  const access = await resolveJobAccess(req, res, args, store, storeRepository, jobId, telemetry)
  if (access == null) return
  const payload = getForwardingPayload(access.job.id)
  sendJson(res, 200, {
    job: publicForwardingJob(access.job, {
      payloadSizeBytes: payload?.payloadSize,
      resultAvailable: hasForwardingResult(access.job.id)
    })
  }, args.allowOrigin)
}

export const handleGetJobResult = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  jobId: string,
  telemetry?: RelayTelemetry
) => {
  const access = await resolveJobAccess(req, res, args, store, storeRepository, jobId, telemetry)
  if (access == null) return
  if (!canReadForwardingJobResult(access.actor, access.device, access.job, access.session)) {
    sendForbidden(res, args)
    return
  }
  if (access.job.status !== 'succeeded') {
    sendJson(res, 409, { error: 'Forwarding job has no completed result.' }, args.allowOrigin)
    return
  }
  const result = consumeForwardingResult(access.job.id)
  if (result == null) {
    sendJson(res, 404, { error: 'Forwarding result is no longer available.' }, args.allowOrigin)
    return
  }
  recordRelayTraceEvent(telemetry, 'info', 'relay.forwarding.result_consumed', {
    deviceId: access.job.deviceId,
    jobId: access.job.id,
    requestId: access.job.requestId,
    resultSizeBytes: result.resultSize,
    sessionId: access.job.sessionId,
    traceId: access.job.traceId,
    userId: access.job.userId
  })
  sendJson(res, 200, {
    job: publicForwardingJob(access.job, { resultAvailable: false }),
    result: result.result
  }, args.allowOrigin)
}

export const handleUpdateJobStatus = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  jobId: string,
  telemetry?: RelayTelemetry
) => {
  const access = await resolveJobAccess(req, res, args, store, storeRepository, jobId, telemetry)
  if (access == null) return
  if (!canUpdateForwardingJob(access.actor, access.job)) {
    sendForbidden(res, args)
    return
  }
  const body = await readRequestBody(req)
  const status = parseJobStatus(body.status)
  if (status == null) {
    sendJson(res, 400, { error: 'Invalid forwarding job status.' }, args.allowOrigin)
    return
  }
  const hasResult = Object.prototype.hasOwnProperty.call(body, 'result')
  const resultPayload = status === 'succeeded' && hasResult
    ? rememberForwardingResult(access.job.id, body.result)
    : undefined
  const updated = updateSessionForwardingJob(access.job, {
    status,
    errorCode: normalizeErrorCode(body.errorCode) ?? (status === 'failed' ? 'forwarding_failed' : undefined),
    resultSizeBytes: resultPayload?.resultSize
  })
  if (status === 'cancelled' || status === 'failed' || status === 'succeeded') {
    clearForwardingPayload(access.job.id)
  }
  if (status === 'cancelled' || status === 'failed') {
    clearForwardingResult(access.job.id)
  }
  if (status === 'succeeded' && !hasResult) {
    clearForwardingResult(access.job.id)
  }
  await persistStore(storeRepository, store)
  const resultAvailable = hasForwardingResult(access.job.id)
  telemetry?.metrics.recordJobStatus({
    deviceId: updated.deviceId,
    jobId: updated.id,
    status: updated.status
  })
  recordRelayTraceEvent(telemetry, status === 'failed' ? 'warn' : 'info', 'relay.forwarding.job_status', {
    deviceId: access.job.deviceId,
    errorCode: updated.errorCode,
    jobId: access.job.id,
    requestId: access.job.requestId,
    resultAvailable,
    resultSizeBytes: updated.resultSizeBytes,
    sessionId: access.job.sessionId,
    status: updated.status,
    traceId: access.job.traceId,
    userId: access.job.userId
  })
  sendJson(res, 200, {
    job: publicForwardingJob(updated, { resultAvailable })
  }, args.allowOrigin)
}
