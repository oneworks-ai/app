/* eslint-disable max-lines -- Audit helpers centralize request metadata, resource labels, and security event writes. */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { resolveRelayAccessToken } from '../auth/access-tokens.js'
import { deviceTokenMatches } from '../devices/private-metadata.js'
import { getBearerToken, responseJsonBody } from '../http.js'
import { relayPermissions } from '../permissions/index.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import { logRelayEvent } from '../telemetry/logger.js'
import type { RelayAuditLogEntry, RelayOpenApiAuditEvent, RelayServerArgs, RelayStore } from '../types.js'
import { requestId, requestIp, requestUserAgent } from './request.js'

export type RelayAuditEvent = Omit<RelayAuditLogEntry, 'createdAt' | 'id'>

const MAX_AUDIT_EVENTS = 1000
const MAX_OPEN_API_AUDIT_EVENTS = 5000

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

export const buildAuditLogEntry = (input: Record<string, unknown>): RelayAuditLogEntry => ({
  ...buildAuditEvent(input),
  id: cleanAuditText(input.id, randomUUID(), 120),
  createdAt: cleanAuditText(input.createdAt, new Date().toISOString(), 80)
})

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

const resolveTeamId = (store: RelayStore, value: string | undefined) => {
  const teamId = decodeSegment(value)
  if (teamId == null) return 'unknown'
  return store.teams.find(team => team.id === teamId || team.slug === teamId)?.id ?? teamId
}

const teamResource = (teamId: string) => `team:${teamId}`

const profileTeamResource = (store: RelayStore, profileId: string | undefined) => {
  const id = decodeSegment(profileId)
  const profile = id == null ? undefined : store.configProfiles.find(item => item.id === id)
  return profile == null ? `profile:${id ?? 'unknown'}` : teamResource(profile.teamId)
}

const assignmentTeamResource = (store: RelayStore, assignmentId: string | undefined) => {
  const id = decodeSegment(assignmentId)
  const assignment = id == null ? undefined : store.configProfileAssignments.find(item => item.id === id)
  return assignment == null ? `assignment:${id ?? 'unknown'}` : profileTeamResource(store, assignment.profileId)
}

const secretTeamResource = (store: RelayStore, secretId: string | undefined) => {
  const id = decodeSegment(secretId)
  const secret = id == null ? undefined : store.configSecrets.find(item => item.id === id)
  return secret == null ? `secret:${id ?? 'unknown'}` : teamResource(secret.teamId)
}

const configProfileAuditAction = (leaf: string | undefined) => {
  if (leaf == null) return 'config.profile.update'
  if (leaf === 'versions') return 'config.profile.version.create'
  if (leaf === 'publish') return 'config.profile.publish'
  if (leaf === 'assignments') return 'config.assignment.create'
  return `config.profile.${leaf}`
}

const teamAuditAction = (
  leaf: string | undefined,
  method: string | undefined,
  nestedId: string | undefined
) => {
  if (leaf == null) return 'team.update'
  if (leaf === 'archive') return 'team.archive'
  if (leaf === 'restore') return 'team.restore'
  if (leaf !== 'members') return `team.${leaf}`
  if (nestedId == null) return 'team.member.create'
  if (method === 'PATCH') return 'team.member.update'
  if (method === 'DELETE') return 'team.member.delete'
  return 'team.members'
}

