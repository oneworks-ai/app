import type { TFunction } from 'i18next'

import type {
  InteractionStructureDetailComponent,
  InteractionStructureItem,
  InteractionStructureItemVariant,
  InteractionStructureMetric,
  InteractionStructureRouteKey
} from './interaction-structure-model'

type MetricKey = 'coverage' | 'owner' | 'progress' | 'queue' | 'risk' | 'sla' | 'version'
type MetricValueKey = 'medium' | 'reviewed' | 'running' | 'synced'

interface MetricSpec {
  key: MetricKey
  value?: string
  valueKey?: MetricValueKey
}

interface ItemSpec {
  children?: ItemSpec[]
  detail?: string
  detailComponent?: InteractionStructureDetailComponent
  filter: InteractionStructureItem['filter']
  filterTokens: string[]
  icon: InteractionStructureItem['icon']
  itemType?: InteractionStructureItem['itemType']
  key: string
  metrics?: MetricSpec[]
  progress?: number
  showDescription?: boolean
  showMeta?: boolean
  showTag?: boolean
  statusKey?: MetricValueKey
  variant: InteractionStructureItemVariant
}

const encodedSvgDataUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
const customCheckoutIcon: InteractionStructureItem['icon'] = {
  active: {
    svg: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M5 7.5h14v9H5z" fill="currentColor"/>' +
      '<path d="M8 10.5h5M8 13.5h8" stroke="var(--bg-color, white)" stroke-width="1.7" stroke-linecap="round"/>' +
      '</svg>',
    type: 'svg'
  },
  inactive: {
    svg: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M5 7.5h14v9H5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<path d="M8 10.5h5M8 13.5h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
      '</svg>',
    type: 'svg'
  }
}
const customDesignAssetIcon: InteractionStructureItem['icon'] = {
  active: {
    alt: '',
    src: encodedSvgDataUri(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
        '<rect x="3" y="5" width="18" height="14" rx="3" fill="#0f9bb5"/>' +
        '<circle cx="8" cy="10" r="1.4" fill="white"/>' +
        '<path d="M6.5 16l3.5-3 2.4 2 2.1-2.5L18 16" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>'
    ),
    type: 'image'
  },
  inactive: {
    alt: '',
    src: encodedSvgDataUri(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
        '<rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="#6b7280" stroke-width="1.8"/>' +
        '<circle cx="8" cy="10" r="1.4" fill="#6b7280"/>' +
        '<path d="M6.5 16l3.5-3 2.4 2 2.1-2.5L18 16" fill="none" stroke="#6b7280" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>'
    ),
    type: 'image'
  }
}

