/* eslint-disable max-lines -- Relay config sharing coordinates remote teams, profiles, versions, secrets, and assignments. */
import { readOneWorksAuthStore } from '@oneworks/utils/auth-store'
import type { OneWorksAuthAccount } from '@oneworks/utils/auth-store'

import { buildRelayConfigShareDraft, collectRelayConfigShareSecretValues } from '../shared/config-share-draft.js'
import type { RelayConfigShareDraftInput } from '../shared/config-share-draft.js'

import { resolveActiveRelayServer } from './options.js'
import type { ResolvedRelayServer } from './options.js'
import { createRelayDeviceStore } from './store.js'
import type { RelayPluginContext } from './types.js'
import { isRecord, normalizeRemoteBaseUrl, toString } from './utils.js'

interface RelayShareAuth {
  account?: OneWorksAuthAccount
  server: ResolvedRelayServer
  sessionToken: string
}

const RELAY_FIXTURE_SESSION_TOKEN_PREFIX = 'relay-fixture:'

const fixtureConfigShareAssignments = new Map<string, Record<string, unknown>>()

const readOptionalText = (value: unknown) => {
  const text = toString(value)
  return text === '' ? undefined : text
}

const readBody = async (response: Response) => {
  const body = await response.json().catch(() => ({}))
  return isRecord(body) ? body : {}
}

const readPayload = (payload?: unknown) => isRecord(payload) ? payload : {}

const readServerId = (payload?: unknown) => {
  const body = readPayload(payload)
  return toString(body.serverId)
}

const readAccountKey = (payload?: unknown) => {
  const body = readPayload(payload)
  return toString(body.accountKey)
}

const readTeamId = (payload?: unknown) => {
  const body = readPayload(payload)
  return toString(body.teamId)
}

const accountMatchesRelayServer = (
  account: OneWorksAuthAccount,
  server: Pick<ResolvedRelayServer, 'id' | 'remoteBaseUrl'>
) => (
  account.serverId === server.id ||
  normalizeRemoteBaseUrl(account.serverUrl) === normalizeRemoteBaseUrl(server.remoteBaseUrl)
)

const accountHasValidSession = (account: Pick<OneWorksAuthAccount, 'sessionExpiresAt' | 'sessionToken'>) => (
  (account.sessionToken ?? '') !== '' &&
  (account.sessionExpiresAt == null || Date.parse(account.sessionExpiresAt) > Date.now())
)

const fixtureTeamSlug = (teamName: string) => (
  teamName.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'fixture'
)

const fixtureConfigShareTargets = (auth: RelayShareAuth, payload?: unknown) => {
  const account = auth.account
  if (account == null) return undefined
  const now = new Date().toISOString()
  const requestedTeamId = readTeamId(payload)
  const teamId = requestedTeamId === '' ? `${account.serverId}:team` : requestedTeamId
  const teamName = auth.server.name === '' ? 'Fixture Workspace' : auth.server.name
  const profiles = [{
    activeVersionId: 'version-1',
    assignmentCount: 1,
    createdAt: now,
    createdByUserId: account.userId,
    description: 'Local Relay fixture config profile.',
    id: `${teamId}:base-profile`,
    name: 'Base Profile',
    status: 'published',
    teamId,
    teamName,
    updatedAt: now,
    updatedByUserId: account.userId,
    versionCount: 1
  }]
  return {
    policy: null,
    profilesByTeamId: {
      [teamId]: profiles
    },
    remoteBaseUrl: auth.server.remoteBaseUrl,
    serverId: auth.server.id,
    teams: [{
      id: teamId,
      membership: {
        role: account.role ?? 'member'
      },
      name: teamName,
      slug: fixtureTeamSlug(teamName)
    }]
  }
}

