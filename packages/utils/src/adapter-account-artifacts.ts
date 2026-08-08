import { randomUUID } from 'node:crypto'
import { chmod, mkdir, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { AdapterAccountCredentialArtifact, AdapterCtx } from '@oneworks/types'

import {
  assertCanonicalChildDirectory,
  ensureCanonicalChildDirectory,
  ensurePrivateParentDirectories,
  identitiesMatch,
  syncDirectory,
  writePrivateArtifact
} from './adapter-account-fs'
import { assertExactLegacyAccountIdentity, readExactLegacyAccountIdentity } from './adapter-account-legacy'
import {
  ACCOUNT_LOCKS_DIRNAME,
  assertAdapterAccountPathSegment,
  assertArtifactPathSet,
  encodeLogicalPathKey
} from './adapter-account-path-validation'
import { migrateStoredAdapterAccounts, resolveAccountStoragePaths } from './adapter-account-paths'
import {
  assertOptionalAccountStateIdentity,
  assertSafeGenerationPointer,
  publishAccountGeneration
} from './adapter-account-publication'
import { ensureSecureAccountsRoot, revalidateLocksRoot } from './adapter-account-root'
import {
  assertAccountStorageIdentity,
  ensureAccountStorage,
  readOptionalAccountStateIdentity
} from './adapter-account-storage'
import { withDirectoryInstallLock } from './install-lock'

const ensureAccountLocksRoot = async (accountsRoot: string) => (
  await ensureCanonicalChildDirectory({
    label: 'Adapter account locks root',
    name: ACCOUNT_LOCKS_DIRNAME,
    parent: accountsRoot
  })
)

const prepareArtifactOperation = async (params: {
  account: string
  adapter: string
  cwd: string
  env: AdapterCtx['env']
}) => {
  const accountKey = assertAdapterAccountPathSegment(params.account, 'account')
  assertAdapterAccountPathSegment(params.adapter, 'adapter')
  const root = await ensureSecureAccountsRoot(params)
  await migrateStoredAdapterAccounts(params.cwd, params.env)
  await ensureSecureAccountsRoot({ ...params, expected: root })
  await readExactLegacyAccountIdentity(params)
  await readOptionalAccountStateIdentity(root.accountsRoot, params.account)
  const locksRoot = await ensureAccountLocksRoot(root.accountsRoot)
  return { accountKey, locksRoot, root }
}

const publishArtifacts = async (params: {
  artifactPaths: string[]
  artifacts: AdapterAccountCredentialArtifact[]
  operation: Awaited<ReturnType<typeof prepareArtifactOperation>>
  request: { account: string; adapter: string; cwd: string; env: AdapterCtx['env'] }
}) => {
  const lockedRoot = await ensureSecureAccountsRoot({ ...params.request, expected: params.operation.root })
  await revalidateLocksRoot({ accountsRoot: lockedRoot.accountsRoot, ...params.operation.locksRoot })
  const legacyAccount = await readExactLegacyAccountIdentity(params.request)
  const stateIdentity = await readOptionalAccountStateIdentity(lockedRoot.accountsRoot, params.request.account)
  const storage = await ensureAccountStorage(lockedRoot.accountsRoot, params.request.account)
  if (stateIdentity != null && !identitiesMatch(stateIdentity, storage.accountStateIdentity)) {
    throw new Error('Adapter account state changed while it was being locked.')
  }
  await assertSafeGenerationPointer(storage.currentPointerPath)

  const generation = randomUUID()
  const stagingDir = resolve(storage.generationsDir, `.${generation}.staging`)
  const generationDir = resolve(storage.generationsDir, generation)
  await mkdir(stagingDir, { mode: 0o700 })
  await chmod(stagingDir, 0o700)
  await syncDirectory(storage.generationsDir)
  let generationReady = false
  try {
    for (let index = 0; index < params.artifacts.length; index += 1) {
      const artifactPath = params.artifactPaths[index]!
      await ensurePrivateParentDirectories(stagingDir, artifactPath)
      await writePrivateArtifact(resolve(stagingDir, artifactPath), params.artifacts[index]!.content)
    }
    await syncDirectory(stagingDir)
    await ensureSecureAccountsRoot({ ...params.request, expected: lockedRoot })
    await assertExactLegacyAccountIdentity({ ...params.request, expected: legacyAccount })
    await assertAccountStorageIdentity(storage)
    await rename(stagingDir, generationDir)
    generationReady = true
    await syncDirectory(storage.generationsDir)
    const published = await assertCanonicalChildDirectory({
      label: 'Adapter account generation',
      parent: storage.generationsDir,
      path: generationDir
    })
    if (published == null) {
      throw new Error(`Adapter account generation disappeared before publication: ${generationDir}`)
    }
    await publishAccountGeneration({
      generation,
      storage,
      validate: async () => {
        await ensureSecureAccountsRoot({ ...params.request, expected: lockedRoot })
        await assertExactLegacyAccountIdentity({ ...params.request, expected: legacyAccount })
        await assertAccountStorageIdentity(storage)
        const current = await assertCanonicalChildDirectory({
          expected: published.identity,
          label: 'Adapter account generation',
          parent: storage.generationsDir,
          path: generationDir
        })
        if (current == null) {
          throw new Error(`Adapter account generation changed before publication: ${generationDir}`)
        }
      }
    })
    return generationDir
  } catch (error) {
    if (!generationReady) await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export const persistAdapterAccountArtifacts = async (params: {
  cwd: string
  env: AdapterCtx['env']
  adapter: string
  account: string
  artifacts: AdapterAccountCredentialArtifact[]
}) => {
  const artifactPaths = assertArtifactPathSet(params.artifacts)
  const operation = await prepareArtifactOperation(params)
  const lockDir = resolve(operation.locksRoot.path, encodeLogicalPathKey(operation.accountKey))
  const accountDir = await withDirectoryInstallLock({ lockDir }, async () => (
    await publishArtifacts({ artifactPaths, artifacts: params.artifacts, operation, request: params })
  ))
  return { accountDir }
}

export const removeStoredAdapterAccount = async (params: {
  cwd: string
  env: AdapterCtx['env']
  adapter: string
  account: string
}) => {
  const operation = await prepareArtifactOperation(params)
  const lockDir = resolve(operation.locksRoot.path, encodeLogicalPathKey(operation.accountKey))
  const accountStateDir = resolveAccountStoragePaths(
    operation.root.accountsRoot,
    operation.accountKey
  ).accountStateDir
  await withDirectoryInstallLock({ lockDir }, async () => {
    const lockedRoot = await ensureSecureAccountsRoot({ ...params, expected: operation.root })
    await revalidateLocksRoot({ accountsRoot: lockedRoot.accountsRoot, ...operation.locksRoot })
    const legacyAccount = await readExactLegacyAccountIdentity(params)
    const stateIdentity = await readOptionalAccountStateIdentity(lockedRoot.accountsRoot, params.account)
    await ensureSecureAccountsRoot({ ...params, expected: lockedRoot })
    await assertExactLegacyAccountIdentity({ ...params, expected: legacyAccount })
    await assertOptionalAccountStateIdentity({
      account: params.account,
      accountsRoot: lockedRoot.accountsRoot,
      expected: stateIdentity
    })
    if (stateIdentity != null) {
      await rm(resolveAccountStoragePaths(lockedRoot.accountsRoot, params.account).accountStateDir, {
        recursive: true,
        force: true
      })
    }
    if (legacyAccount != null) await rm(legacyAccount.path, { recursive: true, force: true })
  })
  return { accountDir: accountStateDir }
}
