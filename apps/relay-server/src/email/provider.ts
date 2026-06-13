import type {
  RelayEmailConfig,
  RelayEmailProvider,
  RelayEmailProviderInput,
  RelayEmailProviderResult,
  RelayEmailPurpose,
  RelayServerArgs
} from '../types.js'

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

const purposeTitle: Record<RelayEmailPurpose, string> = {
  'email-verification': 'Verify your email',
  invite: 'Confirm your Relay invite',
  login: 'Sign in to OneWorks Relay'
}

const purposeIntro: Record<RelayEmailPurpose, string> = {
  'email-verification': 'Use this code to verify your email address.',
  invite: 'Use this code to continue with your Relay invite.',
  login: 'Use this code to sign in to OneWorks Relay.'
}

const minutesUntil = (expiresAt: string) => {
  const remainingMs = Date.parse(expiresAt) - Date.now()
  return Math.max(1, Math.ceil(remainingMs / 60_000))
}

const buildEmailPayload = (input: RelayEmailProviderInput) => {
  const minutes = minutesUntil(input.expiresAt)
  return {
    subject: `OneWorks Relay: ${purposeTitle[input.purpose]}`,
    text: [
      purposeIntro[input.purpose],
      '',
      `Code: ${input.code}`,
      '',
      `This code expires in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      'If you did not request this email, you can ignore it.'
    ].join('\n')
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
      const payload = buildEmailPayload(input)
      const response = await fetch('https://api.resend.com/emails', {
        body: JSON.stringify({
          from,
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
