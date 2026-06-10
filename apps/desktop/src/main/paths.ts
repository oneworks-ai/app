import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import { app } from 'electron'

import { resolveExistingNpmPackageDir } from '@oneworks/types'

const nodeRequire = createRequire(__filename)
const desktopRoot = app.getAppPath()
export const repoRoot = path.resolve(desktopRoot, '../..')
export const clientCliPath = path.join(repoRoot, 'apps/client/cli.cjs')
export const serverChildPath = path.join(desktopRoot, 'src/server-child.cjs')
export const preloadPath = path.join(desktopRoot, 'dist/preload/index.js')
export const isDev = !app.isPackaged

const CLIENT_PACKAGE_NAME = '@oneworks/client'
const SERVER_PACKAGE_NAME = '@oneworks/server'

export const resolveClientDistPath = (): string | undefined => {
  const cachedClientPackageDir = app.isPackaged ? resolveExistingNpmPackageDir(CLIENT_PACKAGE_NAME) : undefined
  const packagedClientDistPath = typeof process.resourcesPath === 'string'
    ? path.join(process.resourcesPath, 'dist')
    : undefined
  const candidates = app.isPackaged
    ? [
      cachedClientPackageDir == null ? undefined : path.join(cachedClientPackageDir, 'dist'),
      packagedClientDistPath
    ]
    : [
      path.join(repoRoot, 'apps/client/dist')
    ]

  return candidates.find(candidate => candidate != null && fs.existsSync(path.join(candidate, 'index.html')))
}

export const resolveServerExecutable = () => {
  if (
    process.env.ONEWORKS_DESKTOP_SERVER_RUNTIME != null && process.env.ONEWORKS_DESKTOP_SERVER_RUNTIME.trim() !== ''
  ) {
    return process.env.ONEWORKS_DESKTOP_SERVER_RUNTIME.trim()
  }

  return app.isPackaged ? process.execPath : 'node'
}

export const resolveCachedServerPackageDir = () => (
  app.isPackaged ? resolveExistingNpmPackageDir(SERVER_PACKAGE_NAME) : undefined
)

export const resolveCachedServerPackageEnv = ():
  | Pick<NodeJS.ProcessEnv, '__ONEWORKS_DESKTOP_SERVER_PACKAGE_DIR__'>
  | {} =>
{
  const packageDir = resolveCachedServerPackageDir()
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
