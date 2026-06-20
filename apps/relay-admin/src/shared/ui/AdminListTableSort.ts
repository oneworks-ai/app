import type { TableColumnsType } from 'antd'

export type AdminListSortOrder = 'ascend' | 'descend'

export interface AdminListSortState {
  columnKey: string
  order: AdminListSortOrder
}

export const sorterCompare = <T extends object>(column: TableColumnsType<T>[number] | undefined) => {
  const sorter = (column as { sorter?: unknown } | undefined)?.sorter
  if (typeof sorter === 'function') {
    return sorter as (left: T, right: T, order?: AdminListSortOrder) => number
  }
  if (sorter != null && typeof sorter === 'object') {
    const compare = (sorter as { compare?: unknown }).compare
    if (typeof compare === 'function') {
      return compare as (left: T, right: T, order?: AdminListSortOrder) => number
    }
  }
  return undefined
}

export const sortAdminListData = <T extends object>(
  dataSource: T[],
  columns: TableColumnsType<T>,
  sortState: AdminListSortState | undefined
) => {
  if (sortState == null) return dataSource
  const column = columns.find(item => item.key != null && String(item.key) === sortState.columnKey)
  const compare = sorterCompare(column)
  if (compare == null) return dataSource
  return [...dataSource].sort((left, right) => {
    const result = compare(left, right, sortState.order)
    return sortState.order === 'descend' ? -result : result
  })
}
