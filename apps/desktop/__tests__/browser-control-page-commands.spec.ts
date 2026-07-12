import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  completeBrowserControlPageCommand,
  sendBrowserControlPageCommand
} from '../src/main/browser-control-page-commands'

const fakeHost = (id: number, send: (channel: string, input: any) => void) =>
  Object.assign(
    new EventEmitter(),
    {
      id,
      isDestroyed: vi.fn(() => false),
      send: vi.fn(send)
    }
  )

const command = (type: 'get_page_view_state' | 'show' = 'show') => ({
  command: { type } as const,
  pageId: 'page_1',
  panelPageId: 'panel-1',
  sessionId: 'session-1'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('browser control page commands', () => {
  it('cleans up and rejects when renderer delivery throws', async () => {
    const host = fakeHost(1, () => {
      throw new Error('renderer unavailable')
    })
    await expect(sendBrowserControlPageCommand(host as never, command())).rejects.toMatchObject({
      code: 'PAGE_COMMAND_SEND_FAILED'
    })
  })

  it('rejects a pending command when its host is destroyed', async () => {
    const host = fakeHost(2, () => undefined)
    const pending = sendBrowserControlPageCommand(host as never, command())
    const rejected = expect(pending).rejects.toMatchObject({ code: 'WORKSPACE_WINDOW_UNAVAILABLE' })
    await vi.waitFor(() => expect(host.send).toHaveBeenCalledOnce())
    host.emit('destroyed')
    await rejected
  })

  it('validates completions and only accepts the owning renderer', async () => {
    let requestId = ''
    const host = fakeHost(3, (_channel, input) => {
      requestId = input.requestId
    })
    const pending = sendBrowserControlPageCommand(host as never, command())
    await vi.waitFor(() => expect(requestId).not.toBe(''))

    expect(() => completeBrowserControlPageCommand(4, { ok: true, requestId })).toThrowError(
      expect.objectContaining({ code: 'PAGE_COMMAND_OWNER_MISMATCH' })
    )
    expect(completeBrowserControlPageCommand(3, { ok: true, requestId, result: { shown: true } }))
      .toEqual({ accepted: true })
    await expect(pending).resolves.toEqual({ shown: true })
    expect(() => completeBrowserControlPageCommand(3, { requestId })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PAGE_COMMAND_COMPLETION' })
    )
  })

  it('serializes UI mutations per host while allowing acknowledged progress', async () => {
    const requestIds: string[] = []
    const host = fakeHost(5, (_channel, input) => requestIds.push(input.requestId))
    const first = sendBrowserControlPageCommand(host as never, command('show'))
    const second = sendBrowserControlPageCommand(host as never, command('show'))
    await vi.waitFor(() => expect(requestIds).toHaveLength(1))

    completeBrowserControlPageCommand(5, { ok: true, requestId: requestIds[0], result: 1 })
    await expect(first).resolves.toBe(1)
    await vi.waitFor(() => expect(requestIds).toHaveLength(2))
    completeBrowserControlPageCommand(5, { ok: true, requestId: requestIds[1], result: 2 })
    await expect(second).resolves.toBe(2)
  })

  it('bounds unacknowledged commands with a timeout', async () => {
    vi.useFakeTimers()
    const host = fakeHost(6, () => undefined)
    const pending = sendBrowserControlPageCommand(host as never, command('get_page_view_state'), { timeoutMs: 20 })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'PAGE_COMMAND_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(21)
    await rejected
  })
})
