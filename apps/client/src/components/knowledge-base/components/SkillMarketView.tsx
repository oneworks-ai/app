import { Button, Empty, Spin, Tooltip } from 'antd'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { ActionSearchToolbar } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'
import { EmptyState } from './EmptyState'
import { SkillMarketResults } from './SkillMarketResults'
import type { SkillMarketViewProps } from './SkillMarketView.types'
import { SkillRegistryErrors } from './SkillRegistryErrors'
import { ALL_REGISTRIES, ALL_SKILL_SOURCES } from './skill-hub-utils'
import type { SkillHubInstallFilter, SkillHubSortKey } from './skill-hub-utils'

export function SkillMarketView({
  currentPage,
  hubItems,
  installingId,
  installFilter,
  isLoading,
  isPageLoading,
  pageSize,
  query,
  registries,
  registry,
  registryOptions,
  resetKey,
  sortKey,
  sourceFilter,
  sourceOptions,
  total,
  onAddRegistry,
  onInstall,
  onInstallFilterChange,
  onOpenSettings,
  onPageChange,
  onQueryChange,
  onRegistryChange,
  onSortChange,
  onSourceFilterChange
}: SkillMarketViewProps) {
  const { t } = useTranslation()
  const [actionsOpen, setActionsOpen] = React.useState(false)
  const hasRegistryFilter = registry !== ALL_REGISTRIES
  const hasSourceFilter = sourceFilter !== ALL_SKILL_SOURCES
  const hasInstallFilter = installFilter !== 'all'
  const hasSort = sortKey !== 'default'
  const hasActiveControls = hasRegistryFilter || hasSourceFilter || hasInstallFilter || hasSort
  const hasSearchCriteria = query.trim() !== '' || hasRegistryFilter || hasSourceFilter || hasInstallFilter
  const registryChevron = <span className='material-symbols-rounded knowledge-base-view__select-chevron'>
    expand_more
  </span>
  const installFilterOptions: Array<{ label: string; value: SkillHubInstallFilter }> = [
    { label: t('knowledge.skills.allStatuses'), value: 'all' },
    { label: t('knowledge.skills.installedOnly'), value: 'installed' },
    { label: t('knowledge.skills.notInstalled'), value: 'notInstalled' }
  ]
  const sortOptions: Array<{ label: string; value: SkillHubSortKey }> = [
    { label: t('knowledge.skills.sortDefault'), value: 'default' },
    { label: t('knowledge.skills.sortNameAsc'), value: 'nameAsc' },
    { label: t('knowledge.skills.sortNameDesc'), value: 'nameDesc' }
  ]

  return (
    <>
      <ActionSearchToolbar
        inset={false}
        query={query}
        placeholder={t('knowledge.skills.searchHub')}
        actions={[
          {
            active: actionsOpen,
            ariaLabel: t('knowledge.skills.marketActions'),
            hasIndicator: hasActiveControls,
            icon: 'filter_alt',
            key: 'knowledge-skill-market-filter',
            onClick: () => setActionsOpen(value => !value),
            pressed: actionsOpen,
            title: t('knowledge.skills.marketActions')
          },
          {
            ariaLabel: t('knowledge.skills.openConfig'),
            icon: 'tune',
            key: 'knowledge-skill-market-settings',
            onClick: onOpenSettings,
            title: t('knowledge.skills.openConfig')
          }
        ]}
        onQueryChange={onQueryChange}
      />
      <div className={`knowledge-base-view__skill-market-actions ${actionsOpen ? 'is-open' : ''}`}>
        <div className='knowledge-base-view__skill-market-actions-inner'>
          <div className='knowledge-base-view__skill-toolbar-field knowledge-base-view__skill-toolbar-field--wide'>
            <span className='material-symbols-rounded knowledge-base-view__toolbar-filter-icon'>source</span>
            <Select
              className='knowledge-base-view__skill-toolbar-select'
              aria-label={t('knowledge.skills.registryFilter')}
              value={registry}
              options={registryOptions}
              suffixIcon={registryChevron}
              onChange={onRegistryChange}
            />
          </div>
          <div className='knowledge-base-view__skill-toolbar-field knowledge-base-view__skill-toolbar-field--wide'>
            <span className='material-symbols-rounded knowledge-base-view__toolbar-filter-icon'>inventory_2</span>
            <Select
              className='knowledge-base-view__skill-toolbar-select'
              aria-label={t('knowledge.skills.sourceFilter')}
              value={sourceFilter}
              options={sourceOptions}
              suffixIcon={registryChevron}
              onChange={onSourceFilterChange}
            />
          </div>
          <div className='knowledge-base-view__skill-toolbar-field'>
            <span className='material-symbols-rounded knowledge-base-view__toolbar-filter-icon'>filter_list</span>
            <Select
              className='knowledge-base-view__skill-toolbar-select'
              aria-label={t('knowledge.skills.installFilter')}
              value={installFilter}
              options={installFilterOptions}
              suffixIcon={registryChevron}
              onChange={onInstallFilterChange}
            />
          </div>
          <div className='knowledge-base-view__skill-toolbar-field'>
            <span className='material-symbols-rounded knowledge-base-view__toolbar-filter-icon'>sort</span>
            <Select
              className='knowledge-base-view__skill-toolbar-select'
              aria-label={t('knowledge.skills.sort')}
              value={sortKey}
              options={sortOptions}
              suffixIcon={registryChevron}
              onChange={onSortChange}
            />
          </div>
          <Tooltip title={t('knowledge.skills.addRegistry')}>
            <Button
              className='knowledge-base-view__icon-button'
              type='text'
              onClick={onAddRegistry}
              icon={<span className='material-symbols-rounded'>add_link</span>}
            />
          </Tooltip>
        </div>
      </div>
      <SkillRegistryErrors registries={registries} />
      {isLoading && (
        <div className='knowledge-base-view__loading'>
          <Spin />
        </div>
      )}
      {!isLoading && hubItems.length > 0 && (
        <SkillMarketResults
          currentPage={currentPage}
          hubItems={hubItems}
          installingId={installingId}
          isPageLoading={isPageLoading}
          pageSize={pageSize}
          resetKey={resetKey}
          total={total}
          onInstall={onInstall}
          onPageChange={onPageChange}
        />
      )}
      {!isLoading && hubItems.length === 0 && registries.length > 0 && (
        <div className='knowledge-base-view__empty-simple'>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={hasSearchCriteria ? t('knowledge.filters.noResults') : t('knowledge.skills.emptyHub')}
          />
        </div>
      )}
      {!isLoading && hubItems.length === 0 && registries.length === 0 && (
        <EmptyState
          description={t('knowledge.skills.noRegistry')}
          actionLabel={t('knowledge.skills.addRegistry')}
          onAction={onAddRegistry}
        />
      )}
    </>
  )
}
