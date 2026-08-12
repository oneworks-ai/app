import { useCallback, useContext, useRef } from 'react'
import type { PropsWithChildren } from 'react'

import { DesktopWorkspaceStartupReadyContext } from './desktop-workspace-startup-ready'

export function DesktopWorkspaceStartupProvider({ children }: PropsWithChildren) {
  const parentMarkReady = useContext(DesktopWorkspaceStartupReadyContext)
  const markWorkspaceStartupReady = window.oneworksDesktop?.markWorkspaceStartupReady
  const hasStartupOverlay = markWorkspaceStartupReady != null
  const readyRequestedRef = useRef(!hasStartupOverlay)

  const markReady = useCallback(() => {
    if (!hasStartupOverlay || readyRequestedRef.current) return

    readyRequestedRef.current = true
    if (parentMarkReady != null) {
      parentMarkReady()
      return
    }
    markWorkspaceStartupReady()
  }, [hasStartupOverlay, markWorkspaceStartupReady, parentMarkReady])

  return (
    <DesktopWorkspaceStartupReadyContext.Provider value={hasStartupOverlay ? markReady : parentMarkReady}>
      {children}
    </DesktopWorkspaceStartupReadyContext.Provider>
  )
}
