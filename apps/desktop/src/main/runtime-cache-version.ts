import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { app } from 'electron'

import { readDesktopBuildRuntimePackageCacheVersion } from './build-source'

const runtimePackageCacheVersionPattern = /^[\w.+-]+$/u

const normalizeRuntimePackageCacheVersion = (value: string | null | undefined) => {
  const normalized = value?.trim()
  if (normalized == null || normalized === '') return undefined
  return runtimePackageCacheVersionPattern.test(normalized) && normalized !== '.' && normalized !== '..'
    ? normalized
    : undefined
}

const readPackagedAppRuntimePackageCacheVersion = () => {
  if (!app.isPackaged) return undefined

  try {
    const packageJsonPath = path.join(app.getAppPath(), 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: unknown }
    return typeof packageJson.version === 'string'
      ? normalizeRuntimePackageCacheVersion(packageJson.version)
      : undefined
  } catch (error) {
    console.warn('[oneworks-desktop] failed to read packaged app runtime cache version', error)
    return undefined
  }
}

export const resolveDesktopRuntimePackageCacheVersion = (
  env: NodeJS.ProcessEnv = process.env
) => (
  normalizeRuntimePackageCacheVersion(env.__ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__) ??
    normalizeRuntimePackageCacheVersion(env.ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION) ??
    normalizeRuntimePackageCacheVersion(env.__ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__) ??
    normalizeRuntimePackageCacheVersion(env.ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION) ??
    readDesktopBuildRuntimePackageCacheVersion() ??
    readPackagedAppRuntimePackageCacheVersion()
)

export const resolveDesktopRuntimePackageCacheVersionEnv = (
  env: NodeJS.ProcessEnv = process.env
):
  | Pick<
    NodeJS.ProcessEnv,
    '__ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__' | '__ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__'
  >
  | {} =>
{
  const runtimePackageCacheVersion = resolveDesktopRuntimePackageCacheVersion(env)
  return runtimePackageCacheVersion == null
    ? {}
    : {
      __ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__: runtimePackageCacheVersion,
      __ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__: runtimePackageCacheVersion
    }
}
