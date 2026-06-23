/* eslint-disable max-lines -- Android CDP discovery needs adb, socket forwarding, and target normalization together. */
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import type { Duplex } from 'node:stream'

import { app } from 'electron'
import type { WebContents } from 'electron'

import { AdbServerClient } from '@yume-chan/adb'
import { AdbScrcpyClient, AdbScrcpyOptions3_3_3 } from '@yume-chan/adb-scrcpy'
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp'
import {
  AndroidKeyCode,
  AndroidKeyEventAction,
  AndroidKeyEventMeta,
  AndroidMotionEventAction,
  AndroidMotionEventButton,
  ScrcpyInstanceId,
  ScrcpyPointerId,
  ScrcpyVideoCodecNameMap
} from '@yume-chan/scrcpy'
import type { ScrcpyControlMessageWriter, ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy'
import { ReadableStream } from '@yume-chan/stream-extra'

const ADB_TIMEOUT_MS = 10000
const FETCH_TIMEOUT_MS = 5000
const ADB_INPUT_TIMEOUT_MS = 3000
const ADB_SCREENSHOT_TIMEOUT_MS = 4000
const ADB_UIAUTOMATOR_DUMP_TIMEOUT_MS = 10000
const ADB_UIAUTOMATOR_READ_TIMEOUT_MS = 3500
const SCRCPY_SERVER_VERSION = '3.3.3'
const SCRCPY_SERVER_REMOTE_PATH = `/data/local/tmp/oneworks-scrcpy-server-v${SCRCPY_SERVER_VERSION}.jar`
const SCRCPY_VIDEO_BIT_RATE = 6_000_000
const SCRCPY_MAX_FPS = 60
const SCRCPY_MAX_SIZE = 1600

export const MOBILE_DEVICE_VIDEO_FRAME_CHANNEL = 'desktop:mobile-device-video-frame'
export const MOBILE_DEVICE_VIDEO_STREAM_STATUS_CHANNEL = 'desktop:mobile-device-video-stream-status'

export interface MobileDebugDevice {
  detail: string
  id: string
  label: string
  state: string
}

export interface MobileDebugNetworkTargetConfig {
  address: string
  enabled?: boolean
  id?: string
}

export interface MobileDebugPortForwardRuleConfig {
  deviceId?: string
  devicePort: number
  enabled?: boolean
  id?: string
  localAddress: string
}

export interface MobileDebugConfig {
  discoverNetworkTargets?: boolean
  discoverUsbDevices?: boolean
  networkTargets?: MobileDebugNetworkTargetConfig[]
  portForwardingRules?: MobileDebugPortForwardRuleConfig[]
  selectedDeviceId?: string
}

type NormalizedMobileDebugConfig =
  & Omit<Required<MobileDebugConfig>, 'selectedDeviceId'>
  & Pick<MobileDebugConfig, 'selectedDeviceId'>

export interface MobileDebugPortForwardStatus {
  deviceId: string
  deviceLabel: string
  devicePort: number
  localAddress: string
  message?: string
  ruleId: string
  status: 'active' | 'error' | 'removed' | 'skipped'
}

export interface MobileDebugTarget {
  appName?: string
  description?: string
  deviceId: string
  deviceLabel: string
  devtoolsFrontendUrl?: string
  faviconUrl?: string
  id: string
  inspectUrl: string
  localPort: number
  networkAddress?: string
  socketName: string
  socketType: 'chrome' | 'other' | 'webview'
  source: 'network' | 'usb'
  title: string
  type: string
  url: string
  webSocketDebuggerUrl?: string
}

export interface MobileDebugTargetsResponse {
  adbMissing?: boolean
  adbPath?: string
  devices: MobileDebugDevice[]
  errors: string[]
  portForwarding: MobileDebugPortForwardStatus[]
  scannedAt: number
  targets: MobileDebugTarget[]
}

export interface MobileDeviceScreenshotResponse {
  capturedAt: number
  deviceId: string
  height?: number
  imageDataUrl: string
  width?: number
}

export interface MobileDeviceVideoStreamStartResponse {
  codec: number
  codecName: string
  deviceId: string
  height?: number
  source: 'scrcpy'
  startedAt: number
  streamId: string
  width?: number
}

export interface MobileDeviceVideoFrameEvent {
  data: Uint8Array
  deviceId: string
  height?: number
  keyframe?: boolean
  receivedAt: number
  streamId: string
  type: ScrcpyMediaStreamPacket['type']
  width?: number
}

export interface MobileDeviceVideoStreamStatusEvent {
  deviceId: string
  message?: string
  status: 'closed' | 'error'
  streamId: string
}

export interface MobileElementBounds {
  height: number
  width: number
  x: number
  y: number
}

export interface MobileElementNode {
  attributes: Record<string, string | number | boolean | null>
  bounds?: MobileElementBounds
  children: MobileElementNode[]
  id: string
  label?: string
  source: 'uiautomator'
  type: string
}

export interface MobileElementTreeResponse {
  capturedAt: number
  deviceId: string
  nodeCount: number
  root?: MobileElementNode
  source: 'uiautomator'
}

export interface MobileDeviceInputEvent {
  action?: 'collapse-panels' | 'notifications' | 'quick-settings' | 'rotate'
  durationMs?: number
  endX?: number
  endY?: number
  key?: 'app-switch' | 'back' | 'delete' | 'enter' | 'home' | 'power' | 'volume-down' | 'volume-up'
  kind: 'action' | 'key' | 'scroll' | 'swipe' | 'tap' | 'text' | 'touch'
  physicalEndX?: number
  physicalEndY?: number
  physicalX?: number
  physicalY?: number
  scrollX?: number
  scrollY?: number
  text?: string
  touchPhase?: 'down' | 'move' | 'up'
  x?: number
  y?: number
}

interface CommandResult {
  stderr: string
  stdout: string
}

interface BufferCommandResult {
  stderr: string
  stdout: Buffer
}

interface CdpTarget {
  description?: string
  devtoolsFrontendUrl?: string
  faviconUrl?: string
  id?: string
  title?: string
  type?: string
  url?: string
  webSocketDebuggerUrl?: string
}

interface WebSocketProxyRecord {
  host: string
  port: number
  server: http.Server
  targetPort: number
}

interface TcpProxyRecord {
  localPort: number
  server: net.Server
  targetHost: string
  targetPort: number
}

interface SocketForwardRecord {
  localPort: number
  webSocketProxyPort: number
}

interface HostPortEndpoint {
  host: string
  port: number
}

const webSocketProxyByTarget = new Map<string, Promise<WebSocketProxyRecord>>()
const tcpProxyByTarget = new Map<string, Promise<TcpProxyRecord>>()
const socketForwardByTarget = new Map<string, Promise<SocketForwardRecord>>()
const activeReversePortsByDevice = new Map<string, Map<number, string>>()
const faviconUrlByPageUrl = new Map<string, string>()
const deviceAdbQueueById = new Map<string, Promise<void>>()
const deviceElementTreeQueueById = new Map<string, Promise<void>>()
const deviceScreenshotTaskById = new Map<string, Promise<MobileDeviceScreenshotResponse>>()
const adbTouchGestureByDeviceId = new Map<string, { startedAt: number; x: number; y: number }>()

interface MobileDeviceVideoStreamSession {
  adb: Awaited<ReturnType<AdbServerClient['createAdb']>>
  client: Awaited<ReturnType<typeof AdbScrcpyClient.start>>
  controller: ScrcpyControlMessageWriter | undefined
  deviceId: string
  isClosed: boolean
  ownerWebContentsId: number
  removeDestroyedListener: () => void
  streamId: string
  videoHeight?: number
  videoWidth?: number
}

const mobileDeviceVideoStreamById = new Map<string, MobileDeviceVideoStreamSession>()

const runCommand = (file: string, args: string[], timeout = ADB_TIMEOUT_MS) =>
  new Promise<CommandResult>((resolve, reject) => {
    execFile(file, args, { maxBuffer: 1024 * 1024 * 4, timeout }, (error, stdout, stderr) => {
      if (error != null) {
        reject(error)
        return
      }

      resolve({ stderr: String(stderr), stdout: String(stdout) })
    })
  })

const runCommandBuffer = (file: string, args: string[], timeout = ADB_TIMEOUT_MS) =>
  new Promise<BufferCommandResult>((resolve, reject) => {
    execFile(file, args, { encoding: 'buffer', maxBuffer: 1024 * 1024 * 24, timeout }, (error, stdout, stderr) => {
      if (error != null) {
        reject(error)
        return
      }

      resolve({
        stderr: Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr),
        stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
      })
    })
  })

const runQueuedDeviceAdbTask = async <T>(deviceId: string, task: () => Promise<T>): Promise<T> => {
  const previousTask = deviceAdbQueueById.get(deviceId) ?? Promise.resolve()
  let releaseCurrentTask: () => void = () => undefined
  const currentTask = new Promise<void>(resolve => {
    releaseCurrentTask = resolve
  })
  const queuedTask = previousTask.catch(() => undefined).then(() => currentTask)
  deviceAdbQueueById.set(deviceId, queuedTask)

  await previousTask.catch(() => undefined)
  try {
    return await task()
  } finally {
    releaseCurrentTask()
    if (deviceAdbQueueById.get(deviceId) === queuedTask) {
      deviceAdbQueueById.delete(deviceId)
    }
  }
}