export const classifyAuditTarget = (req: IncomingMessage, url: URL, store: RelayStore) => {
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
  if (req.method === 'POST' && url.pathname === '/api/auth/email-code-login') {
    return {
      action: 'auth.email_code_login',
      resource: 'email-code'
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
  if (req.method === 'GET' && url.pathname === '/api/relay/config-snapshot') {
    return {
      action: 'config.snapshot.deliver',
      resource: 'config-snapshot'
    }
  }
  const teamConfigSecretsMatch = /^\/api\/(admin|relay)\/teams\/([^/]+)\/config-secrets$/.exec(url.pathname)
  if (req.method === 'POST' && teamConfigSecretsMatch != null) {
    return {
      action: 'config.secret.create',
      resource: teamResource(resolveTeamId(store, teamConfigSecretsMatch[2]))
    }
  }
  const teamConfigProfilesMatch = /^\/api\/(admin|relay)\/teams\/([^/]+)\/config-profiles$/.exec(url.pathname)
  if (req.method === 'POST' && teamConfigProfilesMatch != null) {
    return {
      action: 'config.profile.create',
      resource: teamResource(resolveTeamId(store, teamConfigProfilesMatch[2]))
    }
  }
  const configSecretActionMatch = /^\/api\/(admin|relay)\/config-secrets\/([^/]+)\/(rotate|revoke)$/.exec(url.pathname)
  if (req.method === 'POST' && configSecretActionMatch != null) {
    return {
      action: `config.secret.${configSecretActionMatch[3]}`,
      resource: secretTeamResource(store, configSecretActionMatch[2])
    }
  }
  const configProfileActionMatch = /^\/api\/(admin|relay)\/config-profiles\/([^/]+)(?:\/([^/]+))?$/.exec(
    url.pathname
  )
  if (configProfileActionMatch != null && ['PATCH', 'POST'].includes(req.method ?? '')) {
    const leaf = configProfileActionMatch[3]
    return {
      action: configProfileAuditAction(leaf),
      resource: profileTeamResource(store, configProfileActionMatch[2])
    }
  }
  const configAssignmentActionMatch = /^\/api\/(admin|relay)\/config-assignments\/([^/]+)$/.exec(url.pathname)
  if (req.method === 'PATCH' && configAssignmentActionMatch != null) {
    return {
      action: 'config.assignment.update',
      resource: assignmentTeamResource(store, configAssignmentActionMatch[2])
    }
  }
  const teamActionMatch = /^\/api\/(admin|relay)\/teams\/([^/]+)(?:\/([^/]+)(?:\/([^/]+))?)?$/.exec(url.pathname)
  if (teamActionMatch != null && ['DELETE', 'PATCH', 'POST'].includes(req.method ?? '')) {
    const teamId = resolveTeamId(store, teamActionMatch[2])
    const leaf = teamActionMatch[3]
    const nestedId = teamActionMatch[4]
    return {
      action: teamAuditAction(leaf, req.method, nestedId),
      resource: teamResource(teamId)
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

export const rememberAuditEvent = (store: RelayStore, input: Record<string, unknown>) => {
  store.auditEvents.push(buildAuditLogEntry(input))
  if (store.auditEvents.length > MAX_AUDIT_EVENTS) {
    store.auditEvents.splice(0, store.auditEvents.length - MAX_AUDIT_EVENTS)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const responseErrorMessage = (res: ServerResponse) => {
  if (res.statusCode < 400) return undefined
  const body = responseJsonBody(res)
  if (!isRecord(body) || typeof body.error !== 'string' || body.error.trim() === '') return undefined
  return body.error.trim().slice(0, 500)
}

const openApiPermissionForRequest = (req: IncomingMessage, url: URL) => {
  const requestMethod = req.method ?? 'GET'
  const path = url.pathname
  if (path === '/api/profile/security' && requestMethod === 'GET') return 'profile.security.read'
  if (path === '/api/profile/openapi-audit' && requestMethod === 'GET') return 'profile.openApiAudit.read'
  if (path === '/api/profile/access-tokens' && requestMethod === 'POST') return 'profile.accessTokens.create'
  if (/^\/api\/profile\/access-tokens\/[^/]+$/.test(path) && requestMethod === 'DELETE') {
    return 'profile.accessTokens.revoke'
  }
  if (path === '/api/profile/password' && requestMethod === 'POST') return 'profile.password.write'
  if (/^\/api\/profile\/passkeys\/register\//.test(path) && requestMethod === 'POST') return 'profile.passkeys.write'
  if (path === '/api/relay/config-snapshot' && requestMethod === 'GET') return relayPermissions.relayConfigSnapshotRead
  if (path === '/api/relay/team-policy') {
    return requestMethod === 'GET' ? relayPermissions.relayTeamsRead : relayPermissions.relayTeamsWrite
  }
  if (/^\/api\/relay\/teams(?:\/|$)/.test(path)) {
    if (path.includes('/members')) {
      return ['DELETE', 'PATCH', 'POST'].includes(requestMethod)
        ? relayPermissions.relayTeamMembersWrite
        : relayPermissions.relayTeamMembersRead
    }
    return ['DELETE', 'PATCH', 'POST'].includes(requestMethod)
      ? relayPermissions.relayTeamsWrite
      : relayPermissions.relayTeamsRead
  }
  if (/^\/api\/relay\/config-(?:assignments|profiles|secrets)(?:\/|$)/.test(path)) {
    return ['DELETE', 'PATCH', 'POST'].includes(requestMethod)
      ? relayPermissions.relayTeamsWrite
      : relayPermissions.relayTeamsRead
  }
  if (path === '/api/admin/users' || path.startsWith('/api/admin/users/')) {
    return ['DELETE', 'PATCH', 'POST'].includes(requestMethod)
      ? relayPermissions.adminUsersWrite
      : relayPermissions.adminUsersRead
  }
  if (path === '/api/admin/invites' || path.startsWith('/api/admin/invites/')) {
    return ['DELETE', 'PATCH', 'POST'].includes(requestMethod)
      ? relayPermissions.adminInvitesWrite
      : relayPermissions.adminInvitesRead
  }
  if (path === '/api/admin/sso-providers' || path.startsWith('/api/admin/sso-providers/')) {
    return ['DELETE', 'PATCH', 'POST'].includes(requestMethod)
      ? relayPermissions.adminSsoWrite
      : relayPermissions.adminSsoRead
  }
  if (path.startsWith('/api/admin/')) {
    return ['DELETE', 'PATCH', 'POST'].includes(requestMethod)
      ? relayPermissions.adminSettingsWrite
      : relayPermissions.adminSettingsRead
  }
  return undefined
}

export const rememberOpenApiAuditEvent = (
  store: RelayStore,
  input: Omit<RelayOpenApiAuditEvent, 'createdAt' | 'id'>
) => {
  const events = store.openApiAuditEvents ?? []
  events.push({
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString()
  })
  if (events.length > MAX_OPEN_API_AUDIT_EVENTS) {
    events.splice(0, events.length - MAX_OPEN_API_AUDIT_EVENTS)
  }
  store.openApiAuditEvents = events
}

const buildOpenApiAuditEvent = (
  req: IncomingMessage,
  res: ServerResponse,
  accessToken: NonNullable<ReturnType<typeof resolveRelayAccessToken>>['accessToken'],
  url: URL
): Omit<RelayOpenApiAuditEvent, 'createdAt' | 'id'> => ({
  tokenId: accessToken.id,
  tokenPreview: accessToken.tokenPreview,
  userId: accessToken.userId,
  method: (req.method ?? 'GET').toUpperCase(),
  path: url.pathname,
  status: res.statusCode,
  ip: requestIp(req),
  userAgent: requestUserAgent(req),
  permission: openApiPermissionForRequest(req, url),
  error: responseErrorMessage(res)
})

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

const shouldRememberAuditEvent = (input: Pick<RelayAuditEvent, 'resource'>) => input.resource.startsWith('team:')

const createNoopAuditLogger = () => ({
  flush: async () => {}
})

export const attachAuditLogger = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  const target = classifyAuditTarget(req, url, store)
  const bearerToken = getBearerToken(req)
  const shouldInspectOpenApiAudit = bearerToken.startsWith('owrt_') && url.pathname.startsWith('/api/')
  if (target == null && !shouldInspectOpenApiAudit) return createNoopAuditLogger()
  const actor = target == null ? 'bearer' : resolveAuditActor(req, args, store)
  let flushed = false
  return {
    flush: async () => {
      if (flushed || !res.headersSent) return
      flushed = true
      let shouldWriteStore = false
      if (target != null) {
        const event = {
          actor,
          action: target.action,
          resource: target.resource,
          status: auditStatusFromHttpStatus(res.statusCode)
        }
        recordRequestAuditEvent(req, event)
        if (shouldRememberAuditEvent(event)) {
          rememberAuditEvent(store, {
            ...event,
            ip: requestIp(req),
            requestId: requestId(req),
            userAgent: requestUserAgent(req)
          })
          shouldWriteStore = true
        }
      }
      const accessToken = shouldInspectOpenApiAudit ? resolveRelayAccessToken(store, bearerToken) : undefined
      if (accessToken != null && url.pathname.startsWith('/api/')) {
        rememberOpenApiAuditEvent(store, buildOpenApiAuditEvent(req, res, accessToken.accessToken, url))
        shouldWriteStore = true
      }
      if (shouldWriteStore) {
        await storeRepository.write(store)
      }
    }
  }
}
