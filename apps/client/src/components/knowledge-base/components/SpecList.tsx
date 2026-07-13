import './SpecList.scss'

import { List } from 'antd'
import { useTranslation } from 'react-i18next'

import type { SpecSummary } from '#~/api.js'
import { EmptyState } from './EmptyState'
import { LoadingState } from './LoadingState'
import { PaginatedKnowledgeList } from './PaginatedKnowledgeList'
import { SpecItem } from './SpecItem'

interface SpecListProps {
  currentPage: number
  isLoading: boolean
  specs: SpecSummary[]
  filteredSpecs: SpecSummary[]
  resetKey: string
  total: number
  onCreate?: () => void
  onPageChange: (page: number) => void
}

export function SpecList({
  currentPage,
  isLoading,
  specs,
  filteredSpecs,
  resetKey,
  total,
  onCreate,
  onPageChange
}: SpecListProps) {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className='knowledge-base-view__spec-list'>
        <LoadingState />
      </div>
    )
  }

  if (specs.length === 0) {
    return (
      <div className='knowledge-base-view__spec-list'>
        <EmptyState
          description={onCreate == null
            ? t('knowledge.filters.emptyScope')
            : t('knowledge.flows.empty')}
          actionLabel={onCreate == null ? undefined : t('knowledge.flows.create')}
          onAction={onCreate}
          variant={onCreate == null ? 'simple' : undefined}
        />
      </div>
    )
  }

  if (filteredSpecs.length === 0) {
    return (
      <div className='knowledge-base-view__spec-list'>
        <EmptyState
          description={t('knowledge.filters.noResults')}
          variant='simple'
        />
      </div>
    )
  }

  return (
    <div className='knowledge-base-view__spec-list'>
      <PaginatedKnowledgeList
        currentPage={currentPage}
        data={filteredSpecs}
        resetKey={resetKey}
        renderItem={(spec) => (
          <List.Item className='knowledge-base-view__list-item'>
            <SpecItem spec={spec} />
          </List.Item>
        )}
        total={total}
        onPageChange={onPageChange}
      />
    </div>
  )
}
