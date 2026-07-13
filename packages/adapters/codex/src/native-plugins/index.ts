/* eslint-disable max-lines -- Codex discovery coordinates CLI, config fallback, project roots, and remote install markers. */

import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

import type { AdapterNativePluginManager, NativeHostPlugin, NativeHostPluginDiagnostic } from '@oneworks/types'
import {
  createNativeHostPluginId,
  discoverNativeHostSkills,
  findFirstJsonManifest,
  listChildDirectories,
  listSafeChildDirectories,
  normalizeOptionalString,
  readNativeIconDataUrlWithin,
  readSmallJsonObjectWithin,
  resolveOptionalPath,
  resolveRealUserHome,
  toHomeDisplayPath
} from '@oneworks/utils'

import { resolveCodexPluginBinaryPath } from '../plugins/app-server-marketplace.js'
import { codexNativePluginCapabilities as capabilities } from './capabilities.js'
import { listCodexPlugins } from './cli.js'
import { discoverCodexProjectPlugins } from './project.js'

type CodexProjectPlugin = Awaited<ReturnType<typeof discoverCodexProjectPlugins>>[number]

const omitResolvedPath = ({ resolvedPath: _resolvedPath, ...plugin }: CodexProjectPlugin): NativeHostPlugin => plugin

const readPluginPresentation = async (root: string, manifest?: Record<string, unknown>) => {
  const resolvedManifest = manifest ?? await readSmallJsonObjectWithin(
    root,
    path.resolve(root, '.codex-plugin/plugin.json')
  )
  const pluginInterface = resolvedManifest?.interface != null &&
      typeof resolvedManifest.interface === 'object' &&
      !Array.isArray(resolvedManifest.interface)
    ? resolvedManifest.interface as Record<string, unknown>
    : undefined
  const iconRef = normalizeOptionalString(pluginInterface?.composerIcon) ??
    normalizeOptionalString(pluginInterface?.logo) ??
    normalizeOptionalString(pluginInterface?.logoDark)
  return {
    description: normalizeOptionalString(pluginInterface?.shortDescription) ??
      normalizeOptionalString(resolvedManifest?.description),
    displayName: normalizeOptionalString(pluginInterface?.displayName),
    icon: await readNativeIconDataUrlWithin(root, iconRef),
    version: normalizeOptionalString(resolvedManifest?.version)
  }
}

const parsePluginStates = (content: string) => {
  const states = new Map<string, boolean>()
  let currentPlugin: string | undefined
  for (const line of content.replaceAll('\r\n', '\n').split('\n')) {
    const header = /^\s*\[plugins\."((?:\\.|[^"\\])+)"\]\s*(?:#.*)?$/u.exec(line)
    if (header != null) {
      try {
        currentPlugin = JSON.parse(`"${header[1]}"`) as string
      } catch {
        currentPlugin = undefined
      }
      continue
    }
    if (/^\s*\[/u.test(line)) currentPlugin = undefined
    const enabled = /^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/u.exec(line)
    if (currentPlugin != null && enabled != null) states.set(currentPlugin, enabled[1] === 'true')
  }
  return states
}

const readCachedPlugin = async (params: {
  cacheRoot: string
  marketplace: string
  pluginName: string
  realHome: string
}) => {
  const pluginCacheRoot = path.resolve(params.cacheRoot, params.marketplace, params.pluginName)
  const versions = (await listChildDirectories(pluginCacheRoot))
    .filter(version => !version.startsWith('.'))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
  const candidates = []
  for (const version of versions) {
    const root = path.resolve(pluginCacheRoot, version)
    const manifest = await findFirstJsonManifest(root, ['.codex-plugin/plugin.json'])
    if (manifest != null) candidates.push({ root, version, manifest: manifest.manifest })
  }
  return {
    selected: candidates[0],
    diagnostics: candidates.length > 1
      ? [{
        code: 'native_plugin_old_cache_ignored',
        level: 'info' as const,
        message: `${candidates.length - 1} older cached version(s) were ignored.`
      }]
      : [],
    displayPath: toHomeDisplayPath(params.realHome, candidates[0]?.root ?? pluginCacheRoot)
  }
}

