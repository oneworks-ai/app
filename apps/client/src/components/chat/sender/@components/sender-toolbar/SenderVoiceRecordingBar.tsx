import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SenderVoiceInputController } from '../../@types/sender-voice-input'

const WAVEFORM_BAR_WIDTH = 3
const WAVEFORM_BAR_GAP = 2

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
  const { state } = voiceInput
  const { setWaveformCapacity } = voiceInput.handlers
  const [waveformNode, setWaveformNode] = useState<HTMLDivElement | null>(null)
  const waveformRef = useCallback((node: HTMLDivElement | null) => {
    setWaveformNode(node)
  }, [])
  const isRequesting = state.phase === 'requesting'
  const isTranscribing = state.phase === 'transcribing'
  const phaseAnnouncement = isTranscribing
    ? t('chat.voiceInput.transcribing')
    : t('chat.voiceInput.stop')

  useEffect(() => {
    if (waveformNode == null) return undefined

    const updateCapacity = () => {
      const width = waveformNode.getBoundingClientRect().width
      setWaveformCapacity(Math.floor((width + WAVEFORM_BAR_GAP) / (WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP)))
    }
    updateCapacity()

    const resizeObserver = new ResizeObserver(updateCapacity)
    resizeObserver.observe(waveformNode)
    return () => resizeObserver.disconnect()
  }, [setWaveformCapacity, waveformNode])

  if (isRequesting) {
    return (
      <div
        className='sender-voice-recording sender-voice-recording--requesting'
        role='status'
        aria-live='polite'
        aria-atomic='true'
      >
        <span className='material-symbols-rounded sender-voice-recording__pending-icon' aria-hidden='true'>
          progress_activity
        </span>
        <div className='sender-voice-recording__time'>
          {t('chat.voiceInput.requestingPermission')}
        </div>
      </div>
    )
  }

  return (
    <div className='sender-voice-recording'>
      <div className='sender-voice-waveform' ref={waveformRef}>
        <span
          role='status'
          aria-live='polite'
          aria-atomic='true'
          aria-label={phaseAnnouncement}
        />
        {state.waveformLevels.map((level, index) => (
          <span
            // Waveform bars are positional; no stable domain id exists.
            key={index}
            className='sender-voice-waveform__bar'
            aria-hidden='true'
            style={{ transform: `scaleY(${Math.max(.08, level)})` }}
          />
        ))}
      </div>
      <div className='sender-voice-recording__time'>
        {isTranscribing ? t('chat.voiceInput.transcribing') : formatElapsedTime(state.elapsedSeconds)}
      </div>
    </div>
  )
}
