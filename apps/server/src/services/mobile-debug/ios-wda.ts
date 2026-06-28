/* eslint-disable max-lines -- iOS WDA support coordinates target config, launch, streaming, tree parsing, and input commands. */

import { Buffer } from 'node:buffer'
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { Readable } from 'node:stream'

import type {
  MobileDebugDevice,
  MobileDebugIosWdaTargetConfig,
  MobileDeviceInputEvent,
  MobileDeviceLogsResponse,
  MobileDeviceScreenshotResponse,
  MobileElementBounds,
  MobileElementNode,
  MobileElementTreeResponse
} from './index.js'

const IOS_WDA_STATUS_TIMEOUT_MS = 3500
const IOS_WDA_REQUEST_TIMEOUT_MS = 6000
const IOS_WDA_STREAM_TIMEOUT_MS = 3000
const IOS_WDA_DEVICE_ID_PREFIX = 'ios-wda:'
const IOS_WDA_DEFAULT_DEVICE_ID = 'ios-wda-local-8100'
const IOS_WDA_DEFAULT_URL = 'http://127.0.0.1:8100/'
const IOS_WDA_DEFAULT_MJPEG_URL = 'http://127.0.0.1:9100/'
const IOS_WDA_SIMULATOR_DEVICE_ID = 'ios-wda-simulator-local-8200'
const IOS_WDA_SIMULATOR_URL = 'http://127.0.0.1:8200/'
const IOS_WDA_SIMULATOR_MJPEG_URL = 'http://127.0.0.1:9200/'
const IOS_WDA_HEALTH_CACHE_MS = 45_000
const IOS_WDA_MJPEG_PROBE_TIMEOUT_MS = 900
const IOS_WDA_READY_PROBE_TIMEOUT_MS = 1200
const IOS_WDA_AUTO_START_READY_TIMEOUT_MS = 12_000
const IOS_WDA_AUTO_START_RETRY_MS = 20_000
const IOS_WDA_SWIPE_HOLD_MS = 50
const IOS_WDA_SWIPE_MAX_DURATION_MS = 300
const readIosWdaHostHomeDir = () => {
  const realHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__?.trim()
  if (realHome != null && realHome !== '') return realHome
  return os.userInfo().homedir || os.homedir()
}
const IOS_WDA_HOME_DIR = path.join(readIosWdaHostHomeDir(), '.oneworks', 'mobile-debug')
const IOS_WDA_DEFAULT_DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer'
const IOS_WDA_DEFAULT_PROJECT_PATH = path.join(IOS_WDA_HOME_DIR, 'WebDriverAgent', 'WebDriverAgent.xcodeproj')
const IOS_WDA_DEFAULT_DERIVED_DATA_PATH = path.join(IOS_WDA_HOME_DIR, 'DerivedData')
const IOS_WDA_SIMULATOR_DERIVED_DATA_PATH = path.join(IOS_WDA_HOME_DIR, 'DerivedData-Simulator')
const IOS_WDA_WDA_LOG_PATH = path.join(IOS_WDA_HOME_DIR, 'wda-background.log')
const IOS_WDA_WDA_PID_PATH = path.join(IOS_WDA_HOME_DIR, 'wda-background.pid')
const IOS_WDA_IPROXY_LOG_PATH = path.join(IOS_WDA_HOME_DIR, 'iproxy-background.log')
const IOS_WDA_IPROXY_PID_PATH = path.join(IOS_WDA_HOME_DIR, 'iproxy.pid')
const IOS_WDA_RUN_LOG_PATH = path.join(IOS_WDA_HOME_DIR, 'wda-run.log')

export interface NormalizedIosWdaTargetConfig
  extends Required<Pick<MobileDebugIosWdaTargetConfig, 'enabled' | 'label'>>
{
  autoStart: boolean
  derivedDataPath?: string
  developerDir?: string
  developmentTeam?: string
  destinationPlatform: 'device' | 'simulator'
  id: string
  isImplicitDefault: boolean
  mjpegUrl?: string
  productBundleIdentifier?: string
  udid?: string
  wdaProjectPath?: string
  wdaUrl: string
}

interface IosWdaAutoStartConfig {
  derivedDataPath: string
  developerDir: string
  developmentTeam?: string
  destinationPlatform: 'device' | 'simulator'
  mjpegServerPort: number
  productBundleIdentifier?: string
  udid: string
  wdaProjectPath: string
  wdaServerPort: number
}

interface IosWdaCommandResult {
  stderr: string
  stdout: string
}

interface IosWdaHealthRecord {
  checkedAt: number
  label: string
}

interface IosWdaMjpegSettings {
  animationCoolOffTimeout: number
  mjpegScalingFactor: number
  mjpegServerFramerate: number
  mjpegServerScreenshotQuality: number
  waitForIdleTimeout: number
}

interface IosWdaSessionRecord {
  createdAt: number
  sessionId: string
}

interface IosWdaDecodedDevice {
  destinationPlatform?: 'device' | 'simulator'
  mjpegUrl?: string
  wdaUrl: string
}

interface IosWdaTouchGesture {
  startedAt: number
  x: number
  y: number
}

interface RasterImageSize {
  height: number
  width: number
}

const iosWdaSessionByUrl = new Map<string, IosWdaSessionRecord>()
const iosWdaTouchGestureByDeviceId = new Map<string, IosWdaTouchGesture>()
const iosWdaHealthByUrl = new Map<string, IosWdaHealthRecord>()
const iosWdaStartupByUrl = new Map<string, { attemptedAt: number; promise: Promise<void> }>()
const iosWdaMjpegSettingsByUrl = new Map<string, { appliedAt: number; sessionId: string }>()

const toErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizePort = (value: unknown) => {
  const parsedValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/u.test(value.trim())
    ? Number.parseInt(value, 10)
    : undefined
  if (typeof parsedValue !== 'number' || !Number.isInteger(parsedValue) || parsedValue < 1 || parsedValue > 65535) {
    return undefined
  }
  return parsedValue
}

const normalizeBoundedNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const parsedValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
    ? Number.parseFloat(value)
    : Number.NaN
  if (!Number.isFinite(parsedValue)) return fallback
  return Math.max(min, Math.min(max, Math.round(parsedValue)))
}

const readIosWdaMjpegSettings = (): IosWdaMjpegSettings => ({
  animationCoolOffTimeout: normalizeBoundedNumber(process.env.ONEWORKS_IOS_WDA_ANIMATION_COOLOFF_TIMEOUT, 0, 0, 60),
  mjpegScalingFactor: normalizeBoundedNumber(process.env.ONEWORKS_IOS_WDA_MJPEG_SCALING_FACTOR, 55, 1, 100),
  mjpegServerFramerate: normalizeBoundedNumber(process.env.ONEWORKS_IOS_WDA_MJPEG_FRAMERATE, 12, 1, 60),
  mjpegServerScreenshotQuality: normalizeBoundedNumber(process.env.ONEWORKS_IOS_WDA_MJPEG_QUALITY, 20, 1, 100),
  waitForIdleTimeout: normalizeBoundedNumber(process.env.ONEWORKS_IOS_WDA_WAIT_FOR_IDLE_TIMEOUT, 0, 0, 60)
})

const normalizeHttpEndpoint = (value: unknown, defaultPort?: number) => {
  if (typeof value !== 'string') return undefined
  const trimmedValue = value.trim()
  if (trimmedValue === '') return undefined

  const directPort = normalizePort(trimmedValue)
  const rawUrl = directPort == null
    ? /^[a-z][a-z\d+.-]*:/iu.test(trimmedValue) ? trimmedValue : `http://${trimmedValue}`
    : `http://127.0.0.1:${directPort}`
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.hostname.trim() === '') return undefined
    if (url.port === '' && defaultPort != null) url.port = String(defaultPort)
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return undefined
  }
}

const buildDefaultMjpegUrl = (wdaUrl: string) => {
  try {
    const url = new URL(wdaUrl)
    url.port = url.port === '8200' ? '9200' : '9100'
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return undefined
  }
}

const toBase64Url = (value: string) =>
  Buffer.from(value, 'utf8')
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')

const fromBase64Url = (value: string) => {
  const paddedValue = `${value.replaceAll('-', '+').replaceAll('_', '/')}${'='.repeat((4 - value.length % 4) % 4)}`
  return Buffer.from(paddedValue, 'base64').toString('utf8')
}

