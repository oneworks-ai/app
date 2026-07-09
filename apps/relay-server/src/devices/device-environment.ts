import { isRecord } from '../utils.js'

export interface RelayDeviceEnvironmentInfo {
  arch?: string
  deviceType?: string
  osName?: string
  osPlatform?: string
  osRelease?: string
  osVersion?: string
  runtime?: string
  runtimeVersion?: string
}

export const cleanDeviceMetadataText = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const cleanBoundedText = (value: unknown, maxLength: number) => {
  const text = cleanDeviceMetadataText(value)
  return text === '' ? '' : text.slice(0, maxLength)
}

export const cleanNetworkAddress = (value: unknown) => {
  const text = cleanBoundedText(value, 128)
  return text === 'unknown' ? '' : text
}

const environmentText = (record: Record<string, unknown>, key: string, maxLength = 80) =>
  cleanBoundedText(record[key], maxLength)

export const normalizeDeviceEnvironmentInfo = (value: unknown): RelayDeviceEnvironmentInfo | undefined => {
  if (!isRecord(value)) return undefined
  const os = isRecord(value.os) ? value.os : {}
  const runtime = isRecord(value.runtime) ? value.runtime : {}
  const deviceType = environmentText(value, 'deviceType') || environmentText(value, 'type')
  const osName = environmentText(value, 'osName') || environmentText(os, 'name')
  const osPlatform = environmentText(value, 'osPlatform') || environmentText(os, 'platform')
  const osRelease = environmentText(value, 'osRelease') || environmentText(os, 'release')
  const osVersion = environmentText(value, 'osVersion') || environmentText(os, 'version')
  const runtimeName = environmentText(value, 'runtime') || environmentText(runtime, 'kind')
  const runtimeVersion = environmentText(value, 'runtimeVersion') || environmentText(runtime, 'version')
  const arch = environmentText(value, 'arch') || environmentText(os, 'arch')
  const info = {
    ...(arch === '' ? {} : { arch }),
    ...(deviceType === '' ? {} : { deviceType }),
    ...(osName === '' ? {} : { osName }),
    ...(osPlatform === '' ? {} : { osPlatform }),
    ...(osRelease === '' ? {} : { osRelease }),
    ...(osVersion === '' ? {} : { osVersion }),
    ...(runtimeName === '' ? {} : { runtime: runtimeName }),
    ...(runtimeVersion === '' ? {} : { runtimeVersion })
  }
  return Object.keys(info).length === 0 ? undefined : info
}
