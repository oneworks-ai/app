import type { RelayTeam, RelayTeamMember, RelayUser } from '../types.js'

export const personalModelUsageReportingEnabled = (user: RelayUser) => (
  user.modelUsageReportingEnabled !== false
)

export const teamModelUsageReportingMode = (team: RelayTeam) => (
  team.modelUsageReportingMode === 'optional' ? 'optional' : 'required'
)

export const teamMemberCanControlModelUsageReporting = (team: RelayTeam) => (
  teamModelUsageReportingMode(team) === 'optional'
)

export const teamMemberModelUsageReportingEnabled = (
  team: RelayTeam,
  member: RelayTeamMember
) => (
  teamModelUsageReportingMode(team) === 'required' || member.modelUsageReportingEnabled !== false
)