const fixtureConfigShareProfileDetail = (auth: RelayShareAuth, payload?: unknown) => {
  const body = readPayload(payload)
  const profileId = readOptionalText(body.profileId)
  const targets = fixtureConfigShareTargets(auth, payload)
  const profiles = Object.values(targets?.profilesByTeamId ?? {}).flat()
  const profile = profiles.find(item => readOptionalText(item.id) === profileId) ?? profiles[0]
  if (profile == null) {
    throw new Error('Fixture config profile not found.')
  }
  const now = new Date().toISOString()
  const detailTeamId = readOptionalText(profile.teamId) ?? readOptionalText(body.teamId) ?? 'fixture-team'
  const version = {
    allowedFields: [
      'modelServices',
      'recommendedModels',
      'plugins',
      'marketplaces',
      'skills',
      'skillsMeta',
      'skillRegistries'
    ],
    changeNote: 'Fixture config profile version.',
    configPatch: {
      marketplaces: {
        official: {
          enabled: true,
          source: 'oneworks',
          title: 'OneWorks Marketplace'
        },
        team: {
          enabled: true,
          source: 'relay',
          teamId: detailTeamId,
          title: 'Team Marketplace'
        }
      },
      modelServices: {
        'relay-fixture-openai': {
          apiBaseUrl: 'https://api.openai.com/v1',
          description: 'Shared model service for team smoke testing.',
          extra: {
            provider: 'openai',
            routing: {
              priority: 10,
              tags: ['team', 'default']
            }
          },
          maxOutputTokens: 8192,
          models: ['gpt-4.1', 'gpt-4.1-mini'],
          timeoutMs: 120000,
          title: 'Relay Fixture OpenAI'
        },
        'relay-fixture-anthropic': {
          apiBaseUrl: 'https://api.anthropic.com/v1',
          description: 'Secondary shared model service.',
          extra: {
            provider: 'anthropic',
            routing: {
              priority: 20,
              tags: ['team', 'fallback']
            }
          },
          models: ['claude-sonnet-4'],
          title: 'Relay Fixture Anthropic'
        }
      },
      plugins: [
        {
          enabled: true,
          key: 'relay-demo',
          options: {
            channels: ['stable', 'beta'],
            features: {
              documents: true,
              teamConfigs: true
            }
          }
        },
        {
          enabled: true,
          key: 'workspace-insights',
          options: {
            dashboards: ['usage', 'quality'],
            refreshIntervalMinutes: 30
          }
        }
      ],
      recommendedModels: [
        {
          description: 'Default coding and review model for the team.',
          model: 'gpt-4.1',
          service: 'relay-fixture-openai',
          title: 'Team GPT-4.1'
        },
        {
          description: 'Fast model for lightweight edits.',
          model: 'gpt-4.1-mini',
          placement: 'modelSelector',
          service: 'relay-fixture-openai',
          title: 'Team GPT-4.1 Mini'
        },
        {
          description: 'Fallback model for long-form analysis.',
          model: 'claude-sonnet-4',
          service: 'relay-fixture-anthropic',
          title: 'Team Claude Sonnet'
        }
      ],
      skillRegistries: [
        {
          enabled: true,
          registry: 'https://skills.oneworks.cloud',
          source: 'oneworks',
          title: 'OneWorks Skills'
        },
        {
          enabled: true,
          registry: 'https://relay.example.com/teams/skills',
          source: 'relay',
          title: 'Team Skills'
        }
      ],
      skills: [
        {
          enabled: true,
          name: 'code-review',
          registry: 'https://skills.oneworks.cloud',
          version: '^1.0.0'
        },
        {
          enabled: true,
          name: 'release-notes',
          registry: 'https://relay.example.com/teams/skills',
          version: '^2.1.0'
        }
      ],
      skillsMeta: {
        defaults: {
          enabled: ['code-review'],
          suggested: ['release-notes']
        },
        policy: {
          allowPrerelease: false,
          autoUpdate: true
        }
      }
    },
    createdAt: now,
    createdByUserId: auth.account?.userId ?? 'fixture-user',
    id: 'version-1',
    profileId: readOptionalText(profile.id) ?? 'fixture-profile',
    secretRefs: {},
    sourceHash: 'fixture-config-version',
    version: 1
  }
  const assignmentId = `${readOptionalText(profile.id) ?? 'fixture-profile'}:assignment`
  const defaultAssignment = {
    createdAt: now,
    enabled: true,
    id: assignmentId,
    mode: 'default',
    priority: 100,
    profileId: readOptionalText(profile.id) ?? 'fixture-profile',
    project: {
      allow: ['github.com/oneworks-ai/app']
    },
    target: {
      teamIds: [detailTeamId]
    },
    updatedAt: null,
    versionId: version.id
  }
  return {
    assignments: [fixtureConfigShareAssignments.get(assignmentId) ?? defaultAssignment],
    profile,
    versions: [version]
  }
}

