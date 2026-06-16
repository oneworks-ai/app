import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'

import {
  normalizeRelayConfigProfile,
  normalizeRelayConfigProfileAssignment,
  normalizeRelayConfigProfileVersion
} from './config-profiles.js'
import { normalizeRelayConfigAssignment } from './config-snapshot.js'
import { hashDeviceToken } from './devices/private-metadata.js'
import { sanitizeRelayStorageValue } from './storage/content-boundary.js'
import { normalizeRelaySsoProviders } from './storage/sso-providers.js'
import { normalizeRelayTeamPolicy, normalizeTeamRole } from './teams.js'
import type {
  RelayAuditLogEntry,
  RelayConfigAssignment,
  RelayConfigProfile,
  RelayConfigProfileAssignment,
  RelayConfigProfileVersion,
  RelayConfigSecret,
  RelayDevice,
  RelayDeviceSession,
  RelayEmailChallenge,
  RelayEmailPurpose,
  RelayEmailRiskBucket,
  RelayEmailRiskState,
  RelayEncryptedPayload,
  RelayForwardingJob,
  RelayForwardingJobStatus,
  RelayInvite,
  RelayOAuthState,
  RelayPasskeyChallenge,
  RelayPasskeyChallengeKind,
  RelayPasskeyCredential,
  RelaySession,
  RelayStore,
  RelayTeam,
  RelayTeamMember,
  RelayUser
} from './types.js'
import { createToken, isRecord, normalizeRole, now } from './utils.js'

const defaultStore = (): RelayStore => ({
  createdAt: now(),
  auditEvents: [],
  configAssignments: [],
  configProfileAssignments: [],
  configSecrets: [],
  configProfileVersions: [],
  configProfiles: [],
  emailRisk: {
    buckets: [],
    challenges: []
  },
  teamPolicy: normalizeRelayTeamPolicy(undefined),
  teams: [],
  teamMembers: [],
  users: [],
  invites: [],
  ssoProviders: [],
  passkeyChallenges: [],
  passkeys: [],
  devices: [],
  deviceSessions: [],
  forwardingJobs: [],
  oauthStates: [],
  sessions: []
})

const normalizeUser = (value: Record<string, unknown>): RelayUser => ({
  id: typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : randomUUID(),
  email: typeof value.email === 'string' ? value.email.trim() : '',
  name: typeof value.name === 'string' ? value.name.trim() : '',
  avatarUrl: typeof value.avatarUrl === 'string' && value.avatarUrl.trim() !== '' ? value.avatarUrl.trim() : undefined,
  disabledAt: typeof value.disabledAt === 'string' && value.disabledAt.trim() !== ''
    ? value.disabledAt.trim()
    : undefined,
  maxDevices: Number.isFinite(Number(value.maxDevices)) ? Math.max(0, Math.trunc(Number(value.maxDevices))) : undefined,
  passwordHash: typeof value.passwordHash === 'string' && value.passwordHash.trim() !== ''
    ? value.passwordHash.trim()
    : undefined,
  provider: typeof value.provider === 'string' && value.provider.trim() !== '' ? value.provider.trim() : undefined,
  providerUserId: typeof value.providerUserId === 'string' && value.providerUserId.trim() !== ''
    ? value.providerUserId.trim()
    : undefined,
  role: normalizeRole(value.role, 'member'),
  teamIds: normalizeStringArray(value.teamIds),
  createdAt: typeof value.createdAt === 'string' ? value.createdAt : now(),
  updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined
})

const normalizeStringArray = (value: unknown) => (
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
    : undefined
)

const normalizeSlug = (value: unknown, fallback: string) => {
  const source = typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
  const slug = source.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  return slug === '' ? fallback : slug
}

const normalizeHttpUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

const normalizeImageDataUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\s]+)$/iu.exec(value.trim())
  if (match == null) return undefined
  const base64 = match[2].replace(/\s/gu, '')
  return base64 === '' ? undefined : `data:${match[1].toLowerCase()};base64,${base64}`
}

