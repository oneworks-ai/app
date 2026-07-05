import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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

const shouldPreferLocalRuntimePackage = () => {
  const value = process.env.__ONEWORKS_BOOTSTRAP_PREFER_LOCAL_RUNTIME__?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

const resolveLocalRuntimePackageBaseDirs = () => {
  const dirs = [
    normalizeRuntimePackageDir(process.env.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__),
    normalizeRuntimePackageDir(process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__),
    process.cwd()
  ]
  return [...new Set(dirs.filter((dir): dir is string => dir != null))]
}

const resolveLocalRuntimePackageFromDir = (packageName: string, baseDir: string) => {
  try {
    const packageRequire = createRequire(path.join(baseDir, 'package.json'))
    const packageJsonPath = packageRequire.resolve(`${packageName}/package.json`)
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name?: unknown
      version?: unknown
    }
    if (parsed.name !== packageName || typeof parsed.version !== 'string') {
      return undefined
    }

    return {
      packageDir: path.dirname(packageJsonPath),
      version: parsed.version
    }
  } catch {
    return undefined
  }
}

export const resolveLocalRuntimePackage = (packageName: string) => {
  if (!shouldPreferLocalRuntimePackage()) {
    return undefined
  }

  for (const baseDir of resolveLocalRuntimePackageBaseDirs()) {
    const localPackage = resolveLocalRuntimePackageFromDir(packageName, baseDir)
    if (localPackage != null) {
      return localPackage
    }
  }

  return undefined
}

export const shouldResolveCliAdapterPackage = (cliPackageDirOverride?: string) => {
  const cliPackageDir = normalizeRuntimePackageDir(cliPackageDirOverride) ??
    normalizeRuntimePackageDir(process.env.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__)
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

const resolveCliRuntimeNodeArgs = (packageDir: string) => {
  try {
    const packageRequire = createRequire(path.join(packageDir, 'package.json'))
    return [
      '--conditions=__oneworks__',
      '--loader',
      packageRequire.resolve('@oneworks/register/esm-loader'),
      '-r',
      packageRequire.resolve('@oneworks/register/preload')
    ]
  } catch {
    return []
  }
}

export const launchInstalledPackage = async (input: LaunchInstalledPackageOptions) => {
  const localPackage = resolveLocalRuntimePackage(input.packageName)
  const version = localPackage?.version ??
    readActivePackageVersion(input.packageName) ??
    await resolvePublishedPackageVersion(input.packageName)
  const packageDir = localPackage?.packageDir ??
    (await installPublishedPackage(input.packageName, version)).packageDir
  console.error(
    localPackage == null
      ? `[bootstrap] using ${input.packageName}@${version}`
      : `[bootstrap] using local ${input.packageName}@${version} from ${packageDir}`
  )
  const entryPath = await resolvePackageBinEntrypoint(packageDir, input.commandName)
  const adapterPackageRequest = input.packageName === '@oneworks/cli' &&
      shouldResolveCliAdapterPackage(localPackage == null ? undefined : packageDir)
    ? readCliAdapterPackageRequest(
      input.forwardedArgs,
      version,
      process.env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_ADAPTER__
    )
    : undefined
  const adapterPackageDir = adapterPackageRequest == null
    ? undefined
    : await resolveCliAdapterPackageDir(adapterPackageRequest)
  const env = input.packageName === '@oneworks/cli' && (adapterPackageDir != null || localPackage != null)
    ? {
      ...process.env,
      __ONEWORKS_PROJECT_CLI_PACKAGE_DIR__: adapterPackageDir ?? packageDir
    }
    : undefined

  return await runNodeEntrypoint(
    entryPath,
    input.forwardedArgs,
    {
      env,
      nodeArgs: input.packageName === '@oneworks/cli'
        ? resolveCliRuntimeNodeArgs(packageDir)
        : undefined
    }
  )
}
