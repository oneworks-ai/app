/* eslint-disable max-lines -- plugin route coordinates route sidebar, create, marketplace, and detail views. */

import './PluginStoreRoute.scss'
import './PluginDetailRoute.scss'

import { App, Empty, Spin } from 'antd'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import useSWR from 'swr'

import type { RouteContainerHeaderActionItem, RouteContainerHeaderBreadcrumb } from '@oneworks/components/route-layout'
import type { NativeHostPlugin, PluginMarketplaceCatalogPlugin, PluginMarketplaceInstallTarget } from '@oneworks/types'

import { getApiErrorMessage } from '#~/api.js'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { RouteContainerHeader } from '#~/components/layout/RouteContainerHeader'
import { RouteContainerLayout } from '#~/components/layout/RouteContainerLayout'
import { useRouteSidebar } from '#~/components/layout/route-sidebar-context'
import type { RouteSidebarListContextMenuItems, RouteSidebarListItem } from '#~/components/layout/route-sidebar-context'
import { useRouteContainerSidebarOpener } from '#~/components/layout/use-route-container-sidebar-opener'
import { MarketplacePluginDetailPanel } from '#~/components/plugins/MarketplacePluginDetailPanel'
import { NativePluginDetailPanel } from '#~/components/plugins/NativePluginDetailPanel'
import { PluginCreateLanding } from '#~/components/plugins/PluginCreateLanding'
import { PluginDetailPanel } from '#~/components/plugins/PluginDetailPanel'
import { PluginDiagnostics } from '#~/components/plugins/PluginDiagnostics'
import { PluginHomeView } from '#~/components/plugins/PluginHomeView'
import {
  PluginMarketplaceLanding,
  isMarketplacePluginInstallable,
  isPluginInstalledForTarget
} from '#~/components/plugins/PluginMarketplaceLanding'
import { PluginRuntimeListView } from '#~/components/plugins/PluginRuntimeListView'
import {
  PluginGroupModeControls,
  buildPluginRouteSidebarGroups,
  resolvePluginSourceGroup
} from '#~/components/plugins/PluginStoreSidebarControls'
import type { PluginGroupMode } from '#~/components/plugins/PluginStoreSidebarControls'
import { buildPluginListItems, createNativePluginRouteKey } from '#~/components/plugins/plugin-runtime-list-items'
import { listNativeHostPlugins, setPluginEnabled, setPluginWatch } from '#~/plugins/api'
import {
  listPluginMarketplaceCatalog,
  resolvePluginMarketplaceVersions,
  syncPluginMarketplaceSelection
} from '#~/plugins/marketplace-api'
import { usePluginContext } from '#~/plugins/plugin-context'
import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'
import {
  getPluginPresentationSearchText,
  resolvePluginDisplayName,
  resolvePluginPresentationIcon
} from '#~/plugins/plugin-presentation'
import { useRoutePluginChrome } from '#~/plugins/route-plugin-chrome'
import { copyTextWithFeedback } from '#~/utils/copy'
import {
  PLUGIN_PATHS,
  createMarketplacePluginRouteKey,
  resolveMarketplacePluginRouteKey,
  resolvePluginLocation
} from './plugin-routes'

const PLUGIN_ROUTE_SIDEBAR_KEY = 'plugin-store'
const EMPTY_NATIVE_PLUGINS: NativeHostPlugin[] = []

