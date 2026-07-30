/* eslint-disable max-lines -- authentic ChatHistory/Sender/create composition keeps fixtures and assertions together. */

import * as React from 'react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage, Session } from '@oneworks/core'
import type { ConfigResponse, ConversationStarterConfig, EffortLevel } from '@oneworks/types'

import { ChatHistoryView } from '#~/components/chat/ChatHistoryView'
import { createDraftPermissionModeIncarnation } from '#~/hooks/chat/permission-mode-acknowledgement'
import { deriveCanonicalPermissionModeOwner } from '#~/hooks/chat/permission-mode-owner'
import { useChatAdapterAccountSelection } from '#~/hooks/chat/use-chat-adapter-account-selection'
import { useChatEffort } from '#~/hooks/chat/use-chat-effort'
import { useChatModelAdapterSelection } from '#~/hooks/chat/use-chat-model-adapter-selection'
import type { PermissionModeRequestHandler } from '#~/hooks/chat/use-chat-permission-mode'
import { useChatPermissionMode } from '#~/hooks/chat/use-chat-permission-mode'
import { useDraftPermissionModeLifecycle } from '#~/hooks/chat/use-draft-permission-mode-lifecycle'
import type { PermissionModeTransitionTerminalOutcome } from '#~/hooks/chat/use-session-permission-mode-change'

import {
  MemoryStorage,
  createDeferred,
  dispatchReactHostEvent,
  findReactHostElement,
  installReactMountedTestHost
} from './react-mounted-test-host'

const config = {
  meta: { workspaceFolder: '/workspace/authentic-composer' },
  sources: {
    merged: {
      adapterBuiltinModels: {
        codex: [{
          label: 'Model A',
          supportedEfforts: ['low', 'high'],
          value: 'model-a'
        }],
        'claude-code': [{
          label: 'Model B',
          supportedEfforts: ['low', 'high'],
          value: 'model-b'
        }]
      },
      adapters: {
        codex: { effort: 'high' },
        'claude-code': { effort: 'low' }
      },
      general: {
        defaultAdapter: 'codex',
        defaultModel: 'model-a'
      }
    },
    user: {}
  }
} as unknown as ConfigResponse

const mocks = vi.hoisted(() => ({
  accountCatalogs: new Map<string, {
    data?: {
      accounts: Array<{ key: string; status: string; title: string }>
      defaultAccount?: string
    }
    error?: Error
    pending: boolean
  }>(),
  baseModelChange: vi.fn(),
  createQueuedMessage: vi.fn(),
  createSession: vi.fn(),
  confirm: vi.fn(),
  destroyConfirmation: vi.fn(),
  error: vi.fn(),
  mutate: vi.fn(),
  navigate: vi.fn(),
  resolver: vi.fn(),
  updateSession: vi.fn()
}))

vi.mock('#~/api', () => ({
  branchSessionFromMessage: vi.fn(),
  createQueuedMessage: mocks.createQueuedMessage,
  createSession: mocks.createSession,
  deleteQueuedMessage: vi.fn(),
  deleteSession: vi.fn(),
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  getConfig: vi.fn(async () => config),
  getSessionMessages: vi.fn(),
  moveQueuedMessage: vi.fn(),
  openSessionWorkspaceFileInExternalOpener: vi.fn(),
  openWorkspaceFileInExternalOpener: vi.fn(),
  readSessionWorkspaceFile: vi.fn(),
  readWorkspaceFile: vi.fn(),
  reorderQueuedMessages: vi.fn(),
  sendSessionMessage: vi.fn(),
  terminateSession: vi.fn(),
  updateConfig: vi.fn(),
  updateQueuedMessage: vi.fn(),
  updateSession: mocks.updateSession
}))

vi.mock('@monaco-editor/react', () => ({
  default: () => null,
  loader: { config: vi.fn() }
}))

vi.mock('monaco-editor', () => ({
  editor: {}
}))

vi.mock('#~/components/monaco/use-monaco-theme', () => ({
  useMonacoTheme: () => 'vs'
}))

vi.mock('swr', () => ({
  default: () => ({ data: config, mutate: mocks.mutate }),
  useSWRConfig: () => ({ mutate: mocks.mutate })
}))

vi.mock('react-router-dom', () => ({
  useLocation: () => ({
    hash: '',
    key: 'authentic-draft',
    pathname: '/',
    search: ''
  }),
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams(), vi.fn()]
}))

vi.mock('jotai', () => ({
  atom: (value: unknown) => ({ value }),
  useAtom: (state: { value: unknown }) => [state.value, vi.fn()],
  useAtomValue: (state: { value: unknown }) => state.value,
  useSetAtom: () => vi.fn()
}))

vi.mock('#~/store/index.js', () => ({
  showAnnouncementsAtom: { value: true },
  showNewSessionStarterListAtom: { value: true }
}))

