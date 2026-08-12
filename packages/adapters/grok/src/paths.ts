import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import type { AdapterCtx } from '@oneworks/types'
import { resolveManagedNpmCliBinaryPath } from '@oneworks/utils/managed-npm-cli'
import { resolveProjectOoPath } from '@oneworks/utils'

const require = createRequire(import.meta.url ?? __filename)
const adapterPackageDir = dirname(require.resolve('@oneworks/adapter-grok/package.json'))
const bundledPath = resolve(adapterPackageDir, 'node_modules/.bin/grok')

export const GROK_CLI_PACKAGE = '@xai-official/grok'
export const GROK_CLI_VERSION = '1.0.3'

const toRealPath = (targetPath: string) => {
  try {
    return realpathSync(targetPath)
  } catch {
    return targetPath
  }
}

export const resolveGrokManagedRuntimeHome = (
  cwd: string,
  env: AdapterCtx['env']
) => resolveProjectOoPath(cwd, env, 'caches', 'adapter-grok', 'runtime-home')

export const resolveGrokDownloadedBinaryPath = (grokHome: string) => resolve(
  grokHome,
  'bin',
  process.platform === 'win32' ? 'grok.exe' : 'grok'
)

export const resolveGrokBinaryPath = (
  env: AdapterCtx['env'],
  cwd?: string
) => {
  const envPath = env.__ONEWORKS_PROJECT_ADAPTER_GROK_CLI_PATH__
  if (typeof envPath === 'string' && envPath.trim() !== '') return envPath

  return resolveManagedNpmCliBinaryPath({
    adapterKey: 'grok',
    binaryName: 'grok',
    bundledPath: existsSync(bundledPath) ? toRealPath(bundledPath) : undefined,
    cwd,
    defaultPackageName: GROK_CLI_PACKAGE,
    defaultVersion: GROK_CLI_VERSION,
    env
  })
}

export const resolveGrokRuntimeBinaryPath = (params: {
  configuredBinaryPath: string
  managedRuntimeHome: string
  source?: 'managed' | 'system' | 'path'
}) => {
  const downloadedPath = resolveGrokDownloadedBinaryPath(params.managedRuntimeHome)
  return params.source !== 'system' && params.source !== 'path' && existsSync(downloadedPath)
    ? toRealPath(downloadedPath)
    : params.configuredBinaryPath
}
