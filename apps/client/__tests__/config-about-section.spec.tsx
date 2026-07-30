// @vitest-environment happy-dom
import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppBuildInfo } from '@oneworks/types'

import type { AuthStatus } from '#~/api/auth'
import { getConfig } from '#~/api/config'
import {
  AboutSection,
  getAboutBuildMismatch
} from '#~/components/config/ConfigAboutSection'
import { LauncherAboutView } from '#~/components/launcher/LauncherAboutView'

const testState = vi.hoisted(() => ({
  clientBuild: {
    version: '1.2.3',
    commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    buildTime: '2026-07-30T00:00:00.000Z',
    buildTimeSource: 'build'
  } as AppBuildInfo,
  messageError: vi.fn(),
  messageSuccess: vi.fn()
}))

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        error: testState.messageError,
        success: testState.messageSuccess
      }
    })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('#~/client-build-info', () => ({
  getClientBuildInfo: () => testState.clientBuild
}))

interface Deferred<T> {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T) => void
}

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

const connectedServerBuild = (
  overrides: Partial<AppBuildInfo> = {}
): AppBuildInfo => ({
  version: '1.2.3',
  commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  buildTime: '2026-07-30T01:00:00.000Z',
  buildTimeSource: 'build',
  ...overrides
})

describe('About build fingerprints', () => {
  let container: HTMLDivElement
  let root: Root

  const render = async (element: ReactElement) => {
    await act(async () => {
      root.render(element)
    })
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    testState.messageError.mockReset()
    testState.messageSuccess.mockReset()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    })
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders and copies a build received through the real Config API JSON envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { meta: { about: { build: connectedServerBuild() } } }
    }), { status: 200 })))
    const config = await getConfig()
    await render(<AboutSection serverStatus='connected' value={config.meta?.about} />)

    const copyButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="config.about.copyDiagnostics"]'
    )
    await act(async () => {
      copyButton?.click()
    })
    const diagnosticText = vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0]
    expect(diagnosticText).toContain('Server commit: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
  })

  it('shows different Client and Server builds and copies a safe diagnostic fingerprint', async () => {
    await render(
      <AboutSection
        serverStatus='connected'
        value={{ build: connectedServerBuild() }}
      />
    )

    expect(container.textContent).toContain('config.about.connection.connected')
    expect(container.textContent).toContain('config.about.mismatch.commit')

    const copyButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="config.about.copyDiagnostics"]'
    )
    await act(async () => {
      copyButton?.click()
    })

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    const diagnosticText = vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0]
    expect(diagnosticText).toContain('Client commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(diagnosticText).toContain('Server commit: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    expect(diagnosticText).toContain('Build mismatch: commit')
    expect(testState.messageSuccess).toHaveBeenCalledWith('config.about.copySuccess')
  })

  it('sanitizes unsafe Server metadata before copying diagnostics', async () => {
    const unsafeBuild = {
      version: '/Users/example/private/package.json',
      commit: 'Bearer super-secret-token',
      buildTime: 'token=super-secret',
      buildTimeSource: 'build'
    } as AppBuildInfo
    await render(
      <AboutSection
        serverStatus='connected'
        value={{ build: unsafeBuild }}
      />
    )

    const copyButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="config.about.copyDiagnostics"]'
    )
    await act(async () => {
      copyButton?.click()
    })

    const diagnosticText = vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0]
    expect(diagnosticText).toContain('Server version: 0.0.0')
    expect(diagnosticText).toContain('Server commit: unavailable')
    expect(diagnosticText).not.toContain('/Users/')
    expect(diagnosticText).not.toContain('super-secret')
  })

  it('provides accessible failure feedback when clipboard access fails', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'))
    await render(
      <AboutSection
        serverStatus='connected'
        value={{ build: connectedServerBuild({ commit: testState.clientBuild.commit }) }}
      />
    )

    const copyButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="config.about.copyDiagnostics"]'
    )
    await act(async () => {
      copyButton?.click()
    })

    expect(testState.messageError).toHaveBeenCalledWith('config.about.copyFailed')
  })

  it('distinguishes incompatible versions from different commits', () => {
    expect(getAboutBuildMismatch(
      testState.clientBuild,
      connectedServerBuild({ version: '2.0.0' }),
      'connected'
    )).toBe('version')
    expect(getAboutBuildMismatch(
      testState.clientBuild,
      connectedServerBuild(),
      'connected'
    )).toBe('commit')
  })

  it('shows unavailable, error, retry, and connected Launcher states', async () => {
    const unavailable = createDeferred<AuthStatus>()
    const connected = createDeferred<AuthStatus>()
    const loadServerInfo = vi.fn()
      .mockReturnValueOnce(unavailable.promise)
      .mockImplementationOnce(() => Promise.reject(new Error('offline')))
      .mockReturnValueOnce(connected.promise)

    await render(<LauncherAboutView loadServerInfo={loadServerInfo} />)
    expect(container.textContent).toContain('config.about.connection.loadingDescription')

    await act(async () => {
      unavailable.resolve({
        enabled: false,
        authenticated: true,
        usernames: [],
        passwordSource: 'generated'
      })
      await unavailable.promise
    })
    expect(container.textContent).toContain('config.about.connection.unavailableDescription')

    const retryButton = Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes('config.about.retry')
    )
    await act(async () => {
      retryButton?.click()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('config.about.connection.errorDescription')

    const secondRetryButton = Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes('config.about.retry')
    )
    await act(async () => {
      secondRetryButton?.click()
      connected.resolve({
        build: connectedServerBuild({ commit: testState.clientBuild.commit }),
        version: '1.2.3',
        enabled: false,
        authenticated: true,
        usernames: [],
        passwordSource: 'generated'
      })
      await connected.promise
    })
    expect(container.textContent).toContain('config.about.connection.connected')
  })

  it('ignores a stale Launcher response after the loader changes', async () => {
    const stale = createDeferred<AuthStatus>()
    const current = createDeferred<AuthStatus>()

    await render(<LauncherAboutView loadServerInfo={() => stale.promise} />)
    await render(<LauncherAboutView loadServerInfo={() => current.promise} />)

    await act(async () => {
      current.resolve({
        build: connectedServerBuild({
          version: '2.0.0',
          commit: 'cccccccccccccccccccccccccccccccccccccccc'
        }),
        version: '2.0.0',
        enabled: false,
        authenticated: true,
        usernames: [],
        passwordSource: 'generated'
      })
      await current.promise
    })

    await act(async () => {
      stale.resolve({
        build: connectedServerBuild({
          version: '9.9.9',
          commit: 'dddddddddddddddddddddddddddddddddddddddd'
        }),
        version: '9.9.9',
        enabled: false,
        authenticated: true,
        usernames: [],
        passwordSource: 'generated'
      })
      await stale.promise
    })

    expect(container.textContent).toContain('2.0.0')
    expect(container.textContent).not.toContain('9.9.9')
  })
})
