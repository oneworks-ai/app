import { createLocalRelaySessionSnapshot, submitLocalRelaySessionMessage } from './session-adapter.js'
import {
  pollRelaySessionForwardingJobs,
  pushRelaySessionSnapshot,
  updateRelaySessionForwardingJobStatus
} from './session-relay-client.js'
import type { RelayLocalSessionAdapter, RelaySessionClientAuth } from './session-types.js'

export const DEFAULT_SESSION_WORKER_INTERVAL_MS = 5_000

export interface RelaySessionWorkerOptions {
  adapter: RelayLocalSessionAdapter
  auth: RelaySessionClientAuth
  intervalMs?: number
  logger?: {
    warn: (...args: unknown[]) => void
  }
}

export interface RelaySessionWorker {
  runOnce: () => Promise<void>
  stop: () => void
}

export const createRelaySessionWorker = (options: RelaySessionWorkerOptions): RelaySessionWorker => {
  let stopped = false
  let inFlight: Promise<void> | undefined

  const runOnce = async () => {
    if (stopped) return
    const snapshot = await createLocalRelaySessionSnapshot(options.adapter, options.auth.deviceId)
    await pushRelaySessionSnapshot(options.auth, snapshot)
    const { jobs } = await pollRelaySessionForwardingJobs(options.auth, {
      limit: 5,
      status: 'queued'
    })
    for (const job of jobs) {
      await updateRelaySessionForwardingJobStatus(options.auth, job.id, { status: 'running' })
      const update = await submitLocalRelaySessionMessage(options.adapter, job)
      await updateRelaySessionForwardingJobStatus(options.auth, job.id, update)
    }
  }

  const runScheduled = () => {
    if (stopped || inFlight != null) return
    inFlight = runOnce()
      .catch(error => {
        options.logger?.warn({ err: error }, '[relay] session forwarding worker failed')
      })
      .finally(() => {
        inFlight = undefined
      })
  }

  const timer = setInterval(runScheduled, options.intervalMs ?? DEFAULT_SESSION_WORKER_INTERVAL_MS)
  ;(timer as { unref?: () => void }).unref?.()

  return {
    runOnce,
    stop: () => {
      stopped = true
      clearInterval(timer)
    }
  }
}
