import { lstat } from 'node:fs/promises'

import { withDirectoryInstallLock } from '@oneworks/utils/install-lock'

import { renameOwnedManagedPluginDirectorySync } from './managed-plugin-filesystem'
import {
  assertManagedPluginInstallIdentity,
  hasManagedPluginTransactionMarker,
  readManagedPluginInstallState
} from './managed-plugin-install-state'
import { removeVerifiedManagedPluginStaging } from './managed-plugin-transaction-cleanup'
import {
  getManagedPluginTransactionDirectories,
  getManagedPluginTransactionPaths,
  syncManagedPluginTransactionParent,
  writeManagedPluginTransactionJournal
} from './managed-plugin-transaction-journal'
import type {
  ManagedPluginTransactionJournal,
  ManagedPluginTransactionPhase
} from './managed-plugin-transaction-journal'
import { recoverManagedPluginInstallTransaction } from './managed-plugin-transaction-recovery'

export { recoverManagedPluginInstallTransaction } from './managed-plugin-transaction-recovery'

export type ManagedPluginDurabilityPoint =
  | ManagedPluginTransactionPhase
  | 'cleanup-complete'
  | 'cleanup-started'
  | 'new-renamed'
  | 'old-renamed'
  | 'payload-synced'

export interface ManagedPluginDurabilityOperations {
  afterDurablePoint?: (
    point: ManagedPluginDurabilityPoint
  ) => Promise<void> | void
}

export class ManagedPluginTransactionCrash extends Error {
  constructor(public readonly phase: ManagedPluginDurabilityPoint) {
    super(`Simulated managed plugin transaction crash after ${phase}.`)
    this.name = 'ManagedPluginTransactionCrash'
  }
}

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

const reachDurabilityPoint = async (params: {
  crashAfter?: ManagedPluginDurabilityPoint
  operations?: ManagedPluginDurabilityOperations
}, point: ManagedPluginDurabilityPoint) => {
  await params.operations?.afterDurablePoint?.(point)
  if (params.crashAfter === point) {
    throw new ManagedPluginTransactionCrash(point)
  }
}

const withTransactionLock = async <T>(
  installDir: string,
  callback: () => Promise<T>
) => {
  const { lockDir } = getManagedPluginTransactionPaths(installDir)
  return withDirectoryInstallLock({ lockDir }, callback)
}

export const captureManagedPluginInstallRevision = async (params: {
  force: boolean
  identity: string
  installDir: string
}) =>
  withTransactionLock(params.installDir, async () => {
    await recoverManagedPluginInstallTransaction(params)
    const state = await readManagedPluginInstallState(params.installDir)
    assertManagedPluginInstallIdentity(state, params.identity)
    if (state.exists && !params.force) {
      throw new Error('Managed plugin is already installed. Use --force to replace it.')
    }
    return state.revision
  })

export const commitManagedPluginInstall = async (params: {
  crashAfter?: ManagedPluginDurabilityPoint
  expectedRevision: string
  identity: string
  installDir: string
  newRevision: string
  operations?: ManagedPluginDurabilityOperations
  stagingDir: string
  transactionId: string
}) =>
  withTransactionLock(params.installDir, async () => {
    const recover = () =>
      recoverManagedPluginInstallTransaction({
        identity: params.identity,
        installDir: params.installDir
      })
    await recover()
    const expectedDirectories = getManagedPluginTransactionDirectories(
      params.installDir,
      params.transactionId
    )
    if (expectedDirectories.stagingDir !== params.stagingDir) {
      throw new Error('Managed plugin transaction staging path is invalid.')
    }
    const journal: ManagedPluginTransactionJournal = {
      backupName: `.install-backup-${params.transactionId}`,
      identity: params.identity,
      newRevision: params.newRevision,
      phase: 'prepared',
      previousRevision: params.expectedRevision,
      stagingName: `.install-staging-${params.transactionId}`,
      transactionId: params.transactionId,
      version: 1
    }
    let journalWritten = false
    try {
      if (await pathExists(expectedDirectories.backupDir)) {
        throw new Error('Managed plugin transaction backup path is already occupied.')
      }
      const staged = await readManagedPluginInstallState(params.stagingDir, {
        syncTree: true
      })
      assertManagedPluginInstallIdentity(staged, params.identity)
      assertRevision(staged.revision, params.newRevision, 'Managed plugin staged revision is invalid.')
      const marker = { identity: params.identity, transactionId: params.transactionId, version: 1 as const }
      if (!await hasManagedPluginTransactionMarker(params.stagingDir, marker)) {
        throw new Error('Managed plugin transaction staging ownership is invalid.')
      }
      await reachDurabilityPoint(params, 'payload-synced')
      const current = await readManagedPluginInstallState(params.installDir)
      assertManagedPluginInstallIdentity(current, params.identity)
      assertRevision(current.revision, params.expectedRevision, 'Managed plugin install changed during staging.')
      await writeManagedPluginTransactionJournal(params.installDir, journal)
      journalWritten = true
      await reachDurabilityPoint(params, 'prepared')
      if (current.exists) {
        if (current.rootIdentity == null) {
          throw new Error('Managed plugin current install ownership proof is missing.')
        }
        renameOwnedManagedPluginDirectorySync({
          destination: expectedDirectories.backupDir,
          identity: current.rootIdentity,
          source: params.installDir
        })
        await reachDurabilityPoint(params, 'old-renamed')
      }
      journal.phase = 'old-quarantined'
      await writeManagedPluginTransactionJournal(params.installDir, journal)
      await reachDurabilityPoint(params, journal.phase)
      if (staged.rootIdentity == null) {
        throw new Error('Managed plugin staged install ownership proof is missing.')
      }
      renameOwnedManagedPluginDirectorySync({
        destination: params.installDir,
        identity: staged.rootIdentity,
        source: params.stagingDir
      })
      await reachDurabilityPoint(params, 'new-renamed')
      journal.phase = 'new-promoted'
      await writeManagedPluginTransactionJournal(params.installDir, journal)
      await reachDurabilityPoint(params, journal.phase)
      await reachDurabilityPoint(params, 'cleanup-started')
      await recover()
      await reachDurabilityPoint(params, 'cleanup-complete')
    } catch (error) {
      if (!(error instanceof ManagedPluginTransactionCrash)) {
        if (journalWritten) {
          await recover()
        } else {
          await removeVerifiedManagedPluginStaging(params.stagingDir, journal)
          await syncManagedPluginTransactionParent(params.installDir)
        }
      }
      throw error
    }
  })
