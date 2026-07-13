import path from 'node:path'

import type { AdapterNativePluginManager, NativeHostPlugin, NativeHostPluginDiagnostic } from '@oneworks/types'
import {
  createNativeHostPluginId,
  discoverNativeHostSkills,
  findFirstJsonManifest,
  listChildDirectories,
  listSafeChildDirectories,
  normalizeOptionalString,
  readSmallJsonObject,
  readSmallJsonObjectWithin,
  resolveOptionalPath,
  resolveRealUserHome,
  toHomeDisplayPath
} from '@oneworks/utils'

const capabilities = {
  discover: 'available',
  disable: 'read-only',
  enable: 'read-only',
  import: 'read-only',
  install: 'read-only',
  uninstall: 'read-only',
  update: 'read-only'
} as const

const readDeclarations = async (filePath: string, rootDir?: string) => {
  const settings = rootDir == null
    ? await readSmallJsonObject(filePath)
    : await readSmallJsonObjectWithin(rootDir, filePath)
  const enabledPlugins = settings?.enabledPlugins
  return enabledPlugins != null && typeof enabledPlugins === 'object' && !Array.isArray(enabledPlugins)
    ? Object.entries(enabledPlugins).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
    : []
}

const readCachedPlugin = async (claudeHome: string, marketplace: string, name: string) => {
  const cacheRoot = path.resolve(claudeHome, 'plugins', 'cache', marketplace, name)
  const versions = (await listChildDirectories(cacheRoot))
    .filter(version => !version.startsWith('.'))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
  for (const version of versions) {
    const root = path.resolve(cacheRoot, version)
    const found = await findFirstJsonManifest(root, ['.claude-plugin/plugin.json'])
    if (found != null) return { cacheRoot, manifest: found.manifest, root, version }
  }
  return { cacheRoot }
}