const normalizeAvatarSource = (value: unknown) => normalizeImageDataUrl(value) ?? normalizeHttpUrl(value)

const normalizeTeam = (value: Record<string, unknown>): RelayTeam | undefined => {
  const id = typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : undefined
  const slug = normalizeSlug(value.slug, id ?? randomUUID())
  const teamId = id ?? slug
  return {
    id: teamId,
    slug,
    name: typeof value.name === 'string' && value.name.trim() !== '' ? value.name.trim() : teamId,
    description: typeof value.description === 'string' && value.description.trim() !== ''
      ? value.description.trim()
      : undefined,
    avatarUrl: normalizeAvatarSource(value.avatarUrl),
    ...(typeof value.proxyModeEnabled === 'boolean' ? { proxyModeEnabled: value.proxyModeEnabled } : {}),
    createdByUserId: typeof value.createdByUserId === 'string' && value.createdByUserId.trim() !== ''
      ? value.createdByUserId.trim()
      : 'system',
    archivedAt: typeof value.archivedAt === 'string' && value.archivedAt.trim() !== ''
      ? value.archivedAt.trim()
      : undefined,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined
  }
}

const normalizeTeamMember = (value: Record<string, unknown>): RelayTeamMember | undefined => {
  const teamId = typeof value.teamId === 'string' && value.teamId.trim() !== '' ? value.teamId.trim() : undefined
  const userId = typeof value.userId === 'string' && value.userId.trim() !== '' ? value.userId.trim() : undefined
  if (teamId == null || userId == null) return undefined
  return {
    id: typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : `member:${teamId}:${userId}`,
    teamId,
    userId,
    role: normalizeTeamRole(value.role, 'member'),
    ...(typeof value.configEnabled === 'boolean' ? { configEnabled: value.configEnabled } : {}),
    ...(typeof value.defaultForPublishing === 'boolean' ? { defaultForPublishing: value.defaultForPublishing } : {}),
    createdByUserId: typeof value.createdByUserId === 'string' && value.createdByUserId.trim() !== ''
      ? value.createdByUserId.trim()
      : userId,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined
  }
}

const addLegacyTeamMemberships = (
  users: RelayUser[],
  teams: RelayTeam[],
  teamMembers: RelayTeamMember[]
) => {
  const teamIds = new Set(teams.map(team => team.id))
  const memberKeys = new Set(teamMembers.map(member => `${member.teamId}:${member.userId}`))
  const nextTeams = [...teams]
  const nextMembers = [...teamMembers]

  for (const user of users) {
    for (const teamId of user.teamIds ?? []) {
      if (!teamIds.has(teamId)) {
        nextTeams.push({
          id: teamId,
          slug: normalizeSlug(teamId, teamId),
          name: teamId,
          createdByUserId: user.id,
          createdAt: user.createdAt
        })
        teamIds.add(teamId)
      }
      const key = `${teamId}:${user.id}`
      if (!memberKeys.has(key)) {
        nextMembers.push({
          id: `legacy:${teamId}:${user.id}`,
          teamId,
          userId: user.id,
          role: 'member',
          createdByUserId: user.id,
          createdAt: user.createdAt
        })
        memberKeys.add(key)
      }
    }
  }

  return {
    teamMembers: nextMembers,
    teams: nextTeams
  }
}

const normalizePasskeyCredential = (value: Record<string, unknown>): RelayPasskeyCredential | undefined => {
  const id = typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : undefined
  const publicKey = typeof value.publicKey === 'string' && value.publicKey.trim() !== ''
    ? value.publicKey.trim()
    : undefined
  const userId = typeof value.userId === 'string' && value.userId.trim() !== '' ? value.userId.trim() : undefined
  if (id == null || publicKey == null || userId == null) return undefined
  return {
    backedUp: value.backedUp === true,
    counter: Number.isFinite(Number(value.counter)) ? Math.max(0, Math.trunc(Number(value.counter))) : 0,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now(),
    deviceType: typeof value.deviceType === 'string' && value.deviceType.trim() !== ''
      ? value.deviceType.trim()
      : 'unknown',
    id,
    lastUsedAt: typeof value.lastUsedAt === 'string' && value.lastUsedAt.trim() !== ''
      ? value.lastUsedAt.trim()
      : undefined,
    name: typeof value.name === 'string' && value.name.trim() !== '' ? value.name.trim() : undefined,
    publicKey,
    transports: normalizeStringArray(value.transports),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
    userId
  }
}

