/* eslint-disable max-lines -- relay session worker keeps polling, forwarding, and error reporting together. */
import { createLocalRelaySessionSnapshot, submitLocalRelaySessionMessage } from './session-adapter.js'
import {
  pollRelaySessionForwardingJobs,
  pushRelaySessionSnapshot,
  updateRelaySessionForwardingJobStatus
} from './session-relay-client.js'
import type { RelayForwardingJob, RelayLocalSessionAdapter, RelaySessionClientAuth } from './session-types.js'
import { isRelayWorkspaceWebSocketMode } from './workspace-forwarding-modes.js'
import { RELAY_WORKSPACE_HTTP_MODE, forwardLocalRelayWorkspaceHttpRequest } from './workspace-http-forwarder.js'
import { forwardLocalRelayWorkspaceWebSocketJob } from './workspace-websocket-forwarder.js'

export const DEFAULT_SESSION_WORKER_INTERVAL_MS = 1_000
export const DEFAULT_SESSION_WORKER_MAX_IDLE_INTERVAL_MS = 5_000
export const DEFAULT_SESSION_WORKER_MAX_ERROR_INTERVAL_MS = 30_000
export const DEFAULT_SESSION_WORKER_ERROR_LOG_INTERVAL_MS = 30_000
export const DEFAULT_SESSION_WORKER_SNAPSHOT_REFRESH_MS = 30_000
export const DEFAULT_SESSION_WORKER_LONG_POLL_MS = 10_000

export interface RelaySessionWorkerOptions {
  adapter?: RelayLocalSessionAdapter
  auth: RelaySessionClientAuth
  intervalMs?: number
  logger?: {
    warn: (...args: unknown[]) => void
  }
  errorLogIntervalMs?: number
  maxErrorIntervalMs?: number
  maxIdleIntervalMs?: number
  longPollMs?: number
  serverId?: string
  snapshotRefreshMs?: number
}

export interface RelaySessionWorker {
  runOnce: () => Promise<void>
  stop: () => void
}

const normalizeWorkerErrorCode = (error: unknown) => {
  const raw = error instanceof Error && error.message.trim() !== ''
    ? error.message
    : 'relay_session_worker_job_failed'
  return raw.trim().replace(/[^\w.:-]/g, '_').slice(0, 80) || 'relay_session_worker_job_failed'
}

const describeWorkerError = (error: unknown) => (
  error instanceof Error && error.message.trim() !== ''
    ? error.message.trim()
    : String(error)
)

