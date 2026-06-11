import { Suspense, lazy } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

const DevComponentLabRoute = import.meta.env.DEV
  ? lazy(async () => ({
    default: (await import('#~/routes/dev/ComponentLabRoute')).ComponentLabRoute
  }))
  : null

const LauncherApp = lazy(async () => ({
  default: (await import('#~/LauncherApp')).LauncherApp
}))

const WorkspaceApp = lazy(async () => ({
  default: (await import('#~/WorkspaceApp')).WorkspaceApp
}))

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
  if (location.pathname === '/__component-lab') {
    return <DevComponentLabApp />
  }

  if (location.pathname === '/launcher') {
    if (window.oneworksDesktop == null) {
      return <Navigate to='/' replace />
    }
    return (
      <Suspense fallback={null}>
        <LauncherApp />
      </Suspense>
    )
  }

  return (
    <Suspense fallback={null}>
      <WorkspaceApp />
    </Suspense>
  )
}
