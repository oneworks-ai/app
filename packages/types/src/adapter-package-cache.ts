/* eslint-disable max-lines -- package cache resolution keeps shared cache lookup and adapter semver fallback policy together. */
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

export type PackageCacheEnv = Record<string, string | null | undefined>

interface ExistingPackageCacheEntry {
  cacheDir: string
  cacheVersion: string
  packageDir: string
  version: string
}

const normalizeEnvPath = (value: string | null | undefined) => {
  const trimmed = value?.trim()
  return trimmed != null && trimmed !== '' ? trimmed : undefined
}

const PACKAGE_CACHE_VERSION_PATTERN = /^[\w.+-]+$/u

const normalizePackageCacheVersion = (value: string | null | undefined) => {
  const normalized = normalizeEnvPath(value)
  if (normalized == null) return undefined
  return PACKAGE_CACHE_VERSION_PATTERN.test(normalized) && normalized !== '.' && normalized !== '..'
    ? normalized
    : undefined
}

export const sanitizePackageName = (packageName: string) => packageName.replace(/^@/, '').replace(/[\\/]/g, '__')

const compareVersionLike = (left: string, right: string) => (
  left.localeCompare(right, 'en', {
    numeric: true,
    sensitivity: 'base'
  })
)

const DESKTOP_BUILTIN_ADAPTER_PACKAGES_ENV = '__ONEWORKS_DESKTOP_BUILTIN_ADAPTER_PACKAGES__'
const RUNTIME_PACKAGE_CACHE_VERSION_ENV = '__ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__'
const PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV = 'ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION'
const DESKTOP_DEV_RUNTIME_VERSION_ENV = '__ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__'
const PUBLIC_DESKTOP_DEV_RUNTIME_VERSION_ENV = 'ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION'

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

