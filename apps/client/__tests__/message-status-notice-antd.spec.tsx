// @vitest-environment jsdom

import { App, ConfigProvider } from 'antd'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageStatusNotice } from '#~/components/chat/messages/MessageStatusNotice'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const fetchMock = vi.fn<typeof fetch>()
const jsonResponse = (body: unknown, status = 200) => Promise.resolve(new Response(
  JSON.stringify(body),
  { status, headers: { 'Content-Type': 'application/json' } }
))

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

const recoveryNotice = (sessionId = 'session-a', failureEventId = 'failure-a') => ({
  detail: 'Open or retry.',
  icon: 'error',
  id: `notice-${failureEventId}`,
  message: 'Invalid project config.',
  meta: '/workspace/root/.codex/config.toml:8:5',
  projectConfigRecovery: {
    column: 5,
    configPath: '.codex/config.toml',
    failureEventId,
    failureEventSeq: failureEventId === 'failure-a' ? 8 : 9,
    line: 8,
    sessionId,
    workspaceFolder: sessionId === 'session-a' ? '/workspace/root' : '/workspace/next'
  },
  tone: 'error',
  title: 'Task failed'
} as const)

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
  })
}

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.click()
  })
}

const mountNotice = async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = async (
    notice = recoveryNotice(),
    sessionId = notice.projectConfigRecovery.sessionId
  ) => {
    await act(async () => {
      root.render(
        <ConfigProvider theme={{ token: { motion: false } }}>
          <App message={{ duration: 0 }}>
            <MessageStatusNotice
              notice={notice}
              sessionId={sessionId}
              onRetryConnection={() => undefined}
            />
          </App>
        </ConfigProvider>
      )
    })
  }
  await render()
  return { container, render, root }
}

const findButton = (label: string, root: ParentNode = document) => (
  [...root.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.textContent?.includes(label))
)

const unmount = async (root: Root) => {
  await act(async () => root.unmount())
}

