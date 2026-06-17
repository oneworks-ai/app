import { Button, Dropdown, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import { useTranslation } from 'react-i18next'

import type { SenderVoiceInputController } from '../../@types/sender-voice-input'

export function SenderVoiceControl({
  voiceInput
}: {
  voiceInput: SenderVoiceInputController
}) {
  const { t } = useTranslation()
  const { state, handlers } = voiceInput
  const effectiveSelectedServiceId = state.selectedServiceId ??
    state.services.find(service => service.enabled && service.default)?.id
  const effectiveSelectedService = state.services.find(service => service.id === effectiveSelectedServiceId)
  const menuItems: MenuProps['items'] = [
    ...state.services.map(service => ({
      key: `service:${service.id}`,
      disabled: !service.enabled,
      icon: (
        <span className='material-symbols-rounded'>
          {effectiveSelectedServiceId === service.id ? 'radio_button_checked' : 'radio_button_unchecked'}
        </span>
      ),
      label: (
        <div className='sender-voice-menu-item'>
          <span>{service.label}</span>
          {service.default && (
            <span className='sender-voice-menu-item__badge'>{t('chat.voiceInput.defaultService')}</span>
          )}
        </div>
      )
    })),
    ...(state.services.length > 0
      ? [
        { type: 'divider' as const },
        {
          key: 'set-default',
          disabled: effectiveSelectedServiceId == null || state.settingDefaultServiceId != null,
          icon: (
            <span className='material-symbols-rounded'>
              {state.settingDefaultServiceId != null ? 'progress_activity' : 'star'}
            </span>
          ),
          label: t('chat.voiceInput.setDefault', {
            name: effectiveSelectedService?.label ?? effectiveSelectedServiceId ?? ''
          })
        },
        { type: 'divider' as const }
      ]
      : []),
    {
      key: 'config',
      icon: <span className='material-symbols-rounded'>settings</span>,
      label: t('chat.voiceInput.configure')
    }
  ]
  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'config') {
      handlers.openConfig()
      return
    }
    if (key === 'set-default' && effectiveSelectedServiceId != null) {
      handlers.setDefaultService(effectiveSelectedServiceId)
      return
    }
    if (typeof key === 'string' && key.startsWith('service:')) {
      handlers.selectService(key.slice('service:'.length))
    }
  }
  const isRecording = state.phase === 'recording'
  const isTranscribing = state.phase === 'transcribing'
  const isVoiceActive = isRecording || isTranscribing
  const buttonDisabled = !isVoiceActive && (state.loadingServices || state.unsupported || !state.canStartRecording)
  const buttonClickDisabled = !isVoiceActive && (buttonDisabled || state.setupOpen)
  const serviceMenu = { items: menuItems, onClick: handleMenuClick }
  const activeButtonLabel = isTranscribing ? t('common.cancel') : t('chat.voiceInput.stop')
  const buttonTooltip = isVoiceActive ? activeButtonLabel : state.selectedServiceLabel ?? t('chat.voiceInput.tooltip')
  const buttonAriaLabel = isVoiceActive ? activeButtonLabel : t('chat.voiceInput.start')
  const buttonIcon = isTranscribing || state.loadingServices ? 'progress_activity' : isRecording ? 'stop' : 'mic'
  const handleVoiceButtonClick = () => {
    if (buttonClickDisabled) return
    if (isTranscribing) {
      handlers.cancelTranscription()
      return
    }
    if (isRecording) {
      handlers.stopRecording()
      return
    }
    handlers.startRecording()
  }
  const errorActions: Array<{ ariaLabel: string; icon: string; key: string; onClick: () => void }> = []
  if (state.canRetry) {
    errorActions.push({
      ariaLabel: t('chat.voiceInput.retry'),
      icon: 'refresh',
      key: 'retry',
      onClick: handlers.retryTranscription
    })
  }
  if (state.errorCanOpenConfig) {
    errorActions.push({
      ariaLabel: t('chat.voiceInput.configure'),
      icon: 'settings',
      key: 'config',
      onClick: handlers.openConfig
    })
  }
  errorActions.push({ ariaLabel: t('common.close'), icon: 'close', key: 'close', onClick: handlers.dismissNotice })

  return (
    <div className='sender-voice-control'>
      <Dropdown
        trigger={['contextMenu']}
        menu={serviceMenu}
      >
        <Tooltip
          title={buttonTooltip}
          placement='top'
          mouseEnterDelay={.3}
        >
          <button
            type='button'
            className={[
              'toolbar-btn',
              'sender-voice-control__button',
              state.loadingServices || isTranscribing ? 'is-loading' : '',
              isRecording ? 'is-recording' : '',
              state.setupOpen ? 'is-click-disabled' : ''
            ].filter(Boolean).join(' ')}
            aria-label={buttonAriaLabel}
            aria-disabled={buttonClickDisabled || undefined}
            disabled={buttonDisabled}
            onClick={handleVoiceButtonClick}
          >
            <span className='toolbar-btn__icon-shell'>
              <span className='material-symbols-rounded'>{buttonIcon}</span>
            </span>
          </button>
        </Tooltip>
      </Dropdown>

      {state.setupOpen && (
        <div className='sender-voice-setup'>
          <Button
            size='small'
            type='text'
            className='sender-voice-setup__action'
            onClick={handlers.openConfig}
          >
            {t('chat.voiceInput.setupAction')}
          </Button>
          <Button
            size='small'
            type='text'
            className='sender-voice-setup__close'
            aria-label={t('common.close')}
            icon={<span className='material-symbols-rounded'>close</span>}
            onClick={handlers.dismissNotice}
          />
        </div>
      )}

      {state.errorMessage != null && state.phase === 'idle' && !state.setupOpen && (
        <div className='sender-voice-error'>
          <span className='material-symbols-rounded sender-voice-error__icon'>error</span>
          <span className='sender-voice-error__text' title={state.errorMessage}>{state.errorMessage}</span>
          {errorActions.map(action => (
            <button
              key={action.key}
              type='button'
              className='toolbar-btn sender-voice-error__action'
              aria-label={action.ariaLabel}
              onClick={action.onClick}
            >
              <span className='toolbar-btn__icon-shell'>
                <span className='material-symbols-rounded'>{action.icon}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
