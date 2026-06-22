import { resolvePublishedPackageVersion } from './npm-package'
import {
  normalizePackageCacheVersion,
  resolvePackageCacheDir,
  resolvePackageInstallDir,
  resolveRuntimePackageCacheVersion
} from './npm-package-cache'
import {
  findInstalledPublishedPackageVersion,
  installPublishedPackage,
  readInstalledPackageVersion
} from './npm-package-install'

export type RuntimePackageAction = 'check' | 'install'
export type RuntimePackageTarget = 'cli' | 'client' | 'server' | 'web'

export interface RuntimePackageOptions {
  cacheVersion?: string
  version?: string
}

export interface RuntimePackageStatus {
  cacheVersion?: string
  installed: boolean
  installedVersion?: string
  latestInstalled: boolean
  latestVersion: string
  packageName: string
  requestedVersion?: string
  target: RuntimePackageTarget
  updateAvailable: boolean
}

const RUNTIME_PACKAGE_NAMES: Record<RuntimePackageTarget, string> = {
  cli: '@oneworks/cli',
  client: '@oneworks/client',
  server: '@oneworks/server',
  web: '@oneworks/web'
}

const RUNTIME_PACKAGE_TARGETS = Object.keys(RUNTIME_PACKAGE_NAMES) as RuntimePackageTarget[]

const isRuntimePackageTarget = (value: string): value is RuntimePackageTarget => (
  RUNTIME_PACKAGE_TARGETS.includes(value as RuntimePackageTarget)
)

const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i

const normalizeRequestedVersion = (value: string | undefined) => {
  const normalized = value?.trim()
  if (normalized == null || normalized === '') return undefined
  if (!EXACT_VERSION_PATTERN.test(normalized)) {
    throw new Error(`Runtime package version must be an exact semver version: ${normalized}.`)
  }
  return normalized
}

export const resolveRuntimePackageTarget = (value: string | undefined): RuntimePackageTarget => {
  const normalized = value?.trim().toLowerCase() || 'cli'
  if (isRuntimePackageTarget(normalized)) return normalized
  throw new Error(
    `Unsupported runtime package target: ${value ?? ''}. Supported targets: ${RUNTIME_PACKAGE_TARGETS.join(', ')}.`
  )
}

const readVersionInstalledAt = async (packageName: string, version: string, cacheVersion = version) => {
  const packageDir = resolvePackageInstallDir(
    resolvePackageCacheDir(packageName, version, { cacheVersion }),
    packageName
  )
  return await readInstalledPackageVersion(packageDir)
}

const resolveRuntimePackageVersion = async (packageName: string, options: RuntimePackageOptions) => (
  normalizeRequestedVersion(options.version) ??
    await resolvePublishedPackageVersion(packageName, { cacheFirst: false })
)

const createRuntimePackageStatus = async (
  target: RuntimePackageTarget,
  packageName: string,
  targetVersion: string,
  requestedVersion: string | undefined,
  requestedCacheVersion: string | undefined
): Promise<RuntimePackageStatus> => {
  const cacheVersion = normalizePackageCacheVersion(requestedCacheVersion)
  const resolvedCacheVersion = cacheVersion ?? targetVersion
  const installedVersion = cacheVersion == null
    ? await findInstalledPublishedPackageVersion(packageName)
    : await readVersionInstalledAt(packageName, targetVersion, resolvedCacheVersion)
  const targetInstalled =
    await readVersionInstalledAt(packageName, targetVersion, resolvedCacheVersion) === targetVersion

  return {
    ...(cacheVersion != null ? { cacheVersion } : {}),
    installed: installedVersion != null,
    ...(installedVersion != null ? { installedVersion } : {}),
    latestInstalled: targetInstalled,
    latestVersion: targetVersion,
    packageName,
    ...(requestedVersion != null ? { requestedVersion } : {}),
    target,
    updateAvailable: requestedVersion != null || cacheVersion != null
      ? !targetInstalled
      : installedVersion !== targetVersion
  }
}

export const checkRuntimePackage = async (
  targetValue: string | undefined,
  options: RuntimePackageOptions = {}
): Promise<RuntimePackageStatus> => {
  const target = resolveRuntimePackageTarget(targetValue)
  const packageName = RUNTIME_PACKAGE_NAMES[target]
  const requestedVersion = normalizeRequestedVersion(options.version)
  const cacheVersion = normalizePackageCacheVersion(options.cacheVersion) ?? resolveRuntimePackageCacheVersion()
  const targetVersion = requestedVersion ?? await resolveRuntimePackageVersion(packageName, options)
  return await createRuntimePackageStatus(target, packageName, targetVersion, requestedVersion, cacheVersion)
}

export const installRuntimePackage = async (
  targetValue: string | undefined,
  options: RuntimePackageOptions = {}
): Promise<RuntimePackageStatus> => {
  const target = resolveRuntimePackageTarget(targetValue)
  const packageName = RUNTIME_PACKAGE_NAMES[target]
  const requestedVersion = normalizeRequestedVersion(options.version)
  const cacheVersion = normalizePackageCacheVersion(options.cacheVersion) ?? resolveRuntimePackageCacheVersion()
  const targetVersion = requestedVersion ?? await resolveRuntimePackageVersion(packageName, options)
  await installPublishedPackage(packageName, targetVersion, cacheVersion == null ? {} : { cacheVersion })
  return await createRuntimePackageStatus(target, packageName, targetVersion, requestedVersion, cacheVersion)
}

export const formatRuntimePackageStatus = (status: RuntimePackageStatus) => {
  const current = status.installedVersion ?? 'not installed'
  if (status.requestedVersion != null) {
    if (status.cacheVersion != null) {
      return status.latestInstalled
        ? `${status.packageName}@${status.requestedVersion} cached as ${status.cacheVersion}`
        : `${status.packageName}@${status.requestedVersion} not cached as ${status.cacheVersion} (${current})`
    }
    return status.latestInstalled
      ? `${status.packageName}@${status.requestedVersion} cached`
      : `${status.packageName}@${status.requestedVersion} not cached (${current})`
  }

  if (status.cacheVersion != null) {
    return status.latestInstalled
      ? `${status.packageName}@${status.latestVersion} cached as ${status.cacheVersion}`
      : `${status.packageName}@${status.latestVersion} not cached as ${status.cacheVersion} (${current})`
  }

  const suffix = status.updateAvailable
    ? `update available: ${current} -> ${status.latestVersion}`
    : `up to date: ${status.latestVersion}`

  return `${status.packageName} ${suffix}`
}