const discoverFromConfig = async (params: {
  codexHome: string
  diagnostics: NativeHostPluginDiagnostic[]
  realHome: string
}) => {
  let states: Map<string, boolean>
  try {
    states = parsePluginStates(await readFile(path.resolve(params.codexHome, 'config.toml'), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    params.diagnostics.push({
      code: 'native_plugin_config_unreadable',
      level: 'warning',
      message: 'Codex plugin state could not be read; cached entries were not treated as installed.'
    })
    return []
  }

  const plugins: NativeHostPlugin[] = []
  for (const [pluginId, enabled] of states) {
    const separator = pluginId.lastIndexOf('@')
    if (separator <= 0 || separator === pluginId.length - 1) continue
    const pluginName = pluginId.slice(0, separator)
    const marketplace = pluginId.slice(separator + 1)
    const cached = await readCachedPlugin({
      cacheRoot: path.resolve(params.codexHome, 'plugins', 'cache'),
      marketplace,
      pluginName,
      realHome: params.realHome
    })
    const manifest = cached.selected?.manifest
    const presentation = cached.selected == null
      ? undefined
      : await readPluginPresentation(cached.selected.root, manifest)
    const pluginDiagnostics: NativeHostPluginDiagnostic[] = [...cached.diagnostics]
    if (manifest == null) {
      pluginDiagnostics.push({
        code: 'native_plugin_content_missing',
        level: 'warning',
        message: 'The plugin is configured, but no installed manifest was found.'
      })
    }
    const isHostManaged = marketplace === 'openai-bundled' || marketplace === 'openai-primary-runtime'
    plugins.push({
      adapter: 'codex',
      capabilities,
      id: createNativeHostPluginId('codex', `user:${pluginId}:${cached.selected?.root ?? ''}`),
      marketplace,
      name: pluginName,
      scope: isHostManaged ? 'builtin' : 'user',
      source: {
        displayPath: cached.displayPath,
        ...(cached.selected == null ? {} : { internalRoot: cached.selected.root }),
        kind: isHostManaged ? 'managed' : 'cache'
      },
      state: enabled ? 'enabled' : 'disabled',
      ...(presentation?.description == null ? {} : { description: presentation.description }),
      ...(presentation?.displayName == null ? {} : { displayName: presentation.displayName }),
      ...(presentation?.icon == null ? {} : { icon: presentation.icon }),
      ...(presentation?.version == null && cached.selected?.version == null
        ? {}
        : { version: presentation?.version ?? cached.selected?.version }),
      ...(pluginDiagnostics.length > 0 ? { diagnostics: pluginDiagnostics } : {})
    })
  }
  return plugins
}

const discoverRemoteInstalledPlugins = async (params: {
  codexHome: string
  realHome: string
}) => {
  const cacheRoot = path.resolve(params.codexHome, 'plugins', 'cache')
  const plugins: NativeHostPlugin[] = []
  for (const marketplaceEntry of await listSafeChildDirectories(cacheRoot)) {
    for (const pluginEntry of await listSafeChildDirectories(marketplaceEntry.resolvedPath)) {
      const installMarker = await readSmallJsonObjectWithin(
        pluginEntry.resolvedPath,
        path.resolve(pluginEntry.resolvedPath, '.codex-remote-plugin-install.json')
      )
      const remotePluginId = normalizeOptionalString(installMarker?.remote_plugin_id)
      if (remotePluginId == null) continue
      const cached = await readCachedPlugin({
        cacheRoot,
        marketplace: marketplaceEntry.name,
        pluginName: pluginEntry.name,
        realHome: params.realHome
      })
      if (cached.selected == null) continue
      const presentation = await readPluginPresentation(cached.selected.root, cached.selected.manifest)
      plugins.push({
        adapter: 'codex',
        capabilities,
        id: createNativeHostPluginId('codex', `remote:${remotePluginId}`),
        marketplace: marketplaceEntry.name,
        name: pluginEntry.name,
        scope: 'user',
        source: {
          displayPath: cached.displayPath,
          internalRoot: cached.selected.root,
          kind: 'installed-copy'
        },
        state: 'enabled',
        ...(presentation.description == null ? {} : { description: presentation.description }),
        ...(presentation.displayName == null ? {} : { displayName: presentation.displayName }),
        ...(presentation.icon == null ? {} : { icon: presentation.icon }),
        ...(presentation.version == null ? {} : { version: presentation.version }),
        ...(cached.diagnostics.length === 0 ? {} : { diagnostics: cached.diagnostics })
      })
    }
  }
  return plugins
}

const discover: AdapterNativePluginManager['discover'] = async ({ cwd, env }) => {
  const diagnostics: NativeHostPluginDiagnostic[] = []
  const realHome = resolveRealUserHome(env)
  const codexHome = resolveOptionalPath(env.CODEX_HOME) ?? path.resolve(realHome, '.codex')
  const projectPlugins = await discoverCodexProjectPlugins(cwd, realHome)
  const remoteInstalledPlugins = await discoverRemoteInstalledPlugins({ codexHome, realHome })
  try {
    const cliCwd = await realpath(cwd).catch(() => realHome)
    const cliPlugins = await listCodexPlugins(cliCwd, env, resolveCodexPluginBinaryPath(env, cwd))
    const projectByPath = new Map(projectPlugins.map(plugin => [plugin.resolvedPath, plugin]))
    const plugins: NativeHostPlugin[] = []
    const matchedProjectPaths = new Set<string>()
    for (const cliPlugin of cliPlugins) {
      if (!cliPlugin.installed) continue
      const resolvedSource = cliPlugin.sourcePath == null
        ? undefined
        : await realpath(cliPlugin.sourcePath).catch(() => path.resolve(cliPlugin.sourcePath as string))
      const projectPlugin = resolvedSource == null ? undefined : projectByPath.get(resolvedSource)
      if (projectPlugin != null) matchedProjectPaths.add(projectPlugin.resolvedPath)
      const marketplace = cliPlugin.marketplaceName ?? (() => {
        const separator = cliPlugin.pluginId.lastIndexOf('@')
        return separator > 0 ? cliPlugin.pluginId.slice(separator + 1) : undefined
      })()
      const isHostManaged = marketplace === 'openai-bundled' || marketplace === 'openai-primary-runtime'
      const presentation = resolvedSource == null ? undefined : await readPluginPresentation(resolvedSource)
      plugins.push({
        ...(projectPlugin == null ? {} : omitResolvedPath(projectPlugin)),
        adapter: 'codex',
        capabilities,
        id: createNativeHostPluginId(
          'codex',
          `${projectPlugin == null ? 'cli' : 'project'}:${cliPlugin.pluginId}:${resolvedSource ?? ''}`
        ),
        ...(marketplace == null ? {} : { marketplace }),
        name: cliPlugin.name,
        scope: projectPlugin == null ? (isHostManaged ? 'builtin' : 'user') : 'project',
        source: projectPlugin?.source ?? {
          ...(cliPlugin.sourcePath == null ? {} : { displayPath: toHomeDisplayPath(realHome, cliPlugin.sourcePath) }),
          ...(resolvedSource == null ? {} : { internalRoot: resolvedSource }),
          kind: isHostManaged ? 'managed' : 'installed-copy'
        },
        state: cliPlugin.enabled ? 'enabled' : 'disabled',
        ...(presentation?.description == null ? {} : { description: presentation.description }),
        ...(presentation?.displayName == null ? {} : { displayName: presentation.displayName }),
        ...(presentation?.icon == null ? {} : { icon: presentation.icon }),
        ...(cliPlugin.version == null && presentation?.version == null
          ? {}
          : { version: cliPlugin.version ?? presentation?.version })
      })
    }
    const cliPluginKeys = new Set(plugins.map(plugin => `${plugin.marketplace ?? ''}\0${plugin.name}`))
    plugins.push(
      ...remoteInstalledPlugins.filter(plugin => !cliPluginKeys.has(`${plugin.marketplace ?? ''}\0${plugin.name}`)),
      ...projectPlugins
        .filter(plugin => !matchedProjectPaths.has(plugin.resolvedPath))
        .map(omitResolvedPath)
    )
    return { diagnostics, plugins }
  } catch {
    diagnostics.push({
      code: 'native_plugin_cli_failed',
      level: 'warning',
      message: 'Codex plugin list could not be used; configuration fallback was used.'
    })
    const fallback = await discoverFromConfig({ codexHome, diagnostics, realHome })
    const configuredPluginKeys = new Set(
      fallback.map(plugin => `${plugin.marketplace ?? ''}\0${plugin.name}`)
    )
    return {
      diagnostics,
      plugins: [
        ...fallback,
        ...remoteInstalledPlugins.filter(
          plugin => !configuredPluginKeys.has(`${plugin.marketplace ?? ''}\0${plugin.name}`)
        ),
        ...projectPlugins.map(({ resolvedPath: _resolvedPath, ...plugin }) => plugin)
      ]
    }
  }
}

const discoverSkills: NonNullable<AdapterNativePluginManager['discoverSkills']> = async ({ cwd, env }) => {
  const realHome = resolveRealUserHome(env)
  const codexHome = resolveOptionalPath(env.CODEX_HOME) ?? path.resolve(realHome, '.codex')
  return {
    diagnostics: [],
    skills: await discoverNativeHostSkills({
      adapter: 'codex',
      realHome,
      roots: [
        { id: 'home-agents', path: path.resolve(realHome, '.agents', 'skills'), scope: 'global' },
        { id: 'home-codex', path: path.resolve(codexHome, 'skills'), scope: 'global' },
        { id: 'project-agents', path: path.resolve(cwd, '.agents', 'skills'), scope: 'project' },
        { id: 'project-codex', path: path.resolve(cwd, '.codex', 'skills'), scope: 'project' }
      ]
    })
  }
}

const manager: AdapterNativePluginManager = {
  adapter: 'codex',
  discoverSkills,
  displayName: 'Codex',
  discover
}

export default manager
