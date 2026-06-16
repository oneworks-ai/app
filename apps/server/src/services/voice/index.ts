/* eslint-disable max-lines -- Speech-to-text runtime keeps provider dispatch, response normalization, and config resolution together. */
import { Buffer } from 'node:buffer'
import { env as processEnv } from 'node:process'

import type {
  SpeechToTextCustomHttpConfig,
  SpeechToTextOpenAITranscriptionsConfig,
  SpeechToTextResult,
  SpeechToTextServiceConfig,
  SpeechToTextServiceSummary,
  VoiceErrorCode
} from '@oneworks/types'

import { loadConfigState } from '#~/services/config/index.js'

export interface SpeechToTextRequestInput {
  audioBase64: string
  filename?: string
  language?: string
  mimeType?: string
  prompt?: string
  serviceId?: string
}

interface ResolvedSpeechToTextService {
  config: SpeechToTextServiceConfig
  default: boolean
  id: string
}

interface SpeechToTextProviderInput {
  audio: Buffer
  filename: string
  language?: string
  mimeType: string
  prompt?: string
  service: ResolvedSpeechToTextService
}

export class VoiceRuntimeError extends Error {
  code: VoiceErrorCode
  details?: unknown

  constructor(code: VoiceErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'VoiceRuntimeError'
    this.code = code
    this.details = details
  }
}

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_AUDIO_MIME_TYPE = 'audio/webm'
const DEFAULT_AUDIO_FILENAME = 'recording.webm'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

const normalizeConfigId = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed === '' ? undefined : trimmed
}

const normalizeBase64 = (value: string) => {
  const trimmed = value.trim()
  const commaIndex = trimmed.indexOf(',')
  return (trimmed.startsWith('data:') && commaIndex >= 0 ? trimmed.slice(commaIndex + 1) : trimmed)
    .replace(/\s+/g, '')
}

const decodeAudio = (audioBase64: string) => {
  const normalized = normalizeBase64(audioBase64)
  const firstPaddingIndex = normalized.indexOf('=')
  const paddingLength = firstPaddingIndex === -1 ? 0 : normalized.length - firstPaddingIndex
  if (
    normalized === '' ||
    normalized.length % 4 === 1 ||
    paddingLength > 2 ||
    !/^[\d+/a-z]+={0,2}$/i.test(normalized) ||
    (firstPaddingIndex !== -1 && !/^=+$/.test(normalized.slice(firstPaddingIndex)))
  ) {
    throw new VoiceRuntimeError('UNSUPPORTED_AUDIO_FORMAT', 'Invalid audio payload')
  }
  const unpadded = normalized.replace(/=+$/, '')
  const padded = unpadded.padEnd(unpadded.length + ((4 - unpadded.length % 4) % 4), '=')
  const audio = Buffer.from(padded, 'base64')
  if (audio.byteLength === 0) {
    throw new VoiceRuntimeError('UNSUPPORTED_AUDIO_FORMAT', 'Audio payload is empty')
  }
  return audio
}

const getEnabledServices = (services: Record<string, SpeechToTextServiceConfig> | undefined) => (
  Object.entries(services ?? {})
    .filter(([, service]) => service.enabled !== false)
)

const resolveDefaultServiceId = (
  defaultServiceId: string | undefined,
  services: Record<string, SpeechToTextServiceConfig> | undefined
) => {
  const configuredDefaultServiceId = normalizeConfigId(defaultServiceId)
  if (configuredDefaultServiceId != null) return configuredDefaultServiceId
  const enabledServices = getEnabledServices(services)
  return enabledServices[0]?.[0]
}

const getServiceLabel = (id: string, config: SpeechToTextServiceConfig) => (
  typeof config.label === 'string' && config.label.trim() !== '' ? config.label : id
)

const isOpenAITranscriptionsConfig = (
  config: SpeechToTextServiceConfig
): config is SpeechToTextOpenAITranscriptionsConfig => (
  config.provider === 'openai-transcriptions' &&
  typeof (config as { model?: unknown }).model === 'string' &&
  (config as { model: string }).model.trim() !== ''
)

const isCustomHttpConfig = (config: SpeechToTextServiceConfig): config is SpeechToTextCustomHttpConfig => (
  config.provider === 'custom-http' &&
  isRecord((config as { request?: unknown }).request) &&
  typeof (config as { request: { url?: unknown } }).request.url === 'string' &&
  (config as { request: { url: string } }).request.url.trim() !== ''
)

