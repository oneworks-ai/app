import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { link, open, readdir } from 'node:fs/promises'
import path from 'node:path'

import { encodeRemovalRecordContent } from './managed-plugin-removal-record-content'

export const MAX_REMOVAL_JOURNAL_ENTRIES = 256
export const createRemovalRecordPublicationId = () => randomBytes(32).toString('hex')

export const assertRemovalJournalCapacity = async (directory: string, additional: number) => {
  const entries = (await readdir(directory)).filter(name => (
    /^[a-f0-9]{64}\.json$/u.test(name) ||
    /^[a-f0-9]{64}\.[a-f0-9]{64}\.receipt$/u.test(name) ||
    /^\.[a-f0-9]{64}\.[a-f0-9]{64}\.record\.tmp$/u.test(name)
  ))
  if (entries.length + additional > MAX_REMOVAL_JOURNAL_ENTRIES) {
    throw new Error('Managed plugin removal transaction history is full.')
  }
}

const syncDirectory = async (directory: string) => {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export const publishRemovalRecord = async (
  directory: string,
  operationId: string,
  publicationId: string,
  content: string
) => {
  const expected = encodeRemovalRecordContent(content)
  const target = path.join(directory, `${operationId}.json`)
  const temporary = path.join(directory, `.${operationId}.${publicationId}.record.tmp`)
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600
  )
  let identity: { device: string; inode: string }
  try {
    const { bytesWritten } = await handle.write(expected, 0, expected.length, 0)
    if (bytesWritten !== expected.length) {
      throw new Error('Managed plugin removal transaction record publication is incomplete.')
    }
    await handle.sync()
    const stats = await handle.stat()
    if (!stats.isFile() || stats.nlink !== 1 || stats.size !== expected.length) {
      throw new Error('Managed plugin removal transaction record publication is invalid.')
    }
    identity = { device: stats.dev.toString(), inode: stats.ino.toString() }
  } finally {
    await handle.close()
  }
  await link(temporary, target)
  const published = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  const retained = await open(temporary, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stats = await published.stat()
    const retainedStats = await retained.stat()
    if (
      !stats.isFile() || !retainedStats.isFile() || stats.nlink !== 2 || retainedStats.nlink !== 2 ||
      stats.size !== expected.length || retainedStats.size !== expected.length ||
      stats.dev.toString() !== identity.device || stats.ino.toString() !== identity.inode ||
      retainedStats.dev !== stats.dev || retainedStats.ino !== stats.ino
    ) throw new Error('Managed plugin removal transaction record publication is invalid.')
    const actual = Buffer.alloc(expected.length)
    const { bytesRead } = await published.read(actual, 0, actual.length, 0)
    if (bytesRead !== actual.length || !actual.equals(expected)) {
      throw new Error('Managed plugin removal transaction record publication is invalid.')
    }
  } finally {
    await Promise.all([published.close(), retained.close()])
  }
  await syncDirectory(directory)
}

export const validateRemovalRecordPublication = async (params: {
  device: string
  directory: string
  inode: string
  operationId: string
  publicationId: string
  size: number
}) => {
  const retained = await open(
    path.join(params.directory, `.${params.operationId}.${params.publicationId}.record.tmp`),
    constants.O_RDONLY | constants.O_NOFOLLOW
  )
  try {
    const stats = await retained.stat()
    if (
      !stats.isFile() || stats.nlink !== 2 || stats.size !== params.size ||
      stats.dev.toString() !== params.device || stats.ino.toString() !== params.inode
    ) throw new Error('Managed plugin removal transaction record publication is invalid.')
  } finally {
    await retained.close()
  }
}
