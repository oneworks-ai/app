import type { ManagedPluginAdapter } from '@oneworks/types'
import type { ManagedPluginInstall } from '@oneworks/utils/managed-plugin'
import { Buffer } from 'node:buffer'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  hasBoundRemovalReceipt,
  reserveRemovalReceipt,
  writeBoundRemovalReceipt
} from './managed-plugin-removal-receipt'
import type { ManagedPluginRemovalReceiptBinding } from './managed-plugin-removal-receipt'
import { MAX_REMOVAL_RECORD_BYTES, assertRemovalRecordCanBePublished } from './managed-plugin-removal-record-content'
import {
  assertRemovalJournalCapacity,
  createRemovalRecordPublicationId,
  publishRemovalRecord,
  validateRemovalRecordPublication
} from './managed-plugin-removal-record-publication'
export { MAX_REMOVAL_RECORD_BYTES } from './managed-plugin-removal-record-content'
export { MAX_REMOVAL_JOURNAL_ENTRIES } from './managed-plugin-removal-record-publication'
const JOURNAL_DIR_NAME = '.removal-transactions'
const MAX_ACTIVE_RECORDS = 64
export const validRemovalOperationId = (value: string) => /^[a-f0-9]{64}$/u.test(value)
export const isManagedPluginPathSegment = (value: unknown): value is string => (
  typeof value === 'string' && value !== '' && value !== '.' && value !== '..' &&
  path.basename(value) === value && !value.includes('/') && !value.includes('\\')
)
export interface ManagedPluginRemovalIdentity {
  adapter: ManagedPluginAdapter
  installedAt: string
  marketplace: string
  name: string
  plugin: string
  scope?: string
}
export interface ManagedPluginRemovalRecord {
  identity: ManagedPluginRemovalIdentity
  operationId: string
  parentSegments: [string, string]
  publicationId: string
  receipt: ManagedPluginRemovalReceiptBinding
  transaction: string
  version: 5
}

const isObject = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)
const hasExactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}
const isIdentity = (value: unknown): value is ManagedPluginRemovalIdentity => {
  if (!isObject(value)) return false
  const keys = ['adapter', 'installedAt', 'marketplace', 'name', 'plugin']
  if (Object.hasOwn(value, 'scope')) keys.push('scope')
  return hasExactKeys(value, keys) &&
    (value.adapter === 'claude' || value.adapter === 'codex') &&
    ['installedAt', 'marketplace', 'name', 'plugin'].every(key => (
      typeof value[key] === 'string' && value[key] !== ''
    )) && (value.scope == null || typeof value.scope === 'string')
}
const parseRecord = (value: unknown): ManagedPluginRemovalRecord => {
  if (
    !isObject(value) ||
    !hasExactKeys(
      value,
      ['identity', 'operationId', 'parentSegments', 'publicationId', 'receipt', 'transaction', 'version']
    ) ||
    value.version !== 5 || !isIdentity(value.identity) ||
    typeof value.operationId !== 'string' || !validRemovalOperationId(value.operationId) ||
    !Array.isArray(value.parentSegments) || value.parentSegments.length !== 2 ||
    !value.parentSegments.every(isManagedPluginPathSegment) ||
    typeof value.publicationId !== 'string' || !validRemovalOperationId(value.publicationId) ||
    !isObject(value.receipt) || !hasExactKeys(value.receipt, ['device', 'id', 'inode']) ||
    typeof value.receipt.device !== 'string' || !/^\d+$/u.test(value.receipt.device) ||
    typeof value.receipt.id !== 'string' || !validRemovalOperationId(value.receipt.id) ||
    typeof value.receipt.inode !== 'string' || !/^\d+$/u.test(value.receipt.inode) ||
    typeof value.transaction !== 'string' || value.transaction === '' || value.transaction.length > 32 * 1024
  ) throw new Error('Managed plugin removal transaction record is invalid.')
  return value as unknown as ManagedPluginRemovalRecord
}

