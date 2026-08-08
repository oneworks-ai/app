import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import type { AdapterCtx } from '@oneworks/types'
import type { ManagedNpmCliConfig } from '@oneworks/utils/managed-npm-cli'
import { resolveManagedNpmCliBinaryPath } from '@oneworks/utils/managed-npm-cli'

const require = createRequire(import.meta.url ?? __filename)
const adapterPackageDir = dirname(require.resolve('@oneworks/adapter-pi/package.json'))
const bundledPath = resolve(adapterPackageDir, 'node_modules/.bin/pi')

export const PI_CLI_PACKAGE = '@earendil-works/pi-coding-agent'
export const PI_CLI_VERSION = '0.84.1'
export const PI_CLI_VERSION_RANGE = '>=0.84.1 <0.85.0'
export const PI_MINIMUM_NODE_VERSION = '22.19.0'

export const isPiNodeVersionSupported = (version: string) => {
  const match = version.trim().replace(/^v/u, '').match(/^(\d+)\.(\d+)\.(\d+)/u)
  if (match == null) return false
  const [, rawMajor, rawMinor] = match
  const major = Number(rawMajor)
  const minor = Number(rawMinor)
  return major > 22 || (major === 22 && minor >= 19)
}

export const assertPiNodeVersion = (version = process.versions.node) => {
  if (isPiNodeVersionSupported(version)) return
  throw new Error(
    `Pi ${PI_CLI_VERSION} requires Node.js >=${PI_MINIMUM_NODE_VERSION}; current runtime is ${version}.`
  )
}

const toRealPath = (targetPath: string) => {
  try {
    return realpathSync(targetPath)
  } catch {
    return targetPath
  }
}

export const resolvePiBinaryPath = (
  env: AdapterCtx['env'],
  cwd?: string,
  config?: ManagedNpmCliConfig
) => {
  const envPath = env.__ONEWORKS_PROJECT_ADAPTER_PI_CLI_PATH__
  if (typeof envPath === 'string' && envPath.trim() !== '') return envPath

  return resolveManagedNpmCliBinaryPath({
    adapterKey: 'pi',
    binaryName: 'pi',
    bundledPath: existsSync(bundledPath) ? toRealPath(bundledPath) : undefined,
    config,
    cwd,
    defaultPackageName: PI_CLI_PACKAGE,
    defaultVersion: PI_CLI_VERSION,
    env
  })
}
