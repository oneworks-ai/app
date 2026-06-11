import type { WorkspaceDrawerView } from '#~/components/chat/workspace-drawer/workspace-drawer-types'
import { useQueryParams } from '#~/hooks/useQueryParams.js'

type ChatLayoutMode = 'workspace'

const toChatLayoutMode = (value: string): ChatLayoutMode | undefined => {
  return value === 'workspace' ? value : undefined
}

export function useChatLayoutQueryState() {
  const { values, update } = useQueryParams<{
    layout: string
    workspaceFullscreen: string
    workspaceView: string
  }>({
    keys: ['layout', 'workspaceFullscreen', 'workspaceView'],
    defaults: {
      layout: '',
      workspaceFullscreen: '',
      workspaceView: ''
    },
    omit: {
      layout: value => value === '',
      workspaceFullscreen: value => value === '',
      workspaceView: value => value === ''
    }
  })

  const activeLayout = toChatLayoutMode(values.layout)
  const workspaceDrawerView = values.workspaceView === ''
    ? undefined
    : values.workspaceView as WorkspaceDrawerView

  return {
    activeLayout,
    isWorkspaceDrawerOpen: activeLayout === 'workspace',
    isWorkspaceDrawerFullscreen: values.workspaceFullscreen === 'true',
    workspaceDrawerView,
    setWorkspaceDrawerOpen: (open: boolean, view?: WorkspaceDrawerView) =>
      update({
        layout: open ? 'workspace' : '',
        ...(open ? {} : { workspaceFullscreen: '' }),
        ...(view != null ? { workspaceView: view } : open ? {} : { workspaceView: '' })
      }),
    setWorkspaceDrawerFullscreen: (fullscreen: boolean) =>
      update({
        layout: activeLayout === 'workspace' || fullscreen ? 'workspace' : '',
        workspaceFullscreen: fullscreen ? 'true' : ''
      })
  }
}
