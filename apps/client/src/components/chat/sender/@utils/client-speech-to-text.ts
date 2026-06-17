import type { SpeechToTextServiceSummary } from '@oneworks/types'

export const BROWSER_WEB_SPEECH_SERVICE_ID = 'browser-web-speech'

export type ClientSpeechToTextProvider = 'web-speech'
export type SpeechToTextServiceRuntime = 'client' | 'server'

export type SenderSpeechToTextServiceSummary = SpeechToTextServiceSummary & {
  clientProvider?: ClientSpeechToTextProvider
  runtime: SpeechToTextServiceRuntime
}

type SpeechRecognitionErrorCode =
  | 'aborted'
  | 'audio-capture'
  | 'bad-grammar'
  | 'language-not-supported'
  | 'network'
  | 'no-speech'
  | 'not-allowed'
  | 'phrases-not-supported'
  | 'service-not-allowed'

export interface BrowserSpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

export interface BrowserSpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  item: (index: number) => BrowserSpeechRecognitionAlternative
  [index: number]: BrowserSpeechRecognitionAlternative
}

export interface BrowserSpeechRecognitionResultList {
  readonly length: number
  item: (index: number) => BrowserSpeechRecognitionResult
  [index: number]: BrowserSpeechRecognitionResult
}

export interface BrowserSpeechRecognitionResultEvent extends Event {
  readonly resultIndex: number
  readonly results: BrowserSpeechRecognitionResultList
}

export interface BrowserSpeechRecognitionErrorEvent extends Event {
  readonly error: SpeechRecognitionErrorCode
  readonly message?: string
}

export interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  onend: ((event: Event) => void) | null
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null
  onresult: ((event: BrowserSpeechRecognitionResultEvent) => void) | null
  abort: () => void
  start: () => void
  stop: () => void
}

interface BrowserSpeechRecognitionConstructor {
  new(): BrowserSpeechRecognition
}

const getBrowserSpeechRecognitionConstructor = () => {
  if (typeof window === 'undefined') return undefined
  const candidateWindow = window as Window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
  }
  return candidateWindow.SpeechRecognition ?? candidateWindow.webkitSpeechRecognition
}

export const isBrowserWebSpeechRecognitionAvailable = () => (
  typeof window !== 'undefined' &&
  window.oneworksDesktop == null &&
  getBrowserSpeechRecognitionConstructor() != null
)

export const createBrowserSpeechRecognition = () => {
  const Recognition = getBrowserSpeechRecognitionConstructor()
  return Recognition == null ? undefined : new Recognition()
}

export const toServerSpeechToTextService = (
  service: SpeechToTextServiceSummary
): SenderSpeechToTextServiceSummary => ({
  ...service,
  runtime: 'server'
})

export const getClientSpeechToTextServices = ({
  isDefault,
  label
}: {
  isDefault: boolean
  label: string
}): SenderSpeechToTextServiceSummary[] => {
  if (!isBrowserWebSpeechRecognitionAvailable()) return []

  return [{
    capabilities: {
      streaming: true
    },
    clientProvider: 'web-speech',
    default: isDefault,
    enabled: true,
    id: BROWSER_WEB_SPEECH_SERVICE_ID,
    label,
    provider: 'custom-http',
    runtime: 'client'
  }]
}

export const isClientSpeechToTextService = (
  service: SenderSpeechToTextServiceSummary | undefined
) => service?.runtime === 'client'
