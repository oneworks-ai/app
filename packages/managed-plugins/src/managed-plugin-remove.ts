/* eslint-disable max-lines -- strict journal validation and recovery stay with the removal transaction. */

import { randomUUID } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { ManagedPluginAdapter } from '@oneworks/types'
import type { ManagedPluginInstall } from '@oneworks/utils/managed-plugin'
import { getManagedPluginsRoot, readManagedPluginInstall } from '@oneworks/utils/managed-plugin'

import { withManagedPluginMutationLock } from './managed-plugin-mutation'

const JOURNAL_DIR_NAME = '.removal-journals'
const RECEIPT_DIR_NAME = '.removal-receipts'
const INSTALL_DIR_NAME = 'install'
const MAX_COMPLETION_RECEIPTS = 128
const JOURNAL_OPERATION_PATTERN = /^[a-f0-9]{64}$/
const QUARANTINE_NAME_PATTERN =
  /^\.remove-quarantine-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface ManagedPluginRemovalRuntime {
  beforePathMutation?: (operation: 'remove' | 'rename', sourcePath: string, destinationPath?: string) => void
  removeDirectory?: (targetPath: string) => void
}

export interface ManagedPluginRemovalIdentity {
  adapter: ManagedPluginAdapter
  installedAt: string
  marketplace: string
  name: string
  plugin: string
  scope?: string
}

interface PathIdentity {
  dev: string
  ino: string
}

interface ManagedPluginRemovalJournal {
  adapter: ManagedPluginAdapter
  identity: ManagedPluginRemovalIdentity
  installIdentity: PathIdentity
  operationId: string
  phase: 'prepared' | 'quarantined'
  pluginSlug: string
  quarantineIdentity?: PathIdentity
  quarantineName: string
  version: 2
}

interface ManagedPluginRemovalReceipt {
  completedAt: string
  identity: ManagedPluginRemovalIdentity
  operationId: string
  version: 1
}

export interface ManagedPluginRemovalHandle {
  cwd: string
  env?: NodeJS.ProcessEnv
  identity: ManagedPluginRemovalIdentity
  operationId: string
  pluginSlug: string
  quarantineIdentity: PathIdentity
  quarantineName: string
  runtime?: ManagedPluginRemovalRuntime
}

export interface ManagedPluginRemovalRecoveryResult {
  action: 'cleaned' | 'noop' | 'restored'
  identity: ManagedPluginRemovalIdentity
  operationId: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const hasExactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim() !== ''
)

const isSimplePathSegment = (value: unknown): value is string => (
  isNonEmptyString(value) &&
  value !== '.' &&
  value !== '..' &&
  path.basename(value) === value &&
  !value.includes('/') &&
  !value.includes('\\')
)

const isPathInside = (root: string, candidate: string) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

