import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import path, { resolve } from 'node:path'
import process from 'node:process'

import type {
  LauncherDirectoryList,
  LauncherWorkspaceOpenResponse,
  LauncherWorkspaceSelectorProject,
  LauncherWorkspaceSelectorState,
  LauncherWorkspaceServiceStatus
} from '@oneworks/types'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { applyServerRuntimeEnv } from '#~/cli-runtime.js'
import { badRequest, internalServerError } from '#~/utils/http.js'
import { logger } from '#~/utils/logger.js'

const nodeRequire = createRequire(__filename)

const MAX_RECENT_WORKSPACES = 20
const WORKSPACE_SERVER_HOST = '127.0.0.1'
const WORKSPACE_SERVER_READY_TIMEOUT_MS = 20_000
const WORKSPACE_SERVER_READY_POLL_MS = 200
const invalidFileNameCharacters = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])

interface LauncherManagerState {
  recentWorkspaces?: unknown
}

interface LauncherWorkspaceService {
  process?: ReturnType<typeof spawn>
  serverBaseUrl?: string
  startPromise?: Promise<LauncherWorkspaceService>
  status: LauncherWorkspaceServiceStatus
  workspaceFolder: string
}

const services = new Map<string, LauncherWorkspaceService>()

const isDirectory = (value: string) => {
  try {
    return fs.statSync(value).isDirectory()
  } catch {
    return false
  }
}

const normalizeWorkspaceFolder = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmedValue = value.trim()
  if (trimmedValue === '') return undefined

  const resolvedPath = path.resolve(trimmedValue)
  if (!isDirectory(resolvedPath)) {
    return undefined
  }

  try {
    return fs.realpathSync.native(resolvedPath)
  } catch {
    return resolvedPath
  }
}

const readGitProjectRoot = (workspaceFolder: string) => {
  try {
    const output = execFileSync(
      'git',
      [
        '-C',
        workspaceFolder,
        'rev-parse',
        '--path-format=absolute',
        '--show-toplevel',
        '--git-common-dir'
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2_000
      }
    )
    const [topLevel, gitCommonDir] = output
      .split(/\r?\n/u)
      .map(line => line.trim())
      .filter(Boolean)
    const commonGitDir = gitCommonDir == null
      ? undefined
      : normalizeWorkspaceFolder(gitCommonDir)
    if (commonGitDir != null && path.basename(commonGitDir) === '.git') {
      const commonProjectFolder = normalizeWorkspaceFolder(path.dirname(commonGitDir))
      if (commonProjectFolder != null) return commonProjectFolder
    }

    return normalizeWorkspaceFolder(topLevel)
  } catch {
    return undefined
  }
}

export const resolveLauncherProjectWorkspaceFolder = (value: unknown) => {
  const workspaceFolder = normalizeWorkspaceFolder(value)
  if (workspaceFolder == null) return undefined

  return readGitProjectRoot(workspaceFolder) ?? workspaceFolder
}

const normalizePathForRemoval = (value: unknown) => {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined
  }
  return resolveLauncherProjectWorkspaceFolder(value) ?? path.resolve(value.trim())
}

const getWorkspaceDisplayName = (workspaceFolder: string) => path.basename(workspaceFolder) || workspaceFolder

const getWorkspaceDescription = (workspaceFolder: string) => workspaceFolder

const getLauncherStatePath = () => (
  resolveProjectHomePath(process.cwd(), process.env, 'launcher', 'state.json')
)

const readLauncherState = async (): Promise<LauncherManagerState> => {
  try {
    const raw = await readFile(getLauncherStatePath(), 'utf8')
    const value = JSON.parse(raw) as unknown
    return value != null && typeof value === 'object' && !Array.isArray(value)
      ? value as LauncherManagerState
      : {}
  } catch {
    return {}
  }
}