const runQueuedElementTreeTask = async <T>(deviceId: string, task: () => Promise<T>): Promise<T> => {
  const previousTask = deviceElementTreeQueueById.get(deviceId) ?? Promise.resolve()
  let releaseCurrentTask: () => void = () => undefined
  const currentTask = new Promise<void>(resolve => {
    releaseCurrentTask = resolve
  })
  const queuedTask = previousTask.catch(() => undefined).then(() => currentTask)
  deviceElementTreeQueueById.set(deviceId, queuedTask)

  await previousTask.catch(() => undefined)
  try {
    return await task()
  } finally {
    releaseCurrentTask()
    if (deviceElementTreeQueueById.get(deviceId) === queuedTask) {
      deviceElementTreeQueueById.delete(deviceId)
    }
  }
}

const runDeviceCommand = (
  adbPath: string,
  deviceId: string,
  args: string[],
  timeout = ADB_TIMEOUT_MS
) => runQueuedDeviceAdbTask(deviceId, () => runCommand(adbPath, ['-s', deviceId, ...args], timeout))

const toErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const isPortNumber = (value: number) => Number.isInteger(value) && value > 0 && value <= 65535

const toProxyKey = ({ host, port }: HostPortEndpoint) => `${host}:${port}`

const normalizeEnabled = (value: unknown) => value !== false

const normalizePort = (value: unknown) => {
  if (typeof value === 'number') return isPortNumber(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const parsedValue = Number.parseInt(value, 10)
  return isPortNumber(parsedValue) ? parsedValue : undefined
}

const shouldMockAdbMissing = () => process.env.ONEWORKS_MOCK_ADB_MISSING === '1'

const parseHostPortEndpoint = (value: string, defaultHost = '127.0.0.1'): HostPortEndpoint | undefined => {
  const trimmedValue = value.trim()
  if (trimmedValue === '') return undefined

  const directPort = normalizePort(trimmedValue)
  if (directPort != null && trimmedValue === String(directPort)) {
    return { host: defaultHost, port: directPort }
  }

  try {
    const parsedUrl = new URL(trimmedValue)
    const port = normalizePort(parsedUrl.port)
    if (parsedUrl.hostname !== '' && port != null) {
      return { host: parsedUrl.hostname, port }
    }
  } catch {
    // Fall through to host:port parsing.
  }

  try {
    const parsedUrl = new URL(`tcp://${trimmedValue}`)
    const port = normalizePort(parsedUrl.port)
    if (parsedUrl.hostname !== '' && port != null) {
      return { host: parsedUrl.hostname, port }
    }
  } catch {
    return undefined
  }
}

const normalizeMobileDebugConfig = (config: unknown): NormalizedMobileDebugConfig => {
  const record = config != null && typeof config === 'object' && !Array.isArray(config)
    ? config as Record<string, unknown>
    : {}
  const networkTargets = Array.isArray(record.networkTargets)
    ? record.networkTargets
      .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
      .map((item, index) => ({
        address: typeof item.address === 'string' ? item.address.trim() : '',
        enabled: normalizeEnabled(item.enabled),
        id: typeof item.id === 'string' && item.id.trim() !== '' ? item.id : `network-${index}`
      }))
      .filter(item => item.address !== '')
    : []
  const portForwardingRules = Array.isArray(record.portForwardingRules)
    ? record.portForwardingRules
      .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
      .map((item, index) => {
        const devicePort = normalizePort(item.devicePort)
        return {
          deviceId: typeof item.deviceId === 'string' && item.deviceId.trim() !== '' ? item.deviceId.trim() : undefined,
          devicePort: devicePort ?? 0,
          enabled: normalizeEnabled(item.enabled),
          id: typeof item.id === 'string' && item.id.trim() !== '' ? item.id : `forward-${index}`,
          localAddress: typeof item.localAddress === 'string' ? item.localAddress.trim() : ''
        }
      })
      .filter(item => item.localAddress !== '')
    : []

  return {
    discoverNetworkTargets: normalizeEnabled(record.discoverNetworkTargets),
    discoverUsbDevices: normalizeEnabled(record.discoverUsbDevices),
    networkTargets,
    portForwardingRules,
    selectedDeviceId: typeof record.selectedDeviceId === 'string' && record.selectedDeviceId.trim() !== ''
      ? record.selectedDeviceId.trim()
      : undefined
  }
}

const getAdbCandidates = () => {
  const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  const candidates = [
    process.env.ADB_PATH,
    androidHome == null ? undefined : path.join(androidHome, 'platform-tools', 'adb'),
    path.join(os.homedir(), 'Library/Android/sdk/platform-tools/adb'),
    '/opt/homebrew/bin/adb',
    '/usr/local/bin/adb',
    'adb'
  ]
  const seen = new Set<string>()
  return candidates.filter((candidate): candidate is string => {
    if (candidate == null || candidate.trim() === '' || seen.has(candidate)) return false
    seen.add(candidate)
    return !path.isAbsolute(candidate) || fs.existsSync(candidate)
  })
}

const resolveAdbPath = async () => {
  const errors: string[] = []
  if (shouldMockAdbMissing()) {
    return { adbPath: undefined, errors: ['ONEWORKS_MOCK_ADB_MISSING is enabled.'] }
  }

  for (const candidate of getAdbCandidates()) {
    try {
      await runCommand(candidate, ['version'])
      return { adbPath: candidate, errors }
    } catch (error) {
      errors.push(`${candidate}: ${toErrorMessage(error)}`)
    }
  }
  return { adbPath: undefined, errors }
}

const parseDeviceDetails = (parts: string[]) => {
  const details = Object.fromEntries(
    parts
      .map((part) => {
        const separatorIndex = part.indexOf(':')
        return separatorIndex < 0
          ? undefined
          : [part.slice(0, separatorIndex), part.slice(separatorIndex + 1)]
      })
      .filter((entry): entry is [string, string] => entry != null)
  )
  return details
}

const parseAdbDevices = (stdout: string): MobileDebugDevice[] =>
  stdout
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('List of devices'))
    .map((line) => {
      const [id = '', state = 'unknown', ...detailParts] = line.split(/\s+/u)
      const detailMap = parseDeviceDetails(detailParts)
      const label = detailMap.model ?? detailMap.product ?? detailMap.device ?? id
      return {
        detail: detailParts.join(' '),
        id,
        label,
        state
      }
    })
    .filter(device => device.id !== '')

const normalizeDeviceId = (value: unknown) =>
  typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined

const resolveReadyAdbDevice = async (deviceId: unknown) => {
  const adb = await resolveAdbPath()
  if (adb.adbPath == null) {
    throw new Error(['ADB was not found.', ...adb.errors].join('\n'))
  }

  const normalizedDeviceId = normalizeDeviceId(deviceId)
  const devices = parseAdbDevices((await runCommand(adb.adbPath, ['devices', '-l'])).stdout)
  const device = normalizedDeviceId == null
    ? devices.find(item => item.state === 'device')
    : devices.find(item => item.id === normalizedDeviceId)
  if (device == null) {
    throw new Error(
      normalizedDeviceId == null
        ? 'No connected Android device found.'
        : `Android device not found: ${normalizedDeviceId}`
    )
  }
  if (device.state !== 'device') {
    throw new Error(`${device.label}: ${device.state}`)
  }

  return { adbPath: adb.adbPath, device }
}

const extractSocketName = (line: string) => {
  const match = line.match(/@?([\w.:-]*devtools_remote[\w.:-]*)$/u)
  return match?.[1]
}

const classifySocket = (socketName: string): MobileDebugTarget['socketType'] => {
  if (socketName === 'chrome_devtools_remote' || socketName.startsWith('chrome_devtools_remote_')) {
    return 'chrome'
  }
  if (socketName.startsWith('webview_devtools_remote')) return 'webview'
  return 'other'
}

const getSocketProcessId = (socketName: string) => socketName.match(/_(\d+)$/u)?.[1]

const readSocketAppName = async (adbPath: string, deviceId: string, socketName: string) => {
  const processId = getSocketProcessId(socketName)
  if (processId == null) return undefined

  try {
    const result = await runDeviceCommand(adbPath, deviceId, ['shell', 'cat', `/proc/${processId}/cmdline`])
    return result.stdout.split('\0')[0]?.trim() || undefined
  } catch {
    return undefined
  }
}

const listDevtoolsSockets = async (adbPath: string, deviceId: string) => {
  const result = await runDeviceCommand(adbPath, deviceId, ['shell', 'cat', '/proc/net/unix'])
  const sockets = Array.from(
    new Set(
      result.stdout
        .split(/\r?\n/u)
        .map(extractSocketName)
        .filter((socketName): socketName is string => socketName != null && socketName !== '')
    )
  )
  return sockets.sort((left, right) => {
    const order = { chrome: 0, webview: 1, other: 2 }
    return order[classifySocket(left)] - order[classifySocket(right)] || left.localeCompare(right)
  })
}

const getFreePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address != null) {
          resolve(address.port)
          return
        }
        reject(new Error('Failed to allocate a local port.'))
      })
    })
  })

const fetchJson = async <T>(url: string): Promise<T> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}.`)
    }
    return await response.json() as T
  } finally {
    clearTimeout(timer)
  }
}

const fetchText = async (url: string) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}.`)
    }
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

const fetchOk = async (url: string, method: 'GET' | 'HEAD') => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { method, signal: controller.signal })
    const ok = response.ok
    try {
      await response.body?.cancel()
    } catch {
      // The status is all we need here.
    }
    return ok
  } finally {
    clearTimeout(timer)
  }
}

const isHttpPageUrl = (value: string) => {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

const resolveUrlAgainstPage = (value: string | undefined, pageUrl: string) => {
  const trimmedValue = value?.trim()
  if (trimmedValue == null || trimmedValue === '') return undefined
  try {
    return new URL(trimmedValue, pageUrl).toString()
  } catch {
    return undefined
  }
}

const parseHtmlAttributes = (tag: string) => {
  const attributes = new Map<string, string>()
  const attributePattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/gu
  for (const match of tag.matchAll(attributePattern)) {
    const name = match[1]?.toLowerCase()
    if (name == null) continue
    attributes.set(name, match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

const extractHtmlFaviconUrl = (html: string, pageUrl: string) => {
  const candidates: string[] = []
  const linkPattern = /<link\b[^>]*>/giu
  for (const match of html.matchAll(linkPattern)) {
    const attributes = parseHtmlAttributes(match[0])
    const relTokens = (attributes.get('rel') ?? '').toLowerCase().split(/\s+/u)
    if (!relTokens.includes('icon') || relTokens.includes('mask-icon')) continue
    const faviconUrl = resolveUrlAgainstPage(attributes.get('href'), pageUrl)
    if (faviconUrl != null) candidates.push(faviconUrl)
  }
  return candidates[0]
}

const getPageOriginFaviconUrl = (pageUrl: string) => {
  try {
    return new URL('/favicon.ico', pageUrl).toString()
  } catch {
    return undefined
  }
}

const resolvePageOriginFaviconUrl = async (pageUrl: string) => {
  const faviconUrl = getPageOriginFaviconUrl(pageUrl)
  if (faviconUrl == null) return undefined
  try {
    if (await fetchOk(faviconUrl, 'HEAD')) return faviconUrl
  } catch {
    // Some servers reject HEAD; retry with GET below.
  }

  try {
    return await fetchOk(faviconUrl, 'GET') ? faviconUrl : undefined
  } catch {
    return undefined
  }
}

const resolveTargetHtmlFaviconUrl = async (target: CdpTarget) => {
  const pageUrl = target.url?.trim() ?? ''
  const targetFaviconUrl = resolveUrlAgainstPage(target.faviconUrl, pageUrl || 'http://127.0.0.1')
  if (targetFaviconUrl != null) return targetFaviconUrl
  if (!isHttpPageUrl(pageUrl)) return undefined

  try {
    const html = await fetchText(pageUrl)
    return extractHtmlFaviconUrl(html, pageUrl) ?? await resolvePageOriginFaviconUrl(pageUrl)
  } catch {
    return resolvePageOriginFaviconUrl(pageUrl)
  }
}

const writeBadGateway = (socket: Duplex) => {
  if (socket.destroyed) return
  socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
}

const buildProxyUpgradeRequest = (request: http.IncomingMessage, target: HostPortEndpoint) => {
  const headers = [
    `GET ${request.url ?? '/'} HTTP/${request.httpVersion}`,
    `Host: ${target.host}:${target.port}`,
    'Connection: Upgrade',
    'Upgrade: websocket'
  ]
  const skippedHeaders = new Set(['connection', 'host', 'origin', 'upgrade'])
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index]
    const value = request.rawHeaders[index + 1]
    if (name == null || value == null || skippedHeaders.has(name.toLowerCase())) continue
    headers.push(`${name}: ${value}`)
  }
  return `${headers.join('\r\n')}\r\n\r\n`
}

const createWebSocketProxy = (target: HostPortEndpoint) =>
  new Promise<WebSocketProxyRecord>((resolve, reject) => {
    const server = http.createServer((_request, response) => {
      response.writeHead(404)
      response.end()
    })

    server.on('upgrade', (request, clientSocket, head) => {
      const targetSocket = net.connect(target.port, target.host)
      let hasConnected = false
      const closeSockets = () => {
        clientSocket.destroy()
        targetSocket.destroy()
      }

      clientSocket.once('error', closeSockets)
      targetSocket.once('error', () => {
        if (hasConnected) {
          closeSockets()
        } else {
          writeBadGateway(clientSocket)
          targetSocket.destroy()
        }
      })
      targetSocket.once('connect', () => {
        hasConnected = true
        targetSocket.write(buildProxyUpgradeRequest(request, target))
        if (head.length > 0) targetSocket.write(head)
        clientSocket.pipe(targetSocket)
        targetSocket.pipe(clientSocket)
      })
    })

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address != null) {
        server.off('error', reject)
        server.unref()
        resolve({ host: target.host, port: address.port, server, targetPort: target.port })
        return
      }

      server.close()
      reject(new Error('Failed to allocate a local DevTools proxy port.'))
    })
  })

const ensureWebSocketProxy = async (target: HostPortEndpoint) => {
  const key = toProxyKey(target)
  const existingProxy = webSocketProxyByTarget.get(key)
  if (existingProxy != null) return existingProxy

  const nextProxy = createWebSocketProxy(target).catch(error => {
    webSocketProxyByTarget.delete(key)
    throw error
  })
  webSocketProxyByTarget.set(key, nextProxy)
  return nextProxy
}

const createTcpProxy = (target: HostPortEndpoint) =>
  new Promise<TcpProxyRecord>((resolve, reject) => {
    const server = net.createServer((clientSocket) => {
      const targetSocket = net.connect(target.port, target.host)
      const closeSockets = () => {
        clientSocket.destroy()
        targetSocket.destroy()
      }

      clientSocket.once('error', closeSockets)
      targetSocket.once('error', closeSockets)
      clientSocket.pipe(targetSocket)
      targetSocket.pipe(clientSocket)
    })

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address != null) {
        server.off('error', reject)
        server.unref()
        resolve({
          localPort: address.port,
          server,
          targetHost: target.host,
          targetPort: target.port
        })
        return
      }

      server.close()
      reject(new Error('Failed to allocate a local port forwarding proxy.'))
    })
  })

const ensureTcpProxy = async (target: HostPortEndpoint) => {
  const key = toProxyKey(target)
  const existingProxy = tcpProxyByTarget.get(key)
  if (existingProxy != null) return existingProxy

  const nextProxy = createTcpProxy(target).catch(error => {
    tcpProxyByTarget.delete(key)
    throw error
  })
  tcpProxyByTarget.set(key, nextProxy)
  return nextProxy
}

const getWebSocketDebuggerPath = (target: CdpTarget) => {
  if (target.webSocketDebuggerUrl != null && target.webSocketDebuggerUrl !== '') {
    try {
      const websocketUrl = new URL(target.webSocketDebuggerUrl)
      return `${websocketUrl.pathname}${websocketUrl.search}`
    } catch {
      // Fall through to devtoolsFrontendUrl parsing.
    }
  }

  if (target.devtoolsFrontendUrl == null || target.devtoolsFrontendUrl === '') return undefined
  try {
    const frontendUrl = new URL(target.devtoolsFrontendUrl)
    const websocketTarget = frontendUrl.searchParams.get('ws')
    if (websocketTarget == null || websocketTarget === '') return undefined
    const websocketUrl = new URL(`ws://${websocketTarget}`)
    return `${websocketUrl.pathname}${websocketUrl.search}`
  } catch {
    return undefined
  }
}

const buildInspectUrl = (target: CdpTarget, localPort: number, webSocketProxyPort: number) => {
  const websocketPath = getWebSocketDebuggerPath(target)
  const proxiedWebsocketTarget = websocketPath == null
    ? undefined
    : `127.0.0.1:${webSocketProxyPort}${websocketPath}`
  const frontendUrl = target.devtoolsFrontendUrl
  if (frontendUrl != null && frontendUrl !== '') {
    try {
      const parsedFrontendUrl = new URL(frontendUrl, `http://127.0.0.1:${localPort}`)
      if (proxiedWebsocketTarget != null) {
        parsedFrontendUrl.searchParams.set('ws', proxiedWebsocketTarget)
      }
      return parsedFrontendUrl.toString()
    } catch {
      // Fall through to the generic DevTools URL.
    }
  }

  if (proxiedWebsocketTarget != null) {
    return `http://127.0.0.1:${localPort}/devtools/inspector.html?ws=${encodeURIComponent(proxiedWebsocketTarget)}`
  }

  return `http://127.0.0.1:${localPort}/json`
}