const pathExists = async (targetPath: string) => {
  try {
    await lstat(targetPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

const toPathIdentity = (value: { dev: number | bigint; ino: number | bigint }): PathIdentity => ({
  dev: value.dev.toString(),
  ino: value.ino.toString()
})

const pathIdentitiesMatch = (left: PathIdentity, right: PathIdentity) => (
  left.dev === right.dev && left.ino === right.ino
)

const assertPathInside = (managedRoot: string, targetPath: string, label: string) => {
  if (!isPathInside(managedRoot, targetPath)) {
    throw new Error(`${label} escapes the managed plugin root.`)
  }
}

const readDirectoryIdentitySync = (
  managedRoot: string,
  targetPath: string,
  label: string
) => {
  assertPathInside(managedRoot, targetPath, label)
  const targetStat = lstatSync(targetPath)
  if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
    throw new Error(`${label} must be a real directory.`)
  }
  const realManagedRoot = realpathSync.native(managedRoot)
  const realTarget = realpathSync.native(targetPath)
  if (!isPathInside(realManagedRoot, realTarget)) {
    throw new Error(`${label} resolves outside the managed plugin root.`)
  }
  const finalTargetStat = lstatSync(targetPath)
  if (finalTargetStat.isSymbolicLink() || !finalTargetStat.isDirectory()) {
    throw new Error(`${label} changed while resolving its real path.`)
  }
  const initialIdentity = toPathIdentity(targetStat)
  const finalIdentity = toPathIdentity(finalTargetStat)
  if (!pathIdentitiesMatch(initialIdentity, finalIdentity)) {
    throw new Error(`${label} changed while resolving its real path.`)
  }
  return finalIdentity
}

const openIdentityOwnedDirectory = (
  managedRoot: string,
  targetPath: string,
  expectedIdentity: PathIdentity,
  label: string
) => {
  assertPathInside(managedRoot, targetPath, label)
  if (typeof constants.O_NOFOLLOW !== 'number') {
    throw new TypeError(`${label} cannot be safely mutated because O_NOFOLLOW is unavailable.`)
  }
  const descriptor = openSync(targetPath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const descriptorStat = fstatSync(descriptor)
    if (!descriptorStat.isDirectory() || !pathIdentitiesMatch(toPathIdentity(descriptorStat), expectedIdentity)) {
      throw new Error(`${label} changed before its identity-owned mutation.`)
    }
    const pathIdentity = readDirectoryIdentitySync(managedRoot, targetPath, label)
    if (!pathIdentitiesMatch(pathIdentity, expectedIdentity)) {
      throw new Error(`${label} changed before its identity-owned mutation.`)
    }
    return descriptor
  } catch (error) {
    closeSync(descriptor)
    throw error
  }
}

const pathExistsSync = (targetPath: string) => {
  try {
    lstatSync(targetPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

const rollbackUnexpectedRenameSync = (
  managedRoot: string,
  sourcePath: string,
  destinationPath: string
) => {
  if (!pathExistsSync(destinationPath)) return
  if (!pathExistsSync(sourcePath)) {
    renameSync(destinationPath, sourcePath)
    return
  }
  const isolatedPath = path.resolve(
    path.dirname(destinationPath),
    `.identity-mismatch-${randomUUID()}`
  )
  assertPathInside(managedRoot, isolatedPath, 'Managed plugin identity mismatch isolation')
  renameSync(destinationPath, isolatedPath)
}

const renameIdentityOwnedDirectory = (params: {
  destinationPath: string
  expectedIdentity: PathIdentity
  expectedOwnerIdentity: PathIdentity
  label: string
  managedRoot: string
  ownerPath: string
  runtime?: ManagedPluginRemovalRuntime
  sourcePath: string
}) => {
  assertPathInside(params.managedRoot, params.destinationPath, `${params.label} destination`)
  if (
    path.resolve(path.dirname(params.sourcePath)) !== path.resolve(params.ownerPath) ||
    path.resolve(path.dirname(params.destinationPath)) !== path.resolve(params.ownerPath)
  ) {
    throw new TypeError(`${params.label} rename must stay within its identity-owned parent.`)
  }
  const descriptor = openIdentityOwnedDirectory(
    params.managedRoot,
    params.sourcePath,
    params.expectedIdentity,
    params.label
  )
  let ownerDescriptor: number | undefined
  try {
    ownerDescriptor = openIdentityOwnedDirectory(
      params.managedRoot,
      params.ownerPath,
      params.expectedOwnerIdentity,
      'Managed plugin owner root'
    )
    params.runtime?.beforePathMutation?.('rename', params.sourcePath, params.destinationPath)
    const boundaryIdentity = readDirectoryIdentitySync(
      params.managedRoot,
      params.sourcePath,
      params.label
    )
    if (!pathIdentitiesMatch(boundaryIdentity, params.expectedIdentity)) {
      throw new Error(`${params.label} changed at the rename boundary.`)
    }
    const descriptorBoundaryIdentity = toPathIdentity(fstatSync(descriptor))
    if (!pathIdentitiesMatch(descriptorBoundaryIdentity, params.expectedIdentity)) {
      throw new Error(`${params.label} descriptor changed at the rename boundary.`)
    }
    const ownerBoundaryIdentity = readDirectoryIdentitySync(
      params.managedRoot,
      params.ownerPath,
      'Managed plugin owner root'
    )
    if (!pathIdentitiesMatch(ownerBoundaryIdentity, params.expectedOwnerIdentity)) {
      throw new Error('Managed plugin owner root changed at the rename boundary.')
    }
    if (pathExistsSync(params.destinationPath)) {
      throw new Error(`${params.label} destination already exists.`)
    }
    renameSync(params.sourcePath, params.destinationPath)
    try {
      const descriptorIdentity = toPathIdentity(fstatSync(descriptor))
      const destinationIdentity = readDirectoryIdentitySync(
        params.managedRoot,
        params.destinationPath,
        params.label
      )
      if (
        !pathIdentitiesMatch(descriptorIdentity, params.expectedIdentity) ||
        !pathIdentitiesMatch(destinationIdentity, params.expectedIdentity)
      ) {
        throw new Error(`${params.label} moved an unexpected inode.`)
      }
    } catch (error) {
      rollbackUnexpectedRenameSync(params.managedRoot, params.sourcePath, params.destinationPath)
      throw error
    }
  } finally {
    if (ownerDescriptor != null) closeSync(ownerDescriptor)
    closeSync(descriptor)
  }
}

const validateIdentityOwnedDirectory = (
  managedRoot: string,
  targetPath: string,
  expectedIdentity: PathIdentity,
  label: string
) => {
  const descriptor = openIdentityOwnedDirectory(managedRoot, targetPath, expectedIdentity, label)
  closeSync(descriptor)
}

const getContainedDirectoryIdentity = async (
  managedRoot: string,
  targetPath: string,
  label: string
): Promise<PathIdentity> => {
  assertPathInside(managedRoot, targetPath, label)
  const initialTargetStat = await lstat(targetPath)
  if (initialTargetStat.isSymbolicLink() || !initialTargetStat.isDirectory()) {
    throw new Error(`${label} must be a real directory.`)
  }
  const [realManagedRoot, realTarget] = await Promise.all([
    realpath(managedRoot),
    realpath(targetPath)
  ])
  if (!isPathInside(realManagedRoot, realTarget)) {
    throw new Error(`${label} resolves outside the managed plugin root.`)
  }
  const finalTargetStat = await lstat(targetPath)
  if (finalTargetStat.isSymbolicLink() || !finalTargetStat.isDirectory()) {
    throw new Error(`${label} changed while resolving its real path.`)
  }
  const initialIdentity = toPathIdentity(initialTargetStat)
  const finalIdentity = toPathIdentity(finalTargetStat)
  if (!pathIdentitiesMatch(initialIdentity, finalIdentity)) {
    throw new Error(`${label} changed while resolving its real path.`)
  }
  return finalIdentity
}

const assertDirectoryIdentity = async (
  managedRoot: string,
  targetPath: string,
  expected: PathIdentity,
  label: string
) => {
  const actual = await getContainedDirectoryIdentity(managedRoot, targetPath, label)
  if (!pathIdentitiesMatch(actual, expected)) {
    throw new Error(`${label} changed while the removal transaction was active.`)
  }
  return actual
}

const assertRegularFileIsNotSymlink = async (targetPath: string, label: string) => {
  const targetStat = await lstat(targetPath)
  if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
    throw new Error(`${label} must be a regular file.`)
  }
}

const parsePathIdentity = (value: unknown): PathIdentity => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['dev', 'ino']) ||
    typeof value.dev !== 'string' ||
    typeof value.ino !== 'string' ||
    !/^\d+$/.test(value.dev) ||
    !/^\d+$/.test(value.ino)
  ) {
    throw new Error('Managed plugin removal journal path identity is invalid.')
  }
  return { dev: value.dev, ino: value.ino }
}

const parseRemovalIdentity = (value: unknown): ManagedPluginRemovalIdentity => {
  if (!isRecord(value)) throw new Error('Managed plugin removal journal identity is invalid.')
  const keys = [
    'adapter',
    'installedAt',
    'marketplace',
    'name',
    'plugin',
    ...(value.scope == null ? [] : ['scope'])
  ]
  if (
    !hasExactKeys(value, keys) ||
    !isSimplePathSegment(value.adapter) ||
    !isNonEmptyString(value.installedAt) ||
    !isNonEmptyString(value.marketplace) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.plugin) ||
    (value.scope != null && !isNonEmptyString(value.scope))
  ) {
    throw new Error('Managed plugin removal journal identity is invalid.')
  }
  return {
    adapter: value.adapter,
    installedAt: value.installedAt,
    marketplace: value.marketplace,
    name: value.name,
    plugin: value.plugin,
    ...(value.scope == null ? {} : { scope: value.scope })
  }
}