describe('MessageStatusNotice with the real Ant App/Modal/Button boundary', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: false,
        media: '',
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn()
      }))
    })
    vi.stubGlobal('ResizeObserver', class {
      disconnect() {}
      observe() {}
      unobserve() {}
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  it('owns confirm/cancel/rejection, pending state, rapid clicks, focus and stale-modal cleanup', async () => {
    const mounted = await mountNotice()
    const retry = findButton('chat.projectConfigRecovery.retryGlobal', mounted.container)!
    const open = findButton('chat.projectConfigRecovery.openConfig', mounted.container)!
    const status = mounted.container.querySelector<HTMLElement>('[role="status"]')!

    await click(retry)
    await click(retry)
    expect(document.querySelectorAll('.ant-modal-confirm')).toHaveLength(1)
    expect(retry.disabled).toBe(true)
    expect(open.disabled).toBe(true)
    expect(status.getAttribute('aria-busy')).toBe('true')

    await click(findButton('common.cancel')!)
    await flush()
    expect(document.querySelector('.ant-modal-confirm')).toBeNull()
    expect(retry.disabled).toBe(false)
    expect(document.activeElement).toBe(retry)
    expect(fetchMock).not.toHaveBeenCalled()

    const failedRetry = createDeferred<Response>()
    fetchMock.mockReturnValueOnce(failedRetry.promise)
    await click(retry)
    const failedModal = document.querySelector<HTMLElement>('.ant-modal-confirm')!
    await click(findButton('chat.projectConfigRecovery.retryGlobal', failedModal)!)
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(fetchMock).toHaveBeenCalledOnce()
    await act(async () => {
      failedRetry.reject(new Error('retry failed'))
      await failedRetry.promise.catch(() => undefined)
    })
    await flush()
    expect(document.querySelector('.ant-modal-confirm')).toBeNull()
    expect(document.body.textContent).toContain('retry failed')
    expect(status.getAttribute('aria-busy')).toBe('false')
    expect(document.activeElement).toBe(retry)

    await click(retry)
    expect(document.querySelector('.ant-modal-confirm')).not.toBeNull()
    await mounted.render(recoveryNotice('session-b', 'failure-b'), 'session-b')
    await flush()
    expect(document.querySelector('.ant-modal-confirm')).toBeNull()
    expect(document.activeElement).not.toBe(retry)

    const nextRetry = findButton('chat.projectConfigRecovery.retryGlobal', mounted.container)!
    await click(nextRetry)
    expect(document.querySelector('.ant-modal-confirm')).not.toBeNull()
    await unmount(mounted.root)
    expect(document.querySelector('.ant-modal-confirm')).toBeNull()
  })

  it.each([
    [{ ok: true, queued: true }, 'chat.projectConfigRecovery.queued'],
    [{ ok: true, reason: 'already_queued' }, 'chat.projectConfigRecovery.alreadyQueued']
  ] as const)('renders the real Ant success lifecycle for %s', async (result, successKey) => {
    fetchMock.mockReturnValueOnce(jsonResponse(result))
    const mounted = await mountNotice()
    const retry = findButton('chat.projectConfigRecovery.retryGlobal', mounted.container)!
    const open = findButton('chat.projectConfigRecovery.openConfig', mounted.container)!
    const status = mounted.container.querySelector<HTMLElement>('[role="status"]')!

    await click(retry)
    const modal = document.querySelector<HTMLElement>('.ant-modal-confirm')!
    await click(findButton('chat.projectConfigRecovery.retryGlobal', modal)!)
    await click(findButton('chat.projectConfigRecovery.retryGlobal', modal)!)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(retry.disabled).toBe(true)
    expect(open.disabled).toBe(true)
    expect(status.getAttribute('aria-busy')).toBe('true')
    await flush()
    await flush()

    expect(document.querySelector('.ant-modal-confirm')).toBeNull()
    expect(document.body.textContent).toContain(successKey)
    expect(status.getAttribute('aria-busy')).toBe('false')
    expect(document.activeElement).toBe(retry)
    await unmount(mounted.root)
  })

  it('renders real open-file pending, success and failure lifecycles without duplicate calls', async () => {
    const firstOpen = createDeferred<Response>()
    fetchMock.mockReturnValueOnce(firstOpen.promise)
    const mounted = await mountNotice()
    const open = findButton('chat.projectConfigRecovery.openConfig', mounted.container)!
    const retry = findButton('chat.projectConfigRecovery.retryGlobal', mounted.container)!
    const status = mounted.container.querySelector<HTMLElement>('[role="status"]')!

    await click(open)
    await click(open)
    await click(retry)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(open.disabled).toBe(true)
    expect(retry.disabled).toBe(true)
    expect(status.getAttribute('aria-busy')).toBe('true')

    await act(async () => {
      firstOpen.resolve(await jsonResponse({
        ok: true,
        path: '/workspace/root/.codex/config.toml',
        opener: {
          available: true,
          id: 'vscode',
          source: 'path',
          title: 'Visual Studio Code'
        }
      }))
      await firstOpen.promise
    })
    await flush()
    expect(status.getAttribute('aria-busy')).toBe('false')
    expect(document.activeElement).toBe(open)

    fetchMock.mockReturnValueOnce(jsonResponse({ opened: true }))
    await click(open)
    await flush()
    await flush()
    expect(document.body.textContent).toContain(
      'Project config opener returned an invalid response.'
    )
    expect(status.getAttribute('aria-busy')).toBe('false')
    expect(document.activeElement).toBe(open)

    await mounted.render(recoveryNotice('session-b', 'failure-b'), 'session-b')
    const staleOpen = findButton('chat.projectConfigRecovery.openConfig', mounted.container)!
    const staleRequest = createDeferred<Response>()
    fetchMock.mockReturnValueOnce(staleRequest.promise)
    await click(staleOpen)
    await mounted.render(recoveryNotice('session-a', 'failure-a'), 'session-a')
    await act(async () => {
      staleRequest.reject(new Error('stale opener failure'))
      await staleRequest.promise.catch(() => undefined)
    })
    await flush()
    expect(document.body.textContent).not.toContain('stale opener failure')

    const pendingUnmount = createDeferred<Response>()
    fetchMock.mockReturnValueOnce(pendingUnmount.promise)
    await click(findButton('chat.projectConfigRecovery.openConfig', mounted.container)!)
    await unmount(mounted.root)
    pendingUnmount.reject(new Error('unmounted opener failure'))
    await pendingUnmount.promise.catch(() => undefined)
    await flush()
    expect(document.querySelector('.ant-modal-confirm')).toBeNull()
  })
})
