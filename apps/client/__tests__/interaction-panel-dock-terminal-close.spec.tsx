// @vitest-environment happy-dom
import { App as AntApp } from 'antd'
import { act, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FrozenPanelTabCloseRequest } from '#~/components/chat/interaction-panel/@components/terminal-tab-close/use-panel-tab-close-requests'
import { usePanelTabCloseRequests } from '#~/components/chat/interaction-panel/@components/terminal-tab-close/use-panel-tab-close-requests'
import { InteractionPanelContent } from '#~/components/chat/interaction-panel/InteractionPanelContent'
import { InteractionPanelDockPanelContentBody } from '#~/components/chat/interaction-panel/InteractionPanelDockPanelContent'
import { InteractionPanelDockWorkspace } from '#~/components/chat/interaction-panel/InteractionPanelDockWorkspace'
import type { InteractionPanelTab } from '#~/components/chat/interaction-panel/interaction-panel-tabs'
import { useInteractionTerminalPanes } from '#~/components/chat/interaction-panel/use-interaction-terminal-panes'

const mocks = vi.hoisted(() => ({
  dockContext: null as any,
  dockProps: null as any,
  draftConfirm: vi.fn(),
  holdDraftAfterHidden: false,
  language: 'en',
  messageApi: { destroy: vi.fn(), error: vi.fn() },
  renderActualDockContent: false,
  setContentTabs: null as any,
  setOwnerId: null as any,
  releaseDraftAfterHidden: null as (() => void) | null,
  terminalViewProps: null as any,
  terminalModalProps: null as any
}))
const t = ((key: string) => key) as any
vi.mock('react-i18next', () => ({
  initReactI18next: { init: () => undefined, type: '3rdParty' },
  useTranslation: () => ({
    i18n: { language: mocks.language, resolvedLanguage: mocks.language },
    t: (key: string, options?: { count?: number; title?: string }) => {
      if (key === 'common.cancel') return mocks.language === 'zh' ? '取消' : 'Cancel'
      if (key === 'chat.interactionPanel.closeTab') {
        return mocks.language === 'zh' ? `关闭 ${options?.title}` : `Close ${options?.title}`
      }
      return options?.count == null ? key : `${key}:${options.count}`
    }
  })
}))

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>()
  const App = Object.assign((props: any) => <actual.App {...props} />, {
    useApp: () => {
      const app = actual.App.useApp()
      return {
        ...app,
        message: mocks.messageApi,
        modal: {
          ...app.modal,
          confirm: (config: any) => {
            mocks.draftConfirm(config)
            return app.modal.confirm({
              ...config,
              maskTransitionName: '',
              transitionName: '',
              afterClose: () => {
                const finish = () => config.afterClose?.()
                if (mocks.holdDraftAfterHidden) mocks.releaseDraftAfterHidden = finish
                else finish()
              }
            })
          }
        }
      }
    }
  })
  return {
    ...actual,
    App,
    Modal: (props: any) => {
      mocks.terminalModalProps = props
      return <actual.Modal {...props} maskTransitionName='' transitionName='' />
    }
  }
})

vi.mock('#~/plugins/plugin-slots', () => ({
  usePluginCommandExecutor: () => undefined,
  usePluginSlot: () => []
}))
vi.mock('#~/components/chat/interaction-panel/interaction-panel-dock-context', () => ({
  InteractionPanelDockContext: {
    Provider: ({ children, value }: any) => {
      mocks.dockContext = value
      return children
    }
  },
  useInteractionPanelDockContext: () => mocks.dockContext
}))
vi.mock('#~/components/chat/terminal/ChatTerminalView', async () => {
  const React = await import('react')
  return {
    ChatTerminalView: (props: any) => {
      mocks.terminalViewProps = props
      return React.createElement('div', { 'data-terminal-pane-id': props.panes[0]?.id })
    }
  }
})
vi.mock('#~/components/chat/interaction-panel/use-browser-control-agent-tab-state', () => ({
  getBrowserControlAgentCursorDataUrl: () => '',
  resolveBrowserControlTabIcon: () => ({ kind: 'symbol' }),
  useBrowserControlAgentTabState: () => ({})
}))
vi.mock('#~/components/chat/interaction-panel/use-interaction-panel-mobile-debug-device-options', () => ({
  useInteractionPanelMobileDebugDeviceOptions: () => ({ deviceOptions: [], refreshDeviceOptions: vi.fn() })
}))
vi.mock('#~/components/chat/interaction-panel/use-copy-text-with-feedback', () => ({
  useCopyTextWithFeedback: () => vi.fn()
}))

