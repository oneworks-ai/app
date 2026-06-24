import { Button } from 'antd'
import { useTranslation } from 'react-i18next'

export function InteractionPanelMobileDeviceControls({
  onSendInput
}: {
  onSendInput: (input: DesktopMobileDeviceInputEvent) => void
}) {
  const { t } = useTranslation()
  return (
    <div className='chat-interaction-panel-mobile-debug__device-controls'>
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
    </div>
  )
}

function DeviceToolbarButton({
  icon,
  label,
  onClick
}: {
  icon: string
  label: string
  onClick: () => void
}) {
  return (
    <Button
      type='text'
      size='small'
      className='chat-interaction-panel-mobile-debug__device-control-btn'
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <span className='material-symbols-rounded' aria-hidden='true'>{icon}</span>
    </Button>
  )
}
