import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { badRequest } from '#~/utils/http.js'

export interface FileIdentity {
  dev: bigint
  ino: bigint
}

export const isInsideWorkspace = (root: string, target: string) => {
  const value = relative(root, target)
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value))
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
  const root = await lstat(workspaceRoot, { bigint: true })
  if (
    root.isSymbolicLink() ||
    !root.isDirectory() ||
    (expectedRoot != null && (root.dev !== expectedRoot.dev || root.ino !== expectedRoot.ino))
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
    const entry = await lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (entry == null) break
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw badRequest('Asset destination contains an unsafe path', undefined, 'asset_destination_unsafe')
    }
  }
  return { directory: target, workspaceRoot: trustedRoot }
}
