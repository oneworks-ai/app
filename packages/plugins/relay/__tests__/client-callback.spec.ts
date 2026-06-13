import { afterEach, describe, expect, it, vi } from 'vitest'

import { activatePlugin } from '../src/client/index.js'
import { buildPluginHomeWebLoginRedirectUri, buildWebLoginRedirectUri } from '../src/client/login-callback.js'
import { DEFAULT_OFFICIAL_RELAY_SERVER_ID } from '../src/shared/official-services.js'

interface FakeLocation {
  hash: string
  href: string
  search: string
}

class FakeElement {
  constructor(public dataset: Record<string, string> = {}) {}

  closest(selector: string) {
    return selector === '[data-action]' ? this : null
  }
}

class FakeContainer {
  innerHTML = ''
  listeners = new Map<string, EventListener>()

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener)
  }

  removeEventListener(type: string, listener: EventListener) {
    if (this.listeners.get(type) === listener) {
      this.listeners.delete(type)
    }
  }

  clickAction(action: string, serverId?: string) {
    const listener = this.listeners.get('click')
    expect(listener).toBeDefined()
    listener?.({
      target: new FakeElement({
        action,
        ...(serverId == null ? {} : { serverId })
      })
    } as unknown as Event)
  }
}

const flushPromises = async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  await new Promise<void>(resolve => setTimeout(resolve, 0))
}

const updateLocation = (location: FakeLocation, nextHref: string) => {
  const url = new URL(nextHref)
  location.href = url.toString()
  location.search = url.search
  location.hash = url.hash
}

const installBrowser = (href: string, input: {
  clientBase?: string
  desktop?: boolean
  open?: ReturnType<typeof vi.fn>
} = {}) => {
  const location: FakeLocation = {
    hash: new URL(href).hash,
    href,
    search: new URL(href).search
  }
  const open = input.open ?? vi.fn(() => ({}))
  const windowValue = {
    history: {
      replaceState: vi.fn((_state: unknown, _title: string, nextHref: string) => updateLocation(location, nextHref))
    },
    location,
    open,
    ...(input.desktop === true ? { oneworksDesktop: {} } : {})
  }
  const styleElement = {
    remove: vi.fn(),
    textContent: ''
  }

  vi.stubGlobal('Element', FakeElement)
  vi.stubGlobal('window', windowValue)
  if (input.clientBase != null) {
    vi.stubGlobal('__ONEWORKS_PROJECT_RUNTIME_ENV__', {
      __ONEWORKS_PROJECT_CLIENT_BASE__: input.clientBase
    })
  }
  vi.stubGlobal('document', {
    createElement: vi.fn(() => styleElement),
    head: {
      appendChild: vi.fn()
    }
  })
  return {
    location,
    open
  }
}

const createClientHarness = async (apiFetch: ReturnType<typeof vi.fn>) => {
  let renderHome: ((container: HTMLElement) => { dispose: () => void } | void) | undefined
  const commands = new Map<string, (payload?: unknown) => unknown | Promise<unknown>>()
  const cleanup = await activatePlugin({
    scope: 'relay',
    api: {
      fetch: apiFetch
    },
    commands: {
      register: vi.fn((commandId, handler) => {
        commands.set(commandId, handler)
        return { dispose: vi.fn() }
      })
    },
    views: {
      register: vi.fn((viewId: string, renderer: typeof renderHome) => {
        if (viewId === 'home') renderHome = renderer
        return { dispose: vi.fn() }
      })
    }
  })
  expect(renderHome).toBeDefined()
  return {
    commands,
    cleanup,
    renderHome: renderHome as (container: HTMLElement) => { dispose: () => void } | void
  }
}

