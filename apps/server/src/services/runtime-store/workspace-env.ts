import path from 'node:path'
import { env as processEnv } from 'node:process'

import {
  PROJECT_LAUNCH_CWD_ENV,
  PROJECT_ONEWORKS_HOME_PROJECT_DIR_ENV,
  PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV,
  PROJECT_PRIMARY_WORKSPACE_FOLDER_ENV,
  PROJECT_WORKSPACE_FOLDER_ENV,
  PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD_ENV,
  resolveProjectHomePath,
  resolveProjectMockHome
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

const readFilesystemEnvValue = (value: string | undefined) => (
  value != null && value.trim() !== '' ? value : undefined
)

export const createWorkspaceRuntimeEnv = (
  workspaceFolder: string,
  env: NodeJS.ProcessEnv = processEnv
): NodeJS.ProcessEnv => {
  const normalizedWorkspaceFolder = path.resolve(workspaceFolder)
  const inheritedWorkspaceFolder = readFilesystemEnvValue(env[PROJECT_WORKSPACE_FOLDER_ENV])
  const inheritedWorkspaceMatches = inheritedWorkspaceFolder != null &&
    path.resolve(inheritedWorkspaceFolder) === normalizedWorkspaceFolder
  const preserveInheritedPrimaryWorkspace = inheritedWorkspaceFolder != null &&
    inheritedWorkspaceMatches &&
    readFilesystemEnvValue(env[PROJECT_PRIMARY_WORKSPACE_FOLDER_ENV]) != null
  const inheritedHomeProjectDir = readFilesystemEnvValue(env[PROJECT_ONEWORKS_HOME_PROJECT_DIR_ENV])
  const shouldResetInheritedProjectHome = inheritedWorkspaceFolder == null
    ? inheritedHomeProjectDir != null
    : !inheritedWorkspaceMatches
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
  if (shouldResetInheritedProjectHome) {
    delete runtimeEnv[PROJECT_ONEWORKS_HOME_PROJECT_DIR_ENV]
    delete runtimeEnv.DB_PATH
    delete runtimeEnv.__ONEWORKS_PROJECT_SERVER_DATA_DIR__
    delete runtimeEnv.__ONEWORKS_PROJECT_SERVER_LOG_DIR__

    const realHome = readFilesystemEnvValue(runtimeEnv.__ONEWORKS_PROJECT_REAL_HOME__)
    if (realHome == null) {
      delete runtimeEnv.HOME
    } else {
      runtimeEnv.HOME = realHome
    }
  }

  const ooBaseDirSourceCwd = readFilesystemEnvValue(runtimeEnv[PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV])
  if (
    ooBaseDirSourceCwd == null ||
    !isPathInside(normalizedWorkspaceFolder, path.resolve(ooBaseDirSourceCwd))
  ) {
    runtimeEnv[PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV] = normalizedWorkspaceFolder
  }
  runtimeEnv.HOME = resolveProjectMockHome(normalizedWorkspaceFolder, runtimeEnv)

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
