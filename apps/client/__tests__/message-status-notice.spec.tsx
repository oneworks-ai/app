// @vitest-environment jsdom

import { App } from 'antd'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  openSessionProjectConfig,
  retrySessionProjectConfig
} from '#~/api/sessions'
import { MessageStatusNotice } from '#~/components/chat/messages/MessageStatusNotice'
import {
  createScopedProjectConfigRecoveryActions,
  type ProjectConfigRecoveryConfirmation,
  type ProjectConfigRecoveryPendingAction,
  type ProjectConfigRecoveryResult
} from '#~/components/chat/messages/project-config-recovery-actions'

const appMocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  error: vi.fn(),
  success: vi.fn()
}))

vi.mock('antd', () => ({
  App: Object.assign(
    ({ children }: { children: ReactNode }) => <div data-app-provider='true'>{children}</div>,
    {
      useApp: () => ({
        message: {
          error: appMocks.error,
          success: appMocks.success
        },
        modal: {
          confirm: appMocks.confirm
        }
      })
    }
  ),
  Button: ({
    children,
    loading: _loading,
    type: _type,
    ...props
  }: {
    children: ReactNode
    loading?: boolean
    type?: string
  }) => <button {...props}>{children}</button>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('#~/api/sessions', () => ({
  openSessionProjectConfig: vi.fn(),
  retrySessionProjectConfig: vi.fn()
}))

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

const recoveryNotice = (params: {
  failureEventId?: string
  failureEventSeq?: number
  sessionId?: string
  workspaceFolder?: string
} = {}) => ({
  detail: 'Open or retry.',
  icon: 'error',
  id: 'session-error',
  message: 'Invalid project config.',
  meta: `${params.workspaceFolder ?? '/workspace/root'}/.codex/config.toml:8:5`,
  projectConfigRecovery: {
    column: 5,
    configPath: '.codex/config.toml',
    failureEventId: params.failureEventId ?? 'evt-project-config',
    failureEventSeq: params.failureEventSeq ?? 8,
    line: 8,
    sessionId: params.sessionId ?? 'session-a',
    workspaceFolder: params.workspaceFolder ?? '/workspace/root'
  },
  tone: 'error',
  title: 'Task failed'
} as const)

const mountNotice = async (
  notice = recoveryNotice(),
  sessionId = notice.projectConfigRecovery.sessionId
) => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = async (nextNotice = notice, nextSessionId = sessionId) => {
    await act(async () => {
      root.render(
        <App>
          <MessageStatusNotice
            notice={nextNotice}
            sessionId={nextSessionId}
            onRetryConnection={() => undefined}
          />
        </App>
      )
    })
  }
  await render()
  return {
    container,
    render,
    root
  }
}

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.click()
  })
}

const unmount = async (root: Root) => {
  await act(async () => {
    root.unmount()
  })
}

const createActionHarness = () => {
  let currentScope = ['session-a', '/workspace-a', 'evt-1', '1'].join('\0')
  let pending: ProjectConfigRecoveryPendingAction | null = null
  let confirmation: ProjectConfigRecoveryConfirmation | undefined
  const effects = {
    error: vi.fn(),
    focus: vi.fn(),
    open: vi.fn<(sessionId: string) => Promise<unknown>>(async () => undefined),
    retry: vi.fn<(sessionId: string) => Promise<ProjectConfigRecoveryResult>>(
      async () => ({ queued: true })
    ),
    success: vi.fn()
  }
  const actions = createScopedProjectConfigRecoveryActions({
    confirm: next => {
      confirmation = next
    },
    focus: effects.focus,
    getCurrentScope: () => currentScope,
    getPending: () => pending,
    onError: effects.error,
    onSuccess: effects.success,
    open: effects.open,
    retry: effects.retry,
    scope: currentScope,
    sessionId: 'session-a',
    setPending: value => {
      pending = value
    }
  })
  return {
    actions,
    effects,
    get confirmation() {
      return confirmation
    },
    get pending() {
      return pending
    },
    switchScope: () => {
      currentScope = ['session-b', '/workspace-b', 'evt-2', '2'].join('\0')
      pending = null
    }
  }
}

