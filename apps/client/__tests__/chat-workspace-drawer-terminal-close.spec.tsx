// @vitest-environment happy-dom

import { act, useCallback, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionPanelState, SessionPanelTab } from '@oneworks/core'

import {
  getPanelStateActiveTerminalId,
  getPanelStateTerminalPanes
} from '#~/components/chat/interaction-panel/interaction-panel-tabs'
import { useInteractionTerminalPanes } from '#~/components/chat/interaction-panel/use-interaction-terminal-panes'
import { ChatWorkspaceDrawer } from '#~/components/chat/workspace-drawer/ChatWorkspaceDrawer'
import { RouteContainerLayout } from '#~/components/layout/RouteContainerLayout'
import en from '#~/resources/locales/en.json'
import zh from '#~/resources/locales/zh.json'
import chatRouteShellSource from '#~/routes/ChatRouteShell.tsx?raw'

const mocks = vi.hoisted(() => ({
  dockProps: null as any,
  language: 'en',
  messageApi: { destroy: vi.fn(), error: vi.fn() },
  mobile: false,
  terminalTerminate: vi.fn(() => true),
  useActualModal: false
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { init: () => undefined, type: '3rdParty' },
  useTranslation: () => ({
    i18n: { language: mocks.language, resolvedLanguage: mocks.language },
    t: (key: string, options?: { count?: number; title?: string }) => {
      if (key === 'common.cancel') return mocks.language === 'zh' ? '取消' : 'Cancel'
      if (key === 'chat.interactionPanel.closeTab') {
        return mocks.language === 'zh' ? `关闭 ${options?.title}` : `Close ${options?.title}`
      }
      if (key === 'chat.workspaceDrawerTitle') return mocks.language === 'zh' ? '工作区' : 'Workspace'
      if (key === 'chat.workspaceDrawerToggle') {
        return mocks.language === 'zh' ? zh.chat.workspaceDrawerToggle : en.chat.workspaceDrawerToggle
      }
      if (key === 'chat.interactionPanel.searchTabs') return 'Search tabs'
      return options?.count == null ? key : `${key}:${options.count}`
    }
  })
}))

vi.mock('antd', async (importOriginal) => {
  const React = await import('react')
  const actual = await importOriginal<typeof import('antd')>()
  const FakeModal = ({
    afterClose,
    afterOpenChange,
    cancelText,
    children,
    onCancel,
    onOk,
    okText,
    open,
    title
  }: any) => {
    const wasOpen = React.useRef(false)
    React.useEffect(() => {
      if (wasOpen.current && !open) {
        afterClose?.()
        afterOpenChange?.(false)
      }
      wasOpen.current = open
    }, [afterClose, afterOpenChange, open])
    return open
      ? (
        <div role='dialog' aria-modal='true' onKeyDown={event => event.key === 'Escape' && onCancel()}>
          <h2>{title}</h2>
          {children}
          <button type='button' onClick={onCancel}>{cancelText}</button>
          <button type='button' onClick={onOk}>{okText}</button>
        </div>
      )
      : null
  }
  return {
    ...actual,
    App: { useApp: () => ({ message: mocks.messageApi }) },
    Dropdown: ({ children }: any) => children,
    Modal: (props: any) =>
      mocks.useActualModal
        ? <actual.Modal {...props} maskTransitionName='' transitionName='' />
        : <FakeModal {...props} />
  }
})

vi.mock('jotai', async importOriginal => ({
  ...(await importOriginal<typeof import('jotai')>()),
  useAtomValue: () => 8
}))
vi.mock('swr', () => ({ default: () => ({ data: undefined, isLoading: false, mutate: vi.fn() }) }))
vi.mock('#~/api', () => ({ getSessionGitState: vi.fn(), getWorkspaceGitState: vi.fn() }))
vi.mock('#~/plugins/plugin-slots', () => ({
  usePluginCommandExecutor: () => null,
  usePluginSlot: () => []
}))
vi.mock('#~/plugins/PluginHost', () => ({ PluginViewHost: () => null }))
vi.mock('#~/hooks/use-responsive-layout', () => ({
  useResponsiveLayout: () => ({ isCompactLayout: mocks.mobile, isTouchInteraction: mocks.mobile })
}))
vi.mock('#~/utils/device-shell-simulation', () => ({
  readDeviceShellSimulationMode: () => mocks.mobile ? 'mobile' : null,
  useStoredDevShellSimulation: () => null
}))
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
vi.mock('#~/components/chat/workspace-drawer/use-workspace-drawer-dock-actions', () => ({
  useWorkspaceDrawerDockActions: () => ({
    changedLayout: 'folders',
    changedTreeCommand: null,
    getActionsForView: () => [],
    handleWorkspaceTreeCommand: vi.fn(),
    treeRefreshKey: 0,
    workspaceTreeCommand: null
  })
}))