const passkeyChallengeKinds = new Set<RelayPasskeyChallengeKind>(['authentication', 'registration'])

const normalizePasskeyChallenge = (value: Record<string, unknown>): RelayPasskeyChallenge | undefined => {
  const challenge = typeof value.challenge === 'string' && value.challenge.trim() !== ''
    ? value.challenge.trim()
    : undefined
  const id = typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : undefined
  const kind = typeof value.kind === 'string' && passkeyChallengeKinds.has(value.kind as RelayPasskeyChallengeKind)
    ? value.kind as RelayPasskeyChallengeKind
    : undefined
  const expiresAt = typeof value.expiresAt === 'string' && value.expiresAt.trim() !== ''
    ? value.expiresAt.trim()
    : undefined
  const origin = typeof value.origin === 'string' && value.origin.trim() !== '' ? value.origin.trim() : undefined
  const rpId = typeof value.rpId === 'string' && value.rpId.trim() !== '' ? value.rpId.trim() : undefined
  if (challenge == null || id == null || kind == null || expiresAt == null || origin == null || rpId == null) {
    return undefined
  }
  return {
    challenge,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now(),
    emailChallengeId: typeof value.emailChallengeId === 'string' && value.emailChallengeId.trim() !== ''
      ? value.emailChallengeId.trim()
      : undefined,
    emailHash: typeof value.emailHash === 'string' && value.emailHash.trim() !== ''
      ? value.emailHash.trim()
      : undefined,
    expiresAt,
    id,
    inviteCode: typeof value.inviteCode === 'string' && value.inviteCode.trim() !== ''
      ? value.inviteCode.trim()
      : undefined,
    kind,
    origin,
    rpId,
    userId: typeof value.userId === 'string' && value.userId.trim() !== '' ? value.userId.trim() : undefined
  }
}

const normalizeInvite = (value: Record<string, unknown>): RelayInvite => ({
  code: typeof value.code === 'string' && value.code.trim() !== '' ? value.code.trim() : createToken(),
  role: normalizeRole(value.role, 'member'),
  userId: typeof value.userId === 'string' && value.userId.trim() !== '' ? value.userId.trim() : undefined,
  maxUses: Number.isFinite(Number(value.maxUses)) ? Math.max(1, Number(value.maxUses)) : 1,
  used: Number.isFinite(Number(value.used)) ? Math.max(0, Number(value.used)) : 0,
  expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : undefined,
  revokedAt: typeof value.revokedAt === 'string' && value.revokedAt.trim() !== '' ? value.revokedAt.trim() : undefined,
  createdAt: typeof value.createdAt === 'string' ? value.createdAt : now(),
  updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined
})

const normalizeEncryptedPayload = (value: unknown): RelayEncryptedPayload | undefined => {
  if (!isRecord(value)) return undefined
  return value.algorithm === 'aes-256-gcm' &&
      typeof value.ciphertext === 'string' &&
      typeof value.iv === 'string' &&
      typeof value.tag === 'string' &&
      value.version === 1
    ? {
      algorithm: 'aes-256-gcm',
      ciphertext: value.ciphertext,
      iv: value.iv,
      tag: value.tag,
      version: 1
    }
    : undefined
}

