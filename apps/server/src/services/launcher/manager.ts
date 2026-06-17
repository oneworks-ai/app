/* eslint-disable max-lines -- launcher manager keeps workspace discovery, recent projects, and service startup together. */

import { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
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
  LauncherWorkspaceServiceStatus,
  LauncherWorkspaceStopResponse
} from '@oneworks/types'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { applyServerRuntimeEnv } from '#~/cli-runtime.js'
import { createWorkspaceRuntimeEnv } from '#~/services/runtime-store/workspace-env.js'
import { badRequest, conflict, internalServerError, isHttpError, notFound } from '#~/utils/http.js'
import { logger } from '#~/utils/logger.js'

const nodeRequire = createRequire(__filename)

const MAX_RECENT_WORKSPACES = 20
const WORKSPACE_SERVER_HOST = '127.0.0.1'
const WORKSPACE_SERVER_READY_TIMEOUT_MS = 20_000
const WORKSPACE_SERVER_READY_POLL_MS = 200
const WORKSPACE_SERVER_STOP_TIMEOUT_MS = 5_000
const WORKSPACE_INSTANCE_LOCK_TIMEOUT_MS = 30_000
const WORKSPACE_INSTANCE_LOCK_STALE_MS = 60_000
const WORKSPACE_INSTANCE_PROTOCOL_VERSION = 1
const invalidFileNameCharacters = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])

interface LauncherManagerState {
  recentWorkspaces?: unknown
}

interface LauncherWorkspaceService {
  identity?: LauncherWorkspaceInstanceIdentity
  process?: ChildProcess
  serverBaseUrl?: string
  startPromise?: Promise<LauncherWorkspaceService>
  status: LauncherWorkspaceServiceStatus
  stopPromise?: Promise<void>
  stopRequested?: boolean
  workspaceFolder: string
}

interface LauncherWorkspaceInstanceIdentity {
  implementationId: string
  launchConfigHash: string
  packageDir: string
  repoRoot?: string
}

interface LauncherWorkspaceInstanceState extends LauncherWorkspaceInstanceIdentity {
  pid?: number
  protocolVersion: number
  serverBaseUrl?: string
  startedAt: string
  workspaceFolder: string
}

const services = new Map<string, LauncherWorkspaceService>()
let workspaceServiceCleanupRegistered = false

const isChildProcessRunning = (child?: ChildProcess): child is ChildProcess => (
  child != null && child.exitCode == null && child.signalCode == null
)

const killChildProcess = async (child?: ChildProcess) => {
  if (!isChildProcessRunning(child)) return

  await new Promise<void>((resolvePromise) => {
    let settled = false
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (settled) return
      settled = true
      if (forceKillTimer != null) {
        clearTimeout(forceKillTimer)
      }
      child.off('exit', cleanup)
      resolvePromise()
    }

    child.once('exit', cleanup)
    forceKillTimer = setTimeout(() => {
      if (isChildProcessRunning(child)) {
        child.kill('SIGKILL')
      }
    }, WORKSPACE_SERVER_STOP_TIMEOUT_MS)

    try {
      if (!child.kill('SIGTERM')) {
        cleanup()
      }
    } catch {
      cleanup()
    }

    if (!isChildProcessRunning(child)) {
      cleanup()
    }
  })
}

const stopWorkspaceServiceChildren = () => {
  for (const service of services.values()) {
    const child = service.process
    if (isChildProcessRunning(child)) {
      child.kill('SIGTERM')
    }
  }
}

const registerWorkspaceServiceCleanup = () => {
  if (workspaceServiceCleanupRegistered) {
    return
  }
  workspaceServiceCleanupRegistered = true

  process.once('exit', stopWorkspaceServiceChildren)
  const forwardSignal = (signal: NodeJS.Signals) => {
    stopWorkspaceServiceChildren()
    process.kill(process.pid, signal)
  }
  process.once('SIGINT', () => forwardSignal('SIGINT'))
  process.once('SIGTERM', () => forwardSignal('SIGTERM'))
}

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

export const createLauncherWorkspaceId = (workspaceFolder: string) => (
  `w_${createHash('sha256').update(workspaceFolder).digest('base64url').slice(0, 22)}`
)

