import path from 'node:path'

import type { AdapterNativePluginManager, NativeHostPlugin, NativeHostPluginDiagnostic } from '@oneworks/types'
import {
  createNativeHostPluginId,
  discoverNativeHostSkills,
  findFirstJsonManifest,
  listChildDirectories,
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
  import: 'unsupported',
  install: 'read-only',
  uninstall: 'read-only',
  update: 'read-only'
} as const
const manifestCandidates = [
  '.plugin/plugin.json',
  'plugin.json',
  '.github/plugin/plugin.json',
  '.claude-plugin/plugin.json'
]

const readSettings = async (copilotHome: string) => {
  const settings = await readSmallJsonObject(path.resolve(copilotHome, 'settings.json'))
  return settings ?? await readSmallJsonObject(path.resolve(copilotHome, 'config.json'))
}

const discover: AdapterNativePluginManager['discover'] = async ({ cwd, env }) => {
  const diagnostics: NativeHostPluginDiagnostic[] = []
  const realHome = resolveRealUserHome(env)
  const copilotHome = resolveOptionalPath(env.COPILOT_HOME) ?? path.resolve(realHome, '.copilot')
  let enabledPlugins: Record<string, unknown> = {}
  try {
    const settings = await readSettings(copilotHome)
    if (
      settings?.enabledPlugins != null && typeof settings.enabledPlugins === 'object' &&
      !Array.isArray(settings.enabledPlugins)
    ) {
      enabledPlugins = settings.enabledPlugins as Record<string, unknown>
    }
  } catch {
    diagnostics.push({
      code: 'native_plugin_config_unreadable',
      level: 'warning',
      message: 'Copilot plugin settings could not be parsed; installed plugins default to enabled.'
    })
  }

  const plugins: NativeHostPlugin[] = []
  const installedRoot = path.resolve(copilotHome, 'installed-plugins')
  for (const marketplace of await listChildDirectories(installedRoot)) {
    const marketplaceRoot = path.resolve(installedRoot, marketplace)
    for (const installId of await listChildDirectories(marketplaceRoot)) {
      const root = path.resolve(marketplaceRoot, installId)
      let found
      try {
        found = await findFirstJsonManifest(root, manifestCandidates)
      } catch {
        diagnostics.push({
          code: 'native_plugin_manifest_unreadable',
          level: 'warning',
          message: `Copilot plugin ${installId} has an unreadable manifest.`
        })
        continue
      }
      if (found == null) continue
      const name = normalizeOptionalString(found.manifest.name) ?? installId
      const stateKey = marketplace === '_direct' ? name : `${name}@${marketplace}`
      const declaredState = enabledPlugins[stateKey]
      plugins.push({
        adapter: 'copilot',
        capabilities,
        id: createNativeHostPluginId('copilot', `user:${marketplace}/${installId}:${root}`),
        ...(marketplace === '_direct' ? {} : { marketplace }),
        name,
        scope: 'user',
        source: {
          displayPath: toHomeDisplayPath(realHome, root),
          internalRoot: root,
          kind: 'installed-copy'
        },
        state: declaredState === false ? 'disabled' : 'enabled',
        ...(normalizeOptionalString(found.manifest.description) != null
          ? { description: normalizeOptionalString(found.manifest.description) }
          : {}),
        ...(normalizeOptionalString(found.manifest.version) != null
          ? { version: normalizeOptionalString(found.manifest.version) }
          : {})
      })
    }
  }

  const projectDeclarations = new Map<string, { enabled: boolean; settingsPath: string }>()
  // Sources are ordered from lowest to highest precedence; local and Claude-compatible layers win last.
  const projectSettingsPaths = [
    path.resolve(cwd, '.github/copilot/settings.json'),
    path.resolve(cwd, '.github/copilot/settings.local.json'),
    path.resolve(cwd, '.claude/settings.json'),
    path.resolve(cwd, '.claude/settings.local.json')
  ]
  for (const settingsPath of projectSettingsPaths) {
    let settings
    try {
      settings = await readSmallJsonObjectWithin(cwd, settingsPath)
    } catch {
      diagnostics.push({
        code: 'native_plugin_config_unreadable',
        level: 'warning',
        message: 'Copilot project plugin settings could not be parsed.'
      })
      continue
    }
    const declarations = settings?.enabledPlugins
    if (declarations == null || typeof declarations !== 'object' || Array.isArray(declarations)) continue
    for (const [pluginId, enabled] of Object.entries(declarations)) {
      if (typeof enabled !== 'boolean') continue
      projectDeclarations.set(pluginId, { enabled, settingsPath })
    }
  }
  for (const [pluginId, declaration] of projectDeclarations) {
    const separator = pluginId.lastIndexOf('@')
    const name = separator > 0 ? pluginId.slice(0, separator) : pluginId
    const marketplace = separator > 0 ? pluginId.slice(separator + 1) : undefined
    const installed = plugins.find(plugin =>
      plugin.scope === 'user' && plugin.name === name &&
      plugin.marketplace === marketplace
    )
    plugins.push({
      adapter: 'copilot',
      capabilities,
      id: createNativeHostPluginId(
        'copilot',
        `project:${pluginId}:${installed?.source.internalRoot ?? ''}`
      ),
      ...(marketplace == null ? {} : { marketplace }),
      name,
      scope: 'project',
      source: {
        displayPath: toHomeDisplayPath(realHome, declaration.settingsPath),
        ...(installed?.source.internalRoot == null ? {} : { internalRoot: installed.source.internalRoot }),
        kind: 'local-file'
      },
      state: declaration.enabled ? 'enabled' : 'disabled',
      ...(installed?.description == null ? {} : { description: installed.description }),
      ...(installed?.displayName == null ? {} : { displayName: installed.displayName }),
      ...(installed?.version == null ? {} : { version: installed.version })
    })
  }
  return { diagnostics, plugins }
}

const discoverSkills: NonNullable<AdapterNativePluginManager['discoverSkills']> = async ({ cwd, env }) => {
  const realHome = resolveRealUserHome(env)
  const copilotHome = resolveOptionalPath(env.COPILOT_HOME) ?? path.resolve(realHome, '.copilot')
  return {
    diagnostics: [],
    skills: await discoverNativeHostSkills({
      adapter: 'copilot',
      realHome,
      roots: [
        { id: 'home-copilot', path: path.resolve(copilotHome, 'skills'), scope: 'global' },
        { id: 'project-github', path: path.resolve(cwd, '.github', 'skills'), scope: 'project' },
        { id: 'project-copilot', path: path.resolve(cwd, '.copilot', 'skills'), scope: 'project' }
      ]
    })
  }
}

const manager: AdapterNativePluginManager = {
  adapter: 'copilot',
  discoverSkills,
  displayName: 'GitHub Copilot CLI',
  discover
}

export default manager