const mobileDebugFaviconExpression = `(() => {
  const links = Array.from(document.querySelectorAll('link[rel]'));
  const link = links.find((element) => {
    const relTokens = String(element.getAttribute('rel') || '').toLowerCase().split(/\\s+/);
    return relTokens.includes('icon') && !relTokens.includes('mask-icon');
  });
  return link?.href || '';
})()`

const getProxiedWebSocketDebuggerUrl = (target: CdpTarget, webSocketProxyPort: number) => {
  const websocketPath = getWebSocketDebuggerPath(target)
  return websocketPath == null ? undefined : `ws://127.0.0.1:${webSocketProxyPort}${websocketPath}`
}

const evaluateCdpStringExpression = (webSocketUrl: string, expression: string) =>
  new Promise<string | undefined>((resolve) => {
    if (typeof WebSocket !== 'function') {
      resolve(undefined)
      return
    }

    const requestId = 1
    let socket: WebSocket
    try {
      socket = new WebSocket(webSocketUrl)
    } catch {
      resolve(undefined)
      return
    }
    let finished = false
    const timer = setTimeout(() => finish(undefined), FETCH_TIMEOUT_MS)
    const finish = (value: string | undefined) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        // Best effort cleanup.
      }
      resolve(value)
    }

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: requestId,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true }
      }))
    })
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return
      try {
        const message = JSON.parse(event.data) as {
          id?: number
          result?: { result?: { value?: unknown } }
        }
        if (message.id !== requestId) return
        const value = message.result?.result?.value
        finish(typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)
      } catch {
        finish(undefined)
      }
    })
    socket.addEventListener('error', () => finish(undefined))
    socket.addEventListener('close', () => finish(undefined))
  })

const readTargetFaviconUrlFromCdp = async (target: CdpTarget, webSocketProxyPort: number) => {
  const webSocketUrl = getProxiedWebSocketDebuggerUrl(target, webSocketProxyPort)
  if (webSocketUrl == null) return undefined
  return await evaluateCdpStringExpression(webSocketUrl, mobileDebugFaviconExpression)
}

const resolveTargetFaviconUrl = async (target: CdpTarget, webSocketProxyPort: number) => {
  const pageUrl = target.url?.trim() ?? ''
  const targetFaviconUrl = resolveUrlAgainstPage(target.faviconUrl, pageUrl || 'http://127.0.0.1')
  if (targetFaviconUrl != null) return targetFaviconUrl

  const cachedFaviconUrl = pageUrl === '' ? undefined : faviconUrlByPageUrl.get(pageUrl)
  if (cachedFaviconUrl != null) return cachedFaviconUrl

  const resolvedFaviconUrl = await readTargetFaviconUrlFromCdp(target, webSocketProxyPort) ??
    await resolveTargetHtmlFaviconUrl(target)
  if (resolvedFaviconUrl != null && pageUrl !== '') {
    faviconUrlByPageUrl.set(pageUrl, resolvedFaviconUrl)
  }
  return resolvedFaviconUrl
}

const normalizeTarget = async ({
  device,
  localPort,
  networkAddress,
  appName,
  socketName,
  source,
  target,
  webSocketProxyPort
}: {
  device: MobileDebugDevice
  localPort: number
  networkAddress?: string
  appName?: string
  webSocketProxyPort: number
  socketName: string
  source: MobileDebugTarget['source']
  target: CdpTarget
}): Promise<MobileDebugTarget | null> => {
  const id = target.id?.trim()
  if (id == null || id === '') return null
  const url = target.url?.trim() ?? ''
  const title = target.title?.trim() || url || id
  const faviconUrl = await resolveTargetFaviconUrl(target, webSocketProxyPort)
  return {
    deviceId: device.id,
    deviceLabel: device.label,
    id: `${device.id}:${socketName}:${id}`,
    inspectUrl: buildInspectUrl(target, localPort, webSocketProxyPort),
    localPort,
    ...(appName == null ? {} : { appName }),
    ...(networkAddress == null ? {} : { networkAddress }),
    socketName,
    socketType: classifySocket(socketName),
    source,
    title,
    type: target.type?.trim() || 'page',
    url,
    ...(target.description == null || target.description.trim() === '' ? {} : { description: target.description }),
    ...(target.devtoolsFrontendUrl == null || target.devtoolsFrontendUrl === ''
      ? {}
      : { devtoolsFrontendUrl: target.devtoolsFrontendUrl }),
    ...(faviconUrl == null ? {} : { faviconUrl }),
    ...(target.webSocketDebuggerUrl == null || target.webSocketDebuggerUrl === ''
      ? {}
      : { webSocketDebuggerUrl: target.webSocketDebuggerUrl })
  }
}

const listSocketTargets = async ({
  adbPath,
  device,
  socketName
}: {
  adbPath: string
  device: MobileDebugDevice
  socketName: string
}) => {
  const { localPort, webSocketProxyPort } = await ensureSocketForward({ adbPath, device, socketName })
  const appName = await readSocketAppName(adbPath, device.id, socketName)
  const targets = await fetchJson<CdpTarget[]>(`http://127.0.0.1:${localPort}/json`)
  const normalizedTargets = await Promise.all(
    targets.map(target =>
      normalizeTarget({ appName, device, localPort, webSocketProxyPort, socketName, source: 'usb', target })
    )
  )
  return normalizedTargets.filter((target): target is MobileDebugTarget => target != null)
}

const getMatchingDevices = (devices: MobileDebugDevice[], deviceId?: string) =>
  devices.filter(device => device.state === 'device' && (deviceId == null || device.id === deviceId))

const ensureSocketForward = async ({
  adbPath,
  device,
  socketName
}: {
  adbPath: string
  device: MobileDebugDevice
  socketName: string
}) => {
  const key = `${device.id}:${socketName}`
  const existingForward = socketForwardByTarget.get(key)
  if (existingForward != null) return existingForward

  const nextForward = (async () => {
    const localPort = await getFreePort()
    await runDeviceCommand(adbPath, device.id, ['forward', `tcp:${localPort}`, `localabstract:${socketName}`])
    const webSocketProxyPort = (await ensureWebSocketProxy({ host: '127.0.0.1', port: localPort })).port
    return { localPort, webSocketProxyPort }
  })().catch(error => {
    socketForwardByTarget.delete(key)
    throw error
  })
  socketForwardByTarget.set(key, nextForward)
  return nextForward
}

const removeReversePort = async (adbPath: string, deviceId: string, devicePort: number) => {
  try {
    await runDeviceCommand(adbPath, deviceId, ['reverse', '--remove', `tcp:${devicePort}`])
  } catch {
    // Removing a missing reverse mapping is harmless.
  }
}

const rememberReversePort = (deviceId: string, devicePort: number, localAddress: string) => {
  const ports = activeReversePortsByDevice.get(deviceId) ?? new Map<number, string>()
  ports.set(devicePort, localAddress)
  activeReversePortsByDevice.set(deviceId, ports)
}

const forgetReversePort = (deviceId: string, devicePort: number) => {
  const ports = activeReversePortsByDevice.get(deviceId)
  if (ports == null) return
  ports.delete(devicePort)
  if (ports.size === 0) activeReversePortsByDevice.delete(deviceId)
}

const getDesiredReversePorts = (devices: MobileDebugDevice[], rules: MobileDebugPortForwardRuleConfig[]) => {
  const desiredPorts = new Map<string, Set<number>>()
  for (const rule of rules) {
    if (rule.enabled === false || !isPortNumber(rule.devicePort) || parseHostPortEndpoint(rule.localAddress) == null) {
      continue
    }
    for (const device of getMatchingDevices(devices, rule.deviceId)) {
      const ports = desiredPorts.get(device.id) ?? new Set<number>()
      ports.add(rule.devicePort)
      desiredPorts.set(device.id, ports)
    }
  }
  return desiredPorts
}

const removeStaleReversePorts = async ({
  adbPath,
  desiredPorts,
  devices
}: {
  adbPath: string
  desiredPorts: Map<string, Set<number>>
  devices: MobileDebugDevice[]
}) => {
  const statuses: MobileDebugPortForwardStatus[] = []
  const deviceById = new Map(devices.map(device => [device.id, device]))
  for (const [deviceId, activePorts] of activeReversePortsByDevice) {
    const device = deviceById.get(deviceId)
    if (device?.state !== 'device') continue
    const desiredDevicePorts = desiredPorts.get(deviceId) ?? new Set<number>()
    for (const [devicePort, localAddress] of activePorts) {
      if (desiredDevicePorts.has(devicePort)) continue
      await removeReversePort(adbPath, deviceId, devicePort)
      forgetReversePort(deviceId, devicePort)
      statuses.push({
        deviceId,
        deviceLabel: device.label,
        devicePort,
        localAddress,
        ruleId: `stale:${deviceId}:${devicePort}`,
        status: 'removed'
      })
    }
  }
  return statuses
}

