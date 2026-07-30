import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PermissionModeRequestHandler } from '#~/hooks/chat/use-chat-permission-mode'

import { ConversationStarterPermissionHarness } from './conversation-starter-permission-test-harness'
import { MemoryStorage, findReactHostElement, installReactMountedTestHost } from './react-mounted-test-host'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  destroyModal: vi.fn(),
  error: vi.fn(),
  updateSession: vi.fn(),
  warning: vi.fn()
}))

vi.mock('#~/api', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  updateSession: mocks.updateSession
}))

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        error: mocks.error,
        warning: mocks.warning
      },
      modal: { confirm: mocks.confirm }
    })
  },
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Checkbox: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input type='checkbox' {...props} />
  ),
  Dropdown: ({ children }: React.PropsWithChildren<Record<string, unknown>>) => <>{children}</>,
  Tag: ({ children }: React.PropsWithChildren<Record<string, unknown>>) => <span>{children}</span>,
  Tooltip: ({ children }: React.PropsWithChildren<Record<string, unknown>>) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('#~/components/list-search-input', () => ({
  ListSearchInput: () => <input data-testid='starter-search' />
}))

const latestModal = () => {
  return mocks.confirm.mock.calls.at(-1)?.[0] as {
    afterClose?: () => void
    onOk?: () => void | Promise<void>
  } | undefined
}

const mountReact = async (
  element: React.ReactElement,
  storage = new MemoryStorage()
) => {
  const host = installReactMountedTestHost()
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: storage
  })
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  const root = createRoot(host.container as unknown as Element)
  await act(async () => root.render(element))
  return {
    act,
    container: host.container,
    document: host.document,
    storage,
    render: async (next: React.ReactElement) => {
      await act(async () => root.render(next))
    },
    renderConcurrent: async (next: React.ReactElement) => {
      await act(async () => {
        React.startTransition(() => root.render(next))
        await Promise.resolve()
      })
    },
    unmount: async () => {
      await act(async () => root.unmount())
    }
  }
}

const findStarter = (container: Parameters<typeof findReactHostElement>[0]) => {
  return findReactHostElement(
    container,
    element =>
      element.getAttribute('class')?.split(/\s+/).includes('interaction-list__item') === true &&
      element.textContent.includes('High risk starter')
  )
}

const findState = (container: Parameters<typeof findReactHostElement>[0]) => {
  return findReactHostElement(
    container,
    element => element.getAttribute('data-testid') === 'starter-transaction-state'
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.confirm.mockImplementation(() => ({ destroy: mocks.destroyModal }))
  mocks.updateSession.mockResolvedValue(undefined)
})

