import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

interface ActiveModulePackageMetadata {
  packageDir: string
  packageName: string
  updatedAt: string
  version: string
}

export const sanitizeModulePackageName = (packageName: string) => packageName.replace(/^@/, '').replace(/[\\/]/g, '__')

export const splitModulePackageName = (packageName: string) => packageName.split('/')

export const resolveModuleUpdateRealHomeDir = (env: NodeJS.ProcessEnv = process.env) => {
  const realHome = env.__ONEWORKS_PROJECT_REAL_HOME__?.trim()
  if (realHome) return realHome

  const home = env.HOME?.trim() || env.USERPROFILE?.trim()
  return home || os.homedir()
}

export const resolveBootstrapDataDir = (env: NodeJS.ProcessEnv = process.env) => (
  path.join(resolveModuleUpdateRealHomeDir(env), '.oneworks', 'bootstrap')
)

export const resolveGenericPackageCacheDir = (
  packageName: string,
  version: string,
  env: NodeJS.ProcessEnv = process.env
) => path.join(resolveBootstrapDataDir(env), 'npm', sanitizeModulePackageName(packageName), version)

export const resolveGenericPackageInstallDir = (cacheDir: string, packageName: string) => (
  path.join(cacheDir, 'node_modules', ...splitModulePackageName(packageName))
)

export const resolveAdapterPackageCacheDir = (
  packageName: string,
  version: string,
  env: NodeJS.ProcessEnv = process.env
) => path.join(resolveBootstrapDataDir(env), 'adapter-packages', sanitizeModulePackageName(packageName), version)

export const resolveAdapterPackageInstallDir = (cacheDir: string, packageName: string) => (
  path.join(cacheDir, 'node_modules', ...splitModulePackageName(packageName))
)

export const resolveModuleUpdateMetadataPath = (
  packageName: string,
  env: NodeJS.ProcessEnv = process.env
) =>
  path.join(
    resolveBootstrapDataDir(env),
    'module-updates',
    `${sanitizeModulePackageName(packageName)}.json`
  )

const readPackageInfoFromContent = (content: string) => {
  const parsed = JSON.parse(content) as { name?: unknown; version?: unknown }
  return {
    name: typeof parsed.name === 'string' ? parsed.name : undefined,
    version: typeof parsed.version === 'string' ? parsed.version : undefined
  }
}

export const readPackageInfoSync = (packageJsonPath: string) => {
  try {
    return readPackageInfoFromContent(readFileSync(packageJsonPath, 'utf8'))
  } catch {
    return undefined
  }
}

export const readPackageInfo = async (packageJsonPath: string) => {
  try {
    return readPackageInfoFromContent(await readFile(packageJsonPath, 'utf8'))
  } catch {
    return undefined
  }
}

export const resolveActiveModulePackageDirSync = (
  packageName: string,
  env: NodeJS.ProcessEnv = process.env
) => {
  try {
    const parsed = JSON.parse(
      readFileSync(resolveModuleUpdateMetadataPath(packageName, env), 'utf8')
    ) as Partial<ActiveModulePackageMetadata>
    if (
      parsed.packageName !== packageName ||
      typeof parsed.version !== 'string' ||
      typeof parsed.packageDir !== 'string'
    ) {
      return undefined
    }

    const packageInfo = readPackageInfoSync(path.join(parsed.packageDir, 'package.json'))
    return packageInfo?.name === packageName && packageInfo.version === parsed.version
      ? parsed.packageDir
      : undefined
  } catch {
    return undefined
  }
}

export const writeActiveModulePackage = async (
  input: {
    packageDir: string
    packageName: string
    version: string
  },
  env: NodeJS.ProcessEnv = process.env
) => {
  const metadataPath = resolveModuleUpdateMetadataPath(input.packageName, env)
  await mkdir(path.dirname(metadataPath), { recursive: true })
  const tempPath = `${metadataPath}.${process.pid}.${Date.now()}.tmp`
  const metadata: ActiveModulePackageMetadata = {
    packageDir: input.packageDir,
    packageName: input.packageName,
    updatedAt: new Date().toISOString(),
    version: input.version
  }
  await writeFile(tempPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  await rename(tempPath, metadataPath)
}

export const isExistingPathSync = (targetPath: string) => existsSync(targetPath)
