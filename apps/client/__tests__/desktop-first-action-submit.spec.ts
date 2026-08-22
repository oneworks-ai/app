import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '#~/api/base'
import { createDesktopFirstActionSubmitCoordinator } from '#~/diagnostics/desktop-first-action/submit'

const ACTION_ID = 'client-action-00000000-0000-4000-8000-000000000001'

describe('desktop first-action submit coordinator', () => {
  it('propagates one anonymous action ID and accepts it only after transport success', async () => {
    const begin = vi.fn(() => ACTION_ID)
    const accepted = vi.fn()
    const failed = vi.fn()
    const submitted = vi.fn()
    const terminated = vi.fn()
    const uncertain = vi.fn()
    const coordinator = createDesktopFirstActionSubmitCoordinator({
      accepted,
      begin,
      failed,
      submitted,
      terminated,
      uncertain
    })
    const transport = vi.fn(async (clientActionId?: string) => ({ clientActionId }))

    await expect(coordinator.submit('session-1', transport)).resolves.toEqual({ clientActionId: ACTION_ID })

    expect(begin).toHaveBeenCalledWith('session-1')
    expect(transport).toHaveBeenCalledWith(ACTION_ID)
    expect(accepted).toHaveBeenCalledWith('session-1', ACTION_ID)
    expect(begin.mock.invocationCallOrder[0]).toBeLessThan(transport.mock.invocationCallOrder[0]!)
    expect(transport.mock.invocationCallOrder[0]).toBeLessThan(accepted.mock.invocationCallOrder[0]!)
    expect(submitted).not.toHaveBeenCalled()
    expect(failed).not.toHaveBeenCalled()
    expect(terminated).not.toHaveBeenCalled()
    expect(uncertain).not.toHaveBeenCalled()
  })

  it('keeps an existing optimistic action pending when transport acknowledgement is uncertain', async () => {
    const begin = vi.fn()
    const accepted = vi.fn()
    const failed = vi.fn()
    const submitted = vi.fn(() => true)
    const terminated = vi.fn()
    const uncertain = vi.fn()
    const coordinator = createDesktopFirstActionSubmitCoordinator({
      accepted,
      begin,
      failed,
      submitted,
      terminated,
      uncertain
    })
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
    expect(failed).not.toHaveBeenCalled()
    expect(uncertain).toHaveBeenCalledWith('session-1', ACTION_ID)
  })

  it('fails an action after an explicit server rejection', async () => {
    const begin = vi.fn(() => ACTION_ID)
    const lifecycle = {
      accepted: vi.fn(),
      begin,
      failed: vi.fn(),
      submitted: vi.fn(),
      terminated: vi.fn(),
      uncertain: vi.fn()
    }
    const coordinator = createDesktopFirstActionSubmitCoordinator(lifecycle)
    const failure = new ApiError(400, { code: 'invalid_request', message: 'Rejected.' })

    await expect(coordinator.submit('session-1', async () => {
      throw failure
    })).rejects.toBe(failure)

    expect(lifecycle.failed).toHaveBeenCalledWith('session-1', ACTION_ID)
    expect(lifecycle.uncertain).not.toHaveBeenCalled()
    expect(lifecycle.accepted).not.toHaveBeenCalled()
  })

  it('treats a client request timeout as acknowledgement-uncertain', async () => {
    const lifecycle = {
      accepted: vi.fn(),
      begin: vi.fn(() => ACTION_ID),
      failed: vi.fn(),
      submitted: vi.fn(),
      terminated: vi.fn(),
      uncertain: vi.fn()
    }
    const coordinator = createDesktopFirstActionSubmitCoordinator(lifecycle)
    const failure = new ApiError(408, { code: 'request_timeout', message: 'Timed out.' })

    await expect(coordinator.submit('session-1', async () => {
      throw failure
    })).rejects.toBe(failure)

    expect(lifecycle.uncertain).toHaveBeenCalledWith('session-1', ACTION_ID)
    expect(lifecycle.failed).not.toHaveBeenCalled()
  })

  it.each([
    [408, 'proxy_timeout'],
    [502, 'bad_gateway'],
    [503, 'service_unavailable'],
    [504, 'gateway_timeout']
  ])('keeps HTTP %s acknowledgement uncertain', async (status, code) => {
    const lifecycle = {
      accepted: vi.fn(),
      begin: vi.fn(() => ACTION_ID),
      failed: vi.fn(),
      submitted: vi.fn(),
      terminated: vi.fn(),
      uncertain: vi.fn()
    }
    const coordinator = createDesktopFirstActionSubmitCoordinator(lifecycle)
    const failure = new ApiError(status, { code, message: 'Upstream response is uncertain.' })

    await expect(coordinator.submit('session-1', async () => {
      throw failure
    })).rejects.toBe(failure)

    expect(lifecycle.uncertain).toHaveBeenCalledWith('session-1', ACTION_ID)
    expect(lifecycle.failed).not.toHaveBeenCalled()
  })

  it('terminates a creation cancelled by the user', async () => {
    const lifecycle = {
      accepted: vi.fn(),
      begin: vi.fn(() => ACTION_ID),
      failed: vi.fn(),
      submitted: vi.fn(),
      terminated: vi.fn(),
      uncertain: vi.fn()
    }
    const coordinator = createDesktopFirstActionSubmitCoordinator(lifecycle)
    const failure = new ApiError(409, {
      code: 'session_creation_cancelled',
      message: 'Creation cancelled.'
    })

    await expect(coordinator.submit('session-1', async () => {
      throw failure
    })).rejects.toBe(failure)

    expect(lifecycle.terminated).toHaveBeenCalledWith('session-1', ACTION_ID)
    expect(lifecycle.failed).not.toHaveBeenCalled()
    expect(lifecycle.uncertain).not.toHaveBeenCalled()
  })
})
