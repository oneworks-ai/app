/* eslint-disable max-lines */

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { env as processEnv, platform as processPlatform } from 'node:process'

import { resolvePrimaryWorkspaceFolder } from '@oneworks/register/dotenv'
import type {
  WorktreeEnvironmentDetail,
  WorktreeEnvironmentListResult,
  WorktreeEnvironmentOperation,
  WorktreeEnvironmentPlatform,
  WorktreeEnvironmentSavePayload,
  WorktreeEnvironmentScript,
  WorktreeEnvironmentScriptKey,
  WorktreeEnvironmentSource,
  WorktreeEnvironmentSummary
} from '@oneworks/types'
import { PROJECT_OO_BASE_DIR_ENV, PROJECT_WORKSPACE_FOLDER_ENV, resolveProjectOoPath } from '@oneworks/utils'

import { getWorkspaceFolder, loadConfigState } from '#~/services/config/index.js'

const SCRIPT_TIMEOUT_MS = 10 * 60 * 1000
const SCRIPT_MAX_BUFFER = 1024 * 1024
const ENVIRONMENT_ID_PATTERN = /^\w[\w.-]{0,127}$/
const LOCAL_ENVIRONMENT_SUFFIX = '.local'
const LOCAL_ENVIRONMENT_ROOT = 'env.local'
const LOCAL_ENVIRONMENT_GITIGNORE_ENTRY = `.oo/${LOCAL_ENVIRONMENT_ROOT}/`

const scriptDefinitions: Array<Omit<WorktreeEnvironmentScript, 'exists' | 'content'>> = [
  { key: 'create', operation: 'create', platform: 'base', fileName: 'create.sh' },
  { key: 'create.macos', operation: 'create', platform: 'macos', fileName: 'create.macos.sh' },
  { key: 'create.linux', operation: 'create', platform: 'linux', fileName: 'create.linux.sh' },
  { key: 'create.windows', operation: 'create', platform: 'windows', fileName: 'create.windows.ps1' },
  { key: 'start', operation: 'start', platform: 'base', fileName: 'start.sh' },
  { key: 'start.macos', operation: 'start', platform: 'macos', fileName: 'start.macos.sh' },
  { key: 'start.linux', operation: 'start', platform: 'linux', fileName: 'start.linux.sh' },
  { key: 'start.windows', operation: 'start', platform: 'windows', fileName: 'start.windows.ps1' },
  { key: 'destroy', operation: 'destroy', platform: 'base', fileName: 'destroy.sh' },
  { key: 'destroy.macos', operation: 'destroy', platform: 'macos', fileName: 'destroy.macos.sh' },
  { key: 'destroy.linux', operation: 'destroy', platform: 'linux', fileName: 'destroy.linux.sh' },
  { key: 'destroy.windows', operation: 'destroy', platform: 'windows', fileName: 'destroy.windows.ps1' }
]

interface ScriptRunResult {
  environmentId: string
  scriptPath: string
  stdout: string
  stderr: string
}

export interface WorktreeEnvironmentScriptRunProgress {
  operation: WorktreeEnvironmentOperation
  status: 'running' | 'success' | 'error' | 'skipped'
  environmentId?: string
  scriptPath?: string
  scriptFileName?: string
  message?: string
  stream?: 'stdout' | 'stderr'
  output?: string
}