export function PluginStoreRoute() {
  const { i18n, t } = useTranslation()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const { scope = '' } = useParams()
  const { openRouteSidebar } = useRouteContainerSidebarOpener()
  const { clearRouteSidebar, hasRouteSidebarProvider, setRouteSidebar } = useRouteSidebar()
  const { pluginServerBaseUrl, refreshPlugins, reloadPlugin, snapshot } = usePluginContext()
  const {
    headerActions: routePluginHeaderActions,
    sidebarContextMenuItems: routePluginSidebarContextMenu
  } = useRoutePluginChrome('plugins')
  const [updatingEnabledAction, setUpdatingEnabledAction] = useState<string>()
  const [updatingWatchScope, setUpdatingWatchScope] = useState<string>()
  const [installingMarketplaceTarget, setInstallingMarketplaceTarget] = useState<PluginMarketplaceInstallTarget>()
  const [pluginQuery, setPluginQuery] = useState('')
  const [pluginGroupMode, setPluginGroupMode] = useState<PluginGroupMode>('enabled')
  const [pluginMarketplaceQuery, setPluginMarketplaceQuery] = useState('')
  const pluginLocation = useMemo(
    () => resolvePluginLocation(location.pathname, location.search),
    [location.pathname, location.search]
  )
  const { data: nativePluginData, isLoading: nativePluginsLoading } = useSWR(
    ['/api/plugins/native', pluginServerBaseUrl ?? 'current'],
    () => listNativeHostPlugins({ serverBaseUrl: pluginServerBaseUrl })
  )
  const nativePlugins = nativePluginData?.plugins ?? EMPTY_NATIVE_PLUGINS
  const {
    data: marketplaceCatalog,
    isLoading: marketplaceCatalogLoading,
    mutate: mutateMarketplaceCatalog
  } = useSWR(
    pluginLocation.page === 'home' || pluginLocation.page === 'store'
      ? ['/api/plugins/marketplace/catalog', pluginServerBaseUrl ?? 'current']
      : null,
    () => listPluginMarketplaceCatalog({ serverBaseUrl: pluginServerBaseUrl })
  )
  const encodedScope = encodeURIComponent(scope)
  const isDiagnosticsPage = scope !== '' && location.pathname.endsWith(`/${encodedScope}/diagnostics`)
  const detailParentPage = location.pathname.startsWith('/plugins/store/') ? 'store' : 'list'
  const detailParentPath = PLUGIN_PATHS[detailParentPage]
  const detailPath = `${detailParentPath}/${encodedScope}`

  useEffect(() => {
    if (scope === '' && pluginLocation.shouldReplace) {
      void navigate(`${pluginLocation.pathname}${pluginLocation.search}`, { replace: true })
      return
    }
    if (scope !== '' && location.pathname === `/plugins/${encodedScope}`) {
      void navigate(`${PLUGIN_PATHS.list}/${encodedScope}`, { replace: true })
    }
  }, [encodedScope, location.pathname, navigate, pluginLocation, scope])

  const plugins = useMemo(
    () => [...snapshot.instances].sort((left, right) => left.scope.localeCompare(right.scope)),
    [snapshot.instances]
  )
  const installedItems = useMemo(() =>
    buildPluginListItems({
      language: i18n.resolvedLanguage ?? i18n.language,
      nativePlugins,
      plugins,
      serverBaseUrl: pluginServerBaseUrl
    }), [i18n.language, i18n.resolvedLanguage, nativePlugins, pluginServerBaseUrl, plugins])
  const selectedPlugin = useMemo(
    () => scope === '' ? undefined : plugins.find(plugin => plugin.scope === scope),
    [plugins, scope]
  )
  const selectedNativePlugin = useMemo(
    () =>
      scope === ''
        ? undefined
        : nativePlugins.find(plugin => createNativePluginRouteKey(plugin) === scope),
    [nativePlugins, scope]
  )
  const marketplacePluginIdentity = useMemo(
    () => scope === '' ? undefined : resolveMarketplacePluginRouteKey(scope),
    [scope]
  )
  const selectedMarketplacePlugin = useMemo(
    () =>
      marketplacePluginIdentity == null
        ? undefined
        : marketplaceCatalog?.plugins.find(plugin =>
          plugin.marketplace === marketplacePluginIdentity.marketplace &&
          plugin.name === marketplacePluginIdentity.plugin
        ),
    [marketplaceCatalog?.plugins, marketplacePluginIdentity]
  )
  const { data: resolvedMarketplaceVersion } = useSWR(
    selectedMarketplacePlugin?.version != null || marketplaceCatalog?.versionGeneration == null ||
      marketplacePluginIdentity == null
      ? null
      : [
        '/api/plugins/marketplace/versions',
        pluginServerBaseUrl ?? 'current',
        marketplaceCatalog.versionGeneration,
        marketplacePluginIdentity.marketplace,
        marketplacePluginIdentity.plugin
      ],
    async () =>
      (await resolvePluginMarketplaceVersions(
        marketplaceCatalog?.versionGeneration ?? '',
        [{ marketplace: marketplacePluginIdentity!.marketplace, plugin: marketplacePluginIdentity!.plugin }],
        { serverBaseUrl: pluginServerBaseUrl }
      )).versions[0]?.version
  )
  const selectedMarketplaceVersion = selectedMarketplacePlugin?.version ?? resolvedMarketplaceVersion
  const selectedDetailItem: PluginRuntimeInstance | NativeHostPlugin | PluginMarketplaceCatalogPlugin | undefined =
    selectedPlugin ?? selectedNativePlugin ?? selectedMarketplacePlugin
  const headerTitle = selectedPlugin != null
    ? resolvePluginDisplayName(selectedPlugin, i18n.resolvedLanguage ?? i18n.language)
    : selectedNativePlugin != null
    ? selectedNativePlugin.displayName ?? selectedNativePlugin.name
    : selectedMarketplacePlugin != null
    ? selectedMarketplacePlugin.name
    : scope === ''
    ? t(
      pluginLocation.page === 'home'
        ? 'pluginStore.root'
        : pluginLocation.page === 'create'
        ? 'pluginStore.createPlugin'
        : pluginLocation.page === 'list'
        ? 'pluginStore.listBreadcrumb'
        : 'pluginStore.marketplaceBreadcrumb'
    )
    : t('pluginDetail.notFound')
  const headerIcon = selectedPlugin != null
    ? resolvePluginPresentationIcon(selectedPlugin, pluginServerBaseUrl)
    : selectedNativePlugin?.icon != null
    ? {
      alt: selectedNativePlugin.displayName ?? selectedNativePlugin.name,
      src: selectedNativePlugin.icon,
      type: 'image' as const
    }
    : selectedMarketplacePlugin != null
    ? 'extension'
    : scope === '' && pluginLocation.page === 'store'
    ? 'storefront'
    : 'extension'
  const headerBreadcrumb = useMemo<RouteContainerHeaderBreadcrumb | undefined>(() => {
    if (scope === '' && pluginLocation.page === 'home') return undefined
    if (selectedDetailItem != null) {
      const parentLabel = t(
        detailParentPage === 'store' ? 'pluginStore.marketplaceBreadcrumb' : 'pluginStore.listBreadcrumb'
      )
      return {
        ancestors: [
          { title: t('pluginStore.root'), onSelect: () => void navigate(PLUGIN_PATHS.home) },
          { title: parentLabel, onSelect: () => void navigate(detailParentPath) }
        ],
        ariaLabel: parentLabel,
        currentTitle: t(isDiagnosticsPage ? 'pluginStore.diagnostics' : 'pluginStore.details'),
        onBack: () => void navigate(isDiagnosticsPage ? detailPath : detailParentPath),
        parentTitle: headerTitle
      }
    }
    return {
      ariaLabel: t('pluginStore.root'),
      currentTitle: headerTitle,
      onBack: () => void navigate(PLUGIN_PATHS.home),
      parentTitle: t('pluginStore.root')
    }
  }, [
    detailParentPage,
    detailParentPath,
    detailPath,
    headerTitle,
    isDiagnosticsPage,
    navigate,
    pluginLocation.page,
    scope,
    selectedDetailItem,
    t
  ])
  const selectedPluginDiagnostics = useMemo(() =>
    selectedPlugin == null
      ? []
      : [
        ...snapshot.diagnostics.filter((diagnostic) => {
          const diagnosticScope = 'pluginScope' in diagnostic ? diagnostic.pluginScope : diagnostic.scope
          return diagnosticScope === selectedPlugin.scope
        }),
        ...(selectedPlugin.diagnostics ?? [])
      ], [selectedPlugin, snapshot.diagnostics])
  const visiblePlugins = useMemo(() => {
    const keyword = pluginQuery.trim().toLowerCase()
    if (keyword === '') return plugins

    return plugins.filter((plugin) => {
      return getPluginPresentationSearchText(plugin, i18n.resolvedLanguage ?? i18n.language)
        .toLowerCase()
        .includes(keyword)
    })
  }, [i18n.language, i18n.resolvedLanguage, pluginQuery, plugins])
  const visibleNativePlugins = useMemo(() => {
    const keyword = pluginQuery.trim().toLowerCase()
    if (keyword === '') return nativePlugins
    return nativePlugins.filter(plugin =>
      [
        plugin.displayName,
        plugin.name,
        plugin.adapter,
        plugin.marketplace,
        plugin.source.displayPath
      ].filter(Boolean).join(' ').toLowerCase().includes(keyword)
    )
  }, [nativePlugins, pluginQuery])
  const toggleWatch = useCallback(async (scope: string, enabled: boolean) => {
    setUpdatingWatchScope(scope)
    try {
      await setPluginWatch(scope, enabled, { serverBaseUrl: pluginServerBaseUrl })
      await refreshPlugins()
      void message.success(enabled ? t('pluginStore.watchEnabled') : t('pluginStore.watchDisabled'))
    } catch (error) {
      console.error('[plugin] failed to update watch mode', error)
      void message.error(t('pluginStore.watchUpdateFailed'))
    } finally {
      setUpdatingWatchScope(undefined)
    }
  }, [message, pluginServerBaseUrl, refreshPlugins, t])

  const togglePluginEnabled = useCallback((
    scope: string,
    enabled: boolean,
    target: 'workspace' | 'global' = 'workspace'
  ) => {
    const actionKey = `${target}:${scope}`
    setUpdatingEnabledAction(actionKey)
    return setPluginEnabled(scope, enabled, target, { serverBaseUrl: pluginServerBaseUrl })
      .then(async () => {
        await refreshPlugins()
        void message.success(enabled ? t('pluginStore.pluginEnabled') : t('pluginStore.pluginDisabled'))
      })
      .catch((error) => {
        console.error('[plugin] failed to update plugin enabled state', error)
        void message.error(t('pluginStore.pluginEnabledUpdateFailed'))
      })
      .finally(() => {
        setUpdatingEnabledAction(undefined)
      })
  }, [message, pluginServerBaseUrl, refreshPlugins, t])

  const installMarketplacePlugin = useCallback(async (target: PluginMarketplaceInstallTarget) => {
    if (selectedMarketplacePlugin == null || !isMarketplacePluginInstallable(selectedMarketplacePlugin)) return
    setInstallingMarketplaceTarget(target)
    try {
      await syncPluginMarketplaceSelection(
        selectedMarketplacePlugin.marketplace,
        selectedMarketplacePlugin.name,
        true,
        target,
        { serverBaseUrl: pluginServerBaseUrl }
      )
      await Promise.all([mutateMarketplaceCatalog(), refreshPlugins()])
      void message.success(t(
        target === 'global'
          ? 'pluginStore.marketplacePluginInstalledGlobal'
          : 'pluginStore.marketplacePluginInstalledProject'
      ))
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('pluginStore.marketplacePluginSaveFailed')))
    } finally {
      setInstallingMarketplaceTarget(undefined)
    }
  }, [message, mutateMarketplaceCatalog, pluginServerBaseUrl, refreshPlugins, selectedMarketplacePlugin, t])

  const createPluginContextMenuItems = useCallback(
    (plugin: PluginRuntimeInstance): RouteSidebarListContextMenuItems => {
      const isPluginEnabled = plugin.enabled !== false
      const nextPluginEnabled = !isPluginEnabled
      const pluginRoot = plugin.pluginRoot ?? plugin.rootDir
      const pluginSourceGroup = resolvePluginSourceGroup(plugin)
      const isWatchEnabled = plugin.watch?.enabled === true
      const nextWatchEnabled = !isWatchEnabled

      return [
        {
          key: `details:${plugin.scope}`,
          label: t('pluginStore.openDetails'),
          icon: <MaterialSymbol name='open_in_new' />,
          onClick: () => {
            void navigate(`${PLUGIN_PATHS.list}/${encodeURIComponent(plugin.scope)}`)
          }
        },
        {
          key: `enabled-workspace:${plugin.scope}`,
          label: t(isPluginEnabled ? 'pluginStore.disablePluginInWorkspace' : 'pluginStore.enablePluginInWorkspace'),
          icon: <MaterialSymbol name={isPluginEnabled ? 'extension_off' : 'extension'} />,
          disabled: updatingEnabledAction === `workspace:${plugin.scope}`,
          onClick: () => {
            void togglePluginEnabled(plugin.scope, nextPluginEnabled, 'workspace')
          }
        },
        ...(pluginSourceGroup === 'global'
          ? [{
            key: `enabled-global:${plugin.scope}`,
            label: t(isPluginEnabled ? 'pluginStore.disablePluginGlobally' : 'pluginStore.enablePluginGlobally'),
            icon: <MaterialSymbol name='public' />,
            disabled: updatingEnabledAction === `global:${plugin.scope}`,
            onClick: () => {
              void togglePluginEnabled(plugin.scope, nextPluginEnabled, 'global')
            }
          }]
          : []),
        {
          key: `watch:${plugin.scope}`,
          label: t(isWatchEnabled ? 'pluginStore.disableWatch' : 'pluginStore.enableWatch'),
          icon: <MaterialSymbol name={isWatchEnabled ? 'close' : 'speed'} />,
          disabled: !isPluginEnabled || updatingWatchScope === plugin.scope,
          onClick: () => {
            void toggleWatch(plugin.scope, nextWatchEnabled)
          }
        },
        { key: `copy-divider:${plugin.scope}`, type: 'divider' },
        {
          key: `copy-scope:${plugin.scope}`,
          label: t('pluginStore.copyPluginScope'),
          icon: <MaterialSymbol name='fingerprint' />,
          onClick: () => {
            void copyTextWithFeedback({
              failureMessage: t('common.copyFailed'),
              messageApi: message,
              successMessage: t('pluginStore.pluginScopeCopied'),
              text: plugin.scope
            })
          }
        },
        ...(pluginRoot == null || pluginRoot === ''
          ? []
          : [{
            key: `copy-root:${plugin.scope}`,
            label: t('pluginStore.copyPluginRoot'),
            icon: <MaterialSymbol name='folder_open' />,
            onClick: () => {
              void copyTextWithFeedback({
                failureMessage: t('common.copyFailed'),
                messageApi: message,
                successMessage: t('pluginStore.pluginRootCopied'),
                text: pluginRoot
              })
            }
          }])
      ]
    },
    [message, navigate, t, togglePluginEnabled, toggleWatch, updatingEnabledAction, updatingWatchScope]
  )

  const routeSidebarGroups = useMemo(
    () =>
      buildPluginRouteSidebarGroups(
        visiblePlugins,
        pluginGroupMode,
        t,
        i18n.resolvedLanguage ?? i18n.language,
        pluginServerBaseUrl,
        createPluginContextMenuItems,
        visibleNativePlugins
      ),
    [
      createPluginContextMenuItems,
      i18n.language,
      i18n.resolvedLanguage,
      pluginGroupMode,
      pluginServerBaseUrl,
      visibleNativePlugins,
      t,
      visiblePlugins
    ]
  )

  const pluginGroupModeSuffix = useMemo(() => (
    <PluginGroupModeControls
      groupMode={pluginGroupMode}
      t={t}
      onGroupModeChange={setPluginGroupMode}
    />
  ), [pluginGroupMode, t])

  const handleRouteSidebarSelect = useCallback((item: RouteSidebarListItem) => {
    void navigate(`${PLUGIN_PATHS.list}/${encodeURIComponent(item.key)}`)
  }, [navigate])

  const pageHeaderActions = useMemo<RouteContainerHeaderActionItem[]>(() => {
    const items: RouteContainerHeaderActionItem[] = selectedDetailItem == null
      ? [
        {
          active: scope === '' && pluginLocation.page === 'list',
          icon: 'extension',
          key: 'plugin-list',
          label: t('pluginStore.pluginList'),
          onSelect: () => void navigate(PLUGIN_PATHS.list)
        },
        {
          active: scope === '' && pluginLocation.page === 'store',
          icon: 'storefront',
          key: 'plugin-store',
          label: t('pluginStore.marketplace'),
          onSelect: () => void navigate(PLUGIN_PATHS.store)
        },
        ...(scope === '' && pluginLocation.page === 'home'
          ? [{
            active: false,
            icon: 'add_box',
            key: 'plugin-create',
            label: t('pluginStore.createPlugin'),
            onSelect: () => void navigate(PLUGIN_PATHS.create)
          }]
          : [])
      ]
      : []
    if (selectedPlugin != null) {
      items.push({
        active: selectedPlugin.enabled !== false,
        disabled: updatingEnabledAction != null,
        icon: selectedPlugin.enabled === false ? 'extension_off' : 'extension',
        key: 'plugin-enabled',
        label: t(
          selectedPlugin.enabled === false
            ? 'pluginStore.enablePluginInWorkspace'
            : 'pluginStore.disablePluginInWorkspace'
        ),
        loading: updatingEnabledAction === `workspace:${selectedPlugin.scope}`,
        onSelect: () => void togglePluginEnabled(selectedPlugin.scope, selectedPlugin.enabled === false, 'workspace')
      })
      if (selectedPlugin.watch != null) {
        items.push({
          active: selectedPlugin.watch.enabled,
          disabled: selectedPlugin.enabled === false || updatingWatchScope != null,
          icon: 'speed',
          key: 'plugin-watch',
          label: t(selectedPlugin.watch.enabled ? 'pluginStore.disableWatch' : 'pluginStore.enableWatch'),
          loading: updatingWatchScope === selectedPlugin.scope,
          onSelect: () => void toggleWatch(selectedPlugin.scope, !selectedPlugin.watch?.enabled)
        })
      }
      items.push({
        active: isDiagnosticsPage,
        icon: (
          <span
            className={selectedPluginDiagnostics.some(item => item.level !== 'info')
              ? 'plugin-store-route__diagnostics-action has-indicator'
              : 'plugin-store-route__diagnostics-action'}
          >
            <MaterialSymbol name='bug_report' />
          </span>
        ),
        key: 'plugin-diagnostics',
        label: t('pluginStore.diagnostics'),
        onSelect: () => void navigate(`${detailPath}/diagnostics`)
      })
    }
    if (selectedMarketplacePlugin != null) {
      const targets: Array<{ icon: string; target: PluginMarketplaceInstallTarget }> = [
        { icon: 'folder', target: 'project' },
        { icon: 'public', target: 'global' }
      ]
      for (const { icon, target } of targets) {
        const installed = isPluginInstalledForTarget(selectedMarketplacePlugin, target)
        items.push({
          active: installed,
          disabled: !isMarketplacePluginInstallable(selectedMarketplacePlugin) ||
            installingMarketplaceTarget != null,
          icon,
          key: `marketplace-install-${target}`,
          label: t(
            target === 'global'
              ? installed
                ? 'pluginStore.reinstallMarketplacePluginGlobal'
                : 'pluginStore.installMarketplacePluginGlobal'
              : installed
              ? 'pluginStore.reinstallMarketplacePluginProject'
              : 'pluginStore.installMarketplacePluginProject'
          ),
          loading: installingMarketplaceTarget === target,
          onSelect: () => void installMarketplacePlugin(target)
        })
      }
    }
    return [...items, ...routePluginHeaderActions]
  }, [
    isDiagnosticsPage,
    detailPath,
    installMarketplacePlugin,
    installingMarketplaceTarget,
    navigate,
    pluginLocation.page,
    routePluginHeaderActions,
    scope,
    selectedDetailItem,
    selectedMarketplacePlugin,
    selectedPlugin,
    selectedPluginDiagnostics,
    t,
    togglePluginEnabled,
    toggleWatch,
    updatingEnabledAction,
    updatingWatchScope
  ])

  useLayoutEffect(() => {
    if (!hasRouteSidebarProvider) return undefined

    setRouteSidebar({
      activeKey: selectedPlugin?.scope ??
        (selectedNativePlugin == null ? undefined : createNativePluginRouteKey(selectedNativePlugin)),
      ariaLabel: t('pluginStore.installedLabel'),
      contextMenuItems: routePluginSidebarContextMenu,
      emptyText: t('pluginStore.empty'),
      groups: routeSidebarGroups,
      key: PLUGIN_ROUTE_SIDEBAR_KEY,
      search: {
        placeholder: t('pluginStore.searchPlaceholder'),
        suffix: pluginGroupModeSuffix,
        value: pluginQuery,
        onChange: setPluginQuery
      },
      onSelectItem: handleRouteSidebarSelect
    })

    return () => clearRouteSidebar(PLUGIN_ROUTE_SIDEBAR_KEY)
  }, [
    clearRouteSidebar,
    handleRouteSidebarSelect,
    hasRouteSidebarProvider,
    pluginQuery,
    pluginGroupModeSuffix,
    routePluginSidebarContextMenu,
    routeSidebarGroups,
    selectedPlugin,
    selectedNativePlugin,
    setRouteSidebar,
    t
  ])

  return (
    <RouteContainerLayout
      className='plugin-store-route'
      bodyClassName={`plugin-store-route__body${
        scope === '' && pluginLocation.page === 'list' ? ' is-runtime-list' : ''
      }`}
      contentInset
      header={
        <RouteContainerHeader
          actionItems={pageHeaderActions}
          breadcrumb={headerBreadcrumb}
          icon={headerIcon}
          onOpenSidebar={openRouteSidebar}
          title={headerTitle}
        />
      }
    >
      <div className='plugin-store-route__content'>
        <div
          className={`plugin-store-route__main${
            selectedDetailItem != null && !isDiagnosticsPage ? ' is-plugin-detail' : ''
          }`}
        >
          {scope === ''
            ? pluginLocation.page === 'home'
              ? (
                <PluginHomeView
                  catalogLoading={marketplaceCatalogLoading}
                  catalogPlugins={marketplaceCatalog?.plugins ?? []}
                  installedItems={installedItems}
                  onOpenInstalledItem={item => void navigate(`${PLUGIN_PATHS.list}/${encodeURIComponent(item.id)}`)}
                  onOpenList={() => void navigate(PLUGIN_PATHS.list)}
                  onOpenStore={plugin =>
                    void navigate(
                      plugin == null
                        ? PLUGIN_PATHS.store
                        : `${PLUGIN_PATHS.store}/${
                          encodeURIComponent(createMarketplacePluginRouteKey(plugin.marketplace, plugin.name))
                        }`
                    )}
                />
              )
              : pluginLocation.page === 'create'
              ? <PluginCreateLanding />
              : pluginLocation.page === 'list'
              ? (
                <PluginRuntimeListView
                  pluginServerBaseUrl={pluginServerBaseUrl}
                  nativePlugins={nativePlugins}
                  nativePluginsLoading={nativePluginsLoading}
                  plugins={plugins}
                  onOpenItem={item => void navigate(`${PLUGIN_PATHS.list}/${encodeURIComponent(item.id)}`)}
                />
              )
              : (
                <PluginMarketplaceLanding
                  query={pluginMarketplaceQuery}
                  serverBaseUrl={pluginServerBaseUrl}
                  onOpenPlugin={plugin =>
                    void navigate(
                      `${PLUGIN_PATHS.store}/${
                        encodeURIComponent(
                          createMarketplacePluginRouteKey(plugin.marketplace, plugin.name)
                        )
                      }`
                    )}
                  onQueryChange={setPluginMarketplaceQuery}
                />
              )
            : marketplacePluginIdentity != null && marketplaceCatalogLoading
            ? (
              <div className='plugin-store-route__not-found'>
                <Spin />
              </div>
            )
            : selectedPlugin == null && selectedNativePlugin == null && selectedMarketplacePlugin == null
            ? (
              <div className='plugin-store-route__not-found'>
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('pluginDetail.notFound')} />
              </div>
            )
            : selectedNativePlugin != null
            ? (
              <NativePluginDetailPanel
                plugin={selectedNativePlugin}
                pluginServerBaseUrl={pluginServerBaseUrl}
              />
            )
            : selectedMarketplacePlugin != null
            ? (
              <MarketplacePluginDetailPanel
                plugin={selectedMarketplacePlugin}
                version={selectedMarketplaceVersion}
              />
            )
            : isDiagnosticsPage
            ? (
              <PluginDiagnostics
                diagnostics={selectedPluginDiagnostics}
                emptyText={t('pluginDetail.diagnosticsEmpty')}
                title={t('pluginStore.diagnostics')}
              />
            )
            : (
              <PluginDetailPanel
                plugin={selectedPlugin!}
                pluginServerBaseUrl={pluginServerBaseUrl}
                snapshot={snapshot}
                onContributionPreferencesChange={() => reloadPlugin(selectedPlugin!.scope)}
                onOptionsChange={() => refreshPlugins()}
              />
            )}
        </div>
        {(updatingEnabledAction != null || updatingWatchScope != null) && (
          <div className='plugin-store-route__saving' aria-live='polite'>
            <Spin size='small' />
          </div>
        )}
      </div>
    </RouteContainerLayout>
  )
}
