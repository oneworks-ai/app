// @vitest-environment happy-dom
import { App as AntdApp } from 'antd'
import { act, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getModalFocusableElements } from '@oneworks/route-layout'

import { LauncherOverlay } from '#~/routes/LauncherOverlay'

const workspaceFolder = '/workspace/ project '
const mocks = vi.hoisted(() => ({
  forgetWorkspace: vi.fn<(workspaceFolder: string) => Promise<void>>(async () => {}),
  previewNativeProjectHistory: vi.fn(),
  runNativeProjectHistoryImport: vi.fn(),
  stopWorkspace: vi.fn<(workspaceFolder: string, options?: { remove?: boolean }) => Promise<void>>(async () => {})
}))
const pluginContext = vi.hoisted(() => ({
  registry: { executeCommand: vi.fn(), findRoute: vi.fn() },
  snapshot: { launcherProviders: [], routes: [], slots: {} }
}))

vi.mock('#~/api', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  getConfig: vi.fn(async () => ({ sources: { merged: {} } })),
  previewNativeProjectHistory: mocks.previewNativeProjectHistory,
  runNativeProjectHistoryImport: mocks.runNativeProjectHistoryImport
}))

vi.mock('#~/api/launcher', () => ({
  createLauncherWorkspaceInDirectory: vi.fn(),
  forgetLauncherWorkspace: vi.fn(),
  getLauncherManagerServerBaseUrl: vi.fn(),
  getLauncherWorkspaceSelectorState: vi.fn(async () => ({ recentProjects: [], runningProjects: [] })),
  listLauncherDirectories: vi.fn(),
  openLauncherWorkspace: vi.fn(),
  stopLauncherWorkspace: vi.fn()
}))

vi.mock('#~/api/launcher-relay', () => ({
  createLauncherRelayWorkspaceInDirectory: vi.fn(),
  getLauncherRelayStatus: vi.fn(async () => ({ device: undefined, servers: [] })),
  listLauncherRelayDirectories: vi.fn(),
  openLauncherRelayWorkspace: vi.fn()
}))

vi.mock('#~/components/action-search-toolbar/ActionSearchToolbar', () => ({
  ActionSearchToolbarActions: () => null
}))

vi.mock('#~/components/launcher/LauncherAboutView', () => ({ LauncherAboutView: () => null }))
vi.mock('#~/components/usage/UsagePanel', () => ({ UsagePanel: () => null }))
vi.mock('#~/components/workspace/WorkspaceOpeningOverlay', () => ({ WorkspaceOpeningOverlay: () => null }))
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
  useOptionalPluginContext: () => undefined,
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
vi.mock('#~/hooks/use-native-history-import-notification', () => ({
  useNativeHistoryImportNotification: () => vi.fn(async () => {})
}))

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

