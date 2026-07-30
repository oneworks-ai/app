import { lstatSync, realpathSync } from 'node:fs'
import type { Stats } from 'node:fs'
import path from 'node:path'

export interface ManagedPluginTreeIdentity {
  device: number
  inode: number
  realPath: string
}

export interface ManagedPluginDirectoryAnchor extends ManagedPluginTreeIdentity {
  path: string
}

export const toManagedPluginTreeIdentity = (
  stat: Stats,
  realPath: string
): ManagedPluginTreeIdentity => ({
  device: stat.dev,
  inode: stat.ino,
  realPath
})

export const assertManagedPluginTreeIdentity = (
  stat: Stats,
  expected: ManagedPluginTreeIdentity,
  message: string
) => {
  if (stat.dev !== expected.device || stat.ino !== expected.inode) {
    throw new Error(message)
  }
}

export const readManagedPluginDirectoryAnchor = (
  directory: string,
  parent?: ManagedPluginDirectoryAnchor
): ManagedPluginDirectoryAnchor => {
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Managed plugin install tree contains an unsafe directory.')
  }
  const realPath = realpathSync(directory)
  if (parent != null && path.dirname(realPath) !== parent.realPath) {
    throw new Error('Managed plugin install directory escaped its verified parent.')
  }
  return { ...toManagedPluginTreeIdentity(stat, realPath), path: directory }
}

export const assertManagedPluginDirectoryAnchor = (
  anchor: ManagedPluginDirectoryAnchor
) => {
  const stat = lstatSync(anchor.path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Managed plugin install directory changed during inspection.')
  }
  assertManagedPluginTreeIdentity(
    stat,
    anchor,
    'Managed plugin install directory changed during inspection.'
  )
  if (realpathSync(anchor.path) !== anchor.realPath) {
    throw new Error('Managed plugin install directory changed during inspection.')
  }
}
