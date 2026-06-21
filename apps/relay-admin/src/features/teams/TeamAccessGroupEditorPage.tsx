import { Empty } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'

import type { CreateAccessGroupInput, UpdateAccessGroupInput } from '../../shared/model/adminTypes'
import { DataPanel } from '../../shared/ui/DataPanel'
import { AccessGroupForm } from '../access-groups/AccessGroupPanel'
import type { RelayAdminTeam } from './teamTypes'
import { createRelayAdminTeamAccessGroup, updateRelayAdminTeamAccessGroup } from './teamsApi'

export interface TeamAccessGroupEditorPageProps {
  disabled: boolean
  loading: boolean
  mode: 'create' | 'edit'
  onSaved: () => Promise<void>
  teams: RelayAdminTeam[]
  token: string
}

export const TeamAccessGroupEditorPage = ({
  disabled,
  loading,
  mode,
  onSaved,
  teams,
  token
}: TeamAccessGroupEditorPageProps) => {
  const { groupId, teamId } = useParams()
  const navigate = useNavigate()
  const team = teams.find(item => item.id === teamId)
  const group = mode === 'edit'
    ? team?.accessGroups.find(item => item.scope === 'team' && item.id === groupId)
    : undefined
  const navigateBack = () => {
    if (teamId == null) {
      void navigate('/teams')
      return
    }
    void navigate(`/teams/${encodeURIComponent(teamId)}/groups`)
  }
  const createGroup = async (input: CreateAccessGroupInput) => {
    if (team == null) return
    await createRelayAdminTeamAccessGroup(token, team.id, input)
    await onSaved()
  }
  const updateGroup = async (input: UpdateAccessGroupInput) => {
    if (team == null) return
    await updateRelayAdminTeamAccessGroup(token, team.id, input)
    await onSaved()
  }

  if (team == null || (mode === 'edit' && group == null)) {
    return (
      <DataPanel id='team-access-group-editor'>
        <section className='relay-access-groups__editor'>
          <Empty
            description={loading ? '正在加载成员组' : team == null ? '团队不存在' : '成员组不存在'}
          />
        </section>
      </DataPanel>
    )
  }

  return (
    <DataPanel id='team-access-group-editor'>
      <section className='relay-access-groups__editor'>
        <AccessGroupForm
          disabled={disabled}
          group={group}
          groups={team.accessGroups}
          mode={mode}
          scope='team'
          onCancel={navigateBack}
          onCreateGroup={createGroup}
          onUpdateGroup={updateGroup}
        />
      </section>
    </DataPanel>
  )
}
