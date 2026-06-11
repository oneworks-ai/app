import './DevicePanel.css'

import type { TableColumnsType } from 'antd'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import type { RelayAdminDevice, RelayAdminDeviceStatus } from '../../shared/model/adminTypes'
import { AdminColumnFilter } from '../../shared/ui/AdminColumnFilter'
import { AdminListTable } from '../../shared/ui/AdminListTable'
import type { AdminListColumnOption } from '../../shared/ui/AdminListTable'
import { StatusBadge } from '../../shared/ui/StatusBadge'

export interface DeviceTableProps {
  devices: RelayAdminDevice[]
  initialVisibleColumnKeys?: string[]
  searchPlaceholder?: string
}

const deviceStatuses = ['online', 'stale', 'offline'] as const satisfies readonly RelayAdminDeviceStatus[]

const formatTimestamp = (value: string | null | undefined) => {
  if (value == null || value === '') return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

const deviceStatusTone = (status: RelayAdminDevice['status']) => {
  if (status === 'online') return 'success'
  if (status === 'stale') return 'warning'
  return 'muted'
}

const deviceStatusLabel = (status: RelayAdminDevice['status']) => status ?? 'offline'

const capabilityLabel = (capabilities: Record<string, unknown>) => {
  const keys = Object.keys(capabilities).sort()
  if (keys.length === 0) return '无'
  if (keys.length <= 2) return keys.join(', ')
  return `${keys.slice(0, 2).join(', ')} +${keys.length - 2}`
}

const defaultVisibleColumnKeys = [
  'name',
  'status',
  'lastSeenAt',
  'capabilities'
]

export const DeviceTable = ({
  devices,
  initialVisibleColumnKeys = defaultVisibleColumnKeys,
  searchPlaceholder = '搜索设备、支持功能'
}: DeviceTableProps) => {
  const [searchValue, setSearchValue] = useState('')
  const [statusFilter, setStatusFilter] = useState<RelayAdminDeviceStatus | 'all'>('all')
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(initialVisibleColumnKeys)
  const filteredDevices = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase()
    return devices.filter(device => {
      const status = deviceStatusLabel(device.status)
      const capabilities = capabilityLabel(device.capabilities)
      const searchableValues = [
        device.id,
        device.name,
        status,
        capabilities,
        device.workspaceFolder ?? '',
        device.pluginScope ?? ''
      ]
      return (
        (normalizedSearch === '' || searchableValues.some(value => value.toLowerCase().includes(normalizedSearch))) &&
        (statusFilter === 'all' || status === statusFilter)
      )
    })
  }, [devices, searchValue, statusFilter])

  const columnOptions: AdminListColumnOption[] = [
    { key: 'name', label: '设备', required: true },
    { key: 'id', label: '设备 ID' },
    { key: 'status', label: '状态' },
    { key: 'lastSeenAt', label: '最近在线' },
    { key: 'capabilities', label: '支持功能' },
    { key: 'workspaceFolder', label: '工作区' },
    { key: 'pluginScope', label: '插件范围' },
    { key: 'createdAt', label: '注册时间' }
  ]
  const columns: TableColumnsType<RelayAdminDevice> = [
    {
      dataIndex: 'name',
      ellipsis: true,
      key: 'name',
      render: (_, device) => (
        <span className='relay-device-panel__identity'>
          <Link to={`/devices/${encodeURIComponent(device.id)}`}>
            <strong>{device.name}</strong>
          </Link>
        </span>
      ),
      title: '设备',
      width: 200
    },
    {
      dataIndex: 'id',
      key: 'id',
      render: value => <span className='relay-device-panel__secondary'>{value}</span>,
      title: '设备 ID',
      width: 280
    },
    {
      dataIndex: 'status',
      key: 'status',
      render: value => <StatusBadge tone={deviceStatusTone(value)}>{deviceStatusLabel(value)}</StatusBadge>,
      title: (
        <AdminColumnFilter<RelayAdminDeviceStatus | 'all'>
          allValue='all'
          ariaLabel='按状态过滤设备'
          label='状态'
          options={[
            { label: '全部状态', value: 'all' },
            ...deviceStatuses.map(status => ({ label: status, value: status }))
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
        />
      ),
      width: 100
    },
    {
      dataIndex: 'lastSeenAt',
      key: 'lastSeenAt',
      render: value => formatTimestamp(value),
      title: '最近在线',
      width: 160
    },
    {
      dataIndex: 'capabilities',
      ellipsis: true,
      key: 'capabilities',
      render: value => capabilityLabel(value),
      title: '支持功能',
      width: 148
    },
    {
      dataIndex: 'workspaceFolder',
      ellipsis: true,
      key: 'workspaceFolder',
      render: value => value ?? '-',
      title: '工作区',
      width: 260
    },
    {
      dataIndex: 'pluginScope',
      ellipsis: true,
      key: 'pluginScope',
      render: value => value ?? '-',
      title: '插件范围',
      width: 140
    },
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: value => formatTimestamp(value),
      title: '注册时间',
      width: 160
    }
  ]

  return (
    <AdminListTable<RelayAdminDevice>
      ariaLabel='设备列表'
      className='relay-device-panel__table'
      columnOptions={columnOptions}
      columns={columns}
      dataSource={filteredDevices}
      emptyText='暂无设备'
      rowKey='id'
      searchPlaceholder={searchPlaceholder}
      searchValue={searchValue}
      visibleColumnKeys={visibleColumnKeys}
      onSearchChange={setSearchValue}
      onVisibleColumnKeysChange={setVisibleColumnKeys}
    />
  )
}