const normalizeConfigSecret = (value: Record<string, unknown>): RelayConfigSecret | undefined => {
  const id = typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : undefined
  const teamId = typeof value.teamId === 'string' && value.teamId.trim() !== '' ? value.teamId.trim() : undefined
  const encryptedPayload = normalizeEncryptedPayload(value.encryptedPayload)
  if (id == null || teamId == null || encryptedPayload == null) return undefined

  return {
    id,
    teamId,
    name: typeof value.name === 'string' && value.name.trim() !== '' ? value.name.trim() : id,
    encryptedPayload,
    secretVersion: Number.isFinite(Number(value.secretVersion))
      ? Math.max(1, Math.trunc(Number(value.secretVersion)))
      : 1,
    createdByUserId: typeof value.createdByUserId === 'string' && value.createdByUserId.trim() !== ''
      ? value.createdByUserId.trim()
      : 'system',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now(),
    rotatedAt: typeof value.rotatedAt === 'string' && value.rotatedAt.trim() !== ''
      ? value.rotatedAt.trim()
      : undefined,
    revokedAt: typeof value.revokedAt === 'string' && value.revokedAt.trim() !== ''
      ? value.revokedAt.trim()
      : undefined
  }
}

const normalizeDevice = (value: Record<string, unknown>): RelayDevice => {
  const legacyDeviceToken = typeof value.deviceToken === 'string' && value.deviceToken.trim() !== ''
    ? value.deviceToken.trim()
    : undefined
  const deviceTokenHash = typeof value.deviceTokenHash === 'string' && value.deviceTokenHash.trim() !== ''
    ? value.deviceTokenHash.trim()
    : legacyDeviceToken == null
    ? hashDeviceToken(createToken())
    : undefined

  return {
    id: typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : randomUUID(),
    userId: typeof value.userId === 'string' && value.userId.trim() !== '' ? value.userId.trim() : undefined,
    ...(typeof value.name === 'string' && value.name.trim() !== '' ? { name: value.name.trim() } : {}),
    ...(isRecord(value.capabilities) ? { capabilities: value.capabilities } : {}),
    ...(typeof value.workspaceFolder === 'string' ? { workspaceFolder: value.workspaceFolder } : {}),
    ...(typeof value.pluginScope === 'string' ? { pluginScope: value.pluginScope } : {}),
    ...(legacyDeviceToken == null ? {} : { deviceToken: legacyDeviceToken }),
    deviceTokenHash,
    encryptedMetadata: normalizeEncryptedPayload(value.encryptedMetadata),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now(),
    lastSeenAt: typeof value.lastSeenAt === 'string' ? value.lastSeenAt : now()
  }
}

const normalizeDeviceSession = (value: Record<string, unknown>): RelayDeviceSession | undefined => {
  const id = typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : undefined
  const deviceId = typeof value.deviceId === 'string' && value.deviceId.trim() !== ''
    ? value.deviceId.trim()
    : undefined
  if (id == null || deviceId == null) return undefined
  return {
    id,
    deviceId,
    userId: typeof value.userId === 'string' && value.userId.trim() !== '' ? value.userId.trim() : undefined,
    title: typeof value.title === 'string' && value.title.trim() !== '' ? value.title.trim() : id,
    state: typeof value.state === 'string' && value.state.trim() !== '' ? value.state.trim() : undefined,
    lastActiveAt: typeof value.lastActiveAt === 'string' && value.lastActiveAt.trim() !== ''
      ? value.lastActiveAt.trim()
      : undefined,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now()
  }
}

const forwardingJobStatuses = new Set<RelayForwardingJobStatus>([
  'cancelled',
  'claimed',
  'failed',
  'queued',
  'running',
  'succeeded'
])

