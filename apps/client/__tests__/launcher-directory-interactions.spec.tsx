// @vitest-environment happy-dom
import { App } from 'antd'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '#~/i18n'
import { LauncherRoute } from '#~/routes/LauncherRoute'

const mocks = vi.hoisted(() => ({
  listDirectories: vi.fn(),
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

vi.mock('#~/components/action-search-toolbar/ActionSearchToolbar', () => ({
  ActionSearchToolbarActions: () => null
}))

vi.mock('#~/components/launcher/LauncherAboutView', () => ({ LauncherAboutView: () => null }))

vi.mock('#~/components/launcher/LauncherSettingsView', () => ({ LauncherSettingsView: () => null }))

vi.mock('#~/components/usage/UsagePanel', () => ({ UsagePanel: () => null }))

vi.mock('#~/components/workspace/WorkspaceOpeningOverlay', () => ({
  WorkspaceOpeningOverlay: ({ title }: { title: string }) => (
    <div className='workspace-opening-overlay'>{title}</div>
  )
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

const press = async (input: HTMLInputElement, key: string) => {
  input.setSelectionRange(input.value.length, input.value.length)
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }))
  })
}

const setInputValue = async (input: HTMLInputElement, value: string) => {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (valueSetter == null) throw new Error('Missing input value setter')
  await act(async () => {
    valueSetter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))
  })
}

