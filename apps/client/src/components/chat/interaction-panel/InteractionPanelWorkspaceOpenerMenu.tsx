import { useTranslation } from 'react-i18next'

import type { WorkspaceExternalOpenerId } from '@oneworks/types'

import { OverlayAction, OverlayPanel } from '#~/components/overlay'
import { resolveWorkspaceOpenerIconUrl } from '#~/utils/workspace-file-openers'

const WORKSPACE_MENU_KEY_PREFIX = 'workspace:'

export interface WorkspaceOpenerAction {
  fallbackIcon: string
  iconUrl?: string
  id: WorkspaceExternalOpenerId
  title: string
}

const renderActionIcon = (icon: string, className: string) => <span className={className}>{icon}</span>

export const renderWorkspaceOpenerIcon = ({
  fallbackIcon,
  iconClassName,
  iconUrl,
  title
}: {
  fallbackIcon: string
  iconClassName: string
  iconUrl?: string
  title: string
}) => {
  const resolvedIconUrl = resolveWorkspaceOpenerIconUrl(iconUrl)
  return resolvedIconUrl == null
    ? renderActionIcon(fallbackIcon, iconClassName)
    : <img className='chat-header-app-icon' src={resolvedIconUrl} alt='' aria-hidden='true' title={title} />
}

export function InteractionPanelWorkspaceOpenerMenu({
  actions,
  menuIconClassName,
  onSelect
}: {
  actions: WorkspaceOpenerAction[]
  menuIconClassName: string
  onSelect: (opener: WorkspaceExternalOpenerId) => void
}) {
  const { t } = useTranslation()

  return (
    <OverlayPanel className='chat-header-workspace-opener-menu' role='menu'>
      <div className='chat-header-workspace-opener-menu__list'>
        {actions.length > 0
          ? actions.map(opener => (
            <OverlayAction
              key={`${WORKSPACE_MENU_KEY_PREFIX}${opener.id}`}
              className='chat-header-workspace-opener-menu__item'
              role='menuitem'
              onClick={() => onSelect(opener.id)}
            >
              {renderWorkspaceOpenerIcon({
                fallbackIcon: opener.fallbackIcon,
                iconClassName: menuIconClassName,
                iconUrl: opener.iconUrl,
                title: opener.title
              })}
              <span className='chat-header-workspace-opener-menu__name'>{opener.title}</span>
            </OverlayAction>
          ))
          : (
            <OverlayAction
              className='chat-header-workspace-opener-menu__item'
              role='menuitem'
              disabled
            >
              {renderActionIcon('block', menuIconClassName)}
              <span className='chat-header-workspace-opener-menu__name'>
                {t('chat.interactionPanel.openWorkspaceUnavailable')}
              </span>
            </OverlayAction>
          )}
      </div>
    </OverlayPanel>
  )
}
