import { afterEach, describe, expect, it, vi } from 'vitest'

import { setupPwa } from '../src/pwa'

const originalNavigator = globalThis.navigator
const originalWindow = globalThis.window
const originalCaches = globalThis.caches
const originalSessionStorage = globalThis.sessionStorage

afterEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('navigator', originalNavigator)
  vi.stubGlobal('window', originalWindow)
  vi.stubGlobal('caches', originalCaches)
  vi.stubGlobal('sessionStorage', originalSessionStorage)
})

describe('pwa setup', () => {
  it('removes stale PWA state and reloads a controlled desktop page once', async () => {
    const unregister = vi.fn(async () => true)
    const reload = vi.fn()
    const cacheDelete = vi.fn(async () => true)
    const storage = new Map<string, string>()

    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: {},
        getRegistrations: vi.fn(async () => [{
          scope: 'http://127.0.0.1:63970/ui/',
          unregister
        }])
      }
    })
    vi.stubGlobal('window', {
      location: {
        origin: 'http://127.0.0.1:63970',
        reload
      }
    })
    vi.stubGlobal('caches', {
      delete: cacheDelete,
      keys: vi.fn(async () => ['oneworks-web-app-v4', 'unrelated-cache'])
    })
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    })

    await expect(setupPwa({
      clientBase: '/ui',
      isDesktop: true,
      isProd: true
    })).resolves.toBe(false)

    expect(unregister).toHaveBeenCalledOnce()
    expect(cacheDelete).toHaveBeenCalledOnce()
    expect(cacheDelete).toHaveBeenCalledWith('oneworks-web-app-v4')
    expect(reload).toHaveBeenCalledOnce()

    await expect(setupPwa({
      clientBase: '/ui',
      isDesktop: true,
      isProd: true
    })).resolves.toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('continues rendering when desktop PWA cleanup storage is unavailable', async () => {
    const reload = vi.fn()
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: {},
        getRegistrations: vi.fn(async () => {
          throw new Error('registration unavailable')
        })
      }
    })
    vi.stubGlobal('window', {
      location: {
        origin: 'http://127.0.0.1:63970',
        reload
      }
    })
    vi.stubGlobal('caches', {
      delete: vi.fn(async () => true),
      keys: vi.fn(async () => {
        throw new Error('cache unavailable')
      })
    })
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('storage unavailable')
      },
      setItem: vi.fn()
    })

    await expect(setupPwa({
      clientBase: '/ui',
      isDesktop: true,
      isProd: true
    })).resolves.toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('registers a build-versioned service worker for production web clients', async () => {
    const register = vi.fn(async () => undefined)
    let loadHandler: (() => void) | undefined

    vi.stubGlobal('navigator', {
      serviceWorker: {
        register
      }
    })
    vi.stubGlobal('window', {
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'load') loadHandler = handler
      }),
      location: {
        origin: 'https://example.com'
      }
    })

    await expect(setupPwa({
      clientBase: '/ui',
      isDesktop: false,
      isProd: true
    })).resolves.toBe(true)

    loadHandler?.()
    expect(register).toHaveBeenCalledWith(
      expect.stringMatching(/^\/ui\/sw\.js\?v=.+/),
      { scope: '/ui/' }
    )
  })
})
