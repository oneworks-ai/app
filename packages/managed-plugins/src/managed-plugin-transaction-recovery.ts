import { lstat } from 'node:fs/promises'

import {
  getFreshManagedPluginTransactionPath,
  isolatePromotionAndRestoreBackupSync,
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
  removeManagedPluginTransactionJournal
} from './managed-plugin-transaction-journal'

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
  afterCleanupPoint?: (
    point: ManagedPluginRecoveryCleanupPoint
  ) => Promise<void> | void
  beforeQuarantine?: (directory: string) => Promise<void> | void
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
  const journal = await readManagedPluginTransactionJournal(params.installDir)
  if (journal == null) return
  if (journal.identity !== params.identity) {
    throw new Error('Managed plugin transaction journal belongs to a different plugin.')
  }
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
