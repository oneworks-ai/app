import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import { app } from 'electron'

import {
  comparePackageCacheVersions,
  resolveActiveModulePackageDirSync,
  resolveExistingNpmPackageDir
} from '@oneworks/types/adapter-package-cache'

import { resolveDesktopHeadlessRuntime } from '../headless-runtime.cjs'

const nodeRequire = createRequire(__filename)
const desktopRoot = app.getAppPath()
export const repoRoot = path.resolve(desktopRoot, '../..')
export const clientCliPath = path.join(repoRoot, 'apps/client/cli.cjs')
export const serverChildPath = path.join(desktopRoot, 'src/server-child.cjs')
export const builtinPackageCachePath = path.join(desktopRoot, 'src/builtin-adapter-cache.cjs')
export const preloadPath = path.join(desktopRoot, 'dist/preload/index.js')
export const isDev = !app.isPackaged

const CLIENT_PACKAGE_NAME = '@oneworks/client'
const SERVER_PACKAGE_NAME = '@oneworks/server'

const readPackageVersion = (packageDir: string, packageName: string) => {
  try {
    const packageInfo = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
      name?: unknown
      version?: unknown
    }
    return packageInfo.name === packageName && typeof packageInfo.version === 'string'
      ? packageInfo.version
      : undefined
  } catch {
    return undefined
  }
}

const resolvePreferredPackageDir = (
  packageName: string,
  env: NodeJS.ProcessEnv,
  validatePackageDir: (packageDir: string) => boolean = () => true
) =>
  [
    resolveExistingNpmPackageDir(packageName, env),
    resolveActiveModulePackageDirSync(packageName, env)
  ]
    .filter((packageDir): packageDir is string => packageDir != null && validatePackageDir(packageDir))
    .map(packageDir => ({ packageDir, version: readPackageVersion(packageDir, packageName) }))
    .filter((entry): entry is { packageDir: string; version: string } => entry.version != null)
    .sort((left, right) => comparePackageCacheVersions(right.version, left.version))[0]
    ?.packageDir

export const resolveClientPackageDir = (env: NodeJS.ProcessEnv = process.env): string | undefined => {
  if (!app.isPackaged) return path.join(repoRoot, 'apps/client')

  return resolvePreferredPackageDir(
    CLIENT_PACKAGE_NAME,
    env,
    packageDir => fs.existsSync(path.join(packageDir, 'dist/index.html'))
  )
}

export const resolveClientDistPath = (env: NodeJS.ProcessEnv = process.env): string | undefined => {
  const clientPackageDir = resolveClientPackageDir(env)
  const packagedClientDistPath = typeof process.resourcesPath === 'string'
    ? path.join(process.resourcesPath, 'dist')
    : undefined
  const candidates = app.isPackaged
    ? [
      clientPackageDir == null ? undefined : path.join(clientPackageDir, 'dist'),
      packagedClientDistPath
    ]
    : [
      path.join(repoRoot, 'apps/client/dist')
    ]

  return candidates.find(candidate => candidate != null && fs.existsSync(path.join(candidate, 'index.html')))
}

export const resolveServerRuntime = (env: NodeJS.ProcessEnv = process.env) =>
  resolveDesktopHeadlessRuntime({
    fallbackExecutable: 'node',
    isPackaged: app.isPackaged,
    overrideExecutable: env.ONEWORKS_DESKTOP_SERVER_RUNTIME,
    platform: process.platform,
    processExecutable: process.execPath
  })

export const resolveDesktopBackgroundRuntime = () =>
  resolveDesktopHeadlessRuntime({
    fallbackExecutable: process.execPath,
    isPackaged: app.isPackaged,
    platform: process.platform,
    processExecutable: process.execPath
  })

export const resolveCachedServerPackageDir = (env: NodeJS.ProcessEnv = process.env) => (
  app.isPackaged
    ? resolvePreferredPackageDir(SERVER_PACKAGE_NAME, env)
    : undefined
)

export const resolveCachedServerPackageEnv = (env: NodeJS.ProcessEnv = process.env):
  | Pick<NodeJS.ProcessEnv, '__ONEWORKS_DESKTOP_SERVER_PACKAGE_DIR__'>
  | {} =>
{
  const packageDir = resolveCachedServerPackageDir(env)
  return packageDir == null ? {} : { __ONEWORKS_DESKTOP_SERVER_PACKAGE_DIR__: packageDir }
}

export const resolveClientDevExecutable = () => {
  if (
    process.env.ONEWORKS_DESKTOP_CLIENT_RUNTIME != null && process.env.ONEWORKS_DESKTOP_CLIENT_RUNTIME.trim() !== ''
  ) {
    return process.env.ONEWORKS_DESKTOP_CLIENT_RUNTIME.trim()
  }

  return 'node'
}

export const resolveBundledRuntimeConsumerBootstrapPath = () => {
  try {
    const packageJsonPath = nodeRequire.resolve('oneworks/package.json')
    return path.join(path.dirname(packageJsonPath), 'cli.js')
  } catch {
    return undefined
  }
}
