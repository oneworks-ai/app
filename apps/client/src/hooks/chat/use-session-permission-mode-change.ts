import { useCallback } from 'react'

import { updateSession } from '#~/api.js'

import type { PermissionMode } from './use-chat-permission-mode'

export function useSessionPermissionModeChange(
  sessionId: string | undefined,
  setPermissionMode: (mode: PermissionMode) => void
) {
  return useCallback((mode: PermissionMode) => {
    setPermissionMode(mode)
    if (sessionId == null || sessionId === '') {
      return
    }

    void updateSession(sessionId, { permissionMode: mode }).catch((error) => {
      console.error('Failed to update session permission mode:', error)
    })
  }, [sessionId, setPermissionMode])
}
