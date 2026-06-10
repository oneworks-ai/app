import { getWorkspaceDescription, getWorkspaceDisplayName } from '../workspace-state.cjs'
import { WORKSPACE_SELECTOR_STATE_CHANNEL } from './constants'
import type { DesktopRuntimeState, WindowRecord, WorkspaceSelectorProject, WorkspaceSelectorState } from './types'

interface WorkspaceSelectorStateControllerInput {
  getWindowRecords: () => WindowRecord[]
  isWindowRecordUsable: (windowRecord: WindowRecord) => boolean
  runtimeState: DesktopRuntimeState
}

export const createWorkspaceSelectorStateController = ({
  getWindowRecords,
  isWindowRecordUsable,
  runtimeState
}: WorkspaceSelectorStateControllerInput) => {
  const listRunningWorkspaceServices = ({ currentWorkspaceFolder }: { currentWorkspaceFolder?: string } = {}) => (
    Array.from(runtimeState.services.values())
      .sort((left, right) => {
        if (left.workspaceFolder === currentWorkspaceFolder) return -1
        if (right.workspaceFolder === currentWorkspaceFolder) return 1
        return left.displayName.localeCompare(right.displayName)
      })
      .map<WorkspaceSelectorProject>((service) => {
        const isCurrent = service.workspaceFolder === currentWorkspaceFolder
        const sourceUrl = isCurrent
          ? getWindowRecords().find(windowRecord =>
            windowRecord.kind === 'launcher' &&
            windowRecord.workspaceFolder === currentWorkspaceFolder
          )?.launcherSourceUrl
          : undefined
        return {
          description: service.description,
          isCurrent,
          name: service.displayName,
          ...(sourceUrl == null ? {} : { sourceUrl }),
          status: service.status,
          workspaceFolder: service.workspaceFolder
        }
      })
  )

  const listRecentWorkspaceEntries = ({ currentWorkspaceFolder }: { currentWorkspaceFolder?: string } = {}) => {
    const runningWorkspaceFolders = new Set(Array.from(runtimeState.services.keys()))
    return runtimeState.desktopState.recentWorkspaces
      .filter(workspaceFolder => workspaceFolder !== currentWorkspaceFolder)
      .filter(workspaceFolder => !runningWorkspaceFolders.has(workspaceFolder))
      .map<WorkspaceSelectorProject>(workspaceFolder => ({
        description: getWorkspaceDescription(workspaceFolder),
        name: getWorkspaceDisplayName(workspaceFolder),
        workspaceFolder
      }))
  }

  const buildWorkspaceSelectorState = (windowRecord?: WindowRecord): WorkspaceSelectorState => ({
    recentProjects: listRecentWorkspaceEntries({
      currentWorkspaceFolder: windowRecord?.workspaceFolder
    }),
    runningProjects: listRunningWorkspaceServices({
      currentWorkspaceFolder: windowRecord?.workspaceFolder
    })
  })

  const broadcastWorkspaceSelectorState = () => {
    for (const windowRecord of getWindowRecords()) {
      if (
        (windowRecord.kind !== 'selector' && windowRecord.kind !== 'launcher') ||
        !isWindowRecordUsable(windowRecord)
      ) {
        continue
      }
      windowRecord.window.webContents.send(
        WORKSPACE_SELECTOR_STATE_CHANNEL,
        buildWorkspaceSelectorState(windowRecord)
      )
    }
  }

  return {
    broadcastWorkspaceSelectorState,
    buildWorkspaceSelectorState,
    listRecentWorkspaceEntries,
    listRunningWorkspaceServices
  }
}