const applyPortForwardingRules = async ({
  adbPath,
  devices,
  rules
}: {
  adbPath: string
  devices: MobileDebugDevice[]
  rules: MobileDebugPortForwardRuleConfig[]
}): Promise<MobileDebugPortForwardStatus[]> => {
  const statuses: MobileDebugPortForwardStatus[] = []
  const desiredPorts = getDesiredReversePorts(devices, rules)

  for (const rule of rules) {
    const matchingDevices = getMatchingDevices(devices, rule.deviceId)
    if (!isPortNumber(rule.devicePort)) {
      statuses.push({
        deviceId: rule.deviceId ?? '',
        deviceLabel: rule.deviceId ?? 'All devices',
        devicePort: rule.devicePort,
        localAddress: rule.localAddress,
        message: 'Invalid device port.',
        ruleId: rule.id ?? `${rule.localAddress}:${rule.devicePort}`,
        status: 'error'
      })
      continue
    }

    if (matchingDevices.length === 0) {
      statuses.push({
        deviceId: rule.deviceId ?? '',
        deviceLabel: rule.deviceId ?? 'All devices',
        devicePort: rule.devicePort,
        localAddress: rule.localAddress,
        message: 'No connected device matched this rule.',
        ruleId: rule.id ?? `${rule.localAddress}:${rule.devicePort}`,
        status: 'skipped'
      })
      continue
    }

    if (rule.enabled === false) {
      for (const device of matchingDevices) {
        await removeReversePort(adbPath, device.id, rule.devicePort)
        statuses.push({
          deviceId: device.id,
          deviceLabel: device.label,
          devicePort: rule.devicePort,
          localAddress: rule.localAddress,
          ruleId: rule.id ?? `${rule.localAddress}:${rule.devicePort}`,
          status: 'removed'
        })
      }
      continue
    }

    const endpoint = parseHostPortEndpoint(rule.localAddress)
    if (endpoint == null) {
      statuses.push({
        deviceId: rule.deviceId ?? '',
        deviceLabel: rule.deviceId ?? 'All devices',
        devicePort: rule.devicePort,
        localAddress: rule.localAddress,
        message: 'Invalid local address.',
        ruleId: rule.id ?? `${rule.localAddress}:${rule.devicePort}`,
        status: 'error'
      })
      continue
    }

    try {
      const proxy = await ensureTcpProxy(endpoint)
      for (const device of matchingDevices) {
        try {
          await runDeviceCommand(adbPath, device.id, [
            'reverse',
            `tcp:${rule.devicePort}`,
            `tcp:${proxy.localPort}`
          ])
          rememberReversePort(device.id, rule.devicePort, rule.localAddress)
          statuses.push({
            deviceId: device.id,
            deviceLabel: device.label,
            devicePort: rule.devicePort,
            localAddress: rule.localAddress,
            message: `localhost:${rule.devicePort} -> ${endpoint.host}:${endpoint.port}`,
            ruleId: rule.id ?? `${rule.localAddress}:${rule.devicePort}`,
            status: 'active'
          })
        } catch (error) {
          forgetReversePort(device.id, rule.devicePort)
          statuses.push({
            deviceId: device.id,
            deviceLabel: device.label,
            devicePort: rule.devicePort,
            localAddress: rule.localAddress,
            message: toErrorMessage(error),
            ruleId: rule.id ?? `${rule.localAddress}:${rule.devicePort}`,
            status: 'error'
          })
        }
      }
    } catch (error) {
      statuses.push({
        deviceId: rule.deviceId ?? '',
        deviceLabel: rule.deviceId ?? 'All devices',
        devicePort: rule.devicePort,
        localAddress: rule.localAddress,
        message: toErrorMessage(error),
        ruleId: rule.id ?? `${rule.localAddress}:${rule.devicePort}`,
        status: 'error'
      })
    }
  }

  statuses.push(...await removeStaleReversePorts({ adbPath, desiredPorts, devices }))
  return statuses
}

const listNetworkTargets = async (targetConfig: MobileDebugNetworkTargetConfig): Promise<MobileDebugTarget[]> => {
  const endpoint = parseHostPortEndpoint(targetConfig.address)
  if (endpoint == null) {
    throw new Error(`Invalid network target: ${targetConfig.address}`)
  }

  const localPort = endpoint.port
  const webSocketProxyPort = (await ensureWebSocketProxy(endpoint)).port
  const targets = await fetchJson<CdpTarget[]>(`http://${endpoint.host}:${endpoint.port}/json`)
  const device: MobileDebugDevice = {
    detail: targetConfig.address,
    id: `network:${targetConfig.address}`,
    label: targetConfig.address,
    state: 'network'
  }
  const normalizedTargets = await Promise.all(
    targets.map(target =>
      normalizeTarget({
        device,
        localPort,
        networkAddress: targetConfig.address,
        socketName: 'chrome_devtools_remote',
        source: 'network',
        target,
        webSocketProxyPort
      })
    )
  )
  return normalizedTargets.filter((target): target is MobileDebugTarget => target != null)
}

const readPngSize = (buffer: Buffer) => {
  const pngSignature = '89504e470d0a1a0a'
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== pngSignature) return undefined
  return {
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16)
  }
}

const createBufferReadableStream = (buffer: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(buffer)
      controller.close()
    }
  })

const getScrcpyVideoCodecName = (codec: number) => ScrcpyVideoCodecNameMap.get(codec) ?? `codec-${codec}`

const getScrcpyServerPathCandidates = () => {
  const fileName = `scrcpy-server-v${SCRCPY_SERVER_VERSION}`
  const resourceRelativePath = path.join('resources', 'scrcpy', fileName)
  return [
    process.env.ONEWORKS_SCRCPY_SERVER_PATH,
    path.join(app.getAppPath(), resourceRelativePath),
    path.join(process.cwd(), resourceRelativePath),
    path.resolve(__dirname, '..', resourceRelativePath),
    path.resolve(__dirname, '..', '..', resourceRelativePath),
    path.resolve(__dirname, '..', '..', '..', resourceRelativePath)
  ].filter((candidate): candidate is string => candidate != null && candidate.trim() !== '')
}

const resolveScrcpyServerPath = () => {
  for (const candidate of getScrcpyServerPathCandidates()) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(`scrcpy server v${SCRCPY_SERVER_VERSION} was not found.`)
}

const resolveAdbServerTcpSpec = () => {
  const rawSocket = process.env.ADB_SERVER_SOCKET?.trim()
  if (rawSocket != null && rawSocket.startsWith('tcp:')) {
    const socketParts = rawSocket.slice('tcp:'.length).split(':')
    const [hostValue, portValue = socketParts.length === 1 ? socketParts[0] : '5037'] = socketParts
    const host = socketParts.length === 1 ? '127.0.0.1' : hostValue
    const port = normalizePort(portValue)
    if (port != null) return { host: host === '' ? '127.0.0.1' : host, port }
  }

  const envPort = normalizePort(process.env.ADB_SERVER_PORT)
  return {
    host: '127.0.0.1',
    port: envPort ?? 5037
  }
}

const sendMobileDeviceVideoStreamStatus = (
  webContents: WebContents,
  event: MobileDeviceVideoStreamStatusEvent
) => {
  if (webContents.isDestroyed()) return
  webContents.send(MOBILE_DEVICE_VIDEO_STREAM_STATUS_CHANNEL, event)
}

const closeMobileDeviceVideoStreamSession = async (
  session: MobileDeviceVideoStreamSession,
  webContents: WebContents | undefined,
  status: MobileDeviceVideoStreamStatusEvent['status'],
  message?: string
) => {
  if (session.isClosed) return
  session.isClosed = true
  mobileDeviceVideoStreamById.delete(session.streamId)
  session.removeDestroyedListener()

  await Promise.allSettled([
    session.client.close(),
    session.adb.close()
  ])

  if (webContents != null) {
    sendMobileDeviceVideoStreamStatus(webContents, {
      deviceId: session.deviceId,
      message,
      status,
      streamId: session.streamId
    })
  }
}

const consumeScrcpyOutput = async (output: Awaited<ReturnType<typeof AdbScrcpyClient.start>>['output']) => {
  const reader = output.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      void value
    }
  } catch {
    // The scrcpy output stream closes when its process is stopped.
  }
}

const toMobileDeviceVideoFrameEvent = (
  session: MobileDeviceVideoStreamSession,
  packet: ScrcpyMediaStreamPacket,
  size: { height?: number; width?: number }
): MobileDeviceVideoFrameEvent => ({
  data: packet.data,
  deviceId: session.deviceId,
  height: size.height,
  keyframe: packet.type === 'data' ? packet.keyframe : undefined,
  receivedAt: Date.now(),
  streamId: session.streamId,
  type: packet.type,
  width: size.width
})

