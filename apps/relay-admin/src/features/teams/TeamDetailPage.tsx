import './TeamPanel.css'

import { Empty, Tabs } from 'antd'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { DataPanel } from '../../shared/ui/DataPanel'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import { TeamConfigProfiles } from './TeamConfigProfiles'
import { TeamConfigSecrets } from './TeamConfigSecrets'
import { TeamDetailTabActionsContext } from './TeamDetailTabActions'
import type { TeamDetailTabKey } from './TeamDetailTabActions'
import { TeamMembers } from './TeamMembers'
import type { RelayAdminTeam, RelayAdminTeamPolicy } from './teamTypes'

export interface TeamDetailPageProps {
  disabled: boolean
  loading: boolean
  policy?: RelayAdminTeamPolicy
  teams: RelayAdminTeam[]
  token: string
}

const isTeamDetailTabKey = (value: string): value is TeamDetailTabKey =>
  value === 'members' || value === 'profiles' || value === 'secrets'

const formatTimestamp = (value: string | null | undefined) => {
  if (value == null || value === '') return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export const TeamDetailPage = ({
  disabled,
  loading,
  policy,
  teams,
  token
}: TeamDetailPageProps) => {
  const { tabKey, teamId } = useParams()
  const navigate = useNavigate()
  const team = teams.find(item => item.id === teamId)
  const configDisabled = disabled || policy?.teamsEnabled === false
  const normalizedTabKey = tabKey ?? ''
  const activeTabKey: TeamDetailTabKey = isTeamDetailTabKey(normalizedTabKey) ? normalizedTabKey : 'members'
  const [tabActions, setTabActions] = useState<Partial<Record<TeamDetailTabKey, ReactNode>>>({})
  const registerTabActions = useCallback((key: TeamDetailTabKey, actions: ReactNode | undefined) => {
    setTabActions(current => current[key] === actions ? current : { ...current, [key]: actions })
    return () => {
      setTabActions(current => current[key] === actions ? { ...current, [key]: undefined } : current)
    }
  }, [])
  const tabActionsContext = useMemo(() => ({ registerTabActions }), [registerTabActions])

  useEffect(() => {
    if (teamId == null || tabKey == null || isTeamDetailTabKey(tabKey)) return
    void navigate(`/teams/${encodeURIComponent(teamId)}/members`, { replace: true })
  }, [navigate, tabKey, teamId])

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
        <div className='relay-team-detail__overview' aria-label='团队基本信息'>
          <p
            className={[
              'relay-team-detail__description',
              team.description == null || team.description.trim() === '' ? 'is-empty' : ''
            ].filter(Boolean).join(' ')}
          >
            {team.description == null || team.description.trim() === '' ? '暂无团队介绍' : team.description}
          </p>
          <dl className='relay-team-detail__meta-list'>
            <div className='relay-team-detail__meta-item'>
              <dt>Slug</dt>
              <dd>{team.slug}</dd>
            </div>
            <div className='relay-team-detail__meta-item'>
              <dt>状态</dt>
              <dd>
                {team.archivedAt == null
                  ? <StatusBadge tone='success'>active</StatusBadge>
                  : <StatusBadge tone='warning'>archived</StatusBadge>}
              </dd>
            </div>
            <div className='relay-team-detail__meta-item'>
              <dt>成员</dt>
              <dd>{team.memberCount}</dd>
            </div>
            <div className='relay-team-detail__meta-item'>
              <dt>创建时间</dt>
              <dd>{formatTimestamp(team.createdAt)}</dd>
            </div>
          </dl>
        </div>

        <TeamDetailTabActionsContext.Provider value={tabActionsContext}>
          <Tabs
            activeKey={activeTabKey}
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
                label: '配置方案'
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
                label: '密钥'
              }
            ]}
            tabBarExtraContent={tabActions[activeTabKey] == null
              ? null
              : <div className='relay-team-panel__tab-actions'>{tabActions[activeTabKey]}</div>}
            onChange={key => {
              if (isTeamDetailTabKey(key)) {
                void navigate(`/teams/${encodeURIComponent(team.id)}/${key}`)
              }
            }}
          />
        </TeamDetailTabActionsContext.Provider>
      </section>
    </DataPanel>
  )
}
