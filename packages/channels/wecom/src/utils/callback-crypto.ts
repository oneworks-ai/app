import { Buffer } from 'node:buffer'
import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto'

import type { WeComChannelConfig } from '#~/types.js'

import { parseWeComXml } from './xml'

const safeEqual = (left: string, right: string) => {
  const leftDigest = createHash('sha256').update(left).digest()
  const rightDigest = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftDigest, rightDigest)
}

export const createWeComMessageSignature = (
  token: string,
  timestamp: string,
  nonce: string,
  encrypted: string
) =>
  createHash('sha1')
    .update([token, timestamp, nonce, encrypted].sort().join(''))
    .digest('hex')

export const verifyWeComMessageSignature = (
  config: WeComChannelConfig,
  input: {
    encrypted: string
    msgSignature?: string
    nonce?: string
    timestamp?: string
  }
) => {
  if (
    input.msgSignature == null ||
    input.timestamp == null ||
    input.nonce == null
  ) {
    return false
  }

  const expected = createWeComMessageSignature(config.token, input.timestamp, input.nonce, input.encrypted)
  return safeEqual(expected, input.msgSignature)
}

const getEncodingAesKey = (config: WeComChannelConfig) => Buffer.from(`${config.encodingAesKey}=`, 'base64')

export const decryptWeComPayload = (
  config: WeComChannelConfig,
  encrypted: string
) => {
  const aesKey = getEncodingAesKey(config)
  if (aesKey.length !== 32) {
    throw new Error('Invalid WeCom EncodingAESKey')
  }

  const decipher = createDecipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16))
  const decrypted = Buffer.concat([
    decipher.update(encrypted, 'base64'),
    decipher.final()
  ])
  const messageLength = decrypted.readUInt32BE(16)
  const messageStart = 20
  const messageEnd = messageStart + messageLength
  if (messageEnd > decrypted.length) {
    throw new Error('Invalid WeCom encrypted payload length')
  }

  const messageXml = decrypted.subarray(messageStart, messageEnd).toString('utf8')
  const receiveId = decrypted.subarray(messageEnd).toString('utf8')
  if (receiveId !== '' && receiveId !== config.corpId) {
    throw new Error('Invalid WeCom encrypted payload receive id')
  }

  return {
    message: parseWeComXml(messageXml),
    messageXml,
    receiveId
  }
}