vi.mock('#~/components/layout/RouteContainerPanelTabs', () => ({
  RouteContainerPanelDockWorkspace: (props: any) => {
    mocks.dockProps = props
    return (
      <div className='fake-dock'>
        {props.tabs.length === 0 ? props.defaultContent : props.tabs.map((tab: any) => (
          <div key={tab.key} data-route-container-panel-dock-tab-key={tab.key}>
            <button type='button' role='tab' aria-selected={props.activeTab === tab.key}>{tab.label}</button>
            <button
              type='button'
              className='route-container-panel-dock-tab__close'
              aria-label={props.closeLabel(tab.title ?? tab.label)}
              onClick={() => props.onTabClose(tab.key)}
            >
              Close
            </button>
            {typeof tab.content === 'function' ? tab.content({ isVisible: true }) : tab.content}
          </div>
        ))}
        {props.tabs.length === 0 && (
          <button
            ref={(element) => {
              if (element != null) element.focus = () => undefined
            }}
            type='button'
            className='route-container-panel-dock__create-action'
          />
        )}
      </div>
    )
  }
}))

vi.mock('#~/components/chat/interaction-panel/InteractionPanelDockPanelContent', async (importOriginal) => {
  const React = await import('react')
  const actual = await importOriginal<
    typeof import('#~/components/chat/interaction-panel/InteractionPanelDockPanelContent')
  >()
  return {
    InteractionPanelDockPanelContentBody: ({ tabId }: { tabId: string }) => {
      if (mocks.renderActualDockContent) {
        return React.createElement(actual.InteractionPanelDockPanelContentBody, {
          isPanelVisible: true,
          tabId
        })
      }
      React.useEffect(() => {
        const tab = mocks.dockContext.tabById[tabId]
        if (tab?.kind === 'file') {
          mocks.dockContext.onWorkspaceFileCommentDraftStateChange(tab.path, { hasContent: true, hasDraft: true })
        }
      }, [tabId])
      return null
    }
  }
})

const terminalTab = (id: string): InteractionPanelTab => ({
  canClose: true,
  icon: 'terminal',
  id,
  kind: 'terminal',
  label: id,
  shellKind: 'default',
  terminalId: id
})
const fileTab = (id: string): InteractionPanelTab => ({
  canClose: true,
  icon: 'description',
  id,
  kind: 'file',
  label: id,
  path: `${id}.ts`
})

const terminalPanes = {
  generation: 4,
  getTerminalGeneration: () => 7,
  requiresCloseConfirmation: () => true
} as any
const getActiveTab = (tabs: InteractionPanelTab[]) => {
  const tab = tabs[0]
  if (tab == null) return null
  return tab.kind === 'file' ? { kind: 'file', path: tab.path } : { kind: 'terminal', id: tab.id }
}

