import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import process from 'node:process'

import type { AdapterAccountCredentialArtifact, AdapterCtx } from '@oneworks/types'

import {
  resolveGlobalOneWorksPath,
  resolvePrimaryWorkspaceFolder,
  resolveProjectHomeDir,
  resolveProjectHomePath
} from './ai-path'
import { withDirectoryInstallLock } from './install-lock'
import { migrateProjectHomeSegment } from './project-home-migration'

export * from './adapter-account-revision'

const WINDOWS_RESERVED_PATH_SEGMENT = /^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])(?:\..*)?$/iu
const ACCOUNT_STORE_DIRNAME = '.oneworks-account-store'
const ACCOUNT_LOCKS_DIRNAME = '.oneworks-account-locks'
const ACCOUNT_GENERATIONS_DIRNAME = 'generations'
const ACCOUNT_POINTER_FILENAME = 'current'
const ADAPTER_KEY_METADATA_FILENAME = '.oneworks-adapter-key.json'
const ACCOUNT_KEY_METADATA_FILENAME = '.oneworks-account-key.json'
const KEY_PATH_VERSION = 'v1'
const GENERATION_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu

const toPortablePathKey = (value: string) => value.normalize('NFKC').toLowerCase()

const encodeLogicalPathKey = (value: string) => (
  `${KEY_PATH_VERSION}-${createHash('sha256').update(value, 'utf8').digest('hex')}`
)

const isReservedInternalPathSegment = (segment: string, _label: string) => {
  const portableSegment = toPortablePathKey(segment)
  return portableSegment === ACCOUNT_STORE_DIRNAME || portableSegment === ACCOUNT_LOCKS_DIRNAME
}

