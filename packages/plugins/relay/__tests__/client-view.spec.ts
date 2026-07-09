import { afterEach, describe, expect, it, vi } from 'vitest'

import { activatePlugin } from '../src/client/index.js'
import { RelayHomeView, readJsonResponse } from '../src/client/react-view.js'
import type { PluginClientContext, PluginReactHost, PluginViewRegistration } from '../src/client/types.js'

const createReactHost = (): PluginReactHost & { createElement: ReturnType<typeof vi.fn> } => ({
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

const installBrowser = () => {
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    location: {
      hash: '',
      href: 'http://127.0.0.1:5173/ui/plugins/relay/home/accounts',
      pathname: '/ui/plugins/relay/home/accounts',
      search: ''
    },
    open: vi.fn()
  })
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
}

const createContext = () => {
  const react = createReactHost()
  let homeRegistration: PluginViewRegistration | undefined
  const ctx: PluginClientContext = {
    api: {
      fetch: vi.fn(async () =>
        new Response(JSON.stringify({ accounts: [], servers: [] }), {
          headers: { 'content-type': 'application/json' }
        })
      )
    },
    commands: {
      register: vi.fn(() => ({ dispose: vi.fn() }))
    },
    react,
    scope: 'relay',
    slots: {
      register: vi.fn(() => ({ dispose: vi.fn() }))
    },
    views: {
      register: vi.fn((viewId, registration) => {
        if (viewId === 'home') {
          homeRegistration = registration as PluginViewRegistration
        }
        return { dispose: vi.fn() }
      })
    }
  }
  return {
    ctx,
    getHomeRegistration: () => homeRegistration,
    react
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('relay plugin client view registration', () => {
  it('registers the home view as a React-only renderer', async () => {
    installBrowser()
    const { ctx, getHomeRegistration, react } = createContext()

    const cleanup = await activatePlugin(ctx)
    const homeRegistration = getHomeRegistration()

    expect(homeRegistration).toBeDefined()
    expect(homeRegistration).not.toHaveProperty('render')
    expect(homeRegistration?.renderNode).toEqual(expect.any(Function))

    const view = { route: { setActions: vi.fn(), setBreadcrumb: vi.fn(), setTitle: vi.fn() } }
    const node = homeRegistration?.renderNode?.(view)

    expect(react.createElement).toHaveBeenCalledWith(RelayHomeView, { ctx, view })
    expect(node).toMatchObject({
      props: { ctx, view },
      type: RelayHomeView
    })

    cleanup.dispose()
  })

  it('uses JSON error fields instead of displaying the raw JSON body', async () => {
    await expect(readJsonResponse(
      new Response(JSON.stringify({ error: 'fetch failed' }), { status: 500 }),
      'profile'
    )).rejects.toThrow('fetch failed')
    await expect(readJsonResponse(
      new Response(JSON.stringify({ message: 'Profile service unavailable' }), { status: 503 }),
      'profile'
    )).rejects.toThrow('Profile service unavailable')
  })
})
