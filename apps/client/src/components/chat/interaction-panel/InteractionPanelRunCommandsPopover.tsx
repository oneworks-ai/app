/* eslint-disable max-lines -- run command popover coordinates menu, editor shortcuts, and close behavior. */
import { App, Popover } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { RouteHeaderActionButton, readRouteHeaderIsMac } from '@oneworks/components/route-layout'

import { InteractionPanelRunCommandEditor } from './InteractionPanelRunCommandEditor'
import { InteractionPanelRunCommandMenu } from './InteractionPanelRunCommandMenu'
import { InteractionPanelRunCommandsTrigger } from './InteractionPanelRunCommandsTrigger'
import {
  cloneInteractionPanelRunCommand,
  createInteractionPanelRunCommand,
  normalizeInteractionPanelRunCommands
} from './interaction-panel-run-commands'
import type { InteractionPanelRunCommand, InteractionPanelRunCommandTaskStatus } from './interaction-panel-run-commands'

type RunCommandEditorMode = 'menu' | 'editor'

export function InteractionPanelRunCommandsPopover({
  commands,
  iconClassName,
  lastRunCommandId,
  menuIconClassName,
  runCommandTaskStatuses,
  onRunCommand,
  onTerminateRunCommandTask,
  recordRunCommand,
  saveCommands
}: {
  commands: InteractionPanelRunCommand[]
  iconClassName: string
  lastRunCommandId: string | null
  menuIconClassName: string
  runCommandTaskStatuses: InteractionPanelRunCommandTaskStatus[]
  onRunCommand: (command: InteractionPanelRunCommand) => void
  onTerminateRunCommandTask?: (terminalId: string) => void
  recordRunCommand: (commandId: string) => void
  saveCommands: (commands: InteractionPanelRunCommand[]) => void
}) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<RunCommandEditorMode>('menu')
  const [editingCommandId, setEditingCommandId] = useState<string | null>(null)
  const [draftCommand, setDraftCommand] = useState<InteractionPanelRunCommand>(() => createInteractionPanelRunCommand())
  const escapeClosePrimedRef = useRef(false)
  const escapeCloseTimerRef = useRef<number | null>(null)
  const runCommandTaskStatusByCommandId = useMemo(
    () => new Map(runCommandTaskStatuses.map(status => [status.commandId, status])),
    [runCommandTaskStatuses]
  )
  const canSaveDraft = draftCommand.script.trim() !== ''

  const resetEscapeClosePrompt = useCallback(() => {
    escapeClosePrimedRef.current = false
    if (escapeCloseTimerRef.current == null) return

    window.clearTimeout(escapeCloseTimerRef.current)
    escapeCloseTimerRef.current = null
  }, [])

  const openEditor = (command?: InteractionPanelRunCommand) => {
    resetEscapeClosePrompt()
    setDraftCommand(command == null ? createInteractionPanelRunCommand() : cloneInteractionPanelRunCommand(command))
    setEditingCommandId(command?.id ?? null)
    setMode('editor')
    setIsOpen(true)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setIsOpen(nextOpen)
    if (!nextOpen) {
      resetEscapeClosePrompt()
      return
    }

    if (commands.length === 0) {
      openEditor()
      return
    }

    setMode('menu')
  }

  const saveDraftCommand = () => {
    if (!canSaveDraft) return null

    const isEditingExisting = editingCommandId != null && commands.some(command => command.id === editingCommandId)
    const nextCommands = isEditingExisting
      ? commands.map(command => command.id === editingCommandId ? draftCommand : command)
      : [...commands, draftCommand]
    const normalizedCommands = normalizeInteractionPanelRunCommands(nextCommands)
    saveCommands(normalizedCommands)
    const savedCommand = normalizedCommands.find(command => command.id === draftCommand.id) ?? null
    if (savedCommand != null) {
      setEditingCommandId(savedCommand.id)
      setDraftCommand(cloneInteractionPanelRunCommand(savedCommand))
    }
    return savedCommand
  }

  const deleteDraftCommand = () => {
    if (editingCommandId == null) {
      setIsOpen(false)
      return
    }

    const nextCommands = commands.filter(command => command.id !== editingCommandId)
    saveCommands(nextCommands)
    if (nextCommands.length === 0) {
      openEditor()
      return
    }

    setEditingCommandId(null)
    setMode('menu')
  }

  const deleteCommand = (commandId: string) => {
    const nextCommands = commands.filter(command => command.id !== commandId)
    saveCommands(nextCommands)
    if (nextCommands.length === 0) {
      openEditor()
    }
  }

  const toggleFavoriteCommand = (commandId: string) => {
    saveCommands(
      commands.map(command =>
        command.id === commandId ? { ...command, isFavorite: command.isFavorite !== true } : command
      )
    )
  }

  const handleSave = () => {
    if (saveDraftCommand() == null) return

    setIsOpen(false)
  }

  const handleSaveInPlace = () => {
    saveDraftCommand()
  }

  const handleSaveAndRun = () => {
    const command = saveDraftCommand()
    if (command != null) {
      runCommand(command)
    }
    setIsOpen(false)
  }

  const handleSaveAndRunInPlace = () => {
    const command = saveDraftCommand()
    if (command != null) {
      runCommand(command)
    }
  }

  const runCommand = (command: InteractionPanelRunCommand) => {
    recordRunCommand(command.id)
    onRunCommand(command)
  }

  const isEditorVisible = isOpen && (mode === 'editor' || commands.length === 0)

  useEffect(() => {
    if (!isEditorVisible) {
      resetEscapeClosePrompt()
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Esc') return

      event.preventDefault()
      event.stopPropagation()
      if (escapeClosePrimedRef.current) {
        setIsOpen(false)
        resetEscapeClosePrompt()
        return
      }

      escapeClosePrimedRef.current = true
      void message.info(t('chat.interactionPanel.runCommandEscClosePrompt'))
      escapeCloseTimerRef.current = window.setTimeout(() => {
        escapeCloseTimerRef.current = null
        escapeClosePrimedRef.current = false
      }, 1600)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isEditorVisible, message, resetEscapeClosePrompt, t])

  const primaryRunCommand = commands.find(command => command.id === lastRunCommandId) ??
    commands.find(command => command.isFavorite === true) ??
    commands[0]
  const menuContent = (
    <InteractionPanelRunCommandMenu
      commands={commands}
      menuIconClassName={menuIconClassName}
      runCommandTaskStatusByCommandId={runCommandTaskStatusByCommandId}
      onAdd={() => openEditor()}
      onDelete={deleteCommand}
      onEdit={openEditor}
      onRun={(command) => {
        runCommand(command)
        setIsOpen(false)
      }}
      onTerminateTask={onTerminateRunCommandTask}
      onToggleFavorite={toggleFavoriteCommand}
    />
  )

  const editorContent = (
    <InteractionPanelRunCommandEditor
      canSave={canSaveDraft}
      command={draftCommand}
      hasCommands={commands.length > 0}
      onBack={() => setMode('menu')}
      onCancel={() => setIsOpen(false)}
      onChange={patch => setDraftCommand(current => ({ ...current, ...patch }))}
      onDelete={deleteDraftCommand}
      onRun={handleSaveAndRun}
      onRunShortcut={handleSaveAndRunInPlace}
      onSave={handleSave}
      onSaveShortcut={handleSaveInPlace}
    />
  )
  const runEditorPopover = (
    <Popover
      content={editorContent}
      open={isOpen}
      onOpenChange={handleOpenChange}
      placement='bottomRight'
      trigger='click'
      classNames={{ root: 'chat-header-run-command-popover' }}
      destroyOnHidden
      arrow={false}
    >
      <InteractionPanelRunCommandsTrigger
        command={primaryRunCommand}
        iconClassName={iconClassName}
        taskStatus={primaryRunCommand == null ? undefined : runCommandTaskStatusByCommandId.get(primaryRunCommand.id)}
        onTerminateTask={onTerminateRunCommandTask}
        onPrimaryClick={() => {
          openEditor()
        }}
      />
    </Popover>
  )

  if (commands.length === 0) {
    return runEditorPopover
  }

  return (
    <InteractionPanelRunCommandsTrigger
      command={primaryRunCommand}
      iconClassName={iconClassName}
      taskStatus={primaryRunCommand == null ? undefined : runCommandTaskStatusByCommandId.get(primaryRunCommand.id)}
      onTerminateTask={onTerminateRunCommandTask}
      onPrimaryClick={() => {
        if (primaryRunCommand == null) {
          openEditor()
          return
        }

        runCommand(primaryRunCommand)
      }}
    >
      <Popover
        content={mode === 'editor' || commands.length === 0 ? editorContent : menuContent}
        open={isOpen}
        onOpenChange={handleOpenChange}
        placement='bottomRight'
        trigger='click'
        classNames={{ root: 'chat-header-run-command-popover' }}
        destroyOnHidden
        arrow={false}
      >
        <RouteHeaderActionButton
          isMac={readRouteHeaderIsMac()}
          buttonClassName='chat-header-run-command-trigger__menu'
          data-dock-panel-no-resize='true'
          icon={<span className={iconClassName}>expand_more</span>}
          label={t('chat.interactionPanel.runCommands')}
          tooltipTitle={t('chat.interactionPanel.runCommands')}
        />
      </Popover>
    </InteractionPanelRunCommandsTrigger>
  )
}
