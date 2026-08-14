/* eslint-disable max-lines -- release verification and atomic install policy stay auditable in one module. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import type { AdapterCtx } from '@oneworks/types'
import { withDirectoryInstallLock } from '@oneworks/utils/install-lock'
import { resolveUserShellBinaryPath } from '@oneworks/utils/managed-npm-cli'

import type { GooseCliConfig } from './config-schema'
import {
  GOOSE_CLI_VERSION,
  GOOSE_MINIMUM_ACP_VERSION,
  GOOSE_RELEASE_REPOSITORY,
  normalizeGooseReleaseVersion,
  resolveGooseManagedBinaryPath,
  resolveGooseManagedRootDir,
  resolveGooseManagedVersionDir,
  resolveGooseReleaseTarget
} from './paths'
import type { GooseReleaseTarget } from './paths'

const execFileAsync = promisify(execFile)
const COMMAND_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000

interface GooseReleaseAsset {
  digest: string
  downloadUrl: string
  name: string
}

export interface GooseCliDependencies {
  execFile?: typeof execFileAsync
  fetch?: typeof fetch
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  resolveSystemBinary?: typeof resolveUserShellBinaryPath
}

const GOOSE_PROBE_ENV_NAMES = [
  'ALL_PROXY',
  'COMSPEC',
  'ComSpec',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'NODE_EXTRA_CA_CERTS',
  'NO_PROXY',
  'PATH',
  'PATHEXT',
  'Path',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'SHELL',
  'SYSTEMROOT',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'USERPROFILE',
  'WINDIR',
  'all_proxy',
  'http_proxy',
  'https_proxy',
  'no_proxy'
] as const

export const createGooseProbeEnv = (
  env: AdapterCtx['env'] | NodeJS.ProcessEnv
): NodeJS.ProcessEnv => {
  const result: NodeJS.ProcessEnv = {}
  for (const name of GOOSE_PROBE_ENV_NAMES) {
    const value = Object.prototype.hasOwnProperty.call(env, name) ? env[name] : process.env[name]
    if (typeof value === 'string') result[name] = value
  }
  return result
}

const normalizeSource = (value: unknown) => (
  value === 'managed' || value === 'system' || value === 'path' ? value : undefined
)

const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const normalizeBoolean = (value: unknown) => {
  if (value === true || value === 'true' || value === '1') return true
  if (value === false || value === 'false' || value === '0') return false
  return undefined
}

interface ParsedSemver {
  core: readonly [number, number, number]
  prerelease: string[]
  version: string
}

const parseSemver = (value: string): ParsedSemver | undefined => {
  const match = value.match(
    /(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*))?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?=\s|$)/u
  )
  if (match == null) return undefined
  const core = [Number(match[1]), Number(match[2]), Number(match[3])] as const
  const prerelease = match[4]?.split('.') ?? []
  return {
    core,
    prerelease,
    version: `${core.join('.')}${prerelease.length === 0 ? '' : `-${prerelease.join('.')}`}`
  }
}

const comparePrerelease = (left: string[], right: string[]) => {
  if (left.length === 0 || right.length === 0) return left.length === right.length ? 0 : left.length === 0 ? 1 : -1
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index]
    const rightPart = right[index]
    if (leftPart == null || rightPart == null) return leftPart == null ? -1 : 1
    if (leftPart === rightPart) continue
    const leftNumeric = /^\d+$/u.test(leftPart)
    const rightNumeric = /^\d+$/u.test(rightPart)
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftPart > rightPart ? 1 : -1
  }
  return 0
}

const compareSemver = (left: ParsedSemver, right: ParsedSemver) => {
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return Number(left.core[index]) > Number(right.core[index]) ? 1 : -1
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

export const probeGooseBinary = async (params: {
  binaryPath: string
  env: NodeJS.ProcessEnv
  exec?: typeof execFileAsync
  expectedVersion?: string
}) => {
  const run = params.exec ?? execFileAsync
  try {
    const result = await run(params.binaryPath, ['--version'], {
      env: params.env,
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true
    })
    const output = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`.trim()
    const actual = parseSemver(output)
    if (actual == null) return undefined
    if (params.expectedVersion != null) {
      const expected = parseSemver(normalizeGooseReleaseVersion(params.expectedVersion))
      if (expected == null || compareSemver(actual, expected) !== 0) return undefined
    } else {
      const minimum = parseSemver(GOOSE_MINIMUM_ACP_VERSION)
      if (minimum == null || compareSemver(actual, minimum) < 0) return undefined
    }
    return actual.version
  } catch {
    return undefined
  }
}

const readPathMetadata = async (candidatePath: string) => {
  try {
    return await lstat(candidatePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const resolveContainedManagedBinary = async (params: {
  env: AdapterCtx['env'] | NodeJS.ProcessEnv
  target: GooseReleaseTarget
  version: string
}) => {
  const managedRoot = resolveGooseManagedRootDir(params.env as AdapterCtx['env'])
  const versionDir = resolveGooseManagedVersionDir({
    env: params.env as AdapterCtx['env'],
    target: params.target,
    version: params.version
  })
  const binaryPath = resolveGooseManagedBinaryPath({
    env: params.env as AdapterCtx['env'],
    target: params.target,
    version: params.version
  })
  const directories = [managedRoot, resolve(managedRoot, 'versions'), dirname(versionDir), versionDir]
  for (const directory of directories) {
    const metadata = await readPathMetadata(directory)
    if (metadata == null) return undefined
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('Goose managed cache contains an unsafe directory entry.')
    }
  }
  const binaryMetadata = await readPathMetadata(binaryPath)
  if (binaryMetadata == null) return undefined
  if (binaryMetadata.isSymbolicLink() || !binaryMetadata.isFile()) {
    throw new Error('Goose managed cache binary is not a regular file.')
  }
  const resolvedRoot = await realpath(managedRoot)
  const resolvedBinary = await realpath(binaryPath)
  assertContainedPath(resolvedRoot, resolvedBinary)
  return binaryPath
}

const resolveReleaseAsset = async (params: {
  fetchImpl: typeof fetch
  target: GooseReleaseTarget
  version: string
}): Promise<GooseReleaseAsset> => {
  const tag = `v${normalizeGooseReleaseVersion(params.version)}`
  const response = await params.fetchImpl(
    `https://api.github.com/repos/${GOOSE_RELEASE_REPOSITORY}/releases/tags/${tag}`,
    { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'oneworks-goose-adapter' } }
  )
  if (!response.ok) {
    throw new Error(`Failed to read Goose release ${tag} metadata (${response.status}).`)
  }
  const metadata = await response.json() as { assets?: unknown }
  if (!Array.isArray(metadata.assets)) throw new Error(`Goose release ${tag} returned invalid asset metadata.`)
  const asset = metadata.assets.find((value): value is Record<string, unknown> => (
    value != null && typeof value === 'object' && !Array.isArray(value) &&
    (value as Record<string, unknown>).name === params.target.assetName
  ))
  if (asset == null || typeof asset.browser_download_url !== 'string') {
    throw new Error(`Goose release ${tag} does not contain ${params.target.assetName}.`)
  }
  const downloadUrl = new URL(asset.browser_download_url)
  const expectedDownloadPath = `/${GOOSE_RELEASE_REPOSITORY}/releases/download/${tag}/${params.target.assetName}`
  if (
    downloadUrl.protocol !== 'https:' || downloadUrl.hostname !== 'github.com' ||
    downloadUrl.pathname !== expectedDownloadPath || downloadUrl.search !== '' || downloadUrl.hash !== ''
  ) {
    throw new Error(`Goose release ${tag} returned an untrusted download URL.`)
  }
  const digest = typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/u.test(asset.digest)
    ? asset.digest.slice('sha256:'.length)
    : undefined
  if (digest == null) {
    throw new Error(`Goose release ${tag} did not publish a valid sha256 digest for ${params.target.assetName}.`)
  }
  return { digest, downloadUrl: downloadUrl.toString(), name: params.target.assetName }
}

const hashFile = async (filePath: string) => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

export const assertArchiveEntriesAreContained = (output: string) => {
  const entries = output.split(/\r?\n/u).map(value => value.trim()).filter(Boolean)
  if (entries.length === 0) throw new Error('The Goose release archive is empty.')
  for (const entry of entries) {
    const portable = entry.replaceAll('\\', '/').replace(/^\.\//u, '')
    if (
      portable === '' || portable.includes('\0') || portable.startsWith('/') ||
      /^[A-Za-z]:\//u.test(portable) || portable.split('/').includes('..')
    ) {
      throw new Error(`Goose release archive contains an unsafe path: ${entry}`)
    }
  }
}

export const assertArchiveEntryTypesAreSafe = (output: string) => {
  const entries = output.split(/\r?\n/u).map(value => value.trim()).filter(Boolean)
  if (entries.length === 0) throw new Error('The Goose release archive is empty.')
  for (const entry of entries) {
    if (entry[0] !== '-' && entry[0] !== 'd') {
      throw new Error('Goose release archive contains a link or special file.')
    }
  }
}

const assertContainedPath = (rootPath: string, candidatePath: string) => {
  const child = relative(rootPath, candidatePath)
  if (child === '' || child.startsWith('..') || isAbsolute(child)) {
    throw new Error('Goose release extraction escaped its staging directory.')
  }
}

const findExtractedBinary = async (rootPath: string, binaryName: string): Promise<string> => {
  const visit = async (directory: string): Promise<string[]> => {
    const matches: string[] = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = resolve(directory, entry.name)
      assertContainedPath(rootPath, entryPath)
      const metadata = await lstat(entryPath)
      if (metadata.isSymbolicLink()) throw new Error('Goose release archive contains a symbolic link.')
      if (metadata.isDirectory()) matches.push(...await visit(entryPath))
      else if (metadata.isFile() && basename(entryPath) === binaryName) matches.push(entryPath)
    }
    return matches
  }
  const matches = await visit(rootPath)
  if (matches.length !== 1) {
    throw new Error(`Goose release archive must contain exactly one ${binaryName} binary.`)
  }
  const resolvedRoot = await realpath(rootPath)
  const resolvedBinary = await realpath(matches[0])
  assertContainedPath(resolvedRoot, resolvedBinary)
  return matches[0]
}

const replaceDirectoryAtomically = async (
  stagedDir: string,
  finalDir: string,
  verifyFinal: () => Promise<boolean>
) => {
  const backupDir = `${finalDir}.previous-${process.pid}-${Date.now()}`
  let hasBackup = false
  try {
    await rename(finalDir, backupDir)
    hasBackup = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  try {
    await rename(stagedDir, finalDir)
    if (!await verifyFinal()) throw new Error('Installed Goose CLI failed its final version verification.')
  } catch (error) {
    await rm(finalDir, { recursive: true, force: true }).catch(() => undefined)
    if (hasBackup) await rename(backupDir, finalDir).catch(() => undefined)
    throw error
  }
  if (hasBackup) await rm(backupDir, { recursive: true, force: true })
}

export const installManagedGooseCli = async (params: {
  config?: GooseCliConfig
  ctx: Pick<AdapterCtx, 'env' | 'logger'>
  dependencies?: GooseCliDependencies
  version: string
}) => {
  const dependencies = params.dependencies ?? {}
  const target = resolveGooseReleaseTarget({
    arch: dependencies.arch,
    platform: dependencies.platform,
    variant: params.config?.variant
  })
  const version = normalizeGooseReleaseVersion(params.version)
  const managedRoot = resolveGooseManagedRootDir(params.ctx.env)
  const finalDir = resolveGooseManagedVersionDir({ env: params.ctx.env, target, version })
  const finalBinary = resolveGooseManagedBinaryPath({ env: params.ctx.env, target, version })
  const run = dependencies.execFile ?? execFileAsync
  const probeEnv = createGooseProbeEnv(params.ctx.env)

  await withDirectoryInstallLock({ lockDir: `${managedRoot}.lock` }, async () => {
    const cachedBinary = await resolveContainedManagedBinary({ env: params.ctx.env, target, version })
    if (
      cachedBinary != null &&
      await probeGooseBinary({ binaryPath: cachedBinary, env: probeEnv, exec: run, expectedVersion: version })
    ) return

    const release = await resolveReleaseAsset({
      fetchImpl: dependencies.fetch ?? fetch,
      target,
      version
    })
    const versionsDir = dirname(dirname(finalDir))
    await mkdir(versionsDir, { recursive: true })
    const tempDir = await mkdtemp(resolve(versionsDir, '.goose-install-'))
    const archivePath = resolve(tempDir, release.name)
    const extractDir = resolve(tempDir, 'payload')
    const stagedDir = resolve(tempDir, 'staged')

    try {
      params.ctx.logger.info(`Installing Goose CLI ${version} into the global bootstrap cache`)
      await run('curl', [
        '--fail',
        '--location',
        '--proto',
        '=https',
        '--tlsv1.2',
        '--output',
        archivePath,
        release.downloadUrl
      ], { timeout: DOWNLOAD_TIMEOUT_MS, windowsHide: true })
      const actualDigest = await hashFile(archivePath)
      if (actualDigest !== release.digest) {
        throw new Error(`Goose release checksum mismatch for ${release.name}.`)
      }

      const listing = await run('tar', ['-tf', archivePath], { timeout: COMMAND_TIMEOUT_MS, windowsHide: true })
      assertArchiveEntriesAreContained(String(listing.stdout ?? ''))
      const verboseListing = await run('tar', ['-tvf', archivePath], {
        env: { ...probeEnv, LANG: 'C', LC_ALL: 'C' },
        timeout: COMMAND_TIMEOUT_MS,
        windowsHide: true
      })
      assertArchiveEntryTypesAreSafe(String(verboseListing.stdout ?? ''))
      await mkdir(extractDir, { recursive: true })
      await run('tar', ['-xf', archivePath, '-C', extractDir], { timeout: 2 * 60_000, windowsHide: true })
      const extractedBinary = await findExtractedBinary(extractDir, target.binaryName)
      await mkdir(stagedDir)
      const stagedBinary = resolve(stagedDir, target.binaryName)
      await rename(extractedBinary, stagedBinary)
      if (target.binaryName === 'goose') await chmod(stagedBinary, 0o755)
      if (
        !await probeGooseBinary({
          binaryPath: stagedBinary,
          env: probeEnv,
          exec: run,
          expectedVersion: version
        })
      ) {
        throw new Error(`Downloaded Goose CLI did not report the expected version ${version}.`)
      }
      await mkdir(dirname(finalDir), { recursive: true })
      await replaceDirectoryAtomically(stagedDir, finalDir, async () => {
        const installedBinary = await resolveContainedManagedBinary({ env: params.ctx.env, target, version })
        return installedBinary != null && Boolean(
          await probeGooseBinary({
            binaryPath: installedBinary,
            env: probeEnv,
            exec: run,
            expectedVersion: version
          })
        )
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  const installedBinary = await resolveContainedManagedBinary({ env: params.ctx.env, target, version })
  if (
    installedBinary == null ||
    !await probeGooseBinary({ binaryPath: installedBinary, env: probeEnv, exec: run, expectedVersion: version })
  ) {
    throw new Error(`Installed Goose CLI is not executable: ${finalBinary}`)
  }
  return installedBinary
}

const resolveConfiguredPath = async (params: {
  cwd: string
  path: string
}) => {
  if (!isAbsolute(params.path)) {
    throw new Error('Configured Goose CLI path must be absolute.')
  }
  const resolved = await realpath(resolve(params.cwd, params.path)).catch(() => undefined)
  if (resolved == null) throw new Error(`Configured Goose CLI path does not exist: ${params.path}`)
  const metadata = await lstat(resolved)
  if (!metadata.isFile()) throw new Error(`Configured Goose CLI path is not a file: ${params.path}`)
  return resolved
}

export const resolveInstalledGooseCli = async (params: {
  config?: GooseCliConfig
  cwd: string
  defaultSource?: 'managed' | 'system' | 'path'
  dependencies?: GooseCliDependencies
  env: AdapterCtx['env'] | NodeJS.ProcessEnv
}) => {
  const source = normalizeSource(params.env.__ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_SOURCE__) ??
    normalizeSource(params.config?.source) ?? params.defaultSource ?? 'managed'
  const configuredPath = normalizeNonEmptyString(params.env.__ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__) ??
    normalizeNonEmptyString(params.config?.path)
  const configuredVersion = normalizeNonEmptyString(
    params.env.__ONEWORKS_PROJECT_ADAPTER_GOOSE_INSTALL_VERSION__
  ) ?? normalizeNonEmptyString(params.config?.version) ?? GOOSE_CLI_VERSION
  const version = normalizeGooseReleaseVersion(configuredVersion)
  const dependencies = params.dependencies ?? {}
  const run = dependencies.execFile ?? execFileAsync
  const probeEnv = createGooseProbeEnv(params.env)

  if (configuredPath != null) {
    const binaryPath = await resolveConfiguredPath({ cwd: params.cwd, path: configuredPath })
    return await probeGooseBinary({ binaryPath, env: probeEnv, exec: run }) == null ? undefined : binaryPath
  }
  if (source === 'path') return undefined

  if (source === 'system') {
    const systemBinary = await (dependencies.resolveSystemBinary ?? resolveUserShellBinaryPath)({
      binaryName: 'goose',
      childEnvPolicy: 'provided-only',
      env: probeEnv
    })
    const candidate = systemBinary ?? 'goose'
    return await probeGooseBinary({ binaryPath: candidate, env: probeEnv, exec: run }) == null ? undefined : candidate
  }

  const target = resolveGooseReleaseTarget({
    arch: dependencies.arch,
    platform: dependencies.platform,
    variant: params.config?.variant
  })
  const cachedBinary = await resolveContainedManagedBinary({ env: params.env, target, version })
  if (cachedBinary == null) return undefined
  return await probeGooseBinary({
      binaryPath: cachedBinary,
      env: probeEnv,
      exec: run,
      expectedVersion: version
    }) == null
    ? undefined
    : cachedBinary
}

export const ensureGooseCli = async (params: {
  config?: GooseCliConfig
  ctx: AdapterCtx
  defaultSource?: 'managed' | 'system' | 'path'
  dependencies?: GooseCliDependencies
}) => {
  const source = normalizeSource(params.ctx.env.__ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_SOURCE__) ??
    normalizeSource(params.config?.source) ?? params.defaultSource ?? 'managed'
  const configuredPath = normalizeNonEmptyString(params.ctx.env.__ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__) ??
    normalizeNonEmptyString(params.config?.path)
  const configuredVersion = normalizeNonEmptyString(
    params.ctx.env.__ONEWORKS_PROJECT_ADAPTER_GOOSE_INSTALL_VERSION__
  ) ?? normalizeNonEmptyString(params.config?.version) ?? GOOSE_CLI_VERSION
  const version = normalizeGooseReleaseVersion(configuredVersion)
  const autoInstall = normalizeBoolean(params.ctx.env.__ONEWORKS_PROJECT_ADAPTER_GOOSE_AUTO_INSTALL__) ??
    params.config?.autoInstall ?? true
  const dependencies = params.dependencies ?? {}
  const run = dependencies.execFile ?? execFileAsync
  const probeEnv = createGooseProbeEnv(params.ctx.env)

  if (configuredPath != null) {
    const binaryPath = await resolveConfiguredPath({ cwd: params.ctx.cwd, path: configuredPath })
    if (!await probeGooseBinary({ binaryPath, env: probeEnv, exec: run })) {
      throw new Error(`Configured Goose CLI is older than ${GOOSE_MINIMUM_ACP_VERSION} or not executable.`)
    }
    params.ctx.env.__ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__ = binaryPath
    return binaryPath
  }
  if (source === 'path') throw new Error('Goose CLI source is path, but no absolute path is configured.')

  if (source === 'system') {
    const systemBinary = await (dependencies.resolveSystemBinary ?? resolveUserShellBinaryPath)({
      binaryName: 'goose',
      childEnvPolicy: 'provided-only',
      env: probeEnv
    })
    const candidate = systemBinary ?? 'goose'
    if (!await probeGooseBinary({ binaryPath: candidate, env: probeEnv, exec: run })) {
      throw new Error(`Goose CLI ${GOOSE_MINIMUM_ACP_VERSION} or newer was not found on PATH.`)
    }
    params.ctx.env.__ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__ = candidate
    return candidate
  }

  const target = resolveGooseReleaseTarget({
    arch: dependencies.arch,
    platform: dependencies.platform,
    variant: params.config?.variant
  })
  const existing = await resolveContainedManagedBinary({ env: params.ctx.env, target, version })
  if (
    existing != null &&
    await probeGooseBinary({ binaryPath: existing, env: probeEnv, exec: run, expectedVersion: version })
  ) {
    params.ctx.env.__ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__ = existing
    return existing
  }
  if (!autoInstall) {
    throw new Error(`Goose CLI ${version} is not installed and automatic installation is disabled.`)
  }
  const binaryPath = await installManagedGooseCli({
    config: params.config,
    ctx: params.ctx,
    dependencies,
    version
  })
  params.ctx.env.__ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__ = binaryPath
  return binaryPath
}
