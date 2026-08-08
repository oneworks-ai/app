import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import type { PathIdentity } from './adapter-account-fs'
import { assertCanonicalChildDirectory, ensureCanonicalChildDirectory } from './adapter-account-fs'
import { assertLogicalKeyMetadataSync, ensureLogicalKeyMetadata } from './adapter-account-metadata'
import {
  ACCOUNT_GENERATIONS_DIRNAME,
  ACCOUNT_KEY_METADATA_FILENAME,
  ACCOUNT_POINTER_FILENAME,
  ACCOUNT_STORE_DIRNAME,
  ADAPTER_KEY_METADATA_FILENAME,
  GENERATION_PATTERN,
  assertAdapterAccountPathSegment,
  encodeLogicalPathKey
} from './adapter-account-path-validation'
import { resolveAccountStoragePaths } from './adapter-account-paths'

export interface AccountStorageContext {
  accountKey: string
  accountStateDir: string
  accountStateIdentity: PathIdentity
  currentPointerPath: string
  generationsDir: string
  generationsIdentity: PathIdentity
  storeRoot: string
  storeRootIdentity: PathIdentity
}

export const resolvePublishedAccountGeneration = (
  accountsRoot: string,
  adapter: string,
  account: string
) => {
  const paths = resolveAccountStoragePaths(accountsRoot, account)
  let pointerStat
  try {
    pointerStat = lstatSync(paths.currentPointerPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (pointerStat.isSymbolicLink() || !pointerStat.isFile()) {
    throw new Error(`Adapter account generation pointer must be a real file: ${paths.currentPointerPath}`)
  }
  assertLogicalKeyMetadataSync({
    directory: dirname(accountsRoot),
    filename: ADAPTER_KEY_METADATA_FILENAME,
    key: assertAdapterAccountPathSegment(adapter, 'adapter'),
    label: 'Adapter key'
  })
  assertLogicalKeyMetadataSync({
    directory: paths.accountStateDir,
    filename: ACCOUNT_KEY_METADATA_FILENAME,
    key: assertAdapterAccountPathSegment(account, 'account'),
    label: 'Adapter account key'
  })
  const generation = readFileSync(paths.currentPointerPath, 'utf8').trim()
  if (!GENERATION_PATTERN.test(generation)) {
    throw new Error(`Adapter account generation pointer is invalid: ${paths.currentPointerPath}`)
  }
  for (
    const [path, label] of [
      [paths.storeRoot, 'Adapter account store root'],
      [paths.accountStateDir, 'Adapter account state directory'],
      [paths.generationsDir, 'Adapter account generations directory']
    ] as const
  ) {
    const pathStat = lstatSync(path)
    if (pathStat.isSymbolicLink() || !pathStat.isDirectory()) {
      throw new Error(`${label} must be a real directory and cannot be a symbolic link: ${path}`)
    }
  }
  const generationDir = resolve(paths.generationsDir, generation)
  const generationStat = lstatSync(generationDir)
  if (generationStat.isSymbolicLink() || !generationStat.isDirectory()) {
    throw new Error(`Adapter account generation must be a real directory: ${generationDir}`)
  }
  const canonicalGenerationsDir = realpathSync.native(paths.generationsDir)
  const canonicalGenerationDir = realpathSync.native(generationDir)
  if (relative(canonicalGenerationsDir, canonicalGenerationDir) !== generation) {
    throw new Error(`Adapter account generation resolves outside its generation root: ${generationDir}`)
  }
  return canonicalGenerationDir
}

export const ensureAccountStorage = async (
  accountsRoot: string,
  account: string
): Promise<AccountStorageContext> => {
  const storeRoot = await ensureCanonicalChildDirectory({
    label: 'Adapter account store root',
    name: ACCOUNT_STORE_DIRNAME,
    parent: accountsRoot
  })
  const accountState = await ensureCanonicalChildDirectory({
    label: 'Adapter account state directory',
    name: encodeLogicalPathKey(assertAdapterAccountPathSegment(account, 'account')),
    parent: storeRoot.path
  })
  await ensureLogicalKeyMetadata({
    directory: accountState.path,
    filename: ACCOUNT_KEY_METADATA_FILENAME,
    key: account,
    label: 'Adapter account key'
  })
  const generations = await ensureCanonicalChildDirectory({
    label: 'Adapter account generations directory',
    name: ACCOUNT_GENERATIONS_DIRNAME,
    parent: accountState.path
  })
  return {
    accountKey: account,
    accountStateDir: accountState.path,
    accountStateIdentity: accountState.identity,
    currentPointerPath: resolve(accountState.path, ACCOUNT_POINTER_FILENAME),
    generationsDir: generations.path,
    generationsIdentity: generations.identity,
    storeRoot: storeRoot.path,
    storeRootIdentity: storeRoot.identity
  }
}

export const assertAccountStorageIdentity = async (context: AccountStorageContext) => {
  const storeRoot = await assertCanonicalChildDirectory({
    expected: context.storeRootIdentity,
    label: 'Adapter account store root',
    parent: dirname(context.storeRoot),
    path: context.storeRoot
  })
  if (storeRoot == null) throw new Error(`Adapter account store root disappeared: ${context.storeRoot}`)
  const accountState = await assertCanonicalChildDirectory({
    expected: context.accountStateIdentity,
    label: 'Adapter account state directory',
    parent: storeRoot.path,
    path: context.accountStateDir
  })
  if (accountState == null) throw new Error(`Adapter account state directory disappeared: ${context.accountStateDir}`)
  await ensureLogicalKeyMetadata({
    directory: accountState.path,
    filename: ACCOUNT_KEY_METADATA_FILENAME,
    key: context.accountKey,
    label: 'Adapter account key'
  })
  const generations = await assertCanonicalChildDirectory({
    expected: context.generationsIdentity,
    label: 'Adapter account generations directory',
    parent: accountState.path,
    path: context.generationsDir
  })
  if (generations == null) {
    throw new Error(`Adapter account generations directory disappeared: ${context.generationsDir}`)
  }
}

export const readOptionalAccountStateIdentity = async (accountsRoot: string, account: string) => {
  const paths = resolveAccountStoragePaths(accountsRoot, account)
  const storeRoot = await assertCanonicalChildDirectory({
    label: 'Adapter account store root',
    parent: accountsRoot,
    path: paths.storeRoot
  })
  if (storeRoot == null) return undefined
  return (await assertCanonicalChildDirectory({
    label: 'Adapter account state directory',
    parent: storeRoot.path,
    path: paths.accountStateDir
  }))?.identity
}
