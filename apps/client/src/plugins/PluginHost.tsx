import './PluginHost.scss'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useLocation, useParams } from 'react-router-dom'

import { RouteContainerHeader } from '#~/components/layout/RouteContainerHeader'
import { RouteContainerLayout } from '#~/components/layout/RouteContainerLayout'
import { useRouteContainerSidebarOpener } from '#~/components/layout/use-route-container-sidebar-opener'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import type { RouteContainerHeaderActionItem, RouteContainerHeaderBreadcrumb } from '@oneworks/components/route-layout'

import { listPluginRuntimeEndpoints, setPluginOptions } from './api'
import { usePluginContext } from './plugin-context'
import type { PluginHostComponentEntry } from './plugin-host-components'
import { createPluginHostComponentReactApi, renderPluginHostComponent } from './plugin-host-components'
import { createPluginI18nContext, resolvePluginContributionText } from './plugin-i18n'
import type {
  PluginDisposable,
  PluginHostComponentApi,
  PluginViewContext,
  PluginViewRouteLauncherChrome,
  PluginViewSurface
} from './plugin-manifest'
import { invokePluginRuntimeChannel } from './plugin-runtime'
import { useRoutePluginChrome } from './route-plugin-chrome'

const usePluginHostComponents = (surface: PluginViewSurface) => {
  const [entries, setEntries] = useState<PluginHostComponentEntry[]>([])
  const activeDisposablesRef = useRef(new Set<PluginDisposable>())
  const disposablesByContainerRef = useRef(new WeakMap<HTMLElement, PluginDisposable>())
  const nextIdRef = useRef(0)

  const disposeAll = useCallback(() => {
    Array.from(activeDisposablesRef.current).forEach(disposable => disposable.dispose())
    activeDisposablesRef.current.clear()
    setEntries([])
  }, [])

  const api = useMemo<PluginHostComponentApi>(() => ({
    render(component, container, props) {
      disposablesByContainerRef.current.get(container)?.dispose()

      const id = `plugin-host-component-${nextIdRef.current++}`
      let isDisposed = false
      const disposable: PluginDisposable = {
        dispose() {
          if (isDisposed) return
          isDisposed = true
          activeDisposablesRef.current.delete(disposable)
          if (disposablesByContainerRef.current.get(container) === disposable) {
            disposablesByContainerRef.current.delete(container)
          }
          setEntries(current => current.filter(entry => entry.id !== id))
        }
      }

      activeDisposablesRef.current.add(disposable)
      disposablesByContainerRef.current.set(container, disposable)
      setEntries(current => [...current, { component, container, id, props }])
      return disposable
    }
  }), [])

  const portals = entries.map(entry =>
    createPortal(
      renderPluginHostComponent(entry.component, entry.props, surface),
      entry.container,
      entry.id
    )
  )

  return {
    api,
    disposeAll,
    portals
  }
}