export async function listSpeechToTextServices(): Promise<SpeechToTextServiceSummary[]> {
  const { mergedConfig } = await loadConfigState()
  const speechToText = mergedConfig.voice?.speechToText
  const services = speechToText?.services ?? {}
  const defaultServiceId = resolveDefaultServiceId(speechToText?.defaultServiceId, services)

  return Object.entries(services).map(([id, config]) => ({
    capabilities: config.capabilities,
    default: id === defaultServiceId,
    enabled: config.enabled !== false,
    id,
    label: getServiceLabel(id, config),
    maxBytes: config.maxBytes,
    maxDurationSeconds: config.maxDurationSeconds,
    provider: config.provider
  }))
}

const resolveSpeechToTextService = async (serviceId?: string): Promise<ResolvedSpeechToTextService> => {
  const { mergedConfig } = await loadConfigState()
  const speechToText = mergedConfig.voice?.speechToText
  const services = speechToText?.services ?? {}
  const resolvedServiceId = normalizeConfigId(serviceId) ??
    resolveDefaultServiceId(speechToText?.defaultServiceId, services)

  if (resolvedServiceId == null) {
    throw new VoiceRuntimeError('NO_DEFAULT_SERVICE', 'No speech-to-text service is configured')
  }

  const config = services[resolvedServiceId]
  if (config == null) {
    throw new VoiceRuntimeError('SERVICE_NOT_FOUND', `Speech-to-text service "${resolvedServiceId}" was not found`)
  }
  if (config.enabled === false) {
    throw new VoiceRuntimeError('SERVICE_DISABLED', `Speech-to-text service "${resolvedServiceId}" is disabled`)
  }

  return {
    config,
    default: resolvedServiceId === resolveDefaultServiceId(speechToText?.defaultServiceId, services),
    id: resolvedServiceId
  }
}

const resolveApiKey = (config: { apiKey?: string; apiKeyEnv?: string }) => {
  if (config.apiKey != null && config.apiKey.trim() !== '') {
    return config.apiKey
  }
  if (config.apiKeyEnv != null && config.apiKeyEnv.trim() !== '') {
    const value = processEnv[config.apiKeyEnv]
    if (value != null && value.trim() !== '') {
      return value
    }
  }
  throw new VoiceRuntimeError('MISSING_CREDENTIAL', 'Speech-to-text service credential is missing')
}

const resolvePath = (value: unknown, path: string | undefined): unknown => {
  if (path == null || path.trim() === '') return value
  return path
    .split('.')
    .filter(part => part !== '')
    .reduce<unknown>((current, part) => {
      if (!isRecord(current)) return undefined
      return current[part]
    }, value)
}

const normalizeText = (value: unknown) => {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(item => String(item)).join(' ').trim()
  return ''
}

const normalizeNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

const normalizeTimestampMs = (
  item: Record<string, unknown>,
  millisecondKeys: string[],
  secondKey: string
) => {
  for (const key of millisecondKeys) {
    const milliseconds = normalizeNumber(item[key])
    if (milliseconds != null) return milliseconds
  }

  const seconds = normalizeNumber(item[secondKey])
  return seconds == null ? undefined : Math.round(seconds * 1000)
}

const normalizeSegments = (value: unknown) => {
  if (!Array.isArray(value)) return undefined
  return value
    .map((item) => {
      if (!isRecord(item)) return undefined
      const text = normalizeText(item.text)
      if (text === '') return undefined
      return {
        text,
        startMs: normalizeTimestampMs(item, ['startMs', 'start_ms'], 'start'),
        endMs: normalizeTimestampMs(item, ['endMs', 'end_ms'], 'end'),
        speaker: typeof item.speaker === 'string' ? item.speaker : undefined
      }
    })
    .filter(item => item != null)
}

const normalizeWords = (value: unknown) => {
  if (!Array.isArray(value)) return undefined
  return value
    .map((item) => {
      if (!isRecord(item)) return undefined
      const text = normalizeText(item.text ?? item.word)
      if (text === '') return undefined
      return {
        text,
        startMs: normalizeTimestampMs(item, ['startMs', 'start_ms'], 'start'),
        endMs: normalizeTimestampMs(item, ['endMs', 'end_ms'], 'end'),
        confidence: normalizeNumber(item.confidence),
        speaker: typeof item.speaker === 'string' ? item.speaker : undefined
      }
    })
    .filter(item => item != null)
}

