/* eslint-disable max-lines -- polling, dispatch, idempotent retry, and release form one lease state machine. */
import type { RuntimeBrokerHttpClient } from './client'
import { RuntimeBrokerRemoteError, isRetryableTransportError } from './errors'
import type {
  RuntimeBrokerAcquireResult,
  RuntimeBrokerEventEnvelope,
  RuntimeBrokerHttpRequest,
  RuntimeBrokerPollResult,
  RuntimeBrokerRemoteRequestContext
} from './types'

type EventHandler = (payload: unknown) => void | Promise<void>
type RequestHandler = (
  payload: unknown,
  context: RuntimeBrokerRemoteRequestContext
) => unknown | Promise<unknown>

const createInvocationId = () => globalThis.crypto.randomUUID()
const MAX_TIMER_TIMEOUT_MS = 2_147_483_647
const MAX_REJECTION_RESPONSE_BACKLOG = 4_096
const MAX_REJECTION_RESPONSE_CONCURRENCY = 8

interface ScheduledRequest {
  controller: AbortController
  deadlineAt: number
  deadlineTimer?: ReturnType<typeof setTimeout>
  event: RuntimeBrokerEventEnvelope
}

interface RejectedRequest {
  deadlineAt: number
  error: RuntimeBrokerRemoteError
  event: RuntimeBrokerEventEnvelope
}

interface RuntimeBrokerRemoteLeaseOptions {
  controlRequestTimeoutMs: number
  invokeRequestTimeoutMs: number
  maxPendingRequests: number
  onError: (error: unknown) => void
  pollTimeoutMs: number
  pollTransportTimeoutMs: number
  requestHandlerTimeoutMs: number
}

export class RuntimeBrokerRemoteLease {
  readonly leaseId: string
  readonly metadata: unknown
  readonly #client: RuntimeBrokerHttpClient
  readonly #controlRequestTimeoutMs: number
  readonly #eventHandlers = new Map<string, Set<EventHandler>>()
  #eventDispatchTail = Promise.resolve()
  readonly #activeRequestControllers = new Set<AbortController>()
  readonly #invokeRequestTimeoutMs: number
  readonly #maxPendingRequests: number
  readonly #onError: (error: unknown) => void
  readonly #pollTimeoutMs: number
  readonly #pollTransportTimeoutMs: number
  #requestDispatchTail = Promise.resolve()
  readonly #requestHandlerTimeoutMs: number
  readonly #requestHandlers = new Map<string, RequestHandler>()
  #activeRejectionResponses = 0
  readonly #rejectionResponseQueue: RejectedRequest[] = []
  #cursor = 0
  #pendingRequestCount = 0
  #polling = false
  #released = false

  constructor(
    client: RuntimeBrokerHttpClient,
    result: RuntimeBrokerAcquireResult,
    options: RuntimeBrokerRemoteLeaseOptions
  ) {
    this.#client = client
    this.#controlRequestTimeoutMs = options.controlRequestTimeoutMs
    this.#invokeRequestTimeoutMs = options.invokeRequestTimeoutMs
    this.#maxPendingRequests = options.maxPendingRequests
    this.leaseId = result.leaseId
    this.metadata = result.metadata
    this.#pollTimeoutMs = options.pollTimeoutMs
    this.#pollTransportTimeoutMs = options.pollTransportTimeoutMs
    this.#requestHandlerTimeoutMs = options.requestHandlerTimeoutMs
    this.#onError = options.onError
  }

  onEvent(name: string, handler: EventHandler) {
    const handlers = this.#eventHandlers.get(name) ?? new Set<EventHandler>()
    handlers.add(handler)
    this.#eventHandlers.set(name, handlers)
    this.#ensurePolling()
    return () => handlers.delete(handler)
  }

