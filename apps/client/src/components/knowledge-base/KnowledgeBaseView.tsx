import './KnowledgeBaseView.scss'

import { App, Form } from 'antd'
import React from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import type { RouteContainerHeaderActionItem, RouteContainerHeaderBreadcrumb } from '@oneworks/components/route-layout'

import { createSkill, getApiErrorMessage } from '#~/api.js'
import type { EntitySummary, RuleSummary, SkillSummary, SpecSummary } from '#~/api.js'
import { RouteContainerHeader } from '#~/components/layout/RouteContainerHeader'
import { RouteContainerLayout } from '#~/components/layout/RouteContainerLayout'
import { useRouteSidebar } from '#~/components/layout/route-sidebar-context'
import type { RouteSidebarListItem } from '#~/components/layout/route-sidebar-context'
import { useRouteContainerSidebarOpener } from '#~/components/layout/use-route-container-sidebar-opener'
import { useQueryParams } from '#~/hooks/useQueryParams.js'
import { useRoutePluginChrome } from '#~/plugins/route-plugin-chrome'
import { CreateSkillModal } from './components/CreateSkillModal.js'
import type { CreateSkillFormValues } from './components/CreateSkillModal.js'
import { EntitiesTab } from './components/EntitiesTab.js'
import { FlowsTab } from './components/FlowsTab.js'
import { KnowledgeContentControls } from './components/KnowledgeContentControls.js'
import { RulesTab } from './components/RulesTab.js'
import { SkillRegistrySettingsView } from './components/SkillRegistrySettingsView.js'
import { SkillsTab } from './components/SkillsTab.js'
import {
  ALL_REGISTRIES,
  ALL_SKILL_SOURCES,
  isSkillHubInstallFilter,
  isSkillHubSortKey
} from './components/skill-hub-utils.js'
import type { SkillHubInstallFilter, SkillHubSortKey } from './components/skill-hub-utils.js'
import type { KnowledgeSectionKey, KnowledgeSkillPage } from './knowledge-routes.js'

interface KnowledgeQueryParams extends Record<string, string> {
  skillInstall: string
  skillMarketSearch: string
  skillProjectSearch: string
  skillRegistry: string
  skillRegistrySettingsSearch: string
  skillSort: string
  skillSource: string
}

const KNOWLEDGE_QUERY_KEYS: Array<Extract<keyof KnowledgeQueryParams, string>> = [
  'skillProjectSearch',
  'skillMarketSearch',
  'skillRegistry',
  'skillRegistrySettingsSearch',
  'skillSource',
  'skillInstall',
  'skillSort'
]

const KNOWLEDGE_QUERY_DEFAULTS: Partial<KnowledgeQueryParams> = {
  skillProjectSearch: '',
  skillMarketSearch: '',
  skillRegistry: ALL_REGISTRIES,
  skillRegistrySettingsSearch: '',
  skillSource: ALL_SKILL_SOURCES,
  skillInstall: 'all',
  skillSort: 'default'
}

const KNOWLEDGE_QUERY_OMIT: Partial<Record<Extract<keyof KnowledgeQueryParams, string>, (value: string) => boolean>> = {
  skillProjectSearch: value => value === '',
  skillMarketSearch: value => value === '',
  skillRegistry: value => value === ALL_REGISTRIES,
  skillRegistrySettingsSearch: value => value === '',
  skillSource: value => value === ALL_SKILL_SOURCES,
  skillInstall: value => value === 'all',
  skillSort: value => value === 'default'
}

const toSkillHubInstallFilter = (value: string): SkillHubInstallFilter => (
  isSkillHubInstallFilter(value) ? value : 'all'
)
const toSkillHubSortKey = (value: string): SkillHubSortKey => (
  isSkillHubSortKey(value) ? value : 'default'
)

interface KnowledgeBaseViewProps {
  sectionKey: KnowledgeSectionKey
  skillPage: KnowledgeSkillPage
  onBack: () => void
  onNavigateSection: (sectionKey: KnowledgeSectionKey) => void
  onNavigateSkillPage: (skillPage: KnowledgeSkillPage) => void
}

