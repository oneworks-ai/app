import './InteractionStructureRoute.scss'

import { Switch, Tooltip } from 'antd'
import type { TFunction } from 'i18next'
import type { KeyboardEvent } from 'react'
import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import type { RouteContainerHeaderActionItem } from '@oneworks/components/route-layout'

import type { NavRailWindowBarAction } from '#~/components/NavRail'
import { DockPanel } from '#~/components/dock-panel/DockPanel'
import { renderIconAsset } from '#~/components/icons/IconAsset'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { RouteContainerHeader } from '#~/components/layout/RouteContainerHeader'
import { RouteContainerLayout } from '#~/components/layout/RouteContainerLayout'
import { RouteContainerPanelDockWorkspace } from '#~/components/layout/RouteContainerPanelTabs'
import type {
  RouteContainerPanelContextMenuContext,
  RouteContainerPanelDockTabItem
} from '#~/components/layout/RouteContainerPanelTabs'
import { useRouteSidebar } from '#~/components/layout/route-sidebar-context'
import { useRouteContainerSidebarOpener } from '#~/components/layout/use-route-container-sidebar-opener'
import type { NavRailMoreMenuSection } from '#~/components/nav-rail-more-menu'
import { useRoutePluginChrome } from '#~/plugins/route-plugin-chrome'

import {
  buildInteractionStructureNavigationTarget,
  buildInteractionStructurePath,
  getInteractionStructureItems,
  getInteractionStructureRouteBehavior,
  getInteractionStructureRouteContent,
  getInteractionStructureRoutes,
  resolveInteractionStructureRouteKey
} from './interaction-structure-model'
import type {
  InteractionStructureItem,
  InteractionStructureRouteConfig,
  InteractionStructureRouteContent
} from './interaction-structure-model'

interface InteractionStructureDetailRow {
  description: string
  icon: string
  key: string
  meta?: string
  title: string
}

type InteractionStructurePanelTabKey = 'item' | 'route' | 'summary'
type InteractionStructureRoutePanelKey = 'bottom' | 'side'
type InteractionStructurePanelContextMenuFactory = (
  context: RouteContainerPanelContextMenuContext<InteractionStructurePanelTabKey>
) => NavRailMoreMenuSection[]

interface InteractionStructureRoutePanelQueryState {
  activeTabs: Record<InteractionStructureRoutePanelKey, InteractionStructurePanelTabKey | null>
  bottomPanelOpen: boolean
  openedTabs: Record<InteractionStructureRoutePanelKey, InteractionStructurePanelTabKey[]>
  openPanels: InteractionStructureRoutePanelKey[]
  sidePanelOpen: boolean
}

interface InteractionStructureDetailSection {
  key: string
  rows: InteractionStructureDetailRow[]
  title: string
}

interface InteractionStructurePanelCreateMenuOptions {
  content?: InteractionStructureRouteContent
  panelKey: InteractionStructureRoutePanelKey
  route: InteractionStructureRouteConfig
  t: TFunction
  onOpenTab: (tabKey: InteractionStructurePanelTabKey) => void
}

interface InteractionStructureDebugToolsProps {
  fullscreen: boolean
  platform: InteractionStructureDebugPlatform
  t: TFunction
  onFullscreenChange: (enabled: boolean) => void
  onPlatformChange: (platform: InteractionStructureDebugPlatform) => void
}

const getHeaderActionStateKey = (routeKey: string, actionKey: string) => `${routeKey}:${actionKey}`
const INTERACTION_STRUCTURE_PANEL_KEYS: InteractionStructureRoutePanelKey[] = ['side', 'bottom']
const INTERACTION_STRUCTURE_PANEL_TAB_KEYS: InteractionStructurePanelTabKey[] = ['summary', 'route', 'item']
const INTERACTION_STRUCTURE_PANEL_DOCK_DRAG_SCOPE = 'interaction-structure-route-panels'
/**
 * Route-owned panel persistence contract for the interaction structure demo.
 *
 * `routePanels` stores visible panel regions. `sidePanelTab` /
 * `bottomPanelTab` store the active tab for each region, while
 * `sidePanelTabs` / `bottomPanelTabs` store the tabs the user has opened.
 * Closing a panel removes only its `routePanels` entry so active/opened tab
 * query state remains available for restore-on-return behavior.
 * The layout only receives slots from this derived state; it does not mutate
 * the URL or infer tab history.
 */
const ROUTE_PANELS_QUERY_PARAM = 'routePanels'
const ROUTE_SIDE_PANEL_ACTIVE_TAB_QUERY_PARAM = 'sidePanelTab'
const ROUTE_BOTTOM_PANEL_ACTIVE_TAB_QUERY_PARAM = 'bottomPanelTab'
const ROUTE_SIDE_PANEL_OPENED_TABS_QUERY_PARAM = 'sidePanelTabs'
const ROUTE_BOTTOM_PANEL_OPENED_TABS_QUERY_PARAM = 'bottomPanelTabs'
const DEBUG_DESKTOP_QUERY_PARAM = '__oneworks_desktop'
const DEBUG_FULLSCREEN_QUERY_PARAM = '__oneworks_fullscreen'

type InteractionStructureDebugPlatform = 'macos' | 'web' | 'windows'

const INTERACTION_STRUCTURE_DEBUG_PLATFORM_KEYS: InteractionStructureDebugPlatform[] = [
  'macos',
  'windows',
  'web'
]

const INTERACTION_STRUCTURE_PLATFORM_ICONS: Record<
  InteractionStructureDebugPlatform,
  { path: string; viewBox: string }
> = {
  macos: {
    path:
      'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701',
    viewBox: '0 0 24 24'
  },
  web: {
    path:
      'M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364zM12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728Z',
    viewBox: '0 0 24 24'
  },
  windows: {
    path: 'M0 0h121.329v121.329H0zm134.671 0H256v121.329H134.671zM0 134.671h121.329V256H0zm134.671 0H256V256H134.671z',
    viewBox: '0 0 256 256'
  }
}

const splitQueryList = (value: string | null) => value?.split(',').map(item => item.trim()).filter(Boolean) ?? []

const isRoutePanelKey = (value: string): value is InteractionStructureRoutePanelKey =>
  INTERACTION_STRUCTURE_PANEL_KEYS.includes(value as InteractionStructureRoutePanelKey)

const isPanelTabKey = (value: string): value is InteractionStructurePanelTabKey =>
  INTERACTION_STRUCTURE_PANEL_TAB_KEYS.includes(value as InteractionStructurePanelTabKey)

const uniqueKnownValues = <T extends string>(knownValues: readonly T[], values: readonly T[]) =>
  knownValues.filter(value => values.includes(value))

const readRoutePanels = (searchParams: URLSearchParams) =>
  uniqueKnownValues(
    INTERACTION_STRUCTURE_PANEL_KEYS,
    splitQueryList(searchParams.get(ROUTE_PANELS_QUERY_PARAM)).filter(isRoutePanelKey)
  )

const writeRoutePanels = (
  searchParams: URLSearchParams,
  panels: readonly InteractionStructureRoutePanelKey[]
) => {
  const value = uniqueKnownValues(INTERACTION_STRUCTURE_PANEL_KEYS, panels).join(',')
  if (value === '') {
    searchParams.delete(ROUTE_PANELS_QUERY_PARAM)
  } else {
    searchParams.set(ROUTE_PANELS_QUERY_PARAM, value)
  }
}

const getPanelActiveTabQueryParam = (panelKey: InteractionStructureRoutePanelKey) =>
  panelKey === 'side'
    ? ROUTE_SIDE_PANEL_ACTIVE_TAB_QUERY_PARAM
    : ROUTE_BOTTOM_PANEL_ACTIVE_TAB_QUERY_PARAM

const getPanelOpenedTabsQueryParam = (panelKey: InteractionStructureRoutePanelKey) =>
  panelKey === 'side'
    ? ROUTE_SIDE_PANEL_OPENED_TABS_QUERY_PARAM
    : ROUTE_BOTTOM_PANEL_OPENED_TABS_QUERY_PARAM

const readPanelActiveTab = (
  searchParams: URLSearchParams,
  panelKey: InteractionStructureRoutePanelKey
) => {
  const value = searchParams.get(getPanelActiveTabQueryParam(panelKey))
  return value != null && isPanelTabKey(value) ? value : null
}