describe('conversation starter permission transaction', () => {
  it('applies the real starter list bundle only after confirmation success', async () => {
    const mounted = await mountReact(<ConversationStarterPermissionHarness />)
    const starter = findStarter(mounted.container)
    starter?.focus()
    await mounted.act(async () => starter?.click())
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(findState(mounted.container)?.getAttribute('data-applied')).toBe('')
    expect(findState(mounted.container)?.getAttribute('aria-busy')).toBe('true')
    expect(mounted.storage.getItem('oneworks_new_session_guide_recent')).toBe('[]')

    await mounted.act(async () => starter?.click())
    expect(mocks.confirm).toHaveBeenCalledOnce()
    await mounted.act(async () => latestModal()?.afterClose?.())
    expect(findState(mounted.container)?.getAttribute('data-applied')).toBe('')
    expect(findState(mounted.container)?.getAttribute('aria-busy')).toBe('false')
    expect(mounted.document.activeElement).toBe(starter)
    expect(mounted.storage.getItem('oneworks_new_session_guide_recent')).toBe('[]')

    await mounted.act(async () => findStarter(mounted.container)?.click())
    expect(mocks.confirm).toHaveBeenCalledTimes(2)
    await mounted.act(async () => latestModal()?.onOk?.())
    await mounted.act(async () => latestModal()?.afterClose?.())
    expect(findState(mounted.container)?.getAttribute('data-applied')).toContain('starter-model')
    expect(findState(mounted.container)?.getAttribute('data-mode')).toBe('bypassPermissions')
    expect(JSON.parse(
      mounted.storage.getItem('oneworks_new_session_guide_recent') ?? '[]'
    )).toHaveLength(1)
    await mounted.unmount()

    const reloaded = await mountReact(
      <ConversationStarterPermissionHarness />,
      mounted.storage
    )
    expect(findStarter(reloaded.container)?.textContent)
      .toContain('chat.newSessionGuide.recentTitle')
    await reloaded.unmount()
  })

  it('invalidates a starter confirmation on session switch and unmount', async () => {
    const mounted = await mountReact(<ConversationStarterPermissionHarness />)
    await mounted.act(async () => findStarter(mounted.container)?.click())
    const staleModal = latestModal()
    await mounted.render(<ConversationStarterPermissionHarness sessionId='existing-session' />)
    expect(mocks.destroyModal).toHaveBeenCalledOnce()
    await mounted.act(async () => staleModal?.onOk?.())
    expect(mocks.updateSession).not.toHaveBeenCalled()
    expect(findState(mounted.container)?.getAttribute('data-applied')).toBe('')
    await mounted.unmount()

    const unmounted = await mountReact(<ConversationStarterPermissionHarness />)
    await unmounted.act(async () => findStarter(unmounted.container)?.click())
    const unmountedModal = latestModal()
    await unmounted.unmount()
    expect(mocks.destroyModal).toHaveBeenCalledTimes(2)
    await unmountedModal?.onOk?.()
    expect(mocks.updateSession).not.toHaveBeenCalled()
  })

  it('rejects failure, rapid double selection, and stale success atomically', async () => {
    let settleSelection: ((selected: boolean) => void) | undefined
    const permissionHandler = vi.fn<PermissionModeRequestHandler>(() => {
      const completion = new Promise<boolean>((resolve) => {
        settleSelection = resolve
      })
      return {
        accepted: true,
        completion,
        result: 'transition-pending'
      }
    })
    const mounted = await mountReact(
      <ConversationStarterPermissionHarness onPermissionModeChange={permissionHandler} />
    )
    await mounted.act(async () => findStarter(mounted.container)?.click())
    await mounted.act(async () => findStarter(mounted.container)?.click())
    expect(permissionHandler).toHaveBeenCalledOnce()
    await mounted.act(async () => settleSelection?.(false))
    expect(findState(mounted.container)?.getAttribute('data-applied')).toBe('')
    expect(mounted.storage.getItem('oneworks_new_session_guide_recent')).toBe('[]')

    await mounted.act(async () => findStarter(mounted.container)?.click())
    await mounted.render(
      <ConversationStarterPermissionHarness
        onPermissionModeChange={permissionHandler}
        sessionId='navigated-session'
      />
    )
    await mounted.act(async () => settleSelection?.(true))
    expect(findState(mounted.container)?.getAttribute('data-applied')).toBe('')
    expect(mounted.storage.getItem('oneworks_new_session_guide_recent')).toBe('[]')
    await mounted.unmount()
  })

  it('commits the original starter after a different scope render is abandoned', async () => {
    let settleSelection: ((selected: boolean) => void) | undefined
    const permissionHandler = vi.fn<PermissionModeRequestHandler>(() => {
      const completion = new Promise<boolean>((resolve) => {
        settleSelection = resolve
      })
      return {
        accepted: true,
        completion,
        result: 'transition-pending'
      }
    })
    const renderHarness = (
      sessionId?: string,
      suspendAfterStarterHook?: Promise<never>
    ) => (
      <React.Suspense fallback={<span data-testid='starter-suspended' />}>
        <ConversationStarterPermissionHarness
          onPermissionModeChange={permissionHandler}
          sessionId={sessionId}
          suspendAfterStarterHook={suspendAfterStarterHook}
        />
      </React.Suspense>
    )
    const mounted = await mountReact(renderHarness())
    await mounted.act(async () => findStarter(mounted.container)?.click())
    await mounted.renderConcurrent(renderHarness(
      'abandoned-session',
      new Promise<never>(() => undefined)
    ))
    await mounted.act(async () => settleSelection?.(true))

    expect(findState(mounted.container)?.getAttribute('data-applied'))
      .toContain('starter-model')
    expect(JSON.parse(
      mounted.storage.getItem('oneworks_new_session_guide_recent') ?? '[]'
    )).toHaveLength(1)
    await mounted.unmount()
  })

  it('keeps the visible bundle and Recent unchanged when bundle validation throws', async () => {
    const mounted = await mountReact(
      <ConversationStarterPermissionHarness throwOnApply />
    )
    await mounted.act(async () => findStarter(mounted.container)?.click())
    await mounted.act(async () => latestModal()?.onOk?.())
    await mounted.act(async () => latestModal()?.afterClose?.())

    expect(findState(mounted.container)?.getAttribute('data-applied')).toBe('')
    expect(findState(mounted.container)?.getAttribute('data-error'))
      .toBe('invalid starter account')
    expect(mounted.storage.getItem('oneworks_new_session_guide_recent')).toBe('[]')
    expect(findState(mounted.container)?.getAttribute('aria-busy')).toBe('false')
    await mounted.unmount()
  })

  it('merges every edit into the active starter snapshot and payloads', async () => {
    const mounted = await mountReact(<ConversationStarterPermissionHarness />)
    await mounted.act(async () =>
      findReactHostElement(
        mounted.container,
        element => element.getAttribute('data-testid') === 'edit-starter-model'
      )?.click()
    )
    expect(findState(mounted.container)?.getAttribute('data-applied')).toBe('')

    await mounted.act(async () => findStarter(mounted.container)?.click())
    await mounted.act(async () => latestModal()?.onOk?.())
    await mounted.act(async () => latestModal()?.afterClose?.())
    for (
      const testId of [
        'edit-starter-adapter',
        'edit-starter-account',
        'edit-starter-effort',
        'edit-starter-model',
        'edit-starter-permission',
        'edit-starter-target',
        'edit-starter-workspace',
        'edit-starter-content'
      ]
    ) {
      await mounted.act(async () =>
        findReactHostElement(
          mounted.container,
          element => element.getAttribute('data-testid') === testId
        )?.click()
      )
    }

    const applied = findState(mounted.container)?.getAttribute('data-applied') ?? ''
    const snapshot = JSON.parse(applied) as Record<string, unknown>
    expect(snapshot).toMatchObject({
      account: 'edited-account',
      adapter: 'edited-adapter',
      effortSelection: { effort: 'low', source: 'user' },
      model: 'edited-model',
      permissionMode: 'dontAsk',
      workspaceDraftDirty: true
    })
    expect(applied).toContain('edited-target')
    expect(applied).toContain('edited-content')
    expect(applied).toContain('starter-environment')
    const createPayload = findReactHostElement(
      mounted.container,
      element => element.getAttribute('data-testid') === 'starter-create-payload'
    )?.getAttribute('data-payload')
    const queuedPayload = findReactHostElement(
      mounted.container,
      element => element.getAttribute('data-testid') === 'starter-queued-payload'
    )?.getAttribute('data-payload')
    expect(createPayload).toBe(applied)
    expect(queuedPayload).toBe(applied)
    await mounted.unmount()
  })
})
