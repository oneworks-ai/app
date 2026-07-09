import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDebouncedSaveQueue } from '../src/client/debounced-save-queue.js'

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
})
