/* eslint-disable max-lines -- official manifest selection and platform installers stay in one acquisition boundary. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { chmod, cp, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, symlink } from 'node:fs/promises'
import { basename, isAbsolute, posix, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import type { AdapterCtx } from '@oneworks/types'
import { migrateProjectHomeSegments } from '@oneworks/utils'
import { withDirectoryInstallLock } from '@oneworks/utils/install-lock'

import {
  KIRO_DOWNLOAD_ROOT,
  KIRO_MANIFEST_URL,
  assertKiroInstallVersion,
  resolveKiroManagedBinaryPath,
  resolveKiroManagedRootDir,
  resolveKiroManagedVersionDir
} from '#~/paths.js'
import type { KiroAdapterConfig } from '../config-schema'
import { prepareKiroNativeHooks } from './native-hooks'
import { resolveKiroAdapterConfig, toProcessEnv } from './shared'

const execFileAsync = promisify(execFile)
const COMMAND_CHECK_TIMEOUT_MS = 15_000
const SAFE_ARCHIVE_PROCESS_ENV = { ...process.env, LANG: 'C', LC_ALL: 'C' }

export interface KiroManifestPackage {
  architecture: string
  cliPath?: string
  download: string
  fileType: string
  os: string
  sha256: string
  variant: string
}

export interface KiroManifest {
  packages: KiroManifestPackage[]
  version: string
}

const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const normalizeSource = (value: unknown) => (
  value === 'managed' || value === 'system' || value === 'path' ? value : undefined
)

const normalizeBoolean = (value: unknown) => {
  if (value === true || value === 'true' || value === '1') return true
  if (value === false || value === 'false' || value === '0') return false
  return undefined
}

const isKiroVersionOutput = (value: string) => /\bkiro(?:-cli)?\b/iu.test(value)

export const probeKiroBinary = async (
  binaryPath: string,
  env: NodeJS.ProcessEnv,
  options: { requireKiroBrand?: boolean } = {}
) => {
  try {
    const versionResult = await execFileAsync(binaryPath, ['--version'], {
      env,
      timeout: COMMAND_CHECK_TIMEOUT_MS
    })
    const versionOutput = `${versionResult.stdout}\n${versionResult.stderr}`.trim()
    if (options.requireKiroBrand === true && !isKiroVersionOutput(versionOutput)) return undefined
    await execFileAsync(binaryPath, ['acp', '--help'], { env, timeout: COMMAND_CHECK_TIMEOUT_MS })
    return versionOutput || 'unknown'
  } catch {
    return undefined
  }
}

export const selectKiroManifestPackage = (
  manifest: KiroManifest,
  platform = process.platform,
  arch = process.arch
) => {
  const os = platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : platform
  const architecture = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : arch
  const packages = manifest.packages.filter(item => item.os === os)
  const selected = platform === 'darwin'
    ? packages.find(item => item.fileType === 'dmg' && item.architecture === 'universal')
    : platform === 'win32'
    ? packages.find(item => item.fileType === 'msi' && item.architecture === architecture)
    : packages.find(item => (
      item.fileType === 'tarXz' && item.variant === 'headless' && item.architecture === architecture &&
      !item.download.includes('musl')
    ))
  if (selected == null) {
    throw new Error(`Managed Kiro CLI installation is unsupported on ${platform}/${arch}.`)
  }
  return selected
}

const fetchKiroManifest = async () => {
  const response = await fetch(KIRO_MANIFEST_URL, { redirect: 'follow' })
  if (!response.ok) throw new Error(`Failed to resolve the latest Kiro CLI release (${response.status}).`)
  const manifest = await response.json() as KiroManifest
  assertKiroInstallVersion(manifest.version)
  if (!Array.isArray(manifest.packages)) throw new Error('The official Kiro CLI manifest has no packages.')
  return manifest
}

const hashFile = (filePath: string) =>
  new Promise<string>((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })

const hasWindowsAbsolutePrefix = (value: string) => /^[A-Za-z]:[\\/]|^\\\\/u.test(value)

export const assertSafeKiroArchivePath = (
  value: string,
  label: string,
  options: { allowRoot?: boolean } = {}
) => {
  if (
    value === '' || value.includes('\\') || /[\0\r\n]/u.test(value) ||
    value.startsWith('/') || hasWindowsAbsolutePrefix(value)
  ) throw new Error(`Unsafe Kiro ${label}: ${JSON.stringify(value)}.`)
  const segments = value.split('/')
  if (segments.includes('..')) throw new Error(`Unsafe Kiro ${label}: ${JSON.stringify(value)}.`)
  const normalized = posix.normalize(value)
  const canonical = normalized.replace(/^\.\//u, '').replace(/\/+$/u, '') || '.'
  if (canonical === '.' && options.allowRoot !== true) {
    throw new Error(`Unsafe Kiro ${label}: ${JSON.stringify(value)}.`)
  }
  if (canonical === '..' || canonical.startsWith('../')) {
    throw new Error(`Unsafe Kiro ${label}: ${JSON.stringify(value)}.`)
  }
  return canonical
}

export const assertSafeKiroManifestCliPath = (value: string) => (
  assertSafeKiroArchivePath(value, 'manifest cliPath')
)

const isContainedPath = (root: string, candidate: string) => {
  const relation = relative(root, candidate)
  return relation === '' || (!isAbsolute(relation) && relation !== '..' && !relation.startsWith(`..${sep}`))
}

const assertContainedRealPath = async (root: string, candidate: string, label: string) => {
  const [rootPath, candidatePath] = await Promise.all([realpath(root), realpath(candidate)])
  if (!isContainedPath(rootPath, candidatePath)) {
    throw new Error(`Kiro ${label} escapes the extraction root.`)
  }
  return candidatePath
}

const validateExtractedTree = async (root: string) => {
  const rootPath = await realpath(root)
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const entryPath = resolve(dir, entry.name)
      const info = await lstat(entryPath)
      if (!info.isFile() && !info.isDirectory() && !info.isSymbolicLink()) {
        throw new Error(`Kiro package contains unsupported filesystem entry ${JSON.stringify(entry.name)}.`)
      }
      let resolvedEntry: string
      try {
        resolvedEntry = await realpath(entryPath)
      } catch {
        throw new Error(`Kiro package contains an unresolved link at ${JSON.stringify(entry.name)}.`)
      }
      if (!isContainedPath(rootPath, resolvedEntry)) {
        throw new Error(`Kiro package entry ${JSON.stringify(entry.name)} escapes the extraction root.`)
      }
      if (info.isDirectory()) await visit(entryPath)
    }
  }
  await visit(root)
}

interface TarArchiveEntry {
  path: string
  type: string
  linkTarget?: string
}

const parseTarMetadata = (pathsOutput: string, verboseOutput: string): TarArchiveEntry[] => {
  const paths = pathsOutput.split('\n').filter(line => line !== '')
  const verbose = verboseOutput.split('\n').filter(line => line !== '')
  if (paths.length !== verbose.length) {
    throw new Error('Kiro tar metadata was ambiguous or contained unsupported control characters.')
  }
  return paths.map((path, index) => {
    const line = verbose[index] ?? ''
    const marker = ` ${path}`
    const pathIndex = line.lastIndexOf(marker)
    if (pathIndex < 0) throw new Error(`Unable to validate Kiro tar entry ${JSON.stringify(path)}.`)
    const suffix = line.slice(pathIndex + marker.length)
    const type = line[0] ?? ''
    if (type === 'l') {
      if (!suffix.startsWith(' -> ')) throw new Error(`Unable to validate Kiro symlink ${JSON.stringify(path)}.`)
      return { path, type, linkTarget: suffix.slice(4) }
    }
    if (type === 'h') {
      if (!suffix.startsWith(' link to ')) {
        throw new Error(`Unable to validate Kiro hardlink ${JSON.stringify(path)}.`)
      }
      return { path, type, linkTarget: suffix.slice(' link to '.length) }
    }
    if (suffix !== '') throw new Error(`Unable to validate Kiro tar entry ${JSON.stringify(path)}.`)
    return { path, type }
  })
}

export const preflightKiroTarArchive = async (archivePath: string) => {
  const [pathsResult, verboseResult] = await Promise.all([
    execFileAsync('tar', ['-tJf', archivePath], { env: SAFE_ARCHIVE_PROCESS_ENV, timeout: 5 * 60_000 }),
    execFileAsync('tar', ['-tvJf', archivePath], { env: SAFE_ARCHIVE_PROCESS_ENV, timeout: 5 * 60_000 })
  ])
  if (pathsResult.stderr.trim() !== '' || verboseResult.stderr.trim() !== '') {
    throw new Error('Kiro tar metadata produced warnings and cannot be extracted safely.')
  }
  const entries = parseTarMetadata(pathsResult.stdout, verboseResult.stdout)
  const normalizedPaths = new Set<string>()
  const caseFoldedPaths = new Set<string>()
  const normalizedEntries = entries.map((entry) => {
    const path = assertSafeKiroArchivePath(entry.path, 'tar entry', { allowRoot: true })
    if (normalizedPaths.has(path)) throw new Error(`Kiro tar contains duplicate entry ${JSON.stringify(path)}.`)
    const caseFolded = path.toLocaleLowerCase('en-US')
    if (caseFoldedPaths.has(caseFolded)) {
      throw new Error(`Kiro tar contains a case-colliding entry ${JSON.stringify(path)}.`)
    }
    normalizedPaths.add(path)
    caseFoldedPaths.add(caseFolded)
    if (!['-', 'd', 'l', 'h'].includes(entry.type)) {
      throw new Error(
        `Kiro tar contains unsupported entry type ${JSON.stringify(entry.type)} at ${JSON.stringify(path)}.`
      )
    }
    return { ...entry, path }
  })
  for (const entry of normalizedEntries) {
    if (entry.linkTarget == null) continue
    const linkTarget = entry.linkTarget
    if (
      linkTarget === '' || linkTarget.includes('\\') || /[\0\r\n]/u.test(linkTarget) ||
      linkTarget.startsWith('/') || hasWindowsAbsolutePrefix(linkTarget)
    ) throw new Error(`Unsafe Kiro tar link target: ${JSON.stringify(linkTarget)}.`)
    const normalizedTarget = entry.type === 'h'
      ? posix.normalize(linkTarget)
      : posix.normalize(posix.join(posix.dirname(entry.path), linkTarget))
    const resolvedTarget = normalizedTarget.replace(/^\.\//u, '').replace(/\/+$/u, '') || '.'
    if (resolvedTarget === '..' || resolvedTarget.startsWith('../')) {
      throw new Error(`Kiro tar link target escapes the extraction root: ${JSON.stringify(linkTarget)}.`)
    }
    if (!normalizedPaths.has(resolvedTarget)) {
      throw new Error(`Kiro tar link target is not a validated archive entry: ${JSON.stringify(linkTarget)}.`)
    }
  }
  return normalizedEntries
}

const findFile = async (dir: string, name: string): Promise<string | undefined> => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const entryPath = resolve(dir, entry.name)
    if (entry.isFile() && entry.name === name) return entryPath
    if (entry.isDirectory()) {
      const nested = await findFile(entryPath, name)
      if (nested != null) return nested
    }
  }
  return undefined
}

export const extractKiroPackage = async (params: {
  archivePath: string
  extractDir: string
  manifestPackage: KiroManifestPackage
}) => {
  if (params.manifestPackage.fileType === 'tarXz') {
    await preflightKiroTarArchive(params.archivePath)
    await execFileAsync('tar', [
      '-xJf',
      params.archivePath,
      '-C',
      params.extractDir,
      '--no-same-owner',
      '--no-same-permissions'
    ], { env: SAFE_ARCHIVE_PROCESS_ENV, timeout: 5 * 60_000 })
    await validateExtractedTree(params.extractDir)
    return findFile(params.extractDir, 'kiro-cli')
  }
  if (params.manifestPackage.fileType === 'dmg') {
    const cliPath = assertSafeKiroManifestCliPath(
      params.manifestPackage.cliPath ?? 'Contents/MacOS/kiro-cli'
    )
    const mountDir = resolve(params.extractDir, 'mount')
    await mkdir(mountDir, { recursive: true })
    await execFileAsync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountDir, params.archivePath], {
      timeout: 2 * 60_000
    })
    try {
      const appDir = (await readdir(mountDir, { withFileTypes: true }))
        .find(entry => entry.isDirectory() && entry.name.endsWith('.app'))
      if (appDir == null) throw new Error('The Kiro CLI disk image did not contain an app bundle.')
      const sourceApp = resolve(mountDir, appDir.name)
      const targetApp = resolve(params.extractDir, appDir.name)
      await cp(sourceApp, targetApp, { recursive: true })
      await validateExtractedTree(targetApp)
      const resolvedCli = resolve(targetApp, cliPath)
      await assertContainedRealPath(targetApp, resolvedCli, 'manifest cliPath')
      return resolvedCli
    } finally {
      await execFileAsync('hdiutil', ['detach', mountDir, '-force'], { timeout: 60_000 }).catch(() => undefined)
    }
  }
  if (params.manifestPackage.fileType === 'msi') {
    await execFileAsync('msiexec.exe', [
      '/a',
      params.archivePath,
      '/qn',
      `TARGETDIR=${params.extractDir}`
    ], { timeout: 5 * 60_000 })
    await validateExtractedTree(params.extractDir)
    return findFile(params.extractDir, 'kiro-cli.exe')
  }
  throw new Error(`Unsupported Kiro CLI package type: ${params.manifestPackage.fileType}`)
}

export const extractVerifiedKiroPackage = async (params: {
  archivePath: string
  expectedSha256: string
  extractDir: string
  manifestPackage: KiroManifestPackage
}) => {
  const checksum = await hashFile(params.archivePath)
  if (checksum !== params.expectedSha256.toLowerCase()) {
    throw new Error(`Kiro CLI checksum mismatch: expected ${params.expectedSha256}, received ${checksum}.`)
  }
  try {
    const extractedBinary = await extractKiroPackage(params)
    if (extractedBinary != null) {
      await assertContainedRealPath(params.extractDir, extractedBinary, 'CLI binary')
    }
    return extractedBinary
  } catch (error) {
    await rm(params.extractDir, { recursive: true, force: true })
    await mkdir(params.extractDir, { recursive: true })
    throw error
  }
}

export const replaceKiroInstallDirectory = async (params: {
  finalDir: string
  stagedDir: string
  versionsDir: string
  validate: () => Promise<boolean>
}) => {
  const backupRoot = await mkdtemp(resolve(params.versionsDir, '.backup-'))
  const backupDir = resolve(backupRoot, 'previous')
  const hadPrevious = existsSync(params.finalDir)
  if (hadPrevious) await rename(params.finalDir, backupDir)
  try {
    await rename(params.stagedDir, params.finalDir)
    if (!await params.validate()) throw new Error('The staged Kiro CLI failed its final executable probe.')
    await rm(backupRoot, { recursive: true, force: true })
  } catch (error) {
    await rm(params.finalDir, { recursive: true, force: true })
    if (hadPrevious && existsSync(backupDir)) await rename(backupDir, params.finalDir)
    await rm(backupRoot, { recursive: true, force: true })
    throw error
  }
}

const ensureKiroManagedDirectory = async (directory: string) => {
  let info: Awaited<ReturnType<typeof lstat>>
  try {
    info = await lstat(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(directory, { recursive: true })
    info = await lstat(directory)
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`Unsafe Kiro managed directory: ${directory}`)
  }
  return realpath(directory)
}

const installManagedKiroCli = async (
  ctx: Pick<AdapterCtx, 'env' | 'logger'>,
  manifest: KiroManifest
) => {
  const managedRoot = resolveKiroManagedRootDir(ctx.env)
  const finalDir = resolveKiroManagedVersionDir(ctx.env, manifest.version)
  const finalBinary = resolve(finalDir, process.platform === 'win32' ? 'kiro-cli.exe' : 'kiro-cli')
  const probeEnv = toProcessEnv(ctx.env)
  let installedBinary: string | undefined

  await withDirectoryInstallLock({ lockDir: `${managedRoot}.lock` }, async () => {
    await ensureKiroManagedDirectory(managedRoot)
    const versionsDir = resolve(managedRoot, 'versions')
    await ensureKiroManagedDirectory(versionsDir)
    const existingBinary = resolveKiroManagedBinaryPath(ctx.env, manifest.version)
    if (existingBinary != null && await probeKiroBinary(existingBinary, probeEnv) != null) {
      installedBinary = existingBinary
      return
    }
    const manifestPackage = selectKiroManifestPackage(manifest)
    const tempDir = await mkdtemp(resolve(versionsDir, '.tmp-'))
    const archivePath = resolve(tempDir, basename(manifestPackage.download))
    const extractDir = resolve(tempDir, 'payload')
    const stagedDir = resolve(tempDir, 'staged-version')
    const stagedBinary = resolve(stagedDir, process.platform === 'win32' ? 'kiro-cli.exe' : 'kiro-cli')
    try {
      ctx.logger.info(`Installing Kiro CLI ${manifest.version} into the global bootstrap cache`)
      await mkdir(extractDir, { recursive: true })
      await execFileAsync('curl', [
        '-fSL',
        `${KIRO_DOWNLOAD_ROOT}/${manifestPackage.download}`,
        '-o',
        archivePath
      ], { timeout: 20 * 60_000 })
      const extractedBinary = await extractVerifiedKiroPackage({
        archivePath,
        expectedSha256: manifestPackage.sha256,
        extractDir,
        manifestPackage
      })
      if (extractedBinary == null || !existsSync(extractedBinary)) {
        throw new Error('The official Kiro CLI package did not contain kiro-cli.')
      }
      await chmod(extractedBinary, 0o755)
      await mkdir(stagedDir, { recursive: true })
      if (process.platform === 'darwin') {
        const sourceBundle = resolve(extractedBinary, '..', '..', '..')
        await assertContainedRealPath(extractDir, sourceBundle, 'app bundle')
        const targetBundle = resolve(stagedDir, basename(sourceBundle))
        await rename(sourceBundle, targetBundle)
        await symlink(
          posix.join(
            basename(targetBundle),
            assertSafeKiroManifestCliPath(
              manifestPackage.cliPath ?? 'Contents/MacOS/kiro-cli'
            )
          ),
          stagedBinary
        )
      } else {
        await cp(extractDir, stagedDir, { recursive: true })
        const installedBinary = await findFile(stagedDir, process.platform === 'win32' ? 'kiro-cli.exe' : 'kiro-cli')
        if (installedBinary == null) throw new Error('Failed to stage the extracted Kiro CLI binary.')
        if (installedBinary !== stagedBinary) await cp(installedBinary, stagedBinary)
      }
      if (await probeKiroBinary(stagedBinary, probeEnv) == null) {
        throw new Error('The staged Kiro CLI is not executable or lacks ACP support.')
      }
      await replaceKiroInstallDirectory({
        finalDir,
        stagedDir,
        versionsDir,
        validate: async () => {
          const validatedBinary = resolveKiroManagedBinaryPath(ctx.env, manifest.version)
          return validatedBinary != null && await probeKiroBinary(validatedBinary, probeEnv) != null
        }
      })
      installedBinary = resolveKiroManagedBinaryPath(ctx.env, manifest.version)
      if (installedBinary == null || await probeKiroBinary(installedBinary, probeEnv) == null) {
        throw new Error(`Installed Kiro CLI is not executable or lacks ACP support: ${finalBinary}`)
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  if (installedBinary == null) throw new Error(`Kiro CLI installation did not produce a managed binary: ${finalBinary}`)
  return installedBinary
}

export const ensureKiroCli = async (
  ctx: AdapterCtx,
  options: { defaultSource?: 'managed' | 'system' | 'path' } = {}
) => {
  const adapterConfig: KiroAdapterConfig = resolveKiroAdapterConfig(ctx)
  const source = normalizeSource(ctx.env.__ONEWORKS_PROJECT_ADAPTER_KIRO_CLI_SOURCE__) ??
    normalizeSource(adapterConfig.cli?.source) ?? options.defaultSource ?? 'managed'
  const configuredPath = normalizeNonEmptyString(ctx.env.__ONEWORKS_PROJECT_ADAPTER_KIRO_CLI_PATH__) ??
    normalizeNonEmptyString(adapterConfig.cliPath) ?? normalizeNonEmptyString(adapterConfig.cli?.path)
  const configuredVersion = normalizeNonEmptyString(ctx.env.__ONEWORKS_PROJECT_ADAPTER_KIRO_INSTALL_VERSION__) ??
    normalizeNonEmptyString(adapterConfig.cli?.version)
  const autoInstall = normalizeBoolean(ctx.env.__ONEWORKS_PROJECT_ADAPTER_KIRO_AUTO_INSTALL__) ??
    adapterConfig.cli?.autoInstall ?? true
  const probeEnv = toProcessEnv(ctx.env)

  if (configuredPath != null) {
    if (await probeKiroBinary(configuredPath, probeEnv) == null) {
      throw new Error(`Configured Kiro CLI path is not executable or lacks ACP support: ${configuredPath}`)
    }
    ctx.env.__ONEWORKS_PROJECT_ADAPTER_KIRO_CLI_PATH__ = configuredPath
    return configuredPath
  }
  if (source === 'path') throw new Error('Kiro CLI source is path, but no CLI path is configured.')
  if (source === 'system') {
    for (const candidate of ['kiro-cli', 'q']) {
      const version = await probeKiroBinary(candidate, probeEnv, { requireKiroBrand: candidate === 'q' })
      if (version != null) {
        ctx.env.__ONEWORKS_PROJECT_ADAPTER_KIRO_CLI_PATH__ = candidate
        return candidate
      }
    }
    throw new Error('Kiro CLI with ACP support was not found on PATH. Install it from https://kiro.dev/cli/.')
  }

  const manifest = await fetchKiroManifest()
  if (configuredVersion != null && configuredVersion !== 'latest' && configuredVersion !== manifest.version) {
    assertKiroInstallVersion(configuredVersion)
    throw new Error(
      `Kiro CLI ${configuredVersion} cannot be installed safely: the official manifest only exposes checksums for ${manifest.version}.`
    )
  }
  const managedRoot = resolveKiroManagedRootDir(ctx.env)
  const existingBinary = await withDirectoryInstallLock({ lockDir: `${managedRoot}.lock` }, async () => {
    const candidate = resolveKiroManagedBinaryPath(ctx.env, manifest.version)
    return candidate != null && await probeKiroBinary(candidate, probeEnv) != null ? candidate : undefined
  })
  if (existingBinary != null) {
    ctx.env.__ONEWORKS_PROJECT_ADAPTER_KIRO_CLI_PATH__ = existingBinary
    return existingBinary
  }
  if (!autoInstall) {
    throw new Error(`Kiro CLI ${manifest.version} is not installed and automatic installation is disabled.`)
  }
  const binaryPath = await installManagedKiroCli(ctx, manifest)
  ctx.env.__ONEWORKS_PROJECT_ADAPTER_KIRO_CLI_PATH__ = binaryPath
  return binaryPath
}

export const initKiroAdapter = async (ctx: AdapterCtx) => {
  await migrateProjectHomeSegments(ctx.cwd, ctx.env, ['caches', '.mock'])
  prepareKiroNativeHooks(ctx)
  await ensureKiroCli(ctx)
}
