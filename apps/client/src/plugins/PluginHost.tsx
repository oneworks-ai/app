import './PluginHost.scss'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

import { RouteContainerHeader } from '#~/components/layout/RouteContainerHeader'
import { RouteContainerLayout } from '#~/components/layout/RouteContainerLayout'
import { useRouteContainerSidebarOpener } from '#~/components/layout/use-route-container-sidebar-opener'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'

import { setPluginOptions } from './api'
import { usePluginContext } from './plugin-context'
import type { PluginHostComponentEntry } from './plugin-host-components'
import { pluginHostComponentReactApi, renderPluginHostComponent } from './plugin-host-components'
import { createPluginI18nContext, resolvePluginContributionText } from './plugin-i18n'
import type { PluginDisposable, PluginHostComponentApi, PluginViewContext, PluginViewSurface } from './plugin-manifest'
import { useRoutePluginChrome } from './route-plugin-chrome'

const usePluginHostComponents = () => {
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
      renderPluginHostComponent(entry.component, entry.props),
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
  routeId,
  scope,
  surface = 'route',
  tab,
  viewId
}: {
  routeId?: string
  scope: string
  surface?: PluginViewSurface
  tab?: PluginViewContext['tab']
  viewId: string
}) {
  const { refreshPlugins, registry, snapshot } = usePluginContext()
  const { i18n } = useTranslation()
  const { isDarkMode, resolvedThemeMode, themeMode } = useResolvedThemeMode()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const {
    api: hostComponentApi,
    disposeAll: disposeHostComponents,
    portals: hostComponentPortals
  } = usePluginHostComponents()
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
    const savedOptions = await setPluginOptions(scope, options, target)
    await refreshPlugins()
    return savedOptions
  }, [refreshPlugins, scope])
  const viewContext = useMemo<PluginViewContext>(() => ({
    components: hostComponentApi,
    extensions: {
      getContributions: target => registry.getExtensionContributions(scope, target),
      hasPoint: target => registry.hasExtensionPoint(scope, target)
    },
    host: {
      isDarkMode,
      language,
      resolvedThemeMode,
      surface,
      themeMode
    },
    i18n: pluginI18n,
    options: {
      update: updatePluginOptions,
      value: pluginInstance?.options ?? {}
    },
    routeId,
    scope,
    ...(tab == null ? {} : { tab }),
    ui: pluginHostComponentReactApi
  }), [
    hostComponentApi,
    isDarkMode,
    language,
    pluginI18n,
    pluginInstance?.options,
    registry,
    resolvedThemeMode,
    routeId,
    scope,
    snapshot.extensionContributions,
    snapshot.extensionPoints,
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

  if (view?.renderNode != null) {
    return (
      <>
        <div className='plugin-view-host' data-plugin-scope={scope} data-plugin-view={viewId}>
          {view.renderNode(viewContext)}
        </div>
        {hostComponentPortals}
      </>
    )
  }

  return (
    <>
      <div ref={containerRef} className='plugin-view-host' data-plugin-scope={scope} data-plugin-view={viewId} />
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

  if (route == null) {
    return null
  }

  const routeTitle = resolvePluginContributionText(route, 'title', language) ?? routeId

  return (
    <RouteContainerLayout
      className='plugin-route'
      bodyClassName='plugin-route__body'
      contentInset
      header={
        <RouteContainerHeader
          actionItems={routePluginHeaderActions}
          icon={route.icon ?? 'extension'}
          onOpenSidebar={openRouteSidebar}
          title={routeTitle}
        />
      }
    >
      <PluginViewHost scope={scope} routeId={routeId} surface='route' viewId={route.viewId} />
    </RouteContainerLayout>
  )
}
