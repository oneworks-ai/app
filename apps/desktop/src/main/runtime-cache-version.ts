import process from 'node:process'

import { readDesktopBuildRuntimePackageCacheVersion } from './build-source'

const runtimePackageCacheVersionPattern = /^[\w.+-]+$/u

const normalizeRuntimePackageCacheVersion = (value: string | null | undefined) => {
  const normalized = value?.trim()
  if (normalized == null || normalized === '') return undefined
  return runtimePackageCacheVersionPattern.test(normalized) && normalized !== '.' && normalized !== '..'
    ? normalized
    : undefined
}

export const resolveDesktopRuntimePackageCacheVersion = (
  env: NodeJS.ProcessEnv = process.env
) => (
  normalizeRuntimePackageCacheVersion(env.__ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__) ??
    normalizeRuntimePackageCacheVersion(env.ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION) ??
    normalizeRuntimePackageCacheVersion(env.__ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__) ??
    normalizeRuntimePackageCacheVersion(env.ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION) ??
    readDesktopBuildRuntimePackageCacheVersion()
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
