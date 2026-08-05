/* eslint-disable max-lines -- recovery ordering and cleanup authority share one transaction state machine */
import { realpathSync } from 'node:fs'
import { lstat } from 'node:fs/promises'
import path from 'node:path'

import {
  getFreshManagedPluginTransactionPath,
  isolatePromotionAndRestoreBackupSync,
  removeQuarantinedManagedPluginDirectory,
  renameOwnedManagedPluginDirectorySync
} from './managed-plugin-filesystem'
import { readOwnedManagedPluginDirectoryIdentitySync } from './managed-plugin-filesystem-identity'
import {
  assertManagedPluginInstallIdentity,
  getManagedPluginTransactionMarkerStatus,
  readManagedPluginInstallState,
  removeManagedPluginTransactionMarker
} from './managed-plugin-install-state'
import {
  removeVerifiedManagedPluginBackup,
  removeVerifiedManagedPluginStaging
} from './managed-plugin-transaction-cleanup'
import {
  getManagedPluginTransactionDirectories,
  readManagedPluginTransactionJournal,
  removeManagedPluginTransactionJournal,
  writeManagedPluginTransactionJournal
} from './managed-plugin-transaction-journal'
import type { ManagedPluginTransactionJournalWriteOperations } from './managed-plugin-transaction-journal'

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

export type ManagedPluginRecoveryCleanupPoint =
  | 'backup-cleaned'
  | 'journal-removed'
  | 'marker-removed'
  | 'staging-cleaned'

export interface ManagedPluginRecoveryOperations {
  afterAuthorizedDirectoryOpen?: (relativePath: string) => Promise<void> | void
  afterQuarantine?: (directory: string) => void
  afterCleanupPoint?: (
    point: ManagedPluginRecoveryCleanupPoint
  ) => Promise<void> | void
  beforeQuarantine?: (directory: string) => Promise<void> | void
  journalWrite?: ManagedPluginTransactionJournalWriteOperations
}

const resumeJournaledCleanup = async (
  installDir: string,
  journal: NonNullable<Awaited<ReturnType<typeof readManagedPluginTransactionJournal>>>,
  operations?: ManagedPluginRecoveryOperations
) => {
  if (journal.cleanup == null) return journal
  const quarantine = path.join(path.dirname(installDir), journal.cleanup.name)
  if (await pathExists(quarantine)) {
    const device = Number(journal.cleanup.device)
    const inode = Number(journal.cleanup.inode)
    if (!Number.isSafeInteger(device) || !Number.isSafeInteger(inode)) {
      throw new TypeError('Managed plugin cleanup journal identity is unsupported.')
    }
    await removeQuarantinedManagedPluginDirectory({
      afterAuthorizedDirectoryOpen: operations?.afterAuthorizedDirectoryOpen,
      identity: {
        device,
        inode,
        realPath: realpathSync(quarantine)
      },
      quarantine
    })
  }
  const cleared = { ...journal, cleanup: undefined }
  await writeManagedPluginTransactionJournal(installDir, cleared, operations?.journalWrite)
  return cleared
}

const readExpectedInstall = async (params: {
  directory: string
  identity: string
  revision: string
  unsafeMessage: string
}) => {
  const state = await readManagedPluginInstallState(params.directory)
  assertManagedPluginInstallIdentity(state, params.identity)
  assertRevision(state.revision, params.revision, params.unsafeMessage)
  return state
}

const preserveUnsafePromotion = async (params: {
  backupDir: string
  identity: string
  installDir: string
  previousRevision: string
  promotedIdentity: ReturnType<typeof readOwnedManagedPluginDirectoryIdentitySync>
  transactionId: string
}) => {
  const conflictDestination = getFreshManagedPluginTransactionPath(
    params.installDir,
    params.transactionId,
    'conflict'
  )
  if (params.previousRevision === 'absent') {
    if (await pathExists(params.backupDir)) {
      throw new Error('Managed plugin recovery found an unexpected backup.')
    }
    renameOwnedManagedPluginDirectorySync({
      destination: conflictDestination,
      identity: params.promotedIdentity,
      source: params.installDir
    })
  } else {
    const backup = await readExpectedInstall({
      directory: params.backupDir,
      identity: params.identity,
      revision: params.previousRevision,
      unsafeMessage: 'Managed plugin backup changed before recovery.'
    })
    if (backup.rootIdentity == null) {
      throw new Error('Managed plugin recovery backup ownership proof is missing.')
    }
    isolatePromotionAndRestoreBackupSync({
      backupIdentity: backup.rootIdentity,
      backupSource: params.backupDir,
      conflictDestination,
      installDir: params.installDir,
      promotedIdentity: params.promotedIdentity
    })
  }
  throw new Error('Managed plugin promoted content was preserved and the previous install was restored.')
}

