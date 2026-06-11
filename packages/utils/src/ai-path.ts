import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import process from 'node:process'

export const PROJECT_LAUNCH_CWD_ENV = '__ONEWORKS_PROJECT_LAUNCH_CWD__'
export const PROJECT_WORKSPACE_FOLDER_ENV = '__ONEWORKS_PROJECT_WORKSPACE_FOLDER__'
export const PROJECT_CONFIG_DIR_ENV = '__ONEWORKS_PROJECT_CONFIG_DIR__'
export const PROJECT_OO_BASE_DIR_ENV = '__ONEWORKS_PROJECT_BASE_DIR__'
export const PROJECT_ONEWORKS_HOME_PROJECTS_DIR_ENV = '__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__'
export const PROJECT_ONEWORKS_HOME_PROJECT_DIR_ENV = '__ONEWORKS_PROJECT_HOME_PROJECT_DIR__'
export const PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD_ENV = '__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__'
export const PROJECT_CONFIG_DIR_RESOLVE_CWD_ENV = '__ONEWORKS_PROJECT_CONFIG_DIR_RESOLVE_CWD__'
export const PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV = '__ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__'
export const DEFAULT_PROJECT_OO_BASE_DIR = '.oo'
export const DEFAULT_PROJECT_ONEWORKS_HOME_PROJECTS_DIR = '.oneworks/projects'
export const DEFAULT_GLOBAL_ONEWORKS_DIR = '.oneworks'
export const DEFAULT_GLOBAL_OO_CONFIG_FILE = '.oo.config.json'
export const DEFAULT_GLOBAL_ONEWORKS_ASSETS_DIR = 'global'
export const PROJECT_OO_ENTITIES_DIR_ENV = '__ONEWORKS_PROJECT_ENTITIES_DIR__'
export const DEFAULT_PROJECT_OO_ENTITIES_DIR = 'entities'
export const PROJECT_PRIMARY_WORKSPACE_FOLDER_ENV = '__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__'

const PROJECT_HOME_OO_SEGMENTS = new Set(['logs', 'caches', '.mock', '.local', 'runtime'])

const normalizeDirPath = (value: string | null | undefined) => {
  const trimmed = value?.trim()
  if (trimmed == null || trimmed === '') return undefined
  return trimmed.replace(/[\\/]+$/, '')
}

const resolvePathFromBase = (
  baseDir: string,
  value: string | null | undefined
) => {
  const normalizedValue = normalizeDirPath(value)
  if (normalizedValue == null) {
    return undefined
  }

  if (isAbsolute(normalizedValue)) {
    return resolve(normalizedValue)
  }

  return resolve(baseDir, normalizedValue)
}

const toPathSegments = (value: string) => value.split(/[\\/]+/).filter(Boolean)

const normalizeProjectHomeWorkspaceFolder = (workspaceFolder: string) => {
  const resolvedWorkspaceFolder = resolve(workspaceFolder)
  try {
    return realpathSync.native(resolvedWorkspaceFolder)
  } catch {
    return resolvedWorkspaceFolder
  }
}

const toProjectHomeKey = (workspaceFolder: string) => {
  const normalizedWorkspaceFolder = normalizeProjectHomeWorkspaceFolder(workspaceFolder)
  const normalizedName = basename(normalizedWorkspaceFolder)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const stableHash = createHash('sha1').update(normalizedWorkspaceFolder).digest('hex').slice(0, 10)
  return normalizedName === '' ? stableHash : `${normalizedName}-${stableHash}`
}

const normalizePathForInsideCheck = (targetPath: string): string => {
  const resolvedPath = resolve(targetPath)
  try {
    return realpathSync.native(resolvedPath)
  } catch {
    const parentPath = dirname(resolvedPath)
    if (parentPath === resolvedPath) return resolvedPath
    return resolve(normalizePathForInsideCheck(parentPath), basename(resolvedPath))
  }
}

const isPathInside = (parentPath: string, targetPath: string) => {
  const relativePath = relative(
    normalizePathForInsideCheck(parentPath),
    normalizePathForInsideCheck(targetPath)
  )
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  )
}

const isGitInternalPath = (targetPath: string) => targetPath.split(/[\\/]+/).includes('.git')

