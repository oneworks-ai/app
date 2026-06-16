import Router from '@koa/router'

import { VoiceRuntimeError, listSpeechToTextServices, transcribeSpeechToText } from '#~/services/voice/index.js'
import { HttpError, badRequest } from '#~/utils/http.js'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const getString = (body: Record<string, unknown>, key: string) => {
  const value = body[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

const mapVoiceErrorStatus = (error: VoiceRuntimeError) => {
  switch (error.code) {
    case 'NO_DEFAULT_SERVICE':
    case 'SERVICE_NOT_FOUND':
    case 'SERVICE_DISABLED':
    case 'MISSING_CREDENTIAL':
    case 'UNSUPPORTED_AUDIO_FORMAT':
    case 'AUDIO_TOO_LARGE':
    case 'NO_SPEECH_DETECTED':
      return 400
    case 'PROVIDER_AUTH_FAILED':
      return 401
    case 'PROVIDER_RATE_LIMITED':
      return 429
    case 'PROVIDER_TIMEOUT':
      return 504
    case 'NETWORK_ERROR':
    case 'PROVIDER_BAD_RESPONSE':
      return 502
    default:
      return 500
  }
}

const normalizeVoiceError = (error: unknown) => {
  if (!(error instanceof VoiceRuntimeError)) throw error
  throw new HttpError(
    mapVoiceErrorStatus(error),
    error.code,
    error.message,
    error.details,
    { expose: true }
  )
}

const parseSpeechToTextBody = (body: unknown) => {
  if (!isRecord(body)) {
    throw badRequest('Invalid speech-to-text request body', undefined, 'invalid_voice_request')
  }

  const audioBase64 = getString(body, 'audioBase64') ?? getString(body, 'audio')
  if (audioBase64 == null) {
    throw badRequest('Missing audioBase64', undefined, 'missing_audio')
  }

  return {
    audioBase64,
    filename: getString(body, 'filename'),
    language: getString(body, 'language'),
    mimeType: getString(body, 'mimeType'),
    prompt: getString(body, 'prompt'),
    serviceId: getString(body, 'serviceId')
  }
}

export function voiceRouter(): Router {
  const router = new Router()

  router.get('/speech-to-text/services', async (ctx) => {
    ctx.body = {
      services: await listSpeechToTextServices()
    }
  })

  router.post('/speech-to-text', async (ctx) => {
    try {
      ctx.body = {
        result: await transcribeSpeechToText(parseSpeechToTextBody(ctx.request.body))
      }
    } catch (error) {
      normalizeVoiceError(error)
    }
  })

  router.post('/speech-to-text/test', async (ctx) => {
    try {
      ctx.body = {
        result: await transcribeSpeechToText(parseSpeechToTextBody(ctx.request.body))
      }
    } catch (error) {
      normalizeVoiceError(error)
    }
  })

  return router
}
