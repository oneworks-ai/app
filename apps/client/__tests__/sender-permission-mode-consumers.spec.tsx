import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  acknowledgeHighRiskPermissionMode,
  hasAcknowledgedHighRiskPermissionMode
} from '#~/hooks/chat/permission-mode-acknowledgement'
import type { DraftPermissionModeLifecycle } from '#~/hooks/chat/permission-mode-acknowledgement'

import { findReactHostElement, installReactMountedTestHost } from './react-mounted-test-host'

const mocks = vi.hoisted(() => ({
  configData: undefined as { meta?: { workspaceFolder?: string } } | undefined,
  confirm: vi.fn(),
  destroyModal: vi.fn(),
  routeSessionArgs: [] as Array<Record<string, unknown>>,
  updateSession: vi.fn()
}))

vi.mock('#~/api', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  getConfig: vi.fn(),
  updateSession: mocks.updateSession
}))

vi.mock('@monaco-editor/react', () => ({
  default: () => null,
  loader: { config: vi.fn() }
}))

vi.mock('monaco-editor', () => ({
  editor: {}
}))

vi.mock('swr', () => ({
  default: () => ({ data: mocks.configData })
}))

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ key: 'route-live-draft' }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()]
}))

vi.mock('#~/hooks/chat/use-chat-session', () => ({
  useChatSession: (args: Record<string, unknown>) => {
    mocks.routeSessionArgs.push(args)
    const noop = () => undefined
    return {
      accountOptions: [],
      activeView: 'history',
      adapterOptions: [],
      builtinPreviewModelOptions: [],
      completePermissionModeDraftSessionCreation: noop,
      createPermissionModeDraftCreationToken: noop,
      creationProgress: [],
      discardPermissionModeDraftSessionCreation: noop,
      effort: 'default',
      effortSelection: { effort: 'medium', source: 'fallback' },
      effortOptions: [],
      errorState: null,
      fastMode: false,
      handleInteractionResponse: noop,
      hasAvailableModels: true,
      hiddenBuiltinAdapterOptions: [],
      interactionRequest: null,
      isReady: true,
      isTerminalOpen: false,
      isTerminalPanelFolded: false,
      messages: [],
      modelForQuery: 'model-a',
      modelMenuGroups: [],
      modelSearchOptions: [],
      modelUnavailable: false,
      permissionMode: 'default',
      permissionModeOptions: [],
      permissionModeTransitionPending: false,
      queuedMessages: { next: [], steer: [] },
      recommendedModelOptions: [],
      resolveEffortSelectionForSelection: (current: unknown) => current,
      resolveEffortOptionsForSelection: () => [],
      resolveUserSelectionTransition: (current: unknown) => current,
      retryConnection: noop,
      selectedAccount: undefined,
      selectedAdapter: 'codex',
      selectedModel: 'model-a',
      servicePreviewModelOptions: [],
      sessionActivityLabel: undefined,
      sessionCompactionEvents: [],
      sessionCompactionInfo: null,
      sessionInfo: null,
      sessionWorkspaceChanges: [],
      setActiveView: noop,
      setEffort: noop,
      setFastMode: noop,
      setIsTerminalOpen: noop,
      setIsTerminalPanelFolded: noop,
      setMessages: noop,
      setPermissionMode: noop,
      setSelectedAccount: noop,
      setSelectedAdapter: noop,
      setSelectedModel: noop,
      showAccountSelector: false,
      supportsFastMode: false,
      toggleRecommendedModel: noop,
      updatingRecommendedModelValue: undefined,
      workspaceConnectionError: null
    }
  }
}))

vi.mock('#~/routes/ChatRouteShell', () => ({
  ChatRouteShell: () => <output data-testid='mounted-chat-route' />
}))

vi.mock('#~/components/chat/ChatHistoryView.js', () => ({
  ChatHistoryView: () => null
}))

vi.mock('#~/components/chat/ChatSettingsView.js', () => ({
  ChatSettingsView: () => null
}))

vi.mock('#~/components/chat/ChatTimelineView.js', () => ({
  ChatTimelineView: () => null
}))

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        error: vi.fn(),
        warning: vi.fn()
      },
      modal: { confirm: mocks.confirm }
    })
  },
  Dropdown: ({
    children,
    popupRender
  }: React.PropsWithChildren<{ popupRender?: () => React.ReactNode }>) => (
    <>
      {children}
      {popupRender?.()}
    </>
  ),
  Tooltip: ({ children }: React.PropsWithChildren<Record<string, unknown>>) => <>{children}</>
}))

