import type { TFunction } from 'i18next'
import type { RefObject } from 'react'

import type { RouteContainerHeaderActionItem } from '#~/components/layout/RouteContainerHeader'

type SkillViewMode = 'project' | 'market'

interface BuildSkillsTabHeaderActionsOptions {
  importInputRef: RefObject<HTMLInputElement | null>
  importing: boolean
  navigateToConfig: () => void
  onRefresh: () => void
  onViewModeChange: (value: SkillViewMode) => void
  t: TFunction
  viewMode: SkillViewMode
}

export function buildSkillsTabHeaderActions({
  importInputRef,
  importing,
  navigateToConfig,
  onRefresh,
  onViewModeChange,
  t,
  viewMode
}: BuildSkillsTabHeaderActionsOptions): RouteContainerHeaderActionItem[] {
  return [
    {
      active: viewMode === 'project',
      icon: 'folder_managed',
      key: 'knowledge-skills-project',
      label: t('knowledge.skills.project'),
      onSelect: () => onViewModeChange('project')
    },
    {
      active: viewMode === 'market',
      icon: 'storefront',
      key: 'knowledge-skills-market',
      label: t('knowledge.skills.market'),
      onSelect: () => onViewModeChange('market')
    },
    {
      icon: 'refresh',
      key: 'knowledge-skills-refresh',
      label: t('knowledge.actions.refresh'),
      onSelect: onRefresh
    },
    ...(viewMode === 'project'
      ? [{
        icon: 'download' as const,
        key: 'knowledge-skills-import',
        label: t('knowledge.actions.import'),
        loading: importing,
        onSelect: () => importInputRef.current?.click()
      }]
      : []),
    {
      icon: 'settings',
      key: 'knowledge-skills-settings',
      label: t('knowledge.skills.openConfig'),
      onSelect: navigateToConfig
    }
  ]
}
