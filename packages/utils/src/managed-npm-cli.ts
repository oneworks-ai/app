/* eslint-disable max-lines -- shared managed CLI resolver intentionally centralizes install policy. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { cp, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import { resolveBootstrapPackageCacheRootDir, resolvePackageCacheHomeDir } from '@oneworks/types'
import type { Logger } from '@oneworks/types'
import semver from 'semver'

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

export type ManagedNpmCliChildEnvPolicy =
  | 'legacy-inherit'
  | 'minimal'
  | 'provided-only'
  | {
    mode: 'legacy-inherit' | 'minimal'
    allowKeys?: readonly string[]
    tombstoneKeys?: readonly string[]
    tombstonePrefixes?: readonly string[]
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
  companionPackageSpecs?: string[]
  childEnvPolicy?: ManagedNpmCliChildEnvPolicy
  commandCheckTimeoutMs?: number
  cwd: string
  ignoreInstallScripts?: boolean
  installHomeDir?: string
  logger: Pick<Logger, 'info'>
  minimumVersion?: string
  preferSystem?: boolean
  migrateLegacyInstall?: boolean
  systemBinaryPaths?: string[]
  subprocessEnvAllowKeys?: string[]
  subprocessEnvOmitKeys?: string[]
  validateExplicitPathVersion?: boolean
  versionRange?: string
  validateBinary?: (binaryPath: string, env: NodeJS.ProcessEnv) => Promise<boolean>
}

const execFileAsync = promisify(execFile)
const COMMAND_CHECK_TIMEOUT_MS = 15000

const MINIMAL_CHILD_ENV_KEYS = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'ComSpec',
  'COMSPEC',
  'WINDIR',
  'SHELL',
  'HOME',
  'USERPROFILE',
  'USER',
  'USERNAME',
  'LOGNAME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'COLORTERM',
  'CI',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'NODE_AUTH_TOKEN',
  'NPM_TOKEN',
  'NPM_CONFIG_REGISTRY',
  'NPM_CONFIG_PROXY',
  'NPM_CONFIG_HTTPS_PROXY',
  'NPM_CONFIG_STRICT_SSL',
  'NPM_CONFIG_CAFILE',
  'npm_config_registry',
  'npm_config_proxy',
  'npm_config_https_proxy',
  'npm_config_strict_ssl',
  'npm_config_cafile'
] as const

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

const toIdentityCacheSegment = (value: string) => {
  const readable = toCacheSegment(value).slice(0, 48)
  const digest = createHash('sha256').update(value, 'utf8').digest('hex')
  return `${readable}--${digest}`
}

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

const toDefinedProcessEnv = (
  env: Record<string, string | null | undefined>
): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )

const canRunCommand = async (
  binaryPath: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  timeoutMs = COMMAND_CHECK_TIMEOUT_MS
) => {
  try {
    const result = await execFileAsync(binaryPath, args, { env, timeout: timeoutMs })
    return `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`
  } catch {
    return undefined
  }
}

export const buildManagedNpmCliChildEnv = (params: {
  cwd: string
  env: Record<string, string | null | undefined>
  policy?: ManagedNpmCliChildEnvPolicy
}) => {
  if (params.policy === 'provided-only' || params.policy === 'minimal') {
    return toDefinedProcessEnv(params.env)
  }
  const merged = mergeProcessEnvWithProjectEnv(params.env, { workspaceFolder: params.cwd })
  if (typeof params.policy !== 'object' || params.policy.mode !== 'minimal') return merged

  const allowed = new Set([...MINIMAL_CHILD_ENV_KEYS, ...(params.policy.allowKeys ?? [])])
  const childEnv: NodeJS.ProcessEnv = {}
  for (const key of allowed) {
    const value = merged[key]
    if (typeof value === 'string') childEnv[key] = value
  }
  for (const key of params.policy.tombstoneKeys ?? []) delete childEnv[key]
  for (const prefix of params.policy.tombstonePrefixes ?? []) {
    for (const key of Object.keys(childEnv)) {
      if (key.startsWith(prefix)) delete childEnv[key]
    }
  }
  return childEnv
}

const normalizeVersionArgs = (versionArgs: string[] | undefined) => (
  versionArgs == null || versionArgs.length === 0 ? ['--version'] : versionArgs
)

const extractSemver = (value: string | undefined) => {
  const match = value?.match(/(?:^|\D)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?=$|[^\w.+-])/u)
  const exactVersion = match?.[1]
  if (exactVersion != null && semver.valid(exactVersion) != null) return exactVersion
  return semver.coerce(value)?.version
}

const isVersionCompatible = (
  output: string,
  minimumVersion: string | undefined,
  versionRange: string | undefined
) => {
  const normalizedRange = versionRange?.trim()
  const normalizedMinimum = minimumVersion?.trim()
  if (normalizedRange == null || normalizedRange === '') {
    if (normalizedMinimum == null || normalizedMinimum === '') return true
  } else {
    const actual = extractSemver(output)
    return actual != null &&
      semver.validRange(normalizedRange) != null &&
      semver.satisfies(actual, normalizedRange, { includePrerelease: true })
  }

  const actual = extractSemver(output)
  const minimum = extractSemver(normalizedMinimum)
  return actual != null && minimum != null && semver.gte(actual, minimum)
}

const canRunBinary = async (
  binaryPath: string,
  versionArgs: string[] | undefined,
  env?: NodeJS.ProcessEnv,
  minimumVersion?: string,
  versionRange?: string,
  timeoutMs?: number
) => {
  const output = await canRunCommand(binaryPath, normalizeVersionArgs(versionArgs), env, timeoutMs)
  return output != null && isVersionCompatible(output, minimumVersion, versionRange)
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
    ...(params.installKey ?? []).map(toIdentityCacheSegment),
    toIdentityCacheSegment(params.packageName),
    toIdentityCacheSegment(params.version)
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

const resolveLegacyGlobalManagedNpmCliPaths = (params: {
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

const splitExactPackageIdentity = (packageName: string, version: string) => {
  const embeddedVersionIndex = hasExplicitPackageVersion(packageName) ? packageName.lastIndexOf('@') : -1
  const name = embeddedVersionIndex > 0 ? packageName.slice(0, embeddedVersionIndex) : packageName
  const requestedVersion = embeddedVersionIndex > 0 ? packageName.slice(embeddedVersionIndex + 1) : version
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(name)) return undefined
  if (semver.valid(requestedVersion) == null) return undefined
  return { name, version: requestedVersion }
}

const hasExactInstalledPackageIdentity = (
  binaryName: string,
  installDir: string,
  packageName: string,
  version: string
) => {
  const expected = splitExactPackageIdentity(packageName, version)
  if (expected == null) return false
  try {
    const packageDir = resolve(installDir, 'node_modules', ...expected.name.split('/'))
    const packageJsonPath = resolve(packageDir, 'package.json')
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as unknown
    if (
      !(parsed != null && typeof parsed === 'object' && !Array.isArray(parsed) &&
        (parsed as Record<string, unknown>).name === expected.name &&
        (parsed as Record<string, unknown>).version === expected.version)
    ) return false
    const bin = (parsed as Record<string, unknown>).bin
    const binTarget = typeof bin === 'string'
      ? (expected.name.split('/').at(-1) === binaryName ? bin : undefined)
      : bin != null && typeof bin === 'object' && !Array.isArray(bin)
      ? (bin as Record<string, unknown>)[binaryName]
      : undefined
    if (typeof binTarget !== 'string' || binTarget.trim() === '') return false
    const expectedBinaryPath = resolve(packageDir, binTarget)
    const relativeBinaryPath = relative(packageDir, expectedBinaryPath)
    if (relativeBinaryPath === '' || relativeBinaryPath.startsWith('..') || isAbsolute(relativeBinaryPath)) return false
    return realpathSync(resolve(installDir, 'node_modules', '.bin', binaryName)) === realpathSync(expectedBinaryPath)
  } catch {
    return false
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

    const legacyCandidates = [
      resolveLegacyGlobalManagedNpmCliPaths({
        adapterKey: params.adapterKey,
        binaryName: params.binaryName,
        cwd: params.cwd,
        env: params.env,
        installKey: params.installKey,
        packageName: installOptions.packageName,
        version: installOptions.version
      }),
      resolveLegacyManagedNpmCliPaths({
        adapterKey: params.adapterKey,
        binaryName: params.binaryName,
        cwd: params.cwd,
        env: params.env,
        installKey: params.installKey,
        packageName: installOptions.packageName,
        version: installOptions.version
      })
    ]
    for (const legacyPaths of legacyCandidates) {
      if (
        existsSync(legacyPaths.binaryPath) &&
        hasExactInstalledPackageIdentity(
          params.binaryName,
          legacyPaths.installDir,
          installOptions.packageName,
          installOptions.version
        )
      ) {
        return toRealPath(legacyPaths.binaryPath)
      }
    }
  }

  if (installOptions.source !== 'managed' && params.bundledPath != null && existsSync(params.bundledPath)) {
    return toRealPath(params.bundledPath)
  }

  return params.binaryName
}

export const buildManagedNpmCliInstallEnv = (params: {
  allowKeys?: string[]
  childEnvPolicy?: ManagedNpmCliChildEnvPolicy
  cwd: string
  env: Record<string, string | null | undefined>
  omitKeys?: string[]
  homeDir?: string
  paths: ManagedNpmCliPaths
}) => {
  const mergedEnv = buildManagedNpmCliChildEnv({
    cwd: params.cwd,
    env: params.env,
    policy: params.childEnvPolicy
  })
  const inheritedEnv = params.allowKeys == null
    ? mergedEnv
    : Object.fromEntries(
      Object.entries(mergedEnv).filter(([key, value]) => (
        typeof value === 'string' && params.allowKeys?.some(allowed => (
            process.platform === 'win32' ? allowed.toLowerCase() === key.toLowerCase() : allowed === key
          )
          ) === true
      ))
    )
  const env: NodeJS.ProcessEnv = {
    ...inheritedEnv,
    HOME: params.homeDir ?? resolvePackageCacheHomeDir(params.env),
    USERPROFILE: params.homeDir ?? resolvePackageCacheHomeDir(params.env),
    npm_config_cache: params.paths.cacheDir,
    npm_config_replace_registry_host: 'never',
    npm_config_update_notifier: 'false',
    NPM_CONFIG_CACHE: params.paths.cacheDir,
    NPM_CONFIG_REPLACE_REGISTRY_HOST: 'never'
  }
  for (const key of params.omitKeys ?? []) delete env[key]
  return env
}

export const resolveUserShellBinaryPath = async (params: {
  binaryName: string
  childEnvPolicy?: ManagedNpmCliChildEnvPolicy
  cwd?: string
  env?: Record<string, string | null | undefined>
  omitKeys?: string[]
  timeoutMs?: number
}) => {
  const env = params.env ?? {}
  const policyMode = typeof params.childEnvPolicy === 'object'
    ? params.childEnvPolicy.mode
    : params.childEnvPolicy
  const inheritProcessEnv = policyMode !== 'provided-only' && policyMode !== 'minimal'
  const shellPath = normalizeNonEmptyString(env.SHELL) ??
    (inheritProcessEnv ? normalizeNonEmptyString(process.env.SHELL) : undefined) ??
    (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh')
  const shellEnv = buildManagedNpmCliChildEnv({
    cwd: params.cwd ?? process.cwd(),
    env,
    policy: params.childEnvPolicy
  })
  for (const key of params.omitKeys ?? []) delete shellEnv[key]
  try {
    if (process.platform === 'win32') {
      const result = await execFileAsync('where.exe', [params.binaryName], {
        env: shellEnv,
        timeout: params.timeoutMs ?? COMMAND_CHECK_TIMEOUT_MS
      })
      return String(result.stdout ?? '')
        .split(/\r?\n/u)
        .map(line => line.trim())
        .find(line => /^[A-Za-z]:[\\/]/u.test(line))
    }
    const result = await execFileAsync(
      shellPath,
      ['-lc', 'command -v "$1"', 'oneworks-resolve-binary', params.binaryName],
      {
        env: shellEnv,
        timeout: params.timeoutMs ?? COMMAND_CHECK_TIMEOUT_MS
      }
    )
    return String(result.stdout ?? '')
      .split(/\r?\n/u)
      .map(line => line.trim())
      .find(line => line.startsWith('/'))
  } catch {
    return undefined
  }
}

export const probeManagedNpmCliVersion = async (params: {
  binaryPath: string
  childEnvPolicy?: ManagedNpmCliChildEnvPolicy
  cwd: string
  env: Record<string, string | null | undefined>
  versionArgs?: string[]
}) => {
  const output = await canRunCommand(
    params.binaryPath,
    normalizeVersionArgs(params.versionArgs),
    buildManagedNpmCliChildEnv({
      cwd: params.cwd,
      env: params.env,
      policy: params.childEnvPolicy
    })
  )
  return extractSemver(output)
}

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
  commandCheckTimeoutMs?: number
  legacyPaths: ManagedNpmCliPaths
  logger: Pick<Logger, 'info'>
  minimumVersion?: string
  packageName: string
  paths: ManagedNpmCliPaths
  version: string
  versionRange?: string
  versionArgs?: string[]
  env: NodeJS.ProcessEnv
}) => {
  const targetBinaryUsable = existsSync(params.paths.binaryPath) &&
    await canRunBinary(
      params.paths.binaryPath,
      params.versionArgs,
      params.env,
      params.minimumVersion,
      params.versionRange,
      params.commandCheckTimeoutMs
    )
  if (
    !existsSync(params.legacyPaths.binaryPath) ||
    !hasExactInstalledPackageIdentity(
      params.binaryName,
      params.legacyPaths.installDir,
      params.packageName,
      params.version
    ) ||
    targetBinaryUsable ||
    !await canRunBinary(
      params.legacyPaths.binaryPath,
      params.versionArgs,
      params.env,
      params.minimumVersion,
      params.versionRange,
      params.commandCheckTimeoutMs
    )
  ) {
    return false
  }

  await withDirectoryInstallLock({
    lockDir: `${params.paths.installDir}.lock`
  }, async () => {
    const lockedTargetBinaryUsable = existsSync(params.paths.binaryPath) &&
      await canRunBinary(
        params.paths.binaryPath,
        params.versionArgs,
        params.env,
        params.minimumVersion,
        params.versionRange,
        params.commandCheckTimeoutMs
      )
    if (
      lockedTargetBinaryUsable ||
      !existsSync(params.legacyPaths.binaryPath) ||
      !hasExactInstalledPackageIdentity(
        params.binaryName,
        params.legacyPaths.installDir,
        params.packageName,
        params.version
      )
    ) {
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
    await canRunBinary(
      params.paths.binaryPath,
      params.versionArgs,
      params.env,
      params.minimumVersion,
      params.versionRange,
      params.commandCheckTimeoutMs
    )
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
  const legacyGlobalPaths = resolveLegacyGlobalManagedNpmCliPaths({
    adapterKey: params.adapterKey,
    binaryName: params.binaryName,
    cwd: params.cwd,
    env: params.env,
    installKey: params.installKey,
    packageName: installOptions.packageName,
    version: installOptions.version
  })
  const probeEnv = buildManagedNpmCliChildEnv({
    cwd: params.cwd,
    env: params.env,
    policy: params.childEnvPolicy
  })
  if (params.subprocessEnvAllowKeys != null) {
    for (const key of Object.keys(probeEnv)) {
      if (
        !params.subprocessEnvAllowKeys.some(allowed => (
          process.platform === 'win32' ? allowed.toLowerCase() === key.toLowerCase() : allowed === key
        ))
      ) delete probeEnv[key]
    }
  }
  for (const key of params.subprocessEnvOmitKeys ?? []) delete probeEnv[key]
  const managedProbeEnv = params.installHomeDir == null
    ? probeEnv
    : { ...probeEnv, HOME: params.installHomeDir, USERPROFILE: params.installHomeDir }
  const envPrefix = normalizeAdapterEnvPrefix(params.adapterKey)
  const explicitPath = normalizeNonEmptyString(params.env[`${envPrefix}_CLI_PATH__`]) ??
    normalizeNonEmptyString(params.configuredPath) ??
    normalizeNonEmptyString(params.config?.path)

  const binaryPath = toRealPath(paths.binaryPath)
  const legacyBinaryPaths = new Set([
    toRealPath(legacyGlobalPaths.binaryPath),
    toRealPath(legacyPaths.binaryPath)
  ])
  const hasVersionPolicy = params.minimumVersion?.trim() || params.versionRange?.trim()
  const systemBinaryPaths = Array.from(
    new Set(
      (params.systemBinaryPaths ?? []).map(normalizeNonEmptyString).filter((path): path is string => path != null)
    )
  )
  const canRunCli = async (candidatePath: string, env: NodeJS.ProcessEnv) => {
    if (params.validateBinary != null) return params.validateBinary(candidatePath, env)
    return canRunBinary(
      candidatePath,
      params.versionArgs,
      env,
      params.minimumVersion,
      params.versionRange,
      params.commandCheckTimeoutMs
    )
  }
  const resolveUsableSystemBinaryPath = async () => {
    for (const candidatePath of systemBinaryPaths) {
      if (await canRunCli(candidatePath, probeEnv)) return toRealPath(candidatePath)
    }
    return undefined
  }

  if (explicitPath != null && explicitPath !== binaryPath) {
    if (legacyBinaryPaths.has(explicitPath)) {
      // Continue through source policy and exact artifact identity checks before using a legacy cache.
    } else {
      if (
        params.validateExplicitPathVersion !== true ||
        hasVersionPolicy == null ||
        hasVersionPolicy === '' ||
        await canRunCli(explicitPath, probeEnv)
      ) {
        return explicitPath
      }
      throw new Error(
        `${params.binaryName} CLI at explicit path ${explicitPath} does not satisfy version requirement ${
          params.versionRange ?? `>=${params.minimumVersion}`
        }.`
      )
    }
  }

  if (
    params.preferSystem === true &&
    installOptions.source == null &&
    await canRunCli(params.binaryName, probeEnv)
  ) {
    return params.binaryName
  }

  if (params.preferSystem === true && installOptions.source == null) {
    const systemBinaryPath = await resolveUsableSystemBinaryPath()
    if (systemBinaryPath != null) return systemBinaryPath
  }

  if (
    installOptions.source === 'system' &&
    await canRunCli(params.binaryName, probeEnv)
  ) {
    return params.binaryName
  }

  if (installOptions.source === 'system') {
    const systemBinaryPath = await resolveUsableSystemBinaryPath()
    if (systemBinaryPath != null) return systemBinaryPath
  }

  if (
    existsSync(paths.binaryPath) &&
    await canRunCli(paths.binaryPath, managedProbeEnv)
  ) {
    return binaryPath
  }

  if (
    canUseProjectCli && params.migrateLegacyInstall !== false
  ) {
    for (const legacyCandidate of [legacyGlobalPaths, legacyPaths]) {
      if (
        await migrateLegacyManagedNpmCliInstall({
          binaryName: params.binaryName,
          commandCheckTimeoutMs: params.commandCheckTimeoutMs,
          env: managedProbeEnv,
          legacyPaths: legacyCandidate,
          logger: params.logger,
          minimumVersion: params.minimumVersion,
          packageName: installOptions.packageName,
          paths,
          version: installOptions.version,
          versionRange: params.versionRange,
          versionArgs: params.versionArgs
        })
      ) {
        return binaryPath
      }
    }
  }

  if (
    canUseProjectCli && params.bundledPath != null &&
    existsSync(params.bundledPath) &&
    !legacyBinaryPaths.has(toRealPath(params.bundledPath)) &&
    (hasVersionPolicy == null || hasVersionPolicy === '' || await canRunCli(params.bundledPath, managedProbeEnv))
  ) {
    return toRealPath(params.bundledPath)
  }

  if (canUseProjectCli && installOptions.autoInstall && await canRunNpm(installOptions.npmPath, probeEnv)) {
    await mkdir(paths.cacheDir, { recursive: true })
    if (params.installHomeDir != null) await mkdir(params.installHomeDir, { recursive: true })
    const installEnv = buildManagedNpmCliInstallEnv({
      allowKeys: params.subprocessEnvAllowKeys,
      childEnvPolicy: params.childEnvPolicy,
      cwd: params.cwd,
      env: params.env,
      omitKeys: params.subprocessEnvOmitKeys,
      homeDir: params.installHomeDir,
      paths
    })
    await withDirectoryInstallLock({
      lockDir: `${paths.installDir}.lock`
    }, async () => {
      if (await canRunCli(paths.binaryPath, installEnv)) {
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
            ...(params.ignoreInstallScripts === true ? ['--ignore-scripts'] : []),
            installOptions.packageSpec,
            ...(params.companionPackageSpecs ?? [])
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

    if (!await canRunCli(paths.binaryPath, installEnv)) {
      await withDirectoryInstallLock({ lockDir: `${paths.installDir}.lock` }, async () => {
        if (!await canRunCli(paths.binaryPath, installEnv)) {
          await rm(paths.installDir, { recursive: true, force: true })
        }
      })
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
    params.migrateLegacyInstall !== false
  ) {
    for (const legacyCandidate of [legacyGlobalPaths, legacyPaths]) {
      if (
        existsSync(legacyCandidate.binaryPath) &&
        hasExactInstalledPackageIdentity(
          params.binaryName,
          legacyCandidate.installDir,
          installOptions.packageName,
          installOptions.version
        ) &&
        await canRunCli(legacyCandidate.binaryPath, managedProbeEnv)
      ) return toRealPath(legacyCandidate.binaryPath)
    }
  }

  if (
    canUseSystemCli &&
    await canRunCli(params.binaryName, probeEnv)
  ) {
    return params.binaryName
  }

  if (canUseSystemCli) {
    const systemBinaryPath = await resolveUsableSystemBinaryPath()
    if (systemBinaryPath != null) return systemBinaryPath
  }

  if (installOptions.source === 'system') {
    throw new Error(
      hasVersionPolicy == null || hasVersionPolicy === ''
        ? `${params.binaryName} CLI was not found on PATH.`
        : `${params.binaryName} CLI was not found on PATH or does not satisfy version requirement ${
          params.versionRange ?? `>=${params.minimumVersion}`
        }.`
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