const normalizeForwardingJob = (value: Record<string, unknown>): RelayForwardingJob | undefined => {
  const id = typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : undefined
  const deviceId = typeof value.deviceId === 'string' && value.deviceId.trim() !== ''
    ? value.deviceId.trim()
    : undefined
  const sessionId = typeof value.sessionId === 'string' && value.sessionId.trim() !== ''
    ? value.sessionId.trim()
    : undefined
  if (id == null || deviceId == null || sessionId == null) return undefined
  const traceId = typeof value.traceId === 'string' && value.traceId.trim() !== '' ? value.traceId.trim() : id
  const status = typeof value.status === 'string' && forwardingJobStatuses.has(value.status as RelayForwardingJobStatus)
    ? value.status as RelayForwardingJobStatus
    : 'queued'
  const payloadSizeBytes = Number.isFinite(Number(value.payloadSizeBytes))
    ? Math.max(0, Number(value.payloadSizeBytes))
    : 0
  return {
    id,
    deviceId,
    sessionId,
    userId: typeof value.userId === 'string' && value.userId.trim() !== '' ? value.userId.trim() : undefined,
    status,
    traceId,
    requestId: typeof value.requestId === 'string' && value.requestId.trim() !== ''
      ? value.requestId.trim()
      : undefined,
    mode: typeof value.mode === 'string' && value.mode.trim() !== '' ? value.mode.trim() : undefined,
    payloadSizeBytes,
    resultSizeBytes: Number.isFinite(Number(value.resultSizeBytes))
      ? Math.max(0, Number(value.resultSizeBytes))
      : undefined,
    errorCode: typeof value.errorCode === 'string' && value.errorCode.trim() !== ''
      ? value.errorCode.trim()
      : undefined,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now(),
    claimedAt: typeof value.claimedAt === 'string' && value.claimedAt.trim() !== ''
      ? value.claimedAt.trim()
      : undefined,
    completedAt: typeof value.completedAt === 'string' && value.completedAt.trim() !== ''
      ? value.completedAt.trim()
      : undefined
  }
}

const normalizeOAuthState = (value: Record<string, unknown>): RelayOAuthState | undefined => {
  const provider = typeof value.provider === 'string' && value.provider.trim() !== ''
    ? value.provider.trim()
    : undefined
  if (provider == null) return undefined
  const state = typeof value.state === 'string' && value.state.trim() !== '' ? value.state.trim() : undefined
  const expiresAt = typeof value.expiresAt === 'string' ? value.expiresAt : undefined
  if (state == null || expiresAt == null) return undefined
  return {
    state,
    provider,
    redirectUri: typeof value.redirectUri === 'string' && value.redirectUri.trim() !== ''
      ? value.redirectUri
      : undefined,
    inviteCode: typeof value.inviteCode === 'string' && value.inviteCode.trim() !== '' ? value.inviteCode : undefined,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now(),
    expiresAt
  }
}

const normalizeSession = (value: Record<string, unknown>): RelaySession | undefined => {
  const token = typeof value.token === 'string' && value.token.trim() !== '' ? value.token.trim() : undefined
  const userId = typeof value.userId === 'string' && value.userId.trim() !== '' ? value.userId.trim() : undefined
  const expiresAt = typeof value.expiresAt === 'string' ? value.expiresAt : undefined
  if (token == null || userId == null || expiresAt == null) return undefined
  return {
    token,
    userId,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now(),
    expiresAt,
    lastSeenAt: typeof value.lastSeenAt === 'string' ? value.lastSeenAt : now()
  }
}

const normalizeAuditLogEntry = (value: Record<string, unknown>): RelayAuditLogEntry | undefined => {
  const id = typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : undefined
  const actor = typeof value.actor === 'string' && value.actor.trim() !== '' ? value.actor.trim() : undefined
  const action = typeof value.action === 'string' && value.action.trim() !== '' ? value.action.trim() : undefined
  const resource = typeof value.resource === 'string' && value.resource.trim() !== ''
    ? value.resource.trim()
    : undefined
  const status = typeof value.status === 'string' && value.status.trim() !== '' ? value.status.trim() : undefined
  const createdAt = typeof value.createdAt === 'string' && value.createdAt.trim() !== ''
    ? value.createdAt.trim()
    : undefined
  if (id == null || actor == null || action == null || resource == null || status == null || createdAt == null) {
    return undefined
  }
  return {
    id,
    actor,
    action,
    resource,
    status,
    ip: typeof value.ip === 'string' && value.ip.trim() !== '' ? value.ip.trim() : undefined,
    userAgent: typeof value.userAgent === 'string' && value.userAgent.trim() !== ''
      ? value.userAgent.trim()
      : undefined,
    requestId: typeof value.requestId === 'string' && value.requestId.trim() !== ''
      ? value.requestId.trim()
      : undefined,
    createdAt
  }
}

