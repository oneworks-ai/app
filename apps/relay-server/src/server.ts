/* eslint-disable max-lines -- Relay server routing is centralized to keep platform adapters thin. */
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import process from 'node:process'

import { enabledRelayAuthProviders } from './auth/sso-provider-registry.js'
import { RelayRequestBodyTooLargeError, readRequestBody, sendJson } from './http.js'
import { attachRelayNodeControl } from './platform/node-control.js'
import { handleAdminAccessGroups } from './routes/access-groups.js'
import { handleRelayAdminOpenApi, handleRelayProfileOpenApi } from './routes/admin-openapi.js'
import { handleAdminSsoProviders } from './routes/admin-sso-providers.js'
import { handleAdminInvites, handleAdminUsers } from './routes/admin.js'
import { handleAuthRoute } from './routes/auth.js'
import {
  handleConfigProfileAssignmentsRoute,
  handleConfigProfilesRoute,
  handleTeamConfigProfilesRoute
} from './routes/config-profiles.js'
import { handleConfigSecretsRoute, handleTeamConfigSecretsRoute } from './routes/config-secrets.js'
import { handleRelayConfigSnapshot } from './routes/config-snapshot.js'
import { handleDeviceHeartbeat, handleDeviceList, handleDeviceRegister, handleDeviceUpdate } from './routes/devices.js'
import { handleRelayDiagnosticsRoute } from './routes/diagnostics.js'
import { handleEmailCodeLoginRoute } from './routes/email-code-login.js'
import { handleEmailVerificationSendRoute } from './routes/email-verification.js'
import { handleInviteLoginRoute } from './routes/invite-login.js'
import { handleLoginRoute } from './routes/login.js'
import { handleRelayMetrics } from './routes/metrics.js'
import { handlePasskeyRoute } from './routes/passkeys.js'
import { handlePasswordLoginRoute } from './routes/password-login.js'
import { handleRelayPersonalConfigRoute } from './routes/personal-config.js'
import { handleProfileRoute } from './routes/profile.js'
import { handleProjectRuleDocumentsRoute } from './routes/project-rule-documents.js'
import { handleRelaySessionsRoute } from './routes/sessions.js'
import { handleTeamDocumentsRoute } from './routes/team-documents.js'
import { handleAdminMessagesRoute, handleTeamInvitationActionsRoute } from './routes/team-invitations.js'
import { handleAdminModelUsageRoute } from './routes/team-model-usage.js'
import { handleRelayTeamPolicyRoute } from './routes/team-policy.js'
import { handleTeamsRoute } from './routes/teams.js'
import { handleAdminSecurityTokens } from './security/admin-route.js'
import { attachAuditLogger } from './security/audit.js'
import { createRelayRateLimiter, sendRateLimitExceeded } from './security/rate-limit.js'
import { decodeSegment } from './session-forwarding/http.js'
import { getSessionJobLongPollDeviceId, handleListJobsWithoutStoreLock } from './session-forwarding/job-handlers.js'
import type { ForwardingJobAvailableObserver } from './session-forwarding/job-handlers.js'
import { setForwardingPayloadRepository } from './session-forwarding/payloads.js'
import type { RelayStoreRepository } from './storage/repository.js'
import { createRelayStoreRepository } from './storage/repository.js'
import { createRelayTelemetry } from './telemetry/metrics.js'
import type { RelayTelemetry } from './telemetry/metrics.js'
import type { RelayServerArgs, RelayStore } from './types.js'
import { VERSION } from './version.js'

type RelayStoreRepositoryModule = typeof import('./storage/repository.js')

export { parseRelayServerArgs, printRelayServerHelp } from './config.js'
export { readRelayStore } from './store.js'
export type { RelayServerArgs } from './types.js'
export { VERSION } from './version.js'

const relayHealth = (args: RelayServerArgs) => ({
  buildSha: args.buildSha ?? null,
  ok: true,
  version: VERSION
})

// Keep Node's optional embedded-admin adapter outside browser/Worker bundles.
// Cloudflare serves its Admin UI separately and never resolves this runtime-only module.
const importRuntimeModule = async (specifier: string) => await import(specifier)
const loadEmbeddedAdminUi = async () => await importRuntimeModule('./routes/admin-ui.js')

