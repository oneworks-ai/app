import './WorkspaceConnectionGate.scss'

import { Alert, Spin } from 'antd'
import type { PropsWithChildren } from 'react'
import { useEffect, useState } from 'react'

import { getLauncherWorkspaceConnection } from '#~/api/launcher'
import { mergeRuntimeEnv, normalizeServerBaseUrl } from '#~/runtime-config'

type ConnectionState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { message: string; status: 'error' }

export function WorkspaceConnectionGate({
  children,
  workspaceId
}: PropsWithChildren<{ workspaceId: string }>) {
  const [state, setState] = useState<ConnectionState>({ status: 'loading' })

  useEffect(() => {
    let disposed = false
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
  }, [workspaceId])

  if (state.status === 'ready') {
    return children
  }

  if (state.status === 'error') {
    return (
      <div className='workspace-connection-gate workspace-connection-gate--error'>
        <Alert type='error' showIcon message={state.message} />
      </div>
    )
  }

  return (
    <div className='workspace-connection-gate workspace-connection-gate--loading'>
      <Spin size='large' />
    </div>
  )
}