const writeLauncherState = async (state: LauncherManagerState) => {
  const statePath = getLauncherStatePath()
  await mkdir(path.dirname(statePath), { recursive: true })
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

const dedupeWorkspaceFolders = (values: unknown[]) => {
  const normalizedValues: string[] = []
  const seenPaths = new Set<string>()
  for (const value of values) {
    const normalizedPath = resolveLauncherProjectWorkspaceFolder(value)
    if (normalizedPath == null || seenPaths.has(normalizedPath)) {
      continue
    }
    seenPaths.add(normalizedPath)
    normalizedValues.push(normalizedPath)
  }
  return normalizedValues
}

const getRecentWorkspaces = async () => {
  const state = await readLauncherState()
  const recentWorkspaces = Array.isArray(state.recentWorkspaces) ? state.recentWorkspaces : []
  return dedupeWorkspaceFolders(recentWorkspaces).slice(0, MAX_RECENT_WORKSPACES)
}

const rememberRecentWorkspace = async (workspaceFolder: string) => {
  const state = await readLauncherState()
  const recentWorkspaces = Array.isArray(state.recentWorkspaces) ? state.recentWorkspaces : []
  const nextRecentWorkspaces = dedupeWorkspaceFolders([
    workspaceFolder,
    ...recentWorkspaces
  ]).slice(0, MAX_RECENT_WORKSPACES)
  await writeLauncherState({
    ...state,
    recentWorkspaces: nextRecentWorkspaces
  })
  return nextRecentWorkspaces
}

const removeRecentWorkspace = async (workspaceFolder: string) => {
  const state = await readLauncherState()
  const recentWorkspaces = Array.isArray(state.recentWorkspaces) ? state.recentWorkspaces : []
  const nextRecentWorkspaces = dedupeWorkspaceFolders(recentWorkspaces)
    .filter(candidate => candidate !== workspaceFolder)
    .slice(0, MAX_RECENT_WORKSPACES)
  await writeLauncherState({
    ...state,
    recentWorkspaces: nextRecentWorkspaces
  })
  return nextRecentWorkspaces
}

const toProject = (
  workspaceFolder: string,
  input: {
    isCurrent?: boolean
    status?: LauncherWorkspaceServiceStatus
  } = {}
): LauncherWorkspaceSelectorProject => ({
  description: getWorkspaceDescription(workspaceFolder),
  name: getWorkspaceDisplayName(workspaceFolder),
  ...(input.isCurrent == null ? {} : { isCurrent: input.isCurrent }),
  ...(input.status == null ? {} : { status: input.status }),
  workspaceFolder
})

const getAvailablePort = async () => (
  await new Promise<number>((resolvePromise, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, WORKSPACE_SERVER_HOST, () => {
      const address = server.address()
      const port = typeof address === 'object' && address != null ? address.port : undefined
      server.close(() => {
        if (port == null) {
          reject(new Error('Failed to allocate a workspace server port.'))
          return
        }
        resolvePromise(port)
      })
    })
  })
)

const sleep = async (ms: number) => await new Promise(resolvePromise => setTimeout(resolvePromise, ms))

const waitForServerReady = async (service: LauncherWorkspaceService) => {
  const serverBaseUrl = service.serverBaseUrl
  if (serverBaseUrl == null) {
    throw new Error('Workspace server URL is not available.')
  }

  const startedAt = Date.now()
  while (Date.now() - startedAt < WORKSPACE_SERVER_READY_TIMEOUT_MS) {
    if (service.process?.exitCode != null || service.process?.signalCode != null) {
      throw new Error('Workspace server exited before it became ready.')
    }

    try {
      const response = await fetch(`${serverBaseUrl}/api/auth/status`)
      if (response.ok) return
    } catch {
      // keep polling until the startup deadline
    }
    await sleep(WORKSPACE_SERVER_READY_POLL_MS)
  }

  throw new Error('Timed out waiting for the workspace server to become ready.')
}

const writePrefixedChunk = (prefix: string, chunk: Buffer | string) => {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
  for (const line of text.split(/\r?\n/u)) {
    if (line.trim() !== '') {
      process.stdout.write(`${prefix}${line}\n`)
    }
  }
}