const relayEmailPurposes = new Set<RelayEmailPurpose>([
  'email-verification',
  'invite',
  'login'
])

const normalizeEmailPurpose = (value: unknown): RelayEmailPurpose => (
  typeof value === 'string' && relayEmailPurposes.has(value as RelayEmailPurpose)
    ? value as RelayEmailPurpose
    : 'email-verification'
)

const normalizeEmailRiskBucket = (value: Record<string, unknown>): RelayEmailRiskBucket | undefined => {
  const key = typeof value.key === 'string' && value.key.trim() !== '' ? value.key.trim() : undefined
  const resetAt = typeof value.resetAt === 'string' && value.resetAt.trim() !== '' ? value.resetAt.trim() : undefined
  if (key == null || resetAt == null) return undefined
  return {
    count: Number.isFinite(Number(value.count)) ? Math.max(0, Math.trunc(Number(value.count))) : 0,
    key,
    resetAt,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now()
  }
}

const normalizeEmailChallenge = (value: Record<string, unknown>): RelayEmailChallenge | undefined => {
  const id = typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : undefined
  const emailHash = typeof value.emailHash === 'string' && value.emailHash.trim() !== ''
    ? value.emailHash.trim()
    : undefined
  const codeHash = typeof value.codeHash === 'string' && value.codeHash.trim() !== ''
    ? value.codeHash.trim()
    : undefined
  const expiresAt = typeof value.expiresAt === 'string' && value.expiresAt.trim() !== ''
    ? value.expiresAt.trim()
    : undefined
  if (id == null || emailHash == null || codeHash == null || expiresAt == null) return undefined
  return {
    codeHash,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now(),
    domain: typeof value.domain === 'string' && value.domain.trim() !== ''
      ? value.domain.trim().toLowerCase()
      : 'unknown',
    emailHash,
    expiresAt,
    id,
    lastSentAt: typeof value.lastSentAt === 'string' ? value.lastSentAt : now(),
    providerMessageId: typeof value.providerMessageId === 'string' && value.providerMessageId.trim() !== ''
      ? value.providerMessageId.trim()
      : undefined,
    purpose: normalizeEmailPurpose(value.purpose),
    sendCount: Number.isFinite(Number(value.sendCount)) ? Math.max(0, Math.trunc(Number(value.sendCount))) : 1,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
    verifiedAt: typeof value.verifiedAt === 'string' && value.verifiedAt.trim() !== ''
      ? value.verifiedAt.trim()
      : undefined
  }
}

const normalizeEmailRiskState = (value: unknown): RelayEmailRiskState => {
  const state = isRecord(value) ? value : {}
  return {
    buckets: Array.isArray(state.buckets)
      ? state.buckets.filter(isRecord).map(normalizeEmailRiskBucket).filter((bucket): bucket is RelayEmailRiskBucket =>
        bucket != null
      )
      : [],
    challenges: Array.isArray(state.challenges)
      ? state.challenges.filter(isRecord).map(normalizeEmailChallenge).filter((
        challenge
      ): challenge is RelayEmailChallenge => challenge != null)
      : []
  }
}

