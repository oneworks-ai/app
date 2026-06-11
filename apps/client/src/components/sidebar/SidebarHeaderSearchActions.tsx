import { Button, Tooltip } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { SidebarListSearchInput } from '#~/components/sidebar-list/SidebarListHeader'
import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'
import type { SidebarSessionSortOrder } from '#~/hooks/use-sidebar-query-state'
import { SidebarHeaderBatchActions } from './SidebarHeaderBatchActions'
import { SidebarHeaderSelectField } from './SidebarHeaderSelectField'

interface SidebarHeaderSearchActionsProps {
  adapterFilters: string[]
  availableAdapters: string[]
  availableTags: string[]
  canBatchDelete: boolean
  hasActiveSearchControls: boolean
  isBatchMode: boolean
  searchQuery: string
  selectedCount: number
  shouldShowSearchActions: boolean
  sortOrder: SidebarSessionSortOrder
  sortSelection?: SidebarSessionSortOrder
  tagFilters: string[]
  totalCount: number
  onAdapterFilterChange: (filters: string[]) => void
  onBatchArchive: () => void
  onBatchDelete: () => void
  onBatchStar: () => void
  onSearchChange: (query: string) => void
  onSortOrderChange: (sort?: SidebarSessionSortOrder) => void
  onSelectAll: (selected: boolean) => void
  onTagFilterChange: (tags: string[]) => void
  onToggleBatchMode: () => void
  onToggleSearchActions: () => void
}

export function SidebarHeaderSearchActions({
  adapterFilters,
  availableAdapters,
  availableTags,
  canBatchDelete,
  hasActiveSearchControls,
  isBatchMode,
  searchQuery,
  selectedCount,
  shouldShowSearchActions,
  sortOrder,
  sortSelection,
  tagFilters,
  totalCount,
  onAdapterFilterChange,
  onBatchArchive,
  onBatchDelete,
  onBatchStar,
  onSearchChange,
  onSortOrderChange,
  onSelectAll,
  onTagFilterChange,
  onToggleBatchMode,
  onToggleSearchActions
}: SidebarHeaderSearchActionsProps) {
  const { t } = useTranslation()
  const { isTouchInteraction } = useResponsiveLayout()
  const isAllSelected = totalCount > 0 && selectedCount === totalCount
  const toOptions = useMemo(() => (values: string[]) => values.map((value) => ({ label: value, value })), [])
  const filterSuffixIcon = <MaterialSymbol className='toolbar-filter-chevron' name='expand_more' />
  const resolveTooltipTitle = (title: string) => isTouchInteraction ? undefined : title
  const sortOptions = useMemo(
    () => [
      { label: t('automation.sortDesc'), value: 'desc' },
      { label: t('automation.sortAsc'), value: 'asc' }
    ],
    [t]
  )

  return (
    <>
      <div className='header-search-row'>
        <div className='search-input-wrap'>
          <SidebarListSearchInput
            className='search-input'
            placeholder={t('common.search')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            suffix={
              <Tooltip title={resolveTooltipTitle(t('common.searchActions'))}>
                <button
                  type='button'
                  className={`search-toggle-button ${shouldShowSearchActions ? 'is-open' : ''} ${
                    hasActiveSearchControls ? 'has-active-filters' : ''
                  }`}
                  aria-label={t('common.searchActions')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onToggleSearchActions}
                >
                  <MaterialSymbol className='search-toggle-icon' name='tune' />
                </button>
              </Tooltip>
            }
            allowClear
          />
        </div>
      </div>
      <div className={`header-search-actions ${shouldShowSearchActions ? 'is-open' : ''}`}>
        <div className='header-search-actions-inner'>
          <div className='header-toolbar-row'>
            <div className='header-toolbar-leading'>
              {isBatchMode
                ? (
                  <Tooltip title={resolveTooltipTitle(t('common.cancelBatch'))}>
                    <Button
                      className='sidebar-tool-btn is-icon-only'
                      type='text'
                      onClick={onToggleBatchMode}
                      icon={<MaterialSymbol name='close' />}
                    />
                  </Tooltip>
                )
                : (
                  <Tooltip title={resolveTooltipTitle(t('common.batchMode'))}>
                    <Button
                      className='sidebar-tool-btn is-icon-only'
                      type='text'
                      onClick={onToggleBatchMode}
                      icon={<MaterialSymbol name='checklist' />}
                    />
                  </Tooltip>
                )}
            </div>
            <div className='header-filter-stack'>
              <SidebarHeaderSelectField
                icon='sell'
                mode='tags'
                placeholder={t('common.allTags')}
                options={toOptions(availableTags)}
                value={tagFilters}
                onChange={(value) => onTagFilterChange(value as string[])}
                maxTagCount={1}
                allowClear
                suffixIcon={filterSuffixIcon}
                tokenSeparators={[',']}
              />
              <SidebarHeaderSelectField
                icon='extension'
                mode='tags'
                placeholder={t('common.allAdapters')}
                options={toOptions(availableAdapters)}
                value={adapterFilters}
                onChange={(value) => onAdapterFilterChange(value as string[])}
                maxTagCount={1}
                allowClear
                suffixIcon={filterSuffixIcon}
                tokenSeparators={[',']}
              />
              <SidebarHeaderSelectField
                icon='swap_vert'
                placeholder={t('common.sort')}
                options={sortOptions}
                value={sortSelection}
                onChange={(value) => onSortOrderChange(value as SidebarSessionSortOrder | undefined)}
                allowClear
                suffixIcon={filterSuffixIcon}
              />
            </div>
          </div>
          {isBatchMode && (
            <SidebarHeaderBatchActions
              isAllSelected={isAllSelected}
              selectedCount={selectedCount}
              totalCount={totalCount}
              canBatchDelete={canBatchDelete}
              onBatchArchive={onBatchArchive}
              onBatchDelete={onBatchDelete}
              onBatchStar={onBatchStar}
              onSelectAll={onSelectAll}
            />
          )}
        </div>
      </div>
    </>
  )
}
