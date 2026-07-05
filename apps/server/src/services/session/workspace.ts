/* eslint-disable max-lines */

import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { env as processEnv } from 'node:process'

import type { WSEvent } from '@oneworks/core'
import { resolvePrimaryWorkspaceFolder } from '@oneworks/register/dotenv'
import type { SessionCreationProgressEvent, SessionInfo } from '@oneworks/types'
import {
  PROJECT_WORKSPACE_FOLDER_ENV,
  addGitWorktree,
  isGitMissingError,
  isGitNotRepositoryError,
  removeGitWorktree,
  resolveGitCurrentBranch,
  resolveGitHeadRef,
  resolveGitRepositoryRoot,
  resolveProjectOoPath,
  runGitCommand
} from '@oneworks/utils'

import { getDb } from '#~/db/index.js'
import type {
  SessionWorkspaceCleanupPolicy,
  SessionWorkspaceKind,
  SessionWorkspaceRow
} from '#~/db/sessionWorkspaces/repo.js'
import { getWorkspaceFolder } from '#~/services/config/index.js'
import {
  normalizeOptionalWorktreeEnvironmentId,
  runConfiguredWorktreeEnvironmentScripts
} from '#~/services/worktree-environments.js'
import type { WorktreeEnvironmentScriptRunProgress } from '#~/services/worktree-environments.js'
import { conflict, notFound } from '#~/utils/http.js'

interface ProvisionSessionWorkspaceOptions {
  sourceSessionId?: string
  createWorktree?: boolean
  worktreeEnvironment?: string
  signal?: AbortSignal
  onProgress?: (progress: SessionCreationProgressEvent) => void | Promise<void>
}

const DEFAULT_CLEANUP_POLICY: SessionWorkspaceCleanupPolicy = 'delete_on_session_delete'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const throwIfAborted = (signal: AbortSignal | undefined, fallbackMessage: string) => {
  if (signal?.aborted !== true) {
    return
  }

  if (signal.reason instanceof Error) {
    throw signal.reason
  }
  throw new Error(fallbackMessage)
}

const emitProvisionProgress = async (
  onProgress: ProvisionSessionWorkspaceOptions['onProgress'],
  progress: SessionCreationProgressEvent
) => {
  try {
    await onProgress?.(progress)
  } catch (error) {
    console.error('[sessions] Failed to emit workspace provision progress:', error)
  }
}

const mapEnvironmentScriptProgress = (
  progress: WorktreeEnvironmentScriptRunProgress
): SessionCreationProgressEvent => {
  if (progress.stream != null && progress.output != null) {
    return {
      phase: 'environment',
      step: 'environment_script_output',
      status: 'running',
      environmentId: progress.environmentId,
      scriptPath: progress.scriptPath,
      scriptFileName: progress.scriptFileName,
      stream: progress.stream,
      output: progress.output
    }
  }

  if (progress.status === 'running') {
    return {
      phase: 'environment',
      step: 'environment_script_running',
      status: 'running',
      environmentId: progress.environmentId,
      scriptPath: progress.scriptPath,
      scriptFileName: progress.scriptFileName
    }
  }

  if (progress.status === 'success') {
    return {
      phase: 'environment',
      step: 'environment_script_succeeded',
      status: 'success',
      environmentId: progress.environmentId,
      scriptPath: progress.scriptPath,
      scriptFileName: progress.scriptFileName
    }
  }

  if (progress.status === 'error') {
    return {
      phase: 'environment',
      step: 'environment_script_failed',
      status: 'error',
      message: progress.message,
      environmentId: progress.environmentId,
      scriptPath: progress.scriptPath,
      scriptFileName: progress.scriptFileName
    }
  }

  return {
    phase: 'environment',
    step: 'environment_skipped',
    status: 'skipped',
    message: progress.message,
    environmentId: progress.environmentId
  }
}

const getSessionOrThrow = (sessionId: string) => {
  const session = getDb().getSession(sessionId)
  if (session == null) {
    throw notFound('Session not found', { sessionId }, 'session_not_found')
  }
  return session
}

const resolveRepositoryDirectoryName = (repositoryRoot: string, fallback: string) => {
  const segments = repositoryRoot
    .split(/[\\/]+/)
    .map(segment => segment.trim())
    .filter(Boolean)

  return segments.at(-1) ?? fallback
}

