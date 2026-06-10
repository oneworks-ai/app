import type { RelayDevice, RelayDeviceStatus, RelayServerArgs } from '../types.js'

export const deviceStatusFor = (
  device: Pick<RelayDevice, 'lastSeenAt'>,
  args: Pick<RelayServerArgs, 'deviceOnlineTtlMs'>,
  nowMs = Date.now()
): RelayDeviceStatus => {
  const lastSeenMs = Date.parse(device.lastSeenAt)
  if (!Number.isFinite(lastSeenMs)) return 'offline'
  const ttl = args.deviceOnlineTtlMs ?? 60 * 1000
  const age = nowMs - lastSeenMs
  if (age <= ttl) return 'online'
  if (age <= ttl * 3) return 'stale'
  return 'offline'
}