const isFixtureShareAuth = (auth: RelayShareAuth) => (
  auth.sessionToken.startsWith(RELAY_FIXTURE_SESSION_TOKEN_PREFIX)
)

const selectShareAuthAccount = async (
  server: ResolvedRelayServer,
  payload?: unknown
) => {
  const requestedAccountKey = readAccountKey(payload)
  const authStore = await readOneWorksAuthStore()
  const enabledAccounts = authStore.accounts.filter(account => account.enabled !== false)
  const requestedAccount = requestedAccountKey === ''
    ? undefined
    : enabledAccounts.find(account =>
      account.accountKey === requestedAccountKey &&
      accountMatchesRelayServer(account, server)
    )
  if (requestedAccount != null) return requestedAccount
  const serverAccounts = enabledAccounts.filter(account => accountMatchesRelayServer(account, server))
  return serverAccounts.find(accountHasValidSession) ?? serverAccounts[0]
}

const requireShareAuth = async (
  ctx: RelayPluginContext,
  payload?: unknown
): Promise<RelayShareAuth> => {
  const requestedServerId = readServerId(payload)
  const server = resolveActiveRelayServer(ctx.options, requestedServerId)
  if (server == null) {
    throw new Error(
      requestedServerId === ''
        ? 'Configure at least one relay server before sharing config.'
        : `Unknown relay server: ${requestedServerId}.`
    )
  }
  const authAccount = await selectShareAuthAccount(server, payload)
  if (authAccount != null) {
    const sessionToken = authAccount.sessionToken ?? ''
    if (sessionToken === '') {
      throw new Error('Relay login session is required before sharing team config.')
    }
    if (authAccount.sessionExpiresAt != null && Date.parse(authAccount.sessionExpiresAt) <= Date.now()) {
      throw new Error('Relay login session expired. Login again before sharing team config.')
    }
    return { account: authAccount, server, sessionToken }
  }
  const store = await createRelayDeviceStore(ctx.projectHome).readStore()
  const storedServer = store.servers[server.id]
  const sessionToken = storedServer?.sessionToken ?? ''
  if (storedServer == null || sessionToken === '') {
    throw new Error('Relay login session is required before sharing team config.')
  }
  if (storedServer.sessionExpiresAt != null && Date.parse(storedServer.sessionExpiresAt) <= Date.now()) {
    throw new Error('Relay login session expired. Login again before sharing team config.')
  }
  return { server, sessionToken }
}

const relayJson = async (
  auth: RelayShareAuth,
  path: string,
  init: RequestInit = {}
) => {
  const headers = {
    ...(isRecord(init.headers) ? init.headers : {}),
    authorization: `Bearer ${auth.sessionToken}`
  } as Record<string, string>
  const response = await fetch(new URL(path, auth.server.remoteBaseUrl), {
    ...init,
    headers
  })
  const body = await readBody(response)
  if (!response.ok) {
    throw new Error(toString(body.error) || `Relay request failed with ${response.status}.`)
  }
  return body
}

const relayPostJson = async (
  auth: RelayShareAuth,
  path: string,
  body: Record<string, unknown>
) =>
  relayJson(auth, path, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json'
    },
    method: 'POST'
  })