const parseRemovalJournal = (value: unknown): ManagedPluginRemovalJournal => {
  if (
    !isRecord(value) ||
    value.version !== 2 ||
    (value.phase !== 'prepared' && value.phase !== 'quarantined') ||
    !isSimplePathSegment(value.adapter) ||
    !isSimplePathSegment(value.pluginSlug) ||
    typeof value.operationId !== 'string' ||
    !JOURNAL_OPERATION_PATTERN.test(value.operationId) ||
    typeof value.quarantineName !== 'string' ||
    !QUARANTINE_NAME_PATTERN.test(value.quarantineName)
  ) {
    throw new Error('Managed plugin removal journal is invalid.')
  }
  const expectedKeys = value.phase === 'quarantined'
    ? [
      'adapter',
      'identity',
      'installIdentity',
      'operationId',
      'phase',
      'pluginSlug',
      'quarantineIdentity',
      'quarantineName',
      'version'
    ]
    : ['adapter', 'identity', 'installIdentity', 'operationId', 'phase', 'pluginSlug', 'quarantineName', 'version']
  if (!hasExactKeys(value, expectedKeys)) {
    throw new Error('Managed plugin removal journal is invalid.')
  }
  const identity = parseRemovalIdentity(value.identity)
  if (identity.adapter !== value.adapter) {
    throw new Error('Managed plugin removal journal adapter does not match its identity.')
  }
  return {
    adapter: value.adapter,
    identity,
    installIdentity: parsePathIdentity(value.installIdentity),
    operationId: value.operationId,
    phase: value.phase,
    pluginSlug: value.pluginSlug,
    ...(value.phase === 'quarantined'
      ? { quarantineIdentity: parsePathIdentity(value.quarantineIdentity) }
      : {}),
    quarantineName: value.quarantineName,
    version: 2
  }
}

const parseRemovalReceipt = (value: unknown): ManagedPluginRemovalReceipt => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['completedAt', 'identity', 'operationId', 'version']) ||
    value.version !== 1 ||
    !isNonEmptyString(value.completedAt) ||
    typeof value.operationId !== 'string' ||
    !JOURNAL_OPERATION_PATTERN.test(value.operationId)
  ) {
    throw new Error('Managed plugin removal completion receipt is invalid.')
  }
  return {
    completedAt: value.completedAt,
    identity: parseRemovalIdentity(value.identity),
    operationId: value.operationId,
    version: 1
  }
}

const getRemovalIdentity = (install: ManagedPluginInstall): ManagedPluginRemovalIdentity => {
  if (install.config.source.type !== 'marketplace') {
    throw new Error('Only managed marketplace plugins can use the managed removal transaction.')
  }
  return {
    adapter: install.config.adapter,
    installedAt: install.config.installedAt,
    marketplace: install.config.source.marketplace,
    name: install.config.name,
    plugin: install.config.source.plugin,
    ...(install.config.scope == null ? {} : { scope: install.config.scope })
  }
}

const identitiesMatch = (
  left: ManagedPluginRemovalIdentity,
  right: ManagedPluginRemovalIdentity
) => (
  left.adapter === right.adapter &&
  left.installedAt === right.installedAt &&
  left.marketplace === right.marketplace &&
  left.name === right.name &&
  left.plugin === right.plugin &&
  left.scope === right.scope
)