const normalizeClientBase = (value?: string) => {
  let base = value?.trim() ?? '/ui'
  if (base === '') {
    base = '/ui'
  }
  if (!base.startsWith('/')) {
    base = `/${base}`
  }
  if (base.length > 1 && base.endsWith('/')) {
    base = base.slice(0, -1)
  }
  return base
}

const normalizeWorkspaceId = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmedValue = value.trim()
  return /^w_[\w-]{8,64}$/u.test(trimmedValue) ? trimmedValue : undefined
}

export const createLauncherWorkspaceClientBase = (
  workspaceId: string,
  clientBase = process.env.__ONEWORKS_PROJECT_CLIENT_BASE__ ?? '/ui'
) => {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId)
  if (normalizedWorkspaceId == null) {
    throw new Error('Invalid workspace id')
  }

  const normalizedClientBase = normalizeClientBase(clientBase)
  const workspacePath = `w/${encodeURIComponent(normalizedWorkspaceId)}`
  return normalizedClientBase === '/'
    ? `/${workspacePath}`
    : `${normalizedClientBase}/${workspacePath}`
}

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
  workspaceId: createLauncherWorkspaceId(workspaceFolder),
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

const isPidRunning = (pid: unknown) => {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const readGitCommand = (cwd: string, args: string[]) => {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000
    }).trim()
  } catch {
    return undefined
  }
}

const readGitLargeCommand = (cwd: string, args: string[]) => {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000
    })
  } catch {
    return undefined
  }
}

const resolvePackageDir = () => (
  process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__ ?? resolve(process.cwd(), 'apps/server')
)

const resolveImplementationIdentity = (packageDir: string) => {
  const normalizedPackageDir = fs.realpathSync.native(packageDir)
  const repoRoot = readGitCommand(normalizedPackageDir, ['rev-parse', '--path-format=absolute', '--show-toplevel'])
  const head = repoRoot == null ? undefined : readGitCommand(repoRoot, ['rev-parse', 'HEAD'])
  if (repoRoot != null && head != null) {
    const status = readGitCommand(repoRoot, ['status', '--porcelain=v1'])
    const diff = status == null || status === ''
      ? ''
      : readGitLargeCommand(repoRoot, ['diff', '--binary', 'HEAD', '--'])
    const untracked = status == null || status === ''
      ? ''
      : readGitLargeCommand(repoRoot, ['ls-files', '--others', '--exclude-standard'])
    const dirtyHash = status == null || status === ''
      ? 'clean'
      : createHash('sha256').update(`${status}\n${diff ?? ''}\n${untracked ?? ''}`).digest('hex').slice(0, 12)
    return {
      implementationId: `git:${head}:${dirtyHash}`,
      repoRoot: fs.realpathSync.native(repoRoot)
    }
  }

  return {
    implementationId: `path:${normalizedPackageDir}`
  }
}

export const resolveLauncherWorkspaceInstanceIdentity = (
  workspaceFolder: string,
  input: {
    clientOrigin?: string
  } = {}
): LauncherWorkspaceInstanceIdentity => {
  const packageDir = fs.realpathSync.native(resolvePackageDir())
  const implementation = resolveImplementationIdentity(packageDir)
  const launchConfigHash = createHash('sha256')
    .update(JSON.stringify({
      clientBase: createLauncherWorkspaceClientBase(createLauncherWorkspaceId(workspaceFolder)),
      clientOrigin: input.clientOrigin ?? null,
      host: WORKSPACE_SERVER_HOST,
      workspaceFolder
    }))
    .digest('hex')
    .slice(0, 16)

  return {
    implementationId: implementation.implementationId,
    launchConfigHash,
    packageDir,
    ...(implementation.repoRoot == null ? {} : { repoRoot: implementation.repoRoot })
  }
}

const getWorkspaceInstanceStatePath = (workspaceFolder: string) => (
  resolveProjectHomePath(
    workspaceFolder,
    createWorkspaceRuntimeEnv(workspaceFolder, process.env),
    '.local',
    'server',
    'instance.json'
  )
)

const getWorkspaceInstanceLockPath = (workspaceFolder: string) => (
  resolveProjectHomePath(
    workspaceFolder,
    createWorkspaceRuntimeEnv(workspaceFolder, process.env),
    '.local',
    'server',
    'instance.lock'
  )
)

