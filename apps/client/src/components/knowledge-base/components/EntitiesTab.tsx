import './EntitiesTab.scss'

import React from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { EntitySummary } from '#~/api.js'
import { ActionSearchToolbar } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import { EntityList } from './EntityList'
import { FilterBar } from './FilterBar'
import { KnowledgeScopeTabs } from './KnowledgeScopeTabs'
import { SectionHeader } from './SectionHeader'
import { TabContent } from './TabContent'
import { useKnowledgeAssetList } from './use-knowledge-asset-list'

interface EntitiesTabProps {
  entities: EntitySummary[]
  filteredEntities: EntitySummary[]
  isLoading: boolean
  leading?: ReactNode
  query: string
  tagOptions: Array<{ label: string; value: string }>
  tagFilter: string[]
  onQueryChange: (value: string) => void
  onTagFilterChange: (value: string[]) => void
  onCreate: () => void
  onImport: () => void
}

export function EntitiesTab({
  entities,
  filteredEntities,
  isLoading,
  leading,
  query,
  tagOptions,
  tagFilter,
  onQueryChange,
  onTagFilterChange,
  onCreate,
  onImport
}: EntitiesTabProps) {
  const { t } = useTranslation()
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const {
    changeScope,
    currentPage,
    pageResetKey,
    scope,
    scopedItems,
    setPage,
    total,
    visibleItems
  } = useKnowledgeAssetList(entities, filteredEntities, JSON.stringify([query, tagFilter]))

  return (
    <TabContent className='knowledge-base-view__entities-tab'>
      <SectionHeader leading={scope === 'project' ? leading : undefined} />
      <KnowledgeScopeTabs
        activeKey={scope}
        items={[
          { icon: 'folder', key: 'project', label: t('knowledge.scopes.project') },
          { icon: 'extension', key: 'plugin', label: t('knowledge.scopes.plugin') }
        ]}
        actionItems={scope === 'project'
          ? [{
            icon: 'download',
            key: 'knowledge-entities-import',
            label: t('knowledge.actions.import'),
            onSelect: onImport
          }]
          : []}
        onChange={changeScope}
      />
      <ActionSearchToolbar
        inset={false}
        query={query}
        placeholder={t('knowledge.filters.search')}
        actions={[{
          active: filtersOpen,
          ariaLabel: t('knowledge.filters.tags'),
          hasIndicator: tagFilter.length > 0,
          icon: 'filter_alt',
          key: 'knowledge-entities-filter',
          onClick: () => setFiltersOpen(value => !value),
          pressed: filtersOpen,
          title: t('knowledge.filters.tags')
        }]}
        onQueryChange={onQueryChange}
      />
      {filtersOpen && (
        <FilterBar
          className='knowledge-base-view__scope-filter-panel'
          tagOptions={tagOptions}
          tagFilter={tagFilter}
          tagsPlaceholder={t('knowledge.filters.tags')}
          onTagFilterChange={onTagFilterChange}
        />
      )}
      <EntityList
        currentPage={currentPage}
        isLoading={isLoading}
        entities={scopedItems}
        filteredEntities={visibleItems}
        resetKey={pageResetKey}
        total={total}
        onCreate={scope === 'project' ? onCreate : undefined}
        onPageChange={setPage}
      />
    </TabContent>
  )
}
