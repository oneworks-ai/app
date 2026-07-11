import { Buffer } from 'node:buffer'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { arch, platform, release, type as osType } from 'node:os'
import { basename } from 'node:path'
import process from 'node:process'
import type { Duplex } from 'node:stream'

import {
  createAccountKey,
  readOneWorksAuthStore as readOneWorksAuthStoreFile,
  upsertOneWorksAuthAccount,
  upsertOneWorksAuthServer,
  writeOneWorksAuthStore as writeOneWorksAuthStoreFile
} from '@oneworks/utils/auth-store'
import type { OneWorksAuthAccount, OneWorksAuthServer, OneWorksAuthStore } from '@oneworks/utils/auth-store'
import { WebSocket, WebSocketServer } from 'ws'
import type { RawData } from 'ws'

import type { RelayConfigSnapshot } from '../shared/config-assignment.js'
import { readRelayConfigSnapshotWithGlobalFallback } from '../shared/config-cache.js'
import {
  LOCAL_RELAY_SERVER_ID,
  OFFICIAL_RELAY_CLOUDFLARE_SERVER_ID,
  OFFICIAL_RELAY_VERCEL_SERVER_ID
} from '../shared/official-services.js'
import {
  getRelayConfigShareProfileDetail,
  getRelayConfigShareTargets,
  publishRelayConfigShareDraft,
  updateRelayConfigShareAssignment
} from './config-share.js'
import {
  filterRelayConfigSnapshotByPreferences,
  readRelayConfigSourceKind,
  readRelayConfigSourcePreferences,
  readRelayConfigSourcePreferencesForSnapshot,
  relayConfigSourceDisabledByPreferences,
  serializeRelayConfigSourcePreferences,
  updateRelayConfigSourcePreference
} from './config-source-preferences.js'
import { syncRelayConfigSnapshot } from './config-sync.js'
import type { RelayConfigSyncResult } from './config-sync.js'
import { startHeartbeat } from './heartbeat.js'
import { createRelayLoopLeaseManager } from './loop-lease.js'
import type { RelayLoopLease } from './loop-lease.js'
import { normalizeOptions, resolveActiveRelayServer, resolveRelayServers } from './options.js'
import type { ResolvedRelayServer } from './options.js'
import {
  readRelayPersonalDocumentSyncKind,
  readRelayPersonalDocumentSyncPreferences,
  readRelayTeamDocumentSyncPreferences,
  serializeRelayPersonalDocumentSyncPreferences,
  updateRelayPersonalDocumentSyncPreference,
  updateRelayTeamDocumentSyncPreference
} from './personal-document-sync-preferences.js'
import {
  createPersonalDocumentSyncStatus,
  ensureRelayFixtureDocumentEntries,
  listRelayDocumentEntries,
  openRelayDocumentPath,
  readRelayDocumentContent,
  syncRelayPersonalDocuments,
  syncRelayTeamDocuments
} from './personal-document-sync.js'
import type { RelayDocumentScope } from './personal-document-sync.js'
import { createRelaySessionWorker } from './session-worker.js'
import { createRelayDeviceStore, createRelayManagementServerStore, createRelayServiceInfoStore } from './store.js'
import type { RelayManagementServerStore } from './store.js'
import type {
  RelayAccountProfile,
  RelayConfigDistributionStatus,
  RelayConnectionState,
  RelayDeviceEnvironmentInfo,
  RelayPersonalDocumentSyncStatus,
  RelayPluginContext,
  RelayProfileAccessToken,
  RelayProfileAccessTokenScope,
  RelayProfileCurrentUser,
  RelayProfileMessage,
  RelayProfileMessageAudienceScope,
  RelayProfileMessageKind,
  RelayProfileMessageLoginMetadata,
  RelayProfileMessageUser,
  RelayProfileOpenApiAuditEvent,
  RelayProfileSecuritySummary,
  RelayProfileSessionSummary,
  RelayProfileStatus,
  RelayProfileTeam,
  RelayProfileTeamInvitation,
  RelayPublicAuthAccount,
  RelayPublicServerStatus,
  RelayPublicStatus,
  RelayRemoteDeviceManagementServerSummary,
  RelayRemoteDeviceProjectSummary,
  RelayRemoteDeviceSummary,
  RelayStore,
  RelayStoredServer
} from './types.js'
import { isRecord, normalizeRemoteBaseUrl, toString } from './utils.js'
import {
  RELAY_WORKSPACE_HTTP_MODE,
  RELAY_WORKSPACE_WS_CLOSE_MODE,
  RELAY_WORKSPACE_WS_OPEN_MODE,
  RELAY_WORKSPACE_WS_RECEIVE_MODE,
  RELAY_WORKSPACE_WS_SEND_MODE
} from './workspace-forwarding-modes.js'

export interface RelayController {
  connect: (payload?: unknown) => Promise<unknown>
  createLoginUrl: (payload?: unknown) => Promise<unknown>
  getNativeLoginOptions: (payload?: unknown) => Promise<unknown>
  proxyNativeLoginRequest: (payload?: unknown) => Promise<unknown>
  disconnect: (payload?: unknown) => Promise<unknown>
  dispose: () => void
  forget: (payload?: unknown) => Promise<unknown>
  getPublicStatus: () => Promise<RelayPublicStatus>
  getServiceInfo: (payload?: unknown) => Promise<RelayServiceInfo>
  listDocumentEntries: (payload?: unknown) => Promise<unknown>
  openDocumentPath: (payload?: unknown) => Promise<unknown>
  readDocumentContent: (payload?: unknown) => Promise<unknown>
  getConfigShareProfileDetail: (payload?: unknown) => Promise<unknown>
  getConfigShareTargets: (payload?: unknown) => Promise<unknown>
  publishConfigShareDraft: (payload?: unknown) => Promise<unknown>
  updateConfigShareAssignment: (payload?: unknown) => Promise<unknown>
  refreshConfigDistribution: (payload?: unknown) => Promise<RelayPublicStatus>
  importPersonalDocumentRootAgents: (payload?: unknown) => Promise<RelayPublicStatus>
  restoreStoredConnections: () => Promise<string[]>
  setConfigSourceEnabled: (payload?: unknown) => Promise<RelayPublicStatus>
  setPersonalDocumentSyncEnabled: (payload?: unknown) => Promise<RelayPublicStatus>
  setTeamDocumentSyncEnabled: (payload?: unknown) => Promise<RelayPublicStatus>
  completeLogin: (payload?: unknown) => Promise<unknown>
  listUsers: (payload?: unknown) => Promise<unknown>
  deleteLocalUser: (payload?: unknown) => Promise<unknown>
  logoutUser: (payload?: unknown) => Promise<unknown>
  getProfile: (payload?: unknown) => Promise<unknown>
  getWorkspaceProxyConnection: (payload?: unknown) => Promise<unknown>
  listWorkspaceDirectories: (payload?: unknown) => Promise<unknown>
  openWorkspaceProxy: (payload?: unknown) => Promise<unknown>
  createWorkspaceInDirectory: (payload?: unknown) => Promise<unknown>
  changeProfilePassword: (payload?: unknown) => Promise<unknown>
  createProfileAccessToken: (payload?: unknown) => Promise<unknown>
  updateProfileAccessToken: (payload?: unknown) => Promise<unknown>
  updateProfileDeviceAlias: (payload?: unknown) => Promise<unknown>
  revokeProfileAccessToken: (payload?: unknown) => Promise<unknown>
  deleteProfileAccount: (payload?: unknown) => Promise<unknown>
  setUserEnabled: (payload: unknown, enabled: boolean) => Promise<unknown>
  search: (payload?: unknown) => unknown[]
}

const initialState = (): RelayConnectionState => ({
  state: 'idle',
  message: 'Relay plugin loaded.',
  lastConnectedAt: null,
  lastError: null
})

const RELAY_FIXTURE_SESSION_TOKEN_PREFIX = 'relay-fixture:'
const RELAY_DEVICE_LIST_CACHE_TTL_MS = 10_000
const RELAY_SERVICE_INFO_CACHE_TTL_MS = 60_000
const RELAY_SERVICE_INFO_TIMEOUT_MS = 2_500
const RELAY_DEVICE_LIST_ERROR_BASE_INTERVAL_MS = 3_000
const RELAY_DEVICE_LIST_ERROR_MAX_INTERVAL_MS = 30_000
const RELAY_DEVICE_LIST_ERROR_LOG_INTERVAL_MS = 30_000
const fixtureAccessTokensByAccountKey = new Map<string, RelayProfileAccessToken[]>()
const fixtureDeviceAliasesByAccountKey = new Map<string, Map<string, string>>()

const nativeLoginRequestPaths = {
  'email-code-login': '/api/auth/email-code-login',
  'email-verification-send': '/api/auth/email-verification/send',
  'invite-login': '/api/auth/invite-login',
  'password-login': '/api/auth/password-login'
} as const

class RelayNativeLoginProxyError extends Error {
  code?: string
  status: number

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'RelayNativeLoginProxyError'
    this.code = code
    this.status = status
  }
}

interface RelayWorkspaceProxyEntry {
  authToken: string
  baseUrl: string
  deviceId: string
  deviceName?: string
  remoteBaseUrl: string
  server: ReturnType<typeof createServer>
  serverId: string
  serverName?: string
  sourceDeviceId: string
  targetServerBaseUrl: string
  workspaceFolder: string
  workspaceId: string
}

type RelayWorkspaceJobTarget = Pick<
  RelayWorkspaceProxyEntry,
  'authToken' | 'deviceId' | 'remoteBaseUrl' | 'serverId'
>

interface RelayDeviceListCacheEntry {
  devices: RelayRemoteDeviceSummary[]
  error?: string
  failureCount: number
  fetchedAt: number
  inFlight?: Promise<RelayDeviceListResult>
  lastErrorKey?: string
  lastErrorLoggedAt: number
  retryAt: number
}

interface RelayDeviceListResult {
  devices: RelayRemoteDeviceSummary[]
  error?: string
}

interface RelayServiceInfo {
  availabilityError?: string
  avatarUrl?: string
  lastCheckedAt?: string
  lastSuccessfulAt?: string
  name?: string
  online?: boolean
}

interface RelayServiceInfoCacheEntry {
  fetchedAt: number
  inFlight?: Promise<RelayServiceInfo>
  value: RelayServiceInfo
}

interface RelayDeviceListSource {
  authToken?: string
  listToken: string
  sourceKey: string
}

interface RelayMergedDeviceListResult {
  authTokensByDeviceId: Map<string, string>
  devices: RelayRemoteDeviceSummary[]
  error?: string
}

interface RelayWorkspaceOpenResult {
  relay: {
    deviceId: string
    deviceName?: string
    serverId: string
    serverName?: string
    workspaceFolder: string
  }
  serverBaseUrl: string
  workspaceFolder: string
  workspaceId: string
}

class RelayWorkspaceHttpError extends Error {
  code?: string
  details?: unknown
  status: number

  constructor(message: string, input: {
    code?: string
    details?: unknown
    status: number
  }) {
    super(message)
    this.name = 'RelayWorkspaceHttpError'
    this.code = input.code
    this.details = input.details
    this.status = input.status
  }
}

class RelayWorkspaceConnectionError extends Error {
  code: string
  status: number

  constructor(message: string, input: {
    code?: string
    status?: number
  } = {}) {
    super(message)
    this.name = 'RelayWorkspaceConnectionError'
    this.code = input.code ?? 'remote_workspace_connection_failed'
    this.status = input.status ?? 503
  }
}

const WORKSPACE_PROXY_TIMEOUT_MS = 30_000
const WORKSPACE_PROXY_POLL_INTERVAL_MS = 250
const WORKSPACE_PROXY_MAX_POLL_INTERVAL_MS = 1_000
const WORKSPACE_WS_RECEIVE_EMPTY_POLL_MS = 1_000

const sleep = (durationMs: number) => new Promise(resolve => setTimeout(resolve, durationMs))

const describeRelayFetchError = (error: unknown) => (
  error instanceof Error ? `${error.name}:${error.message}` : String(error)
)

const relayFetchErrorMessage = (error: unknown) => (
  error instanceof Error ? error.message : String(error)
)

const relayDeviceListBackoffMs = (failureCount: number) => (
  Math.min(
    RELAY_DEVICE_LIST_ERROR_MAX_INTERVAL_MS,
    RELAY_DEVICE_LIST_ERROR_BASE_INTERVAL_MS * 2 ** Math.min(Math.max(failureCount - 1, 0), 4)
  )
)

const cacheTokenKey = (token: string) => createHash('sha256').update(token).digest('base64url').slice(0, 16)

const workspaceProxyPollInterval = (elapsedMs: number) => {
  if (elapsedMs < 2_000) return WORKSPACE_PROXY_POLL_INTERVAL_MS
  if (elapsedMs < 8_000) return 500
  return WORKSPACE_PROXY_MAX_POLL_INTERVAL_MS
}

const createRemoteWorkspaceId = (input: {
  deviceId: string
  serverId: string
  workspaceFolder: string
}) =>
  `w_${
    createHash('sha256')
      .update(input.serverId)
      .update('\0')
      .update(input.deviceId)
      .update('\0')
      .update(input.workspaceFolder)
      .digest('base64url')
      .slice(0, 32)
  }`

const readIncomingRequestBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

const readProxyCorsOrigin = (source?: IncomingMessage | string) => {
  if (typeof source === 'string') return source
  const origin = source?.headers.origin
  return typeof origin === 'string' && origin.trim() !== '' ? origin : '*'
}

const writeProxyCorsHeaders = (res: ServerResponse, source?: IncomingMessage | string) => {
  const origin = readProxyCorsOrigin(source)
  res.setHeader('access-control-allow-origin', origin)
  if (origin !== '*') {
    res.setHeader('access-control-allow-credentials', 'true')
    res.setHeader('vary', 'Origin')
  }
  res.setHeader('access-control-allow-headers', 'content-type, authorization, x-oneworks-client-origin')
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
}

const sendProxyJson = (res: ServerResponse, status: number, body: unknown, source?: IncomingMessage | string) => {
  writeProxyCorsHeaders(res, source)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(`${JSON.stringify(body)}\n`)
}

const isRelayWorkspaceHttpResponse = (value: unknown): value is {
  bodyBase64?: string
  headers?: Record<string, string>
  status: number
  statusText?: string
} => (
  isRecord(value) &&
  typeof value.status === 'number' &&
  Number.isFinite(value.status)
)

const readResultBody = (body: Record<string, unknown>) => (
  isRecord(body.result) ? body.result : undefined
)

const filterProxyRequestHeaders = (headers: IncomingMessage['headers']) => {
  const result: Record<string, string> = {}
  for (const key of ['accept', 'content-type', 'x-oneworks-client-origin']) {
    const value = headers[key]
    if (typeof value === 'string' && value !== '') result[key] = value
  }
  return result
}

const writeWorkspaceProxyResponse = (
  res: ServerResponse,
  result: ReturnType<typeof readResultBody>,
  source?: IncomingMessage | string
) => {
  if (!isRelayWorkspaceHttpResponse(result)) {
    sendProxyJson(res, 502, { error: 'Invalid workspace response.' }, source)
    return
  }
  writeProxyCorsHeaders(res, source)
  for (const [key, value] of Object.entries(result.headers ?? {})) {
    if (typeof value === 'string' && value !== '') {
      res.setHeader(key, value)
    }
  }
  if (result.statusText == null || result.statusText === '') {
    res.writeHead(result.status)
  } else {
    res.writeHead(result.status, result.statusText)
  }
  res.end(result.bodyBase64 == null ? Buffer.alloc(0) : Buffer.from(result.bodyBase64, 'base64'))
}

type RelayWorkspaceWebSocketEvent =
  | {
    type: 'close'
    code?: number
    reason?: string
  }
  | {
    type: 'error'
    message?: string
  }
  | {
    type: 'message'
    dataBase64?: string
    isBinary?: boolean
  }
  | {
    type: 'open'
  }

const rawWebSocketDataToBuffer = (data: RawData) => {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data)
}

const isRelayWorkspaceWebSocketOpen = (socket: WebSocket) => socket.readyState === WebSocket.OPEN

const readWorkspaceWebSocketEvents = (result: ReturnType<typeof readResultBody>) => {
  const rawEvents = Array.isArray(result?.events) ? result.events : []
  return rawEvents.flatMap((event): RelayWorkspaceWebSocketEvent[] => {
    if (!isRecord(event)) return []
    const type = toString(event.type)
    if (type === 'open') return [{ type }]
    if (type === 'message') {
      const dataBase64 = toString(event.dataBase64)
      return dataBase64 === ''
        ? []
        : [{
          type,
          dataBase64,
          isBinary: event.isBinary === true
        }]
    }
    if (type === 'close') {
      return [{
        type,
        code: typeof event.code === 'number' ? event.code : undefined,
        reason: toString(event.reason)
      }]
    }
    if (type === 'error') {
      return [{
        type,
        message: toString(event.message)
      }]
    }
    return []
  })
}

interface FixtureAccessTokenGrantInput {
  name: string
  permissionGroupIds: string[]
  permissionGroupMode: 'all' | 'custom'
  scope: RelayProfileAccessTokenScope
  teamId?: string
}

const createMissingRemoteState = (state: RelayConnectionState, requestedServerId?: string): RelayConnectionState => ({
  state: 'error',
  message: requestedServerId == null || requestedServerId === ''
    ? 'Configure at least one relay server before connecting.'
    : `Unknown relay server: ${requestedServerId}.`,
  ...(requestedServerId == null || requestedServerId === '' ? {} : { activeServerId: requestedServerId }),
  lastConnectedAt: state.lastConnectedAt,
  lastError: requestedServerId == null || requestedServerId === ''
    ? 'missing_relay_server'
    : 'unknown_relay_server'
})

interface RelayManagementServerRegistration {
  id: string
  kind: string
  name?: string
}

const relayManagementServerKind = () => {
  const configured = toString(process.env.__ONEWORKS_RELAY_MANAGEMENT_SERVER_KIND__).toLowerCase()
  if (configured === 'web' || configured === 'electron' || configured === 'daemon') return configured

  const clientMode = toString(process.env.__ONEWORKS_PROJECT_CLIENT_MODE__).toLowerCase()
  if (clientMode === 'desktop') return 'electron'
  if (clientMode === 'none') return 'daemon'
  return 'web'
}

const relayManagementServerName = (ctx: RelayPluginContext) => {
  const configured = toString(process.env.__ONEWORKS_RELAY_MANAGEMENT_SERVER_NAME__)
  if (configured !== '') return configured

  const workspaceName = basename(ctx.workspaceFolder)
  return workspaceName === '' ? undefined : workspaceName
}

const createRelayDeviceEnvironmentInfo = (): RelayDeviceEnvironmentInfo => ({
  arch: arch(),
  deviceType: 'computer',
  osName: osType(),
  osPlatform: platform(),
  osRelease: release(),
  runtime: 'node',
  runtimeVersion: process.versions.node
})

const resolveRelayManagementServerRegistration = async (
  ctx: RelayPluginContext,
  store: ReturnType<typeof createRelayManagementServerStore>
): Promise<RelayManagementServerRegistration> => {
  const persisted = await store.readStore()
  const kind = relayManagementServerKind()
  const name = relayManagementServerName(ctx)
  const next: RelayManagementServerStore = {
    ...persisted,
    kind,
    ...(name == null ? {} : { name }),
    updatedAt: new Date().toISOString()
  }
  if (persisted.kind !== next.kind || persisted.name !== next.name) {
    await store.writeStore(next)
  }
  return {
    id: persisted.id,
    kind,
    ...(name == null ? {} : { name })
  }
}

const createCurrentWorkspaceProject = (ctx: RelayPluginContext) => {
  const workspaceName = basename(ctx.workspaceFolder) || ctx.workspaceFolder
  return {
    id: `workspace:${createHash('sha256').update(ctx.workspaceFolder).digest('base64url').slice(0, 16)}`,
    name: workspaceName,
    title: workspaceName,
    workspaceFolder: ctx.workspaceFolder
  }
}

const createRegisterBody = (
  ctx: RelayPluginContext,
  managementServer: RelayManagementServerRegistration,
  store: RelayStore,
  options: ReturnType<typeof normalizeOptions>,
  deviceId = store.deviceId
) => {
  const environment = createRelayDeviceEnvironmentInfo()
  return {
    deviceId,
    deviceInfo: environment,
    deviceName: options.deviceName,
    capabilities: options.capabilities,
    managementServerEnvironment: environment,
    managementServerId: managementServer.id,
    managementServerKind: managementServer.kind,
    ...(managementServer.name == null ? {} : { managementServerName: managementServer.name }),
    managementServerProjects: [createCurrentWorkspaceProject(ctx)],
    workspaceFolder: ctx.workspaceFolder,
    pluginScope: ctx.scope
  }
}

const readServerId = (payload?: unknown) => (
  isRecord(payload) ? toString(payload.serverId) || toString(payload.server) : ''
)

const readTextField = (payload: unknown, key: string) => (
  isRecord(payload) ? toString(payload[key]) : ''
)

const readPayloadArgs = (payload: unknown) => (
  isRecord(payload) && Array.isArray(payload.args)
    ? payload.args.map(item => toString(item)).filter(item => item !== '')
    : []
)

const readUserSelector = (payload: unknown) => (
  readTextField(payload, 'accountKey') ||
  readTextField(payload, 'user') ||
  readPayloadArgs(payload)[0] ||
  ''
)

const readOptionalText = (value: unknown) => {
  const text = toString(value)
  return text === '' ? undefined : text
}

const serverAliasForId = (serverId: string) => {
  switch (serverId) {
    case OFFICIAL_RELAY_CLOUDFLARE_SERVER_ID:
      return 'cf'
    case OFFICIAL_RELAY_VERCEL_SERVER_ID:
      return 'vercel'
    case LOCAL_RELAY_SERVER_ID:
      return 'local'
    default:
      return serverId
  }
}

const publicAuthAccount = (account: OneWorksAuthAccount): RelayPublicAuthAccount => ({
  accountKey: account.accountKey,
  avatarUrl: account.avatarUrl,
  email: account.email,
  enabled: account.enabled,
  loginId: account.loginId,
  name: account.name,
  registeredAt: account.registeredAt,
  role: account.role,
  serverAlias: serverAliasForId(account.serverId),
  serverId: account.serverId,
  serverUrl: account.serverUrl,
  sessionAuthenticated: (account.sessionToken ?? '') !== '' &&
    (account.sessionExpiresAt == null || Date.parse(account.sessionExpiresAt) > Date.now()),
  sessionExpiresAt: account.sessionExpiresAt,
  updatedAt: account.updatedAt,
  userId: account.userId
})

