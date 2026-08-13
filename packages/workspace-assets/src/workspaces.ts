import { basename, relative, resolve, sep } from 'node:path'

import { mergeConfigs } from '@oneworks/config'
import type { Config, WorkspaceAsset } from '@oneworks/types'

import { isDirectory, normalizeWorkspaceConfig, scanWorkspacePatterns } from './workspace-config'

interface WorkspaceCandidate {
  preferredId?: string
  name?: string
  description?: string
  cwd: string
  path: string
  pattern?: string
  sourcePath: string
}

const createWorkspaceAsset = (params: {
  id: string
  name?: string
  description?: string
  cwd: string
  path: string
  pattern?: string
  sourcePath: string
}) => ({
  id: `workspace:workspace:workspace:${params.id}:${params.path}`,
  kind: 'workspace',
  name: params.id,
  displayName: params.id,
  origin: 'workspace',
  sourcePath: params.sourcePath,
  payload: {
    id: params.id,
    name: params.name,
    description: params.description,
    path: params.path,
    cwd: params.cwd,
    pattern: params.pattern
  }
} satisfies Extract<WorkspaceAsset, { kind: 'workspace' }>)

const addCandidate = (
  candidates: Map<string, WorkspaceCandidate>,
  candidate: WorkspaceCandidate
) => {
  const key = resolve(candidate.cwd)
  const existing = candidates.get(key)
  if (existing == null) {
    candidates.set(key, candidate)
    return
  }

  candidates.set(key, {
    ...existing,
    ...candidate,
    preferredId: candidate.preferredId ?? existing.preferredId,
    name: candidate.name ?? existing.name,
    description: candidate.description ?? existing.description
  })
}

const resolveWorkspaceRelativePath = (parentPath: string, targetPath: string) => {
  const relativePath = relative(parentPath, targetPath)
  return sep === '\\' ? relativePath.replaceAll('\\', '/') : relativePath
}

const assignWorkspaceIds = (candidates: WorkspaceCandidate[]) => {
  const preferredIds = new Set(
    candidates
      .map(candidate => candidate.preferredId)
      .filter((value): value is string => value != null && value.trim() !== '')
  )
  const basenameCounts = candidates.reduce<Map<string, number>>((counts, candidate) => {
    if (candidate.preferredId != null) return counts
    const id = basename(candidate.path)
    counts.set(id, (counts.get(id) ?? 0) + 1)
    return counts
  }, new Map())
  const usedIds = new Set<string>()

  return candidates.map((candidate) => {
    const preferredId = candidate.preferredId?.trim()
    if (preferredId != null && preferredId !== '' && !usedIds.has(preferredId)) {
      usedIds.add(preferredId)
      return [preferredId, candidate] as const
    }

    const basenameId = basename(candidate.path)
    const shouldUsePathId = preferredIds.has(basenameId) || (basenameCounts.get(basenameId) ?? 0) > 1
    const id = shouldUsePathId ? candidate.path : basenameId
    const uniqueId = usedIds.has(id) ? candidate.path : id
    usedIds.add(uniqueId)
    return [uniqueId, candidate] as const
  })
}

export const resolveConfiguredWorkspaceAssets = async (params: {
  cwd: string
  configs?: [Config?, Config?]
}): Promise<Array<Extract<WorkspaceAsset, { kind: 'workspace' }>>> => {
  const [config, userConfig] = params.configs ?? [undefined, undefined]
  const mergedConfig = mergeConfigs(config, userConfig)
  const workspaceConfig = normalizeWorkspaceConfig(mergedConfig?.workspaces)
  const sourcePath = resolve(params.cwd, '.oo.config.json')
  const candidates = new Map<string, WorkspaceCandidate>()

  for (const path of await scanWorkspacePatterns(params.cwd, workspaceConfig.include, workspaceConfig.exclude)) {
    const relativePath = resolveWorkspaceRelativePath(params.cwd, path)
    if (relativePath === '') continue
    addCandidate(candidates, {
      cwd: path,
      path: relativePath,
      sourcePath
    })
  }

  for (const [id, entry] of Object.entries(workspaceConfig.entries)) {
    if (entry.enabled === false) continue

    if (entry.path != null) {
      const workspaceCwd = resolve(params.cwd, entry.path)
      if (await isDirectory(workspaceCwd)) {
        addCandidate(candidates, {
          preferredId: id,
          name: entry.name,
          description: entry.description,
          cwd: workspaceCwd,
          path: resolveWorkspaceRelativePath(params.cwd, workspaceCwd),
          sourcePath
        })
      }
    }

    for (
      const path of await scanWorkspacePatterns(
        params.cwd,
        entry.include ?? [],
        [
          ...workspaceConfig.exclude,
          ...(entry.exclude ?? [])
        ]
      )
    ) {
      const relativePath = resolveWorkspaceRelativePath(params.cwd, path)
      if (relativePath === '') continue
      addCandidate(candidates, {
        name: entry.name,
        description: entry.description,
        cwd: path,
        path: relativePath,
        pattern: entry.include?.join(', '),
        sourcePath
      })
    }
  }

  return assignWorkspaceIds(Array.from(candidates.values()))
    .map(([id, candidate]) =>
      createWorkspaceAsset({
        id,
        name: candidate.name,
        description: candidate.description,
        cwd: candidate.cwd,
        path: candidate.path,
        pattern: candidate.pattern,
        sourcePath: candidate.sourcePath
      })
    )
}

export const findWorkspaceAsset = (
  workspaces: Array<Extract<WorkspaceAsset, { kind: 'workspace' }>>,
  ref: string
) => {
  if (ref.trim() === '') return undefined
  const matches = workspaces.filter(workspace =>
    workspace.displayName === ref ||
    workspace.name === ref ||
    workspace.payload.id === ref ||
    workspace.payload.path === ref ||
    workspace.payload.name === ref
  )

  if (matches.length === 0) return undefined
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous workspace reference ${ref}. Candidates: ${matches.map(match => match.displayName).join(', ')}`
    )
  }
  return matches[0]
}
