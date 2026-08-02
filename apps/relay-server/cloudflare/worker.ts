/* eslint-disable max-lines -- the Worker entry keeps its environment mapping and Durable Object lifecycle together. */
import { parseRelayServerArgs } from '../src/config.js'
import type { RelayConfigEnv } from '../src/config.js'
import { deviceTokenMatches, hashDeviceToken } from '../src/devices/private-metadata.js'
import { devicePrincipalForDevice, hasRelayPermission, relayPermissions } from '../src/permissions/index.js'
import { createRelayFetchHandler } from '../src/platform/fetch-handler.js'
import { applyDeviceHeartbeat } from '../src/routes/devices.js'
import { createDurableObjectRelayStoreRepository } from '../src/storage/durable-object.js'
import type { RelayDurableObjectStorage } from '../src/storage/durable-object.js'
import type { RelayStoreRepository } from '../src/storage/repository.js'
import { createRelayTelemetry } from '../src/telemetry/metrics.js'
import type { RelayStore } from '../src/types.js'

interface RelayWebSocket {
  close: (code?: number, reason?: string) => void
  deserializeAttachment: () => unknown
  send: (message: string) => void
  serializeAttachment: (value: unknown) => void
}
interface RelayDurableObjectState {
  storage: RelayDurableObjectStorage
  acceptWebSocket: (socket: RelayWebSocket, tags?: string[]) => void
  getWebSockets: (tag?: string) => RelayWebSocket[]
}
interface RelayWebSocketPair {
  0: RelayWebSocket
  1: RelayWebSocket
}
interface RelayCloudflarePlatform {
  createUpgradeResponse?: (client: RelayWebSocket) => Response
  createWebSocketPair?: () => RelayWebSocketPair
}
interface RelayDurableObjectNamespace {
  get: (id: unknown) => { fetch: (request: Request) => Promise<Response> }
  idFromName: (name: string) => unknown
}

interface RelayCloudflareEnv {
  ONEWORKS_RELAY_ADMIN_TOKEN?: string
  ONEWORKS_RELAY_ALLOW_ORIGIN?: string
  ONEWORKS_RELAY_AVATAR_URL?: string
  ONEWORKS_RELAY_BUILD_SHA?: string
  ONEWORKS_RELAY_DEVICE_METADATA_SECRET?: string
  ONEWORKS_RELAY_DEVICE_API_URL?: string
  ONEWORKS_RELAY_DEVICE_CONTROL_WS_URL?: string
  ONEWORKS_RELAY_DEVICE_ONLINE_TTL_SECONDS?: string
  ONEWORKS_RELAY_EMAIL_CODE_TTL_SECONDS?: string
  ONEWORKS_RELAY_EMAIL_DISPOSABLE_BLOCKLIST_ENABLED?: string
  ONEWORKS_RELAY_EMAIL_DOMAIN_ALLOWLIST?: string
  ONEWORKS_RELAY_EMAIL_DOMAIN_BLOCKLIST?: string
  ONEWORKS_RELAY_EMAIL_FROM?: string
  ONEWORKS_RELAY_EMAIL_PROVIDER?: string
  ONEWORKS_RELAY_EMAIL_RESEND_COOLDOWN_SECONDS?: string
  ONEWORKS_RELAY_EMAIL_RISK_DAILY_BUDGET?: string
  ONEWORKS_RELAY_EMAIL_RISK_DOMAIN_MAX?: string
  ONEWORKS_RELAY_EMAIL_RISK_DOMAIN_WINDOW_SECONDS?: string
  ONEWORKS_RELAY_EMAIL_RISK_EMAIL_MAX?: string
  ONEWORKS_RELAY_EMAIL_RISK_EMAIL_WINDOW_SECONDS?: string
  ONEWORKS_RELAY_EMAIL_RISK_ENABLED?: string
  ONEWORKS_RELAY_EMAIL_RISK_IP_MAX?: string
  ONEWORKS_RELAY_EMAIL_RISK_IP_WINDOW_SECONDS?: string
  ONEWORKS_RELAY_EMAIL_RISK_MONTHLY_BUDGET?: string
  ONEWORKS_RELAY_EMAIL_TURNSTILE_MODE?: string
  ONEWORKS_RELAY_GITHUB_CLIENT_ID?: string
  ONEWORKS_RELAY_GITHUB_CLIENT_SECRET?: string
  ONEWORKS_RELAY_GOOGLE_CLIENT_ID?: string
  ONEWORKS_RELAY_GOOGLE_CLIENT_SECRET?: string
  ONEWORKS_RELAY_INSTANCE_ID?: string
  ONEWORKS_RELAY_LOGIN_REDIRECT_ORIGINS?: string
  ONEWORKS_RELAY_PUBLIC_URL?: string
  ONEWORKS_RELAY_RESEND_API_KEY?: string
  ONEWORKS_RELAY_SESSION_TTL_SECONDS?: string
  ONEWORKS_RELAY_SSO_PROVIDERS?: string
  ONEWORKS_RELAY_TURNSTILE_SECRET_KEY?: string
  ONEWORKS_RELAY_TURNSTILE_VERIFY_URL?: string
  RELAY_OBJECT: RelayDurableObjectNamespace
}

