import type { TFunction } from 'i18next'

import type { IconAsset } from '#~/components/icons/IconAsset'
import type { InteractionListItem } from '#~/components/interaction-list'

export { getInteractionStructureItems } from './interaction-structure-items'

export const INTERACTION_STRUCTURE_BASE_PATH = '/__interaction-structure'

export type InteractionStructureRouteKey = 'requests' | 'resources' | 'operations'
export type InteractionStructureFilterKey = 'all' | 'active' | 'done'
export type InteractionStructureFilterQueryKey = string
export type InteractionStructureStatusFilterKey = Exclude<InteractionStructureFilterKey, 'all'>
export type InteractionStructureItemVariant = 'activity' | 'checkpoint' | 'compact' | 'metrics' | 'summary'
export type InteractionStructureDetailComponent = InteractionStructureItemVariant

export interface InteractionStructureMetric {
  label: string
  value: string
}

export interface InteractionStructureRouteConfig {
  activeLabel: string
  description: string
  icon: IconAsset
  key: InteractionStructureRouteKey
  label: string
  metric: string
  searchPlaceholder: string
}

export interface InteractionStructureFilterOption {
  label: string
  value: string
}

export interface InteractionStructureFilterConfig {
  icon: string
  label: string
  options: InteractionStructureFilterOption[]
  placeholder: string
  queryKey: InteractionStructureFilterQueryKey
  matchesItem?: (item: InteractionStructureItem, selectedValues: string[]) => boolean
}

export interface InteractionStructureRouteActionConfig {
  activeIcon?: IconAsset
  activeLabel?: string
  confirmLabel?: string
  danger?: boolean
  icon: IconAsset
  key?: string
  label: string
}

export interface InteractionStructureRouteBehaviorConfig {
  archiveAction: InteractionStructureRouteActionConfig
  contextActions: InteractionStructureRouteActionConfig[]
  favoriteAction: InteractionStructureRouteActionConfig
  primaryAction: InteractionStructureRouteActionConfig
}

export interface InteractionStructureItem extends InteractionListItem {
  detail?: string
  detailComponent: InteractionStructureDetailComponent
  filter: Exclude<InteractionStructureFilterKey, 'all'>
  filterTokens?: string[]
  metrics?: InteractionStructureMetric[]
  progress?: number
  status?: string
  variant: InteractionStructureItemVariant
}

export interface InteractionStructureRouteContent {
  component: InteractionStructureDetailComponent
  item: InteractionStructureItem
  route: InteractionStructureRouteConfig
}

const routeKeys: InteractionStructureRouteKey[] = ['requests', 'resources', 'operations']
const filledMaterialIcon = (name: string): IconAsset => ({
  filled: true,
  name,
  type: 'material'
})
const encodedSvgDataUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
const customRequestIcon: IconAsset = {
  active: {
    svg: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="4" y="5" width="16" height="3" rx="1.5" fill="currentColor"/>' +
      '<rect x="4" y="11" width="16" height="3" rx="1.5" fill="currentColor"/>' +
      '<rect x="4" y="17" width="10" height="3" rx="1.5" fill="currentColor"/>' +
      '</svg>',
    type: 'svg'
  },
  inactive: {
    svg: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="4" y="5" width="16" height="3" rx="1.5" stroke="currentColor" stroke-width="1.8"/>' +
      '<rect x="4" y="11" width="16" height="3" rx="1.5" stroke="currentColor" stroke-width="1.8"/>' +
      '<rect x="4" y="17" width="10" height="3" rx="1.5" stroke="currentColor" stroke-width="1.8"/>' +
      '</svg>',
    type: 'svg'
  }
}
const customResourceIcon: IconAsset = {
  active: {
    alt: '',
    src: encodedSvgDataUri(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
        '<rect x="4" y="3" width="16" height="18" rx="3" fill="#0f9bb5"/>' +
        '<path d="M8 8h8M8 12h8M8 16h5" stroke="white" stroke-width="1.8" stroke-linecap="round"/>' +
        '</svg>'
    ),
    type: 'image'
  },
  inactive: {
    alt: '',
    src: encodedSvgDataUri(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
        '<rect x="4" y="3" width="16" height="18" rx="3" fill="none" stroke="#6b7280" stroke-width="1.8"/>' +
        '<path d="M8 8h8M8 12h8M8 16h5" stroke="#6b7280" stroke-width="1.8" stroke-linecap="round"/>' +
        '</svg>'
    ),
    type: 'image'
  }
}
const customOperationIcon: IconAsset = {
  active: {
    filled: true,
    name: 'rule_settings',
    type: 'material'
  },
  inactive: {
    name: 'rule_settings',
    type: 'material'
  }
}
const categoryFilterOptionsByRoute: Record<InteractionStructureRouteKey, Array<{ itemKey: string; value: string }>> = {
  operations: [
    { itemKey: 'opsNightlyRun', value: 'schedule' },
    { itemKey: 'opsReviewLoop', value: 'flow' },
    { itemKey: 'opsArchiveSweep', value: 'archive' }
  ],
  requests: [
    { itemKey: 'requestCheckout', value: 'experience' },
    { itemKey: 'requestPluginAudit', value: 'plugin' },
    { itemKey: 'requestNavigationRefresh', value: 'structure' }
  ],
  resources: [
    { itemKey: 'assetDesignSystem', value: 'design' },
    { itemKey: 'assetApiCatalog', value: 'api' },
    { itemKey: 'assetReleaseNotes', value: 'release' }
  ]
}
const stateFilterOptionsByRoute: Record<
  InteractionStructureRouteKey,
  Array<{
    labelKey: string
    value: InteractionStructureStatusFilterKey
  }>