const baseProps = (tabs: InteractionPanelTab[], overrides: Record<string, unknown> = {}) =>
  ({
    activeTab: getActiveTab(tabs),
    bottomPanel: {},
    canCreateSessionTab: false,
    canFullscreenPanel: true,
    canPinMoreTabs: true,
    iframePages: [],
    isPanelFullscreen: false,
    isPanelMinimized: false,
    isVisible: true,
    markdownPreviewMode: 'editor',
    mobileDebugPages: [],
    pinnedTabs: [],
    projectUrlHistoryKey: 'project',
    sessionPages: [],
    sessionUrlHistoryKey: 'session',
    tabs,
    terminalPanes,
    terminalSessionId: 'terminal-session',
    workspaceDrawerState: {},
    onActivateTab: vi.fn(),
    onAddMenuClick: vi.fn(),
    onCloseWorkspaceFilePaths: vi.fn(),
    onCreateCloseRequest: vi.fn(),
    onEditPinnedTab: vi.fn(),
    onExecuteCloseRequest: vi.fn(() => ({ failedTabIds: [] })),
    onIframeMetadataChange: vi.fn(),
    onIframeNavigateHistory: vi.fn(),
    onIframePageChange: vi.fn(),
    onIframeSelectHistory: vi.fn(),
    onIframeUrlChange: vi.fn(),
    onIsCloseRequestInvalidated: () => false,
    onLocateWorkspacePath: vi.fn(),
    onMarkdownPreviewModeChange: vi.fn(),
    onMobileDebugPageChange: vi.fn(),
    onNewMobileDebugPage: vi.fn(),
    onNewSession: vi.fn(),
    onNewTerminal: vi.fn(),
    onNewWebPage: vi.fn(),
    onOpenIframeUrl: vi.fn(),
    onOpenResource: vi.fn(),
    onPanelAction: vi.fn(),
    onPanelClose: vi.fn(),
    onPanelExpand: vi.fn(),
    onPinTab: vi.fn(),
    onPluginTabStateChange: vi.fn(),
    onRunCommand: vi.fn(),
    onRequestTabClose: vi.fn(),
    onSelectWorkspaceFilePath: vi.fn(),
    onSessionPageChange: vi.fn(),
    onTogglePanelFullscreen: vi.fn(),
    onUnpinTab: vi.fn(),
    ...overrides
  }) as any

function InteractionPanelContentHarness({
  initialTabs,
  onCreateRequest = () => undefined,
  onExecuteRequest = () => ({ failedTabIds: [] }),
  requiresCloseConfirmation
}: {
  initialTabs: InteractionPanelTab[]
  onCreateRequest?: (tabs: InteractionPanelTab[], anchorTabId?: string) => unknown
  onExecuteRequest?: (request: FrozenPanelTabCloseRequest) => { failedTabIds: string[] }
  requiresCloseConfirmation: boolean
}) {
  const [currentTabs, setCurrentTabs] = useState(initialTabs)
  const [ownerId, setOwnerId] = useState('terminal-session')
  mocks.setContentTabs = setCurrentTabs
  mocks.setOwnerId = setOwnerId
  const routePanes = currentTabs.flatMap(tab =>
    tab.kind === 'terminal'
      ? [{ id: tab.terminalId, shellKind: tab.shellKind, title: tab.label }]
      : []
  )
  const managedTerminalPanes = useInteractionTerminalPanes(ownerId, t, { initialPanes: routePanes })
  const currentTerminalPanes = {
    ...managedTerminalPanes,
    requiresCloseConfirmation: () => requiresCloseConfirmation
  }
  const closeRequests = usePanelTabCloseRequests({
    ownerGeneration: managedTerminalPanes.generation,
    ownerId,
    tabs: currentTabs,
    terminalPanes: currentTerminalPanes
  })
  const executeRequest = (request: FrozenPanelTabCloseRequest) => {
    const result = onExecuteRequest(request)
    setCurrentTabs(previous =>
      previous.filter(tab =>
        !request.targets.some(target => target.tabId === tab.id) || result.failedTabIds.includes(tab.id)
      )
    )
    return result
  }

  return (
    <MemoryRouter>
      <InteractionPanelContent
        {...baseProps(currentTabs, {
          onCreateCloseRequest: (tabs: InteractionPanelTab[], anchorTabId?: string) => {
            onCreateRequest(tabs, anchorTabId)
            return closeRequests.createCloseRequest(tabs, anchorTabId)
          },
          onExecuteCloseRequest: executeRequest,
          onIsCloseRequestInvalidated: closeRequests.isCloseRequestInvalidated,
          terminalSessionId: ownerId,
          terminalPanes: currentTerminalPanes
        })}
      />
    </MemoryRouter>
  )
}

