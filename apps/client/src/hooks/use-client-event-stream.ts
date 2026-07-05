import { useEffect } from 'react'
import { useSWRConfig } from 'swr'

import type { SessionPanelState, WSEvent } from '@oneworks/core'

import { getAuthToken } from '#~/api/auth-token'
import { createApiUrl } from '#~/api/base'
import {
  revalidateConfigRelatedCaches,
  updateSessionCaches,
  updateWorkspacePanelStateCache
} from '#~/hooks/session-subscription-cache'
import type { SessionUpdate } from '#~/hooks/session-subscription-cache'
import { resolveWorkspaceIdFromPathname } from '#~/runtime-config'
import { readRememberedWorkspaceConnectionMetadata } from '#~/workspace-connection-state'

interface ClientEvent {
  channel: string
  event?: WSEvent
  hostSessionId?: string
  panelState?: SessionPanelState
  roomId?: string
  session?: SessionUpdate
  sessionId?: string
  type: string
  updatedAt?: number
  workspaceFolder?: string
}

const buildEventSourceUrl = () => {
  const url = createApiUrl('/api/events')
  url.searchParams.set('channels', 'agent-rooms,config,sessions,workspace')
  const authToken = getAuthToken()
  if (authToken != null) {
    url.searchParams.set('authToken', authToken)
  }
  return url
}

const canUseClientEventStream = () => {
  const workspaceId = resolveWorkspaceIdFromPathname(window.location.pathname)
  if (workspaceId == null) return true
  const connection = readRememberedWorkspaceConnectionMetadata(workspaceId)
  return connection?.transport !== 'relay'
}

export function useClientEventStream() {
  const { mutate } = useSWRConfig()

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      return
    }
    if (!canUseClientEventStream()) {
      return
    }

    const source = new EventSource(buildEventSourceUrl())
    const handleGeneralEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as ClientEvent
      if (event.type === 'session_updated' && event.session != null) {
        updateSessionCaches(mutate, event.session)
        return
      }

      if (event.type === 'config_updated') {
        void revalidateConfigRelatedCaches(mutate)
      }

      if (event.type === 'workspace_panel_state_updated' && event.panelState != null && event.updatedAt != null) {
        updateWorkspacePanelStateCache(mutate, {
          panelState: event.panelState,
          updatedAt: event.updatedAt
        })
      }
    }
    source.addEventListener('session_updated', handleGeneralEvent)
    source.addEventListener('config_updated', handleGeneralEvent)
    source.addEventListener('workspace_panel_state_updated', handleGeneralEvent)
    source.addEventListener('agent_room_updated', (message) => {
      const event = JSON.parse(message.data) as ClientEvent
      void mutate('/api/agent-rooms/summary')
      void mutate('/api/agent-rooms')
      if (event.roomId != null) {
        void mutate(`/api/agent-rooms/${event.roomId}`)
      }
      if (event.hostSessionId != null) {
        void mutate(`/api/agent-rooms/by-host-session/${encodeURIComponent(event.hostSessionId)}`)
      }
    })
    source.addEventListener('session_message_appended', (message) => {
      const event = JSON.parse(message.data) as ClientEvent
      void mutate('/api/agent-rooms/summary')
      if (event.sessionId != null) {
        void mutate(`/api/agent-rooms/by-host-session/${encodeURIComponent(event.sessionId)}`)
      }
    })

    return () => {
      source.close()
    }
  }, [mutate])
}
