/* eslint-disable max-lines -- callback budgets and lease transport options form one HTTP contract. */
import { RuntimeBrokerRemoteError, isRetryableTransportError, toRemoteError } from './errors'
import { RuntimeBrokerRemoteLease } from './remote-lease'
import type {
  RuntimeBrokerAcquireInput,
  RuntimeBrokerAcquireResult,
  RuntimeBrokerHttpConnection,
  RuntimeBrokerHttpRequest,
  RuntimeBrokerHttpResponse
} from './types'

export { RuntimeBrokerRemoteError } from './errors'
export { RuntimeBrokerRemoteLease } from './remote-lease'

const DEFAULT_ACQUIRE_REQUEST_TIMEOUT_MS = 120_000
const DEFAULT_CALLBACK_ATTEMPT_TIMEOUT_MS = 60_000
const DEFAULT_CALLBACK_TOTAL_TIMEOUT_MS = 700_000
const CALLBACK_RETENTION_GRACE_MS = 10_000
const CALLBACK_ACK_REQUEST_TIMEOUT_MS = 2_000
const DEFAULT_CONTROL_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_INVOKE_REQUEST_TIMEOUT_MS = 120_000
const DEFAULT_POLL_TRANSPORT_GRACE_MS = 5_000
const DEFAULT_REQUEST_HANDLER_TIMEOUT_MS = 600_000
const DEFAULT_MAX_PENDING_REQUESTS = 512
const MAX_PENDING_REQUESTS = 4_096
const MAX_TIMER_TIMEOUT_MS = 2_147_483_647

const readClientTimer = (name: string, value: number, maximum = MAX_TIMER_TIMEOUT_MS) => {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RuntimeBrokerRemoteError(
      'invalid_client_options',
      `Runtime broker ${name} must be an integer between 1 and ${maximum}.`
    )
  }
  return value
}

export interface RuntimeBrokerHttpClientOptions extends RuntimeBrokerHttpConnection {
  acquireRequestTimeoutMs?: number
  callbackAttemptTimeoutMs?: number
  callbackRequestTimeoutMs?: number
  callbackTotalTimeoutMs?: number
  controlRequestTimeoutMs?: number
  fetch?: typeof fetch
  invokeRequestTimeoutMs?: number
  maxPendingRequests?: number
  onError?: (error: unknown) => void
  pollTimeoutMs?: number
  pollTransportGraceMs?: number
  requestHandlerTimeoutMs?: number
}

export class RuntimeBrokerHttpClient {
  readonly #acquireRequestTimeoutMs: number
  readonly #callbackAttemptTimeoutMs: number
  readonly #callbackTotalTimeoutMs: number
  readonly #connection: RuntimeBrokerHttpConnection
  readonly #controlRequestTimeoutMs: number
  readonly #fetch: typeof fetch
  readonly #invokeRequestTimeoutMs: number
  readonly #maxPendingRequests: number
  readonly #onError: (error: unknown) => void
  readonly #pollTimeoutMs: number
  readonly #pollTransportGraceMs: number
  readonly #requestHandlerTimeoutMs: number

