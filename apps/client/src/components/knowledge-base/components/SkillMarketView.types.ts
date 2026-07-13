import type { SkillHubInstallTarget, SkillHubItem, SkillHubRegistrySummary } from '#~/api.js'

import type { SkillHubInstallFilter, SkillHubSortKey } from './skill-hub-utils'

export interface SkillMarketViewProps {
  currentPage: number
  hubItems: SkillHubItem[]
  installingId: string | null
  installFilter: SkillHubInstallFilter
  isLoading: boolean
  isPageLoading: boolean
  pageSize: number
  query: string
  registries: SkillHubRegistrySummary[]
  registry: string
  registryOptions: Array<{ label: string; value: string }>
  resetKey: string
  sortKey: SkillHubSortKey
  sourceFilter: string
  sourceOptions: Array<{ label: string; value: string }>
  total: number
  onAddRegistry: () => void
  onInstall: (item: SkillHubItem, target: SkillHubInstallTarget) => void
  onInstallFilterChange: (value: SkillHubInstallFilter) => void
  onOpenSettings: () => void
  onPageChange: (page: number) => void
  onQueryChange: (value: string) => void
  onRegistryChange: (value: string) => void
  onSortChange: (value: SkillHubSortKey) => void
  onSourceFilterChange: (value: string) => void
}
