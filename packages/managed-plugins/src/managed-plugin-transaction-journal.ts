import { lstat, open, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'

export type ManagedPluginTransactionPhase =
  | 'new-promoted'
  | 'old-quarantined'
  | 'prepared'

export interface ManagedPluginTransactionJournal {
  backupName: string
  identity: string
  newRevision: string
  phase: ManagedPluginTransactionPhase
  previousRevision: string
  stagingName: string
  transactionId: string
  version: 1
}

const JOURNAL_FILE = '.oneworks-install-transaction.json'
const LOCK_DIRECTORY = '.oneworks-install.lock'
const JOURNAL_KEYS = new Set([
  'backupName',
  'identity',
  'newRevision',
  'phase',
  'previousRevision',
  'stagingName',
  'transactionId',
  'version'
])
const TRANSACTION_ID_PATTERN = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu

const lstatIfExists = async (target: string) =>
  lstat(target).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })

const fsyncDirectory = async (directory: string) => {
  const handle = await open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export const getManagedPluginTransactionPaths = (installDir: string) => {
  const parentDir = path.dirname(installDir)
  return {
    journalPath: path.join(parentDir, JOURNAL_FILE),
    lockDir: path.join(parentDir, LOCK_DIRECTORY),
    parentDir
  }
}

export const getManagedPluginTransactionDirectories = (
  installDir: string,
  transactionId: string
) => {
  const { parentDir } = getManagedPluginTransactionPaths(installDir)
  return {
    backupDir: path.join(parentDir, `.install-backup-${transactionId}`),
    stagingDir: path.join(parentDir, `.install-staging-${transactionId}`)
  }
}

const isValidJournal = (
  value: unknown
): value is ManagedPluginTransactionJournal => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  const journal = value as Record<string, unknown>
  if (!Object.keys(journal).every(key => JOURNAL_KEYS.has(key))) return false
  if (
    journal.version !== 1 ||
    typeof journal.transactionId !== 'string' ||
    !TRANSACTION_ID_PATTERN.test(journal.transactionId) ||
    typeof journal.identity !== 'string' ||
    !/^[\da-f]{64}$/iu.test(journal.identity) ||
    typeof journal.previousRevision !== 'string' ||
    typeof journal.newRevision !== 'string' ||
    !/^(?:absent|[\da-f]{64})$/iu.test(journal.previousRevision) ||
    !/^[\da-f]{64}$/iu.test(journal.newRevision) ||
    (
      journal.phase !== 'prepared' &&
      journal.phase !== 'old-quarantined' &&
      journal.phase !== 'new-promoted'
    )
  ) return false
  return (
    journal.stagingName === `.install-staging-${journal.transactionId}` &&
    journal.backupName === `.install-backup-${journal.transactionId}`
  )
}

export const readManagedPluginTransactionJournal = async (
  installDir: string
) => {
  const { journalPath } = getManagedPluginTransactionPaths(installDir)
  const journalStat = await lstatIfExists(journalPath)
  if (journalStat == null) return undefined
  if (!journalStat.isFile() || journalStat.isSymbolicLink()) {
    throw new Error('Managed plugin transaction journal is unsafe.')
  }
  const value = await readFile(journalPath, 'utf8')
    .then(content => JSON.parse(content) as unknown)
    .catch(() => undefined)
  if (!isValidJournal(value)) {
    throw new Error('Managed plugin transaction journal is invalid.')
  }
  return value
}

export const writeManagedPluginTransactionJournal = async (
  installDir: string,
  journal: ManagedPluginTransactionJournal
) => {
  if (!isValidJournal(journal)) {
    throw new Error('Refusing to write an invalid managed plugin transaction journal.')
  }
  const { journalPath, parentDir } = getManagedPluginTransactionPaths(installDir)
  const temporaryPath = `${journalPath}.${journal.transactionId}.tmp`
  const handle = await open(temporaryPath, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(journal)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporaryPath, journalPath)
  await fsyncDirectory(parentDir)
}

export const removeManagedPluginTransactionJournal = async (
  installDir: string
) => {
  const { journalPath, parentDir } = getManagedPluginTransactionPaths(installDir)
  await rm(journalPath, { force: true })
  await fsyncDirectory(parentDir)
}

export const syncManagedPluginTransactionParent = async (
  installDir: string
) => fsyncDirectory(path.dirname(installDir))
