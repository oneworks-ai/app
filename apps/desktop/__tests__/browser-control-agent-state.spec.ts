import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBrowserControlAgentState } from '../src/main/browser-control-agent-state'

const fakePage = (id: number, panelPageId: string) => {
  const webContents = Object.assign(new EventEmitter(), { id })
  return {
    hostWebContentsId: 90,
    id: `page_${id}`,
    panelPageId,
    registered_at: new Date(id).toISOString(),
    session_id: 'session-a',
    title: `Page ${id}`,
    url: `https://example.test/${id}`,
    webContents
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('browser control Agent tab state', () => {
  it('isolates concurrent pages and keeps consecutive same-page actions from flashing idle', async () => {
    vi.useFakeTimers()
    let now = 0
    const transitions: Array<{ pageId: string; state: Record<string, unknown> }> = []
    const state = createBrowserControlAgentState({
      activeDwellMs: 20,
      delay: async ms => {
        now += ms
      },
      now: () => now,
      restoreDwellMs: 40,
      sendState: async (_workspace, page, next) => {
        transitions.push({ pageId: page.id, state: next })
      }
    })
    const firstPage = fakePage(1, 'panel-one')
    const secondPage = fakePage(2, 'panel-two')
    const first = await state.begin({
      action: 'click',
      color: '#625BF6',
      driverInstanceId: 'driver-a',
      page: firstPage as never,
      phase: 'moving',
      workspaceFolder: '/workspace'
    })
    const second = await state.begin({
      action: 'scroll',
      color: '#0EA5E9',
      driverInstanceId: 'driver-b',
      page: secondPage as never,
      phase: 'acting',
      workspaceFolder: '/workspace'
    })

    await state.settle(first, 'succeeded')
    const consecutive = await state.begin({
      action: 'type',
      color: '#625BF6',
      driverInstanceId: 'driver-a',
      page: firstPage as never,
      phase: 'moving',
      workspaceFolder: '/workspace'
    })
    await vi.advanceTimersByTimeAsync(40)

    expect(transitions.filter(transition => transition.pageId === 'page_1' && transition.state.phase === 'idle'))
      .toHaveLength(0)
    expect(state.getActiveCount()).toBe(2)
    await state.settle(consecutive, 'succeeded')
    await state.settle(second, 'succeeded')
    await vi.advanceTimersByTimeAsync(40)

    expect(transitions.filter(transition => transition.state.phase === 'idle').map(transition => transition.pageId))
      .toEqual(['page_1', 'page_2'])
    expect(state.getActiveCount()).toBe(0)
  })

  it('restores on main-frame/SPA navigation, guest destruction, driver release, and broker disposal', async () => {
    const transitions: Array<{ pageId: string; phase: string }> = []
    const state = createBrowserControlAgentState({
      sendState: async (_workspace, page, next) => {
        transitions.push({ pageId: page.id, phase: next.phase })
      }
    })
    const navigationPage = fakePage(3, 'panel-navigation')
    const spaPage = fakePage(10, 'panel-spa-navigation')
    const destroyedPage = fakePage(4, 'panel-destroyed')
    const releasedPage = fakePage(5, 'panel-released')
    const disposedPage = fakePage(6, 'panel-disposed')

    await state.begin({
      action: 'click',
      color: '#625BF6',
      driverInstanceId: 'driver-navigation',
      page: navigationPage as never,
      phase: 'moving',
      workspaceFolder: '/workspace'
    })
    navigationPage.webContents.emit('did-start-navigation', {}, 'https://next.test', false, true)
    await vi.waitFor(() => expect(state.getActiveCount()).toBe(0))

    await state.begin({
      action: 'click',
      color: '#625BF6',
      driverInstanceId: 'driver-spa-navigation',
      page: spaPage as never,
      phase: 'moving',
      workspaceFolder: '/workspace'
    })
    spaPage.webContents.emit('did-navigate-in-page', {}, 'https://example.test/10#next', true)
    await vi.waitFor(() => expect(state.getActiveCount()).toBe(0))

    await state.begin({
      action: 'press_key',
      color: '#625BF6',
      driverInstanceId: 'driver-destroyed',
      page: destroyedPage as never,
      phase: 'acting',
      workspaceFolder: '/workspace'
    })
    destroyedPage.webContents.emit('destroyed')
    await vi.waitFor(() => expect(state.getActiveCount()).toBe(0))

    await state.begin({
      action: 'scroll',
      color: '#625BF6',
      driverInstanceId: 'driver-release',
      page: releasedPage as never,
      phase: 'acting',
      workspaceFolder: '/workspace'
    })
    await state.begin({
      action: 'type',
      color: '#625BF6',
      driverInstanceId: 'driver-dispose',
      page: disposedPage as never,
      phase: 'moving',
      workspaceFolder: '/workspace'
    })
    await expect(state.releaseDriver('/workspace', 'driver-release')).resolves.toEqual({
      ok: true,
      restored_pages: 1
    })
    expect(state.getActiveCount()).toBe(1)
    await state.dispose()
    expect(state.getActiveCount()).toBe(0)
    expect(transitions.filter(transition => transition.phase === 'idle').map(transition => transition.pageId))
      .toEqual(['page_3', 'page_10', 'page_4', 'page_5', 'page_6'])
  })

  it('does not operate after the host rejects the initial visible state', async () => {
    const sent: string[] = []
    const state = createBrowserControlAgentState({
      sendState: async (_workspace, _page, next) => {
        sent.push(next.phase)
        if (next.phase !== 'idle') throw new Error('renderer unavailable')
      }
    })

    await expect(state.begin({
      action: 'select',
      color: '#625BF6',
      driverInstanceId: 'driver-a',
      page: fakePage(7, 'panel-failed') as never,
      phase: 'moving',
      workspaceFolder: '/workspace'
    })).rejects.toMatchObject({ code: 'AGENT_ACTION_STATUS_UNAVAILABLE' })
    expect(sent).toEqual(['moving', 'idle'])
    expect(state.getActiveCount()).toBe(0)
  })

  it('clears the previous lease if a successor cannot reach the renderer', async () => {
    const sent: Array<{ operationId: string; phase: string }> = []
    const state = createBrowserControlAgentState({
      sendState: async (_workspace, _page, next) => {
        sent.push({ operationId: next.operation_id, phase: next.phase })
        if (next.operation_id === 'operation-successor' && next.phase !== 'idle') {
          throw new Error('renderer unavailable')
        }
      }
    })
    const page = fakePage(11, 'panel-successor-failed')
    await state.begin({
      action: 'click',
      color: '#625BF6',
      driverInstanceId: 'driver-a',
      operationId: 'operation-previous',
      page: page as never,
      phase: 'moving',
      workspaceFolder: '/workspace'
    })

    await expect(state.begin({
      action: 'type',
      color: '#625BF6',
      driverInstanceId: 'driver-a',
      operationId: 'operation-successor',
      page: page as never,
      phase: 'moving',
      workspaceFolder: '/workspace'
    })).rejects.toMatchObject({ code: 'AGENT_ACTION_STATUS_UNAVAILABLE' })

    expect(sent.slice(-2)).toEqual([
      { operationId: 'operation-successor', phase: 'idle' },
      { operationId: 'operation-previous', phase: 'idle' }
    ])
    expect(state.getActiveCount()).toBe(0)
  })

  it('settles a failed action before restoring its favicon', async () => {
    vi.useFakeTimers()
    let now = 0
    const transitions: Array<Record<string, unknown>> = []
    const state = createBrowserControlAgentState({
      activeDwellMs: 20,
      delay: async ms => {
        now += ms
      },
      now: () => now,
      restoreDwellMs: 40,
      sendState: async (_workspace, _page, next) => {
        transitions.push(next)
      }
    })
    const lease = await state.begin({
      action: 'type',
      color: '#625BF6',
      driverInstanceId: 'driver-failed',
      page: fakePage(8, 'panel-failed-action') as never,
      phase: 'moving',
      workspaceFolder: '/workspace'
    })

    await state.settle(lease, 'failed')
    await vi.advanceTimersByTimeAsync(40)

    expect(transitions).toEqual([
      expect.objectContaining({ action: 'type', phase: 'moving' }),
      expect.objectContaining({ action: 'type', outcome: 'failed', phase: 'settle' }),
      expect.objectContaining({ phase: 'idle' })
    ])
    expect(state.getActiveCount()).toBe(0)
  })

  it('cancels an exact operation immediately without letting a stale lease clear its successor', async () => {
    const transitions: Array<Record<string, unknown>> = []
    const state = createBrowserControlAgentState({
      sendState: async (_workspace, _page, next) => {
        transitions.push(next)
      }
    })
    const page = fakePage(9, 'panel-cancelled')
    await state.begin({
      action: 'click',
      color: '#625BF6',
      driverInstanceId: 'driver-cancel',
      operationId: 'operation-stale',
      page: page as never,
      phase: 'moving',
      workspaceFolder: '/workspace'
    })
    await state.begin({
      action: 'type',
      color: '#625BF6',
      driverInstanceId: 'driver-cancel',
      operationId: 'operation-current',
      page: page as never,
      phase: 'moving',
      workspaceFolder: '/workspace'
    })

    await expect(state.releaseDriver('/workspace', 'driver-cancel', 'operation-stale')).resolves.toEqual({
      ok: true,
      restored_pages: 0
    })
    expect(state.getActiveCount()).toBe(1)
    expect(transitions.some(transition => transition.phase === 'idle')).toBe(false)

    await expect(state.releaseDriver('/workspace', 'driver-cancel', 'operation-current')).resolves.toEqual({
      ok: true,
      restored_pages: 1
    })
    expect(state.getActiveCount()).toBe(0)
    expect(transitions.at(-1)).toEqual({ operation_id: 'operation-current', phase: 'idle' })
  })

  it('remembers cancellation that arrives before an operation begins', async () => {
    const transitions: Array<Record<string, unknown>> = []
    const state = createBrowserControlAgentState({
      sendState: async (_workspace, _page, next) => {
        transitions.push(next)
      }
    })
    const page = fakePage(12, 'panel-release-before-begin')

    await expect(state.releaseDriver('/workspace', 'driver-pre-release', 'operation-cancelled')).resolves.toEqual({
      ok: true,
      restored_pages: 0
    })
    await expect(state.begin({
      action: 'click',
      color: '#625BF6',
      driverInstanceId: 'driver-pre-release',
      operationId: 'operation-cancelled',
      page: page as never,
      phase: 'moving',
      workspaceFolder: '/workspace'
    })).rejects.toMatchObject({ code: 'BROWSER_CONTROL_CANCELLED' })
    expect(transitions).toEqual([])

    const successor = await state.begin({
      action: 'type',
      color: '#625BF6',
      driverInstanceId: 'driver-pre-release',
      operationId: 'operation-successor',
      page: page as never,
      phase: 'moving',
      workspaceFolder: '/workspace'
    })
    expect(successor.operationId).toBe('operation-successor')
    await state.releaseDriver('/workspace', 'driver-pre-release', 'operation-successor')

    await state.releaseDriver('/workspace', 'driver-disconnected')
    await expect(state.begin({
      action: 'scroll',
      color: '#625BF6',
      driverInstanceId: 'driver-disconnected',
      operationId: 'operation-after-disconnect',
      page: fakePage(13, 'panel-driver-release-before-begin') as never,
      phase: 'acting',
      workspaceFolder: '/workspace'
    })).rejects.toMatchObject({ code: 'BROWSER_CONTROL_CANCELLED' })
  })

  it('rechecks cancellation after the renderer acknowledges the initial moving state', async () => {
    let acknowledgeMoving: (() => void) | undefined
    const transitions: string[] = []
    const state = createBrowserControlAgentState({
      sendState: async (_workspace, _page, next) => {
        transitions.push(next.phase)
        if (next.phase === 'moving') {
          await new Promise<void>(resolve => {
            acknowledgeMoving = resolve
          })
        }
      }
    })
    const begin = state.begin({
      action: 'click',
      color: '#625BF6',
      driverInstanceId: 'driver-delayed-ack',
      operationId: 'operation-delayed-ack',
      page: fakePage(14, 'panel-delayed-ack') as never,
      phase: 'moving',
      workspaceFolder: '/workspace'
    })
    await vi.waitFor(() => expect(acknowledgeMoving).toBeTypeOf('function'))

    await expect(state.releaseDriver(
      '/workspace',
      'driver-delayed-ack',
      'operation-delayed-ack'
    )).resolves.toEqual({ ok: true, restored_pages: 1 })
    acknowledgeMoving?.()

    await expect(begin).rejects.toMatchObject({ code: 'BROWSER_CONTROL_CANCELLED' })
    expect(transitions).toEqual(['moving', 'idle'])
    expect(state.getActiveCount()).toBe(0)
  })
})
