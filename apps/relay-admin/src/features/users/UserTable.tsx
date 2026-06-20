/* eslint-disable max-lines -- user table keeps admin list controls, editable columns, and row actions together. */
import { Avatar, InputNumber, Space, Tooltip } from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { Key } from 'react'
import { Link } from 'react-router-dom'

import type { RelayAdminAccessGroup, RelayAdminUser } from '../../shared/model/adminTypes'
import { AdminActionButton } from '../../shared/ui/AdminActionButton'
import { AdminColumnFilter } from '../../shared/ui/AdminColumnFilter'
import { AdminListTable } from '../../shared/ui/AdminListTable'
import type { AdminListColumnOption } from '../../shared/ui/AdminListTable'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import { accessGroupName } from '../access-groups/accessGroupModel'
import { UserPasswordModal } from './UserPasswordModal'
import type { UserTableGroupFilter, UserTableTeamFilter } from './userTableModel'
import { createUserGroupFilterOptions, createUserTeamFilterOptions, filterRelayAdminUsers } from './userTableModel'

export interface UserTableProps {
  accessGroups: RelayAdminAccessGroup[]
  disabled: boolean
  onSetDisabled: (user: RelayAdminUser, disabled: boolean) => Promise<void>
  onSetMaxDevices: (user: RelayAdminUser, maxDevices: number | null) => Promise<void>
  onSetPassword: (user: RelayAdminUser, password: string) => Promise<void>
  users: RelayAdminUser[]
}

const normalizeDeviceLimit = (value: string | number | null) => {
  if (value == null || value === '') return null
  const count = Number(value)
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : null
}

const userAvatarFallback = (user: RelayAdminUser) => (
  (user.name.trim() || user.email || '?').slice(0, 1).toUpperCase()
)

const userStatus = (user: RelayAdminUser) => user.disabled ? 'disabled' : 'active'

