import { App, Button, Dropdown } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import type { WorkspaceExternalOpenerId, WorkspaceTerminalOpenerId } from '@oneworks/types'

import {
  getApiErrorMessage,
  getWorkspacePathActionCapabilities,
  listWorkspaceFileOpeners,
  openWorkspaceInExternalOpener
} from '#~/api'
import { getWorkspaceFileOpenerIcon } from '#~/utils/workspace-file-openers'

import { InteractionPanelWorkspaceOpenerMenu, renderWorkspaceOpenerIcon } from './InteractionPanelWorkspaceOpenerMenu'
import type { WorkspaceOpenerAction } from './InteractionPanelWorkspaceOpenerMenu'
import {
  readInteractionPanelPreferredWorkspaceOpenerId,
  writeInteractionPanelPreferredWorkspaceOpenerId
} from './interaction-panel-workspace-openers'

const WORKSPACE_TERMINAL_OPENER_ICONS: Record<WorkspaceTerminalOpenerId, string> = {
  terminal: 'terminal',
  warp: 'bolt'
}

export function InteractionPanelWorkspaceOpener({
  iconClassName,
  menuIconClassName
}: {
  iconClassName: string
  menuIconClassName: string
}) {
  const { t } = useTranslation()
  const {
    defaultWorkspaceOpener,
    defaultWorkspaceOpenerLabel,
    handleOpenWorkspace,
    isMenuOpen,
    setIsMenuOpen,
    workspaceOpenerActions
  } = useInteractionPanelWorkspaceOpeners()

  return (
    <div className='chat-header-workspace-opener'>
      <Button
        type='text'
        className='chat-header-workspace-opener__primary'
        data-dock-panel-no-resize='true'
        disabled={defaultWorkspaceOpener == null}
        icon={defaultWorkspaceOpener == null
          ? <span className={iconClassName}>drive_file_move</span>
          : renderWorkspaceOpenerIcon({
            fallbackIcon: defaultWorkspaceOpener.fallbackIcon,
            iconClassName,
            iconUrl: defaultWorkspaceOpener.iconUrl,
            title: defaultWorkspaceOpener.title
          })}
        title={defaultWorkspaceOpenerLabel}
        aria-label={defaultWorkspaceOpenerLabel}
        onClick={() => {
          if (defaultWorkspaceOpener != null) {
            handleOpenWorkspace(defaultWorkspaceOpener.id)
          }
        }}
      />
      <Dropdown
        open={isMenuOpen}
        menu={{ items: [] }}
        popupRender={() => (
          <InteractionPanelWorkspaceOpenerMenu
            actions={workspaceOpenerActions}
            menuIconClassName={menuIconClassName}
            onSelect={(opener) => {
              setIsMenuOpen(false)
              handleOpenWorkspace(opener)
            }}
          />
        )}
        overlayClassName='chat-header-workspace-opener-dropdown'
        onOpenChange={setIsMenuOpen}
        trigger={['click']}
      >
        <Button
          type='text'
          className='chat-header-workspace-opener__menu'
          data-dock-panel-no-resize='true'
          icon={<span className={iconClassName}>expand_more</span>}
          title={t('chat.interactionPanel.openWorkspace')}
          aria-label={t('chat.interactionPanel.openWorkspace')}
        />
      </Dropdown>
    </div>
  )
}

export function useInteractionPanelWorkspaceOpeners() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [preferredWorkspaceOpenerId, setPreferredWorkspaceOpenerId] = useState(
    readInteractionPanelPreferredWorkspaceOpenerId
  )
  const { data: workspaceFileOpeners } = useSWR('workspace-file-openers', listWorkspaceFileOpeners)
  const { data: pathActionCapabilities } = useSWR(
    'workspace-path-action-capabilities',
    getWorkspacePathActionCapabilities
  )
  const fileManager = pathActionCapabilities?.fileManager

  const workspaceOpenerActions = useMemo<WorkspaceOpenerAction[]>(() => {
    const actions: WorkspaceOpenerAction[] = []
    const fileOpeners = workspaceFileOpeners?.openers ?? []
    const defaultFileOpener = fileOpeners.find(opener =>
      opener.available && opener.id === workspaceFileOpeners?.defaultOpener
    )

    if (defaultFileOpener != null) {
      actions.push({
        fallbackIcon: getWorkspaceFileOpenerIcon(defaultFileOpener.id),
        iconUrl: defaultFileOpener.iconUrl,
        id: defaultFileOpener.id,
        title: defaultFileOpener.title
      })
    }

    if (fileManager?.available === true) {
      actions.push({
        fallbackIcon: 'folder_open',
        iconUrl: fileManager.iconUrl,
        id: 'fileManager',
        title: fileManager.title
      })
    }

    for (const opener of pathActionCapabilities?.terminalOpeners ?? []) {
      if (!opener.available) continue
      actions.push({
        fallbackIcon: WORKSPACE_TERMINAL_OPENER_ICONS[opener.id],
        iconUrl: opener.iconUrl,
        id: opener.id,
        title: opener.title
      })
    }

    for (const opener of fileOpeners) {
      if (!opener.available || opener.id === defaultFileOpener?.id) continue
      actions.push({
        fallbackIcon: getWorkspaceFileOpenerIcon(opener.id),
        iconUrl: opener.iconUrl,
        id: opener.id,
        title: opener.title
      })
    }

    return actions
  }, [
    fileManager?.available,
    fileManager?.iconUrl,
    fileManager?.title,
    pathActionCapabilities?.terminalOpeners,
    workspaceFileOpeners?.defaultOpener,
    workspaceFileOpeners?.openers
  ])

  const defaultWorkspaceOpener = workspaceOpenerActions.find(action => action.id === preferredWorkspaceOpenerId) ??
    workspaceOpenerActions.find(action => action.id === workspaceFileOpeners?.defaultOpener) ??
    (workspaceFileOpeners == null ? undefined : workspaceOpenerActions[0])
  const defaultWorkspaceOpenerLabel = defaultWorkspaceOpener == null
    ? t('chat.interactionPanel.openWorkspaceUnavailable')
    : t('chat.interactionPanel.openWorkspaceWith', { opener: defaultWorkspaceOpener.title })
  const handleOpenWorkspace = (opener: WorkspaceExternalOpenerId) => {
    void openWorkspaceInExternalOpener({ opener })
      .then(() => {
        setPreferredWorkspaceOpenerId(opener)
        writeInteractionPanelPreferredWorkspaceOpenerId(opener)
      })
      .catch((error) => {
        void message.error(getApiErrorMessage(error, t('chat.interactionPanel.openWorkspaceFailed')))
      })
  }

  return {
    defaultWorkspaceOpener,
    defaultWorkspaceOpenerLabel,
    handleOpenWorkspace,
    isMenuOpen,
    setIsMenuOpen,
    workspaceOpenerActions
  }
}