const createIosWdaDeviceId = (
  target: Pick<NormalizedIosWdaTargetConfig, 'destinationPlatform' | 'mjpegUrl' | 'wdaUrl'>
) => {
  if (target.wdaUrl === IOS_WDA_DEFAULT_URL && target.mjpegUrl === IOS_WDA_DEFAULT_MJPEG_URL) {
    return IOS_WDA_DEFAULT_DEVICE_ID
  }
  if (target.wdaUrl === IOS_WDA_SIMULATOR_URL && target.mjpegUrl === IOS_WDA_SIMULATOR_MJPEG_URL) {
    return IOS_WDA_SIMULATOR_DEVICE_ID
  }
  return `${IOS_WDA_DEVICE_ID_PREFIX}${
    toBase64Url(JSON.stringify({
      mjpegUrl: target.mjpegUrl,
      destinationPlatform: target.destinationPlatform,
      wdaUrl: target.wdaUrl
    }))
  }`
}

export const isIosWdaDeviceId = (deviceId: unknown) =>
  typeof deviceId === 'string' &&
  (
    deviceId === IOS_WDA_DEFAULT_DEVICE_ID ||
    deviceId === IOS_WDA_SIMULATOR_DEVICE_ID ||
    deviceId.startsWith(IOS_WDA_DEVICE_ID_PREFIX)
  )

const normalizeIosWdaDestinationPlatform = (value: unknown): 'device' | 'simulator' => {
  if (value === 'simulator' || value === 'ios-simulator') return 'simulator'
  return 'device'
}

const decodeIosWdaDeviceId = (deviceId: unknown): IosWdaDecodedDevice => {
  if (deviceId === IOS_WDA_DEFAULT_DEVICE_ID) {
    return {
      destinationPlatform: 'device',
      mjpegUrl: IOS_WDA_DEFAULT_MJPEG_URL,
      wdaUrl: IOS_WDA_DEFAULT_URL
    }
  }
  if (deviceId === IOS_WDA_SIMULATOR_DEVICE_ID) {
    return {
      destinationPlatform: 'simulator',
      mjpegUrl: IOS_WDA_SIMULATOR_MJPEG_URL,
      wdaUrl: IOS_WDA_SIMULATOR_URL
    }
  }
  if (typeof deviceId !== 'string' || !deviceId.startsWith(IOS_WDA_DEVICE_ID_PREFIX)) {
    throw new Error('Invalid iOS WDA device id.')
  }

  try {
    const decodedValue = JSON.parse(fromBase64Url(deviceId.slice(IOS_WDA_DEVICE_ID_PREFIX.length))) as unknown
    if (!isRecord(decodedValue)) throw new Error('Invalid iOS WDA device id.')
    const wdaUrl = normalizeHttpEndpoint(decodedValue.wdaUrl, 8100)
    if (wdaUrl == null) throw new Error('Invalid iOS WDA URL.')
    const mjpegUrl = normalizeHttpEndpoint(decodedValue.mjpegUrl, 9100)
    const destinationPlatform = normalizeIosWdaDestinationPlatform(decodedValue.destinationPlatform)
    return { destinationPlatform, mjpegUrl, wdaUrl }
  } catch (error) {
    throw new Error(`Invalid iOS WDA device id: ${toErrorMessage(error)}`)
  }
}

const createDefaultIosWdaTarget = (): NormalizedIosWdaTargetConfig => ({
  autoStart: true,
  derivedDataPath: IOS_WDA_DEFAULT_DERIVED_DATA_PATH,
  enabled: true,
  developerDir: IOS_WDA_DEFAULT_DEVELOPER_DIR,
  destinationPlatform: 'device',
  id: 'ios-wda-local',
  isImplicitDefault: true,
  label: 'iOS WDA',
  mjpegUrl: IOS_WDA_DEFAULT_MJPEG_URL,
  wdaProjectPath: IOS_WDA_DEFAULT_PROJECT_PATH,
  wdaUrl: IOS_WDA_DEFAULT_URL
})

const createDefaultIosWdaSimulatorTarget = (): NormalizedIosWdaTargetConfig => ({
  autoStart: true,
  derivedDataPath: IOS_WDA_SIMULATOR_DERIVED_DATA_PATH,
  enabled: true,
  developerDir: IOS_WDA_DEFAULT_DEVELOPER_DIR,
  destinationPlatform: 'simulator',
  id: 'ios-wda-simulator',
  isImplicitDefault: true,
  label: 'iOS Simulator WDA',
  mjpegUrl: IOS_WDA_SIMULATOR_MJPEG_URL,
  wdaProjectPath: IOS_WDA_DEFAULT_PROJECT_PATH,
  wdaUrl: IOS_WDA_SIMULATOR_URL
})

const createDefaultIosWdaTargets = () => [
  createDefaultIosWdaTarget(),
  createDefaultIosWdaSimulatorTarget()
]

export const normalizeIosWdaTargetConfigs = (record: Record<string, unknown>): NormalizedIosWdaTargetConfig[] => {
  if (!Array.isArray(record.iosWdaTargets)) return createDefaultIosWdaTargets()
  return record.iosWdaTargets
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item, index) => {
      const wdaUrl = normalizeHttpEndpoint(item.wdaUrl, 8100)
      if (wdaUrl == null) return undefined
      const mjpegUrl = normalizeHttpEndpoint(item.mjpegUrl, 9100) ?? buildDefaultMjpegUrl(wdaUrl)
      const isLocalDefaultTarget = wdaUrl === IOS_WDA_DEFAULT_URL && mjpegUrl === IOS_WDA_DEFAULT_MJPEG_URL
      const isLocalSimulatorTarget = wdaUrl === IOS_WDA_SIMULATOR_URL && mjpegUrl === IOS_WDA_SIMULATOR_MJPEG_URL
      const target: NormalizedIosWdaTargetConfig = {
        autoStart: typeof item.autoStart === 'boolean'
          ? item.autoStart
          : isLocalDefaultTarget || isLocalSimulatorTarget,
        enabled: item.enabled !== false,
        destinationPlatform: normalizeIosWdaDestinationPlatform(
          item.destinationPlatform ?? (isLocalSimulatorTarget ? 'simulator' : undefined)
        ),
        id: typeof item.id === 'string' && item.id.trim() !== '' ? item.id.trim() : `ios-wda-${index}`,
        isImplicitDefault: false,
        label: typeof item.label === 'string' && item.label.trim() !== '' ? item.label.trim() : `iOS WDA ${index + 1}`,
        wdaUrl
      }
      if (mjpegUrl != null) target.mjpegUrl = mjpegUrl
      if (typeof item.derivedDataPath === 'string' && item.derivedDataPath.trim() !== '') {
        target.derivedDataPath = item.derivedDataPath.trim()
      } else if (isLocalDefaultTarget) {
        target.derivedDataPath = IOS_WDA_DEFAULT_DERIVED_DATA_PATH
      } else if (isLocalSimulatorTarget) {
        target.derivedDataPath = IOS_WDA_SIMULATOR_DERIVED_DATA_PATH
      }
      if (typeof item.developerDir === 'string' && item.developerDir.trim() !== '') {
        target.developerDir = item.developerDir.trim()
      } else if (isLocalDefaultTarget || isLocalSimulatorTarget) {
        target.developerDir = IOS_WDA_DEFAULT_DEVELOPER_DIR
      }
      if (typeof item.developmentTeam === 'string' && item.developmentTeam.trim() !== '') {
        target.developmentTeam = item.developmentTeam.trim()
      }
      if (typeof item.productBundleIdentifier === 'string' && item.productBundleIdentifier.trim() !== '') {
        target.productBundleIdentifier = item.productBundleIdentifier.trim()
      }
      if (typeof item.udid === 'string' && item.udid.trim() !== '') {
        target.udid = item.udid.trim()
      }
      if (typeof item.wdaProjectPath === 'string' && item.wdaProjectPath.trim() !== '') {
        target.wdaProjectPath = item.wdaProjectPath.trim()
      } else if (isLocalDefaultTarget || isLocalSimulatorTarget) {
        target.wdaProjectPath = IOS_WDA_DEFAULT_PROJECT_PATH
      }
      return target
    })
    .filter((target): target is NormalizedIosWdaTargetConfig => target != null)
}

