import type { TerminalPaneConfig } from '#~/components/chat/terminal/@utils/terminal-panes'
import type { TerminalPaneInfo } from '#~/components/chat/terminal/ChatTerminalView'
import { getWorkspaceFileIconMeta } from '#~/components/chat/workspace-drawer/workspace-drawer-icons'
import type { WorkspaceDrawerView } from '#~/components/chat/workspace-drawer/workspace-drawer-types'

import type { InteractionPanelIframePage } from './InteractionPanelIframeView'
import type { InteractionPanelMobileDebugPage } from './interaction-panel-mobile-debug-pages'
import type { InteractionPanelPluginPage } from './interaction-panel-plugin-pages'
import type { InteractionPanelSessionPage } from './interaction-panel-session-pages'

export type InteractionPanelTab =
  | {
    id: string
    kind: 'terminal'
    icon: string
    label: string
    shellKind: TerminalPaneConfig['shellKind']
    canClose: true
  }
  | { id: string; kind: 'file'; icon: string; label: string; path: string; canClose: true }
  | { id: string; kind: 'iframe'; faviconUrl?: string; icon: string; label: string; canClose: true }
  | { id: string; kind: 'mobile-debug'; icon: string; label: string; canClose: true }
  | { id: string; kind: 'page-debugger'; icon: string; label: string; canClose: true }
  | { id: string; kind: 'session'; icon: string; label: string; sessionId?: string; canClose: true }
  | {
    id: string
    kind: 'plugin'
    icon: string
    label: string
    pluginScope: string
    tabId: string
    viewId: string
    canClose: true
  }
  | {
    id: string
    kind: 'workspace-drawer'
    icon: string
    label: string
    view: WorkspaceDrawerView
    canClose: true
  }

export type ActiveInteractionTab =
  | { kind: 'terminal'; id: string }
  | { kind: 'file'; path: string }
  | { kind: 'iframe'; id: string }
  | { kind: 'mobile-debug'; id: string }
  | { kind: 'page-debugger'; id: string }
  | { kind: 'session'; id: string }
  | { kind: 'plugin'; id: string }
  | { kind: 'workspace-drawer'; id: string }

export const WORKSPACE_DRAWER_INTERACTION_TAB_PREFIX = 'workspace-drawer:'

export const toWorkspaceDrawerInteractionTabId = (view: WorkspaceDrawerView) =>
  `${WORKSPACE_DRAWER_INTERACTION_TAB_PREFIX}${view}`

export const getFileName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

export const buildInteractionPanelTabs = ({
  filePaths,
  iframePages,
  mobileDebugPages,
  pluginPages,
  sessionPages,
  terminalInfoById,
  terminalPanes
}: {
  filePaths: string[]
  iframePages: InteractionPanelIframePage[]
  mobileDebugPages?: InteractionPanelMobileDebugPage[]
  pluginPages?: InteractionPanelPluginPage[]
  sessionPages?: InteractionPanelSessionPage[]
  terminalInfoById: Record<string, TerminalPaneInfo>
  terminalPanes: TerminalPaneConfig[]
}): InteractionPanelTab[] => [
  ...terminalPanes.map(pane => ({
    id: pane.id,
    kind: 'terminal' as const,
    icon: pane.runCommand?.icon ?? (terminalInfoById[pane.id]?.isExited === true ? 'terminal_off' : 'terminal'),
    label: pane.title,
    shellKind: pane.shellKind,
    canClose: true as const
  })),
  ...filePaths.map(path => ({
    id: `file:${path}`,
    kind: 'file' as const,
    icon: getWorkspaceFileIconMeta(getFileName(path)).icon,
    label: getFileName(path),
    path,
    canClose: true as const
  })),
  ...iframePages.map(page => ({
    id: page.id,
    kind: 'iframe' as const,
    faviconUrl: page.faviconUrl,
    icon: 'language',
    label: page.title,
    canClose: true as const
  })),
  ...(mobileDebugPages ?? []).map(page => ({
    id: page.id,
    kind: 'mobile-debug' as const,
    icon: 'phonelink_setup',
    label: page.selectedDeviceLabel == null ? page.title : `${page.title} / ${page.selectedDeviceLabel}`,
    canClose: true as const
  })),
  ...(sessionPages ?? []).map(page => ({
    id: page.id,
    kind: 'session' as const,
    icon: 'chat',
    label: page.title,
    sessionId: page.sessionId,
    canClose: true as const
  })),
  ...(pluginPages ?? []).map(page => ({
    id: page.id,
    kind: 'plugin' as const,
    icon: page.icon,
    label: page.title,
    pluginScope: page.pluginScope,
    tabId: page.tabId,
    viewId: page.viewId,
    canClose: true as const
  }))
]

export const isActiveTab = (tab: InteractionPanelTab, activeTab: ActiveInteractionTab) => {
  if (tab.kind !== activeTab.kind) return false
  if (tab.kind === 'file' && activeTab.kind === 'file') return tab.path === activeTab.path
  return 'id' in activeTab && tab.id === activeTab.id
}
