import type {
  SenderVoiceInputController,
  SenderVoiceInputPhase
} from '#~/components/chat/sender/@types/sender-voice-input'

export const getAnnotationVoiceActivity = (phase: SenderVoiceInputPhase) => ({
  isActive: phase === 'requesting' || phase === 'recording' || phase === 'transcribing',
  isRecording: phase === 'recording',
  isRequesting: phase === 'requesting',
  isTranscribing: phase === 'transcribing'
})

export const cancelAnnotationVoiceInput = (voiceInput: SenderVoiceInputController | undefined) => {
  if (voiceInput == null) return
  const { phase } = voiceInput.state
  if (phase === 'requesting' || phase === 'recording') {
    voiceInput.handlers.cancelRecording()
    return
  }
  if (phase === 'transcribing') {
    voiceInput.handlers.cancelTranscription()
  }
}