const requestUrl = async (url: string, init: RequestInit = {}, timeoutMs = IOS_WDA_REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

const requestIosWda = async (
  target: Pick<IosWdaDecodedDevice, 'wdaUrl'>,
  pathname: string,
  init: RequestInit = {},
  timeoutMs = IOS_WDA_REQUEST_TIMEOUT_MS
) => {
  const url = new URL(pathname, target.wdaUrl)
  return await requestUrl(url.toString(), init, timeoutMs)
}

const fetchIosWdaJson = async <T>(
  target: Pick<IosWdaDecodedDevice, 'wdaUrl'>,
  pathname: string,
  init: RequestInit = {},
  timeoutMs = IOS_WDA_REQUEST_TIMEOUT_MS
): Promise<T> => {
  const response = await requestIosWda(target, pathname, init, timeoutMs)
  const text = await response.text()
  if (!response.ok) {
    throw new Error(text.trim() || `WDA request failed with ${response.status}.`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('WDA returned invalid JSON.')
  }
}

const postIosWdaJson = <T>(
  target: Pick<IosWdaDecodedDevice, 'wdaUrl'>,
  pathname: string,
  body: unknown
) =>
  fetchIosWdaJson<T>(target, pathname, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  })

const getResponseValue = (body: unknown) => isRecord(body) && 'value' in body ? body.value : body

const getSessionIdFromBody = (body: unknown): string | undefined => {
  if (!isRecord(body)) return undefined
  const directSessionId = body.sessionId
  if (typeof directSessionId === 'string' && directSessionId.trim() !== '') return directSessionId.trim()
  const value = body.value
  if (!isRecord(value)) return undefined
  const valueSessionId = value.sessionId ?? value.session_id
  return typeof valueSessionId === 'string' && valueSessionId.trim() !== '' ? valueSessionId.trim() : undefined
}

const readExistingIosWdaSession = async (target: IosWdaDecodedDevice) => {
  try {
    const body = await fetchIosWdaJson<unknown>(target, '/sessions')
    const value = getResponseValue(body)
    if (!Array.isArray(value)) return undefined
    const session = value.find(item => isRecord(item) && typeof item.id === 'string')
    return isRecord(session) && typeof session.id === 'string' ? session.id : undefined
  } catch {
    return undefined
  }
}

const readIosWdaStatusSession = async (target: IosWdaDecodedDevice) => {
  try {
    return getSessionIdFromBody(await readIosWdaStatus(target))
  } catch {
    return undefined
  }
}

const createIosWdaSession = async (target: IosWdaDecodedDevice) => {
  const bodies = [
    {
      capabilities: {
        alwaysMatch: {},
        firstMatch: [{}]
      },
      desiredCapabilities: {}
    },
    {
      capabilities: {
        alwaysMatch: {},
        firstMatch: [{}]
      }
    },
    { desiredCapabilities: {} }
  ]
  for (const body of bodies) {
    try {
      const result = await postIosWdaJson<unknown>(target, '/session', body)
      const sessionId = getSessionIdFromBody(result)
      if (sessionId != null) return sessionId
    } catch {
      // Retry with the next WebDriver dialect.
    }
  }
  return await readExistingIosWdaSession(target) ?? await readIosWdaStatusSession(target)
}

const applyIosWdaMjpegSettings = async (
  target: IosWdaDecodedDevice,
  sessionId: string
) => {
  const cachedSettings = iosWdaMjpegSettingsByUrl.get(target.wdaUrl)
  if (
    cachedSettings != null &&
    cachedSettings.sessionId === sessionId &&
    Date.now() - cachedSettings.appliedAt < 10 * 60_000
  ) {
    return
  }

  try {
    await postIosWdaJson<unknown>(
      target,
      withSessionPath(sessionId, '/appium/settings'),
      { settings: readIosWdaMjpegSettings() }
    )
    iosWdaMjpegSettingsByUrl.set(target.wdaUrl, { appliedAt: Date.now(), sessionId })
  } catch {
    // Older WDA builds may not expose runtime MJPEG settings; keep the stream usable.
  }
}

const ensureIosWdaSession = async (
  target: IosWdaDecodedDevice,
  options: { preferStatusSession?: boolean; skipMjpegSettings?: boolean } = {}
) => {
  if (options.preferStatusSession) {
    const statusSessionId = await readIosWdaStatusSession(target)
    if (statusSessionId != null) {
      const cachedSession = iosWdaSessionByUrl.get(target.wdaUrl)
      if (cachedSession == null || cachedSession.sessionId !== statusSessionId) {
        iosWdaMjpegSettingsByUrl.delete(target.wdaUrl)
        iosWdaSessionByUrl.set(target.wdaUrl, { createdAt: Date.now(), sessionId: statusSessionId })
      }
      if (options.skipMjpegSettings !== true) await applyIosWdaMjpegSettings(target, statusSessionId)
      return statusSessionId
    }
  }

  const cachedSession = iosWdaSessionByUrl.get(target.wdaUrl)
  if (cachedSession != null && Date.now() - cachedSession.createdAt < 30 * 60_000) {
    if (options.skipMjpegSettings !== true) await applyIosWdaMjpegSettings(target, cachedSession.sessionId)
    return cachedSession.sessionId
  }

  const sessionId = await createIosWdaSession(target)
  if (sessionId == null) throw new Error('Failed to create an iOS WDA session.')
  iosWdaSessionByUrl.set(target.wdaUrl, { createdAt: Date.now(), sessionId })
  if (options.skipMjpegSettings !== true) await applyIosWdaMjpegSettings(target, sessionId)
  return sessionId
}

const withSessionPath = (sessionId: string, suffix: string) => `/session/${encodeURIComponent(sessionId)}${suffix}`

const resetIosWdaSession = (target: Pick<IosWdaDecodedDevice, 'wdaUrl'>) => {
  iosWdaSessionByUrl.delete(target.wdaUrl)
  iosWdaMjpegSettingsByUrl.delete(target.wdaUrl)
}

const resetIosWdaConnectionState = (target: Pick<IosWdaDecodedDevice, 'wdaUrl'>) => {
  resetIosWdaSession(target)
  iosWdaHealthByUrl.delete(target.wdaUrl)
}

const isRecoverableIosWdaSessionError = (error: unknown) => (
  /invalid session|session .*not|session .*exist|no such driver|failed to create an ios wda session/iu
    .test(toErrorMessage(error))
)

const readIosWdaStatus = async (
  target: Pick<IosWdaDecodedDevice, 'wdaUrl'>,
  timeoutMs = IOS_WDA_STATUS_TIMEOUT_MS
) => await fetchIosWdaJson<unknown>(target, '/status', undefined, timeoutMs)

const readIosWdaDeviceName = (status: unknown, fallback: string) => {
  const value = getResponseValue(status)
  if (!isRecord(value)) return fallback
  const candidates = [
    value.deviceName,
    value.name,
    isRecord(value.ios) ? value.ios.deviceName : undefined,
    isRecord(value.os) ? value.os.name : undefined
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
  }
  return fallback
}

const readIosWdaTargetLabel = (
  target: Pick<NormalizedIosWdaTargetConfig, 'destinationPlatform'>,
  status: unknown,
  fallback: string
) => {
  const deviceName = readIosWdaDeviceName(status, fallback)
  if (target.destinationPlatform === 'simulator' && deviceName === 'iOS') return fallback
  return deviceName
}

const rememberIosWdaHealth = (target: Pick<IosWdaDecodedDevice, 'wdaUrl'>, label: string) => {
  iosWdaHealthByUrl.set(target.wdaUrl, { checkedAt: Date.now(), label })
}

const readRecentIosWdaHealth = (target: Pick<IosWdaDecodedDevice, 'wdaUrl'>) => {
  const record = iosWdaHealthByUrl.get(target.wdaUrl)
  if (record == null || Date.now() - record.checkedAt > IOS_WDA_HEALTH_CACHE_MS) return undefined
  return record
}

const probeIosWdaMjpegStream = async (target: Pick<IosWdaDecodedDevice, 'mjpegUrl'>) => {
  if (target.mjpegUrl == null) return false
  try {
    const response = await requestUrl(
      target.mjpegUrl,
      { headers: { accept: 'multipart/x-mixed-replace,image/jpeg,*/*' } },
      IOS_WDA_MJPEG_PROBE_TIMEOUT_MS
    )
    void response.body?.cancel().catch(() => undefined)
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    return response.ok && (contentType.includes('multipart/') || contentType.includes('image/'))
  } catch {
    return false
  }
}

const readUrlPort = (url: string, fallback: number) => {
  try {
    const parsedUrl = new URL(url)
    return normalizePort(parsedUrl.port) ?? fallback
  } catch {
    return fallback
  }
}

const isLocalIosWdaTarget = (target: Pick<IosWdaDecodedDevice, 'wdaUrl'>) => {
  try {
    const url = new URL(target.wdaUrl)
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  } catch {
    return false
  }
}

const runIosWdaCommand = (
  file: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}
) =>
  new Promise<IosWdaCommandResult>((resolve, reject) => {
    execFile(file, args, {
      env: options.env,
      maxBuffer: 1024 * 1024 * 4,
      timeout: options.timeoutMs ?? 8000
    }, (error, stdout, stderr) => {
      if (error != null) {
        reject(error)
        return
      }
      resolve({ stderr: String(stderr), stdout: String(stdout) })
    })
  })

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

