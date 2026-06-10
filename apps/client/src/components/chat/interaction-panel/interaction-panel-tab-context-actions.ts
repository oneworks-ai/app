import type { TFunction } from 'i18next'

import { buildWorkspacePathCopyOptions } from '#~/components/workspace/workspace-path-copy-options'

import type { InteractionPanelIframePage } from './InteractionPanelIframeView'
import { openInteractionPanelExternalUrl } from './interaction-panel-external-url'
import { normalizeFrameUrl } from './interaction-panel-iframe-pages'
import type { InteractionPanelTab } from './interaction-panel-tabs'

export type InteractionPanelTerminalShellKind = Extract<InteractionPanelTab, { kind: 'terminal' }>['shellKind']

export interface InteractionPanelTabContextAction {
  disabled?: boolean
  icon: string
  key: string
  label: string
  run: () => void
}

export const buildInteractionPanelTabContextActions = ({
  iframePage,
  onCopyText,
  onNewTerminal,
  t,
  tab,
  workspaceRootPath
}: {
  iframePage?: InteractionPanelIframePage
  onCopyText: (text: string, successMessage: string) => void
  onNewTerminal: (shellKind?: InteractionPanelTerminalShellKind) => void
  t: TFunction
  tab: InteractionPanelTab
  workspaceRootPath?: string
}): InteractionPanelTabContextAction[] => {
  if (tab.kind === 'file') {
    return buildWorkspacePathCopyOptions({ path: tab.path, t, workspaceRootPath }).map(option => ({
      disabled: option.disabled,
      icon: 'content_copy',
      key: option.key,
      label: option.label,
      run: () => {
        if (option.disabled === true) return
        onCopyText(option.text, option.successMessage)
      }
    }))
  }

  if (tab.kind === 'iframe') {
    const url = normalizeFrameUrl(iframePage?.url ?? '')
    return [
      {
        disabled: url === '',
        icon: 'content_copy',
        key: 'copy-url',
        label: t('chat.interactionPanel.copyIframeUrl'),
        run: () => onCopyText(url, t('chat.interactionPanel.iframeUrlCopied'))
      },
      {
        disabled: url === '',
        icon: 'open_in_new',
        key: 'open-external',
        label: t('chat.interactionPanel.iframeOpenExternalBrowser'),
        run: () => openInteractionPanelExternalUrl(url)
      }
    ]
  }

  if (tab.kind === 'terminal') {
    return [{
      icon: 'terminal',
      key: 'new-same-shell-terminal',
      label: t('chat.interactionPanel.newSameShellTerminal'),
      run: () => onNewTerminal(tab.shellKind)
    }]
  }

  return []
}
