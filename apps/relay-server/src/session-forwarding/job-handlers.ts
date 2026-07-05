import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { readRequestBody, sendJson } from '../http.js'
import { recordAuditEvent } from '../security/audit.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayTelemetry } from '../telemetry/metrics.js'
import { recordRelayTraceEvent, traceContextFromRequest } from '../telemetry/trace.js'
import type { RelayDeviceSession, RelayServerArgs, RelayStore } from '../types.js'
import {
  canAccessForwardingJob,
  canReadForwardingJobResult,
  canSubmitForwardingSession,
  canUpdateForwardingJob
} from './auth.js'
import {
  decodeSegment,
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
  pruneSessionForwardingJobs,
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

const WORKSPACE_HTTP_SESSION_ID = '__workspace_http__'
const WORKSPACE_HTTP_MODE = 'workspace-http'
const WORKSPACE_WS_CLOSE_MODE = 'workspace-ws-close'
const WORKSPACE_WS_OPEN_MODE = 'workspace-ws-open'
const WORKSPACE_WS_RECEIVE_MODE = 'workspace-ws-receive'
const WORKSPACE_WS_SEND_MODE = 'workspace-ws-send'
const SESSION_JOB_LONG_POLL_MAX_MS = 10_000
const SESSION_JOB_LONG_POLL_FALLBACK_MS = 1_000
const SESSION_JOB_EMPTY_NEXT_POLL_MS = 250
const sessionForwardingJobEvents = new EventEmitter()

sessionForwardingJobEvents.setMaxListeners(0)

interface ListJobsContext {
  access: NonNullable<ReturnType<typeof requireDeviceAccess>>
  requestedLimit: ReturnType<typeof parseLimit>
  requestedStatus: NonNullable<ReturnType<typeof parseListStatus>> | 'active'
  waitMs: number
}

const workspaceRequestModes = new Set([
  WORKSPACE_HTTP_MODE,
  WORKSPACE_WS_CLOSE_MODE,
  WORKSPACE_WS_OPEN_MODE,
  WORKSPACE_WS_RECEIVE_MODE,
  WORKSPACE_WS_SEND_MODE
])

const clearPrunedForwardingJobs = async (store: RelayStore) => {
  const prunedJobs = pruneSessionForwardingJobs(store)
  if (prunedJobs.length === 0) return false
  await Promise.all(prunedJobs.map(async job => {
    await clearForwardingPayload(job.id)
    await clearForwardingResult(job.id)
  }))
  return true
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const parseWaitMs = (value: string | null) => {
  if (value == null) return 0
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(SESSION_JOB_LONG_POLL_MAX_MS, Math.max(0, Math.floor(parsed)))
}

export const getSessionJobLongPollDeviceId = (req: IncomingMessage, url: URL) => {
  if (req.method !== 'GET') return undefined
  const match = /^\/api\/relay\/devices\/([^/]+)\/session-jobs$/.exec(url.pathname)
  if (match == null) return undefined
  const requestedStatus = parseListStatus(url.searchParams.get('status')) ?? 'active'
  if (requestedStatus !== 'queued') return undefined
  return parseWaitMs(url.searchParams.get('waitMs')) > 0 ? decodeSegment(match[1]) : undefined
}

const forwardingJobEventName = (deviceId: string) => `forwarding-job:${deviceId}`

const notifyForwardingJobAvailable = (deviceId: string) => {
  sessionForwardingJobEvents.emit(forwardingJobEventName(deviceId))
}

const auditActorForListJobsContext = (context: ListJobsContext) => {
  if (context.access.actor.kind === 'device') return `device:${context.access.actor.device.id}`
  if (context.access.actor.kind === 'session') return `session:${context.access.actor.user.id}`
  return 'admin-token'
}

const waitForForwardingJobSignal = (
  req: IncomingMessage,
  deviceId: string,
  delayMs: number
) =>
  new Promise<boolean>(resolve => {
    if (req.destroyed || req.aborted) {
      resolve(false)
      return
    }
    let settled = false
    const eventName = forwardingJobEventName(deviceId)
    const cleanup = () => {
      sessionForwardingJobEvents.off(eventName, onAvailable)
      req.off('aborted', onClose)
      req.off('close', onClose)
    }
    const finish = (keepWaiting: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cleanup()
      resolve(keepWaiting)
    }
    const onAvailable = () => finish(true)
    const onClose = () => finish(false)
    const timer = setTimeout(() => finish(true), delayMs)
    sessionForwardingJobEvents.once(eventName, onAvailable)
    req.once('aborted', onClose)
    req.once('close', onClose)
  })

const normalizeWorkspaceRequestPayload = (value: unknown) => {
  if (!isRecord(value)) return undefined
  const mode = toOptionalString(value.mode) ?? WORKSPACE_HTTP_MODE
  if (!workspaceRequestModes.has(mode)) return undefined
  if (mode !== WORKSPACE_HTTP_MODE) {
    const channelId = toOptionalString(value.channelId)
    if (channelId == null) return undefined
    if (mode === WORKSPACE_WS_OPEN_MODE) {
      const rawPath = toOptionalString(value.path)
      if (rawPath == null || !rawPath.startsWith('/')) return undefined
      return {
        mode,
        channelId,
        path: rawPath,
        ...(typeof value.serverBaseUrl === 'string' ? { serverBaseUrl: value.serverBaseUrl } : {}),
        ...(typeof value.requestId === 'string' ? { requestId: value.requestId } : {})
      }
    }
    if (mode === WORKSPACE_WS_SEND_MODE) {
      if (typeof value.dataBase64 !== 'string') return undefined
      return {
        mode,
        channelId,
        dataBase64: value.dataBase64,
        ...(typeof value.isBinary === 'boolean' ? { isBinary: value.isBinary } : {}),
        ...(typeof value.requestId === 'string' ? { requestId: value.requestId } : {})
      }
    }
    if (mode === WORKSPACE_WS_CLOSE_MODE) {
      return {
        mode,
        channelId,
        ...(typeof value.code === 'number' ? { code: value.code } : {}),
        ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
        ...(typeof value.requestId === 'string' ? { requestId: value.requestId } : {})
      }
    }
    return {
      mode,
      channelId,
      ...(typeof value.requestId === 'string' ? { requestId: value.requestId } : {})
    }
  }
  const rawPath = toOptionalString(value.path)
  const method = (toOptionalString(value.method) ?? 'GET').toUpperCase()
  if (rawPath == null || !rawPath.startsWith('/')) return undefined
  const headers = isRecord(value.headers)
    ? Object.fromEntries(
      Object.entries(value.headers)
        .flatMap(([key, headerValue]) => {
          if (typeof headerValue !== 'string') return []
          const normalizedKey = key.trim().toLowerCase()
          return normalizedKey === '' ? [] : [[normalizedKey, headerValue]]
        })
    )
    : undefined
  return {
    mode,
    method,
    path: rawPath,
    ...(headers == null ? {} : { headers }),
    ...(typeof value.bodyBase64 === 'string' ? { bodyBase64: value.bodyBase64 } : {}),
    ...(typeof value.serverBaseUrl === 'string' ? { serverBaseUrl: value.serverBaseUrl } : {}),
    ...(typeof value.requestId === 'string' ? { requestId: value.requestId } : {})
  }
}

const createListJobsContext = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  url: URL,
  deviceId: string
): ListJobsContext | undefined => {
  const access = requireDeviceAccess(req, res, args, store, deviceId)
  if (access == null) return undefined
  const requestedStatus = parseListStatus(url.searchParams.get('status')) ?? 'active'
  const requestedLimit = parseLimit(url.searchParams.get('limit'))
  const waitMs = access.actor.kind === 'device' && requestedStatus === 'queued'
    ? parseWaitMs(url.searchParams.get('waitMs'))
    : 0
  return {
    access,
    requestedLimit,
    requestedStatus,
    waitMs
  }
}

const collectListJobsResponse = async (
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  deviceId: string,
  context: ListJobsContext,
  telemetry?: RelayTelemetry
) => {
  let changed = false
  if (await clearPrunedForwardingJobs(store)) {
    changed = true
  }
  const listAccessibleJobs = (sourceStore: RelayStore) => {
    const snapshot = getDeviceSessionSnapshot(sourceStore, deviceId)
    return listSessionForwardingJobs(sourceStore, {
      deviceId,
      status: context.requestedStatus,
      limit: context.requestedLimit
    }).filter(job =>
      canAccessForwardingJob(
        context.access.actor,
        context.access.device,
        job,
        snapshot.sessions.find(session => session.id === job.sessionId)
      )
    )
  }
  const jobs: ReturnType<typeof publicForwardingJob>[] = []
  for (const job of listAccessibleJobs(store)) {
    if (context.access.actor.kind === 'device' && job.status === 'queued') {
      const payload = await consumeForwardingPayload(job.id)
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
        jobs.push(publicForwardingJob(job))
        continue
      }
      changed = true
      updateSessionForwardingJob(job, {
        status: 'claimed',
        claimedByDeviceId: context.access.actor.device.id
      })
      telemetry?.metrics.recordJobClaimed({
        deviceId: job.deviceId,
        jobId: job.id
      })
      recordRelayTraceEvent(telemetry, 'info', 'relay.forwarding.job_claimed', {
        deviceId: context.access.actor.device.id,
        jobId: job.id,
        payloadSizeBytes: job.payloadSizeBytes,
        requestId: job.requestId,
        sessionId: job.sessionId,
        traceId: job.traceId,
        userId: job.userId
      })
      jobs.push(publicForwardingJob(job, { payload }))
      continue
    }
    const payload = await getForwardingPayload(job.id)
    if (await expireMissingPayload(job, telemetry)) changed = true
    jobs.push(publicForwardingJob(job, { payloadSizeBytes: payload?.payloadSize }))
  }
  if (changed) {
    await clearPrunedForwardingJobs(store)
    await persistStore(storeRepository, store)
  }
  return jobs
}

