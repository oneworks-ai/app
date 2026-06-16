/* eslint-disable max-lines -- managed plugin package install/cache handling includes module update cache resolution. */
import type { Dirent } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

import Arborist from '@npmcli/arborist'
import pacote from 'pacote'
import semver from 'semver'

import { resolveBootstrapPackageCacheRootDir, resolvePackageCacheHomeDir, sanitizePackageName } from '@oneworks/types'

import { withDirectoryInstallLock } from './install-lock'

const INSTALL_MANIFEST_FILE = '.oneworks-plugin-package.json'
const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org'
const DEFAULT_REGISTRY_FALLBACKS = ['https://registry.npmmirror.com']
const REGISTRY_PROBE_TIMEOUT_MS = 3000
const REGISTRY_FALLBACK_ENV_KEYS = [
  '__ONEWORKS_PROJECT_PLUGIN_NPM_REGISTRY_FALLBACKS__',
  'ONEWORKS_NPM_REGISTRY_FALLBACKS'
] as const
const REGISTRY_FALLBACK_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'ESOCKETTIMEDOUT',
  'ETIMEDOUT',
  'FETCH_ERROR',
  'ERR_SOCKET_TIMEOUT'
])

type Env = Record<string, string | null | undefined>

interface ActiveModulePackageMetadata {
  packageDir?: unknown
  packageName?: unknown
  version?: unknown
}

interface RegistryManifest {
  name?: string
  version?: string
  dist?: {
    integrity?: string
    tarball?: string
  }
}

interface ManagedPluginPackageInstallManifest {
  installedAt: string
  integrity?: string
  packageName: string
  registry?: string
  requestedVersion: string
  tarball?: string
  version: string
}

interface RegistryCandidate {
  probeRegistry: string
  registry?: string
}

interface ManagedPluginNpmConfig {
  options: Record<string, string | boolean>
  primaryRegistry?: string
}

export const isManagedPluginPackageName = (packageName: string) => packageName.startsWith('@oneworks/plugin-')

const installPromises = new Map<string, Promise<string>>()

