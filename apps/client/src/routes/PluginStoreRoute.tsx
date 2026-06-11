/* eslint-disable max-lines -- plugin route coordinates route sidebar, create, marketplace, and detail views. */

import './PluginStoreRoute.scss'
import './PluginDetailRoute.scss'

import { App, Empty, Spin } from 'antd'
import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { RouteContainerHeader } from '#~/components/layout/RouteContainerHeader'
import { RouteContainerLayout } from '#~/components/layout/RouteContainerLayout'
import { useRouteSidebar } from '#~/components/layout/route-sidebar-context'
import type { RouteSidebarListContextMenuItems, RouteSidebarListItem } from '#~/components/layout/route-sidebar-context'
import { useRouteContainerSidebarOpener } from '#~/components/layout/use-route-container-sidebar-opener'
import { PluginCreateLanding } from '#~/components/plugins/PluginCreateLanding'
import { PluginDetailPanel } from '#~/components/plugins/PluginDetailPanel'
import { PluginMarketplaceLanding } from '#~/components/plugins/PluginMarketplaceLanding'
import {
  PluginGroupModeControls,
  buildPluginRouteSidebarGroups,
  resolvePluginSourceGroup
} from '#~/components/plugins/PluginStoreSidebarControls'
import type { PluginGroupMode } from '#~/components/plugins/PluginStoreSidebarControls'
import { setPluginEnabled, setPluginWatch } from '#~/plugins/api'
import { usePluginContext } from '#~/plugins/plugin-context'
import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'
import { useRoutePluginChrome } from '#~/plugins/route-plugin-chrome'
import { copyTextWithFeedback } from '#~/utils/copy'

const PLUGIN_ROUTE_SIDEBAR_KEY = 'plugin-store'

type PluginStoreViewMode = 'create' | 'marketplace'