let container: HTMLDivElement
let root: Root
let animationFrames: Map<number, FrameRequestCallback>
let nextAnimationFrameId = 0

const renderWithApp = async (child: ReactNode) => {
  await act(async () => root.render(<AntApp>{child}</AntApp>))
}
const renderDock = (props: any) => renderWithApp(<InteractionPanelDockWorkspace {...props} />)
const renderContent = (props: ComponentProps<typeof InteractionPanelContentHarness>) =>
  renderWithApp(<InteractionPanelContentHarness {...props} />)

const flushAnimationFrames = async () => {
  while (animationFrames.size > 0) {
    const pendingFrames = [...animationFrames.values()]
    animationFrames.clear()
    await act(async () => pendingFrames.forEach(callback => callback(0)))
  }
}

const findTerminalConfirmButton = (count = 1) =>
  Array.from(document.querySelectorAll('button')).find(button =>
    button.textContent === `chat.interactionPanel.terminalCloseConfirmAction:${count}`
  )!
const findButton = (text: string) =>
  Array.from(document.querySelectorAll('button')).find(button => button.textContent === text)!

describe('interaction panel dock workspace terminal close boundary', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    mocks.dockContext = null
    mocks.dockProps = null
    mocks.holdDraftAfterHidden = false
    mocks.language = 'en'
    mocks.renderActualDockContent = false
    mocks.releaseDraftAfterHidden = null
    mocks.setContentTabs = null
    mocks.setOwnerId = null
    mocks.terminalViewProps = null
    mocks.terminalModalProps = null
    vi.clearAllMocks()
    animationFrames = new Map()
    nextAnimationFrameId = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const frameId = ++nextAnimationFrameId
      animationFrames.set(frameId, callback)
      return frameId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId) => {
      animationFrames.delete(frameId)
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })
  it.each([
    { action: 'cancel', expectedFocus: 1 },
    { action: 'invalidate', expectedFocus: 1 },
    { action: 'replace-owner', expectedFocus: 0 },
    { action: 'proceed', expectedFocus: 0 }
  ])('settles actual file-draft $action only after hidden', async ({ action, expectedFocus }) => {
    mocks.holdDraftAfterHidden = true
    const tabs = [fileTab('file-a'), terminalTab('term-a')]
    const execute = vi.fn((_request: FrozenPanelTabCloseRequest) => ({ failedTabIds: [] }))
    const create = vi.fn()
    await renderContent({
      initialTabs: tabs,
      onCreateRequest: create,
      onExecuteRequest: execute,
      requiresCloseConfirmation: true
    })
    const menuItems = mocks.dockProps.getTabContextMenuItems({ tab: { key: 'term-a' } })
    const closeAll = [...menuItems].reverse().find((item: any) => item !== 'separator') as any
    const close = container.querySelector<HTMLButtonElement>('[aria-label="Close term-a"]')!
    const focus = vi.spyOn(close, 'focus')
    close.focus()
    focus.mockClear()

    await act(async () => closeAll.componentProps.onSelect())
    expect(create.mock.calls[0]?.[0].map((tab: InteractionPanelTab) => tab.id)).toEqual(['file-a', 'term-a'])
    expect(mocks.draftConfirm).toHaveBeenCalledTimes(1)
    expect(mocks.draftConfirm.mock.calls[0]?.[0].focusTriggerAfterClose).toBe(false)
    expect(execute).not.toHaveBeenCalled()

    if (action === 'cancel') await act(async () => findButton('Cancel').click())
    else if (action === 'proceed') await act(async () => findButton('chat.fileComments.discardDraftOk').click())
    else {
      await act(async () =>
        mocks.setContentTabs([
          { ...fileTab('file-a'), path: 'replacement.ts' },
          terminalTab('term-a')
        ])
      )
    }
    expect(focus).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.releaseDraftAfterHidden).not.toBeNull()
    if (action === 'replace-owner') await act(async () => mocks.setOwnerId('next-session'))
    await act(async () => mocks.releaseDraftAfterHidden?.())

    if (action === 'proceed') {
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
      expect(mocks.terminalModalProps.okButtonProps).toEqual({ danger: true })
      await act(async () => findTerminalConfirmButton().click())
      expect(execute.mock.calls[0]?.[0].targets.map((target: any) => target.tabId)).toEqual(['file-a', 'term-a'])
    } else {
      await flushAnimationFrames()
      expect(focus).toHaveBeenCalledTimes(expectedFocus)
      if (expectedFocus === 1) expect(close.isConnected && document.activeElement === close).toBe(true)
    }
  })
  it.each([
    { closePath: 'passive', confirmCount: 0, tabs: [terminalTab('term-a')] },
    { closePath: 'confirmed', confirmCount: 1, tabs: [terminalTab('term-a')] },
    { closePath: 'confirmed group', confirmCount: 2, tabs: [terminalTab('term-a'), terminalTab('term-b')] }
  ])('focuses a connected production action after $closePath final transition', async ({ confirmCount, tabs }) => {
    await renderContent({
      initialTabs: tabs,
      requiresCloseConfirmation: confirmCount > 0
    })
    const closeButton = container.querySelector<HTMLButtonElement>('.route-container-panel-dock-tab__close')!
    closeButton.focus()
    if (confirmCount === 2) {
      const items = mocks.dockProps.getTabContextMenuItems({ tab: { key: 'term-a' } })
      const closeAll = [...items].reverse().find((item: any) => item !== 'separator') as any
      await act(async () => closeAll.componentProps.onSelect())
    } else await act(async () => closeButton.click())
    if (confirmCount > 0) await act(async () => findTerminalConfirmButton(confirmCount).click())
    await flushAnimationFrames()
    expect(mocks.dockProps.tabs).toHaveLength(0)
    const createAction = container.querySelector<HTMLButtonElement>('.chat-interaction-panel-empty__action')!
    expect(createAction.isConnected).toBe(true)
    expect(document.activeElement).toBe(createAction)
    expect(document.activeElement).not.toBe(document.body)
  })
  it('provides target-specific close names in English and Chinese', async () => {
    await renderDock(baseProps([terminalTab('Terminal A')]))
    expect(container.querySelector('[aria-label="Close Terminal A"]')).not.toBeNull()

    mocks.language = 'zh'
    await renderDock(baseProps([terminalTab('终端甲')]))
    expect(container.querySelector('[aria-label="关闭 终端甲"]')).not.toBeNull()
  })
  it('renders a terminal pane through tab.terminalId when the dock tab id differs', async () => {
    const runtimePane = { id: 'term-a', shellKind: 'default', title: 'Runtime terminal' }
    mocks.renderActualDockContent = true
    mocks.dockContext = {
      tabById: { 'dock-a': { ...terminalTab('dock-a'), terminalId: 'term-a' } },
      terminalPanes: {
        panes: [runtimePane],
        closeTerminal: vi.fn(),
        getTerminalGeneration: vi.fn(() => 7),
        handleExit: vi.fn(),
        handleInfoChange: vi.fn(),
        handleProcessReady: vi.fn(),
        handleProcessRestartAccepted: vi.fn(),
        handleRestartChange: vi.fn(),
        handleTerminateChange: vi.fn(),
        markInitialCommandSent: vi.fn()
      },
      terminalSessionId: 'terminal-session'
    }
    await act(async () =>
      root.render(
        <InteractionPanelDockPanelContentBody isPanelVisible tabId='dock-a' />
      )
    )

    expect(container.querySelector('[data-terminal-pane-id="term-a"]')).not.toBeNull()
    expect(mocks.terminalViewProps).toMatchObject({
      activeTerminalId: 'term-a',
      panes: [runtimePane],
      sessionId: 'terminal-session'
    })
  })
})
