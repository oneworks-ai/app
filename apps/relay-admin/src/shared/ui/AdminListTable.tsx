import './AdminListTable.css'

import { Input, Popover, Table } from 'antd'
import type { TableColumnsType, TableProps } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { Key, ReactNode } from 'react'

import { AdminActionButton } from './AdminActionButton'
import { AdminIcon } from './AdminIcon'
import { AdminListTableColumnPicker } from './AdminListTableColumnPicker'
import { AdminListTablePagination } from './AdminListTablePagination'
import { sortAdminListData, sorterCompare } from './AdminListTableSort'
import type { AdminListSortOrder, AdminListSortState } from './AdminListTableSort'

export interface AdminListColumnOption {
  key: string
  label: string
  required?: boolean
}

export interface AdminListTableProps<T extends object> {
  ariaLabel: string
  batchActions?: ReactNode
  className?: string
  columnOptions: AdminListColumnOption[]
  columns: TableColumnsType<T>
  dataSource: T[]
  emptyText: string
  rowKey: TableProps<T>['rowKey']
  searchPlaceholder: string
  searchValue: string
  selectedRowKeys?: Key[]
  toolbarActions?: ReactNode
  visibleColumnKeys: string[]
  onSearchChange: (value: string) => void
  onSelectedRowKeysChange?: (keys: Key[]) => void
  onVisibleColumnKeysChange: (keys: string[]) => void
}

const DEFAULT_PAGE_SIZE = 20

export const AdminListTable = <T extends object>({
  ariaLabel,
  batchActions,
  className,
  columnOptions,
  columns,
  dataSource,
  emptyText,
  rowKey,
  searchPlaceholder,
  searchValue,
  selectedRowKeys = [],
  toolbarActions,
  visibleColumnKeys,
  onSearchChange,
  onSelectedRowKeysChange,
  onVisibleColumnKeysChange
}: AdminListTableProps<T>) => {
  const [isColumnPickerOpen, setIsColumnPickerOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [sortState, setSortState] = useState<AdminListSortState | undefined>()
  const maxPage = Math.max(1, Math.ceil(dataSource.length / pageSize))
  const requiredColumnKeys = useMemo(
    () => columnOptions.filter(option => option.required).map(option => option.key),
    [columnOptions]
  )
  const resolvedVisibleColumnKeys = useMemo(
    () => new Set([...requiredColumnKeys, ...visibleColumnKeys]),
    [requiredColumnKeys, visibleColumnKeys]
  )
  const visibleColumns = useMemo(
    () =>
      columns
        .filter(column => {
          if (column.key == null) return true
          const key = String(column.key)
          return key === 'actions' || resolvedVisibleColumnKeys.has(key)
        })
        .map(column => {
          if (column.key == null || sorterCompare(column) == null) return column
          const key = String(column.key)
          return {
            ...column,
            sortOrder: sortState?.columnKey === key ? sortState.order : undefined
          }
        }),
    [columns, resolvedVisibleColumnKeys, sortState]
  )
  const sortedData = useMemo(() => sortAdminListData(dataSource, columns, sortState), [columns, dataSource, sortState])
  const handleTableChange: TableProps<T>['onChange'] = (_pagination, _filters, sorter) => {
    const sorters = Array.isArray(sorter) ? sorter : [sorter]
    const activeSorter = sorters.find(item => item.order != null && item.columnKey != null)
    if (activeSorter?.order == null || activeSorter.columnKey == null) {
      setSortState(undefined)
      return
    }
    setSortState({
      columnKey: String(activeSorter.columnKey),
      order: activeSorter.order as AdminListSortOrder
    })
  }
  const pageData = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return sortedData.slice(start, start + pageSize)
  }, [currentPage, pageSize, sortedData])
  const hasSelection = selectedRowKeys.length > 0

  useEffect(() => {
    setCurrentPage(page => Math.min(page, maxPage))
  }, [maxPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [dataSource, pageSize, searchValue, sortState])

  return (
    <div className='relay-admin-list-table' aria-label={ariaLabel}>
      <div className='relay-admin-list-table__toolbar'>
        <Input
          allowClear
          className='relay-admin-list-table__search'
          placeholder={searchPlaceholder}
          prefix={<AdminIcon className='relay-admin-list-table__search-icon' name='search' />}
          value={searchValue}
          onChange={event => onSearchChange(event.target.value)}
        />
        {toolbarActions == null
          ? null
          : <div className='relay-admin-list-table__toolbar-actions'>{toolbarActions}</div>}
        <Popover
          content={
            <AdminListTableColumnPicker
              columnOptions={columnOptions}
              requiredColumnKeys={requiredColumnKeys}
              resolvedVisibleColumnKeys={resolvedVisibleColumnKeys}
              visibleColumnKeys={visibleColumnKeys}
              onVisibleColumnKeysChange={onVisibleColumnKeysChange}
            />
          }
          open={isColumnPickerOpen}
          overlayClassName='relay-admin-list-table__column-popover'
          placement='bottomRight'
          trigger='click'
          onOpenChange={setIsColumnPickerOpen}
        >
          <AdminActionButton
            aria-label='配置展示列'
            className={`route-container-header__action-button relay-admin-list-table__column-trigger${
              isColumnPickerOpen ? ' is-active' : ''
            }`}
            iconName='view_week'
            title='配置展示列'
            type='text'
          />
        </Popover>
      </div>
      {onSelectedRowKeysChange == null || !hasSelection ? null : (
        <div className='relay-admin-list-table__batch'>
          <span className='relay-admin-list-table__selected-count'>已选 {selectedRowKeys.length}</span>
          {batchActions}
        </div>
      )}
      <div className='relay-admin-list-table__table-scroll'>
        <Table<T>
          className={['relay-admin-table', className].filter(Boolean).join(' ')}
          columns={visibleColumns}
          dataSource={pageData}
          locale={{ emptyText }}
          pagination={false}
          rowKey={rowKey}
          rowSelection={onSelectedRowKeysChange == null
            ? undefined
            : {
              columnWidth: 32,
              selectedRowKeys,
              onChange: keys => onSelectedRowKeysChange(keys)
            }}
          scroll={{ x: 'max-content' }}
          size='middle'
          onChange={handleTableChange}
        />
      </div>
      <AdminListTablePagination
        currentPage={currentPage}
        maxPage={maxPage}
        pageSize={pageSize}
        total={dataSource.length}
        onChange={(page, nextPageSize) => {
          setCurrentPage(page)
          setPageSize(nextPageSize)
        }}
      />
    </div>
  )
}
