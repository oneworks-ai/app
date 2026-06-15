import './WorkspaceConnectionGate.scss'

import { Alert } from 'antd'
import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getLauncherWorkspaceConnection } from '#~/api/launcher'
import { DesktopWorkspaceStartupReadyContext } from '#~/components/layout/desktop-workspace-startup-ready'
import { WorkspaceOpeningOverlay } from '#~/components/workspace/WorkspaceOpeningOverlay'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import { mergeRuntimeEnv, normalizeServerBaseUrl } from '#~/runtime-config'

type ConnectionState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { message: string; status: 'error' }

type OpeningOverlayPhase = 'visible' | 'exiting' | 'hidden'

const OPENING_OVERLAY_MIN_VISIBLE_MS = 720
const OPENING_OVERLAY_EXIT_MS = 420
const OPENING_OVERLAY_READY_FALLBACK_MS = 8_000

export function WorkspaceConnectionGate({
  children,
  workspaceId
}: PropsWithChildren<{ workspaceId: string }>) {
  const { t } = useTranslation()
  const { resolvedThemeMode } = useResolvedThemeMode()
  const [state, setState] = useState<ConnectionState>({ status: 'loading' })
  const [overlayPhase, setOverlayPhase] = useState<OpeningOverlayPhase>('visible')
  const overlayMountedAtRef = useRef(performance.now())
  const overlayExitRequestedRef = useRef(false)
  const overlayExitTimerRef = useRef<number | null>(null)
  const overlayHiddenTimerRef = useRef<number | null>(null)

  const clearOverlayTimers = useCallback(() => {
    if (overlayExitTimerRef.current != null) {
      window.clearTimeout(overlayExitTimerRef.current)
      overlayExitTimerRef.current = null
    }
    if (overlayHiddenTimerRef.current != null) {
      window.clearTimeout(overlayHiddenTimerRef.current)
      overlayHiddenTimerRef.current = null
    }
  }, [])

  const resetOpeningOverlay = useCallback(() => {
    clearOverlayTimers()
    overlayMountedAtRef.current = performance.now()
    overlayExitRequestedRef.current = false
    setOverlayPhase('visible')
  }, [clearOverlayTimers])

  const requestOpeningOverlayExit = useCallback(() => {
    if (overlayExitRequestedRef.current) return

    overlayExitRequestedRef.current = true
    const elapsedMs = performance.now() - overlayMountedAtRef.current
    const delayMs = Math.max(0, OPENING_OVERLAY_MIN_VISIBLE_MS - elapsedMs)

    overlayExitTimerRef.current = window.setTimeout(() => {
      overlayExitTimerRef.current = null
      setOverlayPhase('exiting')
      overlayHiddenTimerRef.current = window.setTimeout(() => {
        overlayHiddenTimerRef.current = null
        setOverlayPhase('hidden')
      }, OPENING_OVERLAY_EXIT_MS)
    }, delayMs)
  }, [])

  useEffect(() => {
    let disposed = false
    resetOpeningOverlay()
    setState({ status: 'loading' })

    void getLauncherWorkspaceConnection(workspaceId)
      .then((connection) => {
        if (disposed) return

        const serverBaseUrl = normalizeServerBaseUrl(connection.serverBaseUrl)
        if (serverBaseUrl == null) {
          setState({ status: 'error', message: 'Workspace server returned an invalid URL.' })
          return
        }

        mergeRuntimeEnv({
          __ONEWORKS_PROJECT_SERVER_BASE_URL__: serverBaseUrl,
          __ONEWORKS_PROJECT_SERVER_ROLE__: 'workspace',
          __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: connection.workspaceFolder,
          __ONEWORKS_PROJECT_WORKSPACE_ID__: connection.workspaceId
        })
        setState({ status: 'ready' })
      })
      .catch((error) => {
        if (disposed) return
        setState({
          status: 'error',
          message: error instanceof Error && error.message.trim() !== ''
            ? error.message
            : 'Failed to open workspace.'
        })
      })

    return () => {
      disposed = true
    }
  }, [resetOpeningOverlay, workspaceId])

  useEffect(() => () => clearOverlayTimers(), [clearOverlayTimers])

  useEffect(() => {
    if (state.status !== 'ready') return

    const fallbackTimerId = window.setTimeout(
      requestOpeningOverlayExit,
      OPENING_OVERLAY_READY_FALLBACK_MS
    )
    return () => window.clearTimeout(fallbackTimerId)
  }, [requestOpeningOverlayExit, state.status])

  if (state.status === 'error') {
    return (
      <div className='workspace-connection-gate workspace-connection-gate--error'>
        <Alert type='error' showIcon message={state.message} />
      </div>
    )
  }

  const shouldRenderChildren = state.status === 'ready'
  const shouldRenderOverlay = overlayPhase !== 'hidden'

  return (
    <DesktopWorkspaceStartupReadyContext.Provider
      value={shouldRenderChildren ? requestOpeningOverlayExit : null}
    >
      {shouldRenderChildren
        ? children
        : <div className='workspace-connection-gate workspace-connection-gate--loading' />}
      {shouldRenderOverlay && (
        <WorkspaceOpeningOverlay
          appearance={resolvedThemeMode}
          phase={overlayPhase === 'exiting' ? 'exiting' : 'visible'}
          title={t('desktopStartupOverlay.title')}
        />
      )}
    </DesktopWorkspaceStartupReadyContext.Provider>
  )
}
