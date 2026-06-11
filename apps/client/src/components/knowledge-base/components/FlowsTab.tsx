import './FlowsTab.scss'

import React from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { RouteContainerHeaderActionItem } from '@oneworks/components/route-layout'

import type { SpecSummary } from '#~/api.js'
import { FilterBar } from './FilterBar'
import { SectionHeader } from './SectionHeader'
import { SpecList } from './SpecList'
import { TabContent } from './TabContent'

interface FlowsTabProps {
  specs: SpecSummary[]
  filteredSpecs: SpecSummary[]
  hideContentSearch?: boolean
  isLoading: boolean
  leading?: ReactNode
  query: string
  tagOptions: Array<{ label: string; value: string }>
  tagFilter: string[]
  onRefresh: () => void
  onQueryChange: (value: string) => void
  onTagFilterChange: (value: string[]) => void
  onCreate: () => void
  onHeaderActionsChange?: (items: RouteContainerHeaderActionItem[]) => void
  onImport: () => void
}

export function FlowsTab({
  specs,
  filteredSpecs,
  hideContentSearch = false,
  isLoading,
  leading,
  query,
  tagOptions,
  tagFilter,
  onRefresh,
  onQueryChange,
  onTagFilterChange,
  onCreate,
  onHeaderActionsChange,
  onImport
}: FlowsTabProps) {
  const { t } = useTranslation()
  const headerActionItems = React.useMemo<RouteContainerHeaderActionItem[]>(() => [
    {
      icon: 'refresh',
      key: 'knowledge-flows-refresh',
      label: t('knowledge.actions.refresh'),
      onSelect: () => void onRefresh()
    },
    {
      icon: 'download',
      key: 'knowledge-flows-import',
      label: t('knowledge.actions.import'),
      onSelect: onImport
    }
  ], [onImport, onRefresh, t])

  React.useEffect(() => {
    onHeaderActionsChange?.(headerActionItems)
  }, [headerActionItems, onHeaderActionsChange])
  React.useEffect(() => () => onHeaderActionsChange?.([]), [onHeaderActionsChange])

  return (
    <TabContent className='knowledge-base-view__flows-tab'>
      <SectionHeader leading={leading} />
      <FilterBar
        hideSearch={hideContentSearch}
        query={query}
        tagOptions={tagOptions}
        tagFilter={tagFilter}
        searchPlaceholder={t('knowledge.filters.search')}
        tagsPlaceholder={t('knowledge.filters.tags')}
        onQueryChange={onQueryChange}
        onTagFilterChange={onTagFilterChange}
      />
      <SpecList
        isLoading={isLoading}
        specs={specs}
        filteredSpecs={filteredSpecs}
        onCreate={onCreate}
      />
    </TabContent>
  )
}
