// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  markDesktopManagerInteractiveWhenReady,
  resolveClientRoutePathname,
  resolveDesktopRuntimeIdentity
} from '../src/desktop/manager-runtime'

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
  Reflect.deleteProperty(window, 'oneworksDesktop')
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
      })
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
      markDesktopInteractive
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
      markDesktopInteractive
    }

    await expect(markDesktopManagerInteractiveWhenReady()).resolves.toBe(false)
    expect(markDesktopInteractive).not.toHaveBeenCalled()
  })
})
