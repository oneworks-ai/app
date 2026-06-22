/* eslint-disable max-lines -- package cache resolution keeps shared cache lookup and version fallback policy together. */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { resolveBootstrapPackageCacheDir, resolveRealHomeDir } from './paths'

const DEFAULT_PACKAGE_TAG = 'latest'
const DEFAULT_PACKAGE_LOOKUP_TIMEOUT_MS = 1_000
const DEFAULT_CACHE_FIRST = true
const PACKAGE_CACHE_VERSION_PATTERN = /^[\w.+-]+$/u

export const RUNTIME_PACKAGE_CACHE_VERSION_ENV = '__ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__'
export const PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV = 'ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION'
export const DESKTOP_DEV_RUNTIME_VERSION_ENV = '__ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__'
export const PUBLIC_DESKTOP_DEV_RUNTIME_VERSION_ENV = 'ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION'

interface PublishedPackageVersionMetadata {
  lookupKey: string
  packageName: string
  packageTag: string
  resolvedAt: string
  version: string
}

export const ensureDirectory = async (targetPath: string) => {
  await mkdir(targetPath, { recursive: true })
}

export const sanitizePackageName = (packageName: string) => packageName.replace(/^@/, '').replace(/[\\/]/g, '__')

export const splitPackageName = (packageName: string) => packageName.split('/')

export const compareVersionLike = (left: string, right: string) => (
  left.localeCompare(right, 'en', {
    numeric: true,
    sensitivity: 'base'
  })
)

const hashValue = (value: string) => createHash('sha1').update(value).digest('hex')

export const resolvePackageTag = () => process.env.ONEWORKS_BOOTSTRAP_PACKAGE_TAG?.trim() || DEFAULT_PACKAGE_TAG

export const resolvePackageLookupTimeoutMs = () => {
  const rawValue = process.env.ONEWORKS_BOOTSTRAP_PACKAGE_LOOKUP_TIMEOUT_MS?.trim()
  if (!rawValue) {
    return DEFAULT_PACKAGE_LOOKUP_TIMEOUT_MS
  }

  const parsedValue = Number.parseInt(rawValue, 10)
  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : DEFAULT_PACKAGE_LOOKUP_TIMEOUT_MS
}

export const shouldUseCachedPackageVersionFirst = () => {
  const rawValue = process.env.ONEWORKS_BOOTSTRAP_PACKAGE_CACHE_FIRST?.trim().toLowerCase()
  if (rawValue == null || rawValue === '') {
    return DEFAULT_CACHE_FIRST
  }

  return !['0', 'false', 'no', 'off'].includes(rawValue)
}

export const normalizePackageCacheVersion = (value: string | undefined) => {
  const normalized = value?.trim()
  if (normalized == null || normalized === '') return undefined
  if (!PACKAGE_CACHE_VERSION_PATTERN.test(normalized) || normalized === '.' || normalized === '..') {
    throw new Error(`Runtime package cache version contains unsupported characters: ${normalized}.`)
  }
  return normalized
}

export const resolveRuntimePackageCacheVersion = () => (
  normalizePackageCacheVersion(process.env[RUNTIME_PACKAGE_CACHE_VERSION_ENV]) ??
    normalizePackageCacheVersion(process.env[PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV]) ??
    normalizePackageCacheVersion(process.env[DESKTOP_DEV_RUNTIME_VERSION_ENV]) ??
    normalizePackageCacheVersion(process.env[PUBLIC_DESKTOP_DEV_RUNTIME_VERSION_ENV])
)

export const resolvePackageCacheDir = (
  packageName: string,
  version: string,
  options: { cacheVersion?: string } = {}
) => (
  path.join(
    resolveBootstrapPackageCacheDir(),
    'npm',
    sanitizePackageName(packageName),
    normalizePackageCacheVersion(options.cacheVersion) ?? version
  )
)

