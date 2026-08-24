import './ConfigRecordCollection.scss'

import type { ReactNode } from 'react'

import { ActionSearchToolbar } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import type { ActionSearchToolbarAction } from '#~/components/action-search-toolbar/ActionSearchToolbar'

import { ConfigRecordList } from './ConfigRecordList'

const cx = (...classes: Array<string | false | null | undefined>) => (
  classes.filter(Boolean).join(' ')
)

export const normalizeConfigRecordSearch = (value: unknown) => (
  typeof value === 'string' ? value.trim().toLocaleLowerCase() : ''
)

export const matchesConfigRecordSearch = (query: string, ...values: unknown[]) => {
  const normalizedQuery = normalizeConfigRecordSearch(query)
  return normalizedQuery === '' || values.some(value => (
    normalizeConfigRecordSearch(value).includes(normalizedQuery)
  ))
}

export const ConfigRecordCollection = ({
  actions = [],
  children,
  className,
  createContent,
  emptyText,
  gridClassName,
  hasVisibleItems,
  noMatchesText,
  onQueryChange,
  query,
  searchPlaceholder
}: {
  actions?: ActionSearchToolbarAction[]
  children: ReactNode
  className?: string
  createContent?: ReactNode
  emptyText: ReactNode
  gridClassName?: string
  hasVisibleItems: boolean
  noMatchesText?: ReactNode
  onQueryChange: (query: string) => void
  query: string
  searchPlaceholder: string
}) => {
  const hasQuery = normalizeConfigRecordSearch(query) !== ''

  return (
    <div className={cx('config-record-collection', className)}>
      <ActionSearchToolbar
        className='config-record-collection__toolbar'
        inset={false}
        placeholder={searchPlaceholder}
        query={query}
        onQueryChange={onQueryChange}
        actions={actions}
      />

      {createContent != null && (
        <div className='config-record-collection__create'>
          {createContent}
        </div>
      )}

      <ConfigRecordList className={cx('config-record-collection__grid', gridClassName)}>
        {children}
        {!hasVisibleItems && (
          <div className='config-view__detail-list-empty config-record-collection__empty'>
            <div className='config-view__detail-list-empty-desc'>
              {hasQuery ? (noMatchesText ?? emptyText) : emptyText}
            </div>
          </div>
        )}
      </ConfigRecordList>
    </div>
  )
}
