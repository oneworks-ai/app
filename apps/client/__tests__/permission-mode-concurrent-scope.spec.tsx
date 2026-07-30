import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDeferred, findReactHostElement, installReactMountedTestHost } from './react-mounted-test-host'
import { ActualSenderPermissionHarness } from './sender-permission-mode-test-harness'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  destroyModal: vi.fn(),
  error: vi.fn(),
  updateSession: vi.fn(),
  warning: vi.fn()
}))

vi.mock('#~/api', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  getConfig: vi.fn(),
  updateSession: mocks.updateSession
}))

vi.mock('swr', () => ({
  default: () => ({ data: undefined })
}))

vi.mock('@oneworks/components/route-layout', () => ({
  ShortcutTooltip: ({ children }: React.PropsWithChildren) => <>{children}</>
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
  Dropdown: ({
    children,
    popupRender
  }: React.PropsWithChildren<{ popupRender?: () => React.ReactNode }>) => (
    <>
      {children}
      {popupRender?.()}
    </>
  ),
  Tag: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('#~/hooks/use-responsive-layout', () => ({
  useResponsiveLayout: () => ({
    isCompactLayout: false,
    isTouchInteraction: false
  })
}))

vi.mock('#~/components/chat/sender/@components/mobile-select-drawer/SenderMobileSelectDrawer', () => ({
  SenderMobileSelectDrawer: ({ children }: React.PropsWithChildren) => <>{children}</>
}))

vi.mock('#~/components/chat/sender/@components/sender-composer-input/SenderComposerInput', () => ({
  SenderComposerInput: () => <textarea data-testid='actual-sender-editor' />
}))

vi.mock('#~/components/chat/sender/@hooks/use-sender-voice-input', () => ({
  useSenderVoiceInput: () => undefined
}))

vi.mock('#~/components/workspace/ContextFilePicker', () => ({
  ContextFilePicker: () => null
}))

vi.mock('#~/hooks/use-sender-header-query-state.js', () => ({
  useSenderHeaderQueryState: () => ({
    isHeaderCollapsed: false,
    setHeaderCollapsed: vi.fn()
  })
}))

const latestModal = () => {
  return mocks.confirm.mock.calls.at(-1)?.[0] as {
    afterClose?: () => void
    onOk?: () => void | Promise<void>
  } | undefined
}

const findByTestId = (
  root: Parameters<typeof findReactHostElement>[0],
  testId: string
) => {
  return findReactHostElement(
    root,
    element => element.getAttribute('data-testid') === testId
  )
}

const mountConcurrent = async (element: React.ReactElement) => {
  const host = installReactMountedTestHost()
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: {
      getItem: () => null,
      removeItem: vi.fn(),
      setItem: vi.fn()
    }
  })
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  const root = createRoot(host.container as unknown as Element)
  await act(async () => root.render(element))
  return {
    act,
    container: host.container,
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

const renderActualSender = ({
  authoritativeMode,
  onLayoutMode,
  sessionId,
  suspendAfterPermissionHook
}: {
  authoritativeMode: 'default' | 'bypassPermissions'
  onLayoutMode?: (mode: 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions', pending: boolean) => void
  sessionId: string
  suspendAfterPermissionHook?: Promise<never>
}) => (
  <React.Suspense fallback={<span data-testid='suspended-fallback' />}>
    <ActualSenderPermissionHarness
      authoritativeMode={authoritativeMode}
      draftIdentity='concurrent-workspace'
      onLayoutMode={onLayoutMode}
      sessionId={sessionId}
      suspendAfterPermissionHook={suspendAfterPermissionHook}
    />
  </React.Suspense>
)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.confirm.mockImplementation(() => ({ destroy: mocks.destroyModal }))
  mocks.updateSession.mockResolvedValue(undefined)
})

describe('permission scope commit ownership', () => {
  it('rotates live draft authorization when owner changes without remount', async () => {
    const renderDraft = (workspaceFolder: string) => (
      <ActualSenderPermissionHarness
        authoritativeMode='default'
        draftIdentity='same-live-draft'
        workspaceFolder={workspaceFolder}
      />
    )
    const findBypass = (root: Parameters<typeof findReactHostElement>[0]) =>
      findReactHostElement(
        root,
        element =>
          element.getAttribute('class')?.includes(
            'sender-permission-menu__item--bypassPermissions'
          ) === true
      )
    const mounted = await mountConcurrent(renderDraft('/workspace/a'))
    await mounted.act(async () => findBypass(mounted.container)?.click())
    await mounted.act(async () => latestModal()?.onOk?.())
    await mounted.act(async () => latestModal()?.afterClose?.())
    expect(mocks.confirm).toHaveBeenCalledOnce()

    await mounted.render(renderDraft('/workspace/b'))
    await mounted.act(async () => findBypass(mounted.container)?.click())
    expect(mocks.confirm).toHaveBeenCalledTimes(2)
    await mounted.act(async () => latestModal()?.afterClose?.())

    await mounted.render(renderDraft(''))
    await mounted.act(async () => findBypass(mounted.container)?.click())
    expect(mocks.confirm).toHaveBeenCalledTimes(3)
    await mounted.act(async () => latestModal()?.onOk?.())
    await mounted.act(async () => latestModal()?.afterClose?.())

    await mounted.render(renderDraft('/workspace/resolved'))
    await mounted.act(async () => findBypass(mounted.container)?.click())
    expect(mocks.confirm).toHaveBeenCalledTimes(4)
    await mounted.unmount()
  })

  it('commits a new session and a new draft with their own mode before layout consumers run', async () => {
    const layoutModes: string[] = []
    const mounted = await mountConcurrent(renderActualSender({
      authoritativeMode: 'bypassPermissions',
      onLayoutMode: (mode, pending) => layoutModes.push(`${mode}:${pending}`),
      sessionId: 'session-a'
    }))
    expect(layoutModes.at(-1)).toBe('bypassPermissions:false')

    await mounted.render(renderActualSender({
      authoritativeMode: 'default',
      onLayoutMode: (mode, pending) => layoutModes.push(`${mode}:${pending}`),
      sessionId: 'session-b'
    }))
    expect(layoutModes.at(-1)).toBe('default:false')
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('data-mode'))
      .toBe('default')

    await mounted.render(
      <ActualSenderPermissionHarness
        draftIdentity='concurrent-workspace:new-draft'
        onLayoutMode={(mode, pending) => layoutModes.push(`${mode}:${pending}`)}
      />
    )
    expect(layoutModes.at(-1)).toBe('default:false')
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('aria-busy'))
      .toBe('false')
    await mounted.unmount()
  })

  it('keeps the committed modal valid when a different scope render is abandoned', async () => {
    const mounted = await mountConcurrent(renderActualSender({
      authoritativeMode: 'default',
      sessionId: 'session-a'
    }))
    const bypass = findReactHostElement(
      mounted.container,
      element =>
        element.getAttribute('class')?.includes(
          'sender-permission-menu__item--bypassPermissions'
        ) === true
    )
    await mounted.act(async () => bypass?.click())
    const committedModal = latestModal()
    await mounted.renderConcurrent(renderActualSender({
      authoritativeMode: 'default',
      sessionId: 'session-abandoned',
      suspendAfterPermissionHook: new Promise<never>(() => undefined)
    }))

    expect(mocks.destroyModal).not.toHaveBeenCalled()
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('data-mode'))
      .toBe('default')
    await mounted.act(async () => committedModal?.onOk?.())
    await mounted.act(async () => committedModal?.afterClose?.())
    expect(mocks.updateSession).toHaveBeenCalledWith('session-a', {
      permissionMode: 'bypassPermissions'
    })
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('data-mode'))
      .toBe('bypassPermissions')
    await mounted.unmount()
  })

  it('rolls back the committed attempt after an abandoned scope render', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const recovery = createDeferred<void>()
    mocks.updateSession.mockReturnValueOnce(recovery.promise)
    const mounted = await mountConcurrent(renderActualSender({
      authoritativeMode: 'bypassPermissions',
      sessionId: 'session-a'
    }))
    const reset = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-reset') === true
    )
    await mounted.act(async () => reset?.click())
    await mounted.renderConcurrent(renderActualSender({
      authoritativeMode: 'default',
      sessionId: 'session-abandoned',
      suspendAfterPermissionHook: new Promise<never>(() => undefined)
    }))
    await mounted.act(async () => recovery.reject(new Error('active failure')))

    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('data-mode'))
      .toBe('bypassPermissions')
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('aria-busy'))
      .toBe('false')
    expect(mocks.error).toHaveBeenCalledOnce()
    consoleError.mockRestore()
    await mounted.unmount()
  })

  it('binds a newly committed Sender DOM revision to its own immutable scope', async () => {
    const mounted = await mountConcurrent(renderActualSender({
      authoritativeMode: 'default',
      sessionId: 'session-a'
    }))
    await mounted.act(async () =>
      findReactHostElement(
        mounted.container,
        element =>
          element.getAttribute('class')?.includes(
            'sender-permission-menu__item--bypassPermissions'
          ) === true
      )?.click()
    )
    const oldModal = latestModal()

    await mounted.render(renderActualSender({
      authoritativeMode: 'default',
      sessionId: 'session-b'
    }))
    expect(mocks.destroyModal).toHaveBeenCalledOnce()
    await mounted.act(async () => oldModal?.onOk?.())
    expect(mocks.updateSession).not.toHaveBeenCalled()

    await mounted.act(async () =>
      findReactHostElement(
        mounted.container,
        element =>
          element.getAttribute('class')?.includes(
            'sender-permission-menu__item--bypassPermissions'
          ) === true
      )?.click()
    )
    const committedModal = latestModal()
    await mounted.act(async () => committedModal?.onOk?.())
    await mounted.act(async () => committedModal?.afterClose?.())
    expect(mocks.updateSession).toHaveBeenCalledWith('session-b', {
      permissionMode: 'bypassPermissions'
    })
    await mounted.unmount()
  })
})
