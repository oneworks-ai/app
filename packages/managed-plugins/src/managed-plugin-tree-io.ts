import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import type { Stats } from 'node:fs'
import { open } from 'node:fs/promises'

import { assertManagedPluginDirectoryAnchor, assertManagedPluginTreeIdentity } from './managed-plugin-tree-identity'
import type { ManagedPluginDirectoryAnchor } from './managed-plugin-tree-identity'

const READ_BUFFER_BYTES = 64 * 1024

export const inspectManagedPluginRegularFile = async (params: {
  expected: Stats
  parent: ManagedPluginDirectoryAnchor
  path: string
  sync: boolean
}) => {
  assertManagedPluginDirectoryAnchor(params.parent)
  const handle = await open(
    params.path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  )
  try {
    const stat = await handle.stat()
    if (
      !stat.isFile() ||
      stat.dev !== params.expected.dev ||
      stat.ino !== params.expected.ino ||
      stat.size !== params.expected.size
    ) {
      throw new Error('Managed plugin install file changed during inspection.')
    }
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES)
    let offset = 0
    while (offset < stat.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, stat.size - offset),
        offset
      )
      if (bytesRead === 0) {
        throw new Error('Managed plugin install file changed during inspection.')
      }
      hash.update(buffer.subarray(0, bytesRead))
      offset += bytesRead
    }
    if (params.sync) await handle.sync()
    return hash.digest('hex')
  } finally {
    await handle.close()
  }
}

export const syncManagedPluginDirectory = async (
  anchor: ManagedPluginDirectoryAnchor
) => {
  assertManagedPluginDirectoryAnchor(anchor)
  const handle = await open(
    anchor.path,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0)
  )
  try {
    const stat = await handle.stat()
    assertManagedPluginTreeIdentity(
      stat,
      anchor,
      'Managed plugin install directory changed before sync.'
    )
    await handle.sync()
  } finally {
    await handle.close()
  }
  assertManagedPluginDirectoryAnchor(anchor)
}
