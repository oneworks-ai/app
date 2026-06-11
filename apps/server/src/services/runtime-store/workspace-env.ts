import path from 'node:path'
import { env as processEnv } from 'node:process'

import {
  PROJECT_LAUNCH_CWD_ENV,
  PROJECT_ONEWORKS_HOME_PROJECT_DIR_ENV,
  PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV,
  PROJECT_PRIMARY_WORKSPACE_FOLDER_ENV,
  PROJECT_WORKSPACE_FOLDER_ENV,
  PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD_ENV,
  resolveProjectHomePath
} from '@oneworks/utils'
import { resolveProjectPrimaryWorkspaceFolder } from '@oneworks/utils/project-cache-path'

const isPathInside = (parentPath: string, targetPath: string) => {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(targetPath))
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  )
}

export const createWorkspaceRuntimeEnv = (
  workspaceFolder: string,
  env: NodeJS.ProcessEnv = processEnv
): NodeJS.ProcessEnv => {
  const normalizedWorkspaceFolder = path.resolve(workspaceFolder)
  const inheritedWorkspaceFolder = env[PROJECT_WORKSPACE_FOLDER_ENV]?.trim()
  const inheritedWorkspaceMatches = inheritedWorkspaceFolder != null &&
    inheritedWorkspaceFolder !== '' &&
    path.resolve(inheritedWorkspaceFolder) === normalizedWorkspaceFolder
  const preserveInheritedPrimaryWorkspace = inheritedWorkspaceFolder != null &&
    inheritedWorkspaceFolder !== '' &&
    inheritedWorkspaceMatches &&
    env[PROJECT_PRIMARY_WORKSPACE_FOLDER_ENV]?.trim() != null &&
    env[PROJECT_PRIMARY_WORKSPACE_FOLDER_ENV]?.trim() !== ''
  const runtimeEnv: NodeJS.ProcessEnv = {
    ...env,
    [PROJECT_LAUNCH_CWD_ENV]: normalizedWorkspaceFolder,
    [PROJECT_WORKSPACE_FOLDER_ENV]: normalizedWorkspaceFolder,
    [PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD_ENV]: normalizedWorkspaceFolder
  }

  if (!preserveInheritedPrimaryWorkspace) {
    delete runtimeEnv[PROJECT_PRIMARY_WORKSPACE_FOLDER_ENV]
    const primaryWorkspaceFolder = resolveProjectPrimaryWorkspaceFolder(normalizedWorkspaceFolder, runtimeEnv)
    if (primaryWorkspaceFolder != null) {
      runtimeEnv[PROJECT_PRIMARY_WORKSPACE_FOLDER_ENV] = primaryWorkspaceFolder
    }
  }
  if (inheritedWorkspaceFolder != null && inheritedWorkspaceFolder !== '' && !inheritedWorkspaceMatches) {
    delete runtimeEnv[PROJECT_ONEWORKS_HOME_PROJECT_DIR_ENV]
  }

  const ooBaseDirSourceCwd = runtimeEnv[PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV]?.trim()
  if (
    ooBaseDirSourceCwd == null ||
    ooBaseDirSourceCwd === '' ||
    !isPathInside(normalizedWorkspaceFolder, path.resolve(ooBaseDirSourceCwd))
  ) {
    runtimeEnv[PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV] = normalizedWorkspaceFolder
  }

  return runtimeEnv
}

export const resolveWorkspaceRuntimeStoreRoot = (
  workspaceFolder: string,
  env: NodeJS.ProcessEnv = processEnv
) => {
  const normalizedWorkspaceFolder = path.resolve(workspaceFolder)
  return resolveProjectHomePath(
    normalizedWorkspaceFolder,
    createWorkspaceRuntimeEnv(normalizedWorkspaceFolder, env),
    'runtime'
  )
}
