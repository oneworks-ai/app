import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

import { clientBase, normalizeText, repoRoot } from './paths'
import type { RuntimeEnvInput } from './types'

interface ConfigStateForPluginRoots {
  globalConfig?: unknown
  globalSource?: {
    resolvedConfig?: {
      disableGlobalConfig?: boolean
    }
  }
  mergedConfig?: {
    disableGlobalConfig?: boolean
    plugins?: unknown
  }
}

interface PluginResolverModule {
  resolveConfiguredPluginInstances: (params: {
    cwd: string
    includeDisabled: boolean
    plugins: unknown
  }) => Promise<Array<{ rootDir: string }>>
  resolveRuntimePluginConfig: (params: {
    cwd: string
    disableGlobalConfig?: boolean
    env: NodeJS.ProcessEnv
    plugins?: unknown
  }) => Promise<unknown>
}

const normalizePathValue = (value: unknown) => normalizeText(value)?.replace(/[\\/]+$/, '')

const normalizeWorkspaceFolder = (value: string) => {
  const resolved = resolve(value)
  try {
    return realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

const resolveProjectHomeDir = (env: NodeJS.ProcessEnv) => {
  const realHome = resolve(
    normalizePathValue(env.__ONEWORKS_PROJECT_REAL_HOME__) ?? normalizePathValue(env.HOME) ?? repoRoot
  )
  const projectsDirValue = normalizePathValue(env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__) ?? '.oneworks/projects'
  const projectsDir = isAbsolute(projectsDirValue) ? resolve(projectsDirValue) : resolve(realHome, projectsDirValue)
  const explicitProjectDir = normalizePathValue(env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__)

  if (explicitProjectDir != null) {
    return isAbsolute(explicitProjectDir) ? resolve(explicitProjectDir) : resolve(projectsDir, explicitProjectDir)
  }

  const workspaceFolder = normalizeWorkspaceFolder(
    normalizePathValue(env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__) ??
      normalizePathValue(env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__) ??
      repoRoot
  )
  const normalizedName = basename(workspaceFolder)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const stableHash = createHash('sha1').update(workspaceFolder).digest('hex').slice(0, 10)
  return resolve(projectsDir, normalizedName === '' ? stableHash : `${normalizedName}-${stableHash}`)
}

const appendNoProxy = (value: unknown) => {
  const local = 'localhost,127.0.0.1,::1'
  return normalizeText(value) == null ? local : `${value},${local}`
}

const unique = <T>(values: T[]) => [...new Set(values)]

const runtimeRequire = createRequire(resolve(repoRoot, 'scripts/dev-start/env.ts'))

const requireRuntimeModule = <T>(specifier: string) => runtimeRequire(specifier) as T

const resolvePluginFsAllowRoots = async (env: NodeJS.ProcessEnv) => {
  try {
    const { buildConfigJsonVariables, loadConfigState } = requireRuntimeModule<{
      buildConfigJsonVariables: (
        workspaceFolder: string,
        env: NodeJS.ProcessEnv
      ) => Record<string, string | null | undefined>
      loadConfigState: (options: {
        cwd: string
        env: NodeJS.ProcessEnv
        jsonVariables?: Record<string, string | null | undefined>
      }) => Promise<ConfigStateForPluginRoots>
    }>('../../packages/config/src/load.ts')
    const { resolveConfiguredPluginInstances, resolveRuntimePluginConfig } = requireRuntimeModule<PluginResolverModule>(
      '../../packages/utils/src/plugin-resolver.ts'
    )
    const workspaceFolder = normalizeWorkspaceFolder(
      env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ ??
        env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ ??
        env.__ONEWORKS_PROJECT_LAUNCH_CWD__ ??
        repoRoot
    )
    const { globalConfig, globalSource, mergedConfig } = await loadConfigState({
      cwd: workspaceFolder,
      env,
      jsonVariables: buildConfigJsonVariables(workspaceFolder, env)
    })
    const disableGlobalConfig = mergedConfig?.disableGlobalConfig === true ||
      (globalConfig == null && globalSource?.resolvedConfig?.disableGlobalConfig === true)
    const plugins = await resolveRuntimePluginConfig({
      cwd: workspaceFolder,
      disableGlobalConfig,
      env,
      plugins: mergedConfig?.plugins
    })
    const instances = await resolveConfiguredPluginInstances({
      cwd: workspaceFolder,
      includeDisabled: true,
      plugins
    })
    return unique(instances.map(instance => instance.rootDir))
  } catch {
    return []
  }
}

export const getServerHost = () => normalizeText(process.env.__ONEWORKS_PROJECT_SERVER_HOST__) ?? '127.0.0.1'
export const getClientHost = () => normalizeText(process.env.__ONEWORKS_PROJECT_CLIENT_HOST__) ?? '127.0.0.1'

export const buildRuntimeEnv = async ({
  base = clientBase,
  clientMode = 'dev',
  clientPort,
  extra = {},
  serverPort
}: RuntimeEnvInput) => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    __ONEWORKS_PROJECT_CLIENT_BASE__: base,
    __ONEWORKS_PROJECT_CLIENT_MODE__: clientMode,
    __ONEWORKS_PROJECT_SERVER_PORT__: serverPort == null ? undefined : String(serverPort),
    __ONEWORKS_PROJECT_CLIENT_PORT__: clientPort == null ? undefined : String(clientPort),
    __ONEWORKS_PROJECT_LAUNCH_CWD__: process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__ ?? repoRoot,
    __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ ?? repoRoot,
    __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ ??
      repoRoot,
    __ONEWORKS_PROJECT_REAL_HOME__: process.env.__ONEWORKS_PROJECT_REAL_HOME__ ?? process.env.HOME ?? '',
    NO_PROXY: appendNoProxy(process.env.NO_PROXY),
    no_proxy: appendNoProxy(process.env.no_proxy),
    ...extra
  }

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key]
  }

  const projectHomeDir = resolveProjectHomeDir(env)
  const pluginFsAllowRoots = await resolvePluginFsAllowRoots(env)
  return {
    ...env,
    ...(pluginFsAllowRoots.length > 0
      ? { __ONEWORKS_PROJECT_CLIENT_FS_ALLOW__: JSON.stringify(pluginFsAllowRoots) }
      : {}),
    __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: projectHomeDir,
    DB_PATH: process.env.DB_PATH ?? join(projectHomeDir, '.local/server/db.sqlite')
  }
}
