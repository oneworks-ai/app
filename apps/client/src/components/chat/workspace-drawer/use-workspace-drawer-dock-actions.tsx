import type { MenuProps } from 'antd'
import type { TFunction } from 'i18next'
import { useCallback, useState } from 'react'

import type {
  RouteContainerPanelDockActionItem,
  RouteContainerPanelDockHeaderActionContext
} from '#~/components/layout/RouteContainerPanelTabs'
import type {
  ProjectFileTreeCommand,
  ProjectFileTreeCommandAction
} from '#~/components/workspace/project-file-tree/project-file-tree-types'

import type { ChangedFilesLayout, ChangedTreeCommand, ChangedTreeCommandAction } from './changed-files-model'
import { changedLayoutItems, menuDivider, renderMenuIcon } from './workspace-drawer-toolbar-menu'
import type { WorkspaceDrawerView } from './workspace-drawer-types'

type WorkspaceDrawerTreeBulkAction = Extract<ProjectFileTreeCommandAction, ChangedTreeCommandAction>

export interface WorkspaceDrawerDockActionState {
  changedLayout: ChangedFilesLayout
  changedTreeCommand: ChangedTreeCommand | null
  treeRefreshKey: number
  workspaceTreeCommand: ProjectFileTreeCommand | null
}

export interface WorkspaceDrawerDockActionContext {
  isTopRightGroup: boolean
  view: WorkspaceDrawerView | null | undefined
}

export interface UseWorkspaceDrawerDockActionsOptions {
  includeCloseAction?: boolean
  onActivateView?: (view: WorkspaceDrawerView) => void
  onClose?: () => void
  onForceSync?: () => void | Promise<unknown>
  selectedFilePath?: string | null
  t: TFunction
}

/**
 * Shared workspace drawer dock commands.
 *
 * The workspace drawer can live in the right panel or as tabs inside the
 * bottom interaction panel. Keep tree/change actions here so every Dockview
 * host resolves header actions from the active tab instead of reimplementing
 * toolbar logic in one placement only.
 */
export function useWorkspaceDrawerDockActions({
  includeCloseAction = true,
  onActivateView,
  onClose,
  onForceSync,
  selectedFilePath,
  t
}: UseWorkspaceDrawerDockActionsOptions) {
  const [changedLayout, setChangedLayout] = useState<ChangedFilesLayout>('folders')
  const [changedTreeCommand, setChangedTreeCommand] = useState<ChangedTreeCommand | null>(null)
  const [workspaceTreeCommand, setWorkspaceTreeCommand] = useState<ProjectFileTreeCommand | null>(null)
  const [treeRefreshKey, setTreeRefreshKey] = useState(0)
  const hasSelectedFile = selectedFilePath != null && selectedFilePath !== ''

  const handleForceSync = useCallback(() => {
    void onForceSync?.()
    setTreeRefreshKey(value => value + 1)
  }, [onForceSync])

  const handleChangedTreeCommand = useCallback((action: ChangedTreeCommandAction) => {
    onActivateView?.('changes')
    setChangedLayout('folders')
    setChangedTreeCommand(prev => ({
      action,
      id: (prev?.id ?? 0) + 1
    }))
  }, [onActivateView])

  const handleWorkspaceTreeCommand = useCallback((action: ProjectFileTreeCommandAction, path?: string) => {
    onActivateView?.('tree')
    setWorkspaceTreeCommand(prev => ({
      action,
      id: (prev?.id ?? 0) + 1,
      path
    }))
  }, [onActivateView])

  const getMoreMenuItems = useCallback((view: WorkspaceDrawerView): MenuProps['items'] => [
    {
      key: 'force-sync',
      label: t('chat.workspaceDrawerForceSync'),
      icon: renderMenuIcon('sync'),
      onClick: handleForceSync
    },
    ...(view === 'changes'
      ? [
        menuDivider,
        {
          key: 'display-mode',
          label: t('chat.workspaceDrawerDisplayMode'),
          icon: renderMenuIcon('view_module'),
          children: changedLayoutItems.map(item => ({
            key: `layout:${item.key}`,
            label: t(item.labelKey),
            icon: renderMenuIcon(changedLayout === item.key ? 'check' : item.icon),
            onClick: () => setChangedLayout(item.key)
          }))
        }
      ]
      : [])
  ], [changedLayout, handleForceSync, t])

  const getActionsForView = useCallback(({
    isTopRightGroup,
    view
  }: WorkspaceDrawerDockActionContext): RouteContainerPanelDockActionItem[] => {
    const chromeActions: RouteContainerPanelDockActionItem[] = includeCloseAction && isTopRightGroup && onClose != null
      ? [{
        icon: 'right_panel_close',
        key: 'workspace-drawer:close',
        label: t('chat.workspaceDrawerClose'),
        onSelect: onClose
      }]
      : []

    if (view !== 'tree' && view !== 'changes') return chromeActions

    const runTreeAction = (action: WorkspaceDrawerTreeBulkAction) => {
      if (view === 'changes') {
        handleChangedTreeCommand(action)
        return
      }

      handleWorkspaceTreeCommand(action)
    }

    return [
      {
        disabled: !hasSelectedFile,
        icon: 'my_location',
        key: `${view}:locate`,
        label: t('chat.workspaceDrawerLocateFile'),
        onSelect: () => handleWorkspaceTreeCommand('locate', selectedFilePath ?? undefined)
      },
      {
        icon: 'unfold_more',
        key: `${view}:expand`,
        label: t('chat.workspaceDrawerExpandAll'),
        onSelect: () => runTreeAction('expand')
      },
      {
        icon: 'unfold_less',
        key: `${view}:collapse`,
        label: t('chat.workspaceDrawerCollapseAll'),
        onSelect: () => runTreeAction('collapse')
      },
      {
        icon: 'more_vert',
        key: `${view}:more`,
        label: t('common.moreActions'),
        menuItems: getMoreMenuItems(view)
      },
      ...chromeActions
    ]
  }, [
    getMoreMenuItems,
    handleChangedTreeCommand,
    handleWorkspaceTreeCommand,
    hasSelectedFile,
    includeCloseAction,
    onClose,
    selectedFilePath,
    t
  ])

  const getRouteContainerHeaderActions = useCallback((
    context: RouteContainerPanelDockHeaderActionContext<WorkspaceDrawerView>
  ) =>
    getActionsForView({
      isTopRightGroup: context.isTopRightGroup,
      view: context.groupActiveTabKey
    }), [getActionsForView])

  const state: WorkspaceDrawerDockActionState = {
    changedLayout,
    changedTreeCommand,
    treeRefreshKey,
    workspaceTreeCommand
  }

  return {
    ...state,
    getActionsForView,
    getRouteContainerHeaderActions,
    handleChangedTreeCommand,
    handleForceSync,
    handleWorkspaceTreeCommand
  }
}