interface RunConfiguredWorktreeEnvironmentScriptsOptions {
  operation: WorktreeEnvironmentOperation
  workspaceFolder: string
  sessionId?: string
  environmentId?: string
  sourceWorkspaceFolder?: string
  repositoryRoot?: string
  baseRef?: string
  force?: boolean
  signal?: AbortSignal
  onProgress?: (progress: WorktreeEnvironmentScriptRunProgress) => void | Promise<void>
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

const emitScriptProgress = async (
  options: RunConfiguredWorktreeEnvironmentScriptsOptions,
  progress: WorktreeEnvironmentScriptRunProgress
) => {
  try {
    await options.onProgress?.(progress)
  } catch (error) {
    console.error('[worktree-environments] Failed to emit environment script progress:', error)
  }
}

const resolveAbortReason = (signal: AbortSignal | undefined, fallbackMessage: string) => {
  if (signal?.reason instanceof Error) {
    return signal.reason
  }
  return new Error(fallbackMessage)
}

const throwIfAborted = (signal: AbortSignal | undefined, fallbackMessage: string) => {
  if (signal?.aborted === true) {
    throw resolveAbortReason(signal, fallbackMessage)
  }
}

const getCurrentPlatform = (): WorktreeEnvironmentPlatform | undefined => {
  if (processPlatform === 'darwin') return 'macos'
  if (processPlatform === 'linux') return 'linux'
  if (processPlatform === 'win32') return 'windows'
  return undefined
}

const resolvePrimaryWorkspace = (workspaceFolder: string) => (
  resolvePrimaryWorkspaceFolder(workspaceFolder) ?? workspaceFolder
)

const resolvePrimaryWorkspaceEnv = (workspaceFolder: string) => ({
  ...processEnv,
  [PROJECT_WORKSPACE_FOLDER_ENV]: workspaceFolder
})

const isLocalEnvironmentId = (id: string) => id.endsWith(LOCAL_ENVIRONMENT_SUFFIX)

const getEnvironmentSource = (id: string) => (
  isLocalEnvironmentId(id) ? 'user' : 'project'
)

const assertEnvironmentId = (id: string) => {
  const normalized = id.trim()
  if (!ENVIRONMENT_ID_PATTERN.test(normalized)) {
    throw new Error(`Invalid worktree environment id: ${id}`)
  }
  return normalized
}

export const normalizeOptionalWorktreeEnvironmentId = (id: string | undefined) => {
  const normalized = id?.trim()
  if (normalized == null || normalized === '') return undefined
  return assertEnvironmentId(normalized)
}

const normalizeEnvironmentIdForSource = (id: string, source: WorktreeEnvironmentSource) => {
  const environmentId = assertEnvironmentId(id)
  if (source === 'user' && isLocalEnvironmentId(environmentId)) {
    return environmentId.slice(0, -LOCAL_ENVIRONMENT_SUFFIX.length)
  }
  return environmentId
}

const getEnvironmentSourceFromOptions = (
  id: string,
  source?: WorktreeEnvironmentSource
): WorktreeEnvironmentSource => source ?? getEnvironmentSource(id)

export const resolveWorktreeEnvironmentRoot = (
  workspaceFolder = getWorkspaceFolder(),
  source: WorktreeEnvironmentSource = 'project'
) => {
  const primaryWorkspaceFolder = resolvePrimaryWorkspace(workspaceFolder)
  return resolveProjectOoPath(
    primaryWorkspaceFolder,
    resolvePrimaryWorkspaceEnv(primaryWorkspaceFolder),
    source === 'user' ? LOCAL_ENVIRONMENT_ROOT : 'env'
  )
}

const resolveWorktreeEnvironmentDirectory = (
  id: string,
  workspaceFolder = getWorkspaceFolder(),
  source: WorktreeEnvironmentSource = getEnvironmentSource(id)
) => (
  join(resolveWorktreeEnvironmentRoot(workspaceFolder, source), normalizeEnvironmentIdForSource(id, source))
)

const resolveWorkspaceProjectWorktreeEnvironmentDirectory = (
  id: string,
  workspaceFolder = getWorkspaceFolder()
) => (
  join(
    resolveProjectOoPath(
      workspaceFolder,
      {
        [PROJECT_WORKSPACE_FOLDER_ENV]: workspaceFolder,
        ...(processEnv[PROJECT_OO_BASE_DIR_ENV] != null
          ? { [PROJECT_OO_BASE_DIR_ENV]: processEnv[PROJECT_OO_BASE_DIR_ENV] }
          : {})
      },
      'env'
    ),
    normalizeEnvironmentIdForSource(id, 'project')
  )
)

const resolveLegacyLocalWorktreeEnvironmentDirectory = (
  id: string,
  workspaceFolder = getWorkspaceFolder()
) => (
  join(
    resolveWorktreeEnvironmentRoot(workspaceFolder, 'project'),
    `${normalizeEnvironmentIdForSource(id, 'user')}${LOCAL_ENVIRONMENT_SUFFIX}`
  )
)

const pathExists = async (path: string) => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const isDirectory = async (path: string) => {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

const resolveExistingEnvironmentDirectory = async (
  id: string,
  workspaceFolder: string,
  source?: WorktreeEnvironmentSource
) => {
  const requestedSource = getEnvironmentSourceFromOptions(id, source)
  const environmentId = normalizeEnvironmentIdForSource(id, requestedSource)
  const primaryDirectory = resolveWorktreeEnvironmentDirectory(environmentId, workspaceFolder, requestedSource)
  if (await isDirectory(primaryDirectory)) {
    return {
      environmentId,
      source: requestedSource,
      directory: primaryDirectory
    }
  }

  if (requestedSource === 'project') {
    const workspaceDirectory = resolveWorkspaceProjectWorktreeEnvironmentDirectory(environmentId, workspaceFolder)
    if (await isDirectory(workspaceDirectory)) {
      return {
        environmentId,
        source: requestedSource,
        directory: workspaceDirectory
      }
    }
  }

  if (requestedSource === 'user') {
    const legacyDirectory = resolveLegacyLocalWorktreeEnvironmentDirectory(environmentId, workspaceFolder)
    if (await isDirectory(legacyDirectory)) {
      return {
        environmentId,
        source: requestedSource,
        directory: legacyDirectory
      }
    }
  }

  if (source != null) {
    return {
      environmentId,
      source: requestedSource,
      directory: primaryDirectory
    }
  }

  const localDirectory = resolveWorktreeEnvironmentDirectory(environmentId, workspaceFolder, 'user')
  if (await isDirectory(localDirectory)) {
    return {
      environmentId,
      source: 'user' as const,
      directory: localDirectory
    }
  }

  const legacyDirectory = resolveLegacyLocalWorktreeEnvironmentDirectory(environmentId, workspaceFolder)
  if (await isDirectory(legacyDirectory)) {
    return {
      environmentId,
      source: 'user' as const,
      directory: legacyDirectory
    }
  }

  return {
    environmentId,
    source: 'project' as const,
    directory: primaryDirectory
  }
}

const readScriptContent = async (
  environmentDirectory: string,
  definition: Omit<WorktreeEnvironmentScript, 'exists'>
) => {
  for (const fileName of getScriptReadFileNames(definition)) {
    const primaryPath = join(environmentDirectory, fileName)
    if (!await pathExists(primaryPath)) {
      continue
    }
    return {
      exists: true,
      content: await readFile(primaryPath, 'utf8')
    }
  }

  return {
    exists: false,
    content: ''
  }
}

const readEnvironmentScripts = async (
  environmentDirectory: string,
  includeContent: boolean
): Promise<WorktreeEnvironmentScript[]> => {
  const scripts: WorktreeEnvironmentScript[] = []
  for (const definition of scriptDefinitions) {
    const script = await readScriptContent(environmentDirectory, definition)
    scripts.push({
      ...definition,
      exists: script.exists,
      ...(includeContent ? { content: script.content } : {})
    })
  }
  return scripts
}

const readEnvironment = async (
  id: string,
  workspaceFolder: string,
  includeContent: boolean,
  source?: WorktreeEnvironmentSource
): Promise<WorktreeEnvironmentDetail | WorktreeEnvironmentSummary> => {
  const location = await resolveExistingEnvironmentDirectory(id, workspaceFolder, source)
  return {
    id: location.environmentId,
    path: location.directory,
    source: location.source,
    isLocal: location.source === 'user',
    scripts: await readEnvironmentScripts(location.directory, includeContent)
  }
}

export const listWorktreeEnvironments = async (
  workspaceFolder = getWorkspaceFolder()
): Promise<WorktreeEnvironmentListResult> => {
  const environments: WorktreeEnvironmentSummary[] = []

  const projectRoot = resolveWorktreeEnvironmentRoot(workspaceFolder, 'project')
  if (await isDirectory(projectRoot)) {
    const entries = await readdir(projectRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!ENVIRONMENT_ID_PATTERN.test(entry.name)) continue
      if (isLocalEnvironmentId(entry.name)) {
        environments.push(
          await readEnvironment(
            entry.name.slice(0, -LOCAL_ENVIRONMENT_SUFFIX.length),
            workspaceFolder,
            false,
            'user'
          ) as WorktreeEnvironmentSummary
        )
        continue
      }
      environments.push(
        await readEnvironment(entry.name, workspaceFolder, false, 'project') as WorktreeEnvironmentSummary
      )
    }
  }

  const localRoot = resolveWorktreeEnvironmentRoot(workspaceFolder, 'user')
  if (await isDirectory(localRoot)) {
    const existingLocalIds = new Set(
      environments.filter(environment => environment.source === 'user').map(environment => environment.id)
    )
    const entries = await readdir(localRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!ENVIRONMENT_ID_PATTERN.test(entry.name)) continue
      if (existingLocalIds.has(entry.name)) continue
      environments.push(await readEnvironment(entry.name, workspaceFolder, false, 'user') as WorktreeEnvironmentSummary)
    }
  }

