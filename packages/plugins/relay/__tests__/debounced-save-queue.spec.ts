import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDebouncedSaveQueue, createSerializedSaveQueue } from '../src/client/debounced-save-queue.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('debounced save queue', () => {
  it('persists only the latest queued value', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const queue = createDebouncedSaveQueue<string>(600)

    queue.schedule('assignment', 'github.com/owner/old', save)
    queue.schedule('assignment', 'github.com/owner/new', save)
    await vi.advanceTimersByTimeAsync(600)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('github.com/owner/new')
  })

  it('flushes pending edits before the owning view is disposed', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const queue = createDebouncedSaveQueue<string>(600)

    queue.schedule('assignment', 'github.com/owner/repo', save)
    queue.flushAll()
    await vi.runAllTimersAsync()

    expect(save).toHaveBeenCalledWith('github.com/owner/repo')
  })

  it('serializes saves and marks superseded failures as stale', async () => {
    let rejectFirst: ((error: Error) => void) | undefined
    const first = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject
    })
    const events: string[] = []
    const queue = createSerializedSaveQueue()
    const firstResult = queue.enqueue('assignment', async () => {
      events.push('first:start')
      await first
    })
    const secondResult = queue.enqueue('assignment', () => {
      events.push('second:start')
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual(['first:start'])
    rejectFirst?.(new Error('old save failed'))

    await expect(firstResult).resolves.toMatchObject({ latest: false, saved: false })
    await queue.waitForIdle('assignment')
    await expect(secondResult).resolves.toEqual({ latest: true, saved: true })
    expect(events).toEqual(['first:start', 'second:start'])
  })

  it('waits for every active save in a shared key prefix', async () => {
    let releaseFirst: (() => void) | undefined
    let releaseSecond: (() => void) | undefined
    const first = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    const second = new Promise<void>(resolve => {
      releaseSecond = resolve
    })
    const queue = createSerializedSaveQueue()
    const events: string[] = []

    void queue.enqueue('account\0team\0profile\0assignment-a', async () => {
      await first
      events.push('assignment-a:saved')
    })
    void queue.enqueue('account\0team\0profile\0assignment-b', async () => {
      await second
      events.push('assignment-b:saved')
    })

    let idle = false
    const waiting = queue.waitForIdleByPrefix('account\0team\0profile\0').then(() => {
      idle = true
    })
    await Promise.resolve()
    releaseFirst?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(idle).toBe(false)

    releaseSecond?.()
    await waiting
    expect(events).toEqual(['assignment-a:saved', 'assignment-b:saved'])
    expect(idle).toBe(true)
  })
})
