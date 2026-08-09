/* eslint-disable max-lines -- lease ownership, delivery, timeout, and cleanup form one lifecycle state machine. */
import { randomUUID } from 'node:crypto'

import type {
  RuntimeBrokerAcquireInput,
  RuntimeBrokerAcquireResult,
  RuntimeBrokerDriver,
  RuntimeBrokerDriverCallbackContext,
  RuntimeBrokerDriverLease,
  RuntimeBrokerEventEnvelope,
  RuntimeBrokerPollResult
} from './types'

const DEFAULT_LEASE_TTL_MS = 60_000
const DEFAULT_ACQUIRE_TIMEOUT_MS = 110_000
const DEFAULT_POLL_TIMEOUT_MS = 20_000
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_MAX_QUEUE_SIZE = 512
const DEFAULT_MAX_CALLBACK_ENTRIES = 64
const DEFAULT_MAX_CALLBACK_PRINCIPALS = 64
const DEFAULT_MAX_CALLBACK_RETENTION_MS = 720_000
const DEFAULT_MAX_CONCURRENT_ACQUIRES = 64
const DEFAULT_CALLBACK_TIMEOUT_TOMBSTONE_MS = 10_000
const DEFAULT_CLEANUP_TIMEOUT_MS = 5_000
const MAX_TIMER_TIMEOUT_MS = 2_147_483_647
const MAX_QUEUE_SIZE = 4_096
const MAX_CALLBACK_ENTRIES = 4_096
const MAX_CALLBACK_PRINCIPALS = 4_096
const MAX_CONCURRENT_ACQUIRES = 1_024

export class RuntimeBrokerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'RuntimeBrokerError'
  }
}

const readBoundedInteger = (
  name: string,
  value: number,
  minimum: number,
  maximum: number,
  code = 'invalid_broker_options'
) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RuntimeBrokerError(
      code,
      `Runtime broker ${name} must be an integer between ${minimum} and ${maximum}.`
    )
  }
  return value
}

interface PendingRequest {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

interface IdempotentOperation {
  promise: Promise<unknown>
  settled: boolean
}

interface CallbackOperation extends IdempotentOperation {
  cancel(error: Error): void
  executionTimer: ReturnType<typeof setTimeout>
  expiryTimer: ReturnType<typeof setTimeout>
  leaseId?: string
  principalKey: string
  terminal: boolean
}

interface InflightAcquire {
  cancel(error: Error): void
  finished: Promise<void>
}

interface LeaseState {
  completedRequests: Set<string>
  cursor: number
  driverId: string
  driverLease: RuntimeBrokerDriverLease
  events: RuntimeBrokerEventEnvelope[]
  invocations: Map<string, IdempotentOperation>
  lastSeenAt: number
  ownerId: string
  pendingRequests: Map<string, PendingRequest>
  pollWaiters: Set<() => void>
  profileKey: string
  ready: boolean
  releasing?: Promise<void>
}

export interface RuntimeBrokerOptions {
  acquireTimeoutMs?: number
  cleanupTimeoutMs?: number
  leaseTtlMs?: number
  maxCallbackEntries?: number
  maxCallbackPrincipals?: number
  maxCallbackRetentionMs?: number
  maxQueueSize?: number
  maxConcurrentAcquires?: number
  now?: () => number
  onError?: (error: unknown) => void
  pollTimeoutMs?: number
  requestTimeoutMs?: number
}

export class RuntimeBroker {
  readonly #acquireTimeoutMs: number
  readonly #callbackPrincipalCounts = new Map<string, number>()
  readonly #callbacks = new Map<string, CallbackOperation>()
  readonly #cleanupTimeoutMs: number
  #disposePromise: Promise<void> | undefined
  #disposed = false
  readonly #drivers = new Map<string, RuntimeBrokerDriver>()
  readonly #inflightAcquires = new Set<InflightAcquire>()
  readonly #inflightCallbacks = new Set<Promise<unknown>>()
  readonly #leases = new Map<string, LeaseState>()
  readonly #leaseTtlMs: number
  readonly #maxCallbackEntries: number
  readonly #maxCallbackPrincipals: number
  readonly #maxCallbackRetentionMs: number
  readonly #maxConcurrentAcquires: number
  readonly #maxQueueSize: number
  readonly #now: () => number
  readonly #onError: (error: unknown) => void
  readonly #pollTimeoutMs: number
  readonly #requestTimeoutMs: number
  readonly #sweepTimer: ReturnType<typeof setInterval>