const runListJobsWithLatestStore = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  storeRepository: RelayStoreRepository,
  url: URL,
  deviceId: string,
  telemetry?: RelayTelemetry
) => {
  let result:
    | { context: ListJobsContext; jobs: ReturnType<typeof publicForwardingJob>[]; responded: false }
    | { responded: true }
    | undefined
  const run = async (store: RelayStore, requestRepository: RelayStoreRepository) => {
    const context = createListJobsContext(req, res, args, store, url, deviceId)
    if (context == null) {
      result = { responded: true }
      return
    }
    result = {
      context,
      jobs: await collectListJobsResponse(store, requestRepository, deviceId, context, telemetry),
      responded: false
    }
  }
  if (storeRepository.withStore != null) {
    await storeRepository.withStore(run)
  } else {
    await run(await storeRepository.read(), storeRepository)
  }
  return result ?? { responded: true as const }
}

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
  await rememberForwardingPayload(job.id, {
    message,
    requestId: job.requestId
  })
  await clearPrunedForwardingJobs(store)
  await persistStore(storeRepository, store)
  notifyForwardingJobAvailable(deviceId)
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

export const handleSubmitWorkspaceRequestJob = async (
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

  const pseudoSession: RelayDeviceSession = {
    id: WORKSPACE_HTTP_SESSION_ID,
    deviceId,
    title: 'Workspace HTTP request',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  if (!canSubmitForwardingSession(access.actor, access.device, pseudoSession)) {
    sendForbidden(res, args)
    return
  }

  const body = await readRequestBody(req)
  const requestPayload = normalizeWorkspaceRequestPayload(isRecord(body.request) ? body.request : body)
  if (requestPayload == null) {
    sendJson(res, 400, { error: 'Workspace request method and absolute path are required.' }, args.allowOrigin)
    return
  }

  const requestTrace = traceContextFromRequest(req)
  const payload = JSON.stringify(requestPayload)
  const payloadSizeBytes = measurePayloadSize(payload)
  const requestId = requestPayload.requestId ?? requestTrace.requestId
  const mode = requestPayload.mode ?? WORKSPACE_HTTP_MODE
  const job = createSessionForwardingJob(store, {
    deviceId,
    sessionId: WORKSPACE_HTTP_SESSION_ID,
    mode,
    payloadSizeBytes,
    requestId,
    traceId: toOptionalString(body.traceId) ?? requestTrace.traceId ?? randomUUID(),
    userId: access.actor.kind === 'session' ? access.actor.user.id : undefined
  })
  await rememberForwardingPayload(job.id, {
    message: payload,
    requestId: job.requestId
  })
  await clearPrunedForwardingJobs(store)
  await persistStore(storeRepository, store)
  notifyForwardingJobAvailable(deviceId)
  telemetry?.metrics.recordJobSubmitted({
    deviceId,
    jobId: job.id
  })
  recordRelayTraceEvent(telemetry, 'info', 'relay.forwarding.workspace_request_submitted', {
    deviceId,
    jobId: job.id,
    method: 'method' in requestPayload ? requestPayload.method : undefined,
    mode,
    path: 'path' in requestPayload ? requestPayload.path : undefined,
    payloadSizeBytes,
    requestId: job.requestId,
    sessionId: WORKSPACE_HTTP_SESSION_ID,
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
  const context = createListJobsContext(req, res, args, store, url, deviceId)
  if (context == null) return
  let activeStore = store
  let jobs = await collectListJobsResponse(activeStore, storeRepository, deviceId, context, telemetry)
  if (jobs.length === 0 && context.waitMs > 0) {
    const deadline = Date.now() + context.waitMs
    while (jobs.length === 0 && Date.now() < deadline) {
      const delayMs = Math.min(SESSION_JOB_LONG_POLL_FALLBACK_MS, deadline - Date.now())
      if (delayMs <= 0) break
      const keepWaiting = await waitForForwardingJobSignal(req, deviceId, delayMs)
      if (!keepWaiting) return
      activeStore = await storeRepository.read()
      jobs = await collectListJobsResponse(activeStore, storeRepository, deviceId, context, telemetry)
    }
  }
  sendJson(res, 200, {
    jobs,
    ...(context.waitMs > 0 && jobs.length === 0 ? { nextPollMs: SESSION_JOB_EMPTY_NEXT_POLL_MS } : {})
  }, args.allowOrigin)
}

export const handleListJobsWithoutStoreLock = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  storeRepository: RelayStoreRepository,
  url: URL,
  deviceId: string,
  telemetry?: RelayTelemetry
) => {
  const first = await runListJobsWithLatestStore(req, res, args, storeRepository, url, deviceId, telemetry)
  if (first.responded) return
  let jobs = first.jobs
  let waitMs = first.context.waitMs
  let auditContext = first.context
  if (jobs.length === 0 && waitMs > 0) {
    const deadline = Date.now() + waitMs
    while (jobs.length === 0 && Date.now() < deadline) {
      const delayMs = Math.min(SESSION_JOB_LONG_POLL_FALLBACK_MS, deadline - Date.now())
      if (delayMs <= 0) break
      const keepWaiting = await waitForForwardingJobSignal(req, deviceId, delayMs)
      if (!keepWaiting) return
      const next = await runListJobsWithLatestStore(req, res, args, storeRepository, url, deviceId, telemetry)
      if (next.responded) return
      jobs = next.jobs
      waitMs = next.context.waitMs
      auditContext = next.context
      if (waitMs <= 0) break
    }
  }
  recordAuditEvent({
    actor: auditActorForListJobsContext(auditContext),
    action: 'device.session_jobs.claim',
    resource: `device:${deviceId}`,
    status: 'success'
  })
  sendJson(res, 200, {
    jobs,
    ...(waitMs > 0 && jobs.length === 0 ? { nextPollMs: SESSION_JOB_EMPTY_NEXT_POLL_MS } : {})
  }, args.allowOrigin)
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
  const payload = await getForwardingPayload(access.job.id)
  sendJson(res, 200, {
    job: publicForwardingJob(access.job, {
      payloadSizeBytes: payload?.payloadSize,
      resultAvailable: await hasForwardingResult(access.job.id)
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
  const result = await consumeForwardingResult(access.job.id)
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
    ? await rememberForwardingResult(access.job.id, body.result)
    : undefined
  const updated = updateSessionForwardingJob(access.job, {
    status,
    errorCode: normalizeErrorCode(body.errorCode) ?? (status === 'failed' ? 'forwarding_failed' : undefined),
    resultSizeBytes: resultPayload?.resultSize
  })
  if (status === 'cancelled' || status === 'failed' || status === 'succeeded') {
    await clearForwardingPayload(access.job.id)
  }
  if (status === 'cancelled' || status === 'failed') {
    await clearForwardingResult(access.job.id)
  }
  if (status === 'succeeded' && !hasResult) {
    await clearForwardingResult(access.job.id)
  }
  await clearPrunedForwardingJobs(store)
  await persistStore(storeRepository, store)
  const resultAvailable = await hasForwardingResult(access.job.id)
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
