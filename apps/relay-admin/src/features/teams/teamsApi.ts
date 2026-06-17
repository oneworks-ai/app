/* eslint-disable max-lines -- Relay Admin team API endpoint mapping stays in one feature-local file. */
import { requestJson } from '../../shared/api/requestJson'
import type {
  CreateConfigProfileAssignmentInput,
  CreateConfigProfileInput,
  CreateConfigProfileVersionInput,
  CreateConfigSecretInput,
  CreateRelayAdminMessageInput,
  CreateTeamInput,
  CreateTeamInvitationInput,
  CreateTeamMemberInput,
  RelayAdminAuditEvent,
  RelayAdminConfigProfile,
  RelayAdminConfigProfileAssignment,
  RelayAdminConfigProfileVersion,
  RelayAdminConfigSecret,
  RelayAdminMessage,
  RelayAdminTeam,
  RelayAdminTeamInvitation,
  RelayAdminTeamMember,
  RelayAdminTeamPolicy,
  RotateConfigSecretInput,
  UpdateTeamInput,
  UpdateTeamMemberInput,
  UpdateTeamPolicyInput
} from './teamTypes'

export interface RelayAdminTeamsResponse {
  policy: RelayAdminTeamPolicy
  teams: RelayAdminTeam[]
}

export interface RelayAdminConfigProfileDetailResponse {
  assignments: RelayAdminConfigProfileAssignment[]
  profile: RelayAdminConfigProfile
  versions: RelayAdminConfigProfileVersion[]
}

export const fetchRelayAdminTeams = async (token: string) =>
  await requestJson<RelayAdminTeamsResponse>(token, '/api/admin/teams')

export const fetchRelayAdminMessages = async (token: string, options?: { view?: 'sent' }) => {
  const searchParams = new URLSearchParams()
  if (options?.view != null) searchParams.set('view', options.view)
  const query = searchParams.size === 0 ? '' : `?${searchParams.toString()}`
  return await requestJson<{ invitations: RelayAdminTeamInvitation[]; messages: RelayAdminMessage[] }>(
    token,
    `/api/admin/messages${query}`
  )
}

export const createRelayAdminMessage = async (token: string, input: CreateRelayAdminMessageInput) =>
  await requestJson<{ message: RelayAdminMessage }>(token, '/api/admin/messages', {
    body: JSON.stringify(input),
    method: 'POST'
  })

export const createRelayAdminTeam = async (token: string, input: CreateTeamInput) =>
  await requestJson<{ team: RelayAdminTeam }>(token, '/api/admin/teams', {
    body: JSON.stringify(input),
    method: 'POST'
  })

export const updateRelayAdminTeam = async (token: string, team: RelayAdminTeam, input: UpdateTeamInput) =>
  await requestJson<{ team: RelayAdminTeam }>(
    token,
    `/api/admin/teams/${encodeURIComponent(team.id)}`,
    {
      body: JSON.stringify(input),
      method: 'PATCH'
    }
  )

export const archiveRelayAdminTeam = async (token: string, teamId: string) =>
  await requestJson<{ team: RelayAdminTeam }>(
    token,
    `/api/admin/teams/${encodeURIComponent(teamId)}/archive`,
    { method: 'POST' }
  )

export const restoreRelayAdminTeam = async (token: string, teamId: string) =>
  await requestJson<{ team: RelayAdminTeam }>(
    token,
    `/api/admin/teams/${encodeURIComponent(teamId)}/restore`,
    { method: 'POST' }
  )

export const fetchRelayAdminTeamMembers = async (token: string, teamId: string) =>
  await requestJson<{ members: RelayAdminTeamMember[] }>(
    token,
    `/api/admin/teams/${encodeURIComponent(teamId)}/members`
  )

export const fetchRelayAdminTeamInvitations = async (token: string, teamId: string) =>
  await requestJson<{ invitations: RelayAdminTeamInvitation[] }>(
    token,
    `/api/admin/teams/${encodeURIComponent(teamId)}/invitations`
  )

export const fetchRelayAdminTeamAuditEvents = async (token: string, teamId: string) =>
  await requestJson<{ events: RelayAdminAuditEvent[] }>(
    token,
    `/api/admin/teams/${encodeURIComponent(teamId)}/audit-events`
  )

export const createRelayAdminTeamMember = async (token: string, input: CreateTeamMemberInput) =>
  await requestJson<{ member: RelayAdminTeamMember }>(
    token,
    `/api/admin/teams/${encodeURIComponent(input.teamId)}/members`,
    {
      body: JSON.stringify(input),
      method: 'POST'
    }
  )

export const createRelayAdminTeamInvitation = async (token: string, input: CreateTeamInvitationInput) =>
  await requestJson<{ invitation: RelayAdminTeamInvitation }>(
    token,
    `/api/admin/teams/${encodeURIComponent(input.teamId)}/invitations`,
    {
      body: JSON.stringify(input),
      method: 'POST'
    }
  )

export const acceptRelayAdminTeamInvitation = async (token: string, invitationId: string) =>
  await requestJson<{ invitation: RelayAdminTeamInvitation }>(
    token,
    `/api/admin/team-invitations/${encodeURIComponent(invitationId)}/accept`,
    { method: 'POST' }
  )

