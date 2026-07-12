import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { createBrowserControlOperations } from '../src/main/browser-control-operations'

const fakeContents = (id: number) => {
  const emitter = new EventEmitter()
  let activeIndex = 1
  const entries = [
    { pageState: 'private-state-a', title: 'First', url: 'https://example.com/first' },
    { pageState: 'private-state-b', title: 'Second', url: 'https://example.com/second' }
  ]
  return Object.assign(emitter, {
    id,
    disableDeviceEmulation: vi.fn(),
    enableDeviceEmulation: vi.fn(),
    getTitle: vi.fn(() => entries[activeIndex]?.title ?? ''),
    getURL: vi.fn(() => entries[activeIndex]?.url ?? ''),
    getZoomFactor: vi.fn(() => 1),
    isDestroyed: vi.fn(() => false),
    isLoadingMainFrame: vi.fn(() => false),
    navigationHistory: {
      canGoBack: vi.fn(() => activeIndex > 0),
      canGoForward: vi.fn(() => activeIndex < entries.length - 1),
      canGoToOffset: vi.fn((offset: number) => activeIndex + offset >= 0 && activeIndex + offset < entries.length),
      clear: vi.fn(),
      getActiveIndex: vi.fn(() => activeIndex),
      getAllEntries: vi.fn(() => entries),
      goToIndex: vi.fn((index: number) => {
        activeIndex = index
        queueMicrotask(() => emitter.emit('did-finish-load'))
      }),
      goToOffset: vi.fn((offset: number) => {
        activeIndex += offset
        queueMicrotask(() => emitter.emit('did-finish-load'))
      }),
      restore: vi.fn(async () => undefined)
    },
    reload: vi.fn(() => queueMicrotask(() => emitter.emit('did-finish-load'))),
    reloadIgnoringCache: vi.fn(() => queueMicrotask(() => emitter.emit('did-finish-load'))),
    setZoomFactor: vi.fn()
  })
}

const page = (contents: ReturnType<typeof fakeContents>, panelPageId = 'panel-a') => ({
  hostWebContentsId: 90,
  id: `page_${contents.id}`,
  panelPageId,
  registered_at: new Date(contents.id).toISOString(),
  session_id: 'session-a',
  title: contents.getTitle(),
  url: contents.getURL(),
  webContents: contents
})

const operationsFixture = (
  currentPages: Array<ReturnType<typeof page>>,
  sendPageCommand = vi.fn(async () => ({}))
) => {
  const host = { id: 90, isDestroyed: vi.fn(() => false) }
  const pages = {
    listPages: vi.fn(() => currentPages),
    listScopes: vi.fn(() => []),
    resolvePage: vi.fn((_workspace: string, input: { page_id?: string }) => {
      const found = currentPages.find(candidate => candidate.id === input.page_id)
      if (found == null) throw new Error('missing page')
      return found
    })
  }
  return {
    execute: createBrowserControlOperations({
      getWorkspaceHostWebContents: () => [host as never],
      pages: pages as never,
      sendPageCommand
    }).execute,
    host,
    pages,
    sendPageCommand
  }
}