const parseResponseBody = async (response: Response) => {
  const contentType = response.headers.get('content-type') ?? ''
  const text = await response.text()
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new VoiceRuntimeError('PROVIDER_BAD_RESPONSE', 'Speech-to-text provider returned invalid JSON')
    }
  }
  return text
}

const toProviderError = (response: Response) => {
  if (response.status === 401 || response.status === 403) {
    return new VoiceRuntimeError('PROVIDER_AUTH_FAILED', 'Speech-to-text provider authentication failed')
  }
  if (response.status === 408 || response.status === 504) {
    return new VoiceRuntimeError('PROVIDER_TIMEOUT', 'Speech-to-text provider timed out')
  }
  if (response.status === 429) {
    return new VoiceRuntimeError('PROVIDER_RATE_LIMITED', 'Speech-to-text provider rate limited the request')
  }
  return new VoiceRuntimeError('PROVIDER_BAD_RESPONSE', 'Speech-to-text provider request failed', {
    status: response.status
  })
}

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number | undefined
) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 60000)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new VoiceRuntimeError('PROVIDER_TIMEOUT', 'Speech-to-text provider timed out')
    }
    throw new VoiceRuntimeError('NETWORK_ERROR', 'Speech-to-text provider network request failed')
  } finally {
    clearTimeout(timeout)
  }
}

const normalizeProviderResult = (
  serviceId: string,
  responseBody: unknown,
  options: {
    languagePath?: string
    segmentsPath?: string
    textPath?: string
    wordsPath?: string
  } = {}
): SpeechToTextResult => {
  const text = normalizeText(resolvePath(responseBody, options.textPath ?? 'text'))
  if (text === '') {
    throw new VoiceRuntimeError('NO_SPEECH_DETECTED', 'No speech was detected in the recording')
  }

  const language = normalizeText(resolvePath(responseBody, options.languagePath))
  return {
    language: language === '' ? undefined : language,
    segments: normalizeSegments(resolvePath(responseBody, options.segmentsPath)),
    serviceId,
    text,
    words: normalizeWords(resolvePath(responseBody, options.wordsPath))
  }
}

const appendAudioFile = (form: FormData, fieldName: string, input: SpeechToTextProviderInput) => {
  const blob = new Blob([toArrayBuffer(input.audio)], { type: input.mimeType })
  form.append(fieldName, blob, input.filename)
}

const toArrayBuffer = (buffer: Buffer): ArrayBuffer => {
  const bytes = new Uint8Array(buffer.byteLength)
  bytes.set(buffer)
  return bytes.buffer
}

const transcribeWithOpenAI = async (
  input: SpeechToTextProviderInput,
  config: SpeechToTextOpenAITranscriptionsConfig
): Promise<SpeechToTextResult> => {
  const apiKey = resolveApiKey(config)
  const form = new FormData()
  appendAudioFile(form, 'file', input)
  form.append('model', config.model)
  const language = input.language ?? config.language
  if (language != null && language !== '' && language !== 'auto') {
    form.append('language', language)
  }
  const prompt = input.prompt ?? config.prompt
  if (prompt != null && prompt !== '') {
    form.append('prompt', prompt)
  }
  if (config.responseFormat != null) {
    form.append('response_format', config.responseFormat)
  }

  const baseUrl = trimTrailingSlash(config.baseUrl ?? DEFAULT_OPENAI_BASE_URL)
  const response = await fetchWithTimeout(`${baseUrl}/audio/transcriptions`, {
    body: form,
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    method: 'POST'
  }, config.timeoutMs)

  if (!response.ok) throw toProviderError(response)

  const body = await parseResponseBody(response)
  if (typeof body === 'string') {
    const text = body.trim()
    if (text === '') {
      throw new VoiceRuntimeError('NO_SPEECH_DETECTED', 'No speech was detected in the recording')
    }
    return { serviceId: input.service.id, text }
  }
  return normalizeProviderResult(input.service.id, body)
}

