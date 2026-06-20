import './DevicePanel.css'

import { useMemo, useState } from 'react'

import type { RelayAdminDevice, RelayAdminDeviceStatus } from '../../shared/model/adminTypes'
import { AdminListTable } from '../../shared/ui/AdminListTable'
import { createDeviceColumns, defaultVisibleColumnKeys, deviceColumnOptions, filterDevices } from './deviceTableColumns'

export interface DeviceTableProps {
  devices: RelayAdminDevice[]
  initialVisibleColumnKeys?: string[]
  searchPlaceholder?: string
  searchValue?: string
  statusFilter?: RelayAdminDeviceStatus | 'all'
  visibleColumnKeys?: string[]
  onSearchChange?: (value: string) => void
  onStatusFilterChange?: (value: RelayAdminDeviceStatus | 'all') => void
  onVisibleColumnKeysChange?: (keys: string[]) => void
}

export const DeviceTable = ({
  devices,
  initialVisibleColumnKeys = defaultVisibleColumnKeys,
  searchPlaceholder = '搜索设备、支持功能',
  searchValue,
  statusFilter,
  visibleColumnKeys,
  onSearchChange,
  onStatusFilterChange,
  onVisibleColumnKeysChange
}: DeviceTableProps) => {
  const [internalSearchValue, setInternalSearchValue] = useState('')
  const [internalStatusFilter, setInternalStatusFilter] = useState<RelayAdminDeviceStatus | 'all'>('all')
  const [internalVisibleColumnKeys, setInternalVisibleColumnKeys] = useState(initialVisibleColumnKeys)
  const resolvedSearchValue = searchValue ?? internalSearchValue
  const resolvedStatusFilter = statusFilter ?? internalStatusFilter
  const resolvedVisibleColumnKeys = visibleColumnKeys ?? internalVisibleColumnKeys
  const handleSearchChange = onSearchChange ?? setInternalSearchValue
  const handleStatusFilterChange = onStatusFilterChange ?? setInternalStatusFilter
  const handleVisibleColumnKeysChange = onVisibleColumnKeysChange ?? setInternalVisibleColumnKeys
  const filteredDevices = useMemo(() => {
    return filterDevices(devices, resolvedSearchValue, resolvedStatusFilter)
  }, [devices, resolvedSearchValue, resolvedStatusFilter])
  const columns = useMemo(
    () =>
      createDeviceColumns({
        statusFilter: resolvedStatusFilter,
        onStatusFilterChange: handleStatusFilterChange
      }),
    [handleStatusFilterChange, resolvedStatusFilter]
  )

  return (
    <AdminListTable<RelayAdminDevice>
      ariaLabel='设备列表'
      className='relay-device-panel__table'
      columnOptions={deviceColumnOptions}
      columns={columns}
      dataSource={filteredDevices}
      emptyText='暂无设备'
      rowKey='id'
      searchPlaceholder={searchPlaceholder}
      searchValue={resolvedSearchValue}
      visibleColumnKeys={resolvedVisibleColumnKeys}
      onSearchChange={handleSearchChange}
      onVisibleColumnKeysChange={handleVisibleColumnKeysChange}
    />
  )
}
