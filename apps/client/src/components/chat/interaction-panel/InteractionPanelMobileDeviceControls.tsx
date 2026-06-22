import { Button } from 'antd'
import { useTranslation } from 'react-i18next'

export function InteractionPanelMobileDeviceControls({
  isInspecting,
  onRefresh,
  onSendInput,
  onToggleInspect
}: {
  isInspecting: boolean
  onRefresh: () => void
  onSendInput: (input: DesktopMobileDeviceInputEvent) => void
  onToggleInspect: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className='chat-interaction-panel-mobile-debug__device-controls'>
      <div className='chat-interaction-panel-mobile-debug__device-control-group is-window'>
        <DeviceToolbarButton disabled icon='close' label={t('chat.interactionPanel.mobileDebugWindowClose')} />
        <DeviceToolbarButton disabled icon='minimize' label={t('chat.interactionPanel.mobileDebugWindowMinimize')} />
      </div>
      <div className='chat-interaction-panel-mobile-debug__device-control-group'>
        <DeviceToolbarButton disabled icon='power_settings_new' label={t('chat.interactionPanel.mobileDebugPower')} />
        <DeviceToolbarButton disabled icon='volume_up' label={t('chat.interactionPanel.mobileDebugVolumeUp')} />
        <DeviceToolbarButton disabled icon='volume_down' label={t('chat.interactionPanel.mobileDebugVolumeDown')} />
        <DeviceToolbarButton disabled icon='image' label={t('chat.interactionPanel.mobileDebugScreenshot')} />
        <DeviceToolbarButton disabled icon='zoom_in' label={t('chat.interactionPanel.mobileDebugZoom')} />
        <DeviceToolbarButton disabled icon='restart_alt' label={t('chat.interactionPanel.mobileDebugRotate')} />
      </div>
      <div className='chat-interaction-panel-mobile-debug__device-control-group'>
        <DeviceToolbarButton
          active={isInspecting}
          icon={isInspecting ? 'visibility' : 'touch_app'}
          label={t('chat.interactionPanel.mobileDebugInspectMode')}
          onClick={onToggleInspect}
        />
        <DeviceToolbarButton
          icon='refresh'
          label={t('chat.interactionPanel.mobileDebugRefreshPreview')}
          onClick={onRefresh}
        />
      </div>
      <div className='chat-interaction-panel-mobile-debug__device-control-group is-nav'>
        <DeviceToolbarButton
          icon='arrow_back'
          label={t('chat.interactionPanel.mobileDebugBack')}
          onClick={() => onSendInput({ key: 'back', kind: 'key' })}
        />
        <DeviceToolbarButton
          icon='radio_button_unchecked'
          label={t('chat.interactionPanel.mobileDebugHome')}
          onClick={() => onSendInput({ key: 'home', kind: 'key' })}
        />
        <DeviceToolbarButton
          icon='check_box_outline_blank'
          label={t('chat.interactionPanel.mobileDebugAppSwitch')}
          onClick={() => onSendInput({ key: 'app-switch', kind: 'key' })}
        />
        <DeviceToolbarButton disabled icon='more_horiz' label={t('chat.interactionPanel.mobileDebugMoreControls')} />
      </div>
    </div>
  )
}

function DeviceToolbarButton({
  active,
  disabled,
  icon,
  label,
  onClick
}: {
  active?: boolean
  disabled?: boolean
  icon: string
  label: string
  onClick?: () => void
}) {
  return (
    <Button
      type='text'
      size='small'
      disabled={disabled}
      className={`chat-interaction-panel-mobile-debug__device-control-btn ${active ? 'is-active' : ''}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <span className='material-symbols-rounded' aria-hidden='true'>{icon}</span>
    </Button>
  )
}
