import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import process from 'node:process'

import { normalizeText, repoRoot } from './paths'

const DEV_START_HOME_PROJECTS_ROOT = '.oneworks/dev-instances'

export const normalizePathValue = (value: unknown) => normalizeText(value)?.replace(/[\\/]+$/, '')

export const normalizeWorkspaceFolder = (value: string) => {
  const resolved = resolve(value)
  try {
    return realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

const resolveRealHome = (env: NodeJS.ProcessEnv) =>
  resolve(normalizePathValue(env.__ONEWORKS_PROJECT_REAL_HOME__) ?? normalizePathValue(env.HOME) ?? repoRoot)

const resolveProjectsDir = (env: NodeJS.ProcessEnv, defaultValue: string) => {
  const projectsDirValue = normalizePathValue(env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__) ?? defaultValue
  return isAbsolute(projectsDirValue) ? resolve(projectsDirValue) : resolve(resolveRealHome(env), projectsDirValue)
}

const stablePathKey = (value: string) => {
  const normalizedName = basename(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const stableHash = createHash('sha1').update(value).digest('hex').slice(0, 10)
  return normalizedName === '' ? stableHash : `${normalizedName}-${stableHash}`
}

export const resolveProjectHomeDir = (env: NodeJS.ProcessEnv) => {
  const projectsDir = resolveProjectsDir(env, '.oneworks/projects')
  const explicitProjectDir = normalizePathValue(env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__)

  if (explicitProjectDir != null) {
    return isAbsolute(explicitProjectDir) ? resolve(explicitProjectDir) : resolve(projectsDir, explicitProjectDir)
  }

  const workspaceFolder = normalizeWorkspaceFolder(
    normalizePathValue(env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__) ??
      normalizePathValue(env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__) ??
      repoRoot
  )
  return resolve(projectsDir, stablePathKey(workspaceFolder))
}

export const resolveDevStartInstanceId = (root = repoRoot) => stablePathKey(normalizeWorkspaceFolder(root))

export const resolveDevStartHomeProjectsDir = (
  env: NodeJS.ProcessEnv = process.env,
  root = repoRoot
) => {
  if (normalizePathValue(env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__) != null) {
    return resolveProjectsDir(env, '.oneworks/projects')
  }
  return resolve(resolveRealHome(env), DEV_START_HOME_PROJECTS_ROOT, resolveDevStartInstanceId(root), 'projects')
}