const resolveManagedWorktreePath = (
  workspaceFolder: string,
  sessionId: string,
  repositoryRoot: string
) => {
  const primaryWorkspaceFolder = resolvePrimaryWorkspaceFolder(workspaceFolder) ?? workspaceFolder
  const primaryWorkspaceEnv = {
    ...processEnv,
    [PROJECT_WORKSPACE_FOLDER_ENV]: primaryWorkspaceFolder
  }
  return resolveProjectOoPath(
    primaryWorkspaceFolder,
    primaryWorkspaceEnv,
    'worktrees',
    'sessions',
    sessionId,
    resolveRepositoryDirectoryName(repositoryRoot, sessionId)
  )
}

const buildManagedWorktreeBranchName = (baseBranch: string, sessionId: string) => {
  const suffix = sessionId.slice(0, 8)
  return `${baseBranch}-session-${suffix}`
}

const getLatestSessionInfoCwd = (sessionId: string) => {
  const event = getDb().getLatestSessionInfoMessage(sessionId) as WSEvent | undefined
  if (event?.type !== 'session_info' || !isRecord(event.info)) {
    return undefined
  }

  const info = event.info as SessionInfo & { cwd?: unknown }
  if (typeof info.cwd !== 'string' || info.cwd.trim() === '') {
    return undefined
  }

  const cwd = info.cwd.trim()
  return cwd.startsWith('/') ? cwd : resolve(getWorkspaceFolder(), cwd)
}

const persistSessionWorkspace = (row: Omit<SessionWorkspaceRow, 'createdAt' | 'updatedAt'>) => {
  getDb().upsertSessionWorkspace(row)
  const created = getDb().getSessionWorkspace(row.sessionId)
  if (created == null) {
    throw new Error(`Failed to persist session workspace for ${row.sessionId}`)
  }
  return created
}

const persistSharedWorkspace = async (
  sessionId: string,
  workspaceFolder: string,
  kind: SessionWorkspaceKind,
  cleanupPolicy: SessionWorkspaceCleanupPolicy,
  worktreeEnvironment?: string
) => {
  let repositoryRoot: string | undefined
  try {
    repositoryRoot = await resolveGitRepositoryRoot(workspaceFolder)
  } catch (error) {
    if (!isGitMissingError(error) && !isGitNotRepositoryError(error)) {
      throw error
    }
  }

  return persistSessionWorkspace({
    sessionId,
    kind,
    workspaceFolder,
    repositoryRoot,
    worktreeEnvironment,
    cleanupPolicy,
    state: 'ready'
  })
}

