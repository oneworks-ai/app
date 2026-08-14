import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

import type { AdapterCtx } from '@oneworks/types'
import { resolveProjectOoPath } from '@oneworks/utils'
import type { ManagedNpmCliConfig } from '@oneworks/utils/managed-npm-cli'
import { resolveManagedNpmCliBinaryPath, resolveManagedNpmCliInstallOptions } from '@oneworks/utils/managed-npm-cli'

const require = createRequire(import.meta.url ?? __filename)
const adapterPackageDir = dirname(require.resolve('@oneworks/adapter-droid/package.json'))
const bundledPath = resolve(adapterPackageDir, 'node_modules/.bin/droid')

export const DROID_CLI_PACKAGE = '@factory/cli'
export const DROID_CLI_VERSION = '0.195.0'
export const DROID_CLI_VERSION_RANGE = '>=0.195.0 <0.196.0'
export const DROID_CLI_VERSION_ENV = '__ONEWORKS_PROJECT_ADAPTER_DROID_CLI_VERSION__'

const toRealPath = (targetPath: string) => {
  try {
    return realpathSync(targetPath)
  } catch {
    return targetPath
  }
}

export const resolveDroidBundledBinaryPath = (
  env: AdapterCtx['env'],
  config?: ManagedNpmCliConfig
) => {
  const effective = resolveManagedNpmCliInstallOptions({
    adapterKey: 'droid',
    config,
    defaultPackageName: DROID_CLI_PACKAGE,
    defaultVersion: DROID_CLI_VERSION,
    env
  })
  if (effective.packageName !== DROID_CLI_PACKAGE || effective.version !== DROID_CLI_VERSION) return undefined
  return existsSync(bundledPath) ? toRealPath(bundledPath) : undefined
}

export const resolveDroidBinaryPath = (
  env: AdapterCtx['env'],
  cwd?: string,
  config?: ManagedNpmCliConfig
) => {
  const explicit = env.__ONEWORKS_PROJECT_ADAPTER_DROID_CLI_PATH__
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit

  return resolveManagedNpmCliBinaryPath({
    adapterKey: 'droid',
    binaryName: 'droid',
    bundledPath: resolveDroidBundledBinaryPath(env, config),
    config,
    cwd,
    defaultPackageName: DROID_CLI_PACKAGE,
    defaultVersion: DROID_CLI_VERSION,
    env
  })
}

export const resolveDroidManagedRuntimeHome = (cwd: string, env: AdapterCtx['env']) =>
  resolveProjectOoPath(cwd, env, 'caches', 'adapter-droid', 'runtime-home')