const isSessionAuthenticated = (account: Pick<OneWorksAuthAccount, 'sessionExpiresAt' | 'sessionToken'>) => (
  (account.sessionToken ?? '') !== '' &&
  (account.sessionExpiresAt == null || Date.parse(account.sessionExpiresAt) > Date.now())
)

const isRelayFixtureAuthAccount = (account: Pick<OneWorksAuthAccount, 'sessionToken'>) => (
  (account.sessionToken ?? '').startsWith(RELAY_FIXTURE_SESSION_TOKEN_PREFIX)
)

const readNullableText = (value: unknown) => {
  const text = toString(value)
  return text === '' ? null : text
}

const readBoolean = (value: unknown, fallback = false) => typeof value === 'boolean' ? value : fallback

const readNumber = (value: unknown, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  const text = toString(value)
  if (text === '') return fallback
  const parsed = Number(text)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

const normalizeProfileCurrentUser = (value: unknown): RelayProfileCurrentUser | undefined => {
  if (!isRecord(value)) return undefined
  const id = toString(value.id)
  const email = toString(value.email)
  if (id === '' || email === '') return undefined
  const name = toString(value.name) || email
  return {
    avatarUrl: readNullableText(value.avatarUrl),
    disabledAt: readNullableText(value.disabledAt),
    effectiveAccess: isRecord(value.effectiveAccess) ? value.effectiveAccess : undefined,
    email,
    groupIds: readStringList(value.groupIds),
    id,
    loginId: readNullableText(value.loginId),
    name,
    provider: readNullableText(value.provider),
    role: toString(value.role) || 'member'
  }
}

const normalizeProfileAccessTokenScope = (value: unknown): RelayProfileAccessTokenScope => {
  const scope = toString(value)
  return scope === 'user' || scope === 'team' || scope === 'platform' ? scope : 'platform'
}

const normalizeProfileAccessToken = (value: unknown): RelayProfileAccessToken | undefined => {
  if (!isRecord(value)) return undefined
  const id = toString(value.id)
  if (id === '') return undefined
  return {
    createdAt: toString(value.createdAt),
    id,
    lastUsedAt: readNullableText(value.lastUsedAt),
    name: toString(value.name),
    permissionGroupIds: readStringList(value.permissionGroupIds),
    permissionGroupMode: value.permissionGroupMode === 'custom' ? 'custom' : 'all',
    revokedAt: readNullableText(value.revokedAt),
    scope: normalizeProfileAccessTokenScope(value.scope),
    teamId: readNullableText(value.teamId),
    tokenPreview: toString(value.tokenPreview)
  }
}

const emptyProfileSecuritySummary = (user?: RelayProfileCurrentUser): RelayProfileSecuritySummary => ({
  accessTokens: [],
  accountDeletion: {
    available: false
  },
  password: {
    enabled: false
  },
  passkeys: {
    count: user?.provider === 'passkey' ? 1 : 0,
    enabled: true,
    lastUsedAt: null
  },
  twoFactor: {
    available: false,
    enabled: false
  }
})

const fixtureAccessTokensFor = (accountKey: string) => fixtureAccessTokensByAccountKey.get(accountKey) ?? []

const setFixtureAccessTokens = (accountKey: string, tokens: RelayProfileAccessToken[]) => {
  fixtureAccessTokensByAccountKey.set(accountKey, tokens)
}

const createFixtureAccessToken = (
  account: OneWorksAuthAccount,
  input: FixtureAccessTokenGrantInput
) => {
  const now = new Date().toISOString()
  const accessToken = `owrt_fixture_${randomBytes(18).toString('base64url')}`
  const token: RelayProfileAccessToken = {
    createdAt: now,
    id: `fixture-token:${randomUUID()}`,
    lastUsedAt: null,
    name: input.name || 'Fixture Token',
    permissionGroupIds: input.permissionGroupIds,
    permissionGroupMode: input.permissionGroupMode,
    revokedAt: null,
    scope: input.scope,
    teamId: input.scope === 'team' ? input.teamId || `${account.serverId}:team` : null,
    tokenPreview: `${accessToken.slice(0, 18)}...`
  }
  setFixtureAccessTokens(account.accountKey, [...fixtureAccessTokensFor(account.accountKey), token])
  return {
    accessToken,
    token
  }
}

const updateFixtureAccessToken = (
  account: OneWorksAuthAccount,
  tokenId: string,
  input: FixtureAccessTokenGrantInput
) => {
  const tokens = fixtureAccessTokensFor(account.accountKey)
  const token = tokens.find(item => item.id === tokenId)
  if (token == null) throw new Error('Access token not found.')
  const updated: RelayProfileAccessToken = {
    ...token,
    name: input.name || token.name,
    permissionGroupIds: input.permissionGroupIds,
    permissionGroupMode: input.permissionGroupMode,
    scope: input.scope,
    teamId: input.scope === 'team' ? input.teamId || `${account.serverId}:team` : null
  }
  setFixtureAccessTokens(account.accountKey, tokens.map(item => item.id === tokenId ? updated : item))
  return { token: updated }
}

const revokeFixtureAccessToken = (account: OneWorksAuthAccount, tokenId: string) => {
  const tokens = fixtureAccessTokensFor(account.accountKey)
  const token = tokens.find(item => item.id === tokenId)
  if (token == null) throw new Error('Access token not found.')
  const revoked: RelayProfileAccessToken = {
    ...token,
    revokedAt: token.revokedAt ?? new Date().toISOString()
  }
  setFixtureAccessTokens(account.accountKey, tokens.map(item => item.id === tokenId ? revoked : item))
  return { token: revoked }
}

const fixtureProfileUser = (account: OneWorksAuthAccount): RelayProfileCurrentUser => ({
  ...(account.avatarUrl == null ? {} : { avatarUrl: account.avatarUrl }),
  disabledAt: account.enabled === false ? new Date(0).toISOString() : null,
  effectiveAccess: {},
  email: account.email ?? `${account.userId}@relay.fixture`,
  groupIds: [],
  id: account.userId,
  loginId: account.loginId ?? null,
  name: account.name ?? account.loginId ?? account.userId,
  provider: 'fixture',
  role: account.role ?? 'member'
})

const localProfileUserFromAuthAccount = (account: OneWorksAuthAccount): RelayProfileCurrentUser => {
  const id = account.userId || account.accountKey
  const email = account.email ?? account.loginId ?? id
  return {
    ...(account.avatarUrl == null ? {} : { avatarUrl: account.avatarUrl }),
    disabledAt: account.enabled === false ? new Date(0).toISOString() : null,
    effectiveAccess: {},
    email,
    groupIds: [],
    id,
    loginId: account.loginId ?? null,
    name: account.name ?? account.loginId ?? account.email ?? id,
    provider: null,
    role: account.role ?? 'member'
  }
}

const profileSessionFromAuthAccount = (
  account: OneWorksAuthAccount
): RelayProfileSessionSummary | undefined => (
  account.sessionExpiresAt == null ? undefined : { expiresAt: account.sessionExpiresAt }
)

const fixtureProfileMessageUser = (user: RelayProfileCurrentUser): RelayProfileMessageUser => ({
  avatarUrl: user.avatarUrl ?? null,
  email: user.email,
  id: user.id,
  name: user.name,
  provider: user.provider ?? null,
  role: user.role
})

const normalizeProfileSecuritySummary = (
  value: unknown,
  user?: RelayProfileCurrentUser
): RelayProfileSecuritySummary => {
  if (!isRecord(value)) return emptyProfileSecuritySummary(user)
  const passkeys = isRecord(value.passkeys) ? value.passkeys : {}
  const password = isRecord(value.password) ? value.password : {}
  const accountDeletion = isRecord(value.accountDeletion) ? value.accountDeletion : {}
  const twoFactor = isRecord(value.twoFactor) ? value.twoFactor : {}
  return {
    accessTokens: Array.isArray(value.accessTokens)
      ? value.accessTokens
        .map(normalizeProfileAccessToken)
        .filter((token): token is RelayProfileAccessToken => token != null)
      : [],
    accountDeletion: {
      available: readBoolean(accountDeletion.available)
    },
    password: {
      enabled: readBoolean(password.enabled)
    },
    passkeys: {
      count: readNumber(passkeys.count, user?.provider === 'passkey' ? 1 : 0),
      enabled: readBoolean(passkeys.enabled, true),
      lastUsedAt: readNullableText(passkeys.lastUsedAt)
    },
    twoFactor: {
      available: readBoolean(twoFactor.available),
      enabled: readBoolean(twoFactor.enabled)
    }
  }
}

const normalizeProfileAuditEvent = (value: unknown): RelayProfileOpenApiAuditEvent | undefined => {
  if (!isRecord(value)) return undefined
  const id = toString(value.id)
  if (id === '') return undefined
  return {
    createdAt: toString(value.createdAt),
    error: readNullableText(value.error),
    id,
    ip: readNullableText(value.ip),
    method: toString(value.method),
    path: toString(value.path),
    permission: readNullableText(value.permission),
    status: readNumber(value.status),
    tokenId: toString(value.tokenId),
    tokenPreview: toString(value.tokenPreview),
    userAgent: readNullableText(value.userAgent),
    userId: toString(value.userId)
  }
}

const profileMessageKinds = new Set<RelayProfileMessageKind>(['announcement', 'personal', 'system'])
const profileMessageAudienceScopes = new Set<RelayProfileMessageAudienceScope>(['all', 'team', 'users'])

const normalizeProfileMessageKind = (value: unknown): RelayProfileMessageKind => {
  const kind = toString(value)
  return profileMessageKinds.has(kind as RelayProfileMessageKind) ? kind as RelayProfileMessageKind : 'personal'
}

const normalizeProfileMessageAudienceScope = (value: unknown): RelayProfileMessageAudienceScope => {
  const scope = toString(value)
  return profileMessageAudienceScopes.has(scope as RelayProfileMessageAudienceScope)
    ? scope as RelayProfileMessageAudienceScope
    : 'users'
}

const normalizeProfileMessageUser = (value: unknown): RelayProfileMessageUser | null => {
  if (!isRecord(value)) return null
  const id = toString(value.id)
  const email = toString(value.email)
  const name = toString(value.name) || email || id
  if (id === '' && email === '' && name === '') return null
  return {
    avatarUrl: readNullableText(value.avatarUrl),
    email,
    id,
    name,
    provider: readNullableText(value.provider),
    role: toString(value.role) || 'member'
  }
}

const normalizeProfileMessageTeam = (value: unknown) => {
  if (!isRecord(value)) return null
  const id = toString(value.id)
  const name = toString(value.name)
  const slug = toString(value.slug)
  if (id === '' && name === '' && slug === '') return null
  return {
    avatarUrl: readNullableText(value.avatarUrl),
    id,
    name: name || slug || id,
    slug
  }
}

const normalizeProfileMessageAudience = (value: unknown): RelayProfileMessage['audience'] => {
  const audience = isRecord(value) ? value : {}
  return {
    scope: normalizeProfileMessageAudienceScope(audience.scope),
    team: normalizeProfileMessageTeam(audience.team),
    teamId: readNullableText(audience.teamId),
    userIds: readStringList(audience.userIds),
    users: Array.isArray(audience.users)
      ? audience.users.map(normalizeProfileMessageUser)
      : []
  }
}

const normalizeProfileMessageLoginMetadata = (
  value: unknown
): RelayProfileMessageLoginMetadata | undefined => {
  if (!isRecord(value)) return undefined
  const ip = readOptionalText(value.ip)
  const location = readOptionalText(value.location)
  const userAgent = readOptionalText(value.userAgent)
  if (ip == null && location == null && userAgent == null) return undefined
  return {
    ...(ip == null ? {} : { ip }),
    ...(location == null ? {} : { location }),
    ...(userAgent == null ? {} : { userAgent })
  }
}

const normalizeProfileMessageMetadata = (value: unknown): RelayProfileMessage['metadata'] | undefined => {
  if (!isRecord(value)) return undefined
  const login = normalizeProfileMessageLoginMetadata(value.login)
  if (login == null) return undefined
  return { login }
}

const normalizeProfileMessage = (value: unknown): RelayProfileMessage | undefined => {
  if (!isRecord(value)) return undefined
  const id = toString(value.id)
  if (id === '') return undefined
  const metadata = normalizeProfileMessageMetadata(value.metadata)
  return {
    audience: normalizeProfileMessageAudience(value.audience),
    body: toString(value.body),
    createdAt: toString(value.createdAt),
    createdBy: normalizeProfileMessageUser(value.createdBy),
    createdByUserId: toString(value.createdByUserId),
    id,
    kind: normalizeProfileMessageKind(value.kind),
    ...(metadata == null ? {} : { metadata }),
    title: toString(value.title),
    updatedAt: readNullableText(value.updatedAt)
  }
}

const normalizeProfileTeamInvitation = (value: unknown): RelayProfileTeamInvitation | undefined => {
  if (!isRecord(value)) return undefined
  const id = toString(value.id)
  if (id === '') return undefined
  return {
    configEnabled: readBoolean(value.configEnabled),
    createdAt: toString(value.createdAt),
    createdByUserId: toString(value.createdByUserId),
    defaultForPublishing: readBoolean(value.defaultForPublishing),
    email: readNullableText(value.email),
    groupIds: readStringList(value.groupIds),
    id,
    inviter: normalizeProfileMessageUser(value.inviter),
    respondedAt: readNullableText(value.respondedAt),
    role: toString(value.role) || 'member',
    status: toString(value.status) || 'pending',
    teamAvatarUrl: readNullableText(value.teamAvatarUrl),
    teamId: toString(value.teamId),
    teamName: readNullableText(value.teamName),
    teamSlug: readNullableText(value.teamSlug),
    updatedAt: readNullableText(value.updatedAt),
    user: normalizeProfileMessageUser(value.user),
    userId: readNullableText(value.userId)
  }
}

const normalizeProfileTeam = (value: unknown): RelayProfileTeam | undefined => {
  if (!isRecord(value)) return undefined
  const id = toString(value.id)
  if (id === '') return undefined
  const membership = isRecord(value.membership)
    ? {
      configEnabled: readBoolean(value.membership.configEnabled, true),
      defaultForPublishing: readBoolean(value.membership.defaultForPublishing),
      groupIds: readStringList(value.membership.groupIds),
      role: toString(value.membership.role) || 'member'
    }
    : null
  return {
    archivedAt: readNullableText(value.archivedAt),
    avatarUrl: readNullableText(value.avatarUrl),
    configEnabled: readBoolean(value.configEnabled, membership?.configEnabled ?? true),
    defaultForPublishing: readBoolean(value.defaultForPublishing, membership?.defaultForPublishing ?? false),
    description: readNullableText(value.description),
    id,
    memberCount: readNumber(value.memberCount, 0),
    membership,
    name: toString(value.name) || toString(value.slug) || id,
    role: membership?.role ?? (toString(value.role) || undefined),
    slug: toString(value.slug) || id,
    updatedAt: readNullableText(value.updatedAt)
  }
}

const normalizeProfileSession = (value: unknown): RelayProfileSessionSummary | undefined => {
  if (!isRecord(value)) return undefined
  const expiresAt = readOptionalText(value.expiresAt)
  const lastSeenAt = readOptionalText(value.lastSeenAt)
  if (expiresAt == null && lastSeenAt == null) return undefined
  return {
    ...(expiresAt == null ? {} : { expiresAt }),
    ...(lastSeenAt == null ? {} : { lastSeenAt })
  }
}

const fetchRelayProfileJson = async (
  account: OneWorksAuthAccount,
  path: string,
  init: Pick<RequestInit, 'body' | 'method'> = {}
) => {
  // Plugin profile UI mirrors Relay Admin, but session auth stays server-side in ~/.oneworks/auth.json.
  const sessionToken = account.sessionToken ?? ''
  if (!isSessionAuthenticated(account) || sessionToken === '') {
    throw new Error('Relay login session expired. Sign in again before opening this account.')
  }
  const response = await fetch(new URL(path, account.serverUrl), {
    ...init,
    headers: {
      authorization: `Bearer ${sessionToken}`,
      ...(init.body == null ? {} : { 'content-type': 'application/json' })
    }
  })
  const body = await readResponseJson(response)
  if (!response.ok) {
    const message = toString(body.error) || `Relay profile request failed with ${response.status}.`
    throw new Error(message)
  }
  return body
}

const authServerFromRelayServer = (server: ResolvedRelayServer) => ({
  id: server.id,
  name: server.name,
  official: server.official === true,
  ...(server.platform == null ? {} : { platform: server.platform }),
  url: server.remoteBaseUrl
})

const normalizeBaseUrl = (url: string) => url.replace(/\/+$/u, '')

const accountMatchesRelayServer = (
  account: OneWorksAuthAccount,
  server: Pick<ResolvedRelayServer, 'id' | 'remoteBaseUrl'>
) => (
  account.serverId === server.id ||
  normalizeRemoteBaseUrl(account.serverUrl) === normalizeRemoteBaseUrl(server.remoteBaseUrl)
)

const authServerToResolvedRelayServer = (server: OneWorksAuthServer): ResolvedRelayServer | undefined => {
  const remoteBaseUrl = normalizeRemoteBaseUrl(server.url)
  if (remoteBaseUrl === '') return undefined
  try {
    const url = new URL(remoteBaseUrl)
    const port = url.port === '' ? undefined : Number(url.port)
    return {
      id: server.id,
      name: server.name ?? server.id,
      ...(server.official === true ? { official: true } : {}),
      pairingToken: '',
      pairingTokenConfigured: false,
      ...(server.platform == null ? {} : { platform: server.platform }),
      ...(Number.isFinite(port) ? { port } : {}),
      protocol: url.protocol === 'https:' ? 'https' : 'http',
      remoteBaseUrl,
      server: url.hostname
    }
  } catch {
    return undefined
  }
}

const authAccountToRelayAccountProfile = (account: OneWorksAuthAccount): RelayAccountProfile => ({
  ...(account.avatarUrl == null ? {} : { avatarUrl: account.avatarUrl }),
  ...(account.email == null ? {} : { email: account.email }),
  id: account.userId,
  ...(account.loginId == null ? {} : { loginId: account.loginId }),
  ...(account.name == null ? {} : { name: account.name }),
  ...(account.role == null ? {} : { role: account.role })
})

const authAccountsForRelayServer = (
  authStore: OneWorksAuthStore,
  server: Pick<ResolvedRelayServer, 'id' | 'remoteBaseUrl'>
) =>
  authStore.accounts.filter(account =>
    account.enabled !== false &&
    accountMatchesRelayServer(account, server)
  )

const preferredAuthAccountForRelayServer = (
  authStore: OneWorksAuthStore,
  server: Pick<ResolvedRelayServer, 'id' | 'remoteBaseUrl'>
) => {
  const accounts = authAccountsForRelayServer(authStore, server)
  return accounts.find(isSessionAuthenticated) ?? accounts[0]
}

const resolveAuthStoreRelayServer = (
  authStore: OneWorksAuthStore,
  requestedServerId: string
): ResolvedRelayServer | undefined => {
  const requested = requestedServerId.trim().toLowerCase()
  if (requested === '') return undefined
  const requestedBaseUrl = normalizeRemoteBaseUrl(requestedServerId)
  return Object.values(authStore.servers)
    .map(authServerToResolvedRelayServer)
    .find((server): server is ResolvedRelayServer => {
      if (server == null) return false
      return (
        server.id.toLowerCase() === requested ||
        server.name.toLowerCase() === requested ||
        normalizeBaseUrl(server.remoteBaseUrl) === requestedBaseUrl
      )
    })
}

const authServerToPublicStatus = (
  server: OneWorksAuthServer,
  activeServerId?: string,
  input: {
    account?: RelayAccountProfile
    connected?: boolean
    connection?: RelayConnectionState
    devices?: RelayRemoteDeviceSummary[]
    devicesError?: string
    hasToken?: boolean
    registeredAt?: string | null
    sessionAuthenticated?: boolean
    sessionExpiresAt?: string | null
    updatedAt?: string | null
  } = {}
): RelayPublicServerStatus | undefined => {
  const resolved = authServerToResolvedRelayServer(server)
  if (resolved == null) return undefined
  const { pairingToken: _pairingToken, ...serverOptions } = resolved
  return {
    ...serverOptions,
    active: resolved.id === activeServerId,
    connected: input.connected ?? false,
    connection: input.connection ?? {
      state: 'idle',
      message: 'Relay account server is available from local login state.',
      ...(activeServerId == null || activeServerId === '' ? {} : { activeServerId }),
      lastConnectedAt: null,
      lastError: null,
      remoteBaseUrl: resolved.remoteBaseUrl
    },
    ...(input.account == null ? {} : { account: input.account }),
    devices: input.devices ?? [],
    ...(input.devicesError == null ? {} : { devicesError: input.devicesError }),
    hasToken: input.hasToken ?? false,
    registeredAt: input.registeredAt ?? null,
    sessionAuthenticated: input.sessionAuthenticated ?? false,
    sessionExpiresAt: input.sessionExpiresAt ?? null,
    updatedAt: input.updatedAt ?? null
  }
}

const readAuthStoreServerCandidates = (
  serverStatuses: RelayPublicServerStatus[],
  authServers: Record<string, OneWorksAuthServer>
) => {
  const existingIds = new Set(serverStatuses.map(server => server.id))
  const existingUrls = new Set(serverStatuses.map(server => normalizeBaseUrl(server.remoteBaseUrl)))
  return Object.values(authServers)
    .filter(server => {
      const remoteBaseUrl = normalizeRemoteBaseUrl(server.url)
      return !existingIds.has(server.id) && (remoteBaseUrl === '' || !existingUrls.has(remoteBaseUrl))
    })
}

const accountMatchesSelector = (account: OneWorksAuthAccount, selector: string) => {
  const normalized = selector.trim().toLowerCase()
  if (normalized === '') return true
  return [
    account.accountKey,
    account.userId,
    account.loginId,
    account.email,
    account.name
  ].some(value => value?.trim().toLowerCase() === normalized)
}

const buildDesktopRedirectUri = (ctx: RelayPluginContext, serverId: string) => {
  const url = new URL('oneworks://relay/auth')
  if (ctx.runtime.role === 'manager') {
    url.searchParams.set('launcher', '1')
  } else {
    url.searchParams.set('workspace', ctx.workspaceFolder)
  }
  url.searchParams.set('scope', ctx.scope)
  url.searchParams.set('serverId', serverId)
  return url.toString()
}

const getStoredServer = (
  store: RelayStore,
  server: Pick<ResolvedRelayServer, 'id' | 'remoteBaseUrl'>
): RelayStoredServer | undefined => (
  store.servers[server.id] ??
    Object.values(store.servers).find(stored =>
      stored.remoteBaseUrl.replace(/\/+$/u, '') ===
        server.remoteBaseUrl.replace(/\/+$/u, '')
    )
)

const createServerStatuses = (
  store: RelayStore,
  options: ReturnType<typeof normalizeOptions>,
  getConnectionState: (server: Pick<ResolvedRelayServer, 'id' | 'remoteBaseUrl'>) => RelayConnectionState,
  activeServerId?: string
) =>
  options.servers.map(server => {
    const stored = getStoredServer(store, server)
    const connection = getConnectionState(server)
    return {
      ...server,
      active: server.id === (activeServerId ?? options.activeServerId),
      connected: connection.state === 'registered',
      connection,
      ...(stored?.account == null ? {} : { account: stored.account }),
      hasToken: (stored?.deviceToken ?? '') !== '',
      registeredAt: stored?.registeredAt ?? null,
      sessionAuthenticated: (stored?.sessionToken ?? '') !== '' &&
        (stored?.sessionExpiresAt == null || Date.parse(stored.sessionExpiresAt) > Date.now()),
      sessionExpiresAt: stored?.sessionExpiresAt ?? null,
      updatedAt: stored?.updatedAt ?? null
    }
  })

const withStoredServer = (
  store: RelayStore,
  server: ResolvedRelayServer,
  update: {
    account?: RelayAccountProfile
    deviceName: string
    deviceToken: string
    registeredAt: string
    sessionExpiresAt?: string
    sessionToken?: string
  }
): RelayStore => {
  const previous = getStoredServer(store, server)
  return {
    ...store,
    deviceName: update.deviceName,
    servers: {
      ...store.servers,
      [server.id]: {
        ...(previous?.configDisabledSources == null ? {} : { configDisabledSources: previous.configDisabledSources }),
        ...(previous?.personalDocumentSync == null ? {} : { personalDocumentSync: previous.personalDocumentSync }),
        ...(previous?.teamDocumentSync == null ? {} : { teamDocumentSync: previous.teamDocumentSync }),
        deviceToken: update.deviceToken,
        id: server.id,
        ...(update.account == null ? {} : { account: update.account }),
        registeredAt: previous?.registeredAt ?? update.registeredAt,
        remoteBaseUrl: server.remoteBaseUrl,
        sessionExpiresAt: update.sessionExpiresAt ?? previous?.sessionExpiresAt,
        sessionToken: update.sessionToken ?? previous?.sessionToken,
        updatedAt: update.registeredAt
      }
    }
  }
}

const normalizeAccountProfile = (value: unknown): RelayAccountProfile | undefined => {
  if (!isRecord(value)) return undefined
  const id = toString(value.id)
  const email = toString(value.email)
  const loginId = toString(value.loginId)
  const name = toString(value.name)
  const avatarUrl = toString(value.avatarUrl)
  const provider = toString(value.provider)
  const role = toString(value.role)
  if ([id, email, loginId, name, avatarUrl, provider, role].every(item => item === '')) return undefined
  return {
    ...(avatarUrl === '' ? {} : { avatarUrl }),
    ...(email === '' ? {} : { email }),
    ...(id === '' ? {} : { id }),
    ...(loginId === '' ? {} : { loginId }),
    ...(name === '' ? {} : { name }),
    ...(provider === '' ? {} : { provider }),
    ...(role === '' ? {} : { role })
  }
}

const normalizeRemoteDeviceEnvironmentInfo = (value: unknown): RelayDeviceEnvironmentInfo | undefined => {
  if (!isRecord(value)) return undefined
  const archValue = readOptionalText(value.arch)
  const deviceType = readOptionalText(value.deviceType)
  const osName = readOptionalText(value.osName)
  const osPlatform = readOptionalText(value.osPlatform)
  const osRelease = readOptionalText(value.osRelease)
  const osVersion = readOptionalText(value.osVersion)
  const runtime = readOptionalText(value.runtime)
  const runtimeVersion = readOptionalText(value.runtimeVersion)
  if (
    [archValue, deviceType, osName, osPlatform, osRelease, osVersion, runtime, runtimeVersion].every(item =>
      item == null
    )
  ) {
    return undefined
  }
  return {
    ...(archValue == null ? {} : { arch: archValue }),
    ...(deviceType == null ? {} : { deviceType }),
    ...(osName == null ? {} : { osName }),
    ...(osPlatform == null ? {} : { osPlatform }),
    ...(osRelease == null ? {} : { osRelease }),
    ...(osVersion == null ? {} : { osVersion }),
    ...(runtime == null ? {} : { runtime }),
    ...(runtimeVersion == null ? {} : { runtimeVersion })
  }
}

const normalizeRemoteDeviceProjectSummary = (value: unknown): RelayRemoteDeviceProjectSummary | undefined => {
  if (!isRecord(value)) return undefined
  const createdAt = readOptionalText(value.createdAt)
  const id = readOptionalText(value.id)
  const lastSeenAt = readOptionalText(value.lastSeenAt)
  const name = readOptionalText(value.name)
  const status = readOptionalText(value.status)
  const title = readOptionalText(value.title)
  const workspaceFolder = readOptionalText(value.workspaceFolder)
  if ([createdAt, id, lastSeenAt, name, status, title, workspaceFolder].every(item => item == null)) {
    return undefined
  }
  return {
    ...(createdAt == null ? {} : { createdAt }),
    ...(id == null ? {} : { id }),
    ...(lastSeenAt == null ? {} : { lastSeenAt }),
    ...(name == null ? {} : { name }),
    ...(status == null ? {} : { status }),
    ...(title == null ? {} : { title }),
    ...(workspaceFolder == null ? {} : { workspaceFolder })
  }
}

const normalizeRemoteDeviceManagementServerSummary = (
  value: unknown
): RelayRemoteDeviceManagementServerSummary | undefined => {
  if (!isRecord(value)) return undefined
  const createdAt = readOptionalText(value.createdAt)
  const environment = normalizeRemoteDeviceEnvironmentInfo(value.environment)
  const id = readOptionalText(value.id)
  const ip = readOptionalText(value.ip)
  const kind = readOptionalText(value.kind)
  const lastSeenAt = readOptionalText(value.lastSeenAt)
  const lastSeenIp = readOptionalText(value.lastSeenIp)
  const name = readOptionalText(value.name)
  const pluginScope = readOptionalText(value.pluginScope)
  const projects = Array.isArray(value.projects)
    ? value.projects
      .map(normalizeRemoteDeviceProjectSummary)
      .filter((item): item is RelayRemoteDeviceProjectSummary => item != null)
    : []
  const registeredIp = readOptionalText(value.registeredIp)
  const status = readOptionalText(value.status)
  const workspaceFolder = readOptionalText(value.workspaceFolder)
  if (
    [createdAt, id, ip, kind, lastSeenAt, lastSeenIp, name, pluginScope, registeredIp, status, workspaceFolder]
      .every(item => item == null) &&
    environment == null &&
    projects.length === 0
  ) {
    return undefined
  }
  return {
    ...(createdAt == null ? {} : { createdAt }),
    ...(environment == null ? {} : { environment }),
    ...(id == null ? {} : { id }),
    ...(ip == null ? {} : { ip }),
    ...(kind == null ? {} : { kind }),
    ...(lastSeenAt == null ? {} : { lastSeenAt }),
    ...(lastSeenIp == null ? {} : { lastSeenIp }),
    ...(name == null ? {} : { name }),
    ...(pluginScope == null ? {} : { pluginScope }),
    ...(projects.length === 0 ? {} : { projects }),
    ...(registeredIp == null ? {} : { registeredIp }),
    ...(status == null ? {} : { status }),
    ...(workspaceFolder == null ? {} : { workspaceFolder })
  }
}

const normalizeRemoteDeviceSummary = (value: unknown): RelayRemoteDeviceSummary | undefined => {
  if (!isRecord(value)) return undefined
  const alias = readOptionalText(value.alias)
  const deviceInfo = normalizeRemoteDeviceEnvironmentInfo(value.deviceInfo)
  const id = readOptionalText(value.id)
  const isCurrentClientDevice = value.isCurrentClientDevice === true ? true : undefined
  const ip = readOptionalText(value.ip)
  const lastSeenIp = readOptionalText(value.lastSeenIp)
  const name = readOptionalText(value.name)
  const registeredIp = readOptionalText(value.registeredIp)
  const status = readOptionalText(value.status)
  const pluginScope = readOptionalText(value.pluginScope)
  const createdAt = readOptionalText(value.createdAt)
  const lastSeenAt = readOptionalText(value.lastSeenAt)
  const workspaceFolder = readOptionalText(value.workspaceFolder)
  const capabilities = isRecord(value.capabilities) ? value.capabilities : undefined
  const managementServers = Array.isArray(value.managementServers)
    ? value.managementServers
      .map(normalizeRemoteDeviceManagementServerSummary)
      .filter((item): item is RelayRemoteDeviceManagementServerSummary => item != null)
    : []
  if (
    [alias, id, ip, lastSeenIp, name, registeredIp, status, pluginScope, createdAt, lastSeenAt, workspaceFolder]
      .every(item => item == null) &&
    capabilities == null &&
    deviceInfo == null &&
    managementServers.length === 0
  ) {
    return undefined
  }
  return {
    ...(alias == null ? {} : { alias }),
    ...(capabilities == null ? {} : { capabilities }),
    ...(createdAt == null ? {} : { createdAt }),
    ...(deviceInfo == null ? {} : { deviceInfo }),
    ...(id == null ? {} : { id }),
    ...(isCurrentClientDevice == null ? {} : { isCurrentClientDevice }),
    ...(ip == null ? {} : { ip }),
    ...(lastSeenAt == null ? {} : { lastSeenAt }),
    ...(lastSeenIp == null ? {} : { lastSeenIp }),
    ...(managementServers.length === 0 ? {} : { managementServers }),
    ...(name == null ? {} : { name }),
    ...(pluginScope == null ? {} : { pluginScope }),
    ...(registeredIp == null ? {} : { registeredIp }),
    ...(status == null ? {} : { status }),
    ...(workspaceFolder == null ? {} : { workspaceFolder })
  }
}

const emptyConfigDistributionStatus = (): RelayConfigDistributionStatus => ({
  allowedFields: [],
  hash: null,
  lastAppliedAt: null,
  lastError: null,
  lastSyncedAt: null,
  marketplaceKeys: [],
  matchedProject: null,
  modelServiceKeys: [],
  pluginKeys: [],
  skillKeys: [],
  skillRegistryKeys: [],
  sourceServerId: null,
  sources: [],
  version: null
})

const readStringList = (value: unknown) => (
  Array.isArray(value)
    ? value.map(item => toString(item).trim()).filter(item => item !== '')
    : []
)

const readStatusText = (value: unknown) => {
  const text = readOptionalText(value)
  return text == null ? null : text
}

const readRecordKeys = (value: unknown) => (
  isRecord(value) ? Object.keys(value).filter(key => key.trim() !== '') : []
)

const readArrayOrRecordKeys = (value: unknown) => {
  if (Array.isArray(value)) return readStringList(value)
  return readRecordKeys(value)
}

const readMatchedProject = (value: unknown) => {
  if (typeof value === 'boolean') return value
  return readStatusText(value)
}

const normalizeConfigDistributionStatus = (value: unknown): RelayConfigDistributionStatus => {
  if (!isRecord(value)) return emptyConfigDistributionStatus()

  const modelServiceKeys = readStringList(value.modelServiceKeys)
  const derivedModelServiceKeys = modelServiceKeys.length === 0 && isRecord(value.modelServices)
    ? Object.keys(value.modelServices).filter(key => key.trim() !== '')
    : modelServiceKeys
  const marketplaceKeys = readStringList(value.marketplaceKeys)
  const pluginKeys = readStringList(value.pluginKeys)
  const skillKeys = readStringList(value.skillKeys)
  const skillRegistryKeys = readStringList(value.skillRegistryKeys)

  return {
    allowedFields: readStringList(value.allowedFields),
    hash: readStatusText(value.hash),
    lastAppliedAt: readStatusText(value.lastAppliedAt),
    lastError: readStatusText(value.lastError),
    lastSyncedAt: readStatusText(value.lastSyncedAt),
    marketplaceKeys: marketplaceKeys.length === 0 ? readRecordKeys(value.marketplaces) : marketplaceKeys,
    matchedProject: readMatchedProject(value.matchedProject),
    modelServiceKeys: derivedModelServiceKeys,
    pluginKeys: pluginKeys.length === 0 ? readRecordKeys(value.plugins) : pluginKeys,
    skillKeys: skillKeys.length === 0 ? readArrayOrRecordKeys(value.skills) : skillKeys,
    skillRegistryKeys: skillRegistryKeys.length === 0
      ? readArrayOrRecordKeys(value.skillRegistries)
      : skillRegistryKeys,
    sourceServerId: readStatusText(value.sourceServerId),
    sources: [],
    version: readStatusText(value.version)
  }
}

const collectSnapshotSources = (
  snapshot: RelayConfigSnapshot | undefined,
  preferences = readRelayConfigSourcePreferences(undefined)
) =>
  (snapshot?.assignments ?? [])
    .map(assignment => {
      const provenance = assignment.provenance
      if (provenance == null) return undefined
      const disabledBy = relayConfigSourceDisabledByPreferences(provenance, preferences)
      return {
        assignmentId: provenance.assignmentId,
        disabledBy,
        enabled: disabledBy.length === 0,
        fields: provenance.fields,
        mode: provenance.mode,
        profileId: provenance.profileId,
        profileName: provenance.profileName,
        teamId: provenance.teamId,
        ...(provenance.teamName == null ? {} : { teamName: provenance.teamName }),
        version: provenance.version,
        versionId: provenance.versionId
      }
    })
    .filter((source): source is NonNullable<typeof source> => source != null)

const collectSnapshotPatchKeys = (
  snapshot: RelayConfigSnapshot | undefined,
  field: 'marketplaces' | 'modelServices' | 'plugins' | 'skillRegistries' | 'skills'
) => {
  const keys = new Set<string>()
  const collectAssignment = (assignment: NonNullable<RelayConfigSnapshot['assignments']>[number]) => {
    for (const key of readArrayOrRecordKeys(assignment.configPatch?.[field])) keys.add(key)
    if (Array.isArray(assignment.rules)) {
      for (const rule of assignment.rules) {
        if (typeof rule === 'string') continue
        collectAssignment(rule)
      }
    }
  }
  for (const assignment of snapshot?.assignments ?? []) collectAssignment(assignment)
  for (const rule of snapshot?.rules ?? []) collectAssignment(rule)
  return [...keys]
}

const collectSnapshotAllowedFields = (snapshot: RelayConfigSnapshot | undefined) => {
  const fields = new Set<string>()
  const collectAssignment = (assignment: NonNullable<RelayConfigSnapshot['assignments']>[number]) => {
    for (const field of assignment.allowedFields ?? []) fields.add(field)
    if (Array.isArray(assignment.rules)) {
      for (const rule of assignment.rules) {
        if (typeof rule === 'string') continue
        collectAssignment(rule)
      }
    }
  }
  for (const assignment of snapshot?.assignments ?? []) collectAssignment(assignment)
  for (const rule of snapshot?.rules ?? []) collectAssignment(rule)
  return [...fields]
}

const snapshotToConfigDistributionStatus = (
  snapshot: RelayConfigSnapshot | undefined,
  preferences = readRelayConfigSourcePreferences(undefined)
): RelayConfigDistributionStatus => {
  if (snapshot == null) return emptyConfigDistributionStatus()
  const effectiveSnapshot = filterRelayConfigSnapshotByPreferences(snapshot, preferences)
  return {
    allowedFields: collectSnapshotAllowedFields(effectiveSnapshot),
    hash: snapshot.hash ?? null,
    lastAppliedAt: snapshot.lastAppliedAt ?? null,
    lastError: snapshot.lastError ?? null,
    lastSyncedAt: snapshot.lastSyncedAt ?? null,
    marketplaceKeys: collectSnapshotPatchKeys(effectiveSnapshot, 'marketplaces'),
    matchedProject: snapshot.matchedProject ?? null,
    modelServiceKeys: collectSnapshotPatchKeys(effectiveSnapshot, 'modelServices'),
    pluginKeys: collectSnapshotPatchKeys(effectiveSnapshot, 'plugins'),
    skillKeys: collectSnapshotPatchKeys(effectiveSnapshot, 'skills'),
    skillRegistryKeys: collectSnapshotPatchKeys(effectiveSnapshot, 'skillRegistries'),
    sourceServerId: snapshot.sourceServerId ?? null,
    sources: collectSnapshotSources(snapshot, preferences),
    version: snapshot.version
  }
}

const readResponseJson = async (response: Response) => {
  const body = await response.json().catch(() => ({}))
  return isRecord(body) ? body : {}
}

const fetchRelaySessionProfile = async (
  server: Pick<ResolvedRelayServer, 'remoteBaseUrl'>,
  sessionToken: string
) => {
  const response = await fetch(new URL('/api/auth/me', server.remoteBaseUrl), {
    headers: {
      authorization: `Bearer ${sessionToken}`
    }
  })
  const body = await readResponseJson(response)
  if (!response.ok) {
    const message = toString(body.error) || `Relay session check failed with ${response.status}.`
    throw new Error(message)
  }
  return {
    account: normalizeAccountProfile(body.user),
    expiresAt: isRecord(body.session) ? readOptionalText(body.session.expiresAt) : undefined
  }
}

const fetchRelayDevices = async (
  server: Pick<ResolvedRelayServer, 'remoteBaseUrl'>,
  listToken: string
): Promise<RelayRemoteDeviceSummary[]> => {
  if (listToken === '') return []

  const response = await fetch(new URL('/api/relay/devices', server.remoteBaseUrl), {
    headers: {
      authorization: `Bearer ${listToken}`
    }
  })
  const body = await readResponseJson(response)
  if (!response.ok) {
    const message = toString(body.error) || `Relay device list failed with ${response.status}.`
    throw new Error(message)
  }
  return Array.isArray(body.devices)
    ? body.devices.map(normalizeRemoteDeviceSummary).filter((device): device is RelayRemoteDeviceSummary => {
      return device != null
    })
    : []
}

export const createRelayController = (ctx: RelayPluginContext): RelayController => {
  // Keep async restore and teardown work inside the controller's original user namespace.
  const authStoreEnv = {
    __ONEWORKS_PROJECT_REAL_HOME__: process.env.__ONEWORKS_PROJECT_REAL_HOME__,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE
  }
  const readOneWorksAuthStore = () => readOneWorksAuthStoreFile(authStoreEnv)
  const writeOneWorksAuthStore = (store: OneWorksAuthStore) => (
    writeOneWorksAuthStoreFile(store, authStoreEnv)
  )
  let state = initialState()
  let disposed = false
  let explicitConnectVersion = 0
  const deviceStore = createRelayDeviceStore(ctx.projectHome)
  const managementServerStore = createRelayManagementServerStore(ctx.projectHome)
  const serviceInfoStore = createRelayServiceInfoStore()
  const heartbeats = new Map<string, ReturnType<typeof startHeartbeat>>()
  const sessionWorkers = new Map<string, ReturnType<typeof createRelaySessionWorker>>()
  const loopLeases = new Map<string, RelayLoopLease>()
  const loopConnectionKeysByLeaseKey = new Map<string, string>()
  const loopLeaseManager = createRelayLoopLeaseManager({
    ownerId: randomUUID()
  })
  const workspaceProxies = new Map<string, RelayWorkspaceProxyEntry>()
  const workspaceProxyOpenPromises = new Map<string, Promise<RelayWorkspaceOpenResult>>()
  const deviceListCache = new Map<string, RelayDeviceListCacheEntry>()
  const serviceInfoCache = new Map<string, RelayServiceInfoCacheEntry>()
  const serviceInfoHydration = serviceInfoStore.readStore()
    .then(services => {
      for (const [cacheKey, info] of Object.entries(services)) {
        serviceInfoCache.set(cacheKey, {
          fetchedAt: 0,
          value: info
        })
      }
    })
    .catch(error => {
      ctx.logger.warn({ err: error, scope: ctx.scope }, '[relay] service info cache restore failed')
    })
  const connectionStates: Record<string, RelayConnectionState> = {}
  let configDistributionStatus: RelayConfigDistributionStatus | undefined
  let personalDocumentSyncStatus: RelayPersonalDocumentSyncStatus | undefined
  let personalDocumentSyncStatusServerId: string | undefined
  const projectRuleDocumentSyncStatuses = new Map<
    string,
    { status: RelayPersonalDocumentSyncStatus; teamId: string }
  >()
  const teamDocumentSyncStatuses = new Map<string, RelayPersonalDocumentSyncStatus>()

  const teamDocumentSyncStatusKey = (serverId: string, teamId: string) => `${serverId}:${teamId}`
  const projectRuleDocumentSyncStatusKey = (serverId: string, assignmentId: string) => (
    `${serverId}:${assignmentId}`
  )
  const recordProjectRuleDocumentSyncStatuses = (
    serverId: string,
    result: Pick<RelayConfigSyncResult, 'projectRuleDocuments' | 'snapshot'>
  ) => {
    const prefix = `${serverId}:`
    for (const key of projectRuleDocumentSyncStatuses.keys()) {
      if (key.startsWith(prefix)) projectRuleDocumentSyncStatuses.delete(key)
    }
    for (const assignment of result.snapshot?.assignments ?? []) {
      const status = result.projectRuleDocuments?.[assignment.id]
      const teamId = assignment.provenance?.teamId?.trim()
      if (status == null || teamId == null || teamId === '') continue
      projectRuleDocumentSyncStatuses.set(
        projectRuleDocumentSyncStatusKey(serverId, assignment.id),
        { status, teamId }
      )
    }
  }

  const getConnectionState = (server: Pick<ResolvedRelayServer, 'id' | 'remoteBaseUrl'>) => ({
    ...initialState(),
    activeServerId: server.id,
    remoteBaseUrl: server.remoteBaseUrl,
    ...connectionStates[server.id]
  })

  const listKnownRelayServers = (authStore: OneWorksAuthStore) => {
    const servers: ResolvedRelayServer[] = []
    const seenIds = new Set<string>()
    const seenUrls = new Set<string>()
    const addServer = (server: ResolvedRelayServer | undefined) => {
      if (server == null) return
      const remoteBaseUrl = normalizeBaseUrl(server.remoteBaseUrl)
      if (seenIds.has(server.id) || seenUrls.has(remoteBaseUrl)) return
      seenIds.add(server.id)
      seenUrls.add(remoteBaseUrl)
      servers.push(server)
    }

    for (const configuredServer of normalizeOptions(ctx.options, ctx.runtime.role).servers) {
      addServer(resolveActiveRelayServer(ctx.options, configuredServer.id))
    }
    for (const authServer of Object.values(authStore.servers)) {
      addServer(authServerToResolvedRelayServer(authServer))
    }
    return servers
  }

  const resolveRelayServer = (authStore: OneWorksAuthStore, requestedServerId: string) => (
    resolveActiveRelayServer(ctx.options, requestedServerId) ??
      resolveAuthStoreRelayServer(authStore, requestedServerId)
  )

  const setConnectionState = (serverId: string, nextState: RelayConnectionState) => {
    connectionStates[serverId] = nextState
    state = nextState
  }

  const createLoopLeaseKey = (input: {
    deviceId: string
    managementServerId: string
    server: Pick<ResolvedRelayServer, 'remoteBaseUrl'>
  }) =>
    JSON.stringify({
      deviceId: input.deviceId,
      managementServerId: input.managementServerId,
      remoteBaseUrl: normalizeBaseUrl(input.server.remoteBaseUrl)
    })

  const clearDeviceListCacheForServer = (serverId: string) => {
    for (const cacheKey of deviceListCache.keys()) {
      if (cacheKey.startsWith(`${serverId}|`)) {
        deviceListCache.delete(cacheKey)
      }
    }
  }

  const fetchRelayServiceInfo = async (
    server: Pick<ResolvedRelayServer, 'remoteBaseUrl'>
  ): Promise<RelayServiceInfo> => {
    await serviceInfoHydration
    const cacheKey = normalizeBaseUrl(server.remoteBaseUrl)
    const existing = serviceInfoCache.get(cacheKey)
    if (existing?.inFlight != null) return await existing.inFlight
    if (existing != null && Date.now() - existing.fetchedAt < RELAY_SERVICE_INFO_CACHE_TTL_MS) {
      return existing.value
    }

    const entry: RelayServiceInfoCacheEntry = existing ?? { fetchedAt: 0, value: {} }
    entry.inFlight = (async () => {
      const abortController = new AbortController()
      const timeout = setTimeout(() => abortController.abort(), RELAY_SERVICE_INFO_TIMEOUT_MS)
      try {
        const response = await fetch(new URL('/api/relay/info', server.remoteBaseUrl), {
          headers: { accept: 'application/json' },
          signal: abortController.signal
        })
        const lastCheckedAt = new Date().toISOString()
        if (!response.ok) {
          return {
            ...entry.value,
            availabilityError: `HTTP ${response.status}`,
            lastCheckedAt,
            online: false
          }
        }
        const body = await readResponseJson(response)
        const name = readOptionalText(body.name)
        const avatarSource = readOptionalText(body.avatarUrl)
        let avatarUrl: URL | undefined
        if (avatarSource != null) {
          try {
            avatarUrl = new URL(avatarSource)
          } catch {
            avatarUrl = undefined
          }
        }
        const discoveredAvatarUrl = avatarUrl != null &&
            (avatarUrl.protocol === 'http:' || avatarUrl.protocol === 'https:')
          ? avatarUrl.toString()
          : entry.value.avatarUrl
        const discoveredName = name ?? entry.value.name
        const value = {
          ...(discoveredAvatarUrl == null ? {} : { avatarUrl: discoveredAvatarUrl }),
          lastCheckedAt,
          lastSuccessfulAt: lastCheckedAt,
          ...(discoveredName == null ? {} : { name: discoveredName }),
          online: true as const
        }
        await serviceInfoStore
          .writeServiceInfo(server.remoteBaseUrl, {
            ...(value.avatarUrl == null ? {} : { avatarUrl: value.avatarUrl }),
            lastSuccessfulAt: lastCheckedAt,
            ...(value.name == null ? {} : { name: value.name })
          })
          .catch(error => {
            ctx.logger.warn({ err: error, scope: ctx.scope }, '[relay] service info cache write failed')
          })
        return value
      } catch {
        return {
          ...entry.value,
          availabilityError: abortController.signal.aborted ? 'timeout' : 'unreachable',
          lastCheckedAt: new Date().toISOString(),
          online: false
        }
      } finally {
        clearTimeout(timeout)
      }
    })()
    serviceInfoCache.set(cacheKey, entry)
    const value = await entry.inFlight
    entry.value = value
    entry.fetchedAt = Date.now()
    delete entry.inFlight
    return value
  }

  const readRelayServiceInfo = (
    server: Pick<ResolvedRelayServer, 'remoteBaseUrl'>
  ): RelayServiceInfo => {
    const cacheKey = normalizeBaseUrl(server.remoteBaseUrl)
    const existing = serviceInfoCache.get(cacheKey)
    if (existing == null || Date.now() - existing.fetchedAt >= RELAY_SERVICE_INFO_CACHE_TTL_MS) {
      void fetchRelayServiceInfo(server).catch(error => {
        ctx.logger.warn({ err: error, scope: ctx.scope }, '[relay] service info discovery failed')
      })
    }
    return existing?.value ?? {}
  }

  const warnDeviceListFailure = (
    serverId: string,
    error: unknown,
    entry: RelayDeviceListCacheEntry,
    now: number
  ) => {
    const errorKey = describeRelayFetchError(error)
    const shouldLog = errorKey !== entry.lastErrorKey ||
      now - entry.lastErrorLoggedAt >= RELAY_DEVICE_LIST_ERROR_LOG_INTERVAL_MS
    entry.lastErrorKey = errorKey
    if (!shouldLog) return
    entry.lastErrorLoggedAt = now
    ctx.logger.warn({ err: error, scope: ctx.scope, serverId }, '[relay] device list failed')
  }

  const getDeviceListCacheEntry = (
    server: Pick<ResolvedRelayServer, 'id' | 'remoteBaseUrl'>,
    source: RelayDeviceListSource
  ) => {
    const cacheKey = [
      server.id,
      normalizeBaseUrl(server.remoteBaseUrl),
      source.sourceKey,
      cacheTokenKey(source.listToken)
    ].join('|')
    const existing = deviceListCache.get(cacheKey)
    if (existing != null) return existing
    const entry: RelayDeviceListCacheEntry = {
      devices: [],
      failureCount: 0,
      fetchedAt: 0,
      lastErrorLoggedAt: 0,
      retryAt: 0
    }
    deviceListCache.set(cacheKey, entry)
    return entry
  }

  const listRelayDevicesForSource = async (
    server: Pick<ResolvedRelayServer, 'id' | 'remoteBaseUrl'>,
    source: RelayDeviceListSource,
    input: { force?: boolean } = {}
  ): Promise<RelayDeviceListResult> => {
    if (source.listToken === '') {
      return { devices: [] }
    }

    const entry = getDeviceListCacheEntry(server, source)
    const now = Date.now()
    const hasFreshResult = entry.error == null && now - entry.fetchedAt < RELAY_DEVICE_LIST_CACHE_TTL_MS
    if (!input.force && hasFreshResult) {
      return { devices: entry.devices }
    }
    if (!input.force && now < entry.retryAt) {
      return {
        devices: entry.devices,
        ...(entry.error == null ? {} : { error: entry.error })
      }
    }
    if (entry.inFlight != null) {
      return await entry.inFlight
    }

    const inFlight = fetchRelayDevices(server, source.listToken)
      .then(devices => {
        Object.assign(entry, {
          devices,
          error: undefined,
          failureCount: 0,
          fetchedAt: Date.now(),
          lastErrorKey: undefined,
          retryAt: 0
        })
        return { devices }
      })
      .catch(error => {
        const failedAt = Date.now()
        entry.failureCount += 1
        entry.error = relayFetchErrorMessage(error)
        entry.retryAt = failedAt + relayDeviceListBackoffMs(entry.failureCount)
        warnDeviceListFailure(server.id, error, entry, failedAt)
        return {
          devices: entry.devices,
          error: entry.error
        }
      })
      .finally(() => {
        if (entry.inFlight === inFlight) {
          entry.inFlight = undefined
        }
      })
    entry.inFlight = inFlight
    return await inFlight
  }

  const createStoredServerDeviceSource = (
    server: Pick<ResolvedRelayServer, 'id'>,
    storedServer: RelayStoredServer | undefined
  ): RelayDeviceListSource | undefined => {
    const listToken = storedServer?.deviceToken ?? ''
    if (listToken === '') return undefined
    return {
      ...(storedServer?.sessionToken == null ? {} : { authToken: storedServer.sessionToken }),
      listToken,
      sourceKey: `device:${server.id}`
    }
  }

  const createStoredServerSessionSource = (
    server: Pick<ResolvedRelayServer, 'id'>,
    storedServer: RelayStoredServer | undefined
  ): RelayDeviceListSource | undefined => {
    const sessionToken = storedServer?.sessionToken ?? ''
    if (sessionToken === '') return undefined
    return {
      authToken: sessionToken,
      listToken: sessionToken,
      sourceKey: `stored-session:${server.id}`
    }
  }

  const createAccountDeviceListSources = (
    server: Pick<ResolvedRelayServer, 'id' | 'remoteBaseUrl'>,
    authStore: OneWorksAuthStore
  ) =>
    authStore.accounts
      .filter(account =>
        account.enabled !== false &&
        isSessionAuthenticated(account) &&
        accountMatchesRelayServer(account, server)
      )
      .flatMap((account): RelayDeviceListSource[] => {
        const sessionToken = account.sessionToken ?? ''
        if (sessionToken === '') return []
        return [{
          authToken: sessionToken,
          listToken: sessionToken,
          sourceKey: `account:${account.accountKey}`
        }]
      })

  const dedupeDeviceListSources = (sources: RelayDeviceListSource[]) => {
    const seen = new Set<string>()
    return sources.filter(source => {
      const key = `${source.sourceKey}|${cacheTokenKey(source.listToken)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  const createDeviceListSources = (
    server: Pick<ResolvedRelayServer, 'id' | 'remoteBaseUrl'>,
    store: RelayStore,
    authStore: OneWorksAuthStore
  ) => {
    const storedServer = getStoredServer(store, server)
    return dedupeDeviceListSources(
      [
        createStoredServerDeviceSource(server, storedServer),
        createStoredServerSessionSource(server, storedServer),
        ...createAccountDeviceListSources(server, authStore)
      ].filter((source): source is RelayDeviceListSource => source != null)
    )
  }

  const remoteDeviceLastSeenMs = (device: RelayRemoteDeviceSummary) => {
    const timestamp = Date.parse(device.lastSeenAt ?? '')
    return Number.isFinite(timestamp) ? timestamp : 0
  }

  const shouldPreferRemoteDevice = (
    candidate: RelayRemoteDeviceSummary,
    existing: RelayRemoteDeviceSummary
  ) => {
    const candidateOnline = candidate.status === 'online'
    const existingOnline = existing.status === 'online'
    if (candidateOnline !== existingOnline) return candidateOnline
    return remoteDeviceLastSeenMs(candidate) >= remoteDeviceLastSeenMs(existing)
  }

  const mergeDeviceListResults = (
    results: Array<RelayDeviceListResult & { source: RelayDeviceListSource }>
  ): RelayMergedDeviceListResult => {
    const devicesById = new Map<string, RelayRemoteDeviceSummary>()
    const authTokensByDeviceId = new Map<string, string>()
    const anonymousDevices: RelayRemoteDeviceSummary[] = []
    const errors = new Set<string>()
    for (const result of results) {
      if (result.error != null && result.error !== '') errors.add(result.error)
      for (const device of result.devices) {
        const id = device.id ?? ''
        if (id === '') {
          anonymousDevices.push(device)
          continue
        }
        const existing = devicesById.get(id)
        const shouldReplace = existing == null || shouldPreferRemoteDevice(device, existing)
        if (shouldReplace) {
          devicesById.set(id, device)
        }
        if ((shouldReplace || !authTokensByDeviceId.has(id)) && (result.source.authToken ?? '') !== '') {
          authTokensByDeviceId.set(id, result.source.authToken ?? '')
        }
      }
    }
    return {
      authTokensByDeviceId,
      devices: [...devicesById.values(), ...anonymousDevices],
      ...(errors.size === 0 ? {} : { error: [...errors].join('; ') })
    }
  }

  const listRelayDevicesForServer = async (
    server: Pick<ResolvedRelayServer, 'id' | 'remoteBaseUrl'>,
    store: RelayStore,
    authStore: OneWorksAuthStore,
    input: { force?: boolean } = {}
  ): Promise<RelayMergedDeviceListResult> => {
    const sources = createDeviceListSources(server, store, authStore)
    if (sources.length === 0) {
      return {
        authTokensByDeviceId: new Map(),
        devices: []
      }
    }
    const results = await Promise.all(
      sources.map(async source => ({
        ...(await listRelayDevicesForSource(server, source, input)),
        source
      }))
    )
    return mergeDeviceListResults(results)
  }

  const isOnlineRemoteDevice = (
    device: RelayRemoteDeviceSummary | undefined
  ): device is RelayRemoteDeviceSummary & { status: 'online' } => (
    device?.status === 'online'
  )

  const describeRemoteDeviceState = (device: RelayRemoteDeviceSummary | undefined) => {
    if (device == null) return 'not found'
    return device.status == null || device.status === '' ? 'unknown' : device.status
  }

  const resolveOnlineWorkspaceDevice = async (
    server: ResolvedRelayServer,
    deviceId: string
  ) => {
    const store = await deviceStore.readStore()
    const authStore = await readOneWorksAuthStore()
    const { authTokensByDeviceId, devices, error } = await listRelayDevicesForServer(server, store, authStore)
    const device = devices.find(item => item.id === deviceId)
    if (!isOnlineRemoteDevice(device)) {
      throw new RelayWorkspaceConnectionError(
        error == null
          ? `Remote device is ${
            describeRemoteDeviceState(device)
          }. Wait for the device to reconnect before opening this workspace.`
          : `Remote device is unavailable (${error}). Wait for the device to reconnect before opening this workspace.`,
        {
          code: 'remote_device_offline',
          status: device == null ? 404 : 503
        }
      )
    }
    const authToken = authTokensByDeviceId.get(deviceId) ?? await resolveWorkspaceProxyAuth(server, authStore)
    return {
      authToken,
      device,
      sourceStore: store
    }
  }

  const ensureWorkspaceProxyEntryOnline = async (entry: RelayWorkspaceProxyEntry) => {
    const authStore = await readOneWorksAuthStore()
    const server = resolveRelayServer(authStore, entry.serverId)
    if (server == null) {
      throw new RelayWorkspaceConnectionError(`Unknown relay server: ${entry.serverId}.`, {
        code: 'relay_server_not_found',
        status: 404
      })
    }
    const { authToken, device } = await resolveOnlineWorkspaceDevice(server, entry.deviceId)
    entry.authToken = authToken
    entry.deviceName = entry.deviceName || device.alias || device.name
    return entry
  }

  const disposeWorkspaceProxyEntry = (entry: RelayWorkspaceProxyEntry) => {
    for (const [key, candidate] of workspaceProxies) {
      if (candidate === entry) {
        workspaceProxies.delete(key)
      }
    }
    entry.server.close()
  }

  const readConfiguredConfigDistributionStatus = () =>
    normalizeConfigDistributionStatus(ctx.options.configDistribution ?? ctx.options.configSync)

  const setConfigDistributionError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    configDistributionStatus = {
      ...(configDistributionStatus ?? readConfiguredConfigDistributionStatus()),
      lastError: message
    }
    return configDistributionStatus
  }

  const readConfigDistributionStatus = async () => {
    const getStatus = ctx.configDistribution?.getStatus
    if (getStatus != null) {
      try {
        configDistributionStatus = normalizeConfigDistributionStatus(await getStatus())
        return configDistributionStatus
      } catch (error) {
        ctx.logger.warn({ err: error, scope: ctx.scope }, '[relay] config distribution status failed')
        return setConfigDistributionError(error)
      }
    }
    const { snapshot } = await readRelayConfigSnapshotWithGlobalFallback({
      projectHome: ctx.projectHome
    })
    const store = await deviceStore.readStore()
    const cachedStatus = snapshotToConfigDistributionStatus(
      snapshot,
      readRelayConfigSourcePreferencesForSnapshot(store, snapshot)
    )
    configDistributionStatus = cachedStatus.version == null && cachedStatus.lastError == null
      ? configDistributionStatus ?? readConfiguredConfigDistributionStatus()
      : cachedStatus
    return configDistributionStatus
  }

  const refreshConfigDistributionStatus = async (payload?: unknown) => {
    const refresh = ctx.configDistribution?.refresh
    try {
      if (refresh != null) {
        configDistributionStatus = normalizeConfigDistributionStatus(await refresh())
        return configDistributionStatus
      }

      const requestedServerId = readServerId(payload)
      const authStore = await readOneWorksAuthStore()
      const activeServer = resolveRelayServer(authStore, requestedServerId)
      if (activeServer == null) {
        throw new Error(
          requestedServerId === ''
            ? 'Configure at least one relay server before refreshing relay config.'
            : `Unknown relay server: ${requestedServerId}.`
        )
      }

      const store = await deviceStore.readStore()
      const result = await syncRelayConfigSnapshot({
        ctx,
        server: activeServer,
        storedServer: getStoredServer(store, activeServer)
      })
      personalDocumentSyncStatus = result.personalDocuments
      personalDocumentSyncStatusServerId = activeServer.id
      recordProjectRuleDocumentSyncStatuses(activeServer.id, result)
      configDistributionStatus = snapshotToConfigDistributionStatus(
        result.snapshot,
        readRelayConfigSourcePreferencesForSnapshot(store, result.snapshot)
      )
      return configDistributionStatus
    } catch (error) {
      ctx.logger.warn({ err: error, scope: ctx.scope }, '[relay] config distribution refresh failed')
      return setConfigDistributionError(error)
    }
  }

  const stopRemoteLoop = (connectionKey: string) => {
    heartbeats.get(connectionKey)?.stop()
    heartbeats.delete(connectionKey)
    sessionWorkers.get(connectionKey)?.stop()
    sessionWorkers.delete(connectionKey)
    const lease = loopLeases.get(connectionKey)
    loopLeases.delete(connectionKey)
    for (const [loopLeaseKey, activeConnectionKey] of loopConnectionKeysByLeaseKey) {
      if (activeConnectionKey === connectionKey) {
        loopConnectionKeysByLeaseKey.delete(loopLeaseKey)
      }
    }
    lease?.release()
  }

  const stopRemoteLoopsForServerAccounts = (server: ResolvedRelayServer, authStore: OneWorksAuthStore) => {
    for (const account of authStore.accounts) {
      if (accountMatchesRelayServer(account, server)) {
        stopRemoteLoop(account.accountKey)
      }
    }
  }

  const stopRemoteLoops = () => {
    for (const serverId of new Set([...heartbeats.keys(), ...sessionWorkers.keys()])) {
      stopRemoteLoop(serverId)
    }
  }

  const resolveWorkspaceProxyAuth = async (
    server: ResolvedRelayServer,
    providedAuthStore?: OneWorksAuthStore
  ) => {
    const store = await deviceStore.readStore()
    const storedServer = getStoredServer(store, server)
    const authStore = providedAuthStore ?? await readOneWorksAuthStore()
    const isUsableAccount = (item: OneWorksAuthAccount) => (
      accountMatchesRelayServer(item, server) &&
      item.enabled !== false &&
      isSessionAuthenticated(item)
    )
    const account = authStore.accounts.find(item =>
      isUsableAccount(item) &&
      normalizeRemoteBaseUrl(item.serverUrl) === normalizeRemoteBaseUrl(server.remoteBaseUrl)
    ) ?? authStore.accounts.find(isUsableAccount)
    const token = account?.sessionToken || storedServer?.sessionToken || ''
    if (token === '') {
      throw new Error('Relay login session expired. Sign in again before opening this remote workspace.')
    }
    return token
  }

  const requestRelayWorkspaceJob = async (
    entry: RelayWorkspaceJobTarget,
    payload: Record<string, unknown>
  ) => {
    const response = await fetch(
      new URL(`/api/relay/devices/${encodeURIComponent(entry.deviceId)}/workspace/requests`, entry.remoteBaseUrl),
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${entry.authToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          request: payload
        })
      }
    )
    const body = await readResponseJson(response)
    if (!response.ok) {
      throw new Error(toString(body.error) || `Relay workspace request failed with ${response.status}.`)
    }
    const job = isRecord(body.job) ? body.job : undefined
    const jobId = toString(job?.id)
    if (jobId === '') {
      throw new Error('Relay workspace request did not return a job id.')
    }
    return jobId
  }

  const readRelayWorkspaceJob = async (entry: RelayWorkspaceJobTarget, jobId: string) => {
    const response = await fetch(
      new URL(`/api/relay/session-jobs/${encodeURIComponent(jobId)}`, entry.remoteBaseUrl),
      {
        headers: {
          authorization: `Bearer ${entry.authToken}`
        }
      }
    )
    const body = await readResponseJson(response)
    if (!response.ok) {
      throw new Error(toString(body.error) || `Relay workspace job check failed with ${response.status}.`)
    }
    return isRecord(body.job) ? body.job : {}
  }

  const readRelayWorkspaceJobResult = async (entry: RelayWorkspaceJobTarget, jobId: string) => {
    const response = await fetch(
      new URL(`/api/relay/session-jobs/${encodeURIComponent(jobId)}/result`, entry.remoteBaseUrl),
      {
        headers: {
          authorization: `Bearer ${entry.authToken}`
        }
      }
    )
    const body = await readResponseJson(response)
    if (!response.ok) {
      throw new Error(toString(body.error) || `Relay workspace job result failed with ${response.status}.`)
    }
    return readResultBody(body)
  }

  const waitForRelayWorkspaceJobResult = async (entry: RelayWorkspaceJobTarget, jobId: string) => {
    const startedAt = Date.now()
    const deadline = startedAt + WORKSPACE_PROXY_TIMEOUT_MS
    while (Date.now() < deadline) {
      const job = await readRelayWorkspaceJob(entry, jobId)
      const status = toString(job.status)
      if (status === 'succeeded') {
        return await readRelayWorkspaceJobResult(entry, jobId)
      }
      if (status === 'failed' || status === 'cancelled') {
        const errorCode = toString(job.errorCode)
        if (errorCode === 'payload_expired') {
          throw new RelayWorkspaceConnectionError(
            'Remote workspace request expired before the device picked it up. Wait for the remote device to reconnect before retrying.',
            {
              code: 'remote_device_offline',
              status: 503
            }
          )
        }
        throw new RelayWorkspaceConnectionError(errorCode || `Relay workspace job ${status}.`, {
          code: errorCode || 'remote_workspace_job_failed',
          status: 503
        })
      }
      await sleep(workspaceProxyPollInterval(Date.now() - startedAt))
    }
    throw new Error('Relay workspace request timed out.')
  }

  const submitWorkspaceWebSocketJob = async (
    entry: RelayWorkspaceProxyEntry,
    payload: Record<string, unknown>
  ) => {
    const jobId = await requestRelayWorkspaceJob(entry, {
      ...payload,
      requestId: randomUUID()
    })
    return await waitForRelayWorkspaceJobResult(entry, jobId)
  }

  const resolveWorkspaceJobTarget = async (body: Record<string, unknown>) => {
    const requestedServerId = readServerId(body)
    const deviceId = readTextField(body, 'deviceId')
    if (deviceId === '') {
      throw new Error('Remote device id is required.')
    }
    const authStore = await readOneWorksAuthStore()
    const server = resolveRelayServer(authStore, requestedServerId)
    if (server == null) {
      throw new Error(
        requestedServerId === ''
          ? 'Configure at least one relay server before using a remote workspace.'
          : `Unknown relay server: ${requestedServerId}.`
      )
    }
    const { authToken } = await resolveOnlineWorkspaceDevice(server, deviceId)
    return {
      server,
      target: {
        authToken,
        deviceId,
        remoteBaseUrl: server.remoteBaseUrl,
        serverId: server.id
      }
    }
  }

  const readWorkspaceHttpJsonResult = (result: ReturnType<typeof readResultBody>) => {
    if (!isRelayWorkspaceHttpResponse(result)) {
      throw new Error('Invalid workspace response.')
    }
    const bodyText = result.bodyBase64 == null
      ? ''
      : Buffer.from(result.bodyBase64, 'base64').toString('utf8')
    let body: unknown = {}
    if (bodyText !== '') {
      try {
        body = JSON.parse(bodyText) as unknown
      } catch (error) {
        if (result.status < 200 || result.status >= 300) {
          throw new RelayWorkspaceHttpError(
            bodyText.trim() || `Remote workspace request failed with ${result.status}.`,
            {
              code: 'workspace_response_not_json',
              details: {
                body: bodyText,
                parseError: error instanceof Error ? error.message : String(error)
              },
              status: result.status
            }
          )
        }
        throw new Error('Invalid workspace response body.')
      }
    }
    if (!isRecord(body)) {
      throw new Error('Invalid workspace response body.')
    }
    if (result.status < 200 || result.status >= 300) {
      const errorPayload = isRecord(body.error) ? body.error : undefined
      const message = toString(errorPayload?.message) ||
        toString(body.error) ||
        `Remote workspace request failed with ${result.status}.`
      throw new RelayWorkspaceHttpError(message, {
        code: toString(errorPayload?.code) || undefined,
        details: errorPayload?.details,
        status: result.status
      })
    }
    const data = body.success === true && isRecord(body.data) ? body.data : body
    return data
  }

  const isRestartableWorkspaceVersionConflict = (error: unknown) => (
    error instanceof RelayWorkspaceHttpError &&
    error.code === 'workspace_server_version_conflict' &&
    isRecord(error.details) &&
    error.details.restartable === true
  )

  const submitWorkspaceHttpJson = async (
    entry: RelayWorkspaceJobTarget,
    input: {
      body?: unknown
      method?: string
      path: string
      serverBaseUrl?: string
      timeoutMs?: number
    }
  ) => {
    const bodyText = input.body == null ? undefined : JSON.stringify(input.body)
    const jobId = await requestRelayWorkspaceJob(entry, {
      mode: RELAY_WORKSPACE_HTTP_MODE,
      method: input.method ?? (bodyText == null ? 'GET' : 'POST'),
      path: input.path,
      headers: bodyText == null ? undefined : { 'content-type': 'application/json' },
      ...(bodyText == null ? {} : { bodyBase64: Buffer.from(bodyText).toString('base64') }),
      ...(input.serverBaseUrl == null ? {} : { serverBaseUrl: input.serverBaseUrl }),
      ...(input.timeoutMs == null ? {} : { timeoutMs: input.timeoutMs }),
      requestId: randomUUID()
    })
    return readWorkspaceHttpJsonResult(await waitForRelayWorkspaceJobResult(entry, jobId))
  }

  const handleWorkspaceProxyWebSocketEvent = (
    socket: WebSocket,
    event: RelayWorkspaceWebSocketEvent
  ) => {
    if (!isRelayWorkspaceWebSocketOpen(socket)) return false
    if (event.type === 'open') return true
    if (event.type === 'message') {
      const data = Buffer.from(event.dataBase64 ?? '', 'base64')
      socket.send(event.isBinary === true ? data : data.toString('utf8'))
      return true
    }
    if (event.type === 'error') {
      socket.close(1011, event.message || 'Relay workspace WebSocket failed.')
      return false
    }
    socket.close(event.code ?? 1000, event.reason || 'Relay workspace WebSocket closed.')
    return false
  }

  const pumpWorkspaceProxyWebSocketEvents = async (
    entry: RelayWorkspaceProxyEntry,
    channelId: string,
    socket: WebSocket,
    isStopped: () => boolean
  ) => {
    while (!isStopped()) {
      try {
        const result = await submitWorkspaceWebSocketJob(entry, {
          mode: RELAY_WORKSPACE_WS_RECEIVE_MODE,
          channelId
        })
        const events = readWorkspaceWebSocketEvents(result)
        for (const event of events) {
          if (!handleWorkspaceProxyWebSocketEvent(socket, event)) {
            return
          }
        }
        if (events.length === 0) {
          await sleep(WORKSPACE_WS_RECEIVE_EMPTY_POLL_MS)
        }
      } catch (error) {
        ctx.logger.warn(
          { err: error, scope: ctx.scope, serverId: entry.serverId, deviceId: entry.deviceId },
          '[relay] workspace WebSocket event pump failed'
        )
        if (isRelayWorkspaceWebSocketOpen(socket)) {
          socket.close(1011, error instanceof Error ? error.message : String(error))
        }
        return
      }
    }
  }

  const handleWorkspaceProxyWebSocket = (
    entry: RelayWorkspaceProxyEntry,
    req: IncomingMessage,
    socket: WebSocket
  ) => {
    const channelId = randomUUID()
    let stopped = false
    const isStopped = () => stopped || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING
    const path = (() => {
      const url = new URL(req.url ?? '/ws', entry.baseUrl)
      return `${url.pathname}${url.search}`
    })()
    const openPromise = ensureWorkspaceProxyEntryOnline(entry).then(async () =>
      await submitWorkspaceWebSocketJob(entry, {
        mode: RELAY_WORKSPACE_WS_OPEN_MODE,
        channelId,
        path,
        serverBaseUrl: entry.targetServerBaseUrl
      })
    )

    openPromise
      .then(() => {
        void pumpWorkspaceProxyWebSocketEvents(entry, channelId, socket, isStopped)
      })
      .catch(error => {
        ctx.logger.warn(
          { err: error, scope: ctx.scope, serverId: entry.serverId, deviceId: entry.deviceId },
          '[relay] workspace WebSocket open failed'
        )
        if (isRelayWorkspaceWebSocketOpen(socket)) {
          socket.close(1011, error instanceof Error ? error.message : String(error))
        }
      })

    socket.on('message', (data, isBinary) => {
      void openPromise
        .then(async () => {
          if (isStopped()) return
          await submitWorkspaceWebSocketJob(entry, {
            mode: RELAY_WORKSPACE_WS_SEND_MODE,
            channelId,
            dataBase64: rawWebSocketDataToBuffer(data).toString('base64'),
            isBinary
          })
        })
        .catch(error => {
          ctx.logger.warn(
            { err: error, scope: ctx.scope, serverId: entry.serverId, deviceId: entry.deviceId },
            '[relay] workspace WebSocket send failed'
          )
          if (isRelayWorkspaceWebSocketOpen(socket)) {
            socket.close(1011, error instanceof Error ? error.message : String(error))
          }
        })
    })

    socket.on('close', (code, reason) => {
      stopped = true
      void submitWorkspaceWebSocketJob(entry, {
        mode: RELAY_WORKSPACE_WS_CLOSE_MODE,
        channelId,
        code,
        reason: reason.toString()
      }).catch(error => {
        ctx.logger.warn(
          { err: error, scope: ctx.scope, serverId: entry.serverId, deviceId: entry.deviceId },
          '[relay] workspace WebSocket close forwarding failed'
        )
      })
    })
  }

  const handleWorkspaceProxyHttpRequest = async (
    entry: RelayWorkspaceProxyEntry,
    req: IncomingMessage,
    res: ServerResponse
  ) => {
    if (req.method === 'OPTIONS') {
      writeProxyCorsHeaders(res, req)
      res.writeHead(204)
      res.end()
      return
    }
    try {
      await ensureWorkspaceProxyEntryOnline(entry)
      const url = new URL(req.url ?? '/', entry.baseUrl)
      const body = await readIncomingRequestBody(req)
      const jobId = await requestRelayWorkspaceJob(entry, {
        method: req.method ?? 'GET',
        path: `${url.pathname}${url.search}`,
        headers: filterProxyRequestHeaders(req.headers),
        ...(body.length === 0 ? {} : { bodyBase64: body.toString('base64') }),
        serverBaseUrl: entry.targetServerBaseUrl,
        requestId: randomUUID()
      })
      const result = await waitForRelayWorkspaceJobResult(entry, jobId)
      writeWorkspaceProxyResponse(res, result, req)
    } catch (error) {
      ctx.logger.warn(
        { err: error, scope: ctx.scope, serverId: entry.serverId, deviceId: entry.deviceId },
        '[relay] workspace proxy request failed'
      )
      const status = error instanceof RelayWorkspaceConnectionError ? error.status : 502
      sendProxyJson(res, status, {
        ...(error instanceof RelayWorkspaceConnectionError ? { code: error.code } : {}),
        error: error instanceof Error ? error.message : String(error)
      }, req)
    }
  }

  const listenWorkspaceProxy = async (entry: Omit<RelayWorkspaceProxyEntry, 'baseUrl' | 'server'>) => {
    let proxyEntry: RelayWorkspaceProxyEntry | undefined
    const webSocketServer = new WebSocketServer({ noServer: true })
    const server = createServer((req, res) => {
      const currentEntry = workspaceProxies.get(`${entry.serverId}:${entry.deviceId}:${entry.workspaceFolder}`) ??
        proxyEntry
      if (currentEntry == null) {
        sendProxyJson(res, 503, { error: 'Relay workspace proxy is starting.' }, req)
        return
      }
      void handleWorkspaceProxyHttpRequest(currentEntry, req, res)
    })
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const currentEntry = workspaceProxies.get(`${entry.serverId}:${entry.deviceId}:${entry.workspaceFolder}`) ??
        proxyEntry
      if (currentEntry == null) {
        socket.destroy()
        return
      }
      const pathname = (() => {
        try {
          return new URL(req.url ?? '/', currentEntry.baseUrl).pathname
        } catch {
          return ''
        }
      })()
      if (pathname !== '/ws') {
        socket.destroy()
        return
      }
      webSocketServer.handleUpgrade(req, socket, head, (ws) => {
        handleWorkspaceProxyWebSocket(currentEntry, req, ws)
      })
    })
    server.once('close', () => {
      webSocketServer.close()
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (address == null || typeof address === 'string') {
      server.close()
      throw new Error('Failed to start relay workspace proxy.')
    }
    proxyEntry = {
      ...entry,
      baseUrl: `http://127.0.0.1:${address.port}`,
      server
    }
    return proxyEntry
  }

  const listWorkspaceDirectories = async (payload?: unknown) => {
    const body = isRecord(payload) ? payload : {}
    const { server, target } = await resolveWorkspaceJobTarget(body)
    const directory = readTextField(body, 'directory')
    const url = new URL('/api/launcher/directories', server.remoteBaseUrl)
    if (directory !== '') {
      url.searchParams.set('directory', directory)
    }
    return await submitWorkspaceHttpJson(target, {
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      timeoutMs: 25_000
    })
  }

  const createWorkspaceInDirectory = async (payload?: unknown) => {
    const body = isRecord(payload) ? payload : {}
    const parentDirectory = readTextField(body, 'parentDirectory')
    const projectName = readTextField(body, 'projectName')
    if (parentDirectory === '' || projectName === '') {
      throw new Error('Remote parent directory and project name are required.')
    }
    const { target } = await resolveWorkspaceJobTarget(body)
    return await submitWorkspaceHttpJson(target, {
      body: {
        parentDirectory,
        projectName
      },
      method: 'POST',
      path: '/api/launcher/workspaces/create',
      timeoutMs: 40_000
    })
  }

  const openTargetWorkspaceServer = async (
    entry: RelayWorkspaceJobTarget,
    workspaceFolder: string
  ) => {
    const openWorkspace = async () =>
      await submitWorkspaceHttpJson(entry, {
        body: { workspaceFolder },
        method: 'POST',
        path: '/api/launcher/workspaces/open',
        timeoutMs: 40_000
      })
    const body = await openWorkspace().catch(async (error) => {
      if (!isRestartableWorkspaceVersionConflict(error)) {
        throw error
      }
      await submitWorkspaceHttpJson(entry, {
        body: { forget: false, workspaceFolder },
        method: 'POST',
        path: '/api/launcher/workspaces/stop',
        timeoutMs: 20_000
      })
      return await openWorkspace()
    })
    const serverBaseUrl = toString(body.serverBaseUrl)
    if (serverBaseUrl === '') {
      throw new Error('Remote workspace did not return a workspace server URL.')
    }
    return {
      serverBaseUrl,
      workspaceFolder: toString(body.workspaceFolder) || workspaceFolder,
      workspaceId: toString(body.workspaceId)
    }
  }

  const openWorkspaceProxy = async (payload?: unknown): Promise<RelayWorkspaceOpenResult> => {
    const body = isRecord(payload) ? payload : {}
    const requestedServerId = readServerId(body)
    const deviceId = readTextField(body, 'deviceId')
    const deviceName = readTextField(body, 'deviceName')
    const requestedServerName = readTextField(body, 'serverName')
    const workspaceFolder = readTextField(body, 'workspaceFolder')
    if (deviceId === '' || workspaceFolder === '') {
      throw new Error('Remote device id and workspace folder are required.')
    }
    const authStore = await readOneWorksAuthStore()
    const server = resolveRelayServer(authStore, requestedServerId)
    if (server == null) {
      throw new Error(
        requestedServerId === ''
          ? 'Configure at least one relay server before opening a remote workspace.'
          : `Unknown relay server: ${requestedServerId}.`
      )
    }

    const key = `${server.id}:${deviceId}:${workspaceFolder}`
    const existing = workspaceProxies.get(key)
    if (existing != null) {
      await ensureWorkspaceProxyEntryOnline(existing).catch(error => {
        disposeWorkspaceProxyEntry(existing)
        throw error
      })
      return {
        relay: {
          deviceId: existing.deviceId,
          ...(existing.deviceName == null ? {} : { deviceName: existing.deviceName }),
          serverId: existing.serverId,
          ...(existing.serverName == null ? {} : { serverName: existing.serverName }),
          workspaceFolder: existing.workspaceFolder
        },
        serverBaseUrl: existing.baseUrl,
        workspaceFolder: existing.workspaceFolder,
        workspaceId: existing.workspaceId
      }
    }

    const inFlight = workspaceProxyOpenPromises.get(key)
    if (inFlight != null) return await inFlight

    const openPromise = (async () => {
      const { authToken, device, sourceStore } = await resolveOnlineWorkspaceDevice(server, deviceId)
      const target = {
        authToken,
        deviceId,
        remoteBaseUrl: server.remoteBaseUrl,
        serverId: server.id
      }
      const targetWorkspace = await openTargetWorkspaceServer(target, workspaceFolder)
      const canonicalKey = `${server.id}:${deviceId}:${targetWorkspace.workspaceFolder}`
      const canonicalExisting = workspaceProxies.get(canonicalKey)
      if (canonicalExisting != null) {
        return {
          relay: {
            deviceId: canonicalExisting.deviceId,
            ...(canonicalExisting.deviceName == null ? {} : { deviceName: canonicalExisting.deviceName }),
            serverId: canonicalExisting.serverId,
            ...(canonicalExisting.serverName == null ? {} : { serverName: canonicalExisting.serverName }),
            workspaceFolder: canonicalExisting.workspaceFolder
          },
          serverBaseUrl: canonicalExisting.baseUrl,
          workspaceFolder: canonicalExisting.workspaceFolder,
          workspaceId: canonicalExisting.workspaceId
        }
      }
      const workspaceId = createRemoteWorkspaceId({
        deviceId,
        serverId: server.id,
        workspaceFolder: targetWorkspace.workspaceFolder
      })
      const entry = await listenWorkspaceProxy({
        authToken,
        deviceId,
        deviceName: deviceName || device.alias || device.name,
        remoteBaseUrl: server.remoteBaseUrl,
        serverId: server.id,
        serverName: requestedServerName || server.name,
        sourceDeviceId: sourceStore.deviceId,
        targetServerBaseUrl: targetWorkspace.serverBaseUrl,
        workspaceFolder: targetWorkspace.workspaceFolder,
        workspaceId
      })
      workspaceProxies.set(key, entry)
      workspaceProxies.set(canonicalKey, entry)
      return {
        relay: {
          deviceId: entry.deviceId,
          ...(entry.deviceName == null ? {} : { deviceName: entry.deviceName }),
          serverId: entry.serverId,
          ...(entry.serverName == null ? {} : { serverName: entry.serverName }),
          workspaceFolder: entry.workspaceFolder
        },
        serverBaseUrl: entry.baseUrl,
        workspaceFolder: entry.workspaceFolder,
        workspaceId
      }
    })()

    workspaceProxyOpenPromises.set(key, openPromise)
    try {
      return await openPromise
    } finally {
      if (workspaceProxyOpenPromises.get(key) === openPromise) {
        workspaceProxyOpenPromises.delete(key)
      }
    }
  }

  const getWorkspaceProxyConnection = async (payload?: unknown): Promise<RelayWorkspaceOpenResult> => {
    const body = isRecord(payload) ? payload : {}
    const workspaceId = readTextField(body, 'workspaceId')
    if (workspaceId === '') {
      throw new Error('Workspace id is required.')
    }
    const entry = Array.from(workspaceProxies.values()).find(item => item.workspaceId === workspaceId)
    if (entry != null) {
      await ensureWorkspaceProxyEntryOnline(entry).catch(error => {
        disposeWorkspaceProxyEntry(entry)
        throw error
      })
      return {
        relay: {
          deviceId: entry.deviceId,
          ...(entry.deviceName == null ? {} : { deviceName: entry.deviceName }),
          serverId: entry.serverId,
          ...(entry.serverName == null ? {} : { serverName: entry.serverName }),
          workspaceFolder: entry.workspaceFolder
        },
        serverBaseUrl: entry.baseUrl,
        workspaceFolder: entry.workspaceFolder,
        workspaceId: entry.workspaceId
      }
    }

    const store = await deviceStore.readStore()
    const authStore = await readOneWorksAuthStore()
    for (const server of listKnownRelayServers(authStore)) {
      const { devices } = await listRelayDevicesForServer(server, store, authStore, { force: true })
      for (const device of devices) {
        if (device.id == null || device.workspaceFolder == null || !isOnlineRemoteDevice(device)) continue
        const candidateWorkspaceId = createRemoteWorkspaceId({
          deviceId: device.id,
          serverId: server.id,
          workspaceFolder: device.workspaceFolder
        })
        if (candidateWorkspaceId !== workspaceId) continue
        return await openWorkspaceProxy({
          deviceId: device.id,
          deviceName: device.alias ?? device.name,
          serverId: server.id,
          serverName: server.name,
          workspaceFolder: device.workspaceFolder
        })
      }
    }

    throw new Error('Workspace not found.')
  }

  const getPublicStatus = async (
    configDistributionOverride?: RelayConfigDistributionStatus
  ): Promise<RelayPublicStatus> => {
    await serviceInfoHydration
    const options = normalizeOptions(ctx.options, ctx.runtime.role)
    const statusActiveServerId = state.activeServerId || options.activeServerId
    const resolvedStatusServer = statusActiveServerId === ''
      ? undefined
      : resolveActiveRelayServer(ctx.options, statusActiveServerId)
    const activeServer = resolvedStatusServer ??
      (state.activeServerId == null || state.activeServerId === '' ? resolveActiveRelayServer(ctx.options) : undefined)
    const summaryState = activeServer == null
      ? state
      : getConnectionState(activeServer)
    const publicActiveServerId = summaryState.activeServerId || activeServer?.id || options.activeServerId
    const store = await deviceStore.readStore()
    const authStore = await readOneWorksAuthStore()
    const storedActiveServer = activeServer == null ? undefined : getStoredServer(store, activeServer)
    const activeAccount = activeServer == null ? undefined : preferredAuthAccountForRelayServer(authStore, activeServer)
    const enrichDocumentSyncStatus = async (
      status: RelayPersonalDocumentSyncStatus,
      scope: RelayDocumentScope
    ): Promise<RelayPersonalDocumentSyncStatus> => ({
      ...status,
      entries: await listRelayDocumentEntries(scope).catch(() => status.entries ?? [])
    })
    const teamDocumentSync = activeServer == null
      ? {}
      : Object.fromEntries(
        await Promise.all(
          Object.entries(storedActiveServer?.teamDocumentSync ?? {}).map(async ([teamId, preferences]) => [
            teamId,
            await enrichDocumentSyncStatus(
              teamDocumentSyncStatuses.get(teamDocumentSyncStatusKey(activeServer.id, teamId)) ??
                createPersonalDocumentSyncStatus(preferences),
              { id: teamId, type: 'team' }
            )
          ])
        )
      )
    const projectRuleDocumentSync = activeServer == null
      ? {}
      : Object.fromEntries(
        await Promise.all(
          [...projectRuleDocumentSyncStatuses.entries()]
            .filter(([key]) => key.startsWith(`${activeServer.id}:`))
            .map(async ([key, value]) => {
              const assignmentId = key.slice(activeServer.id.length + 1)
              return [
                assignmentId,
                await enrichDocumentSyncStatus(value.status, {
                  id: assignmentId,
                  teamId: value.teamId,
                  type: 'projectRule'
                })
              ]
            })
        )
      )
    const basePersonalDocumentSync = personalDocumentSyncStatusServerId === activeServer?.id &&
        personalDocumentSyncStatus != null
      ? personalDocumentSyncStatus
      : createPersonalDocumentSyncStatus(readRelayPersonalDocumentSyncPreferences(storedActiveServer))
    const activeAccountId = toString(storedActiveServer?.account?.id) || toString(activeAccount?.userId)
    const personalDocumentSync = activeAccountId === ''
      ? basePersonalDocumentSync
      : await enrichDocumentSyncStatus(
        basePersonalDocumentSync,
        { id: activeAccountId, type: 'account' }
      )
    const serverStatuses = await Promise.all(
      createServerStatuses(store, options, getConnectionState, activeServer?.id).map(
        async (serverStatus) => {
          const server = options.servers.find(item => item.id === serverStatus.id)
          if (server == null) return serverStatus
          const serviceInfo = readRelayServiceInfo(server)
          const result = await listRelayDevicesForServer(server, store, authStore)
          return {
            ...serverStatus,
            ...serviceInfo,
            devices: result.devices,
            ...(result.error == null ? {} : { devicesError: result.error })
          }
        }
      )
    )
    const authStoreOnlyServerStatuses = await Promise.all(
      readAuthStoreServerCandidates(serverStatuses, authStore.servers).map(async (authServer) => {
        const server = authServerToResolvedRelayServer(authServer)
        if (server == null) return undefined
        const storedServer = getStoredServer(store, server)
        const account = preferredAuthAccountForRelayServer(authStore, server)
        const connection = getConnectionState(server)
        const serviceInfo = readRelayServiceInfo(server)
        const result = await listRelayDevicesForServer(server, store, authStore)
        const storedSessionAuthenticated = (storedServer?.sessionToken ?? '') !== '' &&
          (storedServer?.sessionExpiresAt == null || Date.parse(storedServer.sessionExpiresAt) > Date.now())
        return {
          ...authServerToPublicStatus(authServer, publicActiveServerId, {
            ...(account == null
              ? storedServer?.account == null ? {} : { account: storedServer.account }
              : { account: authAccountToRelayAccountProfile(account) }),
            connected: connection.state === 'registered',
            connection,
            devices: result.devices,
            ...(result.error == null ? {} : { devicesError: result.error }),
            hasToken: (storedServer?.deviceToken ?? '') !== '',
            registeredAt: storedServer?.registeredAt ?? null,
            sessionAuthenticated: account == null ? storedSessionAuthenticated : isSessionAuthenticated(account),
            sessionExpiresAt: account?.sessionExpiresAt ?? storedServer?.sessionExpiresAt ?? null,
            updatedAt: account?.updatedAt ?? storedServer?.updatedAt ?? null
          }),
          ...serviceInfo
        }
      })
    )
    return {
      configDistribution: configDistributionOverride ?? await readConfigDistributionStatus(),
      accounts: authStore.accounts.map(publicAuthAccount),
      options,
      personalDocumentSync,
      projectRuleDocumentSync,
      teamDocumentSync,
      servers: [
        ...serverStatuses,
        ...authStoreOnlyServerStatuses.filter((server): server is RelayPublicServerStatus => server != null)
      ],
      device: {
        id: store.deviceId,
        name: store.deviceName || options.deviceName,
        hasToken: (storedActiveServer?.deviceToken ?? '') !== '',
        registeredAt: storedActiveServer?.registeredAt ?? null,
        updatedAt: storedActiveServer?.updatedAt ?? null
      },
      connection: {
        ...summaryState,
        activeServerId: publicActiveServerId,
        remoteBaseUrl: summaryState.remoteBaseUrl || activeServer?.remoteBaseUrl || ''
      },
      storePath: deviceStore.storePath
    }
  }

  const refreshConfigDistribution = async (payload?: unknown) => {
    const configDistribution = await refreshConfigDistributionStatus(payload)
    return await getPublicStatus(configDistribution)
  }

  const setConfigSourceEnabled = async (payload?: unknown) => {
    const body = isRecord(payload) ? payload : {}
    const kind = readRelayConfigSourceKind(body.kind)
    const id = readOptionalText(body.id)
    if (kind == null || id == null) {
      throw new Error('Config source kind and id are required.')
    }
    if (typeof body.enabled !== 'boolean') {
      throw new TypeError('Config source enabled state must be a boolean.')
    }
    const requestedServerId = readServerId(payload)
    const authStore = await readOneWorksAuthStore()
    const activeServer = resolveRelayServer(authStore, requestedServerId)
    if (activeServer == null) {
      throw new Error(
        requestedServerId === ''
          ? 'Configure at least one relay server before changing relay config source state.'
          : `Unknown relay server: ${requestedServerId}.`
      )
    }
    const store = await deviceStore.readStore()
    const previous = getStoredServer(store, activeServer)
    const preferences = updateRelayConfigSourcePreference(
      readRelayConfigSourcePreferences(previous),
      kind,
      id,
      body.enabled
    )
    const serializedPreferences = serializeRelayConfigSourcePreferences(preferences)
    const updatedAt = new Date().toISOString()
    await deviceStore.writeStore({
      ...store,
      servers: {
        ...store.servers,
        [activeServer.id]: {
          ...(previous ?? {
            deviceToken: '',
            id: activeServer.id,
            remoteBaseUrl: activeServer.remoteBaseUrl
          }),
          configDisabledSources: serializedPreferences,
          updatedAt
        }
      }
    })
    const { snapshot } = await readRelayConfigSnapshotWithGlobalFallback({
      projectHome: ctx.projectHome
    })
    configDistributionStatus = snapshotToConfigDistributionStatus(snapshot, preferences)
    return await getPublicStatus(configDistributionStatus)
  }

  const setPersonalDocumentSyncEnabled = async (payload?: unknown) => {
    const body = isRecord(payload) ? payload : {}
    const kind = readRelayPersonalDocumentSyncKind(body.kind)
    if (kind == null) {
      throw new Error('Personal document sync kind is required.')
    }
    if (typeof body.enabled !== 'boolean') {
      throw new TypeError('Personal document sync enabled state must be a boolean.')
    }
    const requestedServerId = readServerId(payload)
    const authStore = await readOneWorksAuthStore()
    const activeServer = resolveRelayServer(authStore, requestedServerId)
    if (activeServer == null) {
      throw new Error(
        requestedServerId === ''
          ? 'Configure at least one relay server before changing personal document sync.'
          : `Unknown relay server: ${requestedServerId}.`
      )
    }
    const store = await deviceStore.readStore()
    const previous = getStoredServer(store, activeServer)
    const preferences = updateRelayPersonalDocumentSyncPreference(
      readRelayPersonalDocumentSyncPreferences(previous),
      kind,
      body.enabled
    )
    const serializedPreferences = serializeRelayPersonalDocumentSyncPreferences(preferences)
    const updatedAt = new Date().toISOString()
    const previousServer = previous ?? {
      deviceToken: '',
      id: activeServer.id,
      remoteBaseUrl: activeServer.remoteBaseUrl
    }
    const { personalDocumentSync: _previousPersonalDocumentSync, ...previousWithoutPersonalDocumentSync } =
      previousServer
    const nextStoredServer = {
      ...previousWithoutPersonalDocumentSync,
      ...(serializedPreferences == null ? {} : { personalDocumentSync: serializedPreferences }),
      updatedAt
    }
    await deviceStore.writeStore({
      ...store,
      servers: {
        ...store.servers,
        [activeServer.id]: nextStoredServer
      }
    })

    if ((nextStoredServer.deviceToken ?? '') === '') {
      personalDocumentSyncStatus = createPersonalDocumentSyncStatus(preferences)
      personalDocumentSyncStatusServerId = activeServer.id
      return await getPublicStatus(configDistributionStatus)
    }

    const result = await syncRelayConfigSnapshot({
      ctx,
      server: activeServer,
      storedServer: nextStoredServer
    })
    personalDocumentSyncStatus = result.personalDocuments ?? createPersonalDocumentSyncStatus(preferences)
    personalDocumentSyncStatusServerId = activeServer.id
    recordProjectRuleDocumentSyncStatuses(activeServer.id, result)
    configDistributionStatus = snapshotToConfigDistributionStatus(
      result.snapshot,
      readRelayConfigSourcePreferencesForSnapshot(
        {
          ...store,
          servers: {
            ...store.servers,
            [activeServer.id]: nextStoredServer
          }
        },
        result.snapshot
      )
    )
    return await getPublicStatus(configDistributionStatus)
  }

  const importPersonalDocumentRootAgents = async (payload?: unknown) => {
    const selection = await selectAuthAccount(payload)
    if ('selectionRequired' in selection) {
      throw new Error(selection.message)
    }
    const accountId = selection.account.userId.trim()
    if (accountId === '') {
      throw new Error('当前账号缺少账号 ID，无法同步 AGENTS.md。')
    }

    const requestedServerId = readServerId(payload) || selection.account.serverId
    const activeServer = resolveRelayServer(selection.store, requestedServerId) ?? (() => {
      const remoteBaseUrl = normalizeRemoteBaseUrl(selection.account.serverUrl)
      if (remoteBaseUrl === '') return undefined
      try {
        const url = new URL(remoteBaseUrl)
        const port = url.port === '' ? undefined : Number(url.port)
        return {
          id: selection.account.serverId,
          name: serverAliasForId(selection.account.serverId),
          pairingToken: '',
          pairingTokenConfigured: false,
          ...(Number.isFinite(port) ? { port } : {}),
          protocol: url.protocol === 'https:' ? 'https' as const : 'http' as const,
          remoteBaseUrl,
          server: url.hostname
        }
      } catch {
        return undefined
      }
    })()
    if (activeServer == null) {
      throw new Error(`Unknown relay server: ${requestedServerId}.`)
    }

    const store = await deviceStore.readStore()
    const previous = getStoredServer(store, activeServer)
    const preferences = updateRelayPersonalDocumentSyncPreference(
      readRelayPersonalDocumentSyncPreferences(previous),
      'agents',
      true
    )
    const serializedPreferences = serializeRelayPersonalDocumentSyncPreferences(preferences)
    const previousServer = previous ?? {
      deviceToken: '',
      id: activeServer.id,
      remoteBaseUrl: activeServer.remoteBaseUrl
    }
    const { personalDocumentSync: _previousPersonalDocumentSync, ...previousWithoutPersonalDocumentSync } =
      previousServer
    const nextStoredServer = {
      ...previousWithoutPersonalDocumentSync,
      ...(serializedPreferences == null ? {} : { personalDocumentSync: serializedPreferences }),
      updatedAt: new Date().toISOString()
    }
    await deviceStore.writeStore({
      ...store,
      servers: {
        ...store.servers,
        [activeServer.id]: nextStoredServer
      }
    })

    try {
      personalDocumentSyncStatus = await syncRelayPersonalDocuments({
        accountId,
        deviceToken: nextStoredServer.deviceToken ?? '',
        importRootAgents: true,
        server: activeServer,
        storedServer: nextStoredServer
      })
    } catch (error) {
      personalDocumentSyncStatus = createPersonalDocumentSyncStatus(preferences, {
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
    personalDocumentSyncStatusServerId = activeServer.id
    return await getPublicStatus(configDistributionStatus)
  }

  const setTeamDocumentSyncEnabled = async (payload?: unknown) => {
    const body = isRecord(payload) ? payload : {}
    const kind = readRelayPersonalDocumentSyncKind(body.kind)
    const teamId = readOptionalText(body.teamId)
    if (kind == null) {
      throw new Error('Team document sync kind is required.')
    }
    if (teamId == null) {
      throw new Error('Team id is required for team document sync.')
    }
    if (typeof body.enabled !== 'boolean') {
      throw new TypeError('Team document sync enabled state must be a boolean.')
    }

    const selection = await selectAuthAccount(payload)
    if ('selectionRequired' in selection) {
      throw new Error(selection.message)
    }
    const requestedServerId = readServerId(payload) || selection.account.serverId
    const activeServer = resolveRelayServer(selection.store, requestedServerId) ?? (() => {
      const remoteBaseUrl = normalizeRemoteBaseUrl(selection.account.serverUrl)
      if (remoteBaseUrl === '') return undefined
      try {
        const url = new URL(remoteBaseUrl)
        const port = url.port === '' ? undefined : Number(url.port)
        return {
          id: selection.account.serverId,
          name: serverAliasForId(selection.account.serverId),
          pairingToken: '',
          pairingTokenConfigured: false,
          ...(Number.isFinite(port) ? { port } : {}),
          protocol: url.protocol === 'https:' ? 'https' as const : 'http' as const,
          remoteBaseUrl,
          server: url.hostname
        }
      } catch {
        return undefined
      }
    })()
    if (activeServer == null) {
      throw new Error(`Unknown relay server: ${requestedServerId}.`)
    }

    const store = await deviceStore.readStore()
    const previous = getStoredServer(store, activeServer)
    const teamDocumentSync = updateRelayTeamDocumentSyncPreference(previous, teamId, kind, body.enabled)
    const previousServer = previous ?? {
      deviceToken: '',
      id: activeServer.id,
      remoteBaseUrl: activeServer.remoteBaseUrl
    }
    const { teamDocumentSync: _previousTeamDocumentSync, ...previousWithoutTeamDocumentSync } = previousServer
    const nextStoredServer: RelayStoredServer = {
      ...previousWithoutTeamDocumentSync,
      ...(teamDocumentSync == null ? {} : { teamDocumentSync }),
      updatedAt: new Date().toISOString()
    }
    await deviceStore.writeStore({
      ...store,
      servers: {
        ...store.servers,
        [activeServer.id]: nextStoredServer
      }
    })

    const preferences = readRelayTeamDocumentSyncPreferences(nextStoredServer, teamId)
    const statusKey = teamDocumentSyncStatusKey(activeServer.id, teamId)
    if (!isSessionAuthenticated(selection.account)) {
      teamDocumentSyncStatuses.set(
        statusKey,
        createPersonalDocumentSyncStatus(preferences, {
          lastError: '当前账号没有有效登录会话，开关已保存，重新登录后可同步团队文档。'
        })
      )
      return await getPublicStatus(configDistributionStatus)
    }

    try {
      teamDocumentSyncStatuses.set(
        statusKey,
        await syncRelayTeamDocuments({
          preferences,
          server: activeServer,
          sessionToken: selection.account.sessionToken ?? '',
          teamId
        })
      )
    } catch (error) {
      teamDocumentSyncStatuses.set(
        statusKey,
        createPersonalDocumentSyncStatus(preferences, {
          lastError: error instanceof Error ? error.message : String(error)
        })
      )
    }
    return await getPublicStatus(configDistributionStatus)
  }

  const openDocumentPath = async (payload?: unknown) => {
    const body = isRecord(payload) ? payload : {}
    const path = toString(body.path)
    if (path === '') {
      throw new Error('文档路径不能为空。')
    }
    return await openRelayDocumentPath(path, toString(body.mode) === 'reveal' ? 'reveal' : 'open')
  }

  const readDocumentContent = async (payload?: unknown) => {
    const body = isRecord(payload) ? payload : {}
    const path = toString(body.path)
    if (path === '') {
      throw new Error('文档路径不能为空。')
    }
    return await readRelayDocumentContent(path)
  }

  const listDocumentEntries = async (payload?: unknown) => {
    const body = isRecord(payload) ? payload : {}
    const selection = await selectAuthAccount(payload)
    if ('selectionRequired' in selection) {
      throw new Error(selection.message)
    }
    if (toString(body.scope) === 'team') {
      const teamId = readOptionalText(body.teamId)
      if (teamId == null) {
        throw new Error('Team id is required for team documents.')
      }
      if (isRelayFixtureAuthAccount(selection.account)) {
        await ensureRelayFixtureDocumentEntries({ id: teamId, type: 'team' })
      }
      return {
        entries: await listRelayDocumentEntries({ id: teamId, type: 'team' })
      }
    }
    if (toString(body.scope) === 'projectRule') {
      const assignmentId = readOptionalText(body.assignmentId)
      const teamId = readOptionalText(body.teamId)
      if (assignmentId == null || teamId == null) {
        throw new Error('Assignment id and team id are required for project rule documents.')
      }
      const scope: RelayDocumentScope = {
        id: assignmentId,
        teamId,
        type: 'projectRule'
      }
      if (isRelayFixtureAuthAccount(selection.account)) {
        await ensureRelayFixtureDocumentEntries(scope)
      }
      return {
        entries: await listRelayDocumentEntries(scope)
      }
    }

    const accountId = selection.account.userId.trim()
    if (accountId === '') {
      throw new Error('当前账号缺少账号 ID，无法读取文档列表。')
    }
    if (isRelayFixtureAuthAccount(selection.account)) {
      await ensureRelayFixtureDocumentEntries({ id: accountId, type: 'account' })
    }
    return {
      entries: await listRelayDocumentEntries({ id: accountId, type: 'account' })
    }
  }

  const getConfigShareTargets = async (payload?: unknown) => await getRelayConfigShareTargets(ctx, payload)

  const getConfigShareProfileDetail = async (payload?: unknown) => await getRelayConfigShareProfileDetail(ctx, payload)

  const publishConfigShareDraft = async (payload?: unknown) => await publishRelayConfigShareDraft(ctx, payload)

  const updateConfigShareAssignment = async (payload?: unknown) => await updateRelayConfigShareAssignment(ctx, payload)

  const resolveAccountCommandServer = (payload?: unknown) => {
    const requestedServerId = readServerId(payload) || 'cf'
    const activeServer = resolveActiveRelayServer(ctx.options, requestedServerId)
    if (activeServer == null) {
      throw new Error(`Unknown relay server: ${requestedServerId}.`)
    }
    return activeServer
  }

  const accountSelectionRequired = (accounts: OneWorksAuthAccount[], message: string) => ({
    ok: false,
    selectionRequired: true,
    message,
    candidates: accounts.map(publicAuthAccount)
  })

  const selectAuthAccount = async (payload?: unknown) => {
    const store = await readOneWorksAuthStore()
    const accountKey = readTextField(payload, 'accountKey')
    if (accountKey !== '') {
      const account = store.accounts.find(item => item.accountKey === accountKey)
      if (account == null) throw new Error(`Unknown OneWorks account: ${accountKey}.`)
      return { account, store }
    }

    const server = resolveAccountCommandServer(payload)
    const selector = readUserSelector(payload)
    const accounts = store.accounts
      .filter(account => accountMatchesRelayServer(account, server))
      .filter(account => accountMatchesSelector(account, selector))

    if (accounts.length === 1) return { account: accounts[0], store }
    if (accounts.length > 1) {
      return accountSelectionRequired(
        accounts,
        selector === ''
          ? `Multiple OneWorks accounts are available on ${server.name}.`
          : `Multiple OneWorks accounts match "${selector}" on ${server.name}.`
      )
    }
    return accountSelectionRequired(
      accounts,
      selector === ''
        ? `No OneWorks account found on ${server.name}. Run "oneworks login -s ${serverAliasForId(server.id)}" first.`
        : `No OneWorks account matches "${selector}" on ${server.name}.`
    )
  }

  const selectProfileAuthAccount = async (payload?: unknown) => {
    const store = await readOneWorksAuthStore()
    const accountKey = readTextField(payload, 'accountKey')
    if (accountKey !== '') {
      const account = store.accounts.find(item => item.accountKey === accountKey)
      if (account == null) throw new Error(`Unknown OneWorks account: ${accountKey}.`)
      return { account, store }
    }

    const requestedServerId = readServerId(payload)
    const selector = readUserSelector(payload)
    const scopedAccounts = requestedServerId === ''
      ? store.accounts
      : store.accounts.filter(account => {
        const server = resolveRelayServer(store, requestedServerId)
        if (server == null) throw new Error(`Unknown relay server: ${requestedServerId}.`)
        return accountMatchesRelayServer(account, server)
      })
    const matchedAccounts = selector === ''
      ? scopedAccounts
      : scopedAccounts.filter(account => accountMatchesSelector(account, selector))
    const signedInAccounts = matchedAccounts.filter(isSessionAuthenticated)
    const candidates = signedInAccounts.length === 0 ? matchedAccounts : signedInAccounts
    const enabledCandidates = candidates.filter(account => account.enabled)

    if (enabledCandidates.length === 1) return { account: enabledCandidates[0], store }
    if (candidates.length === 1) return { account: candidates[0], store }

    return accountSelectionRequired(
      candidates,
      candidates.length === 0
        ? 'No signed-in OneWorks account found. Sign in first.'
        : selector === ''
        ? 'Multiple OneWorks accounts are available. Choose the account to operate on.'
        : `Multiple OneWorks accounts match "${selector}". Choose the account to operate on.`
    )
  }

  const updateProfileAuthAccount = async (
    store: OneWorksAuthStore,
    account: OneWorksAuthAccount,
    user: RelayProfileCurrentUser,
    session?: RelayProfileSessionSummary
  ) => {
    if (user.id !== account.userId) {
      throw new Error('Relay login session belongs to a different account.')
    }
    const updatedAt = new Date().toISOString()
    const updatedAccount = {
      ...account,
      ...(user.avatarUrl == null ? {} : { avatarUrl: user.avatarUrl }),
      email: user.email,
      ...(user.loginId == null ? {} : { loginId: user.loginId }),
      name: user.name,
      role: user.role,
      ...(session?.expiresAt == null ? {} : { sessionExpiresAt: session.expiresAt }),
      updatedAt
    } satisfies OneWorksAuthAccount
    const nextStore = upsertOneWorksAuthAccount(store, updatedAccount)
    await writeOneWorksAuthStore(nextStore)
    return {
      account: updatedAccount,
      store: nextStore
    }
  }

  const profileAuditPath = (payload?: unknown) => {
    const params = new URLSearchParams()
    for (const key of ['from', 'key', 'path', 'status', 'to']) {
      const value = readTextField(payload, key)
      if (value !== '') params.set(key, value)
    }
    const query = params.toString()
    return `/api/profile/openapi-audit${query === '' ? '' : `?${query}`}`
  }

  const markCurrentClientDevices = async (
    devices: RelayRemoteDeviceSummary[]
  ): Promise<RelayRemoteDeviceSummary[]> => {
    const store = await deviceStore.readStore()
    const currentDeviceId = store.deviceId.trim()
    if (currentDeviceId === '') return devices
    return devices.map(device => {
      if (device.id !== currentDeviceId) return device
      return {
        ...device,
        isCurrentClientDevice: true
      }
    })
  }

  const getFixtureProfile = (
    store: OneWorksAuthStore,
    account: OneWorksAuthAccount
  ): RelayProfileStatus => {
    const now = new Date().toISOString()
    const user = fixtureProfileUser(account)
    const messageUser = fixtureProfileMessageUser(user)
    const server = store.servers[account.serverId]
    const serverName = server?.name ?? server?.id ?? account.serverId
    const teamId = `${account.serverId}:team`
    const teamName = serverName === '' ? 'Fixture Workspace' : serverName
    const teamSlug = teamName.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'fixture'
    const fixtureDeviceId = `fixture-device:${account.accountKey}`
    const fixtureDeviceAlias = fixtureDeviceAliasesByAccountKey.get(account.accountKey)?.get(fixtureDeviceId)

    return {
      ok: true,
      account: publicAuthAccount(account),
      accounts: store.accounts.map(publicAuthAccount),
      auditEvents: [{
        createdAt: now,
        error: null,
        id: `fixture-audit:${account.accountKey}`,
        ip: '127.0.0.1',
        method: 'GET',
        path: '/api/profile/account',
        permission: 'fixture.profile.read',
        status: 200,
        tokenId: 'fixture-token',
        tokenPreview: 'fixture...',
        userAgent: 'OneWorks fixture',
        userId: user.id
      }],
      devices: [{
        ...(fixtureDeviceAlias == null ? {} : { alias: fixtureDeviceAlias }),
        id: fixtureDeviceId,
        lastSeenAt: now,
        name: 'Fixture Device',
        pluginScope: ctx.scope,
        status: 'online',
        workspaceFolder: ctx.workspaceFolder
      }],
      invitations: [],
      messages: [{
        audience: {
          scope: 'users',
          team: null,
          teamId: null,
          userIds: [user.id],
          users: [messageUser]
        },
        body: `这是 ${user.name} 的本地调试账号消息。`,
        createdAt: now,
        createdBy: messageUser,
        createdByUserId: user.id,
        id: `fixture-message:${account.accountKey}`,
        kind: 'system',
        title: 'Fixture 账号消息',
        updatedAt: null
      }],
      security: {
        ...emptyProfileSecuritySummary(user),
        accessTokens: fixtureAccessTokensFor(account.accountKey)
      },
      session: {
        ...(account.sessionExpiresAt == null ? {} : { expiresAt: account.sessionExpiresAt }),
        lastSeenAt: now
      },
      teams: [{
        archivedAt: null,
        avatarUrl: null,
        configEnabled: true,
        defaultForPublishing: account.role === 'owner',
        description: 'Local Relay account fixture team.',
        id: teamId,
        memberCount: store.accounts.filter(item => item.serverId === account.serverId).length,
        membership: {
          configEnabled: true,
          defaultForPublishing: account.role === 'owner',
          groupIds: [],
          role: account.role ?? 'member'
        },
        name: teamName,
        role: account.role,
        slug: teamSlug,
        updatedAt: now
      }],
      user
    }
  }

  const resolveProfileFallbackServer = (
    store: OneWorksAuthStore,
    account: OneWorksAuthAccount
  ): Pick<ResolvedRelayServer, 'id' | 'remoteBaseUrl'> | undefined => {
    const resolved = resolveRelayServer(store, account.serverId)
    if (resolved != null) return resolved
    const remoteBaseUrl = normalizeRemoteBaseUrl(account.serverUrl)
    if (remoteBaseUrl === '') return undefined
    return {
      id: account.serverId,
      remoteBaseUrl
    }
  }

  const getDegradedProfile = async (
    selection: {
      account: OneWorksAuthAccount
      store: OneWorksAuthStore
    },
    error: unknown
  ): Promise<RelayProfileStatus> => {
    const user = localProfileUserFromAuthAccount(selection.account)
    const server = resolveProfileFallbackServer(selection.store, selection.account)
    const store = await deviceStore.readStore()
    const devicesResult: RelayMergedDeviceListResult = server == null
      ? { authTokensByDeviceId: new Map(), devices: [] }
      : await listRelayDevicesForServer(server, store, selection.store)
    const errors: NonNullable<RelayProfileStatus['errors']> = {
      profile: relayFetchErrorMessage(error) || 'Relay account profile is unavailable.'
    }
    if (devicesResult.error != null) {
      errors.devices = devicesResult.error
    }
    const session = profileSessionFromAuthAccount(selection.account)
    return {
      ok: true,
      account: publicAuthAccount(selection.account),
      accounts: selection.store.accounts.map(publicAuthAccount),
      auditEvents: [],
      devices: await markCurrentClientDevices(devicesResult.devices),
      errors,
      invitations: [],
      messages: [],
      security: emptyProfileSecuritySummary(user),
      ...(session == null ? {} : { session }),
      teams: [],
      user
    }
  }

  const getProfile = async (payload?: unknown): Promise<unknown> => {
    const selection = await selectProfileAuthAccount(payload)
    if ('selectionRequired' in selection) return selection

    if (isRelayFixtureAuthAccount(selection.account)) {
      return getFixtureProfile(selection.store, selection.account)
    }

    let meBody: Record<string, unknown>
    try {
      meBody = await fetchRelayProfileJson(selection.account, '/api/auth/me')
    } catch (error) {
      return await getDegradedProfile(selection, error)
    }
    const user = normalizeProfileCurrentUser(meBody.user)
    if (user == null) {
      throw new Error('Relay account profile did not return a valid user.')
    }
    const session = normalizeProfileSession(meBody.session)
    const updated = await updateProfileAuthAccount(selection.store, selection.account, user, session)
    const [securityResult, devicesResult, auditResult, messagesResult, teamsResult] = await Promise.allSettled([
      fetchRelayProfileJson(updated.account, '/api/profile/security'),
      fetchRelayProfileJson(updated.account, '/api/relay/devices'),
      fetchRelayProfileJson(updated.account, profileAuditPath(payload)),
      fetchRelayProfileJson(updated.account, '/api/admin/messages'),
      fetchRelayProfileJson(updated.account, '/api/relay/teams')
    ])
    const errors: NonNullable<RelayProfileStatus['errors']> = {}
    if (securityResult.status === 'rejected') {
      errors.security = securityResult.reason instanceof Error
        ? securityResult.reason.message
        : String(securityResult.reason)
    }
    if (devicesResult.status === 'rejected') {
      errors.devices = devicesResult.reason instanceof Error
        ? devicesResult.reason.message
        : String(devicesResult.reason)
    }
    if (auditResult.status === 'rejected') {
      errors.audit = auditResult.reason instanceof Error ? auditResult.reason.message : String(auditResult.reason)
    }
    if (messagesResult.status === 'rejected') {
      errors.messages = messagesResult.reason instanceof Error
        ? messagesResult.reason.message
        : String(messagesResult.reason)
    }
    if (teamsResult.status === 'rejected') {
      errors.teams = teamsResult.reason instanceof Error ? teamsResult.reason.message : String(teamsResult.reason)
    }
    const devicesBody = devicesResult.status === 'fulfilled' ? devicesResult.value : {}
    const auditBody = auditResult.status === 'fulfilled' ? auditResult.value : {}
    const messagesBody = messagesResult.status === 'fulfilled' ? messagesResult.value : {}
    const teamsBody = teamsResult.status === 'fulfilled' ? teamsResult.value : {}
    const profileStatus: RelayProfileStatus = {
      ok: true,
      account: publicAuthAccount(updated.account),
      accounts: updated.store.accounts.map(publicAuthAccount),
      auditEvents: Array.isArray(auditBody.events)
        ? auditBody.events
          .map(normalizeProfileAuditEvent)
          .filter((event): event is RelayProfileOpenApiAuditEvent => event != null)
        : [],
      devices: await markCurrentClientDevices(
        Array.isArray(devicesBody.devices)
          ? devicesBody.devices
            .map(normalizeRemoteDeviceSummary)
            .filter((device): device is RelayRemoteDeviceSummary => device != null)
          : []
      ),
      ...(Object.keys(errors).length === 0 ? {} : { errors }),
      invitations: Array.isArray(messagesBody.invitations)
        ? messagesBody.invitations
          .map(normalizeProfileTeamInvitation)
          .filter((invitation): invitation is RelayProfileTeamInvitation => invitation != null)
        : [],
      messages: Array.isArray(messagesBody.messages)
        ? messagesBody.messages
          .map(normalizeProfileMessage)
          .filter((message): message is RelayProfileMessage => message != null)
        : [],
      security: securityResult.status === 'fulfilled'
        ? normalizeProfileSecuritySummary(securityResult.value, user)
        : emptyProfileSecuritySummary(user),
      ...(session == null ? {} : { session }),
      teams: Array.isArray(teamsBody.teams)
        ? teamsBody.teams
          .map(normalizeProfileTeam)
          .filter((team): team is RelayProfileTeam => team != null)
        : [],
      user
    }
    return profileStatus
  }

  const accessTokenGrantInput = (payload?: unknown): FixtureAccessTokenGrantInput => {
    const body = isRecord(payload) ? payload : {}
    const scope = normalizeProfileAccessTokenScope(body.scope)
    const permissionGroupMode = body.permissionGroupMode === 'custom' ? 'custom' : 'all'
    return {
      name: readTextField(payload, 'name'),
      permissionGroupIds: scope === 'user' || permissionGroupMode !== 'custom'
        ? []
        : readStringList(body.permissionGroupIds),
      permissionGroupMode: scope === 'user' ? 'all' : permissionGroupMode,
      scope,
      ...(scope === 'team' ? { teamId: readTextField(payload, 'teamId') } : {})
    }
  }

  const profileActionWithRefresh = async (
    payload: unknown,
    action: string,
    run: (account: OneWorksAuthAccount) => Promise<Record<string, unknown>>
  ) => {
    const selection = await selectProfileAuthAccount(payload)
    if ('selectionRequired' in selection) return selection
    const result = await run(selection.account)
    const profile = await getProfile({ accountKey: selection.account.accountKey })
    return {
      ...(isRecord(profile) ? profile : {}),
      action,
      result
    }
  }

  const changeProfilePassword = async (payload?: unknown) => {
    const password = readTextField(payload, 'password') || readTextField(payload, 'newPassword')
    if (password === '') throw new Error('Password is required.')
    return await profileActionWithRefresh(
      payload,
      'profile.password',
      async account =>
        await fetchRelayProfileJson(account, '/api/profile/password', {
          method: 'POST',
          body: JSON.stringify({
            currentPassword: readTextField(payload, 'currentPassword') || undefined,
            password
          })
        })
    )
  }

  const createProfileAccessToken = async (payload?: unknown) => {
    const selection = await selectProfileAuthAccount(payload)
    if ('selectionRequired' in selection) return selection
    if (isRelayFixtureAuthAccount(selection.account)) {
      const result = createFixtureAccessToken(selection.account, accessTokenGrantInput(payload))
      const profile = getFixtureProfile(selection.store, selection.account)
      return {
        ...profile,
        action: 'profile.access-token.create',
        result
      }
    }
    return await profileActionWithRefresh(
      payload,
      'profile.access-token.create',
      async account =>
        await fetchRelayProfileJson(account, '/api/profile/access-tokens', {
          method: 'POST',
          body: JSON.stringify(accessTokenGrantInput(payload))
        })
    )
  }

  const updateProfileAccessToken = async (payload?: unknown) => {
    const tokenId = readTextField(payload, 'tokenId') || readTextField(payload, 'id')
    if (tokenId === '') throw new Error('Access token id is required.')
    const selection = await selectProfileAuthAccount(payload)
    if ('selectionRequired' in selection) return selection
    if (isRelayFixtureAuthAccount(selection.account)) {
      const result = updateFixtureAccessToken(selection.account, tokenId, accessTokenGrantInput(payload))
      const profile = getFixtureProfile(selection.store, selection.account)
      return {
        ...profile,
        action: 'profile.access-token.update',
        result
      }
    }
    return await profileActionWithRefresh(
      payload,
      'profile.access-token.update',
      async account =>
        await fetchRelayProfileJson(account, `/api/profile/access-tokens/${encodeURIComponent(tokenId)}`, {
          method: 'PATCH',
          body: JSON.stringify(accessTokenGrantInput(payload))
        })
    )
  }

  const revokeProfileAccessToken = async (payload?: unknown) => {
    const tokenId = readTextField(payload, 'tokenId') || readTextField(payload, 'id')
    if (tokenId === '') throw new Error('Access token id is required.')
    const selection = await selectProfileAuthAccount(payload)
    if ('selectionRequired' in selection) return selection
    if (isRelayFixtureAuthAccount(selection.account)) {
      const result = revokeFixtureAccessToken(selection.account, tokenId)
      const profile = getFixtureProfile(selection.store, selection.account)
      return {
        ...profile,
        action: 'profile.access-token.revoke',
        result
      }
    }
    return await profileActionWithRefresh(
      payload,
      'profile.access-token.revoke',
      async account =>
        await fetchRelayProfileJson(account, `/api/profile/access-tokens/${encodeURIComponent(tokenId)}`, {
          method: 'DELETE'
        })
    )
  }

  const updateProfileDeviceAlias = async (payload?: unknown) => {
    const deviceId = readTextField(payload, 'deviceId') || readTextField(payload, 'id')
    if (deviceId === '') throw new Error('Device id is required.')
    const alias = readTextField(payload, 'alias')
    const selection = await selectProfileAuthAccount(payload)
    if ('selectionRequired' in selection) return selection
    if (isRelayFixtureAuthAccount(selection.account)) {
      const aliases = fixtureDeviceAliasesByAccountKey.get(selection.account.accountKey) ?? new Map<string, string>()
      if (alias === '') {
        aliases.delete(deviceId)
      } else {
        aliases.set(deviceId, alias)
      }
      fixtureDeviceAliasesByAccountKey.set(selection.account.accountKey, aliases)
      return {
        ...getFixtureProfile(selection.store, selection.account),
        action: 'profile.device.update'
      }
    }
    const result = await profileActionWithRefresh(
      payload,
      'profile.device.update',
      async account =>
        await fetchRelayProfileJson(account, `/api/relay/devices/${encodeURIComponent(deviceId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ alias })
        })
    )
    clearDeviceListCacheForServer(selection.account.serverId)
    return result
  }

  const deleteProfileAccount = async (payload?: unknown) => {
    const selection = await selectProfileAuthAccount(payload)
    if ('selectionRequired' in selection) return selection
    const result = await fetchRelayProfileJson(selection.account, '/api/profile/account', {
      method: 'DELETE'
    })
    stopRemoteLoop(selection.account.accountKey)
    const nextStore = {
      ...selection.store,
      accounts: selection.store.accounts.filter(account => account.accountKey !== selection.account.accountKey)
    }
    await writeOneWorksAuthStore(nextStore)
    return {
      ok: true,
      action: 'profile.account.delete',
      account: publicAuthAccount(selection.account),
      accounts: nextStore.accounts.map(publicAuthAccount),
      result
    }
  }

  const listUsers = async (payload?: unknown) => {
    const server = resolveAccountCommandServer(payload)
    const authStore = await readOneWorksAuthStore()
    const accounts = authStore.accounts
      .filter(account => accountMatchesRelayServer(account, server))
      .map(publicAuthAccount)
    return {
      ok: true,
      accounts,
      server: {
        alias: serverAliasForId(server.id),
        id: server.id,
        name: server.name,
        url: server.remoteBaseUrl
      }
    }
  }

  const setUserEnabled = async (payload: unknown, enabled: boolean) => {
    const selection = await selectAuthAccount(payload)
    if ('selectionRequired' in selection) return selection

    const updatedAt = new Date().toISOString()
    const account = {
      ...selection.account,
      enabled,
      updatedAt
    }
    await writeOneWorksAuthStore(upsertOneWorksAuthAccount(selection.store, account))
    if (enabled) {
      await connect({
        accountKey: account.accountKey,
        serverId: account.serverId
      })
    } else {
      stopRemoteLoop(account.accountKey)
    }
    return {
      ok: true,
      action: enabled ? 'users.enable' : 'users.disable',
      account: publicAuthAccount(account),
      message: `${enabled ? 'Enabled' : 'Disabled'} ${account.loginId ?? account.email ?? account.userId} on ${
        serverAliasForId(account.serverId)
      }.`
    }
  }

  const clearLocalDeviceDataForAccount = async (
    account: OneWorksAuthAccount,
    remainingAccounts: OneWorksAuthAccount[]
  ) => {
    const store = await deviceStore.readStore()
    const stored = store.servers[account.serverId]
    if (stored == null) return
    const matchesStoredAccount = stored.account?.id === account.userId
    const matchesStoredDeviceToken = account.deviceToken != null &&
      account.deviceToken !== '' &&
      stored.deviceToken === account.deviceToken
    const matchesStoredSession = account.sessionToken != null &&
      account.sessionToken !== '' &&
      stored.sessionToken === account.sessionToken
    if (!matchesStoredAccount && !matchesStoredDeviceToken && !matchesStoredSession) return

    const remainingSameServer = remainingAccounts.some(item => item.serverId === account.serverId)
    const nextStored: RelayStoredServer = {
      ...(stored.configDisabledSources == null ? {} : { configDisabledSources: stored.configDisabledSources }),
      ...(stored.personalDocumentSync == null ? {} : { personalDocumentSync: stored.personalDocumentSync }),
      ...(stored.teamDocumentSync == null ? {} : { teamDocumentSync: stored.teamDocumentSync }),
      deviceToken: '',
      id: stored.id,
      remoteBaseUrl: stored.remoteBaseUrl,
      updatedAt: new Date().toISOString()
    }
    await deviceStore.writeStore({
      ...store,
      servers: remainingSameServer
        ? {
          ...store.servers,
          [account.serverId]: nextStored
        }
        : Object.fromEntries(
          Object.entries(store.servers).filter(([serverId]) => serverId !== account.serverId)
        )
    })
  }

  const deleteLocalUser = async (payload?: unknown) => {
    const selection = await selectAuthAccount(payload)
    if ('selectionRequired' in selection) return selection

    const account = selection.account
    const remainingAccounts = selection.store.accounts.filter(item => item.accountKey !== account.accountKey)
    stopRemoteLoop(account.accountKey)
    if (!remainingAccounts.some(item => item.serverId === account.serverId)) {
      stopRemoteLoop(account.serverId)
    }
    await writeOneWorksAuthStore({
      ...selection.store,
      accounts: remainingAccounts
    })
    await clearLocalDeviceDataForAccount(account, remainingAccounts)
    return {
      ok: true,
      action: 'users.delete-local',
      account: publicAuthAccount(account),
      accounts: remainingAccounts.map(publicAuthAccount),
      message: `Deleted local data for ${account.loginId ?? account.email ?? account.userId} on ${
        serverAliasForId(account.serverId)
      }.`
    }
  }

  const logoutUser = async (payload?: unknown) => {
    const selection = await selectAuthAccount(payload)
    if ('selectionRequired' in selection) return selection

    const account = selection.account
    stopRemoteLoop(account.accountKey)
    await writeOneWorksAuthStore({
      ...selection.store,
      accounts: selection.store.accounts.filter(item => item.accountKey !== account.accountKey)
    })
    return {
      ok: true,
      action: 'logout',
      account: publicAuthAccount(account),
      message: `Logged out ${account.loginId ?? account.email ?? account.userId} on ${
        serverAliasForId(account.serverId)
      }.`
    }
  }

  let connectQueue = Promise.resolve()

  const withConnectQueue = async <T>(operation: () => Promise<T>) => {
    const previous = connectQueue
    let release!: () => void
    connectQueue = new Promise(resolve => {
      release = resolve
    })
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
    }
  }

  const connect = async (
    payload?: unknown,
    input: { restoring?: boolean } = {}
  ) => {
    if (!input.restoring) explicitConnectVersion += 1

    return await withConnectQueue(async () => {
      if (disposed) return await getPublicStatus()
      const requestedServerId = readServerId(payload)
      const accountKey = readTextField(payload, 'accountKey')
      const transientAuthToken = readTextField(payload, 'authToken') ||
        readTextField(payload, 'loginToken') ||
        readTextField(payload, 'token')
      const transientSessionToken = readTextField(payload, 'sessionToken')
      const transientSessionExpiresAt = readTextField(payload, 'sessionExpiresAt')
      const options = normalizeOptions(ctx.options, ctx.runtime.role)
      const activeServer = resolveActiveRelayServer(ctx.options, requestedServerId)
      if (activeServer == null) {
        state = createMissingRemoteState(state, requestedServerId)
        return await getPublicStatus()
      }

      const authStore = await readOneWorksAuthStore()
      const authAccount = accountKey === ''
        ? undefined
        : authStore.accounts.find(account => account.accountKey === accountKey)
      if (accountKey !== '' && authAccount == null) {
        throw new Error(`Unknown OneWorks account: ${accountKey}.`)
      }
      const connectionKey = accountKey || activeServer.id
      const store = await deviceStore.readStore()
      const deviceId = readTextField(payload, 'deviceId') || store.deviceId
      const managementServer = await resolveRelayManagementServerRegistration(ctx, managementServerStore)
      const storedServer = getStoredServer(store, activeServer)
      const authToken = transientAuthToken ||
        authAccount?.sessionToken ||
        storedServer?.deviceToken ||
        authAccount?.deviceToken ||
        activeServer.pairingToken
      const registerUrl = new URL('/api/relay/devices/register', activeServer.remoteBaseUrl)
      setConnectionState(activeServer.id, {
        state: 'connecting',
        message: `Registering ${deviceId} with ${activeServer.name}.`,
        activeServerId: activeServer.id,
        lastConnectedAt: getConnectionState(activeServer).lastConnectedAt,
        lastError: null,
        remoteBaseUrl: activeServer.remoteBaseUrl
      })

      const loopLeaseKey = createLoopLeaseKey({
        deviceId,
        managementServerId: managementServer.id,
        server: activeServer
      })
      stopRemoteLoop(connectionKey)
      if (accountKey === '') {
        stopRemoteLoopsForServerAccounts(activeServer, authStore)
      } else {
        stopRemoteLoop(activeServer.id)
      }
      const existingLoopConnectionKey = loopConnectionKeysByLeaseKey.get(loopLeaseKey)
      if (existingLoopConnectionKey != null && existingLoopConnectionKey !== connectionKey) {
        stopRemoteLoop(existingLoopConnectionKey)
      }
      let loopLease: RelayLoopLease | undefined
      let loopLeaseAttached = false

      try {
        loopLease = await loopLeaseManager.acquire(loopLeaseKey)
        if (loopLease == null) {
          ctx.logger.warn(
            {
              scope: ctx.scope,
              serverId: activeServer.id,
              connectionKey,
              deviceId,
              remoteBaseUrl: normalizeBaseUrl(activeServer.remoteBaseUrl)
            },
            '[relay] loop already active in another local process'
          )
          setConnectionState(activeServer.id, {
            state: 'registered',
            message: `Device loop for ${activeServer.name} is already active in another local process.`,
            activeServerId: activeServer.id,
            lastConnectedAt: storedServer?.registeredAt ?? getConnectionState(activeServer).lastConnectedAt,
            lastError: null,
            remoteBaseUrl: activeServer.remoteBaseUrl
          })
          return await getPublicStatus()
        }

        const response = await fetch(registerUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(authToken === '' ? {} : { authorization: `Bearer ${authToken}` })
          },
          body: JSON.stringify(createRegisterBody(ctx, managementServer, store, options, deviceId))
        })

        const responseBody = await response.json().catch(() => ({}))
        if (!response.ok) {
          const message = isRecord(responseBody) && typeof responseBody.error === 'string'
            ? responseBody.error
            : `Relay registration failed with ${response.status}.`
          throw new Error(message)
        }
        if (disposed) {
          loopLease.release()
          return await getPublicStatus()
        }

        const registeredAt = new Date().toISOString()
        const previousDeviceToken = storedServer?.deviceToken ?? ''
        const nextDeviceToken = isRecord(responseBody)
          ? toString(responseBody.deviceToken) || storedServer?.deviceToken || ''
          : storedServer?.deviceToken || ''
        const nextStore = withStoredServer(store, activeServer, {
          account: isRecord(responseBody) ? normalizeAccountProfile(responseBody.user) : undefined,
          deviceName: options.deviceName,
          deviceToken: nextDeviceToken,
          registeredAt,
          ...(transientSessionExpiresAt === '' ? {} : { sessionExpiresAt: transientSessionExpiresAt }),
          ...(transientSessionToken === ''
            ? authAccount?.sessionToken == null
              ? {}
              : { sessionToken: authAccount.sessionToken }
            : { sessionToken: transientSessionToken })
        })
        await deviceStore.writeStore(nextStore)
        if (nextDeviceToken !== previousDeviceToken) {
          clearDeviceListCacheForServer(activeServer.id)
        }
        const nextStoredServer = nextStore.servers[activeServer.id]
        if (authAccount != null) {
          const responseAccount = isRecord(responseBody) ? normalizeAccountProfile(responseBody.user) : undefined
          const authAccountWithoutDevice = { ...authAccount }
          delete authAccountWithoutDevice.deviceId
          delete authAccountWithoutDevice.deviceToken
          const updatedAccount = {
            ...authAccountWithoutDevice,
            ...(responseAccount?.avatarUrl == null ? {} : { avatarUrl: responseAccount.avatarUrl }),
            ...(responseAccount?.email == null ? {} : { email: responseAccount.email }),
            ...(responseAccount?.loginId == null ? {} : { loginId: responseAccount.loginId }),
            ...(responseAccount?.name == null ? {} : { name: responseAccount.name }),
            ...(responseAccount?.role == null ? {} : { role: responseAccount.role }),
            enabled: true,
            registeredAt,
            serverUrl: activeServer.remoteBaseUrl,
            updatedAt: registeredAt
          } satisfies OneWorksAuthAccount
          await writeOneWorksAuthStore(
            upsertOneWorksAuthAccount(
              upsertOneWorksAuthServer(authStore, authServerFromRelayServer(activeServer)),
              updatedAccount
            )
          )
        }
        if (!disposed && (nextStoredServer?.deviceToken ?? '') !== '') {
          const auth = {
            deviceId,
            deviceToken: nextStoredServer?.deviceToken ?? '',
            remoteBaseUrl: activeServer.remoteBaseUrl
          }
          heartbeats.set(
            connectionKey,
            startHeartbeat({
              capabilities: options.capabilities,
              deviceInfo: createRelayDeviceEnvironmentInfo(),
              deviceId: auth.deviceId,
              deviceName: options.deviceName,
              deviceToken: auth.deviceToken,
              logger: ctx.logger,
              managementServerEnvironment: createRelayDeviceEnvironmentInfo(),
              managementServerId: managementServer.id,
              managementServerKind: managementServer.kind,
              managementServerName: managementServer.name,
              managementServerProjects: [createCurrentWorkspaceProject(ctx)],
              pluginScope: ctx.scope,
              remoteBaseUrl: auth.remoteBaseUrl,
              serverId: activeServer.id,
              workspaceFolder: ctx.workspaceFolder
            })
          )
          if (options.capabilities.workspaceLauncher || (options.capabilities.sessions && ctx.sessions != null)) {
            const sessionWorker = createRelaySessionWorker({
              adapter: ctx.sessions ?? undefined,
              auth,
              logger: ctx.logger,
              serverId: activeServer.id
            })
            sessionWorkers.set(connectionKey, sessionWorker)
            void sessionWorker.runOnce().catch(error => {
              ctx.logger.warn(
                { err: error, scope: ctx.scope, serverId: activeServer.id },
                '[relay] session forwarding bootstrap failed'
              )
            })
          }
          loopLeases.set(connectionKey, loopLease)
          loopConnectionKeysByLeaseKey.set(loopLeaseKey, connectionKey)
          loopLeaseAttached = true
          await refreshConfigDistributionStatus({ serverId: activeServer.id })
        } else {
          loopLease.release()
        }
        setConnectionState(activeServer.id, {
          state: 'registered',
          message: `Device registered with ${activeServer.name}.`,
          activeServerId: activeServer.id,
          lastConnectedAt: registeredAt,
          lastError: null,
          remoteBaseUrl: activeServer.remoteBaseUrl
        })
      } catch (error) {
        if (!loopLeaseAttached) loopLease?.release()
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger.warn(
          { err: error, scope: ctx.scope, serverId: activeServer.id },
          '[relay] device registration failed'
        )
        setConnectionState(activeServer.id, {
          state: 'error',
          message,
          activeServerId: activeServer.id,
          lastConnectedAt: getConnectionState(activeServer).lastConnectedAt,
          lastError: message,
          remoteBaseUrl: activeServer.remoteBaseUrl
        })
      }

      return await getPublicStatus()
    })
  }

  const restoreStoredConnections = async () => {
    const restoreConnectVersion = explicitConnectVersion
    const restoreWasSuperseded = () => disposed || explicitConnectVersion !== restoreConnectVersion
    const options = normalizeOptions(ctx.options, ctx.runtime.role)
    const store = await deviceStore.readStore()
    const authStore = await readOneWorksAuthStore()
    const restoredServerIds: string[] = []
    if (restoreWasSuperseded()) return restoredServerIds

    for (const configuredServer of options.servers) {
      if (restoreWasSuperseded()) return restoredServerIds
      const server = resolveActiveRelayServer(ctx.options, configuredServer.id)
      if (server == null) continue
      const hasRestorableAccount = authStore.accounts.some(account =>
        account.enabled &&
        accountMatchesRelayServer(account, server) &&
        (
          isSessionAuthenticated(account) ||
          (account.deviceToken ?? '') !== ''
        )
      )
      if (hasRestorableAccount) continue
      const storedServer = getStoredServer(store, server)
      if ((storedServer?.deviceToken ?? '') === '') continue
      if (heartbeats.has(server.id) || sessionWorkers.has(server.id)) {
        restoredServerIds.push(server.id)
        continue
      }

      const status = await connect({ serverId: server.id }, { restoring: true })
      if (
        isRecord(status) &&
        isRecord(status.connection) &&
        toString(status.connection.state) === 'registered'
      ) {
        restoredServerIds.push(server.id)
      }
    }

    for (const configuredServer of options.servers) {
      if (restoreWasSuperseded()) return restoredServerIds
      const server = resolveActiveRelayServer(ctx.options, configuredServer.id)
      if (server == null) continue
      const accounts = authStore.accounts.filter(account =>
        account.enabled &&
        accountMatchesRelayServer(account, server) &&
        (
          isSessionAuthenticated(account) ||
          (account.deviceToken ?? '') !== ''
        )
      )
      for (const account of accounts) {
        if (restoreWasSuperseded()) return restoredServerIds
        if (heartbeats.has(account.accountKey) || sessionWorkers.has(account.accountKey)) {
          if (!restoredServerIds.includes(server.id)) restoredServerIds.push(server.id)
          continue
        }

        const status = await connect({
          accountKey: account.accountKey,
          serverId: server.id
        }, { restoring: true })
        if (
          isRecord(status) &&
          isRecord(status.connection) &&
          toString(status.connection.state) === 'registered'
        ) {
          if (!restoredServerIds.includes(server.id)) restoredServerIds.push(server.id)
        }
      }
    }

    return restoredServerIds
  }

  const createLoginUrl = async (payload?: unknown) => {
    const requestedServerId = readServerId(payload) || 'cf'
    const activeServer = resolveActiveRelayServer(ctx.options, requestedServerId)
    if (activeServer == null) {
      throw new Error(
        requestedServerId === ''
          ? 'Configure at least one relay server before logging in.'
          : `Unknown relay server: ${requestedServerId}.`
      )
    }

    const redirectUri = readTextField(payload, 'redirectUri') || buildDesktopRedirectUri(ctx, activeServer.id)
    const loginUrl = new URL('/login', activeServer.remoteBaseUrl)
    loginUrl.searchParams.set('redirect_uri', redirectUri)
    loginUrl.searchParams.set('scope', ctx.scope)
    loginUrl.searchParams.set('server_id', activeServer.id)
    return {
      loginUrl: loginUrl.toString(),
      redirectUri,
      remoteBaseUrl: activeServer.remoteBaseUrl,
      serverId: activeServer.id
    }
  }

  const getServiceInfo = async (payload?: unknown) => {
    const requestedServerId = readServerId(payload)
    const authStore = await readOneWorksAuthStore()
    const server = resolveRelayServer(authStore, requestedServerId)
    if (server == null) {
      throw new RelayNativeLoginProxyError(`Unknown relay server: ${requestedServerId}.`, 404)
    }
    return await fetchRelayServiceInfo(server)
  }

  const getNativeLoginOptions = async (payload?: unknown) => {
    const login = await createLoginUrl(payload)
    const configuredServer = resolveRelayServers(ctx.options).find(server =>
      server.id === login.serverId && server.remoteBaseUrl === login.remoteBaseUrl
    )
    if (configuredServer == null) {
      throw new RelayNativeLoginProxyError(`Unknown relay server: ${login.serverId}.`, 404)
    }
    const loginUrl = new URL(login.loginUrl)
    const optionsUrl = new URL('/api/auth/login-options', configuredServer.remoteBaseUrl)
    for (const key of ['redirect_uri', 'scope', 'server_id']) {
      const value = loginUrl.searchParams.get(key)
      if (value != null) optionsUrl.searchParams.set(key, value)
    }
    const response = await fetch(optionsUrl, { headers: { accept: 'application/json' } })
    const body = await readResponseJson(response)
    if (!response.ok) {
      throw new RelayNativeLoginProxyError(
        toString(body.error) || `Relay login options failed with ${response.status}.`,
        response.status,
        toString(body.code) || undefined
      )
    }
    return { ...login, options: body }
  }

  const proxyNativeLoginRequest = async (payload?: unknown) => {
    if (!isRecord(payload)) throw new RelayNativeLoginProxyError('Invalid native login request.', 400)
    const action = toString(payload.action)
    const path = nativeLoginRequestPaths[action as keyof typeof nativeLoginRequestPaths]
    if (path == null) throw new RelayNativeLoginProxyError('Unsupported native login action.', 400)
    const requestedServerId = readServerId(payload) || 'cf'
    const resolvedServer = resolveActiveRelayServer(ctx.options, requestedServerId)
    const activeServer = resolvedServer == null
      ? undefined
      : resolveRelayServers(ctx.options).find(server =>
        server.id === resolvedServer.id && server.remoteBaseUrl === resolvedServer.remoteBaseUrl
      )
    if (activeServer == null) {
      throw new RelayNativeLoginProxyError(`Unknown relay server: ${requestedServerId}.`, 404)
    }
    const requestBody = isRecord(payload.body) ? payload.body : {}
    const response = await fetch(new URL(path, activeServer.remoteBaseUrl), {
      body: JSON.stringify(requestBody),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json'
      },
      method: 'POST'
    })
    const body = await readResponseJson(response)
    if (!response.ok) {
      throw new RelayNativeLoginProxyError(
        toString(body.error) || `Relay login failed with ${response.status}.`,
        response.status,
        toString(body.code) || undefined
      )
    }
    return body
  }

  const completeLogin = async (payload?: unknown) => {
    const token = readTextField(payload, 'token') || readTextField(payload, 'relayToken')
    if (token === '') {
      throw new Error('Missing relay login token.')
    }
    const requestedServerId = readServerId(payload)
    const activeServer = resolveActiveRelayServer(ctx.options, requestedServerId)
    if (activeServer == null) {
      throw new Error(
        requestedServerId === ''
          ? 'Configure at least one relay server before completing login.'
          : `Unknown relay server: ${requestedServerId}.`
      )
    }
    const session = await fetchRelaySessionProfile(activeServer, token)
    const userId = session.account?.id
    if (userId == null || userId === '') {
      throw new Error('Relay login did not return a user id.')
    }
    const accountKey = createAccountKey(activeServer.id, userId)
    const authStore = await readOneWorksAuthStore()
    const previousAuthAccount = authStore.accounts.find(account => account.accountKey === accountKey)
    const updatedAt = new Date().toISOString()
    const authAccount = {
      accountKey,
      ...(session.account?.avatarUrl == null ? {} : { avatarUrl: session.account.avatarUrl }),
      ...(session.account?.email == null ? {} : { email: session.account.email }),
      enabled: true,
      ...(session.account?.loginId == null ? {} : { loginId: session.account.loginId }),
      ...(session.account?.name == null ? {} : { name: session.account.name }),
      ...(previousAuthAccount?.registeredAt == null ? {} : { registeredAt: previousAuthAccount.registeredAt }),
      ...(session.account?.role == null ? {} : { role: session.account.role }),
      serverId: activeServer.id,
      serverUrl: activeServer.remoteBaseUrl,
      sessionExpiresAt: session.expiresAt,
      sessionToken: token,
      updatedAt,
      userId
    } satisfies OneWorksAuthAccount
    await writeOneWorksAuthStore(
      upsertOneWorksAuthAccount(
        upsertOneWorksAuthServer(authStore, authServerFromRelayServer(activeServer)),
        authAccount
      )
    )
    await connect({
      ...(isRecord(payload) ? payload : {}),
      accountKey,
      authToken: token,
      ...(session.expiresAt == null ? {} : { sessionExpiresAt: session.expiresAt }),
      sessionToken: token
    })
    const store = await deviceStore.readStore()
    const stored = store.servers[activeServer.id]
    if (stored != null) {
      await deviceStore.writeStore({
        ...store,
        servers: {
          ...store.servers,
          [activeServer.id]: {
            ...stored,
            ...(session.account == null ? {} : { account: session.account }),
            sessionExpiresAt: session.expiresAt,
            sessionToken: token,
            updatedAt: new Date().toISOString()
          }
        }
      })
    }
    const nextAuthStore = await readOneWorksAuthStore()
    const nextAccount = nextAuthStore.accounts.find(account => account.accountKey === accountKey) ?? authAccount
    const status = await getPublicStatus()
    return {
      ...status,
      ok: true,
      action: 'login',
      account: publicAuthAccount(nextAccount)
    }
  }

  const disconnect = async (payload?: unknown) => {
    const requestedServerId = readServerId(payload)
    if (requestedServerId !== '') {
      const activeServer = resolveActiveRelayServer(ctx.options, requestedServerId)
      if (activeServer == null) {
        state = createMissingRemoteState(state, requestedServerId)
        return await getPublicStatus()
      }
      const previousState = getConnectionState(activeServer)
      stopRemoteLoop(activeServer.id)
      setConnectionState(activeServer.id, {
        state: 'idle',
        message: `Relay connection disabled for ${activeServer.name}.`,
        activeServerId: activeServer.id,
        lastConnectedAt: previousState.lastConnectedAt,
        lastError: null,
        remoteBaseUrl: activeServer.remoteBaseUrl
      })
      return await getPublicStatus()
    }

    const options = normalizeOptions(ctx.options, ctx.runtime.role)
    const previousState = state
    stopRemoteLoops()
    for (const server of options.servers) {
      const previousServerState = getConnectionState(server)
      connectionStates[server.id] = {
        state: 'idle',
        message: 'Relay connection disabled for this server process.',
        activeServerId: server.id,
        lastConnectedAt: previousServerState.lastConnectedAt,
        lastError: null,
        remoteBaseUrl: server.remoteBaseUrl
      }
    }
    for (const [serverId, previousServerState] of Object.entries(connectionStates)) {
      if (options.servers.some(server => server.id === serverId)) continue
      connectionStates[serverId] = {
        state: 'idle',
        message: 'Relay connection disabled for this server process.',
        activeServerId: previousServerState.activeServerId ?? serverId,
        lastConnectedAt: previousServerState.lastConnectedAt,
        lastError: null,
        remoteBaseUrl: previousServerState.remoteBaseUrl
      }
    }
    state = {
      state: 'idle',
      message: 'Relay connections disabled for this server process.',
      activeServerId: previousState.activeServerId,
      lastConnectedAt: previousState.lastConnectedAt,
      lastError: null,
      remoteBaseUrl: previousState.remoteBaseUrl
    }
    return await getPublicStatus()
  }

  const forget = async (payload?: unknown) => {
    const store = await deviceStore.readStore()
    const requestedServerId = readServerId(payload)
    const nextServers = { ...store.servers }
    if (requestedServerId === '') {
      const options = normalizeOptions(ctx.options, ctx.runtime.role)
      stopRemoteLoops()
      for (const server of Object.values(nextServers)) {
        nextServers[server.id] = {
          ...server,
          ...(server.configDisabledSources == null ? {} : { configDisabledSources: server.configDisabledSources }),
          ...(server.personalDocumentSync == null ? {} : { personalDocumentSync: server.personalDocumentSync }),
          ...(server.teamDocumentSync == null ? {} : { teamDocumentSync: server.teamDocumentSync }),
          deviceToken: '',
          sessionExpiresAt: undefined,
          sessionToken: undefined
        }
      }
      for (const server of options.servers) {
        connectionStates[server.id] = {
          state: 'idle',
          message: 'Stored relay device tokens removed.',
          activeServerId: server.id,
          lastConnectedAt: null,
          lastError: null,
          remoteBaseUrl: server.remoteBaseUrl
        }
      }
      for (const [serverId, previousServerState] of Object.entries(connectionStates)) {
        if (options.servers.some(server => server.id === serverId)) continue
        connectionStates[serverId] = {
          state: 'idle',
          message: 'Stored relay device tokens removed.',
          activeServerId: previousServerState.activeServerId ?? serverId,
          lastConnectedAt: null,
          lastError: null,
          remoteBaseUrl: previousServerState.remoteBaseUrl
        }
      }
      state = {
        state: 'idle',
        message: 'Stored relay device tokens removed.',
        activeServerId: state.activeServerId,
        lastConnectedAt: null,
        lastError: null,
        remoteBaseUrl: state.remoteBaseUrl
      }
    } else {
      const activeServer = resolveActiveRelayServer(ctx.options, requestedServerId)
      if (activeServer == null) {
        state = createMissingRemoteState(state, requestedServerId)
        return await getPublicStatus()
      }
      const previous = getStoredServer(store, activeServer)
      stopRemoteLoop(activeServer.id)
      nextServers[activeServer.id] = {
        ...(previous?.configDisabledSources == null ? {} : { configDisabledSources: previous.configDisabledSources }),
        ...(previous?.personalDocumentSync == null ? {} : { personalDocumentSync: previous.personalDocumentSync }),
        ...(previous?.teamDocumentSync == null ? {} : { teamDocumentSync: previous.teamDocumentSync }),
        deviceToken: '',
        id: activeServer.id,
        registeredAt: previous?.registeredAt,
        remoteBaseUrl: activeServer.remoteBaseUrl,
        sessionExpiresAt: undefined,
        sessionToken: undefined,
        updatedAt: new Date().toISOString()
      }
      setConnectionState(activeServer.id, {
        state: 'idle',
        message: `Stored relay device token removed for ${activeServer.name}.`,
        activeServerId: activeServer.id,
        lastConnectedAt: null,
        lastError: null,
        remoteBaseUrl: activeServer.remoteBaseUrl
      })
    }
    await deviceStore.writeStore({
      deviceId: store.deviceId,
      deviceSecret: store.deviceSecret,
      deviceName: store.deviceName,
      servers: nextServers
    })
    return await getPublicStatus()
  }

  return {
    completeLogin,
    connect,
    createLoginUrl,
    getNativeLoginOptions,
    proxyNativeLoginRequest,
    disconnect,
    dispose: () => {
      disposed = true
      stopRemoteLoops()
      state = {
        state: 'idle',
        message: 'Relay plugin disposed.',
        activeServerId: state.activeServerId,
        lastConnectedAt: state.lastConnectedAt,
        lastError: null,
        remoteBaseUrl: state.remoteBaseUrl
      }
    },
    forget,
    changeProfilePassword,
    createProfileAccessToken,
    deleteLocalUser,
    deleteProfileAccount,
    getConfigShareProfileDetail,
    getConfigShareTargets,
    getProfile,
    getPublicStatus,
    getServiceInfo,
    getWorkspaceProxyConnection,
    importPersonalDocumentRootAgents,
    listWorkspaceDirectories,
    listDocumentEntries,
    openWorkspaceProxy,
    openDocumentPath,
    readDocumentContent,
    createWorkspaceInDirectory,
    listUsers,
    logoutUser,
    publishConfigShareDraft,
    refreshConfigDistribution,
    restoreStoredConnections,
    revokeProfileAccessToken,
    setConfigSourceEnabled,
    setPersonalDocumentSyncEnabled,
    setTeamDocumentSyncEnabled,
    setUserEnabled,
    updateConfigShareAssignment,
    updateProfileAccessToken,
    updateProfileDeviceAlias,
    search: payload => [{
      id: 'status',
      title: 'Account status',
      subtitle: `Query: ${toString(isRecord(payload) ? payload.query : undefined) || 'relay'}`,
      icon: 'account_circle'
    }]
  }
}
