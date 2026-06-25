import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import {
  readPublishedPackageVersionMetadata,
  resolvePackageLookupTimeoutMs,
  resolvePackageManagerEnv,
  shouldUseCachedPackageVersionFirst,
  writePublishedPackageVersionMetadata
} from './npm-package-cache'
import { findInstalledPublishedPackageVersion } from './npm-package-install'
import { resolvePublishedPackageVersionFromRegistry } from './npm-registry'
import { resolvePackageVersionRequest } from './package-version-request'

export { resolvePackageManagerEnv } from './npm-package-cache'
export { installPublishedPackage, resolvePackageBinEntrypoint } from './npm-package-install'

const resolveRefreshWorkerEntrypoint = () => {
  const requireFromHere = createRequire(import.meta.url)
  const packageJsonPath = requireFromHere.resolve('oneworks/package.json')
  return path.join(path.dirname(packageJsonPath), 'package-version-refresh-worker.cjs')
}

const spawnPackageVersionRefresh = (packageName: string) => {
  if (process.env.ONEWORKS_BOOTSTRAP_DISABLE_BACKGROUND_REFRESH === '1') {
    return
  }

  try {
    const payload = Buffer.from(JSON.stringify({ packageName }), 'utf8').toString('base64url')
    const child = spawn(
      process.execPath,
      [
        resolveRefreshWorkerEntrypoint(),
        payload
      ],
      {
        cwd: process.cwd(),
        detached: true,
        env: resolvePackageManagerEnv(),
        stdio: 'ignore'
      }
    )
    child.unref()
  } catch {
    // Keep bootstrap startup independent from background metadata refresh.
  }
}

export const resolvePublishedPackageVersion = async (
  packageName: string,
  options: { cacheFirst?: boolean } = {}
) => {
  const request = resolvePackageVersionRequest(packageName)
  const cachedMetadata = await readPublishedPackageVersionMetadata(packageName, { lookupScope: request.lookupScope })
  if (cachedMetadata != null && (options.cacheFirst ?? shouldUseCachedPackageVersionFirst())) {
    spawnPackageVersionRefresh(packageName)
    return cachedMetadata.version
  }

  const cachedInstalledVersion = await findInstalledPublishedPackageVersion(packageName, {
    preferredVersion: request.exactVersion,
    versionFilter: request.versionFilter
  })
  if (cachedInstalledVersion != null && (options.cacheFirst ?? shouldUseCachedPackageVersionFirst())) {
    spawnPackageVersionRefresh(packageName)
    return cachedInstalledVersion
  }

  const registryResult = await resolvePublishedPackageVersionFromRegistry(
    packageName,
    request,
    cachedMetadata == null
      ? {}
      : {
        timeoutMs: resolvePackageLookupTimeoutMs()
      }
  )

  if ('version' in registryResult) {
    await writePublishedPackageVersionMetadata(packageName, registryResult.version, {
      lookupScope: request.lookupScope
    })
    return registryResult.version
  }

  if (cachedMetadata == null) {
    // This is not expected because uncached lookups do not use a timeout.
    const retryResult = await resolvePublishedPackageVersionFromRegistry(packageName, request)
    if ('version' in retryResult) {
      await writePublishedPackageVersionMetadata(packageName, retryResult.version, { lookupScope: request.lookupScope })
      return retryResult.version
    }
    throw new Error(`Failed to resolve published version for ${retryResult.spec}.`)
  }

  console.error(
    `[bootstrap] npm view ${registryResult.spec} timed out after ${resolvePackageLookupTimeoutMs()}ms, using cached ${packageName}@${cachedMetadata.version}`
  )
  spawnPackageVersionRefresh(packageName)
  return cachedMetadata.version
}
