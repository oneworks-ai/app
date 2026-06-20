/* eslint-disable max-lines -- Relay config sharing coordinates remote teams, profiles, versions, secrets, and assignments. */
import { buildRelayConfigShareDraft, collectRelayConfigShareSecretValues } from '../shared/config-share-draft.js'
import type { RelayConfigShareDraftInput } from '../shared/config-share-draft.js'

import { resolveActiveRelayServer } from './options.js'
import type { ResolvedRelayServer } from './options.js'
import { createRelayDeviceStore } from './store.js'
import type { RelayPluginContext, RelayStoredServer } from './types.js'
import { isRecord, toString } from './utils.js'

interface RelayShareAuth {
  server: ResolvedRelayServer
  storedServer: RelayStoredServer
  sessionToken: string
}

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
  const store = await createRelayDeviceStore(ctx.projectHome).readStore()
  const storedServer = store.servers[server.id]
  const sessionToken = storedServer?.sessionToken ?? ''
  if (storedServer == null || sessionToken === '') {
    throw new Error('Relay login session is required before sharing team config.')
  }
  if (storedServer.sessionExpiresAt != null && Date.parse(storedServer.sessionExpiresAt) <= Date.now()) {
    throw new Error('Relay login session expired. Login again before sharing team config.')
  }
  return { server, sessionToken, storedServer }
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
