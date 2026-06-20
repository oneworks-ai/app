import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import type { RelayAdminAccessGroup, UpdateAccessGroupInput } from '../../shared/model/adminTypes'
import { AdminActionButton } from '../../shared/ui/AdminActionButton'
import { AccessGroupPanel } from '../access-groups/AccessGroupPanel'
import { useTeamDetailTabActions } from './TeamDetailTabActions'
import type { RelayAdminTeam } from './teamTypes'
import { deleteRelayAdminTeamAccessGroup, updateRelayAdminTeamAccessGroup } from './teamsApi'

export interface TeamAccessGroupsProps {
  disabled: boolean
  groups: RelayAdminAccessGroup[]
  onGroupsChange: (groups: RelayAdminAccessGroup[]) => void
  team: RelayAdminTeam
  token: string
}

export const TeamAccessGroups = ({
  disabled,
  groups,
  onGroupsChange,
  team,
  token
}: TeamAccessGroupsProps) => {
  const navigate = useNavigate()

  const actions = useMemo(
    () => (
      <AdminActionButton
        aria-label='新建成员组'
        disabled={disabled}
        iconName='add'
        size='small'
        title='新建成员组'
        type='primary'
        onClick={() => void navigate(`/teams/${encodeURIComponent(team.id)}/groups/new`)}
      />
    ),
    [disabled, navigate, team.id]
  )
  useTeamDetailTabActions('groups', actions)

  const updateGroup = async (input: UpdateAccessGroupInput) => {
    const body = await updateRelayAdminTeamAccessGroup(token, team.id, input)
    onGroupsChange(groups.map(group => group.id === body.group.id ? body.group : group))
  }

  const deleteGroup = async (group: RelayAdminAccessGroup) => {
    await deleteRelayAdminTeamAccessGroup(token, team.id, group.id)
    onGroupsChange(groups.filter(item => item.id !== group.id))
  }

  return (
    <AccessGroupPanel
      disabled={disabled}
      getGroupPath={group => `/teams/${encodeURIComponent(team.id)}/groups/${encodeURIComponent(group.id)}`}
      groups={groups}
      panelId='team-access-groups'
      scope='team'
      surface={false}
      onDeleteGroup={deleteGroup}
      onUpdateGroup={updateGroup}
    />
  )
}
