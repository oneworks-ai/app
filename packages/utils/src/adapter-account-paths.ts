import { lstatSync, realpathSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

import type { AdapterCtx } from '@oneworks/types'

import {
  ACCOUNT_GENERATIONS_DIRNAME,
  ACCOUNT_POINTER_FILENAME,
  ACCOUNT_STORE_DIRNAME,
  assertAdapterAccountPathSegment,
  encodeLogicalPathKey
} from './adapter-account-path-validation'
import { resolveGlobalOneWorksPath, resolvePrimaryWorkspaceFolder, resolveProjectHomePath } from './ai-path'
import { migrateProjectHomeSegment } from './project-home-migration'

export const resolveGlobalAdapterAccountDir = (
  env: AdapterCtx['env'],
  adapter: string,
  account: string
) =>
  resolveGlobalOneWorksPath(
    env,
    'adapters',
    encodeLogicalPathKey(assertAdapterAccountPathSegment(adapter, 'adapter')),
    'accounts',
    encodeLogicalPathKey(assertAdapterAccountPathSegment(account, 'account'))
  )

const resolveAdapterAccountsRootForWorkspace = (
  workspaceFolder: string,
  env: AdapterCtx['env'],
  adapter: string
) => resolveProjectHomePath(workspaceFolder, env, '.local', 'adapters', adapter, 'accounts')

export const resolveAdapterAccountsRoot = (
  cwd: string,
  env: AdapterCtx['env'],
  adapter: string
) => {
  const encodedAdapter = encodeLogicalPathKey(assertAdapterAccountPathSegment(adapter, 'adapter'))
  const workspace = resolvePrimaryWorkspaceFolder(cwd, env) ?? cwd
  return resolveAdapterAccountsRootForWorkspace(workspace, env, encodedAdapter)
}

export const resolveAdapterAccountReadRoots = (
  cwd: string,
  env: AdapterCtx['env'],
  adapter: string
) => [resolve(resolveAdapterAccountsRoot(cwd, env, adapter))]

const resolveLegacyAdapterAccountsRoot = (
  cwd: string,
  env: AdapterCtx['env'],
  adapter: string
) =>
  resolveAdapterAccountsRootForWorkspace(
    resolvePrimaryWorkspaceFolder(cwd, env) ?? cwd,
    env,
    assertAdapterAccountPathSegment(adapter, 'adapter')
  )

const readExactLegacyDirectorySync = (path: string, expectedBasename: string, label: string) => {
  let pathStat
  try {
    pathStat = lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (pathStat.isSymbolicLink() || !pathStat.isDirectory()) {
    throw new Error(`${label} must be a real directory and cannot be a symbolic link: ${path}`)
  }
  const canonicalPath = realpathSync.native(path)
  return basename(canonicalPath) === expectedBasename ? canonicalPath : undefined
}

export const resolveExactLegacyAccountDirSync = (
  cwd: string,
  env: AdapterCtx['env'],
  adapter: string,
  account: string
) => {
  const adapterSegment = assertAdapterAccountPathSegment(adapter, 'adapter')
  const accountSegment = assertAdapterAccountPathSegment(account, 'account')
  const legacyRoot = resolveLegacyAdapterAccountsRoot(cwd, env, adapterSegment)
  const adapterDir = readExactLegacyDirectorySync(dirname(legacyRoot), adapterSegment, 'Legacy adapter directory')
  if (adapterDir == null) return undefined
  const accountsRoot = readExactLegacyDirectorySync(
    resolve(adapterDir, 'accounts'),
    'accounts',
    'Legacy adapter accounts root'
  )
  if (accountsRoot == null) return undefined
  return readExactLegacyDirectorySync(
    resolve(accountsRoot, accountSegment),
    accountSegment,
    'Legacy adapter account directory'
  )
}

export interface AccountStoragePaths {
  accountStateDir: string
  currentPointerPath: string
  generationsDir: string
  storeRoot: string
}

export const resolveAccountStoragePaths = (
  accountsRoot: string,
  account: string
): AccountStoragePaths => {
  const accountSegment = assertAdapterAccountPathSegment(account, 'account')
  const storeRoot = resolve(accountsRoot, ACCOUNT_STORE_DIRNAME)
  const accountStateDir = resolve(storeRoot, encodeLogicalPathKey(accountSegment))
  return {
    accountStateDir,
    currentPointerPath: resolve(accountStateDir, ACCOUNT_POINTER_FILENAME),
    generationsDir: resolve(accountStateDir, ACCOUNT_GENERATIONS_DIRNAME),
    storeRoot
  }
}

export const migrateStoredAdapterAccounts = async (
  cwd: string,
  env: AdapterCtx['env']
) => migrateProjectHomeSegment(cwd, env, '.local')