const isInvalidPortablePathSegment = (segment: string) => (
  segment === '' ||
  segment === '.' ||
  segment === '..' ||
  segment.trim() !== segment ||
  /[<>:"|?*]/u.test(segment) ||
  segment.endsWith('.') ||
  WINDOWS_RESERVED_PATH_SEGMENT.test(segment)
)

const assertRelativeArtifactPath = (value: string) => {
  const normalized = value.trim()
  if (
    normalized === '' ||
    normalized !== value ||
    normalized.includes('\0') ||
    normalized.includes('\\') ||
    normalized.startsWith('/') ||
    /^[a-z]:/iu.test(normalized)
  ) {
    throw new Error(`Invalid adapter account artifact path "${value}".`)
  }
  if (normalized.split('/').some(isInvalidPortablePathSegment)) {
    throw new Error(`Adapter account artifact path "${value}" must stay inside the account directory.`)
  }
  return normalized
}

const assertArtifactPathSet = (artifacts: AdapterAccountCredentialArtifact[]) => {
  const paths = artifacts.map(artifact => assertRelativeArtifactPath(artifact.path))
  const portablePaths = paths.map(toPortablePathKey)
  for (let left = 0; left < portablePaths.length; left += 1) {
    for (let right = left + 1; right < portablePaths.length; right += 1) {
      const leftPath = portablePaths[left]!
      const rightPath = portablePaths[right]!
      if (
        leftPath === rightPath ||
        leftPath.startsWith(`${rightPath}/`) ||
        rightPath.startsWith(`${leftPath}/`)
      ) {
        throw new Error(
          `Adapter account artifact paths "${paths[left]}" and "${paths[right]}" collide.`
        )
      }
    }
  }
  return paths
}

export const assertAdapterAccountPathSegment = (value: string, label: string) => {
  const normalized = value.trim()
  if (
    normalized === '' ||
    normalized !== value ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.includes('/') ||
    normalized.includes('\\') ||
    normalized.includes('\0') ||
    /^[a-z]:/iu.test(normalized) ||
    isReservedInternalPathSegment(normalized, label) ||
    isInvalidPortablePathSegment(normalized)
  ) {
    throw new Error(`Invalid ${label} path segment "${value}".`)
  }
  return normalized
}

export const resolveGlobalAdapterAccountDir = (
  env: AdapterCtx['env'],
  adapter: string,
  account: string
) =>
  resolveGlobalOneWorksPath(
    env,
    'adapters',
    encodeLogicalPathKey(assertAdapterAccountPathSegment(adapter, 'adapter')),
    'accounts',
    encodeLogicalPathKey(assertAdapterAccountPathSegment(account, 'account'))
  )

export const resolveAdapterAccountsRoot = (
  cwd: string,
  env: AdapterCtx['env'],
  adapter: string
) => {
  const adapterSegment = assertAdapterAccountPathSegment(adapter, 'adapter')
  const encodedAdapterSegment = encodeLogicalPathKey(adapterSegment)
  const primaryWorkspaceFolder = resolvePrimaryWorkspaceFolder(cwd, env)
  if (primaryWorkspaceFolder != null) {
    return resolveAdapterAccountsRootForWorkspace(primaryWorkspaceFolder, env, encodedAdapterSegment)
  }

  return resolveProjectHomePath(cwd, env, '.local', 'adapters', encodedAdapterSegment, 'accounts')
}

const resolveAdapterAccountsRootForWorkspace = (
  workspaceFolder: string,
  env: AdapterCtx['env'],
  adapter: string
) => resolveProjectHomePath(workspaceFolder, env, '.local', 'adapters', adapter, 'accounts')

export const resolveAdapterAccountReadRoots = (
  cwd: string,
  env: AdapterCtx['env'],
  adapter: string
) => [resolve(resolveAdapterAccountsRoot(cwd, env, adapter))]

const resolveLegacyAdapterAccountsRoot = (
  cwd: string,
  env: AdapterCtx['env'],
  adapter: string
) => {
  const adapterSegment = assertAdapterAccountPathSegment(adapter, 'adapter')
  const primaryWorkspaceFolder = resolvePrimaryWorkspaceFolder(cwd, env)
  return resolveAdapterAccountsRootForWorkspace(
    primaryWorkspaceFolder ?? cwd,
    env,
    adapterSegment
  )
}

const readExactLegacyDirectorySync = (path: string, expectedBasename: string, label: string) => {
  let pathStat
  try {
    pathStat = lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (pathStat.isSymbolicLink() || !pathStat.isDirectory()) {
    throw new Error(`${label} must be a real directory and cannot be a symbolic link: ${path}`)
  }
  const canonicalPath = realpathSync.native(path)
  return basename(canonicalPath) === expectedBasename ? canonicalPath : undefined
}

const resolveExactLegacyAccountDirSync = (
  cwd: string,
  env: AdapterCtx['env'],
  adapter: string,
  account: string
) => {
  const adapterSegment = assertAdapterAccountPathSegment(adapter, 'adapter')
  const accountSegment = assertAdapterAccountPathSegment(account, 'account')
  const legacyAccountsRoot = resolveLegacyAdapterAccountsRoot(cwd, env, adapterSegment)
  const legacyAdapterDir = readExactLegacyDirectorySync(
    dirname(legacyAccountsRoot),
    adapterSegment,
    'Legacy adapter directory'
  )
  if (legacyAdapterDir == null) return undefined
  const accountsRoot = readExactLegacyDirectorySync(
    resolve(legacyAdapterDir, 'accounts'),
    'accounts',
    'Legacy adapter accounts root'
  )
  if (accountsRoot == null) return undefined
  return readExactLegacyDirectorySync(
    resolve(accountsRoot, accountSegment),
    accountSegment,
    'Legacy adapter account directory'
  )
}

export const resolveAdapterAccountReadDirs = (
  cwd: string,
  env: AdapterCtx['env'],
  adapter: string,
  account: string
) => {
  const accountSegment = assertAdapterAccountPathSegment(account, 'account')
  return resolveAdapterAccountReadRoots(cwd, env, adapter).map((root) => {
    const generationDir = resolvePublishedAccountGeneration(root, adapter, accountSegment)
    return generationDir ??
      resolveExactLegacyAccountDirSync(cwd, env, adapter, accountSegment) ??
      resolveAccountStoragePaths(root, accountSegment).accountStateDir
  })
}

export const resolveAdapterAccountDir = (
  cwd: string,
  env: AdapterCtx['env'],
  adapter: string,
  account: string
) => resolveAdapterAccountReadDirs(cwd, env, adapter, account)[0]!

export const migrateStoredAdapterAccounts = async (
  cwd: string,
  env: AdapterCtx['env']
) => migrateProjectHomeSegment(cwd, env, '.local')

interface PathIdentity {
  dev: number
  ino: number
  isDirectory: boolean
  isFile: boolean
  isSymbolicLink: boolean
}

interface SecureAccountsRoot {
  accountsRoot: string
  canonicalProjectHome: string
  chain: Array<{ identity: PathIdentity; path: string }>
  projectHomeIdentity: PathIdentity
}

interface AccountStoragePaths {
  accountStateDir: string
  currentPointerPath: string
  generationsDir: string
  storeRoot: string
}

interface AccountStorageContext extends AccountStoragePaths {
  accountKey: string
  accountStateIdentity: PathIdentity
  generationsIdentity: PathIdentity
  storeRootIdentity: PathIdentity
}

const readPathIdentity = async (path: string): Promise<PathIdentity | undefined> => {
  try {
    const pathStat = await lstat(path)
    return {
      dev: pathStat.dev,
      ino: pathStat.ino,
      isDirectory: pathStat.isDirectory(),
      isFile: pathStat.isFile(),
      isSymbolicLink: pathStat.isSymbolicLink()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const identitiesMatch = (left: PathIdentity, right: PathIdentity) => (
  left.dev === right.dev && left.ino === right.ino
)

const assertSecureDirectory = async (path: string, label: string) => {
  const identity = await readPathIdentity(path)
  if (identity?.isSymbolicLink === true || (identity != null && !identity.isDirectory)) {
    throw new Error(`${label} must be a real directory and cannot be a symbolic link: ${path}`)
  }
  return identity
}

const assertCanonicalChildDirectory = async (params: {
  expected?: PathIdentity
  label: string
  parent: string
  path: string
}) => {
  const identity = await assertSecureDirectory(params.path, params.label)
  if (identity == null) return undefined
  if (params.expected != null && !identitiesMatch(params.expected, identity)) {
    throw new Error(`${params.label} changed while it was being updated: ${params.path}`)
  }
  const canonicalPath = await realpath(params.path)
  const relativePath = relative(params.parent, canonicalPath)
  if (
    relativePath === '' ||
    isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    relativePath.includes('/') ||
    relativePath.includes('\\')
  ) {
    throw new Error(`${params.label} resolves outside its parent directory: ${params.path}`)
  }
  return { identity, path: canonicalPath }
}

const ensureCanonicalChildDirectory = async (params: {
  label: string
  name: string
  parent: string
}) => {
  const path = resolve(params.parent, params.name)
  await assertSecureDirectory(path, params.label)
  await mkdir(path, { mode: 0o700 })
    .catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    })
  const result = await assertCanonicalChildDirectory({
    label: params.label,
    parent: params.parent,
    path
  })
  if (result == null) throw new Error(`Failed to create ${params.label}: ${path}`)
  await chmod(result.path, 0o700)
  return result
}

const parseLogicalKeyMetadata = (value: string) => {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    return parsed.version === KEY_PATH_VERSION && typeof parsed.key === 'string'
      ? { key: parsed.key, version: KEY_PATH_VERSION }
      : undefined
  } catch {
    return undefined
  }
}

const ensureLogicalKeyMetadata = async (params: {
  directory: string
  filename: string
  key: string
  label: string
}) => {
  const metadataPath = resolve(params.directory, params.filename)
  let identity = await readPathIdentity(metadataPath)
  if (identity == null) {
    const handle = await open(metadataPath, 'wx', 0o600).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return undefined
      throw error
    })
    if (handle != null) {
      try {
        await handle.writeFile(`${JSON.stringify({ key: params.key, version: KEY_PATH_VERSION })}\n`, 'utf8')
        await handle.chmod(0o600)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await syncDirectory(params.directory)
    }
    identity = await readPathIdentity(metadataPath)
  }
  if (identity == null || identity.isSymbolicLink || !identity.isFile) {
    throw new Error(`${params.label} metadata must be a real file: ${metadataPath}`)
  }
  const metadata = parseLogicalKeyMetadata(await readFile(metadataPath, 'utf8'))
  if (metadata?.key !== params.key) {
    throw new Error(`${params.label} metadata does not match the requested logical key: ${metadataPath}`)
  }
  await chmod(metadataPath, 0o600)
}

const assertLogicalKeyMetadataSync = (params: {
  directory: string
  filename: string
  key: string
  label: string
}) => {
  const metadataPath = resolve(params.directory, params.filename)
  const identity = lstatSync(metadataPath)
  if (identity.isSymbolicLink() || !identity.isFile()) {
    throw new Error(`${params.label} metadata must be a real file: ${metadataPath}`)
  }
  const metadata = parseLogicalKeyMetadata(readFileSync(metadataPath, 'utf8'))
  if (metadata?.key !== params.key) {
    throw new Error(`${params.label} metadata does not match the requested logical key: ${metadataPath}`)
  }
}

const ensureSecureAccountsRoot = async (params: {
  adapter: string
  cwd: string
  env: AdapterCtx['env']
  expected?: SecureAccountsRoot
}): Promise<SecureAccountsRoot> => {
  const projectHome = resolveProjectHomeDir(params.cwd, params.env)
  const accountsRoot = resolveAdapterAccountsRoot(params.cwd, params.env, params.adapter)
  const relativeAccountsRoot = relative(projectHome, accountsRoot)
  if (
    relativeAccountsRoot === '' ||
    isAbsolute(relativeAccountsRoot) ||
    relativeAccountsRoot === '..' ||
    relativeAccountsRoot.startsWith('../')
  ) {
    throw new Error(`Adapter accounts root must stay inside the project home: ${accountsRoot}`)
  }

  await mkdir(projectHome, { recursive: true, mode: 0o700 })
  const canonicalProjectHome = await realpath(projectHome)
  const projectHomeIdentity = await assertSecureDirectory(canonicalProjectHome, 'Canonical project home')
  if (projectHomeIdentity == null) throw new Error(`Project home is unavailable: ${projectHome}`)
  if (
    params.expected != null &&
    (
      params.expected.canonicalProjectHome !== canonicalProjectHome ||
      !identitiesMatch(params.expected.projectHomeIdentity, projectHomeIdentity)
    )
  ) {
    throw new Error(`Canonical project home changed while adapter artifacts were being updated: ${projectHome}`)
  }

  const segments = relativeAccountsRoot.split(/[\\/]+/u).filter(Boolean)
  const chain: SecureAccountsRoot['chain'] = []
  let current = canonicalProjectHome
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!
    const label = index === segments.length - 1
      ? 'Adapter accounts root'
      : 'Adapter accounts root ancestor'
    const child = await ensureCanonicalChildDirectory({ label, name: segment, parent: current })
    const expectedChild = params.expected?.chain[index]
    if (
      expectedChild != null &&
      (expectedChild.path !== child.path || !identitiesMatch(expectedChild.identity, child.identity))
    ) {
      throw new Error(`${label} changed while adapter artifacts were being updated: ${child.path}`)
    }
    chain.push(child)
    current = child.path
  }
  if (params.expected != null && params.expected.chain.length !== chain.length) {
    throw new Error(`Adapter accounts root ancestry changed: ${accountsRoot}`)
  }
  await chmod(current, 0o700)
  await ensureLogicalKeyMetadata({
    directory: dirname(current),
    filename: ADAPTER_KEY_METADATA_FILENAME,
    key: assertAdapterAccountPathSegment(params.adapter, 'adapter'),
    label: 'Adapter key'
  })
  return {
    accountsRoot: current,
    canonicalProjectHome,
    chain,
    projectHomeIdentity
  }
}

