import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

import { resolveBootstrapPackageCacheRootDir } from '@oneworks/types'
import type { AdapterCtx } from '@oneworks/types'

export const CURSOR_INSTALL_URL = 'https://cursor.com/install'

const toRealPath = (targetPath: string) => {
  try {
    return realpathSync(targetPath)
  } catch {
    return targetPath
  }
}

export const resolveCursorManagedRootDir = (env: AdapterCtx['env']) => (
  resolve(resolveBootstrapPackageCacheRootDir(env), 'cursor-agent')
)

export const assertCursorInstallVersion = (version: string) => {
  if (
    version === '.' ||
    version === '..' ||
    isAbsolute(version) ||
    version.includes('/') ||
    version.includes('\\') ||
    !/^\w[\w.-]*$/u.test(version)
  ) {
    throw new Error(`Invalid Cursor CLI version: ${version}`)
  }
  return version
}

export const resolveCursorManagedVersionDir = (env: AdapterCtx['env'], version: string) => {
  const versionsDir = resolve(resolveCursorManagedRootDir(env), 'versions')
  const versionDir = resolve(versionsDir, assertCursorInstallVersion(version))
  const relativePath = relative(versionsDir, versionDir)
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Cursor CLI version escaped the managed cache: ${version}`)
  }
  return versionDir
}

export const resolveCursorManagedBinaryPath = (
  env: AdapterCtx['env'],
  version: string
) => {
  const candidate = resolve(resolveCursorManagedVersionDir(env, version), 'cursor-agent')
  return existsSync(candidate) ? toRealPath(candidate) : undefined
}

export const resolveCursorBinaryPath = (
  env: AdapterCtx['env'],
  configuredPath?: string
) => {
  const envPath = env.__ONEWORKS_PROJECT_ADAPTER_CURSOR_CLI_PATH__?.trim()
  if (envPath) return envPath
  if (configuredPath?.trim()) return configuredPath.trim()
  return 'agent'
}
