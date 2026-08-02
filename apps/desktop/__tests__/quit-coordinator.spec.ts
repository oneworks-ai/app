import { describe, expect, it, vi } from 'vitest'

import { createDesktopQuitCoordinator } from '../src/main/quit-coordinator'

describe('desktop quit coordinator', () => {
  it('waits for one shared shutdown before allowing a repeated quit event', async () => {
    let resolveShutdown: (() => void) | undefined
    const shutdown = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        resolveShutdown = resolve
      })
    })
    const quit = vi.fn()
    const setIsQuitting = vi.fn()
    const coordinator = createDesktopQuitCoordinator({
      onShutdownError: vi.fn(),
      quit,
      setIsQuitting,
      shutdown
    })
    const firstEvent = { preventDefault: vi.fn() }
    const repeatedEvent = { preventDefault: vi.fn() }

    coordinator.handleBeforeQuit(firstEvent)
    coordinator.handleBeforeQuit(repeatedEvent)

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
    expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce()
    expect(shutdown).toHaveBeenCalledOnce()
    expect(quit).not.toHaveBeenCalled()

    resolveShutdown?.()
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())

    const allowedEvent = { preventDefault: vi.fn() }
    coordinator.handleBeforeQuit(allowedEvent)
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled()
  })

  it('keeps the app open and allows retry when shutdown fails', async () => {
    const error = new Error('server did not stop')
    const shutdown = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined)
    const quit = vi.fn()
    const onShutdownError = vi.fn()
    const setIsQuitting = vi.fn()
    const coordinator = createDesktopQuitCoordinator({
      onShutdownError,
      quit,
      setIsQuitting,
      shutdown
    })

    coordinator.handleBeforeQuit({ preventDefault: vi.fn() })
    await vi.waitFor(() => expect(onShutdownError).toHaveBeenCalledWith(error))
    expect(quit).not.toHaveBeenCalled()
    expect(setIsQuitting).toHaveBeenLastCalledWith(false)

    coordinator.handleBeforeQuit({ preventDefault: vi.fn() })
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())
    expect(shutdown).toHaveBeenCalledTimes(2)
  })
})
