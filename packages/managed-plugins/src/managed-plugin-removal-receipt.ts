import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import path from 'node:path'

const RECEIPT_BYTES = 64
const receiptContent = (state: 'pending' | 'removed' | 'restored') => {
  const content = Buffer.alloc(RECEIPT_BYTES)
  content.write(`oneworks-managed-removal-v1:${state}`, 'utf8')
  return content
}

export interface ManagedPluginRemovalReceiptBinding {
  device: string
  id: string
  inode: string
}

const receiptPath = (
  directory: string,
  operationId: string,
  receipt: ManagedPluginRemovalReceiptBinding
) => path.join(directory, `${operationId}.${receipt.id}.receipt`)

const syncDirectory = async (directory: string) => {
  const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {
    await parent.sync()
  } finally {
    await parent.close()
  }
}

const assertBoundReceipt = async (
  handle: Awaited<ReturnType<typeof open>>,
  receipt: ManagedPluginRemovalReceiptBinding
) => {
  const stats = await handle.stat()
  if (
    !stats.isFile() || stats.nlink !== 1 ||
    stats.dev.toString() !== receipt.device || stats.ino.toString() !== receipt.inode
  ) throw new Error('Managed plugin removal receipt identity is invalid.')
  return stats
}

const readReceipt = async (
  handle: Awaited<ReturnType<typeof open>>,
  receipt: ManagedPluginRemovalReceiptBinding
) => {
  const stats = await assertBoundReceipt(handle, receipt)
  if (stats.size !== RECEIPT_BYTES) {
    throw new Error('Managed plugin removal receipt size is invalid.')
  }
  const content = Buffer.alloc(RECEIPT_BYTES)
  const { bytesRead } = await handle.read(content, 0, RECEIPT_BYTES, 0)
  if (bytesRead !== RECEIPT_BYTES) {
    throw new Error('Managed plugin removal receipt size is invalid.')
  }
  return content
}

export const reserveRemovalReceipt = async (
  directory: string,
  operationId: string
): Promise<ManagedPluginRemovalReceiptBinding> => {
  const id = randomBytes(32).toString('hex')
  const target = path.join(directory, `${operationId}.${id}.receipt`)
  const handle = await open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600
  )
  let receipt: ManagedPluginRemovalReceiptBinding
  try {
    const { bytesWritten } = await handle.write(receiptContent('pending'), 0, RECEIPT_BYTES, 0)
    if (bytesWritten !== RECEIPT_BYTES) {
      throw new Error('Managed plugin removal receipt reservation is incomplete.')
    }
    await handle.sync()
    const stats = await handle.stat()
    if (!stats.isFile() || stats.nlink !== 1) {
      throw new Error('Managed plugin removal receipt identity is invalid.')
    }
    receipt = { device: stats.dev.toString(), id, inode: stats.ino.toString() }
  } finally {
    await handle.close()
  }
  await syncDirectory(directory)
  return receipt
}

export const hasBoundRemovalReceipt = async (
  directory: string,
  operationId: string,
  receipt: ManagedPluginRemovalReceiptBinding,
  result: 'removed' | 'restored'
) => {
  const handle = await open(
    receiptPath(directory, operationId, receipt),
    constants.O_RDONLY | constants.O_NOFOLLOW
  )
  try {
    const content = await readReceipt(handle, receipt)
    if (content.equals(receiptContent('pending'))) return false
    if (content.equals(receiptContent('removed')) || content.equals(receiptContent('restored'))) {
      return content.equals(receiptContent(result))
    }
    return false
  } finally {
    await handle.close()
  }
}

export const writeBoundRemovalReceipt = async (
  directory: string,
  operationId: string,
  receipt: ManagedPluginRemovalReceiptBinding,
  result: 'removed' | 'restored'
) => {
  const handle = await open(
    receiptPath(directory, operationId, receipt),
    constants.O_RDWR | constants.O_NOFOLLOW
  )
  try {
    const current = await readReceipt(handle, receipt)
    const expected = receiptContent(result)
    const opposite = receiptContent(result === 'removed' ? 'restored' : 'removed')
    if (current.equals(opposite)) throw new Error('Managed plugin removal receipt result is immutable.')
    if (!current.equals(expected)) {
      const { bytesWritten } = await handle.write(expected, 0, RECEIPT_BYTES, 0)
      if (bytesWritten !== RECEIPT_BYTES) {
        throw new Error('Managed plugin removal receipt write is incomplete.')
      }
    }
    await handle.sync()
  } finally {
    await handle.close()
  }
  await syncDirectory(directory)
}