const readPanelOpenedTabs = (
  searchParams: URLSearchParams,
  panelKey: InteractionStructureRoutePanelKey,
  activeTab: InteractionStructurePanelTabKey | null
) => {
  const tabs = uniqueKnownValues(
    INTERACTION_STRUCTURE_PANEL_TAB_KEYS,
    splitQueryList(searchParams.get(getPanelOpenedTabsQueryParam(panelKey))).filter(isPanelTabKey)
  )
  if (activeTab == null) return tabs

  return tabs.includes(activeTab) ? tabs : uniqueKnownValues(INTERACTION_STRUCTURE_PANEL_TAB_KEYS, [
    ...tabs,
    activeTab
  ])
}

const writePanelActiveTab = (
  searchParams: URLSearchParams,
  panelKey: InteractionStructureRoutePanelKey,
  activeTab: InteractionStructurePanelTabKey | null
) => {
  if (activeTab == null) {
    searchParams.delete(getPanelActiveTabQueryParam(panelKey))
  } else {
    searchParams.set(getPanelActiveTabQueryParam(panelKey), activeTab)
  }
}

const writePanelOpenedTabs = (
  searchParams: URLSearchParams,
  panelKey: InteractionStructureRoutePanelKey,
  openedTabs: readonly InteractionStructurePanelTabKey[]
) => {
  const value = uniqueKnownValues(INTERACTION_STRUCTURE_PANEL_TAB_KEYS, openedTabs).join(',')
  if (value === '') {
    searchParams.delete(getPanelOpenedTabsQueryParam(panelKey))
  } else {
    searchParams.set(getPanelOpenedTabsQueryParam(panelKey), value)
  }
}

/**
 * Reads all externally persisted panel state from URL query.
 *
 * Keep equivalent parsing at the route boundary when other pages adopt this
 * pattern. `RouteContainerLayout` only renders controlled slots and should not
 * know how a route persists visible panels, active tabs, or opened-tab history.
 */
const readRoutePanelQueryState = (
  searchParams: URLSearchParams
): InteractionStructureRoutePanelQueryState => {
  const openPanels = readRoutePanels(searchParams)
  const rawSideActiveTab = readPanelActiveTab(searchParams, 'side')
  const rawBottomActiveTab = readPanelActiveTab(searchParams, 'bottom')
  const sideOpenedTabs = readPanelOpenedTabs(searchParams, 'side', rawSideActiveTab)
  const bottomOpenedTabs = readPanelOpenedTabs(searchParams, 'bottom', rawBottomActiveTab)
  const sideActiveTab = rawSideActiveTab ?? sideOpenedTabs[0] ?? null
  const bottomActiveTab = rawBottomActiveTab ?? bottomOpenedTabs[0] ?? null

  return {
    activeTabs: {
      bottom: bottomActiveTab,
      side: sideActiveTab
    },
    bottomPanelOpen: openPanels.includes('bottom'),
    openedTabs: {
      bottom: bottomOpenedTabs,
      side: sideOpenedTabs
    },
    openPanels,
    sidePanelOpen: openPanels.includes('side')
  }
}

const getInteractionStructureDebugPlatform = (
  searchParams: URLSearchParams
): InteractionStructureDebugPlatform => {
  const normalizedValue = searchParams.get(DEBUG_DESKTOP_QUERY_PARAM)?.trim().toLowerCase()
  if (normalizedValue === 'windows' || normalizedValue === 'win' || normalizedValue === 'win32') {
    return 'windows'
  }

  if (
    normalizedValue === '' ||
    normalizedValue === '1' ||
    normalizedValue === 'true' ||
    normalizedValue === 'mac' ||
    normalizedValue === 'macos' ||
    normalizedValue === 'darwin'
  ) {
    return 'macos'
  }

  return 'web'
}

const getInteractionStructureDebugFullscreen = (searchParams: URLSearchParams) => {
  const normalizedValue = searchParams.get(DEBUG_FULLSCREEN_QUERY_PARAM)?.trim().toLowerCase()
  return normalizedValue === '' ||
    normalizedValue === '1' ||
    normalizedValue === 'true' ||
    normalizedValue === 'yes' ||
    normalizedValue === 'fullscreen'
}

function InteractionStructurePlatformIcon({ platform }: { platform: InteractionStructureDebugPlatform }) {
  const icon = INTERACTION_STRUCTURE_PLATFORM_ICONS[platform]

  return (
    <svg
      className='interaction-structure-debug-tools__platform-icon'
      viewBox={icon.viewBox}
      aria-hidden='true'
      focusable='false'
    >
      <path d={icon.path} fill='currentColor' />
    </svg>
  )
}

