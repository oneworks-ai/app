// @vitest-environment happy-dom
import { act } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '#~/i18n'
import { LauncherRoute } from '#~/routes/LauncherRoute'

const mocks = vi.hoisted(() => ({
  createLocalWorkspace: vi.fn(),
  createRelayWorkspace: vi.fn(),
  getRelayStatus: vi.fn(),
  listDirectories: vi.fn(),
  listRelayDirectories: vi.fn(),
  mergeRuntimeEnv: vi.fn(),
  message: {
    destroy: vi.fn(),
    error: vi.fn(),
    open: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  },
  modal: { confirm: vi.fn() },
  onClose: vi.fn(),
  openLocalWorkspace: vi.fn(),
  openRelayWorkspace: vi.fn(),
  rememberWorkspaceConnection: vi.fn()
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
    createLauncherWorkspaceInDirectory: mocks.createLocalWorkspace,
    getLauncherWorkspaceSelectorState: vi.fn(async () => ({ recentProjects: [], runningProjects: [] })),
    listLauncherDirectories: mocks.listDirectories,
    openLauncherWorkspace: mocks.openLocalWorkspace
  }
})

vi.mock('#~/api/launcher-relay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#~/api/launcher-relay')>()
  return {
    ...actual,
    createLauncherRelayWorkspaceInDirectory: mocks.createRelayWorkspace,
    getLauncherRelayStatus: mocks.getRelayStatus,
    listLauncherRelayDirectories: mocks.listRelayDirectories,
    openLauncherRelayWorkspace: mocks.openRelayWorkspace
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

vi.mock('#~/runtime-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#~/runtime-config')>()
  return {
    ...actual,
    isServerManagerRole: () => true,
    mergeRuntimeEnv: mocks.mergeRuntimeEnv
  }
})

vi.mock('#~/workspace-connection-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#~/workspace-connection-state')>()
  return { ...actual, rememberWorkspaceConnection: mocks.rememberWorkspaceConnection }
})

type Settlement = 'reject' | 'resolve'

const neverSettles = new Promise<never>(() => undefined)

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