export function KnowledgeBaseView({
  sectionKey,
  skillPage,
  onBack,
  onNavigateSection,
  onNavigateSkillPage
}: KnowledgeBaseViewProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const {
    closeRouteSidebar,
    isCompactView,
    isSidebarCollapsed,
    openRouteSidebar
  } = useRouteContainerSidebarOpener()
  const { clearRouteSidebar, hasRouteSidebarProvider, setRouteSidebar } = useRouteSidebar()
  const {
    headerActions: routePluginHeaderActions,
    sidebarContextMenuItems: routePluginSidebarContextMenu
  } = useRoutePluginChrome('knowledge')
  const {
    data: specsRes,
    isLoading: isSpecsLoading,
    mutate: mutateSpecs
  } = useSWR<{ specs: SpecSummary[] }>('/api/ai/specs')
  const {
    data: entitiesRes,
    isLoading: isEntitiesLoading,
    mutate: mutateEntities
  } = useSWR<{ entities: EntitySummary[] }>('/api/ai/entities')
  const {
    data: rulesRes,
    isLoading: isRulesLoading,
    mutate: mutateRules
  } = useSWR<{ rules: RuleSummary[] }>('/api/ai/rules')
  const {
    data: skillsRes,
    mutate: mutateSkills
  } = useSWR<{ skills: SkillSummary[] }>('/api/ai/skills')

  const specs = specsRes?.specs ?? []
  const entities = entitiesRes?.entities ?? []
  const rules = rulesRes?.rules ?? []

  const [specQuery, setSpecQuery] = React.useState('')
  const [specTagFilter, setSpecTagFilter] = React.useState<string[]>([])
  const [entityQuery, setEntityQuery] = React.useState('')
  const [entityTagFilter, setEntityTagFilter] = React.useState<string[]>([])
  const [ruleQuery, setRuleQuery] = React.useState('')
  const [createSkillOpen, setCreateSkillOpen] = React.useState(false)
  const [savingSkill, setSavingSkill] = React.useState(false)
  const [contentHeaderActions, setContentHeaderActions] = React.useState<RouteContainerHeaderActionItem[]>([])
  const [createSkillForm] = Form.useForm<CreateSkillFormValues>()

  const { values, update } = useQueryParams<KnowledgeQueryParams>({
    keys: KNOWLEDGE_QUERY_KEYS,
    defaults: KNOWLEDGE_QUERY_DEFAULTS,
    omit: KNOWLEDGE_QUERY_OMIT
  })
  const skillViewMode = skillPage === 'store' ? 'market' : 'project'
  const skillInstallFilter = toSkillHubInstallFilter(values.skillInstall)
  const skillSortKey = toSkillHubSortKey(values.skillSort)
  const skillProjectQuery = values.skillProjectSearch
  const skillMarketQuery = values.skillMarketSearch
  const skillRegistry = values.skillRegistry || ALL_REGISTRIES
  const skillRegistrySettingsQuery = values.skillRegistrySettingsSearch
  const skillSourceFilter = values.skillSource || ALL_SKILL_SOURCES
  const updateSkillProjectQuery = React.useCallback((value: string) => {
    update({ skillProjectSearch: value })
  }, [update])
  const updateSkillViewMode = React.useCallback((value: 'project' | 'market') => {
    onNavigateSkillPage(value === 'market' ? 'store' : 'project')
  }, [onNavigateSkillPage])
  const updateSkillMarketQuery = React.useCallback((value: string) => {
    update({ skillMarketSearch: value })
  }, [update])
  const updateSkillRegistry = React.useCallback((value: string) => {
    update({ skillRegistry: value })
  }, [update])
  const updateSkillRegistrySettingsQuery = React.useCallback((value: string) => {
    update({ skillRegistrySettingsSearch: value })
  }, [update])
  const updateSkillSourceFilter = React.useCallback((value: string) => {
    update({ skillSource: value })
  }, [update])
  const updateSkillInstallFilter = React.useCallback((value: SkillHubInstallFilter) => {
    update({ skillInstall: value })
  }, [update])
  const updateSkillSortKey = React.useCallback((value: SkillHubSortKey) => {
    update({ skillSort: value })
  }, [update])

  const specTagOptions = React.useMemo(() => {
    const tags = new Set<string>()
    specs.forEach(spec => {
      spec.tags?.forEach(tag => tags.add(tag))
    })
    return Array.from(tags).sort().map(tag => ({ label: tag, value: tag }))
  }, [specs])

  const entityTagOptions = React.useMemo(() => {
    const tags = new Set<string>()
    entities.forEach(entity => {
      entity.tags?.forEach(tag => tags.add(tag))
    })
    return Array.from(tags).sort().map(tag => ({ label: tag, value: tag }))
  }, [entities])

  const filteredSpecs = React.useMemo(() => {
    const query = specQuery.trim().toLowerCase()
    return specs.filter(spec => {
      const tags = spec.tags ?? []
      if (specTagFilter.length > 0 && !specTagFilter.every(tag => tags.includes(tag))) return false
      if (query === '') return true
      const paramsText = spec.params.map(param => `${param.name} ${param.description ?? ''}`).join(' ')
      const tagsText = tags.join(' ')
      const skillsText = (spec.skills ?? []).join(' ')
      const rulesText = (spec.rules ?? []).join(' ')
      const haystack = `${spec.name} ${spec.description} ${paramsText} ${tagsText} ${skillsText} ${rulesText}`
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [specQuery, specTagFilter, specs])

  const filteredEntities = React.useMemo(() => {
    const query = entityQuery.trim().toLowerCase()
    return entities.filter(entity => {
      const tags = entity.tags ?? []
      if (entityTagFilter.length > 0 && !entityTagFilter.every(tag => tags.includes(tag))) return false
      if (query === '') return true
      const tagsText = tags.join(' ')
      const skillsText = (entity.skills ?? []).join(' ')
      const rulesText = (entity.rules ?? []).join(' ')
      const haystack = `${entity.name} ${entity.description} ${tagsText} ${skillsText} ${rulesText}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [entityQuery, entityTagFilter, entities])

  const filteredRules = React.useMemo(() => {
    const query = ruleQuery.trim().toLowerCase()
    return rules.filter(rule => {
      if (query === '') return true
      const globText = (rule.globs ?? []).join(' ')
      const haystack = `${rule.name} ${rule.description} ${globText}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [ruleQuery, rules])

  const handleRefresh = React.useCallback(async () => {
    await Promise.all([mutateSpecs(), mutateEntities(), mutateRules(), mutateSkills()])
    void message.success(t('knowledge.actions.refreshed'))
  }, [message, mutateEntities, mutateRules, mutateSkills, mutateSpecs, t])

  const handleCreateSpec = React.useCallback(() => {
    message.info(t('knowledge.flows.createHint'))
  }, [message, t])

  const handleImportSpec = React.useCallback(() => {
    message.info(t('knowledge.flows.importHint'))
  }, [message, t])

  const handleCreateEntity = React.useCallback(() => {
    message.info(t('knowledge.entities.createHint'))
  }, [message, t])

  const handleImportEntity = React.useCallback(() => {
    message.info(t('knowledge.entities.importHint'))
  }, [message, t])

  const handleCreateSkill = React.useCallback(() => {
    createSkillForm.resetFields()
    setCreateSkillOpen(true)
  }, [createSkillForm])

  const handleSaveSkill = async () => {
    const values = await createSkillForm.validateFields()
    setSavingSkill(true)
    try {
      await createSkill({
        name: values.name,
        description: values.description,
        body: values.body
      })
      setCreateSkillOpen(false)
      createSkillForm.resetFields()
      await mutateSkills()
      void message.success(t('knowledge.skills.createSuccess'))
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('knowledge.skills.createFailed')))
    } finally {
      setSavingSkill(false)
    }
  }

  const handleCreateRule = React.useCallback(() => {
    message.info(t('knowledge.rules.createHint'))
  }, [message, t])

  const handleImportRule = React.useCallback(() => {
    message.info(t('knowledge.rules.importHint'))
  }, [message, t])

  const getContentControls = (onCreate: () => void) =>
    isCompactView
      ? (
        <KnowledgeContentControls
          onCreate={onCreate}
        />
      )
      : isSidebarCollapsed
      ? (
        <KnowledgeContentControls
          onCreate={onCreate}
        />
      )
      : undefined

  const skillCount = React.useMemo(() => {
    if (skillsRes?.skills != null) return skillsRes.skills.length
    const names = new Set<string>()
    specs.forEach(spec => {
      spec.skills?.forEach(skill => names.add(skill))
    })
    entities.forEach(entity => {
      entity.skills?.forEach(skill => names.add(skill))
    })
    return names.size
  }, [entities, skillsRes?.skills, specs])
  const handleContentHeaderActionsChange = React.useCallback((items: RouteContainerHeaderActionItem[]) => {
    setContentHeaderActions(items)
  }, [])
  const handleNavigateSkillProject = React.useCallback(() => {
    onNavigateSkillPage('project')
  }, [onNavigateSkillPage])
  const handleNavigateSkillSettings = React.useCallback(() => {
    onNavigateSkillPage('settings')
  }, [onNavigateSkillPage])
  const handleNavigateSkillStore = React.useCallback(() => {
    onNavigateSkillPage('store')
  }, [onNavigateSkillPage])

  const sections = [
    {
      key: 'skills',
      icon: 'psychology',
      label: t('knowledge.tabs.skills'),
      description: t('knowledge.skills.desc'),
      count: skillCount,
      content: skillPage === 'settings'
        ? (
          <SkillRegistrySettingsView
            query={skillRegistrySettingsQuery}
            onHeaderActionsChange={handleContentHeaderActionsChange}
            onNavigateProject={handleNavigateSkillProject}
            onNavigateStore={handleNavigateSkillStore}
          />
        )
        : (
          <SkillsTab
            installFilter={skillInstallFilter}
            leading={getContentControls(handleCreateSkill)}
            marketQuery={skillMarketQuery}
            projectQuery={skillProjectQuery}
            registry={skillRegistry}
            sortKey={skillSortKey}
            sourceFilter={skillSourceFilter}
            viewMode={skillViewMode}
            onRefresh={handleRefresh}
            onCreate={handleCreateSkill}
            onHeaderActionsChange={handleContentHeaderActionsChange}
            onInstallFilterChange={updateSkillInstallFilter}
            onMarketQueryChange={updateSkillMarketQuery}
            onOpenSettings={handleNavigateSkillSettings}
            onProjectQueryChange={updateSkillProjectQuery}
            onRegistryChange={updateSkillRegistry}
            onSortChange={updateSkillSortKey}
            onSourceFilterChange={updateSkillSourceFilter}
            onViewModeChange={updateSkillViewMode}
          />
        )
    },
    {
      key: 'entities',
      icon: 'group_work',
      label: t('knowledge.tabs.entities'),
      description: t('knowledge.entities.desc'),
      count: entities.length,
      content: (
        <EntitiesTab
          entities={entities}
          filteredEntities={filteredEntities}
          isLoading={isEntitiesLoading}
          leading={getContentControls(handleCreateEntity)}
          query={entityQuery}
          tagOptions={entityTagOptions}
          tagFilter={entityTagFilter}
          onQueryChange={setEntityQuery}
          onTagFilterChange={setEntityTagFilter}
          onCreate={handleCreateEntity}
          onImport={handleImportEntity}
        />
      )
    },
    {
      key: 'flows',
      icon: 'account_tree',
      label: t('knowledge.tabs.flows'),
      description: t('knowledge.flows.desc'),
      count: specs.length,
      content: (
        <FlowsTab
          specs={specs}
          filteredSpecs={filteredSpecs}
          isLoading={isSpecsLoading}
          leading={getContentControls(handleCreateSpec)}
          query={specQuery}
          tagOptions={specTagOptions}
          tagFilter={specTagFilter}
          onQueryChange={setSpecQuery}
          onTagFilterChange={setSpecTagFilter}
          onCreate={handleCreateSpec}
          onImport={handleImportSpec}
        />
      )
    },
    {
      key: 'rules',
      icon: 'gavel',
      label: t('knowledge.tabs.rules'),
      description: t('knowledge.rules.desc'),
      count: rules.length,
      content: (
        <RulesTab
          rules={rules}
          filteredRules={filteredRules}
          isLoading={isRulesLoading}
          leading={getContentControls(handleCreateRule)}
          query={ruleQuery}
          onQueryChange={setRuleQuery}
          onCreate={handleCreateRule}
          onImport={handleImportRule}
        />
      )
    }
  ]

  const activeSectionKey = sectionKey
  const activeSection = React.useMemo(
    () => sections.find(section => section.key === activeSectionKey) ?? sections[0],
    [activeSectionKey, sections]
  )
  const activeSearchValue = activeSectionKey === 'skills' && skillPage === 'settings'
    ? skillRegistrySettingsQuery
    : activeSectionKey === 'skills'
    ? skillViewMode === 'market' ? skillMarketQuery : skillProjectQuery
    : activeSectionKey === 'entities'
    ? entityQuery
    : activeSectionKey === 'flows'
    ? specQuery
    : activeSectionKey === 'rules'
    ? ruleQuery
    : ''
  const activeSearchPlaceholder = activeSectionKey === 'skills'
    ? skillPage === 'settings'
      ? t('knowledge.skills.searchRegistries')
      : skillViewMode === 'market'
      ? t('knowledge.skills.searchHub')
      : t('knowledge.skills.searchProject')
    : t('knowledge.filters.searchActive')

  const handleActiveSearchChange = React.useCallback((value: string) => {
    if (activeSectionKey === 'skills') {
      if (skillPage === 'settings') {
        updateSkillRegistrySettingsQuery(value)
        return
      }
      if (skillViewMode === 'market') {
        updateSkillMarketQuery(value)
        return
      }

      updateSkillProjectQuery(value)
      return
    }
    if (activeSectionKey === 'entities') {
      setEntityQuery(value)
      return
    }
    if (activeSectionKey === 'flows') {
      setSpecQuery(value)
      return
    }
    if (activeSectionKey === 'rules') {
      setRuleQuery(value)
    }
  }, [
    activeSectionKey,
    skillPage,
    skillViewMode,
    updateSkillMarketQuery,
    updateSkillProjectQuery,
    updateSkillRegistrySettingsQuery
  ])

  const handleSelectSection = React.useCallback((key: string) => {
    onNavigateSection(key as KnowledgeSectionKey)
    closeRouteSidebar()
  }, [closeRouteSidebar, onNavigateSection])

  const routeSidebarGroups = React.useMemo(() => [
    {
      icon: 'psychology',
      items: [],
      key: 'skills',
      label: t('knowledge.tabs.skills'),
      searchableText: 'skills',
      selectable: true
    },
    {
      icon: 'group_work',
      items: [],
      key: 'entities',
      label: t('knowledge.tabs.entities'),
      searchableText: 'entities',
      selectable: true
    },
    {
      icon: 'account_tree',
      items: [],
      key: 'flows',
      label: t('knowledge.tabs.flows'),
      searchableText: 'flows',
      selectable: true
    },
    {
      icon: 'gavel',
      items: [],
      key: 'rules',
      label: t('knowledge.tabs.rules'),
      searchableText: 'rules',
      selectable: true
    }
  ], [t])

  const handleRouteSidebarSelect = React.useCallback((item: RouteSidebarListItem) => {
    handleSelectSection(item.key)
  }, [handleSelectSection])
  const headerActionItems = React.useMemo(() => [
    ...contentHeaderActions,
    ...routePluginHeaderActions
  ], [contentHeaderActions, routePluginHeaderActions])
  const headerBreadcrumb = React.useMemo<RouteContainerHeaderBreadcrumb>(() => {
    if (activeSectionKey === 'skills') {
      const currentTitle = skillPage === 'store'
        ? t('knowledge.skills.store')
        : skillPage === 'settings'
        ? t('knowledge.skills.registrySettings')
        : t('knowledge.skills.project')
      return {
        ancestors: [{
          title: t('common.knowledgeBase'),
          onSelect: () => onNavigateSkillPage('project')
        }],
        ariaLabel: t('knowledge.breadcrumbLabel'),
        backLabel: t('common.back'),
        currentTitle,
        onBack: skillPage === 'project' ? onBack : () => onNavigateSkillPage('project'),
        parentTitle: t('knowledge.tabs.skills')
      }
    }

    return {
      ariaLabel: t('knowledge.breadcrumbLabel'),
      backLabel: t('common.back'),
      currentTitle: activeSection.label,
      onBack,
      parentTitle: t('common.knowledgeBase')
    }
  }, [activeSection.label, activeSectionKey, onBack, onNavigateSkillPage, skillPage, t])

  React.useLayoutEffect(() => {
    if (!hasRouteSidebarProvider) return undefined

    setRouteSidebar({
      activeKey: activeSectionKey,
      ariaLabel: t('common.knowledgeBase'),
      contextMenuItems: routePluginSidebarContextMenu,
      emptyText: t('knowledge.filters.noResults'),
      groups: routeSidebarGroups,
      key: 'knowledge-base-view',
      search: {
        placeholder: activeSearchPlaceholder,
        value: activeSearchValue,
        onChange: handleActiveSearchChange
      },
      onSelectItem: handleRouteSidebarSelect
    })

    return () => clearRouteSidebar('knowledge-base-view')
  }, [
    activeSearchPlaceholder,
    activeSearchValue,
    activeSectionKey,
    clearRouteSidebar,
    handleActiveSearchChange,
    handleRouteSidebarSelect,
    hasRouteSidebarProvider,
    routePluginSidebarContextMenu,
    routeSidebarGroups,
    setRouteSidebar,
    t
  ])

  return (
    <RouteContainerLayout
      className={`knowledge-base-view ${isCompactView ? 'knowledge-base-view--compact' : ''}`}
      bodyClassName='knowledge-base-view__body'
      contentInset
      header={
        <RouteContainerHeader
          actionItems={headerActionItems}
          breadcrumb={headerBreadcrumb}
          onOpenSidebar={openRouteSidebar}
        />
      }
    >
      {activeSection?.content}
      <CreateSkillModal
        open={createSkillOpen}
        saving={savingSkill}
        form={createSkillForm}
        onSave={() => void handleSaveSkill()}
        onClose={() => setCreateSkillOpen(false)}
      />
    </RouteContainerLayout>
  )
}
