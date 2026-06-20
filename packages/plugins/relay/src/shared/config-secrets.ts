import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import type { RelayConfigSnapshotSecretEnvelope } from './config-assignment-types.js'

const configSecretAlgorithm = 'aes-256-gcm' as const

const envelopeKey = (deviceToken: string) =>
  createHash('sha256')
    .update('oneworks-relay-config-envelope\0')
    .update(deviceToken)
    .digest()

const envelopeAad = (input: {
  expiresAt: string
  recipientDeviceId: string
  ref: string
  secretId: string
  secretVersion: number
}) =>
  Buffer.from(
    [
      input.recipientDeviceId,
      input.secretId,
      String(input.secretVersion),
      input.ref,
      input.expiresAt
    ].join('\0'),
    'utf8'
  )

export const encryptRelayConfigSnapshotSecretEnvelope = (input: {
  deviceToken: string
  expiresAt: string
  plaintext: string
  recipientDeviceId: string
  ref: string
  secretId: string
  secretVersion: number
}): RelayConfigSnapshotSecretEnvelope => {
  const iv = randomBytes(12)
  const cipher = createCipheriv(configSecretAlgorithm, envelopeKey(input.deviceToken), iv)
  cipher.setAAD(envelopeAad(input))
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(input.plaintext, 'utf8')), cipher.final()])
  return {
    algorithm: configSecretAlgorithm,
    ciphertext: ciphertext.toString('base64url'),
    expiresAt: input.expiresAt,
    iv: iv.toString('base64url'),
    keyId: `device:${input.recipientDeviceId}:token`,
    recipientDeviceId: input.recipientDeviceId,
    ref: input.ref,
    secretId: input.secretId,
    secretVersion: input.secretVersion,
    tag: cipher.getAuthTag().toString('base64url'),
    version: 1
  }
}

export const decryptRelayConfigSnapshotSecretEnvelope = (
  envelope: RelayConfigSnapshotSecretEnvelope,
  deviceToken: string,
  nowMs = Date.now()
): string | undefined => {
  if (deviceToken === '' || Date.parse(envelope.expiresAt) <= nowMs) return undefined
  try {
    const decipher = createDecipheriv(
      configSecretAlgorithm,
      envelopeKey(deviceToken),
      Buffer.from(envelope.iv, 'base64url')
    )
    decipher.setAAD(envelopeAad(envelope))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
      decipher.final()
    ]).toString('utf8')
  } catch {
    return undefined
  }
}
