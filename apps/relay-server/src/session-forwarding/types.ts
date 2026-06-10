import type { RelayForwardingJobStatus } from '../types.js'

export type RelaySessionForwardingMode = 'direct' | 'steer' | string
export type RelaySessionForwardingJobStatus = RelayForwardingJobStatus

export interface RelayForwardingJsonObject {
  [key: string]: unknown
}

export interface CreateRelaySessionForwardingJobInput {
  deviceId: string
  sessionId: string
  payloadSizeBytes: number
  mode?: RelaySessionForwardingMode
  requestId?: string
  traceId: string
  userId?: string
}

export interface UpdateRelaySessionForwardingJobInput {
  status: RelayForwardingJobStatus
  claimedByDeviceId?: string
  errorCode?: string
  resultSizeBytes?: number
}
