import { Space } from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { Key } from 'react'
import { Link } from 'react-router-dom'

import { AdminActionButton } from '../../shared/ui/AdminActionButton'
import { AdminColumnFilter } from '../../shared/ui/AdminColumnFilter'
import { AdminListTable } from '../../shared/ui/AdminListTable'
import type { AdminListColumnOption } from '../../shared/ui/AdminListTable'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import type { RelayAdminTeam } from './teamTypes'

export interface TeamTableProps {
  disabled: boolean
  teams: RelayAdminTeam[]
  onSetArchived: (team: RelayAdminTeam, archived: boolean) => Promise<void>
}

const formatTimestamp = (value: string | null | undefined) => {
  if (value == null || value === '') return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export const TeamTable = ({ disabled, onSetArchived, teams }: TeamTableProps) => {
  const [searchValue, setSearchValue] = useState('')
  const [selectedTeamKeys, setSelectedTeamKeys] = useState<Key[]>([])
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
  const filteredTeamIds = useMemo(() => new Set(filteredTeams.map(team => team.id)), [filteredTeams])
  const selectedTeams = useMemo(
    () => teams.filter(team => selectedTeamKeys.includes(team.id)),
    [selectedTeamKeys, teams]
  )
  const hasSelectedTeams = selectedTeams.length > 0

  useEffect(() => {
    setSelectedTeamKeys(keys => keys.filter(key => filteredTeamIds.has(String(key))))
  }, [filteredTeamIds])

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
        <Link className='relay-team-panel__team-link' to={`/teams/${encodeURIComponent(team.id)}`}>
          {team.name}
        </Link>
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
    },
    {
      align: 'right',
      fixed: 'right',
      key: 'actions',
      render: (_, team) => {
        const archived = team.archivedAt != null
        return (
          <Space size={4}>
            <AdminActionButton
              aria-label={archived ? '恢复团队' : '归档团队'}
              danger={!archived}
              disabled={disabled}
              iconName={archived ? 'unarchive' : 'archive'}
              size='small'
              title={archived ? '恢复团队' : '归档团队'}
              type='text'
              onClick={() => void onSetArchived(team, !archived)}
            />
          </Space>
        )
      },
      title: '操作',
      width: 64
    }
  ]
  const batchActions = (
    <Space size={4}>
      <AdminActionButton
        aria-label='批量恢复团队'
        disabled={disabled || !hasSelectedTeams}
        iconName='unarchive'
        size='small'
        title='批量恢复团队'
        type='text'
        onClick={() => void Promise.all(selectedTeams.map(team => onSetArchived(team, false)))}
      />
      <AdminActionButton
        aria-label='批量归档团队'
        danger
        disabled={disabled || !hasSelectedTeams}
        iconName='archive'
        size='small'
        title='批量归档团队'
        type='text'
        onClick={() => void Promise.all(selectedTeams.map(team => onSetArchived(team, true)))}
      />
    </Space>
  )

  return (
    <AdminListTable<RelayAdminTeam>
      ariaLabel='团队列表'
      batchActions={batchActions}
      className='relay-team-panel__team-table'
      columnOptions={columnOptions}
      columns={columns}
      dataSource={filteredTeams}
      emptyText='暂无团队'
      rowKey='id'
      searchPlaceholder='搜索团队、slug'
      searchValue={searchValue}
      selectedRowKeys={selectedTeamKeys}
      visibleColumnKeys={visibleColumnKeys}
      onSearchChange={setSearchValue}
      onSelectedRowKeysChange={setSelectedTeamKeys}
      onVisibleColumnKeysChange={setVisibleColumnKeys}
    />
  )
}