  environments.sort((left, right) => left.source.localeCompare(right.source) || left.id.localeCompare(right.id))
  return {
    environments
  }
}

export const getWorktreeEnvironment = async (
  id: string,
  workspaceFolder = getWorkspaceFolder(),
  source?: WorktreeEnvironmentSource
): Promise<WorktreeEnvironmentDetail> => {
  const location = await resolveExistingEnvironmentDirectory(id, workspaceFolder, source)
  if (!await isDirectory(location.directory)) {
    throw new Error(`Worktree environment not found: ${location.environmentId}`)
  }
  return await readEnvironment(
    location.environmentId,
    workspaceFolder,
    true,
    location.source
  ) as WorktreeEnvironmentDetail
}

const normalizeScriptContent = (content: string) => (
  content === '' || content.endsWith('\n') ? content : `${content}\n`
)

const ensureLocalEnvironmentGitIgnore = async (workspaceFolder: string) => {
  const root = resolvePrimaryWorkspace(workspaceFolder)
  const gitignorePath = join(root, '.gitignore')
  const entry = LOCAL_ENVIRONMENT_GITIGNORE_ENTRY
  let content = ''
  try {
    content = await readFile(gitignorePath, 'utf8')
  } catch {
    content = ''
  }

  const lines = content.split(/\r?\n/)
  if (lines.includes(entry)) return

  const nextContent = [
    content.trimEnd(),
    entry
  ].filter(Boolean).join('\n')
  await writeFile(gitignorePath, `${nextContent}\n`, 'utf8')
}