const readWdaRunLogSetting = (name: string) => {
  try {
    const text = fs.readFileSync(IOS_WDA_RUN_LOG_PATH, 'utf8')
    const match = text.match(new RegExp(`${escapeRegExp(name)}\\s*=\\s*([^\\s;]+)`, 'u'))
    return match?.[1]?.trim()
  } catch {
    return undefined
  }
}

const readConfiguredValue = (...values: Array<string | undefined>) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

const parseIosDeviceUdid = (output: string) => {
  for (const line of output.split(/\r?\n/u)) {
    if (line.includes('(Simulator)')) continue
    const match = line.match(/\(([^()]+)\)\s*$/u)
    const udid = match?.[1]?.trim()
    if (udid == null || udid === '' || udid.includes('Simulator')) continue
    if (/^[0-9A-F]{8}-[0-9A-F]{16}$/iu.test(udid)) return udid
    if (/^[0-9A-F]{24,40}$/iu.test(udid)) return udid
  }
  return undefined
}

const parseBootedIosSimulatorUdid = (output: string) => {
  for (const line of output.split(/\r?\n/u)) {
    if (!line.includes('(Booted)')) continue
    const match = line.match(/\(([0-9A-Fa-f-]{36})\)\s+\(Booted\)/u)
    const udid = match?.[1]?.trim()
    if (udid != null && udid !== '') return udid
  }
  return undefined
}

const resolveXcrunPath = (developerDir: string) => {
  const developerXcrunPath = path.join(developerDir, 'usr', 'bin', 'xcrun')
  return fs.existsSync(developerXcrunPath) ? developerXcrunPath : '/usr/bin/xcrun'
}

const discoverIosDeviceUdid = async (developerDir: string) => {
  const xcrunPath = resolveXcrunPath(developerDir)
  const result = await runIosWdaCommand(xcrunPath, ['xctrace', 'list', 'devices'], {
    env: { ...process.env, DEVELOPER_DIR: developerDir },
    timeoutMs: 10_000
  })
  return parseIosDeviceUdid(result.stdout)
}

const discoverIosSimulatorUdid = async (developerDir: string) => {
  const xcrunPath = resolveXcrunPath(developerDir)
  const result = await runIosWdaCommand(xcrunPath, ['simctl', 'list', 'devices', 'booted'], {
    env: { ...process.env, DEVELOPER_DIR: developerDir },
    timeoutMs: 10_000
  })
  return parseBootedIosSimulatorUdid(result.stdout)
}

