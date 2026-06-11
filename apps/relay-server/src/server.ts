import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import process from 'node:process'

import { enabledRelayAuthProviders } from './auth/sso-provider-registry.js'
import { sendJson } from './http.js'
import { handleAdminSsoProviders } from './routes/admin-sso-providers.js'
import { handleAdminAsset, handleAdminPage } from './routes/admin-ui.js'
import { handleAdminInvites, handleAdminUsers } from './routes/admin.js'
import { handleAuthRoute } from './routes/auth.js'
import { handleDeviceHeartbeat, handleDeviceList, handleDeviceRegister } from './routes/devices.js'
import { handleInviteLoginRoute } from './routes/invite-login.js'
import { handleLoginRoute } from './routes/login.js'
import { handleRelayMetrics } from './routes/metrics.js'
import { handlePasswordLoginRoute } from './routes/password-login.js'
import { handleRelaySessionsRoute } from './routes/sessions.js'
import { handleAdminSecurityTokens } from './security/admin-route.js'
import { attachAuditLogger } from './security/audit.js'
import { createRelayRateLimiter, sendRateLimitExceeded } from './security/rate-limit.js'
import { createRelayStoreRepository } from './storage/repository.js'
import { createRelayTelemetry } from './telemetry/metrics.js'
import type { RelayTelemetry } from './telemetry/metrics.js'
import type { RelayServerArgs, RelayStore } from './types.js'
import { VERSION } from './types.js'

export { parseRelayServerArgs, printRelayServerHelp } from './config.js'
export { createRelayStoreRepository } from './storage/repository.js'
export { readRelayStore } from './store.js'
export type { RelayServerArgs } from './types.js'
export { VERSION } from './types.js'

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
      oauth: providers.length > 0,
      oauthProviders: providers,
      sessionForwarding: true
    }
  }, args.allowOrigin)
}

export const createRelayHandler = (args: RelayServerArgs, telemetry: RelayTelemetry = createRelayTelemetry()) => {
  const storeRepository = createRelayStoreRepository(args)
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

    const store = await storeRepository.read()
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
    if (req.method === 'GET' && url.pathname.startsWith('/admin/assets/')) {
      await handleAdminAsset(req, res, args, url)
      return
    }
    if (req.method === 'GET' && (url.pathname === '/admin' || url.pathname.startsWith('/admin/'))) {
      handleAdminPage(req, res, args)
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

export const startRelayServer = (args: RelayServerArgs) => {
  const resolvedArgs = {
    ...args,
    dataPath: resolve(args.dataPath)
  }
  const server = createRelayServer(resolvedArgs)
  server.listen(resolvedArgs.port, resolvedArgs.host, () => {
    process.stdout.write(`[relay-server] listening on http://${resolvedArgs.host}:${resolvedArgs.port}\n`)
    process.stdout.write(`[relay-server] storage ${resolvedArgs.storageDriver ?? 'json'}\n`)
    process.stdout.write(`[relay-server] data ${resolvedArgs.dataPath}\n`)
    if (resolvedArgs.adminToken === '') {
      process.stdout.write('[relay-server] admin token is not set; admin endpoints and pairing are open.\n')
    }
  })
  return {
    args: resolvedArgs,
    server
  }
}