vi.mock('@oneworks/components/route-layout', () => ({
  ShortcutTooltip: ({ children }: React.PropsWithChildren<Record<string, unknown>>) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
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

vi.mock('#~/hooks/chat/use-chat-model-adapter-selection', () => ({
  useChatModelAdapterSelection: () => ({
    adapterOptions: [],
    builtinPreviewModelOptions: [],
    hasAvailableModels: true,
    hiddenBuiltinAdapterOptions: [],
    modelMenuGroups: [],
    modelSearchOptions: [],
    recommendedModelOptions: [],
    selectedAdapter: 'codex',
    selectedModel: 'gpt-test',
    selectedModelWithService: 'gpt-test',
    servicePreviewModelOptions: [],
    setSelectedAdapter: vi.fn(),
    setSelectedModel: vi.fn(),
    toggleRecommendedModel: vi.fn(),
    updatingRecommendedModelValue: undefined
  })
}))

vi.mock('#~/hooks/chat/use-chat-adapter-account-selection', () => ({
  useChatAdapterAccountOptions: () => ({
    accountOptions: [],
    dataReady: true,
    resolveSelectableAccount: () => undefined,
    showAccountSelector: false
  }),
  useChatAdapterAccountSelection: () => ({
    accountOptions: [],
    selectedAccount: undefined,
    setSelectedAccount: vi.fn(),
    showAccountSelector: false
  })
}))

vi.mock('#~/hooks/chat/use-chat-effort', () => ({
  useChatEffort: () => ({
    effort: 'default',
    effortSelection: { effort: 'medium', source: 'fallback' },
    effortOptions: [],
    resolveEffortOptionsForSelection: () => [],
    resolveEffortSelectionForSelection: (current: unknown) => current,
    setEffort: vi.fn()
  })
}))

vi.mock('#~/hooks/chat/use-chat-session-actions', () => ({
  useChatSessionActions: () => ({
    interrupt: vi.fn(),
    isCreating: false,
    isStopping: false,
    send: vi.fn(),
    sendContent: vi.fn()
  })
}))

vi.mock('#~/hooks/use-responsive-layout', () => ({
  useResponsiveLayout: () => ({
    isCompactLayout: false,
    isTouchInteraction: false
  })
}))

vi.mock('#~/components/chat/sender/@components/mobile-select-drawer/SenderMobileSelectDrawer', () => ({
  SenderMobileSelectDrawer: ({ children }: React.PropsWithChildren<Record<string, unknown>>) => <>{children}</>
}))

vi.mock('#~/components/chat/sender/@components/sender-composer-input/SenderComposerInput', () => ({
  SenderComposerInput: () => <textarea data-testid='consumer-sender-editor' />
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

vi.mock('#~/components/chat/status-bar/ChatStatusBar', () => ({
  ChatStatusBar: () => null
}))

vi.mock('#~/components/monaco/use-monaco-theme', () => ({
  useMonacoTheme: () => 'vs'
}))

vi.mock('#~/components/composer-landing/ComposerLanding', () => ({
  ComposerLanding: ({ children }: React.PropsWithChildren<Record<string, unknown>>) => <>{children}</>
}))

vi.mock('#~/components/plugins/PluginCreateGuide', () => ({
  PluginCreateGuide: ({ composer }: { composer: React.ReactNode }) => <>{composer}</>
}))

vi.mock('#~/components/automation-view/AutomationEmptyGuide', () => ({
  AutomationEmptyGuide: ({ composer }: { composer: React.ReactNode }) => <>{composer}</>
}))

const mountReact = async (element: React.ReactElement) => {
  const host = installReactMountedTestHost()
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: {
      getItem: () => null,
      setItem: () => undefined
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
    unmount: async () => {
      await act(async () => root.unmount())
    }
  }
}

beforeEach(() => {
  mocks.confirm.mockReset()
  mocks.configData = undefined
  mocks.routeSessionArgs.length = 0
  mocks.destroyModal.mockReset()
  mocks.confirm.mockImplementation(() => ({ destroy: mocks.destroyModal }))
  mocks.updateSession.mockReset()
  mocks.updateSession.mockResolvedValue(undefined)
})

describe('permission mode draft consumers', () => {
  const clickDontAsk = async (
    mounted: Awaited<ReturnType<typeof mountReact>>
  ) => {
    await mounted.act(async () => {
      findReactHostElement(
        mounted.container,
        element =>
          element.getAttribute('class')?.includes(
            'sender-permission-menu__item--dontAsk'
          ) === true
      )?.click()
    })
  }
  const settleLatestConfirmation = async (
    mounted: Awaited<ReturnType<typeof mountReact>>
  ) => {
    const modal = mocks.confirm.mock.calls.at(-1)?.[0] as {
      afterClose?: () => void
      onOk?: () => Promise<void> | void
    }
    await mounted.act(async () => modal.onOk?.())
    await mounted.act(async () => modal.afterClose?.())
  }

  it('rotates plugin and automation authorization on live workspace resolution/change', async () => {
    const { PluginCreateLanding } = await import('#~/components/plugins/PluginCreateLanding')
    const plugin = await mountReact(<PluginCreateLanding />)
    await clickDontAsk(plugin)
    expect(mocks.confirm).toHaveBeenCalledOnce()
    await settleLatestConfirmation(plugin)
    mocks.configData = { meta: { workspaceFolder: '/workspace/plugin' } }
    await plugin.render(<PluginCreateLanding />)
    await clickDontAsk(plugin)
    expect(mocks.confirm).toHaveBeenCalledTimes(2)
    await plugin.unmount()

    mocks.confirm.mockClear()
    mocks.configData = { meta: { workspaceFolder: '/workspace/automation-a' } }
    const { AutomationEmptyLanding } = await import('#~/components/automation-view/AutomationEmptyLanding')
    const automation = await mountReact(<AutomationEmptyLanding />)
    await clickDontAsk(automation)
    expect(mocks.confirm).toHaveBeenCalledOnce()
    await settleLatestConfirmation(automation)
    mocks.configData = { meta: { workspaceFolder: '/workspace/automation-b' } }
    await automation.render(<AutomationEmptyLanding />)
    await clickDontAsk(automation)
    expect(mocks.confirm).toHaveBeenCalledTimes(2)
    await automation.unmount()
  })

  it('rotates the real plugin-host Sender authorization on owner change', async () => {
    mocks.configData = { meta: { workspaceFolder: '/workspace/host-a' } }
    const { renderPluginHostComponent } = await import('#~/plugins/plugin-host-components')
    const renderSender = () =>
      renderPluginHostComponent('sender', {
        hideSelectionControls: true,
        onSend: vi.fn()
      })
    const mounted = await mountReact(renderSender())
    await clickDontAsk(mounted)
    await settleLatestConfirmation(mounted)
    expect(mocks.confirm).toHaveBeenCalledOnce()

    mocks.configData = { meta: { workspaceFolder: '/workspace/host-b' } }
    await mounted.render(renderSender())
    await clickDontAsk(mounted)
    expect(mocks.confirm).toHaveBeenCalledTimes(2)
    await mounted.unmount()
  })

  it('rotates and retires the real ChatRoute draft lifecycle on live owner change', async () => {
    const { ChatRouteView } = await import('#~/routes/ChatRouteView')
    const mounted = await mountReact(
      <ChatRouteView projectWorkspaceFolder='/workspace/route-a' />
    )
    const lifecycleA = mocks.routeSessionArgs.at(-1)
      ?.draftPermissionModeLifecycle as DraftPermissionModeLifecycle
    const scopeA = { kind: 'ephemeral' as const, lifecycle: lifecycleA }
    expect(acknowledgeHighRiskPermissionMode('dontAsk', scopeA)).toBe(true)
    expect(hasAcknowledgedHighRiskPermissionMode('dontAsk', scopeA)).toBe(true)

    await mounted.render(
      <ChatRouteView projectWorkspaceFolder='/workspace/route-b' />
    )
    const lifecycleB = mocks.routeSessionArgs.at(-1)?.draftPermissionModeLifecycle
    expect(lifecycleB).not.toBe(lifecycleA)
    expect(hasAcknowledgedHighRiskPermissionMode('dontAsk', scopeA)).toBe(false)
    await mounted.unmount()
  })
})
