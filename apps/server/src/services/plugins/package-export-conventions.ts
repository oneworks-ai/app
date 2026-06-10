import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

import type { PluginRuntimeManifest } from './types.js'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const pathExists = async (filePath: string) => {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export const readPluginPackageJson = async (rootDir: string) => {
  const packageJsonPath = path.join(rootDir, 'package.json')
  if (!await pathExists(packageJsonPath)) return undefined
  const raw = JSON.parse(await readFile(packageJsonPath, 'utf8')) as unknown
  return isRecord(raw) ? raw : undefined
}

const pickExportTarget = (
  value: unknown,
  conditions: readonly string[],
  depth = 0
): string | undefined => {
  if (depth > 8) return undefined
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const target = pickExportTarget(candidate, conditions, depth + 1)
      if (target != null) return target
    }
    return undefined
  }
  if (!isRecord(value)) return undefined

  for (const condition of conditions) {
    if (!Object.prototype.hasOwnProperty.call(value, condition)) continue
    const target = pickExportTarget(value[condition], conditions, depth + 1)
    if (target != null) return target
  }
  return undefined
}

const resolvePackageExportTarget = (
  packageJson: Record<string, unknown> | undefined,
  subpath: string,
  conditions: readonly string[]
) => {
  const exportsValue = packageJson?.exports
  if (!isRecord(exportsValue)) return undefined
  const target = pickExportTarget(exportsValue[subpath], conditions)
  if (target == null || target.includes('\0') || path.isAbsolute(target)) return undefined
  return target
}

const startsWithPathSegment = (value: string | undefined, segment: string) => {
  if (value == null) return false
  const normalized = value.replace(/^[./\\]+/, '').replaceAll('\\', '/')
  return normalized === segment || normalized.startsWith(`${segment}/`)
}

export const applyPackageExportConventions = (
  manifest: PluginRuntimeManifest | undefined,
  packageJson: Record<string, unknown> | undefined,
  options: { preferSource?: boolean } = {}
) => {
  if (manifest == null || packageJson == null) return manifest

  const clientEntry = resolvePackageExportTarget(packageJson, './client', [
    'browser',
    'import',
    'module',
    'default',
    'require'
  ])
  const clientDevEntry = resolvePackageExportTarget(packageJson, './client', [
    'source',
    'development',
    'dev',
    '__oneworks__',
    'browser',
    'import',
    'module',
    'default'
  ])
  const serverEntry = resolvePackageExportTarget(
    packageJson,
    './server',
    options.preferSource === true
      ? ['source', 'development', 'dev', '__oneworks__', 'node', 'import', 'module', 'default', 'require']
      : ['node', 'import', 'module', 'default', 'require']
  )

  const existingPlugin = manifest.plugin
  const existingClient = existingPlugin?.client
  const shouldCreateClient = existingClient != null || clientEntry != null || clientDevEntry != null
  const client = shouldCreateClient
    ? {
      ...(startsWithPathSegment(clientEntry, 'client') || startsWithPathSegment(clientDevEntry, 'client')
        ? { root: 'client' }
        : {}),
      ...existingClient,
      ...(existingClient?.entry == null && clientEntry != null ? { entry: clientEntry } : {}),
      ...(existingClient?.devEntry == null && clientDevEntry != null && clientDevEntry !== clientEntry
        ? { devEntry: clientDevEntry }
        : {})
    }
    : undefined

  const existingServer = existingPlugin?.server
  const shouldCreateServer = existingServer != null || serverEntry != null
  const server = shouldCreateServer
    ? {
      ...existingServer,
      ...(existingServer?.entry == null && serverEntry != null ? { entry: serverEntry } : {})
    }
    : undefined

  return {
    ...manifest,
    displayName: manifest.displayName ??
      (typeof packageJson.displayName === 'string' ? packageJson.displayName : undefined),
    name: manifest.name ?? (typeof packageJson.name === 'string' ? packageJson.name : undefined),
    version: manifest.version ?? (typeof packageJson.version === 'string' ? packageJson.version : undefined),
    plugin: existingPlugin == null && client == null && server == null
      ? undefined
      : {
        ...existingPlugin,
        ...(client != null ? { client } : {}),
        ...(server != null ? { server } : {})
      }
  } satisfies PluginRuntimeManifest
}