const buildManagedWorkspace = async (
  sessionId: string,
  workspaceFolder: string,
  worktreeEnvironment?: string,
  onProgress?: ProvisionSessionWorkspaceOptions['onProgress'],
  signal?: AbortSignal
) => {
  throwIfAborted(signal, 'Workspace provision cancelled')
  await emitProvisionProgress(onProgress, {
    phase: 'worktree',
    step: 'worktree_preparing',
    status: 'running'
  })
  throwIfAborted(signal, 'Workspace provision cancelled')

  let repositoryRoot: string
  try {
    repositoryRoot = await resolveGitRepositoryRoot(workspaceFolder)
  } catch (error) {
    await emitProvisionProgress(onProgress, {
      phase: 'workspace',
      step: 'workspace_failed',
      status: 'error',
      message: getErrorMessage(error)
    })
    throw error
  }
  throwIfAborted(signal, 'Workspace provision cancelled')

  const currentBranch = await resolveGitCurrentBranch(workspaceFolder).catch(() => '')
  const normalizedBranch = currentBranch.trim() !== '' ? currentBranch.trim() : undefined
  const baseRef = normalizedBranch ?? await resolveGitHeadRef(workspaceFolder).catch(() => 'HEAD')
  const worktreePath = resolveManagedWorktreePath(workspaceFolder, sessionId, repositoryRoot)
  const branchName = normalizedBranch == null
    ? undefined
    : buildManagedWorktreeBranchName(normalizedBranch, sessionId)

  let worktreeCreated = false
  try {
    throwIfAborted(signal, 'Workspace provision cancelled')
    await mkdir(dirname(worktreePath), { recursive: true })
    throwIfAborted(signal, 'Workspace provision cancelled')
    await emitProvisionProgress(onProgress, {
      phase: 'worktree',
      step: 'worktree_creating',
      status: 'running',
      worktreePath
    })
    throwIfAborted(signal, 'Workspace provision cancelled')
    await addGitWorktree({
      branch: branchName,
      cwd: repositoryRoot,
      path: worktreePath,
      ref: baseRef
    })
    worktreeCreated = true
    throwIfAborted(signal, 'Workspace provision cancelled')
    await emitProvisionProgress(onProgress, {
      phase: 'worktree',
      step: 'worktree_created',
      status: 'success',
      worktreePath
    })
    throwIfAborted(signal, 'Workspace provision cancelled')

    await emitProvisionProgress(onProgress, {
      phase: 'environment',
      step: 'environment_resolving',
      status: 'running',
      worktreePath,
      environmentId: worktreeEnvironment
    })
    throwIfAborted(signal, 'Workspace provision cancelled')
    await runConfiguredWorktreeEnvironmentScripts({
      operation: 'create',
      workspaceFolder: worktreePath,
      sourceWorkspaceFolder: workspaceFolder,
      repositoryRoot: worktreePath,
      baseRef,
      environmentId: worktreeEnvironment,
      sessionId,
      signal,
      onProgress: progress => emitProvisionProgress(onProgress, mapEnvironmentScriptProgress(progress))
    })
    throwIfAborted(signal, 'Workspace provision cancelled')
  } catch (error) {
    await emitProvisionProgress(onProgress, {
      phase: 'workspace',
      step: 'workspace_failed',
      status: 'error',
      message: getErrorMessage(error),
      worktreePath
    })
    if (worktreeCreated) {
      await runConfiguredWorktreeEnvironmentScripts({
        operation: 'destroy',
        workspaceFolder: worktreePath,
        sourceWorkspaceFolder: workspaceFolder,
        repositoryRoot: worktreePath,
        baseRef,
        environmentId: worktreeEnvironment,
        force: true,
        sessionId
      }).catch((cleanupError) => {
        console.error(
          '[sessions] Failed to run worktree environment destroy scripts after create failure:',
          cleanupError
        )
      })
      await removeGitWorktree({
        cwd: repositoryRoot,
        path: worktreePath,
        force: true
      }).catch(() => undefined)
    }
    throw error
  }

  throwIfAborted(signal, 'Workspace provision cancelled')
  const workspace = persistSessionWorkspace({
    sessionId,
    kind: 'managed_worktree',
    workspaceFolder: worktreePath,
    repositoryRoot: worktreePath,
    worktreePath,
    baseRef,
    worktreeEnvironment,
    cleanupPolicy: DEFAULT_CLEANUP_POLICY,
    state: 'ready'
  })
  await emitProvisionProgress(onProgress, {
    phase: 'workspace',
    step: 'workspace_ready',
    status: 'success',
    worktreePath
  })
  return workspace
}

const resolveManagedWorkspaceSource = async (
  sessionId: string,
  options: ProvisionSessionWorkspaceOptions
) => {
  if (options.sourceSessionId != null && options.sourceSessionId !== '') {
    const sourceWorkspace = await resolveSessionWorkspace(options.sourceSessionId)
    return sourceWorkspace.workspaceFolder
  }

  return getLatestSessionInfoCwd(sessionId) ?? getWorkspaceFolder()
}

export const provisionSessionWorkspace = async (
  sessionId: string,
  options: ProvisionSessionWorkspaceOptions = {}
) => {
  getSessionOrThrow(sessionId)
  throwIfAborted(options.signal, 'Workspace provision cancelled')

  const existing = getDb().getSessionWorkspace(sessionId)
  if (existing != null && existing.state === 'ready') {
    return existing
  }

  const sourceWorkspaceFolder = await resolveManagedWorkspaceSource(sessionId, options)
  throwIfAborted(options.signal, 'Workspace provision cancelled')
  const worktreeEnvironment = normalizeOptionalWorktreeEnvironmentId(options.worktreeEnvironment)

  if (options.createWorktree === false) {
    throwIfAborted(options.signal, 'Workspace provision cancelled')
    return await persistSharedWorkspace(
      sessionId,
      sourceWorkspaceFolder,
      'shared_workspace',
      'retain'
    )
  }

  try {
    return await buildManagedWorkspace(
      sessionId,
      sourceWorkspaceFolder,
      worktreeEnvironment,
      options.onProgress,
      options.signal
    )
  } catch (error) {
    if (
      options.createWorktree === true ||
      (!isGitMissingError(error) && !isGitNotRepositoryError(error))
    ) {
      throw error
    }

    throwIfAborted(options.signal, 'Workspace provision cancelled')
    return await persistSharedWorkspace(
      sessionId,
      sourceWorkspaceFolder,
      'shared_workspace',
      'retain',
      worktreeEnvironment
    )
  }
}