export const resolveProjectLaunchCwd = (
  cwd: string,
  env: Record<string, string | null | undefined> = process.env
) => (
  resolvePathFromBase(resolve(cwd), env[PROJECT_LAUNCH_CWD_ENV]) ?? resolve(cwd)
)

const resolvePathSourceCwd = (
  cwd: string,
  env: Record<string, string | null | undefined>,
  sourceEnvName: string
) => resolvePathFromBase(cwd, env[sourceEnvName])

const resolvePathFromLaunchCwd = (
  cwd: string,
  value: string | null | undefined,
  env: Record<string, string | null | undefined> = process.env,
  sourceEnvName?: string
) => {
  const baseDir = sourceEnvName == null
    ? resolveProjectLaunchCwd(cwd, env)
    : resolvePathSourceCwd(cwd, env, sourceEnvName) ?? resolveProjectLaunchCwd(cwd, env)

  return resolvePathFromBase(baseDir, value)
}

export const resolveProjectWorkspaceFolder = (
  cwd: string,
  env: Record<string, string | null | undefined> = process.env
) => (
  resolvePathFromLaunchCwd(cwd, env[PROJECT_WORKSPACE_FOLDER_ENV], env, PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD_ENV) ??
    resolve(cwd)
)

export const resolvePrimaryWorkspaceFolder = (
  cwd: string,
  env: Record<string, string | null | undefined> = process.env
) => {
  const normalizedWorkspaceFolder = resolveProjectWorkspaceFolder(cwd, env)
  const explicitPrimaryWorkspaceFolder = env[PROJECT_PRIMARY_WORKSPACE_FOLDER_ENV]?.trim()
  if (explicitPrimaryWorkspaceFolder != null && explicitPrimaryWorkspaceFolder !== '') {
    const resolvedPrimaryWorkspaceFolder = resolvePathFromBase(
      resolveProjectLaunchCwd(cwd, env),
      explicitPrimaryWorkspaceFolder
    )
    if (resolvedPrimaryWorkspaceFolder == null) {
      return undefined
    }
    return resolvedPrimaryWorkspaceFolder === normalizedWorkspaceFolder
      ? undefined
      : resolvedPrimaryWorkspaceFolder
  }

  try {
    const result = spawnSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: normalizedWorkspaceFolder,
      encoding: 'utf8'
    })
    if (result.status !== 0) {
      return undefined
    }

    const gitCommonDir = result.stdout?.trim()
    if (gitCommonDir == null || gitCommonDir === '') {
      return undefined
    }

    const primaryWorkspaceFolder = resolve(normalizedWorkspaceFolder, gitCommonDir, '..')
    if (isGitInternalPath(primaryWorkspaceFolder)) {
      return undefined
    }

    return primaryWorkspaceFolder === normalizedWorkspaceFolder
      ? undefined
      : primaryWorkspaceFolder
  } catch {
    return undefined
  }
}

export const resolveProjectConfigDir = (
  cwd: string,
  env: Record<string, string | null | undefined> = process.env
) => resolvePathFromLaunchCwd(cwd, env[PROJECT_CONFIG_DIR_ENV], env, PROJECT_CONFIG_DIR_RESOLVE_CWD_ENV)

export const resolveProjectOoBaseDirName = (
  env: Record<string, string | null | undefined> = process.env
) => (
  normalizeDirPath(env[PROJECT_OO_BASE_DIR_ENV]) ?? DEFAULT_PROJECT_OO_BASE_DIR
)

export const resolveProjectOoEntitiesDirName = (
  env: Record<string, string | null | undefined> = process.env
) => (
  normalizeDirPath(env[PROJECT_OO_ENTITIES_DIR_ENV]) ?? DEFAULT_PROJECT_OO_ENTITIES_DIR
)

export const resolveProjectOoBaseDir = (
  cwd: string,
  env: Record<string, string | null | undefined> = process.env
) => {
  const baseDir = resolveProjectOoBaseDirName(env)
  if (isAbsolute(baseDir)) {
    return resolve(baseDir)
  }

  if (normalizeDirPath(env[PROJECT_OO_BASE_DIR_ENV]) != null) {
    return resolve(
      resolvePathSourceCwd(cwd, env, PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV) ?? resolveProjectLaunchCwd(cwd, env),
      baseDir
    )
  }

  return resolve(resolveProjectWorkspaceFolder(cwd, env), baseDir)
}

