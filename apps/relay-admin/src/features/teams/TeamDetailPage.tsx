/* eslint-disable max-lines -- Team detail page coordinates overview, tab routing, and route-level actions. */

import './TeamPanel.css'

import { Avatar, Empty, Tabs } from 'antd'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { AdminIcon } from '../../shared/ui/AdminIcon'
import type { AdminIconName } from '../../shared/ui/AdminIcon'
import { DataPanel } from '../../shared/ui/DataPanel'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import { TeamAccessGroups } from './TeamAccessGroups'
import { TeamAuditEvents } from './TeamAuditEvents'
import { TeamConfigProfiles } from './TeamConfigProfiles'
import { TeamConfigSecrets } from './TeamConfigSecrets'
import { TeamDetailTabActionsContext } from './TeamDetailTabActions'
import type { TeamDetailTabKey } from './TeamDetailTabActions'
import { TeamDocuments } from './TeamDocuments'
import { TeamMembers } from './TeamMembers'
import type { RelayAdminTeam, RelayAdminTeamMemberRole, RelayAdminTeamPolicy } from './teamTypes'

export interface TeamDetailPageProps {
  disabled: boolean
  loading: boolean
  policy?: RelayAdminTeamPolicy
  teams: RelayAdminTeam[]
  token: string
}

const isTeamDetailTabKey = (value: string): value is TeamDetailTabKey =>
  value === 'members' || value === 'groups' || value === 'profiles' || value === 'secrets' ||
  value === 'documents' || value === 'audit'

