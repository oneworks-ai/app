import { randomUUID } from 'node:crypto'
import { closeSync, fstatSync, fsyncSync, realpathSync, renameSync } from 'node:fs'
import path from 'node:path'

import { removeVerifiedManagedPluginDirectoryTree } from './managed-plugin-directory-removal'
import {
  assertManagedPluginFilesystemIdentity,
  managedPluginPathDoesNotExist,
  openVerifiedManagedPluginDirectory,
  openVerifiedManagedPluginParent,
  verifyRenamedManagedPluginDirectory
} from './managed-plugin-filesystem-identity'
import type { ManagedPluginTreeIdentity } from './managed-plugin-tree-identity'

export const getFreshManagedPluginTransactionPath = (
  installDir: string,
  transactionId: string,
  purpose: 'cleanup' | 'conflict'
) =>
  path.join(
    path.dirname(installDir),
    `.install-${purpose}-${transactionId}-${randomUUID()}`
  )

export const renameOwnedManagedPluginDirectorySync = (params: {
  destination: string
  identity: ManagedPluginTreeIdentity
  source: string
}) => {
  if (!managedPluginPathDoesNotExist(params.destination)) {
    throw new Error('Managed plugin transaction destination is already occupied.')
  }
  const parent = openVerifiedManagedPluginParent(params.source, params.destination)
  const sourceDescriptor = openVerifiedManagedPluginDirectory(
    params.source,
    params.identity,
    params.identity.realPath
  )
  try {
    renameSync(params.source, params.destination)
    fsyncSync(parent.descriptor)
    verifyRenamedManagedPluginDirectory(params.destination, params.identity, parent.parentRealPath)
    assertManagedPluginFilesystemIdentity(
      fstatSync(sourceDescriptor),
      params.identity,
      'Managed plugin owned directory changed across rename.'
    )
  } finally {
    closeSync(sourceDescriptor)
    closeSync(parent.descriptor)
  }
}

export const removeQuarantinedManagedPluginDirectory = async (params: {
  afterAuthorizedDirectoryOpen?: (relativePath: string) => Promise<void> | void
  beforeRemoval?: (directory: string) => Promise<void> | void
  identity: ManagedPluginTreeIdentity
  quarantine: string
}) => {
  const quarantineIdentity = {
    ...params.identity,
    realPath: realpathSync(params.quarantine)
  }
  await params.beforeRemoval?.(params.quarantine)
  const parent = openVerifiedManagedPluginParent(params.quarantine, params.quarantine)
  const descriptor = openVerifiedManagedPluginDirectory(
    params.quarantine,
    quarantineIdentity,
    quarantineIdentity.realPath
  )
  try {
    assertManagedPluginFilesystemIdentity(
      fstatSync(descriptor),
      quarantineIdentity,
      'Managed plugin cleanup quarantine changed before removal.'
    )
    await removeVerifiedManagedPluginDirectoryTree({
      descriptor,
      identity: quarantineIdentity,
      operations: {
        afterDirectoryOpen: params.afterAuthorizedDirectoryOpen
      },
      parentDescriptor: parent.descriptor,
      root: params.quarantine
    })
    fsyncSync(parent.descriptor)
  } finally {
    closeSync(descriptor)
    closeSync(parent.descriptor)
  }
}

export const removeOwnedManagedPluginDirectory = async (params: {
  afterAuthorizedDirectoryOpen?: (relativePath: string) => Promise<void> | void
  beforeRemoval?: (directory: string) => Promise<void> | void
  identity: ManagedPluginTreeIdentity
  quarantine: string
  source: string
}) => {
  renameOwnedManagedPluginDirectorySync({
    destination: params.quarantine,
    identity: params.identity,
    source: params.source
  })
  await removeQuarantinedManagedPluginDirectory(params)
}

export const isolatePromotionAndRestoreBackupSync = (params: {
  backupIdentity: ManagedPluginTreeIdentity
  backupSource: string
  conflictDestination: string
  installDir: string
  promotedIdentity: ManagedPluginTreeIdentity
}) => {
  if (!managedPluginPathDoesNotExist(params.conflictDestination)) {
    throw new Error('Managed plugin recovery conflict destination is occupied.')
  }
  const parent = openVerifiedManagedPluginParent(params.installDir, params.conflictDestination)
  if (path.dirname(params.backupSource) !== path.dirname(params.installDir)) {
    closeSync(parent.descriptor)
    throw new Error('Managed plugin recovery backup escaped its transaction parent.')
  }
  const promotedDescriptor = openVerifiedManagedPluginDirectory(
    params.installDir,
    params.promotedIdentity,
    params.promotedIdentity.realPath
  )
  const backupDescriptor = openVerifiedManagedPluginDirectory(
    params.backupSource,
    params.backupIdentity,
    params.backupIdentity.realPath
  )
  try {
    renameSync(params.installDir, params.conflictDestination)
    fsyncSync(parent.descriptor)
    verifyRenamedManagedPluginDirectory(
      params.conflictDestination,
      params.promotedIdentity,
      parent.parentRealPath
    )
    renameSync(params.backupSource, params.installDir)
    fsyncSync(parent.descriptor)
    verifyRenamedManagedPluginDirectory(params.installDir, params.backupIdentity, parent.parentRealPath)
    assertManagedPluginFilesystemIdentity(
      fstatSync(promotedDescriptor),
      params.promotedIdentity,
      'Managed plugin promoted content changed while it was isolated.'
    )
    assertManagedPluginFilesystemIdentity(
      fstatSync(backupDescriptor),
      params.backupIdentity,
      'Managed plugin backup changed while it was restored.'
    )
  } finally {
    closeSync(backupDescriptor)
    closeSync(promotedDescriptor)
    closeSync(parent.descriptor)
  }
}
