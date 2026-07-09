/* eslint-disable max-lines -- workspace connection gate keeps startup overlay, conflict handling, and retry flow together. */
import './WorkspaceConnectionGate.scss'

import type { PropsWithChildren } from 'react'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LauncherWorkspaceVersionConflictDetails } from '@oneworks/types'

import { getApiErrorMessage } from '#~/api/base'
import { restartLauncherWorkspace } from '#~/api/launcher'
import { DesktopWorkspaceStartupReadyContext } from '#~/components/layout/desktop-workspace-startup-ready'
import { WorkspaceOpeningOverlay } from '#~/components/workspace/WorkspaceOpeningOverlay'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import { normalizeWorkspaceId } from '#~/runtime-config'
import { getRestorableWorkspaceConnection } from '#~/workspace-connection-restore'
import type {
  WorkspaceConnection,
  WorkspaceConnectionTransport,
  WorkspaceServerRestartActivity
} from '#~/workspace-connection-state'
import {
  applyWorkspaceConnection,
  getWorkspaceServerRestartActivity,
  getWorkspaceVersionConflictDetails,
  isWorkspaceConnectionResponse,
  rememberWorkspaceConnection
} from '#~/workspace-connection-state'
import { WorkspaceConnectionErrorView } from './WorkspaceConnectionErrorView'

interface ResolvedWorkspaceConnection {
  connection: WorkspaceConnection
  transport?: WorkspaceConnectionTransport
}

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

const withRouteWorkspaceId = (
  connection: WorkspaceConnection,
  workspaceId: string | undefined
): WorkspaceConnection => {
  const resolvedWorkspaceId = normalizeWorkspaceId(connection.workspaceId) ?? normalizeWorkspaceId(workspaceId)
  return resolvedWorkspaceId == null ? connection : { ...connection, workspaceId: resolvedWorkspaceId }
}

export function WorkspaceConnectionGate({
  children,
  workspaceId
}: PropsWithChildren<{ workspaceId?: string }>) {
  const { t } = useTranslation()
  const { resolvedThemeMode } = useResolvedThemeMode()
  const [state, setState] = useState<ConnectionState>({ status: 'loading' })
  const [restartErrorMessage, setRestartErrorMessage] = useState<string | undefined>()
  const [isRestarting, setIsRestarting] = useState(false)
  const [overlayPhase, setOverlayPhase] = useState<OpeningOverlayPhase>('visible')
  const parentMarkWorkspaceStartupReady = useContext(DesktopWorkspaceStartupReadyContext)
  const overlayMountedAtRef = useRef(performance.now())
  const overlayExitRequestedRef = useRef(false)
  const overlayExitTimerRef = useRef<number | null>(null)
  const overlayHiddenTimerRef = useRef<number | null>(null)
  const autoRestartAttemptKeyRef = useRef<string | undefined>()
  const restartActivityRef = useRef<WorkspaceServerRestartActivity | undefined>()
  const desktopConnectionUnavailableMessageRef = useRef(t('workspaceConnection.desktopConnectionUnavailable'))

  useEffect(() => {
    desktopConnectionUnavailableMessageRef.current = t('workspaceConnection.desktopConnectionUnavailable')
  }, [t])

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

  const markWorkspaceStartupReady = useCallback(() => {
    requestOpeningOverlayExit()
    parentMarkWorkspaceStartupReady?.()
  }, [parentMarkWorkspaceStartupReady, requestOpeningOverlayExit])

  const maybeRestartIdleWorkspaceServer = useCallback(async (
    details: LauncherWorkspaceVersionConflictDetails
  ) => {
    if (workspaceId == null) {
      return undefined
    }
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

  const getWorkspaceConnection = useCallback(async (): Promise<ResolvedWorkspaceConnection> => {
    if (workspaceId == null) {
      const connection = await window.oneworksDesktop?.getWorkspaceConnection?.()
      if (isWorkspaceConnectionResponse(connection)) {
        return { connection } satisfies ResolvedWorkspaceConnection
      }
      throw new Error(desktopConnectionUnavailableMessageRef.current)
    }

    try {
      const restoredConnection = await getRestorableWorkspaceConnection(workspaceId)
      return {
        ...restoredConnection,
        connection: withRouteWorkspaceId(restoredConnection.connection, workspaceId)
      } satisfies ResolvedWorkspaceConnection
    } catch (error) {
      const details = getWorkspaceVersionConflictDetails(error)
      if (details != null) {
        try {
          const restartedConnection = await maybeRestartIdleWorkspaceServer(details)
          if (restartedConnection != null) {
            return {
              connection: withRouteWorkspaceId(restartedConnection, workspaceId),
              transport: 'local'
            } satisfies ResolvedWorkspaceConnection
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
      const { connection, transport } = await getWorkspaceConnection()
      applyWorkspaceConnection(connection)
      if (transport != null) {
        rememberWorkspaceConnection(connection, transport)
      }
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
        const { connection, transport } = await getWorkspaceConnection()
        if (disposed) return
        applyWorkspaceConnection(connection)
        if (transport != null) {
          rememberWorkspaceConnection(connection, transport)
        }
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
    if (workspaceId == null || state.status !== 'error' || state.details?.restartable !== true) return

    setIsRestarting(true)
    setRestartErrorMessage(undefined)
    try {
      const connection = withRouteWorkspaceId(await restartLauncherWorkspace(workspaceId), workspaceId)
      applyWorkspaceConnection(connection)
      rememberWorkspaceConnection(connection, 'local')
      setState({ status: 'ready' })
    } catch (error) {
      setRestartErrorMessage(getApiErrorMessage(error, t('workspaceConnection.restartFailed')))
    } finally {
      setIsRestarting(false)
    }
  }, [state, t, workspaceId])

  useEffect(() => () => clearOverlayTimers(), [clearOverlayTimers])

  useEffect(() => {
    if (state.status === 'error') {
      markWorkspaceStartupReady()
    }
  }, [markWorkspaceStartupReady, state.status])

  useEffect(() => {
    if (state.status !== 'ready') return

    const fallbackTimerId = window.setTimeout(
      markWorkspaceStartupReady,
      OPENING_OVERLAY_READY_FALLBACK_MS
    )
    return () => window.clearTimeout(fallbackTimerId)
  }, [markWorkspaceStartupReady, state.status])

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
      value={shouldRenderChildren ? markWorkspaceStartupReady : null}
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
