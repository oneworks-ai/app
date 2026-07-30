/* eslint-disable max-lines -- mounted Sender lifecycle coverage shares one authentic composition. */

import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as permissionModeCoordinator from '#~/hooks/chat/use-chat-permission-mode'
import type { PermissionModeSelectionStart } from '#~/hooks/chat/use-chat-permission-mode'
import type { PermissionModeTransitionTerminalOutcome } from '#~/hooks/chat/use-session-permission-mode-change'

import {
  MemoryStorage,
  createDeferred,
  findReactHostElement,
  installReactMountedTestHost,
  queueReactHostEvent,
  scheduleReactHostEventAtCapture
} from './react-mounted-test-host'
import type { ReactHostElement } from './react-mounted-test-host'
import { ActualSenderPermissionHarness, PermissionHarness } from './sender-permission-mode-test-harness'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  compact: false,
  destroyModal: vi.fn(),
  error: vi.fn(),
  headerCollapsed: false,
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
  ShortcutDisplay: () => <span />,
  ShortcutTooltip: ({ children }: React.PropsWithChildren<Record<string, unknown>>) => <>{children}</>
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
  Tag: ({ children }: React.PropsWithChildren<Record<string, unknown>>) => <span>{children}</span>,
  Tooltip: ({ children }: React.PropsWithChildren<Record<string, unknown>>) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      if (options?.mode != null && options.risk != null) {
        return `${options.mode}, ${options.risk}. ${key}`
      }
      return key
    }
  })
}))

vi.mock('#~/hooks/use-responsive-layout', () => ({
  useResponsiveLayout: () => ({
    isCompactLayout: mocks.compact,
    isTouchInteraction: false
  })
}))

vi.mock('#~/components/chat/sender/@components/mobile-select-drawer/SenderMobileSelectDrawer', () => ({
  SenderMobileSelectDrawer: ({ children }: React.PropsWithChildren<Record<string, unknown>>) => <>{children}</>
}))

vi.mock('#~/components/chat/sender/@components/sender-composer-input/SenderComposerInput', async () => {
  const { SenderToolbar } = await vi.importActual<
    typeof import('#~/components/chat/sender/@components/sender-toolbar/SenderToolbar')
  >('#~/components/chat/sender/@components/sender-toolbar/SenderToolbar')
  type ToolbarProps = React.ComponentProps<typeof SenderToolbar>

  return {
    SenderComposerInput: ({
      toolbarData,
      toolbarHandlers,
      toolbarRefs,
      toolbarState,
      showHeaderControlsInMore
    }: {
      toolbarData: ToolbarProps['data']
      toolbarHandlers: ToolbarProps['handlers']
      toolbarRefs: ToolbarProps['refs']
      toolbarState: ToolbarProps['state']
      showHeaderControlsInMore?: boolean
    }) => (
      <>
        <textarea data-testid='actual-sender-editor' />
        <SenderToolbar
          state={toolbarState}
          data={toolbarData}
          refs={toolbarRefs}
          handlers={toolbarHandlers}
          showHeaderControlsInMore={showHeaderControlsInMore}
        />
      </>
    )
  }
})

vi.mock('#~/components/chat/sender/@hooks/use-sender-voice-input', () => ({
  useSenderVoiceInput: () => undefined
}))

vi.mock('#~/components/workspace/ContextFilePicker', () => ({
  ContextFilePicker: () => null
}))

vi.mock('#~/components/list-search-input', () => ({
  ListSearchInput: () => <input data-testid='starter-search' />
}))

vi.mock('#~/hooks/use-sender-header-query-state.js', () => ({
  useSenderHeaderQueryState: () => ({
    isHeaderCollapsed: mocks.headerCollapsed,
    setHeaderCollapsed: vi.fn()
  })
}))

const latestModal = () => {
  return mocks.confirm.mock.calls.at(-1)?.[0] as {
    afterClose?: () => void
    onOk?: () => void | Promise<void>
  } | undefined
}

const findByTestId = (root: ReactHostElement, testId: string) => {
  return findReactHostElement(root, element => element.getAttribute('data-testid') === testId)
}

const mountReact = async (element: React.ReactElement) => {
  const host = installReactMountedTestHost()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  const root = createRoot(host.container as unknown as Element)
  await act(async () => root.render(element))
  return {
    act,
    container: host.container,
    document: host.document,
    eventBoundary: host.eventBoundary,
    render: async (next: React.ReactElement) => {
      await act(async () => root.render(next))
    },
    unmount: async () => {
      await act(async () => root.unmount())
    },
    unmountCommitted: () => {
      root.unmount()
    }
  }
}

