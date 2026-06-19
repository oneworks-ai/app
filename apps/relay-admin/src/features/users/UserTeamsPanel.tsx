import { Empty, Table } from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useMemo, useState } from 'react'

import { StatusBadge } from '../../shared/ui/StatusBadge'
import type { RelayAdminConfigProfile, RelayAdminTeam, RelayAdminTeamMember } from '../teams/teamTypes'
import { fetchRelayAdminTeamConfigProfiles, fetchRelayAdminTeamMembers } from '../teams/teamsApi'

export interface UserTeamsPanelProps {
  token: string
  teams: RelayAdminTeam[]
  userId: string
}

interface UserTeamRow {
  inheritedProfiles: RelayAdminConfigProfile[]
  member: RelayAdminTeamMember
  team: RelayAdminTeam
}

const formatTimestamp = (value: string | null | undefined) => {
  if (value == null || value === '') return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

const profileTone = (profile: RelayAdminConfigProfile, configEnabled: boolean) => {
  if (!configEnabled || profile.status === 'disabled') return 'warning'
  if (profile.status === 'published') return 'success'
  return 'muted'
}

export const UserTeamsPanel = ({ teams, token, userId }: UserTeamsPanelProps) => {
  const [error, setError] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<UserTeamRow[]>([])

  useEffect(() => {
    let active = true
    if (token.trim() === '' || teams.length === 0 || userId === '') {
      setRows([])
      setError(undefined)
      return
    }

    setLoading(true)
    setError(undefined)
    void Promise.all(teams.map(async team => {
      const [membersBody, profilesBody] = await Promise.all([
        fetchRelayAdminTeamMembers(token, team.id),
        fetchRelayAdminTeamConfigProfiles(token, team.id)
      ])
      const member = membersBody.members.find(item => item.userId === userId)
      return member == null
        ? undefined
        : {
          inheritedProfiles: profilesBody.profiles,
          member,
          team
        }
    }))
      .then(result => {
        if (!active) return
        setRows(result.filter((row): row is UserTeamRow => row != null))
      })
      .catch(reason => {
        if (!active) return
        setRows([])
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [teams, token, userId])

  const columns = useMemo<TableColumnsType<UserTeamRow>>(() => [
    {
      dataIndex: ['team', 'name'],
      key: 'team',
      render: (_, row) => (
        <span className='relay-user-detail__team-name'>
          <strong>{row.team.name}</strong>
          <span>{row.team.slug}</span>
        </span>
      ),
      title: '团队',
      width: 180
    },
    {
      dataIndex: ['member', 'role'],
      key: 'role',
      render: value => <StatusBadge tone='muted'>{value}</StatusBadge>,
      title: '角色',
      width: 110
    },
    {
      key: 'config',
      render: (_, row) => (
        <span className='relay-user-detail__team-badges'>
          <StatusBadge tone={row.member.configEnabled ? 'success' : 'warning'}>
            {row.member.configEnabled ? 'config on' : 'config off'}
          </StatusBadge>
          {row.member.defaultForPublishing ? <StatusBadge tone='muted'>default publishing</StatusBadge> : null}
        </span>
      ),
      title: '配置',
      width: 190
    },
    {
      dataIndex: ['member', 'createdAt'],
      key: 'createdAt',
      render: value => formatTimestamp(value),
      title: '加入时间',
      width: 160
    },
    {
      dataIndex: 'inheritedProfiles',
      key: 'profiles',
      render: (_, row) => (
        <span className='relay-user-detail__profiles'>
          {row.inheritedProfiles.length === 0
            ? <span className='relay-user-detail__profiles-empty'>无</span>
            : row.inheritedProfiles.map(profile => (
              <StatusBadge key={profile.id} tone={profileTone(profile, row.member.configEnabled)}>
                {profile.name}
              </StatusBadge>
            ))}
        </span>
      ),
      title: '继承配置',
      width: 300
    }
  ], [])

  return (
    <div className='relay-user-detail__teams'>
      <div className='relay-user-detail__devices-header'>
        <h3>所属团队</h3>
        <span>{rows.length} 个团队</span>
      </div>
      {error == null ? null : <p className='relay-user-detail__error'>{error}</p>}
      {rows.length === 0 && !loading && error == null
        ? <Empty className='relay-user-detail__empty' description='暂无团队' />
        : (
          <Table<UserTeamRow>
            className='relay-admin-table relay-user-detail__teams-table'
            columns={columns}
            dataSource={rows}
            loading={loading}
            locale={{ emptyText: '暂无团队' }}
            pagination={false}
            rowKey={row => row.member.id}
            scroll={{ x: 'max-content' }}
            size='middle'
          />
        )}
    </div>
  )
}
