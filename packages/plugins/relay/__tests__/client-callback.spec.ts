import { afterEach, describe, expect, it, vi } from 'vitest'

import { activatePlugin } from '../src/client/index.js'
import { buildPluginHomeWebLoginRedirectUri, buildWebLoginRedirectUri } from '../src/client/login-callback.js'
import type { PluginClientContext, PluginReactHost } from '../src/client/types.js'
import { DEFAULT_OFFICIAL_RELAY_SERVER_ID } from '../src/shared/official-services.js'

interface FakeLocation {
  hash: string
  href: string
  pathname: string
  search: string
}

const createReactHost = (): PluginReactHost => ({
  Fragment: Symbol.for('test.fragment'),
  createElement: vi.fn((type, props, ...children) => ({
    children,
    props,
    type
  })),
  useEffect: vi.fn(),
  useMemo: vi.fn(factory => factory()),
  useRef: vi.fn(initialValue => ({ current: initialValue })),
  useState: (initialValue => [
    typeof initialValue === 'function' ? (initialValue as () => unknown)() : initialValue,
    vi.fn()
  ]) as PluginReactHost['useState']
})

const updateLocation = (location: FakeLocation, nextHref: string) => {
  const url = new URL(nextHref)
  location.hash = url.hash
  location.href = url.toString()
  location.pathname = url.pathname
  location.search = url.search
}

const installBrowser = (href: string, input: {
  clientBase?: string
  desktop?: boolean
  open?: ReturnType<typeof vi.fn>
} = {}) => {
  const url = new URL(href)
  const location: FakeLocation = {
    hash: url.hash,
    href,
    pathname: url.pathname,
    search: url.search
  }
  const open = input.open ?? vi.fn(() => ({}))
  vi.stubGlobal('window', {
    history: {
      replaceState: vi.fn((_state: unknown, _title: string, nextHref: string) => updateLocation(location, nextHref))
    },
    location,
    open,
    ...(input.desktop === true ? { oneworksDesktop: {} } : {})
  })
  if (input.clientBase != null) {
    vi.stubGlobal('__ONEWORKS_PROJECT_RUNTIME_ENV__', {
      __ONEWORKS_PROJECT_CLIENT_BASE__: input.clientBase
    })
  }
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    createElement: vi.fn(() => ({
      remove: vi.fn(),
      textContent: ''
    })),
    head: {
      appendChild: vi.fn()
    },
    removeEventListener: vi.fn()
  })
  return {
    location,
    open
  }
}

const createClientHarness = async (apiFetch: ReturnType<typeof vi.fn>) => {
  const commands = new Map<string, (payload?: unknown) => unknown | Promise<unknown>>()
  const cleanup = await activatePlugin(
    {
      api: {
        fetch: apiFetch
      },
      commands: {
        register: vi.fn((commandId, handler) => {
          commands.set(commandId, handler)
          return { dispose: vi.fn() }
        })
      },
      react: createReactHost(),
      scope: 'relay',
      slots: {
        register: vi.fn(() => ({ dispose: vi.fn() }))
      },
      views: {
        register: vi.fn(() => ({ dispose: vi.fn() }))
      }
    } satisfies PluginClientContext
  )
  return {
    commands,
    cleanup
  }
}

const statusResponse = () =>
  new Response(
    JSON.stringify({
      accounts: [],
      connection: {
        activeServerId: 'prod',
        state: 'registered'
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
    const apiFetch = vi.fn(async (path: string) => {
      if (path === 'relay/login-url') {
        return new Response(JSON.stringify({ loginUrl: 'http://127.0.0.1:8788/login' }), {
          headers: { 'content-type': 'application/json' }
        })
      }
      return statusResponse()
    })
    const { cleanup, commands } = await createClientHarness(apiFetch)

    const result = await commands.get('login')?.()

    expect(apiFetch).toHaveBeenCalledWith('relay/login-url', expect.objectContaining({ method: 'POST' }))
    expect(open).toHaveBeenCalledWith('http://127.0.0.1:8788/login', '_blank', 'noopener,noreferrer')
    expect(result).toEqual({ loginUrl: 'http://127.0.0.1:8788/login', serverId: 'prod' })
    cleanup.dispose()
  })
})
