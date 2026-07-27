import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { setupPwa } from '../src/pwa'

const originalNavigator = globalThis.navigator
const originalWindow = globalThis.window
const originalCaches = globalThis.caches
const originalSessionStorage = globalThis.sessionStorage
const serviceWorkerSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

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

  it('keeps the previous PWA caches when a new app shell cannot be warmed', async () => {
    let installHandler: ((event: { waitUntil: (task: Promise<unknown>) => void }) => void) | undefined
    const skipWaiting = vi.fn()
    const deleteCache = vi.fn(async () => true)
    const failedResponse = new Response('temporarily unavailable', { status: 503 })
    const context: Record<string, unknown> = {
      URL,
      Request,
      Response,
      caches: {
        delete: deleteCache,
        keys: vi.fn(async () => ['oneworks-web-app-v4']),
        open: vi.fn(async () => ({
          put: vi.fn(async () => undefined)
        }))
      },
      clients: {
        claim: vi.fn(async () => undefined)
      },
      console,
      fetch: vi.fn(async () => failedResponse),
      location: new URL('https://example.com/ui/sw.js?v=next'),
      registration: {
        scope: 'https://example.com/ui/'
      },
      skipWaiting,
      addEventListener: (
        event: string,
        handler: (event: { waitUntil: (task: Promise<unknown>) => void }) => void
      ) => {
        if (event === 'install') installHandler = handler
      }
    }
    context.globalThis = context
    runInNewContext(serviceWorkerSource, context)

    let installTask: Promise<unknown> | undefined
    installHandler?.({
      waitUntil: task => {
        installTask = task
      }
    })

    await expect(installTask).rejects.toThrow('App shell warmup returned HTTP 503.')
    expect(skipWaiting).not.toHaveBeenCalled()
    expect(deleteCache).toHaveBeenCalledWith('oneworks-web-app-v5-next')
    expect(deleteCache).toHaveBeenCalledWith('oneworks-web-static-v5-next')
    expect(deleteCache).not.toHaveBeenCalledWith('oneworks-web-app-v4')
  })

  it('rejects a new app shell when a required script cannot be warmed', async () => {
    let installHandler: ((event: { waitUntil: (task: Promise<unknown>) => void }) => void) | undefined
    const skipWaiting = vi.fn()
    const deleteCache = vi.fn(async () => true)
    const context: Record<string, unknown> = {
      URL,
      Request,
      Response,
      caches: {
        delete: deleteCache,
        keys: vi.fn(async () => ['oneworks-web-app-v4', 'oneworks-web-static-v4']),
        open: vi.fn(async () => ({
          put: vi.fn(async () => undefined)
        }))
      },
      clients: {
        claim: vi.fn(async () => undefined)
      },
      console,
      fetch: vi.fn(async (request: Request) => (
        new URL(request.url).pathname === '/ui/'
          ? new Response(
            '<!doctype html><script type="module" src="./assets/app-next.js"></script>',
            { headers: { 'content-type': 'text/html' }, status: 200 }
          )
          : new Response('temporarily unavailable', { status: 503 })
      )),
      location: new URL('https://example.com/ui/sw.js?v=next'),
      registration: {
        scope: 'https://example.com/ui/'
      },
      skipWaiting,
      addEventListener: (
        event: string,
        handler: (event: { waitUntil: (task: Promise<unknown>) => void }) => void
      ) => {
        if (event === 'install') installHandler = handler
      }
    }
    context.globalThis = context
    runInNewContext(serviceWorkerSource, context)

    let installTask: Promise<unknown> | undefined
    installHandler?.({
      waitUntil: task => {
        installTask = task
      }
    })

    await expect(installTask).rejects.toThrow(
      'App shell asset "https://example.com/ui/assets/app-next.js" returned HTTP 503.'
    )
    expect(skipWaiting).not.toHaveBeenCalled()
    expect(deleteCache).toHaveBeenCalledWith('oneworks-web-app-v5-next')
    expect(deleteCache).toHaveBeenCalledWith('oneworks-web-static-v5-next')
    expect(deleteCache).not.toHaveBeenCalledWith('oneworks-web-app-v4')
    expect(deleteCache).not.toHaveBeenCalledWith('oneworks-web-static-v4')
  })
})
