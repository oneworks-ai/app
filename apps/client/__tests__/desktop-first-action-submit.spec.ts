import { describe, expect, it, vi } from 'vitest'

import { createDesktopFirstActionSubmitCoordinator } from '#~/diagnostics/desktop-first-action-submit'

const ACTION_ID = 'client-action-00000000-0000-4000-8000-000000000001'

describe('desktop first-action submit coordinator', () => {
  it('propagates one anonymous action ID and accepts it only after transport success', async () => {
    const begin = vi.fn(() => ACTION_ID)
    const accepted = vi.fn()
    const submitted = vi.fn()
    const coordinator = createDesktopFirstActionSubmitCoordinator({ accepted, begin, submitted })
    const transport = vi.fn(async (clientActionId?: string) => ({ clientActionId }))

    await expect(coordinator.submit('session-1', transport)).resolves.toEqual({ clientActionId: ACTION_ID })

    expect(begin).toHaveBeenCalledWith('session-1')
    expect(transport).toHaveBeenCalledWith(ACTION_ID)
    expect(accepted).toHaveBeenCalledWith('session-1', ACTION_ID)
    expect(begin.mock.invocationCallOrder[0]).toBeLessThan(transport.mock.invocationCallOrder[0]!)
    expect(transport.mock.invocationCallOrder[0]).toBeLessThan(accepted.mock.invocationCallOrder[0]!)
    expect(submitted).not.toHaveBeenCalled()
  })

  it('resumes an existing optimistic action and never accepts a rejected transport', async () => {
    const begin = vi.fn()
    const accepted = vi.fn()
    const submitted = vi.fn(() => true)
    const coordinator = createDesktopFirstActionSubmitCoordinator({ accepted, begin, submitted })
    const failure = new Error('request failed')

    await expect(coordinator.submit(
      'session-1',
      async clientActionId => {
        expect(clientActionId).toBe(ACTION_ID)
        throw failure
      },
      ACTION_ID
    )).rejects.toBe(failure)

    expect(submitted).toHaveBeenCalledWith('session-1', ACTION_ID)
    expect(begin).not.toHaveBeenCalled()
    expect(accepted).not.toHaveBeenCalled()
  })
})