const envRecord = (env: RelayCloudflareEnv): RelayConfigEnv => ({
  ONEWORKS_RELAY_ADMIN_TOKEN: env.ONEWORKS_RELAY_ADMIN_TOKEN,
  ONEWORKS_RELAY_ALLOW_ORIGIN: env.ONEWORKS_RELAY_ALLOW_ORIGIN,
  ONEWORKS_RELAY_AVATAR_URL: env.ONEWORKS_RELAY_AVATAR_URL,
  ONEWORKS_RELAY_BUILD_SHA: env.ONEWORKS_RELAY_BUILD_SHA,
  ONEWORKS_RELAY_DEVICE_METADATA_SECRET: env.ONEWORKS_RELAY_DEVICE_METADATA_SECRET,
  ONEWORKS_RELAY_DEVICE_API_URL: env.ONEWORKS_RELAY_DEVICE_API_URL,
  ONEWORKS_RELAY_DEVICE_CONTROL_WS_URL: env.ONEWORKS_RELAY_DEVICE_CONTROL_WS_URL,
  ONEWORKS_RELAY_DEVICE_ONLINE_TTL_SECONDS: env.ONEWORKS_RELAY_DEVICE_ONLINE_TTL_SECONDS,
  ONEWORKS_RELAY_EMAIL_CODE_TTL_SECONDS: env.ONEWORKS_RELAY_EMAIL_CODE_TTL_SECONDS,
  ONEWORKS_RELAY_EMAIL_DISPOSABLE_BLOCKLIST_ENABLED: env.ONEWORKS_RELAY_EMAIL_DISPOSABLE_BLOCKLIST_ENABLED,
  ONEWORKS_RELAY_EMAIL_DOMAIN_ALLOWLIST: env.ONEWORKS_RELAY_EMAIL_DOMAIN_ALLOWLIST,
  ONEWORKS_RELAY_EMAIL_DOMAIN_BLOCKLIST: env.ONEWORKS_RELAY_EMAIL_DOMAIN_BLOCKLIST,
  ONEWORKS_RELAY_EMAIL_FROM: env.ONEWORKS_RELAY_EMAIL_FROM,
  ONEWORKS_RELAY_EMAIL_PROVIDER: env.ONEWORKS_RELAY_EMAIL_PROVIDER,
  ONEWORKS_RELAY_EMAIL_RESEND_COOLDOWN_SECONDS: env.ONEWORKS_RELAY_EMAIL_RESEND_COOLDOWN_SECONDS,
  ONEWORKS_RELAY_EMAIL_RISK_DAILY_BUDGET: env.ONEWORKS_RELAY_EMAIL_RISK_DAILY_BUDGET,
  ONEWORKS_RELAY_EMAIL_RISK_DOMAIN_MAX: env.ONEWORKS_RELAY_EMAIL_RISK_DOMAIN_MAX,
  ONEWORKS_RELAY_EMAIL_RISK_DOMAIN_WINDOW_SECONDS: env.ONEWORKS_RELAY_EMAIL_RISK_DOMAIN_WINDOW_SECONDS,
  ONEWORKS_RELAY_EMAIL_RISK_EMAIL_MAX: env.ONEWORKS_RELAY_EMAIL_RISK_EMAIL_MAX,
  ONEWORKS_RELAY_EMAIL_RISK_EMAIL_WINDOW_SECONDS: env.ONEWORKS_RELAY_EMAIL_RISK_EMAIL_WINDOW_SECONDS,
  ONEWORKS_RELAY_EMAIL_RISK_ENABLED: env.ONEWORKS_RELAY_EMAIL_RISK_ENABLED,
  ONEWORKS_RELAY_EMAIL_RISK_IP_MAX: env.ONEWORKS_RELAY_EMAIL_RISK_IP_MAX,
  ONEWORKS_RELAY_EMAIL_RISK_IP_WINDOW_SECONDS: env.ONEWORKS_RELAY_EMAIL_RISK_IP_WINDOW_SECONDS,
  ONEWORKS_RELAY_EMAIL_RISK_MONTHLY_BUDGET: env.ONEWORKS_RELAY_EMAIL_RISK_MONTHLY_BUDGET,
  ONEWORKS_RELAY_EMAIL_TURNSTILE_MODE: env.ONEWORKS_RELAY_EMAIL_TURNSTILE_MODE,
  ONEWORKS_RELAY_GITHUB_CLIENT_ID: env.ONEWORKS_RELAY_GITHUB_CLIENT_ID,
  ONEWORKS_RELAY_GITHUB_CLIENT_SECRET: env.ONEWORKS_RELAY_GITHUB_CLIENT_SECRET,
  ONEWORKS_RELAY_GOOGLE_CLIENT_ID: env.ONEWORKS_RELAY_GOOGLE_CLIENT_ID,
  ONEWORKS_RELAY_GOOGLE_CLIENT_SECRET: env.ONEWORKS_RELAY_GOOGLE_CLIENT_SECRET,
  ONEWORKS_RELAY_LOGIN_REDIRECT_ORIGINS: env.ONEWORKS_RELAY_LOGIN_REDIRECT_ORIGINS,
  ONEWORKS_RELAY_PUBLIC_URL: env.ONEWORKS_RELAY_PUBLIC_URL,
  ONEWORKS_RELAY_RESEND_API_KEY: env.ONEWORKS_RELAY_RESEND_API_KEY,
  ONEWORKS_RELAY_SESSION_TTL_SECONDS: env.ONEWORKS_RELAY_SESSION_TTL_SECONDS,
  ONEWORKS_RELAY_SSO_PROVIDERS: env.ONEWORKS_RELAY_SSO_PROVIDERS,
  ONEWORKS_RELAY_TURNSTILE_SECRET_KEY: env.ONEWORKS_RELAY_TURNSTILE_SECRET_KEY,
  ONEWORKS_RELAY_TURNSTILE_VERIFY_URL: env.ONEWORKS_RELAY_TURNSTILE_VERIFY_URL
})