const resolveAccountStoragePaths = (accountsRoot: string, account: string): AccountStoragePaths => {
  const accountSegment = assertAdapterAccountPathSegment(account, 'account')
  const storeRoot = resolve(accountsRoot, ACCOUNT_STORE_DIRNAME)
  const accountStateDir = resolve(storeRoot, encodeLogicalPathKey(accountSegment))
  return {
    accountStateDir,
    currentPointerPath: resolve(accountStateDir, ACCOUNT_POINTER_FILENAME),
    generationsDir: resolve(accountStateDir, ACCOUNT_GENERATIONS_DIRNAME),
    storeRoot
  }
}

function resolvePublishedAccountGeneration(accountsRoot: string, adapter: string, account: string) {
  const paths = resolveAccountStoragePaths(accountsRoot, account)
  let pointerStat
  try {
    pointerStat = lstatSync(paths.currentPointerPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (pointerStat.isSymbolicLink() || !pointerStat.isFile()) {
    throw new Error(`Adapter account generation pointer must be a real file: ${paths.currentPointerPath}`)
  }
  assertLogicalKeyMetadataSync({
    directory: dirname(accountsRoot),
    filename: ADAPTER_KEY_METADATA_FILENAME,
    key: assertAdapterAccountPathSegment(adapter, 'adapter'),
    label: 'Adapter key'
  })
  assertLogicalKeyMetadataSync({
    directory: paths.accountStateDir,
    filename: ACCOUNT_KEY_METADATA_FILENAME,
    key: assertAdapterAccountPathSegment(account, 'account'),
    label: 'Adapter account key'
  })
  const generation = readFileSync(paths.currentPointerPath, 'utf8').trim()
  if (!GENERATION_PATTERN.test(generation)) {
    throw new Error(`Adapter account generation pointer is invalid: ${paths.currentPointerPath}`)
  }
  for (
    const [path, label] of [
      [paths.storeRoot, 'Adapter account store root'],
      [paths.accountStateDir, 'Adapter account state directory'],
      [paths.generationsDir, 'Adapter account generations directory']
    ] as const
  ) {
    const pathStat = lstatSync(path)
    if (pathStat.isSymbolicLink() || !pathStat.isDirectory()) {
      throw new Error(`${label} must be a real directory and cannot be a symbolic link: ${path}`)
    }
  }
  const generationDir = resolve(paths.generationsDir, generation)
  const generationStat = lstatSync(generationDir)
  if (generationStat.isSymbolicLink() || !generationStat.isDirectory()) {
    throw new Error(`Adapter account generation must be a real directory: ${generationDir}`)
  }
  const canonicalGenerationsDir = realpathSync.native(paths.generationsDir)
  const canonicalGenerationDir = realpathSync.native(generationDir)
  if (relative(canonicalGenerationsDir, canonicalGenerationDir) !== generation) {
    throw new Error(`Adapter account generation resolves outside its generation root: ${generationDir}`)
  }
  return canonicalGenerationDir
}

const ensureAccountStorage = async (accountsRoot: string, account: string): Promise<AccountStorageContext> => {
  const paths = resolveAccountStoragePaths(accountsRoot, account)
  const storeRoot = await ensureCanonicalChildDirectory({
    label: 'Adapter account store root',
    name: ACCOUNT_STORE_DIRNAME,
    parent: accountsRoot
  })
  const accountState = await ensureCanonicalChildDirectory({
    label: 'Adapter account state directory',
    name: encodeLogicalPathKey(assertAdapterAccountPathSegment(account, 'account')),
    parent: storeRoot.path
  })
  await ensureLogicalKeyMetadata({
    directory: accountState.path,
    filename: ACCOUNT_KEY_METADATA_FILENAME,
    key: account,
    label: 'Adapter account key'
  })
  const generations = await ensureCanonicalChildDirectory({
    label: 'Adapter account generations directory',
    name: ACCOUNT_GENERATIONS_DIRNAME,
    parent: accountState.path
  })
  return {
    accountKey: account,
    accountStateDir: accountState.path,
    accountStateIdentity: accountState.identity,
    currentPointerPath: resolve(accountState.path, ACCOUNT_POINTER_FILENAME),
    generationsDir: generations.path,
    generationsIdentity: generations.identity,
    storeRoot: storeRoot.path,
    storeRootIdentity: storeRoot.identity
  }
}

const assertAccountStorageIdentity = async (context: AccountStorageContext) => {
  const storeRoot = await assertCanonicalChildDirectory({
    expected: context.storeRootIdentity,
    label: 'Adapter account store root',
    parent: dirname(context.storeRoot),
    path: context.storeRoot
  })
  if (storeRoot == null) throw new Error(`Adapter account store root disappeared: ${context.storeRoot}`)
  const accountState = await assertCanonicalChildDirectory({
    expected: context.accountStateIdentity,
    label: 'Adapter account state directory',
    parent: storeRoot.path,
    path: context.accountStateDir
  })
  if (accountState == null) throw new Error(`Adapter account state directory disappeared: ${context.accountStateDir}`)
  await ensureLogicalKeyMetadata({
    directory: accountState.path,
    filename: ACCOUNT_KEY_METADATA_FILENAME,
    key: context.accountKey,
    label: 'Adapter account key'
  })
  const generations = await assertCanonicalChildDirectory({
    expected: context.generationsIdentity,
    label: 'Adapter account generations directory',
    parent: accountState.path,
    path: context.generationsDir
  })
  if (generations == null) {
    throw new Error(`Adapter account generations directory disappeared: ${context.generationsDir}`)
  }
}

const readOptionalAccountStateIdentity = async (accountsRoot: string, account: string) => {
  const paths = resolveAccountStoragePaths(accountsRoot, account)
  const storeRoot = await assertCanonicalChildDirectory({
    label: 'Adapter account store root',
    parent: accountsRoot,
    path: paths.storeRoot
  })
  if (storeRoot == null) return undefined
  const accountState = await assertCanonicalChildDirectory({
    label: 'Adapter account state directory',
    parent: storeRoot.path,
    path: paths.accountStateDir
  })
  return accountState?.identity
}

const assertOptionalAccountStateIdentity = async (params: {
  account: string
  accountsRoot: string
  expected: PathIdentity | undefined
}) => {
  const current = await readOptionalAccountStateIdentity(params.accountsRoot, params.account)
  if (params.expected == null && current != null) {
    throw new Error('Adapter account state appeared while it was being updated.')
  }
  if (params.expected != null && (current == null || !identitiesMatch(params.expected, current))) {
    throw new Error('Adapter account state changed while it was being updated.')
  }
  return current
}

const assertSafeGenerationPointer = async (pointerPath: string) => {
  const identity = await readPathIdentity(pointerPath)
  if (identity != null && (identity.isSymbolicLink || !identity.isFile)) {
    throw new Error(`Adapter account generation pointer must be a real file: ${pointerPath}`)
  }
  return identity
}

const syncDirectory = async (path: string) => {
  let handle
  try {
    handle = await open(path, 'r')
    await handle.sync()
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw error
    }
  } finally {
    await handle?.close()
  }
}

const ensurePrivateParentDirectories = async (root: string, relativeFilePath: string) => {
  const segments = relativeFilePath.split('/').slice(0, -1)
  let current = root
  for (const segment of segments) {
    const parent = current
    current = resolve(current, segment)
    await mkdir(current, { mode: 0o700 }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    })
    const identity = await assertSecureDirectory(current, 'Adapter artifact directory')
    if (identity == null) throw new Error(`Adapter artifact directory is unavailable: ${current}`)
    await chmod(current, 0o700)
    await syncDirectory(parent)
  }
}