const uniqueStrings = (values: string[]) => Array.from(new Set(values))

const getScriptReadFileNames = (definition: Omit<WorktreeEnvironmentScript, 'exists' | 'content'>) => {
  const names = [definition.fileName]
  if (definition.operation === 'destroy') {
    names.push(definition.fileName.replace(/^destroy/, 'destory'))
  }
  if (definition.platform === 'windows') {
    const prefix = `${definition.operation}.windows`
    names.push(`${prefix}.cmd`, `${prefix}.bat`)
    if (definition.operation === 'destroy') {
      names.push('destory.windows.cmd', 'destory.windows.bat', 'destory.windows.ps1')
    }
  }
  return uniqueStrings(names)
}

export const saveWorktreeEnvironment = async (
  id: string,
  payload: WorktreeEnvironmentSavePayload = {},
  workspaceFolder = getWorkspaceFolder(),
  source?: WorktreeEnvironmentSource
): Promise<WorktreeEnvironmentDetail> => {
  const requestedSource = getEnvironmentSourceFromOptions(id, source)
  const environmentId = normalizeEnvironmentIdForSource(id, requestedSource)
  const environmentRoot = resolveWorktreeEnvironmentRoot(workspaceFolder, requestedSource)
  const environmentDirectory = join(environmentRoot, environmentId)
  await mkdir(environmentDirectory, { recursive: true })
  if (requestedSource === 'user') {
    await ensureLocalEnvironmentGitIgnore(workspaceFolder)
  }

  const scripts = isRecord(payload.scripts) ? payload.scripts : {}
  for (const definition of scriptDefinitions) {
    const nextContent = scripts[definition.key as WorktreeEnvironmentScriptKey]
    if (typeof nextContent !== 'string') continue
    const scriptPath = join(environmentDirectory, definition.fileName)
    if (nextContent === '') {
      await Promise.all(
        getScriptReadFileNames(definition).map(fileName => rm(join(environmentDirectory, fileName), { force: true }))
      )
      continue
    }
    await writeFile(scriptPath, normalizeScriptContent(nextContent), 'utf8')
    await chmod(scriptPath, 0o755)
    await Promise.all(
      getScriptReadFileNames(definition)
        .filter(fileName => fileName !== definition.fileName)
        .map(fileName => rm(join(environmentDirectory, fileName), { force: true }))
    )
  }

  return getWorktreeEnvironment(environmentId, workspaceFolder, requestedSource)
}

