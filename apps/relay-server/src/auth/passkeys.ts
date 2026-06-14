/* eslint-disable max-lines -- Passkey WebAuthn registration/authentication share challenge lifecycle and user credential updates. */
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from '@simplewebauthn/server'
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  WebAuthnCredential
} from '@simplewebauthn/server'

import { hashRelayEmailAddress, verifyRelayEmailChallengeCode } from '../email/policy.js'
import type {
  RelayPasskeyChallenge,
  RelayPasskeyConfig,
  RelayPasskeyCredential,
  RelayRegistrationMode,
  RelayRole,
  RelayServerArgs,
  RelayStore,
  RelayUser
} from '../types.js'
import { now } from '../utils.js'
import { consumeInvite, findUsableInvite } from './invites.js'

export class RelayPasskeyError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'passkey_error'
  ) {
    super(message)
  }
}

export interface RelayPasskeyOptionsResult<TOptions> {
  options: TOptions
}

export interface RelayPasskeyVerifyResult {
  tokenUser: RelayUser
  credential: RelayPasskeyCredential
}

interface RegistrationCandidate {
  email: string
  existing?: RelayUser
  inviteCode?: string
  name?: string
  userId: string
}

const defaultPasskeyConfig: RelayPasskeyConfig = {
  enabled: true,
  registrationMode: 'invite_required',
  rpName: 'One Works',
  timeoutMs: 60_000
}

const passkeyProvider = 'passkey'

