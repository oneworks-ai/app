/* eslint-disable max-lines -- mounted Sender/create/recovery/discard provenance coverage shares one real composition. */

import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Session } from '@oneworks/core'

import { buildPermissionModeSessionAcknowledgementScope } from '#~/hooks/chat/permission-mode-acknowledgement'
import { deriveCanonicalPermissionModeOwner } from '#~/hooks/chat/permission-mode-owner'

import { PermissionModeCreationHarness } from './permission-mode-creation-test-harness'
import {
  MemoryStorage,
  createDeferred,
  findReactHostElement,
  installReactMountedTestHost
} from './react-mounted-test-host'

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  getSessionMessages: vi.fn(),
  mutate: vi.fn(),
  navigate: vi.fn(),
  optimisticCreations: {} as Record<string, unknown>,
  setHeaderCollapsed: vi.fn(),
  setOptimisticCreations: vi.fn(),
  terminateSession: vi.fn(),
  updateSession: vi.fn(),
  confirm: vi.fn(),
  destroyModal: vi.fn(),
  error: vi.fn(),
  warning: vi.fn()
}))

vi.mock('#~/api', () => ({
  branchSessionFromMessage: vi.fn(),
  createQueuedMessage: vi.fn(),
  createSession: mocks.createSession,
  deleteQueuedMessage: vi.fn(),
  deleteSession: mocks.deleteSession,
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  getConfig: vi.fn(),
  getSessionMessages: mocks.getSessionMessages,
  moveQueuedMessage: vi.fn(),
  reorderQueuedMessages: vi.fn(),
  sendSessionMessage: vi.fn(),
  terminateSession: mocks.terminateSession,
  updateQueuedMessage: vi.fn(),
  updateSession: mocks.updateSession
}))

vi.mock('jotai', () => ({
  atom: (value: unknown) => ({ value }),
  useAtomValue: () => mocks.optimisticCreations,
  useSetAtom: () => mocks.setOptimisticCreations
}))

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ search: '' }),
  useNavigate: () => mocks.navigate
}))

vi.mock('swr', () => ({
  default: () => ({ data: undefined }),
  useSWRConfig: () => ({ mutate: mocks.mutate })
}))

vi.mock('#~/connectionManager.js', () => ({
  connectionManager: {
    close: vi.fn(),
    connect: vi.fn(() => vi.fn()),
    send: vi.fn()
  }
}))

vi.mock('#~/ws.js', () => ({
  createSocket: vi.fn()
}))

vi.mock('#~/hooks/use-sender-header-query-state.js', () => ({
  useSenderHeaderQueryState: () => ({
    isHeaderCollapsed: false,
    setHeaderCollapsed: mocks.setHeaderCollapsed
  })
}))

vi.mock('@oneworks/components/route-layout', () => ({
  ShortcutDisplay: () => <span />,
  ShortcutTooltip: ({ children }: React.PropsWithChildren) => <>{children}</>
}))

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        error: mocks.error,
        open: vi.fn(),
        success: vi.fn(),
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

vi.mock('#~/components/chat/sender/@components/sender-composer-input/SenderComposerInput', async () => {
  const { PermissionModeCreationEditorBoundary } = await import(
    './permission-mode-creation-editor-boundary'
  )

  return {
    SenderComposerInput: PermissionModeCreationEditorBoundary
  }
})

vi.mock('#~/components/chat/sender/@hooks/use-sender-voice-input', () => ({
  useSenderVoiceInput: () => undefined
}))