vi.mock('#~/hooks/use-sender-header-query-state.js', () => ({
  useSenderHeaderQueryState: () => ({
    isHeaderCollapsed: false,
    setHeaderCollapsed: vi.fn()
  })
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

vi.mock('@oneworks/components/route-layout', () => ({
  ShortcutDisplay: () => <span />,
  ShortcutTooltip: ({ children }: React.PropsWithChildren) => <>{children}</>
}))

vi.mock('antd', async () => {
  const ReactModule = await import('react')
  const Select = ReactModule.forwardRef((props: {
    className?: string
    controlTrigger?: { ariaLabel?: string }
    disabled?: boolean
    onChange?: (value: string) => void
    options?: Array<{ label?: React.ReactNode; value: string }>
    value?: string
  }, _ref) => (
    <div className={props.className} data-value={props.value}>
      <button type='button' aria-label={props.controlTrigger?.ariaLabel} disabled={props.disabled}>
        {props.value}
      </button>
      {props.options?.map(option => (
        <div
          role='option'
          tabIndex={0}
          key={option.value}
          aria-disabled={props.disabled}
          data-select-owner={props.className}
          data-select-value={option.value}
          onClick={() => {
            if (props.disabled !== true) props.onChange?.(option.value)
          }}
        >
          {option.label ?? option.value}
        </div>
      ))}
    </div>
  ))
  return {
    App: {
      useApp: () => ({
        message: {
          error: mocks.error,
          open: vi.fn(),
          success: vi.fn(),
          warning: vi.fn()
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
    Drawer: ({ children, open }: React.PropsWithChildren<{ open?: boolean }>) => open ? <>{children}</> : null,
    Modal: ({ children, open }: React.PropsWithChildren<{ open?: boolean }>) => open ? <>{children}</> : null,
    Select,
    Spin: () => <span>loading</span>,
    Tag: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
    Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string) => key
  })
}))

vi.mock('#~/i18n', () => ({
  default: {
    language: 'en',
    off: vi.fn(),
    on: vi.fn(),
    resolvedLanguage: 'en',
    t: (key: string) => key
  }
}))

vi.mock('#~/hooks/use-responsive-layout', () => ({
  useResponsiveLayout: () => ({
    isCompactLayout: false,
    isTouchInteraction: false
  })
}))

vi.mock('#~/hooks/use-resolved-theme-mode', () => ({
  useResolvedThemeMode: () => ({ resolvedThemeMode: 'light' })
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

vi.mock('#~/components/chat/git-controls/ChatGitControls', () => ({
  ChatGitControls: () => null
}))

vi.mock('#~/components/chat/git-controls/DraftGitControls', () => ({
  DraftGitControls: () => null
}))

vi.mock('#~/hooks/use-adapter-accounts-with-quota', () => ({
  useAdapterAccountsWithQuotaState: ({ adapter, model }: { adapter?: string; model?: string }) =>
    mocks.accountCatalogs.get(`${adapter ?? ''}\u0000${model ?? ''}`) ?? {
      data: undefined,
      error: undefined,
      pending: adapter != null
    }
}))

vi.mock('#~/components/MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => <span>{content}</span>
}))

const empty = () => undefined

const starterFixtures = [
  {
    adapter: 'claude-code',
    permissionMode: 'default',
    prompt: 'adapter only prompt',
    title: 'Adapter only'
  },
  {
    account: 'starter-account',
    adapter: 'claude-code',
    permissionMode: 'default',
    prompt: 'adapter account prompt',
    title: 'Adapter and account'
  },
  {
    adapter: 'claude-code',
    effort: 'low',
    permissionMode: 'default',
    prompt: 'explicit effort prompt',
    title: 'Explicit effort'
  },
  {
    model: 'model-b',
    permissionMode: 'default',
    prompt: 'model only prompt',
    title: 'Model only'
  },
  {
    account: 'starter-account',
    adapter: 'claude-code',
    model: 'model-b',
    permissionMode: 'default',
    prompt: 'explicit adapter model prompt',
    title: 'Explicit adapter model'
  },
  {
    model: 'missing-model',
    permissionMode: 'default',
    prompt: 'missing model prompt',
    title: 'Unavailable model'
  },
  {
    account: 'starter-account',
    adapter: 'claude-code',
    permissionMode: 'bypassPermissions',
    prompt: 'high risk account prompt',
    title: 'High risk account'
  }
] satisfies ConversationStarterConfig[]

function AuthenticChatHistoryHarness({
  invalidateCatalogAfterPermissionSelection,
  permissionCancelError,
  permissionCancelGate
}: {
  invalidateCatalogAfterPermissionSelection?: boolean
  permissionCancelError?: Error
  permissionCancelGate?: Promise<void>
}) {
  const [catalogRevision, setCatalogRevision] = useState(0)
  const modelSelection = useChatModelAdapterSelection()
  const effortSelection = useChatEffort({
    adapter: modelSelection.selectedAdapter,
    model: modelSelection.selectedModelWithService
  })
  const ownerIdentity = deriveCanonicalPermissionModeOwner({
    workspaceFolder: config.meta?.workspaceFolder
  })
  const incarnation = useMemo(createDraftPermissionModeIncarnation, [])
  const lifecycle = useDraftPermissionModeLifecycle({ incarnation, ownerIdentity })
  const permission = useChatPermissionMode({
    draftIdentity: 'authentic-chat-history',
    draftLifecycle: lifecycle,
    ownerIdentity
  })
  const accountSelection = useChatAdapterAccountSelection({
    adapter: modelSelection.selectedAdapter,
    model: modelSelection.selectedModelWithService
  })
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [createdSession, setCreatedSession] = useState<Session>()
  const catalogCommitRef = useRef<(() => void)>()
  useLayoutEffect(() => {
    const resolveCatalogCommit = catalogCommitRef.current
    catalogCommitRef.current = undefined
    resolveCatalogCommit?.()
  }, [catalogRevision])
  const requestPermissionModeChange: PermissionModeRequestHandler = useCallback((mode, options) => {
    const selection = permission.setPermissionMode(mode, options)
    if (
      !invalidateCatalogAfterPermissionSelection &&
      permissionCancelError == null && permissionCancelGate == null
    ) return selection
    return {
      ...selection,
      cancel: async (): Promise<PermissionModeTransitionTerminalOutcome> => {
        await permissionCancelGate
        const outcome = await selection.cancel?.() ?? 'not-selected'
        if (permissionCancelError != null) throw permissionCancelError
        return outcome
      },
      completion: selection.completion.then(async (selected) => {
        if (!selected) return false
        if (invalidateCatalogAfterPermissionSelection) {
          mocks.accountCatalogs.set('claude-code\u0000model-b', {
            data: {
              accounts: [
                { key: 'claude-default', status: 'ready', title: 'Claude default' }
              ],
              defaultAccount: 'claude-default'
            },
            pending: false
          })
          await new Promise<void>((resolve) => {
            catalogCommitRef.current = resolve
            setCatalogRevision(value => value + 1)
          })
        }
        return true
      })
    }
  }, [
    invalidateCatalogAfterPermissionSelection,
    permission.setPermissionMode,
    permissionCancelError,
    permissionCancelGate
  ])

  return (
    <>
      <button
        data-testid='refresh-account-catalog'
        onClick={() => setCatalogRevision(value => value + 1)}
      >
        refresh account catalog
      </button>
      <output data-testid='permission-mode-state' data-mode={permission.permissionMode} />
      <ChatHistoryView
        isReady
        messages={messages}
        session={createdSession}
        sessions={createdSession == null ? [] : [createdSession]}
        sessionInfo={null}
        historyStatusNotices={[]}
        queuedMessages={{ next: [], steer: [] }}
        onRetryConnection={empty}
        interactionRequest={null}
        onInteractionResponse={empty}
        setMessages={setMessages}
        onClearMessages={() => setMessages([])}
        newSessionGuide={{
          builtinActions: [...starterFixtures]
        }}
        modelMenuGroups={modelSelection.modelMenuGroups}
        builtinPreviewModelOptions={modelSelection.builtinPreviewModelOptions}
        modelSearchOptions={modelSelection.modelSearchOptions}
        recommendedModelOptions={modelSelection.recommendedModelOptions}
        servicePreviewModelOptions={modelSelection.servicePreviewModelOptions}
        onToggleRecommendedModel={modelSelection.toggleRecommendedModel}
        updatingRecommendedModelValue={modelSelection.updatingRecommendedModelValue}
        selectedModel={modelSelection.selectedModel}
        modelForQuery={modelSelection.selectedModelWithService}
        resolveModelAdapterSelectionTransition={(current, transition) => {
          const result = modelSelection.resolveUserSelectionTransition(current, transition)
          mocks.resolver(current, transition, result)
          return result
        }}
        onModelChange={(model) => {
          mocks.baseModelChange(model)
          modelSelection.setSelectedModel(model)
        }}
        effortSelection={effortSelection.effortSelection}
        effortOptions={effortSelection.effortOptions}
        resolveEffortSelectionForSelection={effortSelection.resolveEffortSelectionForSelection}
        resolveEffortOptionsForSelection={effortSelection.resolveEffortOptionsForSelection}
        onEffortChange={effortSelection.setEffort}
        completePermissionModeDraftSessionCreation={permission.completePermissionModeDraftSessionCreation}
        createPermissionModeDraftCreationToken={permission.createPermissionModeDraftCreationToken}
        discardPermissionModeDraftSessionCreation={permission.discardPermissionModeDraftSessionCreation}
        permissionMode={permission.permissionMode}
        permissionModeTransitionPending={permission.permissionModeTransitionPending}
        permissionModeOptions={permission.permissionModeOptions}
        onPermissionModeChange={requestPermissionModeChange}
        selectedAdapter={modelSelection.selectedAdapter}
        adapterOptions={modelSelection.adapterOptions}
        hiddenBuiltinAdapterOptions={modelSelection.hiddenBuiltinAdapterOptions}
        onAdapterChange={modelSelection.setSelectedAdapter}
        selectedAccount={accountSelection.selectedAccount}
        accountOptions={accountSelection.accountOptions}
        showAccountSelector={accountSelection.showAccountSelector}
        onAccountChange={accountSelection.setSelectedAccount}
        modelUnavailable={false}
        hasAvailableModels
        navigateOnCreate={false}
        onSessionCreated={setCreatedSession}
        workspaceSourceSessionId={undefined}
      />
    </>
  )
}

const mount = async ({
  invalidateCatalogAfterPermissionSelection,
  permissionCancelError,
  permissionCancelGate,
  storedEffort
}: {
  invalidateCatalogAfterPermissionSelection?: boolean
  permissionCancelError?: Error
  permissionCancelGate?: Promise<void>
  storedEffort?: string
} = {}) => {
  const host = installReactMountedTestHost()
  const storage = new MemoryStorage()
  if (storedEffort != null) {
    storage.setItem('oneworks_chat_effort', storedEffort)
  }
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: storage
  })
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  const root = createRoot(host.container as unknown as Element)
  await act(async () =>
    root.render(
      <AuthenticChatHistoryHarness
        invalidateCatalogAfterPermissionSelection={invalidateCatalogAfterPermissionSelection}
        permissionCancelError={permissionCancelError}
        permissionCancelGate={permissionCancelGate}
      />
    )
  )
  return {
    act,
    container: host.container,
    storage,
    unmount: async () => {
      await act(async () => root.unmount())
    }
  }
}

const findBy = (
  root: Parameters<typeof findReactHostElement>[0],
  predicate: Parameters<typeof findReactHostElement>[1]
) => findReactHostElement(root, predicate)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.accountCatalogs.clear()
  mocks.accountCatalogs.set('codex\u0000model-a', {
    data: {
      accounts: [
        { key: 'codex-default', status: 'ready', title: 'Codex default' }
      ],
      defaultAccount: 'codex-default'
    },
    pending: false
  })
  mocks.accountCatalogs.set('claude-code\u0000model-b', {
    data: {
      accounts: [
        { key: 'claude-default', status: 'ready', title: 'Claude default' },
        { key: 'starter-account', status: 'ready', title: 'Starter account' }
      ],
      defaultAccount: 'claude-default'
    },
    pending: false
  })
  mocks.createQueuedMessage.mockResolvedValue({
    queuedMessages: { next: [], steer: [] }
  })
  mocks.confirm.mockImplementation(() => ({ destroy: mocks.destroyConfirmation }))
  mocks.updateSession.mockResolvedValue(undefined)
  mocks.createSession.mockImplementation((
    _title: string,
    _message: string,
    _content: unknown,
    model: string,
    options: {
      account?: string
      adapter?: string
      effort?: EffortLevel
      id: string
    }
  ) =>
    Promise.resolve({
      session: {
        account: options.account,
        adapter: options.adapter,
        createdAt: 1,
        effort: options.effort,
        id: options.id,
        model,
        permissionMode: 'default',
        status: 'running',
        title: 'Created'
      } satisfies Session
    })
  )
})

describe('authentic conversation starter composition', () => {
  const selectStarter = async (
    mounted: Awaited<ReturnType<typeof mount>>,
    title: string
  ) => {
    const findStarter = () =>
      findBy(
        mounted.container,
        element =>
          element.getAttribute('class')?.split(/\s+/).includes('interaction-list__item') === true &&
          element.textContent.includes(title)
      )
    if (findStarter() == null) {
      await mounted.act(async () =>
        findBy(
          mounted.container,
          element =>
            element.getAttribute('class')?.split(/\s+/).includes(
              'composer-starter-list__more-button'
            ) === true
        )?.click()
      )
    }
    const selectedStarter = findStarter()
    await mounted.act(async () => {
      selectedStarter?.focus()
      selectedStarter?.click()
    })
    return selectedStarter
  }

  const selectedValue = (
    mounted: Awaited<ReturnType<typeof mount>>,
    className: string
  ) =>
    findBy(
      mounted.container,
      element => element.getAttribute('class')?.split(/\s+/).includes(className) === true
    )?.getAttribute('data-value')

  const refreshAccountCatalog = async (mounted: Awaited<ReturnType<typeof mount>>) => {
    await mounted.act(async () =>
      findBy(
        mounted.container,
        element => element.getAttribute('data-testid') === 'refresh-account-catalog'
      )?.click()
    )
  }

  const sendDirectThenQueue = async (
    mounted: Awaited<ReturnType<typeof mount>>,
    expected: {
      account?: string
      adapter: string
      effort: EffortLevel
      model: string
      prompt: string
    }
  ) => {
    await mounted.act(async () =>
      findBy(
        mounted.container,
        element => element.getAttribute('class')?.split(/\s+/).includes('chat-send-btn') === true
      )?.click()
    )
    await vi.waitFor(() => expect(mocks.createSession).toHaveBeenCalledOnce())
    const directCall = mocks.createSession.mock.calls[0]
    expect(directCall?.[3]).toBe(expected.model)
    expect(directCall?.[4]).toEqual(expect.objectContaining({
      account: expected.account,
      adapter: expected.adapter,
      effort: expected.effort,
      permissionMode: 'default'
    }))
    expect(JSON.stringify(directCall?.slice(0, 3))).toContain(expected.prompt)

    await mounted.act(async () =>
      findBy(
        mounted.container,
        element => element.getAttribute('data-testid') === 'fill-creation-editor'
      )?.click()
    )
    await mounted.act(async () =>
      findBy(
        mounted.container,
        element => element.getAttribute('class')?.split(/\s+/).includes('chat-send-btn') === true
      )?.click()
    )
    await vi.waitFor(() => expect(mocks.createQueuedMessage).toHaveBeenCalledOnce())
    expect(mocks.createQueuedMessage.mock.calls[0]?.[0]).toBe(directCall?.[4]?.id)
    expect(JSON.stringify(mocks.createQueuedMessage.mock.calls[0]?.[2]))
      .toContain('create the session')
  }

  it('resolves an adapter-only starter to that adapter model, accounts, and configured effort', async () => {
    const mounted = await mount()
    await selectStarter(mounted, 'Adapter only')
    expect(selectedValue(mounted, 'model-select')).toBe('model-b')
    expect(findBy(
      mounted.container,
      element => element.getAttribute('data-stage-value') === 'low'
    )).not.toBeNull()
    expect(mounted.container.textContent).toContain('Starter account')
    expect(mounted.container.textContent).toContain('Claude default')
    expect(mounted.container.textContent).not.toContain('Codex default')
    await sendDirectThenQueue(mounted, {
      account: 'claude-default',
      adapter: 'claude-code',
      effort: 'low',
      model: 'model-b',
      prompt: 'adapter only prompt'
    })
    await mounted.unmount()
  })

  it('preserves an explicitly configured account proven compatible with the final adapter', async () => {
    const mounted = await mount()
    await selectStarter(mounted, 'Adapter and account')
    expect(selectedValue(mounted, 'model-select')).toBe('model-b')
    expect(mounted.container.textContent).toContain('Starter account')
    await sendDirectThenQueue(mounted, {
      account: 'starter-account',
      adapter: 'claude-code',
      effort: 'low',
      model: 'model-b',
      prompt: 'adapter account prompt'
    })
    await mounted.unmount()
  })

  it('preserves a stored effort when both old and configured defaults remain supported', async () => {
    const mounted = await mount({ storedEffort: 'high' })
    await selectStarter(mounted, 'Adapter only')
    expect(findBy(
      mounted.container,
      element => element.getAttribute('data-stage-value') === 'high'
    )).not.toBeNull()
    await sendDirectThenQueue(mounted, {
      account: 'claude-default',
      adapter: 'claude-code',
      effort: 'high',
      model: 'model-b',
      prompt: 'adapter only prompt'
    })
    await mounted.unmount()
  })

  it('preserves a real user effort while configured provenance follows the new default', async () => {
    const mounted = await mount()
    const effortInput = findBy(
      mounted.container,
      element => element.getAttribute('class')?.split(/\s+/).includes('stage-slider__input') === true
    )
    await mounted.act(async () => {
      if (effortInput != null) {
        dispatchReactHostEvent(effortInput, 'keydown', { key: 'ArrowLeft' })
      }
    })
    await mounted.act(async () => {
      if (effortInput != null) {
        dispatchReactHostEvent(effortInput, 'keydown', { key: 'ArrowRight' })
      }
    })
    await selectStarter(mounted, 'Adapter only')
    expect(findBy(
      mounted.container,
      element => element.getAttribute('data-stage-value') === 'high'
    )).not.toBeNull()
    await sendDirectThenQueue(mounted, {
      account: 'claude-default',
      adapter: 'claude-code',
      effort: 'high',
      model: 'model-b',
      prompt: 'adapter only prompt'
    })
    await mounted.unmount()
  })

  it('applies a configured effort through the real create and queue payloads', async () => {
    const mounted = await mount()
    await selectStarter(mounted, 'Explicit effort')
    await sendDirectThenQueue(mounted, {
      account: 'claude-default',
      adapter: 'claude-code',
      effort: 'low',
      model: 'model-b',
      prompt: 'explicit effort prompt'
    })
    await mounted.unmount()
  })

  it('resolves model-only and explicit adapter-model starters through production selection', async () => {
    const modelOnly = await mount()
    await selectStarter(modelOnly, 'Model only')
    await sendDirectThenQueue(modelOnly, {
      account: 'claude-default',
      adapter: 'claude-code',
      effort: 'low',
      model: 'model-b',
      prompt: 'model only prompt'
    })
    await modelOnly.unmount()

    vi.clearAllMocks()
    const explicit = await mount()
    await selectStarter(explicit, 'Explicit adapter model')
    await sendDirectThenQueue(explicit, {
      account: 'starter-account',
      adapter: 'claude-code',
      effort: 'low',
      model: 'model-b',
      prompt: 'explicit adapter model prompt'
    })
    await explicit.unmount()
  })

  it('fails visibly before commit when no configured model is available', async () => {
    const mounted = await mount()
    await selectStarter(mounted, 'Unavailable model')
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled())
    expect(selectedValue(mounted, 'model-select')).toBe('model-a')
    expect(mocks.createSession).not.toHaveBeenCalled()
    await mounted.unmount()
  })

  it('routes a real active-starter model edit through shared compatibility and payload owners', async () => {
    const mounted = await mount()
    await selectStarter(mounted, 'Adapter and account')
    const modelA = findBy(
      mounted.container,
      element =>
        element.getAttribute('data-select-owner')?.includes('model-select') === true &&
        element.getAttribute('data-select-value') === 'model-a'
    )
    await mounted.act(async () => modelA?.click())
    expect(mocks.baseModelChange).not.toHaveBeenCalled()
    expect(mocks.resolver).toHaveBeenLastCalledWith(
      { adapter: 'claude-code', model: 'model-b' },
      { field: 'model', value: 'model-a' },
      { adapter: 'codex', model: 'model-a' }
    )
    expect(mounted.container.textContent).toContain('Codex default')
    expect(mounted.container.textContent).not.toContain('Starter account')
    await sendDirectThenQueue(mounted, {
      account: 'codex-default',
      adapter: 'codex',
      effort: 'high',
      model: 'model-a',
      prompt: 'adapter account prompt'
    })
    await mounted.unmount()
  })

  it('keeps the real starter and Sender busy until the final account catalog validates', async () => {
    mocks.accountCatalogs.set('claude-code\u0000model-b', {
      pending: true
    })
    const mounted = await mount()
    await selectStarter(mounted, 'Adapter and account')

    const sender = findBy(
      mounted.container,
      element => element.getAttribute('class')?.split(/\s+/).includes('chat-input-wrapper') === true
    )
    const sendButton = findBy(
      mounted.container,
      element => element.getAttribute('class')?.split(/\s+/).includes('chat-send-btn') === true
    )
    expect(sender?.getAttribute('aria-busy')).toBe('true')
    expect(sendButton?.getAttribute('aria-disabled')).toBe('true')
    const pendingModelOption = findBy(
      mounted.container,
      element =>
        element.getAttribute('data-select-owner')?.includes('model-select') === true &&
        element.getAttribute('data-select-value') === 'model-a'
    )
    expect(pendingModelOption?.getAttribute('aria-disabled')).toBe('true')
    const resolverCallsBeforePendingClick = mocks.resolver.mock.calls.length
    await mounted.act(async () => pendingModelOption?.click())
    expect(mocks.resolver).toHaveBeenCalledTimes(resolverCallsBeforePendingClick)
    expect(selectedValue(mounted, 'model-select')).toBe('model-a')
    const permissionTrigger = findBy(
      mounted.container,
      element => element.getAttribute('class')?.split(/\s+/).includes('sender-permission-trigger') === true
    )
    const permissionMenuItem = findBy(
      mounted.container,
      element =>
        element.getAttribute('class')?.includes(
          'sender-permission-menu__item--bypassPermissions'
        ) === true
    )
    expect(permissionTrigger?.getAttribute('disabled')).not.toBeNull()
    expect(permissionTrigger?.getAttribute('aria-busy')).toBe('true')
    await mounted.act(async () => permissionMenuItem?.click())
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.updateSession).not.toHaveBeenCalled()
    await mounted.act(async () =>
      findBy(
        mounted.container,
        element => element.getAttribute('class')?.split(/\s+/).includes('chat-send-btn') === true
      )?.click()
    )
    expect(mocks.createSession).not.toHaveBeenCalled()

    mocks.accountCatalogs.set('claude-code\u0000model-b', {
      data: {
        accounts: [
          { key: 'claude-default', status: 'ready', title: 'Claude default' },
          { key: 'starter-account', status: 'ready', title: 'Starter account' }
        ],
        defaultAccount: 'claude-default'
      },
      pending: false
    })
    await refreshAccountCatalog(mounted)
    await vi.waitFor(() => expect(selectedValue(mounted, 'model-select')).toBe('model-b'))
    expect(sender?.getAttribute('aria-busy')).toBe('false')
    expect(mounted.container.textContent).toContain('Starter account')

    await mounted.act(async () =>
      findBy(
        mounted.container,
        element => element.getAttribute('class')?.split(/\s+/).includes('chat-send-btn') === true
      )?.click()
    )
    await vi.waitFor(() => expect(mocks.createSession).toHaveBeenCalledOnce())
    expect(mocks.createSession.mock.calls[0]?.[4]).toEqual(expect.objectContaining({
      account: 'starter-account',
      adapter: 'claude-code'
    }))
    await mounted.unmount()
  })

  it('fails an explicit account safely when the settled catalog is empty', async () => {
    mocks.accountCatalogs.set('claude-code\u0000model-b', {
      pending: true
    })
    const mounted = await mount()
    await selectStarter(mounted, 'Adapter and account')

    mocks.accountCatalogs.set('claude-code\u0000model-b', {
      data: {
        accounts: []
      },
      pending: false
    })
    await refreshAccountCatalog(mounted)
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled())

    expect(selectedValue(mounted, 'model-select')).toBe('model-a')
    expect(mocks.createSession).not.toHaveBeenCalled()
    expect(mounted.container.textContent).not.toContain('Starter account')
    await mounted.unmount()
  })

  it('settles an omitted account against an empty final catalog without inventing a payload value', async () => {
    mocks.accountCatalogs.set('claude-code\u0000model-b', {
      data: {
        accounts: []
      },
      pending: false
    })
    const mounted = await mount()
    await selectStarter(mounted, 'Adapter only')
    await vi.waitFor(() => expect(selectedValue(mounted, 'model-select')).toBe('model-b'))

    await mounted.act(async () =>
      findBy(
        mounted.container,
        element => element.getAttribute('class')?.split(/\s+/).includes('chat-send-btn') === true
      )?.click()
    )
    await vi.waitFor(() => expect(mocks.createSession).toHaveBeenCalledOnce())
    expect(mocks.createSession.mock.calls[0]?.[4]).toEqual(expect.objectContaining({
      account: undefined,
      adapter: 'claude-code'
    }))
    await mounted.unmount()
  })

  it('keeps a switched starter blocked when only the stale previous-adapter catalog settles', async () => {
    const mounted = await mount()
    await selectStarter(mounted, 'Adapter and account')
    await vi.waitFor(() => expect(selectedValue(mounted, 'model-select')).toBe('model-b'))

    mocks.accountCatalogs.set('codex\u0000model-a', {
      pending: true
    })
    const modelA = findBy(
      mounted.container,
      element =>
        element.getAttribute('data-select-owner')?.includes('model-select') === true &&
        element.getAttribute('data-select-value') === 'model-a'
    )
    await mounted.act(async () => modelA?.click())
    const busySender = findBy(
      mounted.container,
      element => element.getAttribute('class')?.split(/\s+/).includes('chat-input-wrapper') === true
    )
    expect(busySender?.getAttribute('aria-busy')).toBe('true')

    mocks.accountCatalogs.set('claude-code\u0000model-b', {
      data: {
        accounts: [
          { key: 'stale-account', status: 'ready', title: 'Stale account' }
        ],
        defaultAccount: 'stale-account'
      },
      pending: false
    })
    await refreshAccountCatalog(mounted)
    expect(busySender?.getAttribute('aria-busy')).toBe('true')
    expect(mounted.container.textContent).not.toContain('Stale account')
    expect(mocks.createSession).not.toHaveBeenCalled()

    mocks.accountCatalogs.set('codex\u0000model-a', {
      data: {
        accounts: [
          { key: 'codex-default', status: 'ready', title: 'Codex default' }
        ],
        defaultAccount: 'codex-default'
      },
      pending: false
    })
    await refreshAccountCatalog(mounted)
    await vi.waitFor(() => expect(busySender?.getAttribute('aria-busy')).toBe('false'))
    expect(mounted.container.textContent).toContain('Codex default')
    await mounted.unmount()
  })

  it('retains the exact validated starter snapshot and payload when an active edit catalog fails', async () => {
    const mounted = await mount()
    await selectStarter(mounted, 'Adapter and account')
    await vi.waitFor(() => expect(selectedValue(mounted, 'model-select')).toBe('model-b'))

    mocks.accountCatalogs.set('codex\u0000model-a', {
      pending: true
    })
    const modelA = findBy(
      mounted.container,
      element =>
        element.getAttribute('data-select-owner')?.includes('model-select') === true &&
        element.getAttribute('data-select-value') === 'model-a'
    )
    await mounted.act(async () => modelA?.click())
    expect(selectedValue(mounted, 'model-select')).toBe('model-b')
    expect(mounted.container.textContent).toContain('Starter account')
    expect(mounted.container.textContent).toContain('Claude default')

    mocks.accountCatalogs.set('codex\u0000model-a', {
      error: new Error('edited adapter catalog failed'),
      pending: false
    })
    await refreshAccountCatalog(mounted)
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled())
    expect(
      findBy(
        mounted.container,
        element => element.getAttribute('class')?.split(/\s+/).includes('chat-input-wrapper') === true
      )?.getAttribute('aria-busy')
    ).toBe('false')
    expect(selectedValue(mounted, 'model-select')).toBe('model-b')
    expect(mounted.container.textContent).toContain('Starter account')
    expect(mounted.container.textContent).toContain('Claude default')
    expect(mounted.container.textContent).not.toContain('Codex default')

    await sendDirectThenQueue(mounted, {
      account: 'starter-account',
      adapter: 'claude-code',
      effort: 'low',
      model: 'model-b',
      prompt: 'adapter account prompt'
    })
    await mounted.unmount()
  })

  it('settles a failed catalog visibly without applying the candidate bundle', async () => {
    mocks.accountCatalogs.set('claude-code\u0000model-b', {
      pending: true
    })
    const mounted = await mount()
    await selectStarter(mounted, 'Adapter and account')

    mocks.accountCatalogs.set('claude-code\u0000model-b', {
      error: new Error('catalog failed'),
      pending: false
    })
    await refreshAccountCatalog(mounted)
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled())
    expect(selectedValue(mounted, 'model-select')).toBe('model-a')
    expect(mocks.createSession).not.toHaveBeenCalled()
    await mounted.unmount()
  })

  it('validates a high-risk starter before confirmation and leaves no partial authorization on failure', async () => {
    mocks.accountCatalogs.set('claude-code\u0000model-b', {
      pending: true
    })
    const mounted = await mount()
    const recentBefore = mounted.storage.getItem('oneworks_new_session_guide_recent')
    const selectedStarter = await selectStarter(mounted, 'High risk account')

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(
      findBy(
        mounted.container,
        element => element.getAttribute('data-testid') === 'permission-mode-state'
      )?.getAttribute('data-mode')
    ).toBe('default')
    expect([...mounted.storage.values.keys()].some(key => key.includes('acknowledged_high_risk_permission_modes')))
      .toBe(false)

    mocks.accountCatalogs.set('claude-code\u0000model-b', {
      error: new Error('high-risk catalog failed'),
      pending: false
    })
    await refreshAccountCatalog(mounted)
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled())
    await vi.waitFor(() => expect(document.activeElement).toBe(selectedStarter))

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(
      findBy(
        mounted.container,
        element => element.getAttribute('data-testid') === 'permission-mode-state'
      )?.getAttribute('data-mode')
    ).toBe('default')
    expect(selectedValue(mounted, 'model-select')).toBe('model-a')
    expect(mounted.storage.getItem('oneworks_new_session_guide_recent')).toBe(recentBefore)
    expect([...mounted.storage.values.keys()].some(key => key.includes('acknowledged_high_risk_permission_modes')))
      .toBe(false)
    expect(mocks.createSession).not.toHaveBeenCalled()
    expect(mocks.createQueuedMessage).not.toHaveBeenCalled()

    mocks.accountCatalogs.set('claude-code\u0000model-b', {
      data: {
        accounts: [
          { key: 'claude-default', status: 'ready', title: 'Claude default' },
          { key: 'starter-account', status: 'ready', title: 'Starter account' }
        ],
        defaultAccount: 'claude-default'
      },
      pending: false
    })
    await selectStarter(mounted, 'High risk account')
    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    const retryConfirmation = mocks.confirm.mock.calls[0]?.[0] as {
      afterClose?: () => void
      onCancel?: () => void
    }
    await mounted.act(async () => retryConfirmation.onCancel?.())
    await mounted.act(async () => retryConfirmation.afterClose?.())
    expect(
      findBy(
        mounted.container,
        element => element.getAttribute('data-testid') === 'permission-mode-state'
      )?.getAttribute('data-mode')
    ).toBe('default')
    expect(mounted.storage.getItem('oneworks_new_session_guide_recent')).toBe(recentBefore)
    await mounted.unmount()
  })

  it('commits a validated high-risk starter and Recent only after guarded confirmation succeeds', async () => {
    const mounted = await mount()
    const recentBefore = mounted.storage.getItem('oneworks_new_session_guide_recent')
    await selectStarter(mounted, 'High risk account')
    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())

    expect(selectedValue(mounted, 'model-select')).toBe('model-a')
    expect(mounted.storage.getItem('oneworks_new_session_guide_recent')).toBe(recentBefore)
    const confirmation = mocks.confirm.mock.calls[0]?.[0] as {
      afterClose?: () => void
      onOk?: () => void | Promise<void>
    }
    await mounted.act(async () => confirmation.onOk?.())
    await mounted.act(async () => confirmation.afterClose?.())
    await vi.waitFor(() => expect(selectedValue(mounted, 'model-select')).toBe('model-b'))

    expect(
      findBy(
        mounted.container,
        element => element.getAttribute('data-testid') === 'permission-mode-state'
      )?.getAttribute('data-mode')
    ).toBe('bypassPermissions')
    expect(JSON.parse(
      mounted.storage.getItem('oneworks_new_session_guide_recent') ?? '[]'
    )).toHaveLength(1)
    await mounted.act(async () =>
      findBy(
        mounted.container,
        element => element.getAttribute('class')?.split(/\s+/).includes('chat-send-btn') === true
      )?.click()
    )
    await vi.waitFor(() => expect(mocks.createSession).toHaveBeenCalledOnce())
    expect(mocks.createSession.mock.calls[0]?.[4]).toEqual(expect.objectContaining({
      account: 'starter-account',
      adapter: 'claude-code',
      permissionMode: 'bypassPermissions'
    }))
    await mounted.unmount()
  })

  it('invalidates an open high-risk confirmation when the same catalog key changes', async () => {
    const mounted = await mount()
    const recentBefore = mounted.storage.getItem('oneworks_new_session_guide_recent')
    await selectStarter(mounted, 'High risk account')
    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    const confirmation = mocks.confirm.mock.calls[0]?.[0] as {
      afterClose?: () => void
      onOk?: () => void | Promise<void>
    }

    mocks.accountCatalogs.set('claude-code\u0000model-b', {
      data: {
        accounts: [
          { key: 'claude-default', status: 'ready', title: 'Claude default' }
        ],
        defaultAccount: 'claude-default'
      },
      pending: false
    })
    await refreshAccountCatalog(mounted)
    await vi.waitFor(() => expect(mocks.destroyConfirmation).toHaveBeenCalledOnce())
    await mounted.act(async () => confirmation.onOk?.())
    await mounted.act(async () => confirmation.afterClose?.())

    expect(
      findBy(
        mounted.container,
        element => element.getAttribute('data-testid') === 'permission-mode-state'
      )?.getAttribute('data-mode')
    ).toBe('default')
    expect(selectedValue(mounted, 'model-select')).toBe('model-a')
    expect(mounted.storage.getItem('oneworks_new_session_guide_recent')).toBe(recentBefore)
    expect([...mounted.storage.values.keys()].some(key => key.includes('acknowledged_high_risk_permission_modes')))
      .toBe(false)
    expect(mocks.updateSession).not.toHaveBeenCalled()
    expect(mocks.createSession).not.toHaveBeenCalled()
    expect(mocks.createQueuedMessage).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalled()
    await mounted.unmount()
  })

  it('compensates a completed guarded selection when final starter commit becomes stale', async () => {
    const mounted = await mount({ invalidateCatalogAfterPermissionSelection: true })
    const recentBefore = mounted.storage.getItem('oneworks_new_session_guide_recent')
    await selectStarter(mounted, 'High risk account')
    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    const confirmation = mocks.confirm.mock.calls[0]?.[0] as {
      afterClose?: () => void
      onOk?: () => void | Promise<void>
    }

    await mounted.act(async () => {
      void confirmation.onOk?.()
      await Promise.resolve()
    })
    await vi.waitFor(() =>
      expect(
        findBy(
          mounted.container,
          element => element.getAttribute('data-testid') === 'permission-mode-state'
        )?.getAttribute('data-mode')
      ).toBe('default')
    )
    await mounted.act(async () => confirmation.afterClose?.())

    expect(selectedValue(mounted, 'model-select')).toBe('model-a')
    expect(mounted.storage.getItem('oneworks_new_session_guide_recent')).toBe(recentBefore)
    expect([...mounted.storage.values.keys()].some(key => key.includes('acknowledged_high_risk_permission_modes')))
      .toBe(false)
    expect(mocks.updateSession).not.toHaveBeenCalled()
    expect(mocks.createSession).not.toHaveBeenCalled()
    expect(mocks.createQueuedMessage).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalled()
    await mounted.unmount()
  })

  it('awaits starter compensation before clearing busy state and discarding the candidate', async () => {
    const cancellation = createDeferred<void>()
    const mounted = await mount({
      invalidateCatalogAfterPermissionSelection: true,
      permissionCancelGate: cancellation.promise
    })
    const selectedStarter = await selectStarter(mounted, 'High risk account')
    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    const confirmation = mocks.confirm.mock.calls[0]?.[0] as { onOk?: () => void | Promise<void> }
    await mounted.act(async () => {
      void confirmation.onOk?.()
      await Promise.resolve()
    })
    await vi.waitFor(() =>
      expect(
        findBy(
          mounted.container,
          element => element.getAttribute('data-testid') === 'permission-mode-state'
        )?.getAttribute('data-mode')
      ).toBe('bypassPermissions')
    )
    expect(
      findBy(
        mounted.container,
        element => element.getAttribute('class')?.split(/\s+/).includes('chat-input-wrapper') === true
      )?.getAttribute('aria-busy')
    ).toBe('true')

    await mounted.act(async () => cancellation.resolve(undefined))
    await vi.waitFor(() =>
      expect(
        findBy(
          mounted.container,
          element => element.getAttribute('data-testid') === 'permission-mode-state'
        )?.getAttribute('data-mode')
      ).toBe('default')
    )
    expect(
      findBy(
        mounted.container,
        element => element.getAttribute('class')?.split(/\s+/).includes('chat-input-wrapper') === true
      )?.getAttribute('aria-busy')
    ).toBe('false')
    expect([...mounted.storage.values.keys()].some(key => key.includes('acknowledged_high_risk_permission_modes')))
      .toBe(false)
    await vi.waitFor(() => expect(document.activeElement).toBe(selectedStarter))
    expect(mocks.createSession).not.toHaveBeenCalled()
    expect(mocks.createQueuedMessage).not.toHaveBeenCalled()
    await mounted.unmount()
  })

  it('reports cancellation rejection but still restores starter cleanup and focus', async () => {
    const mounted = await mount({
      invalidateCatalogAfterPermissionSelection: true,
      permissionCancelError: new Error('compensation observer failed')
    })
    const selectedStarter = await selectStarter(mounted, 'High risk account')
    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    const confirmation = mocks.confirm.mock.calls[0]?.[0] as { onOk?: () => void | Promise<void> }
    await mounted.act(async () => {
      void confirmation.onOk?.()
      await Promise.resolve()
    })
    await vi.waitFor(() =>
      expect(
        findBy(
          mounted.container,
          element => element.getAttribute('data-testid') === 'permission-mode-state'
        )?.getAttribute('data-mode')
      ).toBe('default')
    )
    expect(
      findBy(
        mounted.container,
        element => element.getAttribute('class')?.split(/\s+/).includes('chat-input-wrapper') === true
      )?.getAttribute('aria-busy')
    ).toBe('false')
    expect([...mounted.storage.values.keys()].some(key => key.includes('acknowledged_high_risk_permission_modes')))
      .toBe(false)
    expect(mocks.error.mock.calls.length).toBeGreaterThanOrEqual(2)
    await vi.waitFor(() => expect(document.activeElement).toBe(selectedStarter))
    await mounted.unmount()
  })

  it('validates an active starter permission edit before runtime and commits it once', async () => {
    const mounted = await mount()
    await selectStarter(mounted, 'Adapter and account')
    await vi.waitFor(() => expect(selectedValue(mounted, 'model-select')).toBe('model-b'))
    const highRiskItem = () =>
      findBy(
        mounted.container,
        element =>
          element.getAttribute('class')?.includes(
            'sender-permission-menu__item--bypassPermissions'
          ) === true
      )

    mocks.accountCatalogs.set('claude-code\u0000model-b', { pending: true })
    await refreshAccountCatalog(mounted)
    await mounted.act(async () => highRiskItem()?.click())
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.updateSession).not.toHaveBeenCalled()
    expect(
      findBy(
        mounted.container,
        element => element.getAttribute('class')?.split(/\s+/).includes('sender-permission-trigger') === true
      )?.getAttribute('disabled')
    ).not.toBeNull()

    mocks.accountCatalogs.set('claude-code\u0000model-b', {
      error: new Error('active permission validation failed'),
      pending: false
    })
    await refreshAccountCatalog(mounted)
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled())
    expect(
      findBy(
        mounted.container,
        element => element.getAttribute('data-testid') === 'permission-mode-state'
      )?.getAttribute('data-mode')
    ).toBe('default')
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.updateSession).not.toHaveBeenCalled()

    mocks.accountCatalogs.set('claude-code\u0000model-b', {
      data: {
        accounts: [
          { key: 'claude-default', status: 'ready', title: 'Claude default' },
          { key: 'starter-account', status: 'ready', title: 'Starter account' }
        ],
        defaultAccount: 'claude-default'
      },
      pending: false
    })
    await refreshAccountCatalog(mounted)
    await mounted.act(async () => highRiskItem()?.click())
    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    const confirmation = mocks.confirm.mock.calls[0]?.[0] as {
      afterClose?: () => void
      onOk?: () => void | Promise<void>
    }
    await mounted.act(async () => confirmation.onOk?.())
    await mounted.act(async () => confirmation.afterClose?.())
    await vi.waitFor(() =>
      expect(
        findBy(
          mounted.container,
          element => element.getAttribute('data-testid') === 'permission-mode-state'
        )?.getAttribute('data-mode')
      ).toBe('bypassPermissions')
    )
    await mounted.act(async () =>
      findBy(
        mounted.container,
        element => element.getAttribute('class')?.split(/\s+/).includes('chat-send-btn') === true
      )?.click()
    )
    await vi.waitFor(() => expect(mocks.createSession).toHaveBeenCalledOnce())
    expect(mocks.createSession.mock.calls[0]?.[4]).toEqual(expect.objectContaining({
      account: 'starter-account',
      adapter: 'claude-code',
      permissionMode: 'bypassPermissions'
    }))
    await mounted.unmount()
  })

  it('discards an unresolved high-risk candidate on unmount without storage or runtime writes', async () => {
    mocks.accountCatalogs.set('claude-code\u0000model-b', {
      pending: true
    })
    const mounted = await mount()
    const storageBefore = [...mounted.storage.values.entries()]
    await selectStarter(mounted, 'High risk account')
    expect(mocks.confirm).not.toHaveBeenCalled()
    await mounted.unmount()

    mocks.accountCatalogs.set('claude-code\u0000model-b', {
      data: {
        accounts: [
          { key: 'starter-account', status: 'ready', title: 'Starter account' }
        ],
        defaultAccount: 'starter-account'
      },
      pending: false
    })
    expect([...mounted.storage.values.entries()]).toEqual(storageBefore)
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.createSession).not.toHaveBeenCalled()
    expect(mocks.createQueuedMessage).not.toHaveBeenCalled()
  })
})