  constructor(options: RuntimeBrokerHttpClientOptions) {
    this.#acquireRequestTimeoutMs = readClientTimer(
      'acquire request timeout',
      options.acquireRequestTimeoutMs ?? DEFAULT_ACQUIRE_REQUEST_TIMEOUT_MS
    )
    if (options.callbackRequestTimeoutMs != null) {
      readClientTimer('callback request timeout', options.callbackRequestTimeoutMs)
    }
    this.#callbackAttemptTimeoutMs = readClientTimer(
      'callback attempt timeout',
      options.callbackAttemptTimeoutMs ??
        options.callbackRequestTimeoutMs ??
        DEFAULT_CALLBACK_ATTEMPT_TIMEOUT_MS
    )
    this.#callbackTotalTimeoutMs = readClientTimer(
      'callback total timeout',
      options.callbackTotalTimeoutMs ?? DEFAULT_CALLBACK_TOTAL_TIMEOUT_MS,
      MAX_TIMER_TIMEOUT_MS - CALLBACK_RETENTION_GRACE_MS
    )
    this.#connection = { token: options.token, url: options.url.replace(/\/+$/u, '') }
    this.#controlRequestTimeoutMs = readClientTimer(
      'control request timeout',
      options.controlRequestTimeoutMs ?? DEFAULT_CONTROL_REQUEST_TIMEOUT_MS
    )
    this.#fetch = options.fetch ?? fetch
    this.#invokeRequestTimeoutMs = readClientTimer(
      'invoke request timeout',
      options.invokeRequestTimeoutMs ?? DEFAULT_INVOKE_REQUEST_TIMEOUT_MS
    )
    const maxPendingRequests = options.maxPendingRequests ?? DEFAULT_MAX_PENDING_REQUESTS
    if (
      !Number.isSafeInteger(maxPendingRequests) ||
      maxPendingRequests <= 0 ||
      maxPendingRequests > MAX_PENDING_REQUESTS
    ) {
      throw new RuntimeBrokerRemoteError(
        'invalid_client_options',
        `Runtime broker max pending requests must be an integer between 1 and ${MAX_PENDING_REQUESTS}.`
      )
    }
    this.#maxPendingRequests = maxPendingRequests
    this.#onError = options.onError ?? (() => undefined)
    this.#pollTimeoutMs = readClientTimer('poll timeout', options.pollTimeoutMs ?? 20_000)
    this.#pollTransportGraceMs = readClientTimer(
      'poll transport grace',
      options.pollTransportGraceMs ?? DEFAULT_POLL_TRANSPORT_GRACE_MS
    )
    if (this.#pollTimeoutMs + this.#pollTransportGraceMs > MAX_TIMER_TIMEOUT_MS) {
      throw new RuntimeBrokerRemoteError(
        'invalid_client_options',
        `Runtime broker poll timeout plus transport grace must not exceed ${MAX_TIMER_TIMEOUT_MS}.`
      )
    }
    this.#requestHandlerTimeoutMs = readClientTimer(
      'request handler timeout',
      options.requestHandlerTimeoutMs ?? DEFAULT_REQUEST_HANDLER_TIMEOUT_MS
    )
  }

  async acquire(input: RuntimeBrokerAcquireInput) {
    const result = await this.request<RuntimeBrokerAcquireResult>(
      { action: 'acquire', ...input },
      { timeoutMs: this.#acquireRequestTimeoutMs }
    )
    return new RuntimeBrokerRemoteLease(this, result, {
      controlRequestTimeoutMs: this.#controlRequestTimeoutMs,
      invokeRequestTimeoutMs: this.#invokeRequestTimeoutMs,
      maxPendingRequests: this.#maxPendingRequests,
      onError: this.#onError,
      pollTimeoutMs: this.#pollTimeoutMs,
      pollTransportTimeoutMs: this.#pollTimeoutMs + this.#pollTransportGraceMs,
      requestHandlerTimeoutMs: this.#requestHandlerTimeoutMs
    })
  }

  async callback<T = unknown>(driverId: string, payload?: unknown) {
    const startedAt = Date.now()
    const deadlineAt = startedAt + this.#callbackTotalTimeoutMs
    const body: RuntimeBrokerHttpRequest = {
      action: 'callback',
      callbackId: globalThis.crypto.randomUUID(),
      callbackRetentionMs: this.#callbackTotalTimeoutMs + CALLBACK_RETENTION_GRACE_MS,
      callbackTimeoutMs: this.#callbackTotalTimeoutMs,
      driverId,
      payload
    }
    let delayMs = 250
    let lastError: unknown
    while (Date.now() < deadlineAt) {
      const remainingMs = deadlineAt - Date.now()
      if (remainingMs <= 0) break
      try {
        const result = await this.request<T>(body, {
          timeoutMs: Math.min(this.#callbackAttemptTimeoutMs, remainingMs)
        })
        await this.#acknowledgeCallback(body)
        return result
      } catch (error) {
        lastError = error
        if (!isRetryableTransportError(error)) {
          await this.#acknowledgeCallback(body)
          throw error
        }
        if (Date.now() >= deadlineAt) throw error
        this.#onError(error)
        await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, deadlineAt - Date.now())))
        delayMs = Math.min(delayMs * 2, 1_000)
      }
    }
    throw lastError ?? new RuntimeBrokerRemoteError(
      'transport_error',
      'Runtime broker callback retry deadline was exhausted.'
    )
  }

  async request<T = unknown>(body: RuntimeBrokerHttpRequest, options: { timeoutMs?: number } = {}): Promise<T> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const perform = async () => {
      const response = await this.#fetch(this.#connection.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#connection.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      const parsed = await response.json().catch(() => undefined) as RuntimeBrokerHttpResponse | undefined
      if (parsed?.ok === false) throw toRemoteError(parsed.error)
      if (!response.ok || parsed?.ok !== true) {
        throw new RuntimeBrokerRemoteError(
          'transport_error',
          `Runtime broker request failed with HTTP ${response.status}.`
        )
      }
      return parsed.result as T
    }
    const timeoutMs = readClientTimer(
      'request timeout',
      options.timeoutMs ?? this.#controlRequestTimeoutMs
    )
    try {
      return await Promise.race([
        perform(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            reject(
              new RuntimeBrokerRemoteError(
                'transport_error',
                `Runtime broker request timed out after ${timeoutMs}ms.`
              )
            )
          }, timeoutMs)
          timer.unref?.()
        })
      ])
    } finally {
      if (timer != null) clearTimeout(timer)
    }
  }

  async #acknowledgeCallback(body: RuntimeBrokerHttpRequest) {
    const acknowledgement: RuntimeBrokerHttpRequest = {
      action: 'callback_ack',
      callbackId: body.callbackId,
      driverId: body.driverId
    }
    let delayMs = 100
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.request(acknowledgement, { timeoutMs: CALLBACK_ACK_REQUEST_TIMEOUT_MS })
        return
      } catch (error) {
        this.#onError(error)
        if (!isRetryableTransportError(error) || attempt === 1) return
        await new Promise(resolve => setTimeout(resolve, delayMs))
        delayMs *= 2
      }
    }
  }
}

export const invokeRuntimeBrokerCallback = async <T = unknown>(
  connection: RuntimeBrokerHttpConnection,
  driverId: string,
  payload?: unknown
) => await new RuntimeBrokerHttpClient(connection).callback<T>(driverId, payload)
