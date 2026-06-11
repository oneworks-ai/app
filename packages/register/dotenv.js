/* eslint-disable no-use-before-define -- bootstrap helpers mirror the TypeScript project-home migration helpers. */
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const {
  cpSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  statSync,
  symlinkSync,
  utimesSync
} = require('node:fs')
const { homedir } = require('node:os')
const { basename, dirname, isAbsolute, relative, resolve, sep } = require('node:path')
const process = require('node:process')

const dotenv = require('dotenv')
const { findWorkspaceRoot } = require('./workspace')

const PRIMARY_WORKSPACE_ENV = '__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__'
const PROJECT_LAUNCH_CWD_ENV = '__ONEWORKS_PROJECT_LAUNCH_CWD__'
const PROJECT_WORKSPACE_FOLDER_ENV = '__ONEWORKS_PROJECT_WORKSPACE_FOLDER__'
const PROJECT_CONFIG_DIR_ENV = '__ONEWORKS_PROJECT_CONFIG_DIR__'
const PROJECT_OO_BASE_DIR_ENV = '__ONEWORKS_PROJECT_BASE_DIR__'
const PROJECT_ONEWORKS_HOME_PROJECTS_DIR_ENV = '__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__'
const PROJECT_ONEWORKS_HOME_PROJECT_DIR_ENV = '__ONEWORKS_PROJECT_HOME_PROJECT_DIR__'
const PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD_ENV = '__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__'
const PROJECT_CONFIG_DIR_RESOLVE_CWD_ENV = '__ONEWORKS_PROJECT_CONFIG_DIR_RESOLVE_CWD__'
const PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV = '__ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__'
const DEFAULT_PROJECT_OO_BASE_DIR = '.oo'
const DEFAULT_PROJECT_ONEWORKS_HOME_PROJECTS_DIR = '.oneworks/projects'
const PROJECT_HOME_MIGRATED_SEGMENTS = ['logs', 'caches', '.mock', '.local', 'runtime']

const normalizeDirPath = (value) => {
  const trimmed = typeof value === 'string' ? value.trim() : undefined
  if (!trimmed) {
    return undefined
  }

  return trimmed.replace(/[\\/]+$/, '')
}

const resolvePathFromBase = (baseDir, value) => {
  const normalizedValue = normalizeDirPath(value)
  if (normalizedValue == null) {
    return undefined
  }

  return isAbsolute(normalizedValue)
    ? resolve(normalizedValue)
    : resolve(baseDir, normalizedValue)
}

const resolveProjectLaunchCwd = (cwd = process.cwd(), env = process.env) => (
  resolvePathFromBase(resolve(cwd), env[PROJECT_LAUNCH_CWD_ENV]) ?? resolve(cwd)
)

const resolvePathSourceCwd = (cwd, env, sourceEnvName) => (
  resolvePathFromBase(resolve(cwd), env[sourceEnvName])
)

const resolvePathFromLaunchCwd = (cwd, value, env = process.env, sourceEnvName) => (
  resolvePathFromBase(
    resolvePathSourceCwd(cwd, env, sourceEnvName) ?? resolveProjectLaunchCwd(cwd, env),
    value
  )
)

const resolveProjectWorkspaceFolder = (cwd = process.cwd(), env = process.env) => (
  resolvePathFromLaunchCwd(cwd, env[PROJECT_WORKSPACE_FOLDER_ENV], env, PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD_ENV) ??
    findWorkspaceRoot(resolveProjectLaunchCwd(cwd, env))
)

const resolveProjectConfigDir = (cwd = process.cwd(), env = process.env) => (
  resolvePathFromLaunchCwd(cwd, env[PROJECT_CONFIG_DIR_ENV], env, PROJECT_CONFIG_DIR_RESOLVE_CWD_ENV)
)

const resolveProjectOoBaseDir = (cwd = process.cwd(), env = process.env) => {
  const configuredBaseDir = normalizeDirPath(env[PROJECT_OO_BASE_DIR_ENV])
  if (configuredBaseDir == null) {
    return resolve(resolveProjectWorkspaceFolder(cwd, env), DEFAULT_PROJECT_OO_BASE_DIR)
  }

  const sourceCwd = resolvePathSourceCwd(cwd, env, PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV)
  return resolvePathFromBase(sourceCwd ?? resolveProjectLaunchCwd(cwd, env), configuredBaseDir)
}

const normalizeProjectHomeWorkspaceFolder = (workspaceFolder) => {
  const resolvedWorkspaceFolder = resolve(workspaceFolder)
  try {
    return realpathSync.native(resolvedWorkspaceFolder)
  } catch {
    return resolvedWorkspaceFolder
  }
}

