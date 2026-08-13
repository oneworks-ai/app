// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  connectDesktopManagerRuntimeIfAvailable,
  installDesktopRuntimeIdentityIfAvailable,
  markDesktopManagerInteractiveWhenReady,
  resolveClientRoutePathname,
  resolveDesktopRuntimeIdentity
} from '../src/desktop/manager-runtime'

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
  Reflect.deleteProperty(window, 'oneworksDesktop')
  Reflect.deleteProperty(window, 'oneworksDeviceShell')
  Reflect.deleteProperty(globalThis, '__ONEWORKS_PROJECT_RUNTIME_ENV__')
})

describe('desktop manager runtime', () => {
  it('recognizes routes below the packaged client base', () => {
    expect(resolveClientRoutePathname('/ui/launcher', '/ui')).toBe('/launcher')
    expect(resolveClientRoutePathname('/ui/launcher/account', '/ui')).toBe('/launcher/account')
    expect(resolveClientRoutePathname('/ui/standalone', '/ui')).toBe('/standalone')
  })

  it('keeps root-base and unrelated paths stable', () => {
    expect(resolveClientRoutePathname('/launcher', '/')).toBe('/launcher')
    expect(resolveClientRoutePathname('/custom/launcher', '/ui')).toBe('/custom/launcher')
  })

  it('establishes desktop role identity without waiting for a service URL', () => {
    expect(resolveDesktopRuntimeIdentity('/ui/launcher', '/ui', true)).toEqual({
      clientMode: 'desktop',
      serverRole: 'manager'
    })
    expect(resolveDesktopRuntimeIdentity('/ui/', '/ui', true)).toEqual({
      clientMode: 'desktop',
      serverRole: 'workspace'
    })
    expect(resolveDesktopRuntimeIdentity('/ui/launcher', '/ui', false)).toBeUndefined()
  })

  it('marks the launcher interactive only after the exact manager core is ready', async () => {
    const events: string[] = []
    window.history.replaceState(null, '', '/launcher')
    window.oneworksDesktop = {
      getManagerConnection: vi.fn(async () => ({ serverBaseUrl: 'http://127.0.0.1:38901' })),
      markDesktopCoreReady: vi.fn(async () => {
        events.push('core.ready')
      }),
      markDesktopInteractive: vi.fn(() => {
        events.push('renderer.interactive')
      }),
      shellKind: 'electron'
    }

    await expect(markDesktopManagerInteractiveWhenReady()).resolves.toBe(true)
    expect(events).toEqual(['core.ready', 'renderer.interactive'])
  })

  it('does not finalize launcher diagnostics when manager core is unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    window.history.replaceState(null, '', '/launcher')
    const markDesktopInteractive = vi.fn()
    window.oneworksDesktop = {
      getManagerConnection: vi.fn(async () => {
        throw new Error('Manager unavailable')
      }),
      markDesktopCoreReady: vi.fn(async () => undefined),
      markDesktopInteractive,
      shellKind: 'electron'
    }

    await expect(markDesktopManagerInteractiveWhenReady()).resolves.toBe(false)
    expect(markDesktopInteractive).not.toHaveBeenCalled()
  })

  it('does not finalize launcher diagnostics when core readiness cannot be acknowledged', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    window.history.replaceState(null, '', '/launcher')
    const markDesktopInteractive = vi.fn()
    window.oneworksDesktop = {
      getManagerConnection: vi.fn(async () => ({ serverBaseUrl: 'http://127.0.0.1:38901' })),
      markDesktopCoreReady: vi.fn(async () => {
        throw new Error('IPC unavailable')
      }),
      markDesktopInteractive,
      shellKind: 'electron'
    }

    await expect(markDesktopManagerInteractiveWhenReady()).resolves.toBe(false)
    expect(markDesktopInteractive).not.toHaveBeenCalled()
  })

  it('connects standalone routes through the exact manager endpoint and acknowledges core readiness', async () => {
    window.history.replaceState(null, '', '/standalone/mobile-debug')
    const getManagerConnection = vi.fn(async () => ({ serverBaseUrl: 'http://127.0.0.1:38902' }))
    const markDesktopCoreReady = vi.fn(async () => undefined)
    window.oneworksDesktop = {
      getManagerConnection,
      markDesktopCoreReady,
      shellKind: 'electron'
    }

    await expect(connectDesktopManagerRuntimeIfAvailable()).resolves.toBe('http://127.0.0.1:38902')
    expect(getManagerConnection).toHaveBeenCalledTimes(1)
    expect(markDesktopCoreReady).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['authoritative Android', { shellKind: 'electron' }, { shellKind: 'android' }],
    ['unidentified partial bridge', {}, undefined]
  ])('does not connect a manager for %s', async (_label, desktop, device) => {
    window.history.replaceState(null, '', '/launcher')
    const getManagerConnection = vi.fn(async () => ({ serverBaseUrl: 'http://127.0.0.1:38902' }))
    window.oneworksDesktop = { ...desktop, getManagerConnection }
    window.oneworksDeviceShell = device

    await expect(connectDesktopManagerRuntimeIfAvailable()).resolves.toBeUndefined()
    expect(getManagerConnection).not.toHaveBeenCalled()
  })

  it.each([
    ['authoritative Android', { shellKind: 'electron' }, { shellKind: 'android' }],
    ['unidentified partial bridge', {}, undefined]
  ])('does not install desktop identity for %s', (_label, desktop, device) => {
    window.history.replaceState(null, '', '/launcher')
    window.oneworksDesktop = desktop
    window.oneworksDeviceShell = device

    expect(installDesktopRuntimeIdentityIfAvailable()).toBeUndefined()
  })

  it('keeps an unidentified partial bridge partial after a prior desktop identity', async () => {
    window.history.replaceState(null, '', '/launcher')
    window.oneworksDesktop = { shellKind: 'electron' }
    expect(installDesktopRuntimeIdentityIfAvailable()).toEqual({ clientMode: 'desktop', serverRole: 'manager' })

    const getManagerConnection = vi.fn(async () => ({ serverBaseUrl: 'http://127.0.0.1:38902' }))
    window.oneworksDesktop = { getManagerConnection }

    await expect(connectDesktopManagerRuntimeIfAvailable()).resolves.toBeUndefined()
    expect(installDesktopRuntimeIdentityIfAvailable()).toBeUndefined()
    expect(getManagerConnection).not.toHaveBeenCalled()
  })
})
