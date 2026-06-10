/* eslint-disable max-lines -- invite table keeps list controls, columns, and row actions together. */
import { Popconfirm, Space } from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { Key } from 'react'

import { relayAdminRoles } from '../../shared/model/adminRoles'
import type { RelayAdminInvite } from '../../shared/model/adminTypes'
import { AdminActionButton } from '../../shared/ui/AdminActionButton'
import { AdminColumnFilter } from '../../shared/ui/AdminColumnFilter'
import { AdminListTable } from '../../shared/ui/AdminListTable'
import type { AdminListColumnOption } from '../../shared/ui/AdminListTable'
import { StatusBadge } from '../../shared/ui/StatusBadge'

export interface InviteTableProps {
  disabled: boolean
  invites: RelayAdminInvite[]
  onDeleteInvite: (invite: RelayAdminInvite) => Promise<void>
  onSetRevoked: (invite: RelayAdminInvite, revoked: boolean) => Promise<void>
}

export const InviteTable = ({
  disabled,
  invites,
  onDeleteInvite,
  onSetRevoked
}: InviteTableProps) => {
  const [roleFilter, setRoleFilter] = useState<RelayAdminInvite['role'] | 'all'>('all')
  const [searchValue, setSearchValue] = useState('')
  const [selectedInviteKeys, setSelectedInviteKeys] = useState<Key[]>([])
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | 'revoked'>('all')
  const [visibleColumnKeys, setVisibleColumnKeys] = useState([
    'code',
    'role',
    'usage',
    'status'
  ])
  const filteredInvites = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase()
    return invites.filter(invite => {
      const status = invite.revokedAt == null ? 'active' : 'revoked'
      const searchableValues = [
        invite.code,
        invite.role,
        invite.userId ?? '',
        status
      ]
      return (
        (normalizedSearch === '' || searchableValues.some(value => value.toLowerCase().includes(normalizedSearch))) &&
        (roleFilter === 'all' || invite.role === roleFilter) &&
        (statusFilter === 'all' || status === statusFilter)
      )
    })
  }, [invites, roleFilter, searchValue, statusFilter])
  const filteredInviteCodes = useMemo(() => new Set(filteredInvites.map(invite => invite.code)), [filteredInvites])
  const selectedInvites = useMemo(
    () => invites.filter(invite => selectedInviteKeys.includes(invite.code)),
    [invites, selectedInviteKeys]
  )
  const hasSelectedInvites = selectedInvites.length > 0

  useEffect(() => {
    setSelectedInviteKeys(keys => keys.filter(key => filteredInviteCodes.has(String(key))))
  }, [filteredInviteCodes])

  const columnOptions: AdminListColumnOption[] = [
    { key: 'code', label: '邀请码', required: true },
    { key: 'role', label: '权限' },
    { key: 'usage', label: '使用次数' },
    { key: 'status', label: '状态' },
    { key: 'userId', label: '绑定用户' }
  ]
  const columns: TableColumnsType<RelayAdminInvite> = [
    {
      dataIndex: 'code',
      key: 'code',
      render: value => <span className='relay-invite-panel__code'>{value}</span>,
      title: '邀请码',
      width: 180
    },
    {
      dataIndex: 'role',
      key: 'role',
      title: (
        <AdminColumnFilter<RelayAdminInvite['role'] | 'all'>
          allValue='all'
          ariaLabel='按权限过滤邀请码'
          label='权限'
          options={[
            { label: '全部权限', value: 'all' },
            ...relayAdminRoles.map(role => ({ label: role, value: role }))
          ]}
          value={roleFilter}
          onChange={setRoleFilter}
        />
      ),
      width: 100
    },
    {
      key: 'usage',
      render: (_, invite) => `${invite.used}/${invite.maxUses}`,
      title: '使用次数',
      width: 110
    },
    {
      dataIndex: 'revokedAt',
      key: 'status',
      render: (_, invite) =>
        invite.revokedAt == null
          ? <StatusBadge tone='success'>active</StatusBadge>
          : <StatusBadge tone='warning'>revoked</StatusBadge>,
      title: (
        <AdminColumnFilter<'active' | 'all' | 'revoked'>
          allValue='all'
          ariaLabel='按状态过滤邀请码'
          label='状态'
          options={[
            { label: '全部状态', value: 'all' },
            { label: 'active', value: 'active' },
            { label: 'revoked', value: 'revoked' }
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
        />
      ),
      width: 100
    },
    {
      dataIndex: 'userId',
      key: 'userId',
      render: value => value ?? '-',
      title: '绑定用户',
      width: 280
    },
    {
      align: 'right',
      fixed: 'right',
      key: 'actions',
      render: (_, invite) => (
        <Space size={4}>
          <AdminActionButton
            aria-label={invite.revokedAt == null ? '撤销' : '恢复'}
            disabled={disabled}
            iconName={invite.revokedAt == null ? 'disabled_by_default' : 'check'}
            onClick={() => void onSetRevoked(invite, invite.revokedAt == null)}
            size='small'
            title={invite.revokedAt == null ? '撤销' : '恢复'}
            type='text'
          />
          <Popconfirm
            disabled={disabled}
            okText='删除'
            title='删除这个邀请码？'
            onConfirm={() => void onDeleteInvite(invite)}
          >
            <AdminActionButton
              aria-label='删除'
              danger
              disabled={disabled}
              iconName='delete'
              size='small'
              title='删除'
              type='text'
            />
          </Popconfirm>
        </Space>
      ),
      title: '操作',
      width: 92
    }
  ]
  const batchActions = (
    <Space size={4}>
      <AdminActionButton
        aria-label='批量恢复'
        disabled={disabled || !hasSelectedInvites}
        iconName='check'
        size='small'
        title='批量恢复'
        type='text'
        onClick={() => void Promise.all(selectedInvites.map(invite => onSetRevoked(invite, false)))}
      />
      <AdminActionButton
        aria-label='批量撤销'
        disabled={disabled || !hasSelectedInvites}
        iconName='disabled_by_default'
        size='small'
        title='批量撤销'
        type='text'
        onClick={() => void Promise.all(selectedInvites.map(invite => onSetRevoked(invite, true)))}
      />
      <Popconfirm
        disabled={disabled || !hasSelectedInvites}
        okText='删除'
        title='删除选中的邀请码？'
        onConfirm={() => void Promise.all(selectedInvites.map(invite => onDeleteInvite(invite)))}
      >
        <AdminActionButton
          aria-label='批量删除'
          danger
          disabled={disabled || !hasSelectedInvites}
          iconName='delete'
          size='small'
          title='批量删除'
          type='text'
        />
      </Popconfirm>
    </Space>
  )

  return (
    <AdminListTable<RelayAdminInvite>
      ariaLabel='邀请码列表'
      batchActions={batchActions}
      className='relay-invite-panel__table'
      columnOptions={columnOptions}
      columns={columns}
      dataSource={filteredInvites}
      emptyText='暂无邀请码'
      rowKey='code'
      searchPlaceholder='搜索邀请码、绑定用户'
      searchValue={searchValue}
      selectedRowKeys={selectedInviteKeys}
      visibleColumnKeys={visibleColumnKeys}
      onSearchChange={setSearchValue}
      onSelectedRowKeysChange={setSelectedInviteKeys}
      onVisibleColumnKeysChange={setVisibleColumnKeys}
    />
  )
}