const resolveOperationPaths = (
  cwd: string,
  env: NodeJS.ProcessEnv | undefined,
  operationId: string
) => {
  if (!JOURNAL_OPERATION_PATTERN.test(operationId)) {
    throw new Error('Managed plugin removal operation id is invalid.')
  }
  const managedRoot = path.resolve(getManagedPluginsRoot(cwd, env))
  const journalDir = path.resolve(managedRoot, JOURNAL_DIR_NAME)
  const receiptDir = path.resolve(managedRoot, RECEIPT_DIR_NAME)
  const journalPath = path.resolve(journalDir, `${operationId}.json`)
  const receiptPath = path.resolve(receiptDir, `${operationId}.json`)
  for (
    const [label, targetPath] of [
      ['journal directory', journalDir],
      ['journal file', journalPath],
      ['receipt directory', receiptDir],
      ['receipt file', receiptPath]
    ] as const
  ) {
    assertPathInside(managedRoot, targetPath, `Managed plugin removal ${label}`)
  }
  return { journalDir, journalPath, managedRoot, receiptDir, receiptPath }
}

const resolveJournalPaths = (
  cwd: string,
  env: NodeJS.ProcessEnv | undefined,
  journal: ManagedPluginRemovalJournal
) => {
  const operationPaths = resolveOperationPaths(cwd, env, journal.operationId)
  const adapterRoot = path.resolve(operationPaths.managedRoot, journal.adapter)
  const pluginRoot = path.resolve(adapterRoot, journal.pluginSlug)
  const installDir = path.resolve(pluginRoot, INSTALL_DIR_NAME)
  const quarantineDir = path.resolve(pluginRoot, journal.quarantineName)
  for (
    const [label, targetPath] of [
      ['adapter root', adapterRoot],
      ['plugin root', pluginRoot],
      ['install directory', installDir],
      ['quarantine directory', quarantineDir]
    ] as const
  ) {
    assertPathInside(operationPaths.managedRoot, targetPath, `Managed plugin removal ${label}`)
  }
  return {
    ...operationPaths,
    adapterRoot,
    installDir,
    pluginRoot,
    quarantineDir
  }
}

const readJournalFile = async (
  cwd: string,
  env: NodeJS.ProcessEnv | undefined,
  journalPath: string
) => {
  await assertRegularFileIsNotSymlink(journalPath, 'Managed plugin removal journal')
  const journal = parseRemovalJournal(JSON.parse(await readFile(journalPath, 'utf8')) as unknown)
  const expectedPath = resolveJournalPaths(cwd, env, journal).journalPath
  if (path.resolve(journalPath) !== expectedPath) {
    throw new Error('Managed plugin removal journal filename does not match its operation id.')
  }
  return journal
}

const assertSafeRemovalPaths = async (
  paths: ReturnType<typeof resolveJournalPaths>,
  options?: {
    requireInstall?: boolean
    requireJournal?: boolean
  }
) => {
  await getContainedDirectoryIdentity(paths.managedRoot, paths.managedRoot, 'Managed plugin root')
  if (await pathExists(paths.adapterRoot)) {
    await getContainedDirectoryIdentity(paths.managedRoot, paths.adapterRoot, 'Managed plugin adapter root')
  }
  if (await pathExists(paths.pluginRoot)) {
    await getContainedDirectoryIdentity(paths.managedRoot, paths.pluginRoot, 'Managed plugin owner root')
  }
  if (options?.requireInstall === true || await pathExists(paths.installDir)) {
    await getContainedDirectoryIdentity(paths.managedRoot, paths.installDir, 'Managed plugin install directory')
  }
  if (await pathExists(paths.quarantineDir)) {
    await getContainedDirectoryIdentity(paths.managedRoot, paths.quarantineDir, 'Managed plugin quarantine directory')
  }
  if (await pathExists(paths.journalDir)) {
    await getContainedDirectoryIdentity(paths.managedRoot, paths.journalDir, 'Managed plugin removal journal directory')
  }
  if (options?.requireJournal === true) {
    await assertRegularFileIsNotSymlink(paths.journalPath, 'Managed plugin removal journal')
  }
}

const assertInstallMatchesIdentity = async (
  installDir: string,
  identity: ManagedPluginRemovalIdentity
) => {
  const install = await readManagedPluginInstall(installDir)
  if (install == null || !identitiesMatch(getRemovalIdentity(install), identity)) {
    throw new Error('Managed plugin install no longer matches the removal journal identity.')
  }
  return install
}

const writeAtomicJson = async (
  managedRoot: string,
  directory: string,
  targetPath: string,
  value: unknown,
  label: string
) => {
  const directoryIdentity = await getContainedDirectoryIdentity(managedRoot, directory, label)
  const tempPath = path.resolve(directory, `.${path.basename(targetPath)}-${randomUUID()}.tmp`)
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    await assertDirectoryIdentity(managedRoot, directory, directoryIdentity, label)
    await rename(tempPath, targetPath)
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined)
  }
}

const writeRemovalJournal = async (
  paths: ReturnType<typeof resolveJournalPaths>,
  journal: ManagedPluginRemovalJournal
) => {
  await mkdir(paths.journalDir, { recursive: true })
  await getContainedDirectoryIdentity(
    paths.managedRoot,
    paths.journalDir,
    'Managed plugin removal journal directory'
  )
  await writeAtomicJson(
    paths.managedRoot,
    paths.journalDir,
    paths.journalPath,
    journal,
    'Managed plugin removal journal directory'
  )
  await assertRegularFileIsNotSymlink(paths.journalPath, 'Managed plugin removal journal')
}