beforeEach(() => {
  mocks.confirm.mockReset()
  mocks.compact = false
  mocks.destroyModal.mockReset()
  mocks.confirm.mockImplementation(() => ({ destroy: mocks.destroyModal }))
  mocks.error.mockReset()
  mocks.headerCollapsed = false
  mocks.warning.mockReset()
  mocks.updateSession.mockReset()
  mocks.updateSession.mockResolvedValue(undefined)
  const storage = new MemoryStorage()
  Object.assign(globalThis, { localStorage: storage })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sender permission modes', () => {
  it('re-confirms same-history and reload-equivalent draft lifecycles', async () => {
    const storage = globalThis.localStorage as unknown as MemoryStorage
    const first = await mountReact(
      <PermissionHarness draftIdentity='same-default-draft' workspaceFolder='' />
    )
    await first.act(async () => findByTestId(first.container, 'starter-bypass-entry')?.click())
    await first.act(async () => latestModal()?.onOk?.())
    await first.act(async () => latestModal()?.afterClose?.())
    expect([...storage.values.keys()].some(key => key.includes('draft'))).toBe(false)
    await first.unmount()

    mocks.confirm.mockClear()
    const reloaded = await mountReact(
      <PermissionHarness draftIdentity='same-default-draft' workspaceFolder='' />
    )
    await reloaded.act(async () => findByTestId(reloaded.container, 'starter-bypass-entry')?.click())
    expect(mocks.confirm).toHaveBeenCalledOnce()
    await reloaded.act(async () => latestModal()?.afterClose?.())
    await reloaded.unmount()
  })

  it('shows a visible failure for a rejected legacy permission callback', async () => {
    const mounted = await mountReact(
      <ActualSenderPermissionHarness
        draftIdentity='legacy-rejection'
        legacyPermissionModeChange={() => Promise.reject(new Error('legacy failed'))}
      />
    )
    const acceptEdits = findReactHostElement(
      mounted.container,
      element =>
        element.getAttribute('class')?.includes(
          'sender-permission-menu__item--acceptEdits'
        ) === true
    )
    await mounted.act(async () => acceptEdits?.click())
    await mounted.act(async () => Promise.resolve())
    expect(mocks.error).toHaveBeenCalledOnce()
    await mounted.unmount()
  })

  it('mounts real Sender direct, keyboard, recovery, and More paths', async () => {
    const mounted = await mountReact(
      <ActualSenderPermissionHarness draftIdentity='workspace-a:direct' />
    )
    const directDontAsk = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-menu__item--dontAsk') === true
    )

    await mounted.act(async () => directDontAsk?.click())
    expect(mocks.confirm).toHaveBeenCalledOnce()
    await mounted.act(async () => latestModal()?.afterClose?.())
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('data-mode')).toBe('default')

    const directBypass = findReactHostElement(
      mounted.container,
      element =>
        element.getAttribute('class')?.includes(
          'sender-permission-menu__item--bypassPermissions'
        ) === true
    )
    await mounted.act(async () => directBypass?.keyDown('Enter'))
    await mounted.act(async () => latestModal()?.onOk?.())
    await mounted.act(async () => latestModal()?.afterClose?.())
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('data-mode'))
      .toBe('bypassPermissions')

    const recovery = findReactHostElement(
      mounted.container,
      element =>
        element.getAttribute('class')?.includes(
          'sender-permission-reset--bypassPermissions'
        ) === true
    )
    expect(recovery?.getAttribute('aria-label')).toBe('chat.permissionModes.restoreDefault')
    await mounted.act(async () => recovery?.click())
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('data-mode')).toBe('default')
    await mounted.unmount()

    mocks.confirm.mockClear()
    mocks.headerCollapsed = true
    const more = await mountReact(
      <ActualSenderPermissionHarness draftIdentity='workspace-a:more' />
    )
    const collapsedLowRiskStatus = findReactHostElement(
      more.container,
      element =>
        element.getAttribute('class')?.includes(
          'chat-input-header-toggle-mode-indicator--default'
        ) === true
    )
    expect(collapsedLowRiskStatus?.getAttribute('role')).toBe('status')
    expect(collapsedLowRiskStatus?.getAttribute('aria-label'))
      .toBe('chat.permissionModes.default.label')
    expect(collapsedLowRiskStatus?.getAttribute('aria-busy')).toBe('false')
    const permissionBranch = findReactHostElement(
      more.container,
      element =>
        element.getAttribute('class')?.includes(
            'oneworks-overlay-action'
          ) === true && element.textContent.includes('chat.referencePermission')
    )
    expect(permissionBranch).toBeDefined()
    await more.act(async () => permissionBranch?.click())
    const composite = findReactHostElement(
      more.container,
      element => element.getAttribute('class')?.includes('reference-actions-menu-composite') === true
    )
    const submenuColumns = composite?.querySelectorAll('.oneworks-overlay-menu-column.is-submenu') ?? []
    expect(composite?.style.getPropertyValue('--oneworks-overlay-submenu-width'))
      .toBe('var(--reference-actions-submenu-width)')
    expect(submenuColumns).toHaveLength(1)
    expect(
      submenuColumns[0]
        ?.querySelector<ReactHostElement>('.reference-actions-menu')
        ?.style.getPropertyValue('--oneworks-overlay-menu-width')
    ).toBe('var(--reference-actions-submenu-width)')
    const moreDontAsk = findReactHostElement(
      more.container,
      element =>
        element.getAttribute('class')?.includes(
          'reference-actions-permission-mode-item--dontAsk'
        ) === true
    )
    await more.act(async () => moreDontAsk?.keyDown('Enter'))
    expect(mocks.confirm).toHaveBeenCalledOnce()
    await more.act(async () => latestModal()?.onOk?.())
    await more.act(async () => latestModal()?.afterClose?.())
    const collapsedRecovery = findReactHostElement(
      more.container,
      element =>
        element.getAttribute('class')?.includes(
          'chat-input-header-toggle-mode-indicator--dontAsk'
        ) === true
    )
    expect(collapsedRecovery?.getAttribute('aria-label')).toContain(
      'chat.permissionModes.dontAsk.label'
    )
    expect(collapsedRecovery?.getAttribute('aria-label')).toContain(
      'chat.permissionModes.risk.high'
    )
    expect(collapsedRecovery?.getAttribute('aria-label')).not.toContain('[object Object]')
    await more.act(async () => collapsedRecovery?.click())
    expect(findByTestId(more.container, 'actual-sender-state')?.getAttribute('data-mode'))
      .toBe('default')
    await more.unmount()
  })

  it('delivers queued production permission events into the committed pending guard', async () => {
    const requestCoordinator = vi.spyOn(permissionModeCoordinator, 'requestPermissionModeChange')
    const desktopPending = createDeferred<void>()
    mocks.updateSession.mockReturnValueOnce(desktopPending.promise)
    const desktop = await mountReact(
      <ActualSenderPermissionHarness
        authoritativeMode='default'
        draftIdentity='workspace-a:pending-desktop'
        sessionId='session-pending-desktop'
      />
    )
    const staleDirectItem = findReactHostElement(
      desktop.container,
      element => element.getAttribute('class')?.includes('sender-permission-menu__item--dontAsk') === true
    )
    const directTrigger = findReactHostElement(
      desktop.container,
      element => element.getAttribute('class')?.includes('sender-permission-trigger') === true
    )
    const selectAcceptEdits = findReactHostElement(
      desktop.container,
      element => element.getAttribute('class')?.includes('sender-permission-menu__item--acceptEdits') === true
    )
    let directTargetWasDispatchable = false
    const scheduledDirectClick = staleDirectItem == null
      ? undefined
      : scheduleReactHostEventAtCapture(
        desktop.eventBoundary,
        staleDirectItem,
        'click',
        () => {
          selectAcceptEdits?.click()
          directTargetWasDispatchable = staleDirectItem.disabled !== true
        },
        { button: 0 }
      )
    const deliverDirectKeyboard = staleDirectItem == null
      ? undefined
      : queueReactHostEvent(staleDirectItem, 'keydown', { key: 'Enter' })
    await desktop.act(async () => {
      scheduledDirectClick?.dispatchWhileEnabled()
    })
    expect(scheduledDirectClick?.getCaptureCount()).toBe(1)
    expect(scheduledDirectClick?.getBubbleCount()).toBe(1)
    expect(directTargetWasDispatchable).toBe(true)
    // The initial accepted selection entered the real coordinator once. The
    // original enabled event then reached Sender's event-time guard; removing
    // that guard would call this coordinator a second time.
    expect(requestCoordinator).toHaveBeenCalledOnce()
    expect(directTrigger?.getAttribute('disabled')).not.toBeNull()
    expect(directTrigger?.getAttribute('aria-busy')).toBe('true')
    expect(staleDirectItem?.getAttribute('disabled')).not.toBeNull()
    await desktop.act(async () => {
      deliverDirectKeyboard?.()
    })
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.updateSession).toHaveBeenCalledOnce()
    expect(findByTestId(desktop.container, 'actual-sender-state')?.getAttribute('data-mode')).toBe('acceptEdits')
    await desktop.act(async () => desktopPending.resolve(undefined))
    scheduledDirectClick?.dispose()
    await desktop.unmount()

    mocks.updateSession.mockReset()
    requestCoordinator.mockClear()
    const morePending = createDeferred<void>()
    mocks.updateSession.mockReturnValueOnce(morePending.promise)
    mocks.headerCollapsed = true
    const more = await mountReact(
      <ActualSenderPermissionHarness
        authoritativeMode='default'
        draftIdentity='workspace-a:pending-more'
        sessionId='session-pending-more'
      />
    )
    const permissionBranch = findReactHostElement(
      more.container,
      element =>
        element.getAttribute('class')?.includes('oneworks-overlay-action') === true &&
        element.textContent.includes('chat.referencePermission')
    )
    await more.act(async () => permissionBranch?.click())
    const openedMoreItem = findReactHostElement(
      more.container,
      element => element.getAttribute('class')?.includes('reference-actions-permission-mode-item--dontAsk') === true
    )
    const moreAcceptEdits = findReactHostElement(
      more.container,
      element => element.getAttribute('class')?.includes('reference-actions-permission-mode-item--acceptEdits') === true
    )
    let moreTargetWasDispatchable = false
    const scheduledMoreClick = openedMoreItem == null
      ? undefined
      : scheduleReactHostEventAtCapture(
        more.eventBoundary,
        openedMoreItem,
        'click',
        () => {
          moreAcceptEdits?.click()
          moreTargetWasDispatchable = openedMoreItem.disabled !== true
        },
        { button: 0 }
      )
    await more.act(async () => scheduledMoreClick?.dispatchWhileEnabled())
    expect(scheduledMoreClick?.getCaptureCount()).toBe(1)
    expect(moreTargetWasDispatchable).toBe(true)
    expect(requestCoordinator).toHaveBeenCalledOnce()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.updateSession).toHaveBeenCalledOnce()
    await more.act(async () => morePending.resolve(undefined))
    scheduledMoreClick?.dispose()
    await more.unmount()

    mocks.compact = true
    mocks.headerCollapsed = false
    mocks.updateSession.mockReset()
    const compactPending = createDeferred<void>()
    mocks.updateSession.mockReturnValueOnce(compactPending.promise)
    const compact = await mountReact(
      <ActualSenderPermissionHarness
        authoritativeMode='default'
        draftIdentity='workspace-a:pending-compact'
        sessionId='session-pending-compact'
      />
    )
    const compactItem = findReactHostElement(
      compact.container,
      element => element.getAttribute('class')?.includes('sender-permission-menu__item--bypassPermissions') === true
    )
    const deliverCompactKeyboard = compactItem == null
      ? undefined
      : queueReactHostEvent(compactItem, 'keydown', { key: 'Enter' })
    const compactAcceptEdits = findReactHostElement(
      compact.container,
      element => element.getAttribute('class')?.includes('sender-permission-menu__item--acceptEdits') === true
    )
    await compact.act(async () => compactAcceptEdits?.click())
    expect(compactItem?.getAttribute('disabled')).not.toBeNull()
    await compact.act(async () => deliverCompactKeyboard?.())
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.updateSession).toHaveBeenCalledOnce()
    expect(findByTestId(compact.container, 'actual-sender-state')?.getAttribute('data-mode')).toBe('acceptEdits')
    await compact.act(async () => compactPending.resolve(undefined))
    await compact.unmount()

    mocks.compact = false
    mocks.headerCollapsed = true
    mocks.updateSession.mockReset()
    requestCoordinator.mockClear()
    const collapsedPending = createDeferred<void>()
    mocks.updateSession.mockReturnValueOnce(collapsedPending.promise)
    const collapsed = await mountReact(
      <ActualSenderPermissionHarness
        authoritativeMode='dontAsk'
        draftIdentity='workspace-a:pending-collapsed'
        sessionId='session-pending-collapsed'
      />
    )
    const recovery = findReactHostElement(
      collapsed.container,
      element => element.getAttribute('class')?.includes('chat-input-header-toggle-mode-indicator--dontAsk') === true
    )
    const collapsedDefault = findReactHostElement(
      collapsed.container,
      element => element.getAttribute('class')?.includes('sender-permission-menu__item--default') === true
    )
    let collapsedTargetWasDispatchable = false
    const scheduledCollapsedClick = recovery == null
      ? undefined
      : scheduleReactHostEventAtCapture(
        collapsed.eventBoundary,
        recovery,
        'click',
        () => {
          collapsedDefault?.click()
          collapsedTargetWasDispatchable = recovery.disabled !== true
        },
        { button: 0 }
      )
    await collapsed.act(async () => scheduledCollapsedClick?.dispatchWhileEnabled())
    expect(scheduledCollapsedClick?.getCaptureCount()).toBe(1)
    expect(collapsedTargetWasDispatchable).toBe(true)
    expect(requestCoordinator).toHaveBeenCalledOnce()
    expect(findByTestId(collapsed.container, 'actual-sender-state')?.getAttribute('aria-busy')).toBe('true')
    expect(mocks.updateSession).toHaveBeenCalledOnce()
    expect(findByTestId(collapsed.container, 'actual-sender-state')?.getAttribute('data-mode')).toBe(
      'default'
    )
    await collapsed.act(async () => collapsedPending.resolve(undefined))
    scheduledCollapsedClick?.dispose()
    await collapsed.unmount()
  })

  it('does not compensate an already-finalized direct selection', async () => {
    const storage = globalThis.localStorage as unknown as MemoryStorage
    storage.setItem('oneworks_chat_permission_mode', 'acceptEdits')
    const firstRuntime = createDeferred<void>()
    const serverModes: string[] = []
    let authoritativeServerMode = 'dontAsk'
    mocks.updateSession.mockImplementation((_sessionId, update) => {
      const nextMode = (update as { permissionMode: string }).permissionMode
      serverModes.push(nextMode)
      const settle = () => {
        authoritativeServerMode = nextMode
      }
      if (serverModes.length === 1) return firstRuntime.promise.then(settle)
      settle()
      return Promise.resolve()
    })
    const selections: PermissionModeSelectionStart[] = []
    const mounted = await mountReact(
      <ActualSenderPermissionHarness
        authoritativeMode='dontAsk'
        draftIdentity='workspace-a:cas'
        onPermissionSelection={selection => selections.push(selection)}
        sessionId='session-cas'
      />
    )
    const recovery = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-reset--dontAsk') === true
    )
    await mounted.act(async () => recovery?.click())
    await mounted.act(async () => firstRuntime.resolve(undefined))
    await vi.waitFor(() => expect(storage.getItem('oneworks_chat_permission_mode')).toBe('default'))
    const olderSelection = selections[0]
    expect(olderSelection?.cancel).toBeDefined()

    await mounted.act(async () => olderSelection!.cancel!())
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('data-mode')).toBe('default')
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('aria-busy')).toBe('false')
    const acceptEdits = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-menu__item--acceptEdits') === true
    )
    await mounted.act(async () => acceptEdits?.click())
    await vi.waitFor(() =>
      expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('aria-busy')).toBe('false')
    )
    expect(authoritativeServerMode).toBe('acceptEdits')
    await vi.waitFor(() => expect(storage.getItem('oneworks_chat_permission_mode')).toBe('acceptEdits'))
    expect(serverModes).toEqual(['default', 'acceptEdits'])
    expect(authoritativeServerMode).toBe('acceptEdits')
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('data-mode')).toBe('acceptEdits')
    await mounted.unmount()
  })

  it.each([
    ['returns false', () => false],
    ['rejects', () => Promise.reject(new Error('initial rejected'))]
  ])('keeps the initial selection uncommitted when updateSession %s', async (_caseName, settle) => {
    const storage = globalThis.localStorage as unknown as MemoryStorage
    mocks.updateSession.mockImplementationOnce(() => settle())
    const selections: PermissionModeSelectionStart[] = []
    const mounted = await mountReact(
      <ActualSenderPermissionHarness
        authoritativeMode='default'
        draftIdentity={`initial-${_caseName}`}
        onPermissionSelection={selection => selections.push(selection)}
        sessionId={`initial-${_caseName}`}
      />
    )
    const acceptEdits = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-menu__item--acceptEdits') === true
    )
    await mounted.act(async () => acceptEdits?.click())
    await expect(selections[0]!.completion).resolves.toBe(false)
    expect(storage.getItem('oneworks_chat_permission_mode')).toBeNull()
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('data-mode')).toBe('default')
    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({
      content: 'chat.permissionModes.initialUpdateFailed'
    }))
    await mounted.unmount()
  })

  it('releases the same-dispatch owner after fast draft success', async () => {
    const selections: PermissionModeSelectionStart[] = []
    const mounted = await mountReact(
      <ActualSenderPermissionHarness
        authoritativeMode='default'
        draftIdentity='fast-draft-selection'
        onPermissionSelection={selection => selections.push(selection)}
      />
    )
    const acceptEdits = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-menu__item--acceptEdits') === true
    )
    await mounted.act(async () => acceptEdits?.click())
    await expect(selections[0]!.completion).resolves.toBe(true)
    await Promise.resolve()
    const defaultMode = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-menu__item--default') === true
    )
    await mounted.act(async () => defaultMode?.click())
    await expect(selections[1]!.completion).resolves.toBe(true)
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('aria-busy')).toBe('false')
    await mounted.unmount()
  })

  it.each([
    ['legacy void', () => undefined],
    ['legacy promise', () => Promise.resolve()]
  ])('releases the same-dispatch owner after %s success', async (_caseName, legacyHandler) => {
    const legacy = vi.fn(legacyHandler)
    const mounted = await mountReact(
      <ActualSenderPermissionHarness
        authoritativeMode='default'
        draftIdentity={`legacy-${_caseName}`}
        legacyPermissionModeChange={legacy}
      />
    )
    const acceptEdits = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-menu__item--acceptEdits') === true
    )
    await mounted.act(async () => acceptEdits?.click())
    await Promise.resolve()
    await mounted.act(async () => acceptEdits?.click())
    expect(legacy).toHaveBeenCalledTimes(2)
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('aria-busy')).toBe('false')
    await mounted.unmount()
  })

  it('keeps a current high-risk selection truthful when compensation fails', async () => {
    const storage = globalThis.localStorage as unknown as MemoryStorage
    mocks.updateSession.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('undo rejected'))
    const selections: PermissionModeSelectionStart[] = []
    const mounted = await mountReact(
      <ActualSenderPermissionHarness
        authoritativeMode='default'
        deferPermissionSelectionFinalize
        draftIdentity='high-compensation-failure'
        onPermissionSelection={selection => selections.push(selection)}
        sessionId='high-compensation-failure'
      />
    )
    const bypass = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-menu__item--bypassPermissions') === true
    )
    await mounted.act(async () => bypass?.click())
    await mounted.act(async () => latestModal()?.onOk?.())
    await vi.waitFor(() => expect(selections).toHaveLength(1))
    await mounted.act(async () => selections[0]!.cancel!())
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('data-mode')).toBe('bypassPermissions')
    expect([...storage.values.values()]).toContain('["bypassPermissions"]')
    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({
      content: 'chat.permissionModes.compensationFailedSelectedRemains'
    }))
    await mounted.unmount()
  })

  it('keeps a deferred low-risk selection compensable through unmount and restores its exact prior preference', async () => {
    const storage = globalThis.localStorage as unknown as MemoryStorage
    storage.setItem('oneworks_chat_permission_mode', 'acceptEdits')
    const compensation = createDeferred<void>()
    const updates: string[] = []
    mocks.updateSession.mockImplementation((_sessionId, update) => {
      const mode = (update as { permissionMode: string }).permissionMode
      updates.push(mode)
      return updates.length === 2 ? compensation.promise : Promise.resolve()
    })
    const selections: PermissionModeSelectionStart[] = []
    const mounted = await mountReact(
      <ActualSenderPermissionHarness
        authoritativeMode='dontAsk'
        deferPermissionSelectionFinalize
        draftIdentity='provisional-unmount'
        onPermissionSelection={selection => selections.push(selection)}
        sessionId='provisional-unmount'
      />
    )
    const recovery = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-reset--dontAsk') === true
    )
    await mounted.act(async () => recovery?.click())
    await vi.waitFor(() => expect(storage.getItem('oneworks_chat_permission_mode')).toBe('default'))
    const selection = selections[0]
    expect(selection?.finalize).toBeDefined()
    expect(selection?.cancel).toBeDefined()

    let cancellation: Promise<PermissionModeTransitionTerminalOutcome> | undefined
    await mounted.act(async () => {
      cancellation = selection!.cancel!()
      await Promise.resolve()
    })
    const rootWarning = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mounted.unmountCommitted()
    expect(updates).toEqual(['default', 'dontAsk'])
    expect(storage.getItem('oneworks_chat_permission_mode')).toBe('default')
    const finalizeDuringCancel = selection!.finalize?.()

    compensation.resolve(undefined)
    if (cancellation == null) throw new Error('Expected cancellation to start')
    await cancellation
    await finalizeDuringCancel
    expect(storage.getItem('oneworks_chat_permission_mode')).toBe('acceptEdits')
    expect(updates).toEqual(['default', 'dontAsk'])

    // A cancelled selection cannot later commit its former write token.
    selection!.finalize?.()
    expect(storage.getItem('oneworks_chat_permission_mode')).toBe('acceptEdits')
    rootWarning.mockRestore()
  })

  it.each([
    ['returns false', () => false],
    ['rejects', () => Promise.reject(new Error('compensation rejected'))]
  ])('releases a provisional write owner when compensation %s', async (_caseName, settleCompensation) => {
    const storage = globalThis.localStorage as unknown as MemoryStorage
    storage.setItem('oneworks_chat_permission_mode', 'acceptEdits')
    const updates: string[] = []
    mocks.updateSession.mockImplementation((_sessionId, update) => {
      const mode = (update as { permissionMode: string }).permissionMode
      updates.push(mode)
      return updates.length === 2 ? settleCompensation() : Promise.resolve()
    })
    const selections: PermissionModeSelectionStart[] = []
    const mounted = await mountReact(
      <ActualSenderPermissionHarness
        authoritativeMode='dontAsk'
        deferPermissionSelectionFinalize
        draftIdentity={`compensation-${_caseName}`}
        onPermissionSelection={selection => selections.push(selection)}
        sessionId={`compensation-${_caseName}`}
      />
    )
    const recovery = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-reset--dontAsk') === true
    )
    await mounted.act(async () => recovery?.click())
    await vi.waitFor(() => expect(storage.getItem('oneworks_chat_permission_mode')).toBe('default'))
    await mounted.act(async () => {
      expect(await selections[0]!.cancel!()).toBe('compensation-failed-selected-remains')
    })

    // Remote compensation failed, so selected runtime and persisted preference
    // intentionally remain aligned. A fresh selection proves the module token
    // was released rather than poisoning the next attempt.
    expect(storage.getItem('oneworks_chat_permission_mode')).toBe('default')
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('data-mode')).toBe('default')
    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({
      content: 'chat.permissionModes.compensationFailedSelectedRemains'
    }))
    const acceptEdits = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-menu__item--acceptEdits') === true
    )
    await mounted.act(async () => acceptEdits?.click())
    await vi.waitFor(() => expect(storage.getItem('oneworks_chat_permission_mode')).toBe('acceptEdits'))
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('aria-busy')).toBe('false')
    await mounted.unmount()
  })

  it('compensates a stale low-risk success and keeps the new scope truthfully busy', async () => {
    const storage = globalThis.localStorage as unknown as MemoryStorage
    const oldRequest = createDeferred<void>()
    const oldCompensation = createDeferred<void>()
    const serverModes = new Map<string, string>([
      ['session-a', 'default'],
      ['session-b', 'plan']
    ])
    const updates: Array<[string, string]> = []
    mocks.updateSession.mockImplementation((sessionId, update) => {
      const nextMode = (update as { permissionMode: string }).permissionMode
      updates.push([sessionId as string, nextMode])
      const settle = () => serverModes.set(sessionId as string, nextMode)
      if (updates.length === 1) return oldRequest.promise.then(settle)
      if (updates.length === 2) return oldCompensation.promise.then(settle)
      settle()
      return Promise.resolve()
    })
    const layoutStates: string[] = []
    const mounted = await mountReact(
      <ActualSenderPermissionHarness
        authoritativeMode='default'
        draftIdentity='old-scope'
        onLayoutMode={(mode, pending) => layoutStates.push(`${mode}:${pending}`)}
        sessionId='session-a'
      />
    )
    const staleHighRisk = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-menu__item--bypassPermissions') === true
    )
    const deliverStaleHighRisk = staleHighRisk == null
      ? undefined
      : queueReactHostEvent(staleHighRisk, 'click', { button: 0 })
    const selectAcceptEdits = () =>
      findReactHostElement(
        mounted.container,
        element => element.getAttribute('class')?.includes('sender-permission-menu__item--acceptEdits') === true
      )
    await mounted.act(async () => selectAcceptEdits()?.click())
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('aria-busy')).toBe('true')

    await mounted.render(
      <ActualSenderPermissionHarness
        authoritativeMode='plan'
        draftIdentity='new-scope'
        onLayoutMode={(mode, pending) => layoutStates.push(`${mode}:${pending}`)}
        sessionId='session-b'
      />
    )
    expect(layoutStates.at(-1)).toBe('plan:true')
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('data-mode')).toBe('plan')
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('aria-busy')).toBe('true')
    await mounted.act(async () => deliverStaleHighRisk?.())
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(updates).toEqual([['session-a', 'acceptEdits']])

    await mounted.act(async () => oldRequest.resolve(undefined))
    await vi.waitFor(() =>
      expect(updates).toEqual([
        ['session-a', 'acceptEdits'],
        ['session-a', 'default']
      ])
    )
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('aria-busy')).toBe('true')
    await mounted.act(async () => deliverStaleHighRisk?.())
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect([...storage.values.values()]).not.toContain('["bypassPermissions"]')

    await mounted.act(async () => oldCompensation.resolve(undefined))
    await vi.waitFor(() =>
      expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('aria-busy')).toBe('false')
    )
    expect(serverModes.get('session-a')).toBe('default')
    await mounted.act(async () => selectAcceptEdits()?.click())
    await vi.waitFor(() => expect(serverModes.get('session-b')).toBe('acceptEdits'))
    expect(storage.getItem('oneworks_chat_permission_mode')).toBe('acceptEdits')
    expect(findByTestId(mounted.container, 'actual-sender-state')?.getAttribute('data-mode')).toBe('acceptEdits')
    await mounted.unmount()
  })

  it('compensates a low-risk request that succeeds after unmount commit before passive cleanup', async () => {
    const storage = globalThis.localStorage as unknown as MemoryStorage
    const request = createDeferred<void>()
    const compensation = createDeferred<void>()
    const serverModes: string[] = []
    mocks.updateSession.mockImplementation((_sessionId, update) => {
      const nextMode = (update as { permissionMode: string }).permissionMode
      serverModes.push(nextMode)
      if (serverModes.length === 1) return request.promise
      if (serverModes.length === 2) return compensation.promise
      return Promise.resolve()
    })
    let passiveCleanupComplete = false
    let settledBeforePassiveCleanup: boolean | undefined
    const mounted = await mountReact(
      <ActualSenderPermissionHarness
        authoritativeMode='default'
        draftIdentity='unmount-stale-low-risk'
        onLayoutUnmount={() => {
          settledBeforePassiveCleanup = !passiveCleanupComplete
          request.resolve(undefined)
        }}
        onPassiveUnmount={() => {
          passiveCleanupComplete = true
        }}
        sessionId='session-unmount-low-risk'
      />
    )
    const acceptEdits = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-menu__item--acceptEdits') === true
    )
    await mounted.act(async () => acceptEdits?.click())
    const rootWarning = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mounted.unmountCommitted()
    expect(settledBeforePassiveCleanup).toBe(true)
    await vi.waitFor(() => expect(serverModes).toEqual(['acceptEdits', 'default']))
    compensation.resolve(undefined)
    await compensation.promise
    expect(storage.getItem('oneworks_chat_permission_mode')).toBeNull()
    rootWarning.mockRestore()
  })

  it('awaits the same scope-invalidation cancellation before destroying its modal', async () => {
    const storage = globalThis.localStorage as unknown as MemoryStorage
    const compensation = createDeferred<void>()
    mocks.updateSession
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(compensation.promise)
    const mounted = await mountReact(
      <PermissionHarness
        authoritativeMode='default'
        deferStarterFinalize
        draftIdentity='scope-a'
        sessionId='session-a'
      />
    )
    await mounted.act(async () => findByTestId(mounted.container, 'starter-bypass-entry')?.click())
    await mounted.act(async () => latestModal()?.onOk?.())
    expect(findByTestId(mounted.container, 'permission-state')?.getAttribute('data-mode'))
      .toBe('bypassPermissions')

    await mounted.render(
      <PermissionHarness
        authoritativeMode='default'
        draftIdentity='scope-b'
        sessionId='session-b'
      />
    )
    await vi.waitFor(() => expect(mocks.updateSession).toHaveBeenCalledTimes(2))
    expect(mocks.destroyModal).not.toHaveBeenCalled()
    expect([...storage.values.values()]).toContain('["bypassPermissions"]')

    await mounted.act(async () => compensation.resolve(undefined))
    await vi.waitFor(() => expect(mocks.destroyModal).toHaveBeenCalledOnce())
    expect([...storage.values.values()]).not.toContain('["bypassPermissions"]')
    expect(findByTestId(mounted.container, 'permission-state')?.getAttribute('data-mode'))
      .toBe('default')
    await mounted.unmount()

    mocks.confirm.mockClear()
    mocks.destroyModal.mockReset()
    mocks.updateSession.mockReset()
    mocks.updateSession
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('compensation rejected'))
    const unmounted = await mountReact(
      <PermissionHarness
        authoritativeMode='default'
        deferStarterFinalize
        draftIdentity='scope-unmount'
        sessionId='session-unmount'
      />
    )
    await unmounted.act(async () => findByTestId(unmounted.container, 'starter-bypass-entry')?.click())
    await unmounted.act(async () => latestModal()?.onOk?.())
    await unmounted.unmount()
    await vi.waitFor(() => expect(mocks.updateSession).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(mocks.destroyModal).toHaveBeenCalledOnce())
    expect([...storage.values.values()]).toContain('["bypassPermissions"]')
  })

  it('invalidates modal callbacks across scope changes and unmount', async () => {
    const storage = globalThis.localStorage as unknown as MemoryStorage
    const mounted = await mountReact(
      <PermissionHarness draftIdentity='workspace-a:stale-modal' />
    )
    await mounted.act(async () => findByTestId(mounted.container, 'starter-bypass-entry')?.click())
    const staleModal = latestModal()

    await mounted.render(
      <PermissionHarness
        authoritativeMode='acceptEdits'
        draftIdentity='workspace-b'
        sessionId='session-b'
      />
    )
    expect(mocks.destroyModal).toHaveBeenCalledOnce()
    await mounted.act(async () => staleModal?.onOk?.())
    expect(mocks.updateSession).not.toHaveBeenCalled()
    expect(findByTestId(mounted.container, 'permission-state')?.getAttribute('data-mode'))
      .toBe('acceptEdits')
    expect([...storage.values.values()]).not.toContain('["bypassPermissions"]')

    await mounted.act(async () => findByTestId(mounted.container, 'starter-bypass-entry')?.click())
    const currentModal = latestModal()
    await mounted.act(async () => staleModal?.afterClose?.())
    await mounted.act(async () => currentModal?.onOk?.())
    await mounted.act(async () => currentModal?.afterClose?.())
    expect(mocks.updateSession).toHaveBeenCalledOnce()
    expect(findByTestId(mounted.container, 'permission-state')?.getAttribute('data-mode'))
      .toBe('bypassPermissions')

    await mounted.act(async () => findByTestId(mounted.container, 'starter-entry')?.click())
    const unmountedModal = latestModal()
    await mounted.unmount()
    expect(mocks.destroyModal).toHaveBeenCalledTimes(2)
    await unmountedModal?.onOk?.()
    expect(mocks.updateSession).toHaveBeenCalledOnce()
  })

  it('does not restore high risk across remount/workspace and transfers only the same draft acknowledgement', async () => {
    const storage = globalThis.localStorage as unknown as MemoryStorage
    const mounted = await mountReact(
      <PermissionHarness
        draftIdentity='workspace-a:draft-1'
        workspaceFolder='/workspace/a'
      />
    )

    await mounted.act(async () => findByTestId(mounted.container, 'starter-bypass-entry')?.click())
    await mounted.act(async () => latestModal()?.onOk?.())
    await mounted.act(async () => latestModal()?.afterClose?.())
    expect(storage.getItem('oneworks_chat_permission_mode')).toBeNull()
    await mounted.act(async () => findByTestId(mounted.container, 'issue-draft-creation')?.click())

    await mounted.render(
      <PermissionHarness
        authoritativeMode='bypassPermissions'
        draftIdentity='workspace-a:draft-1'
        workspaceFolder='/workspace/a'
        sessionId='session-created-from-draft'
      />
    )
    await mounted.act(async () => findByTestId(mounted.container, 'complete-draft-creation')?.click())
    expect([...storage.values.keys()].filter(
      key => key.includes(encodeURIComponent('draft:v2:'))
    )).toEqual([])
    await mounted.render(
      <PermissionHarness
        authoritativeMode='default'
        draftIdentity='workspace-a:ignored'
        workspaceFolder='/workspace/a'
        sessionId='session-reused-id'
      />
    )
    await mounted.act(async () => findByTestId(mounted.container, 'complete-draft-creation')?.click())
    await mounted.act(async () => findByTestId(mounted.container, 'starter-bypass-entry')?.click())
    expect(mocks.confirm).toHaveBeenCalledTimes(2)
    await mounted.act(async () => latestModal()?.afterClose?.())
    await mounted.unmount()

    const sameSession = await mountReact(
      <PermissionHarness
        authoritativeMode='default'
        draftIdentity='workspace-a:ignored'
        workspaceFolder='/workspace/a'
        sessionId='session-created-from-draft'
      />
    )
    await sameSession.act(async () => findByTestId(sameSession.container, 'starter-bypass-entry')?.click())
    expect(mocks.confirm).toHaveBeenCalledTimes(2)
    await sameSession.unmount()

    mocks.confirm.mockClear()
    storage.setItem(
      `oneworks_chat_acknowledged_high_risk_permission_modes:${
        encodeURIComponent(
          'session:session-created-from-draft'
        )
      }`,
      '["bypassPermissions"]'
    )
    const reusedIncarnation = await mountReact(
      <PermissionHarness
        authoritativeMode='default'
        draftIdentity='workspace-a:new-draft'
        workspaceFolder='/workspace/a'
        sessionCreatedAt={2}
        sessionId='session-created-from-draft'
      />
    )
    await reusedIncarnation.act(async () => findByTestId(reusedIncarnation.container, 'starter-bypass-entry')?.click())
    expect(mocks.confirm).toHaveBeenCalledOnce()
    await reusedIncarnation.act(async () => latestModal()?.afterClose?.())
    await reusedIncarnation.unmount()

    mocks.confirm.mockClear()
    const unrelatedDraft = await mountReact(
      <PermissionHarness draftIdentity='workspace-b:draft-2' />
    )
    expect(findByTestId(unrelatedDraft.container, 'permission-state')?.getAttribute('data-mode')).toBe('default')
    await unrelatedDraft.act(async () => findByTestId(unrelatedDraft.container, 'starter-bypass-entry')?.click())
    expect(mocks.confirm).toHaveBeenCalledOnce()
    await unrelatedDraft.act(async () => latestModal()?.onOk?.())
    await unrelatedDraft.act(async () => latestModal()?.afterClose?.())
    await unrelatedDraft.render(
      <PermissionHarness
        authoritativeMode='default'
        draftIdentity='workspace-b:existing-navigation'
        sessionId='existing-session'
      />
    )
    await unrelatedDraft.act(async () => findByTestId(unrelatedDraft.container, 'starter-bypass-entry')?.click())
    expect(mocks.confirm).toHaveBeenCalledTimes(2)
    await unrelatedDraft.act(async () => latestModal()?.afterClose?.())
    mocks.confirm.mockClear()
    await unrelatedDraft.render(
      <PermissionHarness draftIdentity='workspace-c:draft-3' />
    )
    await unrelatedDraft.act(async () => findByTestId(unrelatedDraft.container, 'starter-bypass-entry')?.click())
    expect(mocks.confirm).toHaveBeenCalledOnce()
    await unrelatedDraft.unmount()
  })

  it('rolls back visibly, rejects double actions, and ignores stale session completion', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const storage = globalThis.localStorage as unknown as MemoryStorage
    storage.setItem('oneworks_chat_permission_mode', 'acceptEdits')
    const activeRecoveryFailure = createDeferred<void>()
    mocks.updateSession.mockReturnValueOnce(activeRecoveryFailure.promise)
    const mounted = await mountReact(
      <PermissionHarness
        authoritativeMode='bypassPermissions'
        draftIdentity='workspace-a'
        sessionId='session-a'
      />
    )
    const recovery = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-reset') === true
    )

    await mounted.act(async () => recovery?.click())
    await mounted.act(async () => activeRecoveryFailure.reject(new Error('active recovery failure')))
    expect(findByTestId(mounted.container, 'permission-state')?.getAttribute('data-mode'))
      .toBe('bypassPermissions')
    expect(storage.getItem('oneworks_chat_permission_mode')).toBe('acceptEdits')
    expect(mocks.error).toHaveBeenCalledOnce()
    mocks.error.mockClear()

    const recoveryRequest = createDeferred<void>()
    mocks.updateSession.mockReturnValueOnce(recoveryRequest.promise)
    await mounted.act(async () => {
      recovery?.click()
      findByTestId(mounted.container, 'starter-bypass-entry')?.click()
    })
    expect(findByTestId(mounted.container, 'permission-state')?.getAttribute('aria-busy')).toBe('true')
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.warning).not.toHaveBeenCalled()
    expect(
      [...(globalThis.localStorage as unknown as MemoryStorage).values.values()]
    ).not.toContain('["bypassPermissions"]')

    await mounted.render(
      <PermissionHarness
        authoritativeMode='acceptEdits'
        draftIdentity='workspace-b'
        sessionId='session-b'
      />
    )
    await mounted.act(async () => recoveryRequest.reject(new Error('stale failure')))
    expect(findByTestId(mounted.container, 'permission-state')?.getAttribute('data-mode')).toBe('acceptEdits')
    expect(mocks.error).not.toHaveBeenCalled()
    expect(storage.getItem('oneworks_chat_permission_mode')).toBe('acceptEdits')

    const staleSuccess = createDeferred<void>()
    mocks.updateSession.mockReturnValueOnce(staleSuccess.promise)
    const restoreDefault = findReactHostElement(
      mounted.container,
      element =>
        element.getAttribute('class')?.includes(
          'sender-permission-menu__item--default'
        ) === true
    )
    await mounted.act(async () => restoreDefault?.click())
    await mounted.render(
      <PermissionHarness
        authoritativeMode='plan'
        draftIdentity='workspace-c'
        sessionId='session-c'
      />
    )
    await mounted.act(async () => staleSuccess.resolve(undefined))
    expect(findByTestId(mounted.container, 'permission-state')?.getAttribute('data-mode')).toBe('plan')
    expect(mocks.error).not.toHaveBeenCalled()
    expect(storage.getItem('oneworks_chat_permission_mode')).toBe('acceptEdits')

    const activeFailure = createDeferred<void>()
    mocks.updateSession.mockReturnValueOnce(activeFailure.promise)
    await mounted.act(async () => findByTestId(mounted.container, 'starter-bypass-entry')?.click())
    let activeConfirmation: void | Promise<void>
    await mounted.act(async () => {
      activeConfirmation = latestModal()?.onOk?.()
    })
    await mounted.act(async () => activeFailure.reject(new Error('active failure')))
    await activeConfirmation!
    await mounted.act(async () => latestModal()?.afterClose?.())
    expect(findByTestId(mounted.container, 'permission-state')?.getAttribute('data-mode')).toBe('plan')
    expect(mocks.error).toHaveBeenCalledOnce()
    expect(storage.getItem('oneworks_chat_permission_mode')).toBe('acceptEdits')

    mocks.confirm.mockClear()
    await mounted.act(async () => findByTestId(mounted.container, 'starter-bypass-entry')?.click())
    expect(mocks.confirm).toHaveBeenCalledOnce()
    await mounted.act(async () => latestModal()?.afterClose?.())
    await mounted.act(async () => restoreDefault?.click())
    expect(storage.getItem('oneworks_chat_permission_mode')).toBe('default')
    await mounted.unmount()

    storage.setItem('oneworks_chat_permission_mode', 'acceptEdits')
    const unmountedSuccess = createDeferred<void>()
    mocks.updateSession.mockReturnValueOnce(unmountedSuccess.promise)
    const unmounting = await mountReact(
      <PermissionHarness
        authoritativeMode='bypassPermissions'
        draftIdentity='workspace-unmount'
        sessionId='session-unmount'
      />
    )
    const unmountRecovery = findReactHostElement(
      unmounting.container,
      element => element.getAttribute('class')?.includes('sender-permission-reset') === true
    )
    await unmounting.act(async () => unmountRecovery?.click())
    await unmounting.unmount()
    unmountedSuccess.resolve(undefined)
    await unmountedSuccess.promise
    expect(storage.getItem('oneworks_chat_permission_mode')).toBe('acceptEdits')
    consoleError.mockRestore()
  })
})
