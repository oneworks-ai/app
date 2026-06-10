import type { MenuProps } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useInteractionPanelWorkspaceOpeners } from './InteractionPanelWorkspaceOpener'
import { renderWorkspaceOpenerIcon } from './InteractionPanelWorkspaceOpenerMenu'
import { getInteractionPanelRunCommandIcon, getInteractionPanelRunCommandTitle } from './interaction-panel-run-commands'
import type { InteractionPanelRunCommand, InteractionPanelRunCommandTaskStatus } from './interaction-panel-run-commands'
import { useInteractionPanelRunCommands } from './use-interaction-panel-run-commands'

type WorkspaceActionMenuItems = NonNullable<MenuProps['items']>

const renderMenuIcon = (icon: string) => (
  <span className='material-symbols-rounded chat-header-icon'>{icon}</span>
)

export function useInteractionPanelWorkspaceActionMenuItems({
  enabled,
  runCommandTaskStatuses = [],
  terminalSessionId,
  onRunCommand
}: {
  enabled: boolean
  runCommandTaskStatuses?: InteractionPanelRunCommandTaskStatus[]
  terminalSessionId?: string
  onRunCommand?: (command: InteractionPanelRunCommand) => void
}): WorkspaceActionMenuItems {
  const { t } = useTranslation()
  const {
    commands,
    recordRunCommand
  } = useInteractionPanelRunCommands(terminalSessionId ?? '')
  const {
    handleOpenWorkspace,
    workspaceOpenerActions
  } = useInteractionPanelWorkspaceOpeners()
  const runningCommandIds = useMemo(
    () => new Set(runCommandTaskStatuses.filter(status => status.isRunning).map(status => status.commandId)),
    [runCommandTaskStatuses]
  )

  return useMemo(() => {
    if (!enabled || terminalSessionId == null || terminalSessionId === '' || onRunCommand == null) {
      return []
    }

    const runCommandItems: WorkspaceActionMenuItems = commands.length === 0
      ? [{
        key: 'workspace-run-command-empty',
        disabled: true,
        icon: renderMenuIcon('block'),
        label: t('chat.interactionPanel.runCommandsEmpty')
      }]
      : commands.map(command => {
        const title = getInteractionPanelRunCommandTitle(command)
        const isRunning = runningCommandIds.has(command.id)
        return {
          key: `workspace-run-command:${command.id}`,
          icon: renderMenuIcon(getInteractionPanelRunCommandIcon(command)),
          label: isRunning
            ? `${title} · ${t('chat.interactionPanel.runCommandRunning')}`
            : title,
          onClick: () => {
            recordRunCommand(command.id)
            onRunCommand(command)
          }
        }
      })

    const workspaceOpenerItems: WorkspaceActionMenuItems = workspaceOpenerActions.length === 0
      ? [{
        key: 'workspace-opener-empty',
        disabled: true,
        icon: renderMenuIcon('block'),
        label: t('chat.interactionPanel.openWorkspaceUnavailable')
      }]
      : workspaceOpenerActions.map(opener => ({
        key: `workspace-opener:${opener.id}`,
        icon: renderWorkspaceOpenerIcon({
          fallbackIcon: opener.fallbackIcon,
          iconClassName: 'chat-header-menu-icon material-symbols-rounded',
          iconUrl: opener.iconUrl,
          title: opener.title
        }),
        label: opener.title,
        onClick: () => handleOpenWorkspace(opener.id)
      }))

    return [
      {
        key: 'workspace-run-commands',
        children: runCommandItems,
        icon: renderMenuIcon('play_arrow'),
        label: t('chat.interactionPanel.runCommands')
      },
      {
        key: 'workspace-openers',
        children: workspaceOpenerItems,
        icon: renderMenuIcon('drive_file_move'),
        label: t('chat.interactionPanel.openWorkspace')
      }
    ]
  }, [
    commands,
    enabled,
    handleOpenWorkspace,
    onRunCommand,
    recordRunCommand,
    runningCommandIds,
    t,
    terminalSessionId,
    workspaceOpenerActions
  ])
}