const pumpMobileDeviceVideoStream = async (
  webContents: WebContents,
  session: MobileDeviceVideoStreamSession,
  videoStream: Awaited<Awaited<ReturnType<typeof AdbScrcpyClient.start>>['videoStream']>
) => {
  const reader = videoStream.stream.getReader()
  try {
    while (!session.isClosed) {
      const { done, value } = await reader.read()
      if (done) break
      if (webContents.isDestroyed()) break

      webContents.send(
        MOBILE_DEVICE_VIDEO_FRAME_CHANNEL,
        toMobileDeviceVideoFrameEvent(session, value, {
          height: videoStream.height || videoStream.metadata.height,
          width: videoStream.width || videoStream.metadata.width
        })
      )
    }
    await closeMobileDeviceVideoStreamSession(session, webContents, 'closed')
  } catch (error) {
    await closeMobileDeviceVideoStreamSession(session, webContents, 'error', toErrorMessage(error))
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

const normalizeScrollDelta = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(-1, Math.min(1, value))
}

const toInputEventRecord = (input: unknown): MobileDeviceInputEvent => {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid mobile input event.')
  }
  const record = input as Record<string, unknown>
  const kind = record.kind
  if (
    kind !== 'action' &&
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
    action: record.action === 'collapse-panels' ||
        record.action === 'notifications' ||
        record.action === 'quick-settings' ||
        record.action === 'rotate'
      ? record.action
      : undefined,
    durationMs: typeof record.durationMs === 'number' ? record.durationMs : undefined,
    endX: typeof record.endX === 'number' ? record.endX : undefined,
    endY: typeof record.endY === 'number' ? record.endY : undefined,
    key: record.key === 'app-switch' ||
        record.key === 'back' ||
        record.key === 'delete' ||
        record.key === 'enter' ||
        record.key === 'home' ||
        record.key === 'power' ||
        record.key === 'volume-down' ||
        record.key === 'volume-up'
      ? record.key
      : undefined,
    kind,
    physicalEndX: typeof record.physicalEndX === 'number' ? record.physicalEndX : undefined,
    physicalEndY: typeof record.physicalEndY === 'number' ? record.physicalEndY : undefined,
    physicalX: typeof record.physicalX === 'number' ? record.physicalX : undefined,
    physicalY: typeof record.physicalY === 'number' ? record.physicalY : undefined,
    scrollX: typeof record.scrollX === 'number' ? record.scrollX : undefined,
    scrollY: typeof record.scrollY === 'number' ? record.scrollY : undefined,
    text: typeof record.text === 'string' ? record.text : undefined,
    touchPhase: record.touchPhase === 'down' || record.touchPhase === 'move' || record.touchPhase === 'up'
      ? record.touchPhase
      : undefined,
    x: typeof record.x === 'number' ? record.x : undefined,
    y: typeof record.y === 'number' ? record.y : undefined
  }
}

const getInputKeyCode = (key: MobileDeviceInputEvent['key']) => {
  if (key === 'app-switch') return 'KEYCODE_APP_SWITCH'
  if (key === 'back') return 'KEYCODE_BACK'
  if (key === 'delete') return 'KEYCODE_DEL'
  if (key === 'enter') return 'KEYCODE_ENTER'
  if (key === 'home') return 'KEYCODE_HOME'
  if (key === 'power') return 'KEYCODE_POWER'
  if (key === 'volume-down') return 'KEYCODE_VOLUME_DOWN'
  if (key === 'volume-up') return 'KEYCODE_VOLUME_UP'
  throw new Error('Invalid mobile input key.')
}

const getScrcpyInputKeyCode = (key: MobileDeviceInputEvent['key']) => {
  if (key === 'app-switch') return AndroidKeyCode.AndroidAppSwitch
  if (key === 'back') return AndroidKeyCode.AndroidBack
  if (key === 'delete') return AndroidKeyCode.Backspace
  if (key === 'enter') return AndroidKeyCode.Enter
  if (key === 'home') return AndroidKeyCode.AndroidHome
  if (key === 'power') return AndroidKeyCode.Power
  if (key === 'volume-down') return AndroidKeyCode.VolumeDown
  if (key === 'volume-up') return AndroidKeyCode.VolumeUp
  throw new Error('Invalid mobile input key.')
}

const encodeAndroidInputText = (text: string) =>
  text
    .replaceAll('%', '%25')
    .replaceAll(' ', '%s')
    .replaceAll('"', '\\"')
    .replaceAll("'", "\\'")
    .replaceAll('\\', '\\\\')

const delayMs = (durationMs: number) => new Promise(resolve => setTimeout(resolve, durationMs))

const findMobileDeviceVideoStreamSession = (deviceId: string, webContents?: WebContents) => {
  const sessions = [...mobileDeviceVideoStreamById.values()]
    .filter(session => !session.isClosed && session.deviceId === deviceId)
  if (sessions.length <= 0) return undefined
  if (webContents != null) {
    const ownedSession = sessions.find(session => session.ownerWebContentsId === webContents.id)
    if (ownedSession != null) return ownedSession
  }
  return sessions.at(-1)
}

const getScrcpyVideoSize = (session: MobileDeviceVideoStreamSession) => {
  const videoWidth = session.videoWidth
  const videoHeight = session.videoHeight
  if (videoWidth == null || videoHeight == null || videoWidth <= 0 || videoHeight <= 0) {
    throw new Error('scrcpy video size is not ready.')
  }
  return { videoHeight, videoWidth }
}

const toScrcpyPointer = (
  session: MobileDeviceVideoStreamSession,
  xValue: unknown,
  yValue: unknown
) => {
  const x = normalizeCoordinate(xValue)
  const y = normalizeCoordinate(yValue)
  if (x == null || y == null) throw new Error('Pointer input requires x and y.')
  const { videoHeight, videoWidth } = getScrcpyVideoSize(session)
  return {
    pointerX: Math.max(0, Math.min(videoWidth, x)),
    pointerY: Math.max(0, Math.min(videoHeight, y)),
    videoHeight,
    videoWidth
  }
}

const createScrcpyTouchMessage = (
  session: MobileDeviceVideoStreamSession,
  action: AndroidMotionEventAction,
  x: unknown,
  y: unknown,
  pressure: number
) => ({
  ...toScrcpyPointer(session, x, y),
  action,
  actionButton: AndroidMotionEventButton.Primary,
  buttons: pressure > 0 ? AndroidMotionEventButton.Primary : AndroidMotionEventButton.None,
  pointerId: ScrcpyPointerId.Finger,
  pressure
})

const getScrcpyTouchAction = (phase: MobileDeviceInputEvent['touchPhase']) => {
  if (phase === 'down') return AndroidMotionEventAction.Down
  if (phase === 'move') return AndroidMotionEventAction.Move
  if (phase === 'up') return AndroidMotionEventAction.Up
  throw new Error('Touch input requires a valid phase.')
}

const sendScrcpyTouchInput = async (
  session: MobileDeviceVideoStreamSession,
  inputEvent: MobileDeviceInputEvent
) => {
  const controller = session.controller
  if (controller == null) throw new Error('scrcpy control stream is not available.')

  const action = getScrcpyTouchAction(inputEvent.touchPhase)
  await controller.injectTouch(createScrcpyTouchMessage(
    session,
    action,
    inputEvent.x,
    inputEvent.y,
    action === AndroidMotionEventAction.Up ? 0 : 1
  ))
}

const sendScrcpyKeyInput = async (
  controller: ScrcpyControlMessageWriter,
  key: MobileDeviceInputEvent['key']
) => {
  const keyCode = getScrcpyInputKeyCode(key)
  await controller.injectKeyCode({
    action: AndroidKeyEventAction.Down,
    keyCode,
    metaState: AndroidKeyEventMeta.None,
    repeat: 0
  })
  await controller.injectKeyCode({
    action: AndroidKeyEventAction.Up,
    keyCode,
    metaState: AndroidKeyEventMeta.None,
    repeat: 0
  })
}

const sendScrcpySwipeInput = async (
  session: MobileDeviceVideoStreamSession,
  inputEvent: MobileDeviceInputEvent
) => {
  const controller = session.controller
  if (controller == null) throw new Error('scrcpy control stream is not available.')

  const durationMs = normalizeDurationMs(inputEvent.durationMs, 220)
  const steps = Math.max(1, Math.min(24, Math.round(durationMs / 16)))
  const startX = normalizeCoordinate(inputEvent.x)
  const startY = normalizeCoordinate(inputEvent.y)
  const endX = normalizeCoordinate(inputEvent.endX)
  const endY = normalizeCoordinate(inputEvent.endY)
  if (startX == null || startY == null || endX == null || endY == null) {
    throw new Error('Swipe input requires x, y, endX and endY.')
  }

  await controller.injectTouch(createScrcpyTouchMessage(session, AndroidMotionEventAction.Down, startX, startY, 1))
  for (let index = 1; index < steps; index += 1) {
    const progress = index / steps
    await delayMs(Math.max(1, Math.round(durationMs / steps)))
    await controller.injectTouch(createScrcpyTouchMessage(
      session,
      AndroidMotionEventAction.Move,
      startX + (endX - startX) * progress,
      startY + (endY - startY) * progress,
      1
    ))
  }
  await delayMs(Math.max(1, Math.round(durationMs / steps)))
  await controller.injectTouch(createScrcpyTouchMessage(session, AndroidMotionEventAction.Up, endX, endY, 0))
}

