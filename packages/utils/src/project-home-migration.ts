import {
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
  symlinkSync,
  utimesSync
} from 'node:fs'
import { cp, lstat, mkdir, readdir, readlink, stat, symlink, utimes } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'

import { resolveProjectHomePath } from './ai-path'

export type ProjectHomeMigratedSegment = 'logs' | 'caches' | '.mock' | '.local' | 'runtime'

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

export const resolveLegacyProjectHomeSegmentPaths = (
  cwd: string,
  env: Record<string, string | null | undefined> = process.env,
  segment: ProjectHomeMigratedSegment
) => {
  return {
    targetDir: resolveProjectHomePath(cwd, env, segment),
    sourceDirs: []
  }
}

const lstatIfPresent = async (targetPath: string) => {
  try {
    return await lstat(targetPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const lstatIfPresentSync = (targetPath: string) => {
  try {
    return lstatSync(targetPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const preservePathTimes = async (sourceStats: Awaited<ReturnType<typeof lstat>>, targetPath: string) => {
  await utimes(targetPath, sourceStats.atime, sourceStats.mtime).catch(() => undefined)
}

const preservePathTimesSync = (sourceStats: NonNullable<ReturnType<typeof lstatSync>>, targetPath: string) => {
  try {
    utimesSync(targetPath, sourceStats.atime, sourceStats.mtime)
  } catch {
    // Best effort only: copied contents matter more than filesystem timestamps.
  }
}

interface CopyMigrationContext {
  sourceRoot: string
  targetRoot: string
}

const resolveSourceSymlinkTarget = (sourcePath: string, linkTarget: string) => (
  isAbsolute(linkTarget)
    ? resolve(linkTarget)
    : resolve(dirname(sourcePath), linkTarget)
)

const resolveMigratedSymlinkTarget = (params: {
  context: CopyMigrationContext
  sourceTargetPath: string
}) => {
  if (!isPathInside(params.context.sourceRoot, params.sourceTargetPath)) {
    return params.sourceTargetPath
  }
  return resolve(
    params.context.targetRoot,
    relative(
      normalizePathForInsideCheck(params.context.sourceRoot),
      normalizePathForInsideCheck(params.sourceTargetPath)
    )
  )
}

const resolveSymlinkType = async (sourceTargetPath: string) => {
  try {
    return (await stat(sourceTargetPath)).isDirectory()
      ? process.platform === 'win32'
        ? 'junction'
        : 'dir'
      : 'file'
  } catch {
    return undefined
  }
}

const resolveSymlinkTypeSync = (sourceTargetPath: string) => {
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

const splitRelativePathSegments = (rootPath: string, targetPath: string) =>
  relative(resolve(rootPath), resolve(targetPath)).split(/[\\/]+/).filter(Boolean)

const shouldSkipVolatileMigrationPath = (sourcePath: string, context: CopyMigrationContext) => {
  const segments = splitRelativePathSegments(context.sourceRoot, sourcePath)
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === '.codex' && segments[index + 1] === '.tmp') {
      return true
    }
  }
  return false
}

const isVanishedPathError = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

const symlinkWithoutOverwrite = async (
  target: string,
  path: string,
  type: Awaited<ReturnType<typeof resolveSymlinkType>>
) => {
  try {
    await symlink(target, path, type)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return
    throw error
  }
}

const symlinkWithoutOverwriteSync = (
  target: string,
  path: string,
  type: ReturnType<typeof resolveSymlinkTypeSync>
) => {
  try {
    symlinkSync(target, path, type)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return
    throw error
  }
}

const copyEntryWithoutOverwrite = async (
  sourcePath: string,
  targetPath: string,
  context: CopyMigrationContext
) => {
  if (shouldSkipVolatileMigrationPath(sourcePath, context)) return

  const sourceStats = await lstatIfPresent(sourcePath)
  if (sourceStats == null) return

  const targetStats = await lstatIfPresent(targetPath)
  if (targetStats != null) {
    if (
      sourceStats.isDirectory() &&
      targetStats.isDirectory() &&
      !targetStats.isSymbolicLink()
    ) {
      await copyDirectoryContentsWithoutOverwrite({
        context,
        sourceDir: sourcePath,
        targetDir: targetPath
      })
    }
    return
  }

  if (sourceStats.isSymbolicLink()) {
    const linkTarget = await readlink(sourcePath)
    const sourceTargetPath = resolveSourceSymlinkTarget(sourcePath, linkTarget)
    const nextLinkTarget = resolveMigratedSymlinkTarget({
      context,
      sourceTargetPath
    })
    await mkdir(dirname(targetPath), { recursive: true })
    await symlinkWithoutOverwrite(nextLinkTarget, targetPath, await resolveSymlinkType(sourceTargetPath))
    return
  }

  if (sourceStats.isDirectory() && !sourceStats.isSymbolicLink()) {
    await mkdir(targetPath, { recursive: true })
    await copyDirectoryContentsWithoutOverwrite({
      context,
      sourceDir: sourcePath,
      targetDir: targetPath
    })
    await preservePathTimes(sourceStats, targetPath)
    return
  }

  try {
    await cp(sourcePath, targetPath, {
      dereference: false,
      errorOnExist: false,
      force: false,
      preserveTimestamps: true,
      recursive: true,
      verbatimSymlinks: true
    })
  } catch (error) {
    if (isVanishedPathError(error)) return
    throw error
  }
  if (!sourceStats.isSymbolicLink()) {
    await preservePathTimes(sourceStats, targetPath)
  }
}

const copyEntryWithoutOverwriteSync = (
  sourcePath: string,
  targetPath: string,
  context: CopyMigrationContext
) => {
  if (shouldSkipVolatileMigrationPath(sourcePath, context)) return

  const sourceStats = lstatIfPresentSync(sourcePath)
  if (sourceStats == null) return

  const targetStats = lstatIfPresentSync(targetPath)
  if (targetStats != null) {
    if (
      sourceStats.isDirectory() &&
      targetStats.isDirectory() &&
      !targetStats.isSymbolicLink()
    ) {
      copyDirectoryContentsWithoutOverwriteSync({
        context,
        sourceDir: sourcePath,
        targetDir: targetPath
      })
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
    copyDirectoryContentsWithoutOverwriteSync({
      context,
      sourceDir: sourcePath,
      targetDir: targetPath
    })
    preservePathTimesSync(sourceStats, targetPath)
    return
  }

  try {
    cpSync(sourcePath, targetPath, {
      dereference: false,
      errorOnExist: false,
      force: false,
      preserveTimestamps: true,
      recursive: true,
      verbatimSymlinks: true
    })
  } catch (error) {
    if (isVanishedPathError(error)) return
    throw error
  }
  if (!sourceStats.isSymbolicLink()) {
    preservePathTimesSync(sourceStats, targetPath)
  }
}

export const copyDirectoryContentsWithoutOverwrite = async (params: {
  context?: CopyMigrationContext
  sourceDir: string
  targetDir: string
}) => {
  const stats = await lstatIfPresent(params.sourceDir)

  if (stats == null || !stats.isDirectory() || stats.isSymbolicLink()) {
    return false
  }

  await mkdir(params.targetDir, { recursive: true })
  let entries
  try {
    entries = await readdir(params.sourceDir, { withFileTypes: true })
  } catch (error) {
    if (isVanishedPathError(error)) return false
    throw error
  }
  const context = params.context ?? {
    sourceRoot: params.sourceDir,
    targetRoot: params.targetDir
  }
  await Promise.all(
    entries.map(entry =>
      copyEntryWithoutOverwrite(join(params.sourceDir, entry.name), join(params.targetDir, entry.name), context)
    )
  )
  return entries.length > 0
}

export const copyDirectoryContentsWithoutOverwriteSync = (params: {
  context?: CopyMigrationContext
  sourceDir: string
  targetDir: string
}) => {
  const stats = lstatIfPresentSync(params.sourceDir)

  if (stats == null || !stats.isDirectory() || stats.isSymbolicLink()) {
    return false
  }

  mkdirSync(params.targetDir, { recursive: true })
  let entries
  try {
    entries = readdirSync(params.sourceDir, { withFileTypes: true })
  } catch (error) {
    if (isVanishedPathError(error)) return false
    throw error
  }
  const context = params.context ?? {
    sourceRoot: params.sourceDir,
    targetRoot: params.targetDir
  }
  for (const entry of entries) {
    copyEntryWithoutOverwriteSync(join(params.sourceDir, entry.name), join(params.targetDir, entry.name), context)
  }
  return entries.length > 0
}

export const migrateProjectHomeSegment = async (
  cwd: string,
  env: Record<string, string | null | undefined> = process.env,
  segment: ProjectHomeMigratedSegment
) => {
  return {
    migratedSources: [],
    targetDir: resolveProjectHomePath(cwd, env, segment)
  }
}

export const migrateProjectHomeSegmentSync = (
  cwd: string,
  env: Record<string, string | null | undefined> = process.env,
  segment: ProjectHomeMigratedSegment
) => {
  return {
    migratedSources: [],
    targetDir: resolveProjectHomePath(cwd, env, segment)
  }
}

export const migrateProjectHomeSegmentsSync = (
  cwd: string,
  env: Record<string, string | null | undefined> = process.env,
  segments: readonly ProjectHomeMigratedSegment[] = ['logs', 'caches', '.mock', '.local', 'runtime']
) => segments.map(segment => migrateProjectHomeSegmentSync(cwd, env, segment))

export const migrateProjectHomeSegments = async (
  cwd: string,
  env: Record<string, string | null | undefined> = process.env,
  segments: readonly ProjectHomeMigratedSegment[] = ['logs', 'caches', '.mock', '.local', 'runtime']
) => {
  const results = []
  for (const segment of segments) {
    results.push(await migrateProjectHomeSegment(cwd, env, segment))
  }
  return results
}

export const removeLegacyProjectHomeSegmentPath = async (
  _cwd: string,
  _env: Record<string, string | null | undefined> = process.env,
  _segment: ProjectHomeMigratedSegment,
  ..._segments: string[]
) => {
  return undefined
}
