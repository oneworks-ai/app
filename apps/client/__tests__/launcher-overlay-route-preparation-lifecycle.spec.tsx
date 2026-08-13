// @vitest-environment happy-dom
import { act, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getModalFocusableElements } from '@oneworks/route-layout'

import i18n from '#~/i18n'
import { LauncherOverlay } from '#~/routes/LauncherOverlay'

const mocks = vi.hoisted(() => ({
  cloneRepository: vi.fn(),
  listDirectories: vi.fn(),
  message: {
    destroy: vi.fn(),
    error: vi.fn(),
    open: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  },
  modal: { confirm: vi.fn() },
  onClose: vi.fn(),
  openWorkspace: vi.fn()
}))
const pluginContext = vi.hoisted(() => ({
  registry: {
    executeCommand: vi.fn(),
    findRoute: vi.fn()
  },
  snapshot: {
    launcherProviders: [],
    routes: [],
    slots: {}
  }
}))

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>()
  return {
    ...actual,
    App: {
      ...actual.App,
      useApp: () => ({ message: mocks.message, modal: mocks.modal })
    }
  }
})

vi.mock('#~/api/launcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#~/api/launcher')>()
  return {
    ...actual,
    getLauncherWorkspaceSelectorState: vi.fn(async () => ({ recentProjects: [], runningProjects: [] }))
  }
})

vi.mock('#~/api/launcher-relay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#~/api/launcher-relay')>()
  return {
    ...actual,
    getLauncherRelayStatus: vi.fn(async () => ({ device: undefined, servers: [] }))
  }
})

vi.mock('#~/components/action-search-toolbar/ActionSearchToolbar', () => ({
  ActionSearchToolbarActions: () => null
}))

vi.mock('#~/components/launcher/LauncherAboutView', () => ({ LauncherAboutView: () => null }))

vi.mock('#~/components/launcher/LauncherSettingsView', () => ({ LauncherSettingsView: () => null }))

vi.mock('#~/components/usage/UsagePanel', () => ({ UsagePanel: () => null }))

vi.mock('#~/components/workspace/WorkspaceOpeningOverlay', () => ({
  WorkspaceOpeningOverlay: () => <div className='workspace-opening-overlay' />
}))

vi.mock('#~/hooks/use-interface-language-config', () => ({
  useInterfaceLanguageConfig: () => ({
    configuredGlobalLanguage: undefined,
    hasGlobalInterfaceLanguage: false,
    resetGlobalInterfaceLanguage: vi.fn(),
    updateGlobalInterfaceLanguage: vi.fn()
  })
}))

vi.mock('#~/hooks/use-resolved-theme-mode', () => ({
  useResolvedThemeMode: () => ({ isDarkMode: false, resolvedThemeMode: 'light', themeMode: 'light' })
}))

vi.mock('#~/plugins/plugin-context', () => ({
  usePluginContext: () => ({
    pluginServerBaseUrl: undefined,
    registry: pluginContext.registry,
    snapshot: pluginContext.snapshot
  })
}))

vi.mock('#~/plugins/PluginHost', () => ({ PluginViewHost: () => null }))

vi.mock('#~/plugins/PluginProvider', () => ({
  PluginProvider: ({ children }: { children: ReactNode }) => children
}))

vi.mock('#~/runtime-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#~/runtime-config')>()
  return {
    ...actual,
    isServerManagerRole: () => false
  }
})

type Settlement = 'reject' | 'resolve'

const deferred = <Result,>() => {
  let reject!: (reason?: unknown) => void
  let resolve!: (value: Result) => void
  const promise = new Promise<Result>((resolvePromise, rejectPromise) => {
    reject = rejectPromise
    resolve = resolvePromise
  })
  return { promise, reject, resolve }
}

const waitFor = async (assertion: () => void) => {
  let lastError: unknown
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
      })
    }
  }
  throw lastError
}

const click = async (target: Element) => {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, cancelable: true }))
  })
}

const setInputValue = async (value: string) => {
  const input = document.querySelector<HTMLInputElement>('.launcher-command-search__input')
  if (input == null) throw new Error('Missing launcher input')
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (valueSetter == null) throw new Error('Missing input value setter')
  await act(async () => {
    valueSetter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))
  })
}

