// @vitest-environment happy-dom
import { act, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '#~/i18n'
import { LauncherOverlay } from '#~/routes/LauncherOverlay'

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  hideLauncherWindow: vi.fn(),
  onClose: vi.fn(),
  onOpenWorkspaceResource: vi.fn(),
  openCurrentWorkspaceFileInExternalOpener: vi.fn(),
  openFilesystemDirectory: vi.fn(),
  openFilesystemFileInExternalOpener: vi.fn(),
  revealFilesystemPath: vi.fn(),
  searchFilesystemFiles: vi.fn(),
  searchCurrentWorkspaceFiles: vi.fn(),
  searchWorkspaceResources: vi.fn(async () => ({ files: [], sessions: [], terminals: [], websites: [] })),
  selectorState: vi.fn()
}))
const pluginContext = vi.hoisted(() => ({
  registry: { executeCommand: vi.fn(), findRoute: vi.fn() },
  snapshot: { launcherProviders: [], routes: [], slots: {} }
}))

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>()
  return {
    ...actual,
    App: {
      ...actual.App,
      useApp: () => ({
        message: {
          destroy: vi.fn(),
          error: mocks.error,
          info: vi.fn(),
          open: vi.fn(),
          success: vi.fn(),
          warning: vi.fn()
        },
        modal: { confirm: vi.fn() }
      })
    }
  }
})