const readWorkspaceInstanceState = async (workspaceFolder: string) => {
  try {
    const raw = await readFile(getWorkspaceInstanceStatePath(workspaceFolder), 'utf8')
    const value = JSON.parse(raw) as unknown
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined
    return value as LauncherWorkspaceInstanceState
  } catch {
    return undefined
  }
}

const removeWorkspaceInstanceState = async (workspaceFolder: string) => {
  await rm(getWorkspaceInstanceStatePath(workspaceFolder), { force: true })
}

const removeWorkspaceInstanceStateForPid = async (workspaceFolder: string, pid?: number) => {
  if (!isPidRunning(pid)) {
    const state = await readWorkspaceInstanceState(workspaceFolder)
    if (state == null || state.pid === pid) {
      await removeWorkspaceInstanceState(workspaceFolder)
    }
    return
  }

  const state = await readWorkspaceInstanceState(workspaceFolder)
  if (state?.pid === pid) {
    await removeWorkspaceInstanceState(workspaceFolder)
  }
}

const writeWorkspaceInstanceState = async (
  workspaceFolder: string,
  state: LauncherWorkspaceInstanceState
) => {
  const statePath = getWorkspaceInstanceStatePath(workspaceFolder)
  await mkdir(path.dirname(statePath), { recursive: true })
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

const readWorkspaceInstanceLockOwner = async (lockPath: string) => {
  try {
    const raw = await readFile(path.join(lockPath, 'owner.json'), 'utf8')
    const value = JSON.parse(raw) as unknown
    return value != null && typeof value === 'object' && !Array.isArray(value)
      ? value as { pid?: unknown; startedAt?: unknown }
      : undefined
  } catch {
    return undefined
  }
}

const acquireWorkspaceInstanceLock = async (workspaceFolder: string) => {
  const lockPath = getWorkspaceInstanceLockPath(workspaceFolder)
  const startedAt = Date.now()

  await mkdir(path.dirname(lockPath), { recursive: true })

  while (Date.now() - startedAt < WORKSPACE_INSTANCE_LOCK_TIMEOUT_MS) {
    try {
      await mkdir(lockPath, { recursive: false })
      const ownerJson = JSON.stringify(
        {
          pid: process.pid,
          startedAt: Date.now()
        },
        null,
        2
      )
      await writeFile(path.join(lockPath, 'owner.json'), `${ownerJson}\n`)
      return async () => {
        await rm(lockPath, { recursive: true, force: true })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }

      const owner = await readWorkspaceInstanceLockOwner(lockPath)
      const lockStat = await stat(lockPath).catch(() => undefined)
      const ownerStartedAt = typeof owner?.startedAt === 'number' ? owner.startedAt : 0
      const lockStartedAt = ownerStartedAt > 0 ? ownerStartedAt : lockStat?.mtimeMs ?? Date.now()
      const lockAgeMs = Date.now() - lockStartedAt
      if (!isPidRunning(owner?.pid) && lockAgeMs > WORKSPACE_INSTANCE_LOCK_STALE_MS) {
        await rm(lockPath, { recursive: true, force: true })
        continue
      }
      await sleep(WORKSPACE_SERVER_READY_POLL_MS)
    }
  }

  throw conflict(
    'Workspace server startup is already in progress.',
    { workspaceFolder },
    'workspace_server_start_in_progress'
  )
}

const withWorkspaceInstanceLock = async <T>(
  workspaceFolder: string,
  fn: () => Promise<T>
) => {
  const release = await acquireWorkspaceInstanceLock(workspaceFolder)
  try {
    return await fn()
  } finally {
    await release()
  }
}

const isWorkspaceInstanceReady = async (state: LauncherWorkspaceInstanceState | undefined) => {
  if (state?.protocolVersion !== WORKSPACE_INSTANCE_PROTOCOL_VERSION) return false
  if (typeof state.serverBaseUrl !== 'string' || state.serverBaseUrl.trim() === '') return false
  if (!isPidRunning(state.pid)) return false

  try {
    const response = await fetch(`${state.serverBaseUrl}/api/auth/status`)
    return response.ok
  } catch {
    return false
  }
}

const assertCompatibleWorkspaceInstance = (
  workspaceFolder: string,
  state: LauncherWorkspaceInstanceIdentity & {
    pid?: number
    serverBaseUrl?: string
    startedAt?: string
    workspaceFolder: string
  },
  identity: LauncherWorkspaceInstanceIdentity
) => {
  if (
    state.workspaceFolder === workspaceFolder &&
    state.implementationId === identity.implementationId &&
    state.launchConfigHash === identity.launchConfigHash
  ) {
    return
  }

  throw conflict(
    'Workspace is already served by a different One Works version.',
    {
      existing: {
        implementationId: state.implementationId,
        launchConfigHash: state.launchConfigHash,
        packageDir: state.packageDir,
        pid: state.pid,
        repoRoot: state.repoRoot,
        serverBaseUrl: state.serverBaseUrl,
        startedAt: state.startedAt,
        workspaceFolder: state.workspaceFolder
      },
      requested: {
        implementationId: identity.implementationId,
        launchConfigHash: identity.launchConfigHash,
        packageDir: identity.packageDir,
        repoRoot: identity.repoRoot,
        workspaceFolder
      },
      workspaceFolder
    },
    'workspace_server_version_conflict'
  )
}

const getReusableWorkspaceInstanceService = async (
  workspaceFolder: string,
  identity: LauncherWorkspaceInstanceIdentity
) => {
  const state = await readWorkspaceInstanceState(workspaceFolder)
  if (state == null) return undefined

  if (!await isWorkspaceInstanceReady(state)) {
    await removeWorkspaceInstanceState(workspaceFolder)
    return undefined
  }

  assertCompatibleWorkspaceInstance(workspaceFolder, state, identity)
  await rememberRecentWorkspace(workspaceFolder)
  return {
    identity,
    serverBaseUrl: state.serverBaseUrl,
    status: 'ready',
    workspaceFolder
  } satisfies LauncherWorkspaceService
}

const getProcessWorkspaceService = async (
  workspaceFolder: string,
  service: LauncherWorkspaceService,
  identity: LauncherWorkspaceInstanceIdentity
) => {
  if (service.identity != null) {
    assertCompatibleWorkspaceInstance(workspaceFolder, {
      ...service.identity,
      pid: service.process?.pid,
      serverBaseUrl: service.serverBaseUrl,
      workspaceFolder
    }, identity)
  }

  if (service.startPromise != null) {
    return await service.startPromise
  }
  if (service.status === 'ready' && service.serverBaseUrl != null) {
    await rememberRecentWorkspace(workspaceFolder)
    return service
  }
  services.delete(workspaceFolder)
  return undefined
}

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
  const packageDir = resolvePackageDir()
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
  const workspaceId = createLauncherWorkspaceId(workspaceFolder)
  env.__ONEWORKS_PROJECT_CLIENT_BASE__ = createLauncherWorkspaceClientBase(workspaceId)
  env.__ONEWORKS_PROJECT_WORKSPACE_ID__ = workspaceId
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
  },
  identity: LauncherWorkspaceInstanceIdentity
) => {
  const port = await getAvailablePort()
  if (service.stopRequested === true) {
    throw new Error('Workspace server startup was canceled.')
  }
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
  registerWorkspaceServiceCleanup()
  service.process = child
  child.stdout?.on('data', data => writePrefixedChunk(`[oneworks-workspace:${service.workspaceFolder}] `, data))
  child.stderr?.on('data', data => writePrefixedChunk(`[oneworks-workspace:${service.workspaceFolder}] `, data))
  child.once('exit', (code, signal) => {
    if (services.get(service.workspaceFolder) === service) {
      services.delete(service.workspaceFolder)
    }
    void removeWorkspaceInstanceStateForPid(service.workspaceFolder, child.pid)
    service.status = 'stopped'
    logger.info(
      `[launcher] workspace server exited workspace=${service.workspaceFolder} code=${code ?? 'null'} signal=${
        signal ?? 'null'
      }`
    )
  })

  await waitForServerReady(service)
  service.status = 'ready'
  service.stopRequested = false
  await writeWorkspaceInstanceState(service.workspaceFolder, {
    ...identity,
    pid: child.pid,
    protocolVersion: WORKSPACE_INSTANCE_PROTOCOL_VERSION,
    serverBaseUrl: service.serverBaseUrl,
    startedAt: new Date().toISOString(),
    workspaceFolder: service.workspaceFolder
  })
  await rememberRecentWorkspace(service.workspaceFolder)
  return service
}