export const deleteWorktreeEnvironment = async (
  id: string,
  workspaceFolder = getWorkspaceFolder(),
  source?: WorktreeEnvironmentSource
) => {
  const requestedSource = getEnvironmentSourceFromOptions(id, source)
  const environmentId = normalizeEnvironmentIdForSource(id, requestedSource)
  const environmentDirectory = resolveWorktreeEnvironmentDirectory(environmentId, workspaceFolder, requestedSource)
  const legacyDirectory = resolveLegacyLocalWorktreeEnvironmentDirectory(environmentId, workspaceFolder)
  const existed = await isDirectory(environmentDirectory) ||
    (requestedSource === 'user' && await isDirectory(legacyDirectory))
  await rm(environmentDirectory, { recursive: true, force: true })
  if (requestedSource === 'user') {
    await rm(legacyDirectory, {
      recursive: true,
      force: true
    })
  }
  return existed
}

const readConfiguredEnvironmentId = async (workspaceFolder: string) => {
  const configState = await loadConfigState(workspaceFolder).catch(() => undefined)
  return normalizeOptionalWorktreeEnvironmentId(configState?.mergedConfig.conversation?.worktreeEnvironment)
}

const resolveConfiguredEnvironmentId = async (workspaceFolder: string, fallbackWorkspaceFolder?: string) => {
  const environmentId = await readConfiguredEnvironmentId(workspaceFolder)
  if (environmentId != null) return environmentId

  if (fallbackWorkspaceFolder != null && resolve(fallbackWorkspaceFolder) !== resolve(workspaceFolder)) {
    const fallbackEnvironmentId = await readConfiguredEnvironmentId(fallbackWorkspaceFolder)
    if (fallbackEnvironmentId != null) return fallbackEnvironmentId
  }

  const serverWorkspaceFolder = getWorkspaceFolder()
  if (resolve(serverWorkspaceFolder) !== resolve(workspaceFolder)) {
    return await readConfiguredEnvironmentId(serverWorkspaceFolder)
  }

  return undefined
}

const resolveFirstExistingScriptPath = async (environmentDirectory: string, fileNames: string[]) => {
  for (const fileName of fileNames) {
    const scriptPath = join(environmentDirectory, fileName)
    if (await pathExists(scriptPath)) {
      return scriptPath
    }
  }
  return undefined
}

const getOperationScriptFileNames = (
  operation: WorktreeEnvironmentOperation,
  platform: WorktreeEnvironmentPlatform | undefined
) => {
  const base = platform === 'windows'
    ? operation === 'destroy'
      ? [
        'destroy.ps1',
        'destory.ps1',
        'destroy.cmd',
        'destory.cmd',
        'destroy.bat',
        'destory.bat'
      ]
      : [`${operation}.ps1`, `${operation}.cmd`, `${operation}.bat`]
    : operation === 'destroy'
    ? ['destroy.sh', 'destory.sh']
    : [`${operation}.sh`]
  const platformSpecific = platform == null
    ? []
    : platform === 'windows'
    ? operation === 'destroy'
      ? [
        'destroy.windows.ps1',
        'destory.windows.ps1',
        'destroy.windows.cmd',
        'destory.windows.cmd',
        'destroy.windows.bat',
        'destory.windows.bat'
      ]
      : [`${operation}.windows.ps1`, `${operation}.windows.cmd`, `${operation}.windows.bat`]
    : operation === 'destroy'
    ? [`destroy.${platform}.sh`, `destory.${platform}.sh`]
    : [`${operation}.${platform}.sh`]

  return {
    base,
    platformSpecific
  }
}

const resolveOperationScriptPaths = async (
  environmentDirectory: string,
  operation: WorktreeEnvironmentOperation
) => {
  const platform = getCurrentPlatform()
  const fileNames = getOperationScriptFileNames(operation, platform)
  const paths = [
    await resolveFirstExistingScriptPath(environmentDirectory, fileNames.base),
    await resolveFirstExistingScriptPath(environmentDirectory, fileNames.platformSpecific)
  ].filter((path): path is string => path != null)

  return paths
}

