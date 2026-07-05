import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import process from 'node:process'

import type { RelayDevice, RelayEncryptedPayload, RelayServerArgs } from '../types.js'
import { isRecord } from '../utils.js'

export interface RelayDevicePrivateMetadata {
  alias?: string
  capabilities: Record<string, unknown>
  name: string
  pluginScope?: string
  workspaceFolder?: string
}

const metadataAlgorithm = 'aes-256-gcm' as const

const cleanText = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export const hashDeviceToken = (token: string) => `sha256:${createHash('sha256').update(token).digest('base64url')}`

const safeEqualText = (a: string, b: string) => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export const deviceTokenMatches = (device: RelayDevice, token: string) => {
  if (token === '') return false
  if (device.deviceTokenHash != null && safeEqualText(device.deviceTokenHash, hashDeviceToken(token))) {
    return true
  }
  return device.deviceToken === token
}

const deviceMetadataSecret = (args: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>) => {
  const configured = cleanText(args.deviceMetadataSecret ?? process.env.ONEWORKS_RELAY_DEVICE_METADATA_SECRET)
  if (configured !== '') return configured
  if (args.adminToken !== '') return args.adminToken
  return `oneworks-relay-device-metadata:${args.dataPath}`
}

const deviceMetadataKey = (
  args: Pick<RelayServerArgs, 'adminToken' | 'dataPath'>,
  userId: string | undefined
) =>
  createHash('sha256')
    .update(deviceMetadataSecret(args))
    .update('\0')
    .update(userId ?? 'unowned')
    .digest()

const deviceMetadataAad = (deviceId: string, userId: string | undefined) =>
  Buffer.from(`${deviceId}\0${userId ?? 'unowned'}`, 'utf8')

export const normalizeDevicePrivateMetadata = (
  input: Partial<RelayDevicePrivateMetadata>,
  fallbackName: string
): RelayDevicePrivateMetadata => {
  const alias = cleanText(input.alias)
  const name = cleanText(input.name)
  const workspaceFolder = cleanText(input.workspaceFolder)
  const pluginScope = cleanText(input.pluginScope)
  return {
    ...(alias === '' ? {} : { alias }),
    capabilities: isRecord(input.capabilities) ? input.capabilities : {},
    name: name === '' ? fallbackName : name,
    ...(pluginScope === '' ? {} : { pluginScope }),
    ...(workspaceFolder === '' ? {} : { workspaceFolder })
  }
}

export const legacyDevicePrivateMetadata = (device: RelayDevice): RelayDevicePrivateMetadata =>
  normalizeDevicePrivateMetadata({
    alias: device.alias,
    capabilities: device.capabilities,
    name: device.name,
    pluginScope: device.pluginScope,
    workspaceFolder: device.workspaceFolder
  }, device.id)

export const encryptDevicePrivateMetadata = (
  args: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>,
  device: Pick<RelayDevice, 'id' | 'userId'>,
  metadata: RelayDevicePrivateMetadata
): RelayEncryptedPayload => {
  const iv = randomBytes(12)
  const cipher = createCipheriv(metadataAlgorithm, deviceMetadataKey(args, device.userId), iv)
  cipher.setAAD(deviceMetadataAad(device.id, device.userId))
  const plaintext = Buffer.from(JSON.stringify(metadata), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    algorithm: metadataAlgorithm,
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    version: 1
  }
}

export const decryptDevicePrivateMetadata = (
  args: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>,
  device: RelayDevice
): RelayDevicePrivateMetadata | undefined => {
  const encrypted = device.encryptedMetadata
  if (encrypted == null || encrypted.algorithm !== metadataAlgorithm || encrypted.version !== 1) return undefined

  try {
    const decipher = createDecipheriv(
      metadataAlgorithm,
      deviceMetadataKey(args, device.userId),
      Buffer.from(encrypted.iv, 'base64url')
    )
    decipher.setAAD(deviceMetadataAad(device.id, device.userId))
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64url'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
      decipher.final()
    ])
    const parsed = JSON.parse(plaintext.toString('utf8'))
    if (!isRecord(parsed)) return undefined
    return normalizeDevicePrivateMetadata({
      alias: typeof parsed.alias === 'string' ? parsed.alias : undefined,
      capabilities: isRecord(parsed.capabilities) ? parsed.capabilities : undefined,
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      pluginScope: typeof parsed.pluginScope === 'string' ? parsed.pluginScope : undefined,
      workspaceFolder: typeof parsed.workspaceFolder === 'string' ? parsed.workspaceFolder : undefined
    }, device.id)
  } catch {
    return undefined
  }
}

export const visibleDevicePrivateMetadata = (
  args: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>,
  device: RelayDevice
) => decryptDevicePrivateMetadata(args, device) ?? legacyDevicePrivateMetadata(device)

export const storeEncryptedDevicePrivateMetadata = (
  args: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>,
  device: RelayDevice,
  metadata: RelayDevicePrivateMetadata
) => {
  device.encryptedMetadata = encryptDevicePrivateMetadata(args, device, metadata)
  device.name = undefined
  device.alias = undefined
  device.capabilities = undefined
  device.workspaceFolder = undefined
  device.pluginScope = undefined
}