const readPidFile = (filePath: string) => {
  try {
    const pid = Number.parseInt(fs.readFileSync(filePath, 'utf8').trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

const isProcessAlive = (pid: number | undefined) => {
  if (pid == null) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const isLocalTcpPortOpen = (port: number, timeoutMs = 500) =>
  new Promise<boolean>(resolve => {
    const socket = new net.Socket()
    let didResolve = false
    const finish = (result: boolean) => {
      if (didResolve) return
      didResolve = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, '127.0.0.1')
  })

const findIproxyExecutable = () => {
  const configuredPath = readConfiguredValue(process.env.ONEWORKS_IPROXY_PATH)
  if (configuredPath != null) return configuredPath
  const homebrewPath = '/opt/homebrew/bin/iproxy'
  if (fs.existsSync(homebrewPath)) return homebrewPath
  return 'iproxy'
}

const appendLogLine = (filePath: string, message: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.appendFileSync(filePath, `${message}\n`)
}

const createIosWdaRuntimePaths = (config: Pick<IosWdaAutoStartConfig, 'destinationPlatform' | 'wdaServerPort'>) => {
  if (config.destinationPlatform === 'device' && config.wdaServerPort === 8100) {
    return {
      iproxyLogPath: IOS_WDA_IPROXY_LOG_PATH,
      iproxyPidPath: IOS_WDA_IPROXY_PID_PATH,
      wdaLogPath: IOS_WDA_WDA_LOG_PATH,
      wdaPidPath: IOS_WDA_WDA_PID_PATH
    }
  }
  const prefix = config.destinationPlatform === 'simulator' ? 'simulator' : 'device'
  return {
    iproxyLogPath: path.join(IOS_WDA_HOME_DIR, `iproxy-${prefix}-${config.wdaServerPort}.log`),
    iproxyPidPath: path.join(IOS_WDA_HOME_DIR, `iproxy-${prefix}-${config.wdaServerPort}.pid`),
    wdaLogPath: path.join(IOS_WDA_HOME_DIR, `wda-${prefix}-${config.wdaServerPort}.log`),
    wdaPidPath: path.join(IOS_WDA_HOME_DIR, `wda-${prefix}-${config.wdaServerPort}.pid`)
  }
}

const spawnDetached = ({
  args,
  cwd,
  env,
  file,
  logPath,
  pidPath
}: {
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  file: string
  logPath: string
  pidPath: string
}) => {
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  appendLogLine(logPath, `[${new Date().toISOString()}] ${file} ${args.join(' ')}`)
  const logFd = fs.openSync(logPath, 'a')
  try {
    const child = spawn(file, args, {
      cwd,
      detached: true,
      env,
      stdio: ['ignore', logFd, logFd]
    })
    fs.writeFileSync(pidPath, String(child.pid))
    child.unref()
  } finally {
    fs.closeSync(logFd)
  }
}

const isWdaXcodebuildRunning = async (config: IosWdaAutoStartConfig) => {
  try {
    const result = await runIosWdaCommand('/bin/ps', ['-ax', '-o', 'command='], { timeoutMs: 1000 })
    return result.stdout.split(/\r?\n/u).some(line =>
      line.includes('WebDriverAgentRunner') &&
      (
        line.includes(`USE_PORT=${config.wdaServerPort}`) ||
        line.includes(`id=${config.udid}`)
      )
    )
  } catch {
    return false
  }
}

const resolveIosWdaAutoStartConfig = async (
  target: Partial<NormalizedIosWdaTargetConfig> & Pick<IosWdaDecodedDevice, 'mjpegUrl' | 'wdaUrl'>
): Promise<IosWdaAutoStartConfig> => {
  const developerDir = readConfiguredValue(
    target.developerDir,
    process.env.DEVELOPER_DIR,
    fs.existsSync(IOS_WDA_DEFAULT_DEVELOPER_DIR) ? IOS_WDA_DEFAULT_DEVELOPER_DIR : undefined
  )
  if (developerDir == null) throw new Error('Xcode is required to auto-start iOS WDA.')

  const wdaProjectPath = readConfiguredValue(target.wdaProjectPath, process.env.ONEWORKS_IOS_WDA_PROJECT_PATH) ??
    IOS_WDA_DEFAULT_PROJECT_PATH
  if (!fs.existsSync(wdaProjectPath)) {
    throw new Error(`WDA project not found at ${wdaProjectPath}.`)
  }

  const destinationPlatform = target.destinationPlatform ?? 'device'
  const udid = destinationPlatform === 'simulator'
    ? readConfiguredValue(target.udid, process.env.ONEWORKS_IOS_WDA_SIMULATOR_UDID) ??
      await discoverIosSimulatorUdid(developerDir)
    : readConfiguredValue(target.udid, process.env.ONEWORKS_IOS_WDA_UDID) ??
      await discoverIosDeviceUdid(developerDir)
  if (udid == null) {
    throw new Error(
      destinationPlatform === 'simulator'
        ? 'No booted iOS Simulator was found for WDA auto-start.'
        : 'No connected iOS device was found for WDA auto-start.'
    )
  }

  const developmentTeam = readConfiguredValue(
    target.developmentTeam,
    process.env.ONEWORKS_IOS_WDA_DEVELOPMENT_TEAM,
    readWdaRunLogSetting('DEVELOPMENT_TEAM')
  )
  const productBundleIdentifier = readConfiguredValue(
    target.productBundleIdentifier,
    process.env.ONEWORKS_IOS_WDA_BUNDLE_ID,
    readWdaRunLogSetting('PRODUCT_BUNDLE_IDENTIFIER')
  )
  const fallbackMjpegUrl = destinationPlatform === 'simulator'
    ? IOS_WDA_SIMULATOR_MJPEG_URL
    : IOS_WDA_DEFAULT_MJPEG_URL

  return {
    derivedDataPath: readConfiguredValue(target.derivedDataPath, process.env.ONEWORKS_IOS_WDA_DERIVED_DATA_PATH) ??
      (destinationPlatform === 'simulator' ? IOS_WDA_SIMULATOR_DERIVED_DATA_PATH : IOS_WDA_DEFAULT_DERIVED_DATA_PATH),
    developerDir,
    destinationPlatform,
    ...(developmentTeam == null ? {} : { developmentTeam }),
    mjpegServerPort: readUrlPort(target.mjpegUrl ?? fallbackMjpegUrl, 9100),
    ...(productBundleIdentifier == null ? {} : { productBundleIdentifier }),
    udid,
    wdaProjectPath,
    wdaServerPort: readUrlPort(target.wdaUrl, 8100)
  }
}

const ensureIproxyStarted = async (config: IosWdaAutoStartConfig) => {
  if (config.destinationPlatform === 'simulator') return
  const paths = createIosWdaRuntimePaths(config)
  const pid = readPidFile(paths.iproxyPidPath)
  if (isProcessAlive(pid) || await isLocalTcpPortOpen(config.wdaServerPort)) return
  spawnDetached({
    args: [
      '-u',
      config.udid,
      `${config.wdaServerPort}:${config.wdaServerPort}`,
      `${config.mjpegServerPort}:${config.mjpegServerPort}`
    ],
    file: findIproxyExecutable(),
    logPath: paths.iproxyLogPath,
    pidPath: paths.iproxyPidPath
  })
}

const ensureXcodebuildStarted = async (config: IosWdaAutoStartConfig) => {
  const paths = createIosWdaRuntimePaths(config)
  const pid = readPidFile(paths.wdaPidPath)
  if (isProcessAlive(pid) || await isWdaXcodebuildRunning(config)) return
  const xcodebuildPath = path.join(config.developerDir, 'usr', 'bin', 'xcodebuild')
  const mjpegSettings = readIosWdaMjpegSettings()
  const isSimulator = config.destinationPlatform === 'simulator'
  const args = [
    '-project',
    config.wdaProjectPath,
    '-scheme',
    'WebDriverAgentRunner',
    '-destination',
    `${isSimulator ? 'platform=iOS Simulator' : 'platform=iOS'},id=${config.udid}`,
    '-derivedDataPath',
    config.derivedDataPath,
    ...(isSimulator ? [] : ['-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration']),
    'test',
    ...(isSimulator
      ? ['CODE_SIGNING_ALLOWED=NO']
      : [
        ...(config.developmentTeam == null ? [] : [`DEVELOPMENT_TEAM=${config.developmentTeam}`]),
        'CODE_SIGN_STYLE=Automatic',
        ...(config.productBundleIdentifier == null ? [] : [
          `PRODUCT_BUNDLE_IDENTIFIER=${config.productBundleIdentifier}`,
          `WDA_PRODUCT_BUNDLE_IDENTIFIER=${config.productBundleIdentifier}`
        ])
      ]),
    `USE_PORT=${config.wdaServerPort}`,
    `MJPEG_SERVER_PORT=${config.mjpegServerPort}`,
    `MJPEG_SCALING_FACTOR=${mjpegSettings.mjpegScalingFactor}`,
    `MJPEG_SERVER_FRAMERATE=${mjpegSettings.mjpegServerFramerate}`,
    `MJPEG_SERVER_SCREENSHOT_QUALITY=${mjpegSettings.mjpegServerScreenshotQuality}`
  ]
  spawnDetached({
    args,
    cwd: path.dirname(config.wdaProjectPath),
    env: {
      ...process.env,
      DEVELOPER_DIR: config.developerDir,
      MJPEG_SCALING_FACTOR: String(mjpegSettings.mjpegScalingFactor),
      MJPEG_SERVER_FRAMERATE: String(mjpegSettings.mjpegServerFramerate),
      MJPEG_SERVER_SCREENSHOT_QUALITY: String(mjpegSettings.mjpegServerScreenshotQuality),
      MJPEG_SERVER_PORT: String(config.mjpegServerPort),
      USE_PORT: String(config.wdaServerPort),
      ...(config.productBundleIdentifier == null
        ? {}
        : { WDA_PRODUCT_BUNDLE_IDENTIFIER: config.productBundleIdentifier })
    },
    file: fs.existsSync(xcodebuildPath) ? xcodebuildPath : 'xcodebuild',
    logPath: paths.wdaLogPath,
    pidPath: paths.wdaPidPath
  })
}

const waitForIosWdaReady = async (
  target: Pick<IosWdaDecodedDevice, 'mjpegUrl' | 'wdaUrl'>,
  timeoutMs = IOS_WDA_AUTO_START_READY_TIMEOUT_MS
) => {
  const expiresAt = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < expiresAt) {
    try {
      const status = await readIosWdaStatus(target)
      rememberIosWdaHealth(target, readIosWdaDeviceName(status, 'iOS WDA'))
      return
    } catch (error) {
      lastError = error
      if (await probeIosWdaMjpegStream(target)) {
        rememberIosWdaHealth(target, readRecentIosWdaHealth(target)?.label ?? 'iOS WDA')
        return
      }
      await new Promise(resolve => setTimeout(resolve, 650))
    }
  }
  if (lastError instanceof Error) throw lastError
  throw new Error('Timed out waiting for iOS WDA.')
}

const ensureIosWdaAutoStarted = async (
  target: Partial<NormalizedIosWdaTargetConfig> & Pick<IosWdaDecodedDevice, 'mjpegUrl' | 'wdaUrl'>
) => {
  if (target.autoStart === false || !isLocalIosWdaTarget(target)) return
  const existingStartup = iosWdaStartupByUrl.get(target.wdaUrl)
  if (existingStartup != null && Date.now() - existingStartup.attemptedAt < IOS_WDA_AUTO_START_RETRY_MS) {
    await existingStartup.promise
    return
  }

  const startupPromise = (async () => {
    const config = await resolveIosWdaAutoStartConfig(target)
    await ensureIproxyStarted(config)
    await ensureXcodebuildStarted(config)
    await waitForIosWdaReady(target).catch(() => undefined)
  })()
  iosWdaStartupByUrl.set(target.wdaUrl, { attemptedAt: Date.now(), promise: startupPromise })
  await startupPromise
}

const readIosWdaTargetHealth = async (
  target: NormalizedIosWdaTargetConfig,
  fallbackLabel: string
) => {
  try {
    const status = await readIosWdaStatus(target)
    const label = readIosWdaTargetLabel(target, status, fallbackLabel)
    rememberIosWdaHealth(target, label)
    return label
  } catch (statusError) {
    if (await probeIosWdaMjpegStream(target)) {
      const label = readRecentIosWdaHealth(target)?.label ?? fallbackLabel
      rememberIosWdaHealth(target, label)
      return label
    }

    resetIosWdaConnectionState(target)
    await ensureIosWdaAutoStarted(target)
    const status = await readIosWdaStatus(target).catch(() => undefined)
    if (status != null) {
      const label = readIosWdaTargetLabel(target, status, fallbackLabel)
      rememberIosWdaHealth(target, label)
      return label
    }

    if (await probeIosWdaMjpegStream(target)) {
      rememberIosWdaHealth(target, fallbackLabel)
      return fallbackLabel
    }

    throw statusError
  }
}

const ensureIosWdaReadyForRequest = async (target: IosWdaDecodedDevice) => {
  if (readRecentIosWdaHealth(target) != null) {
    try {
      const status = await readIosWdaStatus(target, IOS_WDA_READY_PROBE_TIMEOUT_MS)
      rememberIosWdaHealth(target, readIosWdaDeviceName(status, 'iOS WDA'))
      return
    } catch {
      if (await probeIosWdaMjpegStream(target)) {
        rememberIosWdaHealth(target, 'iOS WDA')
        return
      }
      resetIosWdaConnectionState(target)
    }
  }
  if (await probeIosWdaMjpegStream(target)) {
    rememberIosWdaHealth(target, 'iOS WDA')
    return
  }
  await ensureIosWdaAutoStarted(target)
  const status = await readIosWdaStatus(target).catch(() => undefined)
  if (status != null) {
    rememberIosWdaHealth(target, readIosWdaDeviceName(status, 'iOS WDA'))
    return
  }
  if (await probeIosWdaMjpegStream(target)) {
    rememberIosWdaHealth(target, 'iOS WDA')
    return
  }
  throw new Error('iOS WDA is not ready.')
}

const readNumberValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined

const readIosWdaScreen = async (
  target: NormalizedIosWdaTargetConfig
): Promise<MobileDebugDevice['screen'] | undefined> => {
  try {
    const sessionId = await ensureIosWdaSession(target, { preferStatusSession: true, skipMjpegSettings: true })
    const value = getResponseValue(
      await fetchIosWdaJson<unknown>(
        target,
        withSessionPath(sessionId, '/wda/screen'),
        undefined,
        1500
      )
    )
    if (!isRecord(value) || !isRecord(value.screenSize)) return undefined
    const width = readNumberValue(value.screenSize.width)
    const height = readNumberValue(value.screenSize.height)
    if (width == null || height == null || width <= 0 || height <= 0) return undefined
    const scale = readNumberValue(value.scale)
    return {
      height,
      ...(scale == null || scale <= 0 ? {} : { scale }),
      width
    }
  } catch {
    return undefined
  }
}

export const listIosWdaDevices = async ({
  selectedDeviceId,
  targets
}: {
  selectedDeviceId?: string
  targets: NormalizedIosWdaTargetConfig[]
}): Promise<{ devices: MobileDebugDevice[]; errors: string[] }> => {
  const devices: MobileDebugDevice[] = []
  const errors: string[] = []

  for (const target of targets.filter(item => item.enabled)) {
    const deviceId = createIosWdaDeviceId(target)
    const shouldReportFailure = !target.isImplicitDefault || selectedDeviceId === deviceId
    try {
      const label = await readIosWdaTargetHealth(target, target.label)
      const screen = await readIosWdaScreen(target)
      devices.push({
        detail: `${target.wdaUrl}${target.mjpegUrl == null ? '' : ` · ${target.mjpegUrl}`}`,
        id: deviceId,
        label,
        platform: 'ios',
        ...(screen == null ? {} : { screen }),
        state: 'device',
        videoSource: target.mjpegUrl == null ? 'screenshot' : 'mjpeg'
      })
    } catch (error) {
      if (!shouldReportFailure) continue
      devices.push({
        detail: target.wdaUrl,
        id: deviceId,
        label: target.label,
        platform: 'ios',
        state: 'offline',
        videoSource: 'screenshot'
      })
      errors.push(`${target.label}: ${toErrorMessage(error)}`)
    }
  }

  return { devices, errors }
}

const readPngSize = (buffer: Buffer): RasterImageSize | undefined => {
  const pngSignature = '89504e470d0a1a0a'
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== pngSignature) return undefined
  return {
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16)
  }
}

const readJpegSize = (buffer: Buffer): RasterImageSize | undefined => {
  if (buffer.length < 4 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) return undefined
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xFF) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]
    const blockLength = buffer.readUInt16BE(offset + 2)
    if (marker != null && marker >= 0xC0 && marker <= 0xC3 && blockLength >= 7) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      }
    }
    offset += 2 + blockLength
  }
  return undefined
}