const parseTimeMs = (value: string | undefined) => {
  if (value == null) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const base64UrlFromBytes = (value: Uint8Array) => Buffer.from(value).toString('base64url')

const bytesFromBase64Url = (value: string) => new Uint8Array(Buffer.from(value, 'base64url'))

const bytesFromUserId = (value: string) => new TextEncoder().encode(value)

const cleanString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const originFromRequest = (req: IncomingMessage) => {
  const origin = cleanString(req.headers.origin)
  if (origin !== '') return origin
  const proto = cleanString(req.headers['x-forwarded-proto']) || 'http'
  const host = cleanString(req.headers['x-forwarded-host']) || cleanString(req.headers.host)
  return host === '' ? 'http://localhost' : `${proto.split(',')[0]?.trim() ?? 'http'}://${host.split(',')[0]?.trim()}`
}

const originFromPublicBaseUrl = (value: string | undefined) => {
  if (value == null || value.trim() === '') return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

const resolvePasskeyConfig = (args: RelayServerArgs): RelayPasskeyConfig => ({
  ...defaultPasskeyConfig,
  ...(args.passkey ?? {})
})

export const resolvePasskeyRp = (req: IncomingMessage, args: RelayServerArgs) => {
  const config = resolvePasskeyConfig(args)
  const origin = config.origin?.trim() || originFromPublicBaseUrl(args.publicBaseUrl) || originFromRequest(req)
  const rpId = config.rpId?.trim() || new URL(origin).hostname
  return {
    config,
    origin,
    rpId
  }
}

const ensurePasskeyEnabled = (config: RelayPasskeyConfig) => {
  if (!config.enabled) {
    throw new RelayPasskeyError('Passkey login is not enabled.', 404, 'passkey_disabled')
  }
}

export const prunePasskeyChallenges = (store: RelayStore, nowMs = Date.now()) => {
  store.passkeyChallenges = store.passkeyChallenges.filter(challenge => parseTimeMs(challenge.expiresAt) > nowMs)
}

const pushPasskeyChallenge = (
  store: RelayStore,
  input: Omit<RelayPasskeyChallenge, 'createdAt' | 'expiresAt' | 'id'>,
  ttlMs = 5 * 60 * 1000
) => {
  const timestamp = now()
  const challenge: RelayPasskeyChallenge = {
    ...input,
    createdAt: timestamp,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    id: randomUUID()
  }
  store.passkeyChallenges.push(challenge)
  return challenge
}

const chooseRole = (store: RelayStore, mode: RelayRegistrationMode, inviteRole: RelayRole | undefined): RelayRole => {
  if (inviteRole != null) return inviteRole
  if (mode === 'email_verified' && store.users.length === 0) return 'owner'
  return 'member'
}

const displayNameFromEmail = (email: string) => {
  const name = email.split('@', 1)[0]?.trim() ?? ''
  return name === '' ? email : name
}

const passkeysForUser = (store: RelayStore, userId: string) =>
  store.passkeys.filter(passkey => passkey.userId === userId)

const transportsForWebAuthn = (transports: string[] | undefined) =>
  transports as AuthenticatorTransportFuture[] | undefined

const publicCredentialForVerify = (credential: RelayPasskeyCredential): WebAuthnCredential => ({
  counter: credential.counter,
  id: credential.id,
  publicKey: bytesFromBase64Url(credential.publicKey),
  transports: transportsForWebAuthn(credential.transports)
})

const findLatestChallenge = (
  store: RelayStore,
  input: {
    emailHash?: string
    kind: RelayPasskeyChallenge['kind']
    userId?: string
  }
) => {
  prunePasskeyChallenges(store)
  return [...store.passkeyChallenges]
    .reverse()
    .find(challenge =>
      challenge.kind === input.kind &&
      (input.userId == null || challenge.userId === input.userId) &&
      (input.emailHash == null || challenge.emailHash === input.emailHash)
    )
}

const removeChallenge = (store: RelayStore, challenge: RelayPasskeyChallenge) => {
  store.passkeyChallenges = store.passkeyChallenges.filter(item => item.id !== challenge.id)
}

export const prepareRelayPasskeyRegistration = async (
  req: IncomingMessage,
  args: RelayServerArgs,
  store: RelayStore,
  input: {
    code: string
    email: string
    inviteCode?: string
    name?: string
  }
): Promise<RelayPasskeyOptionsResult<PublicKeyCredentialCreationOptionsJSON>> => {
  const { config, origin, rpId } = resolvePasskeyRp(req, args)
  ensurePasskeyEnabled(config)
  const candidate = resolveRegistrationCandidate(store, config, input)
  const emailVerification = verifyRelayEmailChallengeCode(store, {
    code: input.code,
    email: candidate.email,
    purpose: 'email-verification'
  })
  if (!emailVerification.verified) {
    throw new RelayPasskeyError('Invalid verification code.', 400, 'invalid_email_code')
  }
  const excludeCredentials = passkeysForUser(store, candidate.userId).map(passkey => ({
    id: passkey.id,
    transports: transportsForWebAuthn(passkey.transports)
  }))
  const options = await generateRegistrationOptions({
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred'
    },
    excludeCredentials,
    rpID: rpId,
    rpName: config.rpName,
    timeout: config.timeoutMs,
    userDisplayName: candidate.name ?? candidate.existing?.name ?? candidate.email,
    userID: bytesFromUserId(candidate.userId),
    userName: candidate.email
  })
  pushPasskeyChallenge(store, {
    challenge: options.challenge,
    emailChallengeId: emailVerification.challenge.id,
    emailHash: hashRelayEmailAddress(candidate.email),
    inviteCode: candidate.inviteCode,
    kind: 'registration',
    origin,
    rpId,
    userId: candidate.userId
  }, config.timeoutMs)
  return { options }
}

export const verifyRelayPasskeyRegistration = async (
  args: RelayServerArgs,
  store: RelayStore,
  input: {
    credentialName?: string
    email: string
    response: RegistrationResponseJSON
  }
): Promise<RelayPasskeyVerifyResult> => {
  ensurePasskeyEnabled(resolvePasskeyConfig(args))
  const emailHash = hashRelayEmailAddress(input.email)
  const challenge = findLatestChallenge(store, {
    emailHash,
    kind: 'registration'
  })
  if (challenge == null || challenge.userId == null) {
    throw new RelayPasskeyError('Passkey registration expired.', 400, 'passkey_challenge_expired')
  }
  const verification = await verifyRegistrationResponse({
    expectedChallenge: challenge.challenge,
    expectedOrigin: challenge.origin,
    expectedRPID: challenge.rpId,
    response: input.response
  })
  if (!verification.verified) {
    throw new RelayPasskeyError('Passkey registration failed.', 401, 'passkey_registration_failed')
  }
  const user = upsertPasskeyUser(store, {
    email: input.email,
    inviteCode: challenge.inviteCode,
    userId: challenge.userId
  })
  const credential = upsertPasskeyCredential(store, {
    credentialName: input.credentialName,
    registrationInfo: verification.registrationInfo,
    userId: user.id
  })
  consumeEmailChallenge(store, challenge.emailChallengeId)
  removeChallenge(store, challenge)
  return {
    credential,
    tokenUser: user
  }
}

export const prepareRelayPasskeyAuthentication = async (
  req: IncomingMessage,
  args: RelayServerArgs,
  store: RelayStore,
  input: {
    email: string
  }
): Promise<RelayPasskeyOptionsResult<PublicKeyCredentialRequestOptionsJSON>> => {
  const { config, origin, rpId } = resolvePasskeyRp(req, args)
  ensurePasskeyEnabled(config)
  const user = findEnabledUserByEmail(store, input.email)
  if (user == null) throw new RelayPasskeyError('Passkey login unavailable.', 404, 'passkey_unavailable')
  const credentials = passkeysForUser(store, user.id)
  if (credentials.length === 0) {
    throw new RelayPasskeyError('Passkey login unavailable.', 404, 'passkey_unavailable')
  }
  const options = await generateAuthenticationOptions({
    allowCredentials: credentials.map(credential => ({
      id: credential.id,
      transports: transportsForWebAuthn(credential.transports)
    })),
    rpID: rpId,
    timeout: config.timeoutMs,
    userVerification: 'preferred'
  })
  pushPasskeyChallenge(store, {
    challenge: options.challenge,
    emailHash: hashRelayEmailAddress(input.email),
    kind: 'authentication',
    origin,
    rpId,
    userId: user.id
  }, config.timeoutMs)
  return { options }
}

export const verifyRelayPasskeyAuthentication = async (
  args: RelayServerArgs,
  store: RelayStore,
  input: {
    email: string
    response: AuthenticationResponseJSON
  }
): Promise<RelayPasskeyVerifyResult> => {
  ensurePasskeyEnabled(resolvePasskeyConfig(args))
  const user = findEnabledUserByEmail(store, input.email)
  if (user == null) throw new RelayPasskeyError('Invalid email or passkey.', 401, 'invalid_passkey')
  const credential = store.passkeys.find(passkey => passkey.userId === user.id && passkey.id === input.response.id)
  const challenge = findLatestChallenge(store, {
    kind: 'authentication',
    userId: user.id
  })
  if (credential == null || challenge == null) {
    throw new RelayPasskeyError('Invalid email or passkey.', 401, 'invalid_passkey')
  }
  const verification = await verifyAuthenticationResponse({
    credential: publicCredentialForVerify(credential),
    expectedChallenge: challenge.challenge,
    expectedOrigin: challenge.origin,
    expectedRPID: challenge.rpId,
    response: input.response
  })
  if (!verification.verified) {
    throw new RelayPasskeyError('Invalid email or passkey.', 401, 'invalid_passkey')
  }
  const timestamp = now()
  credential.counter = verification.authenticationInfo.newCounter
  credential.backedUp = verification.authenticationInfo.credentialBackedUp
  credential.deviceType = verification.authenticationInfo.credentialDeviceType
  credential.lastUsedAt = timestamp
  credential.updatedAt = timestamp
  removeChallenge(store, challenge)
  return {
    credential,
    tokenUser: user
  }
}

const resolveRegistrationCandidate = (
  store: RelayStore,
  config: RelayPasskeyConfig,
  input: {
    email: string
    inviteCode?: string
    name?: string
  }
): RegistrationCandidate => {
  const email = input.email.trim().toLowerCase()
  const existing = store.users.find(user => user.email.toLowerCase() === email)
  if (existing?.disabledAt != null) {
    throw new RelayPasskeyError('User is disabled.', 403, 'user_disabled')
  }
  if (existing != null) {
    return {
      email,
      existing,
      name: input.name,
      userId: existing.id
    }
  }
  if (config.registrationMode === 'admin_created_only') {
    throw new RelayPasskeyError('Registration is disabled.', 403, 'registration_disabled')
  }
  const invite = findUsableInvite(store, input.inviteCode)
  if (config.registrationMode === 'invite_required' && invite == null) {
    throw new RelayPasskeyError('Invite required.', 400, 'invite_required')
  }
  return {
    email,
    inviteCode: invite?.code,
    name: input.name,
    userId: invite?.userId ?? randomUUID()
  }
}

const findEnabledUserByEmail = (store: RelayStore, email: string) => {
  const normalizedEmail = email.trim().toLowerCase()
  const user = store.users.find(item => item.email.toLowerCase() === normalizedEmail)
  return user == null || user.disabledAt != null ? undefined : user
}

const upsertPasskeyUser = (
  store: RelayStore,
  input: {
    email: string
    inviteCode?: string
    userId: string
  }
) => {
  const timestamp = now()
  const existing = store.users.find(user => user.email.toLowerCase() === input.email.toLowerCase())
  if (existing != null) {
    if (existing.disabledAt != null) {
      throw new RelayPasskeyError('User is disabled.', 403, 'user_disabled')
    }
    if (existing.provider == null || existing.provider === 'invite') existing.provider = passkeyProvider
    existing.updatedAt = timestamp
    return existing
  }
  const invite = findUsableInvite(store, input.inviteCode)
  if (input.inviteCode != null && invite == null) {
    throw new RelayPasskeyError('Invite required.', 400, 'invite_required')
  }
  const role = chooseRole(store, input.inviteCode == null ? 'email_verified' : 'invite_required', invite?.role)
  const user: RelayUser = {
    createdAt: timestamp,
    email: input.email,
    id: input.userId,
    name: displayNameFromEmail(input.email),
    provider: passkeyProvider,
    role,
    updatedAt: timestamp
  }
  consumeInvite(invite)
  store.users.push(user)
  return user
}

const upsertPasskeyCredential = (
  store: RelayStore,
  input: {
    credentialName?: string
    registrationInfo: Exclude<
      Awaited<ReturnType<typeof verifyRegistrationResponse>>,
      { verified: false }
    >['registrationInfo']
    userId: string
  }
) => {
  const timestamp = now()
  const id = input.registrationInfo.credential.id
  const existing = store.passkeys.find(passkey => passkey.id === id)
  const credential: RelayPasskeyCredential = {
    backedUp: input.registrationInfo.credentialBackedUp,
    counter: input.registrationInfo.credential.counter,
    createdAt: existing?.createdAt ?? timestamp,
    deviceType: input.registrationInfo.credentialDeviceType,
    id,
    lastUsedAt: timestamp,
    name: input.credentialName?.trim() || existing?.name || 'Passkey',
    publicKey: base64UrlFromBytes(input.registrationInfo.credential.publicKey),
    transports: input.registrationInfo.credential.transports,
    updatedAt: timestamp,
    userId: input.userId
  }
  store.passkeys = [
    ...store.passkeys.filter(passkey => passkey.id !== id),
    credential
  ]
  return credential
}

const consumeEmailChallenge = (store: RelayStore, challengeId: string | undefined) => {
  if (challengeId == null) return
  const challenge = store.emailRisk.challenges.find(item => item.id === challengeId)
  if (challenge == null) return
  challenge.verifiedAt = now()
  challenge.updatedAt = challenge.verifiedAt
}

export const canShowPasskeyRegistration = (mode: RelayRegistrationMode) => mode !== 'admin_created_only'
