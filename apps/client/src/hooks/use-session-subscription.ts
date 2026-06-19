import { useEffect } from 'react'
import { useSWRConfig } from 'swr'

import type { WSEvent } from '@oneworks/core'

import {
  revalidateConfigRelatedCaches,
  updateSessionCaches,
  updateWorkspacePanelStateCache
} from '#~/hooks/session-subscription-cache'
import type { SessionUpdate } from '#~/hooks/session-subscription-cache'
import { createSocket } from '#~/ws.js'

export function useSessionSubscription() {
  const { mutate } = useSWRConfig()

  useEffect(() => {
    let disposed = false
    let socket: WebSocket | undefined
    let connectTimer: ReturnType<typeof setTimeout> | undefined

    const closeSocket = (target: WebSocket | undefined) => {
      if (!target) return
      if (target.readyState === WebSocket.CLOSED || target.readyState === WebSocket.CLOSING) {
        return
      }
      if (target.readyState === WebSocket.CONNECTING) {
        target.addEventListener('open', () => target.close(), { once: true })
        return
      }
      target.close()
    }

    const scheduleConnect = (delay = 0) => {
      if (disposed) return
      if (connectTimer) {
        clearTimeout(connectTimer)
      }
      connectTimer = setTimeout(() => {
        connectTimer = undefined
        connect()
      }, delay)
    }

    const connect = () => {
      if (disposed) return

      socket = createSocket({
        onMessage: (data: WSEvent) => {
          if (disposed) return

          if (data.type === 'session_updated') {
            const updatedSession = data.session as SessionUpdate

            updateSessionCaches(mutate, updatedSession)
            return
          }

          if (data.type === 'config_updated') {
            void revalidateConfigRelatedCaches(mutate)
            return
          }

          if (data.type === 'workspace_panel_state_updated') {
            updateWorkspacePanelStateCache(mutate, {
              panelState: data.panelState,
              updatedAt: data.updatedAt
            })
          }
        },
        onClose: (event) => {
          if (disposed) return
          if (event.code === 1008) return
          scheduleConnect(1000)
        },
        onError: () => {
          closeSocket(socket)
        }
      }, { subscribe: 'sessions' })
    }

    scheduleConnect()

    return () => {
      disposed = true
      if (connectTimer) {
        clearTimeout(connectTimer)
      }
      closeSocket(socket)
    }
  }, [mutate])
}
