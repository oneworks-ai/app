import './SkillRegistrySettingsView.scss'

import { App, Empty, List, Spin } from 'antd'
import React from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import type { RouteContainerHeaderActionItem } from '@oneworks/components/route-layout'
import type { ConfigResponse } from '@oneworks/types'

import { getApiErrorMessage, getConfig, listSkillHubRegistries, updateConfig } from '#~/api.js'
import type { SkillHubRegistriesResult } from '#~/api.js'
import { SkillRegistryModal } from './SkillRegistryModal'
import { SkillRegistrySettingsItem, getSkillRegistrySearchText } from './SkillRegistrySettingsItem'
import { TabContent } from './TabContent'
import {
  buildBuiltInSkillRegistryToggleValue,
  buildSkillRegistryRemovalValue,
  collectManagedSkillRegistries,
  resolveInheritedBuiltInRegistryEnabled
} from './skill-registry-settings-utils'
import type { ManagedSkillRegistry } from './skill-registry-settings-utils'
import { useSkillRegistryModal } from './use-skill-registry-modal'

interface SkillRegistrySettingsViewProps {
  query: string
  onHeaderActionsChange?: (items: RouteContainerHeaderActionItem[]) => void
  onNavigateProject: () => void
  onNavigateStore: () => void
}

export function SkillRegistrySettingsView({
  query,
  onHeaderActionsChange,
  onNavigateProject,
  onNavigateStore
}: SkillRegistrySettingsViewProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [writingKey, setWritingKey] = React.useState<string>()
  const {
    data: configRes,
    isLoading,
    mutate: mutateConfig
  } = useSWR<ConfigResponse>('/api/config', getConfig)
  const {
    data: registriesRes,
    isLoading: areRegistriesLoading,
    mutate: mutateRegistries
  } = useSWR<SkillHubRegistriesResult>('/api/skill-hub/registries', listSkillHubRegistries)
  const registryModal = useSkillRegistryModal({
    configRes,
    existingRegistrySources: registriesRes?.registries.map(registry => registry.source),
    mutateConfig,
    mutateHub: mutateRegistries
  })
  const registries = React.useMemo(
    () => collectManagedSkillRegistries(configRes, registriesRes?.registries),
    [configRes, registriesRes?.registries]
  )
  const filteredRegistries = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (normalizedQuery === '') return registries
    return registries.filter(registry => (
      getSkillRegistrySearchText(registry).toLowerCase().includes(normalizedQuery)
    ))
  }, [query, registries])
  const headerActionItems = React.useMemo<RouteContainerHeaderActionItem[]>(() => [
    {
      icon: 'add_link',
      key: 'knowledge-skills-add-registry',
      label: t('knowledge.skills.addRegistry'),
      disabled: writingKey != null || registryModal.saving,
      onSelect: registryModal.openModal
    },
    {
      active: true,
      icon: 'settings',
      key: 'knowledge-skills-settings',
      label: t('knowledge.skills.registrySettings'),
      onSelect: () => undefined
    },
    {
      icon: 'folder_managed',
      key: 'knowledge-skills-project',
      label: t('knowledge.skills.project'),
      onSelect: onNavigateProject
    },
    {
      icon: 'storefront',
      key: 'knowledge-skills-store',
      label: t('knowledge.skills.store'),
      onSelect: onNavigateStore
    }
  ], [
    onNavigateProject,
    onNavigateStore,
    registryModal.openModal,
    registryModal.saving,
    writingKey,
    t
  ])

  React.useEffect(() => {
    onHeaderActionsChange?.(headerActionItems)
  }, [headerActionItems, onHeaderActionsChange])
  React.useEffect(() => () => onHeaderActionsChange?.([]), [onHeaderActionsChange])

  const removeRegistry = async (registry: ManagedSkillRegistry) => {
    setWritingKey(registry.key)
    try {
      const general = configRes?.sources?.[registry.configSource]?.general
      await updateConfig(
        registry.configSource,
        'general',
        buildSkillRegistryRemovalValue(general, registry)
      )
      await Promise.all([mutateConfig(), mutateRegistries()])
      void message.success(t('knowledge.skills.registryRemoved'))
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('knowledge.skills.registryRemoveFailed')))
    } finally {
      setWritingKey(undefined)
    }
  }

  const toggleBuiltInRegistry = async (registry: ManagedSkillRegistry, enabled: boolean) => {
    setWritingKey(registry.key)
    try {
      const general = configRes?.sources?.[registry.configSource]?.general
      await updateConfig(
        registry.configSource,
        'general',
        buildBuiltInSkillRegistryToggleValue(
          general,
          registry.source,
          enabled,
          resolveInheritedBuiltInRegistryEnabled(configRes, registry.configSource, registry.source)
        )
      )
      await Promise.all([mutateConfig(), mutateRegistries()])
      void message.success(t(
        enabled
          ? 'knowledge.skills.registryEnabled'
          : 'knowledge.skills.registryDisabled'
      ))
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('knowledge.skills.registryToggleFailed')))
    } finally {
      setWritingKey(undefined)
    }
  }

  return (
    <TabContent className='knowledge-base-view__registry-settings'>
      <div className='knowledge-base-view__registry-settings-intro'>
        {t('knowledge.skills.registrySettingsDescription')}
      </div>
      {isLoading || areRegistriesLoading
        ? (
          <div className='knowledge-base-view__registry-settings-loading'>
            <Spin />
          </div>
        )
        : filteredRegistries.length === 0
        ? (
          <div className='knowledge-base-view__registry-settings-empty'>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={registries.length === 0
                ? t('knowledge.skills.noCustomRegistries')
                : t('knowledge.filters.noResults')}
            />
          </div>
        )
        : (
          <List
            className='knowledge-base-view__registry-settings-list'
            dataSource={filteredRegistries}
            renderItem={(registry) => (
              <SkillRegistrySettingsItem
                registry={registry}
                writesDisabled={writingKey != null || registryModal.saving}
                writingKey={writingKey}
                onRemove={item => void removeRegistry(item)}
                onToggle={(item, enabled) => void toggleBuiltInRegistry(item, enabled)}
              />
            )}
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
