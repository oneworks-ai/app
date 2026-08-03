import { deviceTokenHashMatches, deviceTokenMatches, hashDeviceToken } from '../devices/private-metadata.js'
import { devicePrincipalForDevice, hasRelayPermission, relayPermissions } from '../permissions/index.js'
import { applyDeviceHeartbeat } from '../routes/devices.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayTelemetry } from '../telemetry/metrics.js'
import type { RelayServerArgs, RelayStore } from '../types.js'

/** Only the token digest survives the HTTP upgrade. Platform socket state never holds a bearer token. */
export interface RelayControlAttachment {
  connectionIp?: string
  deviceId: string
  deviceTokenHash: string
  version: 1
}

export const RELAY_CONTROL_MAX_FRAME_BYTES = 64 * 1024

export type RelayControlFrame = string | ArrayBuffer | Uint8Array | Uint8Array[]
export type RelayControlFrameResult = 'applied' | 'frame-too-large' | 'invalid-frame' | 'revoked'

const hasControlPermissions = (store: RelayStore, device: RelayStore['devices'][number] | undefined) => {
  const principal = device == null ? undefined : devicePrincipalForDevice(device)
  const owner = device?.userId == null ? undefined : store.users.find(user => user.id === device.userId)
  return principal != null && (owner == null || owner.disabledAt == null) &&
    hasRelayPermission(principal, relayPermissions.relayDevicesHeartbeat) &&
    hasRelayPermission(principal, relayPermissions.relayJobsRead)
}

export const createRelayControlAttachment = (
  store: RelayStore,
  input: { connectionIp?: string; deviceId: string; deviceToken: string }
): RelayControlAttachment | undefined => {
  const device = store.devices.find(item => item.id === input.deviceId)
  // Deliberately compare the digest, including for legacy plaintext records, so callers can discard the raw token now.
  const tokenHash = hashDeviceToken(input.deviceToken)
  const matches = device != null && deviceTokenMatches(device, input.deviceToken)
  if (!matches || !hasControlPermissions(store, device)) return undefined
  return {
    ...(input.connectionIp == null || input.connectionIp === '' ? {} : { connectionIp: input.connectionIp }),
    deviceId: input.deviceId,
    deviceTokenHash: tokenHash,
    version: 1
  }
}

const utf8ByteLengthAtMost = (value: string, maximum: number) => {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7F) bytes += 1
    else if (code <= 0x7FF) bytes += 2
    else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xDC00 && next <= 0xDFFF) index += 1
      bytes += 4
    } else bytes += 3
    if (bytes > maximum) return bytes
  }
  return bytes
}

const byteLength = (rawFrame: RelayControlFrame) => (
  typeof rawFrame === 'string'
    ? utf8ByteLengthAtMost(rawFrame, RELAY_CONTROL_MAX_FRAME_BYTES)
    : Array.isArray(rawFrame)
    ? rawFrame.reduce((total, item) => total + item.byteLength, 0)
    : rawFrame.byteLength
)

const toBytes = (rawFrame: Exclude<RelayControlFrame, string>) => {
  if (!Array.isArray(rawFrame)) return rawFrame
  const bytes = new Uint8Array(byteLength(rawFrame))
  let offset = 0
  for (const item of rawFrame) {
    bytes.set(item, offset)
    offset += item.byteLength
  }
  return bytes
}

const parseHeartbeatFrame = (rawFrame: RelayControlFrame) => {
  if (byteLength(rawFrame) > RELAY_CONTROL_MAX_FRAME_BYTES) return 'frame-too-large' as const
  const text = typeof rawFrame === 'string' ? rawFrame : new TextDecoder().decode(toBytes(rawFrame))
  let frame: unknown
  try {
    frame = JSON.parse(text)
  } catch {
    return undefined
  }
  if (frame == null || typeof frame !== 'object' || Array.isArray(frame)) return undefined
  if ((frame as { type?: unknown }).type !== 'heartbeat') return undefined
  return { payload: (frame as { payload?: unknown }).payload ?? {} }
}

/**
 * Revalidates a digest-only socket attachment on every message, migrates legacy plaintext
 * device tokens in the same transaction, and applies the ordinary heartbeat mutation.
 */
export const applyRelayControlHeartbeatFrame = async (input: {
  args: RelayServerArgs
  attachment: RelayControlAttachment
  frame: RelayControlFrame
  repository: RelayStoreRepository
  telemetry?: RelayTelemetry
}): Promise<RelayControlFrameResult> => {
  const parsedFrame = parseHeartbeatFrame(input.frame)
  if (parsedFrame === 'frame-too-large') return parsedFrame
  if (parsedFrame == null) return 'invalid-frame'
  let result: RelayControlFrameResult = 'revoked'
  const apply = async (store: RelayStore, repository: RelayStoreRepository) => {
    const device = store.devices.find(item =>
      item.id === input.attachment.deviceId && (
        deviceTokenHashMatches(item.deviceTokenHash, input.attachment.deviceTokenHash) || (
          item.deviceToken != null &&
          deviceTokenHashMatches(hashDeviceToken(item.deviceToken), input.attachment.deviceTokenHash)
        )
      )
    )
    if (!hasControlPermissions(store, device) || device == null) return
    if (device.deviceTokenHash == null && device.deviceToken != null) {
      device.deviceTokenHash = input.attachment.deviceTokenHash
      delete device.deviceToken
    }
    await applyDeviceHeartbeat({
      args: input.args,
      body: parsedFrame.payload,
      ...(input.attachment.connectionIp == null ? {} : { connectionIp: input.attachment.connectionIp }),
      device,
      store,
      storeRepository: repository,
      telemetry: input.telemetry
    })
    result = 'applied'
  }
  if (input.repository.withStore != null) await input.repository.withStore(apply)
  else await apply(await input.repository.read(), input.repository)
  return result
}