const createWorkspaceServerEnv = (
  workspaceFolder: string,
  input: {
    clientOrigin?: string
    port: number
  }
) => {
  const packageDir = process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__ ?? resolve(process.cwd(), 'apps/server')
  const env = applyServerRuntimeEnv({
    cwd: workspaceFolder,
    packageDir,
    options: {
      allowCors: input.clientOrigin != null,
      host: WORKSPACE_SERVER_HOST,
      port: String(input.port),
      workspace: workspaceFolder
    },
    defaults: {
      allowCors: false,
      clientMode: 'none',
      entryKind: 'server',
      serverRole: 'workspace',
      serverHost: WORKSPACE_SERVER_HOST,
      serverPort: String(input.port),
      serverWsPath: '/ws',
      workspaceMode: 'required'
    }
  })
  env.__ONEWORKS_PROJECT_CLIENT_BASE__ = process.env.__ONEWORKS_PROJECT_CLIENT_BASE__ ?? '/ui/'
  env.__ONEWORKS_PROJECT_WEB_AUTH_ENABLED__ = 'false'
  if (input.clientOrigin != null) {
    env.__ONEWORKS_PROJECT_SERVER_CORS_ORIGIN__ = input.clientOrigin
  }
  return {
    env,
    packageDir
  }
}

const startWorkspaceService = async (
  service: LauncherWorkspaceService,
  input: {
    clientOrigin?: string
  }
) => {
  const port = await getAvailablePort()
  service.serverBaseUrl = `http://${WORKSPACE_SERVER_HOST}:${port}`
  const { env, packageDir } = createWorkspaceServerEnv(service.workspaceFolder, {
    clientOrigin: input.clientOrigin,
    port
  })
  const child = spawn(
    process.execPath,
    [
      '--conditions=__oneworks__',
      '-r',
      nodeRequire.resolve('@oneworks/register/preload'),
      resolve(packageDir, 'src/index.ts')
    ],
    {
      cwd: service.workspaceFolder,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  service.process = child
  child.stdout?.on('data', data => writePrefixedChunk(`[oneworks-workspace:${service.workspaceFolder}] `, data))
  child.stderr?.on('data', data => writePrefixedChunk(`[oneworks-workspace:${service.workspaceFolder}] `, data))
  child.once('exit', (code, signal) => {
    if (services.get(service.workspaceFolder) === service) {
      services.delete(service.workspaceFolder)
    }
    service.status = 'stopped'
    logger.info(
      `[launcher] workspace server exited workspace=${service.workspaceFolder} code=${code ?? 'null'} signal=${
        signal ?? 'null'
      }`
    )
  })

  await waitForServerReady(service)
  service.status = 'ready'
  await rememberRecentWorkspace(service.workspaceFolder)
  return service
}

const ensureWorkspaceService = async (
  workspaceFolder: string,
  input: {
    clientOrigin?: string
  }
) => {
  const existingService = services.get(workspaceFolder)
  if (existingService != null) {
    if (existingService.startPromise != null) {
      return await existingService.startPromise
    }
    if (existingService.status === 'ready' && existingService.serverBaseUrl != null) {
      await rememberRecentWorkspace(workspaceFolder)
      return existingService
    }
    services.delete(workspaceFolder)
  }

  const service: LauncherWorkspaceService = {
    status: 'starting',
    workspaceFolder
  }
  services.set(workspaceFolder, service)
  service.startPromise = startWorkspaceService(service, input)
    .catch((error) => {
      services.delete(workspaceFolder)
      service.status = 'stopped'
      service.process?.kill()
      throw error
    })
    .finally(() => {
      service.startPromise = undefined
    })
  return await service.startPromise
}

export const listLauncherWorkspaces = async (): Promise<LauncherWorkspaceSelectorState> => {
  const runningWorkspaceFolders = new Set(services.keys())
  const runningProjects = Array.from(services.values())
    .sort((left, right) =>
      getWorkspaceDisplayName(left.workspaceFolder).localeCompare(
        getWorkspaceDisplayName(right.workspaceFolder)
      )
    )
    .map(service => toProject(service.workspaceFolder, { status: service.status }))
  const recentProjects = (await getRecentWorkspaces())
    .filter(workspaceFolder => !runningWorkspaceFolders.has(workspaceFolder))
    .map(workspaceFolder => toProject(workspaceFolder))

  return {
    recentProjects,
    runningProjects
  }
}

export const openLauncherWorkspace = async (
  rawWorkspaceFolder: unknown,
  input: {
    clientOrigin?: string
  } = {}
): Promise<LauncherWorkspaceOpenResponse> => {
  const workspaceFolder = resolveLauncherProjectWorkspaceFolder(rawWorkspaceFolder)
  if (workspaceFolder == null) {
    throw badRequest('A valid workspace folder is required.', { workspaceFolder: rawWorkspaceFolder })
  }

  const service = await ensureWorkspaceService(workspaceFolder, input).catch((error) => {
    throw internalServerError('Failed to start workspace server.', {
      cause: error,
      details: { workspaceFolder }
    })
  })
  if (service.serverBaseUrl == null) {
    throw internalServerError('Workspace server did not publish a URL.', { details: { workspaceFolder } })
  }

  return {
    project: toProject(workspaceFolder, { status: service.status }),
    serverBaseUrl: service.serverBaseUrl,
    workspaceFolder
  }
}

export const forgetLauncherWorkspace = async (rawWorkspaceFolder: unknown) => {
  const workspaceFolder = normalizePathForRemoval(rawWorkspaceFolder)
  if (workspaceFolder == null) {
    throw badRequest('A workspace folder is required.', { workspaceFolder: rawWorkspaceFolder })
  }

  await removeRecentWorkspace(workspaceFolder)
  return { ok: true, workspaceFolder }
}

const resolveDefaultDirectory = () => normalizeWorkspaceFolder(homedir()) ?? path.parse(homedir()).root

const resolveDirectory = (rawDirectory?: unknown) => {
  if (typeof rawDirectory === 'string' && rawDirectory.trim() !== '') {
    const normalizedDirectory = normalizeWorkspaceFolder(path.resolve(rawDirectory.trim()))
    if (normalizedDirectory != null) return normalizedDirectory
  }
  return resolveDefaultDirectory()
}

export const listLauncherDirectories = async (rawDirectory?: unknown): Promise<LauncherDirectoryList> => {
  const currentDirectory = resolveDirectory(rawDirectory)
  const rootDirectory = path.parse(currentDirectory).root
  const parentCandidate = path.dirname(currentDirectory)
  const parentDirectory = parentCandidate === currentDirectory || currentDirectory === rootDirectory
    ? undefined
    : normalizeWorkspaceFolder(parentCandidate)
  const entries = await readdir(currentDirectory, { withFileTypes: true }).catch(() => [])
  const directories = (
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) return undefined

      const entryPath = path.resolve(currentDirectory, entry.name)
      const entryStat = await stat(entryPath).catch(() => undefined)
      if (entryStat?.isDirectory() !== true) return undefined

      const normalizedEntryPath = normalizeWorkspaceFolder(entryPath)
      if (normalizedEntryPath == null) return undefined

      return {
        name: entry.name,
        path: normalizedEntryPath
      }
    }))
  )
    .filter((entry): entry is { name: string; path: string } => entry != null)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))

  return {
    currentDirectory,
    directories,
    ...(parentDirectory == null ? {} : { parentDirectory })
  }
}

