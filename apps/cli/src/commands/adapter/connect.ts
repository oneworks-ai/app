import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import process from 'node:process'

import { buildConfigJsonVariables, loadConfigState } from '@oneworks/config'
import {
  SERVER_INSTANCE_FILE_NAME,
  isServerInstanceState,
  loadAdapterCliPreparer,
  resolveAdapterRuntimeTarget
} from '@oneworks/types'
import { mergeProcessEnvWithProjectEnv, resolveProjectHomePath } from '@oneworks/utils'

import { resolveCliWorkspaceCwd } from '#~/workspace.js'

const CODEX_REMOTE_AUTH_TOKEN_ENV = 'ONEWORKS_CODEX_REMOTE_AUTH_TOKEN'

const normalizeHost = (value: string | undefined) => {
  const host = value?.trim()
  if (host == null || host === '' || host === '0.0.0.0' || host === '::') return '127.0.0.1'
  return host
}

const toModelSharingUrl = (baseUrl: string) => {
  const url = new URL(baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/api/adapters/codex/app-server'
  url.search = ''
  url.hash = ''
  return url.toString()
}

const resolveManagerProjectHome = (env: NodeJS.ProcessEnv) => {
  const projectsDirValue = env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__?.trim() || '.oneworks/projects'
  const realHome = env.__ONEWORKS_PROJECT_REAL_HOME__?.trim() || env.HOME?.trim() || homedir()
  const projectsDir = isAbsolute(projectsDirValue) ? resolve(projectsDirValue) : resolve(realHome, projectsDirValue)
  return resolve(projectsDir, 'manager')
}

const resolveManagerInstancePath = (env: NodeJS.ProcessEnv, cwd: string) => {
  const explicitDataDir = env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__?.trim()
  if (explicitDataDir != null && explicitDataDir !== '') {
    return resolve(explicitDataDir, SERVER_INSTANCE_FILE_NAME)
  }
  if (env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__?.trim()) {
    return resolve(resolveManagerProjectHome(env), 'server', 'data', SERVER_INSTANCE_FILE_NAME)
  }
  return resolveProjectHomePath(
    cwd,
    {
      ...env,
      __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: 'manager'
    },
    'server',
    'data',
    SERVER_INSTANCE_FILE_NAME
  )
}

const readDiscoveredManagerBaseUrl = async (env: NodeJS.ProcessEnv, cwd: string) => {
  const path = resolveManagerInstancePath(env, cwd)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    throw new Error(
      'No running One Works PM service was discovered. Start the desktop/daemon manager or set ' +
        '__ONEWORKS_PROJECT_SERVER_BASE_URL__ explicitly.'
    )
  }
  let state: unknown
  try {
    state = JSON.parse(raw) as unknown
  } catch {
    throw new Error(`The One Works PM discovery file is invalid: ${path}`)
  }
  if (!isServerInstanceState(state) || state.role !== 'manager') {
    throw new Error(`The One Works PM discovery file is invalid: ${path}`)
  }

  try {
    process.kill(state.pid, 0)
    const response = await fetch(`${state.serverBaseUrl.replace(/\/+$/u, '')}/api/auth/status`)
    if (!response.ok) throw new Error(`status ${response.status}`)
  } catch {
    throw new Error(`The discovered One Works PM service is no longer running: ${path}`)
  }
  return state.serverBaseUrl
}

export const resolveCodexModelSharingUrl = async (env: NodeJS.ProcessEnv, cwd = process.cwd()) => {
  // A managed workspace terminal inherits that workspace server's address, but
  // model sharing is deliberately mounted on the manager only. Other callers
  // may still provide the manager/remote PM address explicitly.
  if (env.__ONEWORKS_PROJECT_SERVER_ROLE__ !== 'workspace') {
    const explicitBase = env.__ONEWORKS_PROJECT_SERVER_BASE_URL__?.trim()
    if (explicitBase != null && explicitBase !== '') return toModelSharingUrl(explicitBase)

    const explicitPort = env.__ONEWORKS_PROJECT_SERVER_PORT__?.trim()
    if (explicitPort != null && explicitPort !== '') {
      return `ws://${normalizeHost(env.__ONEWORKS_PROJECT_SERVER_HOST__)}:${explicitPort}` +
        '/api/adapters/codex/app-server'
    }
  }

  return toModelSharingUrl(await readDiscoveredManagerBaseUrl(env, cwd))
}

const resolveCodexCliBinary = async () => {
  const cwd = resolveCliWorkspaceCwd()
  const env = mergeProcessEnvWithProjectEnv(process.env, { workspaceFolder: cwd })
  const configState = await loadConfigState({
    cwd,
    env,
    jsonVariables: buildConfigJsonVariables(cwd, env)
  })
  const target = resolveAdapterRuntimeTarget('codex', {
    config: configState.mergedConfig,
    cwd
  })
  const preparer = await loadAdapterCliPreparer(target.loadSpecifier)
  const result = await preparer.prepare({
    cwd,
    env,
    configs: [configState.effectiveProjectConfig ?? configState.projectConfig, configState.userConfig],
    configState,
    logger: { info: () => undefined }
  }, { target: 'cli' })
  return { binaryPath: result.binaryPath, cwd }
}

export const connectManagedCodexClient = async (options: { account?: string }) => {
  const { binaryPath, cwd } = await resolveCodexCliBinary()
  const url = new URL(await resolveCodexModelSharingUrl(process.env, cwd))
  const account = options.account?.trim()
  if (account != null && account !== '' && account !== 'default') url.searchParams.set('account', account)

  const authToken = process.env[CODEX_REMOTE_AUTH_TOKEN_ENV]?.trim()
  const childEnv = { ...process.env }
  const args = ['--remote', url.toString()]
  if (authToken != null && authToken !== '') {
    childEnv[CODEX_REMOTE_AUTH_TOKEN_ENV] = authToken
    args.push('--remote-auth-token-env', CODEX_REMOTE_AUTH_TOKEN_ENV)
  }
  const child = spawn(binaryPath, args, {
    cwd,
    env: childEnv,
    stdio: 'inherit'
  })
  return new Promise<number>((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal != null) {
        reject(new Error(`Codex CLI exited after signal ${signal}.`))
        return
      }
      resolvePromise(code ?? 1)
    })
  })
}
