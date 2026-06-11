/* eslint-disable max-lines -- managed plugin package install/cache handling includes module update cache resolution. */
import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import { resolveBootstrapPackageCacheRootDir, resolvePackageCacheHomeDir, sanitizePackageName } from '@oneworks/types'

import { withDirectoryInstallLock } from './install-lock'

const execFileAsync = promisify(execFile)

const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const INSTALL_BUFFER_BYTES = 1024 * 1024 * 10

type Env = Record<string, string | null | undefined>

interface ActiveModulePackageMetadata {
  packageDir?: unknown
  packageName?: unknown
  version?: unknown
}

export const isManagedPluginPackageName = (packageName: string) => packageName.startsWith('@oneworks/plugin-')

const installPromises = new Map<string, Promise<string>>()

const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const isFalseLike = (value: string) => ['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase())

export const sanitizeManagedPluginPackageName = sanitizePackageName

export const resolveManagedPluginPackageRootDir = (
  env: Env = process.env
) => (
  resolve(resolveBootstrapPackageCacheRootDir(env), 'npm')
)

export const resolveManagedPluginPackageCacheDir = (
  packageName: string,
  version: string,
  env: Env = process.env
) => join(resolveManagedPluginPackageRootDir(env), sanitizeManagedPluginPackageName(packageName), version)

export const resolveManagedPluginPackageInstallDir = (params: {
  env?: Env
  packageName: string
  version: string
}) => (
  join(
    resolveManagedPluginPackageCacheDir(params.packageName, params.version, params.env),
    'node_modules',
    ...params.packageName.split('/')
  )
)

export const resolveManagedPluginPackageVersion = (
  packageName: string,
  requestedVersion?: string
) => (
  normalizeNonEmptyString(requestedVersion) ??
    (isManagedPluginPackageName(packageName) ? 'latest' : undefined)
)

const readInstalledPackageInfo = async (packageDir: string) => {
  try {
    const content = await readFile(join(packageDir, 'package.json'), 'utf8')
    const parsed = JSON.parse(content) as { name?: unknown; version?: unknown }
    return {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      version: typeof parsed.version === 'string' ? parsed.version : undefined
    }
  } catch {
    return undefined
  }
}

const readInstalledPackageVersion = async (packageDir: string) => {
  const packageInfo = await readInstalledPackageInfo(packageDir)
  return packageInfo?.version
}

const isInstalledPackageVersionSatisfied = (
  installedVersion: string | undefined,
  requestedVersion: string
) => (
  installedVersion != null &&
  (requestedVersion === 'latest' || installedVersion === requestedVersion)
)

const resolveNpmPath = (env: Env) => (
  normalizeNonEmptyString(env.__ONEWORKS_PROJECT_PLUGIN_NPM_PATH__) ?? NPM_BIN
)

const shouldAutoInstall = (env: Env) => {
  const raw = normalizeNonEmptyString(env.__ONEWORKS_PROJECT_PLUGIN_AUTO_INSTALL__)
  return raw == null ? true : !isFalseLike(raw)
}

const buildInstallEnv = (env: Env) => {
  const realHome = resolvePackageCacheHomeDir(env)
  const bootstrapRoot = dirname(resolveManagedPluginPackageRootDir(env))
  return {
    ...process.env,
    ...Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ),
    HOME: realHome,
    USERPROFILE: realHome,
    npm_config_cache: join(bootstrapRoot, 'npm-cache'),
    npm_config_replace_registry_host: 'never',
    npm_config_update_notifier: 'false',
    NPM_CONFIG_REPLACE_REGISTRY_HOST: 'never'
  }
}

export const resolveActiveManagedPluginPackageInstallDir = async (params: {
  env?: Env
  packageName: string
}) => {
  if (!isManagedPluginPackageName(params.packageName)) return undefined

  const env = params.env ?? process.env
  const metadataPath = join(
    dirname(resolveManagedPluginPackageRootDir(env)),
    'module-updates',
    `${sanitizeManagedPluginPackageName(params.packageName)}.json`
  )
  try {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as ActiveModulePackageMetadata
    if (
      metadata.packageName !== params.packageName ||
      typeof metadata.version !== 'string' ||
      typeof metadata.packageDir !== 'string'
    ) {
      return undefined
    }

    const packageInfo = await readInstalledPackageInfo(metadata.packageDir)
    return packageInfo?.name === params.packageName && packageInfo.version === metadata.version
      ? metadata.packageDir
      : undefined
  } catch {
    return undefined
  }
}

const installManagedPluginPackage = async (params: {
  cwd: string
  env: Env
  packageName: string
  version: string
}) => {
  const packageDir = resolveManagedPluginPackageInstallDir(params)
  const installedVersion = await readInstalledPackageVersion(packageDir)
  if (isInstalledPackageVersionSatisfied(installedVersion, params.version)) return packageDir

  if (!shouldAutoInstall(params.env)) {
    throw new Error(
      `Managed plugin package ${params.packageName}@${params.version} was not found and automatic install is disabled.`
    )
  }

  const cacheDir = resolveManagedPluginPackageCacheDir(params.packageName, params.version, params.env)
  return await withDirectoryInstallLock({
    lockDir: `${cacheDir}.lock`
  }, async () => {
    const lockedInstalledVersion = await readInstalledPackageVersion(packageDir)
    if (isInstalledPackageVersionSatisfied(lockedInstalledVersion, params.version)) return packageDir

    const stagingDir = `${cacheDir}.tmp-${process.pid}-${Date.now()}`
    await rm(stagingDir, { recursive: true, force: true })
    await mkdir(stagingDir, { recursive: true })

    try {
      await execFileAsync(
        resolveNpmPath(params.env),
        [
          'install',
          '--prefix',
          stagingDir,
          '--no-save',
          '--no-audit',
          '--no-fund',
          '--loglevel=error',
          `${params.packageName}@${params.version}`
        ],
        {
          cwd: params.cwd,
          env: buildInstallEnv(params.env),
          maxBuffer: INSTALL_BUFFER_BYTES
        }
      )

      await mkdir(dirname(cacheDir), { recursive: true })
      await rm(cacheDir, { recursive: true, force: true })
      await rename(stagingDir, cacheDir)
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true })
      throw new Error(`Failed to install managed plugin package ${params.packageName}@${params.version}.`, {
        cause: error
      })
    }

    return resolveManagedPluginPackageInstallDir(params)
  })
}

export const resolveExistingManagedPluginPackage = async (params: {
  env?: Env
  packageName: string
  version?: string
}) => {
  const version = resolveManagedPluginPackageVersion(params.packageName, params.version)
  if (version == null) return undefined

  const packageDir = resolveManagedPluginPackageInstallDir({
    env: params.env,
    packageName: params.packageName,
    version
  })
  const installedVersion = await readInstalledPackageVersion(packageDir)
  return isInstalledPackageVersionSatisfied(installedVersion, version) ? packageDir : undefined
}

export const ensureManagedPluginPackage = async (params: {
  cwd: string
  env?: Env
  packageName: string
  version?: string
}) => {
  const version = resolveManagedPluginPackageVersion(params.packageName, params.version)
  if (version == null) return undefined

  const env = params.env ?? process.env
  const key = `${params.packageName}@${version}:${resolveManagedPluginPackageRootDir(env)}`
  const existing = installPromises.get(key)
  if (existing != null) return await existing

  const promise = installManagedPluginPackage({
    cwd: params.cwd,
    env,
    packageName: params.packageName,
    version
  }).finally(() => {
    installPromises.delete(key)
  })
  installPromises.set(key, promise)
  return await promise
}