export const normalizeRelayStore = (value: unknown): RelayStore => {
  const store = isRecord(value) ? value : {}
  const users = Array.isArray(store.users) ? store.users.filter(isRecord).map(normalizeUser) : []
  const teams = Array.isArray(store.teams)
    ? store.teams.filter(isRecord).map(normalizeTeam).filter((team): team is RelayTeam => team != null)
    : []
  const teamMembers = Array.isArray(store.teamMembers)
    ? store.teamMembers.filter(isRecord).map(normalizeTeamMember).filter((
      member
    ): member is RelayTeamMember => member != null)
    : []
  const legacyTeams = addLegacyTeamMemberships(users, teams, teamMembers)
  return {
    createdAt: typeof store.createdAt === 'string' ? store.createdAt : now(),
    auditEvents: Array.isArray(store.auditEvents)
      ? store.auditEvents.filter(isRecord).map(normalizeAuditLogEntry).filter((
        value
      ): value is RelayAuditLogEntry => value != null)
      : [],
    configAssignments: Array.isArray(store.configAssignments)
      ? store.configAssignments.filter(isRecord).map(normalizeRelayConfigAssignment).filter((
        value
      ): value is RelayConfigAssignment => value != null)
      : [],
    configProfileAssignments: Array.isArray(store.configProfileAssignments)
      ? store.configProfileAssignments.filter(isRecord).map(normalizeRelayConfigProfileAssignment).filter((
        value
      ): value is RelayConfigProfileAssignment => value != null)
      : [],
    configSecrets: Array.isArray(store.configSecrets)
      ? store.configSecrets.filter(isRecord).map(normalizeConfigSecret).filter((
        value
      ): value is RelayConfigSecret => value != null)
      : [],
    configProfileVersions: Array.isArray(store.configProfileVersions)
      ? store.configProfileVersions.filter(isRecord).map(normalizeRelayConfigProfileVersion).filter((
        value
      ): value is RelayConfigProfileVersion => value != null)
      : [],
    configProfiles: Array.isArray(store.configProfiles)
      ? store.configProfiles.filter(isRecord).map(normalizeRelayConfigProfile).filter((
        value
      ): value is RelayConfigProfile => value != null)
      : [],
    emailRisk: normalizeEmailRiskState(store.emailRisk),
    teamPolicy: normalizeRelayTeamPolicy(store.teamPolicy),
    teams: legacyTeams.teams,
    teamMembers: legacyTeams.teamMembers,
    users,
    invites: Array.isArray(store.invites) ? store.invites.filter(isRecord).map(normalizeInvite) : [],
    ssoProviders: normalizeRelaySsoProviders(store.ssoProviders),
    passkeyChallenges: Array.isArray(store.passkeyChallenges)
      ? store.passkeyChallenges.filter(isRecord).map(normalizePasskeyChallenge).filter((
        value
      ): value is RelayPasskeyChallenge => value != null)
      : [],
    passkeys: Array.isArray(store.passkeys)
      ? store.passkeys.filter(isRecord).map(normalizePasskeyCredential).filter((
        value
      ): value is RelayPasskeyCredential => value != null)
      : [],
    devices: Array.isArray(store.devices) ? store.devices.filter(isRecord).map(normalizeDevice) : [],
    deviceSessions: Array.isArray(store.deviceSessions)
      ? store.deviceSessions.filter(isRecord).map(normalizeDeviceSession).filter((value): value is RelayDeviceSession =>
        value != null
      )
      : [],
    forwardingJobs: Array.isArray(store.forwardingJobs)
      ? store.forwardingJobs.filter(isRecord).map(normalizeForwardingJob).filter((value): value is RelayForwardingJob =>
        value != null
      )
      : [],
    oauthStates: Array.isArray(store.oauthStates)
      ? store.oauthStates.filter(isRecord).map(normalizeOAuthState).filter((value): value is RelayOAuthState =>
        value != null
      )
      : [],
    sessions: Array.isArray(store.sessions)
      ? store.sessions.filter(isRecord).map(normalizeSession).filter((value): value is RelaySession => value != null)
      : []
  }
}

export const readRelayStore = async (dataPath: string): Promise<RelayStore> => {
  try {
    return normalizeRelayStore(JSON.parse(await readFile(dataPath, 'utf8')))
  } catch {
    return defaultStore()
  }
}

export const writeRelayStore = async (dataPath: string, store: RelayStore) => {
  await mkdir(dirname(dataPath), { recursive: true })
  const tempPath = `${dataPath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(sanitizeRelayStorageValue(store), null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  await rename(tempPath, dataPath)
}
