import type { SenderSpeechToTextServiceSummary } from '../@utils/client-speech-to-text'

export type SenderVoiceInputPhase = 'idle' | 'recording' | 'transcribing'

export interface SenderVoiceInputState {
  canRetry: boolean
  canStartRecording: boolean
  canSendAfterTranscription: boolean
  elapsedSeconds: number
  enabled: boolean
  errorCanOpenConfig: boolean
  errorMessage?: string
  loadingServices: boolean
  phase: SenderVoiceInputPhase
  selectedServiceId?: string
  selectedServiceLabel?: string
  settingDefaultServiceId?: string
  services: SenderSpeechToTextServiceSummary[]
  setupOpen: boolean
  unsupported: boolean
  waveformLevels: number[]
}

export interface SenderVoiceInputHandlers {
  cancelRecording: () => void
  cancelTranscription: () => void
  dismissNotice: () => void
  openConfig: () => void
  retryTranscription: () => void
  selectService: (serviceId?: string) => void
  setDefaultService: (serviceId: string) => void
  startRecording: () => void
  setWaveformCapacity: (capacity: number) => void
  stopRecording: (options?: { sendAfterTranscription?: boolean }) => void
}

export interface SenderVoiceInputController {
  handlers: SenderVoiceInputHandlers
  state: SenderVoiceInputState
}
