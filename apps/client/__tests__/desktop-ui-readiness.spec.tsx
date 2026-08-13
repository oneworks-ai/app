// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { act, useContext, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DesktopWorkspaceStartupProvider } from '#~/components/layout/DesktopWorkspaceStartupOverlay'
import {
  DesktopWorkspaceStartupReadyContext,
  useDesktopWorkspaceStartupReady
} from '#~/components/layout/desktop-workspace-startup-ready'
import { useDesktopUiReady } from '#~/desktop/use-desktop-ui-ready'

const clientRoot = path.resolve(__dirname, '..')

function ReadinessProbe({ ready }: { ready: boolean }) {
  useDesktopUiReady(ready)
  return <main>Visible product state</main>
}

function WorkspaceReadinessProbe({
  readiness = 'editable',
  ready,
  selector = "[data-oneworks-sender-editor-ready='true']"
}: {
  readiness?: 'degraded' | 'editable'
  ready: boolean
  selector?: string
}) {
  useDesktopWorkspaceStartupReady(ready, {
    readiness,
    visibleSelector: selector
  })
  return null
}

function SenderReadinessProbe({ unavailable }: { unavailable: boolean }) {
  return (
    <>
      <WorkspaceReadinessProbe ready />
      <WorkspaceReadinessProbe
        readiness='degraded'
        ready
        selector="[data-oneworks-sender-editor-unavailable='true']"
      />
      <div
        ref={(element) => {
          if (element == null) return
          element.getBoundingClientRect = () => ({
            bottom: 20,
            height: 20,
            left: 0,
            right: 100,
            toJSON: () => ({}),
            top: 0,
            width: 100,
            x: 0,
            y: 0
          })
        }}
        data-oneworks-sender-editor-ready={unavailable ? undefined : 'true'}
        data-oneworks-sender-editor-unavailable={unavailable ? 'true' : undefined}
      />
    </>
  )
}

function StartupProviderReadyProbe() {
  const markReady = useContext(DesktopWorkspaceStartupReadyContext)

  useEffect(() => {
    markReady?.()
  }, [markReady])

  return <main>Connected workspace</main>
}

let container: HTMLDivElement
let root: Root

