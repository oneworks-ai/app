/* eslint-disable max-lines -- plugin route coordinates route sidebar, create, marketplace, and detail views. */

import './PluginStoreRoute.scss'
import './PluginDetailRoute.scss'

import { App, Empty, Spin } from 'antd'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import useSWR, { useSWRConfig } from 'swr'

import type { RouteContainerHeaderActionItem, RouteContainerHeaderBreadcrumb } from '@oneworks/components/route-layout'
import type { NativeHostPlugin, PluginMarketplaceCatalogPlugin, PluginMarketplaceInstallTarget } from '@oneworks/types'

import { ApiError, getApiErrorMessage } from '#~/api.js'
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
import { PluginUninstallConfirmContent } from '#~/components/plugins/PluginUninstallConfirmContent'
import { buildPluginListItems, createNativePluginRouteKey } from '#~/components/plugins/plugin-runtime-list-items'
import { listNativeHostPlugins, setPluginEnabled, setPluginWatch } from '#~/plugins/api'
import {
  getPluginMarketplaceUninstallPlan,
  listPluginMarketplaceCatalog,
  resolvePluginMarketplaceVersions,
  syncPluginMarketplaceSelection,
  uninstallPluginMarketplacePlugin
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

interface PluginUninstallOperation {
  controller: AbortController
  generation: number
  scope: string
}

interface SuppressedPluginUninstallPlan {
  rejectedToken: string
  scope: string
}

export function PluginStoreRoute() {
  const { i18n, t } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const { message, modal } = App.useApp()
  const { mutate: mutateSWR } = useSWRConfig()
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
  const [uninstallingOperation, setUninstallingOperation] = useState<PluginUninstallOperation>()
  const [suppressedUninstallPlan, setSuppressedUninstallPlan] = useState<SuppressedPluginUninstallPlan>()
  const activeScopeRef = useRef(scope)
  const uninstallGenerationRef = useRef(0)
  const uninstallModalRef = useRef<ReturnType<typeof modal.confirm>>()
  const uninstallOperationRef = useRef<PluginUninstallOperation>()
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
      language,
      nativePlugins,
      plugins,
      serverBaseUrl: pluginServerBaseUrl
    }), [language, nativePlugins, pluginServerBaseUrl, plugins])
  const selectedPlugin = useMemo(
    () => scope === '' ? undefined : plugins.find(plugin => plugin.scope === scope),
    [plugins, scope]
  )
  const {
    data: selectedPluginUninstallPlan,
    mutate: mutateSelectedPluginUninstallPlan
  } = useSWR(
    selectedPlugin == null
      ? null
      : [
        '/api/plugins/uninstall-plan',
        pluginServerBaseUrl ?? 'current',
        selectedPlugin.scope
      ],
    () =>
      getPluginMarketplaceUninstallPlan(selectedPlugin.scope, {
        serverBaseUrl: pluginServerBaseUrl
      })
  )
  const visiblePluginUninstallPlan = suppressedUninstallPlan?.scope === selectedPlugin?.scope
    ? undefined
    : selectedPluginUninstallPlan
  useEffect(() => {
    if (
      suppressedUninstallPlan?.scope === selectedPlugin?.scope &&
      selectedPluginUninstallPlan?.available === true &&
      selectedPluginUninstallPlan.token !== suppressedUninstallPlan.rejectedToken
    ) {
      setSuppressedUninstallPlan(undefined)
    }
  }, [selectedPlugin?.scope, selectedPluginUninstallPlan, suppressedUninstallPlan])
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

  useEffect(() => {
    activeScopeRef.current = scope
    uninstallGenerationRef.current += 1
    uninstallOperationRef.current?.controller.abort()
    uninstallOperationRef.current = undefined
    setUninstallingOperation(undefined)
    setSuppressedUninstallPlan(undefined)
    uninstallModalRef.current?.destroy()
    uninstallModalRef.current = undefined

    return () => {
      uninstallGenerationRef.current += 1
      uninstallOperationRef.current?.controller.abort()
      uninstallOperationRef.current = undefined
      uninstallModalRef.current?.destroy()
      uninstallModalRef.current = undefined
    }
  }, [scope])
  const headerTitle = selectedPlugin != null
    ? resolvePluginDisplayName(selectedPlugin, language)
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
      return getPluginPresentationSearchText(plugin, language)
        .toLowerCase()
        .includes(keyword)
    })
  }, [language, pluginQuery, plugins])
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

  const toggleMarketplacePlugin = useCallback(async (target: PluginMarketplaceInstallTarget) => {
    if (selectedMarketplacePlugin == null || !isMarketplacePluginInstallable(selectedMarketplacePlugin)) return
    const enabled = !isPluginInstalledForTarget(selectedMarketplacePlugin, target)
    setInstallingMarketplaceTarget(target)
    try {
      await syncPluginMarketplaceSelection(
        selectedMarketplacePlugin.marketplace,
        selectedMarketplacePlugin.name,
        enabled,
        target,
        { serverBaseUrl: pluginServerBaseUrl }
      )
      await Promise.all([mutateMarketplaceCatalog(), refreshPlugins()])
      void message.success(t(
        enabled
          ? target === 'global'
            ? 'pluginStore.marketplacePluginInstalledGlobal'
            : 'pluginStore.marketplacePluginInstalledProject'
          : 'pluginStore.marketplacePluginRemoved'
      ))
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('pluginStore.marketplacePluginSaveFailed')))
    } finally {
      setInstallingMarketplaceTarget(undefined)
    }
  }, [message, mutateMarketplaceCatalog, pluginServerBaseUrl, refreshPlugins, selectedMarketplacePlugin, t])

  const confirmMarketplacePluginUninstall = useCallback(() => {
    if (
      selectedPlugin == null ||
      visiblePluginUninstallPlan?.available !== true ||
      uninstallOperationRef.current != null
    ) {
      return
    }
    const plan = visiblePluginUninstallPlan
    const selectedScope = selectedPlugin.scope
    const modalGeneration = uninstallGenerationRef.current
    uninstallModalRef.current?.destroy()
    uninstallModalRef.current = modal.confirm({
      autoFocusButton: 'cancel',
      cancelText: t('pluginStore.uninstall.cancel'),
      content: <PluginUninstallConfirmContent plan={plan} />,
      okButtonProps: { danger: true },
      okText: t('pluginStore.uninstall.confirm'),
      title: t('pluginStore.uninstall.title', {
        name: resolvePluginDisplayName(selectedPlugin, language)
      }),
      onCancel: () => {
        const operation = uninstallOperationRef.current
        if (operation?.scope === selectedScope && operation.generation === modalGeneration) {
          operation.controller.abort()
        }
      },
      onOk: async () => {
        if (uninstallOperationRef.current != null || activeScopeRef.current !== selectedScope) return
        const operation: PluginUninstallOperation = {
          controller: new AbortController(),
          generation: uninstallGenerationRef.current,
          scope: selectedScope
        }
        uninstallOperationRef.current = operation
        setUninstallingOperation(operation)
        const isCurrentOperation = () => (
          uninstallOperationRef.current === operation &&
          uninstallGenerationRef.current === operation.generation &&
          activeScopeRef.current === operation.scope
        )
        try {
          await uninstallPluginMarketplacePlugin(selectedScope, plan.token, {
            serverBaseUrl: pluginServerBaseUrl,
            signal: operation.controller.signal
          })
          if (operation.controller.signal.aborted || !isCurrentOperation()) return
          const refreshResults = await Promise.allSettled([
            refreshPlugins(),
            listPluginMarketplaceCatalog({
              serverBaseUrl: pluginServerBaseUrl
            }).then(catalog =>
              mutateSWR(
                ['/api/plugins/marketplace/catalog', pluginServerBaseUrl ?? 'current'],
                catalog,
                { revalidate: false }
              )
            )
          ])
          if (operation.controller.signal.aborted || !isCurrentOperation()) return
          if (refreshResults.some(result => result.status === 'rejected')) {
            void message.error(t('pluginStore.uninstall.refreshFailed'))
          } else {
            void message.success(t('pluginStore.uninstall.success'))
          }
          void navigate(PLUGIN_PATHS.list)
        } catch (error) {
          if (operation.controller.signal.aborted || !isCurrentOperation()) return
          if (
            error instanceof ApiError &&
            error.code === 'plugin_uninstall_plan_stale'
          ) {
            setSuppressedUninstallPlan({ rejectedToken: plan.token, scope: selectedScope })
            await mutateSelectedPluginUninstallPlan(undefined, { revalidate: false })
            const refreshedPlan = await mutateSelectedPluginUninstallPlan().catch(() => undefined)
            if (operation.controller.signal.aborted || !isCurrentOperation()) return
            if (refreshedPlan?.available === true && refreshedPlan.token !== plan.token) {
              setSuppressedUninstallPlan(undefined)
            }
            uninstallModalRef.current?.destroy()
            uninstallModalRef.current = undefined
            void message.error(t('pluginStore.uninstall.stale'))
            return
          }
          void message.error(getApiErrorMessage(error, t('pluginStore.uninstall.failed')))
          throw error
        } finally {
          if (uninstallOperationRef.current === operation) {
            uninstallOperationRef.current = undefined
            setUninstallingOperation(undefined)
          }
        }
      }
    })
  }, [
    language,
    message,
    modal,
    mutateSWR,
    mutateSelectedPluginUninstallPlan,
    navigate,
    pluginServerBaseUrl,
    refreshPlugins,
    selectedPlugin,
    visiblePluginUninstallPlan,
    t
  ])

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
        language,
        pluginServerBaseUrl,
        createPluginContextMenuItems,
        visibleNativePlugins
      ),
    [
      createPluginContextMenuItems,
      language,
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
      if (visiblePluginUninstallPlan?.available === true) {
        items.push({
          danger: true,
          disabled: uninstallingOperation != null || updatingEnabledAction != null,
          icon: 'delete',
          key: 'plugin-uninstall',
          label: t('pluginStore.uninstall.action'),
          loading: uninstallingOperation?.scope === selectedPlugin.scope,
          onSelect: confirmMarketplacePluginUninstall
        })
      }
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
                ? 'pluginStore.removeMarketplacePlugin'
                : 'pluginStore.installMarketplacePluginGlobal'
              : installed
              ? 'pluginStore.removeMarketplacePlugin'
              : 'pluginStore.installMarketplacePluginProject'
          ),
          loading: installingMarketplaceTarget === target,
          onSelect: () => void toggleMarketplacePlugin(target)
        })
      }
    }
    return [...items, ...routePluginHeaderActions]
  }, [
    isDiagnosticsPage,
    detailPath,
    confirmMarketplacePluginUninstall,
    toggleMarketplacePlugin,
    installingMarketplaceTarget,
    navigate,
    pluginLocation.page,
    routePluginHeaderActions,
    scope,
    selectedDetailItem,
    selectedMarketplacePlugin,
    selectedPlugin,
    selectedPluginDiagnostics,
    visiblePluginUninstallPlan,
    t,
    togglePluginEnabled,
    toggleWatch,
    updatingEnabledAction,
    updatingWatchScope,
    uninstallingOperation
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
                  onPluginsChanged={refreshPlugins}
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
