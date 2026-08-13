import { Buffer } from 'node:buffer'
import { closeSync, existsSync, openSync, readSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

import type { AdapterCtx } from '@oneworks/types'
import { resolvePackageCacheHomeDir } from '@oneworks/types'
import { resolveManagedNpmCliBinaryPath, resolveManagedNpmCliRootDir } from '@oneworks/utils/managed-npm-cli'

const require = createRequire(import.meta.url ?? __filename)
const adapterPackageDir = dirname(require.resolve('@oneworks/adapter-junie/package.json'))
const bundledPath = resolve(adapterPackageDir, 'node_modules/.bin/junie')

export const JUNIE_CLI_PACKAGE = '@jetbrains/junie'
export const JUNIE_CLI_VERSION = '2651.4.0'
export const JUNIE_CLI_VERSION_RANGE = '>=26.8.10 <26.9.0'

const toRealPath = (targetPath: string) => {
  try {
    return realpathSync(targetPath)
  } catch {
    return targetPath
  }
}

export const resolveJunieManagedHomeDir = (env: AdapterCtx['env']) => (
  resolve(resolveManagedNpmCliRootDir(env), 'junie-runtime-home')
)

export const resolveJunieManagedDataDir = (env: AdapterCtx['env']) => (
  resolve(resolveJunieManagedHomeDir(env), '.local', 'share', 'junie')
)

export const resolveJunieUserDataDir = (env: AdapterCtx['env']) => (
  typeof env.JUNIE_DATA === 'string' && env.JUNIE_DATA.trim() !== ''
    ? resolve(env.JUNIE_DATA.trim())
    : resolve(resolvePackageCacheHomeDir(env), '.local', 'share', 'junie')
)

export const resolveJunieInstalledBinary = (dataDir: string) => {
  const currentDir = resolve(dataDir, 'current')
  const candidates = [
    resolve(currentDir, 'Applications', 'junie.app', 'Contents', 'MacOS', 'junie'),
    resolve(currentDir, 'junie', 'bin', 'junie'),
    resolve(currentDir, 'junie', 'bin', 'junie.exe'),
    resolve(currentDir, 'junie'),
    resolve(currentDir, 'junie.exe')
  ]
  const candidate = candidates.find(existsSync)
  return candidate == null ? undefined : toRealPath(candidate)
}

export const isJunieLauncher = (binaryPath: string) => {
  let descriptor: number | undefined
  try {
    descriptor = openSync(binaryPath, 'r')
    const buffer = Buffer.alloc(16_384)
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0)
    const prefix = buffer.subarray(0, bytesRead).toString('utf8')
    return prefix.includes('JUNIE_MANAGED_SHIM') ||
      (prefix.includes('getExecutable') && prefix.includes('Junie'))
  } catch {
    return false
  } finally {
    if (descriptor != null) closeSync(descriptor)
  }
}

export const resolveJunieBinaryPath = (env: AdapterCtx['env'], cwd?: string) => {
  const envPath = env.__ONEWORKS_PROJECT_ADAPTER_JUNIE_CLI_PATH__
  if (typeof envPath === 'string' && envPath.trim() !== '') return envPath.trim()
  return resolveManagedNpmCliBinaryPath({
    adapterKey: 'junie',
    binaryName: 'junie',
    bundledPath: existsSync(bundledPath) ? toRealPath(bundledPath) : undefined,
    cwd,
    defaultPackageName: JUNIE_CLI_PACKAGE,
    defaultVersion: JUNIE_CLI_VERSION,
    env
  })
}