const removeJournalFile = async (paths: ReturnType<typeof resolveJournalPaths>) => {
  if (!await pathExists(paths.journalPath)) return
  const journalDirectoryIdentity = await getContainedDirectoryIdentity(
    paths.managedRoot,
    paths.journalDir,
    'Managed plugin removal journal directory'
  )
  await assertRegularFileIsNotSymlink(paths.journalPath, 'Managed plugin removal journal')
  await assertDirectoryIdentity(
    paths.managedRoot,
    paths.journalDir,
    journalDirectoryIdentity,
    'Managed plugin removal journal directory'
  )
  await rm(paths.journalPath, { force: true })
  if (await pathExists(paths.journalPath)) {
    throw new Error('Managed plugin removal journal could not be removed.')
  }
}

const getCompletionReceipt = async (params: {
  cwd: string
  env?: NodeJS.ProcessEnv
  operationId: string
}) => {
  const paths = resolveOperationPaths(params.cwd, params.env, params.operationId)
  await getContainedDirectoryIdentity(paths.managedRoot, paths.managedRoot, 'Managed plugin root')
  if (!await pathExists(paths.receiptPath)) return undefined
  await getContainedDirectoryIdentity(
    paths.managedRoot,
    paths.receiptDir,
    'Managed plugin removal receipt directory'
  )
  await assertRegularFileIsNotSymlink(paths.receiptPath, 'Managed plugin removal completion receipt')
  const receipt = parseRemovalReceipt(JSON.parse(await readFile(paths.receiptPath, 'utf8')) as unknown)
  if (receipt.operationId !== params.operationId) {
    throw new Error('Managed plugin removal completion receipt filename does not match its operation id.')
  }
  return receipt
}

const pruneCompletionReceipts = async (paths: ReturnType<typeof resolveOperationPaths>) => {
  const entries = (await readdir(paths.receiptDir, { withFileTypes: true }))
    .filter(entry => entry.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name))
  const excess = entries.length - MAX_COMPLETION_RECEIPTS
  if (excess <= 0) return
  const candidates = entries.filter(entry => entry.name !== path.basename(paths.receiptPath)).slice(0, excess)
  for (const entry of candidates) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error('Managed plugin removal receipt entry must be a regular file.')
    }
    const receiptPath = path.resolve(paths.receiptDir, entry.name)
    assertPathInside(paths.managedRoot, receiptPath, 'Managed plugin removal receipt entry')
    await assertRegularFileIsNotSymlink(receiptPath, 'Managed plugin removal completion receipt')
    await rm(receiptPath, { force: true })
  }
}

const writeCompletionReceipt = async (
  paths: ReturnType<typeof resolveJournalPaths>,
  journal: ManagedPluginRemovalJournal
) => {
  await getContainedDirectoryIdentity(paths.managedRoot, paths.managedRoot, 'Managed plugin root')
  const existing = await (async () => {
    if (!await pathExists(paths.receiptPath)) return undefined
    await getContainedDirectoryIdentity(
      paths.managedRoot,
      paths.receiptDir,
      'Managed plugin removal receipt directory'
    )
    await assertRegularFileIsNotSymlink(paths.receiptPath, 'Managed plugin removal completion receipt')
    const receipt = parseRemovalReceipt(JSON.parse(await readFile(paths.receiptPath, 'utf8')) as unknown)
    if (receipt.operationId !== journal.operationId) {
      throw new Error('Managed plugin removal completion receipt filename does not match its operation id.')
    }
    return receipt
  })()
  if (existing != null) {
    if (!identitiesMatch(existing.identity, journal.identity)) {
      throw new Error('Managed plugin removal completion receipt identity does not match the journal.')
    }
    return existing
  }
  await mkdir(paths.receiptDir, { recursive: true })
  await getContainedDirectoryIdentity(
    paths.managedRoot,
    paths.receiptDir,
    'Managed plugin removal receipt directory'
  )
  const receipt: ManagedPluginRemovalReceipt = {
    completedAt: new Date().toISOString(),
    identity: journal.identity,
    operationId: journal.operationId,
    version: 1
  }
  await writeAtomicJson(
    paths.managedRoot,
    paths.receiptDir,
    paths.receiptPath,
    receipt,
    'Managed plugin removal receipt directory'
  )
  await assertRegularFileIsNotSymlink(paths.receiptPath, 'Managed plugin removal completion receipt')
  await pruneCompletionReceipts(paths)
  return receipt
}

const removeContainedDirectory = async (
  managedRoot: string,
  targetPath: string,
  expectedIdentity: PathIdentity,
  label: string,
  runtime?: ManagedPluginRemovalRuntime
) => {
  const descriptor = openIdentityOwnedDirectory(managedRoot, targetPath, expectedIdentity, label)
  try {
    runtime?.beforePathMutation?.('remove', targetPath)
    const boundaryIdentity = readDirectoryIdentitySync(managedRoot, targetPath, label)
    if (!pathIdentitiesMatch(boundaryIdentity, expectedIdentity)) {
      throw new Error(`${label} changed at the recursive removal boundary.`)
    }
    const descriptorBoundaryIdentity = toPathIdentity(fstatSync(descriptor))
    if (!pathIdentitiesMatch(descriptorBoundaryIdentity, expectedIdentity)) {
      throw new Error(`${label} descriptor changed at the recursive removal boundary.`)
    }
    ;(runtime?.removeDirectory ?? (directoryPath => rmSync(directoryPath, { recursive: true })))(targetPath)
    if (pathExistsSync(targetPath)) {
      throw new Error(`${label} cleanup did not remove the quarantined directory.`)
    }
  } finally {
    closeSync(descriptor)
  }
}

