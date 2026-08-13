// @vitest-environment happy-dom
import { App as AntApp } from 'antd'
import { act, useCallback, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionPanelAreaState, SessionPanelState, SessionPanelTab } from '@oneworks/core'

import { MessageItem } from '#~/components/chat/messages/MessageItem'
import { buildSessionMarkdown } from '#~/components/chat/session-markdown'
import { ChatWorkspaceDrawer } from '#~/components/chat/workspace-drawer/ChatWorkspaceDrawer'
import { buildWorkspaceAbsolutePath } from '#~/components/workspace/workspace-path-copy-options'
import { uniqueNonEmptyPaths } from '#~/hooks/chat/workspace-file-panel-state'
import { ChatRouteShell } from '#~/routes/ChatRouteShell'
import { buildChatLauncherWorkspaceContext } from '#~/routes/chat-workspace-context'

const mocks = vi.hoisted(() => ({
  bottomPanel: {
    handleToggleBottomPanel: vi.fn(),
    openWorkspaceFilePaths: [] as string[],
    selectedWorkspaceFilePath: null as string | null,
    shouldShowBottomPanel: false
  },
  chatLayoutState: {
    activeLayout: 'workspace' as const,
    isWorkspaceDrawerFullscreen: false,
    isWorkspaceDrawerOpen: true,
    setWorkspaceDrawerFullscreen: vi.fn(),
    setWorkspaceDrawerOpen: vi.fn(),
    workspaceDrawerView: 'tree' as const
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
  launcherPath: ' reports/file.txt ',
  markdownLinkHref: null as string | null,
  markdownWorkspaceRootPath: vi.fn(),
  panelState: null as SessionPanelState | null,
  pluginCommandExecutor: vi.fn(),
  pluginSlots: [] as unknown[],
  readWorkspaceFile: vi.fn(),
  responsiveLayout: { isCompactLayout: false, isTouchInteraction: false },
  routeSidebar: {
    clearRouteWindowBar: vi.fn(),
    hasRouteSidebarProvider: false,
    setRouteWindowBar: vi.fn()
  },
  routeSidebarOpener: { openRouteSidebar: vi.fn() },
  terminalPanes: { panes: [] },
  translate: (key: string) => key,
  treeEntries: [] as Array<{ name: string; path: string; type: 'file' }>,
  usePanelResizeResult: {
    handleKeyDown: vi.fn(),
    handlePointerDown: vi.fn(),
    isResizing: false
  }
}))

vi.mock('@monaco-editor/react', () => ({
  default: () => null,
  loader: { config: () => undefined }
}))

vi.mock('monaco-editor', () => ({
  editor: { defineTheme: vi.fn() }
}))

vi.mock('@oneworks/route-layout', async (importOriginal) => ({
  ...await importOriginal<typeof import('@oneworks/route-layout')>(),
  usePanelResize: () => mocks.usePanelResizeResult
}))

vi.mock('#~/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('#~/api')>(),
  getWorkspaceGitState: vi.fn(async () => ({ available: false })),
  listWorkspaceTree: vi.fn(async () => ({ entries: mocks.treeEntries })),
  readWorkspaceFile: mocks.readWorkspaceFile,
  updateSession: vi.fn(async (_id: string, session: unknown) => session)
}))

vi.mock('#~/components/chat/ChatHeader.js', () => ({ ChatHeader: () => null }))

vi.mock('#~/components/chat/terminal/ChatTerminalView', () => ({ ChatTerminalView: () => null }))

vi.mock('#~/components/layout/RouteContainerLayout', () => ({
  RouteContainerLayout: ({ children, sidePanel }: { children: ReactNode; sidePanel?: ReactNode }) => {
    const drawer = sidePanel as
      | ReactElement<{
        panelStateController?: { panelState?: SessionPanelState }
      }>
      | undefined
    mocks.panelState = drawer?.props.panelStateController?.panelState ?? mocks.panelState
    return <>{children}</>
  }
}))

vi.mock('#~/components/layout/RouteContainerPanelTabs', async (importOriginal) => ({
  ...await importOriginal<typeof import('#~/components/layout/RouteContainerPanelTabs')>(),
  RouteContainerPanelDockWorkspace: ({
    activeTab,
    tabs
  }: {
    activeTab?: string | null
    tabs: Array<{ content: (context: { isVisible: boolean }) => ReactNode; key: string }>
  }) => {
    const tab = tabs.find(item => item.key === activeTab) ?? tabs[0]
    return <>{tab?.content({ isVisible: true })}</>
  }
}))

