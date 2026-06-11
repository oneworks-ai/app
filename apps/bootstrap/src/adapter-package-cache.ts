/* eslint-disable max-lines -- bootstrap adapter package resolution keeps cache lookup, install, and CLI parsing together. */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { compareVersionLike, ensureDirectory, resolvePackageManagerEnv, sanitizePackageName } from './npm-package-cache'
import { resolveBootstrapPackageCacheDir } from './paths'
import { runBufferedCommand } from './process-utils'
import { createBootstrapProgress } from './progress'

const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const ADAPTER_SCOPE = '@oneworks'
const ADAPTER_PREFIX = 'adapter-'

interface AdapterPackageVersionMetadata {
  checkedAt: string
  installedPackageDir: string
  key: string
  name: string
  resolvedVersion: string
  version: string
}

export interface CliAdapterPackageRequest {
  adapter: string
  cliVersion: string
}

const hashValue = (value: string) => createHash('sha1').update(value).digest('hex')

const resolveAdapterPackagesRoot = () => path.join(resolveBootstrapPackageCacheDir(), 'adapter-packages')

const resolveAdapterPackageCacheDir = (packageName: string, version: string) => (
  path.join(resolveAdapterPackagesRoot(), sanitizePackageName(packageName), version)
)

const resolveAdapterPackageInstallDir = (cacheDir: string, packageName: string) => (
  path.join(cacheDir, 'node_modules', ...packageName.split('/'))
)

const resolveAdapterPackageMetadataDir = () => path.join(resolveAdapterPackagesRoot(), 'metadata')

const resolveAdapterPackageManagerEnv = () => {
  const npmCache = path.join(resolveAdapterPackagesRoot(), 'npm-cache')
  return {
    ...resolvePackageManagerEnv(),
    npm_config_cache: npmCache,
    NPM_CONFIG_CACHE: npmCache
  }
}

const readRegistryFromEnv = () => {
  const env = resolveAdapterPackageManagerEnv()
  return env.npm_config_registry ?? env.NPM_CONFIG_REGISTRY ?? ''
}

const resolveAdapterVersionSpec = (cliVersion: string) => {
  const version = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/u.exec(cliVersion.trim())
  return version == null ? cliVersion : `^${version[1]}`
}

const resolveAdapterPackageLookupKey = (packageName: string, versionSpec: string) => (
  JSON.stringify({
    name: packageName,
    registry: readRegistryFromEnv(),
    version: versionSpec
  })
)

const resolveAdapterPackageMetadataPath = (packageName: string, versionSpec: string) => {
  const key = resolveAdapterPackageLookupKey(packageName, versionSpec)
  return {
    key,
    metadataPath: path.join(resolveAdapterPackageMetadataDir(), `${hashValue(key)}.json`)
  }
}

const readInstalledPackageVersion = async (packageDir: string) => {
  try {
    const content = await readFile(path.join(packageDir, 'package.json'), 'utf8')
    const parsed = JSON.parse(content) as { name?: unknown; version?: unknown }
    if (parsed.name != null && typeof parsed.name !== 'string') return undefined
    return typeof parsed.version === 'string' ? parsed.version : undefined
  } catch {
    return undefined
  }
}

const formatInstallError = (message: string, stderr: string) => {
  const detail = stderr.trim()
  return detail ? `${message}\n${detail}` : message
}

interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

const parseSemver = (version: string): ParsedSemver | undefined => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(version.trim())
  if (match == null) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? []
  }
}

const comparePrereleaseIdentifiers = (left: string, right: string) => {
  const leftNumber = /^\d+$/u.test(left) ? Number(left) : undefined
  const rightNumber = /^\d+$/u.test(right) ? Number(right) : undefined
  if (leftNumber != null && rightNumber != null) return leftNumber - rightNumber
  if (leftNumber != null) return -1
  if (rightNumber != null) return 1
  return left.localeCompare(right)
}

const compareSemver = (left: ParsedSemver, right: ParsedSemver) => {
  const coreDiff = left.major - right.major || left.minor - right.minor || left.patch - right.patch
  if (coreDiff !== 0) return coreDiff
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  const maxLength = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart == null) return -1
    if (rightPart == null) return 1
    const diff = comparePrereleaseIdentifiers(leftPart, rightPart)
    if (diff !== 0) return diff
  }
  return 0
}

const hasSameSemverCore = (left: ParsedSemver, right: ParsedSemver) => (
  left.major === right.major && left.minor === right.minor && left.patch === right.patch
)

const compareAdapterCacheVersions = (left: string, right: string) => {
  const leftSemver = parseSemver(left)
  const rightSemver = parseSemver(right)
  if (leftSemver != null && rightSemver != null) return compareSemver(leftSemver, rightSemver)
  return compareVersionLike(left, right)
}

