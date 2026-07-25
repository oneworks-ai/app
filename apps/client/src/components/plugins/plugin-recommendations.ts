import type { PluginMarketplaceCatalogPlugin } from '@oneworks/types'

import { interleaveMarketplacePlugins } from './PluginMarketplaceLanding'

const RECOMMENDATION_LIMIT = 10

export type PluginRecommendationCategory =
  | 'automation'
  | 'creative'
  | 'data'
  | 'development'
  | 'other'
  | 'productivity'
  | 'themes'

export interface PluginRecommendationGroup {
  category: PluginRecommendationCategory
  plugins: PluginMarketplaceCatalogPlugin[]
}

const recommendationCategoryOrder: PluginRecommendationCategory[] = [
  'automation',
  'development',
  'themes',
  'productivity',
  'creative',
  'data',
  'other'
]

const recommendationCategoryKeywords: Array<{
  category: PluginRecommendationCategory
  keywords: string[]
}> = [
  { category: 'themes', keywords: ['appearance', 'theme'] },
  {
    category: 'automation',
    keywords: ['automation', 'browser control', 'computer control', 'cua', 'driver']
  },
  {
    category: 'development',
    keywords: ['code', 'developer', 'development', 'devtool', 'github', 'plugin demo', 'terminal']
  },
  {
    category: 'creative',
    keywords: ['adobe', 'creative', 'design', 'figma', 'image', 'photoshop', 'video']
  },
  {
    category: 'data',
    keywords: ['analytics', 'banking', 'data', 'equity', 'finance', 'investment']
  },
  {
    category: 'productivity',
    keywords: ['calendar', 'document', 'drive', 'email', 'gmail', 'notion', 'outlook', 'productivity']
  }
]

const matchRecommendationCategory = (value: string | undefined) => {
  const searchText = value?.trim().toLowerCase()
  if (searchText == null || searchText === '') return undefined
  return recommendationCategoryKeywords.find(({ keywords }) => keywords.some(keyword => searchText.includes(keyword)))
    ?.category
}

export const resolvePluginRecommendationCategory = (
  plugin: PluginMarketplaceCatalogPlugin
): PluginRecommendationCategory => {
  const declaredCategory = matchRecommendationCategory(plugin.category)
  if (declaredCategory != null) return declaredCategory

  const searchText = [
    plugin.name,
    plugin.displayName,
    plugin.description
  ].filter(Boolean).join(' ').toLowerCase()

  return matchRecommendationCategory(searchText) ?? 'other'
}

export const groupRecommendedMarketplacePlugins = (
  plugins: PluginMarketplaceCatalogPlugin[]
): PluginRecommendationGroup[] => {
  const groups = new Map<PluginRecommendationCategory, PluginMarketplaceCatalogPlugin[]>()
  for (const plugin of plugins) {
    const category = resolvePluginRecommendationCategory(plugin)
    const current = groups.get(category)
    if (current == null) {
      groups.set(category, [plugin])
    } else {
      current.push(plugin)
    }
  }

  return recommendationCategoryOrder.flatMap(category => {
    const categoryPlugins = groups.get(category)
    return categoryPlugins == null ? [] : [{ category, plugins: categoryPlugins }]
  })
}

export const selectRecommendedMarketplacePlugins = (
  plugins: PluginMarketplaceCatalogPlugin[],
  limit = RECOMMENDATION_LIMIT
) => {
  const availablePlugins = plugins.filter(plugin => (
    plugin.builtIn === true &&
    plugin.marketplaceEnabled &&
    plugin.nativeInstalled !== true &&
    (plugin.installedSources?.length ?? 0) === 0
  ))
  const featuredOneWorksPlugins = availablePlugins.filter(plugin =>
    plugin.marketplaceType === 'oneworks' && plugin.featured === true
  )
  const otherOneWorksPlugins = availablePlugins.filter(plugin =>
    plugin.marketplaceType === 'oneworks' && plugin.featured !== true
  )
  const featuredExternalPlugins = availablePlugins.filter(plugin =>
    plugin.marketplaceType !== 'oneworks' && plugin.featured === true
  )
  const otherExternalPlugins = availablePlugins.filter(plugin =>
    plugin.marketplaceType !== 'oneworks' && plugin.featured !== true
  )

  return [
    ...featuredOneWorksPlugins,
    ...interleaveMarketplacePlugins([
      ...featuredExternalPlugins,
      ...otherExternalPlugins
    ]),
    ...otherOneWorksPlugins
  ].slice(0, limit)
}