const ensureWorkspaceService = async (
  workspaceFolder: string,
  input: {
    clientOrigin?: string
  }
) => {
  const identity = resolveLauncherWorkspaceInstanceIdentity(workspaceFolder, input)
  const existingService = services.get(workspaceFolder)
  if (existingService != null) {
    const service = await getProcessWorkspaceService(workspaceFolder, existingService, identity)
    if (service != null) return service
  }

  return await withWorkspaceInstanceLock(workspaceFolder, async () => {
    const lockedExistingService = services.get(workspaceFolder)
    if (lockedExistingService != null) {
      const service = await getProcessWorkspaceService(workspaceFolder, lockedExistingService, identity)
      if (service != null) return service
    }

    const reusableService = await getReusableWorkspaceInstanceService(workspaceFolder, identity)
    if (reusableService != null) return reusableService

    const service: LauncherWorkspaceService = {
      identity,
      status: 'starting',
      workspaceFolder
    }
    services.set(workspaceFolder, service)
    service.startPromise = startWorkspaceService(service, input, identity)
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
  })
}

const stopLauncherWorkspaceService = async (service: LauncherWorkspaceService) => {
  if (service.stopPromise != null) {
    await service.stopPromise
    return
  }

  service.status = 'stopping'
  service.stopRequested = true
  service.startPromise?.catch(() => undefined)
  service.stopPromise = (async () => {
    if (service.process == null && service.startPromise != null) {
      await Promise.race([
        service.startPromise.catch(() => undefined),
        sleep(WORKSPACE_SERVER_READY_POLL_MS)
      ])
    }

    await killChildProcess(service.process)
    if (services.get(service.workspaceFolder) === service) {
      services.delete(service.workspaceFolder)
    }
    service.status = 'stopped'
  })()
    .finally(() => {
      service.stopPromise = undefined
    })

  await service.stopPromise
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

const resolveLauncherWorkspaceFolderById = async (rawWorkspaceId: unknown) => {
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId)
  if (workspaceId == null) {
    throw badRequest('A valid workspace id is required.', { workspaceId: rawWorkspaceId }, 'invalid_workspace_id')
  }

  for (const service of services.values()) {
    if (createLauncherWorkspaceId(service.workspaceFolder) === workspaceId) {
      return service.workspaceFolder
    }
  }

  return (await getRecentWorkspaces())
    .find(workspaceFolder => createLauncherWorkspaceId(workspaceFolder) === workspaceId)
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
    if (isHttpError(error)) throw error
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
    workspaceId: createLauncherWorkspaceId(workspaceFolder),
    workspaceFolder
  }
}