const normalizeNewWorkspaceName = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const name = value.trim()
  if (
    name === '' ||
    name === '.' ||
    name === '..' ||
    name.split('').some(character => invalidFileNameCharacters.has(character) || character.codePointAt(0) === 0)
  ) {
    return undefined
  }
  return name
}

export const createLauncherWorkspaceInDirectory = async (
  rawParentDirectory: unknown,
  rawProjectName: unknown
) => {
  const parentDirectory = normalizeWorkspaceFolder(rawParentDirectory)
  if (parentDirectory == null) {
    throw badRequest('A valid parent directory is required.', { parentDirectory: rawParentDirectory })
  }

  const projectName = normalizeNewWorkspaceName(rawProjectName)
  if (projectName == null) {
    throw badRequest('A valid project name is required.', { projectName: rawProjectName })
  }

  const workspaceFolder = path.resolve(parentDirectory, projectName)
  if (path.dirname(workspaceFolder) !== parentDirectory) {
    throw badRequest('A valid project name is required.', { projectName: rawProjectName })
  }

  await mkdir(workspaceFolder, { recursive: false }).catch((error: unknown) => {
    throw badRequest(
      'Failed to create workspace directory.',
      { projectName, parentDirectory },
      'workspace_create_failed'
    )
  })

  const normalizedWorkspaceFolder = normalizeWorkspaceFolder(workspaceFolder)
  if (normalizedWorkspaceFolder == null) {
    throw internalServerError('Created workspace directory could not be opened.', { details: { workspaceFolder } })
  }
  await rememberRecentWorkspace(normalizedWorkspaceFolder)
  return normalizedWorkspaceFolder
}