const discover: AdapterNativePluginManager['discover'] = async ({ cwd, env }) => {
  const diagnostics: NativeHostPluginDiagnostic[] = []
  const realHome = resolveRealUserHome(env)
  const claudeHome = resolveOptionalPath(env.CLAUDE_CONFIG_DIR) ?? path.resolve(realHome, '.claude')
  const declarationSources = [
    { filePath: path.resolve(claudeHome, 'settings.json'), scope: 'user' as const },
    { filePath: path.resolve(cwd, '.claude/settings.json'), scope: 'project' as const },
    { filePath: path.resolve(cwd, '.claude/settings.local.json'), scope: 'project' as const }
  ]
  const declarations = new Map<string, {
    enabled: boolean
    filePath: string
    pluginId: string
    scope: 'project' | 'user'
  }>()
  for (const source of declarationSources) {
    let sourceDeclarations: Array<[string, boolean]>
    try {
      sourceDeclarations = await readDeclarations(source.filePath, source.scope === 'project' ? cwd : undefined)
    } catch {
      diagnostics.push({
        code: 'native_plugin_config_unreadable',
        level: 'warning',
        message: `Claude Code ${source.scope} plugin settings could not be parsed.`
      })
      continue
    }
    for (const [pluginId, enabled] of sourceDeclarations) {
      declarations.set(`${source.scope}\0${pluginId}`, { ...source, enabled, pluginId })
    }
  }

  const plugins: NativeHostPlugin[] = []
  for (const declaration of declarations.values()) {
    const separator = declaration.pluginId.lastIndexOf('@')
    if (separator <= 0 || separator === declaration.pluginId.length - 1) continue
    const name = declaration.pluginId.slice(0, separator)
    const marketplace = declaration.pluginId.slice(separator + 1)
    const cached = await readCachedPlugin(claudeHome, marketplace, name)
    const pluginDiagnostics = cached.manifest == null
      ? [{
        code: 'native_plugin_content_missing',
        level: 'warning' as const,
        message: 'The plugin is configured, but no installed manifest was found.'
      }]
      : []
    plugins.push({
      adapter: 'claude-code',
      capabilities,
      id: createNativeHostPluginId(
        'claude-code',
        `${declaration.scope}:${declaration.pluginId}:${cached.root ?? ''}`
      ),
      marketplace,
      name,
      scope: declaration.scope,
      source: {
        displayPath: toHomeDisplayPath(
          realHome,
          declaration.scope === 'project' ? declaration.filePath : cached.root ?? cached.cacheRoot
        ),
        ...(cached.root == null ? {} : { internalRoot: cached.root }),
        kind: declaration.scope === 'project' ? 'local-file' : 'cache'
      },
      state: declaration.enabled ? 'enabled' : 'disabled',
      ...(normalizeOptionalString(cached.manifest?.description) != null
        ? { description: normalizeOptionalString(cached.manifest?.description) }
        : {}),
      ...(normalizeOptionalString(cached.manifest?.displayName) != null
        ? { displayName: normalizeOptionalString(cached.manifest?.displayName) }
        : {}),
      ...(normalizeOptionalString(cached.manifest?.version ?? cached.version) != null
        ? { version: normalizeOptionalString(cached.manifest?.version ?? cached.version) }
        : {}),
      ...(pluginDiagnostics.length > 0 ? { diagnostics: pluginDiagnostics } : {})
    })
  }

  for (const root of [path.resolve(cwd, '.claude/plugins'), path.resolve(cwd, '.claude-code/plugins')]) {
    for (const child of await listSafeChildDirectories(root)) {
      let manifest
      try {
        manifest = await readSmallJsonObjectWithin(
          child.resolvedPath,
          path.resolve(child.resolvedPath, '.claude-plugin/plugin.json')
        )
      } catch {
        diagnostics.push({
          code: 'native_plugin_manifest_unreadable',
          level: 'warning',
          message: `Claude Code project plugin ${child.name} has an unreadable manifest.`
        })
        continue
      }
      if (manifest == null) continue
      const name = normalizeOptionalString(manifest.name) ?? child.name
      plugins.push({
        adapter: 'claude-code',
        capabilities,
        id: createNativeHostPluginId('claude-code', `project:${child.resolvedPath}`),
        name,
        scope: 'project',
        source: {
          displayPath: toHomeDisplayPath(realHome, child.displayPath),
          internalRoot: child.resolvedPath,
          kind: 'local-file'
        },
        state: 'enabled',
        ...(normalizeOptionalString(manifest.description) != null
          ? { description: normalizeOptionalString(manifest.description) }
          : {}),
        ...(normalizeOptionalString(manifest.displayName) != null
          ? { displayName: normalizeOptionalString(manifest.displayName) }
          : {}),
        ...(normalizeOptionalString(manifest.version) != null
          ? { version: normalizeOptionalString(manifest.version) }
          : {})
      })
    }
  }
  return { diagnostics, plugins }
}

const discoverSkills: NonNullable<AdapterNativePluginManager['discoverSkills']> = async ({ cwd, env }) => {
  const realHome = resolveRealUserHome(env)
  const claudeHome = resolveOptionalPath(env.CLAUDE_CONFIG_DIR) ?? path.resolve(realHome, '.claude')
  return {
    diagnostics: [],
    skills: await discoverNativeHostSkills({
      adapter: 'claude-code',
      realHome,
      roots: [
        { id: 'home-claude', path: path.resolve(claudeHome, 'skills'), scope: 'global' },
        { id: 'project-claude', path: path.resolve(cwd, '.claude', 'skills'), scope: 'project' },
        { id: 'project-claude-code', path: path.resolve(cwd, '.claude-code', 'skills'), scope: 'project' }
      ]
    })
  }
}

const manager: AdapterNativePluginManager = {
  adapter: 'claude-code',
  discoverSkills,
  displayName: 'Claude Code',
  discover
}

export default manager