const resolveScriptCommand = (scriptPath: string) => {
  const extension = extname(scriptPath).toLowerCase()
  if (extension === '.ps1') {
    return {
      command: processPlatform === 'win32' ? 'powershell.exe' : 'pwsh',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath
      ]
    }
  }

  if (extension === '.cmd' || extension === '.bat') {
    return {
      command: processEnv.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', `"${scriptPath}"`]
    }
  }

  return {
    command: 'sh',
    args: [scriptPath]
  }
}

const runShellScript = async (
  scriptPath: string,
  options: RunConfiguredWorktreeEnvironmentScriptsOptions & { environmentId: string }
): Promise<ScriptRunResult> => {
  throwIfAborted(options.signal, 'Worktree environment script cancelled')

  const scriptFileName = basename(scriptPath)
  const childEnv: NodeJS.ProcessEnv = {
    ...processEnv,
    ONEWORKS_WORKTREE_ENV: options.environmentId,
    ONEWORKS_WORKTREE_OPERATION: options.operation,
    ONEWORKS_WORKTREE_PATH: options.workspaceFolder,
    ONEWORKS_WORKTREE_FORCE: options.force === true ? 'true' : 'false'
  }
  if (isNonEmptyString(options.sessionId)) {
    childEnv.ONEWORKS_SESSION_ID = options.sessionId.trim()
  }
  if (isNonEmptyString(options.sourceWorkspaceFolder)) {
    childEnv.ONEWORKS_WORKTREE_SOURCE_PATH = options.sourceWorkspaceFolder.trim()
  }
  if (isNonEmptyString(options.repositoryRoot)) {
    childEnv.ONEWORKS_REPOSITORY_ROOT = options.repositoryRoot.trim()
  }
  if (isNonEmptyString(options.baseRef)) {
    childEnv.ONEWORKS_WORKTREE_BASE_REF = options.baseRef.trim()
  }

  try {
    const scriptCommand = resolveScriptCommand(scriptPath)
    return await new Promise<ScriptRunResult>((resolvePromise, reject) => {
      throwIfAborted(options.signal, 'Worktree environment script cancelled')

      const child = spawn(
        scriptCommand.command,
        scriptCommand.args,
        {
          cwd: options.workspaceFolder,
          env: childEnv
        }
      )
      let stdout = ''
      let stderr = ''
      let settled = false
      let progressQueue = Promise.resolve()
      let timeout: NodeJS.Timeout | undefined
      const abortScript = () => {
        child.kill()
        settle(resolveAbortReason(options.signal, 'Worktree environment script cancelled'))
      }
      const queueOutputProgress = (stream: 'stdout' | 'stderr', output: string) => {
        if (output === '') {
          return
        }

        progressQueue = progressQueue.then(() =>
          emitScriptProgress(options, {
            operation: options.operation,
            status: 'running',
            environmentId: options.environmentId,
            scriptPath,
            scriptFileName,
            stream,
            output
          })
        )
      }
      const settle = (error?: Error, exitCode?: number | null, signal?: NodeJS.Signals | null) => {
        if (settled) {
          return
        }

        settled = true
        if (timeout != null) {
          clearTimeout(timeout)
        }
        options.signal?.removeEventListener('abort', abortScript)
        progressQueue
          .then(() => {
            if (error != null) {
              reject(Object.assign(error, { stdout, stderr, scriptPath }))
              return
            }

            if (exitCode !== 0) {
              const exitMessage = signal != null
                ? `Script exited with signal ${signal}`
                : `Script exited with code ${exitCode ?? 1}`
              reject(Object.assign(new Error(exitMessage), { stdout, stderr, scriptPath }))
              return
            }

            resolvePromise({
              environmentId: options.environmentId,
              scriptPath,
              stdout,
              stderr
            })
          })
          .catch((progressError: unknown) => {
            reject(Object.assign(progressError instanceof Error ? progressError : new Error(String(progressError)), {
              stdout,
              stderr,
              scriptPath
            }))
          })
      }
      timeout = setTimeout(() => {
        child.kill()
        settle(new Error(`Script timed out after ${SCRIPT_TIMEOUT_MS}ms`))
      }, SCRIPT_TIMEOUT_MS)
      if (options.signal?.aborted === true) {
        abortScript()
      } else {
        options.signal?.addEventListener('abort', abortScript, { once: true })
      }
      const appendOutput = (stream: 'stdout' | 'stderr', chunk: Buffer | string) => {
        const output = String(chunk)
        if (stream === 'stdout') {
          stdout += output
          if (Buffer.byteLength(stdout, 'utf8') > SCRIPT_MAX_BUFFER) {
            child.kill()
            settle(new Error(`stdout exceeded ${SCRIPT_MAX_BUFFER} bytes`))
            return
          }
        } else {
          stderr += output
          if (Buffer.byteLength(stderr, 'utf8') > SCRIPT_MAX_BUFFER) {
            child.kill()
            settle(new Error(`stderr exceeded ${SCRIPT_MAX_BUFFER} bytes`))
            return
          }
        }

        queueOutputProgress(stream, output)
      }

      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', chunk => appendOutput('stdout', chunk))
      child.stderr?.on('data', chunk => appendOutput('stderr', chunk))
      child.on('error', error => settle(error))
      child.on('close', (exitCode, signal) => settle(undefined, exitCode, signal))
    })
  } catch (error) {
    if (options.signal?.aborted === true) {
      throw resolveAbortReason(options.signal, 'Worktree environment script cancelled')
    }
    const scriptError = error as Error & { stdout?: string; stderr?: string }
    const details = [
      scriptError.message,
      scriptError.stderr?.trim(),
      scriptError.stdout?.trim()
    ].filter(Boolean).join('\n')
    throw new Error(`Worktree environment script failed: ${scriptPath}${details !== '' ? `\n${details}` : ''}`)
  }
}

