import type { Dispatch, SetStateAction } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  createLauncherWorkspaceOpenController,
  createLauncherWorkspaceOpenControllerOwner
} from '#~/routes/launcher-workspace-open-lifecycle'
import type { LauncherOpeningWorkspace } from '#~/routes/launcher-workspace-open-lifecycle'

const deferred = <Result>() => {
  let reject!: (reason?: unknown) => void
  let resolve!: (value: Result) => void
  const promise = new Promise<Result>((resolvePromise, rejectPromise) => {
    reject = rejectPromise
    resolve = resolvePromise
  })
  return { promise, reject, resolve }
}

const createHarness = () => {
  let opening: LauncherOpeningWorkspace | undefined
  const setOpeningWorkspace: Dispatch<SetStateAction<LauncherOpeningWorkspace | undefined>> = (update) => {
    opening = typeof update === 'function' ? update(opening) : update
  }
  return {
    controller: createLauncherWorkspaceOpenController({ setOpeningWorkspace }),
    opening: () => opening
  }
}

describe('launcher workspace open lifecycle', () => {
  it('invalidates synchronously and suppresses every late settlement effect', async () => {
    const request = deferred<string>()
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const harness = createHarness()
    const lease = harness.controller.acquire()

    const settlement = harness.controller.open({
      execute: () => request.promise,
      lease,
      onError,
      onSuccess,
      opening: { name: 'Old', path: '/old' }
    })
    expect(harness.opening()).toEqual({ name: 'Old', path: '/old' })

    harness.controller.invalidate()
    expect(lease.isCurrent()).toBe(false)
    expect(harness.opening()).toBeUndefined()
    request.resolve('late')

    await expect(settlement).resolves.toBe(false)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('reuses one preparation lease into open while a reopen retires the older chain', async () => {
    const firstRequest = deferred<string>()
    const secondRequest = deferred<string>()
    const firstSuccess = vi.fn()
    const firstError = vi.fn()
    const secondSuccess = vi.fn()
    const harness = createHarness()
    const firstLease = harness.controller.acquire()

    const firstSettlement = harness.controller.open({
      execute: () => firstRequest.promise,
      lease: firstLease,
      onError: firstError,
      onSuccess: firstSuccess,
      opening: { name: 'First', path: '/first' }
    })
    const secondLease = harness.controller.acquire()
    const secondSettlement = harness.controller.open({
      execute: () => secondRequest.promise,
      lease: secondLease,
      onError: vi.fn(),
      onSuccess: secondSuccess,
      opening: { name: 'Second', path: '/second' }
    })
    expect(firstLease.isCurrent()).toBe(false)
    expect(harness.opening()).toEqual({ name: 'Second', path: '/second' })

    firstRequest.reject(new Error('late failure'))
    await expect(firstSettlement).resolves.toBe(false)
    expect(firstSuccess).not.toHaveBeenCalled()
    expect(firstError).not.toHaveBeenCalled()
    expect(harness.opening()).toEqual({ name: 'Second', path: '/second' })

    secondRequest.resolve('current')
    await expect(secondSettlement).resolves.toBe(true)
    expect(secondSuccess).toHaveBeenCalledWith('current')
    expect(harness.opening()).toBeUndefined()
  })

  it('runs registered preparation cleanup exactly once on invalidation', () => {
    const harness = createHarness()
    const cleanup = vi.fn()
    const lease = harness.controller.acquire()
    lease.onInvalidate(cleanup)

    harness.controller.invalidate()
    harness.controller.invalidate()

    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('keeps concurrent activation observers current across exclusive actions until the activation closes', () => {
    const harness = createHarness()
    const firstCleanup = vi.fn()
    const secondCleanup = vi.fn()
    const firstObserver = harness.controller.observeActivation()
    const secondObserver = harness.controller.observeActivation()
    firstObserver.onInvalidate(firstCleanup)
    secondObserver.onInvalidate(secondCleanup)

    const firstLease = harness.controller.acquire()
    const secondLease = harness.controller.acquire()

    expect(firstLease.isCurrent()).toBe(false)
    expect(secondLease.isCurrent()).toBe(true)
    expect(firstObserver.isCurrent()).toBe(true)
    expect(secondObserver.isCurrent()).toBe(true)

    firstObserver.release()
    expect(firstObserver.isCurrent()).toBe(false)
    expect(firstCleanup).toHaveBeenCalledTimes(1)
    expect(secondObserver.isCurrent()).toBe(true)

    harness.controller.invalidate()
    expect(secondLease.isCurrent()).toBe(false)
    expect(secondObserver.isCurrent()).toBe(false)
    expect(secondCleanup).toHaveBeenCalledTimes(1)
  })

  it('retires old observers without affecting a reopened activation observer', () => {
    const harness = createHarness()
    const oldObserver = harness.controller.observeActivation()

    harness.controller.invalidate()
    const reopenedObserver = harness.controller.observeActivation()

    expect(oldObserver.isCurrent()).toBe(false)
    expect(reopenedObserver.isCurrent()).toBe(true)
    oldObserver.release()
    expect(reopenedObserver.isCurrent()).toBe(true)
  })

  it('allows the overlay owner to invalidate only the attached route controller', () => {
    const owner = createLauncherWorkspaceOpenControllerOwner()
    const first = createHarness()
    const second = createHarness()
    const firstLease = first.controller.acquire()
    const detachFirst = owner.attach(first.controller)
    void first.controller.open({
      execute: () => new Promise<string>(() => undefined),
      lease: firstLease,
      onError: vi.fn(),
      onSuccess: vi.fn(),
      opening: { name: 'First', path: '/first' }
    })
    detachFirst()
    const secondLease = second.controller.acquire()
    owner.attach(second.controller)
    void second.controller.open({
      execute: () => new Promise<string>(() => undefined),
      lease: secondLease,
      onError: vi.fn(),
      onSuccess: vi.fn(),
      opening: { name: 'Second', path: '/second' }
    })

    owner.invalidate()

    expect(first.opening()).toEqual({ name: 'First', path: '/first' })
    expect(second.opening()).toBeUndefined()
  })
})
