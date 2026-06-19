import { useEffect, useRef } from 'react'
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
  const waveformRef = useRef<HTMLDivElement | null>(null)
  const isTranscribing = state.phase === 'transcribing'

  useEffect(() => {
    const node = waveformRef.current
    if (node == null) return undefined

    const updateCapacity = () => {
      const width = node.getBoundingClientRect().width
      setWaveformCapacity(Math.floor((width + WAVEFORM_BAR_GAP) / (WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP)))
    }
    updateCapacity()

    const resizeObserver = new ResizeObserver(updateCapacity)
    resizeObserver.observe(node)
    return () => resizeObserver.disconnect()
  }, [setWaveformCapacity])

  return (
    <div className='sender-voice-recording'>
      <div className='sender-voice-waveform' aria-hidden='true' ref={waveformRef}>
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
    </div>
  )
}