const relayPatchJson = async (
  auth: RelayShareAuth,
  path: string,
  body: Record<string, unknown>
) =>
  relayJson(auth, path, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json'
    },
    method: 'PATCH'
  })

const createDraftInput = (payload?: unknown): RelayConfigShareDraftInput => {
  const body = readPayload(payload)
  return {
    allowedFields: body.allowedFields,
    config: body.config,
    pluginSchemas: isRecord(body.pluginSchemas) ? body.pluginSchemas : undefined
  }
}

const readSecretId = (value: unknown) => {
  const body = isRecord(value) ? value : {}
  return isRecord(body.secret) ? readOptionalText(body.secret.id) : undefined
}

const uploadDraftSecrets = async (
  auth: RelayShareAuth,
  teamId: string,
  draftInput: RelayConfigShareDraftInput,
  draft: ReturnType<typeof buildRelayConfigShareDraft>
) => {
  const secretValues = collectRelayConfigShareSecretValues(draftInput)
  const secretRefs: Record<string, string> = {}
  const secrets: unknown[] = []

  for (const secret of draft.secretItems) {
    const value = secretValues[secret.ref]
    if (value == null || value === '') {
      throw new Error(`Missing secret value for ${secret.path}.`)
    }
    const response = await relayPostJson(auth, `/api/relay/teams/${encodeURIComponent(teamId)}/config-secrets`, {
      name: secret.displayName,
      value
    })
    const secretId = readSecretId(response)
    if (secretId == null) {
      throw new Error(`Relay did not return a secret id for ${secret.path}.`)
    }
    secretRefs[secret.ref] = secretId
    secrets.push(response.secret)
  }

  return { secretRefs, secrets }
}

const profileName = (payload: Record<string, unknown>) => (
  readOptionalText(payload.profileName) ?? `Shared config ${new Date().toISOString()}`
)

export const getRelayConfigShareTargets = async (
  ctx: RelayPluginContext,
  payload?: unknown
) => {
  const auth = await requireShareAuth(ctx, payload)
  if (isFixtureShareAuth(auth)) {
    const fixtureTargets = fixtureConfigShareTargets(auth, payload)
    if (fixtureTargets != null) return fixtureTargets
  }
  const teamsBody = await relayJson(auth, '/api/relay/teams')
  const teams = Array.isArray(teamsBody.teams) ? teamsBody.teams : []
  const profilesByTeamId: Record<string, unknown[]> = {}
  for (const team of teams) {
    const teamId = isRecord(team) ? readOptionalText(team.id) : undefined
    if (teamId == null) continue
    const profilesBody = await relayJson(auth, `/api/relay/teams/${encodeURIComponent(teamId)}/config-profiles`)
    profilesByTeamId[teamId] = Array.isArray(profilesBody.profiles) ? profilesBody.profiles : []
  }
  return {
    policy: teamsBody.policy ?? null,
    profilesByTeamId,
    remoteBaseUrl: auth.server.remoteBaseUrl,
    serverId: auth.server.id,
    teams
  }
}

export const getRelayConfigShareProfileDetail = async (
  ctx: RelayPluginContext,
  payload?: unknown
) => {
  const body = readPayload(payload)
  const profileId = readOptionalText(body.profileId)
  if (profileId == null) {
    throw new Error('profileId is required to load relay config profile detail.')
  }
  const auth = await requireShareAuth(ctx, payload)
  if (isFixtureShareAuth(auth)) {
    return fixtureConfigShareProfileDetail(auth, payload)
  }
  return await relayJson(auth, `/api/relay/config-profiles/${encodeURIComponent(profileId)}`)
}