describe('mounted LauncherRoute preparation lifecycle', () => {
  let consoleError: ReturnType<typeof vi.spyOn>
  let container: HTMLDivElement
  let currentPath: string
  let focusSpy: ReturnType<typeof vi.spyOn>
  let root: Root
  let rootMounted: boolean

  const route = (active: boolean) => (
    <MemoryRouter initialEntries={[currentPath]}>
      <LauncherRoute active={active} onClose={mocks.onClose} />
    </MemoryRouter>
  )

  const renderRoute = async (path: string, active = true) => {
    currentPath = path
    await act(async () => root.render(route(active)))
  }

  const deactivateBeforePassiveEffects = () => {
    flushSync(() => root.render(route(false)))
  }

  const reopenAndAcquire = async (trigger: () => Promise<void>, request: ReturnType<typeof vi.fn>) => {
    await renderRoute(currentPath)
    await trigger()
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  }

  const mutationSnapshot = () => ({
    busy: document.querySelector('.launcher-route')?.getAttribute('aria-busy'),
    close: mocks.onClose.mock.calls.length,
    consoleError: consoleError.mock.calls.length,
    focus: focusSpy.mock.calls.length,
    location: window.location.href,
    localOpen: mocks.openLocalWorkspace.mock.calls.length,
    merge: mocks.mergeRuntimeEnv.mock.calls.length,
    messageDestroy: mocks.message.destroy.mock.calls.length,
    messageError: mocks.message.error.mock.calls.length,
    messageOpen: mocks.message.open.mock.calls.length,
    messageSuccess: mocks.message.success.mock.calls.length,
    messageWarning: mocks.message.warning.mock.calls.length,
    opening: document.querySelectorAll('.workspace-opening-overlay').length,
    recentDirectories: localStorage.getItem('oneworks_launcher_clone_destination_directories'),
    relayOpen: mocks.openRelayWorkspace.mock.calls.length,
    remember: mocks.rememberWorkspaceConnection.mock.calls.length
  })

  const settleLate = async <Result,>(
    request: ReturnType<typeof deferred<Result>>,
    settlement: Settlement,
    value: Result
  ) => {
    const before = mutationSnapshot()
    if (settlement === 'resolve') request.resolve(value)
    else request.reject(new Error('late failure'))
    await act(async () => {
      await request.promise.catch(() => undefined)
      await Promise.resolve()
    })
    expect(mutationSnapshot()).toEqual(before)
  }

  const localDirectoryApi = (overrides: Record<string, unknown> = {}) => ({
    getWorkspaceSelectorState: vi.fn(async () => ({ recentProjects: [], runningProjects: [] })),
    listCloneDestinationDirectories: mocks.listDirectories,
    onWorkspaceSelectorStateChange: vi.fn(() => () => undefined),
    openWorkspace: mocks.openLocalWorkspace,
    platform: 'darwin' as const,
    ...overrides
  })

  const defineDesktopApi = (value: unknown) => {
    Object.defineProperty(window, 'oneworksDesktop', {
      configurable: true,
      value,
      writable: true
    })
  }

  const awaitDirectoryRow = async (path: string) => {
    await waitFor(() => {
      expect(
        Array.from(document.querySelectorAll<HTMLElement>('[data-launcher-command-path]'))
          .find(element => element.dataset.launcherCommandPath === path)
      ).not.toBeUndefined()
    })
    return Array.from(document.querySelectorAll<HTMLElement>('[data-launcher-command-path]'))
      .find(element => element.dataset.launcherCommandPath === path)!
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
    localStorage.clear()
    vi.clearAllMocks()
    mocks.getRelayStatus.mockResolvedValue({
      device: { id: 'local-device' },
      servers: [{
        active: true,
        connected: true,
        devices: [{
          alias: 'Remote',
          capabilities: { sessions: true, workspaceLauncher: true },
          id: 'remote-device',
          name: 'Remote Device',
          status: 'online',
          workspaceFolder: '/remote'
        }],
        id: 'relay-server',
        name: 'Relay'
      }]
    })
    mocks.listDirectories.mockImplementation(async (directory?: string) => ({
      currentDirectory: directory ?? '/workspace',
      directories: [{ name: 'alpha', path: '/workspace/alpha' }],
      parentDirectory: '/'
    }))
    mocks.listRelayDirectories.mockImplementation(async ({ directory }: { directory?: string }) => ({
      currentDirectory: directory ?? '/remote',
      directories: [{ name: 'alpha', path: '/remote/alpha' }],
      parentDirectory: '/'
    }))
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
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
    await i18n.changeLanguage('en')
  })

  it.each<Settlement>(['resolve', 'reject'])(
    'invalidates chooseWorkspace %s before passive effects and never starts open',
    async (settlement) => {
      const request = deferred<string | undefined>()
      const chooseWorkspace = vi.fn()
        .mockImplementationOnce(() => request.promise)
        .mockImplementation(() => neverSettles)
      defineDesktopApi(localDirectoryApi({
        chooseWorkspace,
        listCloneDestinationDirectories: undefined
      }))
      await renderRoute('/launcher')
      await waitFor(() => expect(document.getElementById('open-folder')).not.toBeNull())

      await click(document.getElementById('open-folder')!)
      await waitFor(() => expect(chooseWorkspace).toHaveBeenCalledTimes(1))
      deactivateBeforePassiveEffects()
      await reopenAndAcquire(() => click(document.getElementById('open-folder')!), chooseWorkspace)
      await settleLate(request, settlement, '/workspace/chosen')

      expect(mocks.openLocalWorkspace).not.toHaveBeenCalled()
    }
  )

  it.each<Settlement>(['resolve', 'reject'])(
    'invalidates clone %s before passive effects and suppresses late notification/open',
    async (settlement) => {
      const destinationDirectory = '/workspace/ alpha '
      const request = deferred<string | undefined>()
      const cloneRepository = vi.fn()
        .mockImplementationOnce(() => request.promise)
        .mockImplementation(() => neverSettles)
      mocks.listDirectories.mockImplementation(async () => ({
        currentDirectory: '/workspace',
        directories: [{ name: ' alpha ', path: destinationDirectory }],
        parentDirectory: '/'
      }))
      defineDesktopApi(localDirectoryApi({
        cloneRepository,
        isGitAvailable: vi.fn(async () => true)
      }))
      await renderRoute('/launcher/browse/clone/local/%2Fworkspace')
      const row = await awaitDirectoryRow(destinationDirectory)
      await setInputValue('https://example.test/repository.git')

      await click(row)
      await waitFor(() => expect(cloneRepository).toHaveBeenCalledTimes(1))
      expect(cloneRepository).toHaveBeenCalledWith('https://example.test/repository.git', destinationDirectory)
      expect(localStorage.getItem('oneworks_launcher_clone_destination_directories'))
        .toBe(JSON.stringify([destinationDirectory]))
      deactivateBeforePassiveEffects()
      expect(mocks.message.destroy).toHaveBeenCalledWith('launcher-clone-repository')
      await reopenAndAcquire(async () => click(await awaitDirectoryRow(destinationDirectory)), cloneRepository)
      await settleLate(request, settlement, '/workspace/cloned')

      expect(mocks.openLocalWorkspace).not.toHaveBeenCalled()
    }
  )

  it.each<Settlement>(['resolve', 'reject'])(
    'supersedes desktop-local create %s across close/reopen and suppresses late recent/open effects',
    async (settlement) => {
      const parentDirectory = '/workspace '
      const request = deferred<string | undefined>()
      const createWorkspaceInDirectory = vi.fn()
        .mockImplementationOnce(() => request.promise)
        .mockImplementation(() => neverSettles)
      defineDesktopApi(localDirectoryApi({ createWorkspaceInDirectory }))
      await renderRoute(`/launcher/browse/create-workspace/local/${encodeURIComponent(parentDirectory)}`)
      const row = await awaitDirectoryRow(parentDirectory)
      await setInputValue('created-project')

      await click(row)
      await waitFor(() => expect(createWorkspaceInDirectory).toHaveBeenCalledTimes(1))
      expect(createWorkspaceInDirectory).toHaveBeenCalledWith(parentDirectory, 'created-project')
      deactivateBeforePassiveEffects()
      await reopenAndAcquire(async () => click(await awaitDirectoryRow(parentDirectory)), createWorkspaceInDirectory)
      await settleLate(request, settlement, '/workspace/alpha/created-project')

      expect(mocks.openLocalWorkspace).not.toHaveBeenCalled()
    }
  )

  it.each<Settlement>(['resolve', 'reject'])(
    'invalidates manager-local create %s before passive effects and suppresses late recent/open effects',
    async (settlement) => {
      const parentDirectory = '/workspace/ Manager Parent '
      const request = deferred<{ workspaceFolder: string }>()
      mocks.createLocalWorkspace
        .mockImplementationOnce(() => request.promise)
        .mockImplementation(() => neverSettles)
      defineDesktopApi(undefined)
      await renderRoute(`/launcher/browse/create-workspace/local/${encodeURIComponent(parentDirectory)}`)
      const row = await awaitDirectoryRow(parentDirectory)
      await setInputValue('manager-created-project')

      await click(row)
      await waitFor(() => expect(mocks.createLocalWorkspace).toHaveBeenCalledTimes(1))
      expect(mocks.createLocalWorkspace).toHaveBeenCalledWith(parentDirectory, 'manager-created-project')
      deactivateBeforePassiveEffects()
      await reopenAndAcquire(async () => click(await awaitDirectoryRow(parentDirectory)), mocks.createLocalWorkspace)
      await settleLate(request, settlement, { workspaceFolder: '/workspace/alpha/manager-created-project' })

      expect(mocks.openLocalWorkspace).not.toHaveBeenCalled()
    }
  )

  it.each<Settlement>(['resolve', 'reject'])(
    'invalidates relay create %s before passive effects and suppresses late relay/env/navigation effects',
    async (settlement) => {
      const parentDirectory = String.raw`\\server\share\ Remote Parent `
      const request = deferred<{ workspaceFolder: string }>()
      mocks.createRelayWorkspace
        .mockImplementationOnce(() => request.promise)
        .mockImplementation(() => neverSettles)
      mocks.getRelayStatus.mockResolvedValue({
        device: { id: 'local-device' },
        servers: [{
          active: true,
          connected: true,
          devices: [{
            alias: 'Remote',
            capabilities: { sessions: true, workspaceLauncher: true },
            id: 'remote-device',
            name: 'Remote Device',
            status: 'online',
            workspaceFolder: parentDirectory
          }],
          id: 'relay-server',
          name: 'Relay'
        }]
      })
      defineDesktopApi(undefined)
      await renderRoute('/launcher/browse/create-workspace/local/%2Fworkspace')
      await waitFor(() => expect(document.querySelector('[title="Remote · Relay"]')).not.toBeNull())
      await click(document.querySelector('[title="Remote · Relay"]')!)
      const row = await awaitDirectoryRow(parentDirectory)
      await setInputValue('remote-project')

      await click(row)
      await waitFor(() => expect(mocks.createRelayWorkspace).toHaveBeenCalledTimes(1))
      expect(mocks.createRelayWorkspace).toHaveBeenCalledWith(expect.objectContaining({ parentDirectory }))
      deactivateBeforePassiveEffects()
      await reopenAndAcquire(async () => click(await awaitDirectoryRow(parentDirectory)), mocks.createRelayWorkspace)
      await settleLate(request, settlement, { workspaceFolder: '/remote/alpha/remote-project' })

      expect(mocks.openRelayWorkspace).not.toHaveBeenCalled()
      expect(mocks.mergeRuntimeEnv).not.toHaveBeenCalled()
      expect(mocks.rememberWorkspaceConnection).not.toHaveBeenCalled()
    }
  )
})
