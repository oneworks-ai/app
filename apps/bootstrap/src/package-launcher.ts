import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { readCliAdapterPackageRequest, resolveCliAdapterPackageDir } from './adapter-package-cache'
import { installPublishedPackage, resolvePackageBinEntrypoint, resolvePublishedPackageVersion } from './npm-package'
import { resolvePackageCacheDir, resolvePackageInstallDir, sanitizePackageName } from './npm-package-cache'
import { resolveBootstrapDataDir } from './paths'
import { runNodeEntrypoint } from './process-utils'

export interface LaunchInstalledPackageOptions {
  commandName?: string
  forwardedArgs: string[]
  packageName: string
}

const normalizeRuntimePackageDir = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed == null || trimmed === '' ? undefined : path.resolve(trimmed)
}

export const shouldResolveCliAdapterPackage = () => {
  const cliPackageDir = normalizeRuntimePackageDir(process.env.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__)
  const packageDir = normalizeRuntimePackageDir(process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__)
  return cliPackageDir == null || cliPackageDir === packageDir
}

const readActivePackageVersion = (packageName: string) => {
  try {
    const metadataPath = path.join(
      resolveBootstrapDataDir(),
      'module-updates',
      `${sanitizePackageName(packageName)}.json`
    )
    const parsed = JSON.parse(readFileSync(metadataPath, 'utf8')) as {
      packageName?: unknown
      version?: unknown
    }
    if (parsed.packageName !== packageName || typeof parsed.version !== 'string') {
      return undefined
    }

    const packageDir = resolvePackageInstallDir(resolvePackageCacheDir(packageName, parsed.version), packageName)
    const packageJson = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
      name?: unknown
      version?: unknown
    }
    return packageJson.name === packageName && packageJson.version === parsed.version
      ? parsed.version
      : undefined
  } catch {
    return undefined
  }
}

export const launchInstalledPackage = async (input: LaunchInstalledPackageOptions) => {
  const version = readActivePackageVersion(input.packageName) ?? await resolvePublishedPackageVersion(input.packageName)
  console.error(`[bootstrap] using ${input.packageName}@${version}`)
  const installedPackage = await installPublishedPackage(input.packageName, version)
  const entryPath = await resolvePackageBinEntrypoint(installedPackage.packageDir, input.commandName)
  const adapterPackageRequest = input.packageName === '@oneworks/cli' &&
      shouldResolveCliAdapterPackage()
    ? readCliAdapterPackageRequest(
      input.forwardedArgs,
      version,
      process.env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_ADAPTER__
    )
    : undefined
  const adapterPackageDir = adapterPackageRequest == null
    ? undefined
    : await resolveCliAdapterPackageDir(adapterPackageRequest)

  return await runNodeEntrypoint(
    entryPath,
    input.forwardedArgs,
    adapterPackageDir == null
      ? {}
      : {
        env: {
          ...process.env,
          __ONEWORKS_PROJECT_CLI_PACKAGE_DIR__: adapterPackageDir
        }
      }
  )
}
