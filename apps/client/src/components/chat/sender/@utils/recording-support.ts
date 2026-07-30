export type RecordingStartErrorMessageKey =
  | 'chat.voiceInput.microphoneUnavailable'
  | 'chat.voiceInput.noMicrophone'
  | 'chat.voiceInput.permissionDenied'
  | 'chat.voiceInput.recordingFailed'

export const hasAudioCaptureSupport = () => (
  typeof navigator !== 'undefined' &&
  typeof navigator.mediaDevices?.getUserMedia === 'function'
)

export const hasRecordingSupport = () => (
  hasAudioCaptureSupport() &&
  typeof MediaRecorder !== 'undefined'
)

export const hasAnySpeechInputSupport = (browserSpeechRecognitionAvailable: boolean) => (
  hasRecordingSupport() ||
  (hasAudioCaptureSupport() && browserSpeechRecognitionAvailable)
)

export const getRecordingStartErrorMessageKey = (error: unknown): RecordingStartErrorMessageKey => {
  const name = error != null && typeof error === 'object' && 'name' in error && typeof error.name === 'string'
    ? error.name
    : undefined

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'chat.voiceInput.permissionDenied'
    case 'DevicesNotFoundError':
    case 'NotFoundError':
      return 'chat.voiceInput.noMicrophone'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'chat.voiceInput.microphoneUnavailable'
    default:
      return 'chat.voiceInput.recordingFailed'
  }
}
