/* eslint-disable max-lines -- SSO provider table keeps filters, columns, and provider actions together. */
import { Popconfirm, Space } from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { Key } from 'react'

import type { RelayAdminSsoProvider } from '../../shared/model/adminTypes'
import { AdminActionButton } from '../../shared/ui/AdminActionButton'
import { AdminColumnFilter } from '../../shared/ui/AdminColumnFilter'
import { AdminListTable } from '../../shared/ui/AdminListTable'
import type { AdminListColumnOption } from '../../shared/ui/AdminListTable'
import { StatusBadge } from '../../shared/ui/StatusBadge'

export interface SsoProviderTableProps {
  disabled: boolean
  onDeleteProvider: (provider: RelayAdminSsoProvider) => Promise<void>
  onEditProvider: (provider: RelayAdminSsoProvider) => void
  onSetEnabled: (provider: RelayAdminSsoProvider, enabled: boolean) => Promise<void>
  providers: RelayAdminSsoProvider[]
}

export const SsoProviderTable = ({
  disabled,
  onDeleteProvider,
  onEditProvider,
  onSetEnabled,
  providers
}: SsoProviderTableProps) => {
  const [searchValue, setSearchValue] = useState('')
  const [selectedProviderKeys, setSelectedProviderKeys] = useState<Key[]>([])
  const [statusFilter, setStatusFilter] = useState<'all' | 'disabled' | 'enabled'>('all')
  const [typeFilter, setTypeFilter] = useState<RelayAdminSsoProvider['type'] | 'all'>('all')
  const [visibleColumnKeys, setVisibleColumnKeys] = useState([
    'name',
    'type',
    'status',
    'clientId',
    'scope'
  ])
  const filteredProviders = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase()
    return providers.filter(provider => {
      const status = provider.enabled ? 'enabled' : 'disabled'
      const searchableValues = [
        provider.clientId,
        provider.id,
        provider.name,
        provider.scope,
        provider.type,
        status
      ]
      return (
        (normalizedSearch === '' || searchableValues.some(value => value.toLowerCase().includes(normalizedSearch))) &&
        (statusFilter === 'all' || status === statusFilter) &&
        (typeFilter === 'all' || provider.type === typeFilter)
      )
    })
  }, [providers, searchValue, statusFilter, typeFilter])
  const filteredProviderIds = useMemo(() => new Set(filteredProviders.map(provider => provider.id)), [
    filteredProviders
  ])
  const selectedProviders = useMemo(
    () => providers.filter(provider => selectedProviderKeys.includes(provider.id)),
    [providers, selectedProviderKeys]
  )
  const hasSelectedProviders = selectedProviders.length > 0

  useEffect(() => {
    setSelectedProviderKeys(keys => keys.filter(key => filteredProviderIds.has(String(key))))
  }, [filteredProviderIds])

  const columnOptions: AdminListColumnOption[] = [
    { key: 'name', label: 'Provider', required: true },
    { key: 'id', label: 'Provider ID' },
    { key: 'type', label: '类型' },
    { key: 'status', label: '状态' },
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Secret' },
    { key: 'scope', label: 'Scope' }
  ]
  const columns: TableColumnsType<RelayAdminSsoProvider> = [
    {
      dataIndex: 'name',
      key: 'name',
      render: (_, provider) => (
        <span className='relay-sso-panel__identity'>
          <strong>{provider.name}</strong>
        </span>
      ),
      title: 'Provider',
      width: 180
    },
    {
      dataIndex: 'id',
      key: 'id',
      render: value => <span className='relay-sso-panel__secondary'>{value}</span>,
      title: 'Provider ID',
      width: 220
    },
    {
      dataIndex: 'type',
      key: 'type',
      title: (
        <AdminColumnFilter<RelayAdminSsoProvider['type'] | 'all'>
          allValue='all'
          ariaLabel='按类型过滤 SSO'
          label='类型'
          options={[
            { label: '全部类型', value: 'all' },
            { label: 'oidc', value: 'oidc' },
            { label: 'oauth2', value: 'oauth2' }
          ]}
          value={typeFilter}
          onChange={setTypeFilter}
        />
      ),
      width: 100
    },
    {
      dataIndex: 'enabled',
      key: 'status',
      render: (_, provider) =>
        provider.enabled
          ? <StatusBadge tone='success'>enabled</StatusBadge>
          : <StatusBadge tone='warning'>disabled</StatusBadge>,
      title: (
        <AdminColumnFilter<'all' | 'disabled' | 'enabled'>
          allValue='all'
          ariaLabel='按状态过滤 SSO'
          label='状态'
          options={[
            { label: '全部状态', value: 'all' },
            { label: 'enabled', value: 'enabled' },
            { label: 'disabled', value: 'disabled' }
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
        />
      ),
      width: 110
    },
    {
      dataIndex: 'clientId',
      key: 'clientId',
      render: value => <span className='relay-sso-panel__client'>{value}</span>,
      title: 'Client ID',
      width: 340
    },
    {
      dataIndex: 'clientSecret',
      key: 'clientSecret',
      render: value => value ?? '-',
      title: 'Secret',
      width: 120
    },
    {
      dataIndex: 'scope',
      ellipsis: true,
      key: 'scope',
      title: 'Scope',
      width: 180
    },
    {
      align: 'right',
      fixed: 'right',
      key: 'actions',
      render: (_, provider) => (
        <Space size={4}>
          <AdminActionButton
            aria-label='编辑'
            disabled={disabled}
            iconName='edit'
            onClick={() => onEditProvider(provider)}
            size='small'
            title='编辑'
            type='text'
          />
          <AdminActionButton
            aria-label={provider.enabled ? '禁用' : '启用'}
            disabled={disabled}
            iconName={provider.enabled ? 'disabled_by_default' : 'check'}
            onClick={() => void onSetEnabled(provider, !provider.enabled)}
            size='small'
            title={provider.enabled ? '禁用' : '启用'}
            type='text'
          />
          <Popconfirm
            disabled={disabled}
            okText='删除'
            title='删除这个 SSO provider？'
            onConfirm={() => void onDeleteProvider(provider)}
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
      width: 118
    }
  ]
  const batchActions = (
    <Space size={4}>
      <AdminActionButton
        aria-label='批量启用'
        disabled={disabled || !hasSelectedProviders}
        iconName='check'
        size='small'
        title='批量启用'
        type='text'
        onClick={() => void Promise.all(selectedProviders.map(provider => onSetEnabled(provider, true)))}
      />
      <AdminActionButton
        aria-label='批量禁用'
        disabled={disabled || !hasSelectedProviders}
        iconName='disabled_by_default'
        size='small'
        title='批量禁用'
        type='text'
        onClick={() => void Promise.all(selectedProviders.map(provider => onSetEnabled(provider, false)))}
      />
      <Popconfirm
        disabled={disabled || !hasSelectedProviders}
        okText='删除'
        title='删除选中的 SSO provider？'
        onConfirm={() => void Promise.all(selectedProviders.map(provider => onDeleteProvider(provider)))}
      >
        <AdminActionButton
          aria-label='批量删除'
          danger
          disabled={disabled || !hasSelectedProviders}
          iconName='delete'
          size='small'
          title='批量删除'
          type='text'
        />
      </Popconfirm>
    </Space>
  )

  return (
    <AdminListTable<RelayAdminSsoProvider>
      ariaLabel='SSO provider 列表'
      batchActions={batchActions}
      className='relay-sso-panel__table'
      columnOptions={columnOptions}
      columns={columns}
      dataSource={filteredProviders}
      emptyText='暂无 SSO provider'
      rowKey='id'
      searchPlaceholder='搜索 Provider、Client ID、Scope'
      searchValue={searchValue}
      selectedRowKeys={selectedProviderKeys}
      visibleColumnKeys={visibleColumnKeys}
      onSearchChange={setSearchValue}
      onSelectedRowKeysChange={setSelectedProviderKeys}
      onVisibleColumnKeysChange={setVisibleColumnKeys}
    />
  )
}
