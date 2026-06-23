import { Button, Dropdown, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import { useTranslation } from 'react-i18next'

const sendMoreControlInput = (
  key: string,
  onSendInput: (input: DesktopMobileDeviceInputEvent) => void
) => {
  if (key === 'power' || key === 'volume-down' || key === 'volume-up') {
    onSendInput({ key, kind: 'key' })
    return
  }
  if (key === 'collapse-panels' || key === 'notifications' || key === 'quick-settings') {
    onSendInput({ action: key, kind: 'action' })
  }
}

const moreControlItems = [
  ['power', 'power_settings_new', 'mobileDebugPower'],
  ['volume-up', 'volume_up', 'mobileDebugVolumeUp'],
  ['volume-down', 'volume_down', 'mobileDebugVolumeDown'],
  'divider',
  ['notifications', 'notifications', 'mobileDebugNotifications'],
  ['quick-settings', 'settings_suggest', 'mobileDebugQuickSettings'],
  ['collapse-panels', 'keyboard_arrow_up', 'mobileDebugCollapsePanels']
] as const

const useMobileDeviceMoreMenu = (onSendInput: (input: DesktopMobileDeviceInputEvent) => void) => {
  const { t } = useTranslation()
  const items: MenuProps['items'] = moreControlItems.map((item) => {
    if (item === 'divider') return { type: 'divider' }
    const [key, icon, labelKey] = item
    return {
      icon: <span className='material-symbols-rounded' aria-hidden='true'>{icon}</span>,
      key,
      label: t(`chat.interactionPanel.${labelKey}`)
    }
  })

  return {
    items,
    onClick: ({ key }: { key: string }) => sendMoreControlInput(key, onSendInput)
  }
}

export function MobileDeviceTabActionButton({
  active,
  icon,
  label,
  onClick
}: {
  active?: boolean
  icon: string
  label: string
  onClick?: () => void
}) {
  return (
    <Button
      type='text'
      size='small'
      className={`chat-interaction-panel-mobile-debug__tab-action ${active ? 'is-active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active == null ? undefined : active}
      onClick={event => {
        if (onClick == null) return
        event.preventDefault()
        onClick()
      }}
    >
      <span className='material-symbols-rounded' aria-hidden='true'>{icon}</span>
    </Button>
  )
}

export function MobileDeviceInlineTabActions({
  onRefresh,
  onSendInput,
  onToggleSidePanel
}: {
  onRefresh: () => void
  onSendInput: (input: DesktopMobileDeviceInputEvent) => void
  onToggleSidePanel: () => void
}) {
  const { t } = useTranslation()
  const moreMenu = useMobileDeviceMoreMenu(onSendInput)

  return (
    <div className='chat-interaction-panel-mobile-debug__tab-actions'>
      <MobileDeviceTabActionButton
        icon='right_panel_close'
        label={t('chat.interactionPanel.mobileDebugHideSidePanel')}
        onClick={onToggleSidePanel}
      />
      <MobileDeviceTabActionButton
        icon='refresh'
        label={t('chat.interactionPanel.mobileDebugRefreshPreview')}
        onClick={onRefresh}
      />
      <MobileDeviceTabActionButton
        icon='restart_alt'
        label={t('chat.interactionPanel.mobileDebugRotate')}
        onClick={() => onSendInput({ action: 'rotate', kind: 'action' })}
      />
      <Dropdown menu={moreMenu} placement='bottomRight' trigger={['click']}>
        <span>
          <MobileDeviceTabActionButton
            icon='more_vert'
            label={t('chat.interactionPanel.mobileDebugMoreControls')}
          />
        </span>
      </Dropdown>
    </div>
  )
}

function StandaloneDeviceHeaderActionButton({
  active,
  icon,
  label,
  onClick
}: {
  active?: boolean
  icon: string
  label: string
  onClick?: () => void
}) {
  return (
    <Tooltip title={label} placement='bottom'>
      <Button
        type='text'
        className={`standalone-mobile-debug-route__header-action ${active ? 'is-active' : ''}`}
        aria-label={label}
        aria-pressed={active == null ? undefined : active}
        onClick={onClick}
      >
        <span className='material-symbols-rounded standalone-mobile-debug-route__header-action-icon' aria-hidden='true'>
          {icon}
        </span>
      </Button>
    </Tooltip>
  )
}

export function MobileDeviceStandaloneHeaderActions({
  isSidePanelVisible,
  onRefresh,
  onSendInput,
  onToggleSidePanel
}: {
  isSidePanelVisible: boolean
  onRefresh: () => void
  onSendInput: (input: DesktopMobileDeviceInputEvent) => void
  onToggleSidePanel: () => void
}) {
  const { t } = useTranslation()
  const moreMenu = useMobileDeviceMoreMenu(onSendInput)

  return (
    <div className='chat-interaction-panel-mobile-debug__standalone-header-actions'>
      <StandaloneDeviceHeaderActionButton
        active={!isSidePanelVisible}
        icon={isSidePanelVisible ? 'right_panel_close' : 'right_panel_open'}
        label={t(
          isSidePanelVisible
            ? 'chat.interactionPanel.mobileDebugHideSidePanel'
            : 'chat.interactionPanel.mobileDebugShowSidePanel'
        )}
        onClick={onToggleSidePanel}
      />
      <StandaloneDeviceHeaderActionButton
        icon='refresh'
        label={t('chat.interactionPanel.mobileDebugRefreshPreview')}
        onClick={onRefresh}
      />
      <StandaloneDeviceHeaderActionButton
        icon='restart_alt'
        label={t('chat.interactionPanel.mobileDebugRotate')}
        onClick={() => onSendInput({ action: 'rotate', kind: 'action' })}
      />
      <Dropdown menu={moreMenu} placement='bottomRight' trigger={['click']}>
        <span className='standalone-mobile-debug-route__popover-trigger'>
          <StandaloneDeviceHeaderActionButton
            icon='more_vert'
            label={t('chat.interactionPanel.mobileDebugMoreControls')}
          />
        </span>
      </Dropdown>
    </div>
  )
}
