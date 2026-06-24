/* eslint-disable max-lines -- workspace connection gate keeps startup overlay, conflict handling, and retry flow together. */
import './WorkspaceConnectionGate.scss'

import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LauncherWorkspaceVersionConflictDetails } from '@oneworks/types'

import { getApiErrorMessage } from '#~/api/base'
import { getLauncherWorkspaceConnection, restartLauncherWorkspace } from '#~/api/launcher'
import { DesktopWorkspaceStartupReadyContext } from '#~/components/layout/desktop-workspace-startup-ready'
import { WorkspaceOpeningOverlay } from '#~/components/workspace/WorkspaceOpeningOverlay'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import type { WorkspaceServerRestartActivity } from '#~/workspace-connection-state'
import {
  applyWorkspaceConnection,
  getWorkspaceServerRestartActivity,
  getWorkspaceVersionConflictDetails
} from '#~/workspace-connection-state'
import { WorkspaceConnectionErrorView } from './WorkspaceConnectionErrorView'

type ConnectionState =
  | { status: 'loading' }
  | { status: 'ready' }
  | {
    details?: LauncherWorkspaceVersionConflictDetails
    message: string
    restartActivity?: WorkspaceServerRestartActivity
    status: 'error'
  }

type OpeningOverlayPhase = 'visible' | 'exiting' | 'hidden'

const OPENING_OVERLAY_MIN_VISIBLE_MS = 720
const OPENING_OVERLAY_EXIT_MS = 420
const OPENING_OVERLAY_READY_FALLBACK_MS = 8_000

const createVersionConflictRestartKey = (details: LauncherWorkspaceVersionConflictDetails) => (
  JSON.stringify({
    existingImplementationId: details.existing.implementationId,
    existingLaunchConfigHash: details.existing.launchConfigHash,
    existingServerBaseUrl: details.existing.serverBaseUrl,
    requestedImplementationId: details.requested.implementationId,
    requestedLaunchConfigHash: details.requested.launchConfigHash,
    workspaceFolder: details.workspaceFolder
  })
)

export function WorkspaceConnectionGate({
  children,
  workspaceId
}: PropsWithChildren<{ workspaceId: string }>) {
  const { t } = useTranslation()
  const { resolvedThemeMode } = useResolvedThemeMode()
  const [state, setState] = useState<ConnectionState>({ status: 'loading' })
  const [restartErrorMessage, setRestartErrorMessage] = useState<string | undefined>()
  const [isRestarting, setIsRestarting] = useState(false)
  const [overlayPhase, setOverlayPhase] = useState<OpeningOverlayPhase>('visible')
  const overlayMountedAtRef = useRef(performance.now())
  const overlayExitRequestedRef = useRef(false)
  const overlayExitTimerRef = useRef<number | null>(null)
  const overlayHiddenTimerRef = useRef<number | null>(null)
  const autoRestartAttemptKeyRef = useRef<string | undefined>()
  const restartActivityRef = useRef<WorkspaceServerRestartActivity | undefined>()

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

  const maybeRestartIdleWorkspaceServer = useCallback(async (
    details: LauncherWorkspaceVersionConflictDetails
  ) => {
    if (details.restartable !== true) {
      return undefined
    }

    const restartKey = createVersionConflictRestartKey(details)
    if (autoRestartAttemptKeyRef.current === restartKey) {
      return undefined
    }

    const activity = await getWorkspaceServerRestartActivity(details)
    restartActivityRef.current = activity
    if (activity.status !== 'idle') {
      return undefined
    }

    autoRestartAttemptKeyRef.current = restartKey
    return await restartLauncherWorkspace(workspaceId)
  }, [workspaceId])

  const getWorkspaceConnection = useCallback(async () => {
    try {
      return await getLauncherWorkspaceConnection(workspaceId)
    } catch (error) {
      const details = getWorkspaceVersionConflictDetails(error)
      if (details != null) {
        try {
          const restartedConnection = await maybeRestartIdleWorkspaceServer(details)
          if (restartedConnection != null) {
            return restartedConnection
          }
        } catch {
          // Keep the original version conflict visible; manual restart still reports its own error.
        }
      }
      throw error
    }
  }, [maybeRestartIdleWorkspaceServer, workspaceId])

  const connectWorkspace = useCallback(async () => {
    resetOpeningOverlay()
    setState({ status: 'loading' })
    setRestartErrorMessage(undefined)
    restartActivityRef.current = undefined

    try {
      const connection = await getWorkspaceConnection()
      applyWorkspaceConnection(connection)
      setState({ status: 'ready' })
    } catch (error) {
      const details = getWorkspaceVersionConflictDetails(error)
      const restartActivity = restartActivityRef.current
      restartActivityRef.current = undefined
      setState({
        details,
        message: error instanceof Error && error.message.trim() !== ''
          ? error.message
          : 'Failed to open workspace.',
        ...(restartActivity == null ? {} : { restartActivity }),
        status: 'error'
      })
    }
  }, [getWorkspaceConnection, resetOpeningOverlay])

  useEffect(() => {
    let disposed = false

    void (async () => {
      resetOpeningOverlay()
      setState({ status: 'loading' })
      setRestartErrorMessage(undefined)
      restartActivityRef.current = undefined

      try {
        const connection = await getWorkspaceConnection()
        if (disposed) return
        applyWorkspaceConnection(connection)
        setState({ status: 'ready' })
      } catch (error) {
        if (disposed) return
        const details = getWorkspaceVersionConflictDetails(error)
        const restartActivity = restartActivityRef.current
        restartActivityRef.current = undefined
        setState({
          details,
          status: 'error',
          ...(restartActivity == null ? {} : { restartActivity }),
          message: error instanceof Error && error.message.trim() !== ''
            ? error.message
            : 'Failed to open workspace.'
        })
      }
    })()

    return () => {
      disposed = true
    }
  }, [getWorkspaceConnection, resetOpeningOverlay])

  const restartWorkspaceServer = useCallback(async () => {
    if (state.status !== 'error' || state.details?.restartable !== true) return

    setIsRestarting(true)
    setRestartErrorMessage(undefined)
    try {
      const connection = await restartLauncherWorkspace(workspaceId)
      applyWorkspaceConnection(connection)
      setState({ status: 'ready' })
    } catch (error) {
      setRestartErrorMessage(getApiErrorMessage(error, t('workspaceConnection.restartFailed')))
    } finally {
      setIsRestarting(false)
    }
  }, [state, t, workspaceId])

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
      <WorkspaceConnectionErrorView
        details={state.details}
        isRestarting={isRestarting}
        message={state.message}
        restartActivity={state.restartActivity}
        restartErrorMessage={restartErrorMessage}
        onRestart={() => void restartWorkspaceServer()}
        onRetry={() => void connectWorkspace()}
      />
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
