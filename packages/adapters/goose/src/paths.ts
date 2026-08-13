import { isAbsolute, relative, resolve } from 'node:path'
import process from 'node:process'

import { resolveBootstrapPackageCacheRootDir } from '@oneworks/types'
import type { AdapterCtx } from '@oneworks/types'

import type { GooseCliConfig } from './config-schema'

export const GOOSE_CLI_VERSION = '1.46.0'
export const GOOSE_MINIMUM_ACP_VERSION = '1.46.0'
export const GOOSE_RELEASE_REPOSITORY = 'aaif-goose/goose'

export interface GooseReleaseTarget {
  archiveType: 'tar' | 'zip'
  assetName: string
  binaryName: 'goose' | 'goose.exe'
  installKey: string
}

export const normalizeGooseReleaseVersion = (value: string) => {
  const version = value.trim()
  if (!/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u.test(version)) {
    throw new Error(`Invalid Goose CLI version: ${value}`)
  }
  const normalized = version.replace(/^v/u, '')
  if (normalized === '.' || normalized === '..' || normalized.includes('/') || normalized.includes('\\')) {
    throw new Error(`Invalid Goose CLI version: ${value}`)
  }
  return normalized
}

export const resolveGooseReleaseTarget = (params: {
  arch?: NodeJS.Architecture
  platform?: NodeJS.Platform
  variant?: GooseCliConfig['variant']
} = {}): GooseReleaseTarget => {
  const arch = params.arch ?? process.arch
  const platform = params.platform ?? process.platform
  const releaseArch = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : undefined
  if (releaseArch == null) {
    throw new Error(`Managed Goose CLI installation is unsupported on ${platform}/${arch}.`)
  }

  if (platform === 'darwin') {
    if (params.variant != null && params.variant !== 'standard') {
      throw new Error(`Goose release variant ${params.variant} is unsupported on darwin.`)
    }
    return {
      archiveType: 'tar',
      assetName: `goose-${releaseArch}-apple-darwin.tar.bz2`,
      binaryName: 'goose',
      installKey: `darwin-${releaseArch}-standard`
    }
  }

  if (platform === 'linux') {
    const variant = params.variant ?? 'standard'
    if (variant !== 'standard' && variant !== 'musl' && variant !== 'vulkan') {
      throw new Error(`Goose release variant ${variant} is unsupported on linux.`)
    }
    const suffix = variant === 'musl' ? 'musl' : variant === 'vulkan' ? 'gnu-vulkan' : 'gnu'
    return {
      archiveType: 'tar',
      assetName: `goose-${releaseArch}-unknown-linux-${suffix}.tar.bz2`,
      binaryName: 'goose',
      installKey: `linux-${releaseArch}-${variant}`
    }
  }

  if (platform === 'win32' && releaseArch === 'x86_64') {
    const variant = params.variant ?? 'standard'
    if (variant !== 'standard' && variant !== 'cuda') {
      throw new Error(`Goose release variant ${variant} is unsupported on win32.`)
    }
    return {
      archiveType: 'zip',
      assetName: `goose-x86_64-pc-windows-msvc${variant === 'cuda' ? '-cuda' : ''}.zip`,
      binaryName: 'goose.exe',
      installKey: `win32-x86_64-${variant}`
    }
  }

  throw new Error(`Managed Goose CLI installation is unsupported on ${platform}/${arch}.`)
}

export const resolveGooseManagedRootDir = (env: AdapterCtx['env']) => (
  resolve(resolveBootstrapPackageCacheRootDir(env), 'native', 'goose')
)

const assertContainedChild = (parentPath: string, childPath: string, label: string) => {
  const relativePath = relative(parentPath, childPath)
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`${label} escaped the Goose managed cache.`)
  }
  return childPath
}

export const resolveGooseManagedVersionDir = (params: {
  env: AdapterCtx['env']
  target: GooseReleaseTarget
  version: string
}) => {
  const versionsDir = resolve(resolveGooseManagedRootDir(params.env), 'versions')
  const version = normalizeGooseReleaseVersion(params.version)
  const versionDir = assertContainedChild(versionsDir, resolve(versionsDir, version), 'Goose CLI version')
  return assertContainedChild(versionDir, resolve(versionDir, params.target.installKey), 'Goose release target')
}

export const resolveGooseManagedBinaryPath = (params: {
  env: AdapterCtx['env']
  target?: GooseReleaseTarget
  version: string
}) => {
  const target = params.target ?? resolveGooseReleaseTarget()
  return resolve(resolveGooseManagedVersionDir({ ...params, target }), target.binaryName)
}