export const resolvePackageCacheRootDir = (packageName: string) => (
  path.join(resolveBootstrapPackageCacheDir(), 'npm', sanitizePackageName(packageName))
)

export const resolvePackageInstallDir = (cacheDir: string, packageName: string) => (
  path.join(cacheDir, 'node_modules', ...splitPackageName(packageName))
)

const resolvePackageVersionMetadataDir = () => path.join(resolveBootstrapPackageCacheDir(), 'npm-version-cache')

const resolveProjectNpmrc = () => {
  const projectNpmrc = path.resolve(process.cwd(), '.npmrc')
  return existsSync(projectNpmrc) ? projectNpmrc : undefined
}

export const resolvePackageManagerEnv = () => {
  const userConfig = process.env.npm_config_userconfig ?? process.env.NPM_CONFIG_USERCONFIG ?? resolveProjectNpmrc()

  return {
    ...process.env,
    HOME: resolveRealHomeDir(),
    USERPROFILE: resolveRealHomeDir(),
    npm_config_cache: path.join(resolveBootstrapPackageCacheDir(), 'npm-cache'),
    npm_config_replace_registry_host: 'never',
    npm_config_update_notifier: 'false',
    NPM_CONFIG_REPLACE_REGISTRY_HOST: 'never',
    ...(userConfig != null
      ? {
        NPM_CONFIG_USERCONFIG: userConfig,
        npm_config_userconfig: userConfig
      }
      : {})
  }
}

const readOptionalFile = async (filePath: string | undefined) => {
  if (filePath == null || filePath === '') {
    return undefined
  }

  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return undefined
  }
}

const resolvePackageLookupKey = async (packageName: string) => {
  const env = resolvePackageManagerEnv()
  const userConfig = env.npm_config_userconfig ?? env.NPM_CONFIG_USERCONFIG
  const userConfigContent = await readOptionalFile(userConfig)

  return JSON.stringify({
    packageName,
    packageTag: resolvePackageTag(),
    registry: env.npm_config_registry ?? env.NPM_CONFIG_REGISTRY ?? '',
    userConfig: userConfig ?? '',
    userConfigContentHash: userConfigContent == null ? '' : hashValue(userConfigContent)
  })
}

const resolvePackageVersionMetadataPath = async (packageName: string) => {
  const lookupKey = await resolvePackageLookupKey(packageName)
  return {
    lookupKey,
    metadataPath: path.join(
      resolvePackageVersionMetadataDir(),
      `${sanitizePackageName(packageName)}-${hashValue(lookupKey)}.json`
    )
  }
}

export const readPublishedPackageVersionMetadata = async (packageName: string) => {
  const { lookupKey, metadataPath } = await resolvePackageVersionMetadataPath(packageName)

  try {
    const content = await readFile(metadataPath, 'utf8')
    const parsed = JSON.parse(content) as Partial<PublishedPackageVersionMetadata>
    if (
      parsed.lookupKey === lookupKey &&
      parsed.packageName === packageName &&
      parsed.packageTag === resolvePackageTag() &&
      typeof parsed.version === 'string' &&
      parsed.version.trim()
    ) {
      return {
        metadataPath,
        version: parsed.version.trim()
      }
    }
  } catch {
    // Ignore missing or invalid metadata and use the registry path.
  }

  return undefined
}

export const writePublishedPackageVersionMetadata = async (packageName: string, version: string) => {
  const { lookupKey, metadataPath } = await resolvePackageVersionMetadataPath(packageName)
  await ensureDirectory(path.dirname(metadataPath))

  const tempPath = `${metadataPath}.${process.pid}.${Date.now()}.tmp`
  const metadata: PublishedPackageVersionMetadata = {
    lookupKey,
    packageName,
    packageTag: resolvePackageTag(),
    resolvedAt: new Date().toISOString(),
    version
  }
  await writeFile(tempPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  await rename(tempPath, metadataPath)
}

export const isExistingPath = async (targetPath: string) => {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}
