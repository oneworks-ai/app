import './RuleList.scss'

import { List } from 'antd'
import { useTranslation } from 'react-i18next'

import type { RuleSummary } from '#~/api.js'
import { EmptyState } from './EmptyState'
import { LoadingState } from './LoadingState'
import { PaginatedKnowledgeList } from './PaginatedKnowledgeList'
import { RuleItem } from './RuleItem'

interface RuleListProps {
  currentPage: number
  isLoading: boolean
  rules: RuleSummary[]
  filteredRules: RuleSummary[]
  resetKey: string
  total: number
  onCreate?: () => void
  onPageChange: (page: number) => void
}

export function RuleList({
  currentPage,
  isLoading,
  rules,
  filteredRules,
  resetKey,
  total,
  onCreate,
  onPageChange
}: RuleListProps) {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className='knowledge-base-view__rule-list'>
        <LoadingState />
      </div>
    )
  }

  if (rules.length === 0) {
    return (
      <div className='knowledge-base-view__rule-list'>
        <EmptyState
          description={onCreate == null
            ? t('knowledge.filters.emptyScope')
            : t('knowledge.rules.empty')}
          actionLabel={onCreate == null ? undefined : t('knowledge.rules.create')}
          onAction={onCreate}
          variant={onCreate == null ? 'simple' : undefined}
        />
      </div>
    )
  }

  if (filteredRules.length === 0) {
    return (
      <div className='knowledge-base-view__rule-list'>
        <EmptyState
          description={t('knowledge.filters.noResults')}
          variant='simple'
        />
      </div>
    )
  }

  return (
    <div className='knowledge-base-view__rule-list'>
      <PaginatedKnowledgeList
        currentPage={currentPage}
        data={filteredRules}
        resetKey={resetKey}
        renderItem={(rule) => (
          <List.Item className='knowledge-base-view__list-item'>
            <RuleItem rule={rule} />
          </List.Item>
        )}
        total={total}
        onPageChange={onPageChange}
      />
    </div>
  )
}
