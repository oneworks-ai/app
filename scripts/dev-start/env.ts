import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { clientBase, normalizeText, repoRoot } from './paths'
import {
  normalizePathValue,
  normalizeWorkspaceFolder,
  resolveDevStartHomeProjectsDir,
  resolveDevStartInstanceId,
  resolveProjectHomeDir
} from './storage'
import type { RuntimeEnvInput } from './types'

export { resolveDevStartHomeProjectsDir, resolveDevStartInstanceId } from './storage'

interface ConfigStateForPluginRoots {
  globalConfig?: unknown
  globalSource?: { resolvedConfig?: { disableGlobalConfig?: boolean } }
  mergedConfig?: { disableGlobalConfig?: boolean; plugins?: unknown }
}

type DevStartRuntimeEnv = NodeJS.ProcessEnv & {
  DB_PATH: string
  __ONEWORKS_DEV_START_INSTANCE_ID__?: string
  __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: string
  __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__?: string
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
  serverRole = 'workspace',
  serverPort
}: RuntimeEnvInput): Promise<DevStartRuntimeEnv> => {
  const isManagerServer = serverRole === 'manager'
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    __ONEWORKS_PROJECT_CLIENT_BASE__: base,
    __ONEWORKS_PROJECT_CLIENT_MODE__: clientMode,
    __ONEWORKS_PROJECT_SERVER_ROLE__: serverRole,
    __ONEWORKS_PROJECT_SERVER_PORT__: serverPort == null ? undefined : String(serverPort),
    __ONEWORKS_PROJECT_CLIENT_PORT__: clientPort == null ? undefined : String(clientPort),
    __ONEWORKS_PROJECT_LAUNCH_CWD__: process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__ ?? repoRoot,
    ...(isManagerServer
      ? { __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: 'manager' }
      : {
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ ?? repoRoot,
        __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ ??
          repoRoot
      }),
    __ONEWORKS_PROJECT_REAL_HOME__: process.env.__ONEWORKS_PROJECT_REAL_HOME__ ?? process.env.HOME ?? '',
    NO_PROXY: appendNoProxy(process.env.NO_PROXY),
    no_proxy: appendNoProxy(process.env.no_proxy),
    ...extra
  }

  if (normalizePathValue(env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__) == null) {
    env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = resolveDevStartHomeProjectsDir(env)
  }
  env.__ONEWORKS_DEV_START_INSTANCE_ID__ = env.__ONEWORKS_DEV_START_INSTANCE_ID__ ?? resolveDevStartInstanceId()

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key]
  }

  const projectHomeDir = resolveProjectHomeDir(env)
  const pluginFsAllowRoots = isManagerServer ? [] : await resolvePluginFsAllowRoots(env)
  return {
    ...env,
    ...(pluginFsAllowRoots.length > 0
      ? { __ONEWORKS_PROJECT_CLIENT_FS_ALLOW__: JSON.stringify(pluginFsAllowRoots) }
      : {}),
    __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: projectHomeDir,
    DB_PATH: process.env.DB_PATH ?? join(projectHomeDir, '.local/server/db.sqlite')
  }
}