const loadRemovalJournal = async (handle: ManagedPluginRemovalHandle) => {
  const operationPaths = resolveOperationPaths(handle.cwd, handle.env, handle.operationId)
  if (!await pathExists(operationPaths.journalPath)) return undefined
  const journal = await readJournalFile(handle.cwd, handle.env, operationPaths.journalPath)
  if (
    !identitiesMatch(journal.identity, handle.identity) ||
    journal.pluginSlug !== handle.pluginSlug ||
    journal.quarantineName !== handle.quarantineName ||
    (journal.phase === 'quarantined' && !pathIdentitiesMatch(
      journal.quarantineIdentity!,
      handle.quarantineIdentity
    ))
  ) {
    throw new Error('Managed plugin removal handle does not match its journal identity.')
  }
  return journal
}

const ensureQuarantinedJournal = async (
  paths: ReturnType<typeof resolveJournalPaths>,
  journal: ManagedPluginRemovalJournal
) => {
  if (journal.phase === 'quarantined') {
    if (!pathIdentitiesMatch(journal.quarantineIdentity!, journal.installIdentity)) {
      throw new Error('Managed plugin quarantine journal identity is inconsistent.')
    }
    await assertDirectoryIdentity(
      paths.managedRoot,
      paths.quarantineDir,
      journal.quarantineIdentity!,
      'Managed plugin quarantine directory'
    )
    return journal
  }
  const quarantineIdentity = await getContainedDirectoryIdentity(
    paths.managedRoot,
    paths.quarantineDir,
    'Managed plugin quarantine directory'
  )
  if (!pathIdentitiesMatch(quarantineIdentity, journal.installIdentity)) {
    throw new Error('Managed plugin quarantine does not match the staged install identity.')
  }
  await assertInstallMatchesIdentity(paths.quarantineDir, journal.identity)
  const quarantinedJournal: ManagedPluginRemovalJournal = {
    ...journal,
    phase: 'quarantined',
    quarantineIdentity
  }
  await writeRemovalJournal(paths, quarantinedJournal)
  return quarantinedJournal
}

const finalizeRemovedJournal = async (
  paths: ReturnType<typeof resolveJournalPaths>,
  journal: ManagedPluginRemovalJournal
) => {
  await writeCompletionReceipt(paths, journal)
  await removeJournalFile(paths)
}

export const getManagedPluginRemovalCompletion = async (params: {
  cwd: string
  env?: NodeJS.ProcessEnv
  operationId: string
}) => withManagedPluginMutationLock(params, () => getCompletionReceipt(params))

export const stageManagedPluginRemoval = async (params: {
  cwd: string
  env?: NodeJS.ProcessEnv
  install: ManagedPluginInstall
  operationId: string
  runtime?: ManagedPluginRemovalRuntime
}): Promise<ManagedPluginRemovalHandle> =>
  withManagedPluginMutationLock({ cwd: params.cwd, env: params.env }, async () => {
    const identity = getRemovalIdentity(params.install)
    if (!isSimplePathSegment(identity.adapter)) {
      throw new Error('Managed plugin adapter is not a safe path segment.')
    }
    const installDir = path.resolve(params.install.installDir)
    if (path.basename(installDir) !== INSTALL_DIR_NAME) {
      throw new Error('Managed plugin install directory has an unexpected name.')
    }
    const pluginSlug = path.basename(path.dirname(installDir))
    if (!isSimplePathSegment(pluginSlug)) {
      throw new Error('Managed plugin owner directory is not a safe path segment.')
    }
    const quarantineName = `.remove-quarantine-${randomUUID()}`
    const preparedJournalBase = {
      adapter: identity.adapter,
      identity,
      operationId: params.operationId,
      phase: 'prepared' as const,
      pluginSlug,
      quarantineName,
      version: 2 as const
    }
    const paths = resolveJournalPaths(params.cwd, params.env, {
      ...preparedJournalBase,
      installIdentity: { dev: '0', ino: '0' }
    })
    if (paths.installDir !== installDir) {
      throw new Error('Managed plugin install directory does not match its authoritative adapter owner.')
    }
    if (
      await getCompletionReceipt({
        cwd: params.cwd,
        env: params.env,
        operationId: params.operationId
      }) != null
    ) {
      throw new Error('Managed plugin removal operation is already complete.')
    }
    await assertSafeRemovalPaths(paths, { requireInstall: true })
    const pluginRootIdentity = await getContainedDirectoryIdentity(
      paths.managedRoot,
      paths.pluginRoot,
      'Managed plugin owner root'
    )
    const installIdentity = await getContainedDirectoryIdentity(
      paths.managedRoot,
      paths.installDir,
      'Managed plugin install directory'
    )
    const preparedJournal: ManagedPluginRemovalJournal = {
      ...preparedJournalBase,
      installIdentity
    }
    await assertInstallMatchesIdentity(paths.installDir, identity)
    if (await pathExists(paths.journalPath)) {
      throw new Error('Managed plugin removal operation is already staged.')
    }
    if (await pathExists(paths.quarantineDir)) {
      throw new Error('Managed plugin removal quarantine already exists.')
    }
    await writeRemovalJournal(paths, preparedJournal)
    try {
      await assertDirectoryIdentity(
        paths.managedRoot,
        paths.pluginRoot,
        pluginRootIdentity,
        'Managed plugin owner root'
      )
      await assertDirectoryIdentity(
        paths.managedRoot,
        paths.installDir,
        installIdentity,
        'Managed plugin install directory'
      )
      if (await pathExists(paths.quarantineDir)) {
        throw new Error('Managed plugin removal quarantine appeared before rename.')
      }
      renameIdentityOwnedDirectory({
        destinationPath: paths.quarantineDir,
        expectedIdentity: installIdentity,
        expectedOwnerIdentity: pluginRootIdentity,
        label: 'Managed plugin install directory',
        managedRoot: paths.managedRoot,
        ownerPath: paths.pluginRoot,
        runtime: params.runtime,
        sourcePath: paths.installDir
      })
    } catch (error) {
      const [installExists, quarantineExists] = await Promise.all([
        pathExists(paths.installDir),
        pathExists(paths.quarantineDir)
      ])
      const exactInstallRemains = installExists &&
        pathIdentitiesMatch(
          readDirectoryIdentitySync(
            paths.managedRoot,
            paths.installDir,
            'Managed plugin install directory'
          ),
          installIdentity
        )
      if (exactInstallRemains && !quarantineExists) {
        await removeJournalFile(paths)
      }
      throw error
    }
    const quarantineIdentity = await getContainedDirectoryIdentity(
      paths.managedRoot,
      paths.quarantineDir,
      'Managed plugin quarantine directory'
    )
    if (!pathIdentitiesMatch(quarantineIdentity, preparedJournal.installIdentity)) {
      throw new Error('Managed plugin install changed during quarantine rename.')
    }
    await assertInstallMatchesIdentity(paths.quarantineDir, identity)
    const quarantinedJournal: ManagedPluginRemovalJournal = {
      ...preparedJournal,
      phase: 'quarantined',
      quarantineIdentity
    }
    await writeRemovalJournal(paths, quarantinedJournal)
    return {
      cwd: params.cwd,
      env: params.env,
      identity,
      operationId: params.operationId,
      pluginSlug,
      quarantineIdentity,
      quarantineName: preparedJournal.quarantineName,
      ...(params.runtime == null ? {} : { runtime: params.runtime })
    }
  })