vi.mock('#~/api/launcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#~/api/launcher')>()
  return {
    ...actual,
    getLauncherWorkspaceSelectorState: vi.fn(async () => mocks.selectorState())
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
vi.mock('#~/components/workspace/WorkspaceOpeningOverlay', () => ({ WorkspaceOpeningOverlay: () => null }))
vi.mock('#~/hooks/use-interface-language-config', () => ({
  useInterfaceLanguageConfig: () => ({ updateGlobalInterfaceLanguage: vi.fn() })
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
  return { ...actual, isServerManagerRole: () => false }
})

type ActionKind = 'current-external-file' | 'directory' | 'external-file' | 'resource' | 'reveal'
type Settlement = 'reject' | 'resolve'

const deferred = () => {
  let reject!: (error: Error) => void
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

const waitFor = async (assertion: () => void) => {
  let lastError: unknown
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
    }
  }
  throw lastError
}

const click = async (target: Element) => {
  await act(async () => target.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
}

const setInputValue = async (value: string) => {
  const input = document.querySelector<HTMLInputElement>('.launcher-command-search__input')
  if (input == null) throw new Error('Missing launcher input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (setter == null) throw new Error('Missing input setter')
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('launcher overlay resource lifecycle', () => {
  let actionKind: ActionKind
  let container: HTMLDivElement
  let reopen: () => void
  let root: Root

  function Harness() {
    const [open, setOpen] = useState(true)
    reopen = () => setOpen(true)
    const workspaceContext = actionKind === 'resource' || actionKind === 'current-external-file'
      ? { description: '/workspace/project', name: 'Project', workspaceFolder: '/workspace/project' }
      : undefined
    return (
      <LauncherOverlay
        open={open}
        workspaceContext={workspaceContext}
        onClose={() => {
          mocks.onClose()
          setOpen(false)
        }}
        onOpenWorkspaceResource={mocks.onOpenWorkspaceResource}
        searchWorkspaceResources={mocks.searchWorkspaceResources}
      />
    )
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
  })

  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.clearAllMocks()
    mocks.selectorState.mockReturnValue({ recentProjects: [], runningProjects: [] })
    Object.defineProperty(window, 'oneworksDesktop', {
      configurable: true,
      value: {
        getWorkspaceSelectorState: async () => mocks.selectorState(),
        hideLauncherWindow: mocks.hideLauncherWindow,
        isGitAvailable: async () => true,
        listCurrentWorkspaceFileOpeners: async () => ({
          defaultOpener: 'vscode',
          openers: [{ available: true, id: 'vscode', source: 'path', title: 'Visual Studio Code' }]
        }),
        onWorkspaceSelectorStateChange: () => () => undefined,
        openCurrentWorkspaceFileInExternalOpener: mocks.openCurrentWorkspaceFileInExternalOpener,
        openFilesystemDirectory: mocks.openFilesystemDirectory,
        openFilesystemFileInExternalOpener: mocks.openFilesystemFileInExternalOpener,
        platform: 'darwin',
        revealFilesystemPath: mocks.revealFilesystemPath,
        searchCurrentWorkspaceFiles: mocks.searchCurrentWorkspaceFiles,
        searchFilesystemFiles: mocks.searchFilesystemFiles
      },
      writable: true
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
  })

  afterAll(async () => i18n.changeLanguage('en'))

  const renderHarness = async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/launcher']}>
          <Harness />
        </MemoryRouter>
      )
    })
    await waitFor(() => expect(document.querySelector('.launcher-web-overlay.is-open')).not.toBeNull())
  }

  it('keeps a running project authoritative over an equivalent recent spelling', async () => {
    actionKind = 'directory'
    mocks.selectorState.mockReturnValue({
      recentProjects: [{
        description: 'stale recent project',
        name: 'Recent project',
        workspaceFolder: 'c:/projects/app'
      }],
      runningProjects: [{
        description: 'active running project',
        name: 'Running project',
        status: 'ready',
        workspaceFolder: String.raw`C:\Projects\App`
      }]
    })

    await renderHarness()

    const project = [...document.querySelectorAll('[data-launcher-command-path]')]
      .find(element => element.getAttribute('data-launcher-command-path') === String.raw`C:\Projects\App`)
    expect(project).not.toBeNull()
    expect(project?.textContent).toContain('Running project')
    expect(project?.textContent).not.toContain('Recent project')
    expect(project?.querySelector('.launcher-command-item__icon')?.textContent).toContain('radio_button_checked')
  })

  const triggerAction = async (kind: ActionKind, request: ReturnType<typeof deferred>) => {
    if (kind === 'resource') {
      mocks.onOpenWorkspaceResource.mockReturnValueOnce(request.promise)
      await waitFor(() => expect(document.getElementById('resource:new-session')).not.toBeNull())
      await click(document.getElementById('resource:new-session')!)
      return
    }
    if (kind === 'current-external-file') {
      mocks.searchCurrentWorkspaceFiles.mockResolvedValueOnce({
        files: [{ directory: 'src', name: 'exact.ts', path: 'src/exact.ts', type: 'file' }]
      })
      mocks.openCurrentWorkspaceFileInExternalOpener.mockReturnValueOnce(request.promise)
      const input = document.querySelector<HTMLInputElement>('.launcher-command-search__input')!
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '/' })))
      await setInputValue('exact')
      await waitFor(() => expect(document.querySelector('[data-launcher-command-title="exact.ts"]')).not.toBeNull())
      const file = document.querySelector('[data-launcher-command-title="exact.ts"]')!
      await act(async () => file.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 })))
      await waitFor(() => expect(document.querySelector('.ant-dropdown-menu-item')).not.toBeNull())
      await click(document.querySelector('.ant-dropdown-menu-item')!)
      return
    }
    if (kind === 'reveal') {
      mocks.selectorState.mockReturnValue({
        recentProjects: [{
          description: '/workspace/project',
          name: 'Project',
          workspaceFolder: '/workspace/project'
        }],
        runningProjects: []
      })
      await act(async () => root.unmount())
      root = createRoot(container)
      await renderHarness()
      mocks.revealFilesystemPath.mockReturnValueOnce(request.promise)
      const project = document.querySelector('[data-launcher-command-path="/workspace/project"]')!
      await act(async () => project.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 })))
      await waitFor(() => expect(document.querySelector('.ant-dropdown-menu')).not.toBeNull())
      const reveal = [...document.querySelectorAll('.ant-dropdown-menu-item')]
        .find(item => item.textContent?.includes('Finder'))
      if (reveal == null) throw new Error('Missing reveal command')
      await click(reveal)
      return
    }

    const path = kind === 'directory' ? '/filesystem/raw-directory' : '/filesystem/raw-file.txt'
    const name = kind === 'directory' ? 'raw-directory' : 'raw-file.txt'
    mocks.searchFilesystemFiles.mockResolvedValueOnce({
      files: [{ directory: '/filesystem', name, path, type: kind === 'directory' ? 'directory' : 'file' }]
    })
    const action = kind === 'directory' ? mocks.openFilesystemDirectory : mocks.openFilesystemFileInExternalOpener
    action.mockReturnValueOnce(request.promise)
    const input = document.querySelector<HTMLInputElement>('.launcher-command-search__input')!
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '/' })))
    await setInputValue('raw')
    await waitFor(() => expect(document.querySelector(`[data-launcher-command-title="${name}"]`)).not.toBeNull())
    await click(document.querySelector(`[data-launcher-command-title="${name}"]`)!)
  }

  it.each(
    (['resource', 'current-external-file', 'external-file', 'directory', 'reveal'] as const).flatMap(kind =>
      (['resolve', 'reject'] as const).map(settlement => [kind, settlement] as const)
    )
  )(
    'suppresses stale %s %s settlement after close and reopen',
    async (kind: ActionKind, settlement: Settlement) => {
      actionKind = kind
      const request = deferred()
      await renderHarness()
      await triggerAction(kind, request)
      await waitFor(() => {
        const calls = kind === 'resource'
          ? mocks.onOpenWorkspaceResource.mock.calls.length
          : kind === 'current-external-file'
          ? mocks.openCurrentWorkspaceFileInExternalOpener.mock.calls.length
          : kind === 'external-file'
          ? mocks.openFilesystemFileInExternalOpener.mock.calls.length
          : kind === 'directory'
          ? mocks.openFilesystemDirectory.mock.calls.length
          : mocks.revealFilesystemPath.mock.calls.length
        expect(calls).toBe(1)
      })

      await click(document.querySelector('.launcher-web-overlay.is-open')!)
      await act(async () => reopen())
      await waitFor(() => expect(document.querySelector('.launcher-web-overlay.is-open')).not.toBeNull())
      const before = {
        activeElement: document.activeElement,
        close: mocks.onClose.mock.calls.length,
        error: mocks.error.mock.calls.length,
        hide: mocks.hideLauncherWindow.mock.calls.length
      }

      if (settlement === 'resolve') request.resolve()
      else request.reject(new Error('late failure'))
      await act(async () => {
        await request.promise.catch(() => undefined)
        await Promise.resolve()
      })

      expect({
        activeElement: document.activeElement,
        close: mocks.onClose.mock.calls.length,
        error: mocks.error.mock.calls.length,
        hide: mocks.hideLauncherWindow.mock.calls.length
      }).toEqual(before)
      expect(document.querySelector('.launcher-web-overlay.is-open')).not.toBeNull()
    }
  )
})