const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const isFalseLike = (value: string) => ['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase())

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const toErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

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

const isInstalledPackageInfoSatisfied = (
  packageInfo: Awaited<ReturnType<typeof readInstalledPackageInfo>>,
  packageName: string,
  requestedVersion: string
) => (
  packageInfo?.name === packageName &&
  packageInfo.version === requestedVersion
)

const shouldAutoInstall = (env: Env) => {
  const raw = normalizeNonEmptyString(env.__ONEWORKS_PROJECT_PLUGIN_AUTO_INSTALL__)
  return raw == null ? true : !isFalseLike(raw)
}

const resolveNpmCacheDir = (env: Env) => {
  const bootstrapRoot = dirname(resolveManagedPluginPackageRootDir(env))
  return {
    cache: join(bootstrapRoot, 'npm-cache')
  }
}

const normalizeRegistry = (value: unknown) => normalizeNonEmptyString(value)?.replace(/\/+$/u, '')

const parseRegistryList = (value: unknown) => (
  normalizeNonEmptyString(value)
    ?.split(/[\s,;]+/u)
    .flatMap(registry => normalizeRegistry(registry) ?? []) ?? []
)

const resolveConfiguredRegistry = (env: Env) => (
  normalizeRegistry(env.npm_config_registry) ?? normalizeRegistry(env.NPM_CONFIG_REGISTRY)
)

const resolvePackageScope = (packageName: string) => (
  packageName.startsWith('@') ? packageName.split('/')[0] : undefined
)

const stripInlineComment = (value: string) => {
  const hashIndex = value.search(/\s[#;]/u)
  return hashIndex === -1 ? value : value.slice(0, hashIndex)
}

const unquoteNpmConfigValue = (value: string) => {
  const trimmed = stripInlineComment(value).trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

const interpolateNpmConfigValue = (value: string, env: Env) => (
  value.replace(/\$\{([^}]+)\}/gu, (_match, name: string) => normalizeNonEmptyString(env[name]) ?? '')
)

const normalizeNpmConfigKey = (key: string) => {
  const trimmed = key.trim()
  return trimmed.startsWith('//') ? trimmed : trimmed.toLowerCase()
}

const parseNpmrc = (content: string, env: Env) => (
  Object.fromEntries(
    content
      .split(/\r?\n/u)
      .flatMap((line): Array<[string, string]> => {
        const trimmed = line.trim()
        if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith(';')) return []
        const separatorIndex = trimmed.indexOf('=')
        if (separatorIndex === -1) return []

        const key = normalizeNpmConfigKey(trimmed.slice(0, separatorIndex))
        const value = interpolateNpmConfigValue(unquoteNpmConfigValue(trimmed.slice(separatorIndex + 1)), env)
        return key === '' ? [] : [[key, value]]
      })
  )
)

const readNpmrcConfig = async (filePath: string, env: Env) => {
  try {
    return parseNpmrc(await readFile(filePath, 'utf8'), env)
  } catch {
    return {}
  }
}

const normalizeEnvNpmConfigKey = (key: string) => {
  if (key.startsWith('//') || key.includes(':')) return normalizeNpmConfigKey(key)
  return normalizeNpmConfigKey(key.replace(/_/gu, '-'))
}

const readEnvNpmConfig = (env: Env) => (
  Object.fromEntries(
    Object.entries(env).flatMap((entry): Array<[string, string]> => {
      const [key, value] = entry
      if (typeof value !== 'string') return []
      const prefix = key.startsWith('npm_config_')
        ? 'npm_config_'
        : key.startsWith('NPM_CONFIG_')
        ? 'NPM_CONFIG_'
        : undefined
      if (prefix == null) return []

      const configKey = normalizeEnvNpmConfigKey(key.slice(prefix.length))
      if (configKey === '' || configKey === 'argv') return []
      return [[configKey, value]]
    })
  )
)

const toNpmConfigOptionValue = (value: string) => {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return value
}

const resolveManagedPluginNpmConfig = async (params: {
  cwd: string
  env: Env
  packageName: string
}): Promise<ManagedPluginNpmConfig> => {
  const userConfigPath = normalizeNonEmptyString(params.env.npm_config_userconfig) ??
    normalizeNonEmptyString(params.env.NPM_CONFIG_USERCONFIG) ??
    join(resolvePackageCacheHomeDir(params.env), '.npmrc')
  const projectConfigPath = normalizeNonEmptyString(params.env.npm_config_projectconfig) ??
    normalizeNonEmptyString(params.env.NPM_CONFIG_PROJECTCONFIG) ??
    join(params.cwd, '.npmrc')
  const [userConfig, projectConfig] = await Promise.all([
    readNpmrcConfig(userConfigPath, params.env),
    readNpmrcConfig(projectConfigPath, params.env)
  ])
  const mergedConfig = {
    ...userConfig,
    ...projectConfig,
    ...readEnvNpmConfig(params.env)
  }
  const packageScope = resolvePackageScope(params.packageName)
  const scopedRegistry = packageScope == null
    ? undefined
    : normalizeRegistry(mergedConfig[`${packageScope}:registry`])
  const primaryRegistry = scopedRegistry ?? normalizeRegistry(mergedConfig.registry)

  return {
    options: Object.fromEntries(
      Object.entries(mergedConfig).map(([key, value]) => [key, toNpmConfigOptionValue(value)])
    ),
    ...(primaryRegistry != null ? { primaryRegistry } : {})
  }
}

const resolveConfiguredFallbackRegistries = (env: Env) => (
  REGISTRY_FALLBACK_ENV_KEYS.flatMap(key => parseRegistryList(env[key]))
)

const toRegistryCandidate = (registry: string | undefined): RegistryCandidate => ({
  probeRegistry: registry ?? DEFAULT_NPM_REGISTRY,
  ...(registry != null ? { registry } : {})
})

const uniqueRegistryCandidates = (candidates: RegistryCandidate[]) => {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = candidate.probeRegistry
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const resolveRegistryCandidates = (params: {
  env: Env
  npmConfig: ManagedPluginNpmConfig
}): RegistryCandidate[] => {
  const configuredRegistry = params.npmConfig.primaryRegistry ?? resolveConfiguredRegistry(params.env)
  const configuredFallbacks = resolveConfiguredFallbackRegistries(params.env)
  return uniqueRegistryCandidates([
    toRegistryCandidate(configuredRegistry),
    ...configuredFallbacks.map(toRegistryCandidate),
    ...(configuredRegistry == null && configuredFallbacks.length === 0
      ? DEFAULT_REGISTRY_FALLBACKS.map(toRegistryCandidate)
      : [])
  ])
}

const createNpmConfigInstallKey = (env: Env, npmConfig: ManagedPluginNpmConfig) => (
  [
    npmConfig.primaryRegistry ?? '<default>',
    ...resolveConfiguredFallbackRegistries(env)
  ].join('|')
)

const formatRegistryLabel = (candidate: RegistryCandidate) => (
  candidate.registry ?? `default npm registry (${candidate.probeRegistry})`
)

const buildRegistryProbeUrl = (candidate: RegistryCandidate) => (
  new URL('./-/ping', candidate.probeRegistry.endsWith('/') ? candidate.probeRegistry : `${candidate.probeRegistry}/`)
    .toString()
)

const isReachableRegistryProbeStatus = (status: number) => status < 500 && status !== 408 && status !== 429

const probeRegistryCandidate = async (candidate: RegistryCandidate) => {
  try {
    const response = await fetch(buildRegistryProbeUrl(candidate), {
      signal: AbortSignal.timeout(REGISTRY_PROBE_TIMEOUT_MS)
    })
    return isReachableRegistryProbeStatus(response.status)
  } catch {
    return false
  }
}

const orderRegistryCandidatesByProbe = async (candidates: RegistryCandidate[]) => {
  if (candidates.length <= 1) return candidates

  for (const [index, candidate] of candidates.entries()) {
    if (await probeRegistryCandidate(candidate)) return candidates.slice(index)

    const next = candidates[index + 1]
    if (next != null) {
      console.warn(
        `[plugins] Registry probe failed for ${formatRegistryLabel(candidate)}. Trying ${formatRegistryLabel(next)}.`
      )
    }
  }

  return candidates
}

const readErrorStatusCode = (error: unknown): number | undefined => {
  if (!isRecord(error)) return undefined
  const statusCode = typeof error.statusCode === 'number'
    ? error.statusCode
    : typeof error.status === 'number'
    ? error.status
    : undefined
  if (statusCode != null) return statusCode

  return readErrorStatusCode(error.response)
}

const isRegistryFallbackError = (error: unknown) => {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined
  if (code != null && REGISTRY_FALLBACK_ERROR_CODES.has(code)) return true

  const statusCode = readErrorStatusCode(error)
  return statusCode === 408 || statusCode === 429 || (statusCode != null && statusCode >= 500)
}

const buildRegistryOptions = (params: {
  env: Env
  npmConfig: ManagedPluginNpmConfig
  registry?: string
}) => {
  return {
    ...params.npmConfig.options,
    ...(params.registry != null ? { registry: params.registry } : {}),
    audit: false,
    fund: false,
    ignoreScripts: true,
    replaceRegistryHost: 'never',
    updateNotifier: false,
    ...resolveNpmCacheDir(params.env)
  }
}

const toInstallManifest = (params: {
  installedAt?: string
  manifest: RegistryManifest
  packageName: string
  registry?: string
  requestedVersion: string
  version: string
}): ManagedPluginPackageInstallManifest => ({
  installedAt: params.installedAt ?? new Date().toISOString(),
  ...(normalizeNonEmptyString(params.manifest.dist?.integrity) != null
    ? { integrity: normalizeNonEmptyString(params.manifest.dist?.integrity) }
    : {}),
  packageName: params.packageName,
  ...(params.registry != null ? { registry: params.registry } : {}),
  requestedVersion: params.requestedVersion,
  ...(normalizeNonEmptyString(params.manifest.dist?.tarball) != null
    ? { tarball: normalizeNonEmptyString(params.manifest.dist?.tarball) }
    : {}),
  version: params.version
})

const writePackageInstallManifest = async (cacheDir: string, entry: ManagedPluginPackageInstallManifest) => {
  await writeFile(join(cacheDir, INSTALL_MANIFEST_FILE), `${JSON.stringify(entry, null, 2)}\n`)
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

const resolveValidCachedPackage = async (params: {
  env: Env
  packageName: string
  requestedVersion: string
  version: string
}) => {
  const packageDir = resolveManagedPluginPackageInstallDir(params)
  const packageInfo = await readInstalledPackageInfo(packageDir)
  if (!isInstalledPackageInfoSatisfied(packageInfo, params.packageName, params.version)) return undefined

  return packageDir
}

const findCachedPackageVersions = async (packageName: string, env: Env) => {
  const packageRoot = join(resolveManagedPluginPackageRootDir(env), sanitizeManagedPluginPackageName(packageName))
  let entries: Dirent<string>[]
  try {
    entries = await readdir(packageRoot, { withFileTypes: true })
  } catch {
    return []
  }

  const versions = await Promise.all(
    entries
      .filter(entry => entry.isDirectory())
      .map(async (entry) => {
        const packageDir = resolveManagedPluginPackageInstallDir({
          env,
          packageName,
          version: entry.name
        })
        const packageInfo = await readInstalledPackageInfo(packageDir)
        return packageInfo?.name === packageName && packageInfo.version === entry.name ? entry.name : undefined
      })
  )
  return versions.filter((version): version is string => version != null)
}

const pickCachedVersion = (versions: string[], requestedVersion: string) => {
  const validVersions = versions.filter(version => semver.valid(version) != null)
  const exactVersion = semver.valid(requestedVersion)
  if (exactVersion != null) return validVersions.includes(exactVersion) ? exactVersion : undefined
  if (requestedVersion === 'latest') return semver.rsort(validVersions)[0]
  return semver.maxSatisfying(validVersions, requestedVersion, { includePrerelease: true }) ?? undefined
}

const resolveCachedPackage = async (params: {
  env: Env
  packageName: string
  requestedVersion: string
}) => {
  const version = pickCachedVersion(
    await findCachedPackageVersions(params.packageName, params.env),
    params.requestedVersion
  )
  if (version == null) return undefined

  return await resolveValidCachedPackage({
    ...params,
    version
  })
}

const isExactSemverRequest = (requestedVersion: string) => semver.valid(requestedVersion) != null

const resolveRegistryManifest = async (params: {
  env: Env
  npmConfig: ManagedPluginNpmConfig
  packageName: string
  requestedVersion: string
}) => {
  const spec = `${params.packageName}@${params.requestedVersion}`
  const candidates = await orderRegistryCandidatesByProbe(resolveRegistryCandidates({
    env: params.env,
    npmConfig: params.npmConfig
  }))

  for (const [index, candidate] of candidates.entries()) {
    try {
      const manifest = await pacote.manifest(spec, {
        ...buildRegistryOptions({
          env: params.env,
          npmConfig: params.npmConfig,
          registry: candidate.registry
        }),
        fullMetadata: true
      }) as RegistryManifest
      const version = normalizeNonEmptyString(manifest.version)

      if (manifest.name !== params.packageName || version == null) {
        throw new Error(`Failed to resolve managed plugin package ${spec}. Registry returned invalid metadata.`)
      }

      return {
        manifest,
        registry: candidate.registry ?? candidate.probeRegistry,
        version
      }
    } catch (error) {
      const next = candidates[index + 1]
      if (next == null || !isRegistryFallbackError(error)) throw error

      console.warn(
        `[plugins] Failed to resolve ${spec} from ${formatRegistryLabel(candidate)}: ${toErrorMessage(error)}. Trying ${
          formatRegistryLabel(next)
        }.`
      )
    }
  }

  throw new Error(`Failed to resolve managed plugin package ${spec}.`)
}

const installManagedPluginPackage = async (params: {
  env: Env
  manifest: RegistryManifest
  npmConfig: ManagedPluginNpmConfig
  packageName: string
  registry?: string
  requestedVersion: string
  version: string
}) => {
  const packageDir = resolveManagedPluginPackageInstallDir(params)
  const packageInfo = await readInstalledPackageInfo(packageDir)
  if (isInstalledPackageInfoSatisfied(packageInfo, params.packageName, params.version)) return packageDir

  if (!shouldAutoInstall(params.env)) {
    throw new Error(
      `Managed plugin package ${params.packageName}@${params.version} was not found and automatic install is disabled.`
    )
  }

  const cacheDir = resolveManagedPluginPackageCacheDir(params.packageName, params.version, params.env)
  return await withDirectoryInstallLock({
    lockDir: `${cacheDir}.lock`
  }, async () => {
    const lockedPackageInfo = await readInstalledPackageInfo(packageDir)
    if (isInstalledPackageInfoSatisfied(lockedPackageInfo, params.packageName, params.version)) return packageDir

    const stagingDir = `${cacheDir}.tmp-${process.pid}-${Date.now()}`
    await rm(stagingDir, { recursive: true, force: true })
    await mkdir(stagingDir, { recursive: true })

    try {
      await writeFile(
        join(stagingDir, 'package.json'),
        `${JSON.stringify({ dependencies: {}, private: true }, null, 2)}\n`
      )
      const arborist = new Arborist({
        ...buildRegistryOptions({
          env: params.env,
          npmConfig: params.npmConfig,
          registry: params.registry
        }),
        path: stagingDir
      })
      await arborist.reify({
        add: [`${params.packageName}@${params.version}`],
        save: false
      })

      const packageInfo = await readInstalledPackageInfo(
        join(stagingDir, 'node_modules', ...params.packageName.split('/'))
      )
      if (packageInfo?.name !== params.packageName || packageInfo.version !== params.version) {
        throw new Error(
          `Installed ${params.packageName} version ${
            packageInfo?.version ?? 'unknown'
          } does not match ${params.version}.`
        )
      }

      await writePackageInstallManifest(stagingDir, toInstallManifest(params))

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
  const requestedVersion = resolveManagedPluginPackageVersion(params.packageName, params.version)
  if (requestedVersion == null) return undefined

  return await resolveCachedPackage({
    env: params.env ?? process.env,
    packageName: params.packageName,
    requestedVersion
  })
}

export const ensureManagedPluginPackage = async (params: {
  cwd: string
  env?: Env
  packageName: string
  version?: string
}) => {
  const requestedVersion = resolveManagedPluginPackageVersion(params.packageName, params.version)
  if (requestedVersion == null) return undefined

  const env = params.env ?? process.env
  const npmConfig = await resolveManagedPluginNpmConfig({
    cwd: params.cwd,
    env,
    packageName: params.packageName
  })
  const key = `${params.packageName}@${requestedVersion}:${resolveManagedPluginPackageRootDir(env)}:${
    createNpmConfigInstallKey(env, npmConfig)
  }`
  const existing = installPromises.get(key)
  if (existing != null) return await existing

  const promise = (async () => {
    if (isExactSemverRequest(requestedVersion)) {
      const cachedPackageDir = await resolveCachedPackage({
        env,
        packageName: params.packageName,
        requestedVersion
      })
      if (cachedPackageDir != null) return cachedPackageDir
    }

    if (!shouldAutoInstall(env)) {
      const cachedPackageDir = await resolveCachedPackage({
        env,
        packageName: params.packageName,
        requestedVersion
      })
      if (cachedPackageDir != null) return cachedPackageDir

      throw new Error(
        `Managed plugin package ${params.packageName}@${requestedVersion} was not found and automatic install is disabled.`
      )
    }

    const resolved = await resolveRegistryManifest({
      env,
      npmConfig,
      packageName: params.packageName,
      requestedVersion
    })
    return await installManagedPluginPackage({
      env,
      manifest: resolved.manifest,
      npmConfig,
      packageName: params.packageName,
      registry: resolved.registry,
      requestedVersion,
      version: resolved.version
    })
  })().finally(() => {
    installPromises.delete(key)
  })
  installPromises.set(key, promise)
  return await promise
}
