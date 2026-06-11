import './RulesTab.scss'

import { Input } from 'antd'
import React from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { RouteContainerHeaderActionItem } from '@oneworks/components/route-layout'

import type { RuleSummary } from '#~/api.js'
import { RuleList } from './RuleList'
import { SectionHeader } from './SectionHeader'
import { TabContent } from './TabContent'

interface RulesTabProps {
  rules: RuleSummary[]
  filteredRules: RuleSummary[]
  hideContentSearch?: boolean
  isLoading: boolean
  leading?: ReactNode
  query: string
  onRefresh: () => void
  onQueryChange: (value: string) => void
  onCreate: () => void
  onHeaderActionsChange?: (items: RouteContainerHeaderActionItem[]) => void
  onImport: () => void
}

export function RulesTab({
  rules,
  filteredRules,
  hideContentSearch = false,
  isLoading,
  leading,
  query,
  onRefresh,
  onQueryChange,
  onCreate,
  onHeaderActionsChange,
  onImport
}: RulesTabProps) {
  const { t } = useTranslation()
  const headerActionItems = React.useMemo<RouteContainerHeaderActionItem[]>(() => [
    {
      icon: 'refresh',
      key: 'knowledge-rules-refresh',
      label: t('knowledge.actions.refresh'),
      onSelect: () => void onRefresh()
    },
    {
      icon: 'download',
      key: 'knowledge-rules-import',
      label: t('knowledge.actions.import'),
      onSelect: onImport
    }
  ], [onImport, onRefresh, t])

  React.useEffect(() => {
    onHeaderActionsChange?.(headerActionItems)
  }, [headerActionItems, onHeaderActionsChange])
  React.useEffect(() => () => onHeaderActionsChange?.([]), [onHeaderActionsChange])

  return (
    <TabContent className='knowledge-base-view__rules-tab'>
      <SectionHeader leading={leading} />
      {!hideContentSearch && (
        <div className='knowledge-base-view__filters'>
          <Input
            className='knowledge-base-view__filter-input'
            prefix={<span className='material-symbols-rounded knowledge-base-view__filter-icon'>search</span>}
            placeholder={t('knowledge.filters.search')}
            allowClear
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </div>
      )}
      <RuleList
        isLoading={isLoading}
        rules={rules}
        filteredRules={filteredRules}
        onCreate={onCreate}
      />
    </TabContent>
  )
}
