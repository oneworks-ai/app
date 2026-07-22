import fs from 'node:fs/promises'
import path from 'node:path'

import type {
  ClaudeCodeMarketplacePluginDefinition,
  ClaudeCodeMarketplaceSource,
  ManagedPluginSource,
  MarketplaceConfig
} from '@oneworks/types'
import { normalizeMarketplaceConfig } from '@oneworks/utils'

import { parseClaudePluginManifest, pathExists } from './source'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export interface ClaudeMarketplaceCatalog {
  name?: string
  metadata?: {
    pluginRoot?: string
  }
  plugins: ClaudeCodeMarketplacePluginDefinition[]
}

const normalizeMarketplaceCatalog = (catalog: unknown, description: string): ClaudeMarketplaceCatalog => {
  const catalogSource: Record<string, unknown> = {
    source: 'settings',
    ...(isRecord(catalog) ? catalog : {})
  }
  if (isRecord(catalog) && 'plugins' in catalog) {
    catalogSource.plugins = catalog.plugins
  }

  const normalized = normalizeMarketplaceConfig(
    {
      __catalog__: {
        type: 'claude-code',
        options: {
          source: catalogSource
        }
      }
    } as unknown as MarketplaceConfig,
    description,
    {
      allowSettingsPathPluginSources: true
    }
  )

  const entry = normalized?.__catalog__
  const source = entry?.type === 'claude-code' ? entry.options?.source : undefined
  if (source == null || source.source !== 'settings') {
    throw new TypeError(`Failed to normalize Claude marketplace catalog from ${description}.`)
  }

  return {
    ...(source.name != null ? { name: source.name } : {}),
    ...(source.metadata != null ? { metadata: source.metadata } : {}),
    plugins: source.plugins
  }
}

const readMarketplaceCatalogFromRoot = async (rootDir: string): Promise<ClaudeMarketplaceCatalog> => {
  const catalogPath = await resolvePathWithinRoot(
    rootDir,
    path.join('.claude-plugin', 'marketplace.json'),
    'Claude marketplace catalog'
  )
  if (!await pathExists(catalogPath)) {
    throw new Error(`Claude marketplace catalog not found at ${catalogPath}.`)
  }
  const catalog = normalizeMarketplaceCatalog(
    JSON.parse(await fs.readFile(catalogPath, 'utf8')) as unknown,
    catalogPath
  )
  return enrichLocalPluginVersions(rootDir, catalog)
}

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

const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const enrichLocalPluginVersions = async (
  rootDir: string,
  catalog: ClaudeMarketplaceCatalog
): Promise<ClaudeMarketplaceCatalog> => ({
  ...catalog,
  plugins: await Promise.all(catalog.plugins.map(async (plugin) => {
    if (normalizeNonEmptyString(plugin.version) != null || typeof plugin.source !== 'string') return plugin
    const pluginRootPrefix = normalizeNonEmptyString(catalog.metadata?.pluginRoot)
    const relativeSource = pluginRootPrefix != null &&
        !plugin.source.startsWith('./') &&
        !plugin.source.startsWith('../')
      ? path.join(pluginRootPrefix, plugin.source)
      : plugin.source
    const pluginRoot = await resolvePathWithinRoot(
      rootDir,
      relativeSource,
      `Marketplace plugin source for ${plugin.name}`
    )
    const version = normalizeNonEmptyString((await parseClaudePluginManifest(pluginRoot))?.version)
    return version == null ? plugin : { ...plugin, version }
  }))
})

export const loadMarketplaceCatalogFromSource = async (
  tempDir: string,
  source: ClaudeCodeMarketplaceSource,
  marketplaceName: string,
  installSource: (targetDir: string, source: ManagedPluginSource) => Promise<string>
): Promise<{ catalog: ClaudeMarketplaceCatalog; rootDir?: string }> => {
  switch (source.source) {
    case 'settings':
      return {
        catalog: {
          ...(source.name != null ? { name: source.name } : {}),
          ...(source.metadata != null ? { metadata: source.metadata } : {}),
          plugins: source.plugins
        }
      }
    case 'url': {
      const response = await fetch(source.url)
      if (!response.ok) {
        throw new Error(`Failed to fetch Claude marketplace ${marketplaceName} from ${source.url}: ${response.status}.`)
      }
      return {
        catalog: normalizeMarketplaceCatalog(await response.json(), source.url)
      }
    }
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

      const marketplaceRoot = source.source === 'directory'
        ? sourceRoot
        : source.path != null
        ? await resolvePathWithinRoot(sourceRoot, source.path, `Marketplace ${marketplaceName} path`)
        : sourceRoot

      return {
        rootDir: marketplaceRoot,
        catalog: await readMarketplaceCatalogFromRoot(marketplaceRoot)
      }
    }
    case 'hostPattern':
      throw new Error(
        `Configured Claude marketplace ${marketplaceName} uses hostPattern restrictions and cannot be fetched directly.`
      )
  }
}