export function PluginStoreRoute() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { scope = '' } = useParams()
  const [searchParams] = useSearchParams()
  const { openRouteSidebar } = useRouteContainerSidebarOpener()
  const { clearRouteSidebar, hasRouteSidebarProvider, setRouteSidebar } = useRouteSidebar()
  const { refreshPlugins, reloadPlugin, snapshot } = usePluginContext()
  const {
    headerActions: routePluginHeaderActions,
    sidebarContextMenuItems: routePluginSidebarContextMenu
  } = useRoutePluginChrome('plugins')
  const [updatingEnabledAction, setUpdatingEnabledAction] = useState<string>()
  const [updatingWatchScope, setUpdatingWatchScope] = useState<string>()
  const [pluginQuery, setPluginQuery] = useState('')
  const [pluginGroupMode, setPluginGroupMode] = useState<PluginGroupMode>('enabled')
  const [pluginMarketplaceQuery, setPluginMarketplaceQuery] = useState('')
  const pluginStoreViewMode: PluginStoreViewMode = scope === '' && searchParams.get('mode') === 'create'
    ? 'create'
    : 'marketplace'

  const plugins = useMemo(
    () => [...snapshot.instances].sort((left, right) => left.scope.localeCompare(right.scope)),
    [snapshot.instances]
  )
  const selectedPlugin = useMemo(
    () => scope === '' ? undefined : plugins.find(plugin => plugin.scope === scope),
    [plugins, scope]
  )
  const headerTitle = selectedPlugin != null
    ? selectedPlugin.displayName ?? selectedPlugin.name ?? selectedPlugin.scope
    : scope === ''
    ? t(pluginStoreViewMode === 'create' ? 'pluginStore.createPlugin' : 'pluginStore.marketplace')
    : t('pluginDetail.notFound')
  const headerIcon = selectedPlugin?.enabled === false
    ? 'extension_off'
    : scope === '' && pluginStoreViewMode === 'marketplace'
    ? 'storefront'
    : 'extension'
  const diagnostics = useMemo(
    () => [
      ...snapshot.diagnostics,
      ...plugins.flatMap(plugin => plugin.diagnostics ?? [])
    ],
    [plugins, snapshot.diagnostics]
  )
  const visiblePlugins = useMemo(() => {
    const keyword = pluginQuery.trim().toLowerCase()
    if (keyword === '') return plugins

    return plugins.filter((plugin) => {
      const displayName = plugin.displayName ?? plugin.name ?? plugin.scope
      const source = plugin.packageId ?? plugin.requestId ?? ''
      const root = plugin.pluginRoot ?? plugin.rootDir ?? ''
      return `${displayName} ${plugin.scope} ${source} ${root}`.toLowerCase().includes(keyword)
    })
  }, [pluginQuery, plugins])

  const toggleWatch = useCallback(async (scope: string, enabled: boolean) => {
    setUpdatingWatchScope(scope)
    try {
      await setPluginWatch(scope, enabled)
      await refreshPlugins()
      void message.success(enabled ? t('pluginStore.watchEnabled') : t('pluginStore.watchDisabled'))
    } catch (error) {
      console.error('[plugin] failed to update watch mode', error)
      void message.error(t('pluginStore.watchUpdateFailed'))
    } finally {
      setUpdatingWatchScope(undefined)
    }
  }, [message, refreshPlugins, t])

  const togglePluginEnabled = useCallback((
    scope: string,
    enabled: boolean,
    target: 'workspace' | 'global' = 'workspace'
  ) => {
    const actionKey = `${target}:${scope}`
    setUpdatingEnabledAction(actionKey)
    return setPluginEnabled(scope, enabled, target)
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
  }, [message, refreshPlugins, t])

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
            void navigate(`/plugins/${encodeURIComponent(plugin.scope)}`)
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
    () => buildPluginRouteSidebarGroups(visiblePlugins, pluginGroupMode, t, createPluginContextMenuItems),
    [createPluginContextMenuItems, pluginGroupMode, t, visiblePlugins]
  )

  const pluginGroupModeSuffix = useMemo(() => (
    <PluginGroupModeControls
      groupMode={pluginGroupMode}
      t={t}
      onGroupModeChange={setPluginGroupMode}
    />
  ), [pluginGroupMode, t])

  const handleRouteSidebarSelect = useCallback((item: RouteSidebarListItem) => {
    void navigate(`/plugins/${encodeURIComponent(item.key)}`)
  }, [navigate])

  useLayoutEffect(() => {
    if (!hasRouteSidebarProvider) return undefined

    setRouteSidebar({
      activeKey: selectedPlugin?.scope,
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
    setRouteSidebar,
    t
  ])

  return (
    <RouteContainerLayout
      className='plugin-store-route'
      bodyClassName='plugin-store-route__body'
      contentInset
      header={
        <RouteContainerHeader
          actionItems={routePluginHeaderActions}
          icon={headerIcon}
          onOpenSidebar={openRouteSidebar}
          title={headerTitle}
        />
      }
    >
      <div className='plugin-store-route__content'>
        <div className='plugin-store-route__main'>
          {scope === ''
            ? pluginStoreViewMode === 'create'
              ? <PluginCreateLanding />
              : (
                <PluginMarketplaceLanding
                  query={pluginMarketplaceQuery}
                  onQueryChange={setPluginMarketplaceQuery}
                />
              )
            : selectedPlugin == null
            ? (
              <div className='plugin-store-route__not-found'>
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('pluginDetail.notFound')} />
              </div>
            )
            : (
              <PluginDetailPanel
                plugin={selectedPlugin}
                snapshot={snapshot}
                enabledLoading={updatingEnabledAction === `workspace:${selectedPlugin.scope}`}
                watchLoading={updatingWatchScope === selectedPlugin.scope}
                onContributionPreferencesChange={() => reloadPlugin(selectedPlugin.scope)}
                onEnabledChange={checked => void togglePluginEnabled(selectedPlugin.scope, checked, 'workspace')}
                onOptionsChange={() => refreshPlugins()}
                onWatchChange={checked => void toggleWatch(selectedPlugin.scope, checked)}
              />
            )}
        </div>
        {(updatingEnabledAction != null || updatingWatchScope != null) && (
          <div className='plugin-store-route__saving' aria-live='polite'>
            <Spin size='small' />
          </div>
        )}
        {diagnostics.length > 0 && (
          <div className='plugin-store-route__diagnostic-badge' aria-label={t('pluginStore.diagnostics')}>
            <MaterialSymbol name='bug_report' />
            <span>{diagnostics.length}</span>
          </div>
        )}
      </div>
    </RouteContainerLayout>
  )
}