const satisfiesCaretVersionSpec = (version: string, versionSpec: string) => {
  const trimmedSpec = versionSpec.trim()
  const minimumVersion = trimmedSpec.startsWith('^') ? trimmedSpec.slice(1) : trimmedSpec
  const parsedVersion = parseSemver(version)
  const parsedMinimum = parseSemver(minimumVersion)
  if (parsedVersion == null || parsedMinimum == null) return version === minimumVersion
  if (compareSemver(parsedVersion, parsedMinimum) < 0) return false
  if (!trimmedSpec.startsWith('^')) return compareSemver(parsedVersion, parsedMinimum) === 0
  if (
    parsedVersion.prerelease.length > 0 &&
    (parsedMinimum.prerelease.length === 0 || !hasSameSemverCore(parsedVersion, parsedMinimum))
  ) {
    return false
  }
  if (parsedMinimum.major > 0) return parsedVersion.major === parsedMinimum.major
  if (parsedMinimum.minor > 0) {
    return parsedVersion.major === 0 && parsedVersion.minor === parsedMinimum.minor
  }
  return parsedVersion.major === 0 &&
    parsedVersion.minor === 0 &&
    parsedVersion.patch === parsedMinimum.patch
}

const readCachedAdapterPackageVersions = async (packageCacheRoot: string, versionSpec?: string) => {
  const trimmedVersionSpec = versionSpec?.trim()
  if (trimmedVersionSpec && !trimmedVersionSpec.startsWith('^')) {
    return [trimmedVersionSpec]
  }

  return (await readdir(packageCacheRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
}

const findCachedAdapterPackageDir = async (packageName: string, versionSpec?: string) => {
  const packageCacheRoot = path.join(resolveAdapterPackagesRoot(), sanitizePackageName(packageName))
  let entries: string[]
  try {
    entries = await readCachedAdapterPackageVersions(packageCacheRoot, versionSpec)
  } catch {
    return undefined
  }

  const candidates: Array<{ cacheDir: string; version: string }> = []
  for (const entry of entries) {
    const cacheDir = path.join(packageCacheRoot, entry)
    const packageDir = resolveAdapterPackageInstallDir(cacheDir, packageName)
    const installedVersion = await readInstalledPackageVersion(packageDir)
    if (installedVersion === entry && (versionSpec == null || satisfiesCaretVersionSpec(entry, versionSpec))) {
      candidates.push({ cacheDir, version: entry })
    }
  }

  return candidates
    .sort((left, right) => compareAdapterCacheVersions(right.version, left.version))[0]
    ?.cacheDir
}

const readAdapterPackageVersionMetadata = async (packageName: string, versionSpec: string) => {
  const { key, metadataPath } = resolveAdapterPackageMetadataPath(packageName, versionSpec)
  try {
    const content = await readFile(metadataPath, 'utf8')
    const parsed = JSON.parse(content) as Partial<AdapterPackageVersionMetadata>
    if (
      parsed.key === key &&
      parsed.name === packageName &&
      parsed.version === versionSpec &&
      typeof parsed.resolvedVersion === 'string' &&
      typeof parsed.installedPackageDir === 'string'
    ) {
      return parsed as AdapterPackageVersionMetadata
    }
  } catch {
    // Ignore missing or stale metadata and fall back to the package cache.
  }
  return undefined
}

const writeAdapterPackageVersionMetadata = async (input: {
  installedPackageDir: string
  packageName: string
  resolvedVersion: string
  versionSpec: string
}) => {
  const { key, metadataPath } = resolveAdapterPackageMetadataPath(input.packageName, input.versionSpec)
  await ensureDirectory(path.dirname(metadataPath))
  const tempPath = `${metadataPath}.${process.pid}.${Date.now()}.tmp`
  const metadata: AdapterPackageVersionMetadata = {
    checkedAt: new Date().toISOString(),
    installedPackageDir: input.installedPackageDir,
    key,
    name: input.packageName,
    resolvedVersion: input.resolvedVersion,
    version: input.versionSpec
  }
  await writeFile(tempPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  await rename(tempPath, metadataPath)
}

const parseVersionOutput = (spec: string, output: string) => {
  const normalizedOutput = output.trim()
  if (!normalizedOutput) {
    throw new Error(`No version was returned for ${spec}.`)
  }

  try {
    const parsed = JSON.parse(normalizedOutput) as unknown
    if (typeof parsed === 'string' && parsed.trim()) {
      return parsed.trim()
    }
    if (Array.isArray(parsed)) {
      const versions = parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      const latestVersion = versions.sort(compareVersionLike).at(-1)
      if (latestVersion != null) return latestVersion
    }
  } catch {
    // Fall through to unquoted output parsing.
  }

  const unquotedOutput = normalizedOutput.replace(/^"|"$/g, '').trim()
  if (!unquotedOutput) {
    throw new Error(`Invalid published version for ${spec}: ${normalizedOutput}`)
  }
  return unquotedOutput
}

const resolvePublishedAdapterPackageVersion = async (packageName: string, versionSpec: string) => {
  const spec = `${packageName}@${versionSpec}`
  const result = await runBufferedCommand({
    args: ['view', spec, 'version', '--json'],
    command: NPM_BIN,
    env: resolveAdapterPackageManagerEnv()
  })
  if (result.code !== 0) {
    throw new Error(`Failed to resolve adapter package version for ${spec}:\n${result.stderr.trim()}`)
  }
  return parseVersionOutput(spec, result.stdout)
}

const installAdapterPackage = async (packageName: string, version: string) => {
  const cacheDir = resolveAdapterPackageCacheDir(packageName, version)
  const packageDir = resolveAdapterPackageInstallDir(cacheDir, packageName)
  const installedVersion = await readInstalledPackageVersion(packageDir)
  if (installedVersion === version) {
    return {
      cacheDir,
      packageDir
    }
  }

  const stagingDir = `${cacheDir}.tmp-${process.pid}-${Date.now()}`
  await rm(stagingDir, { recursive: true, force: true })
  await ensureDirectory(stagingDir)

  const progress = createBootstrapProgress({
    label: `installing adapter ${packageName}@${version} into bootstrap cache`
  })
  try {
    const result = await runBufferedCommand({
      args: [
        'install',
        '--prefix',
        stagingDir,
        '--no-audit',
        '--no-fund',
        '--loglevel=error',
        `${packageName}@${version}`
      ],
      command: NPM_BIN,
      env: resolveAdapterPackageManagerEnv()
    })

    if (result.code !== 0) {
      throw new Error(formatInstallError(
        `Failed to install adapter package ${packageName}@${version}.`,
        result.stderr
      ))
    }

    await ensureDirectory(path.dirname(cacheDir))
    await rm(cacheDir, { recursive: true, force: true })
    await rename(stagingDir, cacheDir)
    progress.finish(`cached adapter ${packageName}@${version}`)
  } catch (error) {
    progress.fail(`failed to cache adapter ${packageName}@${version}`)
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }

  return {
    cacheDir,
    packageDir
  }
}

const splitAdapterVersionSelector = (value: string) => {
  const lastAt = value.lastIndexOf('@')
  if (lastAt <= 0) {
    return value
  }

  if (value.startsWith('@')) {
    const slash = value.indexOf('/')
    if (slash < 0 || lastAt <= slash) {
      return value
    }
  }

  return value.slice(0, lastAt)
}

export const normalizeAdapterPackageId = (type: string) => {
  const trimmed = splitAdapterVersionSelector(type.trim())
  if (trimmed.startsWith('@')) return trimmed

  const hasAdapterPrefix = trimmed.startsWith(ADAPTER_PREFIX)
  const adapterId = hasAdapterPrefix ? trimmed.slice(ADAPTER_PREFIX.length) : trimmed
  const normalizedAdapterId = adapterId === 'claude' ? 'claude-code' : adapterId

  return hasAdapterPrefix ? `${ADAPTER_PREFIX}${normalizedAdapterId}` : normalizedAdapterId
}

export const resolveAdapterPackageName = (type: string) => {
  const normalizedType = normalizeAdapterPackageId(type)
  if (normalizedType.startsWith('@')) return normalizedType
  return normalizedType.startsWith(ADAPTER_PREFIX)
    ? `${ADAPTER_SCOPE}/${normalizedType}`
    : `${ADAPTER_SCOPE}/${ADAPTER_PREFIX}${normalizedType}`
}

export const readCliAdapterPackageRequest = (
  forwardedArgs: string[],
  cliVersion: string,
  fallbackAdapter?: string
): CliAdapterPackageRequest | undefined => {
  for (let index = 0; index < forwardedArgs.length; index += 1) {
    const arg = forwardedArgs[index]
    if (arg === '--adapter' || arg === '-A') {
      const adapter = forwardedArgs[index + 1]?.trim()
      return adapter ? { adapter, cliVersion } : undefined
    }
    if (arg.startsWith('--adapter=')) {
      const adapter = arg.slice('--adapter='.length).trim()
      return adapter ? { adapter, cliVersion } : undefined
    }
    if (arg.startsWith('-A') && arg.length > 2) {
      const adapter = arg.slice(2).trim()
      return adapter ? { adapter, cliVersion } : undefined
    }
  }

  const adapter = fallbackAdapter?.trim()
  return adapter ? { adapter, cliVersion } : undefined
}

export const resolveCliAdapterPackageDir = async (request: CliAdapterPackageRequest) => {
  const packageName = resolveAdapterPackageName(request.adapter)
  const versionSpec = resolveAdapterVersionSpec(request.cliVersion)
  const metadata = await readAdapterPackageVersionMetadata(packageName, versionSpec)
  if (metadata != null) {
    const cachedByMetadata = await findCachedAdapterPackageDir(packageName, metadata.resolvedVersion)
    if (cachedByMetadata != null && existsSync(metadata.installedPackageDir)) {
      return cachedByMetadata
    }
  }

  const cachedPackageDir = await findCachedAdapterPackageDir(packageName, versionSpec)
  if (cachedPackageDir != null) {
    return cachedPackageDir
  }

  const resolvedVersion = await resolvePublishedAdapterPackageVersion(packageName, versionSpec)
  const installedPackage = await installAdapterPackage(packageName, resolvedVersion)
  await writeAdapterPackageVersionMetadata({
    installedPackageDir: installedPackage.packageDir,
    packageName,
    resolvedVersion,
    versionSpec
  })
  return installedPackage.cacheDir
}