const interpolateTemplate = (value: string, input: SpeechToTextProviderInput) => (
  value
    .replace(/\$\{env:(\w+)\}/gi, (_, envName: string) => {
      const envValue = processEnv[envName]
      if (envValue == null || envValue === '') {
        throw new VoiceRuntimeError('MISSING_CREDENTIAL', `Missing environment variable ${envName}`)
      }
      return envValue
    })
    .replaceAll('{{language}}', input.language ?? '')
    .replaceAll('{{prompt}}', input.prompt ?? '')
    .replaceAll('{{mimeType}}', input.mimeType)
    .replaceAll('{{filename}}', input.filename)
)

const interpolateJsonValue = (value: unknown, input: SpeechToTextProviderInput): unknown => {
  if (typeof value === 'string') return interpolateTemplate(value, input)
  if (Array.isArray(value)) return value.map(item => interpolateJsonValue(item, input))
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolateJsonValue(item, input)])
    )
  }
  return value
}

const buildCustomHttpBody = (
  config: SpeechToTextCustomHttpConfig,
  input: SpeechToTextProviderInput
): { body: BodyInit; headers: Record<string, string> } => {
  const body = config.request.body ?? { kind: 'json' as const }
  const fields = Object.fromEntries(
    Object.entries(body.fields ?? {}).map(([key, value]) => [key, interpolateJsonValue(value, input)])
  )

  if (body.kind === 'binary') {
    return {
      body: toArrayBuffer(input.audio),
      headers: {
        'Content-Type': input.mimeType
      }
    }
  }

  if (body.kind === 'multipart') {
    const form = new FormData()
    appendAudioFile(form, body.fileField ?? 'file', input)
    for (const [key, value] of Object.entries(fields)) {
      form.append(key, typeof value === 'string' ? value : JSON.stringify(value))
    }
    return { body: form, headers: {} }
  }

  return {
    body: JSON.stringify({
      ...fields,
      [body.audioBase64Field ?? 'audioBase64']: input.audio.toString('base64'),
      mimeType: input.mimeType,
      filename: input.filename
    }),
    headers: {
      'Content-Type': 'application/json'
    }
  }
}

const transcribeWithCustomHttp = async (
  input: SpeechToTextProviderInput,
  config: SpeechToTextCustomHttpConfig
): Promise<SpeechToTextResult> => {
  const requestHeaders = Object.fromEntries(
    Object.entries(config.request.headers ?? {})
      .map(([key, value]) => [key, interpolateTemplate(value, input)])
  )
  const body = buildCustomHttpBody(config, input)
  const response = await fetchWithTimeout(config.request.url, {
    body: body.body,
    headers: {
      ...body.headers,
      ...requestHeaders
    },
    method: config.request.method ?? 'POST'
  }, config.timeoutMs)

  if (!response.ok) throw toProviderError(response)

  const responseBody = await parseResponseBody(response)
  if (typeof responseBody === 'string') {
    const text = responseBody.trim()
    if (text === '') {
      throw new VoiceRuntimeError('NO_SPEECH_DETECTED', 'No speech was detected in the recording')
    }
    return { serviceId: input.service.id, text }
  }
  return normalizeProviderResult(input.service.id, responseBody, config.response)
}

export async function transcribeSpeechToText(request: SpeechToTextRequestInput): Promise<SpeechToTextResult> {
  const service = await resolveSpeechToTextService(request.serviceId)
  const audio = decodeAudio(request.audioBase64)
  const maxBytes = service.config.maxBytes
  if (maxBytes != null && audio.byteLength > maxBytes) {
    throw new VoiceRuntimeError('AUDIO_TOO_LARGE', 'Audio payload is too large')
  }

  const input: SpeechToTextProviderInput = {
    audio,
    filename: request.filename ?? DEFAULT_AUDIO_FILENAME,
    language: request.language,
    mimeType: request.mimeType ?? DEFAULT_AUDIO_MIME_TYPE,
    prompt: request.prompt,
    service
  }

  switch (service.config.provider) {
    case 'openai-transcriptions':
      if (!isOpenAITranscriptionsConfig(service.config)) {
        throw new VoiceRuntimeError('SERVICE_NOT_FOUND', 'Invalid OpenAI speech-to-text service')
      }
      return await transcribeWithOpenAI(input, service.config)
    case 'custom-http':
      if (!isCustomHttpConfig(service.config)) {
        throw new VoiceRuntimeError('SERVICE_NOT_FOUND', 'Invalid custom speech-to-text service')
      }
      return await transcribeWithCustomHttp(input, service.config)
  }
}
