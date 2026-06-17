import { Buffer } from 'node:buffer'
import { createHash, createPrivateKey, createPublicKey, sign, timingSafeEqual, verify } from 'node:crypto'

import type { ChannelWebhookRequest } from '@oneworks/core/channel'

import type { QQChannelConfig } from '#~/types.js'

type RawBodyWebhookRequest = ChannelWebhookRequest & {
  rawBody?: string | Uint8Array
}

const ED25519_PKCS8_SEED_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
const ED25519_SEED_SIZE = 32

const getFirstString = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value[0]
  return value
}

const getHeader = (headers: Record<string, string | string[] | undefined>, key: string) => {
  const normalizedKey = key.toLowerCase()
  for (const [headerKey, value] of Object.entries(headers)) {
    if (headerKey.toLowerCase() === normalizedKey) {
      return getFirstString(value)
    }
  }
  return undefined
}

const safeEqual = (left: string, right: string) => {
  const leftDigest = createHash('sha256').update(left).digest()
  const rightDigest = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftDigest, rightDigest)
}

const normalizeSecretSeed = (secret: string) => {
  let seed = secret
  while (Buffer.byteLength(seed) < ED25519_SEED_SIZE) {
    seed += seed
  }
  return Buffer.from(seed).subarray(0, ED25519_SEED_SIZE)
}

const createQQPrivateKey = (secret: string) =>
  createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, normalizeSecretSeed(secret)]),
    format: 'der',
    type: 'pkcs8'
  })

const asRawBodyBuffer = (request: RawBodyWebhookRequest) => {
  if (typeof request.rawBody === 'string') return Buffer.from(request.rawBody)
  if (request.rawBody instanceof Uint8Array) return Buffer.from(request.rawBody)
  if (typeof request.body === 'string') return Buffer.from(request.body)
  if (request.body instanceof Uint8Array) return Buffer.from(request.body)
  return Buffer.from(JSON.stringify(request.body))
}

export const signQQWebhookValidation = (
  appSecret: string,
  input: {
    eventTs: string
    plainToken: string
  }
) => sign(null, Buffer.from(`${input.eventTs}${input.plainToken}`), createQQPrivateKey(appSecret)).toString('hex')

export const verifyQQWebhookSignature = (config: QQChannelConfig, request: ChannelWebhookRequest) => {
  if (config.verifyWebhookSignature === false) return true
  const signatureHex = getHeader(request.headers, 'x-signature-ed25519')
  const timestamp = getHeader(request.headers, 'x-signature-timestamp')
  if (signatureHex == null || timestamp == null) return false

  let signature: Buffer
  try {
    signature = Buffer.from(signatureHex, 'hex')
  } catch {
    return false
  }
  if (signature.length !== 64 || (signature[63] & 224) !== 0) return false

  const message = Buffer.concat([Buffer.from(timestamp), asRawBodyBuffer(request as RawBodyWebhookRequest)])
  return verify(null, message, createPublicKey(createQQPrivateKey(config.appSecret)), signature)
}

export const verifyQQWebhookAppId = (config: QQChannelConfig, request: ChannelWebhookRequest) => {
  if (config.verifyWebhookAppId === false) return true
  const appId = getHeader(request.headers, 'x-bot-appid')
  return appId == null || safeEqual(appId, config.appId)
}
