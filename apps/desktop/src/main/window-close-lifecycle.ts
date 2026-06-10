import type { DesktopRuntimeState, WindowRecord, WorkspaceService } from './types'

const hasWorkspaceWindow = (getWindowRecords: () => WindowRecord[], workspaceFolder: string) => (
  getWindowRecords()
    .some(candidate => candidate.kind === 'workspace' && candidate.workspaceFolder === workspaceFolder)
)

const stopLauncherSourceWorkspaceServiceIfUnused = async ({
  getWindowRecords,
  runtimeState,
  sourceWorkspaceFolder,
  stopWorkspaceService
}: {
  getWindowRecords: () => WindowRecord[]
  runtimeState: DesktopRuntimeState
  sourceWorkspaceFolder?: string
  stopWorkspaceService: (service: WorkspaceService) => Promise<void>
}) => {
  if (
    sourceWorkspaceFolder == null ||
    hasWorkspaceWindow(getWindowRecords, sourceWorkspaceFolder) ||
    getWindowRecords().some(candidate => candidate.kind === 'launcher')
  ) {
    return
  }

  const sourceService = runtimeState.services.get(sourceWorkspaceFolder)
  if (sourceService != null) {
    await stopWorkspaceService(sourceService)
  }
}

export const installWindowCloseLifecycle = ({
  broadcastWorkspaceSelectorState,
  getWindowRecords,
  refreshAppMenu,
  runtimeState,
  stopWorkspaceService,
  windowRecord
}: {
  broadcastWorkspaceSelectorState: () => void
  getWindowRecords: () => WindowRecord[]
  refreshAppMenu: () => void
  runtimeState: DesktopRuntimeState
  stopWorkspaceService: (service: WorkspaceService) => Promise<void>
  windowRecord: WindowRecord
}) => {
  windowRecord.window.on('closed', () => {
    runtimeState.windows.delete(windowRecord.window.id)
    if (windowRecord.kind === 'workspace' && windowRecord.workspaceFolder != null) {
      const hasOtherWorkspaceWindow = hasWorkspaceWindow(getWindowRecords, windowRecord.workspaceFolder)
      const hasLauncherWindowUsingWorkspace = getWindowRecords()
        .some(candidate => candidate.kind === 'launcher' && candidate.workspaceFolder === windowRecord.workspaceFolder)
      if (!hasOtherWorkspaceWindow && !hasLauncherWindowUsingWorkspace) {
        const service = runtimeState.services.get(windowRecord.workspaceFolder)
        if (service != null) {
          void stopWorkspaceService(service)
        }
      }
    }
    if (windowRecord.kind === 'launcher') {
      const hasOtherLauncherWindow = getWindowRecords().some(candidate => candidate.kind === 'launcher')
      if (!hasOtherLauncherWindow) {
        void stopLauncherSourceWorkspaceServiceIfUnused({
          getWindowRecords,
          runtimeState,
          sourceWorkspaceFolder: windowRecord.workspaceFolder,
          stopWorkspaceService
        })
      }
    }
    refreshAppMenu()
    broadcastWorkspaceSelectorState()
  })
}
