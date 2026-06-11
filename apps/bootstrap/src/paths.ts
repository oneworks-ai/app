import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

export const resolveRealHomeDir = () => {
  const realHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__?.trim()
  if (realHome) {
    return realHome
  }

  return os.homedir()
}

export const resolveBootstrapDataDir = () => path.join(resolveRealHomeDir(), '.oneworks', 'bootstrap')

export const resolveBootstrapPackageCacheDir = () => {
  const packageCacheDir = process.env.__ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__?.trim()
  return packageCacheDir || resolveBootstrapDataDir()
}
