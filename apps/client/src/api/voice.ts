import type { SpeechToTextResult, SpeechToTextServiceSummary } from '@oneworks/types'

import { fetchApiJson, jsonHeaders } from './base'

export interface SpeechToTextServicesResponse {
  services: SpeechToTextServiceSummary[]
}

export interface SpeechToTextTranscriptionResponse {
  result: SpeechToTextResult
}

export interface SpeechToTextTranscriptionRequest {
  audio: Blob
  filename?: string
  language?: string
  prompt?: string
  signal?: AbortSignal
  serviceId?: string
}

const blobToBase64 = async (blob: Blob) => {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return window.btoa(binary)
}

export const listSpeechToTextServices = () =>
  fetchApiJson<SpeechToTextServicesResponse>('/api/voice/speech-to-text/services')

export const transcribeSpeechToText = async ({
  audio,
  filename,
  language,
  prompt,
  signal,
  serviceId
}: SpeechToTextTranscriptionRequest) => {
  const audioBase64 = await blobToBase64(audio)
  return await fetchApiJson<SpeechToTextTranscriptionResponse>('/api/voice/speech-to-text', {
    body: JSON.stringify({
      audioBase64,
      filename: filename ?? 'recording.webm',
      language,
      mimeType: audio.type || 'audio/webm',
      prompt,
      serviceId
    }),
    headers: jsonHeaders,
    method: 'POST',
    signal,
    timeoutMs: 120_000
  })
}
