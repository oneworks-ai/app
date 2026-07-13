import './SkillsTab.scss'

import { App } from 'antd'
import React from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import type { RouteContainerHeaderActionItem } from '@oneworks/components/route-layout'
import type { ConfigResponse } from '@oneworks/types'

import type { SkillSummary } from '#~/api.js'
import { getConfig, listSkills } from '#~/api.js'
import { useSkillsTabActions } from './@hooks/use-skills-tab-actions'
import { ProjectSkillsList } from './ProjectSkillsList'
import { SectionHeader } from './SectionHeader'
import { SkillArchiveInput } from './SkillArchiveInput'
import { SkillMarketView } from './SkillMarketView'
import { SkillRegistryModal } from './SkillRegistryModal'
import { TabContent } from './TabContent'
import { ALL_REGISTRIES, ALL_SKILL_SOURCES } from './skill-hub-utils'
import type { SkillHubInstallFilter, SkillHubSortKey } from './skill-hub-utils'
import { buildSkillsTabHeaderActions } from './skills-tab-header-actions'
import { useSkillMarketSearch } from './use-skill-market-search'
import { useSkillRegistryModal } from './use-skill-registry-modal'

interface SkillsTabProps {
  leading?: ReactNode
  installFilter: SkillHubInstallFilter
  marketQuery: string
  projectQuery: string
  registry: string
  sortKey: SkillHubSortKey
  sourceFilter: string
  viewMode: 'project' | 'market'
  onRefresh: () => void | Promise<void>
  onCreate: () => void
  onHeaderActionsChange?: (items: RouteContainerHeaderActionItem[]) => void
  onInstallFilterChange: (value: SkillHubInstallFilter) => void
  onMarketQueryChange: (value: string) => void
  onOpenSettings: () => void
  onProjectQueryChange: (value: string) => void
  onRegistryChange: (value: string) => void
  onSortChange: (value: SkillHubSortKey) => void
  onSourceFilterChange: (value: string) => void
  onViewModeChange: (value: 'project' | 'market') => void
}

export function SkillsTab({
  leading,
  installFilter,
  marketQuery,
  projectQuery,
  registry,
  sortKey,
  sourceFilter,
  viewMode,
  onCreate,
  onHeaderActionsChange,
  onInstallFilterChange,
  onMarketQueryChange,
  onOpenSettings,
  onProjectQueryChange,
  onRegistryChange,
  onRefresh,
  onSortChange,
  onSourceFilterChange,
  onViewModeChange
}: SkillsTabProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const {
    data: skillsRes,
    isLoading: isSkillsLoading,
    mutate: mutateSkills
  } = useSWR<{ skills: SkillSummary[] }>('/api/ai/skills', listSkills)
  const { data: configRes, mutate: mutateConfig } = useSWR<ConfigResponse>('/api/config', getConfig)
  const marketSearch = useSkillMarketSearch({ installFilter, marketQuery, registry, sortKey, sourceFilter, viewMode })
  const registryModal = useSkillRegistryModal({
    configRes,
    existingRegistrySources: marketSearch.data?.registries.map(registry => registry.source),
    mutateConfig,
    mutateHub: marketSearch.mutate,
    setRegistry: onRegistryChange
  })
  const actionParams = React.useMemo(() => ({
    marketMutate: marketSearch.mutate,
    message,
    mutateConfig,
    mutateSkills,
    onRefresh,
    t
  }), [marketSearch.mutate, message, mutateConfig, mutateSkills, onRefresh, t])
  const actions = useSkillsTabActions(actionParams)

  const skills = skillsRes?.skills ?? []
  const registries = marketSearch.data?.registries ?? []
  const hubItems = marketSearch.data?.items ?? []
  const registryOptions = React.useMemo(() => [
    { label: t('knowledge.skills.allRegistries'), value: ALL_REGISTRIES },
    ...registries.filter(item => item.enabled).map(item => ({
      label: `${item.title != null && item.title.trim() !== '' ? item.title : item.name} · ${
        item.builtIn ? t('knowledge.skills.builtInRegistry') : item.configLabel
      }`,
      value: item.id
    }))
  ], [registries, t])
  const sourceOptions = React.useMemo(() => [
    { label: t('knowledge.skills.allSources'), value: ALL_SKILL_SOURCES },
    ...(marketSearch.data?.sources ?? []).map(source => ({ label: source, value: source }))
  ], [marketSearch.data?.sources, t])
  const headerActionItems = React.useMemo<RouteContainerHeaderActionItem[]>(() => (
    buildSkillsTabHeaderActions({
      navigateToSettings: onOpenSettings,
      onViewModeChange,
      t,
      viewMode
    })
  ), [onOpenSettings, onViewModeChange, t, viewMode])

  React.useEffect(() => {
    onHeaderActionsChange?.(headerActionItems)
  }, [headerActionItems, onHeaderActionsChange])
  React.useEffect(() => () => onHeaderActionsChange?.([]), [onHeaderActionsChange])

  return (
    <TabContent className='knowledge-base-view__skills-tab'>
      <SectionHeader leading={leading} />
      <SkillArchiveInput
        inputRef={actions.importInputRef}
        onSelect={(file) => void actions.handleImportArchive(file)}
      />
      {viewMode === 'project' && (
        <ProjectSkillsList
          isLoading={isSkillsLoading}
          importing={actions.importing}
          query={projectQuery}
          skills={skills}
          onCreate={onCreate}
          onImport={actions.triggerImport}
          onQueryChange={onProjectQueryChange}
        />
      )}
      {viewMode === 'market' && (
        <SkillMarketView
          currentPage={marketSearch.page}
          hubItems={hubItems}
          installingId={actions.installingId}
          installFilter={installFilter}
          isLoading={marketSearch.isLoading && hubItems.length === 0}
          isPageLoading={marketSearch.isValidating}
          pageSize={marketSearch.pageSize}
          query={marketQuery}
          registries={registries}
          registry={registry}
          registryOptions={registryOptions}
          sortKey={sortKey}
          sourceFilter={sourceFilter}
          sourceOptions={sourceOptions}
          total={marketSearch.data?.total ?? 0}
          onAddRegistry={registryModal.openModal}
          onInstall={actions.handleInstall}
          onInstallFilterChange={onInstallFilterChange}
          onOpenSettings={onOpenSettings}
          onPageChange={marketSearch.setPage}
          onQueryChange={onMarketQueryChange}
          onRegistryChange={onRegistryChange}
          resetKey={marketSearch.resetKey}
          onSortChange={onSortChange}
          onSourceFilterChange={onSourceFilterChange}
        />
      )}
      <SkillRegistryModal
        open={registryModal.open}
        saving={registryModal.saving}
        form={registryModal.form}
        onSave={() => void registryModal.save()}
        onClose={registryModal.close}
      />
    </TabContent>
  )
}
