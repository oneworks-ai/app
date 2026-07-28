import { afterEach, describe, expect, it, vi } from 'vitest'

import { RELAY_SERVER_INFO_REFRESH_INTERVAL_MS, startRelayServerInfoPolling } from '../src/client/react-view.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('relay server info polling', () => {
  it('refreshes without overlapping polling rounds', async () => {
    vi.useFakeTimers()
    let resolveFirst: ((value: { online: boolean }) => void) | undefined
    const load = vi.fn()
      .mockImplementationOnce(async () =>
        await new Promise<{ online: boolean }>(resolve => {
          resolveFirst = resolve
        })
      )
      .mockResolvedValue({ online: true })
    const onValue = vi.fn()
    const dispose = startRelayServerInfoPolling({
      load,
      onValue,
      serverKeys: ['official']
    })

    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(RELAY_SERVER_INFO_REFRESH_INTERVAL_MS * 2)
    expect(load).toHaveBeenCalledTimes(1)

    resolveFirst?.({ online: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(onValue).toHaveBeenCalledWith('official', { online: false })

    await vi.advanceTimersByTimeAsync(RELAY_SERVER_INFO_REFRESH_INTERVAL_MS)
    expect(load).toHaveBeenCalledTimes(2)
    expect(onValue).toHaveBeenLastCalledWith('official', { online: true })

    dispose()
    await vi.advanceTimersByTimeAsync(RELAY_SERVER_INFO_REFRESH_INTERVAL_MS)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('retries failed requests and ignores values after disposal', async () => {
    vi.useFakeTimers()
    let resolveAfterDisposal: ((value: { online: boolean }) => void) | undefined
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(async () =>
        await new Promise<{ online: boolean }>(resolve => {
          resolveAfterDisposal = resolve
        })
      )
    const onValue = vi.fn()
    const dispose = startRelayServerInfoPolling({
      load,
      onValue,
      serverKeys: ['official']
    })

    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(RELAY_SERVER_INFO_REFRESH_INTERVAL_MS)
    expect(load).toHaveBeenCalledTimes(2)

    dispose()
    resolveAfterDisposal?.({ online: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(onValue).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(RELAY_SERVER_INFO_REFRESH_INTERVAL_MS)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