const readRasterImageSize = (buffer: Buffer) => readPngSize(buffer) ?? readJpegSize(buffer)

const readScreenshotBase64Value = (body: unknown) => {
  const value = getResponseValue(body)
  if (typeof value !== 'string' || value.trim() === '') throw new Error('WDA screenshot response is empty.')
  return value.trim().replace(/^data:image\/\w+;base64,/iu, '')
}

const fetchIosWdaScreenshotBase64 = async (target: IosWdaDecodedDevice) => {
  let sessionId: string | undefined
  try {
    sessionId = await ensureIosWdaSession(target)
  } catch {
    // Some WDA builds expose /screenshot without a session.
  }

  if (sessionId != null) {
    try {
      return readScreenshotBase64Value(
        await fetchIosWdaJson<unknown>(
          target,
          withSessionPath(sessionId, '/screenshot')
        )
      )
    } catch {
      resetIosWdaSession(target)
    }
  }

  return readScreenshotBase64Value(await fetchIosWdaJson<unknown>(target, '/screenshot'))
}

export const captureIosWdaScreenshot = async (deviceId: unknown): Promise<MobileDeviceScreenshotResponse> => {
  const target = decodeIosWdaDeviceId(deviceId)
  await ensureIosWdaReadyForRequest(target)
  const base64Value = await fetchIosWdaScreenshotBase64(target)
  const imageBuffer = Buffer.from(base64Value, 'base64')
  const size = readRasterImageSize(imageBuffer)
  return {
    capturedAt: Date.now(),
    deviceId: typeof deviceId === 'string' ? deviceId : '',
    imageDataUrl: `data:image/png;base64,${base64Value}`,
    ...(size == null ? {} : size)
  }
}

const decodeXmlAttribute = (value: string) =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')

const parseXmlAttributes = (value: string) => {
  const attributes: Record<string, string | number | boolean | null> = {}
  const attributePattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu
  for (const match of value.matchAll(attributePattern)) {
    const name = match[1]
    const rawValue = match[2] ?? match[3]
    if (name == null || rawValue == null) continue
    const decodedValue = decodeXmlAttribute(rawValue)
    if (decodedValue === 'true') attributes[name] = true
    else if (decodedValue === 'false') attributes[name] = false
    else attributes[name] = decodedValue
  }
  return attributes
}

const parseNumberAttribute = (value: unknown) => {
  const parsedValue = typeof value === 'number'
    ? value
    : typeof value === 'string'
    ? Number.parseFloat(value)
    : Number.NaN
  return Number.isFinite(parsedValue) ? Math.round(parsedValue) : undefined
}

const parseIosWdaBounds = (
  attributes: Record<string, string | number | boolean | null>
): MobileElementBounds | undefined => {
  const x = parseNumberAttribute(attributes.x)
  const y = parseNumberAttribute(attributes.y)
  const width = parseNumberAttribute(attributes.width)
  const height = parseNumberAttribute(attributes.height)
  if (x == null || y == null || width == null || height == null) return undefined
  return {
    height: Math.max(0, height),
    width: Math.max(0, width),
    x,
    y
  }
}

const getIosWdaElementLabel = (attributes: Record<string, string | number | boolean | null>) => {
  const candidates = [attributes.label, attributes.name, attributes.value, attributes.identifier]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
  }
  return undefined
}

const parseIosWdaXml = (xml: string): MobileElementTreeResponse['root'] => {
  const root: MobileElementNode = {
    attributes: {},
    children: [],
    id: 'wda:root',
    label: 'AppiumAUT',
    source: 'wda',
    type: 'AppiumAUT'
  }
  const stack: MobileElementNode[] = [root]
  const nodeIndexByDepth: number[] = []
  // eslint-disable-next-line regexp/no-super-linear-backtracking -- WDA XML snapshots are bounded XCTest responses parsed once per refresh.
  const tagPattern = /<\?[^>]*\?>|<!--[\s\S]*?-->|<\/([A-Za-z_][\w:.-]*)\s*>|<([A-Za-z_][\w:.-]*)([^<>]*?)(\/?)>/gu

  for (const match of xml.matchAll(tagPattern)) {
    const closingTagName = match[1]
    if (closingTagName != null) {
      if (stack.length > 1) stack.pop()
      continue
    }

    const tagName = match[2]
    if (tagName == null) continue
    const attributeText = match[3] ?? ''
    const isSelfClosing = match[4] === '/'
    const attributes = parseXmlAttributes(attributeText)
    const parent = stack.at(-1) ?? root
    const depth = stack.length
    const siblingIndex = nodeIndexByDepth[depth] ?? 0
    nodeIndexByDepth[depth] = siblingIndex + 1
    nodeIndexByDepth.length = depth + 1
    const pathParts = [
      ...stack.slice(1).map(node => node.id.split('/').at(-1) ?? '0'),
      String(siblingIndex)
    ]
    const type = typeof attributes.type === 'string' && attributes.type.trim() !== ''
      ? attributes.type.trim()
      : tagName
    const node: MobileElementNode = {
      attributes,
      bounds: parseIosWdaBounds(attributes),
      children: [],
      id: `wda:${pathParts.join('/')}`,
      label: getIosWdaElementLabel(attributes),
      source: 'wda',
      type
    }
    parent.children.push(node)
    if (!isSelfClosing) stack.push(node)
  }

  return root.children[0] ?? root
}

const countElementNodes = (root: MobileElementNode | undefined): number => {
  if (root == null) return 0
  return 1 + root.children.reduce((count, child) => count + countElementNodes(child), 0)
}

