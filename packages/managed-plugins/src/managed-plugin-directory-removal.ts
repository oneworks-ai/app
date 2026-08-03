import { fstatSync } from 'node:fs'
import path from 'node:path'

import { removeDirectoryTreeAtAuthorizedParent } from '@oneworks/utils/filesystem-authority'
import type { FilesystemAuthorityOperations } from '@oneworks/utils/filesystem-authority'

import { assertManagedPluginFilesystemIdentity } from './managed-plugin-filesystem-identity'
import type { ManagedPluginTreeIdentity } from './managed-plugin-tree-identity'

export const removeVerifiedManagedPluginDirectoryTree = async (params: {
  descriptor: number
  identity: ManagedPluginTreeIdentity
  operations?: FilesystemAuthorityOperations
  parentDescriptor: number
  root: string
}) => {
  const descriptorIdentity = fstatSync(params.descriptor)
  assertManagedPluginFilesystemIdentity(
    descriptorIdentity,
    params.identity,
    'Managed plugin cleanup quarantine changed before removal.'
  )
  const parentIdentity = fstatSync(params.parentDescriptor)
  if (!parentIdentity.isDirectory()) {
    throw new Error('Managed plugin cleanup parent changed before removal.')
  }
  await removeDirectoryTreeAtAuthorizedParent({
    operations: params.operations,
    parentDirectory: path.dirname(params.root),
    parentIdentity: {
      device: parentIdentity.dev,
      inode: parentIdentity.ino
    },
    rootIdentity: {
      device: descriptorIdentity.dev,
      inode: descriptorIdentity.ino
    },
    rootName: path.basename(params.root)
  })
}
