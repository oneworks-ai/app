import type { GitChangedFile, SessionWorkspaceChangeOutcome, SessionWorkspaceChangedFile } from '@oneworks/types'

import { getRepositoryStatus, resolveRepositoryContextByWorkspaceFolder } from '#~/services/git/repository.js'
import { resolveSessionWorkspaceFolder } from '#~/services/session/workspace.js'

import { getWorkspaceChangeFileDiffs } from './workspace-change-diff-utils'
import { getWorkspaceChangeFileSignature, getWorkspaceChangeFileStats } from './workspace-change-git-utils'

export interface WorkspaceChangeSnapshot {
  cwd: string
  fileSignatures: Map<string, string>
  files: GitChangedFile[]
  repositoryRoot: string
}

export interface TrackedWorkspaceChange extends WorkspaceChangeSnapshot {
  id: string
  startedAt: number
}

export const getCurrentWorkspaceChangeSnapshot = async (
  sessionId: string
): Promise<WorkspaceChangeSnapshot | undefined> => {
  const cwd = await resolveSessionWorkspaceFolder(sessionId)
  const repo = await resolveRepositoryContextByWorkspaceFolder(cwd)
  if (!repo.available || repo.repositoryRoot == null) {
    return undefined
  }

  const repositoryRoot = repo.repositoryRoot
  const status = await getRepositoryStatus(repositoryRoot)
  const signatures = await Promise.all(status.changedFiles.map(async file => ({
    path: file.path,
    signature: await getWorkspaceChangeFileSignature(repositoryRoot, file)
  })))

  return {
    cwd: repo.cwd,
    repositoryRoot,
    files: status.changedFiles,
    fileSignatures: new Map(signatures.map(item => [item.path, item.signature]))
  }
}

export const buildWorkspaceChanges = async (
  sessionId: string,
  baseline: TrackedWorkspaceChange,
  outcome: SessionWorkspaceChangeOutcome
) => {
  const current = await getCurrentWorkspaceChangeSnapshot(sessionId)
  if (current == null || current.repositoryRoot !== baseline.repositoryRoot) {
    return undefined
  }

  const changedFiles = current.files.filter((file) => {
    const previousSignature = baseline.fileSignatures.get(file.path)
    const currentSignature = current.fileSignatures.get(file.path)
    return currentSignature != null && currentSignature !== previousSignature
  })
  if (changedFiles.length === 0) {
    return undefined
  }

  const statsByPath = await getWorkspaceChangeFileStats(current.repositoryRoot, changedFiles)
  const diffsByPath = await getWorkspaceChangeFileDiffs(current.repositoryRoot, changedFiles)
  const files: SessionWorkspaceChangedFile[] = changedFiles.map((file) => {
    const stats = statsByPath.get(file.path) ?? { additions: 0, deletions: 0 }
    const diff = diffsByPath.get(file.path)
    return {
      ...file,
      additions: stats.additions,
      deletions: stats.deletions,
      ...(diff != null ? { diff } : {})
    }
  })
  const completedAt = Date.now()

  return {
    id: baseline.id,
    sessionId,
    cwd: current.cwd,
    repositoryRoot: current.repositoryRoot,
    startedAt: baseline.startedAt,
    completedAt,
    createdAt: completedAt,
    outcome,
    files,
    summary: {
      changedFiles: files.length,
      additions: files.reduce((count, file) => count + file.additions, 0),
      deletions: files.reduce((count, file) => count + file.deletions, 0)
    }
  }
}
