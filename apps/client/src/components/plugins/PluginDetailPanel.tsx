/* eslint-disable max-lines -- plugin detail panel coordinates README, extension, asset, and overview tabs. */

import { Tooltip } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import type { PluginDetailAssetKind } from '#~/plugins/api'
import type { PluginContextValue } from '#~/plugins/plugin-context'
import {
  buildPluginContributionItemPreferenceId,
  readDisabledPluginContributionGroups,
  readDisabledPluginContributionItems,
  writeDisabledPluginContributionGroups,
  writeDisabledPluginContributionItems
} from '#~/plugins/plugin-contribution-preferences'
import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'

import { PluginAssetSection } from './PluginAssetSection'
import { PluginConfigSection } from './PluginConfigSection'
import { PluginRows, getPluginContributions, pluginContributionGroups } from './PluginDetailSections'
import type { PluginDetailRow } from './PluginDetailSections'
import { PluginDetailView } from './PluginDetailView'
import { PluginReadmeSection } from './PluginReadmeSection'
import { usePluginAssets } from './use-plugin-assets'
import { usePluginReadme } from './use-plugin-readme'

interface PluginDetailPanelProps {
  plugin: PluginRuntimeInstance
  pluginServerBaseUrl?: string
  snapshot: PluginContextValue['snapshot']
  onContributionPreferencesChange: () => void | Promise<void>
  onOptionsChange: () => void | Promise<void>
}

const runtimeSlotLabelKeys: Record<string, string> = {
  'chat.header.actions': 'pluginDetail.groups.chatHeaderActions',
  'chat.header.moreMenu': 'pluginDetail.groups.chatHeaderMoreMenu',
  'chat.interactionPanel.emptyActions': 'pluginDetail.groups.chatInteractionPanelEmptyActions',
  'launcher.searchProviders': 'pluginDetail.groups.launcherSearchProviders',
  'nav.footer.before': 'pluginDetail.groups.navFooterBefore',
  'nav.items': 'pluginDetail.groups.navItems',
  'nav.moreMenu': 'pluginDetail.groups.navMoreMenu',
  'route.header.actions': 'pluginDetail.groups.routeHeaderActions',
  'route.moreMenu.items': 'pluginDetail.groups.routeMoreMenuItems',
  'route.sidebar.contextMenu': 'pluginDetail.groups.routeSidebarContextMenu',
  'route.windowBar.actions': 'pluginDetail.groups.routeWindowBarActions',
  'settings.pages': 'pluginDetail.groups.settingsPages',
  'workbench.addMenu': 'pluginDetail.groups.workbenchAddMenu',
  'workbench.tabs': 'pluginDetail.groups.workbenchTabs',
  'workspace.drawer.tabs': 'pluginDetail.groups.workspaceDrawerTabs'
}

const PLUGIN_DETAIL_TAB_QUERY_PARAM = 'tab'
const pluginDetailTabKeys = ['readme', 'contributions', 'config', 'skills', 'mcp', 'hooks'] as const
type PluginDetailTabKey = typeof pluginDetailTabKeys[number]
const pluginDetailTabKeySet = new Set<string>(pluginDetailTabKeys)

const resolvePluginDetailTabKey = (value: string | null): PluginDetailTabKey => (
  value != null && pluginDetailTabKeySet.has(value) ? value as PluginDetailTabKey : 'readme'
)

