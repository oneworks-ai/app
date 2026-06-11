import { Suspense, lazy } from 'react'

import { AuthGate } from '#~/components/auth/AuthGate'
import { ServerConnectionGate } from '#~/components/server-connection/ServerConnectionGate'

const AuthenticatedApp = lazy(async () => ({
  default: (await import('#~/AuthenticatedApp')).AuthenticatedApp
}))

export function WorkspaceApp() {
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