export const resolveProjectRealHome = (
  env: Record<string, string | null | undefined> = process.env
) => {
  const configuredHome = normalizeDirPath(env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    normalizeDirPath(env.HOME) ??
    normalizeDirPath(env.USERPROFILE) ??
    homedir()

  return resolve(configuredHome)
}

export const resolveGlobalOneWorksDir = (
  env: Record<string, string | null | undefined> = process.env
) => resolve(resolveProjectRealHome(env), DEFAULT_GLOBAL_ONEWORKS_DIR)

export const resolveGlobalOneWorksPath = (
  env: Record<string, string | null | undefined> = process.env,
  ...segments: string[]
) => resolve(resolveGlobalOneWorksDir(env), ...segments)

export const resolveGlobalOoConfigPath = (
  env: Record<string, string | null | undefined> = process.env
) => resolveGlobalOneWorksPath(env, DEFAULT_GLOBAL_OO_CONFIG_FILE)

export const resolveGlobalOneWorksAssetsPath = (
  env: Record<string, string | null | undefined> = process.env,
  ...segments: string[]
) => resolveGlobalOneWorksPath(env, DEFAULT_GLOBAL_ONEWORKS_ASSETS_DIR, ...segments)

export const resolveProjectHomeProjectsDir = (
  env: Record<string, string | null | undefined> = process.env
) => {
  const configuredProjectsDir = normalizeDirPath(env[PROJECT_ONEWORKS_HOME_PROJECTS_DIR_ENV]) ??
    DEFAULT_PROJECT_ONEWORKS_HOME_PROJECTS_DIR

  return isAbsolute(configuredProjectsDir)
    ? resolve(configuredProjectsDir)
    : resolve(resolveProjectRealHome(env), configuredProjectsDir)
}

export const resolveProjectHomeDir = (
  cwd: string,
  env: Record<string, string | null | undefined> = process.env
) => {
  const explicitProjectDir = normalizeDirPath(env[PROJECT_ONEWORKS_HOME_PROJECT_DIR_ENV])
  if (explicitProjectDir != null) {
    return isAbsolute(explicitProjectDir)
      ? resolve(explicitProjectDir)
      : resolve(resolveProjectHomeProjectsDir(env), explicitProjectDir)
  }

  const workspaceFolder = resolvePrimaryWorkspaceFolder(cwd, env) ?? resolveProjectWorkspaceFolder(cwd, env)
  return resolve(resolveProjectHomeProjectsDir(env), toProjectHomeKey(workspaceFolder))
}

export const resolveProjectHomePath = (
  cwd: string,
  env: Record<string, string | null | undefined> = process.env,
  ...segments: string[]
) => resolve(resolveProjectHomeDir(cwd, env), ...segments)

export const resolveProjectOoPath = (
  cwd: string,
  env: Record<string, string | null | undefined> = process.env,
  ...segments: string[]
) => (
  segments[0] != null && PROJECT_HOME_OO_SEGMENTS.has(segments[0])
    ? resolveProjectHomePath(cwd, env, ...segments)
    : resolve(resolveProjectOoBaseDir(cwd, env), ...segments)
)

export const resolveProjectMockHome = (
  cwd: string,
  env: Record<string, string | null | undefined> = process.env
) => {
  const fallbackMockHome = resolveProjectHomePath(cwd, env, '.mock')
  const explicitHome = normalizeDirPath(env.HOME ?? process.env.HOME)
  const realHome = normalizeDirPath(env.__ONEWORKS_PROJECT_REAL_HOME__ ?? process.env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    resolveProjectRealHome(env)
  const resolvedExplicitHome = explicitHome == null ? undefined : resolve(explicitHome)
  const resolvedRealHome = resolve(realHome)
  const workspaceFolder = resolveProjectWorkspaceFolder(cwd, env)

  if (resolvedExplicitHome == null) return fallbackMockHome
  if (resolvedExplicitHome === resolvedRealHome) {
    return fallbackMockHome
  }
  if (isPathInside(workspaceFolder, resolvedExplicitHome) && resolvedExplicitHome !== fallbackMockHome) {
    return fallbackMockHome
  }

  return resolvedExplicitHome
}

export const resolveProjectOoEntitiesDir = (
  cwd: string,
  env: Record<string, string | null | undefined> = process.env
) => resolveProjectOoPath(cwd, env, ...toPathSegments(resolveProjectOoEntitiesDirName(env)))