export const recoverManagedPluginInstallTransaction = async (params: {
  identity: string
  installDir: string
  operations?: ManagedPluginRecoveryOperations
}) => {
  const storedJournal = await readManagedPluginTransactionJournal(params.installDir)
  if (storedJournal == null) return
  if (storedJournal.identity !== params.identity) {
    throw new Error('Managed plugin transaction journal belongs to a different plugin.')
  }
  const journal = await resumeJournaledCleanup(
    params.installDir,
    storedJournal,
    params.operations
  )
  const { backupDir, stagingDir } = getManagedPluginTransactionDirectories(
    params.installDir,
    journal.transactionId
  )
  const targetExists = await pathExists(params.installDir)
  const promotedIdentity = targetExists
    ? readOwnedManagedPluginDirectoryIdentitySync(params.installDir)
    : undefined
  const target = targetExists
    ? await readManagedPluginInstallState(params.installDir).catch(() => undefined)
    : { exists: false as const, revision: 'absent' }
  const targetOwned = target != null && (
    !target.exists || target.identity === journal.identity
  )

  if (targetOwned && target.revision === journal.newRevision) {
    const marker = {
      identity: journal.identity,
      transactionId: journal.transactionId,
      version: 1 as const
    }
    const markerStatus = await getManagedPluginTransactionMarkerStatus(params.installDir, marker)
    if (markerStatus === 'invalid') {
      throw new Error('Managed plugin promoted transaction marker changed before recovery.')
    }
    if (markerStatus === 'exact') {
      await removeManagedPluginTransactionMarker(params.installDir)
    }
    await params.operations?.afterCleanupPoint?.('marker-removed')
    await removeVerifiedManagedPluginBackup(backupDir, journal, params.operations)
    await params.operations?.afterCleanupPoint?.('backup-cleaned')
    await removeVerifiedManagedPluginStaging(stagingDir, journal, params.operations)
    await params.operations?.afterCleanupPoint?.('staging-cleaned')
    await removeManagedPluginTransactionJournal(params.installDir)
    await params.operations?.afterCleanupPoint?.('journal-removed')
    return
  }

  if (targetOwned && target.revision === journal.previousRevision) {
    await removeVerifiedManagedPluginBackup(backupDir, journal, params.operations)
  } else if (!targetExists && journal.previousRevision !== 'absent') {
    const backup = await readExpectedInstall({
      directory: backupDir,
      identity: journal.identity,
      revision: journal.previousRevision,
      unsafeMessage: 'Managed plugin backup cannot be restored.'
    })
    if (backup.rootIdentity == null) {
      throw new Error('Managed plugin recovery backup ownership proof is missing.')
    }
    renameOwnedManagedPluginDirectorySync({
      destination: params.installDir,
      identity: backup.rootIdentity,
      source: backupDir
    })
  } else if (targetExists) {
    if (promotedIdentity == null) {
      throw new Error('Managed plugin promoted ownership proof is missing.')
    }
    await params.operations?.beforeQuarantine?.(params.installDir)
    await preserveUnsafePromotion({
      backupDir,
      identity: journal.identity,
      installDir: params.installDir,
      previousRevision: journal.previousRevision,
      promotedIdentity,
      transactionId: journal.transactionId
    })
  } else if (journal.previousRevision !== 'absent') {
    throw new Error('Managed plugin transaction target revision is unsafe.')
  }
  await removeVerifiedManagedPluginStaging(stagingDir, journal, params.operations)
  await params.operations?.afterCleanupPoint?.('staging-cleaned')
  await removeManagedPluginTransactionJournal(params.installDir)
  await params.operations?.afterCleanupPoint?.('journal-removed')
}