describe('MessageStatusNotice project config recovery', () => {
  beforeEach(() => {
    appMocks.confirm.mockReset()
    appMocks.error.mockReset()
    appMocks.success.mockReset()
    vi.mocked(openSessionProjectConfig).mockReset()
    vi.mocked(retrySessionProjectConfig).mockReset()
    appMocks.confirm.mockReturnValue({ destroy: vi.fn() })
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('renders accessible recovery actions for the validated failing source', () => {
    const notice = recoveryNotice()
    const html = renderToStaticMarkup(
      <MessageStatusNotice
        notice={notice}
        sessionId='session-a'
        onRetryConnection={() => undefined}
      />
    )

    expect(html).toContain('role="status"')
    expect(html).toContain('aria-busy="false"')
    expect(html).toContain('/workspace/root/.codex/config.toml:8:5')
    expect(html).toContain('data-recovery-action="open"')
    expect(html).toContain('data-recovery-action="retry"')
    const mismatchedSessionHtml = renderToStaticMarkup(
      <MessageStatusNotice
        notice={notice}
        sessionId='session-b'
        onRetryConnection={() => undefined}
      />
    )
    expect(mismatchedSessionHtml).not.toContain('data-recovery-action=')
  })

  it('mounts the App boundary and suppresses rapid open clicks while exposing pending state', async () => {
    const deferred = createDeferred<Awaited<ReturnType<typeof openSessionProjectConfig>>>()
    vi.mocked(openSessionProjectConfig).mockReturnValue(deferred.promise)
    const mounted = await mountNotice()
    const card = mounted.container.querySelector<HTMLElement>('[role="status"]')!
    const open = mounted.container.querySelector<HTMLButtonElement>('[data-recovery-action="open"]')!
    const retry = mounted.container.querySelector<HTMLButtonElement>('[data-recovery-action="retry"]')!

    await click(open)
    await click(open)
    expect(openSessionProjectConfig).toHaveBeenCalledOnce()
    expect(openSessionProjectConfig).toHaveBeenCalledWith('session-a')
    expect(card.getAttribute('aria-busy')).toBe('true')
    expect(open.disabled).toBe(true)
    expect(retry.disabled).toBe(true)

    deferred.resolve({
      ok: true,
      opener: {
        available: true,
        id: 'vscode',
        source: 'path',
        title: 'Visual Studio Code'
      },
      path: '.codex/config.toml'
    })
    await act(async () => {
      await deferred.promise
    })
    expect(card.getAttribute('aria-busy')).toBe('false')
    expect(document.activeElement).toBe(open)
    expect(appMocks.success).not.toHaveBeenCalled()
    await unmount(mounted.root)
  })

  it('drives rendered retry confirmation, cancellation, focus, and repeated-click suppression', async () => {
    const mounted = await mountNotice()
    const retry = mounted.container.querySelector<HTMLButtonElement>('[data-recovery-action="retry"]')!
    const open = mounted.container.querySelector<HTMLButtonElement>('[data-recovery-action="open"]')!

    await click(retry)
    await click(retry)
    expect(appMocks.confirm).toHaveBeenCalledOnce()
    expect(open.disabled).toBe(true)
    expect(retry.disabled).toBe(true)
    const confirmation = appMocks.confirm.mock.calls[0]?.[0] as { onCancel: () => void }
    await act(async () => confirmation.onCancel())

    expect(retry.disabled).toBe(false)
    expect(document.activeElement).toBe(retry)
    expect(retrySessionProjectConfig).not.toHaveBeenCalled()
    await unmount(mounted.root)
  })

  it('surfaces a mounted opener failure without reporting recovery as queued', async () => {
    vi.mocked(openSessionProjectConfig).mockRejectedValue(
      Object.assign(new Error('Config file no longer exists.'), { code: 'ENOENT' })
    )
    const mounted = await mountNotice()
    const card = mounted.container.querySelector<HTMLElement>('[role="status"]')!
    const open = mounted.container.querySelector<HTMLButtonElement>('[data-recovery-action="open"]')!

    await click(open)
    await act(async () => Promise.resolve())

    expect(appMocks.error).toHaveBeenCalledWith('Config file no longer exists.')
    expect(appMocks.success).not.toHaveBeenCalled()
    expect(card.getAttribute('aria-busy')).toBe('false')
    expect(document.activeElement).toBe(open)
    await unmount(mounted.root)
  })

  it.each([
    {
      response: { ok: true as const, queued: true as const },
      successKey: 'chat.projectConfigRecovery.queued'
    },
    {
      response: { ok: true as const, reason: 'already_queued' as const },
      successKey: 'chat.projectConfigRecovery.alreadyQueued'
    }
  ])('reports the rendered retry outcome only after API success: $successKey', async ({
    response,
    successKey
  }) => {
    vi.mocked(retrySessionProjectConfig).mockResolvedValue(response)
    const mounted = await mountNotice()
    const retry = mounted.container.querySelector<HTMLButtonElement>('[data-recovery-action="retry"]')!
    await click(retry)
    const confirmation = appMocks.confirm.mock.calls[0]?.[0] as { onOk: () => Promise<void> }
    await act(async () => {
      await confirmation.onOk()
    })

    expect(retrySessionProjectConfig).toHaveBeenCalledOnce()
    expect(appMocks.success).toHaveBeenCalledWith(successKey)
    expect(appMocks.error).not.toHaveBeenCalled()
    await unmount(mounted.root)
  })

  it('keeps the mounted retry idempotent across rapid modal confirmation clicks', async () => {
    const deferred = createDeferred<{ ok: true; queued: true }>()
    vi.mocked(retrySessionProjectConfig).mockReturnValue(deferred.promise)
    const mounted = await mountNotice()
    const retry = mounted.container.querySelector<HTMLButtonElement>('[data-recovery-action="retry"]')!
    await click(retry)
    const confirmation = appMocks.confirm.mock.calls[0]?.[0] as { onOk: () => Promise<void> }

    const first = confirmation.onOk()
    const repeated = confirmation.onOk()
    deferred.resolve({ ok: true, queued: true })
    await act(async () => {
      await Promise.all([first, repeated])
    })

    expect(retrySessionProjectConfig).toHaveBeenCalledOnce()
    expect(appMocks.success).toHaveBeenCalledOnce()
    await unmount(mounted.root)
  })

  it('surfaces current API failure and ignores stale completion after a scope rerender', async () => {
    const retryFailure = new Error('runtime store unavailable')
    vi.mocked(retrySessionProjectConfig).mockRejectedValueOnce(retryFailure)
    const mounted = await mountNotice()
    const retry = mounted.container.querySelector<HTMLButtonElement>('[data-recovery-action="retry"]')!
    await click(retry)
    const confirmation = appMocks.confirm.mock.calls[0]?.[0] as { onOk: () => Promise<void> }
    await act(async () => {
      await expect(confirmation.onOk()).resolves.toBeUndefined()
    })
    expect(appMocks.error).toHaveBeenCalledWith('runtime store unavailable')
    expect(appMocks.success).not.toHaveBeenCalled()

    appMocks.error.mockClear()
    const deferred = createDeferred<Awaited<ReturnType<typeof openSessionProjectConfig>>>()
    vi.mocked(openSessionProjectConfig).mockReturnValueOnce(deferred.promise)
    const open = mounted.container.querySelector<HTMLButtonElement>('[data-recovery-action="open"]')!
    await click(open)
    await mounted.render(recoveryNotice({
      failureEventId: 'evt-next',
      failureEventSeq: 9,
      sessionId: 'session-b',
      workspaceFolder: '/workspace/next'
    }), 'session-b')
    deferred.reject(new Error('old opener failed'))
    await act(async () => {
      await deferred.promise.catch(() => undefined)
    })

    const nextCard = mounted.container.querySelector<HTMLElement>('[role="status"]')!
    expect(nextCard.getAttribute('aria-busy')).toBe('false')
    expect(appMocks.error).not.toHaveBeenCalled()
    expect(appMocks.success).not.toHaveBeenCalled()
    await unmount(mounted.root)
  })

  it('suppresses rapid open clicks and ignores stale completion after a session switch', async () => {
    const harness = createActionHarness()
    const deferred = createDeferred<void>()
    harness.effects.open.mockReturnValue(deferred.promise)

    const first = harness.actions.open()
    const repeated = harness.actions.open()
    expect(harness.effects.open).toHaveBeenCalledOnce()
    expect(harness.effects.open).toHaveBeenCalledWith('session-a')
    expect(harness.pending).toBe('open')

    harness.switchScope()
    deferred.resolve()
    await Promise.all([first, repeated])

    expect(harness.effects.error).not.toHaveBeenCalled()
    expect(harness.effects.focus).not.toHaveBeenCalled()
    expect(harness.pending).toBeNull()
  })

  it('surfaces a current opener or missing-file failure without reporting recovery as queued', async () => {
    const harness = createActionHarness()
    const failure = Object.assign(new Error('Config file no longer exists.'), { code: 'ENOENT' })
    harness.effects.open.mockRejectedValue(failure)

    await harness.actions.open()

    expect(harness.effects.error).toHaveBeenCalledWith('open', failure)
    expect(harness.effects.success).not.toHaveBeenCalled()
    expect(harness.effects.focus).toHaveBeenCalledWith('open')
    expect(harness.pending).toBeNull()
  })

  it('supports confirm cancellation, suppresses repeated confirms, and restores focus', () => {
    const harness = createActionHarness()

    harness.actions.requestRetry()
    harness.actions.requestRetry()
    expect(harness.confirmation).toBeDefined()
    expect(harness.pending).toBe('confirm')
    harness.confirmation?.onCancel()

    expect(harness.pending).toBeNull()
    expect(harness.effects.focus).toHaveBeenCalledWith('retry')
    expect(harness.effects.retry).not.toHaveBeenCalled()
  })

  it.each([
    { result: { queued: true }, expected: { queued: true } },
    { result: { reason: 'already_queued' as const }, expected: { reason: 'already_queued' } }
  ])('reports only successful queued outcomes: $expected', async ({ result, expected }) => {
    const harness = createActionHarness()
    harness.effects.retry.mockResolvedValue(result)
    harness.actions.requestRetry()

    await harness.confirmation?.onOk()

    expect(harness.effects.retry).toHaveBeenCalledOnce()
    expect(harness.effects.success).toHaveBeenCalledWith(expected)
    expect(harness.effects.error).not.toHaveBeenCalled()
    expect(harness.pending).toBeNull()
  })

  it('keeps retry idempotent during rapid confirmation and surfaces current API failure', async () => {
    const harness = createActionHarness()
    const failure = new Error('runtime store unavailable')
    const deferred = createDeferred<{ queued: true }>()
    harness.effects.retry.mockReturnValue(deferred.promise)
    harness.actions.requestRetry()

    const first = harness.confirmation!.onOk()
    const repeated = harness.confirmation!.onOk()
    deferred.reject(failure)

    await expect(first).resolves.toBeUndefined()
    await expect(repeated).resolves.toBeUndefined()
    expect(harness.effects.retry).toHaveBeenCalledOnce()
    expect(harness.effects.error).toHaveBeenCalledWith('retry', failure)
    expect(harness.effects.success).not.toHaveBeenCalled()
    expect(harness.pending).toBeNull()
  })

  it('ignores stale retry failure and never reports it as queued', async () => {
    const harness = createActionHarness()
    const deferred = createDeferred<{ queued: true }>()
    harness.effects.retry.mockReturnValue(deferred.promise)
    harness.actions.requestRetry()
    const retry = harness.confirmation!.onOk()

    harness.switchScope()
    deferred.reject(new Error('old session failed'))
    await expect(retry).resolves.toBeUndefined()

    expect(harness.effects.error).not.toHaveBeenCalled()
    expect(harness.effects.success).not.toHaveBeenCalled()
    expect(harness.effects.focus).not.toHaveBeenCalled()
  })
})
