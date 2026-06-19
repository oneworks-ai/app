import { useCallback, useContext, useEffect, useRef } from 'react'
import type { PropsWithChildren } from 'react'

import { DesktopWorkspaceStartupReadyContext } from './desktop-workspace-startup-ready'

const STARTUP_MIN_VISIBLE_MS = 720

export function DesktopWorkspaceStartupProvider({ children }: PropsWithChildren) {
  const parentMarkReady = useContext(DesktopWorkspaceStartupReadyContext)
  const markWorkspaceStartupReady = window.oneworksDesktop?.markWorkspaceStartupReady
  const hasStartupOverlay = markWorkspaceStartupReady != null
  const readyRequestedRef = useRef(!hasStartupOverlay)
  const mountedAtRef = useRef(performance.now())
  const readyTimerRef = useRef<number | null>(null)

  const markReady = useCallback(() => {
    if (!hasStartupOverlay || readyRequestedRef.current) return

    readyRequestedRef.current = true
    const elapsedMs = performance.now() - mountedAtRef.current
    const delayMs = Math.max(0, STARTUP_MIN_VISIBLE_MS - elapsedMs)
    readyTimerRef.current = window.setTimeout(() => {
      readyTimerRef.current = null
      markWorkspaceStartupReady()
    }, delayMs)
  }, [hasStartupOverlay, markWorkspaceStartupReady])

  useEffect(() => () => {
    if (readyTimerRef.current != null) {
      window.clearTimeout(readyTimerRef.current)
    }
  }, [])

  return (
    <DesktopWorkspaceStartupReadyContext.Provider value={hasStartupOverlay ? markReady : parentMarkReady}>
      {children}
    </DesktopWorkspaceStartupReadyContext.Provider>
  )
}
