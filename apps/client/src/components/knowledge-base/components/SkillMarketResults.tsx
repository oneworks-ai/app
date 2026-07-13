import type { SkillHubInstallTarget, SkillHubItem } from '#~/api.js'
import { MarketplaceResults } from '#~/components/marketplace/MarketplaceResults'
import { SkillHubResultItem } from './SkillHubResultItem'

interface SkillMarketResultsProps {
  currentPage: number
  hubItems: SkillHubItem[]
  installingId: string | null
  isPageLoading: boolean
  pageSize: number
  resetKey: string
  total: number
  onInstall: (item: SkillHubItem, target: SkillHubInstallTarget) => void
  onPageChange: (page: number) => void
}

export function SkillMarketResults({
  currentPage,
  hubItems,
  installingId,
  isPageLoading,
  pageSize,
  resetKey,
  total,
  onInstall,
  onPageChange
}: SkillMarketResultsProps) {
  return (
    <MarketplaceResults
      currentPage={currentPage}
      items={hubItems}
      isLoading={isPageLoading}
      pageSize={pageSize}
      resetKey={resetKey}
      total={total}
      onPageChange={onPageChange}
      renderItem={(item) => {
        const installingTarget = (['project', 'global'] as const).find(
          target => installingId === `${item.id}:${target}`
        ) ?? null
        return (
          <SkillHubResultItem
            item={item}
            installDisabled={installingId != null && installingTarget == null}
            installingTarget={installingTarget}
            onInstall={onInstall}
          />
        )
      }}
    />
  )
}
