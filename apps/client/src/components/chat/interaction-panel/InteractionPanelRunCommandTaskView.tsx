import { Button, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'

import type { TerminalPaneConfig } from '#~/components/chat/terminal/@utils/terminal-panes'
import { ChatTerminalView } from '#~/components/chat/terminal/ChatTerminalView'

import { buildInteractionPanelRunCommandTaskScript } from './interaction-panel-run-commands'
import type { useInteractionTerminalPanes } from './use-interaction-terminal-panes'

export function InteractionPanelRunCommandTaskView({
  activeTerminalId,
  pane,
  sessionId,
  terminalPanes
}: {
  activeTerminalId: string
  pane: TerminalPaneConfig
  sessionId: string
  terminalPanes: ReturnType<typeof useInteractionTerminalPanes>
}) {
  const { t } = useTranslation()
  const task = pane.runCommand
  const isRunning = terminalPanes.runTaskRunningById[pane.id] === true

  if (task == null) {
    return null
  }

  const taskScript = buildInteractionPanelRunCommandTaskScript(task.script)
  const primaryActionLabel = isRunning
    ? t('chat.interactionPanel.runTaskTerminate')
    : t('chat.interactionPanel.runTaskStart')

  return (
    <div className='chat-interaction-panel-run-task'>
      <aside className='chat-interaction-panel-run-task__actions'>
        <Tooltip title={primaryActionLabel}>
          <Button
            type='text'
            className='dock-panel__close-btn chat-interaction-panel-run-task__button'
            data-dock-panel-no-resize='true'
            icon={<span className='material-symbols-rounded'>{isRunning ? 'stop_circle' : 'play_arrow'}</span>}
            aria-label={primaryActionLabel}
            onClick={() => {
              if (isRunning) {
                terminalPanes.terminateTerminal(pane.id)
                return
              }

              terminalPanes.restartTerminal(pane.id, taskScript)
            }}
          />
        </Tooltip>
        {isRunning && (
          <Tooltip title={t('chat.interactionPanel.runTaskRestart')}>
            <Button
              type='text'
              className='dock-panel__close-btn chat-interaction-panel-run-task__button'
              data-dock-panel-no-resize='true'
              icon={<span className='material-symbols-rounded'>restart_alt</span>}
              aria-label={t('chat.interactionPanel.runTaskRestart')}
              onClick={() => terminalPanes.restartTerminal(pane.id, taskScript)}
            />
          </Tooltip>
        )}
      </aside>
      <div className='chat-interaction-panel-run-task__terminal'>
        <ChatTerminalView
          activeTerminalId={activeTerminalId}
          autoRestartExitedSession={false}
          panes={[pane]}
          sessionId={sessionId}
          onInfoChange={terminalPanes.handleInfoChange}
          onInitialCommandSent={terminalPanes.markInitialCommandSent}
          onRestartChange={terminalPanes.handleRestartChange}
          onTerminateChange={terminalPanes.handleTerminateChange}
        />
      </div>
    </div>
  )
}
