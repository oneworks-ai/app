import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import type { CodexMarketplaceSource, ManagedPluginSource } from '@oneworks/types'
import { listSafeChildDirectories, readNativeIconDataUrlWithin } from '@oneworks/utils'

import { loadCodexAppServerMarketplaceCatalog, resolveCodexAppServerMarketplacePluginPath } from './app-server-catalog'
import type {
  CodexMarketplaceCatalog,
  CodexMarketplacePluginDefinition,
  CodexMarketplaceRuntime
} from './marketplace-types'
import { parseCodexPluginManifest, pathExists } from './source'

export type {
  CodexMarketplaceCatalog,
  CodexMarketplacePluginDefinition,
  CodexMarketplaceRuntime
} from './marketplace-types'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const resolvePathWithinRoot = async (rootDir: string, candidatePath: string, description: string) => {
  const resolvedPath = path.resolve(rootDir, candidatePath)
  const relativePath = path.relative(rootDir, resolvedPath)
  if (
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    relativePath.startsWith('..\\') ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`${description} resolves outside the marketplace root.`)
  }
  if (await pathExists(resolvedPath)) {
    const [realRoot, realResolved] = await Promise.all([
      fs.realpath(rootDir),
      fs.realpath(resolvedPath)
    ])
    const realRelative = path.relative(realRoot, realResolved)
    if (
      realRelative === '..' ||
      realRelative.startsWith('../') ||
      realRelative.startsWith('..\\') ||
      path.isAbsolute(realRelative)
    ) {
      throw new Error(`${description} resolves outside the marketplace root through a symlink.`)
    }
  }
  return resolvedPath
}

const normalizeCatalog = async (
  catalog: unknown,
  description: string,
  rootDir?: string
): Promise<CodexMarketplaceCatalog> => {
  if (!isRecord(catalog) || !Array.isArray(catalog.plugins)) {
    throw new TypeError(`Invalid Codex marketplace catalog at ${description}.`)
  }

  const plugins = await Promise.all(catalog.plugins.map(async (value, index) => {
    if (!isRecord(value)) {
      throw new TypeError(`Invalid Codex marketplace plugin at ${description}.plugins[${index}].`)
    }
    const name = normalizeNonEmptyString(value.name)
    const source = isRecord(value.source) ? value.source : undefined
    const sourcePath = normalizeNonEmptyString(source?.path)
    if (name == null || source?.source !== 'local' || sourcePath == null) {
      throw new TypeError(
        `Unsupported Codex marketplace plugin at ${description}.plugins[${index}]. Expected a local source.`
      )
    }
    const pluginRoot = rootDir == null
      ? undefined
      : await resolvePathWithinRoot(rootDir, sourcePath, `Codex plugin ${name}`)
    const manifest = pluginRoot == null ? undefined : await parseCodexPluginManifest(pluginRoot)
    const manifestInterface = manifest?.interface
    const iconRef = manifestInterface?.logo ??
      manifestInterface?.logoDark ??
      manifestInterface?.composerIcon
    const icon = pluginRoot == null ? undefined : await readNativeIconDataUrlWithin(pluginRoot, iconRef)
    const listAssetDirectories = async (assetName: 'agents' | 'commands' | 'skills') => (
      pluginRoot == null
        ? []
        : (await listSafeChildDirectories(path.resolve(pluginRoot, assetName))).map(entry => entry.name)
    )
    const [agents, commands, skills] = await Promise.all([
      listAssetDirectories('agents'),
      listAssetDirectories('commands'),
      listAssetDirectories('skills')
    ])
    return {
      name,
      source: { source: 'local' as const, path: sourcePath },
      ...(normalizeNonEmptyString(value.description) ?? manifest?.description) != null
        ? { description: normalizeNonEmptyString(value.description) ?? manifest?.description }
        : {},
      ...(normalizeNonEmptyString(value.version) ?? manifest?.version) != null
        ? { version: normalizeNonEmptyString(value.version) ?? manifest?.version }
        : {},
      ...(normalizeNonEmptyString(manifestInterface?.displayName) != null
        ? { displayName: normalizeNonEmptyString(manifestInterface?.displayName) }
        : {}),
      ...(icon != null ? { icon: { kind: 'data' as const, value: icon } } : {}),
      ...(agents.length > 0 ? { agents } : {}),
      ...(commands.length > 0 ? { commands } : {}),
      ...(skills.length > 0 ? { skills } : {})
    }
  }))

  const catalogInterface = isRecord(catalog.interface) ? catalog.interface : undefined
  return {
    ...(normalizeNonEmptyString(catalog.name) != null ? { name: normalizeNonEmptyString(catalog.name) } : {}),
    ...(normalizeNonEmptyString(catalogInterface?.displayName) != null
      ? { title: normalizeNonEmptyString(catalogInterface?.displayName) }
      : {}),
    plugins
  }
}

const readCatalogFromRoot = async (rootDir: string) => {
  const catalogPath = await resolvePathWithinRoot(
    rootDir,
    path.join('.agents', 'plugins', 'marketplace.json'),
    'Codex marketplace catalog'
  )
  if (!await pathExists(catalogPath)) {
    throw new Error(`Codex marketplace catalog not found at ${catalogPath}.`)
  }
  return normalizeCatalog(JSON.parse(await fs.readFile(catalogPath, 'utf8')) as unknown, catalogPath, rootDir)
}

export const loadCodexMarketplaceCatalogFromSource = async (
  tempDir: string,
  source: CodexMarketplaceSource,
  marketplaceName: string,
  installSource: (targetDir: string, source: ManagedPluginSource) => Promise<string>,
  runtime: CodexMarketplaceRuntime = { cwd: process.cwd(), env: process.env }
): Promise<{ catalog: CodexMarketplaceCatalog; rootDir?: string }> => {
  switch (source.source) {
    case 'directory':
    case 'github':
    case 'git': {
      const sourceRoot = await installSource(
        path.join(tempDir, 'marketplace-source'),
        source.source === 'directory'
          ? { type: 'path', path: source.path }
          : source.source === 'github'
          ? { type: 'github', repo: source.repo, ...(source.ref != null ? { ref: source.ref } : {}) }
          : { type: 'git', url: source.url, ...(source.ref != null ? { ref: source.ref } : {}) }
      )
      const marketplaceRoot = source.source !== 'directory' && source.path != null
        ? await resolvePathWithinRoot(sourceRoot, source.path, `Marketplace ${marketplaceName} path`)
        : sourceRoot
      return {
        rootDir: marketplaceRoot,
        catalog: await readCatalogFromRoot(marketplaceRoot)
      }
    }
    case 'app-server': {
      return {
        catalog: await loadCodexAppServerMarketplaceCatalog(source, runtime)
      }
    }
  }
}

export const resolveCodexMarketplacePluginPath = async (
  rootDir: string | undefined,
  plugin: CodexMarketplacePluginDefinition,
  marketplaceName: string,
  runtime: CodexMarketplaceRuntime = { cwd: process.cwd(), env: process.env }
) => {
  if (plugin.source.source === 'app-server') {
    return resolveCodexAppServerMarketplacePluginPath(
      plugin,
      marketplaceName,
      runtime,
      resolvePathWithinRoot
    )
  }
  if (rootDir == null) {
    throw new Error(
      `Codex marketplace plugin ${plugin.name}@${marketplaceName} uses a local source, but its marketplace is not directory-backed.`
    )
  }
  return resolvePathWithinRoot(
    rootDir,
    plugin.source.path,
    `Marketplace plugin source for ${plugin.name}@${marketplaceName}`
  )
}