export const restoreManagedPluginRemoval = async (
  handle: ManagedPluginRemovalHandle
) =>
  withManagedPluginMutationLock({ cwd: handle.cwd, env: handle.env }, async () => {
    const journal = await loadRemovalJournal(handle)
    if (journal == null) {
      const receipt = await getCompletionReceipt(handle)
      if (receipt != null && identitiesMatch(receipt.identity, handle.identity)) {
        throw new Error('Managed plugin removal is already complete and cannot be restored.')
      }
      throw new Error('Managed plugin removal journal is missing.')
    }
    const paths = resolveJournalPaths(handle.cwd, handle.env, journal)
    await assertSafeRemovalPaths(paths, { requireJournal: true })
    const installExists = await pathExists(paths.installDir)
    const quarantineExists = await pathExists(paths.quarantineDir)
    if (installExists && quarantineExists) {
      throw new Error('Managed plugin install and quarantine both exist; refusing to overwrite either.')
    }
    if (!installExists && !quarantineExists) {
      throw new Error('Managed plugin removal cannot restore a missing install and quarantine.')
    }
    if (quarantineExists) {
      const quarantinedJournal = await ensureQuarantinedJournal(paths, journal)
      await assertInstallMatchesIdentity(paths.quarantineDir, quarantinedJournal.identity)
      const pluginRootIdentity = await getContainedDirectoryIdentity(
        paths.managedRoot,
        paths.pluginRoot,
        'Managed plugin owner root'
      )
      await assertDirectoryIdentity(
        paths.managedRoot,
        paths.quarantineDir,
        quarantinedJournal.quarantineIdentity!,
        'Managed plugin quarantine directory'
      )
      await assertDirectoryIdentity(
        paths.managedRoot,
        paths.pluginRoot,
        pluginRootIdentity,
        'Managed plugin owner root'
      )
      if (await pathExists(paths.installDir)) {
        throw new Error('Managed plugin install reappeared before restore.')
      }
      renameIdentityOwnedDirectory({
        destinationPath: paths.installDir,
        expectedIdentity: quarantinedJournal.quarantineIdentity!,
        expectedOwnerIdentity: pluginRootIdentity,
        label: 'Managed plugin quarantine directory',
        managedRoot: paths.managedRoot,
        ownerPath: paths.pluginRoot,
        runtime: handle.runtime,
        sourcePath: paths.quarantineDir
      })
      await assertInstallMatchesIdentity(paths.installDir, quarantinedJournal.identity)
    } else {
      validateIdentityOwnedDirectory(
        paths.managedRoot,
        paths.installDir,
        journal.installIdentity,
        'Managed plugin restored install directory'
      )
      await assertInstallMatchesIdentity(paths.installDir, journal.identity)
    }
    await removeJournalFile(paths)
  })

