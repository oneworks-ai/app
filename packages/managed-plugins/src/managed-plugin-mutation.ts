import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { resolvePrimaryWorkspaceFolder, resolveProjectWorkspaceFolder } from '@oneworks/utils/ai-path'
import { withDirectoryInstallLock } from '@oneworks/utils/install-lock'

interface ManagedPluginMutationLease {
  active: boolean
  runtime?: ManagedPluginMutationRuntime
}

export interface ManagedPluginMutationRuntime {
  onLeaseEvent?: (event: 'acquired' | 'reused', lockDir: string) => void
  withLock?: typeof withDirectoryInstallLock
}

const activeMutationLocks = new AsyncLocalStorage<ReadonlyMap<string, ManagedPluginMutationLease>>()

const normalizeWorkspaceKey = (
  cwd: string,
  env: NodeJS.ProcessEnv | undefined = process.env
) => {
  const workspace = resolvePrimaryWorkspaceFolder(cwd, env) ??
    resolveProjectWorkspaceFolder(cwd, env)
  try {
    return realpathSync.native(workspace)
  } catch {
    return path.resolve(workspace)
  }
}

export const getManagedPluginMutationLockDir = (
  cwd: string,
  env?: NodeJS.ProcessEnv
) => {
  const workspaceKey = createHash('sha256')
    .update(normalizeWorkspaceKey(cwd, env))
    .digest('hex')
  return path.resolve(tmpdir(), 'oneworks-managed-plugin-mutations', `${workspaceKey}.lock`)
}

export const isManagedPluginMutationActive = (params: {
  cwd: string
  env?: NodeJS.ProcessEnv
}) =>
  activeMutationLocks.getStore()?.get(
    getManagedPluginMutationLockDir(params.cwd, params.env)
  )?.active === true

export const withManagedPluginMutationLock = async <T>(
  params: {
    cwd: string
    env?: NodeJS.ProcessEnv
    runtime?: ManagedPluginMutationRuntime
  },
  callback: () => Promise<T>
) => {
  const lockDir = getManagedPluginMutationLockDir(params.cwd, params.env)
  const activeLocks = activeMutationLocks.getStore()
  const activeLease = activeLocks?.get(lockDir)
  if (activeLease?.active === true) {
    activeLease.runtime?.onLeaseEvent?.('reused', lockDir)
    return callback()
  }

  const withLock = params.runtime?.withLock ?? withDirectoryInstallLock
  return withLock({ lockDir }, async () => {
    params.runtime?.onLeaseEvent?.('acquired', lockDir)
    const lease: ManagedPluginMutationLease = {
      active: true,
      ...(params.runtime == null ? {} : { runtime: params.runtime })
    }
    const nextLocks = new Map(activeLocks)
    nextLocks.set(lockDir, lease)
    try {
      return await activeMutationLocks.run(nextLocks, callback)
    } finally {
      lease.active = false
    }
  })
}
