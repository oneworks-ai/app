import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'
import { resolveProjectPrimaryWorkspaceFolder } from '@oneworks/utils/project-cache-path'
import { migrateProjectHomeSegment } from '@oneworks/utils/project-home-migration'

export interface RuntimeRootDiscoveryOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  homeDir?: string
}

const exists = async (path: string) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const PROJECT_LAUNCH_CWD_ENV = '__ONEWORKS_PROJECT_LAUNCH_CWD__'
const PROJECT_WORKSPACE_FOLDER_ENV = '__ONEWORKS_PROJECT_WORKSPACE_FOLDER__'
const PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD_ENV = '__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__'
const PROJECT_PRIMARY_WORKSPACE_FOLDER_ENV = '__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__'
const PROJECT_OO_BASE_DIR_ENV = '__ONEWORKS_PROJECT_BASE_DIR__'
const PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV = '__ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__'
const PROJECT_ONEWORKS_HOME_PROJECT_DIR_ENV = '__ONEWORKS_PROJECT_HOME_PROJECT_DIR__'

const normalizeDirPath = (value: string | null | undefined) => {
  const trimmed = value?.trim()
  if (trimmed == null || trimmed === '') return undefined
  return trimmed.replace(/[\\/]+$/, '')
}

const hasProjectOoBaseDirEnv = (env: NodeJS.ProcessEnv) => normalizeDirPath(env[PROJECT_OO_BASE_DIR_ENV]) != null

const hasProjectWorkspaceEnv = (env: NodeJS.ProcessEnv) =>
  normalizeDirPath(env[PROJECT_WORKSPACE_FOLDER_ENV]) != null ||
  normalizeDirPath(env[PROJECT_LAUNCH_CWD_ENV]) != null

const isPathInside = (parentPath: string, targetPath: string) => {
  const relativePath = relative(resolve(parentPath), resolve(targetPath))
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  )
}

const createWorkspaceRuntimeEnv = (cwd: string, env: NodeJS.ProcessEnv) => {
  const normalizedWorkspaceFolder = resolve(cwd)
  const inheritedWorkspaceFolder = env[PROJECT_WORKSPACE_FOLDER_ENV]?.trim()
  const inheritedWorkspaceMatches = inheritedWorkspaceFolder != null &&
    inheritedWorkspaceFolder !== '' &&
    resolve(inheritedWorkspaceFolder) === normalizedWorkspaceFolder
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

  const aiBaseDirSourceCwd = runtimeEnv[PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV]?.trim()
  if (
    aiBaseDirSourceCwd == null ||
    aiBaseDirSourceCwd === '' ||
    !isPathInside(normalizedWorkspaceFolder, resolve(aiBaseDirSourceCwd))
  ) {
    runtimeEnv[PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV] = normalizedWorkspaceFolder
  }

  return runtimeEnv
}

const resolveRuntimeEnv = (env: NodeJS.ProcessEnv, homeDir?: string) => (
  homeDir == null || env.HOME != null || env.__ONEWORKS_PROJECT_REAL_HOME__ != null
    ? env
    : { ...env, HOME: homeDir }
)

const resolveProjectOoRuntimeRoot = (cwd: string, env: NodeJS.ProcessEnv, homeDir?: string) => {
  const resolvedEnv = resolveRuntimeEnv(env, homeDir)
  return resolveProjectHomePath(cwd, resolvedEnv, 'runtime')
}

const migrateProjectRuntimeRoot = async (cwd: string, env: NodeJS.ProcessEnv, homeDir?: string) => {
  const resolvedEnv = resolveRuntimeEnv(env, homeDir)
  await migrateProjectHomeSegment(cwd, resolvedEnv, 'runtime').catch(() => undefined)
  return resolveProjectOoRuntimeRoot(cwd, resolvedEnv)
}

export const findProjectRuntimeRoot = async (
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  homeDir?: string
) => {
  let current = resolve(cwd)

  while (true) {
    const hasAiDir = await exists(join(current, '.oo'))
    const hasPackageJson = await exists(join(current, 'package.json'))
    if (hasAiDir || hasPackageJson || await exists(join(current, '.oneworks'))) {
      return await migrateProjectRuntimeRoot(current, env, homeDir)
    }

    const parent = dirname(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }
}

export const getUserRuntimeRoot = (homeDir = homedir()) => {
  return join(homeDir, '.oneworks', 'runtime')
}

export const resolveRuntimeRoot = async (options: RuntimeRootDiscoveryOptions = {}) => {
  const baseEnv = options.env ?? process.env
  const hasProjectEnv = hasProjectOoBaseDirEnv(baseEnv) || hasProjectWorkspaceEnv(baseEnv)
  const env = hasProjectEnv && options.cwd != null
    ? createWorkspaceRuntimeEnv(options.cwd, baseEnv)
    : baseEnv
  if (hasProjectOoBaseDirEnv(env) || hasProjectWorkspaceEnv(env)) {
    return await migrateProjectRuntimeRoot(options.cwd ?? process.cwd(), env, options.homeDir)
  }

  const projectRoot = await findProjectRuntimeRoot(options.cwd, env, options.homeDir)
  return projectRoot ?? getUserRuntimeRoot(options.homeDir)
}

export const getSessionStorePath = (root: string, sessionId: string) => {
  return join(root, 'sessions', sessionId)
}

export const getSessionLocksPath = (sessionPath: string) => {
  return join(sessionPath, 'locks')
}