describe('browser control operations', () => {
  it('uses Electron navigationHistory and waits for reload/history completion', async () => {
    const contents = fakeContents(1)
    const fixture = operationsFixture([page(contents)])

    await expect(fixture.execute('/workspace', {
      op: 'get_navigation_state',
      page_id: 'page_1',
      session_id: 'session-a'
    })).resolves.toMatchObject({ can_go_back: true, current_index: 1, total_entries: 2 })
    await expect(fixture.execute('/workspace', {
      direction: 'back',
      op: 'navigate_history',
      page_id: 'page_1',
      session_id: 'session-a'
    })).resolves.toMatchObject({ current_index: 0, navigated: true, target_index: 0 })
    await expect(fixture.execute('/workspace', {
      ignore_cache: true,
      op: 'reload',
      page_id: 'page_1',
      session_id: 'session-a'
    })).resolves.toMatchObject({ ignore_cache: true, ok: true })

    expect(contents.navigationHistory.goToOffset).toHaveBeenCalledWith(-1)
    expect(contents.reloadIgnoringCache).toHaveBeenCalledOnce()
    expect(fixture.sendPageCommand).toHaveBeenCalledOnce()
  })

  it('persists authoritative history after traversal without exposing Electron pageState', async () => {
    const contents = fakeContents(11)
    let acknowledge: ((result: unknown) => void) | undefined
    const sendPageCommand = vi.fn(async () =>
      await new Promise(resolve => {
        acknowledge = resolve
      })
    )
    const fixture = operationsFixture([page(contents)], sendPageCommand)
    let settled = false
    const execution = fixture.execute('/workspace', {
      direction: 'back',
      op: 'navigate_history',
      page_id: 'page_11',
      session_id: 'session-a'
    }).finally(() => {
      settled = true
    })

    await vi.waitFor(() => expect(sendPageCommand).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
    expect(sendPageCommand).toHaveBeenCalledWith(fixture.host, {
      command: {
        active_index: 0,
        current_url: 'https://example.com/first',
        entries: [
          { title: 'First', url: 'https://example.com/first' },
          { title: 'Second', url: 'https://example.com/second' }
        ],
        type: 'sync_navigation_history'
      },
      pageId: 'page_11',
      panelPageId: 'panel-a',
      sessionId: 'session-a'
    })
    expect(JSON.stringify(sendPageCommand.mock.calls[0])).not.toContain('pageState')
    acknowledge?.({ persisted: true })
    await expect(execution).resolves.toMatchObject({
      current_index: 0,
      navigated: true,
      persisted: true
    })
  })

  it('bounds reload acknowledgement when Electron emits no navigation completion', async () => {
    const contents = fakeContents(7)
    contents.reload.mockImplementation(() => undefined)
    const fixture = operationsFixture([page(contents)])

    await expect(fixture.execute('/workspace', {
      op: 'reload',
      page_id: 'page_7',
      session_id: 'session-a',
      timeout_ms: 1
    })).rejects.toMatchObject({ code: 'PAGE_NAVIGATION_TIMEOUT' })
  })

  it('waits for persisted renderer history clearing before clearing Electron history', async () => {
    const contents = fakeContents(8)
    const sendPageCommand = vi.fn(async (_host, request: any) => {
      expect(request.command).toEqual({ type: 'clear_navigation_history' })
      expect(contents.navigationHistory.clear).not.toHaveBeenCalled()
      return { persisted: true }
    })
    const fixture = operationsFixture([page(contents)], sendPageCommand)

    await expect(fixture.execute('/workspace', {
      op: 'clear_navigation_history',
      page_id: 'page_8',
      session_id: 'session-a'
    })).resolves.toMatchObject({ ok: true, persisted: true })
    expect(contents.navigationHistory.clear).toHaveBeenCalledOnce()
  })

  it('waits for close removal and returns replacement ids for duplicate and cross-area move', async () => {
    const oldContents = fakeContents(2)
    oldContents.getZoomFactor.mockReturnValue(1.75)
    const currentPages = [page(oldContents)]
    const replacements = new Map<number, ReturnType<typeof fakeContents>>()
    const sendPageCommand = vi.fn(async (_host, request: any) => {
      if (request.command.type === 'close') {
        currentPages.splice(0)
        return { closed: true }
      }
      const nextContents = fakeContents(request.command.type === 'duplicate' ? 3 : 4)
      replacements.set(nextContents.id, nextContents)
      const next = page(nextContents, request.command.type === 'duplicate' ? 'panel-copy' : 'panel-a')
      if (request.command.type === 'duplicate') currentPages.push(next)
      else currentPages.splice(0, 1, next)
      return {
        page_id_changed: true,
        panel_page_id: next.panelPageId
      }
    })

    let fixture = operationsFixture(currentPages, sendPageCommand)
    await expect(fixture.execute('/workspace', {
      op: 'duplicate_page',
      page_id: 'page_2',
      placement: 'right',
      session_id: 'session-a'
    })).resolves.toMatchObject({ previous_page_id: 'page_2', replacement_page_id: 'page_3' })
    expect(replacements.get(3)?.navigationHistory.restore).toHaveBeenCalledWith({
      entries: oldContents.navigationHistory.getAllEntries(),
      index: 1
    })
    expect(replacements.get(3)?.setZoomFactor).toHaveBeenCalledWith(1.75)

    currentPages.splice(0, currentPages.length, page(oldContents))
    fixture = operationsFixture(currentPages, sendPageCommand)
    await expect(fixture.execute('/workspace', {
      op: 'move_page',
      page_id: 'page_2',
      placement: 'bottom',
      session_id: 'session-a'
    })).resolves.toMatchObject({ previous_page_id: 'page_2', replacement_page_id: 'page_4' })
    expect(replacements.get(4)?.navigationHistory.restore).toHaveBeenCalledWith({
      entries: oldContents.navigationHistory.getAllEntries(),
      index: 1
    })
    expect(replacements.get(4)?.setZoomFactor).toHaveBeenCalledWith(1.75)

    currentPages.splice(0, currentPages.length, page(oldContents))
    fixture = operationsFixture(currentPages, sendPageCommand)
    await expect(fixture.execute('/workspace', {
      op: 'close_page',
      page_id: 'page_2',
      session_id: 'session-a'
    })).resolves.toMatchObject({ closed_page_id: 'page_2', ok: true })
  })

  it('does not wait or replace page_id for a same-area move', async () => {
    const contents = fakeContents(5)
    const currentPages = [page(contents)]
    const sendPageCommand = vi.fn(async () => ({
      moved: false,
      page_id_changed: false,
      panel_page_id: 'panel-a'
    }))
    const fixture = operationsFixture(currentPages, sendPageCommand)
    await expect(fixture.execute('/workspace', {
      op: 'move_page',
      page_id: 'page_5',
      placement: 'right',
      session_id: 'session-a'
    })).resolves.toMatchObject({ replacement_page_id: 'page_5' })
    expect(fixture.pages.listPages).not.toHaveBeenCalled()
  })

  it('returns the replacement id with partial restore details when history restore fails', async () => {
    const oldContents = fakeContents(9)
    const replacement = fakeContents(10)
    replacement.navigationHistory.restore.mockRejectedValue(new Error('history rejected'))
    const currentPages = [page(oldContents)]
    const sendPageCommand = vi.fn(async () => {
      currentPages.push(page(replacement, 'panel-copy'))
      return { page_id_changed: true, panel_page_id: 'panel-copy' }
    })
    const fixture = operationsFixture(currentPages, sendPageCommand)

    await expect(fixture.execute('/workspace', {
      op: 'duplicate_page',
      page_id: 'page_9',
      session_id: 'session-a'
    })).resolves.toMatchObject({
      ok: true,
      replacement_page_id: 'page_10',
      state_restore: {
        errors: [{ code: 'NAVIGATION_HISTORY_RESTORE_FAILED', state: 'navigation_history' }],
        navigation_history: 'failed',
        zoom: 'restored'
      }
    })
    expect(replacement.setZoomFactor).toHaveBeenCalledWith(1)
  })

  it('applies native device emulation and rolls renderer state back on native failure', async () => {
    const contents = fakeContents(6)
    const currentPages = [page(contents)]
    const deviceMode = {
      device_pixel_ratio: 2,
      device_type: 'mobile',
      enabled: true,
      height: 844,
      preset_id: 'iphone-14',
      width: 390,
      zoom: 'auto'
    }
    const sendPageCommand = vi.fn(async (_host, request: any) => ({
      device_mode: request.command.enabled
        ? {
          ...deviceMode,
          ...(request.command.width == null ? {} : { preset_id: 'responsive', width: request.command.width })
        }
        : { ...deviceMode, enabled: false }
    }))
    const fixture = operationsFixture(currentPages, sendPageCommand)

    await expect(fixture.execute('/workspace', {
      enabled: true,
      op: 'set_device_mode',
      page_id: 'page_6',
      session_id: 'session-a'
    })).resolves.toMatchObject({ native_device_emulation: deviceMode })
    expect(contents.enableDeviceEmulation).toHaveBeenCalledWith(expect.objectContaining({
      deviceScaleFactor: 2,
      screenPosition: 'mobile',
      viewSize: { height: 844, width: 390 }
    }))

    contents.enableDeviceEmulation.mockImplementationOnce(() => {
      throw new Error('CDP failed')
    })
    await expect(fixture.execute('/workspace', {
      enabled: true,
      op: 'set_device_mode',
      page_id: 'page_6',
      session_id: 'session-a',
      width: 800
    })).rejects.toMatchObject({ code: 'DEVICE_EMULATION_FAILED' })
    expect(sendPageCommand).toHaveBeenLastCalledWith(
      fixture.host,
      expect.objectContaining({
        command: expect.objectContaining({ enabled: true, type: 'set_device_mode', width: 390 })
      })
    )
  })
})