export function PluginViewHost({
  launcherSearchValue,
  onRouteActionsChange,
  onRouteBreadcrumbChange,
  onRouteLauncherChromeChange,
  onRouteTitleChange,
  routeId,
  scope,
  surface = 'route',
  tab,
  viewId
}: {
  launcherSearchValue?: string
  onRouteActionsChange?: (actions?: RouteContainerHeaderActionItem[]) => void
  onRouteBreadcrumbChange?: (breadcrumb?: RouteContainerHeaderBreadcrumb) => void
  onRouteLauncherChromeChange?: (chrome?: PluginViewRouteLauncherChrome) => void
  onRouteTitleChange?: (title?: string) => void
  routeId?: string
  scope: string
  surface?: PluginViewSurface
  tab?: PluginViewContext['tab']
  viewId: string
}) {
  const { pluginServerBaseUrl, refreshPlugins, registry, runtimeEndpoint, snapshot } = usePluginContext()
  const { i18n } = useTranslation()
  const { isDarkMode, resolvedThemeMode, themeMode } = useResolvedThemeMode()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const {
    api: hostComponentApi,
    disposeAll: disposeHostComponents,
    portals: hostComponentPortals
  } = usePluginHostComponents(surface)
  const pluginHostComponentReactApi = useMemo(
    () => createPluginHostComponentReactApi(surface, { launcherSearchValue }),
    [launcherSearchValue, surface]
  )
  const location = useLocation()
  const pluginI18n = useMemo(() => createPluginI18nContext(), [])
  const view = useMemo(
    () => snapshot.views.find(item => item.scope === scope && item.id === viewId),
    [scope, snapshot.views, viewId]
  )
  const pluginInstance = useMemo(
    () => snapshot.instances.find(item => item.scope === scope),
    [scope, snapshot.instances]
  )
  const language = i18n.resolvedLanguage ?? i18n.language
  const updatePluginOptions = useCallback(async (
    options: Record<string, unknown>,
    target: 'workspace' | 'global' = 'workspace'
  ) => {
    const savedOptions = await setPluginOptions(scope, options, target, { serverBaseUrl: pluginServerBaseUrl })
    await refreshPlugins()
    return savedOptions
  }, [pluginServerBaseUrl, refreshPlugins, scope])
  const viewContext = useMemo<PluginViewContext>(() => ({
    components: hostComponentApi,
    extensions: {
      getContributions: target => registry.getExtensionContributions(scope, target),
      hasPoint: target => registry.hasExtensionPoint(scope, target)
    },
    host: {
      isDarkMode,
      language,
      ...(surface === 'launcher'
        ? {
          launcherSearch: {
            value: launcherSearchValue ?? ''
          }
        }
        : {}),
      resolvedThemeMode,
      surface,
      themeMode
    },
    i18n: pluginI18n,
    options: {
      update: updatePluginOptions,
      value: pluginInstance?.options ?? {}
    },
    runtime: {
      endpoint: runtimeEndpoint,
      invokeChannel: (channelId, invocation) =>
        invokePluginRuntimeChannel(scope, channelId, invocation, pluginServerBaseUrl),
      listEndpoints: () => listPluginRuntimeEndpoints({ serverBaseUrl: pluginServerBaseUrl })
    },
    ...(onRouteTitleChange == null
      ? {}
      : {
        route: {
          setActions: (actions) => onRouteActionsChange?.(actions as RouteContainerHeaderActionItem[] | undefined),
          setBreadcrumb: breadcrumb =>
            onRouteBreadcrumbChange?.(breadcrumb as RouteContainerHeaderBreadcrumb | undefined),
          setLauncherChrome: chrome => onRouteLauncherChromeChange?.(chrome),
          setTitle: onRouteTitleChange
        }
      }),
    routeId,
    scope,
    ...(tab == null ? {} : { tab }),
    ui: pluginHostComponentReactApi
  }), [
    hostComponentApi,
    isDarkMode,
    language,
    launcherSearchValue,
    pluginI18n,
    pluginInstance?.options,
    pluginServerBaseUrl,
    pluginHostComponentReactApi,
    registry,
    runtimeEndpoint,
    onRouteActionsChange,
    onRouteBreadcrumbChange,
    onRouteLauncherChromeChange,
    onRouteTitleChange,
    resolvedThemeMode,
    routeId,
    scope,
    surface,
    tab,
    themeMode,
    updatePluginOptions
  ])

  useEffect(() => () => disposeHostComponents(), [disposeHostComponents])

  useEffect(() => {
    const container = containerRef.current
    if (container == null || view?.render == null) return
    container.replaceChildren()
    const cleanup = view.render(container, viewContext)
    return () => {
      cleanup?.dispose()
      disposeHostComponents()
      container.replaceChildren()
    }
  }, [disposeHostComponents, view, viewContext])

  useEffect(() => {
    if (surface !== 'route' && surface !== 'launcher') return
    window.dispatchEvent(
      new CustomEvent('oneworks:plugin-route-change', {
        detail: {
          hash: location.hash,
          path: location.pathname,
          pluginScope: scope,
          route: `${location.pathname}${location.search}${location.hash}`,
          routeId,
          search: location.search,
          surface
        }
      })
    )
  }, [location.hash, location.pathname, location.search, routeId, scope, surface])

  if (view?.renderNode != null) {
    return (
      <>
        <div
          className={`plugin-view-host plugin-view-host--${surface}`}
          data-plugin-scope={scope}
          data-plugin-surface={surface}
          data-plugin-view={viewId}
        >
          {view.renderNode(viewContext)}
        </div>
        {hostComponentPortals}
      </>
    )
  }

  return (
    <>
      <div
        ref={containerRef}
        className={`plugin-view-host plugin-view-host--${surface}`}
        data-plugin-scope={scope}
        data-plugin-surface={surface}
        data-plugin-view={viewId}
      />
      {hostComponentPortals}
    </>
  )
}

export function PluginRoute() {
  const { registry, snapshot } = usePluginContext()
  const { i18n } = useTranslation()
  const { routeId = '', scope = '' } = useParams()
  const route = registry.findRoute(scope, routeId) ??
    snapshot.routes.find(item => item.scope === scope && item.id === routeId)
  const { openRouteSidebar } = useRouteContainerSidebarOpener()
  const { headerActions: routePluginHeaderActions } = useRoutePluginChrome('plugin-route')
  const language = i18n.resolvedLanguage ?? i18n.language
  const [routeActionsOverride, setRouteActionsOverride] = useState<RouteContainerHeaderActionItem[]>([])
  const [routeBreadcrumbOverride, setRouteBreadcrumbOverride] = useState<RouteContainerHeaderBreadcrumb | undefined>()
  const [routeTitleOverride, setRouteTitleOverride] = useState<string | undefined>()
  const handleRouteActionsChange = useCallback((actions?: RouteContainerHeaderActionItem[]) => {
    setRouteActionsOverride(actions ?? [])
  }, [])
  const handleRouteBreadcrumbChange = useCallback((breadcrumb?: RouteContainerHeaderBreadcrumb) => {
    setRouteBreadcrumbOverride(breadcrumb)
  }, [])

  useEffect(() => {
    setRouteActionsOverride([])
    setRouteBreadcrumbOverride(undefined)
    setRouteTitleOverride(undefined)
  }, [routeId, scope])

  if (route == null) {
    return null
  }

  const routeTitle = routeTitleOverride ?? resolvePluginContributionText(route, 'title', language) ?? routeId

  return (
    <RouteContainerLayout
      className='plugin-route'
      bodyClassName='plugin-route__body'
      contentInset
      header={
        <RouteContainerHeader
          actionItems={[...routeActionsOverride, ...routePluginHeaderActions]}
          breadcrumb={routeBreadcrumbOverride}
          icon={route.icon ?? 'extension'}
          onOpenSidebar={openRouteSidebar}
          title={routeTitle}
        />
      }
    >
      <PluginViewHost
        scope={scope}
        routeId={routeId}
        surface='route'
        viewId={route.viewId}
        onRouteActionsChange={handleRouteActionsChange}
        onRouteBreadcrumbChange={handleRouteBreadcrumbChange}
        onRouteTitleChange={setRouteTitleOverride}
      />
    </RouteContainerLayout>
  )
}
