import { randomUUID } from 'node:crypto'

import type { RelayDeviceSession, RelayForwardingJob, RelayForwardingJobStatus, RelayStore } from '../types.js'
import { now } from '../utils.js'
import type { CreateRelaySessionForwardingJobInput, UpdateRelaySessionForwardingJobInput } from './types.js'

const terminalStatuses = new Set<RelayForwardingJobStatus>(['cancelled', 'failed', 'succeeded'])

export const getDeviceSessionSnapshot = (
  store: RelayStore,
  deviceId: string
) => ({
  deviceId,
  sessions: store.deviceSessions.filter(session => session.deviceId === deviceId),
  updatedAt: store.deviceSessions
    .filter(session => session.deviceId === deviceId)
    .map(session => session.updatedAt)
    .sort()
    .at(-1) ?? now()
})

export const updateDeviceSessionSnapshot = (
  store: RelayStore,
  input: {
    deviceId: string
    sessions: RelayDeviceSession[]
    updatedAt: string
  }
) => {
  store.deviceSessions = [
    ...store.deviceSessions.filter(session => session.deviceId !== input.deviceId),
    ...input.sessions
  ]
  return {
    deviceId: input.deviceId,
    sessions: input.sessions,
    updatedAt: input.updatedAt
  }
}

export const createSessionForwardingJob = (
  store: RelayStore,
  input: CreateRelaySessionForwardingJobInput
) => {
  const timestamp = now()
  const job: RelayForwardingJob = {
    id: randomUUID(),
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    userId: input.userId,
    status: 'queued',
    traceId: input.traceId,
    requestId: input.requestId,
    mode: input.mode,
    payloadSizeBytes: input.payloadSizeBytes,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  store.forwardingJobs.push(job)
  return job
}

export const getSessionForwardingJob = (
  store: RelayStore,
  jobId: string
) => store.forwardingJobs.find(job => job.id === jobId)

export const listSessionForwardingJobs = (
  store: RelayStore,
  input: {
    deviceId?: string
    status?: RelayForwardingJobStatus | 'active' | 'all'
    limit?: number
  }
) => {
  const status = input.status ?? 'active'
  const jobs = store.forwardingJobs.filter(job => {
    if (input.deviceId != null && job.deviceId !== input.deviceId) return false
    if (status === 'all') return true
    if (status === 'active') return !terminalStatuses.has(job.status)
    return job.status === status
  })
  const limit = input.limit == null ? jobs.length : Math.max(0, Math.floor(input.limit))
  return jobs
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(0, limit)
}

export const updateSessionForwardingJob = (
  job: RelayForwardingJob,
  input: UpdateRelaySessionForwardingJobInput
) => {
  const timestamp = now()
  job.status = input.status
  job.updatedAt = timestamp
  if (input.claimedByDeviceId != null) {
    job.claimedByDeviceId = input.claimedByDeviceId
  }
  if ((input.status === 'claimed' || input.status === 'running') && job.claimedAt == null) {
    job.claimedAt = timestamp
  }
  if (terminalStatuses.has(input.status)) {
    job.completedAt = timestamp
  }
  if (input.errorCode != null) {
    job.errorCode = input.errorCode
  } else if (input.status !== 'failed') {
    delete job.errorCode
  }
  if (input.resultSizeBytes != null) {
    job.resultSizeBytes = Math.max(0, Math.floor(input.resultSizeBytes))
  } else {
    delete job.resultSizeBytes
  }
  return job
}