describe('launcher overlay production route preparation lifecycle', () => {
  let closeOrder: string[]
  let consoleError: ReturnType<typeof vi.spyOn>
  let container: HTMLDivElement
  let closeFromOwner: () => void
  let focusSpy: ReturnType<typeof vi.spyOn>
  let offsetParentDescriptor: PropertyDescriptor | undefined
  let root: Root
  let rootMounted: boolean

  function Harness() {
    const [open, setOpen] = useState(true)
    closeFromOwner = () => setOpen(false)
    return (
      <LauncherOverlay
        open={open}
        onClose={() => {
          closeOrder.push('onClose')
          mocks.onClose()
          setOpen(false)
        }}
      />
    )
  }

  const mutationSnapshot = () => ({
    busy: document.querySelector('.launcher-route')?.getAttribute('aria-busy'),
    close: mocks.onClose.mock.calls.length,
    consoleError: consoleError.mock.calls.length,
    destroy: mocks.message.destroy.mock.calls.length,
    focus: focusSpy.mock.calls.length,
    location: window.location.href,
    messageError: mocks.message.error.mock.calls.length,
    messageOpen: mocks.message.open.mock.calls.length,
    messageSuccess: mocks.message.success.mock.calls.length,
    opening: document.querySelectorAll('.workspace-opening-overlay').length,
    openWorkspace: mocks.openWorkspace.mock.calls.length,
    recentDirectories: localStorage.getItem('oneworks_launcher_clone_destination_directories')
  })

  const renderHarness = async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/launcher']}>
          <Harness />
        </MemoryRouter>
      )
    })
  }

  const appendBackgroundButton = (testId: string) => {
    const button = document.createElement('button')
    button.dataset.testid = testId
    button.textContent = testId
    document.body.insertBefore(button, container)
    return button
  }

  const dispatchKey = async (target: Element, key: string, shiftKey = false) => {
    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key,
          shiftKey
        })
      )
    })
  }

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        matches: false,
        removeEventListener: vi.fn(),
        removeListener: vi.fn()
      })
    })
    globalThis.ResizeObserver = class {
      disconnect() {}
      observe() {}
      unobserve() {}
    }
    offsetParentDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get: function getOffsetParent(this: HTMLElement) {
        return this.isConnected && this.closest('[hidden], [inert]') == null ? document.body : null
      }
    })
  })

  beforeEach(async () => {
    await i18n.changeLanguage('en')
    localStorage.clear()
    vi.clearAllMocks()
    closeOrder = []
    closeFromOwner = () => {
      throw new Error('Launcher owner is not mounted')
    }
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
    mocks.listDirectories.mockImplementation(async (directory?: string) => ({
      currentDirectory: directory ?? '/workspace',
      directories: [{ name: 'alpha', path: '/workspace/alpha' }],
      parentDirectory: '/'
    }))
    mocks.message.destroy.mockImplementation(() => {
      closeOrder.push('clone-cleanup')
    })
    mocks.openWorkspace.mockImplementation(() => new Promise(() => undefined))
    Object.defineProperty(window, 'oneworksDesktop', {
      configurable: true,
      value: {
        cloneRepository: mocks.cloneRepository,
        getWorkspaceSelectorState: vi.fn(async () => ({ recentProjects: [], runningProjects: [] })),
        isGitAvailable: vi.fn(async () => true),
        listCloneDestinationDirectories: mocks.listDirectories,
        onWorkspaceSelectorStateChange: vi.fn(() => () => undefined),
        openWorkspace: mocks.openWorkspace,
        platform: 'darwin'
      } satisfies Partial<NonNullable<Window['oneworksDesktop']>>,
      writable: true
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    rootMounted = true
  })

  afterEach(async () => {
    if (rootMounted) await act(async () => root.unmount())
    container.remove()
    consoleError.mockRestore()
    focusSpy.mockRestore()
    document.body.innerHTML = ''
  })

  afterAll(async () => {
    if (offsetParentDescriptor == null) Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent')
    else Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParentDescriptor)
    await i18n.changeLanguage('en')
  })

  it('contains Tab and outside focus, then restores the connected opener on Escape close', async () => {
    const opener = appendBackgroundButton('opener')
    opener.focus()
    await renderHarness()
    const overlay = document.querySelector<HTMLElement>('.launcher-web-overlay.is-open')
    if (overlay == null) throw new Error('Missing open launcher overlay')
    await waitFor(() => expect(overlay.contains(document.activeElement)).toBe(true))
    expect(opener.hasAttribute('inert')).toBe(true)

    const focusableElements = getModalFocusableElements(overlay)
    expect(focusableElements.length).toBeGreaterThan(1)
    const firstElement = focusableElements[0]
    const lastElement = focusableElements.at(-1)!
    lastElement.focus()
    await dispatchKey(lastElement, 'Tab')
    expect(document.activeElement).toBe(firstElement)
    firstElement.focus()
    await dispatchKey(firstElement, 'Tab', true)
    expect(document.activeElement).toBe(lastElement)

    opener.focus()
    await waitFor(() => expect(overlay.contains(document.activeElement)).toBe(true))
    const searchInput = overlay.querySelector<HTMLInputElement>('.launcher-command-search__input')
    if (searchInput == null) throw new Error('Missing launcher search input')
    searchInput.focus()
    await dispatchKey(searchInput, 'Escape')
    await waitFor(() => expect(document.activeElement).toBe(opener))
    expect(opener.hasAttribute('inert')).toBe(false)
    expect(document.querySelector('.launcher-web-overlay.is-open')).toBeNull()
  })

  it('restores the opener after backdrop close', async () => {
    const opener = appendBackgroundButton('backdrop-opener')
    opener.focus()
    await renderHarness()
    await waitFor(() => expect(document.querySelector('.launcher-web-overlay.is-open')).not.toBeNull())

    await click(document.querySelector('.launcher-web-overlay.is-open')!)

    await waitFor(() => expect(document.activeElement).toBe(opener))
    expect(document.querySelector('.launcher-web-overlay.is-open')).toBeNull()
  })

  it('restores a safe connected fallback when the opener disconnects before unmount', async () => {
    const fallback = appendBackgroundButton('fallback')
    const opener = appendBackgroundButton('removed-opener')
    opener.focus()
    await renderHarness()
    await waitFor(() => {
      expect(document.querySelector('.launcher-web-overlay.is-open')?.contains(document.activeElement)).toBe(true)
    })
    opener.remove()

    await act(async () => root.unmount())
    rootMounted = false

    expect(document.activeElement).toBe(fallback)
  })

  it.each(
    [
      { close: 'Escape', invalidation: 'disabled' },
      { close: 'backdrop', invalidation: 'hidden' },
      { close: 'external owner', invalidation: 'disabled' },
      { close: 'unmount', invalidation: 'hidden' }
    ] as const
  )(
    'restores a safe fallback when the connected opener becomes $invalidation before $close close',
    async ({ close, invalidation }) => {
      const fallback = appendBackgroundButton(`${close}-fallback`)
      const opener = appendBackgroundButton(`${close}-opener`)
      opener.focus()
      await renderHarness()
      const overlay = document.querySelector<HTMLElement>('.launcher-web-overlay.is-open')
      if (overlay == null) throw new Error('Missing open launcher overlay')
      await waitFor(() => expect(overlay.contains(document.activeElement)).toBe(true))

      if (invalidation === 'disabled') opener.setAttribute('disabled', '')
      else opener.hidden = true

      if (close === 'Escape') {
        const searchInput = overlay.querySelector<HTMLInputElement>('.launcher-command-search__input')
        if (searchInput == null) throw new Error('Missing launcher search input')
        await dispatchKey(searchInput, 'Escape')
      } else if (close === 'backdrop') {
        await click(overlay)
      } else if (close === 'external owner') {
        await act(async () => closeFromOwner())
      } else {
        await act(async () => root.unmount())
        rootMounted = false
      }

      await waitFor(() => expect(document.activeElement).toBe(fallback))
      expect(opener.isConnected).toBe(true)
      if (close !== 'unmount') expect(document.querySelector('.launcher-web-overlay.is-open')).toBeNull()
    }
  )

  it.each<Settlement>(['resolve', 'reject'])(
    'invalidates clone before onClose and suppresses its late %s through the real owner seam',
    async (settlement) => {
      const request = deferred<string | undefined>()
      mocks.cloneRepository.mockImplementation(() => request.promise)
      await renderHarness()
      await waitFor(() => expect(document.getElementById('clone-repository')).not.toBeNull())
      await click(document.getElementById('clone-repository')!)
      await waitFor(() => {
        expect(document.querySelector('[data-launcher-command-path="/workspace/alpha"]')).not.toBeNull()
      })
      await setInputValue('https://example.test/repository.git')
      await click(document.querySelector('[data-launcher-command-path="/workspace/alpha"]')!)
      await waitFor(() => expect(mocks.cloneRepository).toHaveBeenCalledTimes(1))

      await click(document.querySelector('.launcher-web-overlay.is-open')!)

      expect(closeOrder).toEqual(['clone-cleanup', 'onClose'])
      expect(document.querySelector('.launcher-web-overlay.is-open')).toBeNull()
      const before = mutationSnapshot()
      if (settlement === 'resolve') request.resolve('/workspace/cloned')
      else request.reject(new Error('late failure'))
      await act(async () => {
        await request.promise.catch(() => undefined)
        await Promise.resolve()
      })
      expect(mutationSnapshot()).toEqual(before)
    }
  )
})
