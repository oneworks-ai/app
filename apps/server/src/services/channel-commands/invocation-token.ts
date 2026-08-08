import { Buffer } from 'node:buffer'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const TOKEN_VERSION = 1
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000
const signingKey = randomBytes(32)

interface InvocationTokenPayload {
  channelKey: string
  childRunId: string
  expiresAt: number
  sessionId: string
  version: typeof TOKEN_VERSION
}

const encode = (value: string) => Buffer.from(value, 'utf8').toString('base64url')
const sign = (encodedPayload: string) => createHmac('sha256', signingKey).update(encodedPayload).digest('base64url')

export const createChannelCommandInvocationToken = (input: {
  channelKey: string
  childRunId: string
  now?: number
  sessionId: string
  ttlMs?: number
}) => {
  const payload: InvocationTokenPayload = {
    channelKey: input.channelKey,
    childRunId: input.childRunId,
    expiresAt: (input.now ?? Date.now()) + (input.ttlMs ?? DEFAULT_TTL_MS),
    sessionId: input.sessionId,
    version: TOKEN_VERSION
  }
  const encodedPayload = encode(JSON.stringify(payload))
  return `${encodedPayload}.${sign(encodedPayload)}`
}

export const verifyChannelCommandInvocationToken = (token: string, input: {
  channelKey: string
  now?: number
}): InvocationTokenPayload | undefined => {
  const [encodedPayload, providedSignature, extra] = token.split('.')
  if (encodedPayload == null || providedSignature == null || extra != null) return undefined

  const expectedSignature = sign(encodedPayload)
  const provided = Buffer.from(providedSignature)
  const expected = Buffer.from(expectedSignature)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return undefined

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as InvocationTokenPayload
    if (
      payload.version !== TOKEN_VERSION ||
      payload.channelKey !== input.channelKey ||
      typeof payload.childRunId !== 'string' || payload.childRunId.trim() === '' ||
      typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '' ||
      !Number.isFinite(payload.expiresAt) || payload.expiresAt <= (input.now ?? Date.now())
    ) {
      return undefined
    }
    return payload
  } catch {
    return undefined
  }
}
