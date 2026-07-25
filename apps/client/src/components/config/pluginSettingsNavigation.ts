import type { PluginContributionSettingsPageGroup } from '@oneworks/types'

export const externalControlSettingsPageGroup = 'external-control' satisfies PluginContributionSettingsPageGroup

interface SettingsPageContributionWithGroup {
  group?: string
}

export const partitionPluginSettingsPages = <T extends SettingsPageContributionWithGroup>(
  pages: readonly T[]
) => ({
  defaultPages: pages.filter(page => page.group !== externalControlSettingsPageGroup),
  externalControlPages: pages.filter(page => page.group === externalControlSettingsPageGroup)
})