export const openLauncherWorkspaceById = async (
  rawWorkspaceId: unknown,
  input: {
    clientOrigin?: string
  } = {}
): Promise<LauncherWorkspaceOpenResponse> => {
  const workspaceFolder = await resolveLauncherWorkspaceFolderById(rawWorkspaceId)
  if (workspaceFolder == null) {
    throw notFound('Workspace not found.', { workspaceId: rawWorkspaceId }, 'workspace_not_found')
  }

  return await openLauncherWorkspace(workspaceFolder, input)
}

export const forgetLauncherWorkspace = async (rawWorkspaceFolder: unknown) => {
  const workspaceFolder = normalizePathForRemoval(rawWorkspaceFolder)
  if (workspaceFolder == null) {
    throw badRequest('A workspace folder is required.', { workspaceFolder: rawWorkspaceFolder })
  }

  await removeRecentWorkspace(workspaceFolder)
  return { ok: true, workspaceFolder }
}

export const stopLauncherWorkspace = async (
  rawWorkspaceFolder: unknown,
  input: {
    forget?: boolean
  } = {}
): Promise<LauncherWorkspaceStopResponse> => {
  const workspaceFolder = normalizePathForRemoval(rawWorkspaceFolder)
  if (workspaceFolder == null) {
    throw badRequest('A workspace folder is required.', { workspaceFolder: rawWorkspaceFolder })
  }

  const service = services.get(workspaceFolder)
  const stopped = service != null
  if (service != null) {
    await stopLauncherWorkspaceService(service)
  }

  const removed = input.forget === true
  if (removed) {
    await removeRecentWorkspace(workspaceFolder)
  } else if (stopped) {
    await rememberRecentWorkspace(workspaceFolder)
  }

  return {
    ok: true,
    removed,
    stopped,
    workspaceFolder
  }
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

  await mkdir(workspaceFolder, { recursive: false }).catch(() => {
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
