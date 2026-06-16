import { Button, Dropdown, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import { useTranslation } from 'react-i18next'

import type { SenderVoiceInputController } from '../../@types/sender-voice-input'

const formatElapsedTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

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
  const buttonDisabled = state.loadingServices || state.unsupported || !state.canStartRecording
  const serviceMenu = { items: menuItems, onClick: handleMenuClick }

  return (
    <div className='sender-voice-control'>
      <Dropdown
        trigger={['contextMenu']}
        menu={serviceMenu}
      >
        <Tooltip
          title={state.selectedServiceLabel ?? t('chat.voiceInput.tooltip')}
          placement='top'
          mouseEnterDelay={.3}
        >
          <button
            type='button'
            className={[
              'toolbar-btn',
              'sender-voice-control__button',
              state.loadingServices ? 'is-loading' : ''
            ].filter(Boolean).join(' ')}
            aria-label={t('chat.voiceInput.start')}
            aria-disabled={buttonDisabled || undefined}
            disabled={buttonDisabled}
            onClick={handlers.startRecording}
          >
            <span className='toolbar-btn__icon-shell'>
              <span className='material-symbols-rounded'>{state.loadingServices ? 'progress_activity' : 'mic'}</span>
            </span>
          </button>
        </Tooltip>
      </Dropdown>

      <Dropdown
        trigger={['click', 'contextMenu']}
        menu={serviceMenu}
      >
        <Tooltip
          title={t('chat.voiceInput.menu')}
          placement='top'
          mouseEnterDelay={.3}
        >
          <button
            type='button'
            className='toolbar-btn sender-voice-control__menu-button'
            aria-label={t('chat.voiceInput.menu')}
            aria-haspopup='menu'
          >
            <span className='toolbar-btn__icon-shell'>
              <span className='material-symbols-rounded'>more_horiz</span>
            </span>
          </button>
        </Tooltip>
      </Dropdown>

      {state.setupOpen && (
        <div className='sender-voice-setup'>
          <span className='material-symbols-rounded'>settings_voice</span>
          <span className='sender-voice-setup__text'>{t('chat.voiceInput.setupPrompt')}</span>
          <Button
            size='small'
            type='primary'
            icon={<span className='material-symbols-rounded'>open_in_new</span>}
            onClick={handlers.openConfig}
          >
            {t('chat.voiceInput.configure')}
          </Button>
          <Button
            size='small'
            type='text'
            aria-label={t('common.close')}
            icon={<span className='material-symbols-rounded'>close</span>}
            onClick={handlers.dismissSetup}
          />
        </div>
      )}

      {state.errorMessage != null && state.phase === 'idle' && !state.setupOpen && (
        <div className='sender-voice-error'>
          <span className='material-symbols-rounded'>error</span>
          <span className='sender-voice-error__text'>{state.errorMessage}</span>
          {state.canRetry && (
            <Button
              size='small'
              type='text'
              icon={<span className='material-symbols-rounded'>refresh</span>}
              onClick={handlers.retryTranscription}
            >
              {t('chat.voiceInput.retry')}
            </Button>
          )}
          <Button
            size='small'
            type='text'
            icon={<span className='material-symbols-rounded'>settings</span>}
            onClick={handlers.openConfig}
          >
            {t('chat.voiceInput.configure')}
          </Button>
        </div>
      )}
    </div>
  )
}

export function SenderVoiceRecordingBar({
  voiceInput
}: {
  voiceInput: SenderVoiceInputController
}) {
  const { t } = useTranslation()
  const { state, handlers } = voiceInput
  const isTranscribing = state.phase === 'transcribing'

  return (
    <div className='sender-voice-recording'>
      <div className='sender-voice-recording__leading'>
        <span className='material-symbols-rounded'>
          {isTranscribing ? 'progress_activity' : 'graphic_eq'}
        </span>
      </div>
      <div className='sender-voice-waveform' aria-hidden='true'>
        {state.waveformLevels.map((level, index) => (
          <span
            // Waveform bars are positional; no stable domain id exists.
            key={index}
            className='sender-voice-waveform__bar'
            style={{ transform: `scaleY(${Math.max(.08, level)})` }}
          />
        ))}
      </div>
      <div className='sender-voice-recording__time'>
        {isTranscribing ? t('chat.voiceInput.transcribing') : formatElapsedTime(state.elapsedSeconds)}
      </div>
      <Tooltip title={isTranscribing ? t('common.cancel') : t('chat.voiceInput.stop')}>
        <button
          type='button'
          className='sender-voice-recording__action'
          aria-label={isTranscribing ? t('common.cancel') : t('chat.voiceInput.stop')}
          onClick={() => {
            if (isTranscribing) {
              handlers.cancelTranscription()
              return
            }
            handlers.stopRecording()
          }}
        >
          <span className='material-symbols-rounded'>{isTranscribing ? 'close' : 'stop'}</span>
        </button>
      </Tooltip>
      <Tooltip title={t('chat.voiceInput.sendAfterTranscription')}>
        <button
          type='button'
          className='sender-voice-recording__action sender-voice-recording__action--send'
          disabled={isTranscribing || !state.canSendAfterTranscription}
          aria-label={t('chat.voiceInput.sendAfterTranscription')}
          onClick={() => handlers.stopRecording({ sendAfterTranscription: true })}
        >
          <span className='material-symbols-rounded'>send</span>
        </button>
      </Tooltip>
    </div>
  )
}
