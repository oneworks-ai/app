import './EntityList.scss'

import { List } from 'antd'
import { useTranslation } from 'react-i18next'

import type { EntitySummary } from '#~/api.js'
import { EmptyState } from './EmptyState'
import { EntityItem } from './EntityItem'
import { LoadingState } from './LoadingState'
import { PaginatedKnowledgeList } from './PaginatedKnowledgeList'

interface EntityListProps {
  currentPage: number
  isLoading: boolean
  entities: EntitySummary[]
  filteredEntities: EntitySummary[]
  resetKey: string
  total: number
  onCreate?: () => void
  onPageChange: (page: number) => void
}

export function EntityList({
  currentPage,
  isLoading,
  entities,
  filteredEntities,
  resetKey,
  total,
  onCreate,
  onPageChange
}: EntityListProps) {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className='knowledge-base-view__entity-list'>
        <LoadingState />
      </div>
    )
  }

  if (entities.length === 0) {
    return (
      <div className='knowledge-base-view__entity-list'>
        <EmptyState
          description={onCreate == null
            ? t('knowledge.filters.emptyScope')
            : t('knowledge.entities.empty')}
          actionLabel={onCreate == null ? undefined : t('knowledge.entities.create')}
          onAction={onCreate}
          variant={onCreate == null ? 'simple' : undefined}
        />
      </div>
    )
  }

  if (filteredEntities.length === 0) {
    return (
      <div className='knowledge-base-view__entity-list'>
        <EmptyState
          description={t('knowledge.filters.noResults')}
          variant='simple'
        />
      </div>
    )
  }

  return (
    <div className='knowledge-base-view__entity-list'>
      <PaginatedKnowledgeList
        currentPage={currentPage}
        data={filteredEntities}
        resetKey={resetKey}
        renderItem={(entity) => (
          <List.Item className='knowledge-base-view__list-item'>
            <EntityItem entity={entity} />
          </List.Item>
        )}
        total={total}
        onPageChange={onPageChange}
      />
    </div>
  )
}
