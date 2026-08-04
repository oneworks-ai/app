/* eslint-disable max-lines -- the Worker entry keeps its environment mapping and Durable Object lifecycle together. */
import { normalizeRelayDeviceTransport } from '@oneworks/types/relay-device-transport'

import { parseRelayServerArgs } from '../src/config.js'
import type { RelayConfigEnv } from '../src/config.js'
import { applyRelayControlHeartbeatFrame, createRelayControlAttachment } from '../src/platform/control-heartbeat.js'
import { createRelayFetchHandler } from '../src/platform/fetch-handler.js'
import { createDurableObjectRelayStoreRepository } from '../src/storage/durable-object.js'
import type { RelayDurableObjectStorage } from '../src/storage/durable-object.js'
import { createRelayTelemetry } from '../src/telemetry/metrics.js'

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
  ONEWORKS_RELAY_DEVICE_CONTROL_HEARTBEAT_SECONDS?: string
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

const readCloudflareHeartbeatIntervalMs = (value: string | undefined) => {
  if (value == null || value.trim() === '') return 30_000
  const seconds = Number(value)
  return Number.isFinite(seconds) && Number.isSafeInteger(seconds) && seconds > 0 ? seconds * 1_000 : undefined
}

const createCloudflareDeviceTransport = (env: RelayCloudflareEnv) => {
  const heartbeatIntervalMs = readCloudflareHeartbeatIntervalMs(env.ONEWORKS_RELAY_DEVICE_CONTROL_HEARTBEAT_SECONDS)
  if (heartbeatIntervalMs == null) return undefined
  return normalizeRelayDeviceTransport({
    apiBaseUrl: env.ONEWORKS_RELAY_DEVICE_API_URL,
    controlWebSocketUrl: env.ONEWORKS_RELAY_DEVICE_CONTROL_WS_URL,
    heartbeatIntervalMs,
    version: 1
  })
}

export const createCloudflareRelayArgs = (env: RelayCloudflareEnv) => {
  const parsed = parseRelayServerArgs([], envRecord(env))
  const websocket = createCloudflareDeviceTransport(env)
  if (websocket == null) {
    throw new Error(
      'Cloudflare Relay requires valid ONEWORKS_RELAY_DEVICE_API_URL and ONEWORKS_RELAY_DEVICE_CONTROL_WS_URL.'
    )
  }
  return {
    ...parsed,
    // Durable Object WebSockets use a low-write cadence.  Only an absent override gets the
    // longer window; an explicit invalid value must retain config parsing's safe fallback.
    deviceOnlineTtlMs: env.ONEWORKS_RELAY_DEVICE_ONLINE_TTL_SECONDS == null
      ? 900_000
      : parsed.deviceOnlineTtlMs,
    deviceTransport: websocket,
    dataPath: 'cloudflare-durable-object',
    embeddedAdminUi: false,
    host: '0.0.0.0',
    port: 0,
    storageDriver: 'cloudflare-do' as const
  }
}

export class RelayDurableObject {
  private readonly handler: (request: Request) => Promise<Response>
  private readonly repository
  private readonly args
  private readonly state: RelayDurableObjectState
  private readonly telemetry = createRelayTelemetry()
  private readonly platform: Required<RelayCloudflarePlatform>

  constructor(state: RelayDurableObjectState, env: RelayCloudflareEnv, platform: RelayCloudflarePlatform = {}) {
    this.state = state
    this.args = createCloudflareRelayArgs(env)
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
      const attachment = createRelayControlAttachment(store, {
        ...(request.headers.get('cf-connecting-ip') == null
          ? {}
          : { connectionIp: request.headers.get('cf-connecting-ip') ?? undefined }),
        deviceId,
        deviceToken: token
      })
      if (attachment == null) {
        return new Response('Unauthorized', { status: 401 })
      }
      const pair = this.platform.createWebSocketPair()
      const client = pair[0]
      const server = pair[1]
      this.state.acceptWebSocket(server, [deviceId])
      server.serializeAttachment(attachment)
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
    const attachmentDeviceId = attachment.deviceId
    const attachmentDeviceTokenHash = attachment.deviceTokenHash
    const result = await applyRelayControlHeartbeatFrame({
      args: this.args,
      attachment: {
        version: 1,
        deviceId: attachmentDeviceId,
        deviceTokenHash: attachmentDeviceTokenHash,
        ...(typeof attachment.connectionIp === 'string' ? { connectionIp: attachment.connectionIp } : {})
      },
      frame: message,
      repository: this.repository,
      telemetry: this.telemetry
    })
    if (result === 'frame-too-large') socket.close(1009, 'frame too large')
    if (result === 'invalid-frame') socket.close(1003, 'invalid frame')
    if (result === 'revoked') socket.close(1008, 'device token revoked')
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
