import { requestJson } from '../../shared/api/requestJson'
import type {
  CreateConfigProfileAssignmentInput,
  CreateConfigProfileInput,
  CreateConfigProfileVersionInput,
  CreateTeamInput,
  CreateTeamMemberInput,
  RelayAdminConfigProfile,
  RelayAdminConfigProfileAssignment,
  RelayAdminConfigProfileVersion,
  RelayAdminTeam,
  RelayAdminTeamMember,
  RelayAdminTeamPolicy,
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

export const createRelayAdminTeam = async (token: string, input: CreateTeamInput) =>
  await requestJson<{ team: RelayAdminTeam }>(token, '/api/admin/teams', {
    body: JSON.stringify(input),
    method: 'POST'
  })

export const fetchRelayAdminTeamMembers = async (token: string, teamId: string) =>
  await requestJson<{ members: RelayAdminTeamMember[] }>(
    token,
    `/api/admin/teams/${encodeURIComponent(teamId)}/members`
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
