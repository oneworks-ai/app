import { lstat } from 'node:fs/promises'
import path from 'node:path'

import { getFreshManagedPluginTransactionPath, removeOwnedManagedPluginDirectory } from './managed-plugin-filesystem'
import {
  assertManagedPluginInstallIdentity,
  hasManagedPluginTransactionMarker,
  readManagedPluginInstallState
} from './managed-plugin-install-state'
import { writeManagedPluginTransactionJournal } from './managed-plugin-transaction-journal'
import type {
  ManagedPluginTransactionJournal,
  ManagedPluginTransactionJournalWriteOperations
} from './managed-plugin-transaction-journal'
import type { ManagedPluginTreeIdentity } from './managed-plugin-tree-identity'

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
  afterAuthorizedDirectoryOpen?: (relativePath: string) => Promise<void> | void
  afterQuarantine?: (directory: string) => Promise<void> | void
  beforeQuarantine?: (directory: string) => Promise<void> | void
  journalWrite?: ManagedPluginTransactionJournalWriteOperations
}

const removeVerifiedManagedPluginDirectory = async (params: {
  directory: string
  identity: ManagedPluginTreeIdentity
  journal: ManagedPluginTransactionJournal
  operations?: ManagedPluginCleanupOperations
  purpose: 'backup' | 'staging'
}) => {
  const quarantine = getFreshManagedPluginTransactionPath(
    params.directory,
    params.journal.transactionId,
    'cleanup'
  )
  await writeManagedPluginTransactionJournal(
    params.directory,
    {
      ...params.journal,
      cleanup: {
        device: String(params.identity.device),
        inode: String(params.identity.inode),
        name: path.basename(quarantine),
        purpose: params.purpose
      }
    },
    params.operations?.journalWrite
  )
  await removeOwnedManagedPluginDirectory({
    afterAuthorizedDirectoryOpen: params.operations?.afterAuthorizedDirectoryOpen,
    beforeRemoval: params.operations?.afterQuarantine,
    identity: params.identity,
    quarantine,
    source: params.directory
  })
  await writeManagedPluginTransactionJournal(
    params.directory,
    { ...params.journal, cleanup: undefined },
    params.operations?.journalWrite
  )
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
  await removeVerifiedManagedPluginDirectory({
    directory: stagingDir,
    identity: state.rootIdentity,
    journal,
    operations,
    purpose: 'staging'
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
  await removeVerifiedManagedPluginDirectory({
    directory: backupDir,
    identity: state.rootIdentity,
    journal,
    operations,
    purpose: 'backup'
  })
}
