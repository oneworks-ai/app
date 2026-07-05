import type { ServerResponse } from 'node:http'

import { sendJson } from '../http.js'
import type { RelayForwardingJob, RelayForwardingJobStatus, RelayServerArgs } from '../types.js'
import type { RelayForwardingPayload } from './payloads.js'

const forwardingStatuses = new Set<RelayForwardingJobStatus>([
  'cancelled',
  'claimed',
  'failed',
  'queued',
  'running',
  'succeeded'
])

export const decodeSegment = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export const parseLimit = (value: string | null) => {
  if (value == null || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : undefined
}

export const parseJobStatus = (value: unknown): RelayForwardingJobStatus | undefined => {
  if (typeof value !== 'string') return undefined
  const status = value.trim()
  if (status === 'completed') return 'succeeded'
  return forwardingStatuses.has(status as RelayForwardingJobStatus) ? status as RelayForwardingJobStatus : undefined
}

export const parseListStatus = (value: string | null) => {
  if (value === 'all' || value === 'active') return value
  return parseJobStatus(value)
}

export const toOptionalString = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text === '' ? undefined : text
}

export const normalizeErrorCode = (value: unknown) => {
  const text = toOptionalString(value)
  if (text == null) return undefined
  const cleaned = text.replace(/[^\w.:-]/g, '_').slice(0, 80)
  return cleaned === '' ? undefined : cleaned
}

export const sendUnauthorized = (res: ServerResponse, args: RelayServerArgs) => {
  sendJson(res, 401, { error: 'Authentication required.' }, args.allowOrigin)
}

export const sendForbidden = (res: ServerResponse, args: RelayServerArgs) => {
  sendJson(res, 403, { error: 'Forbidden.' }, args.allowOrigin)
}

export const sendDeviceNotFound = (res: ServerResponse, args: RelayServerArgs) => {
  sendJson(res, 404, { error: 'Device not found.' }, args.allowOrigin)
}

export const publicForwardingJob = (
  job: RelayForwardingJob,
  options: {
    payload?: RelayForwardingPayload
    payloadSizeBytes?: number
    resultAvailable?: boolean
  } = {}
) => ({
  id: job.id,
  deviceId: job.deviceId,
  sessionId: job.sessionId,
  userId: job.userId,
  status: job.status,
  mode: job.mode,
  traceId: job.traceId,
  requestId: job.requestId,
  payloadSizeBytes: options.payloadSizeBytes ?? options.payload?.payloadSize ?? job.payloadSizeBytes,
  resultSizeBytes: job.resultSizeBytes,
  ...(options.resultAvailable == null ? {} : { resultAvailable: options.resultAvailable }),
  errorCode: job.errorCode,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  claimedAt: job.claimedAt,
  completedAt: job.completedAt,
  ...(options.payload == null
    ? {}
    : {
      payload: {
        message: options.payload.message
      }
    })
})