function InteractionStructureDebugTools({
  fullscreen,
  platform,
  t,
  onFullscreenChange,
  onPlatformChange
}: InteractionStructureDebugToolsProps) {
  const platformLabels: Record<InteractionStructureDebugPlatform, string> = {
    macos: t('interactionStructure.debugTools.platformMacos'),
    web: t('interactionStructure.debugTools.platformWeb'),
    windows: t('interactionStructure.debugTools.platformWindows')
  }
  const platformOptions: Array<{ key: InteractionStructureDebugPlatform; label: string }> =
    INTERACTION_STRUCTURE_DEBUG_PLATFORM_KEYS.map(key => ({
      key,
      label: platformLabels[key]
    }))
  const fullscreenLabel = fullscreen
    ? t('interactionStructure.debugTools.fullscreenOn')
    : t('interactionStructure.debugTools.fullscreenOff')
  const fullscreenControlLabel = t('interactionStructure.debugTools.fullscreen')
  const platformFieldLabel = t('interactionStructure.debugTools.platformFieldLabel')
  const fullscreenFieldLabel = t('interactionStructure.debugTools.fullscreenFieldLabel')
  const handlePlatformRadioKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = platformOptions.findIndex(option => option.key === platform)
    if (currentIndex < 0) {
      return
    }

    let nextIndex: number | null = null
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + platformOptions.length) % platformOptions.length
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % platformOptions.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = platformOptions.length - 1
    }

    if (nextIndex === null) {
      return
    }

    event.preventDefault()
    const nextPlatform = platformOptions[nextIndex]?.key
    if (!nextPlatform) {
      return
    }

    onPlatformChange(nextPlatform)
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-platform="${nextPlatform}"]`)
      ?.focus()
  }

  return (
    <div className='interaction-structure-debug-tools'>
      <div className='interaction-structure-debug-tools__field'>
        <span
          className='interaction-structure-debug-tools__label'
          title={t('interactionStructure.debugTools.platform')}
          aria-label={t('interactionStructure.debugTools.platform')}
        >
          <MaterialSymbol name='devices' aria-hidden='true' />
          <span className='interaction-structure-debug-tools__label-text'>
            {platformFieldLabel}
          </span>
        </span>
        <div
          className='interaction-structure-debug-tools__segmented'
          role='radiogroup'
          aria-label={t('interactionStructure.debugTools.platform')}
          onKeyDown={handlePlatformRadioKeyDown}
        >
          {platformOptions.map(option => (
            <Tooltip key={option.key} title={option.label} placement='top'>
              <button
                type='button'
                className={[
                  'interaction-structure-debug-tools__segment',
                  platform === option.key ? 'is-active' : ''
                ].filter(Boolean).join(' ')}
                data-platform={option.key}
                role='radio'
                title={option.label}
                aria-label={option.label}
                aria-checked={platform === option.key}
                tabIndex={platform === option.key ? 0 : -1}
                onClick={() => onPlatformChange(option.key)}
              >
                <InteractionStructurePlatformIcon platform={option.key} />
              </button>
            </Tooltip>
          ))}
        </div>
      </div>
      <div className='interaction-structure-debug-tools__field'>
        <span
          className='interaction-structure-debug-tools__label'
          title={t('interactionStructure.debugTools.fullscreen')}
          aria-label={t('interactionStructure.debugTools.fullscreen')}
        >
          <MaterialSymbol name='aspect_ratio' aria-hidden='true' />
          <span className='interaction-structure-debug-tools__label-text'>
            {fullscreenFieldLabel}
          </span>
        </span>
        <Tooltip title={fullscreenLabel} placement='top'>
          <Switch
            className='interaction-structure-debug-tools__switch'
            size='small'
            checked={fullscreen}
            title={fullscreenLabel}
            aria-label={fullscreenControlLabel}
            onChange={onFullscreenChange}
          />
        </Tooltip>
      </div>
    </div>
  )
}

const buildInteractionStructureDetailSections = (
  content: InteractionStructureRouteContent,
  t: TFunction
): InteractionStructureDetailSection[] => {
  const { component, item, route } = content
  const metricSummary = item.metrics?.map(metric => `${metric.label} ${metric.value}`).join(' · ')
  const childSummary = (item.children ?? []).map(child => child.title).join(' / ')
  const status = item.status ?? item.filter
  const primaryMeta = metricSummary ?? childSummary ?? status

  const row = (
    key: string,
    icon: string,
    meta?: string
  ): InteractionStructureDetailRow => ({
    description: t(`interactionStructure.detail.rows.${key}.description`, {
      component,
      item: item.title,
      route: route.label,
      status
    }),
    icon,
    key,
    meta,
    title: t(`interactionStructure.detail.rows.${key}.title`)
  })

  const scrollRows = Array.from({ length: 12 }, (_, index) => {
    const rowIndex = index + 1
    const scrollKey = `scroll-${rowIndex}`
    return {
      description: t('interactionStructure.detail.rows.scrollTrace.description', {
        component,
        count: rowIndex,
        item: item.title,
        route: route.label
      }),
      icon: ['line_axis', 'view_timeline', 'vertical_align_bottom'][index % 3],
      key: scrollKey,
      meta: `${rowIndex}/12`,
      title: t('interactionStructure.detail.rows.scrollTrace.title', {
        count: rowIndex
      })
    }
  })

  return [
    {
      key: 'structure',
      rows: [
        row('routeSlot', 'route', route.metric),
        row('activeItem', 'ads_click', item.key),
        row('headerState', 'web_asset', component),
        row('containerPadding', 'space_bar', '12px'),
        row('componentSwitch', 'rebase_edit', primaryMeta)
      ],
      title: t('interactionStructure.detail.sections.structure')
    },
    {
      key: 'behavior',
      rows: [
        row('sidebarLink', 'left_panel_open', route.key),
        row('filterState', 'filter_alt', item.filterTokens?.join(' / ')),
        row('contextActions', 'more_horiz', route.label),
        row('batchSelection', 'checklist', item.filter),
        row('itemRenderer', 'data_object', component)
      ],
      title: t('interactionStructure.detail.sections.behavior')
    },
    {
      key: 'scroll',
      rows: scrollRows,
      title: t('interactionStructure.detail.sections.scroll')
    }
  ]
}

const renderInteractionStructurePanelCreateMenuCustomItem = (
  route: InteractionStructureRouteConfig,
  t: TFunction
) => (
  <span className='interaction-structure-panel-create-menu__custom'>
    <span className='interaction-structure-panel-create-menu__custom-icon' aria-hidden='true'>
      {renderIconAsset({
        active: true,
        className: 'interaction-structure-panel-create-menu__custom-icon-asset',
        icon: route.icon
      })}
    </span>
    <span className='interaction-structure-panel-create-menu__custom-copy'>
      <strong>{t('interactionStructure.panels.create.customTitle')}</strong>
      <span>{t('interactionStructure.panels.create.customDescription', { entry: route.label })}</span>
    </span>
  </span>
)

const getInteractionStructurePanelRouteCreateItems = ({
  panelKey,
  route,
  t,
  onOpenTab
}: Omit<InteractionStructurePanelCreateMenuOptions, 'content'>) => ({
  operations: [
    {
      icon: 'event_repeat',
      key: `interaction-structure:${route.key}:${panelKey}:create-scheduled-lane`,
      label: t('interactionStructure.panels.create.operations.scheduledLane'),
      onSelect: () => onOpenTab('route')
    },
    {
      icon: 'monitoring',
      key: `interaction-structure:${route.key}:${panelKey}:create-monitor-view`,
      label: t('interactionStructure.panels.create.operations.monitorView'),
      onSelect: () => onOpenTab('summary')
    },
    {
      children: [
        {
          icon: 'dark_mode',
          key: `interaction-structure:${route.key}:${panelKey}:cadence-nightly`,
          label: t('interactionStructure.panels.create.operations.cadenceNightly'),
          onSelect: () => onOpenTab('item')
        },
        {
          icon: 'today',
          key: `interaction-structure:${route.key}:${panelKey}:cadence-daily`,
          label: t('interactionStructure.panels.create.operations.cadenceDaily'),
          onSelect: () => onOpenTab('route')
        },
        {
          icon: 'date_range',
          key: `interaction-structure:${route.key}:${panelKey}:cadence-weekly`,
          label: t('interactionStructure.panels.create.operations.cadenceWeekly'),
          onSelect: () => onOpenTab('route')
        }
      ],
      icon: 'schedule',
      key: `interaction-structure:${route.key}:${panelKey}:cadence-submenu`,
      label: t('interactionStructure.panels.create.operations.cadence')
    }
  ],
  requests: [
    {
      icon: 'note_add',
      key: `interaction-structure:${route.key}:${panelKey}:create-requirement`,
      label: t('interactionStructure.panels.create.requests.requirement'),
      onSelect: () => onOpenTab('route')
    },
    {
      icon: 'add_task',
      key: `interaction-structure:${route.key}:${panelKey}:create-follow-up`,
      label: t('interactionStructure.panels.create.requests.followUp'),
      onSelect: () => onOpenTab('item')
    },
    {
      children: [
        {
          icon: 'web_asset',
          key: `interaction-structure:${route.key}:${panelKey}:template-experience`,
          label: t('interactionStructure.panels.create.requests.experienceTemplate'),
          onSelect: () => onOpenTab('summary')
        },
        {
          icon: 'extension',
          key: `interaction-structure:${route.key}:${panelKey}:template-plugin`,
          label: t('interactionStructure.panels.create.requests.pluginTemplate'),
          onSelect: () => onOpenTab('summary')
        }
      ],
      icon: 'dashboard_customize',
      key: `interaction-structure:${route.key}:${panelKey}:template-submenu`,
      label: t('interactionStructure.panels.create.templates')
    }
  ],
  resources: [
    {
      icon: 'upload_file',
      key: `interaction-structure:${route.key}:${panelKey}:import-resource`,
      label: t('interactionStructure.panels.create.resources.importResource'),
      onSelect: () => onOpenTab('route')
    },
    {
      icon: 'description',
      key: `interaction-structure:${route.key}:${panelKey}:create-reference`,
      label: t('interactionStructure.panels.create.resources.referenceDoc'),
      onSelect: () => onOpenTab('item')
    },
    {
      children: [
        {
          icon: 'design_services',
          key: `interaction-structure:${route.key}:${panelKey}:source-design`,
          label: t('interactionStructure.panels.create.resources.designSource'),
          onSelect: () => onOpenTab('summary')
        },
        {
          icon: 'dns',
          key: `interaction-structure:${route.key}:${panelKey}:source-server`,
          label: t('interactionStructure.panels.create.resources.serverSource'),
          onSelect: () => onOpenTab('summary')
        },
        {
          icon: 'menu_book',
          key: `interaction-structure:${route.key}:${panelKey}:source-docs`,
          label: t('interactionStructure.panels.create.resources.docsSource'),
          onSelect: () => onOpenTab('summary')
        }
      ],
      icon: 'source',
      key: `interaction-structure:${route.key}:${panelKey}:source-submenu`,
      label: t('interactionStructure.panels.create.resources.source')
    }
  ]
}[route.key])

const getInteractionStructurePanelCreateMenuSections = ({
  content,
  panelKey,
  route,
  t,
  onOpenTab
}: InteractionStructurePanelCreateMenuOptions): NavRailMoreMenuSection[] => [
  {
    items: [
      {
        icon: 'widgets',
        key: `interaction-structure:${route.key}:${panelKey}:open-summary-tab`,
        label: t('interactionStructure.panels.create.summaryTab'),
        onSelect: () => onOpenTab('summary')
      },
      {
        icon: 'route',
        key: `interaction-structure:${route.key}:${panelKey}:open-route-tab`,
        label: t('interactionStructure.panels.create.routeTab'),
        onSelect: () => onOpenTab('route')
      },
      {
        disabled: content == null,
        icon: content == null ? 'tab' : 'fact_check',
        key: `interaction-structure:${route.key}:${panelKey}:open-item-tab`,
        label: content == null
          ? t('interactionStructure.panels.create.itemDisabled')
          : t('interactionStructure.panels.create.itemTab'),
        onSelect: () => onOpenTab('item')
      }
    ],
    key: `interaction-structure:${route.key}:${panelKey}:tabs`
  },
  {
    items: [
      {
        children: getInteractionStructurePanelRouteCreateItems({
          panelKey,
          route,
          t,
          onOpenTab
        }),
        icon: 'add_box',
        key: `interaction-structure:${route.key}:${panelKey}:entry-create`,
        label: t('interactionStructure.panels.create.entryTemplates')
      }
    ],
    key: `interaction-structure:${route.key}:${panelKey}:entry`
  },
  {
    items: [
      {
        className: 'interaction-structure-panel-create-menu__custom-item',
        content: renderInteractionStructurePanelCreateMenuCustomItem(route, t),
        key: `interaction-structure:${route.key}:${panelKey}:custom-rendered-item`,
        type: 'custom',
        onClick: () => onOpenTab('route')
      }
    ],
    key: `interaction-structure:${route.key}:${panelKey}:custom`
  }
]

function InteractionStructureSelectedPanel({
  content
}: {
  content?: InteractionStructureRouteContent
}) {
  if (content == null) return null

  const { component, item, route } = content
  const childItems = item.children ?? []
  const progress = Math.min(100, Math.max(0, item.progress ?? 0))
  const description = item.description ?? item.detail ?? route.description

  return (
    <section
      className={[
        'interaction-structure-route__selected',
        `is-${component}`
      ].join(' ')}
      data-component={component}
      data-selected-item-key={item.key}
    >
      <div className='interaction-structure-route__selected-header'>
        <span className='interaction-structure-route__selected-icon'>
          {renderIconAsset({
            active: true,
            className: 'interaction-structure-route__selected-icon-asset',
            icon: item.icon
          })}
        </span>
        <span className='interaction-structure-route__selected-title-group'>
          <span className='interaction-structure-route__selected-route'>{route.label}</span>
          <strong className='interaction-structure-route__selected-title'>{item.title}</strong>
        </span>
        {item.status != null && (
          <span className='interaction-structure-route__selected-status'>{item.status}</span>
        )}
      </div>
      <div className='interaction-structure-route__selected-body'>
        {component === 'metrics' && (
          <div className='interaction-structure-route__metric-grid'>
            {item.metrics?.map(metric => (
              <span key={`${metric.label}:${metric.value}`} className='interaction-structure-route__metric-card'>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </span>
            ))}
          </div>
        )}
        {component === 'checkpoint' && (
          <div className='interaction-structure-route__checkpoint'>
            <span className='interaction-structure-route__description'>{description}</span>
            <span className='interaction-structure-route__progress' aria-hidden='true'>
              <span style={{ width: `${progress}%` }} />
            </span>
          </div>
        )}
        {component === 'activity' && (
          <div className='interaction-structure-route__activity'>
            {item.status != null && (
              <span className='interaction-structure-route__activity-token'>{item.status}</span>
            )}
            {item.detail != null && (
              <span className='interaction-structure-route__activity-detail'>{item.detail}</span>
            )}
          </div>
        )}
        {component === 'compact' && (
          <div className='interaction-structure-route__compact'>
            {childItems.length > 0
              ? childItems.map(child => (
                <span key={child.key} className='interaction-structure-route__compact-row'>
                  {renderIconAsset({
                    active: false,
                    className: 'interaction-structure-route__compact-icon',
                    icon: child.icon
                  })}
                  <span>{child.title}</span>
                </span>
              ))
              : <span className='interaction-structure-route__description'>{description}</span>}
          </div>
        )}
        {component === 'summary' && (
          <div className='interaction-structure-route__summary'>
            <span className='interaction-structure-route__description'>{description}</span>
            {(item.tags?.length ?? 0) > 0 && (
              <span className='interaction-structure-route__selected-tags'>
                {item.tags?.map((tag, index) => (
                  <span key={index} className='interaction-structure-route__selected-tag'>{tag}</span>
                ))}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function InteractionStructureOverviewPanel({
  items,
  route,
  t
}: {
  items: InteractionStructureItem[]
  route?: InteractionStructureRouteConfig
  t: TFunction
}) {
  if (route == null) return null

  return (
    <section
      className='interaction-structure-route__overview'
      data-route-default-page={route.key}
    >
      <header className='interaction-structure-route__overview-header'>
        <span className='interaction-structure-route__overview-icon'>
          {renderIconAsset({
            active: true,
            className: 'interaction-structure-route__overview-icon-asset',
            icon: route.icon
          })}
        </span>
        <span className='interaction-structure-route__overview-title-group'>
          <span className='interaction-structure-route__overview-kicker'>
            {t('interactionStructure.overview.defaultPage')}
          </span>
          <strong className='interaction-structure-route__overview-title'>{route.label}</strong>
          <span className='interaction-structure-route__overview-description'>{route.description}</span>
        </span>
        <span className='interaction-structure-route__overview-metric'>{route.metric}</span>
      </header>
      <div className='interaction-structure-route__overview-items' role='list'>
        {items.map((item) => {
          const childSummary = item.children?.map(child => child.title).join(' / ')
          const description = item.description ?? item.detail ?? childSummary
          const meta = item.status ?? item.meta ?? item.filter

          return (
            <article
              key={item.key}
              className='interaction-structure-route__overview-item'
              role='listitem'
            >
              <span className='interaction-structure-route__overview-item-icon'>
                {renderIconAsset({
                  active: false,
                  className: 'interaction-structure-route__overview-item-icon-asset',
                  icon: item.icon
                })}
              </span>
              <span className='interaction-structure-route__overview-item-copy'>
                <strong>{item.title}</strong>
                {description != null && <span>{description}</span>}
              </span>
              {meta != null && <span className='interaction-structure-route__overview-item-meta'>{meta}</span>}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function InteractionStructureDetailSections({
  content,
  t
}: {
  content?: InteractionStructureRouteContent
  t: TFunction
}) {
  if (content == null) return null

  const sections = buildInteractionStructureDetailSections(content, t)

  return (
    <div className='interaction-structure-route__details'>
      {sections.map(section => (
        <section key={section.key} className='interaction-structure-route__detail-section'>
          <h2 className='interaction-structure-route__detail-section-title'>{section.title}</h2>
          <div className='interaction-structure-route__detail-rows'>
            {section.rows.map(row => (
              <article key={row.key} className='interaction-structure-route__detail-row'>
                <span className='interaction-structure-route__detail-row-icon' aria-hidden='true'>
                  {renderIconAsset({
                    active: false,
                    className: 'interaction-structure-route__detail-row-icon-asset',
                    icon: row.icon
                  })}
                </span>
                <span className='interaction-structure-route__detail-row-copy'>
                  <strong>{row.title}</strong>
                  <span>{row.description}</span>
                </span>
                {row.meta != null && (
                  <span className='interaction-structure-route__detail-row-meta'>{row.meta}</span>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function InteractionStructurePanelDefaultContent({
  content,
  panelKey,
  path,
  route,
  t
}: {
  content?: InteractionStructureRouteContent
  panelKey: InteractionStructureRoutePanelKey
  path: string
  route?: InteractionStructureRouteConfig
  t: TFunction
}) {
  if (route == null) return null

  const rows: Array<{ icon: string; key: string; label: string; value: string }> = [
    {
      icon: 'route',
      key: 'route',
      label: String(t('interactionStructure.panels.side.rows.route')),
      value: route.label
    },
    {
      icon: 'tab',
      key: 'item',
      label: String(t('interactionStructure.panels.bottom.rows.item')),
      value: String(content?.item.title ?? t('interactionStructure.panels.bottom.defaultItem'))
    },
    {
      icon: 'link',
      key: 'path',
      label: String(t('interactionStructure.panels.bottom.rows.path')),
      value: path
    }
  ]

  return (
    <section className={`interaction-structure-panel-default is-${panelKey}`}>
      <header className='interaction-structure-panel-default__header'>
        <span className='interaction-structure-panel-default__icon'>
          {renderIconAsset({
            active: true,
            className: 'interaction-structure-panel-default__icon-asset',
            icon: route.icon
          })}
        </span>
        <span className='interaction-structure-panel-default__copy'>
          <span>{t('interactionStructure.overview.defaultPage')}</span>
          <strong>{route.label}</strong>
          <em>{route.description}</em>
        </span>
        <strong className='interaction-structure-panel-default__metric'>{route.metric}</strong>
      </header>
      <div className='interaction-structure-panel-default__rows'>
        {rows.map(row => (
          <article key={row.key} className='interaction-structure-panel-default__row'>
            <span className='interaction-structure-panel-default__row-icon' aria-hidden='true'>
              <MaterialSymbol name={row.icon} />
            </span>
            <span className='interaction-structure-panel-default__row-copy'>
              <strong>{row.label}</strong>
              <span title={row.value}>{row.value}</span>
            </span>
          </article>
        ))}
      </div>
    </section>
  )
}

function InteractionStructureSidePanel({
  activeTab,
  content,
  openedTabs,
  path,
  route,
  t,
  getContextMenuSections,
  onClose,
  onTabDrop,
  onTabChange
}: {
  activeTab: InteractionStructurePanelTabKey | null
  content?: InteractionStructureRouteContent
  openedTabs: readonly InteractionStructurePanelTabKey[]
  path: string
  route?: InteractionStructureRouteConfig
  t: TFunction
  getContextMenuSections?: InteractionStructurePanelContextMenuFactory
  onClose: () => void
  onTabDrop?: (
    sourcePanelKey: InteractionStructureRoutePanelKey,
    tabKey: InteractionStructurePanelTabKey
  ) => void
  onTabChange: (
    tabKey: InteractionStructurePanelTabKey | null,
    openedTabs: InteractionStructurePanelTabKey[]
  ) => void
}) {
  if (route == null) return null

  const resolvePanelState = (tabKey: InteractionStructurePanelTabKey) => {
    const summary = tabKey === 'route'
      ? {
        description: route.description,
        icon: route.icon,
        title: route.label
      }
      : tabKey === 'item' && content != null
      ? {
        description: content.item.description ?? content.item.detail ?? content.component,
        icon: content.item.icon,
        title: content.item.title
      }
      : {
        description: content?.item.description ?? route.description,
        icon: content?.item.icon ?? route.icon,
        title: content?.item.title ?? route.label
      }
    const rows: Array<[string, string]> = tabKey === 'route'
      ? [
        [String(t('interactionStructure.panels.side.rows.route')), route.key],
        [String(t('interactionStructure.panels.side.rows.metric')), route.metric],
        [String(t('interactionStructure.panels.side.rows.path')), path]
      ]
      : tabKey === 'item' && content != null
      ? [
        [String(t('interactionStructure.panels.side.rows.route')), route.label],
        [String(t('interactionStructure.panels.side.rows.item')), String(content.item.title ?? '')],
        [String(t('interactionStructure.panels.side.rows.component')), content.component]
      ]
      : [
        [String(t('interactionStructure.panels.side.rows.route')), route.label],
        [
          String(t('interactionStructure.panels.side.rows.item')),
          content?.item.key ?? String(t('interactionStructure.panels.bottom.defaultItem'))
        ],
        [String(t('interactionStructure.panels.side.rows.component')), content?.component ?? 'overview']
      ]

    return { rows, summary }
  }
  const renderPanelContent = (tabKey: InteractionStructurePanelTabKey) => {
    const { rows, summary } = resolvePanelState(tabKey)

    return (
      <div className='interaction-structure-side-panel__body'>
        <section className='interaction-structure-side-panel__summary'>
          <span className='interaction-structure-side-panel__summary-icon'>
            {renderIconAsset({
              active: true,
              className: 'interaction-structure-side-panel__summary-icon-asset',
              icon: summary.icon
            })}
          </span>
          <span className='interaction-structure-side-panel__summary-copy'>
            <strong>{summary.title}</strong>
            <span>{summary.description}</span>
          </span>
        </section>
        <div className='interaction-structure-side-panel__rows'>
          {rows.map(([label, value]) => (
            <span key={label} className='interaction-structure-side-panel__row'>
              <span>{label}</span>
              <strong title={value}>{value}</strong>
            </span>
          ))}
        </div>
      </div>
    )
  }
  const tabs: Array<RouteContainerPanelDockTabItem<InteractionStructurePanelTabKey>> = [
    {
      content: ({ tabKey }) => renderPanelContent(tabKey),
      icon: 'widgets',
      key: 'summary',
      label: String(t('interactionStructure.panels.side.tabs.summary')),
      title: String(t('interactionStructure.panels.side.tabs.summary'))
    },
    {
      content: ({ tabKey }) => renderPanelContent(tabKey),
      icon: 'route',
      key: 'route',
      label: String(t('interactionStructure.panels.side.tabs.route')),
      title: String(t('interactionStructure.panels.side.tabs.route'))
    },
    {
      content: ({ tabKey }) => renderPanelContent(tabKey),
      icon: content == null ? 'tab' : 'fact_check',
      key: 'item',
      label: String(t('interactionStructure.panels.side.tabs.item')),
      title: String(t('interactionStructure.panels.side.tabs.item'))
    }
  ]
  const openPanelTab = (tabKey: InteractionStructurePanelTabKey) => {
    onTabChange(tabKey, uniqueKnownValues(INTERACTION_STRUCTURE_PANEL_TAB_KEYS, [...openedTabs, tabKey]))
  }
  const createMenuSections = getInteractionStructurePanelCreateMenuSections({
    content,
    panelKey: 'side',
    route,
    t,
    onOpenTab: openPanelTab
  })

  return (
    <div className='interaction-structure-side-panel'>
      <RouteContainerPanelDockWorkspace
        activeTab={activeTab}
        ariaLabel={t('interactionStructure.panels.side.title')}
        className='interaction-structure-side-panel__dock'
        createMenuLabel={t('interactionStructure.panels.create.label')}
        createMenuSections={createMenuSections}
        defaultContent={
          <InteractionStructurePanelDefaultContent
            content={content}
            panelKey='side'
            path={path}
            route={route}
            t={t}
          />
        }
        externalTabDrag={{
          canDrop: ({ sourceWorkspaceKey }) => sourceWorkspaceKey === 'bottom',
          droppable: true,
          onDrop: ({ sourceWorkspaceKey, tabKey }) => {
            if (isRoutePanelKey(sourceWorkspaceKey)) onTabDrop?.(sourceWorkspaceKey, tabKey)
          },
          scope: INTERACTION_STRUCTURE_PANEL_DOCK_DRAG_SCOPE,
          workspaceKey: 'side'
        }}
        getContextMenuSections={getContextMenuSections}
        headerActions={[{
          icon: 'right_panel_close',
          key: 'close',
          label: t('interactionStructure.panels.side.close'),
          onSelect: onClose
        }]}
        closable
        closeLabel={(title) => String(t('interactionStructure.panels.closeTab', { title }))}
        labelMode='icon-only'
        minOpenTabs={0}
        openedTabs={openedTabs}
        panelKey='side'
        storageKey={`interaction-structure:${route.key}:side-panel-layout`}
        tabs={tabs}
        onTabChange={onTabChange}
      />
    </div>
  )
}

function InteractionStructureBottomPanel({
  activeTab,
  content,
  isOpen = true,
  openedTabs,
  path,
  route,
  t,
  getContextMenuSections,
  onClose,
  onTabDrop,
  onTabChange
}: {
  activeTab: InteractionStructurePanelTabKey | null
  content?: InteractionStructureRouteContent
  isOpen?: boolean
  openedTabs: readonly InteractionStructurePanelTabKey[]
  path: string
  route?: InteractionStructureRouteConfig
  t: TFunction
  getContextMenuSections?: InteractionStructurePanelContextMenuFactory
  onClose: () => void
  onTabDrop?: (
    targetPanelKey: InteractionStructureRoutePanelKey,
    tabKey: InteractionStructurePanelTabKey
  ) => void
  onTabChange: (
    tabKey: InteractionStructurePanelTabKey | null,
    openedTabs: InteractionStructurePanelTabKey[]
  ) => void
}) {
  if (route == null) return null

  const getPanelRows = (
    tabKey: InteractionStructurePanelTabKey
  ): Array<{ icon: string; key: string; label: string; value: string }> =>
    tabKey === 'route'
      ? [
        {
          icon: 'route',
          key: 'path',
          label: String(t('interactionStructure.panels.bottom.rows.path')),
          value: path
        },
        {
          icon: 'folder',
          key: 'route',
          label: String(t('interactionStructure.panels.side.rows.route')),
          value: route.key
        },
        {
          icon: 'widgets',
          key: 'metric',
          label: String(t('interactionStructure.panels.side.rows.metric')),
          value: route.metric
        }
      ]
      : tabKey === 'item'
      ? [
        {
          icon: 'tab',
          key: 'item',
          label: String(t('interactionStructure.panels.bottom.rows.item')),
          value: content?.item.key ?? String(t('interactionStructure.panels.bottom.defaultItem'))
        },
        {
          icon: 'article',
          key: 'title',
          label: String(t('interactionStructure.panels.side.rows.item')),
          value: String(content?.item.title ?? route.label)
        },
        {
          icon: 'web_asset',
          key: 'slot',
          label: String(t('interactionStructure.panels.bottom.rows.slot')),
          value: content?.component ?? 'overview'
        }
      ]
      : [
        {
          icon: 'widgets',
          key: 'route',
          label: String(t('interactionStructure.panels.side.rows.route')),
          value: String(route.label)
        },
        {
          icon: 'tab',
          key: 'item',
          label: String(t('interactionStructure.panels.bottom.rows.item')),
          value: String(content?.item.title ?? t('interactionStructure.panels.bottom.defaultItem'))
        },
        {
          icon: 'web_asset',
          key: 'slot',
          label: String(t('interactionStructure.panels.bottom.rows.slot')),
          value: content?.component ?? 'overview'
        }
      ]
  const renderPanelContent = (tabKey: InteractionStructurePanelTabKey) => {
    const panelRows = getPanelRows(tabKey)

    return (
      <div className='interaction-structure-bottom-panel__body'>
        {panelRows.map(row => (
          <article key={row.key} className='interaction-structure-bottom-panel__row'>
            <span className='interaction-structure-bottom-panel__row-icon' aria-hidden='true'>
              <MaterialSymbol name={row.icon} />
            </span>
            <span className='interaction-structure-bottom-panel__row-copy'>
              <strong>{row.label}</strong>
              <span title={row.value}>{row.value}</span>
            </span>
          </article>
        ))}
      </div>
    )
  }
  const tabs: Array<RouteContainerPanelDockTabItem<InteractionStructurePanelTabKey>> = [
    {
      content: ({ tabKey }) => renderPanelContent(tabKey),
      icon: 'widgets',
      key: 'summary',
      label: String(t('interactionStructure.panels.bottom.tabs.summary')),
      title: String(t('interactionStructure.panels.bottom.tabs.summary'))
    },
    {
      content: ({ tabKey }) => renderPanelContent(tabKey),
      icon: 'route',
      key: 'route',
      label: String(t('interactionStructure.panels.bottom.tabs.route')),
      title: String(t('interactionStructure.panels.bottom.tabs.route'))
    },
    {
      content: ({ tabKey }) => renderPanelContent(tabKey),
      icon: content == null ? 'tab' : 'fact_check',
      key: 'item',
      label: String(t('interactionStructure.panels.bottom.tabs.item')),
      title: String(t('interactionStructure.panels.bottom.tabs.item'))
    }
  ]
  const openPanelTab = (tabKey: InteractionStructurePanelTabKey) => {
    onTabChange(tabKey, uniqueKnownValues(INTERACTION_STRUCTURE_PANEL_TAB_KEYS, [...openedTabs, tabKey]))
  }
  const createMenuSections = getInteractionStructurePanelCreateMenuSections({
    content,
    panelKey: 'bottom',
    route,
    t,
    onOpenTab: openPanelTab
  })

  return (
    <DockPanel
      allowFullscreen
      className='interaction-structure-bottom-panel'
      closeIcon='bottom_panel_close'
      closeLabel={t('interactionStructure.panels.bottom.close')}
      defaultHeight={240}
      fullscreenEnterLabel={t('common.enterFullscreen')}
      fullscreenExitLabel={t('common.exitFullscreen')}
      isOpen={isOpen}
      maxHeight={520}
      minHeight='20%'
      hideHeader
      resizeLabel={t('interactionStructure.panels.bottom.resize')}
      storageKey={`interaction-structure:${route.key}:bottom-panel-height`}
      onClose={onClose}
    >
      {({ isFullscreen, onToggleFullscreen }) => (
        <RouteContainerPanelDockWorkspace
          activeTab={activeTab}
          ariaLabel={t('interactionStructure.panels.bottom.title')}
          className='interaction-structure-bottom-panel__dock'
          closable
          closeLabel={(title) => String(t('interactionStructure.panels.closeTab', { title }))}
          createMenuLabel={t('interactionStructure.panels.create.label')}
          createMenuSections={createMenuSections}
          defaultContent={
            <InteractionStructurePanelDefaultContent
              content={content}
              panelKey='bottom'
              path={path}
              route={route}
              t={t}
            />
          }
          externalTabDrag={{
            canDrop: ({ targetWorkspaceKey }) => targetWorkspaceKey === 'side',
            draggable: true,
            dropTargets: [{
              selector: '.interaction-structure-route-layout > .route-container-layout__main',
              targetWorkspaceKey: 'side'
            }],
            onDrop: ({ targetWorkspaceKey, tabKey }) => {
              if (isRoutePanelKey(targetWorkspaceKey)) onTabDrop?.(targetWorkspaceKey, tabKey)
            },
            scope: INTERACTION_STRUCTURE_PANEL_DOCK_DRAG_SCOPE,
            workspaceKey: 'bottom'
          }}
          getContextMenuSections={getContextMenuSections}
          headerActions={[
            {
              active: isFullscreen,
              activeIcon: 'fullscreen_exit',
              icon: 'fullscreen',
              key: 'fullscreen',
              label: isFullscreen ? t('common.exitFullscreen') : t('common.enterFullscreen'),
              onSelect: onToggleFullscreen
            },
            {
              icon: 'bottom_panel_close',
              key: 'close',
              label: t('interactionStructure.panels.bottom.close'),
              onSelect: onClose
            }
          ]}
          labelMode='responsive'
          minOpenTabs={0}
          openedTabs={openedTabs}
          panelKey='bottom'
          storageKey={`interaction-structure:${route.key}:bottom-panel-layout`}
          tabs={tabs}
          onTabChange={onTabChange}
        />
      )}
    </DockPanel>
  )
}

export function InteractionStructureRoute() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { structureRoute } = useParams()
  const [searchParams] = useSearchParams()
  const { openRouteSidebar } = useRouteContainerSidebarOpener()
  const [activeHeaderActionKeys, setActiveHeaderActionKeys] = useState<Set<string>>(
    () => new Set([getHeaderActionStateKey('requests', 'primary')])
  )
  const {
    clearRouteMoreMenu,
    clearRouteWindowBar,
    hasRouteSidebarProvider,
    setRouteMoreMenu,
    setRouteWindowBar
  } = useRouteSidebar()
  const routeKey = resolveInteractionStructureRouteKey(structureRoute)
  const { headerActions: routePluginHeaderActions } = useRoutePluginChrome(routeKey)
  const routes = useMemo(() => getInteractionStructureRoutes(t), [t])
  const currentRoute = routes.find(route => route.key === routeKey) ?? routes[0]
  const routeItems = useMemo(() => getInteractionStructureItems(routeKey, t), [routeKey, t])
  const selectedItemKey = searchParams.get('item')
  const routePanelQueryState = useMemo(() => readRoutePanelQueryState(searchParams), [searchParams])
  const isRouteSidePanelOpen = routePanelQueryState.sidePanelOpen
  const isRouteBottomPanelOpen = routePanelQueryState.bottomPanelOpen
  const debugPlatform = getInteractionStructureDebugPlatform(searchParams)
  const isDebugFullscreen = getInteractionStructureDebugFullscreen(searchParams)
  const routeContent = useMemo(() =>
    currentRoute == null
      ? undefined
      : getInteractionStructureRouteContent({
        items: routeItems,
        route: currentRoute,
        selectedItemKey
      }), [currentRoute, routeItems, selectedItemKey])
  const routeBehavior = useMemo(() => getInteractionStructureRouteBehavior(routeKey, t), [routeKey, t])
  const navigateToRouteOverview = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('item')

    const nextSearch = nextParams.toString()
    void navigate({
      pathname: buildInteractionStructurePath(routeKey),
      search: nextSearch === '' ? '' : `?${nextSearch}`
    })
  }, [navigate, routeKey, searchParams])
  const navigateWithSearchParams = useCallback((nextParams: URLSearchParams) => {
    const nextSearch = nextParams.toString()
    void navigate({
      pathname: buildInteractionStructurePath(routeKey),
      search: nextSearch === '' ? '' : `?${nextSearch}`
    }, { replace: true })
  }, [navigate, routeKey])
  const setDebugPlatform = useCallback((platform: InteractionStructureDebugPlatform) => {
    const nextParams = new URLSearchParams(searchParams)
    if (platform === 'web') {
      nextParams.delete(DEBUG_DESKTOP_QUERY_PARAM)
    } else {
      nextParams.set(DEBUG_DESKTOP_QUERY_PARAM, platform)
    }

    navigateWithSearchParams(nextParams)
  }, [navigateWithSearchParams, searchParams])
  const setDebugFullscreen = useCallback((enabled: boolean) => {
    const nextParams = new URLSearchParams(searchParams)
    if (enabled) {
      nextParams.set(DEBUG_FULLSCREEN_QUERY_PARAM, '1')
    } else {
      nextParams.delete(DEBUG_FULLSCREEN_QUERY_PARAM)
    }

    navigateWithSearchParams(nextParams)
  }, [navigateWithSearchParams, searchParams])
  const updateRoutePanelSearch = useCallback((
    updater: (nextParams: URLSearchParams) => void
  ) => {
    const nextParams = new URLSearchParams(searchParams)
    updater(nextParams)
    navigateWithSearchParams(nextParams)
  }, [navigateWithSearchParams, searchParams])
  const setRoutePanelOpen = useCallback((
    panelKey: InteractionStructureRoutePanelKey,
    isOpen: boolean
  ) => {
    updateRoutePanelSearch((nextParams) => {
      const nextPanels = new Set(readRoutePanels(nextParams))
      if (isOpen) {
        nextPanels.add(panelKey)
      } else {
        nextPanels.delete(panelKey)
      }

      writeRoutePanels(nextParams, Array.from(nextPanels))
    })
  }, [updateRoutePanelSearch])
  const setRoutePanelActiveTab = useCallback((
    panelKey: InteractionStructureRoutePanelKey,
    tabKey: InteractionStructurePanelTabKey | null,
    openedTabs: readonly InteractionStructurePanelTabKey[]
  ) => {
    updateRoutePanelSearch((nextParams) => {
      writePanelActiveTab(nextParams, panelKey, tabKey)
      writePanelOpenedTabs(nextParams, panelKey, openedTabs)
    })
  }, [updateRoutePanelSearch])
  const openDroppedRoutePanelTab = useCallback((
    sourcePanelKey: InteractionStructureRoutePanelKey,
    targetPanelKey: InteractionStructureRoutePanelKey,
    tabKey: InteractionStructurePanelTabKey
  ) => {
    if (sourcePanelKey === targetPanelKey) return

    updateRoutePanelSearch((nextParams) => {
      const nextPanels = new Set(readRoutePanels(nextParams))
      nextPanels.add(targetPanelKey)
      writeRoutePanels(nextParams, Array.from(nextPanels))

      const targetActiveTab = readPanelActiveTab(nextParams, targetPanelKey)
      const targetOpenedTabs = readPanelOpenedTabs(nextParams, targetPanelKey, targetActiveTab)
      writePanelActiveTab(nextParams, targetPanelKey, tabKey)
      writePanelOpenedTabs(nextParams, targetPanelKey, [
        ...targetOpenedTabs,
        tabKey
      ])
    })
  }, [updateRoutePanelSearch])
  const getPanelContextMenuSections = useCallback<InteractionStructurePanelContextMenuFactory>((context) => {
    const contextPanelKey = context.panelKey
    const panelKey: InteractionStructureRoutePanelKey = contextPanelKey != null && isRoutePanelKey(contextPanelKey)
      ? contextPanelKey
      : 'side'
    const panelLabel = panelKey === 'side'
      ? String(t('interactionStructure.panels.side.title'))
      : String(t('interactionStructure.panels.bottom.title'))
    const allTabKeys = uniqueKnownValues(
      INTERACTION_STRUCTURE_PANEL_TAB_KEYS,
      context.tabs.map(tab => tab.key)
    )
    const activatePanelTabs = (
      activeTab: InteractionStructurePanelTabKey | null,
      openedTabKeys: readonly InteractionStructurePanelTabKey[]
    ) => {
      updateRoutePanelSearch((nextParams) => {
        const nextPanels = new Set(readRoutePanels(nextParams))
        nextPanels.add(panelKey)
        writeRoutePanels(nextParams, Array.from(nextPanels))
        writePanelActiveTab(nextParams, panelKey, activeTab)
        writePanelOpenedTabs(nextParams, panelKey, openedTabKeys)
      })
    }

    if (context.target === 'blank' || context.tab == null) {
      return [
        {
          items: [
            {
              icon: 'select_all',
              key: `interaction-structure:${routeKey}:${panelKey}:tabs:open-all`,
              label: t('interactionStructure.panels.contextMenu.openAllTabs', { panel: panelLabel }),
              onSelect: () => activatePanelTabs(context.activeTab ?? allTabKeys[0] ?? null, allTabKeys)
            },
            {
              icon: 'reset_focus',
              key: `interaction-structure:${routeKey}:${panelKey}:tabs:reset-default`,
              label: t('interactionStructure.panels.contextMenu.resetDefaultPage', { panel: panelLabel }),
              onSelect: () => activatePanelTabs(null, [])
            }
          ],
          key: `interaction-structure:${routeKey}:${panelKey}:blank-tabs`
        }
      ]
    }

    const tab = context.tab
    return [
      {
        items: [
          {
            active: context.isActive,
            icon: tab.icon,
            key: `interaction-structure:${routeKey}:${panelKey}:${tab.key}:select`,
            label: t('interactionStructure.panels.contextMenu.selectTab', { tab: tab.label }),
            onSelect: () => context.selectTab(tab.key)
          },
          {
            icon: 'tab_close',
            key: `interaction-structure:${routeKey}:${panelKey}:${tab.key}:keep-only`,
            label: t('interactionStructure.panels.contextMenu.keepOnlyTab', { tab: tab.label }),
            onSelect: () => activatePanelTabs(tab.key, [tab.key])
          }
        ],
        key: `interaction-structure:${routeKey}:${panelKey}:${tab.key}:tab-actions`
      },
      {
        items: [
          {
            disabled: true,
            icon: 'info',
            key: `interaction-structure:${routeKey}:${panelKey}:${tab.key}:metadata`,
            label: t('interactionStructure.panels.contextMenu.tabMetadata', {
              panel: panelLabel,
              tab: tab.label
            })
          }
        ],
        key: `interaction-structure:${routeKey}:${panelKey}:${tab.key}:metadata`
      }
    ]
  }, [routeKey, t, updateRoutePanelSearch])
  const headerBreadcrumb = useMemo(() => (
    selectedItemKey == null || routeContent == null
      ? undefined
      : {
        currentTitle: routeContent.item.title,
        onBack: navigateToRouteOverview,
        parentTitle: currentRoute?.label
      }
  ), [
    currentRoute?.label,
    navigateToRouteOverview,
    routeContent,
    selectedItemKey
  ])
  const isHeaderActionActive = useCallback((actionKey: string) => (
    activeHeaderActionKeys.has(getHeaderActionStateKey(routeKey, actionKey))
  ), [activeHeaderActionKeys, routeKey])
  const toggleHeaderAction = useCallback((actionKey: string) => {
    const stateKey = getHeaderActionStateKey(routeKey, actionKey)
    setActiveHeaderActionKeys((current) => {
      const next = new Set(current)
      if (next.has(stateKey)) {
        next.delete(stateKey)
      } else {
        next.add(stateKey)
      }
      return next
    })
  }, [routeKey])
  const headerActions = useMemo<RouteContainerHeaderActionItem[]>(() => {
    const actions: RouteContainerHeaderActionItem[] = [
      {
        active: isHeaderActionActive('primary'),
        activeIcon: routeBehavior.primaryAction.activeIcon,
        activeLabel: routeBehavior.primaryAction.activeLabel,
        icon: routeBehavior.primaryAction.icon,
        key: 'primary',
        label: routeBehavior.primaryAction.label,
        onSelect: () => toggleHeaderAction('primary')
      },
      {
        active: isHeaderActionActive('favorite'),
        activeIcon: routeBehavior.favoriteAction.activeIcon,
        activeLabel: routeBehavior.favoriteAction.activeLabel,
        icon: routeBehavior.favoriteAction.icon,
        key: 'favorite',
        label: routeBehavior.favoriteAction.label,
        onSelect: () => toggleHeaderAction('favorite')
      },
      {
        danger: routeBehavior.archiveAction.danger,
        icon: routeBehavior.archiveAction.icon,
        key: 'archive',
        label: routeBehavior.archiveAction.label
      }
    ]

    if (!isRouteBottomPanelOpen) {
      actions.push({
        icon: 'bottom_panel_open',
        key: 'bottom-panel',
        label: t('interactionStructure.panels.bottom.open'),
        onSelect: () => setRoutePanelOpen('bottom', true)
      })
    }

    if (!isRouteSidePanelOpen) {
      actions.push({
        icon: 'right_panel_open',
        key: 'side-panel',
        label: t('interactionStructure.panels.side.open'),
        onSelect: () => setRoutePanelOpen('side', true)
      })
    }

    return [
      ...actions,
      ...routePluginHeaderActions
    ]
  }, [
    isHeaderActionActive,
    isRouteBottomPanelOpen,
    isRouteSidePanelOpen,
    routePluginHeaderActions,
    routeBehavior,
    setRoutePanelOpen,
    t,
    toggleHeaderAction
  ])
  const windowBarActions = useMemo<NavRailWindowBarAction[]>(() => [
    {
      active: isHeaderActionActive('primary'),
      activeIcon: routeBehavior.primaryAction.activeIcon,
      activeLabel: routeBehavior.primaryAction.activeLabel,
      icon: routeBehavior.primaryAction.icon,
      key: 'primary',
      label: routeBehavior.primaryAction.label,
      onSelect: () => toggleHeaderAction('primary')
    },
    {
      active: isHeaderActionActive('favorite'),
      activeIcon: routeBehavior.favoriteAction.activeIcon,
      activeLabel: routeBehavior.favoriteAction.activeLabel,
      icon: routeBehavior.favoriteAction.icon,
      key: 'favorite',
      label: routeBehavior.favoriteAction.label,
      onSelect: () => toggleHeaderAction('favorite')
    }
  ], [isHeaderActionActive, routeBehavior, toggleHeaderAction])
  const routeMoreMenuSections = useMemo<NavRailMoreMenuSection[]>(() => {
    const primaryActive = isHeaderActionActive('primary')
    const favoriteActive = isHeaderActionActive('favorite')

    return [
      {
        items: [
          {
            active: primaryActive,
            activeIcon: routeBehavior.primaryAction.activeIcon,
            icon: routeBehavior.primaryAction.icon,
            key: `interaction-structure:${routeKey}:primary`,
            label: primaryActive
              ? routeBehavior.primaryAction.activeLabel ?? routeBehavior.primaryAction.label
              : routeBehavior.primaryAction.label,
            onSelect: () => toggleHeaderAction('primary')
          },
          {
            active: favoriteActive,
            activeIcon: routeBehavior.favoriteAction.activeIcon,
            icon: routeBehavior.favoriteAction.icon,
            key: `interaction-structure:${routeKey}:favorite`,
            label: favoriteActive
              ? routeBehavior.favoriteAction.activeLabel ?? routeBehavior.favoriteAction.label
              : routeBehavior.favoriteAction.label,
            onSelect: () => toggleHeaderAction('favorite')
          }
        ],
        key: `interaction-structure:${routeKey}:primary-actions`
      },
      {
        items: [
          ...routeBehavior.contextActions.map((action, index) => ({
            icon: action.icon,
            key: `interaction-structure:${routeKey}:${action.key ?? `context-${index}`}`,
            label: action.label
          })),
          {
            danger: routeBehavior.archiveAction.danger,
            icon: routeBehavior.archiveAction.icon,
            key: `interaction-structure:${routeKey}:archive`,
            label: routeBehavior.archiveAction.label
          }
        ],
        key: `interaction-structure:${routeKey}:context-actions`
      }
    ]
  }, [
    isHeaderActionActive,
    routeBehavior,
    routeKey,
    toggleHeaderAction
  ])
  const routeMoreMenuContextMenuSections = useMemo<NavRailMoreMenuSection[]>(() => [
    {
      items: [
        {
          icon: 'playlist_add_check',
          key: `interaction-structure:${routeKey}:context:configure-actions`,
          label: t('interactionStructure.moreMenuContext.configureActions')
        },
        {
          icon: 'visibility_off',
          key: `interaction-structure:${routeKey}:context:hide-archive-action`,
          label: t('interactionStructure.moreMenuContext.hideArchiveAction')
        }
      ],
      key: `interaction-structure:${routeKey}:more-menu-context`
    }
  ], [routeKey, t])
  const routeMoreMenuFooterBefore = useMemo(() => (
    <div className='interaction-structure-footer-stack'>
      <div className='interaction-structure-footer-slot'>
        <span className='material-symbols-rounded interaction-structure-footer-slot__icon' aria-hidden='true'>
          route
        </span>
        <span className='interaction-structure-footer-slot__text'>
          {currentRoute?.activeLabel ?? currentRoute?.label}
        </span>
      </div>
      <InteractionStructureDebugTools
        fullscreen={isDebugFullscreen}
        platform={debugPlatform}
        t={t}
        onFullscreenChange={setDebugFullscreen}
        onPlatformChange={setDebugPlatform}
      />
    </div>
  ), [
    currentRoute?.activeLabel,
    currentRoute?.label,
    debugPlatform,
    isDebugFullscreen,
    setDebugFullscreen,
    setDebugPlatform,
    t
  ])
  const routeMoreMenuFooterAfter = useMemo(() => (
    <div className='interaction-structure-footer-slot is-muted'>
      <span className='material-symbols-rounded interaction-structure-footer-slot__icon' aria-hidden='true'>
        data_object
      </span>
      <span className='interaction-structure-footer-slot__text'>{currentRoute?.metric}</span>
    </div>
  ), [currentRoute?.metric])

  useLayoutEffect(() => {
    if (!hasRouteSidebarProvider) return undefined

    const key = `interaction-structure-window-bar:${routeKey}`
    setRouteWindowBar({
      actions: windowBarActions,
      key
    })

    return () => clearRouteWindowBar(key)
  }, [
    clearRouteWindowBar,
    hasRouteSidebarProvider,
    routeKey,
    setRouteWindowBar,
    windowBarActions
  ])

  useLayoutEffect(() => {
    if (!hasRouteSidebarProvider) return undefined

    const key = `interaction-structure-more-menu:${routeKey}`
    setRouteMoreMenu({
      contextMenuSections: routeMoreMenuContextMenuSections,
      footerAfter: routeMoreMenuFooterAfter,
      footerBefore: routeMoreMenuFooterBefore,
      key,
      sections: routeMoreMenuSections
    })

    return () => clearRouteMoreMenu(key)
  }, [
    clearRouteMoreMenu,
    hasRouteSidebarProvider,
    routeKey,
    routeMoreMenuFooterAfter,
    routeMoreMenuFooterBefore,
    routeMoreMenuContextMenuSections,
    routeMoreMenuSections,
    setRouteMoreMenu
  ])

  if (structureRoute !== routeKey) {
    return (
      <Navigate
        to={buildInteractionStructureNavigationTarget(routeKey, searchParams)}
        replace
      />
    )
  }

  return (
    <RouteContainerLayout
      className='interaction-structure-route-layout'
      bottomPanel={isRouteBottomPanelOpen
        ? ({ isClosing, path }) => (
          <InteractionStructureBottomPanel
            activeTab={routePanelQueryState.activeTabs.bottom}
            content={routeContent}
            isOpen={!isClosing}
            openedTabs={routePanelQueryState.openedTabs.bottom}
            path={path}
            route={currentRoute}
            t={t}
            getContextMenuSections={getPanelContextMenuSections}
            onClose={() => setRoutePanelOpen('bottom', false)}
            onTabDrop={(targetPanelKey, tabKey) => openDroppedRoutePanelTab('bottom', targetPanelKey, tabKey)}
            onTabChange={(tabKey, openedTabs) => setRoutePanelActiveTab('bottom', tabKey, openedTabs)}
          />
        )
        : undefined}
      header={
        <RouteContainerHeader
          actionItems={headerActions}
          breadcrumb={headerBreadcrumb}
          icon={currentRoute?.icon}
          title={currentRoute?.label}
          onCreateSession={() => {
            void navigate('/')
          }}
          onOpenSidebar={openRouteSidebar}
        />
      }
      sidePanel={isRouteSidePanelOpen
        ? ({ path }) => (
          <InteractionStructureSidePanel
            activeTab={routePanelQueryState.activeTabs.side}
            content={routeContent}
            openedTabs={routePanelQueryState.openedTabs.side}
            path={path}
            route={currentRoute}
            t={t}
            getContextMenuSections={getPanelContextMenuSections}
            onClose={() => setRoutePanelOpen('side', false)}
            onTabDrop={(sourcePanelKey, tabKey) => openDroppedRoutePanelTab(sourcePanelKey, 'side', tabKey)}
            onTabChange={(tabKey, openedTabs) => setRoutePanelActiveTab('side', tabKey, openedTabs)}
          />
        )
        : undefined}
      sidePanelClassName='interaction-structure-route-layout__side-panel'
      sidePanelResize={{
        defaultWidth: 300,
        minWidth: 240,
        resizeHandleAriaLabel: t('interactionStructure.panels.side.resize'),
        resizeHandleTitle: t('interactionStructure.panels.side.resize'),
        storageKey: `interaction-structure:${currentRoute?.key ?? routeKey}:side-panel-width`
      }}
    >
      {({ path }) => (
        <div
          className='interaction-structure-route'
          data-route-path={path}
          data-selected-item-key={routeContent?.item.key}
        >
          <div className='interaction-structure-route__content'>
            {routeContent == null
              ? (
                <InteractionStructureOverviewPanel
                  items={routeItems}
                  route={currentRoute}
                  t={t}
                />
              )
              : (
                <>
                  <InteractionStructureSelectedPanel content={routeContent} />
                  <InteractionStructureDetailSections content={routeContent} t={t} />
                </>
              )}
          </div>
        </div>
      )}
    </RouteContainerLayout>
  )
}
