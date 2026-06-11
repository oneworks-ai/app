import type { TFunction } from 'i18next'

import { resolvePluginContributionText } from '#~/plugins/plugin-i18n'
import type { PluginContributionWorkbenchTab } from '#~/plugins/plugin-manifest'

import type { WorkspaceDrawerView } from './workspace-drawer-types'

export type WorkspaceDrawerPluginTab = PluginContributionWorkbenchTab & { pluginScope: string }

export interface WorkspaceDrawerViewItem {
  count?: number
  icon: string
  key: WorkspaceDrawerView
  label: string
}

export const toPluginWorkspaceDrawerView = (pluginScope: string, id: string) => `plugin:${pluginScope}:${id}` as const

export const getPluginWorkspaceDrawerViews = (pluginTabs: WorkspaceDrawerPluginTab[]) =>
  new Set(
    pluginTabs.filter(tab => tab.placement === 'right' && tab.clientView != null).map(tab =>
      toPluginWorkspaceDrawerView(tab.pluginScope, tab.id)
    )
  )

export const buildWorkspaceDrawerViewItems = ({
  agentRosterCount,
  approvalCount,
  changedFilesCount,
  hasAgentsTab,
  hasApprovalsTab,
  hasSettingsTab,
  language,
  pluginTabs,
  t
}: {
  agentRosterCount?: number
  approvalCount?: number
  changedFilesCount?: number
  hasAgentsTab?: boolean
  hasApprovalsTab?: boolean
  hasSettingsTab?: boolean
  language: string
  pluginTabs: WorkspaceDrawerPluginTab[]
  t: TFunction
}): WorkspaceDrawerViewItem[] => [
  { key: 'tree' as const, icon: 'folder', label: t('chat.workspaceDrawerTree') },
  {
    key: 'changes' as const,
    icon: 'difference',
    label: t('chat.workspaceDrawerChangedFiles'),
    count: changedFilesCount
  },
  ...(hasSettingsTab === true
    ? [{
      key: 'settings' as const,
      icon: 'tune',
      label: t('chat.viewSettings')
    }]
    : []),
  ...(hasApprovalsTab === true
    ? [{
      key: 'approvals' as const,
      icon: 'approval',
      label: t('chat.workspaceDrawerApprovals'),
      count: approvalCount
    }]
    : []),
  ...(hasAgentsTab === true
    ? [{
      key: 'agents' as const,
      icon: 'groups',
      label: t('chat.workspaceDrawerAgents'),
      count: agentRosterCount
    }]
    : []),
  ...pluginTabs
    .filter(tab => tab.placement === 'right' && tab.clientView != null)
    .map(tab => ({
      key: toPluginWorkspaceDrawerView(tab.pluginScope, tab.id),
      icon: tab.icon ?? 'layers',
      label: resolvePluginContributionText(tab, 'title', language) ?? tab.title
    }))
]
