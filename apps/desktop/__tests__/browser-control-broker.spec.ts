/* eslint-disable max-lines -- broker integration coverage keeps the full HTTP lifecycle in one suite. */
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  session: { fromPartition: vi.fn(() => ({})) },
  shell: {},
  webContents: { fromId: vi.fn(() => undefined) }
}))

const brokers: Array<{ stop: () => Promise<void> }> = []

afterEach(async () => {
  await Promise.all(brokers.splice(0).map(broker => broker.stop()))
})

const fakeWebContents = (id: number, url = 'https://example.com/') => {
  const emitter = new EventEmitter()
  let activeIndex = 0
  const entries = [{ title: `Page ${id}`, url }]
  return Object.assign(emitter, {
    id,
    capturePage: vi.fn(),
    disableDeviceEmulation: vi.fn(),
    enableDeviceEmulation: vi.fn(),
    executeJavaScript: vi.fn(async () => ({ elements: [], snapshot_id: 's1' })),
    focus: vi.fn(),
    getTitle: vi.fn(() => `Page ${id}`),
    getURL: vi.fn(() => url),
    getZoomFactor: vi.fn(() => 1),
    isDestroyed: vi.fn(() => false),
    isLoadingMainFrame: vi.fn(() => false),
    loadURL: vi.fn(async () => undefined),
    navigationHistory: {
      canGoBack: vi.fn(() => activeIndex > 0),
      canGoForward: vi.fn(() => activeIndex < entries.length - 1),
      canGoToOffset: vi.fn((offset: number) => activeIndex + offset >= 0 && activeIndex + offset < entries.length),
      clear: vi.fn(() => {
        entries.splice(0, Math.max(0, entries.length - 1))
        activeIndex = 0
      }),
      getActiveIndex: vi.fn(() => activeIndex),
      getAllEntries: vi.fn(() => entries),
      goToIndex: vi.fn((index: number) => {
        activeIndex = index
        queueMicrotask(() => emitter.emit('did-finish-load'))
      }),
      goToOffset: vi.fn((offset: number) => {
        activeIndex += offset
        queueMicrotask(() => emitter.emit('did-finish-load'))
      })
    },
    reload: vi.fn(() => queueMicrotask(() => emitter.emit('did-finish-load'))),
    reloadIgnoringCache: vi.fn(() => queueMicrotask(() => emitter.emit('did-finish-load'))),
    sendInputEvent: vi.fn(),
    setZoomFactor: vi.fn(),
    stop: vi.fn()
  })
}

