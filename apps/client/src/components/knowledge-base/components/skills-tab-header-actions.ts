import type { TFunction } from 'i18next'

import type { RouteContainerHeaderActionItem } from '@oneworks/components/route-layout'

type SkillViewMode = 'project' | 'market'

interface BuildSkillsTabHeaderActionsOptions {
  navigateToSettings: () => void
  onViewModeChange: (value: SkillViewMode) => void
  t: TFunction
  viewMode: SkillViewMode
}

export function buildSkillsTabHeaderActions({
  navigateToSettings,
  onViewModeChange,
  t,
  viewMode
}: BuildSkillsTabHeaderActionsOptions): RouteContainerHeaderActionItem[] {
  return [
    {
      icon: 'settings',
      key: 'knowledge-skills-settings',
      label: t('knowledge.skills.openConfig'),
      onSelect: navigateToSettings
    },
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
      key: 'knowledge-skills-store',
      label: t('knowledge.skills.store'),
      onSelect: () => onViewModeChange('market')
    }
  ]
}
