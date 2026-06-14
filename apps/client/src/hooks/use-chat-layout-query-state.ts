import { useCallback } from 'react'

import type { WorkspaceDrawerView } from '#~/components/chat/workspace-drawer/workspace-drawer-types'
import { useQueryParams } from '#~/hooks/useQueryParams.js'

type ChatLayoutMode = 'workspace'

interface ChatLayoutQueryParams {
  [key: string]: string
  layout: string
  workspaceFullscreen: string
  workspaceView: string
}

const CHAT_LAYOUT_QUERY_KEYS: string[] = ['layout', 'workspaceFullscreen', 'workspaceView']
const CHAT_LAYOUT_QUERY_DEFAULTS: Partial<ChatLayoutQueryParams> = {
  layout: '',
  workspaceFullscreen: '',
  workspaceView: ''
}
const CHAT_LAYOUT_QUERY_OMIT = {
  layout: (value: string) => value === '',
  workspaceFullscreen: (value: string) => value === '',
  workspaceView: (value: string) => value === ''
} satisfies Partial<Record<keyof ChatLayoutQueryParams, (value: string) => boolean>>

const toChatLayoutMode = (value: string): ChatLayoutMode | undefined => {
  return value === 'workspace' ? value : undefined
}

export function useChatLayoutQueryState() {
  const { values, update } = useQueryParams<ChatLayoutQueryParams>({
    defaults: CHAT_LAYOUT_QUERY_DEFAULTS,
    keys: CHAT_LAYOUT_QUERY_KEYS,
    omit: CHAT_LAYOUT_QUERY_OMIT
  })

  const activeLayout = toChatLayoutMode(values.layout)
  const workspaceDrawerView = values.workspaceView === ''
    ? undefined
    : values.workspaceView as WorkspaceDrawerView
  const setWorkspaceDrawerOpen = useCallback((open: boolean, view?: WorkspaceDrawerView) =>
    update({
      layout: open ? 'workspace' : '',
      ...(open ? {} : { workspaceFullscreen: '' }),
      ...(view != null ? { workspaceView: view } : open ? {} : { workspaceView: '' })
    }), [update])
  const setWorkspaceDrawerFullscreen = useCallback((fullscreen: boolean) =>
    update({
      layout: activeLayout === 'workspace' || fullscreen ? 'workspace' : '',
      workspaceFullscreen: fullscreen ? 'true' : ''
    }), [activeLayout, update])

  return {
    activeLayout,
    isWorkspaceDrawerOpen: activeLayout === 'workspace',
    isWorkspaceDrawerFullscreen: values.workspaceFullscreen === 'true',
    workspaceDrawerView,
    setWorkspaceDrawerFullscreen,
    setWorkspaceDrawerOpen
  }
}
