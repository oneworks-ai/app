import { randomUUID } from 'node:crypto'

import type { RelayDeviceSession, RelayForwardingJob, RelayForwardingJobStatus, RelayStore } from '../types.js'
import { now } from '../utils.js'
import type { CreateRelaySessionForwardingJobInput, UpdateRelaySessionForwardingJobInput } from './types.js'

const terminalStatuses = new Set<RelayForwardingJobStatus>(['cancelled', 'failed', 'succeeded'])
const DEFAULT_FORWARDING_JOB_TTL_MS = 30 * 60 * 1_000
const DEFAULT_MAX_RETAINED_FORWARDING_JOBS = 2_000

const sessionFingerprint = (session: RelayDeviceSession) =>
  JSON.stringify({
    deviceId: session.deviceId,
    id: session.id,
    lastActiveAt: session.lastActiveAt,
    state: session.state,
    title: session.title,
    userId: session.userId,
    workspaceFolder: session.workspaceFolder
  })

const sessionListsEqual = (left: RelayDeviceSession[], right: RelayDeviceSession[]) => {
  if (left.length !== right.length) return false
  return left.every((session, index) => sessionFingerprint(session) === sessionFingerprint(right[index]))
}

const terminalTimestamp = (job: RelayForwardingJob) => (
  Date.parse(job.completedAt ?? job.updatedAt ?? job.createdAt)
)

const sortJobsByCreatedAt = (jobs: RelayForwardingJob[]) =>
  jobs.sort((left, right) => left.createdAt.localeCompare(right.createdAt))

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
  const previousSessions = store.deviceSessions.filter(session => session.deviceId === input.deviceId)
  const previousById = new Map(previousSessions.map(session => [session.id, session]))
  const nextSessions = input.sessions.map(session => {
    const previous = previousById.get(session.id)
    if (previous != null && sessionFingerprint(previous) === sessionFingerprint(session)) {
      return previous
    }
    return {
      ...session,
      createdAt: previous?.createdAt ?? session.createdAt,
      updatedAt: input.updatedAt
    }
  })
  const changed = !sessionListsEqual(previousSessions, nextSessions)
  if (!changed) {
    return {
      changed,
      deviceId: input.deviceId,
      sessions: previousSessions,
      updatedAt: previousSessions
        .map(session => session.updatedAt)
        .sort()
        .at(-1) ?? input.updatedAt
    }
  }
  store.deviceSessions = [
    ...store.deviceSessions.filter(session => session.deviceId !== input.deviceId),
    ...nextSessions
  ]
  return {
    changed,
    deviceId: input.deviceId,
    sessions: nextSessions,
    updatedAt: input.updatedAt
  }
}

export const pruneSessionForwardingJobs = (
  store: RelayStore,
  options: {
    maxRetainedJobs?: number
    nowMs?: number
    terminalTtlMs?: number
  } = {}
) => {
  const maxRetainedJobs = Math.max(0, Math.floor(options.maxRetainedJobs ?? DEFAULT_MAX_RETAINED_FORWARDING_JOBS))
  const nowMs = options.nowMs ?? Date.now()
  const terminalTtlMs = Math.max(0, Math.floor(options.terminalTtlMs ?? DEFAULT_FORWARDING_JOB_TTL_MS))
  const activeJobs = store.forwardingJobs.filter(job => !terminalStatuses.has(job.status))
  const terminalJobs = store.forwardingJobs
    .filter(job => terminalStatuses.has(job.status))
    .sort((left, right) => terminalTimestamp(right) - terminalTimestamp(left))

  const retainedTerminalBudget = Math.max(0, maxRetainedJobs - activeJobs.length)
  const retainedTerminalJobs = terminalJobs
    .filter(job => {
      const timestamp = terminalTimestamp(job)
      if (!Number.isFinite(timestamp)) return false
      return nowMs - timestamp <= terminalTtlMs
    })
    .slice(0, retainedTerminalBudget)
  const retainedIds = new Set([...activeJobs, ...retainedTerminalJobs].map(job => job.id))
  const prunedJobs = store.forwardingJobs.filter(job => !retainedIds.has(job.id))
  if (prunedJobs.length === 0) return []
  store.forwardingJobs = sortJobsByCreatedAt([...activeJobs, ...retainedTerminalJobs])
  return prunedJobs
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