export const declineRelayAdminTeamInvitation = async (token: string, invitationId: string) =>
  await requestJson<{ invitation: RelayAdminTeamInvitation }>(
    token,
    `/api/admin/team-invitations/${encodeURIComponent(invitationId)}/decline`,
    { method: 'POST' }
  )

export const updateRelayAdminTeamMember = async (
  token: string,
  member: RelayAdminTeamMember,
  input: UpdateTeamMemberInput
) =>
  await requestJson<{ member: RelayAdminTeamMember }>(
    token,
    `/api/admin/teams/${encodeURIComponent(member.teamId)}/members/${encodeURIComponent(member.userId)}`,
    {
      body: JSON.stringify(input),
      method: 'PATCH'
    }
  )

export const deleteRelayAdminTeamMember = async (token: string, member: RelayAdminTeamMember) =>
  await requestJson<{ deleted: boolean; member: RelayAdminTeamMember }>(
    token,
    `/api/admin/teams/${encodeURIComponent(member.teamId)}/members/${encodeURIComponent(member.userId)}`,
    { method: 'DELETE' }
  )

export const updateRelayAdminTeamPolicy = async (token: string, input: UpdateTeamPolicyInput) =>
  await requestJson<{ policy: RelayAdminTeamPolicy }>(token, '/api/admin/team-policy', {
    body: JSON.stringify(input),
    method: 'PATCH'
  })

export const fetchRelayAdminTeamConfigProfiles = async (token: string, teamId: string) =>
  await requestJson<{ profiles: RelayAdminConfigProfile[] }>(
    token,
    `/api/admin/teams/${encodeURIComponent(teamId)}/config-profiles`
  )

export const fetchRelayAdminTeamConfigSecrets = async (token: string, teamId: string) =>
  await requestJson<{ secrets: RelayAdminConfigSecret[] }>(
    token,
    `/api/admin/teams/${encodeURIComponent(teamId)}/config-secrets`
  )

export const createRelayAdminConfigSecret = async (token: string, input: CreateConfigSecretInput) =>
  await requestJson<{ secret: RelayAdminConfigSecret }>(
    token,
    `/api/admin/teams/${encodeURIComponent(input.teamId)}/config-secrets`,
    {
      body: JSON.stringify({ name: input.name, value: input.value }),
      method: 'POST'
    }
  )

export const rotateRelayAdminConfigSecret = async (
  token: string,
  secret: RelayAdminConfigSecret,
  input: RotateConfigSecretInput
) =>
  await requestJson<{ secret: RelayAdminConfigSecret }>(
    token,
    `/api/admin/config-secrets/${encodeURIComponent(secret.id)}/rotate`,
    {
      body: JSON.stringify(input),
      method: 'POST'
    }
  )

export const revokeRelayAdminConfigSecret = async (token: string, secret: RelayAdminConfigSecret) =>
  await requestJson<{ secret: RelayAdminConfigSecret }>(
    token,
    `/api/admin/config-secrets/${encodeURIComponent(secret.id)}/revoke`,
    { method: 'POST' }
  )

export const fetchRelayAdminConfigProfile = async (token: string, profileId: string) =>
  await requestJson<RelayAdminConfigProfileDetailResponse>(
    token,
    `/api/admin/config-profiles/${encodeURIComponent(profileId)}`
  )

export const createRelayAdminConfigProfile = async (token: string, input: CreateConfigProfileInput) =>
  await requestJson<RelayAdminConfigProfileDetailResponse>(
    token,
    `/api/admin/teams/${encodeURIComponent(input.teamId)}/config-profiles`,
    {
      body: JSON.stringify({ description: input.description, name: input.name }),
      method: 'POST'
    }
  )

export const createRelayAdminConfigProfileVersion = async (
  token: string,
  profileId: string,
  input: CreateConfigProfileVersionInput
) =>
  await requestJson<{ version: RelayAdminConfigProfileVersion }>(
    token,
    `/api/admin/config-profiles/${encodeURIComponent(profileId)}/versions`,
    {
      body: JSON.stringify(input),
      method: 'POST'
    }
  )

export const publishRelayAdminConfigProfile = async (token: string, profileId: string, versionId?: string) =>
  await requestJson<RelayAdminConfigProfileDetailResponse>(
    token,
    `/api/admin/config-profiles/${encodeURIComponent(profileId)}/publish`,
    {
      body: JSON.stringify(versionId == null ? {} : { versionId }),
      method: 'POST'
    }
  )

export const createRelayAdminConfigProfileAssignment = async (
  token: string,
  profileId: string,
  input: CreateConfigProfileAssignmentInput
) =>
  await requestJson<{ assignment: RelayAdminConfigProfileAssignment }>(
    token,
    `/api/admin/config-profiles/${encodeURIComponent(profileId)}/assignments`,
    {
      body: JSON.stringify(input),
      method: 'POST'
    }
  )

export const updateRelayAdminConfigProfileAssignment = async (
  token: string,
  assignment: RelayAdminConfigProfileAssignment,
  input: Pick<RelayAdminConfigProfileAssignment, 'enabled'>
) =>
  await requestJson<{ assignment: RelayAdminConfigProfileAssignment }>(
    token,
    `/api/admin/config-assignments/${encodeURIComponent(assignment.id)}`,
    {
      body: JSON.stringify(input),
      method: 'PATCH'
    }
  )
