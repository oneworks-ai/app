import { lstat, mkdir, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { badRequest } from '#~/utils/http.js'

export interface FileIdentity {
  dev: bigint
  ino: bigint
}

export const isInsideWorkspace = (root: string, target: string) => {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

export const inspectSafeDestination = async (
  workspaceRoot: string,
  directory: string,
  expectedRoot?: FileIdentity
) => {
  const requestedRoot = resolve(workspaceRoot)
  const requestedTarget = resolve(directory)
  if (!isInsideWorkspace(requestedRoot, requestedTarget)) {
    throw badRequest('Asset destination is outside the current workspace', undefined, 'asset_destination_forbidden')
  }
  const rootStat = await lstat(workspaceRoot, { bigint: true })
  if (
    rootStat.isSymbolicLink() ||
    !rootStat.isDirectory() ||
    (expectedRoot != null && (rootStat.dev !== expectedRoot.dev || rootStat.ino !== expectedRoot.ino))
  ) {
    throw badRequest('Workspace authority changed', undefined, 'asset_workspace_changed')
  }
  const trustedRoot = await realpath(workspaceRoot)
  if (expectedRoot != null && trustedRoot !== workspaceRoot) {
    throw badRequest('Workspace authority changed', undefined, 'asset_workspace_changed')
  }
  const target = resolve(trustedRoot, relative(requestedRoot, requestedTarget))
  let current = trustedRoot
  for (const part of relative(trustedRoot, target).split(sep).filter(Boolean)) {
    current = resolve(current, part)
    const stat = await lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (stat == null) break
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw badRequest('Asset destination contains an unsafe path', undefined, 'asset_destination_unsafe')
    }
  }
  return { directory: target, workspaceRoot: trustedRoot }
}

export const ensureSafeDirectory = async (
  workspaceRoot: string,
  directory: string,
  expectedRoot?: FileIdentity
) => {
  const inspected = await inspectSafeDestination(workspaceRoot, directory, expectedRoot)
  let current = inspected.workspaceRoot
  for (const part of relative(inspected.workspaceRoot, inspected.directory).split(sep).filter(Boolean)) {
    current = resolve(current, part)
    try {
      await mkdir(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const stat = await lstat(current)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw badRequest('Asset destination contains an unsafe path', undefined, 'asset_destination_unsafe')
    }
  }
  return inspected
}
