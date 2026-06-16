export type SpeechToTextProviderKind =
  | 'openai-transcriptions'
  | 'custom-http'

export type SpeechToTextBodyKind = 'multipart' | 'binary' | 'json'

export interface SpeechToTextCapabilities {
  streaming?: boolean
  diarization?: boolean
  wordTimestamps?: boolean
  languageDetection?: boolean
}

export interface SpeechToTextServiceConfigCommon {
  label?: string
  description?: string
  provider: SpeechToTextProviderKind
  enabled?: boolean
  language?: string
  prompt?: string
  timeoutMs?: number
  maxDurationSeconds?: number
  maxBytes?: number
  capabilities?: SpeechToTextCapabilities
}

export interface SpeechToTextOpenAITranscriptionsConfig extends SpeechToTextServiceConfigCommon {
  provider: 'openai-transcriptions'
  baseUrl?: string
  apiKey?: string
  apiKeyEnv?: string
  model: string
  responseFormat?: 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt'
}

export interface SpeechToTextCustomHttpBodyConfig {
  kind: SpeechToTextBodyKind
  fileField?: string
  audioBase64Field?: string
  fields?: Record<string, unknown>
}

export interface SpeechToTextCustomHttpRequestConfig {
  method?: 'POST' | 'PUT'
  url: string
  headers?: Record<string, string>
  body?: SpeechToTextCustomHttpBodyConfig
}

export interface SpeechToTextCustomHttpResponseConfig {
  textPath?: string
  languagePath?: string
  segmentsPath?: string
  wordsPath?: string
}

export interface SpeechToTextCustomHttpConfig extends SpeechToTextServiceConfigCommon {
  provider: 'custom-http'
  request: SpeechToTextCustomHttpRequestConfig
  response?: SpeechToTextCustomHttpResponseConfig
}

export type SpeechToTextServiceConfig =
  | SpeechToTextOpenAITranscriptionsConfig
  | SpeechToTextCustomHttpConfig

export interface SpeechToTextConfig {
  defaultServiceId?: string
  services?: Record<string, SpeechToTextServiceConfig>
}

export interface VoiceConfig {
  speechToText?: SpeechToTextConfig
}

export interface SpeechToTextServiceSummary {
  capabilities?: SpeechToTextCapabilities
  default: boolean
  enabled: boolean
  id: string
  label: string
  maxBytes?: number
  maxDurationSeconds?: number
  provider: SpeechToTextProviderKind
}

export interface SpeechToTextSegment {
  text: string
  startMs?: number
  endMs?: number
  speaker?: string
}

export interface SpeechToTextWord {
  text: string
  startMs?: number
  endMs?: number
  confidence?: number
  speaker?: string
}

export interface SpeechToTextResult {
  durationMs?: number
  language?: string
  segments?: SpeechToTextSegment[]
  serviceId: string
  text: string
  words?: SpeechToTextWord[]
}

export type VoiceErrorCode =
  | 'NO_DEFAULT_SERVICE'
  | 'SERVICE_NOT_FOUND'
  | 'SERVICE_DISABLED'
  | 'MISSING_CREDENTIAL'
  | 'MICROPHONE_PERMISSION_DENIED'
  | 'RECORDING_UNSUPPORTED'
  | 'UNSUPPORTED_AUDIO_FORMAT'
  | 'AUDIO_TOO_LARGE'
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_BAD_RESPONSE'
  | 'NO_SPEECH_DETECTED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN'
