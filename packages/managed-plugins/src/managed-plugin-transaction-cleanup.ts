import { lstat } from 'node:fs/promises'

import { removeOwnedManagedPluginDirectorySync } from './managed-plugin-filesystem'
import {
  assertManagedPluginInstallIdentity,
  hasManagedPluginTransactionMarker,
  readManagedPluginInstallState
} from './managed-plugin-install-state'
import type { ManagedPluginTransactionJournal } from './managed-plugin-transaction-journal'

const pathExists = async (target: string) =>
  lstat(target)
    .then(() => true)
    .catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    })

const assertRevision = (
  actual: string,
  expected: string,
  message: string
) => {
  if (actual !== expected) throw new Error(message)
}

export interface ManagedPluginCleanupOperations {
  beforeQuarantine?: (directory: string) => Promise<void> | void
}

export const removeVerifiedManagedPluginStaging = async (
  stagingDir: string,
  journal: ManagedPluginTransactionJournal,
  operations?: ManagedPluginCleanupOperations
) => {
  if (!await pathExists(stagingDir)) return
  const marker = {
    identity: journal.identity,
    transactionId: journal.transactionId,
    version: 1 as const
  }
  if (!await hasManagedPluginTransactionMarker(stagingDir, marker)) {
    throw new Error('Managed plugin transaction staging ownership is invalid.')
  }
  const state = await readManagedPluginInstallState(stagingDir)
  assertManagedPluginInstallIdentity(state, journal.identity)
  assertRevision(state.revision, journal.newRevision, 'Managed plugin transaction staging revision changed.')
  if (state.rootIdentity == null) {
    throw new Error('Managed plugin transaction staging ownership proof is missing.')
  }
  await operations?.beforeQuarantine?.(stagingDir)
  removeOwnedManagedPluginDirectorySync({
    identity: state.rootIdentity,
    installDir: stagingDir,
    source: stagingDir,
    transactionId: journal.transactionId
  })
}

export const removeVerifiedManagedPluginBackup = async (
  backupDir: string,
  journal: ManagedPluginTransactionJournal,
  operations?: ManagedPluginCleanupOperations
) => {
  if (!await pathExists(backupDir)) return
  if (journal.previousRevision === 'absent') {
    throw new Error('Managed plugin transaction has an unexpected backup.')
  }
  const state = await readManagedPluginInstallState(backupDir)
  assertManagedPluginInstallIdentity(state, journal.identity)
  assertRevision(state.revision, journal.previousRevision, 'Managed plugin transaction backup revision changed.')
  if (state.rootIdentity == null) {
    throw new Error('Managed plugin transaction backup ownership proof is missing.')
  }
  await operations?.beforeQuarantine?.(backupDir)
  removeOwnedManagedPluginDirectorySync({
    identity: state.rootIdentity,
    installDir: backupDir,
    source: backupDir,
    transactionId: journal.transactionId
  })
}