vi.mock('#~/components/workspace/ContextFilePicker', () => ({
  ContextFilePicker: () => null
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
    storage,
    render: async (next: React.ReactElement) => {
      await act(async () => root.render(next))
    },
    unmount: async () => {
      await act(async () => root.unmount())
    }
  }
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

const findPermissionMode = (
  root: Parameters<typeof findReactHostElement>[0],
  mode: string
) => {
  return findReactHostElement(
    root,
    element =>
      element.getAttribute('class')?.includes(
        `sender-permission-menu__item--${mode}`
      ) === true
  )
}

const findSend = (root: Parameters<typeof findReactHostElement>[0]) => {
  return findReactHostElement(
    root,
    element => element.getAttribute('class')?.split(/\s+/).includes('chat-send-btn') === true
  )
}

const sessionFixture = (id: string): Session => ({
  id,
  createdAt: 1,
  status: 'completed',
  title: id
})

const getAcknowledgementKeys = (storage: MemoryStorage) => {
  return [...storage.values.keys()].filter(
    key => key.startsWith('oneworks_chat_acknowledged_high_risk_permission_modes:')
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.optimisticCreations = {}
  mocks.setOptimisticCreations.mockImplementation((
    update: (current: Record<string, unknown>) => Record<string, unknown>
  ) => {
    mocks.optimisticCreations = update(mocks.optimisticCreations)
  })
  mocks.confirm.mockImplementation(() => ({ destroy: mocks.destroyModal }))
  mocks.deleteSession.mockResolvedValue(undefined)
  mocks.mutate.mockResolvedValue(undefined)
  mocks.terminateSession.mockResolvedValue(undefined)
  mocks.updateSession.mockResolvedValue(undefined)
})

describe('permission acknowledgement create provenance', () => {
  it('retires in-flight create provenance when the mounted owner changes', async () => {
    const created = createDeferred<{ session: Session }>()
    mocks.createSession.mockReturnValueOnce(created.promise)
    const renderHarness = (workspaceFolder: string) => (
      <PermissionModeCreationHarness
        draftIdentity='same-create-draft'
        workspaceFolder={workspaceFolder}
      />
    )
    const mounted = await mountReact(renderHarness('/workspace/a'))
    await mounted.act(async () => findPermissionMode(mounted.container, 'bypassPermissions')?.click())
    await mounted.act(async () => latestModal()?.onOk?.())
    await mounted.act(async () => latestModal()?.afterClose?.())
    await mounted.act(async () => findByTestId(mounted.container, 'fill-creation-editor')?.click())
    await mounted.act(async () => findSend(mounted.container)?.click())
    const createdId = (
      mocks.createSession.mock.calls[0]?.[4] as { id: string }
    ).id

    await mounted.render(renderHarness('/workspace/b'))
    await mounted.act(async () =>
      created.resolve({
        session: sessionFixture(createdId)
      })
    )
    await vi.waitFor(() =>
      expect(
        findByTestId(mounted.container, 'creation-permission-state')
          ?.getAttribute('data-session-status')
      ).toBe('running')
    )
    expect(getAcknowledgementKeys(mounted.storage)).toEqual([])
    await mounted.unmount()
  })

  it('transfers through the real Sender/create/storage chain only on direct create success', async () => {
    mocks.createSession.mockImplementationOnce((
      _title: string,
      _message: string,
      _content: unknown,
      _model: string,
      options: { id: string }
    ) => Promise.resolve({ session: sessionFixture(options.id) }))
    const mounted = await mountReact(
      <PermissionModeCreationHarness
        draftIdentity='workspace-a:draft-a'
        workspaceFolder='/workspace/a'
      />
    )
    await mounted.act(async () =>
      findPermissionMode(
        mounted.container,
        'bypassPermissions'
      )?.click()
    )
    await mounted.act(async () => latestModal()?.onOk?.())
    await mounted.act(async () => latestModal()?.afterClose?.())
    expect(getAcknowledgementKeys(mounted.storage)).toHaveLength(0)

    await mounted.act(async () =>
      findByTestId(
        mounted.container,
        'fill-creation-editor'
      )?.click()
    )
    await mounted.act(async () => findSend(mounted.container)?.click())
    await vi.waitFor(() => expect(mocks.createSession).toHaveBeenCalledOnce())
    const createdId = (
      mocks.createSession.mock.calls[0]?.[4] as { id: string }
    ).id
    const createdScope = buildPermissionModeSessionAcknowledgementScope({
      ownerIdentity: deriveCanonicalPermissionModeOwner({
        workspaceFolder: '/workspace/a'
      }),
      session: { createdAt: 1, id: createdId }
    })!
    await vi.waitFor(() => {
      expect(getAcknowledgementKeys(mounted.storage)).toEqual([
        `oneworks_chat_acknowledged_high_risk_permission_modes:${encodeURIComponent(createdScope.storageScopeId)}`
      ])
    })
    await mounted.unmount()

    mocks.confirm.mockClear()
    const createdSession = await mountReact(
      <PermissionModeCreationHarness
        draftIdentity='ignored'
        workspaceFolder='/workspace/a'
        session={sessionFixture(createdId)}
      />,
      mounted.storage
    )
    await createdSession.act(async () =>
      findPermissionMode(
        createdSession.container,
        'bypassPermissions'
      )?.click()
    )
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.updateSession).toHaveBeenCalledWith(createdId, {
      permissionMode: 'bypassPermissions'
    })
    await createdSession.unmount()
  })

  it('destroys provenance before response-loss recovery or an ID collision can reuse it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let collidedId = ''
    mocks.createSession.mockImplementationOnce((
      _title: string,
      _message: string,
      _content: unknown,
      _model: string,
      options: { id: string }
    ) => {
      collidedId = options.id
      return Promise.reject(new Error('response lost or collision'))
    })
    mocks.getSessionMessages.mockImplementationOnce((id: string) => (
      Promise.resolve({ session: sessionFixture(id) })
    ))
    const mounted = await mountReact(
      <PermissionModeCreationHarness draftIdentity='workspace-b:draft-b' />
    )
    await mounted.act(async () =>
      findPermissionMode(
        mounted.container,
        'bypassPermissions'
      )?.click()
    )
    await mounted.act(async () => latestModal()?.onOk?.())
    await mounted.act(async () => latestModal()?.afterClose?.())
    await mounted.act(async () =>
      findByTestId(
        mounted.container,
        'fill-creation-editor'
      )?.click()
    )
    await mounted.act(async () => findSend(mounted.container)?.click())
    await vi.waitFor(() =>
      expect(mocks.getSessionMessages).toHaveBeenCalledWith(
        collidedId,
        { limit: 20 }
      )
    )
    expect(
      getAcknowledgementKeys(mounted.storage).some(
        key => key.includes(encodeURIComponent(`session:${collidedId}`))
      )
    ).toBe(false)
    await mounted.unmount()

    mocks.confirm.mockClear()
    const recovered = await mountReact(
      <PermissionModeCreationHarness
        draftIdentity='direct-navigation'
        session={sessionFixture(collidedId)}
      />,
      mounted.storage
    )
    await recovered.act(async () =>
      findPermissionMode(
        recovered.container,
        'bypassPermissions'
      )?.click()
    )
    expect(mocks.confirm).toHaveBeenCalledOnce()
    await recovered.unmount()
    consoleError.mockRestore()
  })

  it('destroys provenance when the actual optimistic creation is discarded', async () => {
    let resolveCreate: ((value: { session: Session }) => void) | undefined
    let optimisticId = ''
    mocks.createSession.mockImplementationOnce((
      _title: string,
      _message: string,
      _content: unknown,
      _model: string,
      options: { id: string }
    ) => {
      optimisticId = options.id
      return new Promise<{ session: Session }>((resolve) => {
        resolveCreate = resolve
      })
    })
    const mounted = await mountReact(
      <PermissionModeCreationHarness draftIdentity='workspace-c:draft-c' />
    )
    await mounted.act(async () =>
      findPermissionMode(
        mounted.container,
        'bypassPermissions'
      )?.click()
    )
    await mounted.act(async () => latestModal()?.onOk?.())
    await mounted.act(async () => latestModal()?.afterClose?.())
    await mounted.act(async () =>
      findByTestId(
        mounted.container,
        'fill-creation-editor'
      )?.click()
    )
    await mounted.act(async () => findSend(mounted.container)?.click())
    await vi.waitFor(() =>
      expect(
        findByTestId(
          mounted.container,
          'creation-editor-value'
        )?.textContent
      ).toBe('')
    )
    expect(
      findByTestId(
        mounted.container,
        'creation-permission-state'
      )?.getAttribute('data-session-status')
    ).toBe('running')
    expect(
      findByTestId(
        mounted.container,
        'creation-permission-state'
      )?.getAttribute('data-is-thinking')
    ).toBe('true')
    expect(findSend(mounted.container)?.getAttribute('class')).toContain('stop')
    const stop = await vi.waitFor(() => {
      const element = findReactHostElement(
        mounted.container,
        candidate => candidate.getAttribute('class')?.split(/\s+/).includes('stop') === true
      )
      expect(element).toBeDefined()
      return element
    })
    await mounted.act(async () => stop?.click())
    await mounted.act(async () =>
      resolveCreate?.({
        session: sessionFixture(optimisticId)
      })
    )
    await vi.waitFor(() =>
      expect(mocks.deleteSession).toHaveBeenCalledWith(
        optimisticId,
        { force: true }
      )
    )
    expect(
      getAcknowledgementKeys(mounted.storage).some(
        key => key.includes(encodeURIComponent(`session:${optimisticId}`))
      )
    ).toBe(false)
    await mounted.unmount()

    mocks.confirm.mockClear()
    const discardedNavigation = await mountReact(
      <PermissionModeCreationHarness
        draftIdentity='discarded-navigation'
        session={sessionFixture(optimisticId)}
      />,
      mounted.storage
    )
    await discardedNavigation.act(async () =>
      findPermissionMode(
        discardedNavigation.container,
        'bypassPermissions'
      )?.click()
    )
    expect(mocks.confirm).toHaveBeenCalledOnce()
    await discardedNavigation.unmount()
  })

  it('does not transfer acknowledgement after create and recovery both fail', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let failedId = ''
    mocks.createSession.mockImplementationOnce((
      _title: string,
      _message: string,
      _content: unknown,
      _model: string,
      options: { id: string }
    ) => {
      failedId = options.id
      return Promise.reject(new Error('create failed'))
    })
    mocks.getSessionMessages.mockRejectedValueOnce(new Error('no created session'))
    const mounted = await mountReact(
      <PermissionModeCreationHarness draftIdentity='workspace-d:draft-d' />
    )
    await mounted.act(async () =>
      findPermissionMode(
        mounted.container,
        'bypassPermissions'
      )?.click()
    )
    await mounted.act(async () => latestModal()?.onOk?.())
    await mounted.act(async () => latestModal()?.afterClose?.())
    await mounted.act(async () =>
      findByTestId(
        mounted.container,
        'fill-creation-editor'
      )?.click()
    )
    await mounted.act(async () => findSend(mounted.container)?.click())
    await vi.waitFor(() =>
      expect(mocks.getSessionMessages).toHaveBeenCalledWith(
        failedId,
        { limit: 20 }
      )
    )
    expect(
      getAcknowledgementKeys(mounted.storage).some(
        key => key.includes(encodeURIComponent(`session:${failedId}`))
      )
    ).toBe(false)
    await mounted.unmount()

    mocks.confirm.mockClear()
    const directNavigation = await mountReact(
      <PermissionModeCreationHarness
        draftIdentity='failed-direct-navigation'
        session={sessionFixture(failedId)}
      />,
      mounted.storage
    )
    await directNavigation.act(async () =>
      findPermissionMode(
        directNavigation.container,
        'bypassPermissions'
      )?.click()
    )
    expect(mocks.confirm).toHaveBeenCalledOnce()
    await directNavigation.unmount()
    consoleError.mockRestore()
    consoleWarn.mockRestore()
  })
})
