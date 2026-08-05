import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { openFilesystemAuthority } from '@oneworks/fs-authority-native'
import type { FilesystemAuthority } from '@oneworks/fs-authority-native'
import { resolvePrimaryWorkspaceFolder, resolveProjectWorkspaceFolder } from '@oneworks/utils/ai-path'
import { getManagedPluginsRoot } from '@oneworks/utils/managed-plugin'

export interface ManagedPluginMutationLease {
  active: boolean
  authority: FilesystemAuthority
  generation: number
  key: string
  managedRoot: string
  runtime?: ManagedPluginMutationRuntime
  terminal: boolean
}

export interface ManagedPluginMutationRuntime {
  onLeaseEvent?: (event: 'acquired' | 'reused', key: string) => void
  openAuthority?: typeof openFilesystemAuthority
}

const activeMutationLeases = new AsyncLocalStorage<ReadonlyMap<string, ManagedPluginMutationLease>>()

const normalizeWorkspace = (
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
) => {
  const workspace = resolvePrimaryWorkspaceFolder(cwd, env) ?? resolveProjectWorkspaceFolder(cwd, env)
  try {
    return realpathSync.native(workspace)
  } catch {
    return path.resolve(workspace)
  }
}

export const getManagedPluginMutationKey = (
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
) => createHash('sha256').update(normalizeWorkspace(cwd, env)).digest('hex')

export const isManagedPluginMutationActive = (params: {
  cwd: string
  env?: NodeJS.ProcessEnv
}) =>
  activeMutationLeases.getStore()?.get(
    getManagedPluginMutationKey(params.cwd, params.env)
  )?.active === true

export const withManagedPluginAuthority = async <T>(
  params: {
    cwd: string
    env?: NodeJS.ProcessEnv
    runtime?: ManagedPluginMutationRuntime
  },
  callback: (lease: ManagedPluginMutationLease) => Promise<T>
) => {
  const env = params.env ?? process.env
  const key = getManagedPluginMutationKey(params.cwd, env)
  const activeLeases = activeMutationLeases.getStore()
  const activeLease = activeLeases?.get(key)
  if (activeLease?.active === true) {
    activeLease.runtime?.onLeaseEvent?.('reused', key)
    return callback(activeLease)
  }

  const managedRoot = getManagedPluginsRoot(params.cwd, env)
  await mkdir(managedRoot, { recursive: true })
  const authority = await (params.runtime?.openAuthority ?? openFilesystemAuthority)(managedRoot)
  let lease: ManagedPluginMutationLease | undefined
  let callbackError: unknown
  let callbackFailed = false
  let result: T | undefined
  try {
    const generation = await authority.claimMutation('managed-plugin-workspace', key)
    params.runtime?.onLeaseEvent?.('acquired', key)
    lease = {
      active: true,
      authority,
      generation,
      key,
      managedRoot,
      runtime: params.runtime,
      terminal: false
    }
    const nextLeases = new Map(activeLeases)
    nextLeases.set(key, lease)
    result = await activeMutationLeases.run(nextLeases, () => callback(lease!))
  } catch (error) {
    callbackFailed = true
    callbackError = error
  }
  if (lease != null) lease.active = false
  let releaseError: unknown
  if (lease != null && !lease.terminal) {
    try {
      await authority.release(lease.generation)
    } catch (error) {
      releaseError = error
    }
  }
  try {
    authority.close()
  } catch (error) {
    releaseError ??= error
  }
  if (callbackFailed) throw callbackError
  if (releaseError != null) throw releaseError
  return result as T
}

export const markManagedPluginAuthorityTerminal = (lease: ManagedPluginMutationLease) => {
  lease.active = false
  lease.terminal = true
}

export const withManagedPluginMutationLock = async <T>(
  params: {
    cwd: string
    env?: NodeJS.ProcessEnv
    runtime?: ManagedPluginMutationRuntime
  },
  callback: () => Promise<T>
) => withManagedPluginAuthority(params, callback)
