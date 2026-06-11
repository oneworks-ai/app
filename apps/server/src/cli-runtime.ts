import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import process from 'node:process'

import {
  resolvePrimaryWorkspaceFolder,
  resolveProjectHomePath,
  resolveProjectMockHome,
  resolveProjectWorkspaceFolder
} from '@oneworks/register/dotenv'
import { bridgeRealHomeToMockHome } from '@oneworks/register/mock-home-bridge'
import { migrateProjectHomeSegments } from '@oneworks/utils/project-home-migration'

import { isDefaultServerDataDir, migrateDefaultServerDataDir } from './project-home-data-migration'

const nodeRequire = createRequire(__filename)

export interface RuntimeCliOptions {
  allowCors?: boolean
  base?: string
  configDir?: string
  dataDir?: string
  host?: string
  logDir?: string
  port?: string
  publicBaseUrl?: string
  workspace?: string
  wsPath?: string
}

export interface RuntimeEnvDefaults {
  allowCors?: boolean
  clientBase?: string
  clientMode?: 'dev' | 'none' | 'static'
  entryKind?: 'server' | 'web'
  serverHost?: string
  serverPort?: string
  serverWsPath?: string
}

export interface ApplyServerRuntimeEnvOptions {
  baseEnv?: NodeJS.ProcessEnv
  cwd?: string
  defaults: RuntimeEnvDefaults
  options: RuntimeCliOptions
  packageDir: string
}

export interface RunRuntimeEntryOptions {
  entryPath: string
  env: NodeJS.ProcessEnv
}

const resolveOptionPath = (cwd: string, value?: string) => {
  const trimmedValue = value?.trim()
  if (!trimmedValue) {
    return undefined
  }

  return resolve(cwd, trimmedValue)
}

export const applyServerRuntimeEnv = (params: ApplyServerRuntimeEnvOptions) => {
  const baseEnv = params.baseEnv ?? process.env
  const callerCwd = resolve(params.cwd ?? process.cwd())
  const launchCwd = resolveOptionPath(callerCwd, baseEnv.__ONEWORKS_PROJECT_LAUNCH_CWD__) ?? callerCwd
  const nextEnv: NodeJS.ProcessEnv = {
    ...baseEnv,
    __ONEWORKS_PROJECT_LAUNCH_CWD__: launchCwd
  }

  if (params.defaults.serverHost != null) {
    nextEnv.__ONEWORKS_PROJECT_SERVER_HOST__ = params.options.host ??
      nextEnv.__ONEWORKS_PROJECT_SERVER_HOST__ ??
      params.defaults.serverHost
  }

  if (params.defaults.serverPort != null) {
    nextEnv.__ONEWORKS_PROJECT_SERVER_PORT__ = params.options.port ??
      nextEnv.__ONEWORKS_PROJECT_SERVER_PORT__ ??
      params.defaults.serverPort
  }

  if (params.defaults.serverWsPath != null) {
    nextEnv.__ONEWORKS_PROJECT_SERVER_WS_PATH__ = params.options.wsPath ??
      nextEnv.__ONEWORKS_PROJECT_SERVER_WS_PATH__ ??
      params.defaults.serverWsPath
  }

  if (params.defaults.allowCors != null) {
    nextEnv.__ONEWORKS_PROJECT_SERVER_ALLOW_CORS__ = params.options.allowCors === true
      ? 'true'
      : nextEnv.__ONEWORKS_PROJECT_SERVER_ALLOW_CORS__ ?? (params.defaults.allowCors ? 'true' : 'false')
  }

  if (params.defaults.clientMode != null) {
    nextEnv.__ONEWORKS_PROJECT_CLIENT_MODE__ = params.defaults.clientMode
  }

  if (params.defaults.clientBase != null) {
    nextEnv.__ONEWORKS_PROJECT_CLIENT_BASE__ = params.options.base ??
      nextEnv.__ONEWORKS_PROJECT_CLIENT_BASE__ ??
      params.defaults.clientBase
  }

  if (params.defaults.entryKind != null) {
    nextEnv.__ONEWORKS_PROJECT_SERVER_ENTRY_KIND__ = params.defaults.entryKind
  }

  if (typeof params.options.publicBaseUrl === 'string') {
    nextEnv.__ONEWORKS_PROJECT_PUBLIC_BASE_URL__ = params.options.publicBaseUrl
  }

  if (typeof params.options.dataDir === 'string') {
    nextEnv.__ONEWORKS_PROJECT_SERVER_DATA_DIR__ = params.options.dataDir
  }

  if (typeof params.options.logDir === 'string') {
    nextEnv.__ONEWORKS_PROJECT_SERVER_LOG_DIR__ = params.options.logDir
  }

  const workspaceFolder = resolveOptionPath(launchCwd, params.options.workspace) ??
    resolveProjectWorkspaceFolder(launchCwd, nextEnv)
  const inheritedWorkspaceFolder = nextEnv.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__?.trim()
  const inheritedWorkspaceMatches = inheritedWorkspaceFolder != null &&
    inheritedWorkspaceFolder !== '' &&
    resolve(inheritedWorkspaceFolder) === workspaceFolder
  const preserveInheritedPrimaryWorkspace = inheritedWorkspaceMatches &&
    nextEnv.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__?.trim() != null &&
    nextEnv.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__?.trim() !== ''
  nextEnv.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspaceFolder
  nextEnv.__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__ = workspaceFolder

  if (!preserveInheritedPrimaryWorkspace) {
    delete nextEnv.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
    const primaryWorkspaceFolder = resolvePrimaryWorkspaceFolder(workspaceFolder, nextEnv)
    if (primaryWorkspaceFolder != null) {
      nextEnv.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = primaryWorkspaceFolder
    }
  }
  if (inheritedWorkspaceFolder != null && inheritedWorkspaceFolder !== '' && !inheritedWorkspaceMatches) {
    delete nextEnv.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__
  }

  if (typeof params.options.dataDir !== 'string' && nextEnv.__ONEWORKS_PROJECT_SERVER_DATA_DIR__ == null) {
    nextEnv.__ONEWORKS_PROJECT_SERVER_DATA_DIR__ = resolveProjectHomePath(workspaceFolder, nextEnv, 'server', 'data')
  }

  if (typeof params.options.logDir !== 'string' && nextEnv.__ONEWORKS_PROJECT_SERVER_LOG_DIR__ == null) {
    nextEnv.__ONEWORKS_PROJECT_SERVER_LOG_DIR__ = resolveProjectHomePath(workspaceFolder, nextEnv, 'logs', 'server')
  }

  const configDir = resolveOptionPath(launchCwd, params.options.configDir)
  if (configDir != null) {
    nextEnv.__ONEWORKS_PROJECT_CONFIG_DIR__ = configDir
  }

  nextEnv.__ONEWORKS_PROJECT_PACKAGE_DIR__ = params.packageDir
  nextEnv.__ONEWORKS_PROJECT_REAL_HOME__ = nextEnv.__ONEWORKS_PROJECT_REAL_HOME__ ?? nextEnv.HOME ?? ''
  nextEnv.HOME = resolveProjectMockHome(workspaceFolder, nextEnv)

  return nextEnv
}

