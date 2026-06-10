import { Button } from 'antd'
import { Fragment, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { OverlayAction, OverlayDivider } from '#~/components/overlay'

import { getInteractionPanelRunCommandIcon, getInteractionPanelRunCommandTitle } from './interaction-panel-run-commands'
import type { InteractionPanelRunCommand, InteractionPanelRunCommandTaskStatus } from './interaction-panel-run-commands'

const sortRunCommands = (commands: InteractionPanelRunCommand[]) => (
  commands
    .map((command, index) => ({ command, index }))
    .sort((left, right) => {
      const favoriteDelta = Number(right.command.isFavorite === true) - Number(left.command.isFavorite === true)
      return favoriteDelta === 0 ? left.index - right.index : favoriteDelta
    })
    .map(item => item.command)
)

export function InteractionPanelRunCommandMenu({
  commands,
  menuIconClassName,
  runCommandTaskStatusByCommandId,
  onAdd,
  onDelete,
  onEdit,
  onRun,
  onTerminateTask,
  onToggleFavorite
}: {
  commands: InteractionPanelRunCommand[]
  menuIconClassName: string
  runCommandTaskStatusByCommandId: Map<string, InteractionPanelRunCommandTaskStatus>
  onAdd: () => void
  onDelete: (commandId: string) => void
  onEdit: (command: InteractionPanelRunCommand) => void
  onRun: (command: InteractionPanelRunCommand) => void
  onTerminateTask?: (terminalId: string) => void
  onToggleFavorite: (commandId: string) => void
}) {
  const { t } = useTranslation()
  const sortedCommands = useMemo(() => sortRunCommands(commands), [commands])

  return (
    <div className='chat-header-run-command-panel chat-header-run-command-menu'>
      <div className='chat-header-run-command-menu__list' role='menu'>
        {sortedCommands.map((command, index) => (
          <Fragment key={command.id}>
            {index > 0 && sortedCommands[index - 1]?.isFavorite === true && command.isFavorite !== true && (
              <OverlayDivider className='chat-header-run-command-menu__divider' />
            )}
            <div className='chat-header-run-command-menu__row'>
              <OverlayAction
                className='chat-header-run-command-menu__run'
                role='menuitem'
                onClick={() => onRun(command)}
              >
                <span className={menuIconClassName}>{getInteractionPanelRunCommandIcon(command)}</span>
                <span className='chat-header-run-command-menu__name'>
                  {getInteractionPanelRunCommandTitle(command)}
                </span>
                {runCommandTaskStatusByCommandId.get(command.id)?.isRunning === true && (
                  <span
                    className='chat-header-run-command-menu__status material-symbols-rounded'
                    title={t('chat.interactionPanel.runTaskTerminate')}
                    aria-label={t('chat.interactionPanel.runTaskTerminate')}
                    onClick={(event) => {
                      event.stopPropagation()
                      const taskStatus = runCommandTaskStatusByCommandId.get(command.id)
                      if (taskStatus != null) onTerminateTask?.(taskStatus.terminalId)
                    }}
                  >
                    stop_circle
                  </span>
                )}
              </OverlayAction>
              <div className='chat-header-run-command-menu__actions'>
                <Button
                  type='text'
                  size='small'
                  className='chat-header-run-command-menu__action'
                  icon={
                    <span className={`material-symbols-rounded ${command.isFavorite === true ? 'is-filled' : ''}`}>
                      star
                    </span>
                  }
                  title={t(
                    command.isFavorite === true
                      ? 'chat.interactionPanel.unfavoriteRunCommand'
                      : 'chat.interactionPanel.favoriteRunCommand'
                  )}
                  aria-label={t(
                    command.isFavorite === true
                      ? 'chat.interactionPanel.unfavoriteRunCommand'
                      : 'chat.interactionPanel.favoriteRunCommand'
                  )}
                  onClick={() => onToggleFavorite(command.id)}
                />
                <Button
                  type='text'
                  size='small'
                  className='chat-header-run-command-menu__action'
                  icon={<span className='material-symbols-rounded'>edit</span>}
                  title={t('chat.interactionPanel.editRunCommand')}
                  aria-label={t('chat.interactionPanel.editRunCommand')}
                  onClick={() => onEdit(command)}
                />
                <Button
                  type='text'
                  size='small'
                  className='chat-header-run-command-menu__action'
                  icon={<span className='material-symbols-rounded'>delete</span>}
                  title={t('chat.interactionPanel.removeRunCommand')}
                  aria-label={t('chat.interactionPanel.removeRunCommand')}
                  onClick={() => onDelete(command.id)}
                />
              </div>
            </div>
          </Fragment>
        ))}
      </div>
      <OverlayDivider className='chat-header-run-command-menu__divider' />
      <OverlayAction
        className='chat-header-run-command-menu__add'
        onClick={onAdd}
      >
        <span className='material-symbols-rounded'>add_box</span>
        {t('chat.interactionPanel.addRunCommand')}
      </OverlayAction>
    </div>
  )
}
