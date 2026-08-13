import { resolveProjectWorkspaceFolder } from '../workspace-state.cjs'
import type { LaunchRequest, WorkspaceService } from './types'
import type { WindowManager } from './window-manager'

export const normalizeWorkspaceLaunchRequest = (launchRequest: LaunchRequest): LaunchRequest => {
  const workspaceFolder = resolveProjectWorkspaceFolder(launchRequest.workspaceFolder)
  return {
    ...(launchRequest.launcherRoutePath == null ? {} : { launcherRoutePath: launchRequest.launcherRoutePath }),
    ...(launchRequest.standaloneRoutePath == null ? {} : { standaloneRoutePath: launchRequest.standaloneRoutePath }),
    ...(launchRequest.routePath == null ? {} : { routePath: launchRequest.routePath }),
    ...(workspaceFolder == null ? {} : { workspaceFolder })
  }
}

export const openWorkspaceLaunchRequest = async (
  launchRequest: LaunchRequest,
  windowManager: Pick<
    WindowManager,
    | 'createLauncherWindow'
    | 'openLauncherRouteWindow'
    | 'openStandaloneTabWindow'
    | 'openWorkspaceRouteWindow'
    | 'openWorkspaceWindow'
  >,
  prepared = false
) => {
  const normalizedLaunchRequest = prepared ? launchRequest : normalizeWorkspaceLaunchRequest(launchRequest)
  if (normalizedLaunchRequest.standaloneRoutePath != null) {
    await windowManager.openStandaloneTabWindow(normalizedLaunchRequest.standaloneRoutePath)
    return
  }
  if (normalizedLaunchRequest.launcherRoutePath != null) {
    await windowManager.openLauncherRouteWindow(normalizedLaunchRequest.launcherRoutePath)
    return
  }
  if (normalizedLaunchRequest.workspaceFolder != null && normalizedLaunchRequest.routePath != null) {
    await windowManager.openWorkspaceRouteWindow(
      normalizedLaunchRequest.workspaceFolder,
      normalizedLaunchRequest.routePath
    )
    return
  }
  if (normalizedLaunchRequest.workspaceFolder != null) {
    await windowManager.openWorkspaceWindow(normalizedLaunchRequest.workspaceFolder)
    return
  }
  await windowManager.createLauncherWindow()
}

export const stopWorkspaceRuntimeFolder = async ({
  forgetWorkspaceFolder,
  input,
  rememberWorkspaceFolder,
  services,
  stopWorkspaceService,
  workspaceFolder
}: {
  forgetWorkspaceFolder: (workspaceFolder: string) => void
  input?: { forget?: boolean }
  rememberWorkspaceFolder: (workspaceFolder: string) => void
  services: Map<string, WorkspaceService>
  stopWorkspaceService: (service: WorkspaceService) => Promise<void>
  workspaceFolder: string
}) => {
  const normalizedWorkspaceFolder = workspaceFolder.trim() === ''
    ? ''
    : resolveProjectWorkspaceFolder(workspaceFolder) ?? workspaceFolder
  const service = services.get(normalizedWorkspaceFolder)
  const stopped = service != null
  if (service != null) {
    await stopWorkspaceService(service)
  }

  const removed = input?.forget === true
  if (removed) {
    forgetWorkspaceFolder(normalizedWorkspaceFolder)
  } else if (stopped) {
    rememberWorkspaceFolder(normalizedWorkspaceFolder)
  }

  return {
    ok: true,
    removed,
    stopped,
    workspaceFolder: normalizedWorkspaceFolder
  }
}