export const UserTable = ({
  accessGroups,
  disabled,
  onSetDisabled,
  onSetMaxDevices,
  onSetPassword,
  users
}: UserTableProps) => {
  const [passwordUser, setPasswordUser] = useState<RelayAdminUser | undefined>()
  const [groupFilter, setGroupFilter] = useState<UserTableGroupFilter>('all')
  const [searchValue, setSearchValue] = useState('')
  const [selectedUserKeys, setSelectedUserKeys] = useState<Key[]>([])
  const [sourceFilter, setSourceFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | 'disabled'>('all')
  const [teamFilter, setTeamFilter] = useState<UserTableTeamFilter>('all')
  const [visibleColumnKeys, setVisibleColumnKeys] = useState([
    'identity',
    'groups',
    'teams',
    'devices',
    'provider'
  ])
  const sourceOptions = useMemo(
    () => Array.from(new Set(users.map(user => user.provider ?? 'local'))).sort(),
    [users]
  )
  const groupOptions = useMemo(() => createUserGroupFilterOptions(accessGroups), [accessGroups])
  const teamOptions = useMemo(() => createUserTeamFilterOptions(users), [users])
  const filteredUsers = useMemo(() => {
    return filterRelayAdminUsers(users, accessGroups, {
      groupFilter,
      searchValue,
      sourceFilter,
      statusFilter,
      teamFilter
    })
  }, [accessGroups, groupFilter, searchValue, sourceFilter, statusFilter, teamFilter, users])
  const filteredUserIds = useMemo(() => new Set(filteredUsers.map(user => user.id)), [filteredUsers])
  const selectedUsers = useMemo(
    () => users.filter(user => selectedUserKeys.includes(user.id)),
    [selectedUserKeys, users]
  )
  const hasSelectedUsers = selectedUsers.length > 0

  useEffect(() => {
    setSelectedUserKeys(keys => keys.filter(key => filteredUserIds.has(String(key))))
  }, [filteredUserIds])

  const columnOptions: AdminListColumnOption[] = [
    { key: 'identity', label: '用户', required: true },
    { key: 'id', label: '用户 ID' },
    { key: 'groups', label: '用户组' },
    { key: 'teams', label: '团队' },
    { key: 'devices', label: '设备' },
    { key: 'provider', label: '来源' }
  ]
  const columns: TableColumnsType<RelayAdminUser> = [
    {
      dataIndex: 'email',
      ellipsis: true,
      key: 'identity',
      render: (_, user) => {
        const status = userStatus(user)
        const statusLabel = `状态：${status}`
        return (
          <Tooltip placement='topLeft' title={statusLabel}>
            <Link className='relay-user-panel__identity' to={`/users/${encodeURIComponent(user.id)}`}>
              <span className='relay-user-panel__avatar-wrap'>
                <Avatar
                  className='relay-user-panel__avatar'
                  size={28}
                  src={user.avatarUrl ?? undefined}
                >
                  {userAvatarFallback(user)}
                </Avatar>
                <span
                  aria-label={statusLabel}
                  className={`relay-user-panel__status-dot relay-user-panel__status-dot--${status}`}
                  role='img'
                  title={statusLabel}
                />
              </span>
              <span className='relay-user-panel__identity-main'>
                <strong>{user.email}</strong>
                <span className='relay-user-panel__identity-name'>
                  {user.loginId == null || user.loginId === '' ? user.name || '-' : `@${user.loginId}`}
                </span>
              </span>
            </Link>
          </Tooltip>
        )
      },
      title: (
        <AdminColumnFilter<'active' | 'all' | 'disabled'>
          allValue='all'
          ariaLabel='按状态过滤用户'
          label='用户'
          options={[
            { label: '全部状态', value: 'all' },
            { label: 'active', value: 'active' },
            { label: 'disabled', value: 'disabled' }
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
        />
      ),
      width: 232
    },
    {
      dataIndex: 'id',
      key: 'id',
      render: value => <span className='relay-user-panel__secondary'>{value}</span>,
      title: '用户 ID',
      width: 280
    },
    {
      key: 'groups',
      render: (_, user) => (
        <span className='relay-user-panel__groups'>
          {user.groupIds.length === 0
            ? <span className='relay-user-panel__secondary'>-</span>
            : user.groupIds.map(groupId => (
              <StatusBadge key={groupId} tone='muted'>
                {accessGroupName(accessGroups, groupId)}
              </StatusBadge>
            ))}
        </span>
      ),
      title: (
        <AdminColumnFilter<UserTableGroupFilter>
          allValue='all'
          ariaLabel='按用户组过滤用户'
          label='用户组'
          options={[
            { label: '全部用户组', value: 'all' },
            ...groupOptions
          ]}
          value={groupFilter}
          onChange={setGroupFilter}
        />
      ),
      width: 180
    },
    {
      key: 'teams',
      render: (_, user) => (
        <span className='relay-user-panel__teams'>
          {user.teams.length === 0
            ? <span className='relay-user-panel__secondary'>-</span>
            : user.teams.map(team => (
              <StatusBadge key={team.id} tone={team.configEnabled ? 'success' : 'warning'}>
                {team.name}
              </StatusBadge>
            ))}
        </span>
      ),
      title: (
        <AdminColumnFilter<UserTableTeamFilter>
          allValue='all'
          ariaLabel='按团队过滤用户'
          label='团队'
          options={[
            { label: '全部团队', value: 'all' },
            ...teamOptions
          ]}
          value={teamFilter}
          onChange={setTeamFilter}
        />
      ),
      width: 190
    },
    {
      dataIndex: 'deviceCount',
      key: 'devices',
      render: (_, user) => (
        <span className='relay-user-panel__device-limit'>
          <span className='relay-user-panel__device-count'>{user.deviceCount}</span>
          <span className='relay-user-panel__device-separator'>/</span>
          <InputNumber
            aria-label={`Max devices for ${user.email}`}
            className='relay-user-panel__device-input'
            controls={false}
            disabled={disabled}
            min={0}
            placeholder='不限'
            size='small'
            value={user.maxDevices}
            onChange={value => void onSetMaxDevices(user, normalizeDeviceLimit(value))}
          />
        </span>
      ),
      title: '设备',
      width: 126
    },
    {
      dataIndex: 'provider',
      ellipsis: true,
      key: 'provider',
      render: value => <span className='relay-user-panel__source'>{value ?? '-'}</span>,
      title: (
        <AdminColumnFilter
          allValue='all'
          ariaLabel='按来源过滤用户'
          label='来源'
          options={[
            { label: '全部来源', value: 'all' },
            ...sourceOptions.map(source => ({ label: source, value: source }))
          ]}
          value={sourceFilter}
          onChange={setSourceFilter}
        />
      ),
      width: 98
    },
    {
      align: 'right',
      fixed: 'right',
      key: 'actions',
      render: (_, user) => (
        <Space size={4}>
          <AdminActionButton
            aria-label={user.passwordEnabled ? '重置密码' : '设置密码'}
            disabled={disabled}
            iconName='key'
            onClick={() => setPasswordUser(user)}
            size='small'
            title={user.passwordEnabled ? '重置密码' : '设置密码'}
            type='text'
          />
          <AdminActionButton
            aria-label={user.disabled ? '启用' : '禁用'}
            danger={!user.disabled}
            disabled={disabled}
            iconName={user.disabled ? 'check' : 'disabled_by_default'}
            onClick={() => void onSetDisabled(user, !user.disabled)}
            size='small'
            title={user.disabled ? '启用' : '禁用'}
            type='text'
          />
        </Space>
      ),
      title: '操作',
      width: 68
    }
  ]
  const batchActions = (
    <Space size={4}>
      <AdminActionButton
        aria-label='批量启用'
        disabled={disabled || !hasSelectedUsers}
        iconName='check'
        size='small'
        title='批量启用'
        type='text'
        onClick={() => void Promise.all(selectedUsers.map(user => onSetDisabled(user, false)))}
      />
      <AdminActionButton
        aria-label='批量禁用'
        danger
        disabled={disabled || !hasSelectedUsers}
        iconName='disabled_by_default'
        size='small'
        title='批量禁用'
        type='text'
        onClick={() => void Promise.all(selectedUsers.map(user => onSetDisabled(user, true)))}
      />
    </Space>
  )

  return (
    <>
      <AdminListTable<RelayAdminUser>
        ariaLabel='用户列表'
        batchActions={batchActions}
        className='relay-user-panel__table'
        columnOptions={columnOptions}
        columns={columns}
        dataSource={filteredUsers}
        emptyText='暂无用户'
        rowKey='id'
        searchPlaceholder='搜索邮箱、Login ID、名称、来源、用户组、团队'
        searchValue={searchValue}
        selectedRowKeys={selectedUserKeys}
        visibleColumnKeys={visibleColumnKeys}
        onSearchChange={setSearchValue}
        onSelectedRowKeysChange={setSelectedUserKeys}
        onVisibleColumnKeysChange={setVisibleColumnKeys}
      />
      <UserPasswordModal
        user={passwordUser}
        onClose={() => setPasswordUser(undefined)}
        onSetPassword={onSetPassword}
      />
    </>
  )
}
