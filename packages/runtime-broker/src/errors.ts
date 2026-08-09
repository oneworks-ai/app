import type { RuntimeBrokerSerializedError } from './types'

export class RuntimeBrokerRemoteError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'RuntimeBrokerRemoteError'
  }
}

export const toRemoteError = (error: RuntimeBrokerSerializedError) =>
  new RuntimeBrokerRemoteError(error.code, error.message, error.details)

export const isRetryableTransportError = (error: unknown) => (
  !(error instanceof RuntimeBrokerRemoteError) || error.code === 'transport_error'
)
