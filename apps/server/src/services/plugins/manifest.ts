import { access, readFile, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { ResolvedPluginInstance } from '@oneworks/utils/plugin-resolver'

import { applyPackageExportConventions, readPluginPackageJson } from './package-export-conventions.js'
import type { PluginRuntimeManifest } from './types.js'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const isPathOutside = (relativePath: string) => (
  relativePath === '..' ||
  relativePath.startsWith('../') ||
  relativePath.startsWith('..\\') ||
  path.isAbsolute(relativePath)
)

const resolveInsidePluginRoot = async (pluginRoot: string, relativePath: string) => {
  if (relativePath.includes('\0') || path.isAbsolute(relativePath)) return undefined
  const resolvedPath = path.resolve(pluginRoot, relativePath)
  const [realRoot, realTarget] = await Promise.all([
    realpath(pluginRoot).catch(() => undefined),
    realpath(resolvedPath).catch(() => undefined)
  ])
  if (realRoot == null || realTarget == null || isPathOutside(path.relative(realRoot, realTarget))) {
    return undefined
  }
  return realTarget
}

const pathExists = async (filePath: string) => {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

const parseJsonFile = async (filePath: string) => {
  const raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown
  return isRecord(raw) ? raw : undefined
}

const parseScalar = (value: string) => {
  const trimmed = value.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

const parseSimpleYamlLine = (rawLine: string) => {
  const trimmedStart = rawLine.trimStart()
  const colonIndex = trimmedStart.indexOf(':')
  if (colonIndex <= 0) return undefined
  const key = trimmedStart.slice(0, colonIndex).trim()
  if (key === '' || key.includes('#')) return undefined
  return {
    indent: rawLine.length - trimmedStart.length,
    key,
    rawValue: trimmedStart.slice(colonIndex + 1).trimStart()
  }
}

const parseSimpleYaml = (source: string) => {
  const root: Record<string, unknown> = {}
  const stack: Array<{ indent: number; value: Record<string, unknown> }> = [{ indent: -1, value: root }]

  for (const rawLine of source.split(/\r?\n/)) {
    if (rawLine.trim() === '' || rawLine.trimStart().startsWith('#')) continue
    const line = parseSimpleYamlLine(rawLine)
    if (line == null) continue

    while (stack.length > 1 && line.indent <= stack[stack.length - 1].indent) {
      stack.pop()
    }

    const parent = stack[stack.length - 1].value
    if (line.rawValue.trim() === '') {
      const child: Record<string, unknown> = {}
      parent[line.key] = child
      stack.push({ indent: line.indent, value: child })
    } else {
      parent[line.key] = parseScalar(line.rawValue)
    }
  }

  return root
}

const parseYamlFile = async (filePath: string) => parseSimpleYaml(await readFile(filePath, 'utf8'))

const normalizeRuntimeManifest = (value: unknown): PluginRuntimeManifest | undefined => {
  if (!isRecord(value)) return undefined
  const plugin = isRecord(value.plugin) ? value.plugin : undefined
  if (plugin == null && !('name' in value) && !('displayName' in value) && !('version' in value)) return undefined

  return value as unknown as PluginRuntimeManifest
}

const loadPackageExportManifest = async (workspaceFolder: string, instance: ResolvedPluginInstance) => {
  if (instance.packageId == null) return undefined

  const workspaceRequire = createRequire(path.resolve(workspaceFolder, '__oneworks_plugin_runtime__.cjs'))
  let entryPath: string
  try {
    entryPath = workspaceRequire.resolve(instance.packageId)
  } catch {
    return undefined
  }

  try {
    const mod = workspaceRequire(entryPath) as unknown
    return normalizeRuntimeManifest(isRecord(mod) && 'default' in mod ? mod.default : mod)
  } catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined
    if (code !== 'ERR_REQUIRE_ESM') {
      throw error
    }
    const mod = await import(pathToFileURL(entryPath).href)
    return normalizeRuntimeManifest('default' in mod ? mod.default : mod)
  }
}

const loadDirectoryManifest = async (rootDir: string, options: { preferSource?: boolean } = {}) => {
  const packageJson = await readPluginPackageJson(rootDir)
  const candidates = [
    { path: path.join(rootDir, 'plugin.json'), type: 'json' },
    { path: path.join(rootDir, 'plugin.yaml'), type: 'yaml' },
    { path: path.join(rootDir, 'plugin.yml'), type: 'yaml' }
  ] as const

  for (const candidate of candidates) {
    if (!await pathExists(candidate.path)) continue
    const parsed = candidate.type === 'json'
      ? await parseJsonFile(candidate.path)
      : await parseYamlFile(candidate.path)
    return applyPackageExportConventions(normalizeRuntimeManifest(parsed), packageJson, options)
  }

  if (packageJson == null) return undefined
  return applyPackageExportConventions(
    normalizeRuntimeManifest(packageJson.oneWorksPlugin ?? packageJson),
    packageJson,
    options
  )
}

export const loadPluginRuntimeManifest = async (
  workspaceFolder: string,
  instance: ResolvedPluginInstance
) => {
  const fromPackage = await loadPackageExportManifest(workspaceFolder, instance)
  const conventionOptions = { preferSource: instance.watch === true }
  const fromDirectory = await loadDirectoryManifest(instance.rootDir, conventionOptions)
  if (fromPackage == null) return fromDirectory
  const primary = instance.watch === true ? fromDirectory : fromPackage
  const secondary = instance.watch === true ? fromPackage : fromDirectory
  const merged = {
    ...secondary,
    ...primary,
    displayName: primary?.displayName ?? secondary?.displayName,
    name: primary?.name ?? secondary?.name,
    version: primary?.version ?? secondary?.version
  }
  return applyPackageExportConventions(merged, await readPluginPackageJson(instance.rootDir), conventionOptions)
}

export const resolvePluginClientAssetRoot = async (pluginRoot: string, manifest: PluginRuntimeManifest) => {
  const client = manifest.plugin?.client
  const configuredRoot = typeof client?.root === 'string' && client.root.trim() !== ''
    ? client.root
    : undefined
  if (configuredRoot != null) {
    return await resolveInsidePluginRoot(pluginRoot, configuredRoot) ?? pluginRoot
  }

  const entry = typeof client?.entry === 'string' && client.entry.trim() !== ''
    ? client.entry
    : undefined
  if (entry == null) {
    return await realpath(pluginRoot).catch(() => pluginRoot)
  }

  return await resolveInsidePluginRoot(pluginRoot, path.dirname(entry)) ?? pluginRoot
}

export const resolvePluginServerEntryPath = async (pluginRoot: string, manifest: PluginRuntimeManifest) => {
  const entry = manifest.plugin?.server?.entry
  if (typeof entry !== 'string' || entry.trim() === '') return undefined
  const resolved = await resolveInsidePluginRoot(pluginRoot, entry)
  if (resolved == null) return undefined
  const entryStat = await stat(resolved).catch(() => undefined)
  return entryStat?.isFile() === true ? resolved : undefined
}