> = {
  operations: [
    { labelKey: 'running', value: 'active' },
    { labelKey: 'archived', value: 'done' }
  ],
  requests: [
    { labelKey: 'active', value: 'active' },
    { labelKey: 'done', value: 'done' }
  ],
  resources: [
    { labelKey: 'pending', value: 'active' },
    { labelKey: 'archived', value: 'done' }
  ]
}
const tokenFilterConfigsByRoute: Record<
  InteractionStructureRouteKey,
  Array<{
    icon: string
    labelKey: string
    options: Array<{
      labelKey: string
      value: string
    }>
    placeholderKey: string
    queryKey: InteractionStructureFilterQueryKey
  }>
> = {
  operations: [
    {
      icon: 'event_repeat',
      labelKey: 'cadenceLabel',
      options: [
        { labelKey: 'nightly', value: 'cadence-nightly' },
        { labelKey: 'daily', value: 'cadence-daily' },
        { labelKey: 'weekly', value: 'cadence-weekly' }
      ],
      placeholderKey: 'cadenceAll',
      queryKey: 'cadence'
    },
    {
      icon: 'person',
      labelKey: 'ownerLabel',
      options: [
        { labelKey: 'system', value: 'owner-system' },
        { labelKey: 'product', value: 'owner-product' }
      ],
      placeholderKey: 'ownerAll',
      queryKey: 'owner'
    }
  ],
  requests: [
    {
      icon: 'priority_high',
      labelKey: 'priorityLabel',
      options: [
        { labelKey: 'high', value: 'priority-high' },
        { labelKey: 'medium', value: 'priority-medium' },
        { labelKey: 'low', value: 'priority-low' }
      ],
      placeholderKey: 'priorityAll',
      queryKey: 'priority'
    },
    {
      icon: 'input',
      labelKey: 'channelLabel',
      options: [
        { labelKey: 'web', value: 'channel-web' },
        { labelKey: 'extension', value: 'channel-extension' },
        { labelKey: 'navigation', value: 'channel-navigation' }
      ],
      placeholderKey: 'channelAll',
      queryKey: 'channel'
    }
  ],
  resources: [
    {
      icon: 'source',
      labelKey: 'sourceLabel',
      options: [
        { labelKey: 'design', value: 'source-design' },
        { labelKey: 'server', value: 'source-server' },
        { labelKey: 'docs', value: 'source-docs' }
      ],
      placeholderKey: 'sourceAll',
      queryKey: 'source'
    },
    {
      icon: 'update',
      labelKey: 'freshnessLabel',
      options: [
        { labelKey: 'current', value: 'freshness-current' },
        { labelKey: 'archived', value: 'freshness-archived' }
      ],
      placeholderKey: 'freshnessAll',
      queryKey: 'freshness'
    }
  ]
}
export const DEFAULT_INTERACTION_STRUCTURE_ROUTE: InteractionStructureRouteKey = 'requests'
export const getInteractionStructureFilterQueryKeys = (): InteractionStructureFilterQueryKey[] => (
  Array.from(
    new Set([
      'filter',
      'state',
      ...Object.values(tokenFilterConfigsByRoute).flatMap(configs => configs.map(config => config.queryKey))
    ])
  )
)

export const resolveInteractionStructureRouteKey = (
  rawValue?: string | null
): InteractionStructureRouteKey => {
  if (rawValue != null && routeKeys.includes(rawValue as InteractionStructureRouteKey)) {
    return rawValue as InteractionStructureRouteKey
  }

  return DEFAULT_INTERACTION_STRUCTURE_ROUTE
}

export const buildInteractionStructurePath = (routeKey: InteractionStructureRouteKey) => (
  `${INTERACTION_STRUCTURE_BASE_PATH}/${routeKey}`
)

