import './EntitiesTab.scss'

import React from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { EntitySummary } from '#~/api.js'
import type { RouteContainerHeaderActionItem } from '#~/components/layout/RouteContainerHeader'
import { EntityList } from './EntityList'
import { FilterBar } from './FilterBar'
import { SectionHeader } from './SectionHeader'
import { TabContent } from './TabContent'

interface EntitiesTabProps {
  entities: EntitySummary[]
  filteredEntities: EntitySummary[]
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

export function EntitiesTab({
  entities,
  filteredEntities,
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
}: EntitiesTabProps) {
  const { t } = useTranslation()
  const headerActionItems = React.useMemo<RouteContainerHeaderActionItem[]>(() => [
    {
      icon: 'refresh',
      key: 'knowledge-entities-refresh',
      label: t('knowledge.actions.refresh'),
      onSelect: () => void onRefresh()
    },
    {
      icon: 'download',
      key: 'knowledge-entities-import',
      label: t('knowledge.actions.import'),
      onSelect: onImport
    }
  ], [onImport, onRefresh, t])

  React.useEffect(() => {
    onHeaderActionsChange?.(headerActionItems)
  }, [headerActionItems, onHeaderActionsChange])
  React.useEffect(() => () => onHeaderActionsChange?.([]), [onHeaderActionsChange])

  return (
    <TabContent className='knowledge-base-view__entities-tab'>
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
      <EntityList
        isLoading={isLoading}
        entities={entities}
        filteredEntities={filteredEntities}
        onCreate={onCreate}
      />
    </TabContent>
  )
}