export const publishRelayConfigShareDraft = async (
  ctx: RelayPluginContext,
  payload?: unknown
) => {
  const body = readPayload(payload)
  const teamId = toString(body.teamId)
  if (teamId === '') {
    throw new Error('teamId is required to publish relay config.')
  }
  const auth = await requireShareAuth(ctx, payload)
  const draftInput = createDraftInput(payload)
  const draft = buildRelayConfigShareDraft(draftInput)
  if (draft.configPatch == null) {
    throw new Error('A safe config share draft is required before publishing.')
  }

  const { secretRefs, secrets } = await uploadDraftSecrets(auth, teamId, draftInput, draft)
  const explicitProfileId = readOptionalText(body.profileId)
  const profileBody = explicitProfileId == null
    ? await relayPostJson(auth, `/api/relay/teams/${encodeURIComponent(teamId)}/config-profiles`, {
      description: readOptionalText(body.profileDescription),
      name: profileName(body)
    })
    : await relayJson(auth, `/api/relay/config-profiles/${encodeURIComponent(explicitProfileId)}`)
  const profile = isRecord(profileBody.profile) ? profileBody.profile : {}
  const profileId = readOptionalText(profile.id) ?? explicitProfileId
  if (profileId == null) {
    throw new Error('Relay did not return a config profile id.')
  }

  const versionBody = await relayPostJson(
    auth,
    `/api/relay/config-profiles/${encodeURIComponent(profileId)}/versions`,
    {
      allowedFields: draft.allowedFields,
      changeNote: readOptionalText(body.changeNote),
      configPatch: draft.configPatch,
      secretRefs: Object.keys(secretRefs).length === 0 ? undefined : secretRefs
    }
  )
  const version = isRecord(versionBody.version) ? versionBody.version : {}
  const versionId = readOptionalText(version.id)
  if (versionId == null) {
    throw new Error('Relay did not return a config profile version id.')
  }

  const published = body.publish === false
    ? null
    : await relayPostJson(auth, `/api/relay/config-profiles/${encodeURIComponent(profileId)}/publish`, {
      versionId
    })
  const assignment = body.assignToTeam === true
    ? await relayPostJson(auth, `/api/relay/config-profiles/${encodeURIComponent(profileId)}/assignments`, {
      mode: body.assignmentMode,
      priority: body.assignmentPriority,
      project: body.project,
      target: { teamIds: [teamId] },
      versionId
    })
    : null

  return {
    assignment,
    draft,
    profile: published ?? profileBody,
    remoteBaseUrl: auth.server.remoteBaseUrl,
    secretRefs,
    secrets,
    serverId: auth.server.id,
    version
  }
}

export const updateRelayConfigShareAssignment = async (
  ctx: RelayPluginContext,
  payload?: unknown
) => {
  const body = readPayload(payload)
  const assignmentId = readOptionalText(body.assignmentId)
  if (assignmentId == null) {
    throw new Error('assignmentId is required to update relay config assignment.')
  }
  const auth = await requireShareAuth(ctx, payload)
  const updateBody: Record<string, unknown> = {}
  for (const key of ['enabled', 'mode', 'priority', 'project', 'target', 'versionId'] as const) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      updateBody[key] = body[key]
    }
  }

  if (isFixtureShareAuth(auth)) {
    const now = new Date().toISOString()
    const previous = fixtureConfigShareAssignments.get(assignmentId)
    const assignment = {
      createdAt: previous?.createdAt ?? now,
      enabled: body.enabled !== false,
      id: assignmentId,
      mode: readOptionalText(body.mode) === 'override' ? 'override' : 'default',
      priority: typeof body.priority === 'number' ? body.priority : 100,
      profileId: readOptionalText(body.profileId) ?? assignmentId.replace(/:assignment$/u, ''),
      project: isRecord(body.project) ? body.project : null,
      target: isRecord(body.target) ? body.target : previous?.target ?? null,
      updatedAt: now,
      versionId: readOptionalText(body.versionId) ?? 'version-1'
    }
    fixtureConfigShareAssignments.set(assignmentId, assignment)
    return { assignment }
  }

  return await relayPatchJson(
    auth,
    `/api/relay/config-assignments/${encodeURIComponent(assignmentId)}`,
    updateBody
  )
}