vi.mock('@oneworks/components/route-layout', () => ({
  RouteChromeHeader: ({ actions, leading, title }: any) => <header>{leading}{title}{actions}</header>,
  RouteChromeInput: ({ prefix: _prefix, ...props }: any) => <input {...props} />,
  RouteHeaderActionButton: ({ label, onClick }: any) => (
    <button type='button' aria-label={label} onClick={onClick}>{label}</button>
  )
}))
vi.mock('#~/components/icons/MaterialSymbol', () => ({ MaterialSymbol: ({ name }: any) => <span>{name}</span> }))
vi.mock('#~/components/chat/terminal/ChatTerminalView', async () => {
  const React = await import('react')
  return {
    ChatTerminalView: (props: any) => {
      const pane = props.panes[0]
      const generation = pane == null ? null : props.getTerminalGeneration(pane.id)
      React.useEffect(() => {
        if (pane == null || generation == null) return undefined
        const target = { generation, terminalId: pane.id }
        const disposeRestart = props.onRestartChange(target, () => true)
        const disposeTerminate = props.onTerminateChange(target, mocks.terminalTerminate)
        return () => {
          disposeRestart()
          disposeTerminate()
        }
      }, [generation, pane?.id, props.onRestartChange, props.onTerminateChange])
      return <div>Terminal</div>
    }
  }
})
vi.mock('#~/components/chat/workspace-file-editor/WorkspaceFileEditorView', () => ({
  WorkspaceFileEditorView: () => <div>File</div>
}))
vi.mock('#~/components/chat/workspace-drawer/WorkspaceDrawerViewPanel', () => ({
  WorkspaceDrawerViewPanel: ({ activeView }: any) => <div>{activeView}</div>
}))
vi.mock('#~/components/chat/interaction-panel/InteractionPanelIframeView', () => ({
  InteractionPanelIframeView: () => <div>Web</div>
}))
vi.mock('#~/components/chat/interaction-panel/InteractionPanelMobileDebugView', () => ({
  InteractionPanelMobileDebugView: () => <div>Mobile debug</div>
}))
vi.mock('#~/components/chat/interaction-panel/InteractionPanelPageDebuggerListView', () => ({
  InteractionPanelPageDebuggerListView: () => <div>Debugger</div>
}))
vi.mock('#~/components/chat/interaction-panel/InteractionPanelSessionView', () => ({
  InteractionPanelSessionView: () => <div>Session</div>
}))
vi.mock('#~/components/chat/interaction-panel/InteractionPanelPinnedTabEditModal', () => ({
  InteractionPanelPinnedTabEditModal: () => null
}))

vi.mock('#~/components/layout/RouteContainerPanelTabs', () => ({
  areRouteContainerPanelDockLayoutsEquivalent: () => true,
  RouteContainerPanelDockWorkspace: (props: any) => {
    mocks.dockProps = props
    const opened = props.tabs.filter((tab: any) => props.openedTabs.includes(tab.key))
    return (
      <div className='fake-right-dock'>
        {opened.length === 0 ? props.defaultContent : opened.map((tab: any) => (
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
          </div>
        ))}
      </div>
    )
  }
}))

const t = ((key: string) => key) as any
const terminalKey = (id: string) => `workspace-drawer:terminal:${encodeURIComponent(id)}`
const terminalTab = (id: string, title = id): SessionPanelTab => ({
  id: terminalKey(id),
  kind: 'terminal',
  shellKind: 'default',
  terminalId: id,
  title
})
const fileTab = (id: string): SessionPanelTab => ({
  id: `workspace-drawer:file:${encodeURIComponent(`${id}.ts`)}`,
  kind: 'file',
  path: `${id}.ts`,
  title: id
})
interface HarnessValue {
  panelState: SessionPanelState
  replaceRightTabs: (tabs: SessionPanelTab[], activeTabId?: string) => void
  terminalPanes: ReturnType<typeof useInteractionTerminalPanes>
}

function DrawerHarness({
  initialPanelState,
  onValue
}: {
  initialPanelState: SessionPanelState
  onValue: (value: HarnessValue) => void
}) {
  const [panelState, setPanelState] = useState(initialPanelState)
  const updateArea = useCallback((area: 'bottom' | 'right', updater: any) => {
    setPanelState(current => ({ ...current, [area]: updater(current[area]) }))
  }, [])
  const controller = useMemo(() => ({ panelState, setPanelState, updateArea }), [panelState, updateArea])
  const terminalPanes = useInteractionTerminalPanes('terminal-session', t, {
    activeTerminalId: getPanelStateActiveTerminalId(panelState),
    initialPanes: getPanelStateTerminalPanes(panelState)
  })
  onValue({
    panelState,
    replaceRightTabs: (tabs, activeTabId) =>
      setPanelState(current => ({
        ...current,
        right: { tabs, ...(activeTabId == null ? {} : { activeTabId }) }
      })),
    terminalPanes
  })
  return (
    <MemoryRouter>
      <ChatWorkspaceDrawer
        onOpenResource={vi.fn()}
        panelStateController={controller}
        terminalPanes={terminalPanes}
        terminalSessionId='terminal-session'
      />
    </MemoryRouter>
  )
}

