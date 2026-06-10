import type { MenuProps } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import type { TerminalShellKind } from '@oneworks/types'

import { buildWorkbenchCreateMenuItems } from '#~/components/chat/workbench-create-menu'
import type { WorkspaceDrawerViewItem } from '#~/components/chat/workspace-drawer/workspace-drawer-view-items'
import { RouteContainerPanelDockWorkspace } from '#~/components/layout/RouteContainerPanelTabs'
import type { RouteContainerPanelDockChromeActionsConfig } from '#~/components/layout/RouteContainerPanelTabs'
import type {
  PluginContributionChatInteractionPanelEmptyAction,
  PluginContributionWorkbenchAddMenuItem
} from '#~/plugins/plugin-manifest'
import { usePluginCommandExecutor, usePluginSlot } from '#~/plugins/plugin-slots'
import { resolveRouteContributionText } from '#~/plugins/route-plugin-chrome'

import { InteractionPanelEmptyState } from './InteractionPanelEmptyState'
import type { InteractionPanelEmptyAction } from './InteractionPanelEmptyState'
import { useInteractionPanelMobileDebugDeviceOptions } from './use-interaction-panel-mobile-debug-device-options'

const hasPluginEmptyActionTarget = (
  contribution: PluginContributionChatInteractionPanelEmptyAction
) => (
  contribution.command != null && contribution.command.trim() !== '' ||
  contribution.route != null && contribution.route.trim() !== '' ||
  contribution.href != null && contribution.href.trim() !== ''
)

export function InteractionPanelEmptyDockWorkspace({
  canCreateSessionTab,
  canFullscreenPanel,
  isPanelFullscreen,
  isPanelMinimized,
  onAddMenuClick,
  onNewMobileDebugPage,
  onNewSession,
  onNewTerminal,
  onNewWebPage,
  onOpenResource,
  onPanelExpand,
  onPanelClose,
  onPanelAction,
  onTogglePanelFullscreen,
  workspaceDrawerCreateItems,
  workspaceDrawerCreateSelectedKeys
}: {
  canCreateSessionTab: boolean
  canFullscreenPanel: boolean
  isPanelFullscreen: boolean
  isPanelMinimized: boolean
  onAddMenuClick: NonNullable<MenuProps['onClick']>
  onNewMobileDebugPage: () => void
  onNewSession: () => void
  onNewTerminal: (shellKind?: TerminalShellKind) => void
  onNewWebPage: () => void
  onOpenResource: () => void
  onPanelExpand: () => void
  onPanelClose: () => void
  onPanelAction: () => void
  onTogglePanelFullscreen: () => void
  workspaceDrawerCreateItems?: WorkspaceDrawerViewItem[]
  workspaceDrawerCreateSelectedKeys?: string[]
}) {
  const { i18n, t } = useTranslation()
  const navigate = useNavigate()
  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
  const { deviceOptions, refreshDeviceOptions } = useInteractionPanelMobileDebugDeviceOptions()
  const executePluginCommand = usePluginCommandExecutor()
  const pluginAddMenuItems = usePluginSlot<PluginContributionWorkbenchAddMenuItem>('workbench.addMenu')
  const pluginEmptyActions = usePluginSlot<PluginContributionChatInteractionPanelEmptyAction>(
    'chat.interactionPanel.emptyActions'
  )
  const language = i18n.resolvedLanguage ?? i18n.language
  const addMenuItems = useMemo(
    () =>
      buildWorkbenchCreateMenuItems(t, isMac, {
        canCreateSessionTab,
        mobileDebugDevices: deviceOptions,
        language,
        pluginMenuItems: pluginAddMenuItems,
        workspaceDrawerItems: workspaceDrawerCreateItems
      }),
    [canCreateSessionTab, deviceOptions, isMac, pluginAddMenuItems, t, workspaceDrawerCreateItems]
  )
  const extraEmptyActions = useMemo<InteractionPanelEmptyAction[]>(() =>
    pluginEmptyActions
      .filter(hasPluginEmptyActionTarget)
      .map((contribution): InteractionPanelEmptyAction => {
        const label = resolveRouteContributionText(contribution, 'title', language) ?? contribution.title
        return {
          description: resolveRouteContributionText(contribution, 'description', language),
          icon: contribution.icon ?? 'extension',
          key: `plugin:${contribution.pluginScope}:${contribution.id}`,
          label,
          shortcut: contribution.shortcut,
          onClick: () => {
            if (contribution.command != null && contribution.command.trim() !== '') {
              void executePluginCommand?.(contribution.pluginScope, contribution.command, {
                kind: 'chatInteractionPanelEmptyAction',
                source: 'chat.interactionPanel.emptyActions'
              })
              return
            }

            if (contribution.route != null && contribution.route.trim() !== '') {
              void navigate(contribution.route)
              return
            }

            if (contribution.href != null && contribution.href.trim() !== '') {
              window.open(contribution.href, '_blank', 'noopener,noreferrer')
            }
          }
        }
      }), [executePluginCommand, language, navigate, pluginEmptyActions])
  const fullscreenLabel = isPanelFullscreen ? t('common.exitFullscreen') : t('common.enterFullscreen')
  const panelMinimizeLabel = t(
    isPanelMinimized ? 'chat.interactionPanel.expandPanel' : 'chat.interactionPanel.minimizePanel'
  )
  const panelCloseLabel = t('chat.interactionPanel.hidePanel')
  const panelChromeActions = useMemo<RouteContainerPanelDockChromeActionsConfig>(() => ({
    ...(canFullscreenPanel
      ? {
        fullscreen: {
          active: isPanelFullscreen,
          label: fullscreenLabel,
          onSelect: onTogglePanelFullscreen
        }
      }
      : {}),
    minimize: {
      icon: isPanelMinimized ? 'bottom_panel_open' : 'bottom_panel_close',
      label: panelMinimizeLabel,
      onSelect: isPanelMinimized ? onPanelExpand : onPanelAction
    },
    close: {
      label: panelCloseLabel,
      onSelect: onPanelClose
    }
  }), [
    canFullscreenPanel,
    fullscreenLabel,
    isPanelFullscreen,
    isPanelMinimized,
    panelCloseLabel,
    onPanelClose,
    onPanelExpand,
    onPanelAction,
    onTogglePanelFullscreen,
    panelMinimizeLabel
  ])

  return (
    <RouteContainerPanelDockWorkspace
      activeTab={null}
      ariaLabel={t('chat.interactionPanel.addTab')}
      className='chat-interaction-panel__dock-workspace chat-interaction-panel__dock-workspace--empty'
      createMenuItems={addMenuItems}
      createMenuLabel={t('chat.interactionPanel.addTab')}
      createMenuSelectedKeys={workspaceDrawerCreateSelectedKeys}
      defaultContent={
        <InteractionPanelEmptyState
          canCreateSessionTab={canCreateSessionTab}
          extraActions={extraEmptyActions}
          onNewSession={onNewSession}
          onNewMobileDebugPage={onNewMobileDebugPage}
          onNewTerminal={onNewTerminal}
          onNewWebPage={onNewWebPage}
          onOpenResource={onOpenResource}
        />
      }
      labelMode='responsive'
      openedTabs={[]}
      panelChromeActions={panelChromeActions}
      panelKey='chat-interaction-panel'
      tabs={[]}
      onCreateMenuClick={onAddMenuClick}
      onCreateMenuOpenChange={(open) => {
        if (open) void refreshDeviceOptions()
      }}
      onTabChange={() => undefined}
    />
  )
}
