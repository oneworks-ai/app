import type { RelayDeviceStatus, RelayForwardingJobStatus } from '../types.js'
import { now } from '../utils.js'

export interface RelayTelemetry {
  metrics: RelayMetricsRegistry
}

export interface RelayRateSnapshot {
  denominator: number
  numerator: number
  ratio: number | null
}

export interface RelayForwardingCounters {
  cancelled: number
  claimed: number
  completed: number
  expired: number
  failed: number
  submitted: number
}

export interface RelayDeviceMetricsSnapshot extends RelayForwardingCounters {
  deviceId: string
  heartbeatCount: number
  lastHeartbeatAt?: string
  lastStatus?: RelayDeviceStatus
  lastUserId?: string
}

export interface RelayTraceMetricsEvent {
  at: string
  event: string
  level: string
  deviceId?: string
  errorCode?: string
  jobId?: string
  payloadSizeBytes?: number
  requestId?: string
  resultAvailable?: boolean
  resultSizeBytes?: number
  sessionCount?: number
  sessionId?: string
  status?: string
  traceId?: string
  userId?: string
}

export interface RelayMetricsSnapshot {
  service: 'relay-server'
  generatedAt: string
  startedAt: string
  devices: {
    count: number
    heartbeats: number
    items: RelayDeviceMetricsSnapshot[]
  }
  forwarding: {
    counters: RelayForwardingCounters
    inFlight: number
    rates: {
      delivery: RelayRateSnapshot
      success: RelayRateSnapshot
    }
  }
  traces: {
    recent: RelayTraceMetricsEvent[]
    total: number
  }
}

type RelayTerminalOutcome = 'cancelled' | 'completed' | 'expired' | 'failed'

interface RelayDeviceMetricsState {
  counters: RelayForwardingCounters
  heartbeatCount: number
  lastHeartbeatAt?: string
  lastStatus?: RelayDeviceStatus
  lastUserId?: string
}

interface RelayTerminalRecord {
  deviceId: string
  outcome: RelayTerminalOutcome
}

export interface RelayJobMetricInput {
  deviceId: string
  jobId: string
}

export interface RelayHeartbeatMetricInput {
  deviceId: string
  status: RelayDeviceStatus
  userId?: string
}

const emptyCounters = (): RelayForwardingCounters => ({
  cancelled: 0,
  claimed: 0,
  completed: 0,
  expired: 0,
  failed: 0,
  submitted: 0
})

const createDeviceState = (): RelayDeviceMetricsState => ({
  counters: emptyCounters(),
  heartbeatCount: 0
})

const cloneCounters = (counters: RelayForwardingCounters): RelayForwardingCounters => ({
  cancelled: counters.cancelled,
  claimed: counters.claimed,
  completed: counters.completed,
  expired: counters.expired,
  failed: counters.failed + counters.expired,
  submitted: counters.submitted
})

const adjustTerminalCounter = (
  counters: RelayForwardingCounters,
  outcome: RelayTerminalOutcome,
  delta: 1 | -1
) => {
  if (outcome === 'completed') counters.completed += delta
  if (outcome === 'failed') counters.failed += delta
  if (outcome === 'expired') counters.expired += delta
  if (outcome === 'cancelled') counters.cancelled += delta
}

const ratio = (numerator: number, denominator: number): RelayRateSnapshot => ({
  denominator,
  numerator,
  ratio: denominator === 0 ? null : numerator / denominator
})

const terminalOutcomeForStatus = (status: RelayForwardingJobStatus): RelayTerminalOutcome | undefined => {
  if (status === 'succeeded') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return undefined
}

export class RelayMetricsRegistry {
  private readonly claimedJobs = new Set<string>()
  private readonly counters = emptyCounters()
  private readonly deviceMetrics = new Map<string, RelayDeviceMetricsState>()
  private readonly recentTraces: RelayTraceMetricsEvent[] = []
  private readonly startedAt = now()
  private readonly terminalJobs = new Map<string, RelayTerminalRecord>()
  private traceCount = 0

  constructor(private readonly maxTraceEvents = 200) {}

  recordHeartbeat(input: RelayHeartbeatMetricInput) {
    const device = this.device(input.deviceId)
    device.heartbeatCount += 1
    device.lastHeartbeatAt = now()
    device.lastStatus = input.status
    device.lastUserId = input.userId
  }

  recordJobSubmitted(input: RelayJobMetricInput) {
    this.counters.submitted += 1
    this.device(input.deviceId).counters.submitted += 1
  }

  recordJobClaimed(input: RelayJobMetricInput) {
    if (this.claimedJobs.has(input.jobId)) return
    this.claimedJobs.add(input.jobId)
    this.counters.claimed += 1
    this.device(input.deviceId).counters.claimed += 1
  }

  recordJobExpired(input: RelayJobMetricInput) {
    this.recordTerminal(input, 'expired')
  }

  recordJobStatus(input: RelayJobMetricInput & { status: RelayForwardingJobStatus }) {
    const outcome = terminalOutcomeForStatus(input.status)
    if (outcome == null) return
    this.recordTerminal(input, outcome)
  }

  recordTraceEvent(event: RelayTraceMetricsEvent) {
    this.traceCount += 1
    this.recentTraces.push(event)
    if (this.recentTraces.length > this.maxTraceEvents) {
      this.recentTraces.splice(0, this.recentTraces.length - this.maxTraceEvents)
    }
  }

  snapshot(): RelayMetricsSnapshot {
    const counters = cloneCounters(this.counters)
    const items = Array.from(this.deviceMetrics.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([deviceId, state]) => ({
        deviceId,
        ...cloneCounters(state.counters),
        heartbeatCount: state.heartbeatCount,
        lastHeartbeatAt: state.lastHeartbeatAt,
        lastStatus: state.lastStatus,
        lastUserId: state.lastUserId
      }))
    return {
      service: 'relay-server',
      generatedAt: now(),
      startedAt: this.startedAt,
      devices: {
        count: items.length,
        heartbeats: items.reduce((total, item) => total + item.heartbeatCount, 0),
        items
      },
      forwarding: {
        counters,
        inFlight: Math.max(0, counters.submitted - counters.completed - counters.failed - counters.cancelled),
        rates: {
          delivery: ratio(counters.claimed, counters.submitted),
          success: ratio(counters.completed, counters.submitted)
        }
      },
      traces: {
        recent: [...this.recentTraces],
        total: this.traceCount
      }
    }
  }

  private device(deviceId: string) {
    const existing = this.deviceMetrics.get(deviceId)
    if (existing != null) return existing
    const created = createDeviceState()
    this.deviceMetrics.set(deviceId, created)
    return created
  }

  private recordTerminal(input: RelayJobMetricInput, outcome: RelayTerminalOutcome) {
    const existing = this.terminalJobs.get(input.jobId)
    if (existing?.outcome === outcome && existing.deviceId === input.deviceId) return
    if (existing != null) {
      adjustTerminalCounter(this.counters, existing.outcome, -1)
      adjustTerminalCounter(this.device(existing.deviceId).counters, existing.outcome, -1)
    }
    adjustTerminalCounter(this.counters, outcome, 1)
    adjustTerminalCounter(this.device(input.deviceId).counters, outcome, 1)
    this.terminalJobs.set(input.jobId, {
      deviceId: input.deviceId,
      outcome
    })
  }
}

export const createRelayTelemetry = (): RelayTelemetry => ({
  metrics: new RelayMetricsRegistry()
})