const formatTimestamp = (value: string | null | undefined) => {
  if (value == null || value === '') return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

const teamInitials = (name: string) => {
  const words = name.trim().split(/\s+/u).filter(Boolean)
  if (words.length >= 2) {
    return `${Array.from(words[0] ?? '').at(0) ?? ''}${Array.from(words[1] ?? '').at(0) ?? ''}`.toUpperCase()
  }
  const fallback = words[0] ?? name
  return Array.from(fallback).slice(0, 2).join('').toUpperCase() || '团'
}

const teamRoleLabel = (role: RelayAdminTeamMemberRole | undefined) => {
  switch (role) {
    case 'owner':
      return '团队所有者'
    case 'admin':
      return '团队管理员'
    case 'editor':
      return '编辑者'
    case 'viewer':
      return '只读成员'
    case 'member':
      return '成员'
    default:
      return '平台管理员'
  }
}

const teamTabLabel = (iconName: AdminIconName, label: string) => (
  <span className='relay-team-panel__tab-label'>
    <AdminIcon name={iconName} />
    <span>{label}</span>
  </span>
)

export const TeamDetailPage = ({
  disabled,
  loading,
  policy,
  teams,
  token
}: TeamDetailPageProps) => {
  const { profileId, tabKey, teamId } = useParams()
  const navigate = useNavigate()
  const team = teams.find(item => item.id === teamId)
  const [teamAccessGroups, setTeamAccessGroups] = useState(team?.accessGroups ?? [])
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
  const teamWithAccessGroups = useMemo(
    () => team == null ? undefined : { ...team, accessGroups: teamAccessGroups },
    [team, teamAccessGroups]
  )

  useEffect(() => {
    setTeamAccessGroups(team?.accessGroups ?? [])
  }, [team?.accessGroups, team?.id])

  useEffect(() => {
    if (teamId == null || tabKey == null || isTeamDetailTabKey(tabKey)) return
    void navigate(`/teams/${encodeURIComponent(teamId)}/members`, { replace: true })
  }, [navigate, tabKey, teamId])

  if (teamWithAccessGroups == null) {
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
          <div className='relay-team-detail__identity'>
            <Avatar
              className='relay-team-detail__avatar'
              shape='square'
              size={48}
              src={teamWithAccessGroups.avatarUrl ?? undefined}
            >
              {teamInitials(teamWithAccessGroups.name)}
            </Avatar>
            <div className='relay-team-detail__identity-copy'>
              <div className='relay-team-detail__name-row'>
                <h2>{teamWithAccessGroups.name}</h2>
                {teamWithAccessGroups.archivedAt == null
                  ? <StatusBadge tone='success'>启用</StatusBadge>
                  : <StatusBadge tone='warning'>已归档</StatusBadge>}
              </div>
              <p className='relay-team-detail__slug'>{teamWithAccessGroups.slug}</p>
              <p
                className={[
                  'relay-team-detail__description',
                  teamWithAccessGroups.description == null || teamWithAccessGroups.description.trim() === ''
                    ? 'is-empty'
                    : ''
                ].filter(Boolean).join(' ')}
              >
                {teamWithAccessGroups.description == null || teamWithAccessGroups.description.trim() === ''
                  ? '暂无团队介绍'
                  : teamWithAccessGroups.description}
              </p>
            </div>
          </div>
          <dl className='relay-team-detail__meta-list'>
            <div className='relay-team-detail__meta-item'>
              <dt>成员</dt>
              <dd>{teamWithAccessGroups.memberCount}</dd>
            </div>
            <div className='relay-team-detail__meta-item'>
              <dt>我的角色</dt>
              <dd>{teamRoleLabel(teamWithAccessGroups.membership?.role)}</dd>
            </div>
            <div className='relay-team-detail__meta-item'>
              <dt>Proxy 模式</dt>
              <dd>{teamWithAccessGroups.proxyModeEnabled ? '允许' : '关闭'}</dd>
            </div>
            <div className='relay-team-detail__meta-item'>
              <dt>创建时间</dt>
              <dd>{formatTimestamp(teamWithAccessGroups.createdAt)}</dd>
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
                    accessGroups={teamWithAccessGroups.accessGroups}
                    disabled={configDisabled}
                    team={teamWithAccessGroups}
                    token={token}
                  />
                ),
                key: 'members',
                label: teamTabLabel('group', '成员')
              },
              {
                children: (
                  <TeamAccessGroups
                    disabled={configDisabled}
                    groups={teamWithAccessGroups.accessGroups}
                    team={teamWithAccessGroups}
                    token={token}
                    onGroupsChange={setTeamAccessGroups}
                  />
                ),
                key: 'groups',
                label: teamTabLabel('badge', '成员组')
              },
              {
                children: (
                  <TeamConfigProfiles
                    activeProfileId={activeTabKey === 'profiles' ? profileId : undefined}
                    disabled={configDisabled}
                    team={teamWithAccessGroups}
                    token={token}
                    onProfileRouteChange={nextProfileId => {
                      const basePath = `/teams/${encodeURIComponent(teamWithAccessGroups.id)}/profiles`
                      void navigate(
                        nextProfileId == null
                          ? basePath
                          : `${basePath}/${encodeURIComponent(nextProfileId)}`
                      )
                    }}
                  />
                ),
                key: 'profiles',
                label: teamTabLabel('admin_panel_settings', '配置方案')
              },
              {
                children: (
                  <TeamConfigSecrets
                    disabled={configDisabled}
                    team={teamWithAccessGroups}
                    token={token}
                  />
                ),
                key: 'secrets',
                label: teamTabLabel('key', '密钥')
              },
              {
                children: (
                  <TeamDocuments
                    disabled={configDisabled}
                    team={teamWithAccessGroups}
                    token={token}
                  />
                ),
                key: 'documents',
                label: teamTabLabel('sync', '同步文档')
              },
              {
                children: (
                  <TeamAuditEvents
                    disabled={configDisabled}
                    team={teamWithAccessGroups}
                    token={token}
                  />
                ),
                key: 'audit',
                label: teamTabLabel('fact_check', '操作审计')
              }
            ]}
            tabBarExtraContent={tabActions[activeTabKey] == null
              ? null
              : <div className='relay-team-panel__tab-actions'>{tabActions[activeTabKey]}</div>}
            onChange={key => {
              if (isTeamDetailTabKey(key)) {
                void navigate(`/teams/${encodeURIComponent(teamWithAccessGroups.id)}/${key}`)
              }
            }}
          />
        </TeamDetailTabActionsContext.Provider>
      </section>
    </DataPanel>
  )
}
