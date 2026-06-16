/* eslint-disable max-lines -- Relay server routing is centralized to keep platform adapters thin. */
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import process from 'node:process'

import { enabledRelayAuthProviders } from './auth/sso-provider-registry.js'
import { sendJson } from './http.js'
import { handleAdminSsoProviders } from './routes/admin-sso-providers.js'
import { handleAdminInvites, handleAdminUsers } from './routes/admin.js'
import { handleAuthRoute } from './routes/auth.js'
import { handleDeviceHeartbeat, handleDeviceList, handleDeviceRegister } from './routes/devices.js'
import { handleEmailCodeLoginRoute } from './routes/email-code-login.js'
import { handleEmailVerificationSendRoute } from './routes/email-verification.js'
import { handleInviteLoginRoute } from './routes/invite-login.js'
import { handleLoginRoute } from './routes/login.js'
import { handleRelayMetrics } from './routes/metrics.js'
import { handlePasskeyRoute } from './routes/passkeys.js'
import { handlePasswordLoginRoute } from './routes/password-login.js'
import { handleRelaySessionsRoute } from './routes/sessions.js'
import { handleAdminSecurityTokens } from './security/admin-route.js'
import { attachAuditLogger } from './security/audit.js'
import { createRelayRateLimiter, sendRateLimitExceeded } from './security/rate-limit.js'
import { setForwardingPayloadRepository } from './session-forwarding/payloads.js'
import type { RelayStoreRepository } from './storage/repository.js'
import { createRelayTelemetry } from './telemetry/metrics.js'
import type { RelayTelemetry } from './telemetry/metrics.js'
import type { RelayServerArgs, RelayStore } from './types.js'
import { VERSION } from './version.js'

type RelayStoreRepositoryModule = typeof import('./storage/repository.js')

export { parseRelayServerArgs, printRelayServerHelp } from './config.js'
export { readRelayStore } from './store.js'
export type { RelayServerArgs } from './types.js'
export { VERSION } from './version.js'

const handleInfo = (res: ServerResponse, args: RelayServerArgs, store: RelayStore) => {
  const providers = enabledRelayAuthProviders(args, store)
  sendJson(res, 200, {
    name: 'OneWorks Relay',
    version: VERSION,
    features: {
      authSessions: true,
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
      sessionForwarding: true
    }
  }, args.allowOrigin)
}

const handleAdminAssetRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  url: URL
) => {
  const { handleAdminAsset } = await import('./routes/admin-ui.js')
  await handleAdminAsset(req, res, args, url)
}

const handleAdminPageRoute = async (req: IncomingMessage, res: ServerResponse, args: RelayServerArgs) => {
  const { handleAdminPage } = await import('./routes/admin-ui.js')
  handleAdminPage(req, res, args)
}

const handleRelayRequestWithStore = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  telemetry: RelayTelemetry,
  storeRepository: RelayStoreRepository,
  store: RelayStore
) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  attachAuditLogger(req, res, args, store, url)

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
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true, version: VERSION }, args.allowOrigin)
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/relay/info') {
    handleInfo(res, args, store)
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
  if (await handleRelaySessionsRoute(req, res, args, store, storeRepository, url, telemetry)) {
    return
  }
  if (url.pathname.startsWith('/api/admin/security/tokens')) {
    await handleAdminSecurityTokens(req, res, args, store, storeRepository, url)
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
}

export const createRelayHandler = (
  args: RelayServerArgs,
  telemetry: RelayTelemetry = createRelayTelemetry(),
  storeRepository?: RelayStoreRepository
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
    const rateLimit = rateLimiter.check(req, url)
    if (!rateLimit.allowed) {
      sendRateLimitExceeded(req, res, args, rateLimit)
      return
    }

    const activeStoreRepository = await loadStoreRepository()
    setForwardingPayloadRepository(activeStoreRepository.forwardingPayloads)

    if (activeStoreRepository.withStore != null) {
      await activeStoreRepository.withStore(async (store, requestRepository) => {
        await handleRelayRequestWithStore(req, res, args, telemetry, requestRepository, store)
      })
      return
    }
    await handleRelayRequestWithStore(
      req,
      res,
      args,
      telemetry,
      activeStoreRepository,
      await activeStoreRepository.read()
    )
  }
}

export const createRelayServer = (args: RelayServerArgs): Server => {
  const handler = createRelayHandler(args)
  return createServer((req, res) => {
    void handler(req, res).catch(error => {
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : new Error(String(error)))
        return
      }
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error)
      }, args.allowOrigin)
    })
  })
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