const handleInfo = (res: ServerResponse, args: RelayServerArgs, store: RelayStore) => {
  const providers = enabledRelayAuthProviders(args, store)
  sendJson(res, 200, {
    avatarUrl: args.avatarUrl ?? null,
    ...(args.deviceTransport == null ? {} : { deviceTransport: args.deviceTransport }),
    name: 'OneWorks Relay',
    version: VERSION,
    features: {
      authSessions: true,
      configSnapshot: true,
      deviceRegistration: true,
      invites: true,
      users: true,
      passwordAuth: true,
      defaultLoginMethod: args.defaultLoginMethod ?? 'password',
      emailCodeLogin: args.emailProvider != null || args.email?.provider !== 'disabled',
      emailVerification: args.emailProvider != null || args.email?.provider !== 'disabled',
      passkeyAuth: args.passkey?.enabled !== false,
      registrationMode: args.passkey?.registrationMode ?? 'invite_required',
      oauth: providers.length > 0,
      oauthProviders: providers,
      sessionForwarding: true,
      teams: true
    }
  }, args.allowOrigin)
}

const handleAdminAssetRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  url: URL
) => {
  const { handleAdminAsset } = await loadEmbeddedAdminUi()
  await handleAdminAsset(req, res, args, url)
}

const handleAdminPageRoute = async (req: IncomingMessage, res: ServerResponse, args: RelayServerArgs) => {
  const { handleAdminPage } = await loadEmbeddedAdminUi()
  handleAdminPage(req, res, args)
}