const recoverLegacySessionWorkspace = async (sessionId: string) => {
  getSessionOrThrow(sessionId)

  const legacyCwd = getLatestSessionInfoCwd(sessionId)
  if (legacyCwd != null) {
    return persistSharedWorkspace(sessionId, legacyCwd, 'external_workspace', 'retain')
  }

  return persistSharedWorkspace(sessionId, getWorkspaceFolder(), 'shared_workspace', 'retain')
}

export const resolveSessionWorkspace = async (sessionId: string) => {
  const existing = getDb().getSessionWorkspace(sessionId)
  if (existing != null && existing.state === 'ready') {
    return existing
  }

  return await recoverLegacySessionWorkspace(sessionId)
}

export const resolveSessionWorkspaceFolder = async (sessionId: string) => {
  const workspace = await resolveSessionWorkspace(sessionId)
  return workspace.workspaceFolder
}

export const createSessionManagedWorktree = async (sessionId: string) => {
  getSessionOrThrow(sessionId)

  const existing = await resolveSessionWorkspace(sessionId)
  if (existing.kind === 'managed_worktree') {
    return existing
  }

  try {
    return await buildManagedWorkspace(sessionId, existing.workspaceFolder, existing.worktreeEnvironment)
  } catch (error) {
    if (!isGitMissingError(error) && !isGitNotRepositoryError(error)) {
      throw error
    }

    throw conflict(
      'Session workspace is not a git repository',
      {
        sessionId,
        workspaceFolder: existing.workspaceFolder
      },
      'session_workspace_not_repository'
    )
  }
}

export const transferSessionWorkspaceToLocal = async (sessionId: string) => {
  const existing = await resolveSessionWorkspace(sessionId)
  if (existing.kind !== 'managed_worktree') {
    throw conflict(
      'Session workspace is not a managed worktree',
      { sessionId },
      'session_workspace_not_managed_worktree'
    )
  }

  getDb().updateSessionWorkspace(sessionId, {
    kind: 'external_workspace',
    cleanupPolicy: 'retain',
    state: 'ready',
    lastError: null
  })

  const updated = getDb().getSessionWorkspace(sessionId)
  if (updated == null) {
    throw new Error(`Failed to transfer session workspace for ${sessionId}`)
  }

  return updated
}

export const deleteSessionWorkspace = async (
  sessionId: string,
  options: {
    force?: boolean
  } = {}
) => {
  const workspace = getDb().getSessionWorkspace(sessionId)
  if (workspace == null) {
    return false
  }

  if (workspace.kind !== 'managed_worktree' || workspace.worktreePath == null || workspace.worktreePath.trim() === '') {
    getDb().deleteSessionWorkspace(sessionId)
    return true
  }

  if (options.force !== true) {
    const { stdout } = await runGitCommand(['status', '--short'], workspace.worktreePath)
    if (stdout !== '') {
      throw conflict(
        'Session worktree has uncommitted changes',
        {
          sessionId,
          worktreePath: workspace.worktreePath
        },
        'session_worktree_not_clean'
      )
    }
  }

  getDb().updateSessionWorkspace(sessionId, {
    state: 'deleting',
    lastError: null
  })

  try {
    await runConfiguredWorktreeEnvironmentScripts({
      operation: 'destroy',
      workspaceFolder: workspace.worktreePath,
      repositoryRoot: workspace.repositoryRoot?.trim() || workspace.worktreePath,
      baseRef: workspace.baseRef,
      environmentId: workspace.worktreeEnvironment,
      force: options.force === true,
      sessionId
    })

    await removeGitWorktree({
      cwd: workspace.repositoryRoot?.trim() || workspace.worktreePath,
      path: workspace.worktreePath,
      force: options.force !== false
    })
  } catch (error) {
    getDb().updateSessionWorkspace(sessionId, {
      state: 'broken',
      lastError: error instanceof Error ? error.message : String(error)
    })
    throw error
  }

  getDb().deleteSessionWorkspace(sessionId)
  return true
}
