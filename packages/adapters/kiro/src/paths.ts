import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import process from 'node:process'

import type { AdapterCtx } from '@oneworks/types'
import { resolveBootstrapPackageCacheRootDir } from '@oneworks/types'

export const KIRO_MANIFEST_URL = 'https://prod.download.cli.kiro.dev/stable/latest/manifest.json'
export const KIRO_DOWNLOAD_ROOT = 'https://prod.download.cli.kiro.dev/stable'

export const assertKiroInstallVersion = (version: string) => {
  if (
    version === '.' ||
    version === '..' ||
    isAbsolute(version) ||
    version.includes('/') ||
    version.includes('\\') ||
    !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(version)
  ) {
    throw new Error(`Invalid Kiro CLI version: ${version}`)
  }
  return version
}

export const resolveKiroManagedRootDir = (env: AdapterCtx['env']) => (
  resolve(resolveBootstrapPackageCacheRootDir(env), 'kiro-cli')
)

export const resolveKiroManagedVersionDir = (env: AdapterCtx['env'], version: string) => {
  const versionsDir = resolve(resolveKiroManagedRootDir(env), 'versions')
  const versionDir = resolve(versionsDir, assertKiroInstallVersion(version))
  const relativePath = relative(versionsDir, versionDir)
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Kiro CLI version escaped the managed cache: ${version}`)
  }
  return versionDir
}

export const resolveKiroManagedBinaryPath = (env: AdapterCtx['env'], version: string) => {
  const managedRoot = resolveKiroManagedRootDir(env)
  const versionsDir = resolve(managedRoot, 'versions')
  const versionDir = resolveKiroManagedVersionDir(env, version)
  const executable = process.platform === 'win32' ? 'kiro-cli.exe' : 'kiro-cli'
  const candidate = resolve(versionDir, executable)
  const requiredDirectories = [managedRoot, versionsDir, versionDir]
  for (const directory of requiredDirectories) {
    let info: ReturnType<typeof lstatSync>
    try {
      info = lstatSync(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`Unsafe Kiro managed directory: ${directory}`)
    }
  }
  let candidateInfo: ReturnType<typeof lstatSync>
  try {
    candidateInfo = lstatSync(candidate)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (!candidateInfo.isSymbolicLink() && !candidateInfo.isFile()) {
    throw new Error(`Unsafe Kiro managed executable: ${candidate}`)
  }
  let realManagedRoot: string
  let realVersionDir: string
  let realPath: string
  try {
    realManagedRoot = realpathSync(managedRoot)
    realVersionDir = realpathSync(versionDir)
    realPath = realpathSync(candidate)
  } catch {
    return undefined
  }
  const versionRelation = relative(realManagedRoot, realVersionDir)
  if (versionRelation === '' || versionRelation.startsWith('..') || isAbsolute(versionRelation)) {
    throw new Error(`Kiro CLI version directory escaped the managed root: ${versionDir}`)
  }
  const relativePath = relative(realVersionDir, realPath)
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Kiro CLI executable escaped its managed version directory: ${candidate}`)
  }
  if (!lstatSync(realPath).isFile()) {
    throw new Error(`Unsafe Kiro managed executable target: ${realPath}`)
  }
  return realPath
}

export const resolveKiroBinaryPath = (env: AdapterCtx['env'], configuredPath?: string) => (
  env.__ONEWORKS_PROJECT_ADAPTER_KIRO_CLI_PATH__?.trim() || configuredPath?.trim() || 'kiro-cli'
)
