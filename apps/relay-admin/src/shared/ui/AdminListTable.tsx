import './AdminListTable.css'

import { Checkbox, Input, Pagination, Popover, Table } from 'antd'
import type { TableColumnsType, TableProps } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { Key, ReactNode } from 'react'

import { AdminActionButton } from './AdminActionButton'
import { AdminIcon } from './AdminIcon'

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
  visibleColumnKeys,
  onSearchChange,
  onSelectedRowKeysChange,
  onVisibleColumnKeysChange
}: AdminListTableProps<T>) => {
  const [isColumnPickerOpen, setIsColumnPickerOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
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
      columns.filter(column => {
        if (column.key == null) return true
        const key = String(column.key)
        return key === 'actions' || resolvedVisibleColumnKeys.has(key)
      }),
    [columns, resolvedVisibleColumnKeys]
  )
  const pageData = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return dataSource.slice(start, start + pageSize)
  }, [currentPage, dataSource, pageSize])
  const hasSelection = selectedRowKeys.length > 0
  const columnPicker = (
    <div className='relay-admin-list-table__column-menu' role='group' aria-label='展示列'>
      {columnOptions.map(option => (
        <Checkbox
          key={option.key}
          checked={resolvedVisibleColumnKeys.has(option.key)}
          disabled={option.required}
          onChange={event => {
            const nextKeys = event.target.checked
              ? [...visibleColumnKeys, option.key]
              : visibleColumnKeys.filter(key => key !== option.key)
            onVisibleColumnKeysChange(Array.from(new Set([...requiredColumnKeys, ...nextKeys])))
          }}
        >
          {option.label}
        </Checkbox>
      ))}
    </div>
  )

  useEffect(() => {
    setCurrentPage(page => Math.min(page, maxPage))
  }, [maxPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [dataSource, pageSize, searchValue])

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
        <Popover
          content={columnPicker}
          open={isColumnPickerOpen}
          overlayClassName='relay-admin-list-table__column-popover'
          placement='bottomRight'
          trigger='click'
          onOpenChange={setIsColumnPickerOpen}
        >
          <AdminActionButton
            aria-label='配置展示列'
            className={[
              'route-container-header__action-button',
              'relay-admin-list-table__column-trigger',
              isColumnPickerOpen ? 'is-active' : ''
            ].filter(Boolean).join(' ')}
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
        />
      </div>
      <div className='relay-admin-list-table__pagination'>
        <span className='relay-admin-list-table__pagination-summary'>
          共 {dataSource.length} 条
        </span>
        <Pagination
          current={Math.min(currentPage, maxPage)}
          pageSize={pageSize}
          pageSizeOptions={[10, 20, 50]}
          showSizeChanger={false}
          size='small'
          total={dataSource.length}
          onChange={(page, nextPageSize) => {
            setCurrentPage(page)
            setPageSize(nextPageSize)
          }}
        />
      </div>
    </div>
  )
}
