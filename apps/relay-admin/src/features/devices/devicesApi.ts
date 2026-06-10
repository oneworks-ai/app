import { requestJson } from '../../shared/api/requestJson'
import type { RelayAdminDevice, RelayAdminDeviceSession } from '../../shared/model/adminTypes'

export const fetchRelayAdminDevices = async (token: string) =>
  await requestJson<{ devices: RelayAdminDevice[] }>(token, '/api/relay/devices')

export const fetchRelayAdminDeviceSessions = async (token: string, deviceId: string) =>
  await requestJson<{
    deviceId: string
    sessions: RelayAdminDeviceSession[]
    updatedAt: string
  }>(token, `/api/relay/devices/${encodeURIComponent(deviceId)}/sessions`)