vi.mock('#~/components/layout/desktop-workspace-startup-ready', () => ({
  useDesktopWorkspaceStartupReady: () => undefined
}))

vi.mock('#~/components/layout/route-sidebar-context', () => ({
  useRouteSidebar: () => mocks.routeSidebar
}))

vi.mock('#~/components/layout/use-route-container-sidebar-opener', () => ({
  useRouteContainerSidebarOpener: () => mocks.routeSidebarOpener
}))

vi.mock('#~/components/chat/interaction-panel/use-interaction-terminal-panes', () => ({
  useInteractionTerminalPanes: () => mocks.terminalPanes
}))

vi.mock('#~/hooks/chat/use-chat-route-bottom-panel', () => ({
  useChatRouteBottomPanel: () => mocks.bottomPanel
}))

vi.mock('#~/hooks/chat/use-terminal-dock-visibility', () => ({
  useTerminalDockVisibility: () => ({ isRendered: false, isVisible: false })
}))

vi.mock('#~/hooks/use-responsive-layout', () => ({
  useResponsiveLayout: () => mocks.responsiveLayout
}))

vi.mock('#~/hooks/use-chat-layout-query-state', () => ({
  useChatLayoutQueryState: () => mocks.chatLayoutState
}))

vi.mock('#~/plugins/PluginHost', () => ({ PluginViewHost: () => null }))

vi.mock('#~/plugins/plugin-slots', () => ({
  usePluginCommandExecutor: () => mocks.pluginCommandExecutor,
  usePluginSlot: () => mocks.pluginSlots
}))

vi.mock('#~/plugins/route-plugin-chrome', () => ({
  useInstallRoutePluginMoreMenu: () => undefined,
  useInstallRoutePluginWindowBarActions: () => undefined
}))

vi.mock('#~/runtime-config', async (importOriginal) => ({
  ...await importOriginal<typeof import('#~/runtime-config')>(),
  getRuntimeWorkspaceId: () => undefined
}))

vi.mock('#~/routes/ChatRouteBottomPanel', () => ({ ChatRouteBottomPanel: () => null }))

vi.mock('#~/routes/LauncherOverlay', () => ({
  LauncherOverlay: ({
    onOpenWorkspaceResource
  }: {
    onOpenWorkspaceResource: (target: { kind: 'file'; path: string }) => void
  }) => (
    <button
      data-testid='route-launcher-file'
      onClick={() => onOpenWorkspaceResource({ kind: 'file', path: mocks.launcherPath })}
    >
      open file
    </button>
  )
}))

vi.mock('#~/components/MarkdownContent', () => ({
  MarkdownContent: ({
    onLinkClick,
    workspaceRootPath
  }: {
    onLinkClick?: (href: string, event: ReactMouseEvent<HTMLAnchorElement>) => void
    workspaceRootPath?: string
  }) => {
    mocks.markdownWorkspaceRootPath(workspaceRootPath)
    return (
      <div data-testid='markdown-content'>
        {mocks.markdownLinkHref == null
          ? undefined
          : (
            <a
              data-testid='markdown-workspace-link'
              href={mocks.markdownLinkHref}
              onClick={event => onLinkClick?.(mocks.markdownLinkHref!, event)}
            >
              linked workspace file
            </a>
          )}
      </div>
    )
  }
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    i18n: mocks.i18n,
    t: mocks.translate
  })
}))