const journalDir = (root: string) => path.join(root, JOURNAL_DIR_NAME)
const recordPath = (root: string, id: string) => path.join(journalDir(root), `${id}.json`)
const ensureJournalDir = async (root: string) => {
  const directory = journalDir(root)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const stats = await lstat(directory)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('Managed plugin removal transaction directory is invalid.')
  }
  return directory
}
export const readRemovalRecord = async (
  root: string,
  operationId: string,
  runtime?: { afterRecordStat?(): Promise<void> | void }
) => {
  const handle = await open(recordPath(root, operationId), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stats = await handle.stat()
    if (!stats.isFile() || stats.nlink !== 2 || stats.size <= 0 || stats.size > MAX_REMOVAL_RECORD_BYTES) {
      throw new Error('Managed plugin removal transaction record is invalid.')
    }
    await runtime?.afterRecordStat?.()
    const content = Buffer.alloc(MAX_REMOVAL_RECORD_BYTES + 1)
    const { bytesRead } = await handle.read(content, 0, content.length, 0)
    if (bytesRead !== stats.size) throw new Error('Managed plugin removal transaction record is invalid.')
    const record = parseRecord(JSON.parse(content.subarray(0, bytesRead).toString('utf8')))
    await validateRemovalRecordPublication({
      device: stats.dev.toString(),
      directory: journalDir(root),
      inode: stats.ino.toString(),
      operationId,
      publicationId: record.publicationId,
      size: stats.size
    })
    return record
  } finally {
    await handle.close()
  }
}
export const hasRemovalReceipt = async (
  root: string,
  record: ManagedPluginRemovalRecord,
  result: 'removed' | 'restored'
) => hasBoundRemovalReceipt(journalDir(root), record.operationId, record.receipt, result)
export const listPendingRemovalRecords = async (root: string) => {
  const directory = await ensureJournalDir(root)
  const ids = (await readdir(directory))
    .filter(name => /^[a-f0-9]{64}\.json$/u.test(name)).map(name => name.slice(0, 64)).sort()
  const records: ManagedPluginRemovalRecord[] = []
  for (const id of ids) {
    const record = await readRemovalRecord(root, id)
    if (!await hasRemovalReceipt(root, record, 'removed') && !await hasRemovalReceipt(root, record, 'restored')) {
      records.push(record)
    }
  }
  return records
}
export const writeRemovalRecord = async (
  root: string,
  record: Omit<ManagedPluginRemovalRecord, 'publicationId' | 'receipt'>
) => {
  assertRemovalRecordCanBePublished(record)
  const directory = await ensureJournalDir(root)
  await assertRemovalJournalCapacity(directory, 3)
  if ((await listPendingRemovalRecords(root)).length >= MAX_ACTIVE_RECORDS) {
    throw new Error('Managed plugin removal transaction history is full.')
  }
  const publicationId = createRemovalRecordPublicationId()
  const persisted = {
    ...record,
    publicationId,
    receipt: await reserveRemovalReceipt(directory, record.operationId)
  }
  await publishRemovalRecord(directory, record.operationId, publicationId, `${JSON.stringify(persisted)}\n`)
  return persisted
}
export const writeRemovalReceipt = async (
  root: string,
  record: ManagedPluginRemovalRecord,
  result: 'removed' | 'restored'
) => {
  const directory = await ensureJournalDir(root)
  await writeBoundRemovalReceipt(directory, record.operationId, record.receipt, result)
}
export const createRemovalRecord = (
  install: ManagedPluginInstall,
  operationId: string,
  managedRoot: string,
  transaction: string
): Omit<ManagedPluginRemovalRecord, 'publicationId' | 'receipt'> => {
  if (!validRemovalOperationId(operationId) || install.config.source.type !== 'marketplace') {
    throw new TypeError('Managed plugin removal identity is invalid.')
  }
  const segments = path.relative(managedRoot, install.installDir).split(path.sep)
  if (
    segments.length !== 3 || segments[0] !== install.config.adapter || segments[2] !== 'install' ||
    !segments.every(isManagedPluginPathSegment)
  ) throw new TypeError('Managed plugin install is outside its authority root.')
  return {
    identity: {
      adapter: install.config.adapter,
      installedAt: install.config.installedAt,
      marketplace: install.config.source.marketplace,
      name: install.config.name,
      plugin: install.config.source.plugin,
      ...(install.config.scope == null ? {} : { scope: install.config.scope })
    },
    operationId,
    parentSegments: [segments[0], segments[1]],
    transaction,
    version: 5
  }
}
