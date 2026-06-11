import { resolvePluginContributionText } from '#~/plugins/plugin-i18n'
import type { PluginContributionWorkbenchTab } from '#~/plugins/plugin-manifest'

export interface InteractionPanelPluginPage {
  icon: string
  id: string
  pluginScope: string
  tabId: string
  title: string
  viewId: string
}

export type InteractionPanelPluginTabDefinition = PluginContributionWorkbenchTab & { pluginScope: string }

const toPluginTabDefinitionKey = (scope: string, tabId: string) => `${scope}/${tabId}`

const isOpenablePluginTabDefinition = (
  tab: InteractionPanelPluginTabDefinition
): tab is InteractionPanelPluginTabDefinition & { clientView: string } =>
  tab.placement !== 'right' && tab.clientView != null

export const resolveInteractionPanelPluginTabDefinition = ({
  fallbackToSingle,
  pluginScope,
  tabId,
  tabs
}: {
  fallbackToSingle?: boolean
  pluginScope: string
  tabId?: string
  tabs: InteractionPanelPluginTabDefinition[]
}) => {
  const candidates = tabs.filter(tab => tab.pluginScope === pluginScope && isOpenablePluginTabDefinition(tab))
  const exactTab = tabId == null ? undefined : candidates.find(tab => tab.id === tabId)
  if (exactTab != null) return exactTab
  if (fallbackToSingle === true && candidates.length === 1) return candidates[0]
  return undefined
}

export const createInteractionPanelPluginPage = (
  tab: InteractionPanelPluginTabDefinition,
  language: string
): InteractionPanelPluginPage | null => {
  if (!isOpenablePluginTabDefinition(tab)) return null

  return {
    icon: tab.icon ?? 'layers',
    id: `plugin-${tab.pluginScope}-${tab.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    pluginScope: tab.pluginScope,
    tabId: tab.id,
    title: resolvePluginContributionText(tab, 'title', language) ?? tab.title,
    viewId: tab.clientView
  }
}

export const normalizeInteractionPanelPluginPages = (
  pages: InteractionPanelPluginPage[],
  tabs: InteractionPanelPluginTabDefinition[],
  language: string
) => {
  const tabsByKey = new Map(tabs.map(tab => [toPluginTabDefinitionKey(tab.pluginScope, tab.id), tab]))

  return pages.flatMap((page) => {
    const tab = tabsByKey.get(toPluginTabDefinitionKey(page.pluginScope, page.tabId))
    if (tab == null || !isOpenablePluginTabDefinition(tab)) return []

    return [{
      ...page,
      icon: tab.icon ?? 'layers',
      title: resolvePluginContributionText(tab, 'title', language) ?? tab.title,
      viewId: tab.clientView
    }]
  })
}

export const areInteractionPanelPluginPagesEqual = (
  left: InteractionPanelPluginPage[],
  right: InteractionPanelPluginPage[]
) =>
  left.length === right.length &&
  left.every((page, index) => {
    const rightPage = right[index]
    return rightPage != null &&
      page.id === rightPage.id &&
      page.pluginScope === rightPage.pluginScope &&
      page.tabId === rightPage.tabId &&
      page.title === rightPage.title &&
      page.icon === rightPage.icon &&
      page.viewId === rightPage.viewId
  })