export const commitManagedPluginRemoval = async (
  handle: ManagedPluginRemovalHandle
) =>
  withManagedPluginMutationLock({ cwd: handle.cwd, env: handle.env }, async () => {
    const journal = await loadRemovalJournal(handle)
    if (journal == null) {
      const receipt = await getCompletionReceipt(handle)
      if (receipt != null && identitiesMatch(receipt.identity, handle.identity)) return
      throw new Error('Managed plugin removal journal is missing.')
    }
    const paths = resolveJournalPaths(handle.cwd, handle.env, journal)
    await assertSafeRemovalPaths(paths, { requireJournal: true })
    if (await pathExists(paths.installDir)) {
      throw new Error('Managed plugin install reappeared before removal cleanup.')
    }
    if (await pathExists(paths.quarantineDir)) {
      const quarantinedJournal = await ensureQuarantinedJournal(paths, journal)
      await removeContainedDirectory(
        paths.managedRoot,
        paths.quarantineDir,
        quarantinedJournal.quarantineIdentity!,
        'Managed plugin quarantine directory',
        handle.runtime
      )
      await finalizeRemovedJournal(paths, quarantinedJournal)
      return
    }
    if (journal.phase !== 'quarantined') {
      throw new Error('Managed plugin removal journal has no recoverable quarantine entry.')
    }
    await finalizeRemovedJournal(paths, journal)
  })

export const recoverManagedPluginRemovals = async (params: {
  cwd: string
  env?: NodeJS.ProcessEnv
  isDeclarationPresent: (identity: ManagedPluginRemovalIdentity) => boolean | Promise<boolean>
  runtime?: ManagedPluginRemovalRuntime
}): Promise<ManagedPluginRemovalRecoveryResult[]> => {
  const operationPaths = resolveOperationPaths(params.cwd, params.env, '0'.repeat(64))
  if (!await pathExists(operationPaths.journalDir)) return []
  return withManagedPluginMutationLock({ cwd: params.cwd, env: params.env }, async () => {
    if (!await pathExists(operationPaths.journalDir)) return []
    await getContainedDirectoryIdentity(
      operationPaths.managedRoot,
      operationPaths.journalDir,
      'Managed plugin removal journal directory'
    )
    const entries = (await readdir(operationPaths.journalDir, { withFileTypes: true }))
      .filter(entry => entry.name.endsWith('.json'))
      .sort((left, right) => left.name.localeCompare(right.name))
    const results: ManagedPluginRemovalRecoveryResult[] = []

    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error('Managed plugin removal journal entry must be a regular file.')
      }
      const journalPath = path.resolve(operationPaths.journalDir, entry.name)
      const journal = await readJournalFile(params.cwd, params.env, journalPath)
      const paths = resolveJournalPaths(params.cwd, params.env, journal)
      await assertSafeRemovalPaths(paths, { requireJournal: true })
      const installExists = await pathExists(paths.installDir)
      const quarantineExists = await pathExists(paths.quarantineDir)
      if (installExists && quarantineExists) {
        throw new Error('Managed plugin install and quarantine both exist; recovery cannot choose one.')
      }

      if (installExists) {
        validateIdentityOwnedDirectory(
          paths.managedRoot,
          paths.installDir,
          journal.installIdentity,
          'Managed plugin recovered install directory'
        )
        await assertInstallMatchesIdentity(paths.installDir, journal.identity)
        await removeJournalFile(paths)
        results.push({
          action: 'noop',
          identity: journal.identity,
          operationId: journal.operationId
        })
        continue
      }

      const declarationPresent = await params.isDeclarationPresent(journal.identity)
      if (quarantineExists) {
        if (declarationPresent) {
          const quarantinedJournal = await ensureQuarantinedJournal(paths, journal)
          await assertInstallMatchesIdentity(paths.quarantineDir, quarantinedJournal.identity)
          const pluginRootIdentity = await getContainedDirectoryIdentity(
            paths.managedRoot,
            paths.pluginRoot,
            'Managed plugin owner root'
          )
          await assertDirectoryIdentity(
            paths.managedRoot,
            paths.quarantineDir,
            quarantinedJournal.quarantineIdentity!,
            'Managed plugin quarantine directory'
          )
          await assertDirectoryIdentity(
            paths.managedRoot,
            paths.pluginRoot,
            pluginRootIdentity,
            'Managed plugin owner root'
          )
          renameIdentityOwnedDirectory({
            destinationPath: paths.installDir,
            expectedIdentity: quarantinedJournal.quarantineIdentity!,
            expectedOwnerIdentity: pluginRootIdentity,
            label: 'Managed plugin quarantine directory',
            managedRoot: paths.managedRoot,
            ownerPath: paths.pluginRoot,
            runtime: params.runtime,
            sourcePath: paths.quarantineDir
          })
          await assertInstallMatchesIdentity(paths.installDir, quarantinedJournal.identity)
          await removeJournalFile(paths)
          results.push({
            action: 'restored',
            identity: journal.identity,
            operationId: journal.operationId
          })
          continue
        }
        const quarantinedJournal = await ensureQuarantinedJournal(paths, journal)
        await removeContainedDirectory(
          paths.managedRoot,
          paths.quarantineDir,
          quarantinedJournal.quarantineIdentity!,
          'Managed plugin quarantine directory',
          params.runtime
        )
        await finalizeRemovedJournal(paths, quarantinedJournal)
        results.push({
          action: 'cleaned',
          identity: journal.identity,
          operationId: journal.operationId
        })
        continue
      }

      if (declarationPresent || journal.phase !== 'quarantined') {
        throw new Error('Managed plugin removal journal cannot recover the missing declared install.')
      }
      await finalizeRemovedJournal(paths, journal)
      results.push({
        action: 'cleaned',
        identity: journal.identity,
        operationId: journal.operationId
      })
    }

    return results
  })
}
