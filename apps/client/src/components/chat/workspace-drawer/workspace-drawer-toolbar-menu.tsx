import type { ChangedFilesLayout } from './changed-files-model'

export const changedLayoutItems: Array<{
  icon: string
  key: ChangedFilesLayout
  labelKey: string
}> = [
  {
    key: 'folders',
    icon: 'account_tree',
    labelKey: 'chat.workspaceDrawerChangedFolders'
  },
  {
    key: 'flat',
    icon: 'view_list',
    labelKey: 'chat.workspaceDrawerChangedFlat'
  }
]

export const menuDivider = { type: 'divider' as const }

export const renderMenuIcon = (icon: string) =>
  <span className='material-symbols-rounded chat-workspace-drawer__menu-icon'>{icon}</span>
