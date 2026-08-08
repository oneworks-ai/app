import { Buffer } from 'node:buffer'
import { createHmac, timingSafeEqual } from 'node:crypto'

const SIGNATURE_PREFIX = 'sha256='

export const ONEWORKS_WEBHOOK_NONCE_HEADER = 'x-oneworks-channel-nonce'
export const ONEWORKS_WEBHOOK_SIGNATURE_HEADER = 'x-oneworks-channel-signature'
export const ONEWORKS_WEBHOOK_TIMESTAMP_HEADER = 'x-oneworks-channel-timestamp'
export const ONEWORKS_WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000

export const buildOneWorksWebhookSignature = (input: {
  body: string | Uint8Array
  nonce: string
  secret: string
  timestamp: string
}) => {
  const hmac = createHmac('sha256', input.secret)
  hmac.update(input.timestamp)
  hmac.update('\n')
  hmac.update(input.nonce)
  hmac.update('\n')
  hmac.update(input.body)
  return `${SIGNATURE_PREFIX}${hmac.digest('hex')}`
}

export const verifyOneWorksWebhookSignature = (input: {
  body: string | Uint8Array
  nonce: string
  now?: number
  secret: string
  signature: string
  timestamp: string
  windowMs?: number
}) => {
  if (!/^[-\w]{8,200}$/u.test(input.nonce)) return false
  if (!/^\d{13}$/u.test(input.timestamp)) return false

  const timestamp = Number(input.timestamp)
  const windowMs = input.windowMs ?? ONEWORKS_WEBHOOK_MAX_AGE_MS
  if (!Number.isSafeInteger(timestamp) || Math.abs((input.now ?? Date.now()) - timestamp) > windowMs) {
    return false
  }

  const expected = buildOneWorksWebhookSignature(input)
  const actualBuffer = Buffer.from(input.signature)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}