const trySendScrcpyMobileDeviceInput = async (
  webContents: WebContents | undefined,
  deviceId: string,
  inputEvent: MobileDeviceInputEvent
) => {
  const session = findMobileDeviceVideoStreamSession(deviceId, webContents)
  const controller = session?.controller
  if (session == null || controller == null) return false

  if (inputEvent.kind === 'touch') {
    await sendScrcpyTouchInput(session, inputEvent)
  } else if (inputEvent.kind === 'tap') {
    await controller.injectTouch(
      createScrcpyTouchMessage(session, AndroidMotionEventAction.Down, inputEvent.x, inputEvent.y, 1)
    )
    await delayMs(20)
    await controller.injectTouch(
      createScrcpyTouchMessage(session, AndroidMotionEventAction.Up, inputEvent.x, inputEvent.y, 0)
    )
  } else if (inputEvent.kind === 'swipe') {
    await sendScrcpySwipeInput(session, inputEvent)
  } else if (inputEvent.kind === 'scroll') {
    const pointer = toScrcpyPointer(session, inputEvent.x, inputEvent.y)
    await controller.injectScroll({
      ...pointer,
      buttons: AndroidMotionEventButton.None,
      scrollX: normalizeScrollDelta(inputEvent.scrollX),
      scrollY: normalizeScrollDelta(inputEvent.scrollY)
    })
  } else if (inputEvent.kind === 'text') {
    const text = inputEvent.text
    if (text == null || text === '') throw new Error('Text input requires text.')
    await controller.injectText(text)
  } else if (inputEvent.kind === 'action') {
    if (inputEvent.action === 'collapse-panels') await controller.collapseNotificationPanel()
    else if (inputEvent.action === 'notifications') await controller.expandNotificationPanel()
    else if (inputEvent.action === 'quick-settings') await controller.expandSettingPanel()
    else if (inputEvent.action === 'rotate') await controller.rotateDevice()
    else throw new Error('Invalid mobile input action.')
  } else {
    await sendScrcpyKeyInput(controller, inputEvent.key)
  }
  return true
}

const getAdbInputCoordinate = (
  inputEvent: MobileDeviceInputEvent,
  videoField: 'endX' | 'endY' | 'x' | 'y'
) => {
  if (videoField === 'endX') return normalizeCoordinate(inputEvent.physicalEndX ?? inputEvent.endX)
  if (videoField === 'endY') return normalizeCoordinate(inputEvent.physicalEndY ?? inputEvent.endY)
  if (videoField === 'x') return normalizeCoordinate(inputEvent.physicalX ?? inputEvent.x)
  return normalizeCoordinate(inputEvent.physicalY ?? inputEvent.y)
}

const sendAdbTouchInput = async (
  adbPath: string,
  deviceId: string,
  inputEvent: MobileDeviceInputEvent
) => {
  const phase = inputEvent.touchPhase
  const x = getAdbInputCoordinate(inputEvent, 'x')
  const y = getAdbInputCoordinate(inputEvent, 'y')
  if (phase == null) throw new Error('Touch input requires a valid phase.')
  if (x == null || y == null) throw new Error('Touch input requires x and y.')

  if (phase === 'down') {
    adbTouchGestureByDeviceId.set(deviceId, { startedAt: Date.now(), x, y })
    return
  }
  if (phase === 'move') return

  const startPoint = adbTouchGestureByDeviceId.get(deviceId)
  adbTouchGestureByDeviceId.delete(deviceId)
  if (startPoint == null || Math.hypot(x - startPoint.x, y - startPoint.y) <= 10) {
    await runCommand(adbPath, ['-s', deviceId, 'shell', 'input', 'tap', String(x), String(y)], ADB_INPUT_TIMEOUT_MS)
    return
  }

  await runCommand(adbPath, [
    '-s',
    deviceId,
    'shell',
    'input',
    'swipe',
    String(startPoint.x),
    String(startPoint.y),
    String(x),
    String(y),
    String(normalizeDurationMs(Date.now() - startPoint.startedAt, 220))
  ], ADB_INPUT_TIMEOUT_MS)
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
  const attributePattern = /([^\s=/>]+)\s*=\s*"([^"]*)"/gu
  for (const match of value.matchAll(attributePattern)) {
    const name = match[1]
    const rawValue = match[2]
    if (name == null || rawValue == null) continue
    const decodedValue = decodeXmlAttribute(rawValue)
    if (decodedValue === 'true') {
      attributes[name] = true
    } else if (decodedValue === 'false') {
      attributes[name] = false
    } else {
      attributes[name] = decodedValue
    }
  }
  return attributes
}

const parseBoundsAttribute = (value: unknown): MobileElementBounds | undefined => {
  if (typeof value !== 'string') return undefined
  const match = value.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/u)
  if (match == null) return undefined
  const left = Number.parseInt(match[1] ?? '', 10)
  const top = Number.parseInt(match[2] ?? '', 10)
  const right = Number.parseInt(match[3] ?? '', 10)
  const bottom = Number.parseInt(match[4] ?? '', 10)
  if (![left, top, right, bottom].every(Number.isFinite)) return undefined
  return {
    height: Math.max(0, bottom - top),
    width: Math.max(0, right - left),
    x: left,
    y: top
  }
}

const getElementLabel = (attributes: Record<string, string | number | boolean | null>) => {
  const candidates = [attributes.text, attributes['content-desc'], attributes['resource-id']]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
  }
  return undefined
}

