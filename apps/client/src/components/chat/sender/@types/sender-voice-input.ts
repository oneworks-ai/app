import type { SpeechToTextServiceSummary } from '@oneworks/types'

export type SenderVoiceInputPhase = 'idle' | 'recording' | 'transcribing'

export interface SenderVoiceInputState {
  canRetry: boolean
  canStartRecording: boolean
  canSendAfterTranscription: boolean
  elapsedSeconds: number
  enabled: boolean
  errorMessage?: string
  loadingServices: boolean
  phase: SenderVoiceInputPhase
  selectedServiceId?: string
  selectedServiceLabel?: string
  settingDefaultServiceId?: string
  services: SpeechToTextServiceSummary[]
  setupOpen: boolean
  unsupported: boolean
  waveformLevels: number[]
}

export interface SenderVoiceInputHandlers {
  cancelRecording: () => void
  cancelTranscription: () => void
  dismissSetup: () => void
  openConfig: () => void
  retryTranscription: () => void
  selectService: (serviceId?: string) => void
  setDefaultService: (serviceId: string) => void
  startRecording: () => void
  stopRecording: (options?: { sendAfterTranscription?: boolean }) => void
}

export interface SenderVoiceInputController {
  handlers: SenderVoiceInputHandlers
  state: SenderVoiceInputState
}
