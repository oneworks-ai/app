import fs from 'node:fs'
import path from 'node:path'
import { cwd, env as processEnv } from 'node:process'

import type { loadEnv } from '@oneworks/core'
import { resolveExistingNpmPackageDirs } from '@oneworks/types'

import { resolveActiveModulePackageDirSync } from '#~/module-update-cache.js'

export const DEFAULT_CLIENT_BASE = '/ui/'
export const DEFAULT_BASE_PLACEHOLDER = '/__ONEWORKS_PROJECT_CLIENT_BASE__/'
const CLIENT_PACKAGE_NAME = '@oneworks/client'

const resolveCachedClientDistCandidates = () => (
  resolveExistingNpmPackageDirs(CLIENT_PACKAGE_NAME, processEnv)
    .map(packageDir => path.join(packageDir, 'dist'))
)

export const normalizeClientBase = (value?: string) => {
  let base = value?.trim() || DEFAULT_CLIENT_BASE
  if (!base.startsWith('/')) {
    base = `/${base}`
  }
  if (!base.endsWith('/')) {
    base += '/'
  }
  return base
}

export const trimTrailingSlash = (value: string) => {
  if (value === '/') {
    return value
  }
  return value.replace(/\/+$/, '')
}

export const resolveClientDistPath = (distPath: string | undefined) => {
  const workspaceFolder = processEnv.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ ?? cwd()
  const packageDir = processEnv.__ONEWORKS_PROJECT_PACKAGE_DIR__ ?? cwd()
  const candidates: string[] = []

  if (distPath?.trim()) {
    const rawPath = distPath.trim()
    const resolved = path.isAbsolute(rawPath) ? rawPath : path.resolve(workspaceFolder, rawPath)
    candidates.push(resolved)
  }

  const activeClientPackageDir = resolveActiveModulePackageDirSync('@oneworks/client')
  if (activeClientPackageDir != null) {
    candidates.push(path.resolve(activeClientPackageDir, 'dist'))
  }

  candidates.push(
    ...resolveCachedClientDistCandidates(),
    path.resolve(workspaceFolder, 'apps/client/dist'),
    path.resolve(workspaceFolder, 'client/dist'),
    path.resolve(packageDir, '../client/dist'),
    path.resolve(packageDir, '../../client/dist'),
    path.resolve(workspaceFolder, 'node_modules/@oneworks/client/dist'),
    path.resolve(packageDir, '../../node_modules/@oneworks/client/dist')
  )

  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue
    seen.add(candidate)
    if (fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate
    }
  }
  return null
}

export const createRuntimeScript = (
  env: ReturnType<typeof loadEnv>,
  clientBase: string,
  serverBaseUrl?: string
) => {
  const workspaceFolder = processEnv.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ ?? cwd()
  const runtimeEnv = {
    __ONEWORKS_PROJECT_SERVER_BASE_URL__: serverBaseUrl ?? env.__ONEWORKS_PROJECT_PUBLIC_BASE_URL__,
    __ONEWORKS_PROJECT_SERVER_HOST__: env.__ONEWORKS_PROJECT_SERVER_HOST__,
    __ONEWORKS_PROJECT_SERVER_PORT__: String(env.__ONEWORKS_PROJECT_SERVER_PORT__),
    __ONEWORKS_PROJECT_SERVER_WS_PATH__: env.__ONEWORKS_PROJECT_SERVER_WS_PATH__,
    __ONEWORKS_PROJECT_CLIENT_MODE__: env.__ONEWORKS_PROJECT_CLIENT_MODE__,
    __ONEWORKS_PROJECT_CLIENT_BASE__: clientBase,
    __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceFolder
  }
  return `<script>window.__ONEWORKS_PROJECT_RUNTIME_ENV__=${JSON.stringify(runtimeEnv)}</script>`
}