const argsFromEnv = (env: RelayCloudflareEnv) => ({
  ...parseRelayServerArgs([], envRecord(env)),
  dataPath: 'cloudflare-durable-object',
  embeddedAdminUi: false,
  host: '0.0.0.0',
  port: 0,
  storageDriver: 'cloudflare-do' as const
})

export class RelayDurableObject {
  private readonly handler: (request: Request) => Promise<Response>
  private readonly repository
  private readonly args
  private readonly state: RelayDurableObjectState
  private readonly telemetry = createRelayTelemetry()
  private readonly platform: Required<RelayCloudflarePlatform>

  constructor(state: RelayDurableObjectState, env: RelayCloudflareEnv, platform: RelayCloudflarePlatform = {}) {
    this.state = state
    this.args = argsFromEnv(env)
    this.repository = createDurableObjectRelayStoreRepository(state.storage)
    this.platform = {
      createUpgradeResponse: platform.createUpgradeResponse ?? (client => (
        new Response(null, { status: 101, webSocket: client } as ResponseInit)
      )),
      createWebSocketPair: platform.createWebSocketPair ?? (() => {
        const Pair = (globalThis as typeof globalThis & {
          WebSocketPair: new() => RelayWebSocketPair
        }).WebSocketPair
        return new Pair()
      })
    }
    this.handler = createRelayFetchHandler(this.args, {
      storeRepository: this.repository,
      telemetry: this.telemetry,
      onForwardingJobAvailable: deviceId => this.notifyForwardingJobAvailable(deviceId)
    })
  }

  private notifyForwardingJobAvailable(deviceId: string) {
    for (const socket of this.state.getWebSockets(deviceId)) {
      try {
        socket.send(JSON.stringify({ type: 'jobs-available' }))
      } catch {
        socket.close(1011, 'notification failed')
      }
    }
  }

