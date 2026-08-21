// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

const clientModulePath = '../../../packages/plugins/channel-oneworks/client/src/index.tsx'

afterEach(() => {
  document.head.querySelectorAll('style').forEach(style => style.remove())
  globalThis.history.replaceState({}, '', '/ui/')
})

describe('oneWorks chat room client activation', () => {
  it('registers workspace navigation from runtime identity without relying on the browser URL', async () => {
    globalThis.history.replaceState({}, '', '/ui/')
    const { activatePlugin } = await import(/* @vite-ignore */ clientModulePath)
    const disposeNav = vi.fn()
    const disposeView = vi.fn()
    const registerNav = vi.fn(() => ({ dispose: disposeNav }))
    const registerView = vi.fn(() => ({ dispose: disposeView }))

    const dispose = await activatePlugin({
      runtime: { endpoint: { role: 'workspace' } },
      scope: 'channel-oneworks',
      slots: { register: registerNav },
      views: { register: registerView }
    })

    expect(registerView).toHaveBeenCalledWith('oneworks-channel', expect.any(Object))
    expect(registerNav).toHaveBeenCalledWith(
      'nav.items',
      expect.objectContaining({
        id: 'oneworks-channel',
        route: '/plugins/channel-oneworks/oneworks-channel'
      })
    )
    expect(document.head.querySelector('style')).not.toBeNull()

    dispose?.()
    expect(disposeNav).toHaveBeenCalledOnce()
    expect(disposeView).toHaveBeenCalledOnce()
    expect(document.head.querySelector('style')).toBeNull()
  })

  it('does not register workspace navigation in the manager runtime', async () => {
    globalThis.history.replaceState({}, '', '/ui/w/w_example123/')
    const { activatePlugin } = await import(/* @vite-ignore */ clientModulePath)
    const registerNav = vi.fn(() => ({ dispose: vi.fn() }))
    const registerView = vi.fn(() => ({ dispose: vi.fn() }))

    const dispose = await activatePlugin({
      runtime: { endpoint: { role: 'manager' } },
      scope: 'channel-oneworks',
      slots: { register: registerNav },
      views: { register: registerView }
    })

    expect(registerView).toHaveBeenCalledOnce()
    expect(registerNav).not.toHaveBeenCalled()
    dispose?.()
  })
})