export const INTERACTION_STRUCTURE_SHARED_QUERY_KEYS = [
  'sidebar',
  '__oneworks_desktop',
  '__oneworks_fullscreen',
  'routePanels',
  'sidePanelTab',
  'sidePanelTabs',
  'bottomPanelTab',
  'bottomPanelTabs'
]

export const buildInteractionStructureNavigationTarget = (
  routeKey: InteractionStructureRouteKey,
  currentSearch: string | URLSearchParams
) => {
  const currentParams = new URLSearchParams(currentSearch)
  const nextParams = new URLSearchParams()

  INTERACTION_STRUCTURE_SHARED_QUERY_KEYS.forEach((key) => {
    currentParams.getAll(key).forEach(value => nextParams.append(key, value))
  })

  const nextSearch = nextParams.toString()
  return {
    pathname: buildInteractionStructurePath(routeKey),
    search: nextSearch === '' ? '' : `?${nextSearch}`
  }
}

export const getInteractionStructureRoutes = (t: TFunction): InteractionStructureRouteConfig[] => (
  routeKeys.map(key => ({
    activeLabel: t(`interactionStructure.routes.${key}.activeLabel`),
    description: t(`interactionStructure.routes.${key}.description`),
    icon: {
      operations: customOperationIcon,
      requests: customRequestIcon,
      resources: customResourceIcon
    }[key],
    key,
    label: t(`interactionStructure.routes.${key}.label`),
    metric: t(`interactionStructure.routes.${key}.metric`),
    searchPlaceholder: t(`interactionStructure.routes.${key}.searchPlaceholder`)
  }))
)

export const flattenInteractionStructureItems = (
  items: InteractionStructureItem[]
): InteractionStructureItem[] => (
  items.flatMap(item => [
    item,
    ...flattenInteractionStructureItems((item.children ?? []) as InteractionStructureItem[])
  ])
)

export const getInteractionStructureSelectableItems = (
  items: InteractionStructureItem[]
): InteractionStructureItem[] => (
  flattenInteractionStructureItems(items).filter(item => item.itemType !== 'groupTitle' && item.disabled !== true)
)

export const resolveInteractionStructureSelectedItem = (
  items: InteractionStructureItem[],
  selectedItemKey?: string | null
): InteractionStructureItem | undefined => {
  if (selectedItemKey == null || selectedItemKey.trim() === '') return undefined

  const selectableItems = getInteractionStructureSelectableItems(items)
  return selectableItems.find(item => item.key === selectedItemKey)
}

export const getInteractionStructureRouteContent = ({
  items,
  route,
  selectedItemKey
}: {
  items: InteractionStructureItem[]
  route: InteractionStructureRouteConfig
  selectedItemKey?: string | null
}): InteractionStructureRouteContent | undefined => {
  const selectedItem = resolveInteractionStructureSelectedItem(items, selectedItemKey)
  if (selectedItem == null) return undefined

  return {
    component: selectedItem.detailComponent,
    item: selectedItem,
    route
  }
}

const getInteractionStructureCategoryFilterOptions = (
  routeKey: InteractionStructureRouteKey,
  t: TFunction
): InteractionStructureFilterOption[] => (
  categoryFilterOptionsByRoute[routeKey].map(option => ({
    label: t(`interactionStructure.items.${option.itemKey}.tag`),
    value: option.value
  }))
)

export const getInteractionStructureFilterConfigs = (
  routeKey: InteractionStructureRouteKey,
  t: TFunction
): InteractionStructureFilterConfig[] => {
  const tokenMatches = (item: InteractionStructureItem, selectedValues: string[]) => {
    const itemFilterTokens = item.filterTokens ?? [item.filter]
    return selectedValues.some(value => itemFilterTokens.includes(value))
  }

  return [
    {
      icon: {
        operations: 'route',
        requests: 'filter_list',
        resources: 'category'
      }[routeKey],
      label: t(`interactionStructure.filterRoutes.${routeKey}.label`),
      matchesItem: tokenMatches,
      options: getInteractionStructureCategoryFilterOptions(routeKey, t),
      placeholder: t(`interactionStructure.filterRoutes.${routeKey}.all`),
      queryKey: 'filter'
    },
    {
      icon: {
        operations: 'timeline',
        requests: 'radio_button_checked',
        resources: 'sync_alt'
      }[routeKey],
      label: t(`interactionStructure.filterRoutes.${routeKey}.stateLabel`),
      matchesItem: (item, selectedValues) => selectedValues.includes(item.filter),
      options: stateFilterOptionsByRoute[routeKey].map(option => ({
        label: t(`interactionStructure.filterRoutes.${routeKey}.states.${option.labelKey}`),
        value: option.value
      })),
      placeholder: t(`interactionStructure.filterRoutes.${routeKey}.stateAll`),
      queryKey: 'state'
    },
    ...tokenFilterConfigsByRoute[routeKey].map(config => ({
      icon: config.icon,
      label: t(`interactionStructure.filterRoutes.${routeKey}.${config.labelKey}`),
      matchesItem: tokenMatches,
      options: config.options.map(option => ({
        label: t(`interactionStructure.filterRoutes.${routeKey}.${config.queryKey}.${option.labelKey}`),
        value: option.value
      })),
      placeholder: t(`interactionStructure.filterRoutes.${routeKey}.${config.placeholderKey}`),
      queryKey: config.queryKey
    }))
  ]
}

