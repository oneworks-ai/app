import { useEffect, useRef, useState } from 'react'

import type { Session, SessionPanelTab } from '@oneworks/core'

import { normalizeWorkspaceFileState, uniqueNonEmptyPaths } from './workspace-file-panel-state'
import type { WorkspaceFilePanelState } from './workspace-file-panel-state'

export type ChatBottomPanelView = 'file' | 'terminal'

const getWorkspaceFileStateFromSessionPanel = (session?: Session): WorkspaceFilePanelState => {
  const bottom = session?.panelState?.bottom
  const fileTabs =
    bottom?.tabs.filter((tab): tab is Extract<SessionPanelTab, { kind: 'file' }> => tab.kind === 'file') ?? []
  const activeTab = bottom?.tabs.find(tab => tab.id === bottom.activeTabId)
  const selectedPath = activeTab?.kind === 'file' ? activeTab.path : fileTabs[0]?.path
  return {
    openPaths: fileTabs.map(tab => tab.path),
    selectedPath,
    isOpen: activeTab?.kind === 'file'
  }
}

export function useChatRouteBottomPanel({
  isTerminalOpen,
  session,
  setIsTerminalOpen
}: {
  isTerminalOpen: boolean
  session?: Session
  setIsTerminalOpen: (isOpen: boolean) => void
}) {
  const initialWorkspaceFileState = normalizeWorkspaceFileState(getWorkspaceFileStateFromSessionPanel(session))
  const [bottomPanelView, setBottomPanelView] = useState<ChatBottomPanelView>('terminal')
  const [selectedWorkspaceFilePath, setSelectedWorkspaceFilePath] = useState<string | null>(
    initialWorkspaceFileState.selectedPath
  )
  const [openWorkspaceFilePaths, setOpenWorkspaceFilePaths] = useState<string[]>(initialWorkspaceFileState.openPaths)
  const [isWorkspaceFileEditorOpen, setIsWorkspaceFileEditorOpen] = useState(initialWorkspaceFileState.isOpen)
  const hasWorkspaceFileEditor = isWorkspaceFileEditorOpen && selectedWorkspaceFilePath != null
  const shouldShowFileEditor = isTerminalOpen && hasWorkspaceFileEditor && bottomPanelView === 'file'
  const shouldShowBottomPanel = isTerminalOpen
  const persistedPanelFileStateKey = JSON.stringify(session?.panelState?.bottom ?? null)
  const panelFileStateEffectKey = `${session?.id ?? ''}:${persistedPanelFileStateKey}`
  const lastPanelFileStateEffectKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (lastPanelFileStateEffectKeyRef.current === panelFileStateEffectKey) {
      return
    }
    lastPanelFileStateEffectKeyRef.current = panelFileStateEffectKey

    const nextState = normalizeWorkspaceFileState(getWorkspaceFileStateFromSessionPanel(session))
    setOpenWorkspaceFilePaths(nextState.openPaths)
    setSelectedWorkspaceFilePath(nextState.selectedPath)
    setIsWorkspaceFileEditorOpen(nextState.isOpen)
    if (nextState.isOpen && nextState.selectedPath != null) {
      setBottomPanelView('file')
      setIsTerminalOpen(true)
      return
    }

    setBottomPanelView(current => current === 'file' ? 'terminal' : current)
  }, [panelFileStateEffectKey, session, setIsTerminalOpen])

  const commitWorkspaceFileState = (state: WorkspaceFilePanelState) => {
    const nextState = normalizeWorkspaceFileState(state)
    setOpenWorkspaceFilePaths(nextState.openPaths)
    setSelectedWorkspaceFilePath(nextState.selectedPath)
    setIsWorkspaceFileEditorOpen(nextState.isOpen)
  }

  const handleSelectBottomPanelView = (view: ChatBottomPanelView) => {
    if (view === 'file' && !hasWorkspaceFileEditor) {
      return
    }

    setBottomPanelView(view)
    setIsTerminalOpen(true)
  }
  const handleCloseBottomPanel = () => {
    setIsTerminalOpen(false)
  }
  const handleToggleBottomPanel = () => {
    if (isTerminalOpen) {
      handleCloseBottomPanel()
      return
    }

    if (hasWorkspaceFileEditor && bottomPanelView === 'file') {
      setBottomPanelView('file')
      setIsTerminalOpen(true)
      return
    }

    setBottomPanelView('terminal')
    setIsTerminalOpen(true)
  }
  const handleOpenWorkspaceFile = (path: string) => {
    commitWorkspaceFileState({
      openPaths: uniqueNonEmptyPaths([...openWorkspaceFilePaths, path]),
      selectedPath: path,
      isOpen: true
    })
    setBottomPanelView('file')
    setIsTerminalOpen(true)
  }
  const handleCloseWorkspaceFile = () => {
    commitWorkspaceFileState({
      openPaths: openWorkspaceFilePaths,
      selectedPath: selectedWorkspaceFilePath,
      isOpen: false
    })
    if (isTerminalOpen) {
      setBottomPanelView('terminal')
    }
  }
  const handleCloseAllWorkspaceFileTabs = () => {
    commitWorkspaceFileState({
      openPaths: [],
      selectedPath: null,
      isOpen: false
    })
    if (isTerminalOpen) {
      setBottomPanelView('terminal')
    }
  }
  const handleSelectWorkspaceFile = (path: string) => {
    commitWorkspaceFileState({
      openPaths: uniqueNonEmptyPaths([...openWorkspaceFilePaths, path]),
      selectedPath: path,
      isOpen: true
    })
    setBottomPanelView('file')
  }
  const handleCloseWorkspaceFileTab = (path: string) => {
    handleCloseWorkspaceFileTabs([path])
  }
  const handleCloseWorkspaceFileTabs = (paths: string[]) => {
    const pathSet = new Set(paths)
    if (pathSet.size <= 0) {
      return
    }

    const firstClosedIndex = openWorkspaceFilePaths.findIndex(path => pathSet.has(path))
    const nextPaths = openWorkspaceFilePaths.filter(path => !pathSet.has(path))
    const nextPath = selectedWorkspaceFilePath != null && !pathSet.has(selectedWorkspaceFilePath)
      ? selectedWorkspaceFilePath
      : nextPaths[Math.min(Math.max(firstClosedIndex, 0), nextPaths.length - 1)] ?? null

    commitWorkspaceFileState({
      openPaths: nextPaths,
      selectedPath: nextPath,
      isOpen: isWorkspaceFileEditorOpen && nextPath != null
    })

    if (nextPath == null && isTerminalOpen) {
      setBottomPanelView('terminal')
    }
  }
  const handleCloseOtherWorkspaceFileTabs = (path: string) => {
    if (!openWorkspaceFilePaths.includes(path)) {
      return
    }

    commitWorkspaceFileState({
      openPaths: [path],
      selectedPath: path,
      isOpen: true
    })
    setBottomPanelView('file')
  }
  const handleCloseWorkspaceFileTabsToRight = (path: string) => {
    const tabIndex = openWorkspaceFilePaths.indexOf(path)
    if (tabIndex < 0) {
      return
    }

    handleCloseWorkspaceFileTabs(openWorkspaceFilePaths.slice(tabIndex + 1))
  }
  return {
    handleCloseAllWorkspaceFileTabs,
    handleCloseBottomPanel,
    handleCloseWorkspaceFile,
    handleCloseOtherWorkspaceFileTabs,
    handleCloseWorkspaceFileTab,
    handleCloseWorkspaceFileTabs,
    handleCloseWorkspaceFileTabsToRight,
    handleOpenWorkspaceFile,
    handleSelectWorkspaceFile,
    handleSelectBottomPanelView,
    handleToggleBottomPanel,
    hasWorkspaceFileEditor,
    openWorkspaceFilePaths,
    selectedWorkspaceFilePath,
    shouldShowBottomPanel,
    shouldShowFileEditor
  }
}
export type ChatRouteBottomPanelState = ReturnType<typeof useChatRouteBottomPanel>
