import { Suspense, lazy } from 'react'

import { AuthGate } from '#~/components/auth/AuthGate'
import { ServerConnectionGate } from '#~/components/server-connection/ServerConnectionGate'
import { useDesktopUiReady } from '#~/desktop/use-desktop-ui-ready'

const AuthenticatedApp = lazy(async () => ({
  default: (await import('#~/AuthenticatedApp')).AuthenticatedApp
}))

export function WorkspaceApp() {
  useDesktopUiReady()
  return (
    <ServerConnectionGate>
      <AuthGate>
        <Suspense fallback={null}>
          <AuthenticatedApp />
        </Suspense>
      </AuthGate>
    </ServerConnectionGate>
  )
}
