import process from 'node:process'

import { resolvePackagedCliPathEnv } from './cli-path-env'
import {
  builtinPackageCachePath,
  resolveBundledRuntimeConsumerBootstrapPath,
  resolveDesktopBackgroundRuntime
} from './paths'
import { runOwnedChildCommand, writeProcessLine } from './process-utils'
import { resolveDesktopRuntimePackageCacheVersionEnv } from './runtime-cache-version'
import type { WorkspaceRuntimeCacheRefreshResult } from './workspace-runtime-cache-manager'

type RuntimePackageTarget = 'client' | 'server'

interface BundledRuntimeCacheRefreshResult {
  entries: Array<{ seeded?: boolean }>
}

interface RuntimePackageStatus {
  latestVersion: string
  packageName: string
}

export const buildBundledRuntimeCacheRefreshScript = () => `
const cacheModule = require(${JSON.stringify(builtinPackageCachePath)})
const entries = [
  ...(cacheModule.ensureBuiltinPluginPackageCache?.({ env: process.env, trustManifest: true }) ?? []),
  ...(cacheModule.ensureBuiltinAdapterPackageCache?.({ env: process.env, trustManifest: true }) ?? []),
  ...(cacheModule.ensureBuiltinRuntimePackageCache?.({ env: process.env, trustManifest: true }) ?? [])
]
process.stdout.write(JSON.stringify({ entries }) + '\\n')
`

const readJsonResult = <T>(stdout: string, missingResultMessage: string): T => {
  const line = stdout
    .split(/\r?\n/u)
    .map(item => item.trim())
    .filter(Boolean)
    .at(-1)
  if (line == null) throw new Error(missingResultMessage)
  return JSON.parse(line) as T
}

const refreshBundledWorkspaceRuntimeCache = async (
  signal: AbortSignal
): Promise<WorkspaceRuntimeCacheRefreshResult | undefined> => {
  const runtimePackageCacheVersionEnv = resolveDesktopRuntimePackageCacheVersionEnv()
  if (Object.keys(runtimePackageCacheVersionEnv).length === 0) return undefined
  const runtime = resolveDesktopBackgroundRuntime()

  const { stdout } = await runOwnedChildCommand({
    args: ['-e', buildBundledRuntimeCacheRefreshScript()],
    description: 'Bundled workspace runtime cache refresh',
    env: {
      ...process.env,
      ...runtimePackageCacheVersionEnv,
      ...runtime.env
    },
    executable: runtime.executable,
    signal
  })
  const { entries } = readJsonResult<BundledRuntimeCacheRefreshResult>(
    stdout,
    'Bundled workspace runtime cache refresh did not return a result.'
  )
  if (entries.length === 0) return undefined

  const changed = entries.filter(entry => entry.seeded === true).length
  writeProcessLine(
    process.stdout,
    `[oneworks-runtime] refreshed bundled workspace package cache (${changed}/${entries.length} changed)`
  )
  return {
    changed,
    source: 'bundled',
    total: entries.length
  }
}

const installBootstrapRuntimePackage = async (
  signal: AbortSignal,
  target: RuntimePackageTarget
) => {
  const bootstrapPath = resolveBundledRuntimeConsumerBootstrapPath()
  if (bootstrapPath == null) {
    throw new Error('Bundled One Works bootstrap CLI was not found.')
  }
  const runtimePackageCacheVersionEnv = resolveDesktopRuntimePackageCacheVersionEnv()
  const runtimeEnv = {
    ...process.env,
    ...runtimePackageCacheVersionEnv
  }
  const runtime = resolveDesktopBackgroundRuntime()
  const { stdout } = await runOwnedChildCommand({
    args: [bootstrapPath, 'runtime', 'install', target, '--json'],
    description: `Bootstrap runtime cache refresh for ${target}`,
    env: {
      ...runtimeEnv,
      ...resolvePackagedCliPathEnv(runtimeEnv),
      ...runtime.env
    },
    executable: runtime.executable,
    signal
  })
  return readJsonResult<RuntimePackageStatus>(
    stdout,
    `Bootstrap runtime cache refresh for ${target} did not return a result.`
  )
}

export const refreshWorkspaceRuntimeCache = async (
  signal: AbortSignal
): Promise<WorkspaceRuntimeCacheRefreshResult> => {
  const bundledResult = await refreshBundledWorkspaceRuntimeCache(signal)
  if (bundledResult != null) return bundledResult

  const statuses: RuntimePackageStatus[] = []
  for (const target of ['server', 'client'] as const) {
    statuses.push(await installBootstrapRuntimePackage(signal, target))
  }
  const summary = statuses
    .map(status => `${status.packageName}@${status.latestVersion}`)
    .join(', ')
  writeProcessLine(process.stdout, `[oneworks-runtime] cached ${summary} for future workspace launches`)
  return {
    changed: statuses.length,
    source: 'bootstrap',
    summary,
    total: statuses.length
  }
}