const itemSpecs: Record<InteractionStructureRouteKey, ItemSpec[]> = {
  operations: [
    {
      filter: 'active',
      filterTokens: ['schedule', 'cadence-nightly', 'owner-system'],
      children: [
        {
          detail: 'status / source',
          filter: 'active',
          filterTokens: ['schedule', 'cadence-nightly', 'owner-system'],
          icon: 'sync',
          key: 'opsDataSnapshot',
          statusKey: 'running',
          variant: 'activity'
        },
        {
          filter: 'active',
          filterTokens: ['schedule', 'cadence-nightly', 'owner-system'],
          icon: 'article',
          key: 'opsDigestPublish',
          showDescription: true,
          showTag: true,
          variant: 'summary'
        }
      ],
      icon: 'schedule',
      key: 'opsNightlyRun',
      progress: 64,
      showDescription: true,
      statusKey: 'running',
      variant: 'checkpoint'
    },
    {
      filter: 'active',
      filterTokens: ['flow', 'cadence-daily', 'owner-product'],
      children: [
        {
          filter: 'active',
          filterTokens: ['flow', 'cadence-daily', 'owner-product'],
          icon: 'support_agent',
          key: 'opsTriageQueue',
          showDescription: true,
          showTag: true,
          variant: 'summary'
        },
        {
          detail: 'smoke / routes',
          filter: 'active',
          filterTokens: ['flow', 'cadence-weekly', 'owner-product'],
          icon: 'fact_check',
          key: 'opsRegressionWatch',
          statusKey: 'reviewed',
          variant: 'activity'
        }
      ],
      icon: 'hub',
      itemType: 'groupTitle',
      key: 'opsReviewLoop',
      variant: 'compact'
    },
    {
      filter: 'done',
      filterTokens: ['archive', 'cadence-weekly', 'owner-system'],
      icon: 'inventory_2',
      key: 'opsArchiveSweep',
      variant: 'compact'
    }
  ],
  requests: [
    {
      filter: 'active',
      filterTokens: ['experience', 'priority-high', 'channel-web'],
      icon: customCheckoutIcon,
      key: 'requestCheckout',
      showDescription: true,
      showTag: true,
      variant: 'summary'
    },
    {
      filter: 'active',
      filterTokens: ['plugin', 'priority-medium', 'channel-extension'],
      icon: 'extension',
      key: 'requestPluginAudit',
      metrics: [
        { key: 'coverage', value: '7/9' },
        { key: 'risk', valueKey: 'medium' }
      ],
      variant: 'metrics'
    },
    {
      detail: 'sidebar / container',
      filter: 'done',
      filterTokens: ['structure', 'priority-low', 'channel-navigation'],
      icon: 'explore',
      key: 'requestNavigationRefresh',
      statusKey: 'reviewed',
      variant: 'activity'
    }
  ],
  resources: [
    {
      filter: 'active',
      filterTokens: ['design', 'source-design', 'freshness-current'],
      icon: customDesignAssetIcon,
      key: 'assetDesignSystem',
      metrics: [
        { key: 'version', value: 'v3.4' },
        { key: 'coverage', value: '86%' }
      ],
      variant: 'metrics'
    },
    {
      detail: 'apps/client -> apps/server/routes',
      filter: 'active',
      filterTokens: ['api', 'source-server', 'freshness-current'],
      icon: 'api',
      key: 'assetApiCatalog',
      statusKey: 'synced',
      variant: 'activity'
    },
    {
      filter: 'done',
      filterTokens: ['release', 'source-docs', 'freshness-archived'],
      icon: 'newspaper',
      key: 'assetReleaseNotes',
      showDescription: true,
      variant: 'summary'
    }
  ]
}

const metric = (t: TFunction, spec: MetricSpec): InteractionStructureMetric => ({
  label: t(`interactionStructure.itemMetrics.${spec.key}`),
  value: spec.valueKey == null
    ? spec.value ?? ''
    : t(`interactionStructure.itemMetricValues.${spec.valueKey}`)
})

const item = (t: TFunction, spec: ItemSpec): InteractionStructureItem => {
  const title = t(`interactionStructure.items.${spec.key}.title`)
  const description = t(`interactionStructure.items.${spec.key}.description`)
  const meta = t(`interactionStructure.items.${spec.key}.meta`)
  const displayedMeta = spec.showMeta === true ? meta : undefined
  const tag = t(`interactionStructure.items.${spec.key}.tag`)
  const metrics = spec.metrics?.map(metricSpec => metric(t, metricSpec))
  const status = spec.statusKey == null ? undefined : t(`interactionStructure.itemMetricValues.${spec.statusKey}`)

  return {
    description: spec.showDescription === true ? description : undefined,
    detail: spec.detail,
    detailComponent: spec.detailComponent ?? spec.variant,
    filter: spec.filter,
    filterTokens: spec.filterTokens,
    icon: spec.icon,
    itemType: spec.itemType,
    key: spec.key,
    children: spec.children?.map(childSpec => item(t, childSpec)),
    meta: displayedMeta,
    metrics,
    progress: spec.progress,
    searchText: [
      title,
      description,
      displayedMeta,
      spec.showTag === true ? tag : undefined,
      spec.detail,
      status,
      ...(metrics ?? []).flatMap(current => [current.label, current.value])
    ].filter(Boolean).join(' '),
    status,
    tags: spec.showTag === true ? [tag] : undefined,
    title,
    variant: spec.variant
  }
}

export const getInteractionStructureItems = (
  routeKey: InteractionStructureRouteKey,
  t: TFunction
): InteractionStructureItem[] => itemSpecs[routeKey].map(spec => item(t, spec))
