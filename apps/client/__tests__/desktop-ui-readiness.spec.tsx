// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDesktopUiReady } from '#~/desktop/use-desktop-ui-ready'

const clientRoot = path.resolve(__dirname, '..')

function ReadinessProbe({ ready }: { ready: boolean }) {
  useDesktopUiReady(ready)
  return <main>Visible product state</main>
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
      launcherRoute,
      main,
      standaloneThemeProvider,
      workspaceApp,
      workspaceConnectionGate
    ] = await Promise.all([
      readFile(path.join(clientRoot, 'src/routes/LauncherRoute.tsx'), 'utf8'),
      readFile(path.join(clientRoot, 'src/main.tsx'), 'utf8'),
      readFile(path.join(clientRoot, 'src/routes/StandaloneRouteThemeProvider.tsx'), 'utf8'),
      readFile(path.join(clientRoot, 'src/WorkspaceApp.tsx'), 'utf8'),
      readFile(path.join(clientRoot, 'src/WorkspaceConnectionGate.tsx'), 'utf8')
    ])

    expect(main).not.toContain('markDesktopUiReady')
    expect(launcherRoute).toContain('useDesktopUiReady()')
    expect(workspaceConnectionGate).toContain('useDesktopUiReady()')
    expect(workspaceApp).toContain('useDesktopUiReady()')
    expect(standaloneThemeProvider).toContain('useDesktopUiReady(ready)')
    expect(standaloneThemeProvider).toContain('connectDesktopManagerRuntimeIfAvailable()')
    expect(standaloneThemeProvider).toContain('deferUntilRuntimeServerBaseUrl={waitsForDesktopManager}')
    expect(standaloneThemeProvider).toContain('runtimeServerBaseUrl={managerServerBaseUrl}')
  })
})
