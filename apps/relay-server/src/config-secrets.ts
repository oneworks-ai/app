/* eslint-disable max-lines -- Relay config secret storage and envelope crypto share one boundary module. */
import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import process from 'node:process'

import type {
  RelayConfigSecret,
  RelayConfigSnapshotSecretEnvelope,
  RelayDevice,
  RelayEncryptedPayload,
  RelayServerArgs,
  RelayStore
} from './types.js'
import { now } from './utils.js'

const configSecretAlgorithm = 'aes-256-gcm' as const
const defaultSecretTtlHours = 24

const cleanText = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const configSecretMasterSecret = (
  args: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>
) => {
  const configured = cleanText(args.deviceMetadataSecret ?? process.env.ONEWORKS_RELAY_DEVICE_METADATA_SECRET)
  if (configured !== '') return configured
  if (args.adminToken !== '') return args.adminToken
  return `oneworks-relay-config-secret:${args.dataPath}`
}

const configSecretAtRestKey = (
  args: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>,
  teamId: string
) =>
  createHash('sha256')
    .update(configSecretMasterSecret(args))
    .update('\0config-secret-at-rest\0')
    .update(teamId)
    .digest()

const configSecretAtRestAad = (
  secret: Pick<RelayConfigSecret, 'id' | 'secretVersion' | 'teamId'>
) => Buffer.from(`${secret.teamId}\0${secret.id}\0${secret.secretVersion}`, 'utf8')

const encryptAtRestPayload = (
  args: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>,
  secret: Pick<RelayConfigSecret, 'id' | 'secretVersion' | 'teamId'>,
  plaintext: string
): RelayEncryptedPayload => {
  const iv = randomBytes(12)
  const cipher = createCipheriv(configSecretAlgorithm, configSecretAtRestKey(args, secret.teamId), iv)
  cipher.setAAD(configSecretAtRestAad(secret))
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()])
  return {
    algorithm: configSecretAlgorithm,
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    version: 1
  }
}

export const decryptRelayConfigSecretValue = (
  args: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>,
  secret: RelayConfigSecret
): string | undefined => {
  try {
    const decipher = createDecipheriv(
      configSecretAlgorithm,
      configSecretAtRestKey(args, secret.teamId),
      Buffer.from(secret.encryptedPayload.iv, 'base64url')
    )
    decipher.setAAD(configSecretAtRestAad(secret))
    decipher.setAuthTag(Buffer.from(secret.encryptedPayload.tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(secret.encryptedPayload.ciphertext, 'base64url')),
      decipher.final()
    ]).toString('utf8')
  } catch {
    return undefined
  }
}

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

export const serializeRelayConfigSecret = (secret: RelayConfigSecret) => ({
  id: secret.id,
  teamId: secret.teamId,
  name: secret.name,
  secretVersion: secret.secretVersion,
  createdByUserId: secret.createdByUserId,
  createdAt: secret.createdAt,
  rotatedAt: secret.rotatedAt ?? null,
  revokedAt: secret.revokedAt ?? null
})

export const createRelayConfigSecret = (
  args: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>,
  input: {
    createdByUserId: string
    name: string
    teamId: string
    value: string
  }
): RelayConfigSecret => {
  const createdAt = now()
  const secret: RelayConfigSecret = {
    id: randomUUID(),
    teamId: input.teamId,
    name: input.name,
    encryptedPayload: {
      algorithm: configSecretAlgorithm,
      ciphertext: '',
      iv: '',
      tag: '',
      version: 1
    },
    secretVersion: 1,
    createdByUserId: input.createdByUserId,
    createdAt
  }
  secret.encryptedPayload = encryptAtRestPayload(args, secret, input.value)
  return secret
}

export const rotateRelayConfigSecret = (
  args: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>,
  secret: RelayConfigSecret,
  value: string
) => {
  secret.secretVersion += 1
  secret.encryptedPayload = encryptAtRestPayload(args, secret, value)
  secret.rotatedAt = now()
  secret.revokedAt = undefined
}

export const revokeRelayConfigSecret = (secret: RelayConfigSecret) => {
  secret.revokedAt = now()
}

export const relayConfigSecretExpiresAt = (store: Pick<RelayStore, 'teamPolicy'>) => {
  const hours = Math.max(1, Math.trunc(store.teamPolicy.maxSecretTtlHours ?? defaultSecretTtlHours))
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

export const createRelayConfigSnapshotSecretEnvelopes = (params: {
  args?: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>
  expiresAt: string
  recipientDevice?: RelayDevice
  recipientDeviceToken?: string
  secretRefs?: Record<string, string>
  store: RelayStore
  teamId: string
}): RelayConfigSnapshotSecretEnvelope[] => {
  if (
    params.args == null ||
    params.recipientDevice == null ||
    params.recipientDeviceToken == null ||
    params.recipientDeviceToken === '' ||
    params.secretRefs == null
  ) {
    return []
  }
  const args = params.args
  const recipientDevice = params.recipientDevice
  const recipientDeviceToken = params.recipientDeviceToken

  return Object.entries(params.secretRefs)
    .map(([ref, secretId]) => {
      const secret = params.store.configSecrets.find(item =>
        item.id === secretId && item.teamId === params.teamId && item.revokedAt == null
      )
      if (secret == null) return undefined
      const plaintext = decryptRelayConfigSecretValue(args, secret)
      if (plaintext == null) return undefined
      return encryptRelayConfigSnapshotSecretEnvelope({
        deviceToken: recipientDeviceToken,
        expiresAt: params.expiresAt,
        plaintext,
        recipientDeviceId: recipientDevice.id,
        ref,
        secretId: secret.id,
        secretVersion: secret.secretVersion
      })
    })
    .filter((item): item is RelayConfigSnapshotSecretEnvelope => item != null)
}
