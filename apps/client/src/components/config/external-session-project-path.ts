import type { LauncherWorkspaceSelectorProject } from '@oneworks/types'

import {
  getFilesystemPathComparisonKey,
  getFilesystemPathDisplayName,
  readNonBlankFilesystemPath
} from '#~/utils/filesystem-path-identity'

import type { ExternalSessionsProjectOption } from './external-sessions-panel-model'

export const getExternalSessionProjectPathKey = (value: string) => getFilesystemPathComparisonKey(value)

export const isExternalSessionCandidateWithinProjects = (
  candidateCwd: string,
  projectPaths: string[]
) => {
  const candidate = getExternalSessionProjectPathKey(candidateCwd)
  return projectPaths.length === 0 || projectPaths.some((projectPath) => {
    const project = getExternalSessionProjectPathKey(projectPath)
    if (candidate.slice(0, candidate.indexOf(':')) !== project.slice(0, project.indexOf(':'))) return false
    const candidatePath = candidate.slice(candidate.indexOf(':') + 1)
    const projectPathValue = project.slice(project.indexOf(':') + 1)
    return candidatePath === projectPathValue || candidatePath.startsWith(
      projectPathValue.endsWith('/') ? projectPathValue : `${projectPathValue}/`
    )
  })
}

export const getExternalSessionProjectLabel = (value: string) => getFilesystemPathDisplayName(value) ?? value

export const buildLauncherExternalSessionProjectOptions = (
  workspaceProjects: LauncherWorkspaceSelectorProject[]
): ExternalSessionsProjectOption[] => {
  const projectsByPath = new Map<string, LauncherWorkspaceSelectorProject>()
  for (const project of workspaceProjects) {
    if (readNonBlankFilesystemPath(project.workspaceFolder) == null) continue
    const key = getExternalSessionProjectPathKey(project.workspaceFolder)
    if (!projectsByPath.has(key)) projectsByPath.set(key, project)
  }
  return Array.from(projectsByPath.values()).map(project => ({
    description: project.description,
    isCurrent: project.isCurrent,
    label: project.name.trim() || project.workspaceFolder,
    value: project.workspaceFolder
  }))
}
