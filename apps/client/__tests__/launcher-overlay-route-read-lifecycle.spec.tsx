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
  listLocal: vi.fn(),
  listOpeners: vi.fn(),
  listRelay: vi.fn(),
  onClose: vi.fn(),
  openWorkspace: vi.fn(),
  searchFiles: vi.fn(),
  searchResources: vi.fn(),
  serverMode: false
}))
const pluginContext = vi.hoisted(() => ({
  registry: { executeCommand: vi.fn(), findRoute: vi.fn() },
  snapshot: { launcherProviders: [] as Array<Record<string, unknown>>, routes: [], slots: {} }
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
vi.mock('#~/api', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  getConfig: vi.fn(async () => ({ sources: { merged: {} } }))
}))
vi.mock('#~/api/launcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#~/api/launcher')>()
  return {
    ...actual,
    getLauncherWorkspaceSelectorState: vi.fn(async () => ({ recentProjects: [], runningProjects: [] })),
    listLauncherDirectories: mocks.listLocal
  }
})
vi.mock('#~/api/launcher-relay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#~/api/launcher-relay')>()
  return {
    ...actual,
    getLauncherRelayStatus: vi.fn(async () => ({
      device: { id: 'current-device' },
      servers: [{
        active: true,
        connected: true,
        devices: [{
          capabilities: { sessions: true, workspaceLauncher: true },
          id: 'remote-device',
          name: 'Remote Device',
          status: 'online',
          workspaceFolder: '/relay'
        }],
        id: 'relay-server',
        name: 'Relay Server',
        sessionAuthenticated: true
      }]
    })),
    listLauncherRelayDirectories: mocks.listRelay
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
  return { ...actual, isServerManagerRole: () => mocks.serverMode }
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
  for (let attempt = 0; attempt < 70; attempt += 1) {
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

const settle = async <Result,>(request: ReturnType<typeof deferred<Result>>, settlement: Settlement, value: Result) => {
  await act(async () => {
    if (settlement === 'resolve') request.resolve(value)
    else request.reject(new Error('late activation failure'))
    await request.promise.catch(() => undefined)
    await Promise.resolve()
  })
}

describe('launcher overlay read-side activation lifecycle', () => {
  let container: HTMLDivElement
  let reopen: () => void
  let root: Root
  let workspaceContext: { description: string; name: string; workspaceFolder: string } | undefined

  function Harness() {
    const [open, setOpen] = useState(true)
    reopen = () => setOpen(true)
    return (
      <LauncherOverlay
        open={open}
        workspaceContext={workspaceContext}
        onClose={() => {
          mocks.onClose()
          setOpen(false)
        }}
        searchWorkspaceResources={mocks.searchResources}
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
    mocks.listLocal.mockReset().mockResolvedValue({ currentDirectory: '/', directories: [] })
    mocks.listOpeners.mockReset().mockResolvedValue({ defaultOpener: undefined, openers: [] })
    mocks.listRelay.mockReset().mockResolvedValue({ currentDirectory: '/', directories: [] })
    mocks.openWorkspace.mockReset().mockResolvedValue(undefined)
    mocks.searchFiles.mockReset().mockResolvedValue({ files: [] })
    mocks.searchResources.mockReset().mockResolvedValue({ files: [], sessions: [], terminals: [], websites: [] })
    pluginContext.registry.executeCommand.mockReset().mockResolvedValue(undefined)
    localStorage.clear()
    mocks.serverMode = false
    workspaceContext = undefined
    pluginContext.snapshot.launcherProviders = []
    Object.defineProperty(window, 'oneworksDesktop', {
      configurable: true,
      value: {
        getWorkspaceSelectorState: async () => ({ recentProjects: [], runningProjects: [] }),
        listCloneDestinationDirectories: mocks.listLocal,
        listCurrentWorkspaceFileOpeners: mocks.listOpeners,
        onWorkspaceSelectorStateChange: () => () => undefined,
        openWorkspace: mocks.openWorkspace,
        platform: 'darwin',
        searchCurrentWorkspaceFiles: mocks.searchFiles,
        searchFilesystemFiles: mocks.searchFiles
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

  const render = async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/launcher']}>
          <Harness />
        </MemoryRouter>
      )
    })
    await waitFor(() => expect(document.querySelector('.launcher-web-overlay.is-open')).not.toBeNull())
  }

  const closeAndReopen = async () => {
    await click(document.querySelector('.launcher-web-overlay.is-open')!)
    await act(async () => reopen())
    await waitFor(() => expect(document.querySelector('.launcher-web-overlay.is-open')).not.toBeNull())
  }

  it.each(
    (['local', 'relay'] as const).flatMap(target =>
      (['resolve', 'reject'] as const).map(settlement => [target, settlement] as const)
    )
  )('keeps reopened %s directory state after old %s settlement', async (target, settlement) => {
    const request = deferred<{ currentDirectory: string; directories: Array<{ name: string; path: string }> }>()
    const fresh = {
      currentDirectory: target === 'local' ? '/local' : '/relay',
      directories: [{ name: 'fresh-directory', path: `/${target}/fresh-directory` }]
    }
    mocks.serverMode = true
    delete (window as { oneworksDesktop?: unknown }).oneworksDesktop
    if (target === 'local') {
      mocks.listLocal.mockReturnValueOnce(request.promise).mockResolvedValue(fresh)
      mocks.listRelay.mockResolvedValue(fresh)
    } else {
      mocks.listLocal.mockResolvedValue({ currentDirectory: '/local', directories: [] })
      mocks.listRelay.mockReturnValueOnce(request.promise).mockResolvedValue(fresh)
    }
    await render()
    await waitFor(() => expect(document.getElementById('open-folder')).not.toBeNull())
    await click(document.getElementById('open-folder')!)
    if (target === 'relay') {
      await waitFor(() =>
        expect([...document.querySelectorAll('[role="tab"]')]
          .some(tab => tab.textContent?.includes('Remote Device'))).toBe(true)
      )
      const relayTab = [...document.querySelectorAll('[role="tab"]')]
        .find(tab => tab.textContent?.includes('Remote Device'))!
      await click(relayTab)
    }
    const list = target === 'local' ? mocks.listLocal : mocks.listRelay
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))

    await closeAndReopen()
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThanOrEqual(2))
    await waitFor(() =>
      expect(document.querySelector('[data-launcher-command-title="fresh-directory"]')).not.toBeNull()
    )
    await settle(request, settlement, {
      currentDirectory: target === 'local' ? '/local' : '/relay',
      directories: [{ name: 'stale-directory', path: `/${target}/stale-directory` }]
    })

    expect(document.querySelector('[data-launcher-command-title="fresh-directory"]')).not.toBeNull()
    expect(document.querySelector('[data-launcher-command-title="stale-directory"]')).toBeNull()
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it.each<Settlement>(['resolve', 'reject'])(
    'keeps reopened workspace resources after old %s settlement',
    async (settlement) => {
      const request = deferred<
        { files: Array<Record<string, string>>; sessions: never[]; terminals: never[]; websites: never[] }
      >()
      workspaceContext = { description: '/workspace', name: 'Workspace', workspaceFolder: '/workspace' }
      mocks.searchResources
        .mockReturnValueOnce(request.promise)
        .mockResolvedValue({
          files: [{ directory: 'src', id: 'fresh', kind: 'file', name: 'fresh.ts', path: 'src/fresh.ts' }],
          sessions: [],
          terminals: [],
          websites: []
        })
      await render()
      await waitFor(() => expect(mocks.searchResources).toHaveBeenCalledTimes(1))
      await closeAndReopen()
      await waitFor(() => expect(document.querySelector('[data-launcher-command-title="fresh.ts"]')).not.toBeNull())
      await settle(request, settlement, {
        files: [{ directory: 'src', id: 'stale', kind: 'file', name: 'stale.ts', path: 'src/stale.ts' }],
        sessions: [],
        terminals: [],
        websites: []
      })

      expect(document.querySelector('[data-launcher-command-title="fresh.ts"]')).not.toBeNull()
      expect(document.querySelector('[data-launcher-command-title="stale.ts"]')).toBeNull()
      expect(mocks.error).not.toHaveBeenCalled()
    }
  )

  it.each<Settlement>(['resolve', 'reject'])(
    'keeps reopened filesystem search results after old %s settlement',
    async (settlement) => {
      const request = deferred<{ files: Array<Record<string, string>> }>()
      mocks.searchFiles.mockReturnValueOnce(request.promise).mockResolvedValue({
        files: [{ directory: '/workspace', name: 'fresh.ts', path: '/workspace/fresh.ts', type: 'file' }]
      })
      await render()
      const input = document.querySelector<HTMLInputElement>('.launcher-command-search__input')!
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '/' })))
      await setInputValue('result')
      await waitFor(() => expect(mocks.searchFiles).toHaveBeenCalledTimes(1))
      await closeAndReopen()
      await waitFor(() => expect(document.querySelector('[data-launcher-command-title="fresh.ts"]')).not.toBeNull())
      await settle(request, settlement, {
        files: [{ directory: '/workspace', name: 'stale.ts', path: '/workspace/stale.ts', type: 'file' }]
      })

      expect(document.querySelector('[data-launcher-command-title="fresh.ts"]')).not.toBeNull()
      expect(document.querySelector('[data-launcher-command-title="stale.ts"]')).toBeNull()
      expect(mocks.error).not.toHaveBeenCalled()
    }
  )

  it.each<Settlement>(['resolve', 'reject'])(
    'keeps reopened file-opener state after old %s settlement',
    async (settlement) => {
      const request = deferred<Record<string, unknown>>()
      workspaceContext = { description: '/workspace', name: 'Workspace', workspaceFolder: '/workspace' }
      mocks.listOpeners.mockReturnValueOnce(request.promise).mockResolvedValue({
        defaultOpener: 'zed',
        openers: [{ available: true, id: 'zed', source: 'path', title: 'Zed' }]
      })
      mocks.searchFiles.mockResolvedValue({
        files: [{ directory: 'src', name: 'fresh.ts', path: 'src/fresh.ts', type: 'file' }]
      })
      await render()
      await waitFor(() => expect(mocks.listOpeners).toHaveBeenCalledTimes(1))
      await closeAndReopen()
      await waitFor(() => expect(mocks.listOpeners.mock.calls.length).toBeGreaterThanOrEqual(2))
      await settle(request, settlement, {
        defaultOpener: 'vscode',
        openers: [{ available: true, id: 'vscode', source: 'path', title: 'Visual Studio Code' }]
      })
      const input = document.querySelector<HTMLInputElement>('.launcher-command-search__input')!
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '/' })))
      await setInputValue('fresh')
      await waitFor(() => expect(document.querySelector('[data-launcher-command-title="fresh.ts"]')).not.toBeNull())
      const row = document.querySelector('[data-launcher-command-title="fresh.ts"]')!
      await act(async () => row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 })))
      await waitFor(() => expect(document.querySelector('.ant-dropdown-menu')).not.toBeNull())

      expect(document.querySelector('.ant-dropdown-menu')?.textContent).toContain('Zed')
      expect(document.querySelector('.ant-dropdown-menu')?.textContent).not.toContain('Visual Studio Code')
    }
  )

  it.each<Settlement>(['resolve', 'reject'])(
    'suppresses old plugin command %s settlement after close and reopen',
    async (settlement) => {
      const request = deferred<{ route?: string }>()
      pluginContext.snapshot.launcherProviders = [{
        command: 'demo.search',
        id: 'search',
        scope: 'demo',
        search: async () => [{ id: 'result', title: 'Provider result' }],
        title: 'Demo'
      }]
      pluginContext.registry.executeCommand.mockReturnValueOnce(request.promise)
      await render()
      await setInputValue('provider')
      await waitFor(() =>
        expect(document.querySelector('[data-launcher-command-title="Provider result"]')).not.toBeNull()
      )
      await click(document.querySelector('[data-launcher-command-title="Provider result"]')!)
      await waitFor(() => expect(pluginContext.registry.executeCommand).toHaveBeenCalledTimes(1))
      await closeAndReopen()
      const beforeClose = mocks.onClose.mock.calls.length
      await settle(request, settlement, { route: '/plugins/demo/result' })

      expect(mocks.onClose).toHaveBeenCalledTimes(beforeClose)
      expect(mocks.error).not.toHaveBeenCalled()
      expect(document.querySelector('.launcher-web-overlay.is-open')).not.toBeNull()
    }
  )

  it.each<Settlement>(['resolve', 'reject'])(
    'suppresses old secondary project-open %s settlement after close and reopen',
    async (settlement) => {
      const request = deferred<void>()
      mocks.listLocal.mockResolvedValue({
        currentDirectory: '/workspace',
        directories: [{ name: 'child', path: '/workspace/child' }]
      })
      mocks.openWorkspace.mockReturnValueOnce(request.promise)
      await render()
      await click(document.getElementById('open-folder')!)
      await waitFor(() =>
        expect(document.querySelector('[data-launcher-command-path="/workspace/child"]')).not.toBeNull()
      )
      const row = document.querySelector('[data-launcher-command-path="/workspace/child"]')!
      await click(row.querySelector('.launcher-command-item__secondary')!)
      await waitFor(() => expect(mocks.openWorkspace).toHaveBeenCalledTimes(1))
      await closeAndReopen()
      const beforeClose = mocks.onClose.mock.calls.length
      await settle(request, settlement, undefined)

      expect(mocks.onClose).toHaveBeenCalledTimes(beforeClose)
      expect(mocks.error).not.toHaveBeenCalled()
      expect(document.querySelector('.launcher-web-overlay.is-open')).not.toBeNull()
    }
  )
})
