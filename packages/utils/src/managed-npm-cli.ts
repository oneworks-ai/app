/* eslint-disable max-lines -- shared managed CLI resolver intentionally centralizes install policy. */
import { execFile } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { cp, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import { resolveBootstrapPackageCacheRootDir, resolvePackageCacheHomeDir } from '@oneworks/types'
import type { Logger } from '@oneworks/types'

import { withDirectoryInstallLock } from './install-lock'
import { resolveProjectSharedCachePath } from './project-cache-path'
import { mergeProcessEnvWithProjectEnv } from './project-env'

export interface ManagedNpmCliConfig {
  source?: 'managed' | 'system' | 'path'
  path?: string
  package?: string
  version?: string
  autoInstall?: boolean
  prepareOnInstall?: boolean
  npmPath?: string
}

export interface ManagedNpmCliInstallOptions {
  autoInstall: boolean
  npmPath: string
  packageName: string
  packageSpec: string
  source?: 'managed' | 'system' | 'path'
  version: string
}

export interface ManagedNpmCliPaths {
  rootDir: string
  installDir: string
  cacheDir: string
  binDir: string
  binaryPath: string
}

interface ResolveManagedNpmCliOptionsParams {
  adapterKey: string
  defaultPackageName: string
  defaultVersion: string
  env: Record<string, string | null | undefined>
  config?: ManagedNpmCliConfig
}

interface ResolveManagedNpmCliPathParams extends ResolveManagedNpmCliOptionsParams {
  binaryName: string
  bundledPath?: string
  cwd?: string
  configuredPath?: string
  installKey?: string[]
  versionArgs?: string[]
}

interface EnsureManagedNpmCliParams extends ResolveManagedNpmCliPathParams {
  cwd: string
  logger: Pick<Logger, 'info'>
  minimumVersion?: string
  preferSystem?: boolean
}

const execFileAsync = promisify(execFile)
const COMMAND_CHECK_TIMEOUT_MS = 15000

const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const isFalseLike = (value: string) => ['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase())

const normalizeAdapterEnvPrefix = (adapterKey: string) => (
  `__ONEWORKS_PROJECT_ADAPTER_${adapterKey.replace(/[^a-z0-9]+/giu, '_').toUpperCase()}`
)

const normalizeSource = (value: unknown): ManagedNpmCliInstallOptions['source'] => (
  value === 'managed' || value === 'system' || value === 'path' ? value : undefined
)

const toCacheSegment = (value: string) => (
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'cli'
)

export const resolveManagedNpmCliRootDir = (
  env: Record<string, string | null | undefined> = process.env
) => (
  resolve(resolveBootstrapPackageCacheRootDir(env), 'npm')
)

const hasExplicitPackageVersion = (packageName: string) => {
  const lastAt = packageName.lastIndexOf('@')
  if (!packageName.startsWith('@')) return lastAt > 0
  const slash = packageName.indexOf('/')
  return slash > 0 && lastAt > slash
}

const toPackageSpec = (packageName: string, version: string) => (
  hasExplicitPackageVersion(packageName) ? packageName : `${packageName}@${version}`
)

const toRealPath = (targetPath: string) => {
  try {
    return realpathSync(targetPath)
  } catch {
    return targetPath
  }
}

const canRunCommand = async (binaryPath: string, args: string[], env?: NodeJS.ProcessEnv) => {
  try {
    const result = await execFileAsync(binaryPath, args, { env, timeout: COMMAND_CHECK_TIMEOUT_MS })
    return `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`
  } catch {
    return undefined
  }
}

const normalizeVersionArgs = (versionArgs: string[] | undefined) => (
  versionArgs == null || versionArgs.length === 0 ? ['--version'] : versionArgs
)

const parseSemver = (value: string | undefined): [number, number, number] | undefined => {
  const match = value?.match(/(?:^|\D)(\d+)\.(\d+)\.(\d+)(?:\D|$)/u)
  if (match == null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

const isVersionAtLeast = (output: string, minimumVersion: string | undefined) => {
  if (minimumVersion == null || minimumVersion.trim() === '') return true
  const actual = parseSemver(output)
  const minimum = parseSemver(minimumVersion)
  if (actual == null || minimum == null) return false

  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true
    if (actual[index] < minimum[index]) return false
  }
  return true
}

const canRunBinary = async (
  binaryPath: string,
  versionArgs: string[] | undefined,
  env?: NodeJS.ProcessEnv,
  minimumVersion?: string
) => {
  const output = await canRunCommand(binaryPath, normalizeVersionArgs(versionArgs), env)
  return output != null && isVersionAtLeast(output, minimumVersion)
}
const canRunNpm = async (binaryPath: string, env?: NodeJS.ProcessEnv) =>
  await canRunCommand(binaryPath, ['--version'], env) != null

const moveDirectory = async (source: string, target: string) => {
  try {
    await rename(source, target)
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code !== 'EXDEV') throw error
    await cp(source, target, { recursive: true })
    await rm(source, { recursive: true, force: true })
  }
}

export const resolveManagedNpmCliInstallOptions = (
  params: ResolveManagedNpmCliOptionsParams
): ManagedNpmCliInstallOptions => {
  const envPrefix = normalizeAdapterEnvPrefix(params.adapterKey)
  const rawAutoInstall = normalizeNonEmptyString(params.env[`${envPrefix}_AUTO_INSTALL__`])
  const packageName = normalizeNonEmptyString(params.env[`${envPrefix}_INSTALL_PACKAGE__`]) ??
    normalizeNonEmptyString(params.config?.package) ??
    params.defaultPackageName
  const version = normalizeNonEmptyString(params.env[`${envPrefix}_INSTALL_VERSION__`]) ??
    normalizeNonEmptyString(params.config?.version) ??
    params.defaultVersion

  return {
    autoInstall: rawAutoInstall == null
      ? params.config?.autoInstall !== false
      : !isFalseLike(rawAutoInstall),
    npmPath: normalizeNonEmptyString(params.env[`${envPrefix}_NPM_PATH__`]) ??
      normalizeNonEmptyString(params.config?.npmPath) ??
      'npm',
    packageName,
    packageSpec: toPackageSpec(packageName, version),
    source: normalizeSource(params.env[`${envPrefix}_CLI_SOURCE__`]) ?? normalizeSource(params.config?.source),
    version
  }
}

export const resolveManagedNpmCliPaths = (params: {
  adapterKey: string
  binaryName: string
  cwd: string
  env: Record<string, string | null | undefined>
  installKey?: string[]
  packageName: string
  version: string
}): ManagedNpmCliPaths => {
  const rootDir = resolveManagedNpmCliRootDir(params.env)
  const bootstrapRoot = dirname(rootDir)
  const installDir = resolve(
    rootDir,
    ...(params.installKey ?? []).map(toCacheSegment),
    toCacheSegment(params.packageName),
    toCacheSegment(params.version)
  )
  const binDir = resolve(installDir, 'node_modules', '.bin')
  return {
    rootDir,
    installDir,
    cacheDir: resolve(bootstrapRoot, 'npm-cache'),
    binDir,
    binaryPath: resolve(binDir, params.binaryName)
  }
}

const resolveLegacyManagedNpmCliPaths = (params: {
  adapterKey: string
  binaryName: string
  cwd: string
  env: Record<string, string | null | undefined>
  installKey?: string[]
  packageName: string
  version: string
}): ManagedNpmCliPaths => {
  const rootDir = resolveProjectSharedCachePath(params.cwd, params.env, `adapter-${params.adapterKey}`, 'cli', 'npm')
  const installDir = resolve(
    rootDir,
    ...(params.installKey ?? []).map(toCacheSegment),
    toCacheSegment(params.packageName),
    toCacheSegment(params.version)
  )
  const binDir = resolve(installDir, 'node_modules', '.bin')
  return {
    rootDir,
    installDir,
    cacheDir: resolve(rootDir, '.npm-cache'),
    binDir,
    binaryPath: resolve(binDir, params.binaryName)
  }
}

export const resolveManagedNpmCliBinaryPath = (params: ResolveManagedNpmCliPathParams) => {
  const envPrefix = normalizeAdapterEnvPrefix(params.adapterKey)
  const installOptions = resolveManagedNpmCliInstallOptions(params)
  const explicitPath = normalizeNonEmptyString(params.env[`${envPrefix}_CLI_PATH__`]) ??
    normalizeNonEmptyString(params.configuredPath) ??
    normalizeNonEmptyString(params.config?.path)

  if (explicitPath != null) return explicitPath
  if (installOptions.source === 'system') return params.binaryName

  if (params.cwd != null && params.cwd.trim() !== '') {
    const paths = resolveManagedNpmCliPaths({
      adapterKey: params.adapterKey,
      binaryName: params.binaryName,
      cwd: params.cwd,
      env: params.env,
      installKey: params.installKey,
      packageName: installOptions.packageName,
      version: installOptions.version
    })
    if (existsSync(paths.binaryPath) || installOptions.source === 'managed') {
      return toRealPath(paths.binaryPath)
    }

    const legacyPaths = resolveLegacyManagedNpmCliPaths({
      adapterKey: params.adapterKey,
      binaryName: params.binaryName,
      cwd: params.cwd,
      env: params.env,
      installKey: params.installKey,
      packageName: installOptions.packageName,
      version: installOptions.version
    })
    if (existsSync(legacyPaths.binaryPath)) {
      return toRealPath(legacyPaths.binaryPath)
    }
  }

  if (installOptions.source !== 'managed' && params.bundledPath != null && existsSync(params.bundledPath)) {
    return toRealPath(params.bundledPath)
  }

  return params.binaryName
}

export const buildManagedNpmCliInstallEnv = (params: {
  cwd: string
  env: Record<string, string | null | undefined>
  paths: ManagedNpmCliPaths
}) => ({
  ...mergeProcessEnvWithProjectEnv(params.env, { workspaceFolder: params.cwd }),
  HOME: resolvePackageCacheHomeDir(params.env),
  USERPROFILE: resolvePackageCacheHomeDir(params.env),
  npm_config_cache: params.paths.cacheDir,
  npm_config_replace_registry_host: 'never',
  npm_config_update_notifier: 'false',
  NPM_CONFIG_CACHE: params.paths.cacheDir,
  NPM_CONFIG_REPLACE_REGISTRY_HOST: 'never'
})

export const buildManagedNpmCliInstallInstructions = (params: {
  adapterKey: string
  binaryName: string
  options: ManagedNpmCliInstallOptions
  paths: ManagedNpmCliPaths
}) =>
  [
    `Install ${params.binaryName} CLI with one of these options:`,
    '',
    '1. Let One Works install the managed CLI into the global bootstrap cache:',
    `   ${params.options.npmPath} install --prefix ${params.paths.installDir} --no-save ${params.options.packageSpec}`,
    '',
    '2. Install it yourself and point One Works at the binary:',
    `   __ONEWORKS_PROJECT_ADAPTER_${
      params.adapterKey.replace(/[^a-z0-9]+/giu, '_').toUpperCase()
    }_CLI_PATH__=/absolute/path/to/${params.binaryName}`,
    '',
    `Managed ${params.binaryName} bin dir: ${params.paths.binDir}`
  ].join('\n')

const migrateLegacyManagedNpmCliInstall = async (params: {
  binaryName: string
  legacyPaths: ManagedNpmCliPaths
  logger: Pick<Logger, 'info'>
  minimumVersion?: string
  paths: ManagedNpmCliPaths
  versionArgs?: string[]
  env: NodeJS.ProcessEnv
}) => {
  const targetBinaryUsable = existsSync(params.paths.binaryPath) &&
    await canRunBinary(params.paths.binaryPath, params.versionArgs, params.env, params.minimumVersion)
  if (
    !existsSync(params.legacyPaths.binaryPath) ||
    targetBinaryUsable ||
    !await canRunBinary(params.legacyPaths.binaryPath, params.versionArgs, params.env, params.minimumVersion)
  ) {
    return false
  }

  await withDirectoryInstallLock({
    lockDir: `${params.paths.installDir}.lock`
  }, async () => {
    const lockedTargetBinaryUsable = existsSync(params.paths.binaryPath) &&
      await canRunBinary(params.paths.binaryPath, params.versionArgs, params.env, params.minimumVersion)
    if (lockedTargetBinaryUsable || !existsSync(params.legacyPaths.binaryPath)) {
      return
    }

    await mkdir(dirname(params.paths.installDir), { recursive: true })
    await rm(params.paths.installDir, { recursive: true, force: true })
    params.logger.info(
      `Moving ${params.binaryName} CLI from ${params.legacyPaths.installDir} to ${params.paths.installDir}`
    )
    await moveDirectory(params.legacyPaths.installDir, params.paths.installDir)
  })

  return existsSync(params.paths.binaryPath) &&
    await canRunBinary(params.paths.binaryPath, params.versionArgs, params.env, params.minimumVersion)
}

export const ensureManagedNpmCli = async (params: EnsureManagedNpmCliParams) => {
  const installOptions = resolveManagedNpmCliInstallOptions(params)
  const canUseProjectCli = installOptions.source !== 'system'
  const canUseSystemCli = installOptions.source !== 'managed'
  const paths = resolveManagedNpmCliPaths({
    adapterKey: params.adapterKey,
    binaryName: params.binaryName,
    cwd: params.cwd,
    env: params.env,
    installKey: params.installKey,
    packageName: installOptions.packageName,
    version: installOptions.version
  })
  const legacyPaths = resolveLegacyManagedNpmCliPaths({
    adapterKey: params.adapterKey,
    binaryName: params.binaryName,
    cwd: params.cwd,
    env: params.env,
    installKey: params.installKey,
    packageName: installOptions.packageName,
    version: installOptions.version
  })
  const probeEnv = mergeProcessEnvWithProjectEnv(params.env, { workspaceFolder: params.cwd })
  const explicitPath = resolveManagedNpmCliBinaryPath({
    ...params,
    config: {
      ...params.config,
      source: params.config?.source === 'path' ? 'path' : undefined
    }
  })

  const binaryPath = toRealPath(paths.binaryPath)
  const legacyBinaryPath = toRealPath(legacyPaths.binaryPath)

  if (explicitPath !== params.binaryName && explicitPath !== binaryPath) {
    if (explicitPath === legacyBinaryPath) {
      // Continue through source policy checks before using the legacy workspace cache.
    } else {
      return explicitPath
    }
  }

  if (
    params.preferSystem === true &&
    installOptions.source == null &&
    await canRunBinary(params.binaryName, params.versionArgs, probeEnv, params.minimumVersion)
  ) {
    return params.binaryName
  }

  if (
    installOptions.source === 'system' &&
    await canRunBinary(params.binaryName, params.versionArgs, probeEnv, params.minimumVersion)
  ) {
    return params.binaryName
  }

  if (
    existsSync(paths.binaryPath) &&
    await canRunBinary(paths.binaryPath, params.versionArgs, probeEnv, params.minimumVersion)
  ) {
    return binaryPath
  }

  if (
    canUseProjectCli &&
    await migrateLegacyManagedNpmCliInstall({
      binaryName: params.binaryName,
      env: probeEnv,
      legacyPaths,
      logger: params.logger,
      minimumVersion: params.minimumVersion,
      paths,
      versionArgs: params.versionArgs
    })
  ) {
    return binaryPath
  }

  if (
    canUseProjectCli && params.bundledPath != null &&
    existsSync(params.bundledPath) &&
    toRealPath(params.bundledPath) !== legacyBinaryPath &&
    (params.minimumVersion == null ||
      await canRunBinary(params.bundledPath, params.versionArgs, probeEnv, params.minimumVersion))
  ) {
    return toRealPath(params.bundledPath)
  }

  if (canUseProjectCli && installOptions.autoInstall && await canRunNpm(installOptions.npmPath, probeEnv)) {
    await mkdir(paths.cacheDir, { recursive: true })
    const installEnv = buildManagedNpmCliInstallEnv({
      cwd: params.cwd,
      env: params.env,
      paths
    })
    await withDirectoryInstallLock({
      lockDir: `${paths.installDir}.lock`
    }, async () => {
      if (await canRunBinary(paths.binaryPath, params.versionArgs, installEnv, params.minimumVersion)) {
        return
      }

      const stagingDir = `${paths.installDir}.tmp-${process.pid}-${Date.now()}`
      await rm(stagingDir, { recursive: true, force: true })
      await mkdir(stagingDir, { recursive: true })
      params.logger.info(`Installing ${params.binaryName} CLI into ${paths.installDir}`)
      try {
        await execFileAsync(
          installOptions.npmPath,
          [
            'install',
            '--prefix',
            stagingDir,
            '--no-save',
            '--no-audit',
            '--no-fund',
            installOptions.packageSpec
          ],
          {
            cwd: params.cwd,
            env: installEnv,
            maxBuffer: 1024 * 1024 * 10
          }
        )
        await mkdir(dirname(paths.installDir), { recursive: true })
        await rm(paths.installDir, { recursive: true, force: true })
        await rename(stagingDir, paths.installDir)
      } catch (error) {
        await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
        throw error
      }
    })

    if (!await canRunBinary(paths.binaryPath, params.versionArgs, installEnv, params.minimumVersion)) {
      throw new Error(
        `${params.binaryName} CLI installation completed, but the managed binary could not be executed.\n\n${
          buildManagedNpmCliInstallInstructions({
            adapterKey: params.adapterKey,
            binaryName: params.binaryName,
            options: installOptions,
            paths
          })
        }`
      )
    }

    return binaryPath
  }

  if (
    canUseProjectCli &&
    existsSync(legacyPaths.binaryPath) &&
    await canRunBinary(legacyPaths.binaryPath, params.versionArgs, probeEnv, params.minimumVersion)
  ) {
    return legacyBinaryPath
  }

  if (
    canUseSystemCli &&
    await canRunBinary(params.binaryName, params.versionArgs, probeEnv, params.minimumVersion)
  ) {
    return params.binaryName
  }

  if (installOptions.source === 'system') {
    throw new Error(
      params.minimumVersion == null
        ? `${params.binaryName} CLI was not found on PATH.`
        : `${params.binaryName} CLI was not found on PATH or does not satisfy minimum version ${params.minimumVersion}.`
    )
  }

  if (!installOptions.autoInstall) {
    throw new Error(
      `${params.binaryName} CLI was not found and automatic install is disabled.\n\n${
        buildManagedNpmCliInstallInstructions({
          adapterKey: params.adapterKey,
          binaryName: params.binaryName,
          options: installOptions,
          paths
        })
      }`
    )
  }

  throw new Error(
    `${params.binaryName} CLI was not found, and npm is required for automatic install.\n\n${
      buildManagedNpmCliInstallInstructions({
        adapterKey: params.adapterKey,
        binaryName: params.binaryName,
        options: installOptions,
        paths
      })
    }`
  )
}
