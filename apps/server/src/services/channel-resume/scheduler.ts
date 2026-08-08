import { resumeReadyChannelIntents } from './batch.js'
import type { ChannelResumeSchedulerRuntime } from './types.js'

const DEFAULT_RESUME_SCHEDULER_INTERVAL_MS = 5000
const DEFAULT_RESUME_SCHEDULER_LIMIT = 20
let resumeSchedulerTimer: ReturnType<typeof setInterval> | undefined
let resumeSchedulerRunning = false

export const runChannelResumeSchedulerOnce = async (input: {
  limit?: number
  now?: number
} = {}) => {
  if (resumeSchedulerRunning) return []
  resumeSchedulerRunning = true
  try {
    return await resumeReadyChannelIntents({
      limit: input.limit ?? DEFAULT_RESUME_SCHEDULER_LIMIT,
      now: input.now
    })
  } finally {
    resumeSchedulerRunning = false
  }
}

export const stopChannelResumeScheduler = () => {
  if (resumeSchedulerTimer != null) {
    clearInterval(resumeSchedulerTimer)
    resumeSchedulerTimer = undefined
  }
}

export const startChannelResumeScheduler = (input: {
  intervalMs?: number
  limit?: number
} = {}): ChannelResumeSchedulerRuntime => {
  stopChannelResumeScheduler()
  const intervalMs = Number.isFinite(input.intervalMs) && input.intervalMs! > 0
    ? input.intervalMs!
    : DEFAULT_RESUME_SCHEDULER_INTERVAL_MS
  const limit = Number.isInteger(input.limit) && input.limit! > 0
    ? input.limit!
    : DEFAULT_RESUME_SCHEDULER_LIMIT

  void runChannelResumeSchedulerOnce({ limit }).catch(() => undefined)
  resumeSchedulerTimer = setInterval(() => {
    void runChannelResumeSchedulerOnce({ limit }).catch(() => undefined)
  }, intervalMs)
  resumeSchedulerTimer.unref?.()

  return {
    stop: stopChannelResumeScheduler
  }
}
