import type { TFunction } from 'i18next'

import { isWorkspaceShellScriptPath } from '#~/components/chat/workspace-file-editor/workspace-file-editor-language'

import type { InteractionPanelRunCommand } from './interaction-panel-run-commands'
import type { InteractionPanelTab } from './interaction-panel-tabs'

export interface InteractionPanelTabHeaderAction {
  icon: string
  key: string
  label: string
  run: () => void
}

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

const getFileName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

const buildShellFileRunCommand = (
  tab: Extract<InteractionPanelTab, { kind: 'file' }>,
  t: TFunction,
  workspaceRootPath?: string
): InteractionPanelRunCommand => {
  const fileName = getFileName(tab.path)
  const title = t('chat.interactionPanel.runShellFileTitle', { file: fileName })
  const cwd = workspaceRootPath?.trim()

  return {
    ...(cwd == null || cwd === '' ? {} : { cwd }),
    icon: 'play_arrow',
    id: `workspace-file:${tab.path}:run-shell-script`,
    name: title,
    script: `bash ${shellQuote(tab.path)}`
  }
}

export const buildInteractionPanelTabHeaderActions = ({
  onRunCommand,
  t,
  tab,
  workspaceRootPath
}: {
  onRunCommand: (command: InteractionPanelRunCommand) => void
  t: TFunction
  tab?: InteractionPanelTab
  workspaceRootPath?: string
}): InteractionPanelTabHeaderAction[] => {
  if (tab?.kind === 'file' && isWorkspaceShellScriptPath(tab.path)) {
    const command = buildShellFileRunCommand(tab, t, workspaceRootPath)
    return [{
      icon: 'play_arrow',
      key: 'run-shell-file',
      label: t('chat.interactionPanel.runShellFile'),
      run: () => onRunCommand(command)
    }]
  }

  return []
}