const parseUiautomatorXml = (xml: string): MobileElementTreeResponse['root'] => {
  const root: MobileElementNode = {
    attributes: {},
    children: [],
    id: 'uiautomator:root',
    label: 'hierarchy',
    source: 'uiautomator',
    type: 'hierarchy'
  }
  const stack: MobileElementNode[] = [root]
  const nodeIndexByDepth: number[] = []
  const nodePattern = /<\/node>|<node\b([^>]*?)(\/?)>/gu

  for (const match of xml.matchAll(nodePattern)) {
    if (match[0] === '</node>') {
      if (stack.length > 1) stack.pop()
      continue
    }

    const attributeText = match[1] ?? ''
    const isSelfClosing = match[2] === '/'
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
    const node: MobileElementNode = {
      attributes,
      bounds: parseBoundsAttribute(attributes.bounds),
      children: [],
      id: `uiautomator:${pathParts.join('/')}`,
      label: getElementLabel(attributes),
      source: 'uiautomator',
      type: typeof attributes.class === 'string' && attributes.class !== '' ? attributes.class : 'node'
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

export const listMobileDebugTargets = async (inputConfig?: unknown): Promise<MobileDebugTargetsResponse> => {
  const config = normalizeMobileDebugConfig(inputConfig)
  const targets: MobileDebugTarget[] = []
  const scanErrors: string[] = []
  let adbPath: string | undefined
  let devices: MobileDebugDevice[] = []
  let adbErrors: string[] = []
  let portForwarding: MobileDebugPortForwardStatus[] = []
  const needsAdb = config.discoverUsbDevices || config.portForwardingRules.length > 0

  if (needsAdb) {
    const adb = await resolveAdbPath()
    adbPath = adb.adbPath
    adbErrors = adb.errors
    if (adbPath == null) {
      return {
        adbMissing: true,
        devices: [],
        errors: ['ADB was not found.', ...adbErrors],
        portForwarding,
        scannedAt: Date.now(),
        targets
      }
    }

    devices = parseAdbDevices((await runCommand(adbPath, ['devices', '-l'])).stdout)
    const targetDevices = config.selectedDeviceId == null
      ? devices
      : devices.filter(device => device.id === config.selectedDeviceId)
    portForwarding = await applyPortForwardingRules({
      adbPath,
      devices: targetDevices,
      rules: config.portForwardingRules
    })

    if (config.discoverUsbDevices) {
      for (const device of targetDevices) {
        if (device.state !== 'device') {
          scanErrors.push(`${device.label}: ${device.state}`)
          continue
        }

        try {
          const sockets = await listDevtoolsSockets(adbPath, device.id)
          for (const socketName of sockets) {
            try {
              targets.push(...await listSocketTargets({ adbPath, device, socketName }))
            } catch (error) {
              scanErrors.push(`${device.label} ${socketName}: ${toErrorMessage(error)}`)
            }
          }
        } catch (error) {
          scanErrors.push(`${device.label}: ${toErrorMessage(error)}`)
        }
      }
    }
  }

  if (config.discoverNetworkTargets) {
    for (const targetConfig of config.networkTargets.filter(target => target.enabled !== false)) {
      try {
        targets.push(...await listNetworkTargets(targetConfig))
      } catch (error) {
        scanErrors.push(`${targetConfig.address}: ${toErrorMessage(error)}`)
      }
    }
  }

  return {
    adbPath,
    devices,
    errors: [...adbErrors, ...scanErrors],
    portForwarding,
    scannedAt: Date.now(),
    targets
  }
}

export const startMobileDeviceVideoStream = async (
  webContents: WebContents,
  deviceId: unknown
): Promise<MobileDeviceVideoStreamStartResponse> => {
  const { adbPath, device } = await resolveReadyAdbDevice(deviceId)
  const scrcpyServerPath = resolveScrcpyServerPath()
  await runCommand(adbPath, ['start-server'], ADB_TIMEOUT_MS)

  const adbServerClient = new AdbServerClient(new AdbServerNodeTcpConnector(resolveAdbServerTcpSpec()))
  const adb = await adbServerClient.createAdb({ serial: device.id })
  const streamId = `scrcpy:${device.id}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
  let client: Awaited<ReturnType<typeof AdbScrcpyClient.start>> | undefined

  try {
    const serverBuffer = await fs.promises.readFile(scrcpyServerPath)
    await AdbScrcpyClient.pushServer(adb, createBufferReadableStream(serverBuffer), SCRCPY_SERVER_REMOTE_PATH)

    const options = new AdbScrcpyOptions3_3_3({
      audio: false,
      cleanup: false,
      clipboardAutosync: false,
      control: true,
      logLevel: 'info',
      maxFps: SCRCPY_MAX_FPS,
      maxSize: SCRCPY_MAX_SIZE,
      powerOn: true,
      scid: ScrcpyInstanceId.random(),
      sendFrameMeta: true,
      stayAwake: true,
      tunnelForward: true,
      video: true,
      videoBitRate: SCRCPY_VIDEO_BIT_RATE,
      videoCodec: 'h264'
    }, { version: SCRCPY_SERVER_VERSION })
    client = await AdbScrcpyClient.start(adb, SCRCPY_SERVER_REMOTE_PATH, options)
    const videoStream = await client.videoStream
    if (videoStream == null) {
      throw new Error('scrcpy video stream is disabled.')
    }
    const videoHeight = videoStream.height || videoStream.metadata.height
    const videoWidth = videoStream.width || videoStream.metadata.width

    const handleDestroyed = () => {
      const session = mobileDeviceVideoStreamById.get(streamId)
      if (session == null) return
      void closeMobileDeviceVideoStreamSession(session, undefined, 'closed')
    }
    webContents.once('destroyed', handleDestroyed)
    const session: MobileDeviceVideoStreamSession = {
      adb,
      client,
      controller: client.controller,
      deviceId: device.id,
      isClosed: false,
      ownerWebContentsId: webContents.id,
      removeDestroyedListener: () => webContents.off('destroyed', handleDestroyed),
      streamId,
      videoHeight,
      videoWidth
    }
    mobileDeviceVideoStreamById.set(streamId, session)
    void consumeScrcpyOutput(client.output)
    void pumpMobileDeviceVideoStream(webContents, session, videoStream)

    const codec = videoStream.metadata.codec
    return {
      codec,
      codecName: getScrcpyVideoCodecName(codec),
      deviceId: device.id,
      height: videoHeight,
      source: 'scrcpy',
      startedAt: Date.now(),
      streamId,
      width: videoWidth
    }
  } catch (error) {
    await Promise.allSettled([
      client?.close(),
      adb.close()
    ])
    throw error
  }
}

export const stopMobileDeviceVideoStream = async (
  webContents: WebContents,
  streamId: unknown
): Promise<{ stoppedAt: number; streamId: string }> => {
  if (typeof streamId !== 'string' || streamId.trim() === '') {
    throw new TypeError('A mobile video stream id is required.')
  }

  const session = mobileDeviceVideoStreamById.get(streamId)
  if (session != null) {
    if (session.ownerWebContentsId !== webContents.id) {
      throw new Error('Mobile video stream is owned by another window.')
    }
    await closeMobileDeviceVideoStreamSession(session, webContents, 'closed')
  }
  return { stoppedAt: Date.now(), streamId }
}

export const captureMobileDeviceScreenshot = async (deviceId: unknown): Promise<MobileDeviceScreenshotResponse> => {
  const { adbPath, device } = await resolveReadyAdbDevice(deviceId)
  const currentTask = deviceScreenshotTaskById.get(device.id)
  if (currentTask != null) return await currentTask

  const nextTask = (async () => {
    const result = await runCommandBuffer(
      adbPath,
      ['-s', device.id, 'exec-out', 'screencap', '-p'],
      ADB_SCREENSHOT_TIMEOUT_MS
    )
    const size = readPngSize(result.stdout)
    return {
      capturedAt: Date.now(),
      deviceId: device.id,
      imageDataUrl: `data:image/png;base64,${result.stdout.toString('base64')}`,
      ...(size == null ? {} : size)
    }
  })()
  deviceScreenshotTaskById.set(device.id, nextTask)
  try {
    return await nextTask
  } finally {
    if (deviceScreenshotTaskById.get(device.id) === nextTask) {
      deviceScreenshotTaskById.delete(device.id)
    }
  }
}

export const sendMobileDeviceInput = async (
  webContents: WebContents | undefined,
  deviceId: unknown,
  input: unknown
): Promise<{ deviceId: string; sentAt: number }> => {
  const { adbPath, device } = await resolveReadyAdbDevice(deviceId)
  const inputEvent = toInputEventRecord(input)

  if (await trySendScrcpyMobileDeviceInput(webContents, device.id, inputEvent)) {
    return { deviceId: device.id, sentAt: Date.now() }
  }

  if (inputEvent.kind === 'touch') {
    await sendAdbTouchInput(adbPath, device.id, inputEvent)
  } else if (inputEvent.kind === 'tap') {
    const x = getAdbInputCoordinate(inputEvent, 'x')
    const y = getAdbInputCoordinate(inputEvent, 'y')
    if (x == null || y == null) throw new Error('Tap input requires x and y.')
    await runCommand(adbPath, ['-s', device.id, 'shell', 'input', 'tap', String(x), String(y)], ADB_INPUT_TIMEOUT_MS)
  } else if (inputEvent.kind === 'swipe') {
    const x = getAdbInputCoordinate(inputEvent, 'x')
    const y = getAdbInputCoordinate(inputEvent, 'y')
    const endX = getAdbInputCoordinate(inputEvent, 'endX')
    const endY = getAdbInputCoordinate(inputEvent, 'endY')
    if (x == null || y == null || endX == null || endY == null) {
      throw new Error('Swipe input requires x, y, endX and endY.')
    }
    await runCommand(adbPath, [
      '-s',
      device.id,
      'shell',
      'input',
      'swipe',
      String(x),
      String(y),
      String(endX),
      String(endY),
      String(normalizeDurationMs(inputEvent.durationMs, 220))
    ], ADB_INPUT_TIMEOUT_MS)
  } else if (inputEvent.kind === 'text') {
    const text = inputEvent.text?.trim()
    if (text == null || text === '') throw new Error('Text input requires text.')
    await runCommand(
      adbPath,
      ['-s', device.id, 'shell', 'input', 'text', encodeAndroidInputText(text)],
      ADB_INPUT_TIMEOUT_MS
    )
  } else if (inputEvent.kind === 'scroll') {
    const x = getAdbInputCoordinate(inputEvent, 'x')
    const y = getAdbInputCoordinate(inputEvent, 'y')
    if (x == null || y == null) throw new Error('Scroll input requires x and y.')
    const distance = Math.max(160, Math.min(720, Math.round(Math.abs(inputEvent.scrollY ?? 0) * 520)))
    const direction = (inputEvent.scrollY ?? 0) >= 0 ? -1 : 1
    await runCommand(adbPath, [
      '-s',
      device.id,
      'shell',
      'input',
      'swipe',
      String(x),
      String(y),
      String(x),
      String(Math.max(0, y + direction * distance)),
      '180'
    ], ADB_INPUT_TIMEOUT_MS)
  } else if (inputEvent.kind === 'action') {
    throw new Error('This mobile input action requires a scrcpy control stream.')
  } else {
    await runCommand(
      adbPath,
      ['-s', device.id, 'shell', 'input', 'keyevent', getInputKeyCode(inputEvent.key)],
      ADB_INPUT_TIMEOUT_MS
    )
  }

  return { deviceId: device.id, sentAt: Date.now() }
}

export const dumpMobileElementTree = async (deviceId: unknown): Promise<MobileElementTreeResponse> => {
  const { adbPath, device } = await resolveReadyAdbDevice(deviceId)
  return await runQueuedElementTreeTask(device.id, async () => {
    const remotePath = `/sdcard/oneworks-window-${Date.now().toString(36)}.xml`
    await runCommand(
      adbPath,
      ['-s', device.id, 'shell', 'uiautomator', 'dump', '--compressed', remotePath],
      ADB_UIAUTOMATOR_DUMP_TIMEOUT_MS
    )
    const result = await runCommand(
      adbPath,
      ['-s', device.id, 'exec-out', 'cat', remotePath],
      ADB_UIAUTOMATOR_READ_TIMEOUT_MS
    )
    void runCommand(adbPath, ['-s', device.id, 'shell', 'rm', '-f', remotePath], ADB_INPUT_TIMEOUT_MS)
      .catch(() => undefined)
    const root = parseUiautomatorXml(result.stdout)
    return {
      capturedAt: Date.now(),
      deviceId: device.id,
      nodeCount: countElementNodes(root),
      root,
      source: 'uiautomator'
    }
  })
}
