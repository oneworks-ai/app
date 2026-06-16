import { Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'

import type { SenderVoiceInputController } from '../../@types/sender-voice-input'

const formatElapsedTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
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