const writePrivateArtifact = async (targetPath: string, content: string) => {
  const handle = await open(targetPath, 'wx', 0o600)
  try {
    await handle.writeFile(content, { encoding: 'utf8' })
    await handle.chmod(0o600)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await syncDirectory(dirname(targetPath))
}

const publishAccountGeneration = async (params: {
  generation: string
  storage: AccountStorageContext
  validate: () => Promise<void>
}) => {
  const tempPointerPath = resolve(
    params.storage.accountStateDir,
    `.${ACCOUNT_POINTER_FILENAME}.${process.pid}.${randomUUID()}.tmp`
  )
  try {
    await writePrivateArtifact(tempPointerPath, `${params.generation}\n`)
    await params.validate()
    await assertSafeGenerationPointer(params.storage.currentPointerPath)
    await rename(tempPointerPath, params.storage.currentPointerPath)
    await syncDirectory(params.storage.accountStateDir)
  } finally {
    await rm(tempPointerPath, { force: true }).catch(() => undefined)
  }
}

const readExactLegacyAccountIdentity = async (params: {
  account: string
  adapter: string
  cwd: string
  env: AdapterCtx['env']
}) => {
  const path = resolveExactLegacyAccountDirSync(params.cwd, params.env, params.adapter, params.account)
  if (path == null) return undefined
  const identity = await assertSecureDirectory(path, 'Legacy adapter account directory')
  return identity == null ? undefined : { identity, path }
}

const assertExactLegacyAccountIdentity = async (params: {
  account: string
  adapter: string
  cwd: string
  env: AdapterCtx['env']
  expected: Awaited<ReturnType<typeof readExactLegacyAccountIdentity>>
}) => {
  const current = await readExactLegacyAccountIdentity(params)
  if (params.expected == null && current != null) {
    throw new Error('Legacy adapter account directory appeared while it was being updated.')
  }
  if (
    params.expected != null &&
    (
      current == null ||
      current.path !== params.expected.path ||
      !identitiesMatch(current.identity, params.expected.identity)
    )
  ) {
    throw new Error('Legacy adapter account directory changed while it was being updated.')
  }
  return current
}

const ensureAccountLocksRoot = async (accountsRoot: string) => (
  await ensureCanonicalChildDirectory({
    label: 'Adapter account locks root',
    name: ACCOUNT_LOCKS_DIRNAME,
    parent: accountsRoot
  })
)

const withAdapterAccountLock = async <T>(lockDir: string, callback: () => Promise<T>) => (
  await withDirectoryInstallLock({
    lockDir
  }, callback)
)

export const persistAdapterAccountArtifacts = async (params: {
  cwd: string
  env: AdapterCtx['env']
  adapter: string
  account: string
  artifacts: AdapterAccountCredentialArtifact[]
}) => {
  const artifactPaths = assertArtifactPathSet(params.artifacts)
  const accountKey = assertAdapterAccountPathSegment(params.account, 'account')
  assertAdapterAccountPathSegment(params.adapter, 'adapter')
  const initialRoot = await ensureSecureAccountsRoot(params)
  await migrateStoredAdapterAccounts(params.cwd, params.env)
  await ensureSecureAccountsRoot({ ...params, expected: initialRoot })
  await readExactLegacyAccountIdentity(params)
  await readOptionalAccountStateIdentity(initialRoot.accountsRoot, params.account)
  const initialLocksRoot = await ensureAccountLocksRoot(initialRoot.accountsRoot)
  const lockDir = resolve(initialLocksRoot.path, encodeLogicalPathKey(accountKey))
  let publishedAccountDir: string | undefined

  await withAdapterAccountLock(lockDir, async () => {
    const lockedRoot = await ensureSecureAccountsRoot({ ...params, expected: initialRoot })
    const lockedLocksRoot = await assertCanonicalChildDirectory({
      expected: initialLocksRoot.identity,
      label: 'Adapter account locks root',
      parent: lockedRoot.accountsRoot,
      path: initialLocksRoot.path
    })
    if (lockedLocksRoot == null) throw new Error('Adapter account locks root disappeared while locking.')
    const lockedLegacyAccount = await readExactLegacyAccountIdentity(params)
    const lockedStateIdentity = await readOptionalAccountStateIdentity(lockedRoot.accountsRoot, params.account)
    const storage = await ensureAccountStorage(lockedRoot.accountsRoot, params.account)
    if (
      lockedStateIdentity != null &&
      !identitiesMatch(lockedStateIdentity, storage.accountStateIdentity)
    ) {
      throw new Error('Adapter account state changed while it was being locked.')
    }
    await assertSafeGenerationPointer(storage.currentPointerPath)

    const generation = randomUUID()
    const stagingDir = resolve(storage.generationsDir, `.${generation}.staging`)
    const generationDir = resolve(storage.generationsDir, generation)
    await mkdir(stagingDir, { mode: 0o700 })
    await chmod(stagingDir, 0o700)
    await syncDirectory(storage.generationsDir)
    let generationReady = false
    try {
      for (let index = 0; index < params.artifacts.length; index += 1) {
        const relativeArtifactPath = artifactPaths[index]!
        await ensurePrivateParentDirectories(stagingDir, relativeArtifactPath)
        await writePrivateArtifact(
          resolve(stagingDir, relativeArtifactPath),
          params.artifacts[index]!.content
        )
      }
      await syncDirectory(stagingDir)
      await ensureSecureAccountsRoot({ ...params, expected: lockedRoot })
      await assertExactLegacyAccountIdentity({ ...params, expected: lockedLegacyAccount })
      await assertAccountStorageIdentity(storage)
      await rename(stagingDir, generationDir)
      generationReady = true
      await syncDirectory(storage.generationsDir)
      const publishedGeneration = await assertCanonicalChildDirectory({
        label: 'Adapter account generation',
        parent: storage.generationsDir,
        path: generationDir
      })
      if (publishedGeneration == null) {
        throw new Error(`Adapter account generation disappeared before publication: ${generationDir}`)
      }
      await publishAccountGeneration({
        generation,
        storage,
        validate: async () => {
          await ensureSecureAccountsRoot({ ...params, expected: lockedRoot })
          await assertExactLegacyAccountIdentity({ ...params, expected: lockedLegacyAccount })
          await assertAccountStorageIdentity(storage)
          const currentGeneration = await assertCanonicalChildDirectory({
            expected: publishedGeneration.identity,
            label: 'Adapter account generation',
            parent: storage.generationsDir,
            path: generationDir
          })
          if (currentGeneration == null) {
            throw new Error(`Adapter account generation disappeared before publication: ${generationDir}`)
          }
        }
      })
      publishedAccountDir = generationDir
    } catch (error) {
      if (!generationReady) {
        await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
      }
      throw error
    }
  })

  if (publishedAccountDir == null) throw new Error('Adapter account generation was not published.')
  return {
    accountDir: publishedAccountDir
  }
}

export const removeStoredAdapterAccount = async (params: {
  cwd: string
  env: AdapterCtx['env']
  adapter: string
  account: string
}) => {
  const accountKey = assertAdapterAccountPathSegment(params.account, 'account')
  assertAdapterAccountPathSegment(params.adapter, 'adapter')
  const initialRoot = await ensureSecureAccountsRoot(params)
  await migrateStoredAdapterAccounts(params.cwd, params.env)
  await ensureSecureAccountsRoot({ ...params, expected: initialRoot })
  await readExactLegacyAccountIdentity(params)
  await readOptionalAccountStateIdentity(initialRoot.accountsRoot, params.account)
  const initialLocksRoot = await ensureAccountLocksRoot(initialRoot.accountsRoot)
  const lockDir = resolve(initialLocksRoot.path, encodeLogicalPathKey(accountKey))
  const accountStateDir = resolveAccountStoragePaths(initialRoot.accountsRoot, accountKey).accountStateDir

  await withAdapterAccountLock(lockDir, async () => {
    const lockedRoot = await ensureSecureAccountsRoot({ ...params, expected: initialRoot })
    const lockedLocksRoot = await assertCanonicalChildDirectory({
      expected: initialLocksRoot.identity,
      label: 'Adapter account locks root',
      parent: lockedRoot.accountsRoot,
      path: initialLocksRoot.path
    })
    if (lockedLocksRoot == null) throw new Error('Adapter account locks root disappeared while locking.')
    const lockedLegacyAccount = await readExactLegacyAccountIdentity(params)
    const lockedStateIdentity = await readOptionalAccountStateIdentity(lockedRoot.accountsRoot, params.account)

    await ensureSecureAccountsRoot({ ...params, expected: lockedRoot })
    await assertExactLegacyAccountIdentity({ ...params, expected: lockedLegacyAccount })
    await assertOptionalAccountStateIdentity({
      account: params.account,
      accountsRoot: lockedRoot.accountsRoot,
      expected: lockedStateIdentity
    })
    if (lockedStateIdentity != null) {
      const paths = resolveAccountStoragePaths(lockedRoot.accountsRoot, params.account)
      await rm(paths.accountStateDir, { recursive: true, force: true })
    }
    if (lockedLegacyAccount != null) {
      await rm(lockedLegacyAccount.path, { recursive: true, force: true })
    }
  })
  return {
    accountDir: accountStateDir
  }
}