export const runConfiguredWorktreeEnvironmentScripts = async (
  options: RunConfiguredWorktreeEnvironmentScriptsOptions
): Promise<ScriptRunResult[]> => {
  throwIfAborted(options.signal, 'Worktree environment script cancelled')

  const environmentId = normalizeOptionalWorktreeEnvironmentId(options.environmentId) ??
    await resolveConfiguredEnvironmentId(options.workspaceFolder, options.sourceWorkspaceFolder)
  throwIfAborted(options.signal, 'Worktree environment script cancelled')
  if (environmentId == null) {
    await emitScriptProgress(options, {
      operation: options.operation,
      status: 'skipped',
      message: 'No worktree environment configured'
    })
    return []
  }

  const environmentWorkspaceFolder = options.sourceWorkspaceFolder ?? options.workspaceFolder
  const location = await resolveExistingEnvironmentDirectory(environmentId, environmentWorkspaceFolder)
  throwIfAborted(options.signal, 'Worktree environment script cancelled')
  if (!await isDirectory(location.directory)) {
    await emitScriptProgress(options, {
      operation: options.operation,
      status: 'error',
      environmentId,
      message: `Worktree environment not found: ${environmentId}`
    })
    throw new Error(`Worktree environment not found: ${environmentId}`)
  }

  const scriptPaths = await resolveOperationScriptPaths(location.directory, options.operation)
  throwIfAborted(options.signal, 'Worktree environment script cancelled')
  if (scriptPaths.length === 0) {
    await emitScriptProgress(options, {
      operation: options.operation,
      status: 'skipped',
      environmentId,
      message: `No ${options.operation} script configured for worktree environment: ${environmentId}`
    })
    return []
  }

  const results: ScriptRunResult[] = []
  for (const scriptPath of scriptPaths) {
    throwIfAborted(options.signal, 'Worktree environment script cancelled')
    const scriptFileName = basename(scriptPath)
    await emitScriptProgress(options, {
      operation: options.operation,
      status: 'running',
      environmentId,
      scriptPath,
      scriptFileName
    })

    try {
      const result = await runShellScript(scriptPath, {
        ...options,
        environmentId
      })
      await emitScriptProgress(options, {
        operation: options.operation,
        status: 'success',
        environmentId,
        scriptPath,
        scriptFileName
      })
      results.push(result)
    } catch (error) {
      await emitScriptProgress(options, {
        operation: options.operation,
        status: 'error',
        environmentId,
        scriptPath,
        scriptFileName,
        message: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  return results
}
