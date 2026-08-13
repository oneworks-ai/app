import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

import type { AdapterCtx } from '@oneworks/types'
import type { ManagedNpmCliConfig } from '@oneworks/utils/managed-npm-cli'
import { resolveManagedNpmCliBinaryPath } from '@oneworks/utils/managed-npm-cli'

const require = createRequire(import.meta.url ?? __filename)
const adapterPackageDir = dirname(require.resolve('@oneworks/adapter-cline/package.json'))
const bundledPath = resolve(adapterPackageDir, 'node_modules/.bin/cline')

export const CLINE_CLI_PACKAGE = 'cline'
export const CLINE_CLI_VERSION = '3.0.54'
export const CLINE_ACP_PROTOCOL_VERSION = 1

const toRealPath = (targetPath: string) => {
  try {
    return realpathSync(targetPath)
  } catch {
    return targetPath
  }
}

export const isClineNativeResumeVersion = (version: string | undefined) => version === CLINE_CLI_VERSION

export const resolveClineCliSource = (
  env: AdapterCtx['env'],
  config?: ManagedNpmCliConfig
): 'managed' | 'path' | 'system' => {
  if (env.__ONEWORKS_PROJECT_ADAPTER_CLINE_CLI_PATH__?.trim() || config?.path?.trim()) return 'path'
  const source = env.__ONEWORKS_PROJECT_ADAPTER_CLINE_CLI_SOURCE__?.trim() ?? config?.source
  return source === 'path' || source === 'system' ? source : 'managed'
}

export const resolveClineBinaryPath = (
  env: AdapterCtx['env'],
  cwd?: string,
  config?: ManagedNpmCliConfig
) => {
  const envPath = env.__ONEWORKS_PROJECT_ADAPTER_CLINE_CLI_PATH__?.trim()
  if (envPath) return envPath
  const source = resolveClineCliSource(env, config)
  const effectiveConfig = source === 'managed'
    ? { ...config, source, version: CLINE_CLI_VERSION }
    : config
  const effectiveEnv = source === 'managed'
    ? { ...env, __ONEWORKS_PROJECT_ADAPTER_CLINE_INSTALL_VERSION__: CLINE_CLI_VERSION }
    : env
  return resolveManagedNpmCliBinaryPath({
    adapterKey: 'cline',
    binaryName: 'cline',
    bundledPath: existsSync(bundledPath) ? toRealPath(bundledPath) : undefined,
    config: effectiveConfig,
    cwd,
    defaultPackageName: CLINE_CLI_PACKAGE,
    defaultVersion: CLINE_CLI_VERSION,
    env: effectiveEnv
  })
}