export function PluginDetailPanel({
  onContributionPreferencesChange,
  onOptionsChange,
  plugin,
  pluginServerBaseUrl,
  snapshot
}: PluginDetailPanelProps) {
  const { i18n, t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const readmeState = usePluginReadme(
    plugin,
    snapshot.instances,
    t('pluginDetail.readmeLoadFailed'),
    pluginServerBaseUrl
  )
  const assetsState = usePluginAssets(
    plugin,
    snapshot.instances,
    t('pluginDetail.assetsLoadFailed'),
    pluginServerBaseUrl
  )
  const [disabledContributionGroups, setDisabledContributionGroups] = useState<string[]>(() =>
    readDisabledPluginContributionGroups(plugin.scope)
  )
  const [disabledContributionItems, setDisabledContributionItems] = useState<string[]>(() =>
    readDisabledPluginContributionItems(plugin.scope)
  )

  useEffect(() => {
    setDisabledContributionGroups(readDisabledPluginContributionGroups(plugin.scope))
    setDisabledContributionItems(readDisabledPluginContributionItems(plugin.scope))
  }, [plugin.scope])

  const contributionRows = useMemo(() => {
    const contributions = getPluginContributions(plugin)
    return pluginContributionGroups
      .map((group) => {
        const items = contributions[group.key]
        return {
          ...group,
          items: Array.isArray(items) ? items : []
        }
      })
      .filter(group => group.items.length > 0)
  }, [plugin])

  const runtimeRows = useMemo(() => {
    const slotRows = Object.entries(snapshot.slots).flatMap(([slot, items]) => {
      const scopedItems = (items ?? []).filter(item => item.pluginScope === plugin.scope)
      if (scopedItems.length === 0) return []
      const labelKey = runtimeSlotLabelKeys[slot]
      const slotLabel = labelKey == null ? slot : t(labelKey)
      return [{
        icon: 'widgets',
        id: `slot:${slot}`,
        items: scopedItems,
        title: t('pluginDetail.runtimeSlotLabel', { slot: slotLabel })
      }]
    })
    const routes = snapshot.routes
      .filter(item => item.scope === plugin.scope)
      .map(item => ({ id: item.id, title: item.title, viewId: item.viewId }))
    const views = snapshot.views
      .filter(item => item.scope === plugin.scope)
      .map(item => ({ id: item.id }))
    const launchers = snapshot.launcherProviders
      .filter(item => item.scope === plugin.scope)
      .map(item => ({ command: item.command, id: item.id, title: item.title }))
    const pluginApis = snapshot.pluginApis
      .filter(item => item.pluginScope === plugin.scope)
      .map(item => ({
        description: item.description,
        descriptionI18n: item.descriptionI18n,
        id: item.id,
        inputSchema: item.inputSchema,
        outputSchema: item.outputSchema,
        title: item.title,
        titleI18n: item.titleI18n
      }))
    const extensionPoints = snapshot.extensionPoints
      .filter(item => item.pluginScope === plugin.scope)
      .map(item => ({
        contributionSchema: item.contributionSchema,
        description: item.description,
        descriptionI18n: item.descriptionI18n,
        id: item.id,
        title: item.title,
        titleI18n: item.titleI18n
      }))
    const extensionContributions = Object.values(snapshot.extensionContributions)
      .flat()
      .filter(item => item.pluginScope === plugin.scope)
      .map(item => ({
        command: typeof item.command === 'string' ? item.command : undefined,
        description: item.description,
        descriptionI18n: item.descriptionI18n,
        extensionPoint: item.extensionPoint,
        icon: typeof item.icon === 'string' ? item.icon : undefined,
        id: item.id,
        target: item.target,
        title: item.title,
        titleI18n: item.titleI18n
      }))
    const apis = (plugin.apis ?? []).map(api => ({
      description: api.description,
      headerSchema: api.headerSchema,
      id: api.id,
      inputSchema: api.inputSchema,
      mode: api.mode,
      outputSchema: api.outputSchema,
      proxyTarget: api.proxyTarget,
      target: api.target,
      title: api.title
    }))

    return [
      ...slotRows,
      ...(extensionPoints.length > 0
        ? [{
          icon: 'extension',
          id: 'runtime:extension-points',
          items: extensionPoints,
          title: t('pluginDetail.runtimeExtensionPoints')
        }]
        : []),
      ...(extensionContributions.length > 0
        ? [{
          icon: 'add_link',
          id: 'runtime:extension-contributions',
          items: extensionContributions,
          title: t('pluginDetail.runtimeExtensionContributions')
        }]
        : []),
      ...(apis.length > 0
        ? [{ icon: 'api', id: 'runtime:apis', items: apis, title: t('pluginDetail.runtimeApis') }]
        : []),
      ...(pluginApis.length > 0
        ? [{ icon: 'hub', id: 'runtime:plugin-apis', items: pluginApis, title: t('pluginDetail.runtimePluginApis') }]
        : []),
      ...(routes.length > 0
        ? [{ icon: 'route', id: 'runtime:routes', items: routes, title: t('pluginDetail.runtimeRoutes') }]
        : []),
      ...(views.length > 0
        ? [{ icon: 'web_asset', id: 'runtime:views', items: views, title: t('pluginDetail.runtimeViews') }]
        : []),
      ...(launchers.length > 0
        ? [{
          icon: 'manage_search',
          id: 'runtime:launchers',
          items: launchers,
          title: t('pluginDetail.runtimeLaunchers')
        }]
        : [])
    ]
  }, [
    plugin.apis,
    plugin.scope,
    snapshot.extensionContributions,
    snapshot.extensionPoints,
    snapshot.launcherProviders,
    snapshot.pluginApis,
    snapshot.routes,
    snapshot.slots,
    snapshot.views,
    t
  ])

  const disabledContributionGroupSet = useMemo(
    () => new Set(disabledContributionGroups),
    [disabledContributionGroups]
  )
  const disabledContributionItemSet = useMemo(
    () => new Set(disabledContributionItems),
    [disabledContributionItems]
  )
  const handleContributionGroupEnabledChange = useCallback((rowId: string, enabled: boolean) => {
    const next = new Set(disabledContributionGroups)
    if (enabled) {
      next.delete(rowId)
    } else {
      next.add(rowId)
    }
    const values = [...next]
    setDisabledContributionGroups(values)
    writeDisabledPluginContributionGroups(plugin.scope, values)
    void onContributionPreferencesChange()
  }, [disabledContributionGroups, onContributionPreferencesChange, plugin.scope])
  const handleContributionItemEnabledChange = useCallback((itemId: string, enabled: boolean) => {
    const next = new Set(disabledContributionItems)
    if (enabled) {
      next.delete(itemId)
    } else {
      next.add(itemId)
    }
    const values = [...next]
    setDisabledContributionItems(values)
    writeDisabledPluginContributionItems(plugin.scope, values)
    void onContributionPreferencesChange()
  }, [disabledContributionItems, onContributionPreferencesChange, plugin.scope])

  const toDetailItems = useCallback((rowId: string, items: unknown[]) =>
    items.map((item, index) => {
      const itemId = buildPluginContributionItemPreferenceId(rowId, item, index)
      return {
        disabled: disabledContributionItemSet.has(itemId),
        id: itemId,
        value: item
      }
    }), [disabledContributionItemSet])

  const detailRows = useMemo(
    () =>
      [
        ...contributionRows.map(row => ({
          disabled: disabledContributionGroupSet.has(row.key),
          icon: row.icon,
          id: row.key,
          items: toDetailItems(row.key, row.items),
          title: t(row.labelKey)
        })),
        ...runtimeRows.map(row => ({
          ...row,
          disabled: disabledContributionGroupSet.has(row.id),
          items: toDetailItems(row.id, row.items)
        }))
      ] satisfies PluginDetailRow[],
    [contributionRows, disabledContributionGroupSet, runtimeRows, t, toDetailItems]
  )
  const readmeTabLabel = readmeState.readme == null
    ? t('pluginDetail.readme')
    : `${t('pluginDetail.readme')}: ${readmeState.readme.path}`
  const contributionsTabLabel = `${t('pluginDetail.contributions')}: ${detailRows.length}`
  const assetsByKind = useMemo(
    () => new Map(assetsState.groups.map(group => [group.kind, group])),
    [assetsState.groups]
  )
  const getAssetGroup = (kind: PluginDetailAssetKind) => assetsByKind.get(kind)
  const dataAssetGroups = [
    { icon: 'psychology', kind: 'skills' as const, title: t('knowledge.tabs.skills') },
    { icon: 'group_work', kind: 'entities' as const, title: t('knowledge.tabs.entities') },
    { icon: 'account_tree', kind: 'specs' as const, title: t('knowledge.tabs.flows') },
    { icon: 'gavel', kind: 'rules' as const, title: t('knowledge.tabs.rules') }
  ]
  const populatedDataAssetGroups = dataAssetGroups.filter(({ kind }) => (
    (getAssetGroup(kind)?.files.length ?? 0) > 0
  ))
  const assetTabs = [
    { icon: 'deployed_code', key: 'mcp' as const, title: t('pluginDetail.mcp') },
    { icon: 'tune', key: 'hooks' as const, title: t('pluginDetail.hooks') }
  ]
  const activeTabKey = resolvePluginDetailTabKey(searchParams.get(PLUGIN_DETAIL_TAB_QUERY_PARAM))
  const handleTabChange = useCallback((key: string) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      if (key === 'readme') {
        next.delete(PLUGIN_DETAIL_TAB_QUERY_PARAM)
      } else {
        next.set(PLUGIN_DETAIL_TAB_QUERY_PARAM, key)
      }
      return next
    }, { replace: true })
  }, [setSearchParams])

  return (
    <PluginDetailView
      activeTabKey={activeTabKey}
      overviewLabels={{
        clientDevEntry: t('pluginDetail.clientDevEntry'),
        clientEntry: t('pluginDetail.clientEntry'),
        disabled: t('pluginStore.disabled'),
        overview: t('pluginDetail.overview'),
        package: t('pluginDetail.package'),
        request: t('pluginDetail.request'),
        requestedVersion: t('pluginDetail.requestedVersion'),
        root: t('pluginDetail.root'),
        serverEntry: t('pluginDetail.serverEntry'),
        version: t('pluginDetail.version')
      }}
      overviewPlugin={plugin}
      onTabChange={handleTabChange}
      items={[
        {
          children: (
            <PluginReadmeSection
              emptyText={t('pluginDetail.readmeEmpty')}
              error={readmeState.error}
              loading={readmeState.loading}
              preferredLanguage={i18n.resolvedLanguage ?? i18n.language}
              pluginScope={plugin.scope}
              pluginServerBaseUrl={pluginServerBaseUrl}
              readme={readmeState.readme}
              readmes={readmeState.readmes}
              showTitle={false}
              title={t('pluginDetail.readme')}
            />
          ),
          key: 'readme',
          label: (
            <Tooltip title={readmeTabLabel}>
              <span className='plugin-detail-route__tab-label' aria-label={readmeTabLabel}>
                <MaterialSymbol name='article' aria-hidden='true' />
                <span>{t('pluginDetail.readme')}</span>
              </span>
            </Tooltip>
          )
        },
        {
          children: (
            <PluginRows
              emptyText={t('pluginDetail.noContributions')}
              disabledText={t('pluginDetail.contributionDisabled')}
              disableText={t('pluginDetail.disableContribution')}
              disableItemText={t('pluginDetail.disableContributionItem')}
              enableText={t('pluginDetail.enableContribution')}
              enableItemText={t('pluginDetail.enableContributionItem')}
              fieldLabels={{
                clientView: t('pluginDetail.fields.clientView'),
                command: t('pluginDetail.fields.command'),
                contributionSchema: t('pluginDetail.fields.contributionSchema'),
                extensionPoint: t('pluginDetail.fields.extensionPoint'),
                headerSchema: t('pluginDetail.fields.headerSchema'),
                href: t('pluginDetail.fields.href'),
                id: t('pluginDetail.fields.id'),
                inputSchema: t('pluginDetail.fields.inputSchema'),
                mode: t('pluginDetail.fields.mode'),
                outputSchema: t('pluginDetail.fields.outputSchema'),
                placement: t('pluginDetail.fields.placement'),
                proxyTarget: t('pluginDetail.fields.proxyTarget'),
                route: t('pluginDetail.fields.route'),
                routeId: t('pluginDetail.fields.routeId'),
                tab: t('pluginDetail.fields.tab'),
                target: t('pluginDetail.fields.target'),
                title: t('pluginDetail.fields.title'),
                viewId: t('pluginDetail.fields.viewId')
              }}
              itemDisabledText={t('pluginDetail.contributionItemDisabled')}
              language={i18n.resolvedLanguage ?? i18n.language}
              noMatchesText={t('pluginDetail.noContributionMatches')}
              noDescriptionText={t('pluginDetail.noContributionDescription')}
              onItemEnabledChange={handleContributionItemEnabledChange}
              onRowEnabledChange={handleContributionGroupEnabledChange}
              rows={detailRows}
              searchPlaceholder={t('pluginDetail.searchContributions')}
              showTitle={false}
              title={t('pluginDetail.contributions')}
            />
          ),
          key: 'contributions',
          label: (
            <Tooltip title={contributionsTabLabel}>
              <span className='plugin-detail-route__tab-label' aria-label={contributionsTabLabel}>
                <MaterialSymbol name='extension' aria-hidden='true' />
                <span>{t('pluginDetail.contributions')}</span>
              </span>
            </Tooltip>
          )
        },
        {
          children: (
            <PluginConfigSection
              labels={{
                instance: t('pluginDetail.configInstance'),
                manifest: t('pluginDetail.configManifest'),
                noSchema: t('pluginDetail.configNoSchema'),
                options: t('pluginDetail.configOptions'),
                saved: t('pluginDetail.configSaved'),
                saveFailed: t('pluginDetail.configSaveFailed'),
                saving: t('pluginDetail.configSaving')
              }}
              onOptionsChange={onOptionsChange}
              plugin={plugin}
            />
          ),
          key: 'config',
          label: (
            <Tooltip title={t('pluginDetail.config')}>
              <span className='plugin-detail-route__tab-label' aria-label={t('pluginDetail.config')}>
                <MaterialSymbol name='settings' aria-hidden='true' />
                <span>{t('pluginDetail.config')}</span>
              </span>
            </Tooltip>
          )
        },
        {
          children: assetsState.loading || assetsState.error != null || populatedDataAssetGroups.length === 0
            ? (
              <PluginAssetSection
                emptyText={t('pluginDetail.assetsEmpty')}
                error={assetsState.error}
                loading={assetsState.loading}
                title={t('pluginDetail.dataAssets')}
              />
            )
            : (
              <div className='plugin-detail-route__data-assets'>
                {populatedDataAssetGroups.map(group => (
                  <PluginAssetSection
                    key={group.kind}
                    emptyText={t('pluginDetail.assetsEmpty')}
                    group={getAssetGroup(group.kind)}
                    icon={group.icon}
                    loading={false}
                    showHeading
                    title={group.title}
                  />
                ))}
              </div>
            ),
          key: 'skills',
          label: (
            <Tooltip title={t('pluginDetail.dataAssets')}>
              <span className='plugin-detail-route__tab-label' aria-label={t('pluginDetail.dataAssets')}>
                <MaterialSymbol name='database' aria-hidden='true' />
                <span>{t('pluginDetail.dataAssets')}</span>
              </span>
            </Tooltip>
          )
        },
        ...assetTabs.map(tab => ({
          children: (
            <PluginAssetSection
              emptyText={t('pluginDetail.assetsEmpty')}
              error={assetsState.error}
              group={getAssetGroup(tab.key)}
              loading={assetsState.loading}
              title={tab.title}
            />
          ),
          key: tab.key,
          label: (
            <Tooltip title={tab.title}>
              <span className='plugin-detail-route__tab-label' aria-label={tab.title}>
                <MaterialSymbol name={tab.icon} aria-hidden='true' />
                <span>{tab.title}</span>
              </span>
            </Tooltip>
          )
        }))
      ]}
    />
  )
}