export const getInteractionStructureRouteBehavior = (
  routeKey: InteractionStructureRouteKey,
  t: TFunction
): InteractionStructureRouteBehaviorConfig => ({
  operations: {
    archiveAction: {
      icon: 'inventory_2',
      label: t('interactionStructure.actions.archiveOperation')
    },
    contextActions: [
      {
        icon: 'article',
        key: 'view-run-log',
        label: t('interactionStructure.actions.viewRunLog')
      },
      {
        icon: 'pause_circle',
        key: 'pauseOperation',
        label: t('interactionStructure.actions.pauseOperation')
      }
    ],
    favoriteAction: {
      activeIcon: filledMaterialIcon('push_pin'),
      activeLabel: t('interactionStructure.actions.unpinOperation'),
      icon: 'keep',
      label: t('interactionStructure.actions.pinOperation')
    },
    primaryAction: {
      activeIcon: filledMaterialIcon('play_arrow'),
      icon: 'play_arrow',
      label: t('interactionStructure.actions.runOperation')
    }
  },
  requests: {
    archiveAction: {
      icon: 'archive',
      label: t('common.archive')
    },
    contextActions: [
      {
        icon: 'add_task',
        key: 'createFollowUp',
        label: t('interactionStructure.actions.createFollowUp')
      },
      {
        icon: 'turn_right',
        key: 'convertToTask',
        label: t('interactionStructure.actions.convertToTask')
      }
    ],
    favoriteAction: {
      activeIcon: filledMaterialIcon('star'),
      activeLabel: t('common.unstar'),
      icon: 'star_border',
      label: t('common.star')
    },
    primaryAction: {
      activeIcon: filledMaterialIcon('check_circle'),
      icon: 'check_circle',
      label: t('interactionStructure.actions.markDone')
    }
  },
  resources: {
    archiveAction: {
      icon: 'inventory_2',
      label: t('interactionStructure.actions.archiveResource')
    },
    contextActions: [
      {
        icon: 'open_in_new',
        key: 'openResource',
        label: t('interactionStructure.actions.openResource')
      },
      {
        icon: 'content_copy',
        key: 'copyResourceReference',
        label: t('interactionStructure.actions.copyResourceReference')
      }
    ],
    favoriteAction: {
      activeIcon: filledMaterialIcon('bookmark'),
      activeLabel: t('interactionStructure.actions.unbookmarkResource'),
      icon: 'bookmark_border',
      label: t('interactionStructure.actions.bookmarkResource')
    },
    primaryAction: {
      activeIcon: filledMaterialIcon('sync'),
      icon: 'sync',
      label: t('interactionStructure.actions.syncResource')
    }
  }
}[routeKey])

export const filterInteractionStructureItems = ({
  filterConfigs,
  filters,
  items,
  query
}: {
  filterConfigs: InteractionStructureFilterConfig[]
  filters: Record<string, string[]>
  items: InteractionStructureItem[]
  query: string
}): InteractionStructureItem[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase()

  const matchesItem = (item: InteractionStructureItem): boolean => {
    const matchesFilters = filterConfigs.every((config) => {
      const selectedValues = filters[config.queryKey] ?? []
      if (selectedValues.length === 0) return true
      return config.matchesItem?.(item, selectedValues) ?? true
    })
    const matchesQuery = normalizedQuery === '' || [
      item.searchText,
      item.key
    ].filter(Boolean).join(' ').toLocaleLowerCase().includes(normalizedQuery)

    return matchesFilters && matchesQuery
  }

  return items.flatMap((item): InteractionStructureItem[] => {
    const filteredChildren = filterInteractionStructureItems({
      filters,
      filterConfigs,
      items: (item.children ?? []) as InteractionStructureItem[],
      query
    })

    if (matchesItem(item)) {
      return [{
        ...item,
        children: filteredChildren
      }]
    }

    if (filteredChildren.length > 0) {
      return [{
        ...item,
        children: filteredChildren
      }]
    }

    return []
  })
}
