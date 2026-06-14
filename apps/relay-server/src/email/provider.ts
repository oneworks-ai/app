import type { RelayEmailConfig, RelayEmailProvider, RelayEmailProviderResult, RelayServerArgs } from '../types.js'

import { buildRelayEmailPayload } from './template.js'

export class RelayEmailProviderUnavailableError extends Error {
  constructor(message = 'Email delivery is not configured.') {
    super(message)
    this.name = 'RelayEmailProviderUnavailableError'
  }
}

export class RelayEmailProviderSendError extends Error {
  constructor(message = 'Email delivery failed.') {
    super(message)
    this.name = 'RelayEmailProviderSendError'
  }
}

const parseResendResponse = async (response: Response): Promise<RelayEmailProviderResult> => {
  const text = await response.text()
  let payload: unknown
  try {
    payload = text.trim() === '' ? {} : JSON.parse(text)
  } catch {
    payload = {}
  }
  if (!response.ok) {
    throw new RelayEmailProviderSendError('Email delivery provider rejected the request.')
  }
  const messageId = payload != null &&
      typeof payload === 'object' &&
      'id' in payload &&
      typeof payload.id === 'string'
    ? payload.id
    : undefined
  return { messageId }
}

export const createResendRelayEmailProvider = (config: RelayEmailConfig): RelayEmailProvider => {
  if (
    config.resendApiKey == null || config.resendApiKey.trim() === '' || config.from == null || config.from.trim() === ''
  ) {
    throw new RelayEmailProviderUnavailableError()
  }
  const apiKey = config.resendApiKey.trim()
  const from = config.from.trim()
  return {
    sendVerificationCode: async input => {
      const payload = buildRelayEmailPayload(input)
      const response = await fetch('https://api.resend.com/emails', {
        body: JSON.stringify({
          from,
          html: payload.html,
          subject: payload.subject,
          text: payload.text,
          to: [input.email]
        }),
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        method: 'POST'
      })
      return await parseResendResponse(response)
    }
  }
}

export const resolveRelayEmailProvider = (args: RelayServerArgs): RelayEmailProvider => {
  if (args.emailProvider != null) return args.emailProvider
  if (args.email == null || args.email.provider === 'disabled') {
    throw new RelayEmailProviderUnavailableError()
  }
  if (args.email.provider === 'resend') return createResendRelayEmailProvider(args.email)
  throw new RelayEmailProviderUnavailableError()
}