export const runRuntimeEntry = async (options: RunRuntimeEntryOptions) => {
  const workspaceFolder = options.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__?.trim() || process.cwd()
  const launchCwd = options.env.__ONEWORKS_PROJECT_LAUNCH_CWD__?.trim() || workspaceFolder
  await migrateProjectHomeSegments(
    workspaceFolder,
    options.env
  ).catch(() => undefined)
  const serverDataDir = options.env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__?.trim()
  if (
    serverDataDir != null && serverDataDir !== '' && isDefaultServerDataDir(workspaceFolder, options.env, serverDataDir)
  ) {
    await migrateDefaultServerDataDir(workspaceFolder, options.env).catch(() => undefined)
  }
  bridgeRealHomeToMockHome({
    realHome: options.env.__ONEWORKS_PROJECT_REAL_HOME__,
    mockHome: options.env.HOME
  })

  const child = spawn(
    process.execPath,
    [
      '--conditions=__oneworks__',
      '-r',
      nodeRequire.resolve('@oneworks/register/preload'),
      options.entryPath
    ],
    {
      cwd: launchCwd,
      env: options.env,
      stdio: 'inherit'
    }
  )

  const forwardSignal = (signal: NodeJS.Signals) => {
    if (!child.killed) {
      child.kill(signal)
    }
  }

  const handleSigint = () => {
    forwardSignal('SIGINT')
  }

  const handleSigterm = () => {
    forwardSignal('SIGTERM')
  }

  const cleanup = () => {
    process.off('SIGINT', handleSigint)
    process.off('SIGTERM', handleSigterm)
  }

  process.on('SIGINT', handleSigint)
  process.on('SIGTERM', handleSigterm)

  return await new Promise<number>((resolvePromise, reject) => {
    child.once('error', (error) => {
      cleanup()
      reject(error)
    })

    child.once('exit', (code, signal) => {
      cleanup()
      if (signal != null) {
        process.kill(process.pid, signal)
        return
      }

      resolvePromise(code ?? 0)
    })
  })
}
