export type RelaySessionForwardingJobStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface RelaySessionJsonObject {
  [key: string]: unknown
}

export interface RelayLocalSession {
  id: string
  userId?: string
  status?: string
  createdAt?: number
  updatedAt?: number
  messageCount?: number
  model?: string
  adapter?: string
  workspaceFolder?: string
}

export interface RelayLocalSessionSnapshot {
  deviceId: string
  sessions: RelayLocalSession[]
  updatedAt: string
}

export interface RelayForwardingJob {
  id: string
  deviceId: string
  sessionId: string
  status: RelaySessionForwardingJobStatus
  traceId?: string
  mode?: string
  requestId?: string
  payloadSizeBytes?: number
  resultAvailable?: boolean
  resultSizeBytes?: number
  payload?: {
    message: string
  }
  errorCode?: string
  createdAt?: string
  updatedAt?: string
}

export interface RelayForwardingJobStatusUpdate {
  status: RelaySessionForwardingJobStatus
  errorCode?: string
  result?: unknown
}

export interface RelayLocalSessionSubmitInput {
  jobId: string
  sessionId: string
  message: string
  mode?: string
  requestId?: string
}

export interface RelayLocalSessionAdapter {
  listSessions: () => unknown[] | Promise<unknown[]>
  submitMessage: (input: RelayLocalSessionSubmitInput) => unknown | Promise<unknown>
}

export interface RelaySessionClientAuth {
  deviceId: string
  deviceToken: string
  remoteBaseUrl: string
}