function WorkspaceDrawerDialogHarness() {
  const { t } = useTranslation()
  return (
    <MemoryRouter>
      <RouteContainerLayout
        isCompactLayout
        sidePanel={<span>Workspace</span>}
        sidePanelCompactMode='overlay'
        sidePanelLabel={t('chat.workspaceDrawerToggle')}
      >
        Chat
      </RouteContainerLayout>
    </MemoryRouter>
  )
}

let animationFrames = new Map<number, FrameRequestCallback>()
let nextAnimationFrameId = 0
let container: HTMLDivElement
let root: Root
let value: HarnessValue
const currentTarget = (id: string) => ({ generation: value.terminalPanes.getTerminalGeneration(id)!, terminalId: id })

const flushAnimationFrames = async () => {
  while (animationFrames.size > 0) {
    const callbacks = [...animationFrames.values()]
    animationFrames.clear()
    await act(async () => callbacks.forEach(callback => callback(0)))
  }
}

const renderDrawer = async (rightTabs: SessionPanelTab[], bottomTabs: SessionPanelTab[] = []) => {
  const initialPanelState: SessionPanelState = {
    bottom: { activeTabId: bottomTabs[0]?.id, tabs: bottomTabs },
    right: { activeTabId: rightTabs[0]?.id, tabs: rightTabs }
  }
  await act(async () =>
    root.render(
      <DrawerHarness initialPanelState={initialPanelState} onValue={next => value = next} />
    )
  )
}

const findConfirmButton = () =>
  Array.from(document.querySelectorAll('button')).find(button =>
    button.textContent === 'chat.interactionPanel.terminalCloseConfirmAction:1'
  )!