const toProjectHomeKey = (workspaceFolder) => {
  const normalizedWorkspaceFolder = normalizeProjectHomeWorkspaceFolder(workspaceFolder)
  const normalizedName = basename(normalizedWorkspaceFolder)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const stableHash = createHash('sha1').update(normalizedWorkspaceFolder).digest('hex').slice(0, 10)
  return normalizedName === '' ? stableHash : `${normalizedName}-${stableHash}`
}

const normalizePathForInsideCheck = (targetPath) => {
  const resolvedPath = resolve(targetPath)
  try {
    return realpathSync.native(resolvedPath)
  } catch {
    const parentPath = dirname(resolvedPath)
    if (parentPath === resolvedPath) return resolvedPath
    return resolve(normalizePathForInsideCheck(parentPath), basename(resolvedPath))
  }
}

const resolveProjectRealHome = (env = process.env) => (
  resolve(
    normalizeDirPath(env.__ONEWORKS_PROJECT_REAL_HOME__) ??
      normalizeDirPath(env.HOME) ??
      homedir()
  )
)

const resolveProjectHomeProjectsDir = (env = process.env) => {
  const configuredProjectsDir = normalizeDirPath(env[PROJECT_ONEWORKS_HOME_PROJECTS_DIR_ENV]) ??
    DEFAULT_PROJECT_ONEWORKS_HOME_PROJECTS_DIR

  return isAbsolute(configuredProjectsDir)
    ? resolve(configuredProjectsDir)
    : resolve(resolveProjectRealHome(env), configuredProjectsDir)
}

const resolveProjectHomeDir = (cwd = process.cwd(), env = process.env) => {
  const explicitProjectDir = normalizeDirPath(env[PROJECT_ONEWORKS_HOME_PROJECT_DIR_ENV])
  if (explicitProjectDir != null) {
    return isAbsolute(explicitProjectDir)
      ? resolve(explicitProjectDir)
      : resolve(resolveProjectHomeProjectsDir(env), explicitProjectDir)
  }

  const workspaceFolder = resolvePrimaryWorkspaceFolder(resolveProjectWorkspaceFolder(cwd, env), env) ??
    resolveProjectWorkspaceFolder(cwd, env)
  return resolve(resolveProjectHomeProjectsDir(env), toProjectHomeKey(workspaceFolder))
}

const resolveProjectHomePath = (cwd = process.cwd(), env = process.env, ...segments) => (
  resolve(resolveProjectHomeDir(cwd, env), ...segments)
)