export const createRelaySessionWorker = (options: RelaySessionWorkerOptions): RelaySessionWorker => {
  let stopped = false
  let inFlight: Promise<void> | undefined
  const inFlightJobIds = new Set<string>()
  let lastSnapshotKey: string | undefined
  let lastSnapshotPushedAt = 0
  let snapshotBackoffUntil = 0
  let nextIntervalMs = Math.max(250, Math.floor(options.intervalMs ?? DEFAULT_SESSION_WORKER_INTERVAL_MS))
  let lastWorkerErrorKey: string | undefined
  let lastWorkerErrorLoggedAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const maxIdleIntervalMs = Math.max(
    nextIntervalMs,
    Math.floor(options.maxIdleIntervalMs ?? DEFAULT_SESSION_WORKER_MAX_IDLE_INTERVAL_MS)
  )
  const maxErrorIntervalMs = Math.max(
    nextIntervalMs,
    Math.floor(options.maxErrorIntervalMs ?? DEFAULT_SESSION_WORKER_MAX_ERROR_INTERVAL_MS)
  )
  const errorLogIntervalMs = Math.max(
    1_000,
    Math.floor(options.errorLogIntervalMs ?? DEFAULT_SESSION_WORKER_ERROR_LOG_INTERVAL_MS)
  )
  const longPollMs = Math.max(0, Math.floor(options.longPollMs ?? DEFAULT_SESSION_WORKER_LONG_POLL_MS))
  const snapshotRefreshMs = Math.max(
    1_000,
    Math.floor(options.snapshotRefreshMs ?? DEFAULT_SESSION_WORKER_SNAPSHOT_REFRESH_MS)
  )

  const isWorkspaceForwardingJob = (job: RelayForwardingJob) => (
    job.mode === RELAY_WORKSPACE_HTTP_MODE || isRelayWorkspaceWebSocketMode(job.mode)
  )

  const processJob = async (job: RelayForwardingJob) => {
    try {
      await updateRelaySessionForwardingJobStatus(options.auth, job.id, { status: 'running' })
      const update = job.mode === RELAY_WORKSPACE_HTTP_MODE
        ? await forwardLocalRelayWorkspaceHttpRequest(job)
        : isRelayWorkspaceWebSocketMode(job.mode)
        ? await forwardLocalRelayWorkspaceWebSocketJob(job)
        : options.adapter == null
        ? {
          errorCode: 'relay_session_adapter_unavailable',
          status: 'failed' as const
        }
        : await submitLocalRelaySessionMessage(options.adapter, job)
      await updateRelaySessionForwardingJobStatus(options.auth, job.id, update)
    } catch (error) {
      options.logger?.warn(
        { err: error, jobId: job.id, ...(options.serverId == null ? {} : { serverId: options.serverId }) },
        '[relay] session forwarding job failed'
      )
      await updateRelaySessionForwardingJobStatus(options.auth, job.id, {
        errorCode: normalizeWorkerErrorCode(error),
        status: 'failed'
      }).catch(updateError => {
        options.logger?.warn(
          {
            err: updateError,
            jobId: job.id,
            ...(options.serverId == null ? {} : { serverId: options.serverId })
          },
          '[relay] failed to mark session forwarding job failed'
        )
      })
    } finally {
      inFlightJobIds.delete(job.id)
    }
  }

  const startJob = (job: RelayForwardingJob) => {
    if (inFlightJobIds.has(job.id)) return
    inFlightJobIds.add(job.id)
    void processJob(job)
  }

  const pushSnapshotIfNeeded = async () => {
    if (options.adapter == null) return
    const snapshot = await createLocalRelaySessionSnapshot(options.adapter, options.auth.deviceId)
    const snapshotKey = JSON.stringify({
      deviceId: snapshot.deviceId,
      sessions: snapshot.sessions
    })
    const shouldRefresh = Date.now() - lastSnapshotPushedAt >= snapshotRefreshMs
    if (snapshotKey === lastSnapshotKey && !shouldRefresh) return
    await pushRelaySessionSnapshot(options.auth, snapshot)
    lastSnapshotKey = snapshotKey
    lastSnapshotPushedAt = Date.now()
  }

  const nextSnapshotDelayMs = () => {
    if (options.adapter == null || lastSnapshotPushedAt <= 0 || Date.now() < snapshotBackoffUntil) return undefined
    return Math.max(0, snapshotRefreshMs - (Date.now() - lastSnapshotPushedAt))
  }

  const runCycle = async () => {
    if (stopped) return { jobCount: 0 }
    await pushSnapshotIfNeeded()
    const { jobs, nextPollMs } = await pollRelaySessionForwardingJobs(options.auth, {
      limit: 50,
      status: 'queued',
      waitMs: longPollMs
    })
    ;[...jobs]
      .sort((left, right) => Number(isWorkspaceForwardingJob(right)) - Number(isWorkspaceForwardingJob(left)))
      .forEach(startJob)
    return { jobCount: jobs.length, nextPollMs }
  }

  const runOnce = async () => {
    await runCycle()
  }

  const warnWorkerFailure = (error: unknown) => {
    const now = Date.now()
    const errorKey = describeWorkerError(error)
    const shouldLog = errorKey !== lastWorkerErrorKey || now - lastWorkerErrorLoggedAt >= errorLogIntervalMs
    if (!shouldLog) return
    lastWorkerErrorKey = errorKey
    lastWorkerErrorLoggedAt = now
    options.logger?.warn(
      { err: error, ...(options.serverId == null ? {} : { serverId: options.serverId }) },
      '[relay] session forwarding worker failed'
    )
  }

  const resetWorkerFailure = () => {
    lastWorkerErrorKey = undefined
    snapshotBackoffUntil = 0
  }

  const schedule = (
    delayMs = nextIntervalMs,
    scheduleOptions: { allowSnapshotWake?: boolean } = {}
  ) => {
    if (stopped) return
    const snapshotDelayMs = scheduleOptions.allowSnapshotWake === false ? undefined : nextSnapshotDelayMs()
    const nextDelayMs = snapshotDelayMs == null
      ? delayMs
      : Math.min(delayMs, snapshotDelayMs)
    timer = setTimeout(runScheduled, nextDelayMs)
    ;(timer as { unref?: () => void }).unref?.()
  }

  const runScheduled = () => {
    if (stopped) return
    if (inFlight != null) {
      schedule(nextIntervalMs, { allowSnapshotWake: false })
      return
    }
    inFlight = runCycle()
      .then(({ jobCount, nextPollMs }) => {
        const baseIntervalMs = Math.max(250, Math.floor(options.intervalMs ?? DEFAULT_SESSION_WORKER_INTERVAL_MS))
        resetWorkerFailure()
        if (jobCount > 0) {
          nextIntervalMs = baseIntervalMs
          return
        }
        nextIntervalMs = nextPollMs == null
          ? Math.min(maxIdleIntervalMs, Math.max(baseIntervalMs, nextIntervalMs * 2))
          : Math.min(maxIdleIntervalMs, Math.max(250, Math.floor(nextPollMs)))
      })
      .catch(error => {
        warnWorkerFailure(error)
        nextIntervalMs = Math.min(maxErrorIntervalMs, Math.max(nextIntervalMs, 1_000) * 2)
        snapshotBackoffUntil = Date.now() + nextIntervalMs
      })
      .finally(() => {
        inFlight = undefined
        schedule()
      })
  }

  schedule()

  return {
    runOnce,
    stop: () => {
      stopped = true
      if (timer != null) clearTimeout(timer)
    }
  }
}
