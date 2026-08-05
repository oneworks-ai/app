import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

import {
  assertManagedPluginDirectoryAnchor,
  assertManagedPluginTreeIdentity,
  readManagedPluginDirectoryAnchor,
  toManagedPluginTreeIdentity
} from './managed-plugin-tree-identity'
import type { ManagedPluginDirectoryAnchor, ManagedPluginTreeIdentity } from './managed-plugin-tree-identity'
import { inspectManagedPluginRegularFile, syncManagedPluginDirectory } from './managed-plugin-tree-io'

const MAX_TREE_DEPTH = 32
const MAX_TREE_ENTRIES = 8_192
const MAX_TREE_PATH_BYTES = 1_024
const MAX_TREE_FILE_BYTES = 128 * 1024 * 1024
const MAX_TREE_TOTAL_BYTES = 512 * 1024 * 1024
const TRANSACTION_MARKER_FILE = '.oneworks-install-transaction.json'

export interface ManagedPluginTreeProof {
  digest: string
  entries: number
  rootIdentity: ManagedPluginTreeIdentity
  totalBytes: number
}

export type { ManagedPluginTreeIdentity } from './managed-plugin-tree-identity'

export type ManagedPluginTreeBoundary =
  | 'directory-read'
  | 'directory-sync'
  | 'file-open'

interface TreeInspectionOptions {
  beforeBoundary?: (
    boundary: ManagedPluginTreeBoundary,
    target: string
  ) => Promise<void> | void
  sync?: boolean
}

const assertSafeRelativePath = (relativePath: string, depth: number) => {
  if (
    depth > MAX_TREE_DEPTH ||
    Buffer.byteLength(relativePath, 'utf8') > MAX_TREE_PATH_BYTES
  ) {
    throw new Error('Managed plugin install tree exceeds its safety limits.')
  }
}

export const inspectManagedPluginTree = async (
  root: string,
  options: TreeInspectionOptions = {}
): Promise<ManagedPluginTreeProof> => {
  const treeHash = createHash('sha256')
  const directories: ManagedPluginDirectoryAnchor[] = []
  let entries = 0
  let totalBytes = 0

  const visit = async (
    directory: string,
    relativeDirectory: string,
    depth: number,
    expected?: ManagedPluginDirectoryAnchor,
    parent?: ManagedPluginDirectoryAnchor
  ): Promise<void> => {
    assertSafeRelativePath(relativeDirectory, depth)
    await options.beforeBoundary?.('directory-read', directory)
    const anchor = readManagedPluginDirectoryAnchor(directory, parent)
    if (
      expected != null &&
      (anchor.device !== expected.device || anchor.inode !== expected.inode)
    ) {
      throw new Error('Managed plugin install directory changed during inspection.')
    }
    entries += 1
    if (entries > MAX_TREE_ENTRIES) {
      throw new Error('Managed plugin install tree exceeds its safety limits.')
    }
    const directoryStat = lstatSync(directory)
    treeHash.update(`d\0${relativeDirectory}\0${directoryStat.mode}\0`)
    directories.push(anchor)

    const children = await readdir(directory, { withFileTypes: true })
    assertManagedPluginDirectoryAnchor(anchor)
    children.sort((left, right) => left.name.localeCompare(right.name))
    for (const child of children) {
      const relativePath = relativeDirectory === '.'
        ? child.name
        : `${relativeDirectory}/${child.name}`
      assertSafeRelativePath(relativePath, depth + 1)
      const target = path.join(directory, child.name)
      assertManagedPluginDirectoryAnchor(anchor)
      const targetStat = lstatSync(target)
      if (targetStat.isSymbolicLink()) {
        throw new Error('Managed plugin install tree contains a symbolic link.')
      }
      if (targetStat.isDirectory()) {
        const childAnchor = readManagedPluginDirectoryAnchor(target, anchor)
        await visit(target, relativePath, depth + 1, childAnchor, anchor)
        continue
      }
      if (!targetStat.isFile()) {
        throw new Error('Managed plugin install tree contains an unsupported entry.')
      }
      entries += 1
      totalBytes += targetStat.size
      if (
        entries > MAX_TREE_ENTRIES ||
        targetStat.size > MAX_TREE_FILE_BYTES ||
        totalBytes > MAX_TREE_TOTAL_BYTES
      ) {
        throw new Error('Managed plugin install tree exceeds its safety limits.')
      }
      await options.beforeBoundary?.('file-open', target)
      assertManagedPluginDirectoryAnchor(anchor)
      const finalTargetStat = lstatSync(target)
      assertManagedPluginTreeIdentity(
        finalTargetStat,
        toManagedPluginTreeIdentity(targetStat, realpathSync(target)),
        'Managed plugin install file changed during inspection.'
      )
      const digest = await inspectManagedPluginRegularFile({
        expected: targetStat,
        parent: anchor,
        path: target,
        sync: options.sync === true
      })
      if (relativePath !== TRANSACTION_MARKER_FILE) {
        treeHash.update(`f\0${relativePath}\0${targetStat.mode}\0${targetStat.size}\0${digest}\0`)
      }
    }
    assertManagedPluginDirectoryAnchor(anchor)
  }

  await visit(root, '.', 0)
  const rootIdentity = directories[0]
  if (rootIdentity == null) {
    throw new Error('Managed plugin install tree is empty.')
  }
  if (options.sync === true) {
    for (const directory of directories.toReversed()) {
      await options.beforeBoundary?.('directory-sync', directory.path)
      await syncManagedPluginDirectory(directory)
    }
  }
  return {
    digest: treeHash.digest('hex'),
    entries,
    rootIdentity,
    totalBytes
  }
}
