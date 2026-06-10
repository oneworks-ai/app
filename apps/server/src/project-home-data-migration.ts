import path from 'node:path'

import {
  DEFAULT_PROJECT_OO_BASE_DIR,
  resolvePrimaryWorkspaceFolder,
  resolveProjectHomePath,
  resolveProjectOoBaseDir,
  resolveProjectOoBaseDirName,
  resolveProjectWorkspaceFolder
} from '@oneworks/utils/ai-path'
import { copyDirectoryContentsWithoutOverwrite } from '@oneworks/utils/project-home-migration'

const unique = (paths: string[]) => Array.from(new Set(paths.map(item => path.resolve(item))))

const isPathInside = (parentPath: string, targetPath: string) => {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(targetPath))
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  )
}

const resolveCandidateWorkspaces = (
  cwd: string,
  env: Record<string, string | null | undefined>
) =>
  unique([
    cwd,
    resolveProjectWorkspaceFolder(cwd, env),
    resolvePrimaryWorkspaceFolder(cwd, env) ?? ''
  ].filter(Boolean))

const resolveLegacyAiBaseDirForWorkspace = (
  workspaceFolder: string,
  env: Record<string, string | null | undefined>
) => {
  const baseDir = resolveProjectOoBaseDirName(env)
  return path.isAbsolute(baseDir)
    ? path.resolve(baseDir)
    : path.resolve(workspaceFolder, baseDir)
}

export const resolveDefaultServerDataDir = (
  cwd: string,
  env: Record<string, string | null | undefined>
) => resolveProjectHomePath(cwd, env, 'server', 'data')

export const isDefaultServerDataDir = (
  cwd: string,
  env: Record<string, string | null | undefined>,
  dataDir: string
) => path.resolve(dataDir) === path.resolve(resolveDefaultServerDataDir(cwd, env))

export const migrateDefaultServerDataDir = async (
  cwd: string,
  env: Record<string, string | null | undefined>
) => {
  const targetDir = resolveDefaultServerDataDir(cwd, env)
  const aiBaseDir = resolveProjectOoBaseDir(cwd, env)
  const sourceDirs = unique([
    ...resolveCandidateWorkspaces(cwd, env).map(workspace => path.resolve(workspace, '.data')),
    path.resolve(aiBaseDir, 'server', 'data'),
    ...resolveCandidateWorkspaces(cwd, env).map(workspace =>
      path.resolve(resolveLegacyAiBaseDirForWorkspace(workspace, env), 'server', 'data')
    ),
    ...resolveCandidateWorkspaces(cwd, env).map(workspace =>
      path.resolve(workspace, DEFAULT_PROJECT_OO_BASE_DIR, 'server', 'data')
    )
  ]).filter(sourceDir =>
    sourceDir !== targetDir &&
    !isPathInside(sourceDir, targetDir) &&
    !isPathInside(targetDir, sourceDir)
  )

  for (const sourceDir of sourceDirs) {
    await copyDirectoryContentsWithoutOverwrite({
      sourceDir,
      targetDir
    })
  }

  return targetDir
}