describe('desktop UI readiness', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    vi.useRealTimers()
    await act(async () => root.unmount())
    container.remove()
    Reflect.deleteProperty(window, 'oneworksDesktop')
  })

  it('reports readiness only after the owning surface is visible', async () => {
    const markDesktopUiReady = vi.fn(async () => undefined)
    window.oneworksDesktop = { markDesktopUiReady }

    await act(async () => {
      root.render(<ReadinessProbe ready={false} />)
    })
    expect(markDesktopUiReady).not.toHaveBeenCalled()

    await act(async () => {
      root.render(<ReadinessProbe ready />)
    })
    expect(markDesktopUiReady).toHaveBeenCalledTimes(1)
  })

  it('keeps the provider bootstrap free of premature readiness and delegates to real surfaces', async () => {
    const [
      authenticatedApp,
      appShell,
      desktopWorkspaceStartupReady,
      launcherApp,
      launcherRoute,
      main,
      standaloneThemeProvider,
      workspaceApp,
      workspaceConnectionGate,
      workspaceOpeningOverlay
    ] = await Promise.all([
      readFile(path.join(clientRoot, 'src/AuthenticatedApp.tsx'), 'utf8'),
      readFile(path.join(clientRoot, 'src/components/layout/AppShell.tsx'), 'utf8'),
      readFile(path.join(clientRoot, 'src/components/layout/desktop-workspace-startup-ready.ts'), 'utf8'),
      readFile(path.join(clientRoot, 'src/LauncherApp.tsx'), 'utf8'),
      readFile(path.join(clientRoot, 'src/routes/LauncherRoute.tsx'), 'utf8'),
      readFile(path.join(clientRoot, 'src/main.tsx'), 'utf8'),
      readFile(path.join(clientRoot, 'src/routes/StandaloneRouteThemeProvider.tsx'), 'utf8'),
      readFile(path.join(clientRoot, 'src/WorkspaceApp.tsx'), 'utf8'),
      readFile(path.join(clientRoot, 'src/WorkspaceConnectionGate.tsx'), 'utf8'),
      readFile(
        path.join(clientRoot, 'src/components/workspace/WorkspaceOpeningOverlay.tsx'),
        'utf8'
      )
    ])

    expect(main).not.toContain('markDesktopUiReady')
    expect(authenticatedApp).not.toContain('if (!ready) return null')
    expect(launcherApp).not.toContain('if (!ready) return null')
    expect(authenticatedApp).toContain('<PluginProvider runtimeSource={pluginRuntimeSource}>')
    expect(launcherApp).toContain('<PluginProvider')
    expect(launcherRoute).toContain('useDesktopUiReady()')
    expect(workspaceConnectionGate).not.toContain('useDesktopUiReady')
    expect(workspaceConnectionGate).toContain('preloadWorkspaceSurface')
    expect(workspaceOpeningOverlay).toContain('revealWorkspaceStartupSurface')
    expect(workspaceOpeningOverlay).toContain('markDesktopUiReady')
    expect(workspaceApp).not.toContain('useDesktopUiReady')
    expect(workspaceConnectionGate).not.toContain('OPENING_OVERLAY_READY_FALLBACK_MS')
    expect(workspaceConnectionGate).not.toContain('OPENING_OVERLAY_MIN_VISIBLE_MS')
    expect(workspaceConnectionGate).not.toContain('OPENING_OVERLAY_EXIT_MS')
    expect(workspaceConnectionGate).toContain("overlayPhase !== 'hidden'")
    expect(workspaceConnectionGate).toContain('parentMarkWorkspaceStartupReady(workspaceStartupReadiness)')
    expect(workspaceConnectionGate).toContain(
      'terminalMarkWorkspaceStartupReady?.({ readiness: workspaceStartupReadiness })'
    )
    expect(workspaceConnectionGate).not.toContain('fallbackTimerId')
    expect(desktopWorkspaceStartupReady).not.toContain('STARTUP_MIN_VISIBLE_MS')
    expect(appShell).not.toContain('AppShellStartupReadySignal')
    expect(desktopWorkspaceStartupReady).not.toContain('visibleTimeout')
    expect(desktopWorkspaceStartupReady).not.toContain('setTimeout(finishAfterPaint')
    expect(standaloneThemeProvider).toContain('useDesktopUiReady(ready)')
    expect(standaloneThemeProvider).toContain('connectDesktopManagerRuntimeIfAvailable()')
    expect(standaloneThemeProvider).toContain('deferUntilRuntimeServerBaseUrl={waitsForDesktopManager}')
    expect(standaloneThemeProvider).toContain('runtimeServerBaseUrl={managerServerBaseUrl}')
  })

  it('uses the real sender editor as chat editable readiness', async () => {
    const [chatRouteShell, senderBody, senderComposer, senderEditor] = await Promise.all([
      readFile(path.join(clientRoot, 'src/routes/ChatRouteShell.tsx'), 'utf8'),
      readFile(
        path.join(
          clientRoot,
          'src/components/chat/sender/@components/sender-body/SenderBody.tsx'
        ),
        'utf8'
      ),
      readFile(
        path.join(
          clientRoot,
          'src/components/chat/sender/@components/sender-composer-input/SenderComposerInput.tsx'
        ),
        'utf8'
      ),
      readFile(
        path.join(
          clientRoot,
          'src/components/chat/sender/@components/sender-monaco-editor/SenderMonacoEditor.tsx'
        ),
        'utf8'
      )
    ])

    expect(chatRouteShell).toContain(
      'const CHAT_ROUTE_STARTUP_READY_SELECTOR = "[data-oneworks-sender-editor-ready=\'true\']"'
    )
    expect(chatRouteShell).toContain(
      'const CHAT_ROUTE_STARTUP_DEGRADED_SELECTOR = "[data-oneworks-sender-editor-unavailable=\'true\']"'
    )
    expect(senderBody).toContain('startupUnavailable={!isInlineEdit && modelUnavailable === true}')
    expect(senderComposer).toContain('startupUnavailable={startupUnavailable}')
    expect(senderEditor).toContain('const isStartupEditable = isEditorReady && !disabled')
    expect(senderEditor).toContain('const isStartupUnavailable = isEditorReady && startupUnavailable')
  })

  it('reports the first real startup outcome once while the degraded sender can later become editable', async () => {
    vi.useFakeTimers()
    const markWorkspaceStartupReady = vi.fn()
    window.oneworksDesktop = { markWorkspaceStartupReady }

    await act(async () => {
      root.render(
        <DesktopWorkspaceStartupProvider>
          <SenderReadinessProbe unavailable />
        </DesktopWorkspaceStartupProvider>
      )
    })
    await act(async () => vi.runAllTimersAsync())

    expect(markWorkspaceStartupReady).toHaveBeenCalledOnce()
    expect(markWorkspaceStartupReady).toHaveBeenCalledWith({ readiness: 'degraded' })

    await act(async () => {
      root.render(
        <DesktopWorkspaceStartupProvider>
          <SenderReadinessProbe unavailable={false} />
        </DesktopWorkspaceStartupProvider>
      )
    })
    await act(async () => vi.runAllTimersAsync())

    expect(container.querySelector('[data-oneworks-sender-editor-ready="true"]')).not.toBeNull()
    expect(container.querySelector('[data-oneworks-sender-editor-unavailable="true"]')).toBeNull()
    expect(markWorkspaceStartupReady).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('does not hold an already connected real workspace behind a cosmetic minimum delay', async () => {
    const markWorkspaceStartupReady = vi.fn()
    window.oneworksDesktop = { markWorkspaceStartupReady }

    await act(async () => {
      root.render(
        <DesktopWorkspaceStartupProvider>
          <StartupProviderReadyProbe />
        </DesktopWorkspaceStartupProvider>
      )
    })

    expect(markWorkspaceStartupReady).toHaveBeenCalledWith({ readiness: 'editable' })
  })

  it('delegates a real surface-ready request to the connection gate before terminal readiness', async () => {
    const markWorkspaceStartupReady = vi.fn()
    const requestConnectionGateExit = vi.fn()
    window.oneworksDesktop = { markWorkspaceStartupReady }

    await act(async () => {
      root.render(
        <DesktopWorkspaceStartupReadyContext.Provider value={requestConnectionGateExit}>
          <DesktopWorkspaceStartupProvider>
            <StartupProviderReadyProbe />
          </DesktopWorkspaceStartupProvider>
        </DesktopWorkspaceStartupReadyContext.Provider>
      )
    })

    expect(requestConnectionGateExit).toHaveBeenCalledWith('editable')
    expect(markWorkspaceStartupReady).not.toHaveBeenCalled()
  })

  it('does not report workspace interactive readiness when the real sender never mounts', async () => {
    vi.useFakeTimers()
    const markWorkspaceStartupReady = vi.fn()

    await act(async () => {
      root.render(
        <DesktopWorkspaceStartupReadyContext.Provider value={markWorkspaceStartupReady}>
          <WorkspaceReadinessProbe ready />
        </DesktopWorkspaceStartupReadyContext.Provider>
      )
    })
    await act(async () => vi.advanceTimersByTime(60_000))

    expect(markWorkspaceStartupReady).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