const isCompatibleWithMinimumVersion = (version: string, minimumVersion: string) => {
  const parsedVersion = parseSemver(version)
  const parsedMinimum = parseSemver(minimumVersion)
  if (parsedVersion == null || parsedMinimum == null) return false
  if (compareSemver(parsedVersion, parsedMinimum) < 0) return false
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

const comparePackageCacheVersions = (left: string, right: string) => {
  const leftSemver = parseSemver(left)
  const rightSemver = parseSemver(right)
  if (leftSemver != null && rightSemver != null) return compareSemver(leftSemver, rightSemver)
  return compareVersionLike(left, right)
}

export const resolvePackageCacheHomeDir = (env: PackageCacheEnv = process.env) => (
  normalizeEnvPath(env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    normalizeEnvPath(env.HOME) ??
    normalizeEnvPath(env.USERPROFILE) ??
    homedir()
)

export const resolveBootstrapPackageCacheRootDir = (env: PackageCacheEnv = process.env) => {
  const configuredRoot = normalizeEnvPath(env.__ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__)
  if (configuredRoot != null) return configuredRoot

  return join(resolvePackageCacheHomeDir(env), '.oneworks', 'bootstrap')
}

const readInstalledPackageInfo = (packageDir: string) => {
  try {
    const parsed = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
      name?: unknown
      version?: unknown
    }
    return {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      version: typeof parsed.version === 'string' ? parsed.version : undefined
    }
  } catch {
    return undefined
  }
}

const readDesktopBuiltinAdapterPackageInfo = (packageName: string, env: PackageCacheEnv = process.env) => {
  try {
    const parsed = JSON.parse(normalizeEnvPath(env[DESKTOP_BUILTIN_ADAPTER_PACKAGES_ENV]) ?? '{}') as Record<
      string,
      { cacheDir?: unknown; cacheVersion?: unknown; version?: unknown }
    >
    const info = parsed[packageName]
    if (info == null) return undefined
    return {
      cacheDir: typeof info.cacheDir === 'string' && info.cacheDir.trim() !== '' ? info.cacheDir.trim() : undefined,
      cacheVersion: typeof info.cacheVersion === 'string' && info.cacheVersion.trim() !== ''
        ? info.cacheVersion.trim()
        : undefined,
      version: typeof info.version === 'string' && info.version.trim() !== '' ? info.version.trim() : undefined
    }
  } catch {
    return undefined
  }
}

const resolveRuntimePackageCacheVersion = (env: PackageCacheEnv = process.env) => (
  normalizePackageCacheVersion(env[RUNTIME_PACKAGE_CACHE_VERSION_ENV]) ??
    normalizePackageCacheVersion(env[PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV]) ??
    normalizePackageCacheVersion(env[DESKTOP_DEV_RUNTIME_VERSION_ENV]) ??
    normalizePackageCacheVersion(env[PUBLIC_DESKTOP_DEV_RUNTIME_VERSION_ENV])
)

const isInstalledAdapterPackage = (cacheDir: string, packageName: string, version: string) => {
  const packageDir = join(cacheDir, 'node_modules', ...packageName.split('/'))
  const packageInfo = readInstalledPackageInfo(packageDir)
  return packageInfo?.name === packageName && packageInfo.version === version
}

const resolvePackageCacheDir = (
  namespace: 'adapter-packages' | 'npm',
  packageName: string,
  cacheVersion: string,
  env: PackageCacheEnv = process.env
) => (
  join(
    resolveBootstrapPackageCacheRootDir(env),
    namespace,
    sanitizePackageName(packageName),
    cacheVersion
  )
)

const resolvePackageInstallDir = (cacheDir: string, packageName: string) => (
  join(cacheDir, 'node_modules', ...packageName.split('/'))
)

const resolveExistingDevPackageCacheEntry = (
  namespace: 'adapter-packages' | 'npm',
  packageName: string,
  env: PackageCacheEnv = process.env
): ExistingPackageCacheEntry | undefined => {
  const cacheVersion = resolveRuntimePackageCacheVersion(env)
  if (cacheVersion == null) return undefined

  const cacheDir = resolvePackageCacheDir(namespace, packageName, cacheVersion, env)
  const packageDir = resolvePackageInstallDir(cacheDir, packageName)
  const packageInfo = readInstalledPackageInfo(packageDir)
  return packageInfo?.name === packageName && packageInfo.version != null
    ? { cacheDir, cacheVersion, packageDir, version: packageInfo.version }
    : undefined
}

const resolveExistingPackageCacheEntries = (
  namespace: 'adapter-packages' | 'npm',
  packageName: string,
  env: PackageCacheEnv = process.env
): ExistingPackageCacheEntry[] => {
  const packageCacheRoot = join(
    resolveBootstrapPackageCacheRootDir(env),
    namespace,
    sanitizePackageName(packageName)
  )
  let versions: string[]
  try {
    versions = readdirSync(packageCacheRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return []
  }

  return versions
    .map((version) => {
      const cacheDir = join(packageCacheRoot, version)
      const packageDir = resolvePackageInstallDir(cacheDir, packageName)
      const packageInfo = readInstalledPackageInfo(packageDir)
      return packageInfo?.name === packageName && packageInfo.version === version
        ? { cacheDir, cacheVersion: version, packageDir, version }
        : undefined
    })
    .filter((value): value is ExistingPackageCacheEntry => value != null)
    .sort((left, right) => comparePackageCacheVersions(right.version, left.version))
}

export const resolveExistingNpmPackageDirs = (
  packageName: string,
  env: PackageCacheEnv = process.env
) => {
  if (resolveRuntimePackageCacheVersion(env) != null) {
    const devEntry = resolveExistingDevPackageCacheEntry('npm', packageName, env)
    return devEntry == null ? [] : [devEntry.packageDir]
  }

  return resolveExistingPackageCacheEntries('npm', packageName, env)?.map(entry => entry.packageDir) ?? []
}

export const resolveExistingNpmPackageDir = (
  packageName: string,
  env: PackageCacheEnv = process.env
) => resolveExistingNpmPackageDirs(packageName, env)[0]

export const resolveExistingAdapterPackageCacheDir = (
  packageName: string,
  env: PackageCacheEnv = process.env
) => {
  const builtinPackage = readDesktopBuiltinAdapterPackageInfo(packageName, env)
  const resolveBuiltinPackageCacheDir = () => (
    builtinPackage?.cacheDir != null &&
      builtinPackage.version != null &&
      isInstalledAdapterPackage(builtinPackage.cacheDir, packageName, builtinPackage.version)
      ? builtinPackage.cacheDir
      : undefined
  )
  const runtimePackageCacheVersion = resolveRuntimePackageCacheVersion(env)
  const builtinCacheVersion = builtinPackage?.cacheVersion ?? builtinPackage?.version
  if (
    runtimePackageCacheVersion != null &&
    builtinCacheVersion === runtimePackageCacheVersion
  ) {
    const builtinCacheDir = resolveBuiltinPackageCacheDir()
    if (builtinCacheDir != null) return builtinCacheDir
  }

  const entries = resolveExistingPackageCacheEntries('adapter-packages', packageName, env)
    .filter(entry =>
      builtinPackage?.version == null || isCompatibleWithMinimumVersion(entry.version, builtinPackage.version)
    )
  return entries[0]?.cacheDir ?? resolveBuiltinPackageCacheDir()
}