  async fetch(request: Request) {
    const url = new URL(request.url)
    if (
      request.method === 'GET' &&
      url.pathname === '/api/relay/devices/control' &&
      url.search === '' &&
      request.headers.get('upgrade')?.toLowerCase() === 'websocket'
    ) {
      const token = request.headers.get('authorization')?.replace(/^Bearer\s+/iu, '') ?? ''
      const deviceId = request.headers.get('x-oneworks-relay-device-id')?.trim() ?? ''
      const store = await this.repository.read()
      const device = store.devices.find(item => item.id === deviceId && deviceTokenMatches(item, token))
      const principal = device == null ? undefined : devicePrincipalForDevice(device)
      if (
        device == null ||
        principal == null ||
        !hasRelayPermission(principal, relayPermissions.relayDevicesHeartbeat) ||
        !hasRelayPermission(principal, relayPermissions.relayJobsRead)
      ) {
        return new Response('Unauthorized', { status: 401 })
      }
      const pair = this.platform.createWebSocketPair()
      const client = pair[0]
      const server = pair[1]
      this.state.acceptWebSocket(server, [deviceId])
      server.serializeAttachment({
        version: 1,
        deviceId,
        deviceTokenHash: hashDeviceToken(token),
        ...(request.headers.get('cf-connecting-ip') == null
          ? {}
          : { connectionIp: request.headers.get('cf-connecting-ip') })
      })
      return this.platform.createUpgradeResponse(client)
    }
    return await this.handler(request)
  }

  async webSocketMessage(socket: RelayWebSocket, message: string | ArrayBuffer) {
    let rawAttachment: unknown
    try {
      rawAttachment = socket.deserializeAttachment()
    } catch {
      socket.close(1008, 'invalid attachment')
      return
    }
    if (rawAttachment == null || typeof rawAttachment !== 'object') {
      socket.close(1008, 'invalid attachment')
      return
    }
    const attachment = rawAttachment as {
      connectionIp?: unknown
      deviceId?: unknown
      deviceTokenHash?: unknown
      version?: unknown
    }
    if (
      attachment.version !== 1 ||
      typeof attachment.deviceId !== 'string' ||
      typeof attachment.deviceTokenHash !== 'string'
    ) {
      socket.close(1008, 'invalid attachment')
      return
    }
    let frame: unknown
    try {
      frame = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message))
    } catch {
      socket.close(1003, 'invalid frame')
      return
    }
    if (frame == null || typeof frame !== 'object' || (frame as { type?: unknown }).type !== 'heartbeat') {
      socket.close(1003, 'unsupported frame')
      return
    }
    const applyHeartbeat = async (store: RelayStore, storeRepository: RelayStoreRepository) => {
      const device = store.devices.find(item => (
        item.id === attachment.deviceId && (
          item.deviceTokenHash === attachment.deviceTokenHash ||
          (item.deviceToken != null && hashDeviceToken(item.deviceToken) === attachment.deviceTokenHash)
        )
      ))
      const principal = device == null ? undefined : devicePrincipalForDevice(device)
      if (
        device == null ||
        principal == null ||
        !hasRelayPermission(principal, relayPermissions.relayDevicesHeartbeat) ||
        !hasRelayPermission(principal, relayPermissions.relayJobsRead)
      ) {
        socket.close(1008, 'device token revoked')
        return
      }
      if (device.deviceTokenHash == null && device.deviceToken != null) {
        device.deviceTokenHash = attachment.deviceTokenHash
        delete device.deviceToken
      }
      await applyDeviceHeartbeat({
        args: this.args,
        body: (frame as { payload?: unknown }).payload ?? {},
        connectionIp: typeof attachment.connectionIp === 'string' ? attachment.connectionIp : undefined,
        device,
        store,
        storeRepository,
        telemetry: this.telemetry
      })
    }
    if (this.repository.withStore != null) {
      await this.repository.withStore(applyHeartbeat)
    } else {
      await applyHeartbeat(await this.repository.read(), this.repository)
    }
  }

  webSocketClose(_socket: RelayWebSocket, _code: number, _reason: string, _wasClean: boolean) {}

  webSocketError(socket: RelayWebSocket, _error: unknown) {
    socket.close(1011, 'socket error')
  }
}

export default {
  async fetch(request: Request, env: RelayCloudflareEnv) {
    const id = env.RELAY_OBJECT.idFromName(env.ONEWORKS_RELAY_INSTANCE_ID ?? 'main')
    return await env.RELAY_OBJECT.get(id).fetch(request)
  }
}
