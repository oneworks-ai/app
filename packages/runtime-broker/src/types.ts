export interface RuntimeBrokerSerializedError {
  code: string
  message: string
  details?: unknown
}

export interface RuntimeBrokerEventEnvelope {
  cursor: number
  kind: 'event' | 'request'
  name: string
  payload?: unknown
  requestDeadlineAt?: number
  requestId?: string
}

export interface RuntimeBrokerRemoteRequestContext {
  signal: AbortSignal
}

export interface RuntimeBrokerPollResult {
  events: RuntimeBrokerEventEnvelope[]
  nextCursor: number
}

export interface RuntimeBrokerAcquireInput {
  driverId: string
  payload?: unknown
  profileKey: string
}

export interface RuntimeBrokerAcquireResult {
  leaseId: string
  metadata?: unknown
}

export interface RuntimeBrokerDriverContext {
  emit(name: string, payload?: unknown): void
  leaseId: string
  ownerId: string
  profileKey: string
  request(name: string, payload?: unknown, options?: { timeoutMs?: number }): Promise<unknown>
  signal: AbortSignal
}

export interface RuntimeBrokerDriverLease {
  invoke(operation: string, payload?: unknown): Promise<unknown>
  metadata?: unknown
  release(): void | Promise<void>
}

export interface RuntimeBrokerDriverCallbackContext {
  callbackId?: string
  leaseId?: string
  profileKey: string
  signal?: AbortSignal
}

export interface RuntimeBrokerDriver {
  acquire(payload: unknown, context: RuntimeBrokerDriverContext): Promise<RuntimeBrokerDriverLease>
  callback?(payload: unknown, context: RuntimeBrokerDriverCallbackContext): Promise<unknown>
  dispose?(): void | Promise<void>
  id: string
}

export interface RuntimeBrokerHttpConnection {
  token: string
  url: string
}

export interface RuntimeBrokerHttpRequest {
  action: string
  callbackId?: string
  callbackRetentionMs?: number
  callbackTimeoutMs?: number
  driverId?: string
  invocationId?: string
  leaseId?: string
  operation?: string
  payload?: unknown
  profileKey?: string
  afterCursor?: number
  requestId?: string
  timeoutMs?: number
}

export type RuntimeBrokerHttpResponse =
  | { ok: true; result?: unknown }
  | { ok: false; error: RuntimeBrokerSerializedError }