const readSourceXmlValue = (body: unknown) => {
  const value = getResponseValue(body)
  if (typeof value !== 'string' || value.trim() === '') throw new Error('WDA source response is empty.')
  return value
}

const fetchIosWdaSourceXml = async (target: IosWdaDecodedDevice) => {
  let sessionId: string
  try {
    sessionId = await ensureIosWdaSession(target)
  } catch {
    resetIosWdaSession(target)
    return readSourceXmlValue(await fetchIosWdaJson<unknown>(target, '/source?format=xml'))
  }

  try {
    return readSourceXmlValue(
      await fetchIosWdaJson<unknown>(
        target,
        withSessionPath(sessionId, '/source?format=xml')
      )
    )
  } catch {
    resetIosWdaSession(target)
    return readSourceXmlValue(await fetchIosWdaJson<unknown>(target, '/source?format=xml'))
  }
}

export const dumpIosWdaElementTree = async (deviceId: unknown): Promise<MobileElementTreeResponse> => {
  const target = decodeIosWdaDeviceId(deviceId)
  await ensureIosWdaReadyForRequest(target)
  const root = parseIosWdaXml(await fetchIosWdaSourceXml(target))
  return {
    capturedAt: Date.now(),
    deviceId: typeof deviceId === 'string' ? deviceId : '',
    nodeCount: countElementNodes(root),
    root,
    source: 'wda'
  }
}

const normalizeLineLimit = (value: unknown) => {
  const parsedValue = typeof value === 'number'
    ? value
    : typeof value === 'string'
    ? Number.parseInt(value, 10)
    : undefined
  if (parsedValue == null || !Number.isFinite(parsedValue)) return 400
  return Math.max(50, Math.min(2000, Math.round(parsedValue)))
}

export const readIosWdaLogs = async (
  deviceId: unknown,
  input: unknown
): Promise<MobileDeviceLogsResponse> => {
  const target = decodeIosWdaDeviceId(deviceId)
  await ensureIosWdaReadyForRequest(target).catch(() => undefined)
  const record = isRecord(input) ? input : {}
  const lineLimit = normalizeLineLimit(record.lineLimit)
  let statusLine = 'WDA status unavailable.'
  try {
    statusLine = JSON.stringify(getResponseValue(await readIosWdaStatus(target)))
  } catch (error) {
    statusLine = `WDA status failed: ${toErrorMessage(error)}`
  }
  return {
    capturedAt: Date.now(),
    deviceId: typeof deviceId === 'string' ? deviceId : '',
    lineLimit,
    lines: [`WDA ${target.wdaUrl}`, statusLine].slice(0, lineLimit),
    source: 'wda'
  }
}

const normalizeCoordinate = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.round(value))
}

const normalizeDurationMs = (value: unknown, fallback: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(60000, Math.round(value)))
}

const toInputEventRecord = (input: unknown): MobileDeviceInputEvent => {
  if (!isRecord(input)) throw new Error('Invalid mobile input event.')
  const kind = input.kind
  if (
    kind !== 'action' &&
    kind !== 'drag' &&
    kind !== 'key' &&
    kind !== 'scroll' &&
    kind !== 'swipe' &&
    kind !== 'tap' &&
    kind !== 'text' &&
    kind !== 'touch'
  ) {
    throw new Error('Invalid mobile input kind.')
  }
  return {
    action: input.action === 'rotate' ? input.action : undefined,
    durationMs: typeof input.durationMs === 'number' ? input.durationMs : undefined,
    endX: typeof input.endX === 'number' ? input.endX : undefined,
    endY: typeof input.endY === 'number' ? input.endY : undefined,
    key: input.key === 'home' ||
        input.key === 'power' ||
        input.key === 'volume-down' ||
        input.key === 'volume-up'
      ? input.key
      : undefined,
    kind,
    physicalEndX: typeof input.physicalEndX === 'number' ? input.physicalEndX : undefined,
    physicalEndY: typeof input.physicalEndY === 'number' ? input.physicalEndY : undefined,
    physicalX: typeof input.physicalX === 'number' ? input.physicalX : undefined,
    physicalY: typeof input.physicalY === 'number' ? input.physicalY : undefined,
    scrollX: typeof input.scrollX === 'number' ? input.scrollX : undefined,
    scrollY: typeof input.scrollY === 'number' ? input.scrollY : undefined,
    text: typeof input.text === 'string' ? input.text : undefined,
    touchPhase: input.touchPhase === 'down' || input.touchPhase === 'move' || input.touchPhase === 'up'
      ? input.touchPhase
      : undefined,
    x: typeof input.x === 'number' ? input.x : undefined,
    y: typeof input.y === 'number' ? input.y : undefined
  }
}

const getInputCoordinate = (
  inputEvent: MobileDeviceInputEvent,
  field: 'endX' | 'endY' | 'x' | 'y'
) => {
  if (field === 'endX') return normalizeCoordinate(inputEvent.endX)
  if (field === 'endY') return normalizeCoordinate(inputEvent.endY)
  if (field === 'x') return normalizeCoordinate(inputEvent.x)
  return normalizeCoordinate(inputEvent.y)
}

const postFirstSuccessfulIosWdaJson = async (
  target: IosWdaDecodedDevice,
  requests: Array<{ body: unknown; path: string }>
) => {
  const errors: string[] = []
  for (const request of requests) {
    try {
      await postIosWdaJson<unknown>(target, request.path, request.body)
      return
    } catch (error) {
      errors.push(toErrorMessage(error))
    }
  }
  throw new Error(errors.at(-1) ?? 'WDA input failed.')
}

const sendIosWdaW3cGesture = async ({
  durationMs,
  endX,
  endY,
  pauseMs,
  sessionId,
  target,
  x,
  y
}: {
  durationMs: number
  endX: number
  endY: number
  pauseMs?: number
  sessionId: string
  target: IosWdaDecodedDevice
  x: number
  y: number
}) => {
  await postIosWdaJson<unknown>(target, withSessionPath(sessionId, '/actions'), {
    actions: [
      {
        actions: [
          { duration: 0, origin: 'viewport', type: 'pointerMove', x, y },
          { button: 0, type: 'pointerDown' },
          { duration: Math.max(20, pauseMs ?? Math.min(80, durationMs)), type: 'pause' },
          { duration: Math.max(0, durationMs), origin: 'viewport', type: 'pointerMove', x: endX, y: endY },
          { button: 0, type: 'pointerUp' }
        ],
        id: 'oneworks-finger',
        parameters: { pointerType: 'touch' },
        type: 'pointer'
      }
    ]
  })
}

const sendIosWdaTap = async (
  target: IosWdaDecodedDevice,
  sessionId: string,
  inputEvent: MobileDeviceInputEvent
) => {
  const x = getInputCoordinate(inputEvent, 'x')
  const y = getInputCoordinate(inputEvent, 'y')
  if (x == null || y == null) throw new Error('Tap input requires x and y.')

  try {
    await postFirstSuccessfulIosWdaJson(target, [
      { body: { x, y }, path: withSessionPath(sessionId, '/wda/tap') },
      { body: { x, y }, path: withSessionPath(sessionId, '/tap') }
    ])
  } catch {
    await sendIosWdaW3cGesture({
      durationMs: 0,
      endX: x,
      endY: y,
      pauseMs: 20,
      sessionId,
      target,
      x,
      y
    })
  }
}

const sendIosWdaSwipe = async (
  target: IosWdaDecodedDevice,
  sessionId: string,
  inputEvent: MobileDeviceInputEvent
) => {
  const x = getInputCoordinate(inputEvent, 'x')
  const y = getInputCoordinate(inputEvent, 'y')
  const endX = getInputCoordinate(inputEvent, 'endX')
  const endY = getInputCoordinate(inputEvent, 'endY')
  if (x == null || y == null || endX == null || endY == null) {
    throw new Error('Swipe input requires x, y, endX and endY.')
  }
  const durationMs = Math.max(
    80,
    Math.min(IOS_WDA_SWIPE_MAX_DURATION_MS, normalizeDurationMs(inputEvent.durationMs, 180))
  )

  try {
    await postFirstSuccessfulIosWdaJson(target, [
      {
        body: { duration: durationMs / 1000, fromX: x, fromY: y, toX: endX, toY: endY },
        path: withSessionPath(sessionId, '/wda/dragfromtoforduration')
      }
    ])
  } catch {
    await sendIosWdaW3cGesture({
      durationMs,
      endX,
      endY,
      pauseMs: IOS_WDA_SWIPE_HOLD_MS,
      sessionId,
      target,
      x,
      y
    })
  }
}

