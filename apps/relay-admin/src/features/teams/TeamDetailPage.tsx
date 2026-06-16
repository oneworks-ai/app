import './TeamPanel.css'

import { Empty, Tabs } from 'antd'
import { useParams } from 'react-router-dom'

import { DataPanel } from '../../shared/ui/DataPanel'
import { TeamConfigProfiles } from './TeamConfigProfiles'
import { TeamConfigSecrets } from './TeamConfigSecrets'
import { TeamMembers } from './TeamMembers'
import type { RelayAdminTeam, RelayAdminTeamPolicy } from './teamTypes'

export interface TeamDetailPageProps {
  disabled: boolean
  loading: boolean
  policy?: RelayAdminTeamPolicy
  teams: RelayAdminTeam[]
  token: string
}

export const TeamDetailPage = ({
  disabled,
  loading,
  policy,
  teams,
  token
}: TeamDetailPageProps) => {
  const { teamId } = useParams()
  const team = teams.find(item => item.id === teamId)
  const configDisabled = disabled || policy?.teamsEnabled === false

  if (team == null) {
    return (
      <DataPanel id='team-detail'>
        <section className='relay-team-detail'>
          <Empty
            className='relay-team-detail__empty'
            description={loading ? '正在加载团队' : '团队不存在'}
          />
        </section>
      </DataPanel>
    )
  }

  return (
    <DataPanel id='team-detail'>
      <section className='relay-team-detail'>
        <Tabs
          className='relay-team-panel__tabs'
          items={[
            {
              children: (
                <TeamMembers
                  disabled={configDisabled}
                  team={team}
                  token={token}
                />
              ),
              key: 'members',
              label: '成员'
            },
            {
              children: (
                <TeamConfigProfiles
                  disabled={configDisabled}
                  team={team}
                  token={token}
                />
              ),
              key: 'profiles',
              label: '配置 Profiles'
            },
            {
              children: (
                <TeamConfigSecrets
                  disabled={configDisabled}
                  team={team}
                  token={token}
                />
              ),
              key: 'secrets',
              label: 'Secrets'
            }
          ]}
        />
      </section>
    </DataPanel>
  )
}
