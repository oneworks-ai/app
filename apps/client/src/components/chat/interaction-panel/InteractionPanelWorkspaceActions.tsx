import { InteractionPanelRunCommandsPopover } from './InteractionPanelRunCommandsPopover'
import { InteractionPanelWorkspaceOpener } from './InteractionPanelWorkspaceOpener'
import type { InteractionPanelRunCommand, InteractionPanelRunCommandTaskStatus } from './interaction-panel-run-commands'
import { useInteractionPanelRunCommands } from './use-interaction-panel-run-commands'

export function InteractionPanelWorkspaceActions({
  containerClassName = 'chat-header-workspace-actions',
  iconClassName = 'chat-header-view-option material-symbols-rounded',
  menuIconClassName = 'chat-header-menu-icon material-symbols-rounded',
  runCommandTaskStatuses = [],
  terminalSessionId,
  onRunCommand,
  onTerminateRunCommandTask
}: {
  containerClassName?: string
  iconClassName?: string
  menuIconClassName?: string
  runCommandTaskStatuses?: InteractionPanelRunCommandTaskStatus[]
  terminalSessionId: string
  onRunCommand: (command: InteractionPanelRunCommand) => void
  onTerminateRunCommandTask?: (terminalId: string) => void
}) {
  const { commands, lastRunCommandId, recordRunCommand, saveCommands } = useInteractionPanelRunCommands(
    terminalSessionId
  )

  return (
    <div className={containerClassName}>
      <InteractionPanelRunCommandsPopover
        commands={commands}
        iconClassName={iconClassName}
        lastRunCommandId={lastRunCommandId}
        menuIconClassName={menuIconClassName}
        runCommandTaskStatuses={runCommandTaskStatuses}
        onRunCommand={onRunCommand}
        onTerminateRunCommandTask={onTerminateRunCommandTask}
        recordRunCommand={recordRunCommand}
        saveCommands={saveCommands}
      />
      <InteractionPanelWorkspaceOpener
        iconClassName={iconClassName}
        menuIconClassName={menuIconClassName}
      />
    </div>
  )
}
