// @vitest-environment happy-dom
import { act, useContext, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceConnectionGate } from '#~/WorkspaceConnectionGate'
import { DesktopWorkspaceStartupReadyContext } from '#~/components/layout/desktop-workspace-startup-ready'

const { isWorkspaceConnectionResponseMock } = vi.hoisted(() => ({
  isWorkspaceConnectionResponseMock: vi.fn(() => false)
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('#~/api/base', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback
}))

vi.mock('#~/api/launcher', () => ({
  restartLauncherWorkspace: vi.fn()
}))

vi.mock('#~/components/workspace/WorkspaceOpeningOverlay', () => ({
  WorkspaceOpeningOverlay: () => <div className='workspace-opening-overlay'>Opening</div>
}))

vi.mock('#~/hooks/use-resolved-theme-mode', () => ({
  useResolvedThemeMode: () => ({ resolvedThemeMode: 'light' })
}))

vi.mock('#~/WorkspaceConnectionErrorView', () => ({
  WorkspaceConnectionErrorView: ({ onRetry }: { onRetry: () => void }) => (
    <main data-testid='workspace-connection-error'>
      Connection error
      <button type='button' onClick={onRetry}>Retry</button>
    </main>
  )
}))

vi.mock('#~/workspace-connection-restore', () => ({
  getRestorableWorkspaceConnection: vi.fn()
}))

vi.mock('#~/workspace-connection-state', () => ({
  applyWorkspaceConnection: vi.fn(),
  getWorkspaceServerRestartActivity: vi.fn(),
  getWorkspaceVersionConflictDetails: () => undefined,
  isWorkspaceConnectionResponse: isWorkspaceConnectionResponseMock,
  rememberWorkspaceConnection: vi.fn(),
  withWorkspaceRouteId: (connection: unknown) => connection
}))

vi.mock('#~/workspace-startup-preload', () => ({
  preloadWorkspaceSurface: () => Promise.resolve()
}))

let container: HTMLDivElement
let root: Root

function ConnectedWorkspaceProbe() {
  const requestStartupSurfaceReady = useContext(DesktopWorkspaceStartupReadyContext)

  useEffect(() => {
    requestStartupSurfaceReady?.()
  }, [requestStartupSurfaceReady])

  return <main data-testid='connected-workspace'>Connected workspace</main>
}

describe('workspace connection gate startup readiness', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    isWorkspaceConnectionResponseMock.mockReturnValue(false)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    Reflect.deleteProperty(window, 'oneworksDesktop')
  })

  it('reports a committed retryable error surface exactly once without pretending the sender connected', async () => {
    const markWorkspaceStartupReady = vi.fn()
    window.oneworksDesktop = {
      getWorkspaceConnection: vi.fn(async () => undefined)
    }

    await act(async () => {
      root.render(
        <DesktopWorkspaceStartupReadyContext.Provider value={markWorkspaceStartupReady}>
          <WorkspaceConnectionGate>
            <main data-testid='connected-workspace'>Connected workspace</main>
          </WorkspaceConnectionGate>
        </DesktopWorkspaceStartupReadyContext.Provider>
      )
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.querySelector('[data-testid="workspace-connection-error"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="connected-workspace"]')).toBeNull()
    expect(document.querySelector('.workspace-opening-overlay')).toBeNull()
    expect(markWorkspaceStartupReady).toHaveBeenCalledOnce()
    expect(markWorkspaceStartupReady).toHaveBeenCalledWith('degraded')
  })

  it('can retry into an editable surface without rewriting the first terminal startup outcome', async () => {
    isWorkspaceConnectionResponseMock.mockReturnValueOnce(false).mockReturnValue(true)
    const markWorkspaceStartupReady = vi.fn()
    window.oneworksDesktop = {
      getWorkspaceConnection: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ serverBaseUrl: 'http://127.0.0.1:3000' })
    }

    await act(async () => {
      root.render(
        <DesktopWorkspaceStartupReadyContext.Provider value={markWorkspaceStartupReady}>
          <WorkspaceConnectionGate>
            <ConnectedWorkspaceProbe />
          </WorkspaceConnectionGate>
        </DesktopWorkspaceStartupReadyContext.Provider>
      )
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(markWorkspaceStartupReady).toHaveBeenCalledOnce()
    expect(markWorkspaceStartupReady).toHaveBeenCalledWith('degraded')

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="workspace-connection-error"] button')
        ?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.querySelector('[data-testid="workspace-connection-error"]')).toBeNull()
    expect(document.querySelector('[data-testid="connected-workspace"]')).not.toBeNull()
    expect(document.querySelector('.workspace-opening-overlay')).toBeNull()
    expect(markWorkspaceStartupReady).toHaveBeenCalledOnce()
  })

  it('reports terminal readiness only after the React opening overlay is unmounted', async () => {
    isWorkspaceConnectionResponseMock.mockReturnValue(true)
    const markWorkspaceStartupReady = vi.fn(() => {
      expect(document.querySelector('.workspace-opening-overlay')).toBeNull()
    })
    window.oneworksDesktop = {
      getWorkspaceConnection: vi.fn(async () => ({ serverBaseUrl: 'http://127.0.0.1:3000' })),
      markWorkspaceStartupReady
    }

    await act(async () => {
      root.render(
        <WorkspaceConnectionGate>
          <ConnectedWorkspaceProbe />
        </WorkspaceConnectionGate>
      )
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.querySelector('[data-testid="workspace-connection-error"]')).toBeNull()
    expect(document.querySelector('[data-testid="connected-workspace"]')).not.toBeNull()
    expect(markWorkspaceStartupReady).toHaveBeenCalledOnce()
    expect(markWorkspaceStartupReady).toHaveBeenCalledWith({ readiness: 'editable' })
  })
})
