import type { LauncherWorkspaceSelectorProject } from '@oneworks/types'

import { getFilesystemPathDisplayName, readNonBlankFilesystemPath } from '#~/utils/filesystem-path-identity'

export const resolveChatWorkspaceRootPath = (
  sessionWorkspaceRootPath: string | undefined,
  projectWorkspaceFolder: string | undefined
) => readNonBlankFilesystemPath(sessionWorkspaceRootPath) ?? projectWorkspaceFolder

export const buildChatLauncherWorkspaceContext = (
  workspaceRootPath: string | null | undefined,
  displayTitle: string | undefined
): LauncherWorkspaceSelectorProject | undefined => {
  const rawWorkspaceRootPath = readNonBlankFilesystemPath(workspaceRootPath)
  if (rawWorkspaceRootPath == null) return undefined

  const workspaceName = getFilesystemPathDisplayName(rawWorkspaceRootPath) ?? rawWorkspaceRootPath
  return {
    description: rawWorkspaceRootPath,
    isCurrent: true,
    name: workspaceName.trim() === '' ? displayTitle?.trim() || rawWorkspaceRootPath : workspaceName,
    status: 'ready',
    workspaceFolder: rawWorkspaceRootPath
  }
}
