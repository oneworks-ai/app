import { Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { MobileDeviceTabActionButton } from './InteractionPanelMobileDeviceTabActionButton'

const sendMoreControlInput = (
  key: string,
  onReconnect: () => void,
  onSendInput: (input: DesktopMobileDeviceInputEvent) => void
) => {
  if (key === 'reconnect') {
    onReconnect()
    return
  }
  if (key === 'power' || key === 'volume-down' || key === 'volume-up') {
    onSendInput({ key, kind: 'key' })
    return
  }
  if (key === 'collapse-panels' || key === 'notifications' || key === 'quick-settings') {
    onSendInput({ action: key, kind: 'action' })
  }
}

const moreControlItems = [
  ['reconnect', 'sync', 'mobileDebugReconnectPreview'],
  'divider',
  ['power', 'power_settings_new', 'mobileDebugPower'],
  ['volume-up', 'volume_up', 'mobileDebugVolumeUp'],
  ['volume-down', 'volume_down', 'mobileDebugVolumeDown'],
  'divider',
  ['notifications', 'notifications', 'mobileDebugNotifications'],
  ['quick-settings', 'settings_suggest', 'mobileDebugQuickSettings'],
  ['collapse-panels', 'keyboard_arrow_up', 'mobileDebugCollapsePanels']
] as const

export const useMobileDeviceMoreMenu = ({
  onOpenDeviceList,
  onReconnect,
  onSendInput
}: {
  onOpenDeviceList?: () => void
  onReconnect: () => void
  onSendInput: (input: DesktopMobileDeviceInputEvent) => void
}) => {
  const { t } = useTranslation()
  const controlItems: MenuProps['items'] = moreControlItems.map((item) => {
    if (item === 'divider') return { type: 'divider' }
    const [key, icon, labelKey] = item
    return {
      icon: <span className='material-symbols-rounded' aria-hidden='true'>{icon}</span>,
      key,
      label: t(`chat.interactionPanel.${labelKey}`)
    }
  })
  const items: MenuProps['items'] = onOpenDeviceList == null
    ? controlItems
    : [
      {
        icon: <span className='material-symbols-rounded' aria-hidden='true'>devices</span>,
        key: 'device-list',
        label: t('chat.interactionPanel.mobileDebugBackToDeviceList')
      },
      { type: 'divider' },
      ...controlItems
    ]

  return {
    items,
    onClick: ({ key }: { key: string }) => {
      if (key === 'device-list') {
        onOpenDeviceList?.()
        return
      }
      sendMoreControlInput(key, onReconnect, onSendInput)
    }
  }
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
  const moreMenu = useMobileDeviceMoreMenu({ onReconnect: onRefresh, onSendInput })

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
