/* eslint-disable max-lines -- Android CDP discovery needs adb, socket forwarding, and target normalization together. */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import type { Duplex } from 'node:stream'

const ADB_TIMEOUT_MS = 10000
const FETCH_TIMEOUT_MS = 5000

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

interface CommandResult {
  stderr: string
  stdout: string
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
    const result = await runCommand(adbPath, ['-s', deviceId, 'shell', 'cat', `/proc/${processId}/cmdline`])
    return result.stdout.split('\0')[0]?.trim() || undefined
  } catch {
    return undefined
  }
}

const listDevtoolsSockets = async (adbPath: string, deviceId: string) => {
  const result = await runCommand(adbPath, ['-s', deviceId, 'shell', 'cat', '/proc/net/unix'])
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
    await runCommand(adbPath, ['-s', device.id, 'forward', `tcp:${localPort}`, `localabstract:${socketName}`])
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
    await runCommand(adbPath, ['-s', deviceId, 'reverse', '--remove', `tcp:${devicePort}`])
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
          await runCommand(adbPath, ['-s', device.id, 'reverse', `tcp:${rule.devicePort}`, `tcp:${proxy.localPort}`])
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