describe('launcher overlay nested confirmation focus ownership', () => {
  let closeFromOwner: () => void
  let container: HTMLDivElement
  let offsetParentDescriptor: PropertyDescriptor | undefined
  let opener: HTMLButtonElement
  let projectKind: 'recent' | 'running'
  let reopen: () => void
  let root: Root

  function Harness() {
    const [open, setOpen] = useState(true)
    closeFromOwner = () => setOpen(false)
    reopen = () => setOpen(true)
    return <LauncherOverlay open={open} onClose={() => setOpen(false)} />
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
      get() {
        return this.parentElement
      }
    })
  })

  beforeEach(async () => {
    mocks.forgetWorkspace.mockClear()
    mocks.previewNativeProjectHistory.mockReset()
    mocks.runNativeProjectHistoryImport.mockReset()
    mocks.stopWorkspace.mockClear()
    mocks.previewNativeProjectHistory.mockResolvedValue({
      adapters: [{
        adapter: 'codex',
        candidates: [{
          adapter: 'codex',
          createdAt: 1,
          cwd: workspaceFolder,
          fileSizeBytes: 1,
          isArchived: false,
          isImported: false,
          isLarge: false,
          isPinned: false,
          nativeSessionId: 'native-session',
          sourcePath: `${workspaceFolder}/rollout.jsonl`,
          title: 'External session',
          updatedAt: 2
        }],
        hasMore: false,
        isComplete: true,
        largeFiles: 0,
        largestFileBytes: 1,
        matchedFiles: 1,
        projects: [{ path: workspaceFolder, sessionCount: 1 }],
        scannedFiles: 1,
        totalBytes: 1
      }]
    })
    mocks.runNativeProjectHistoryImport.mockResolvedValue({
      importedEvents: 0,
      importedSessions: 0,
      matchedFiles: 1,
      scannedFiles: 1,
      sessions: []
    })
    projectKind = 'recent'
    opener = document.createElement('button')
    opener.textContent = 'Open launcher'
    document.body.appendChild(opener)
    opener.focus()
    container = document.createElement('div')
    document.body.appendChild(container)
    Object.defineProperty(window, 'oneworksDesktop', {
      configurable: true,
      value: {
        forgetWorkspace: mocks.forgetWorkspace,
        getWorkspaceSelectorState: vi.fn(async () => ({
          recentProjects: projectKind === 'recent'
            ? [{
              description: workspaceFolder,
              name: 'Whitespace project',
              workspaceFolder
            }]
            : [],
          runningProjects: projectKind === 'running'
            ? [{
              description: workspaceFolder,
              name: 'Whitespace project',
              status: 'running',
              workspaceFolder
            }]
            : []
        })),
        platform: 'darwin',
        stopWorkspace: mocks.stopWorkspace
      }
    })
    root = createRoot(container)
    await act(async () => {
      root.render(
        <AntdApp>
          <MemoryRouter initialEntries={['/launcher']}>
            <Harness />
          </MemoryRouter>
        </AntdApp>
      )
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    delete (window as { oneworksDesktop?: unknown }).oneworksDesktop
    container.remove()
    opener.remove()
  })

  afterAll(() => {
    if (offsetParentDescriptor == null) {
      delete (HTMLElement.prototype as { offsetParent?: unknown }).offsetParent
    } else {
      Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParentDescriptor)
    }
  })

  it('keeps the real AntD confirmation inside the active focus boundary and executes it', async () => {
    await waitFor(() => {
      expect(document.querySelector('.launcher-command-item__remove')).not.toBeNull()
    })
    const removeButton = document.querySelector<HTMLButtonElement>('.launcher-command-item__remove')!
    await act(async () => removeButton.click())

    let dialog!: HTMLElement
    await waitFor(() => {
      dialog = document.querySelector<HTMLElement>('.launcher-route [role="dialog"]')!
      expect(dialog).not.toBeNull()
    })
    const launcherRoute = document.querySelector<HTMLElement>('.launcher-route')!
    expect(launcherRoute.contains(dialog)).toBe(true)

    const focusable = getModalFocusableElements(dialog)
    expect(focusable.length).toBeGreaterThanOrEqual(2)
    focusable.at(-1)!.focus()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab' }))
    })
    expect(document.activeElement).toBe(focusable[0])
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Tab',
          shiftKey: true
        })
      )
    })
    expect(document.activeElement).toBe(focusable.at(-1))

    opener.focus()
    expect(dialog.contains(document.activeElement)).toBe(true)

    const confirmButton = dialog.querySelector<HTMLButtonElement>('.ant-btn-primary')!
    await act(async () => confirmButton.click())
    await waitFor(() => {
      expect(mocks.forgetWorkspace).toHaveBeenCalledWith(workspaceFolder)
    })
  })

  it('destroys an unconfirmed owned dialog before external close and does not revive it after reopen', async () => {
    await waitFor(() => expect(document.querySelector('.launcher-command-item__remove')).not.toBeNull())
    await act(async () => document.querySelector<HTMLButtonElement>('.launcher-command-item__remove')!.click())
    await waitFor(() => expect(document.querySelector('.launcher-route [role="dialog"]')).not.toBeNull())
    const staleConfirm = document.querySelector<HTMLButtonElement>('.launcher-route .ant-btn-primary')!

    await act(async () => closeFromOwner())

    await waitFor(() => expect(document.querySelector('.launcher-route [role="dialog"]')).toBeNull())
    expect(document.activeElement).toBe(opener)
    staleConfirm.click()
    expect(mocks.forgetWorkspace).not.toHaveBeenCalled()

    await act(async () => reopen())
    await waitFor(() => expect(document.querySelector('.launcher-web-overlay.is-open')).not.toBeNull())
    expect(document.querySelector('.launcher-route [role="dialog"]')).toBeNull()
  })

  it('destroys an unconfirmed owned dialog before unmount without executing stale onOk', async () => {
    await waitFor(() => expect(document.querySelector('.launcher-command-item__remove')).not.toBeNull())
    await act(async () => document.querySelector<HTMLButtonElement>('.launcher-command-item__remove')!.click())
    await waitFor(() => expect(document.querySelector('.launcher-route [role="dialog"]')).not.toBeNull())
    const staleConfirm = document.querySelector<HTMLButtonElement>('.launcher-route .ant-btn-primary')!

    await act(async () => root.unmount())

    expect(document.querySelector('.launcher-route [role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
    staleConfirm.click()
    expect(mocks.forgetWorkspace).not.toHaveBeenCalled()
    root = createRoot(container)
  })

  it.each(['unconfirmed', 'confirmed-resolve', 'confirmed-reject'] as const)(
    'invalidates an external-session %s import across close/reopen',
    async (scenario) => {
      const importRequest = deferred<Awaited<ReturnType<typeof mocks.runNativeProjectHistoryImport>>>()
      if (scenario !== 'unconfirmed') mocks.runNativeProjectHistoryImport.mockReturnValueOnce(importRequest.promise)

      await act(async () => document.querySelector<HTMLButtonElement>('.launcher-command-footer__brand')!.click())
      await waitFor(() => expect(document.querySelector('.ant-dropdown-menu')).not.toBeNull())
      const settingsItem = [...document.querySelectorAll<HTMLElement>('.ant-dropdown-menu-item')]
        .find(item => item.textContent?.includes('Settings'))
      if (settingsItem == null) throw new Error('Missing launcher settings action')
      await act(async () => settingsItem.click())
      await waitFor(() => expect(document.getElementById('launcher-settings-tab-external-sessions')).not.toBeNull())
      await act(async () => document.getElementById('launcher-settings-tab-external-sessions')!.click())
      await waitFor(() => expect(document.querySelector('[aria-label="Import all"]')).not.toBeNull())
      await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Import all"]')!.click())
      await waitFor(() => expect(document.querySelector('.launcher-route [role="dialog"]')).not.toBeNull())
      const staleConfirm = document.querySelector<HTMLButtonElement>('.launcher-route .ant-btn-primary')!

      if (scenario !== 'unconfirmed') {
        await act(async () => staleConfirm.click())
        await waitFor(() => expect(mocks.runNativeProjectHistoryImport).toHaveBeenCalledTimes(1))
      }
      await act(async () => closeFromOwner())
      await act(async () => reopen())
      await waitFor(() => expect(document.querySelector('.launcher-web-overlay.is-open')).not.toBeNull())

      if (scenario === 'unconfirmed') {
        staleConfirm.click()
        expect(mocks.runNativeProjectHistoryImport).not.toHaveBeenCalled()
      } else if (scenario === 'confirmed-resolve') {
        importRequest.resolve({
          importedEvents: 1,
          importedSessions: 1,
          matchedFiles: 1,
          scannedFiles: 1,
          sessions: []
        })
      } else {
        importRequest.reject(new Error('late external-session failure'))
      }
      if (scenario !== 'unconfirmed') {
        await act(async () => {
          await importRequest.promise.catch(() => undefined)
          await Promise.resolve()
        })
      }

      expect(document.querySelector('.launcher-route [role="dialog"]')).toBeNull()
      expect(document.querySelector('.ant-message')).toBeNull()
      expect(document.querySelector('.notification-queue')).toBeNull()
    }
  )

  it.each(
    [
      ['forget', 'resolve'],
      ['forget', 'reject'],
      ['stop', 'resolve'],
      ['stop', 'reject']
    ] as const
  )(
    'suppresses confirmed %s mutation after close/reopen and late %s',
    async (action, settlement) => {
      const request = deferred<void>()
      projectKind = action === 'stop' ? 'running' : 'recent'
      await act(async () => root.unmount())
      root = createRoot(container)
      await act(async () => {
        root.render(
          <AntdApp>
            <MemoryRouter initialEntries={['/launcher']}>
              <Harness />
            </MemoryRouter>
          </AntdApp>
        )
      })

      if (action === 'forget') {
        mocks.forgetWorkspace.mockReturnValueOnce(request.promise)
        await waitFor(() => expect(document.querySelector('.launcher-command-item__remove')).not.toBeNull())
        await act(async () => document.querySelector<HTMLButtonElement>('.launcher-command-item__remove')!.click())
      } else {
        mocks.stopWorkspace.mockReturnValueOnce(request.promise)
        await waitFor(() =>
          expect(document.querySelector(`[data-launcher-command-path="${workspaceFolder}"]`)).not.toBeNull()
        )
        const project = document.querySelector(`[data-launcher-command-path="${workspaceFolder}"]`)!
        await act(async () => project.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 })))
        await waitFor(() => expect(document.querySelector('.ant-dropdown-menu')).not.toBeNull())
        const stopItem = [...document.querySelectorAll<HTMLElement>('.ant-dropdown-menu-item')]
          .find(item => item.textContent?.includes('Stop service'))
        if (stopItem == null) throw new Error('Missing stop service action')
        await act(async () => stopItem.click())
      }
      await waitFor(() => expect(document.querySelector('.launcher-route [role="dialog"]')).not.toBeNull())
      await act(async () => document.querySelector<HTMLButtonElement>('.launcher-route .ant-btn-primary')!.click())
      await waitFor(() =>
        expect(
          action === 'forget' ? mocks.forgetWorkspace : mocks.stopWorkspace
        ).toHaveBeenCalledTimes(1)
      )

      await act(async () => closeFromOwner())
      await act(async () => reopen())
      await waitFor(() => expect(document.querySelector('.launcher-web-overlay.is-open')).not.toBeNull())
      const beforeText = document.querySelector('.launcher-route')?.textContent
      if (settlement === 'resolve') request.resolve()
      else request.reject(new Error('late owner failure'))
      await act(async () => {
        await request.promise.catch(() => undefined)
        await Promise.resolve()
      })

      expect(document.querySelector('.launcher-route')?.textContent).toBe(beforeText)
      expect(document.querySelector('.ant-message')).toBeNull()
      expect(document.querySelector('.launcher-route [role="dialog"]')).toBeNull()
      expect(document.querySelector(`[data-launcher-command-path="${workspaceFolder}"]`)).not.toBeNull()
    }
  )
})
