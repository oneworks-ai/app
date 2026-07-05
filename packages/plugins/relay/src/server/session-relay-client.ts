import type {
  RelayForwardingJob,
  RelayForwardingJobPollResult,
  RelayForwardingJobStatusUpdate,
  RelayLocalSessionSnapshot,
  RelaySessionClientAuth,
  RelaySessionForwardingJobStatus
} from './session-types.js'
import { isRecord, normalizeRemoteBaseUrl, toString } from './utils.js'

const jobStatuses = new Set<RelaySessionForwardingJobStatus>([
  'queued',
  'claimed',
  'running',
  'succeeded',
  'failed',
  'cancelled'
])

const toOptionalString = (value: unknown) => {
  const text = toString(value)
  return text === '' ? undefined : text
}

const createRelayUrl = (auth: RelaySessionClientAuth, path: string) => {
  const baseUrl = normalizeRemoteBaseUrl(auth.remoteBaseUrl)
  if (baseUrl === '') throw new Error('remoteBaseUrl is required.')
  return new URL(path, baseUrl).toString()
}

const authHeaders = (auth: RelaySessionClientAuth) => ({
  authorization: `Bearer ${auth.deviceToken}`,
  'content-type': 'application/json'
})

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  const body = await response.json().catch(() => ({}))
  return isRecord(body) ? body : {}
}

const ensureOk = async (response: Response) => {
  if (response.ok) return
  const body = await readJson(response)
  const message = typeof body.error === 'string' && body.error.trim() !== ''
    ? body.error.trim()
    : `Relay request failed with ${response.status}.`
  throw new Error(message)
}

const normalizeRelayForwardingJob = (value: unknown): RelayForwardingJob | undefined => {
  if (!isRecord(value)) return undefined
  const id = toOptionalString(value.id)
  const deviceId = toOptionalString(value.deviceId)
  const sessionId = toOptionalString(value.sessionId)
  const rawStatus = toString(value.status) as RelaySessionForwardingJobStatus
  if (
    id == null ||
    deviceId == null ||
    sessionId == null ||
    !jobStatuses.has(rawStatus)
  ) {
    return undefined
  }
  const payload = isRecord(value.payload) ? toOptionalString(value.payload.message) : undefined
  return {
    id,
    deviceId,
    sessionId,
    status: rawStatus,
    traceId: toOptionalString(value.traceId),
    mode: toOptionalString(value.mode),
    requestId: toOptionalString(value.requestId),
    payloadSizeBytes: typeof value.payloadSizeBytes === 'number' && Number.isFinite(value.payloadSizeBytes)
      ? Math.max(0, Math.floor(value.payloadSizeBytes))
      : undefined,
    resultAvailable: typeof value.resultAvailable === 'boolean' ? value.resultAvailable : undefined,
    resultSizeBytes: typeof value.resultSizeBytes === 'number' && Number.isFinite(value.resultSizeBytes)
      ? Math.max(0, Math.floor(value.resultSizeBytes))
      : undefined,
    payload: payload == null ? undefined : { message: payload },
    errorCode: toOptionalString(value.errorCode),
    createdAt: toOptionalString(value.createdAt),
    updatedAt: toOptionalString(value.updatedAt)
  }
}

export const pushRelaySessionSnapshot = async (
  auth: RelaySessionClientAuth,
  snapshot: RelayLocalSessionSnapshot
) => {
  const response = await fetch(
    createRelayUrl(
      auth,
      `/api/relay/devices/${encodeURIComponent(auth.deviceId)}/sessions/snapshot`
    ),
    {
      method: 'POST',
      headers: authHeaders(auth),
      body: JSON.stringify(snapshot)
    }
  )
  await ensureOk(response)
  return await readJson(response)
}

export const pollRelaySessionForwardingJobs = async (
  auth: RelaySessionClientAuth,
  options: {
    limit?: number
    status?: 'active' | 'all' | RelayForwardingJob['status']
    waitMs?: number
  } = {}
): Promise<RelayForwardingJobPollResult> => {
  const search = new URLSearchParams()
  if (options.status != null) search.set('status', options.status)
  if (options.limit != null) search.set('limit', String(options.limit))
  if (options.waitMs != null) search.set('waitMs', String(Math.max(0, Math.floor(options.waitMs))))
  const query = search.toString()
  const response = await fetch(
    createRelayUrl(
      auth,
      `/api/relay/devices/${encodeURIComponent(auth.deviceId)}/session-jobs${query === '' ? '' : `?${query}`}`
    ),
    {
      method: 'GET',
      headers: authHeaders(auth)
    }
  )
  await ensureOk(response)
  const body = await readJson(response)
  const nextPollMs = typeof body.nextPollMs === 'number' && Number.isFinite(body.nextPollMs)
    ? Math.max(0, Math.floor(body.nextPollMs))
    : undefined
  return {
    jobs: Array.isArray(body.jobs)
      ? body.jobs.map(normalizeRelayForwardingJob).filter((job): job is RelayForwardingJob => job != null)
      : [],
    ...(nextPollMs == null ? {} : { nextPollMs })
  }
}

export const updateRelaySessionForwardingJobStatus = async (
  auth: RelaySessionClientAuth,
  jobId: string,
  update: RelayForwardingJobStatusUpdate
) => {
  const response = await fetch(
    createRelayUrl(
      auth,
      `/api/relay/session-jobs/${encodeURIComponent(jobId)}/status`
    ),
    {
      method: 'POST',
      headers: authHeaders(auth),
      body: JSON.stringify(update)
    }
  )
  await ensureOk(response)
  return await readJson(response)
}
