import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync } from 'node:fs'
import path from 'node:path'

import type { ManagedPluginTreeIdentity } from './managed-plugin-tree-identity'

const ownedDirectoryFlags = () => {
  if (constants.O_DIRECTORY == null || constants.O_NOFOLLOW == null) {
    throw new Error('Safe managed plugin directory ownership operations are unsupported on this platform.')
  }
  return constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
}

export const managedPluginPathDoesNotExist = (target: string) => {
  try {
    lstatSync(target)
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw error
  }
}

export const assertManagedPluginFilesystemIdentity = (
  actual: { dev: number; ino: number },
  expected: ManagedPluginTreeIdentity,
  message: string
) => {
  if (actual.dev !== expected.device || actual.ino !== expected.inode) {
    throw new Error(message)
  }
}

export const openVerifiedManagedPluginDirectory = (
  target: string,
  expected: ManagedPluginTreeIdentity,
  expectedRealPath: string
) => {
  const pathStat = lstatSync(target)
  if (!pathStat.isDirectory() || pathStat.isSymbolicLink()) {
    throw new Error('Managed plugin owned directory changed before mutation.')
  }
  assertManagedPluginFilesystemIdentity(
    pathStat,
    expected,
    'Managed plugin owned directory changed before mutation.'
  )
  if (realpathSync(target) !== expectedRealPath) {
    throw new Error('Managed plugin owned directory changed before mutation.')
  }
  const descriptor = openSync(target, ownedDirectoryFlags())
  try {
    const descriptorStat = fstatSync(descriptor)
    if (!descriptorStat.isDirectory()) {
      throw new Error('Managed plugin owned directory changed before mutation.')
    }
    assertManagedPluginFilesystemIdentity(
      descriptorStat,
      expected,
      'Managed plugin owned directory changed before mutation.'
    )
    return descriptor
  } catch (error) {
    closeSync(descriptor)
    throw error
  }
}

export const openVerifiedManagedPluginParent = (
  source: string,
  destination: string
) => {
  const sourceParent = path.dirname(source)
  if (sourceParent !== path.dirname(destination)) {
    throw new Error('Managed plugin transaction mutation must stay within one parent directory.')
  }
  const parentStat = lstatSync(sourceParent)
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error('Managed plugin transaction parent is unsafe.')
  }
  const parentRealPath = realpathSync(sourceParent)
  const descriptor = openSync(sourceParent, ownedDirectoryFlags())
  try {
    assertManagedPluginFilesystemIdentity(
      fstatSync(descriptor),
      {
        device: parentStat.dev,
        inode: parentStat.ino,
        realPath: parentRealPath
      },
      'Managed plugin transaction parent changed before mutation.'
    )
    return { descriptor, parentRealPath }
  } catch (error) {
    closeSync(descriptor)
    throw error
  }
}

export const verifyRenamedManagedPluginDirectory = (
  destination: string,
  expected: ManagedPluginTreeIdentity,
  parentRealPath: string
) => {
  const destinationRealPath = realpathSync(destination)
  if (path.dirname(destinationRealPath) !== parentRealPath) {
    throw new Error('Managed plugin transaction destination escaped its verified parent.')
  }
  const destinationStat = lstatSync(destination)
  if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
    throw new Error('Managed plugin transaction destination changed after rename.')
  }
  assertManagedPluginFilesystemIdentity(
    destinationStat,
    expected,
    'Managed plugin transaction destination changed after rename.'
  )
}

export const readOwnedManagedPluginDirectoryIdentitySync = (
  target: string
): ManagedPluginTreeIdentity => {
  const stat = lstatSync(target)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Managed plugin owned directory is unsafe.')
  }
  return {
    device: stat.dev,
    inode: stat.ino,
    realPath: realpathSync(target)
  }
}