  constructor(options: RuntimeBrokerOptions = {}) {
    this.#acquireTimeoutMs = readBoundedInteger(
      'acquire timeout',
      options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS,
      1,
      MAX_TIMER_TIMEOUT_MS
    )
    this.#cleanupTimeoutMs = readBoundedInteger(
      'cleanup timeout',
      options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS,
      1,
      MAX_TIMER_TIMEOUT_MS
    )
    this.#leaseTtlMs = readBoundedInteger(
      'lease TTL',
      options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS,
      1,
      MAX_TIMER_TIMEOUT_MS
    )
    this.#maxCallbackEntries = readBoundedInteger(
      'callback entry capacity',
      options.maxCallbackEntries ?? DEFAULT_MAX_CALLBACK_ENTRIES,
      1,
      MAX_CALLBACK_ENTRIES
    )
    this.#maxCallbackPrincipals = readBoundedInteger(
      'callback principal capacity',
      options.maxCallbackPrincipals ?? DEFAULT_MAX_CALLBACK_PRINCIPALS,
      1,
      MAX_CALLBACK_PRINCIPALS
    )
    this.#maxCallbackRetentionMs = readBoundedInteger(
      'callback retention',
      options.maxCallbackRetentionMs ?? DEFAULT_MAX_CALLBACK_RETENTION_MS,
      1,
      MAX_TIMER_TIMEOUT_MS
    )
    this.#maxConcurrentAcquires = readBoundedInteger(
      'concurrent acquire capacity',
      options.maxConcurrentAcquires ?? DEFAULT_MAX_CONCURRENT_ACQUIRES,
      1,
      MAX_CONCURRENT_ACQUIRES
    )
    this.#maxQueueSize = readBoundedInteger(
      'queue capacity',
      options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE,
      1,
      MAX_QUEUE_SIZE
    )
    this.#now = options.now ?? Date.now
    this.#onError = options.onError ?? (() => undefined)
    this.#pollTimeoutMs = readBoundedInteger(
      'poll timeout',
      options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
      0,
      MAX_TIMER_TIMEOUT_MS
    )
    this.#requestTimeoutMs = readBoundedInteger(
      'request timeout',
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      1,
      MAX_TIMER_TIMEOUT_MS,
      'invalid_request_timeout'
    )
    this.#sweepTimer = setInterval(() => {
      void this.sweepStaleLeases()
    }, Math.max(1_000, Math.min(this.#leaseTtlMs, 10_000)))
    this.#sweepTimer.unref?.()
  }

  registerDriver(driver: RuntimeBrokerDriver) {
    this.#assertOpen()
    const id = driver.id.trim()
    if (id === '') throw new RuntimeBrokerError('invalid_driver', 'Runtime broker driver id is required.')
    if (this.#drivers.has(id)) {
      throw new RuntimeBrokerError('driver_exists', `Runtime broker driver "${id}" is already registered.`)
    }
    this.#drivers.set(id, driver)
    return () => {
      if (this.#drivers.get(id) === driver) this.#drivers.delete(id)
    }
  }

  async acquire(ownerId: string, input: RuntimeBrokerAcquireInput): Promise<RuntimeBrokerAcquireResult> {
    this.#assertOpen()
    const driver = this.#drivers.get(input.driverId)
    if (driver == null) {
      throw new RuntimeBrokerError('driver_not_found', `Runtime broker driver "${input.driverId}" is not registered.`)
    }
    if (input.profileKey.trim() === '') {
      throw new RuntimeBrokerError('invalid_profile', 'Runtime broker profile key is required.')
    }
    if (this.#inflightAcquires.size >= this.#maxConcurrentAcquires) {
      throw new RuntimeBrokerError(
        'acquire_capacity',
        'Runtime broker acquisition capacity is exhausted; retry after an in-flight acquisition finishes.'
      )
    }

    const leaseId = randomUUID()
    const state: LeaseState = {
      completedRequests: new Set(),
      cursor: 0,
      driverId: driver.id,
      driverLease: undefined as unknown as RuntimeBrokerDriverLease,
      events: [],
      invocations: new Map(),
      lastSeenAt: this.#now(),
      ownerId,
      pendingRequests: new Map(),
      pollWaiters: new Set(),
      profileKey: input.profileKey,
      ready: false
    }
    const controller = new AbortController()
    let finishAcquire!: () => void
    const finished = new Promise<void>(resolve => {
      finishAcquire = resolve
    })
    let cancelAcquire!: (error: Error) => void
    let cancelled = false
    const cancellation = new Promise<never>((_resolve, reject) => {
      cancelAcquire = (error) => {
        if (cancelled) return
        cancelled = true
        controller.abort(error)
        reject(error)
      }
    })
    const inflightAcquire: InflightAcquire = { cancel: cancelAcquire, finished }
    this.#inflightAcquires.add(inflightAcquire)
    const acquireTimer = setTimeout(() => {
      cancelAcquire(
        new RuntimeBrokerError(
          'acquire_timeout',
          `Runtime broker acquisition timed out after ${this.#acquireTimeoutMs}ms.`
        )
      )
    }, this.#acquireTimeoutMs)
    acquireTimer.unref?.()
    const context = {
      emit: (name: string, payload?: unknown) => this.#enqueue(state, 'event', name, payload),
      leaseId,
      ownerId,
      profileKey: input.profileKey,
      request: (name: string, payload?: unknown, options?: { timeoutMs?: number }) => {
        if (!state.ready) {
          return Promise.reject(
            new RuntimeBrokerError(
              'lease_not_ready',
              'Runtime broker drivers cannot request workspace input during acquisition.'
            )
          )
        }
        return this.#request(state, name, payload, options?.timeoutMs)
      },
      signal: controller.signal
    }
    let driverAcquire: Promise<RuntimeBrokerDriverLease>
    try {
      driverAcquire = Promise.resolve(driver.acquire(input.payload, context))
    } catch (error) {
      driverAcquire = Promise.reject(error)
    }
    let acquireWon = false

    try {
      state.driverLease = await Promise.race([driverAcquire, cancellation])
      acquireWon = true
      if (this.#disposed) {
        await this.#runCleanup(
          () => state.driverLease.release(),
          `Runtime broker late lease "${leaseId}" cleanup timed out.`
        )
        throw new RuntimeBrokerError('broker_disposed', 'Runtime broker was disposed during lease acquisition.')
      }
      state.ready = true
      this.#touch(state)
      this.#leases.set(leaseId, state)
      return { leaseId, metadata: state.driverLease.metadata }
    } catch (error) {
      if (!controller.signal.aborted) controller.abort(error)
      if (!acquireWon) {
        void driverAcquire.then(async lease =>
          await this.#runCleanup(
            () => lease.release(),
            `Runtime broker late lease "${leaseId}" cleanup timed out.`
          )
        ).catch(this.#onError)
      }
      for (const pending of state.pendingRequests.values()) {
        clearTimeout(pending.timer)
        pending.reject(new RuntimeBrokerError('acquire_failed', 'Runtime lease acquisition failed.'))
      }
      throw error
    } finally {
      clearTimeout(acquireTimer)
      this.#inflightAcquires.delete(inflightAcquire)
      finishAcquire()
    }
  }

  async invoke<T = unknown>(
    ownerId: string,
    leaseId: string,
    operation: string,
    payload?: unknown,
    invocationId?: string
  ): Promise<T> {
    const state = this.#getOwnedLease(ownerId, leaseId)
    this.#touch(state)
    if (invocationId == null || invocationId === '') {
      return await state.driverLease.invoke(operation, payload) as T
    }
    return await this.#runIdempotentOperation(
      state.invocations,
      invocationId,
      () => state.driverLease.invoke(operation, payload)
    ) as T
  }

  async poll(
    ownerId: string,
    leaseId: string,
    afterCursor = 0,
    timeoutMs = this.#pollTimeoutMs
  ): Promise<RuntimeBrokerPollResult> {
    const state = this.#getOwnedLease(ownerId, leaseId)
    this.#touch(state)
    const readAvailable = () => {
      const earliestCursor = state.events[0]?.cursor
      if (earliestCursor != null && earliestCursor > afterCursor + 1) {
        throw new RuntimeBrokerError(
          'event_gap',
          'Runtime broker event cursor fell behind the bounded delivery queue.'
        )
      }
      return state.events.filter(event => event.cursor > afterCursor)
    }
    let events = readAvailable()
    if (events.length === 0 && timeoutMs > 0) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          state.pollWaiters.delete(done)
          resolve()
        }
        const timer = setTimeout(done, Math.min(timeoutMs, this.#pollTimeoutMs))
        state.pollWaiters.add(done)
      })
      events = readAvailable()
    }
    this.#touch(state)
    return {
      events,
      nextCursor: events.at(-1)?.cursor ?? afterCursor
    }
  }

  respond(ownerId: string, leaseId: string, requestId: string, result: unknown) {
    const state = this.#getOwnedLease(ownerId, leaseId)
    this.#touch(state)
    if (state.completedRequests.has(requestId)) return
    const pending = state.pendingRequests.get(requestId)
    if (pending == null) {
      throw new RuntimeBrokerError('request_not_found', 'Runtime broker request is no longer pending.')
    }
    state.pendingRequests.delete(requestId)
    clearTimeout(pending.timer)
    state.completedRequests.add(requestId)
    this.#trimSet(state.completedRequests)
    pending.resolve(result)
  }

  async callback(
    driverId: string,
    payload: unknown,
    context: RuntimeBrokerDriverCallbackContext,
    options: { executionTimeoutMs?: number; retentionMs?: number } = {}
  ) {
    this.#assertOpen()
    const driver = this.#drivers.get(driverId)
    if (driver?.callback == null) {
      throw new RuntimeBrokerError('callback_not_found', `Runtime broker driver "${driverId}" has no callback handler.`)
    }
    if (context.callbackId == null || context.callbackId === '') {
      throw new RuntimeBrokerError('invalid_callback', 'Runtime broker callback id is required.')
    }
    this.#assertCallbackLease(driverId, context)
    const callback = this.#runCallbackOperation(
      driverId,
      context,
      signal => driver.callback!(payload, { ...context, signal }),
      options
    )
    this.#inflightCallbacks.add(callback)
    try {
      return await callback
    } finally {
      this.#inflightCallbacks.delete(callback)
    }
  }

  acknowledgeCallback(driverId: string, context: RuntimeBrokerDriverCallbackContext) {
    this.#assertOpen()
    if (context.callbackId == null || context.callbackId === '') {
      throw new RuntimeBrokerError('invalid_callback', 'Runtime broker callback id is required.')
    }
    const callbackKey = this.#callbackKey(driverId, context)
    const operation = this.#callbacks.get(callbackKey)
    if (operation == null) return
    if (!operation.settled) {
      throw new RuntimeBrokerError('callback_in_flight', 'Runtime broker callback is still in flight.')
    }
    if (operation.terminal) return
    this.#deleteCallback(callbackKey, operation)
  }

  async release(ownerId: string, leaseId: string) {
    const state = this.#getOwnedLease(ownerId, leaseId)
    await this.#releaseState(leaseId, state, 'Runtime broker lease released.')
  }

  async sweepStaleLeases() {
    const cutoff = this.#now() - this.#leaseTtlMs
    await Promise.all(
      [...this.#leases.entries()]
        .filter(([, state]) => state.lastSeenAt < cutoff)
        .map(([leaseId, state]) => this.#releaseState(leaseId, state, 'Runtime broker lease expired.'))
    )
  }

  async dispose() {
    if (this.#disposePromise != null) return await this.#disposePromise
    this.#disposed = true
    clearInterval(this.#sweepTimer)
    const drivers = [...this.#drivers.values()]
    this.#drivers.clear()
    const disposeError = new RuntimeBrokerError('broker_disposed', 'Runtime broker is disposed.')
    for (const acquisition of this.#inflightAcquires) acquisition.cancel(disposeError)
    for (const operation of this.#callbacks.values()) operation.cancel(disposeError)
    this.#disposePromise = (async () => {
      await Promise.allSettled([...this.#inflightAcquires].map(acquisition => acquisition.finished))
      const releases = Promise.all(
        [...this.#leases.entries()].map(([leaseId, state]) =>
          this.#releaseState(leaseId, state, 'Runtime broker disposed.')
        )
      )
      const driverCleanup = Promise.all(drivers.map(driver =>
        this.#runCleanup(
          () => driver.dispose?.(),
          `Runtime broker driver "${driver.id}" cleanup timed out.`
        )
      ))
      await Promise.all([
        releases,
        driverCleanup,
        Promise.allSettled([...this.#inflightCallbacks])
      ])
      for (const operation of this.#callbacks.values()) {
        clearTimeout(operation.executionTimer)
        clearTimeout(operation.expiryTimer)
      }
      this.#callbacks.clear()
      this.#callbackPrincipalCounts.clear()
    })()
    await this.#disposePromise
  }

  #assertOpen() {
    if (this.#disposed) throw new RuntimeBrokerError('broker_disposed', 'Runtime broker is disposed.')
  }

  #getOwnedLease(ownerId: string, leaseId: string) {
    const state = this.#leases.get(leaseId)
    if (state == null || state.ownerId !== ownerId) {
      throw new RuntimeBrokerError('lease_not_found', 'Runtime broker lease was not found for this owner.')
    }
    return state
  }

  #touch(state: LeaseState) {
    state.lastSeenAt = this.#now()
  }

  async #runCleanup(task: () => void | Promise<void>, timeoutMessage: string) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const outcome = await Promise.race([
      Promise.resolve().then(task).then(
        () => ({ status: 'fulfilled' as const }),
        error => ({ error, status: 'rejected' as const })
      ),
      new Promise<{ status: 'timed_out' }>(resolve => {
        timer = setTimeout(() => resolve({ status: 'timed_out' }), this.#cleanupTimeoutMs)
      })
    ])
    if (timer != null) clearTimeout(timer)
    if (outcome.status === 'rejected') this.#onError(outcome.error)
    if (outcome.status === 'timed_out') {
      this.#onError(new RuntimeBrokerError('cleanup_timeout', timeoutMessage))
    }
  }

  #callbackKey(driverId: string, context: RuntimeBrokerDriverCallbackContext) {
    return [
      driverId,
      context.profileKey,
      context.leaseId ?? '',
      context.callbackId ?? ''
    ].join('\0')
  }

  #callbackPrincipalKey(driverId: string, context: RuntimeBrokerDriverCallbackContext) {
    return [driverId, context.profileKey, context.leaseId ?? ''].join('\0')
  }

  #assertCallbackLease(driverId: string, context: RuntimeBrokerDriverCallbackContext) {
    if (context.leaseId == null) return
    const lease = this.#leases.get(context.leaseId)
    if (
      lease == null ||
      lease.driverId !== driverId ||
      lease.profileKey !== context.profileKey
    ) {
      throw new RuntimeBrokerError(
        'lease_not_found',
        'Runtime broker callback lease was not found for this driver profile.'
      )
    }
  }

  #deleteCallback(key: string, operation: CallbackOperation) {
    if (this.#callbacks.get(key) !== operation) return
    clearTimeout(operation.executionTimer)
    clearTimeout(operation.expiryTimer)
    this.#callbacks.delete(key)
    const nextCount = (this.#callbackPrincipalCounts.get(operation.principalKey) ?? 1) - 1
    if (nextCount <= 0) this.#callbackPrincipalCounts.delete(operation.principalKey)
    else this.#callbackPrincipalCounts.set(operation.principalKey, nextCount)
  }

  #releaseCallbacksForLease(leaseId: string) {
    for (const [key, operation] of this.#callbacks) {
      if (operation.leaseId !== leaseId) continue
      operation.cancel(new RuntimeBrokerError('lease_closed', 'Runtime broker callback lease was released.'))
      this.#deleteCallback(key, operation)
    }
  }

  #trimSet(collection: Set<string>) {
    while (collection.size > this.#maxQueueSize) {
      const first = collection.keys().next().value
      if (first == null) return
      collection.delete(first)
    }
  }

  #trimCompletedOperations(collection: Map<string, IdempotentOperation>) {
    let completed = [...collection.values()].filter(operation => operation.settled).length
    if (completed <= this.#maxQueueSize) return
    for (const [key, operation] of collection) {
      if (!operation.settled) continue
      collection.delete(key)
      completed -= 1
      if (completed <= this.#maxQueueSize) return
    }
  }

  #runIdempotentOperation(
    collection: Map<string, IdempotentOperation>,
    id: string,
    operation: () => unknown | Promise<unknown>,
    options: { maxEntries?: number } = {}
  ) {
    const existing = collection.get(id)
    if (existing != null) return existing.promise
    if (options.maxEntries != null && collection.size >= options.maxEntries) {
      throw new RuntimeBrokerError(
        'callback_capacity',
        'Runtime broker callback capacity is exhausted; retry after prior callbacks are acknowledged.'
      )
    }
    const entry: IdempotentOperation = {
      promise: Promise.resolve().then(operation),
      settled: false
    }
    collection.set(id, entry)
    void entry.promise.finally(() => {
      entry.settled = true
      if (options.maxEntries == null) this.#trimCompletedOperations(collection)
    }).catch(() => undefined)
    return entry.promise
  }

  #runCallbackOperation(
    driverId: string,
    context: RuntimeBrokerDriverCallbackContext,
    operation: (signal: AbortSignal) => unknown | Promise<unknown>,
    options: { executionTimeoutMs?: number; retentionMs?: number }
  ) {
    const callbackKey = this.#callbackKey(driverId, context)
    const existing = this.#callbacks.get(callbackKey)
    if (existing != null) return existing.promise
    const retentionMs = options.retentionMs ?? this.#maxCallbackRetentionMs
    if (!Number.isSafeInteger(retentionMs) || retentionMs <= 0 || retentionMs > this.#maxCallbackRetentionMs) {
      throw new RuntimeBrokerError(
        'invalid_callback_retention',
        `Runtime broker callback retention must be between 1 and ${this.#maxCallbackRetentionMs}ms.`
      )
    }
    const tombstoneMs = Math.min(
      DEFAULT_CALLBACK_TIMEOUT_TOMBSTONE_MS,
      Math.max(1, Math.floor(retentionMs / 10))
    )
    const executionTimeoutMs = options.executionTimeoutMs ?? Math.max(1, retentionMs - tombstoneMs)
    if (
      !Number.isSafeInteger(executionTimeoutMs) ||
      executionTimeoutMs <= 0 ||
      executionTimeoutMs > retentionMs
    ) {
      throw new RuntimeBrokerError(
        'invalid_callback_timeout',
        'Runtime broker callback execution timeout must be a positive integer within its retention window.'
      )
    }
    const principalKey = this.#callbackPrincipalKey(driverId, context)
    const principalCount = this.#callbackPrincipalCounts.get(principalKey) ?? 0
    if (principalCount === 0 && this.#callbackPrincipalCounts.size >= this.#maxCallbackPrincipals) {
      throw new RuntimeBrokerError(
        'callback_principal_capacity',
        'Runtime broker callback principal capacity is exhausted; retry after an inactive principal is reclaimed.'
      )
    }
    if (principalCount >= this.#maxCallbackEntries) {
      throw new RuntimeBrokerError(
        'callback_capacity',
        'Runtime broker callback capacity is exhausted for this driver profile; retry after prior callbacks expire or are acknowledged.'
      )
    }
    const controller = new AbortController()
    let rejectExecution!: (error: Error) => void
    let cancelled = false
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectExecution = reject
    })
    const driverCallback = Promise.resolve().then(() => operation(controller.signal))
    const entry: CallbackOperation = {
      cancel: (error) => {
        if (cancelled || entry.settled) return
        cancelled = true
        entry.terminal = true
        controller.abort(error)
        rejectExecution(error)
      },
      executionTimer: undefined as unknown as ReturnType<typeof setTimeout>,
      expiryTimer: undefined as unknown as ReturnType<typeof setTimeout>,
      leaseId: context.leaseId,
      principalKey,
      promise: Promise.race([driverCallback, cancellation]),
      settled: false,
      terminal: false
    }
    entry.executionTimer = setTimeout(() => {
      entry.cancel(
        new RuntimeBrokerError(
          'callback_timeout',
          `Runtime broker callback execution timed out after ${executionTimeoutMs}ms.`
        )
      )
    }, executionTimeoutMs)
    entry.executionTimer.unref?.()
    entry.expiryTimer = setTimeout(() => {
      entry.cancel(
        new RuntimeBrokerError(
          'callback_expired',
          `Runtime broker callback retention expired after ${retentionMs}ms.`
        )
      )
      this.#deleteCallback(callbackKey, entry)
    }, retentionMs)
    entry.expiryTimer.unref?.()
    this.#callbacks.set(callbackKey, entry)
    this.#callbackPrincipalCounts.set(principalKey, principalCount + 1)
    void entry.promise.finally(() => {
      entry.settled = true
      clearTimeout(entry.executionTimer)
    }).catch(() => undefined)
    return entry.promise
  }

  #enqueue(
    state: LeaseState,
    kind: RuntimeBrokerEventEnvelope['kind'],
    name: string,
    payload?: unknown,
    requestId?: string,
    requestDeadlineAt?: number
  ) {
    const event: RuntimeBrokerEventEnvelope = {
      cursor: ++state.cursor,
      kind,
      name,
      ...(payload === undefined ? {} : { payload }),
      ...(requestDeadlineAt == null ? {} : { requestDeadlineAt }),
      ...(requestId == null ? {} : { requestId })
    }
    state.events.push(event)
    if (state.events.length > this.#maxQueueSize) {
      state.events.splice(0, state.events.length - this.#maxQueueSize)
    }
    for (const wake of [...state.pollWaiters]) wake()
  }

  #request(state: LeaseState, name: string, payload: unknown, timeoutMs?: number) {
    const requestId = randomUUID()
    const effectiveTimeoutMs = timeoutMs ?? this.#requestTimeoutMs
    if (
      !Number.isSafeInteger(effectiveTimeoutMs) ||
      effectiveTimeoutMs <= 0 ||
      effectiveTimeoutMs > MAX_TIMER_TIMEOUT_MS
    ) {
      return Promise.reject(
        new RuntimeBrokerError(
          'invalid_request_timeout',
          `Runtime broker request timeout must be a positive integer no greater than ${MAX_TIMER_TIMEOUT_MS}ms.`
        )
      )
    }
    if (state.pendingRequests.size >= this.#maxQueueSize) {
      return Promise.reject(
        new RuntimeBrokerError(
          'request_capacity',
          'Runtime broker request capacity is exhausted; retry after a pending request finishes.'
        )
      )
    }
    const requestDeadlineAt = Date.now() + effectiveTimeoutMs
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pendingRequests.delete(requestId)
        reject(new RuntimeBrokerError('request_timeout', `Runtime broker request "${name}" timed out.`))
      }, effectiveTimeoutMs)
      timer.unref?.()
      state.pendingRequests.set(requestId, { reject, resolve, timer })
      this.#enqueue(state, 'request', name, payload, requestId, requestDeadlineAt)
    })
  }

  async #releaseState(leaseId: string, state: LeaseState, reason: string) {
    if (state.releasing != null) return await state.releasing
    state.releasing = (async () => {
      if (this.#leases.get(leaseId) === state) this.#leases.delete(leaseId)
      this.#releaseCallbacksForLease(leaseId)
      for (const wake of [...state.pollWaiters]) wake()
      state.pollWaiters.clear()
      for (const pending of state.pendingRequests.values()) {
        clearTimeout(pending.timer)
        pending.reject(new RuntimeBrokerError('lease_closed', reason))
      }
      state.pendingRequests.clear()
      await this.#runCleanup(
        () => state.driverLease.release(),
        `Runtime broker lease "${leaseId}" cleanup timed out.`
      )
    })().catch((error) => {
      this.#onError(error)
    })
    await state.releasing
  }
}
