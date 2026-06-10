import { existsSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

import { resolveBootstrapPackageCacheRootDir } from '@oneworks/types'
import type { AdapterCtx } from '@oneworks/types'
import { resolveProjectSharedCachePath } from '@oneworks/utils/project-cache-path'

export const DEFAULT_KIMI_INSTALL_PACKAGE = 'kimi-cli'
export const DEFAULT_KIMI_INSTALL_VERSION = '1.36.0'
export const DEFAULT_KIMI_INSTALL_PYTHON = '3.13'

const KIMI_BINARY_NAMES = process.platform === 'win32'
  ? ['kimi.exe', 'kimi.cmd', 'kimi']
  : ['kimi']

interface KimiManagedToolPathOptions {
  packageName?: string
  python?: string
}

const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const toRealPath = (targetPath: string) => {
  try {
    return realpathSync(targetPath)
  } catch {
    return targetPath
  }
}

const resolveKimiBootstrapUvRootDir = (env: AdapterCtx['env']) => (
  resolve(resolveBootstrapPackageCacheRootDir(env), 'uv')
)

const hasUvVersionSpec = (packageName: string) => /[<>=!~@]/u.test(packageName)

const toUvPackageSpec = (packageName: string, version?: string) => (
  version != null && !hasUvVersionSpec(packageName) ? `${packageName}==${version}` : packageName
)

const toPathSegment = (value: string) => (
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'kimi'
)

const resolveKimiManagedPackageSpec = (
  env: AdapterCtx['env'],
  options: KimiManagedToolPathOptions
) => {
  const packageName = normalizeNonEmptyString(options.packageName) ??
    normalizeNonEmptyString(env.__ONEWORKS_PROJECT_ADAPTER_KIMI_INSTALL_PACKAGE__) ??
    DEFAULT_KIMI_INSTALL_PACKAGE
  const version = normalizeNonEmptyString(env.__ONEWORKS_PROJECT_ADAPTER_KIMI_INSTALL_VERSION__) ??
    DEFAULT_KIMI_INSTALL_VERSION
  return toUvPackageSpec(packageName, version)
}

const resolveKimiManagedPython = (
  env: AdapterCtx['env'],
  options: KimiManagedToolPathOptions
) => (
  normalizeNonEmptyString(options.python) ??
    normalizeNonEmptyString(env.__ONEWORKS_PROJECT_ADAPTER_KIMI_INSTALL_PYTHON__) ??
    DEFAULT_KIMI_INSTALL_PYTHON
)

const buildKimiToolPaths = (rootDir: string) => {
  const binDir = resolve(rootDir, 'bin')
  return {
    rootDir,
    toolDir: resolve(rootDir, 'tools'),
    binDir,
    cacheDir: resolve(rootDir, 'uv-cache'),
    pythonDir: resolve(rootDir, 'python'),
    pythonBinDir: resolve(rootDir, 'python-bin'),
    binaryCandidates: KIMI_BINARY_NAMES.map(fileName => resolve(binDir, fileName))
  }
}

export const resolveKimiManagedToolPaths = (
  cwd: string,
  env: AdapterCtx['env'] = process.env,
  options: KimiManagedToolPathOptions = {}
) => {
  const packageSpec = resolveKimiManagedPackageSpec(env, options)
  const python = resolveKimiManagedPython(env, options)
  return buildKimiToolPaths(resolve(
    resolveKimiBootstrapUvRootDir(env),
    toPathSegment(packageSpec),
    toPathSegment(`python-${python}`)
  ))
}

export const resolveKimiLegacyManagedToolPaths = (
  cwd: string,
  env: AdapterCtx['env'] = process.env
) => {
  return buildKimiToolPaths(resolveProjectSharedCachePath(cwd, env, 'adapter-kimi', 'cli'))
}

export const resolveKimiManagedBinaryPath = (
  cwd?: string,
  env: AdapterCtx['env'] = process.env,
  options: KimiManagedToolPathOptions = {}
) => {
  if (cwd == null || cwd.trim() === '') return undefined
  return [
    ...resolveKimiManagedToolPaths(cwd, env, options).binaryCandidates,
    ...resolveKimiLegacyManagedToolPaths(cwd, env).binaryCandidates
  ].find(candidate => existsSync(candidate))
}

export const resolveKimiBinaryPath = (env: AdapterCtx['env'], cwd?: string) => {
  const envPath = env.__ONEWORKS_PROJECT_ADAPTER_KIMI_CLI_PATH__
  if (typeof envPath === 'string' && envPath.trim() !== '') {
    return envPath
  }

  const managedPath = resolveKimiManagedBinaryPath(cwd, env)
  if (managedPath != null) {
    return toRealPath(managedPath)
  }

  return 'kimi'
}