  onRequest(name: string, handler: RequestHandler) {
    this.#requestHandlers.set(name, handler)
    this.#ensurePolling()
    return () => {
      if (this.#requestHandlers.get(name) === handler) this.#requestHandlers.delete(name)
    }
  }

  async invoke<T = unknown>(
    operation: string,
    payload?: unknown,
    options: { requestTimeoutMs?: number } = {}
  ): Promise<T> {
    this.#ensurePolling()
    return await this.#requestWithRetry<T>({
      action: 'invoke',
      invocationId: createInvocationId(),
      leaseId: this.leaseId,
      operation,
      payload
    }, options.requestTimeoutMs)
  }

  release() {
    if (!this.#close(new RuntimeBrokerRemoteError('lease_closed', 'Runtime broker lease was released.'))) return
    void this.#client.request(
      { action: 'release', leaseId: this.leaseId },
      { timeoutMs: this.#controlRequestTimeoutMs }
    ).catch(this.#onError)
  }

  #ensurePolling() {
    if (this.#polling || this.#released) return
    this.#polling = true
    void this.#pollLoop()
  }

  async #pollLoop() {
    try {
      while (!this.#released) {
        try {
          const result = await this.#client.request<RuntimeBrokerPollResult>(
            {
              action: 'poll',
              afterCursor: this.#cursor,
              leaseId: this.leaseId,
              timeoutMs: this.#pollTimeoutMs
            },
            { timeoutMs: this.#pollTransportTimeoutMs }
          )
          const requests: RuntimeBrokerEventEnvelope[] = []
          for (const event of result.events) {
            this.#cursor = Math.max(this.#cursor, event.cursor)
            if (event.kind === 'event') {
              this.#scheduleEvent(event)
            } else {
              requests.push(event)
            }
          }
          this.#cursor = Math.max(this.#cursor, result.nextCursor)
          for (const request of requests) this.#scheduleRequest(request)
        } catch (error) {
          if (this.#released) break
          this.#onError(error)
          if (
            error instanceof RuntimeBrokerRemoteError &&
            (error.code === 'lease_not_found' || error.code === 'event_gap')
          ) {
            this.#close(error)
            if (error.code === 'event_gap') {
              void this.#client.request(
                { action: 'release', leaseId: this.leaseId },
                { timeoutMs: this.#controlRequestTimeoutMs }
              ).catch(this.#onError)
            }
            break
          }
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }
    } finally {
      this.#polling = false
    }
  }

  #scheduleEvent(event: RuntimeBrokerEventEnvelope) {
    this.#eventDispatchTail = this.#eventDispatchTail
      .then(() => this.#dispatchEvent(event))
      .catch(this.#onError)
  }

  #scheduleRequest(event: RuntimeBrokerEventEnvelope) {
    if (this.#released) return
    const rawDeadlineAt = event.requestDeadlineAt
    const deadlineAt = rawDeadlineAt === undefined
      ? Date.now() + this.#requestHandlerTimeoutMs
      : rawDeadlineAt
    const remainingMs = deadlineAt - Date.now()
    if (
      !Number.isSafeInteger(deadlineAt) ||
      remainingMs > MAX_TIMER_TIMEOUT_MS
    ) {
      this.#rejectRequestWithoutDispatch(
        event,
        new RuntimeBrokerRemoteError(
          'invalid_request_deadline',
          'Runtime broker request deadline must be a finite safe integer within the supported timer range.'
        ),
        Date.now() + this.#requestHandlerTimeoutMs
      )
      return
    }
    if (this.#pendingRequestCount >= this.#maxPendingRequests) {
      this.#rejectRequestWithoutDispatch(
        event,
        new RuntimeBrokerRemoteError(
          'request_capacity',
          'Runtime broker remote request capacity is exhausted; the handler was not executed.'
        ),
        deadlineAt
      )
      return
    }
    const request: ScheduledRequest = {
      controller: new AbortController(),
      deadlineAt,
      event
    }
    this.#pendingRequestCount += 1
    this.#activeRequestControllers.add(request.controller)
    if (remainingMs <= 0) {
      request.controller.abort(this.#requestDeadlineError(deadlineAt))
    } else {
      request.deadlineTimer = setTimeout(() => {
        request.controller.abort(this.#requestDeadlineError(deadlineAt))
      }, remainingMs)
      request.deadlineTimer.unref?.()
    }
    this.#requestDispatchTail = this.#requestDispatchTail
      .then(() => this.#dispatchRequest(request))
      .catch(this.#onError)
      .finally(() => {
        if (request.deadlineTimer != null) clearTimeout(request.deadlineTimer)
        this.#activeRequestControllers.delete(request.controller)
        this.#pendingRequestCount -= 1
      })
  }

  async #dispatchEvent(event: RuntimeBrokerEventEnvelope) {
    if (this.#released) return
    for (const handler of this.#eventHandlers.get(event.name) ?? []) {
      await handler(event.payload)
    }
  }

  async #dispatchRequest(request: ScheduledRequest) {
    if (this.#released) return
    const { controller, event } = request
    const handler = this.#requestHandlers.get(event.name)
    let abortListener: (() => void) | undefined
    const cancellation = new Promise<never>((_resolve, reject) => {
      abortListener = () =>
        reject(
          controller.signal.reason instanceof Error
            ? controller.signal.reason
            : new RuntimeBrokerRemoteError('request_aborted', 'Runtime broker request handler was aborted.')
        )
      controller.signal.addEventListener('abort', abortListener, { once: true })
    })
    let result: unknown
    try {
      result = controller.signal.aborted
        ? { error: this.#requestErrorMessage(controller.signal.reason) }
        : handler == null
        ? { error: `No runtime broker request handler registered for "${event.name}".` }
        : await Promise.race([
          Promise.resolve().then(() => handler(event.payload, { signal: controller.signal })),
          cancellation
        ])
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) }
    } finally {
      if (abortListener != null) controller.signal.removeEventListener('abort', abortListener)
      if (request.deadlineTimer != null) {
        clearTimeout(request.deadlineTimer)
        request.deadlineTimer = undefined
      }
    }
    await this.#respondWithRetry({
      action: 'respond',
      leaseId: this.leaseId,
      requestId: event.requestId,
      payload: result
    })
  }

  #requestDeadlineError(deadlineAt: number) {
    return new RuntimeBrokerRemoteError(
      'request_timeout',
      `Runtime broker request deadline expired at ${deadlineAt}.`
    )
  }

  #requestErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }

  #rejectRequestWithoutDispatch(
    event: RuntimeBrokerEventEnvelope,
    error: RuntimeBrokerRemoteError,
    deadlineAt: number
  ) {
    this.#onError(error)
    if (this.#released) return
    if (this.#rejectionResponseQueue.length >= MAX_REJECTION_RESPONSE_BACKLOG) {
      this.#onError(
        new RuntimeBrokerRemoteError(
          'request_capacity',
          'Runtime broker rejection response backlog is exhausted; the lease was released.'
        )
      )
      this.release()
      return
    }
    this.#rejectionResponseQueue.push({ deadlineAt, error, event })
    this.#drainRejectionResponses()
  }

  #drainRejectionResponses() {
    while (
      !this.#released &&
      this.#activeRejectionResponses < MAX_REJECTION_RESPONSE_CONCURRENCY &&
      this.#rejectionResponseQueue.length > 0
    ) {
      const rejected = this.#rejectionResponseQueue.shift()!
      this.#activeRejectionResponses += 1
      void this.#respondWithRetry({
        action: 'respond',
        leaseId: this.leaseId,
        requestId: rejected.event.requestId,
        payload: { error: rejected.error.message }
      }, rejected.deadlineAt).catch(this.#onError).finally(() => {
        this.#activeRejectionResponses -= 1
        this.#drainRejectionResponses()
      })
    }
  }

  #close(reason: Error) {
    if (this.#released) return false
    this.#released = true
    this.#rejectionResponseQueue.length = 0
    for (const controller of this.#activeRequestControllers) controller.abort(reason)
    this.#activeRequestControllers.clear()
    return true
  }

  async #respondWithRetry(body: RuntimeBrokerHttpRequest, deadlineAt?: number) {
    let delayMs = 250
    while (!this.#released) {
      const remainingMs = deadlineAt == null ? undefined : deadlineAt - Date.now()
      if (remainingMs != null && remainingMs <= 0) return
      try {
        await this.#client.request(body, {
          timeoutMs: remainingMs == null
            ? this.#controlRequestTimeoutMs
            : Math.max(1, Math.min(this.#controlRequestTimeoutMs, remainingMs))
        })
        return
      } catch (error) {
        if (
          error instanceof RuntimeBrokerRemoteError &&
          (error.code === 'lease_not_found' || error.code === 'request_not_found')
        ) return
        if (!isRetryableTransportError(error)) throw error
        if (this.#released) return
        this.#onError(error)
        const retryRemainingMs = deadlineAt == null ? undefined : deadlineAt - Date.now()
        if (retryRemainingMs != null && retryRemainingMs <= 0) return
        await new Promise(resolve =>
          setTimeout(
            resolve,
            retryRemainingMs == null ? delayMs : Math.min(delayMs, retryRemainingMs)
          )
        )
        delayMs = Math.min(delayMs * 2, 5_000)
      }
    }
  }

  async #requestWithRetry<T>(
    body: RuntimeBrokerHttpRequest,
    requestTimeoutMs = this.#invokeRequestTimeoutMs
  ): Promise<T> {
    let delayMs = 250
    while (!this.#released) {
      try {
        return await this.#client.request<T>(body, { timeoutMs: requestTimeoutMs })
      } catch (error) {
        if (!isRetryableTransportError(error)) throw error
        this.#onError(error)
        await new Promise(resolve => setTimeout(resolve, delayMs))
        delayMs = Math.min(delayMs * 2, 5_000)
      }
    }
    throw new RuntimeBrokerRemoteError('lease_closed', 'Runtime broker lease was released.')
  }
}