const statusResponse = (state = 'registered') =>
  new Response(
    JSON.stringify({
      connection: {
        activeServerId: 'prod',
        state
      },
      device: {
        hasToken: true,
        id: 'device-1',
        name: 'Device'
      },
      servers: [{
        active: true,
        hasToken: true,
        id: 'prod',
        name: 'Production',
        remoteBaseUrl: 'http://127.0.0.1:8788'
      }]
    }),
    {
      headers: { 'content-type': 'application/json' },
      status: 200
    }
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('relay plugin client login callbacks', () => {
  it('builds the current Web plugin route as redirect_uri', () => {
    installBrowser('http://127.0.0.1:5173/plugins/relay/home?lang=zh-CN#relay_token=old')

    expect(buildWebLoginRedirectUri('prod')).toBe(
      'http://127.0.0.1:5173/plugins/relay/home?lang=zh-CN&relayLogin=1&relayLoginServerId=prod'
    )
  })

  it('builds the plugin home route as redirect_uri for global login commands', () => {
    installBrowser('http://127.0.0.1:5173/ui/session/abc?drawer=1', { clientBase: '/ui' })

    expect(buildPluginHomeWebLoginRedirectUri('relay', DEFAULT_OFFICIAL_RELAY_SERVER_ID)).toBe(
      `http://127.0.0.1:5173/ui/plugins/relay/home?relayLogin=1&relayLoginServerId=${DEFAULT_OFFICIAL_RELAY_SERVER_ID}`
    )
  })

  it('opens the default official relay login from the global login command', async () => {
    const open = vi.fn(() => ({}))
    installBrowser('http://127.0.0.1:5173/ui/session/abc', { clientBase: '/ui', open })
    const apiFetch = vi.fn(async (path: string, _init?: RequestInit) => {
      if (path === 'relay/status') {
        return new Response(
          JSON.stringify({
            connection: {
              activeServerId: DEFAULT_OFFICIAL_RELAY_SERVER_ID,
              state: 'idle'
            },
            servers: [{
              active: true,
              id: DEFAULT_OFFICIAL_RELAY_SERVER_ID,
              name: 'OneWorks Relay (Cloudflare)'
            }]
          }),
          { status: 200 }
        )
      }
      if (path === 'relay/login-url') {
        return new Response(
          JSON.stringify({
            loginUrl: 'https://relay.cloudflare.oneworks.example.com/login'
          }),
          { status: 200 }
        )
      }
      return new Response('{}', { status: 404 })
    })
    const { cleanup, commands } = await createClientHarness(apiFetch)

    await commands.get('login')?.()

    const loginUrlCall = apiFetch.mock.calls.find(call => call[0] === 'relay/login-url')
    expect(loginUrlCall).toBeDefined()
    expect(JSON.parse(String((loginUrlCall?.[1] as RequestInit).body))).toEqual({
      redirectUri:
        `http://127.0.0.1:5173/ui/plugins/relay/home?relayLogin=1&relayLoginServerId=${DEFAULT_OFFICIAL_RELAY_SERVER_ID}`,
      serverId: DEFAULT_OFFICIAL_RELAY_SERVER_ID
    })
    expect(open).toHaveBeenCalledWith(
      'https://relay.cloudflare.oneworks.example.com/login',
      '_blank',
      'noopener,noreferrer'
    )
    cleanup?.dispose()
  })

  it('opens the relay login page with the current Web plugin route as redirect_uri', async () => {
    const open = vi.fn(() => ({}))
    installBrowser('http://127.0.0.1:5173/plugins/relay/home', { open })
    const apiFetch = vi.fn(async (path: string, _init?: RequestInit) => {
      if (path === 'relay/status') return statusResponse('idle')
      if (path === 'relay/login-url') {
        return new Response(
          JSON.stringify({
            loginUrl: 'http://127.0.0.1:8788/login?redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2Fplugins%2Frelay%2Fhome'
          }),
          { status: 200 }
        )
      }
      return new Response('{}', { status: 404 })
    })
    const { cleanup, renderHome } = await createClientHarness(apiFetch)
    const container = new FakeContainer()

    renderHome(container as unknown as HTMLElement)
    await flushPromises()
    container.clickAction('login', 'prod')
    await flushPromises()

    const loginUrlCall = apiFetch.mock.calls.find(call => call[0] === 'relay/login-url')
    expect(loginUrlCall).toBeDefined()
    expect(JSON.parse(String((loginUrlCall?.[1] as RequestInit).body))).toEqual({
      redirectUri: 'http://127.0.0.1:5173/plugins/relay/home?relayLogin=1&relayLoginServerId=prod',
      serverId: 'prod'
    })
    expect(open).toHaveBeenCalledWith(
      'http://127.0.0.1:8788/login?redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2Fplugins%2Frelay%2Fhome',
      '_blank',
      'noopener,noreferrer'
    )
    cleanup?.dispose()
  })

  it('opens the relay login page without Web redirect_uri inside Electron runtime', async () => {
    const open = vi.fn(() => ({}))
    installBrowser('http://127.0.0.1:5173/plugins/relay/home', { desktop: true, open })
    const apiFetch = vi.fn(async (path: string, _init?: RequestInit) => {
      if (path === 'relay/status') return statusResponse('idle')
      if (path === 'relay/login-url') {
        return new Response(
          JSON.stringify({
            loginUrl: 'http://127.0.0.1:8788/login'
          }),
          { status: 200 }
        )
      }
      return new Response('{}', { status: 404 })
    })
    const { cleanup, renderHome } = await createClientHarness(apiFetch)
    const container = new FakeContainer()

    renderHome(container as unknown as HTMLElement)
    await flushPromises()
    container.clickAction('login', 'prod')
    await flushPromises()

    const loginUrlCall = apiFetch.mock.calls.find(call => call[0] === 'relay/login-url')
    expect(loginUrlCall).toBeDefined()
    expect(JSON.parse(String((loginUrlCall?.[1] as RequestInit).body))).toEqual({
      serverId: 'prod'
    })
    expect(open).toHaveBeenCalledWith(
      'http://127.0.0.1:8788/login',
      '_blank',
      'noopener,noreferrer'
    )
    cleanup?.dispose()
  })

  it('consumes a Web callback token and removes it from the browser URL', async () => {
    const browser = installBrowser(
      'http://127.0.0.1:5173/plugins/relay/home?relayLogin=1&relayLoginServerId=prod#relay_token=web-session-token'
    )
    const apiFetch = vi.fn(async (path: string, _init?: RequestInit) => {
      if (path === 'relay/login-callback') return statusResponse()
      if (path === 'relay/status') return statusResponse()
      return new Response('{}', { status: 404 })
    })
    const { cleanup, renderHome } = await createClientHarness(apiFetch)

    renderHome(new FakeContainer() as unknown as HTMLElement)
    await flushPromises()

    const callbackCall = apiFetch.mock.calls.find(call => call[0] === 'relay/login-callback')
    expect(callbackCall).toBeDefined()
    expect(JSON.parse(String((callbackCall?.[1] as RequestInit).body))).toEqual({
      serverId: 'prod',
      token: 'web-session-token'
    })
    expect(browser.location.href).toBe('http://127.0.0.1:5173/plugins/relay/home')
    expect(apiFetch.mock.calls.map(call => call[0])).not.toContain('relay/status')
    cleanup?.dispose()
  })

  it('consumes an Electron deep-link plugin route token without requiring a Web redirect_uri', async () => {
    installBrowser(
      'http://127.0.0.1:5173/plugins/relay/home?relayLogin=1&relayLoginServerId=prod#relay_token=electron-session-token',
      { desktop: true }
    )
    const apiFetch = vi.fn(async (path: string, _init?: RequestInit) => {
      if (path === 'relay/login-callback') return statusResponse()
      if (path === 'relay/status') return statusResponse()
      return new Response('{}', { status: 404 })
    })
    const { cleanup, renderHome } = await createClientHarness(apiFetch)

    renderHome(new FakeContainer() as unknown as HTMLElement)
    await flushPromises()

    const callbackCall = apiFetch.mock.calls.find(call => call[0] === 'relay/login-callback')
    expect(callbackCall).toBeDefined()
    expect(JSON.parse(String((callbackCall?.[1] as RequestInit).body))).toEqual({
      serverId: 'prod',
      token: 'electron-session-token'
    })
    cleanup?.dispose()
  })
})