describe('chat workspace drawer terminal close boundary', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    mocks.dockProps = null
    mocks.language = 'en'
    mocks.mobile = false
    mocks.useActualModal = false
    animationFrames = new Map()
    vi.clearAllMocks()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      nextAnimationFrameId += 1
      animationFrames.set(nextAnimationFrameId, callback)
      return nextAnimationFrameId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => animationFrames.delete(id))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })
  it('closes the selected passive terminal immediately and leaves a connected workspace target focused', async () => {
    await renderDrawer([terminalTab('term-a')], [terminalTab('bottom-a')])
    await act(async () => value.terminalPanes.handleInfoChange(currentTarget('term-a'), { isExited: true } as any))
    expect(value.terminalPanes.panes.map(pane => `${pane.id}:${pane.surface}`))
      .toEqual(['bottom-a:bottom'])
    container.querySelector<HTMLElement>('[aria-label="Close term-a"]')?.focus()
    await act(async () => container.querySelector<HTMLElement>('[aria-label="Close term-a"]')?.click())
    await flushAnimationFrames()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(value.panelState.right.tabs).toEqual([])
    expect(document.activeElement).not.toBe(document.body)
  })
  it('confirms one active terminal once and preserves a concurrently inserted tab in current order', async () => {
    mocks.useActualModal = true
    await renderDrawer([terminalTab('term-a'), fileTab('file-a')])
    const terminate = vi.fn(() => true)
    value.terminalPanes.handleTerminateChange(currentTarget('term-a'), terminate)
    const menuItems = mocks.dockProps.getTabContextMenuItems({ tab: { key: terminalKey('term-a') } })
    const closeAll = [...menuItems].reverse().find((item: any) => item !== 'separator') as any
    await act(async () => closeAll.componentProps.onSelect())
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    await act(async () =>
      value.replaceRightTabs([
        fileTab('inserted'),
        fileTab('file-a'),
        terminalTab('term-a')
      ], terminalKey('term-a'))
    )
    const confirm = findConfirmButton()
    await act(async () => {
      confirm.click()
      confirm.click()
    })
    await flushAnimationFrames()
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(value.panelState.right.tabs.map(tab => tab.title)).toEqual(['inserted'])
    expect(document.activeElement).toBe(container.querySelector('[aria-label="Close inserted.ts"]'))
    expect(document.activeElement).not.toBe(document.body)
  })

  it('keeps and focuses a failed terminal with one actual-text owner live region', async () => {
    await renderDrawer([terminalTab('term-a')])
    value.terminalPanes.handleTerminateChange(currentTarget('term-a'), () => false)
    await act(async () => container.querySelector<HTMLElement>('[aria-label="Close term-a"]')?.click())
    await act(async () => findConfirmButton().click())
    await flushAnimationFrames()
    expect(value.panelState.right.tabs.map(tab => tab.id)).toEqual([terminalKey('term-a')])
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe('chat.interactionPanel.terminalCloseFailed:1')
    expect(document.activeElement).toBe(container.querySelector('[aria-label="Close term-a"]'))
  })

  it('restores the connected mobile close invoker when Cancel dismisses an active terminal confirmation', async () => {
    mocks.mobile = true
    await renderDrawer([terminalTab('term-a')])
    value.terminalPanes.handleTerminateChange(currentTarget('term-a'), () => true)
    const close = container.querySelector<HTMLElement>('[aria-label="Close term-a"]')!
    close.focus()
    await act(async () => close.click())
    const cancel = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Cancel')!
    await act(async () => cancel.click())
    await flushAnimationFrames()
    expect(value.panelState.right.tabs.map(tab => tab.id)).toEqual([terminalKey('term-a')])
    expect(document.activeElement).toBe(container.querySelector('[aria-label="Close term-a"]'))
  })

  it.each([false, true])('focuses a production action after actual Modal settles (mobile %s)', async (mobile) => {
    mocks.mobile = mobile
    mocks.useActualModal = true
    await renderDrawer([terminalTab('term-a')])
    value.terminalPanes.handleTerminateChange(currentTarget('term-a'), () => true)
    const close = container.querySelector<HTMLButtonElement>('[aria-label="Close term-a"]')!
    close.focus()
    await act(async () => close.click())
    await act(async () => findConfirmButton().click())
    await flushAnimationFrames()
    const startAction = container.querySelector<HTMLButtonElement>(
      mobile
        ? '.chat-workspace-drawer__mobile-tab-card-title'
        : '.chat-interaction-panel-empty__action'
    )!
    expect(value.panelState.right.tabs).toEqual([])
    expect(startAction.isConnected).toBe(true)
    expect(document.activeElement).toBe(startAction)
    expect(document.activeElement).not.toBe(document.body)
  })

  it('focuses a fixed-view action after a passive mobile final-tab close', async () => {
    mocks.mobile = true
    await renderDrawer([terminalTab('term-a')])
    await act(async () => value.terminalPanes.handleInfoChange(currentTarget('term-a'), { isExited: true } as any))
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close term-a"]')!.click())
    await flushAnimationFrames()
    const fixedView = container.querySelector<HTMLButtonElement>('.chat-workspace-drawer__mobile-tab-card-title')!
    expect(fixedView.isConnected).toBe(true)
    expect(document.activeElement).toBe(fixedView)
    expect(document.activeElement).not.toBe(document.body)
  })

  it('keeps a running mobile terminal lifecycle mounted while the overview closes it', async () => {
    mocks.mobile = true
    await renderDrawer([terminalTab('term-a')])
    await act(async () => container.querySelector<HTMLElement>('button[aria-label="Workspace"]')!.click())
    await act(async () => container.querySelector<HTMLElement>('[aria-label="Close term-a"]')!.click())
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => findConfirmButton().click())
    await flushAnimationFrames()
    expect(mocks.terminalTerminate).toHaveBeenCalledTimes(1)
    expect(value.panelState.right.tabs).toEqual([])
  })

  it.each([
    { label: en.chat.workspaceDrawerToggle, language: 'en' },
    { label: zh.chat.workspaceDrawerToggle, language: 'zh' }
  ])('renders the $language mobile workspace dialog name', async ({ label, language }) => {
    mocks.language = language
    await act(async () => root.render(<WorkspaceDrawerDialogHarness />))
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(label)
    expect(chatRouteShellSource).toContain("sidePanelLabel={t('chat.workspaceDrawerToggle')}")
  })

  it('materializes unopened fixed views from the mobile overview and localizes mobile close labels', async () => {
    mocks.mobile = true
    await renderDrawer([])
    expect(container.textContent).toContain('tree')
    expect(container.textContent).toContain('changes')
    const treeCard = container.querySelector<HTMLButtonElement>('.chat-workspace-drawer__mobile-tab-card-title')!
    await act(async () => treeCard.click())
    expect(value.panelState.right.tabs).toEqual([
      expect.objectContaining({ kind: 'workspace-drawer', view: 'tree' })
    ])
    await act(async () => value.replaceRightTabs([terminalTab('终端甲', '终端甲')], terminalKey('终端甲')))
    mocks.language = 'zh'
    await act(async () =>
      root.render(
        <DrawerHarness
          initialPanelState={value.panelState}
          onValue={next => value = next}
        />
      )
    )
    const showOverview = container.querySelector<HTMLElement>('button[aria-label="工作区"]')
    expect(showOverview).not.toBeNull()
    await act(async () => showOverview!.click())
    expect(container.querySelector('[aria-label="关闭 终端甲"]')).not.toBeNull()
  })
})
