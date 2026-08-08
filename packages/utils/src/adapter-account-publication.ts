import { randomUUID } from 'node:crypto'
import { rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

import { identitiesMatch, readPathIdentity, syncDirectory, writePrivateArtifact } from './adapter-account-fs'
import { ACCOUNT_POINTER_FILENAME } from './adapter-account-path-validation'
import type { AccountStorageContext } from './adapter-account-storage'
import { readOptionalAccountStateIdentity } from './adapter-account-storage'

export const assertOptionalAccountStateIdentity = async (params: {
  account: string
  accountsRoot: string
  expected: Awaited<ReturnType<typeof readOptionalAccountStateIdentity>>
}) => {
  const current = await readOptionalAccountStateIdentity(params.accountsRoot, params.account)
  if (params.expected == null && current != null) {
    throw new Error('Adapter account state appeared while it was being updated.')
  }
  if (params.expected != null && (current == null || !identitiesMatch(params.expected, current))) {
    throw new Error('Adapter account state changed while it was being updated.')
  }
  return current
}

export const assertSafeGenerationPointer = async (pointerPath: string) => {
  const identity = await readPathIdentity(pointerPath)
  if (identity != null && (identity.isSymbolicLink || !identity.isFile)) {
    throw new Error(`Adapter account generation pointer must be a real file: ${pointerPath}`)
  }
  return identity
}

export const publishAccountGeneration = async (params: {
  generation: string
  storage: AccountStorageContext
  validate: () => Promise<void>
}) => {
  const tempPointerPath = resolve(
    params.storage.accountStateDir,
    `.${ACCOUNT_POINTER_FILENAME}.${process.pid}.${randomUUID()}.tmp`
  )
  try {
    await writePrivateArtifact(tempPointerPath, `${params.generation}\n`)
    await params.validate()
    await assertSafeGenerationPointer(params.storage.currentPointerPath)
    await rename(tempPointerPath, params.storage.currentPointerPath)
    await syncDirectory(params.storage.accountStateDir)
  } finally {
    await rm(tempPointerPath, { force: true }).catch(() => undefined)
  }
}