describe('chat workspace path consumers', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    mocks.launcherPath = ' reports/file.txt '
    mocks.markdownLinkHref = null
    mocks.markdownWorkspaceRootPath.mockReset()
    mocks.panelState = null
    mocks.readWorkspaceFile.mockReset()
    mocks.readWorkspaceFile.mockImplementation(async (path: string) => ({ content: '# file', path }))
    mocks.treeEntries = []
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('passes an exact session cwd through MessageItem to Markdown resource and link resolution', async () => {
    const workspaceRootPath = '/parent/ project '
    const message = {
      content: '![asset](/parent/ project /asset.png)',
      createdAt: 1,
      id: 'message-1',
      role: 'assistant'
    }

    await act(async () => {
      root.render(
        <MemoryRouter>
          <MessageItem
            anchorId='message-1'
            isEditing={false}
            isFirstInGroup
            isSessionBusy={false}
            isTargeted={false}
            msg={message as never}
            onCancelEditing={() => undefined}
            onEditMessage={async () => true}
            onForkMessage={async () => true}
            onRecallMessage={async () => true}
            onStartEditing={() => undefined}
            onSwitchBranchSession={() => undefined}
            originalMessage={message as never}
            sessionInfo={{ cwd: workspaceRootPath, type: 'init' } as never}
            workspaceRootPath='/parent/project'
          />
        </MemoryRouter>
      )
    })

    expect(mocks.markdownWorkspaceRootPath).toHaveBeenLastCalledWith(workspaceRootPath)
  })

  it('builds Launcher context and absolute workspace paths from the original bytes', () => {
    const workspaceRootPath = '/parent/ project '
    expect(buildChatLauncherWorkspaceContext(workspaceRootPath, 'Fallback')).toMatchObject({
      description: workspaceRootPath,
      workspaceFolder: workspaceRootPath
    })
    expect(buildWorkspaceAbsolutePath(workspaceRootPath, ' scripts/run.sh ')).toBe(
      '/parent/ project / scripts/run.sh '
    )
    expect(
      buildSessionMarkdown({
        messages: [],
        sessionId: 'session-raw-path',
        title: 'Raw path',
        workspacePath: workspaceRootPath
      }).split('\n')
    ).toContain(`- Workspace: ${workspaceRootPath}`)
    expect(buildChatLauncherWorkspaceContext(String.raw`/parent/team\secret`, 'Fallback')?.name)
      .toBe(String.raw`team\secret`)
    expect(buildChatLauncherWorkspaceContext('/parent/team/secret', 'Fallback')?.name).toBe('secret')
    expect(buildChatLauncherWorkspaceContext(String.raw`C:\parent\secret`, 'Fallback')?.name).toBe('secret')
  })

  it('round-trips a Launcher file path through the real route owner without aliasing it', async () => {
    const treeTab: SessionPanelTab = {
      id: 'workspace-drawer:tree',
      kind: 'workspace-drawer',
      title: 'Tree',
      view: 'tree'
    }
    const workspaceSession = {
      id: 'session-route-path',
      panelState: {
        bottom: { tabs: [] },
        right: { activeTabId: treeTab.id, tabs: [treeTab] }
      }
    }

    function RouteHarness() {
      const [isTerminalOpen, setIsTerminalOpen] = useState(false)
      return (
        <MemoryRouter initialEntries={['/chat?layout=workspace']}>
          <ChatRouteShell
            activeView='history'
            historyView={<div>history</div>}
            isTerminalOpen={isTerminalOpen}
            isTerminalPanelFolded={false}
            projectWorkspaceFolder='/projects/current '
            sessionInfo={{ cwd: '/projects/current ', type: 'init' } as never}
            setActiveView={() => undefined}
            setIsTerminalOpen={setIsTerminalOpen}
            setIsTerminalPanelFolded={() => undefined}
            workspaceSession={workspaceSession as never}
          />
        </MemoryRouter>
      )
    }

    await act(async () => root.render(<RouteHarness />))
    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="route-launcher-file"]')
    expect(trigger).not.toBeNull()

    await act(async () => trigger?.click())
    await waitFor(() => {
      const fileTabs = mocks.panelState?.right.tabs.filter(tab => tab.kind === 'file') ?? []
      expect(fileTabs).toContainEqual(expect.objectContaining({ path: mocks.launcherPath }))
      expect(fileTabs).not.toContainEqual(expect.objectContaining({ path: mocks.launcherPath.trim() }))
    })
  })

  it('keeps exact locate and row-open paths through the real drawer and project tree', async () => {
    const rawPath = ' reports/file.txt '
    const adjacentPath = rawPath.trim()
    const openedPaths: string[] = []
    const locateFileRequest = { id: 1, path: rawPath }
    const handleOpenFile = (path: string) => openedPaths.push(path)
    const handleOpenResource = () => undefined
    mocks.treeEntries = [
      { name: rawPath, path: rawPath, type: 'file' },
      { name: adjacentPath, path: adjacentPath, type: 'file' }
    ]

    function DrawerHarness() {
      const [panelState, setPanelState] = useState<SessionPanelState>({
        bottom: { tabs: [] },
        right: {
          activeTabId: 'workspace-drawer:tree',
          tabs: [{
            id: 'workspace-drawer:tree',
            kind: 'workspace-drawer',
            title: 'Tree',
            view: 'tree'
          }]
        }
      })
      const updateArea = useCallback((
        area: 'bottom' | 'right',
        updater: (current: SessionPanelAreaState) => SessionPanelAreaState
      ) => setPanelState(current => ({ ...current, [area]: updater(current[area]) })), [])
      const panelStateController = useMemo(() => ({
        panelState,
        setPanelState: (updater: (current: SessionPanelState) => SessionPanelState) => setPanelState(updater),
        updateArea
      }), [panelState, updateArea])

      return (
        <MemoryRouter>
          <AntApp>
            <ChatWorkspaceDrawer
              locateFileRequest={locateFileRequest}
              onOpenFile={handleOpenFile}
              onOpenResource={handleOpenResource}
              panelStateController={panelStateController}
              terminalPanes={mocks.terminalPanes as never}
              terminalSessionId='workspace'
            />
          </AntApp>
        </MemoryRouter>
      )
    }

    await act(async () => root.render(<DrawerHarness />))
    await waitFor(() => {
      expect(
        Array.from(container.querySelectorAll<HTMLElement>('[data-workspace-tree-path]'))
          .some(row => row.dataset.workspaceTreePath === rawPath)
      ).toBe(true)
    })
    const rawRow = Array.from(container.querySelectorAll<HTMLElement>('[data-workspace-tree-path]'))
      .find(row => row.dataset.workspaceTreePath === rawPath)
    const adjacentRow = Array.from(container.querySelectorAll<HTMLElement>('[data-workspace-tree-path]'))
      .find(row => row.dataset.workspaceTreePath === adjacentPath)
    expect(rawRow?.classList.contains('is-selected')).toBe(true)
    expect(adjacentRow?.classList.contains('is-selected')).toBe(false)

    await act(async () => rawRow?.click())
    expect(openedPaths).toEqual([rawPath])
  })

  it('preserves a whitespace-distinct directory in the drawer file-tab and final read owner', async () => {
    const initialPath = 'guide.md'
    const linkedPath = 'project /file.txt'
    const adjacentPath = 'project/file.txt'
    const handleOpenResource = () => undefined
    mocks.markdownLinkHref = linkedPath

    function FileDrawerHarness() {
      const [panelState, setPanelState] = useState<SessionPanelState>({
        bottom: { tabs: [] },
        right: {
          activeTabId: `workspace-drawer:file:${encodeURIComponent(initialPath)}`,
          tabs: [{
            id: `workspace-drawer:file:${encodeURIComponent(initialPath)}`,
            kind: 'file',
            path: initialPath,
            title: initialPath
          }]
        }
      })
      const updateArea = useCallback((
        area: 'bottom' | 'right',
        updater: (current: SessionPanelAreaState) => SessionPanelAreaState
      ) => setPanelState(current => ({ ...current, [area]: updater(current[area]) })), [])
      const panelStateController = useMemo(() => ({
        panelState,
        setPanelState: (updater: (current: SessionPanelState) => SessionPanelState) => setPanelState(updater),
        updateArea
      }), [panelState, updateArea])

      return (
        <MemoryRouter>
          <AntApp>
            <ChatWorkspaceDrawer
              onOpenResource={handleOpenResource}
              panelStateController={panelStateController}
              terminalPanes={mocks.terminalPanes as never}
              terminalSessionId='workspace'
            />
          </AntApp>
        </MemoryRouter>
      )
    }

    await act(async () => root.render(<FileDrawerHarness />))
    await waitFor(() => expect(mocks.readWorkspaceFile).toHaveBeenCalledWith(initialPath))
    const link = container.querySelector<HTMLAnchorElement>('[data-testid="markdown-workspace-link"]')
    expect(link).not.toBeNull()

    await act(async () => link?.click())
    await waitFor(() => expect(mocks.readWorkspaceFile).toHaveBeenCalledWith(linkedPath))
    expect(mocks.readWorkspaceFile).not.toHaveBeenCalledWith(adjacentPath)
    expect(uniqueNonEmptyPaths([linkedPath, adjacentPath])).toEqual([linkedPath, adjacentPath])
  })
})

const waitFor = async (assertion: () => void) => {
  let lastError: unknown
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
      })
    }
  }
  throw lastError
}
