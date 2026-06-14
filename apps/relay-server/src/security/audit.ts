import type { IncomingMessage, ServerResponse } from 'node:http'

import { deviceTokenMatches } from '../devices/private-metadata.js'
import { getBearerToken } from '../http.js'
import { logRelayEvent } from '../telemetry/logger.js'
import type { RelayServerArgs, RelayStore } from '../types.js'
import { requestId, requestIp, requestUserAgent } from './request.js'

export interface RelayAuditEvent {
  actor: string
  action: string
  resource: string
  status: string
  ip?: string
  userAgent?: string
  requestId?: string
}

const cleanAuditText = (value: unknown, fallback: string, maxLength: number) => {
  if (typeof value !== 'string') return fallback
  const text = value.trim()
  return text === '' ? fallback : text.slice(0, maxLength)
}

export const buildAuditEvent = (input: Record<string, unknown>): RelayAuditEvent => {
  const event: RelayAuditEvent = {
    actor: cleanAuditText(input.actor, 'anonymous', 160),
    action: cleanAuditText(input.action, 'unknown', 160),
    resource: cleanAuditText(input.resource, 'unknown', 200),
    status: cleanAuditText(input.status, 'unknown', 80)
  }
  const ip = cleanAuditText(input.ip, '', 128)
  const userAgent = cleanAuditText(input.userAgent, '', 240)
  const id = cleanAuditText(input.requestId, '', 120)
  if (ip !== '') event.ip = ip
  if (userAgent !== '') event.userAgent = userAgent
  if (id !== '') event.requestId = id
  return event
}

export const auditStatusFromHttpStatus = (statusCode: number) => {
  if (statusCode === 429) return 'blocked'
  return statusCode >= 200 && statusCode < 400 ? 'success' : 'failure'
}

export const resolveAuditActor = (
  req: IncomingMessage,
  args: RelayServerArgs,
  store: RelayStore
) => {
  const token = getBearerToken(req)
  if (token === '') return 'anonymous'
  if (args.adminToken !== '' && token === args.adminToken) return 'admin-token'
  const session = store.sessions.find(item => item.token === token && Date.parse(item.expiresAt) > Date.now())
  if (session != null) return `session:${session.userId}`
  const device = store.devices.find(item => deviceTokenMatches(item, token))
  if (device != null) return `device:${device.id}`
  return 'bearer'
}

const decodeSegment = (value: string | undefined) => {
  if (value == null) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export const classifyAuditTarget = (req: IncomingMessage, url: URL) => {
  const oauthMatch = /^\/api\/auth\/oauth\/([^/]+)\/(start|callback)$/.exec(url.pathname)
  if (oauthMatch != null) {
    return {
      action: `auth.oauth.${oauthMatch[2]}`,
      resource: `provider:${decodeSegment(oauthMatch[1]) ?? 'unknown'}`
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    return {
      action: 'auth.logout',
      resource: 'session'
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/invite-login') {
    return {
      action: 'auth.invite_login',
      resource: 'invite'
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/password-login') {
    return {
      action: 'auth.password_login',
      resource: 'password'
    }
  }
  const passkeyMatch = /^\/api\/auth\/passkey\/(register|login)\/(options|verify)$/.exec(url.pathname)
  if (req.method === 'POST' && passkeyMatch != null) {
    return {
      action: `auth.passkey.${passkeyMatch[1]}.${passkeyMatch[2]}`,
      resource: 'passkey'
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/relay/devices/register') {
    return {
      action: 'device.register',
      resource: 'device'
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/relay/devices/heartbeat') {
    return {
      action: 'device.heartbeat',
      resource: 'device'
    }
  }
  const claimMatch = /^\/api\/relay\/devices\/([^/]+)\/session-jobs$/.exec(url.pathname)
  if (req.method === 'GET' && claimMatch != null) {
    return {
      action: 'device.session_jobs.claim',
      resource: `device:${decodeSegment(claimMatch[1]) ?? 'unknown'}`
    }
  }
  if (url.pathname === '/api/admin/security/tokens/rotate' && req.method === 'POST') {
    return {
      action: 'admin.security.tokens.rotate',
      resource: 'token'
    }
  }
  if (url.pathname === '/api/admin/security/tokens/revoke' && req.method === 'POST') {
    return {
      action: 'admin.security.tokens.revoke',
      resource: 'token'
    }
  }
  if (/^\/api\/admin\//.test(url.pathname) && ['DELETE', 'PATCH', 'POST'].includes(req.method ?? '')) {
    return {
      action: `admin.${req.method?.toLowerCase() ?? 'unknown'}`,
      resource: url.pathname
    }
  }
  return undefined
}

export const recordAuditEvent = (input: Record<string, unknown>) => {
  logRelayEvent('info', 'relay.audit', { ...buildAuditEvent(input) })
}

export const recordRequestAuditEvent = (
  req: IncomingMessage,
  input: Pick<RelayAuditEvent, 'actor' | 'action' | 'resource' | 'status'>
) => {
  recordAuditEvent({
    ...input,
    ip: requestIp(req),
    requestId: requestId(req),
    userAgent: requestUserAgent(req)
  })
}

export const attachAuditLogger = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  url: URL
) => {
  const target = classifyAuditTarget(req, url)
  if (target == null) return
  const actor = resolveAuditActor(req, args, store)
  res.once('finish', () => {
    recordRequestAuditEvent(req, {
      actor,
      action: target.action,
      resource: target.resource,
      status: auditStatusFromHttpStatus(res.statusCode)
    })
  })
}
