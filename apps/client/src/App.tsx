import { Suspense, lazy, useRef } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { isStandaloneDeviceRoutePath } from '@oneworks/types'

import { WorkspaceConnectionGate } from '#~/WorkspaceConnectionGate'
import { getRuntimeWorkspaceId, isDesktopClientMode, isServerManagerRole } from '#~/runtime-config'

const DevComponentLabRoute = import.meta.env.DEV
  ? lazy(async () => ({
    default: (await import('#~/routes/dev/ComponentLabRoute')).ComponentLabRoute
  }))
  : null

const LauncherApp = lazy(async () => ({
  default: (await import('#~/LauncherApp')).LauncherApp
}))

const StandaloneMobileDebugRoute = lazy(async () => ({
  default: (await import('#~/routes/StandaloneMobileDebugRoute')).StandaloneMobileDebugRoute
}))

const WorkspaceApp = lazy(async () => ({
  default: (await import('#~/WorkspaceApp')).WorkspaceApp
}))

const isHomepagePreviewSearch = (search: string) => (
  __ONEWORKS_PROJECT_HOMEPAGE_PREVIEW__ &&
  new URLSearchParams(search).get('owPreview') === 'homepage'
)

function DevComponentLabApp() {
  const Route = DevComponentLabRoute

  if (Route == null) {
    return <Navigate to='/' replace />
  }

  return (
    <Suspense fallback={null}>
      <Route />
    </Suspense>
  )
}

export default function App() {
  const location = useLocation()
  const isManagerLauncher = isServerManagerRole()
  const workspaceId = getRuntimeWorkspaceId()
  const isHomepagePreviewEntry = isHomepagePreviewSearch(location.search)
  const homepagePreviewActiveRef = useRef(isHomepagePreviewEntry)
  if (isHomepagePreviewEntry) {
    homepagePreviewActiveRef.current = true
  }

  if (location.pathname === '/__component-lab') {
    return <DevComponentLabApp />
  }

  if (isStandaloneDeviceRoutePath(`${location.pathname}${location.search}`)) {
    return (
      <Suspense fallback={null}>
        <StandaloneMobileDebugRoute />
      </Suspense>
    )
  }

  if (workspaceId != null) {
    return (
      <Suspense fallback={null}>
        <WorkspaceConnectionGate workspaceId={workspaceId}>
          <WorkspaceApp />
        </WorkspaceConnectionGate>
      </Suspense>
    )
  }

  if (homepagePreviewActiveRef.current) {
    return (
      <Suspense fallback={null}>
        <WorkspaceApp />
      </Suspense>
    )
  }

  if (location.pathname === '/launcher') {
    if (window.oneworksDesktop == null && !isManagerLauncher) {
      return <Navigate to='/' replace />
    }
    return (
      <Suspense fallback={null}>
        <LauncherApp />
      </Suspense>
    )
  }

  if (window.oneworksDesktop != null && isDesktopClientMode() && !isManagerLauncher) {
    return (
      <Suspense fallback={null}>
        <WorkspaceApp />
      </Suspense>
    )
  }

  return (
    <Navigate
      to={{
        pathname: '/launcher',
        search: location.search,
        hash: location.hash
      }}
      replace
    />
  )
}
