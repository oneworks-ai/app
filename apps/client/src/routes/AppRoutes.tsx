import { Suspense, lazy } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import type { ExperimentsConfig } from '@oneworks/types'

import { useDesktopWorkspaceStartupReady } from '#~/components/layout/desktop-workspace-startup-ready'
import { useExperimentsState } from '#~/hooks/use-experiments'
import { PluginRoute } from '#~/plugins/PluginHost'

const lazyNamedRoute = <T extends Record<K, ComponentType>, K extends keyof T>(
  loader: () => Promise<T>,
  exportName: K
) =>
  lazy(async () => ({
    default: (await loader())[exportName]
  }))

const AgentRoomRoute = lazyNamedRoute(() => import('#~/routes/AgentRoomRoute'), 'AgentRoomRoute')
const AgentRoomSessionRoute = lazyNamedRoute(
  () => import('#~/routes/AgentRoomSessionRoute'),
  'AgentRoomSessionRoute'
)
const ArchiveRoute = lazyNamedRoute(() => import('#~/routes/ArchiveRoute'), 'ArchiveRoute')
const AutomationRoute = lazyNamedRoute(() => import('#~/routes/AutomationRoute'), 'AutomationRoute')
const BenchmarkRoute = lazyNamedRoute(() => import('#~/routes/BenchmarkRoute'), 'BenchmarkRoute')
const ChatRoute = lazyNamedRoute(() => import('#~/routes/ChatRoute'), 'ChatRoute')
const ConfigRoute = lazyNamedRoute(() => import('#~/routes/ConfigRoute'), 'ConfigRoute')
const InteractionStructureRoute = lazyNamedRoute(
  () => import('#~/routes/dev/InteractionStructureRoute'),
  'InteractionStructureRoute'
)
const KnowledgeRoute = lazyNamedRoute(() => import('#~/routes/KnowledgeRoute'), 'KnowledgeRoute')
const ModuleManagementRoute = lazyNamedRoute(() => import('#~/routes/ModuleManagementRoute'), 'ModuleManagementRoute')
const PluginStoreRoute = lazyNamedRoute(() => import('#~/routes/PluginStoreRoute'), 'PluginStoreRoute')

function ExperimentalRoute({
  children,
  experimentKey
}: {
  children: ReactNode
  experimentKey: keyof Pick<ExperimentsConfig, 'benchmark'>
}) {
  const { experiments, isLoading } = useExperimentsState()

  if (isLoading) return null
  if (experiments[experimentKey] !== true) return <Navigate to='/' replace />

  return children
}

const isChatWorkspaceRoute = (pathname: string) => (
  pathname === '/' ||
  pathname === '/__interaction-structure' ||
  pathname.startsWith('/__interaction-structure/') ||
  pathname.startsWith('/session/') ||
  pathname.startsWith('/rooms/')
)

function DesktopStartupRouteReadySignal() {
  const location = useLocation()
  useDesktopWorkspaceStartupReady(!isChatWorkspaceRoute(location.pathname))
  return null
}

export function AppRoutes() {
  return (
    <>
      <DesktopStartupRouteReadySignal />
      <Suspense fallback={null}>
        <Routes>
          <Route path='/' element={<ChatRoute />} />
          {import.meta.env.DEV
            ? (
              <>
                <Route
                  path='/__interaction-structure'
                  element={<Navigate to='/__interaction-structure/requests' replace />}
                />
                <Route path='/__interaction-structure/:structureRoute' element={<InteractionStructureRoute />} />
              </>
            )
            : null}
          <Route path='/session/:sessionId' element={<ChatRoute />} />
          <Route path='/rooms/:roomId' element={<AgentRoomRoute />} />
          <Route path='/rooms/:roomId/sessions/:sessionId' element={<AgentRoomSessionRoute />} />
          <Route path='/archive' element={<ArchiveRoute />} />
          <Route
            path='/benchmark'
            element={
              <ExperimentalRoute experimentKey='benchmark'>
                <BenchmarkRoute />
              </ExperimentalRoute>
            }
          />
          <Route
            path='/automation'
            element={<AutomationRoute />}
          />
          <Route path='/knowledge' element={<KnowledgeRoute />} />
          <Route path='/modules' element={<ModuleManagementRoute />} />
          <Route path='/config/*' element={<ConfigRoute />} />
          <Route path='/plugins' element={<PluginStoreRoute />} />
          <Route path='/plugins/:scope' element={<PluginStoreRoute />} />
          <Route path='/plugins/:scope/:routeId' element={<PluginRoute />} />
        </Routes>
      </Suspense>
    </>
  )
}