describe('browser control broker', () => {
  it('writes user-only credentials and removes credentials it still owns', async () => {
    const { createBrowserControlBroker } = await import('../src/main/browser-control-broker')
    const workspace = '/credential-workspace'
    const broker = createBrowserControlBroker()
    brokers.push(broker)
    await broker.start()
    const key = createHash('sha256').update(path.resolve(workspace)).digest('hex').slice(0, 24)
    const credentialPath = path.join(tmpdir(), 'oneworks-browser-control', `${key}.json`)
    mkdirSync(path.dirname(credentialPath), { recursive: true })
    writeFileSync(credentialPath, '{}', { mode: 0o644 })
    chmodSync(credentialPath, 0o644)
    broker.getWorkspaceEnv(workspace)
    expect(statSync(credentialPath).mode & 0o777).toBe(0o600)
    await broker.stop()
    expect(existsSync(credentialPath)).toBe(false)
  })

  it('does not let an old broker remove a newer broker credential', async () => {
    const { createBrowserControlBroker } = await import('../src/main/browser-control-broker')
    const workspace = '/shared-credential-workspace'
    const oldBroker = createBrowserControlBroker()
    const newBroker = createBrowserControlBroker()
    brokers.push(oldBroker, newBroker)
    await oldBroker.start()
    const oldToken = oldBroker.getWorkspaceEnv(workspace).__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__
    await newBroker.start()
    const newToken = newBroker.getWorkspaceEnv(workspace).__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__
    expect(newToken).not.toBe(oldToken)
    await oldBroker.stop()
    const key = createHash('sha256').update(path.resolve(workspace)).digest('hex').slice(0, 24)
    const credentialPath = path.join(tmpdir(), 'oneworks-browser-control', `${key}.json`)
    expect(JSON.parse(readFileSync(credentialPath, 'utf8'))).toMatchObject({ token: newToken })
  })

  it('authenticates loopback requests and strictly isolates pages by session', async () => {
    const { createBrowserControlBroker } = await import('../src/main/browser-control-broker')
    const pages = new Map([[1, fakeWebContents(1)], [2, fakeWebContents(2)]])
    const broker = createBrowserControlBroker({
      getWebContentsById: id => pages.get(id) as never,
      listWebviewScopes: () => [
        { registeredAt: 1, sessionKey: 'session-a', webContentsId: 1, workspaceFolder: '/workspace' },
        { registeredAt: 2, sessionKey: 'session-b', webContentsId: 2, workspaceFolder: '/workspace' }
      ]
    })
    brokers.push(broker)
    const baseUrl = await broker.start()
    const token = broker.getWorkspaceEnv('/workspace').__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__
    const response = await fetch(`${baseUrl}/v1/control`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'list_pages', session_id: 'session-a' })
    })
    expect(await response.json()).toMatchObject({
      ok: true,
      pages: [{ id: 'page_1', session_id: 'session-a' }]
    })

    const crossSession = await fetch(`${baseUrl}/v1/control`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'snapshot', page_id: 'page_2', session_id: 'session-a' })
    })
    expect(crossSession.status).toBe(404)
    expect(await crossSession.json()).toMatchObject({ error: { code: 'PAGE_NOT_FOUND' }, ok: false })

    const missingPageId = await fetch(`${baseUrl}/v1/control`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'snapshot', session_id: 'session-a' })
    })
    expect(missingPageId.status).toBe(400)
    expect(await missingPageId.json()).toMatchObject({ error: { code: 'PAGE_ID_REQUIRED' }, ok: false })
  })

  it('matches in_app_browser_open to the renderer registration request id', async () => {
    const { createBrowserControlBroker } = await import('../src/main/browser-control-broker')
    const scopes: any[] = []
    const page = fakeWebContents(7)
    const host = {
      id: 70,
      isDestroyed: vi.fn(() => false),
      send: vi.fn((_channel: string, request: { placement: string; requestId: string }) => {
        expect(request.placement).toBe('right')
        scopes.push({
          controlRequestId: request.requestId,
          registeredAt: Date.now(),
          sessionKey: 'session-a',
          webContentsId: 7,
          workspaceFolder: '/workspace'
        })
      })
    }
    const broker = createBrowserControlBroker({
      getWebContentsById: id => id === 7 ? page as never : undefined,
      getWorkspaceHostWebContents: () => [host as never],
      listWebviewScopes: () => scopes
    })
    brokers.push(broker)
    const baseUrl = await broker.start()
    const token = broker.getWorkspaceEnv('/workspace').__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__
    const response = await fetch(`${baseUrl}/v1/control`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'open_page', session_id: 'session-a', url: 'https://example.com/' })
    })
    expect(await response.json()).toMatchObject({ ok: true, result: { page: { id: 'page_7' }, reused: false } })
    expect(host.send).toHaveBeenCalledOnce()
  })

  it('serializes concurrent new-tab opens through the same host until each scope is registered', async () => {
    const { createBrowserControlBroker } = await import('../src/main/browser-control-broker')
    const scopes: any[] = []
    const pages = new Map<number, ReturnType<typeof fakeWebContents>>()
    const requestIds: string[] = []
    const completedAtSend: number[] = []
    let completed = 0
    const host = {
      id: 71,
      isDestroyed: vi.fn(() => false),
      send: vi.fn((_channel: string, request: { requestId: string }) => {
        requestIds.push(request.requestId)
        completedAtSend.push(completed)
        const webContentsId = 40 + requestIds.length
        setTimeout(() => {
          pages.set(webContentsId, fakeWebContents(webContentsId, `https://example.com/${webContentsId}`))
          scopes.push({
            controlRequestId: request.requestId,
            hostWebContentsId: 71,
            panelPageId: `panel-${webContentsId}`,
            registeredAt: Date.now(),
            sessionKey: 'session-concurrent',
            webContentsId,
            workspaceFolder: '/workspace'
          })
          completed += 1
        }, 5)
      })
    }
    const broker = createBrowserControlBroker({
      getWebContentsById: id => pages.get(id) as never,
      getWorkspaceHostWebContents: () => [host as never],
      listWebviewScopes: () => scopes
    })
    brokers.push(broker)
    const baseUrl = await broker.start()
    const token = broker.getWorkspaceEnv('/workspace').__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__
    const open = async (url: string) =>
      await fetch(`${baseUrl}/v1/control`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          op: 'open_page',
          open_mode: 'new-tab',
          session_id: 'session-concurrent',
          url
        })
      }).then(response => response.json())

    const [first, second] = await Promise.all([
      open('https://example.com/first'),
      open('https://example.com/second')
    ])
    expect(first).toMatchObject({ result: { page: { id: 'page_41' } } })
    expect(second).toMatchObject({ result: { page: { id: 'page_42' } } })
    expect(new Set(requestIds).size).toBe(2)
    expect(completedAtSend).toEqual([0, 1])
  })

  it('forwards an explicit bottom placement to the renderer', async () => {
    const { createBrowserControlBroker } = await import('../src/main/browser-control-broker')
    const scopes: any[] = []
    const page = fakeWebContents(8)
    const host = {
      id: 80,
      isDestroyed: vi.fn(() => false),
      send: vi.fn((_channel: string, request: { placement: string; requestId: string }) => {
        expect(request.placement).toBe('bottom')
        scopes.push({
          controlRequestId: request.requestId,
          registeredAt: Date.now(),
          sessionKey: 'session-a',
          webContentsId: 8,
          workspaceFolder: '/workspace'
        })
      })
    }
    const broker = createBrowserControlBroker({
      getWebContentsById: id => id === 8 ? page as never : undefined,
      getWorkspaceHostWebContents: () => [host as never],
      listWebviewScopes: () => scopes
    })
    brokers.push(broker)
    const baseUrl = await broker.start()
    const token = broker.getWorkspaceEnv('/workspace').__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__
    const response = await fetch(`${baseUrl}/v1/control`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        op: 'open_page',
        placement: 'bottom',
        session_id: 'session-a',
        url: 'https://example.com/'
      })
    })
    expect(await response.json()).toMatchObject({ ok: true, result: { page: { id: 'page_8' } } })
  })

  it('routes open_page only to the host already owning the requested session', async () => {
    const { createBrowserControlBroker } = await import('../src/main/browser-control-broker')
    const scopes: any[] = [{
      hostWebContentsId: 102,
      panelPageId: 'existing-page',
      registeredAt: 1,
      sessionKey: 'session-routed',
      webContentsId: 10,
      workspaceFolder: '/workspace'
    }]
    const pages = new Map([[10, fakeWebContents(10)], [11, fakeWebContents(11)]])
    const wrongHost = { id: 101, isDestroyed: vi.fn(() => false), send: vi.fn() }
    const owningHost = {
      id: 102,
      isDestroyed: vi.fn(() => false),
      send: vi.fn((_channel: string, request: { requestId: string }) =>
        scopes.push({
          controlRequestId: request.requestId,
          hostWebContentsId: 102,
          panelPageId: 'opened-page',
          registeredAt: 2,
          sessionKey: 'session-routed',
          webContentsId: 11,
          workspaceFolder: '/workspace'
        })
      )
    }
    const broker = createBrowserControlBroker({
      getWebContentsById: id => pages.get(id) as never,
      getWorkspaceHostWebContents: () => [wrongHost as never, owningHost as never],
      listWebviewScopes: () => scopes
    })
    brokers.push(broker)
    const baseUrl = await broker.start()
    const token = broker.getWorkspaceEnv('/workspace').__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__
    const response = await fetch(`${baseUrl}/v1/control`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'open_page', session_id: 'session-routed', url: 'https://example.com/new' })
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ result: { page: { id: 'page_11' } } })
    expect(owningHost.send).toHaveBeenCalledOnce()
    expect(wrongHost.send).not.toHaveBeenCalled()
  })

  it('reveals an existing page in its owning renderer tab', async () => {
    const { createBrowserControlBroker } = await import('../src/main/browser-control-broker')
    const page = fakeWebContents(12)
    const host = {
      id: 21,
      isDestroyed: vi.fn(() => false),
      send: vi.fn()
    }
    const sendPageCommand = vi.fn(async () => ({ shown: true }))
    const broker = createBrowserControlBroker({
      getWebContentsById: id => id === 12 ? page as never : undefined,
      getWorkspaceHostWebContents: () => [host as never],
      listWebviewScopes: () => [{
        hostWebContentsId: 21,
        panelPageId: 'iframe-controlled-page',
        registeredAt: 1,
        sessionKey: 'session-show',
        webContentsId: 12,
        workspaceFolder: '/workspace'
      }],
      sendPageCommand
    })
    brokers.push(broker)
    const baseUrl = await broker.start()
    const token = broker.getWorkspaceEnv('/workspace').__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__
    const response = await fetch(`${baseUrl}/v1/control`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'show_page', page_id: 'page_12', session_id: 'session-show' })
    })

    expect(await response.json()).toMatchObject({ ok: true, result: { page: { id: 'page_12' } } })
    expect(sendPageCommand).toHaveBeenCalledWith(host, {
      command: { type: 'show' },
      pageId: 'page_12',
      panelPageId: 'iframe-controlled-page',
      sessionId: 'session-show'
    })
    expect(page.loadURL).not.toHaveBeenCalled()
  })

  it('restores the tab Agent state when the owning browser driver disconnects', async () => {
    const { createBrowserControlBroker } = await import('../src/main/browser-control-broker')
    const page = fakeWebContents(13)
    const host = { id: 22, isDestroyed: vi.fn(() => false) }
    const transitions: string[] = []
    const sendPageCommand = vi.fn(async (_host, request: any) => {
      if (request.command.type === 'set_agent_action_state') {
        transitions.push(request.command.state.phase)
      }
      return { applied: true }
    })
    const broker = createBrowserControlBroker({
      getWebContentsById: id => id === 13 ? page as never : undefined,
      getWorkspaceHostWebContents: () => [host as never],
      listWebviewScopes: () => [{
        hostWebContentsId: 22,
        panelPageId: 'iframe-agent-page',
        registeredAt: 1,
        sessionKey: 'session-agent',
        webContentsId: 13,
        workspaceFolder: '/workspace'
      }],
      sendPageCommand
    })
    brokers.push(broker)
    const baseUrl = await broker.start()
    const token = broker.getWorkspaceEnv('/workspace').__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__
    const control = async (body: Record<string, unknown>) =>
      await fetch(`${baseUrl}/v1/control`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          driver_instance_id: 'driver-agent',
          session_id: 'session-agent',
          ...body
        })
      }).then(response => response.json())

    await control({ op: 'snapshot', page_id: 'page_13' })
    expect(await control({ op: 'click', page_id: 'page_13', ref: 's1e1' })).toMatchObject({ ok: true })
    expect(await control({ op: 'release_agent_action_state' })).toMatchObject({
      ok: true,
      result: { ok: true, restored_pages: 1 }
    })
    expect(transitions).toEqual(['moving', 'settle', 'idle'])
  })

  it('rejects an operation whose exact cancellation arrived before begin', async () => {
    const { createBrowserControlBroker } = await import('../src/main/browser-control-broker')
    const page = fakeWebContents(14)
    const host = { id: 24, isDestroyed: vi.fn(() => false) }
    const transitions: string[] = []
    const broker = createBrowserControlBroker({
      getWebContentsById: id => id === 14 ? page as never : undefined,
      getWorkspaceHostWebContents: () => [host as never],
      listWebviewScopes: () => [{
        hostWebContentsId: 24,
        panelPageId: 'iframe-release-before-begin',
        registeredAt: 1,
        sessionKey: 'session-release-before-begin',
        webContentsId: 14,
        workspaceFolder: '/workspace'
      }],
      sendPageCommand: vi.fn(async (_host, request: any) => {
        if (request.command.type === 'set_agent_action_state') transitions.push(request.command.state.phase)
        return { applied: true }
      })
    })
    brokers.push(broker)
    const baseUrl = await broker.start()
    const token = broker.getWorkspaceEnv('/workspace').__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__
    const control = async (body: Record<string, unknown>) =>
      await fetch(`${baseUrl}/v1/control`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          agent_operation_id: 'operation-pre-cancelled',
          driver_instance_id: 'driver-pre-cancelled',
          page_id: 'page_14',
          session_id: 'session-release-before-begin',
          ...body
        })
      })

    expect(await control({ op: 'release_agent_action_state' }).then(response => response.json())).toMatchObject({
      ok: true,
      result: { restored_pages: 0 }
    })
    await control({ op: 'snapshot' })
    const cancelled = await control({ op: 'click', ref: 's1e1' })
    expect(cancelled.status).toBe(409)
    expect(await cancelled.json()).toMatchObject({
      error: { code: 'BROWSER_CONTROL_CANCELLED' },
      ok: false
    })
    expect(transitions).toEqual([])
    expect(page.executeJavaScript).toHaveBeenCalledOnce()
  })

  it('closes the Agent-state gate before broker stop drains an in-flight moving acknowledgement', async () => {
    const { createBrowserControlBroker } = await import('../src/main/browser-control-broker')
    const page = fakeWebContents(15)
    const host = { id: 25, isDestroyed: vi.fn(() => false) }
    const transitions: string[] = []
    let acknowledgeMoving: (() => void) | undefined
    const broker = createBrowserControlBroker({
      getWebContentsById: id => id === 15 ? page as never : undefined,
      getWorkspaceHostWebContents: () => [host as never],
      listWebviewScopes: () => [{
        hostWebContentsId: 25,
        panelPageId: 'iframe-stop-inflight',
        registeredAt: 1,
        sessionKey: 'session-stop-inflight',
        webContentsId: 15,
        workspaceFolder: '/workspace'
      }],
      sendPageCommand: vi.fn(async (_host, request: any) => {
        if (request.command.type !== 'set_agent_action_state') return { applied: true }
        transitions.push(request.command.state.phase)
        if (request.command.state.phase === 'moving') {
          await new Promise<void>(resolve => {
            acknowledgeMoving = resolve
          })
        }
        return { applied: true }
      })
    })
    brokers.push(broker)
    const baseUrl = await broker.start()
    const token = broker.getWorkspaceEnv('/workspace').__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__
    const control = async (body: Record<string, unknown>) =>
      await fetch(`${baseUrl}/v1/control`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          driver_instance_id: 'driver-stop-inflight',
          page_id: 'page_15',
          session_id: 'session-stop-inflight',
          ...body
        })
      })

    await control({ op: 'snapshot' })
    const click = control({
      agent_operation_id: 'operation-stop-inflight',
      op: 'click',
      ref: 's1e1'
    })
    await vi.waitFor(() => expect(acknowledgeMoving).toBeTypeOf('function'))
    const stop = broker.stop()
    await vi.waitFor(() => expect(transitions).toEqual(['moving', 'idle']))
    acknowledgeMoving?.()

    const cancelled = await click
    expect(cancelled.status).toBe(409)
    expect(await cancelled.json()).toMatchObject({ error: { code: 'BROWSER_CONTROL_CANCELLED' }, ok: false })
    await stop
    expect(page.executeJavaScript).toHaveBeenCalledOnce()
  })

  it('renders the shared Browser Driver cursor inside the controlled page', async () => {
    const { createBrowserControlBroker } = await import('../src/main/browser-control-broker')
    const page = fakeWebContents(9)
    const host = { id: 23, isDestroyed: vi.fn(() => false) }
    const broker = createBrowserControlBroker({
      getWebContentsById: id => id === 9 ? page as never : undefined,
      getWorkspaceHostWebContents: () => [host as never],
      listWebviewScopes: () => [{
        hostWebContentsId: 23,
        panelPageId: 'iframe-cursor-page',
        registeredAt: 1,
        sessionKey: 'session-cursor',
        webContentsId: 9,
        workspaceFolder: '/workspace'
      }],
      sendPageCommand: vi.fn(async () => ({ applied: true }))
    })
    brokers.push(broker)
    const baseUrl = await broker.start()
    const token = broker.getWorkspaceEnv('/workspace').__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__
    const control = async (body: Record<string, unknown>) =>
      await fetch(`${baseUrl}/v1/control`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          ...body,
          driver_instance_id: 'driver-cursor',
          page_id: 'page_9',
          session_id: 'session-cursor'
        })
      })

    expect((await control({ op: 'snapshot' })).status).toBe(200)
    expect((await control({ op: 'click', ref: 's1e1' })).status).toBe(200)

    const actionScript = page.executeJavaScript.mock.calls[1]?.[0]
    expect(actionScript).toContain('__oneworks_browser_driver_cursor')
    expect(actionScript).toContain('data-oneworks-browser-driver-click-ripple')
    expect(actionScript).toContain('Math.min(900, Math.max(360')
    expect(actionScript).toContain("rippleHost.style.position = 'fixed'")
    expect(actionScript).toContain('duration: 680')
    expect(actionScript).toContain('<svg')
    expect(actionScript).toContain('rotate(-135 32 32)')
    expect(actionScript).not.toContain('__oneworks_demo_video_cursor')
    expect(actionScript.indexOf('void playCursorFeedback(true)')).toBeLessThan(actionScript.indexOf('element.click()'))
    expect(actionScript).not.toContain('await playCursorFeedback(true)')

    expect((await control({ op: 'scroll', y: 640 })).status).toBe(200)
    const scrollScript = page.executeJavaScript.mock.calls[2]?.[0]
    expect(scrollScript).toContain('requestAnimationFrame')
    expect(scrollScript).toContain('Math.min(1000, Math.max(480')
    expect(scrollScript).toContain("behavior: 'instant'")
  })
})