describe('mounted LauncherRoute directory actions', () => {
  let container: HTMLDivElement
  let root: Root

  const renderRoute = async (
    active = true,
    routePath = '/launcher/browse/open-workspace/local/%2Fworkspace'
  ) => {
    await act(async () => {
      root.render(
        <App>
          <MemoryRouter initialEntries={[routePath]} key={routePath}>
            <LauncherRoute active={active} onClose={mocks.onClose} />
          </MemoryRouter>
        </App>
      )
    })
  }

  const alphaRow = () => document.querySelector<HTMLElement>('[data-launcher-command-path="/workspace/alpha"]')
  const commandsByPath = (path: string) => (
    [...document.querySelectorAll<HTMLElement>('[data-launcher-command-path]')]
      .filter(element => element.dataset.launcherCommandPath === path)
  )
  const commandByPath = (path: string) => commandsByPath(path)[0]
  const breadcrumbByPath = (path: string) => (
    [...document.querySelectorAll<HTMLElement>('.launcher-directory-breadcrumb [title]')]
      .find(element => element.getAttribute('title') === path)
  )
  const input = () => document.querySelector<HTMLInputElement>('.launcher-command-search__input')

  const awaitAlphaRow = async () => {
    await waitFor(() => expect(alphaRow()).not.toBeNull())
    return alphaRow()!
  }

  const selectAlphaWithKeyboard = async () => {
    const searchInput = input()
    if (searchInput == null) throw new Error('Missing launcher search input')
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (alphaRow()?.getAttribute('aria-selected') === 'true') return searchInput
      await press(searchInput, 'ArrowDown')
    }
    throw new Error('Could not select alpha with the production keyboard path')
  }

  const activateContextItem = async (label: string) => {
    const row = await awaitAlphaRow()
    await act(async () => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2, cancelable: true }))
    })
    await waitFor(() => {
      expect([...document.querySelectorAll('.ant-dropdown-menu-item')]
        .some(item => item.textContent?.includes(label))).toBe(true)
    })
    const item = [...document.querySelectorAll('.ant-dropdown-menu-item')]
      .find(candidate => candidate.textContent?.includes(label))
    if (item == null) throw new Error(`Missing context action: ${label}`)
    await click(item)
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
    mocks.listDirectories.mockReset().mockImplementation(async (directory?: string) => {
      const currentDirectory = directory ?? '/workspace'
      if (currentDirectory === '/workspace/alpha') {
        return {
          currentDirectory,
          directories: [{ name: 'nested', path: '/workspace/alpha/nested' }],
          parentDirectory: '/workspace'
        }
      }
      return {
        currentDirectory: '/workspace',
        directories: [{ name: 'alpha', path: '/workspace/alpha' }],
        parentDirectory: '/'
      }
    })
    mocks.onClose.mockReset()
    mocks.openWorkspace.mockReset().mockImplementation(() => new Promise(() => undefined))
    Object.defineProperty(window, 'oneworksDesktop', {
      configurable: true,
      value: {
        getWorkspaceSelectorState: vi.fn(async () => ({ recentProjects: [], runningProjects: [] })),
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
    await renderRoute()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
  })

  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders distinct localized enter and open-as-project hit regions', async () => {
    const row = await awaitAlphaRow()
    const primary = row.querySelector<HTMLButtonElement>('.launcher-command-item__enter')
    const explicit = row.querySelector<HTMLButtonElement>('.launcher-command-item__secondary')

    expect(row.dataset.launcherCommandActionLabel).toBe('enter-directory')
    expect(primary?.getAttribute('aria-label')).toBe('Enter folder')
    expect(primary?.textContent).toContain('chevron_right')
    expect(explicit?.getAttribute('aria-label')).toBe('Open this folder as a project')
    expect(explicit?.textContent).toContain('folder_open')

    await act(async () => {
      await i18n.changeLanguage('zh')
    })
    expect(primary?.getAttribute('aria-label')).toBe('进入文件夹')
    expect(explicit?.getAttribute('aria-label')).toBe('将此文件夹作为项目打开')
  })

  it.each(['row', 'primary-control', 'Enter', 'context-primary'])(
    'routes the %s entry marker through folder navigation',
    async (entry) => {
      const row = await awaitAlphaRow()
      if (entry === 'row') await click(row)
      if (entry === 'primary-control') await click(row.querySelector('.launcher-command-item__enter')!)
      if (entry === 'Enter') {
        await press(await selectAlphaWithKeyboard(), 'Enter')
      }
      if (entry === 'context-primary') await activateContextItem('Enter folder')

      await waitFor(() => expect(mocks.listDirectories).toHaveBeenCalledWith('/workspace/alpha'))
      expect(mocks.openWorkspace).not.toHaveBeenCalled()
    }
  )

  it.each(['explicit-control', 'ArrowRight', 'context-secondary'])(
    'routes the %s entry marker through the explicit project-open action',
    async (entry) => {
      const row = await awaitAlphaRow()
      if (entry === 'explicit-control') await click(row.querySelector('.launcher-command-item__secondary')!)
      if (entry === 'ArrowRight') {
        await press(await selectAlphaWithKeyboard(), 'ArrowRight')
      }
      if (entry === 'context-secondary') {
        await activateContextItem('Open this folder as a project')
      }

      await waitFor(() => expect(mocks.openWorkspace).toHaveBeenCalledWith('/workspace/alpha'))
      expect(mocks.listDirectories).not.toHaveBeenCalledWith('/workspace/alpha')
    }
  )

  it('navigates the complete breadcrumb path and restores search focus', async () => {
    await click(await awaitAlphaRow())
    await waitFor(() =>
      expect(document.querySelector('[aria-current="location"]')?.getAttribute('title'))
        .toBe('/workspace/alpha')
    )
    const breadcrumb = document.querySelector<HTMLElement>('.launcher-directory-breadcrumb')
    expect(breadcrumb?.querySelector('[title="/"]')).not.toBeNull()
    expect(breadcrumb?.querySelector('[title="/workspace"]')).not.toBeNull()

    await click(breadcrumb!.querySelector('[title="/workspace"]')!)
    await waitFor(() => expect(alphaRow()).not.toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(input()))
  })

  it.each([
    {
      child: String.raw`C:\Users\Example\project\child`,
      current: String.raw`C:\Users\Example\project`,
      label: 'drive',
      parent: String.raw`C:\Users\Example`,
      root: 'C:\\'
    },
    {
      child: String.raw`\\server\share\project\child`,
      current: String.raw`\\server\share\project`,
      label: 'UNC',
      parent: String.raw`\\server\share`,
      root: String.raw`\\server\share`
    }
  ])(
    'preserves $label breadcrumb roots when clicking and opening',
    async ({ child, current, parent, root: rootPath }) => {
      mocks.listDirectories.mockReset().mockImplementation(async (directory?: string) => ({
        currentDirectory: directory ?? current,
        directories: directory === parent
          ? [{ name: 'project', path: current }]
          : [{ name: 'child', path: child }],
        parentDirectory: directory === parent ? rootPath : parent
      }))
      await renderRoute(true, `/launcher/browse/open-workspace/local/${encodeURIComponent(current)}`)
      await waitFor(() => expect(breadcrumbByPath(rootPath)).not.toBeUndefined())

      await click(breadcrumbByPath(parent)!)
      await waitFor(() => expect(mocks.listDirectories).toHaveBeenCalledWith(parent))
      const projectRow = commandByPath(current)
      if (projectRow == null) throw new Error('Missing project row after breadcrumb navigation')
      await click(projectRow.querySelector('.launcher-command-item__secondary')!)
      expect(mocks.openWorkspace).toHaveBeenCalledWith(current)
    }
  )

  it('round-trips and opens a raw whitespace path without changing its identity', async () => {
    const rawPath = ' /workspace/ Project '
    mocks.listDirectories.mockReset().mockImplementation(async () => ({
      currentDirectory: rawPath,
      directories: [],
      parentDirectory: '/workspace'
    }))
    await renderRoute(true, `/launcher/browse/open-workspace/local/${encodeURIComponent(rawPath)}`)
    await waitFor(() => expect(mocks.listDirectories).toHaveBeenCalledWith(rawPath))
    expect(document.querySelector('[aria-current="location"]')?.getAttribute('title')).toBe(rawPath)

    const currentRow = commandByPath(rawPath)
    if (currentRow == null) throw new Error('Missing raw current-directory row')
    await click(currentRow)
    expect(mocks.openWorkspace).toHaveBeenCalledWith(rawPath)
    expect(localStorage.getItem('oneworks_launcher_clone_destination_directories')).toBe(JSON.stringify([rawPath]))
  })

  it('opens a typed direct path with trailing whitespace unchanged', async () => {
    const rawPath = '/workspace/direct '
    const searchInput = input()
    if (searchInput == null) throw new Error('Missing launcher search input')
    await setInputValue(searchInput, rawPath)
    await waitFor(() => expect(commandByPath(rawPath)).not.toBeUndefined())
    expect(commandsByPath(rawPath)).toHaveLength(1)

    await click(commandByPath(rawPath)!)
    expect(mocks.openWorkspace).toHaveBeenCalledWith(rawPath)
  })

  it.each(['resolve', 'reject'] as const)(
    'invalidates the production open request synchronously on Escape close before a late %s',
    async (settlement) => {
      const request = deferred<void>()
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mocks.openWorkspace.mockReset().mockImplementation(() => request.promise)

      await click((await awaitAlphaRow()).querySelector('.launcher-command-item__secondary')!)
      await waitFor(() => expect(document.querySelector('.workspace-opening-overlay')).not.toBeNull())
      const searchInput = input()
      if (searchInput == null) throw new Error('Missing launcher search input')
      await press(searchInput, 'Escape')

      expect(mocks.onClose).toHaveBeenCalledTimes(1)
      expect(document.querySelector('.workspace-opening-overlay')).toBeNull()
      await act(async () => {
        if (settlement === 'resolve') request.resolve()
        else request.reject(new Error('late failure'))
        await request.promise.catch(() => undefined)
      })
      expect(mocks.onClose).toHaveBeenCalledTimes(1)
      expect(consoleError).not.toHaveBeenCalled()
      consoleError.mockRestore()
    }
  )

  it('clears on inactive, reopens, and ignores the older deferred settlement', async () => {
    const first = deferred<void>()
    const second = deferred<void>()
    mocks.openWorkspace.mockReset()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

    await click((await awaitAlphaRow()).querySelector('.launcher-command-item__secondary')!)
    await waitFor(() => expect(document.querySelector('.workspace-opening-overlay')).not.toBeNull())
    await renderRoute(false)
    await waitFor(() => expect(document.querySelector('.workspace-opening-overlay')).toBeNull())
    await renderRoute(true)
    await click((await awaitAlphaRow()).querySelector('.launcher-command-item__secondary')!)

    await act(async () => {
      first.reject(new Error('late failure'))
      await first.promise.catch(() => undefined)
    })
    expect(document.querySelector('.workspace-opening-overlay')).not.toBeNull()
    expect(mocks.onClose).not.toHaveBeenCalled()

    await act(async () => {
      second.resolve()
      await second.promise
    })
    await waitFor(() => expect(mocks.onClose).toHaveBeenCalledTimes(1))
  })
})
