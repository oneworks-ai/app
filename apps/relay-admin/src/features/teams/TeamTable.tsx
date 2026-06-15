import { Button } from 'antd'
import type { TableColumnsType } from 'antd'
import { useMemo, useState } from 'react'

import { AdminColumnFilter } from '../../shared/ui/AdminColumnFilter'
import { AdminListTable } from '../../shared/ui/AdminListTable'
import type { AdminListColumnOption } from '../../shared/ui/AdminListTable'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import type { RelayAdminTeam } from './teamTypes'

export interface TeamTableProps {
  selectedTeamId?: string
  teams: RelayAdminTeam[]
  onSelectTeam: (teamId: string) => void
}

const formatTimestamp = (value: string | null | undefined) => {
  if (value == null || value === '') return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export const TeamTable = ({ onSelectTeam, selectedTeamId, teams }: TeamTableProps) => {
  const [searchValue, setSearchValue] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | 'archived'>('active')
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(['name', 'status', 'memberCount', 'createdAt'])
  const filteredTeams = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase()
    return teams.filter(team => {
      const status = team.archivedAt == null ? 'active' : 'archived'
      const searchableValues = [team.id, team.name, team.slug, team.description ?? '', status]
      return (
        (statusFilter === 'all' || status === statusFilter) &&
        (normalizedSearch === '' || searchableValues.some(value => value.toLowerCase().includes(normalizedSearch)))
      )
    })
  }, [searchValue, statusFilter, teams])
  const columnOptions: AdminListColumnOption[] = [
    { key: 'name', label: '团队', required: true },
    { key: 'slug', label: 'Slug' },
    { key: 'status', label: '状态' },
    { key: 'memberCount', label: '成员' },
    { key: 'createdAt', label: '创建时间' },
    { key: 'updatedAt', label: '更新时间' }
  ]
  const columns: TableColumnsType<RelayAdminTeam> = [
    {
      dataIndex: 'name',
      key: 'name',
      render: (_, team) => (
        <Button
          className={[
            'relay-team-panel__team-link',
            team.id === selectedTeamId ? 'is-active' : ''
          ].filter(Boolean).join(' ')}
          type='link'
          onClick={() => onSelectTeam(team.id)}
        >
          {team.name}
        </Button>
      ),
      title: '团队',
      width: 200
    },
    {
      dataIndex: 'slug',
      key: 'slug',
      render: value => <span className='relay-team-panel__secondary'>{value}</span>,
      title: 'Slug',
      width: 160
    },
    {
      dataIndex: 'archivedAt',
      key: 'status',
      render: value =>
        value == null
          ? <StatusBadge tone='success'>active</StatusBadge>
          : <StatusBadge tone='warning'>archived</StatusBadge>,
      title: (
        <AdminColumnFilter<'active' | 'all' | 'archived'>
          allValue='all'
          ariaLabel='按状态过滤团队'
          label='状态'
          options={[
            { label: '全部状态', value: 'all' },
            { label: 'active', value: 'active' },
            { label: 'archived', value: 'archived' }
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
        />
      ),
      width: 120
    },
    {
      dataIndex: 'memberCount',
      key: 'memberCount',
      title: '成员',
      width: 96
    },
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: value => formatTimestamp(value),
      title: '创建时间',
      width: 170
    },
    {
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: value => formatTimestamp(value),
      title: '更新时间',
      width: 170
    }
  ]

  return (
    <AdminListTable<RelayAdminTeam>
      ariaLabel='团队列表'
      className='relay-team-panel__team-table'
      columnOptions={columnOptions}
      columns={columns}
      dataSource={filteredTeams}
      emptyText='暂无团队'
      rowKey='id'
      searchPlaceholder='搜索团队、slug'
      searchValue={searchValue}
      visibleColumnKeys={visibleColumnKeys}
      onSearchChange={setSearchValue}
      onVisibleColumnKeysChange={setVisibleColumnKeys}
    />
  )
}