const isPathInside = (parentPath, targetPath) => {
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

const isGitInternalPath = (targetPath) => targetPath.split(/[\\/]+/).includes('.git')

const resolveLegacyProjectHomeSegmentPaths = (cwd = process.cwd(), env = process.env, segment) => {
  return {
    targetDir: resolveProjectHomePath(cwd, env, segment),
    sourceDirs: []
  }
}

const lstatIfPresentSync = (targetPath) => {
  try {
    return lstatSync(targetPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

const preservePathTimesSync = (sourceStats, targetPath) => {
  try {
    utimesSync(targetPath, sourceStats.atime, sourceStats.mtime)
  } catch {}
}

const resolveSourceSymlinkTarget = (sourcePath, linkTarget) => (
  isAbsolute(linkTarget)
    ? resolve(linkTarget)
    : resolve(dirname(sourcePath), linkTarget)
)

const resolveMigratedSymlinkTarget = (params) => (
  isPathInside(params.context.sourceRoot, params.sourceTargetPath)
    ? resolve(params.context.targetRoot, relative(params.context.sourceRoot, params.sourceTargetPath))
    : params.sourceTargetPath
)

const resolveSymlinkTypeSync = (sourceTargetPath) => {
  try {
    return statSync(sourceTargetPath).isDirectory()
      ? process.platform === 'win32'
        ? 'junction'
        : 'dir'
      : 'file'
  } catch {
    return undefined
  }
}

const symlinkWithoutOverwriteSync = (target, path, type) => {
  try {
    symlinkSync(target, path, type)
  } catch (error) {
    if (error?.code === 'EEXIST') return
    throw error
  }
}

const copyEntryWithoutOverwriteSync = (sourcePath, targetPath, context) => {
  const sourceStats = lstatIfPresentSync(sourcePath)
  if (sourceStats == null) return

  const targetStats = lstatIfPresentSync(targetPath)
  if (targetStats != null) {
    if (
      sourceStats.isDirectory() &&
      !sourceStats.isSymbolicLink() &&
      targetStats.isDirectory() &&
      !targetStats.isSymbolicLink()
    ) {
      copyDirectoryContentsWithoutOverwriteSync(sourcePath, targetPath, context)
    }
    return
  }

  if (sourceStats.isSymbolicLink()) {
    const linkTarget = readlinkSync(sourcePath)
    const sourceTargetPath = resolveSourceSymlinkTarget(sourcePath, linkTarget)
    const nextLinkTarget = resolveMigratedSymlinkTarget({
      context,
      sourceTargetPath
    })
    mkdirSync(dirname(targetPath), { recursive: true })
    symlinkWithoutOverwriteSync(nextLinkTarget, targetPath, resolveSymlinkTypeSync(sourceTargetPath))
    return
  }

  if (sourceStats.isDirectory() && !sourceStats.isSymbolicLink()) {
    mkdirSync(targetPath, { recursive: true })
    copyDirectoryContentsWithoutOverwriteSync(sourcePath, targetPath, context)
    preservePathTimesSync(sourceStats, targetPath)
    return
  }

  cpSync(sourcePath, targetPath, {
    dereference: false,
    errorOnExist: false,
    force: false,
    preserveTimestamps: true,
    recursive: true,
    verbatimSymlinks: true
  })
  if (!sourceStats.isSymbolicLink()) {
    preservePathTimesSync(sourceStats, targetPath)
  }
}

const copyDirectoryContentsWithoutOverwriteSync = (sourceDir, targetDir, context) => {
  const stats = lstatIfPresentSync(sourceDir)
  if (stats == null || !stats.isDirectory() || stats.isSymbolicLink()) return false

  mkdirSync(targetDir, { recursive: true })
  const entries = readdirSync(sourceDir, { withFileTypes: true })
  const migrationContext = context ?? {
    sourceRoot: sourceDir,
    targetRoot: targetDir
  }
  for (const entry of entries) {
    copyEntryWithoutOverwriteSync(resolve(sourceDir, entry.name), resolve(targetDir, entry.name), migrationContext)
  }
  return entries.length > 0
}

const migrateProjectHomeSegmentSync = (cwd = process.cwd(), env = process.env, segment) => {
  return {
    migratedSources: [],
    targetDir: resolveProjectHomePath(cwd, env, segment)
  }
}

const migrateProjectHomeSegmentsSync = (
  cwd = process.cwd(),
  env = process.env,
  segments = PROJECT_HOME_MIGRATED_SEGMENTS
) => segments.map(segment => migrateProjectHomeSegmentSync(cwd, env, segment))

const resolveProjectMockHome = (cwd = process.cwd(), env = process.env) => {
  const fallbackMockHome = resolveProjectHomePath(cwd, env, '.mock')
  const explicitHome = normalizeDirPath(env.HOME ?? process.env.HOME)
  const realHome = normalizeDirPath(env.__ONEWORKS_PROJECT_REAL_HOME__ ?? process.env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    resolveProjectRealHome(env)
  const resolvedExplicitHome = explicitHome == null ? undefined : resolve(explicitHome)
  const resolvedRealHome = resolve(realHome)
  const workspaceFolder = resolveProjectWorkspaceFolder(cwd, env)

  if (resolvedExplicitHome == null) return fallbackMockHome
  if (resolvedExplicitHome === resolvedRealHome) return fallbackMockHome
  if (isPathInside(workspaceFolder, resolvedExplicitHome) && resolvedExplicitHome !== fallbackMockHome) {
    return fallbackMockHome
  }

  return resolvedExplicitHome
}

const PROJECT_PATH_SOURCE_CWD_ENV_BY_KEY = {
  [PROJECT_WORKSPACE_FOLDER_ENV]: PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD_ENV,
  [PROJECT_CONFIG_DIR_ENV]: PROJECT_CONFIG_DIR_RESOLVE_CWD_ENV,
  [PROJECT_OO_BASE_DIR_ENV]: PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV
}

const rememberProjectPathSources = (filePath, parsed) => {
  if (parsed == null) {
    return
  }

  for (const [key, sourceEnvName] of Object.entries(PROJECT_PATH_SOURCE_CWD_ENV_BY_KEY)) {
    const configuredValue = parsed[key]
    if (configuredValue == null || process.env[key] !== configuredValue) {
      continue
    }

    process.env[sourceEnvName] = dirname(filePath)
  }
}

const resolvePrimaryWorkspaceFolder = (workspaceFolder, env = process.env) => {
  const normalizedWorkspaceFolder = resolve(workspaceFolder)
  const explicitPrimaryWorkspaceFolder = env[PRIMARY_WORKSPACE_ENV]?.trim()
  if (explicitPrimaryWorkspaceFolder) {
    const resolvedPrimaryWorkspaceFolder = resolvePathFromBase(
      resolveProjectLaunchCwd(workspaceFolder, env),
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
      cwd: workspaceFolder,
      encoding: 'utf8'
    })
    if (result.status !== 0) {
      return undefined
    }

    const gitCommonDir = result.stdout?.trim()
    if (!gitCommonDir) {
      return undefined
    }

    const primaryWorkspaceFolder = dirname(resolve(workspaceFolder, gitCommonDir))
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

const loadDotenv = (options = {}) => {
  if (options.workspaceFolder != null) {
    const inheritedWorkspaceFolder = process.env[PROJECT_WORKSPACE_FOLDER_ENV]
    const inheritedWorkspaceMatches = normalizeDirPath(inheritedWorkspaceFolder) != null &&
      resolve(inheritedWorkspaceFolder) === resolve(options.workspaceFolder)
    delete process.env[PROJECT_LAUNCH_CWD_ENV]
    delete process.env[PROJECT_WORKSPACE_FOLDER_ENV]
    delete process.env[PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD_ENV]
    delete process.env[PROJECT_CONFIG_DIR_ENV]
    delete process.env[PROJECT_CONFIG_DIR_RESOLVE_CWD_ENV]
    if (!inheritedWorkspaceMatches) {
      delete process.env[PRIMARY_WORKSPACE_ENV]
      delete process.env[PROJECT_ONEWORKS_HOME_PROJECT_DIR_ENV]
    }
  }

  const launchCwd = resolveProjectLaunchCwd(
    options.workspaceFolder ?? process.cwd(),
    process.env
  )
  process.env[PROJECT_LAUNCH_CWD_ENV] = launchCwd
  const envFiles = process.env.__ONEWORKS_PROJECT_DOTENV_FILES__
    ? process.env.__ONEWORKS_PROJECT_DOTENV_FILES__
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    : undefined
  const files = options.files ?? envFiles ?? ['.env', '.env.dev']
  const packageDir = process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__
  const seenFiles = new Set()

  while (true) {
    const workspaceFolder = resolveProjectWorkspaceFolder(launchCwd, process.env)
    const configDir = resolveProjectConfigDir(launchCwd, process.env)
    const primaryWorkspaceFolder = resolvePrimaryWorkspaceFolder(workspaceFolder)
    const roots = [
      launchCwd,
      workspaceFolder,
      ...(configDir != null ? [configDir] : []),
      ...(packageDir && packageDir !== workspaceFolder ? [packageDir] : []),
      ...(primaryWorkspaceFolder &&
          primaryWorkspaceFolder !== launchCwd &&
          primaryWorkspaceFolder !== workspaceFolder &&
          primaryWorkspaceFolder !== configDir &&
          primaryWorkspaceFolder !== packageDir
        ? [primaryWorkspaceFolder]
        : [])
    ]
    const pendingFiles = []

    for (const root of roots) {
      for (const file of files) {
        const filePath = resolve(root, file)
        if (seenFiles.has(filePath)) {
          continue
        }

        pendingFiles.push(filePath)
      }
    }

    if (pendingFiles.length === 0) {
      break
    }

    for (const filePath of pendingFiles) {
      seenFiles.add(filePath)
      const result = dotenv.config({
        quiet: true,
        path: filePath
      })
      rememberProjectPathSources(filePath, result.parsed)
    }

    const resolvedWorkspaceFolder = resolveProjectWorkspaceFolder(launchCwd, process.env)
    const resolvedConfigDir = resolveProjectConfigDir(launchCwd, process.env)

    process.env[PROJECT_WORKSPACE_FOLDER_ENV] = resolvedWorkspaceFolder
    if (resolvedConfigDir != null) {
      process.env[PROJECT_CONFIG_DIR_ENV] = resolvedConfigDir
    }
  }

  process.env[PROJECT_WORKSPACE_FOLDER_ENV] = resolveProjectWorkspaceFolder(launchCwd, process.env)
  const resolvedConfigDir = resolveProjectConfigDir(launchCwd, process.env)
  if (resolvedConfigDir != null) {
    process.env[PROJECT_CONFIG_DIR_ENV] = resolvedConfigDir
  }
}

loadDotenv()

module.exports = {
  loadDotenv,
  migrateProjectHomeSegmentSync,
  migrateProjectHomeSegmentsSync,
  resolvePrimaryWorkspaceFolder,
  resolveLegacyProjectHomeSegmentPaths,
  resolveProjectOoBaseDir,
  resolveProjectHomeDir,
  resolveProjectHomePath,
  resolveProjectHomeProjectsDir,
  resolveProjectMockHome,
  resolveProjectConfigDir,
  resolveProjectLaunchCwd,
  resolveProjectWorkspaceFolder
}