const sendIosWdaDrag = async (
  target: IosWdaDecodedDevice,
  sessionId: string,
  inputEvent: MobileDeviceInputEvent
) => {
  const x = getInputCoordinate(inputEvent, 'x')
  const y = getInputCoordinate(inputEvent, 'y')
  const endX = getInputCoordinate(inputEvent, 'endX')
  const endY = getInputCoordinate(inputEvent, 'endY')
  if (x == null || y == null || endX == null || endY == null) {
    throw new Error('Drag input requires x, y, endX and endY.')
  }
  const durationMs = Math.max(
    80,
    Math.min(IOS_WDA_SWIPE_MAX_DURATION_MS, normalizeDurationMs(inputEvent.durationMs, 180))
  )

  try {
    await postFirstSuccessfulIosWdaJson(target, [
      {
        body: { duration: durationMs / 1000, fromX: x, fromY: y, toX: endX, toY: endY },
        path: withSessionPath(sessionId, '/wda/dragfromtoforduration')
      }
    ])
  } catch {
    await sendIosWdaW3cGesture({
      durationMs,
      endX,
      endY,
      pauseMs: IOS_WDA_SWIPE_HOLD_MS,
      sessionId,
      target,
      x,
      y
    })
  }
}

const sendIosWdaScroll = async (
  target: IosWdaDecodedDevice,
  sessionId: string,
  inputEvent: MobileDeviceInputEvent
) => {
  const x = getInputCoordinate(inputEvent, 'x')
  const y = getInputCoordinate(inputEvent, 'y')
  if (x == null || y == null) throw new Error('Scroll input requires x and y.')
  const distance = Math.max(160, Math.min(720, Math.round(Math.abs(inputEvent.scrollY ?? 0) * 520)))
  const direction = (inputEvent.scrollY ?? 0) >= 0 ? -1 : 1
  await sendIosWdaSwipe(target, sessionId, {
    ...inputEvent,
    endX: x,
    endY: Math.max(0, y + direction * distance),
    kind: 'swipe',
    x,
    y
  })
}

const sendIosWdaText = async (
  target: IosWdaDecodedDevice,
  sessionId: string,
  inputEvent: MobileDeviceInputEvent
) => {
  const text = inputEvent.text
  if (text == null || text === '') throw new Error('Text input requires text.')
  await postFirstSuccessfulIosWdaJson(target, [
    { body: { text, value: [...text] }, path: withSessionPath(sessionId, '/keys') },
    { body: { text, value: [...text] }, path: withSessionPath(sessionId, '/wda/keys') }
  ])
}

const sendIosWdaKey = async (
  target: IosWdaDecodedDevice,
  sessionId: string,
  inputEvent: MobileDeviceInputEvent
) => {
  const key = inputEvent.key
  if (key === 'home') {
    await postFirstSuccessfulIosWdaJson(target, [
      { body: {}, path: withSessionPath(sessionId, '/wda/homescreen') },
      { body: { name: 'home' }, path: withSessionPath(sessionId, '/wda/pressButton') }
    ])
    return
  }
  if (key === 'power' || key === 'volume-down' || key === 'volume-up') {
    const name = key === 'power' ? 'lock' : key === 'volume-down' ? 'volumeDown' : 'volumeUp'
    await postFirstSuccessfulIosWdaJson(target, [
      { body: { name }, path: withSessionPath(sessionId, '/wda/pressButton') }
    ])
    return
  }
  throw new Error('This iOS control is not available through WDA.')
}

const sendIosWdaRotate = async (
  target: IosWdaDecodedDevice,
  sessionId: string
) => {
  let nextOrientation = 'LANDSCAPE'
  try {
    const currentOrientation = getResponseValue(
      await fetchIosWdaJson<unknown>(
        target,
        withSessionPath(sessionId, '/orientation')
      )
    )
    if (typeof currentOrientation === 'string' && currentOrientation.toUpperCase().startsWith('LANDSCAPE')) {
      nextOrientation = 'PORTRAIT'
    }
  } catch {
    // If reading orientation fails, still try setting landscape.
  }
  await postIosWdaJson<unknown>(target, withSessionPath(sessionId, '/orientation'), {
    orientation: nextOrientation
  })
}

const sendIosWdaTouch = async (
  deviceId: string,
  target: IosWdaDecodedDevice,
  sessionId: string,
  inputEvent: MobileDeviceInputEvent
) => {
  const phase = inputEvent.touchPhase
  const x = getInputCoordinate(inputEvent, 'x')
  const y = getInputCoordinate(inputEvent, 'y')
  if (phase == null) throw new Error('Touch input requires a valid phase.')
  if (x == null || y == null) throw new Error('Touch input requires x and y.')
  if (phase === 'down') {
    iosWdaTouchGestureByDeviceId.set(deviceId, { startedAt: Date.now(), x, y })
    return
  }
  if (phase === 'move') return

  const startPoint = iosWdaTouchGestureByDeviceId.get(deviceId)
  iosWdaTouchGestureByDeviceId.delete(deviceId)
  if (startPoint == null || Math.hypot(x - startPoint.x, y - startPoint.y) <= 10) {
    await sendIosWdaTap(target, sessionId, { ...inputEvent, kind: 'tap', x, y })
    return
  }

  await sendIosWdaDrag(target, sessionId, {
    ...inputEvent,
    durationMs: normalizeDurationMs(inputEvent.durationMs ?? Date.now() - startPoint.startedAt, 220),
    endX: x,
    endY: y,
    kind: 'swipe',
    x: startPoint.x,
    y: startPoint.y
  })
}

const dispatchIosWdaInput = async (
  deviceId: string,
  target: IosWdaDecodedDevice,
  sessionId: string,
  inputEvent: MobileDeviceInputEvent
) => {
  if (inputEvent.kind === 'touch') {
    await sendIosWdaTouch(deviceId, target, sessionId, inputEvent)
  } else if (inputEvent.kind === 'drag') {
    await sendIosWdaDrag(target, sessionId, inputEvent)
  } else if (inputEvent.kind === 'tap') {
    await sendIosWdaTap(target, sessionId, inputEvent)
  } else if (inputEvent.kind === 'swipe') {
    await sendIosWdaSwipe(target, sessionId, inputEvent)
  } else if (inputEvent.kind === 'scroll') {
    await sendIosWdaScroll(target, sessionId, inputEvent)
  } else if (inputEvent.kind === 'text') {
    await sendIosWdaText(target, sessionId, inputEvent)
  } else if (inputEvent.kind === 'action') {
    if (inputEvent.action !== 'rotate') throw new Error('This iOS action is not available through WDA.')
    await sendIosWdaRotate(target, sessionId)
  } else {
    await sendIosWdaKey(target, sessionId, inputEvent)
  }
}

export const sendIosWdaInput = async (
  deviceId: unknown,
  input: unknown
): Promise<{ deviceId: string; sentAt: number }> => {
  if (typeof deviceId !== 'string') throw new Error('Invalid iOS WDA device id.')
  const target = decodeIosWdaDeviceId(deviceId)
  await ensureIosWdaReadyForRequest(target)
  const inputEvent = toInputEventRecord(input)

  try {
    const sessionId = await ensureIosWdaSession(target, { preferStatusSession: true, skipMjpegSettings: true })
    await dispatchIosWdaInput(deviceId, target, sessionId, inputEvent)
  } catch (error) {
    if (inputEvent.kind === 'touch' || !isRecoverableIosWdaSessionError(error)) throw error
    resetIosWdaSession(target)
    await dispatchIosWdaInput(
      deviceId,
      target,
      await ensureIosWdaSession(target, { preferStatusSession: true, skipMjpegSettings: true }),
      inputEvent
    )
  }

  return { deviceId, sentAt: Date.now() }
}

export const openIosWdaMjpegStream = async (deviceId: unknown) => {
  const target = decodeIosWdaDeviceId(deviceId)
  await ensureIosWdaReadyForRequest(target)
  if (target.mjpegUrl == null) throw new Error('This iOS WDA device has no MJPEG stream URL configured.')
  const response = await requestUrl(target.mjpegUrl, {}, IOS_WDA_STREAM_TIMEOUT_MS)
  if (!response.ok || response.body == null) {
    throw new Error(`WDA MJPEG stream failed with ${response.status}.`)
  }
  return {
    body: Readable.fromWeb(response.body as never),
    contentType: response.headers.get('content-type') ?? 'multipart/x-mixed-replace; boundary=BoundaryString'
  }
}