const handleRelayRequestWithStore = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  telemetry: RelayTelemetry,
  storeRepository: RelayStoreRepository,
  store: RelayStore,
  onForwardingJobAvailable?: ForwardingJobAvailableObserver
) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, relayHealth(args), args.allowOrigin)
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/relay/info') {
    handleInfo(res, args, store)
    return
  }
  const auditLogger = attachAuditLogger(req, res, args, store, storeRepository, url)

  try {
    if (handleLoginRoute(req, res, args, store, url)) {
      return
    }
    if (await handleInviteLoginRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (await handlePasswordLoginRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (await handleEmailCodeLoginRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (await handlePasskeyRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (await handleEmailVerificationSendRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (await handleAuthRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (url.pathname === '/api/admin/openapi.json') {
      handleRelayAdminOpenApi(req, res, args)
      return
    }
    if (url.pathname === '/api/profile/openapi.json') {
      handleRelayProfileOpenApi(req, res, args)
      return
    }
    if (await handleProfileRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/relay/config-snapshot') {
      handleRelayConfigSnapshot(req, res, args, store, url)
      return
    }
    if (await handleRelayPersonalConfigRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (await handleRelayDiagnosticsRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (handleAdminModelUsageRoute(req, res, args, store, url)) {
      return
    }
    if (await handleRelayTeamPolicyRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (await handleTeamConfigProfilesRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (await handleTeamConfigSecretsRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (await handleTeamDocumentsRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (await handleProjectRuleDocumentsRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (await handleTeamsRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (await handleTeamInvitationActionsRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (await handleAdminMessagesRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (await handleConfigProfilesRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (await handleConfigProfileAssignmentsRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (await handleConfigSecretsRoute(req, res, args, store, storeRepository, url)) {
      return
    }
    if (url.pathname === '/api/relay/metrics') {
      handleRelayMetrics(req, res, args, store, telemetry)
      return
    }
    if (args.embeddedAdminUi !== false && req.method === 'GET' && url.pathname.startsWith('/admin/assets/')) {
      await handleAdminAssetRoute(req, res, args, url)
      return
    }
    if (
      args.embeddedAdminUi !== false && req.method === 'GET' &&
      (url.pathname === '/admin' || url.pathname.startsWith('/admin/'))
    ) {
      await handleAdminPageRoute(req, res, args)
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/relay/devices/register') {
      await handleDeviceRegister(req, res, args, store, storeRepository, telemetry)
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/relay/devices/heartbeat') {
      await handleDeviceHeartbeat(req, res, args, store, storeRepository, telemetry)
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/relay/devices') {
      handleDeviceList(req, res, args, store)
      return
    }
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/relay/devices/')) {
      const deviceId = decodeURIComponent(url.pathname.slice('/api/relay/devices/'.length))
      await handleDeviceUpdate(req, res, args, store, storeRepository, deviceId, telemetry)
      return
    }
    if (
      await handleRelaySessionsRoute(
        req,
        res,
        args,
        store,
        storeRepository,
        url,
        telemetry,
        onForwardingJobAvailable
      )
    ) {
      return
    }
    if (url.pathname.startsWith('/api/admin/security/tokens')) {
      await handleAdminSecurityTokens(req, res, args, store, storeRepository, url)
      return
    }
    if (url.pathname === '/api/admin/access-groups' || url.pathname.startsWith('/api/admin/access-groups/')) {
      await handleAdminAccessGroups(req, res, args, store, storeRepository, url)
      return
    }
    if (url.pathname === '/api/admin/users' || url.pathname.startsWith('/api/admin/users/')) {
      await handleAdminUsers(req, res, args, store, storeRepository, url)
      return
    }
    if (url.pathname === '/api/admin/invites' || url.pathname.startsWith('/api/admin/invites/')) {
      await handleAdminInvites(req, res, args, store, storeRepository, url)
      return
    }
    if (url.pathname === '/api/admin/sso-providers' || url.pathname.startsWith('/api/admin/sso-providers/')) {
      await handleAdminSsoProviders(req, res, args, store, storeRepository, url)
      return
    }

    sendJson(res, 404, { error: 'Not found.' }, args.allowOrigin)
  } finally {
    await auditLogger.flush()
  }
}

export const createRelayHandler = (
  args: RelayServerArgs,
  telemetry: RelayTelemetry = createRelayTelemetry(),
  storeRepository?: RelayStoreRepository,
  options: { onForwardingJobAvailable?: ForwardingJobAvailableObserver } = {}
) => {
  let defaultStoreRepository: Promise<RelayStoreRepository> | undefined
  const loadStoreRepository = async () => {
    if (storeRepository != null) return storeRepository
    defaultStoreRepository ??= import(`./storage/${'repository.js'}`).then(module =>
      (module as RelayStoreRepositoryModule).createRelayStoreRepository(args)
    )
    return await defaultStoreRepository
  }
  const rateLimiter = createRelayRateLimiter()

  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {}, args.allowOrigin)
      return
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, relayHealth(args), args.allowOrigin)
      return
    }
    const rateLimit = rateLimiter.check(req, url)
    if (!rateLimit.allowed) {
      sendRateLimitExceeded(req, res, args, rateLimit)
      return
    }

    const postPollMatch = req.method === 'POST'
      ? /^\/api\/relay\/devices\/([^/]+)\/session-jobs$/.exec(url.pathname)
      : undefined
    if (postPollMatch != null) {
      let body: Record<string, unknown>
      try {
        body = await readRequestBody(req, { maxBytes: 64 * 1024 })
      } catch (error) {
        if (error instanceof RelayRequestBodyTooLargeError) {
          sendJson(res, 413, { error: 'Long-poll request body is too large.' }, args.allowOrigin)
          return
        }
        sendJson(res, 400, { error: 'Invalid long-poll request body.' }, args.allowOrigin)
        return
      }
      const deviceId = decodeSegment(postPollMatch[1])
      const heartbeat = body.heartbeat
      const limit = body.limit
      const valid = url.search === '' &&
        heartbeat != null && typeof heartbeat === 'object' && !Array.isArray(heartbeat) &&
        body.status === 'queued' &&
        typeof body.waitMs === 'number' && Number.isSafeInteger(body.waitMs) && body.waitMs >= 1_000 &&
        body.waitMs <= 55_000 &&
        (limit == null || (typeof limit === 'number' && Number.isSafeInteger(limit) && limit >= 1 && limit <= 100)) &&
        ((heartbeat as { deviceId?: unknown }).deviceId == null ||
          (heartbeat as { deviceId?: unknown }).deviceId === deviceId)
      if (!valid) {
        sendJson(res, 400, { error: 'Invalid long-poll request body.' }, args.allowOrigin)
        return
      }
      const pollUrl = new URL(url)
      pollUrl.searchParams.set('status', 'queued')
      pollUrl.searchParams.set('waitMs', String(body.waitMs))
      if (limit != null) pollUrl.searchParams.set('limit', String(limit))
      const activeStoreRepository = await loadStoreRepository()
      setForwardingPayloadRepository(activeStoreRepository.forwardingPayloads)
      await handleListJobsWithoutStoreLock(
        req,
        res,
        args,
        activeStoreRepository,
        pollUrl,
        deviceId,
        telemetry,
        heartbeat
      )
      return
    }
    const activeStoreRepository = await loadStoreRepository()
    setForwardingPayloadRepository(activeStoreRepository.forwardingPayloads)
    const longPollDeviceId = getSessionJobLongPollDeviceId(req, url)
    if (longPollDeviceId != null) {
      await handleListJobsWithoutStoreLock(req, res, args, activeStoreRepository, url, longPollDeviceId, telemetry)
      return
    }

    if (activeStoreRepository.withStore != null) {
      const pendingForwardingNotifications = new Set<string>()
      await activeStoreRepository.withStore(async (store, requestRepository) => {
        await handleRelayRequestWithStore(
          req,
          res,
          args,
          telemetry,
          requestRepository,
          store,
          deviceId => pendingForwardingNotifications.add(deviceId)
        )
      })
      for (const deviceId of pendingForwardingNotifications) {
        options.onForwardingJobAvailable?.(deviceId)
      }
      return
    }
    await handleRelayRequestWithStore(
      req,
      res,
      args,
      telemetry,
      activeStoreRepository,
      await activeStoreRepository.read(),
      options.onForwardingJobAvailable
    )
  }
}

export const createRelayServer = (args: RelayServerArgs): Server => {
  const defaultHost = args.host === '0.0.0.0' || args.host === '::' ? '127.0.0.1' : args.host
  const publicBaseUrl = args.publicBaseUrl ?? `http://${defaultHost}:${args.port}`
  // The Node listener owns this endpoint, so deployment-specific transport settings must never
  // advertise a different platform's control socket from a native server.
  const deviceTransport = {
    apiBaseUrl: new URL(publicBaseUrl).toString(),
    controlWebSocketUrl: new URL('/api/relay/devices/control', publicBaseUrl)
      .toString().replace(/^http/u, 'ws'),
    heartbeatIntervalMs: 30_000,
    version: 1 as const
  }
  const resolvedArgs = { ...args, deviceTransport }
  const telemetry = createRelayTelemetry()
  const repository = createRelayStoreRepository(resolvedArgs)
  const server = createServer((req, res) => {
    void handler(req, res).catch(error => {
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : new Error(String(error)))
        return
      }
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error)
      }, resolvedArgs.allowOrigin)
    })
  })
  const nodeControl = attachRelayNodeControl({ args: resolvedArgs, repository, server, telemetry })
  const handler = createRelayHandler(resolvedArgs, telemetry, repository, {
    onForwardingJobAvailable: nodeControl.onForwardingJobAvailable
  })
  server.on('listening', () => {
    if (args.publicBaseUrl != null || args.port !== 0) return
    const address = server.address() as AddressInfo | null
    if (address == null || typeof address === 'string') return
    const origin = `http://${defaultHost}:${address.port}`
    resolvedArgs.deviceTransport = {
      apiBaseUrl: `${origin}/`,
      controlWebSocketUrl: `ws://${defaultHost}:${address.port}/api/relay/devices/control`,
      heartbeatIntervalMs: 30_000,
      version: 1
    }
  })
  server.on('close', () => nodeControl.close())
  return server
}

const isFileStorageDriver = (driver: RelayServerArgs['storageDriver']) =>
  driver == null || driver === 'json' || driver === 'sqlite'

const displayDataLocation = (args: RelayServerArgs) => {
  if (args.storageDriver === 'postgres') {
    return args.dataPath.replace(/:\/\/([^:@]+):([^@]+)@/, '://$1:***@') || 'postgres'
  }
  return args.dataPath
}

export const startRelayServer = (args: RelayServerArgs) => {
  const resolvedArgs = {
    ...args,
    dataPath: isFileStorageDriver(args.storageDriver) ? resolve(args.dataPath) : args.dataPath
  }
  const server = createRelayServer(resolvedArgs)
  server.listen(resolvedArgs.port, resolvedArgs.host, () => {
    process.stdout.write(`[relay-server] listening on http://${resolvedArgs.host}:${resolvedArgs.port}\n`)
    process.stdout.write(`[relay-server] storage ${resolvedArgs.storageDriver ?? 'json'}\n`)
    process.stdout.write(`[relay-server] data ${displayDataLocation(resolvedArgs)}\n`)
    if (resolvedArgs.adminToken === '') {
      process.stdout.write('[relay-server] admin token is not set; admin endpoints and pairing are open.\n')
    }
  })
  return {
    args: resolvedArgs,
    server
  }
}
