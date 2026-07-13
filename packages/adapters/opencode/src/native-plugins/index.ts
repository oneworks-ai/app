import path from 'node:path'

import type { AdapterNativePluginManager, NativeHostPluginDiagnostic } from '@oneworks/types'
import {
  createNativeHostPluginId,
  discoverNativeHostSkills,
  listChildFiles,
  listSafeChildFiles,
  normalizeOptionalString,
  readSmallJsonObject,
  readSmallJsonObjectWithin,
  resolveOptionalPath,
  resolveRealUserHome,
  toHomeDisplayPath
} from '@oneworks/utils'

const capabilities = {
  discover: 'available',
  disable: 'unsupported',
  enable: 'unsupported',
  import: 'unsupported',
  install: 'unsupported',
  uninstall: 'unsupported',
  update: 'unsupported'
} as const
const localPluginExtensions = new Set(['.cjs', '.cts', '.js', '.mjs', '.mts', '.ts'])

const discover: AdapterNativePluginManager['discover'] = async ({ cwd, env }) => {
  const diagnostics: NativeHostPluginDiagnostic[] = []
  const realHome = resolveRealUserHome(env)
  const explicitConfigDir = resolveOptionalPath(env.OPENCODE_CONFIG_DIR)
  const xdgConfigDir = resolveOptionalPath(env.XDG_CONFIG_HOME)
  const configDir = explicitConfigDir ?? (
    xdgConfigDir == null ? path.resolve(realHome, '.config', 'opencode') : path.resolve(xdgConfigDir, 'opencode')
  )
  const plugins = []
  let config: Record<string, unknown> | undefined
  try {
    config = await readSmallJsonObject(path.resolve(configDir, 'opencode.json'))
  } catch {
    diagnostics.push({
      code: 'native_plugin_config_unreadable',
      level: 'warning',
      message: 'OpenCode plugin declarations could not be parsed.'
    })
  }
  if (Array.isArray(config?.plugin)) {
    for (const declaration of config.plugin) {
      const name = normalizeOptionalString(declaration)
      if (name == null) continue
      plugins.push({
        adapter: 'opencode',
        capabilities,
        id: createNativeHostPluginId('opencode', `user:npm:${name}:${path.resolve(configDir, 'opencode.json')}`),
        name,
        scope: 'user' as const,
        source: {
          displayPath: toHomeDisplayPath(realHome, path.resolve(configDir, 'opencode.json')),
          kind: 'npm-config' as const
        },
        state: 'enabled' as const
      })
    }
  }

  const localRoot = path.resolve(configDir, 'plugins')
  for (const fileName of await listChildFiles(localRoot)) {
    if (!localPluginExtensions.has(path.extname(fileName))) continue
    const root = path.resolve(localRoot, fileName)
    plugins.push({
      adapter: 'opencode',
      capabilities,
      id: createNativeHostPluginId('opencode', `user:local:${root}`),
      name: path.basename(fileName, path.extname(fileName)),
      scope: 'user' as const,
      source: {
        displayPath: toHomeDisplayPath(realHome, root),
        kind: 'local-file' as const
      },
      state: 'enabled' as const
    })
  }

  const projectConfigPath = path.resolve(cwd, 'opencode.json')
  let projectConfig: Record<string, unknown> | undefined
  try {
    projectConfig = await readSmallJsonObjectWithin(cwd, projectConfigPath)
  } catch {
    diagnostics.push({
      code: 'native_plugin_config_unreadable',
      level: 'warning',
      message: 'OpenCode project plugin declarations could not be parsed.'
    })
  }
  if (Array.isArray(projectConfig?.plugin)) {
    for (const declaration of projectConfig.plugin) {
      const name = normalizeOptionalString(declaration)
      if (name == null) continue
      plugins.push({
        adapter: 'opencode',
        capabilities,
        id: createNativeHostPluginId('opencode', `project:npm:${name}:${projectConfigPath}`),
        name,
        scope: 'project' as const,
        source: {
          displayPath: toHomeDisplayPath(realHome, projectConfigPath),
          kind: 'npm-config' as const
        },
        state: 'enabled' as const
      })
    }
  }

  const projectLocalRoot = path.resolve(cwd, '.opencode', 'plugins')
  for (const file of await listSafeChildFiles(projectLocalRoot)) {
    if (!localPluginExtensions.has(path.extname(file.name))) continue
    plugins.push({
      adapter: 'opencode',
      capabilities,
      id: createNativeHostPluginId('opencode', `project:local:${file.resolvedPath}`),
      name: path.basename(file.name, path.extname(file.name)),
      scope: 'project' as const,
      source: {
        displayPath: toHomeDisplayPath(realHome, file.displayPath),
        kind: 'local-file' as const
      },
      state: 'enabled' as const
    })
  }
  return { diagnostics, plugins }
}

const discoverSkills: NonNullable<AdapterNativePluginManager['discoverSkills']> = async ({ cwd, env }) => {
  const realHome = resolveRealUserHome(env)
  const explicitConfigDir = resolveOptionalPath(env.OPENCODE_CONFIG_DIR)
  const xdgConfigDir = resolveOptionalPath(env.XDG_CONFIG_HOME)
  const configDir = explicitConfigDir ?? (
    xdgConfigDir == null ? path.resolve(realHome, '.config', 'opencode') : path.resolve(xdgConfigDir, 'opencode')
  )
  return {
    diagnostics: [],
    skills: await discoverNativeHostSkills({
      adapter: 'opencode',
      realHome,
      roots: [
        { id: 'home-opencode', path: path.resolve(configDir, 'skills'), scope: 'global' },
        { id: 'project-opencode', path: path.resolve(cwd, '.opencode', 'skills'), scope: 'project' }
      ]
    })
  }
}

const manager: AdapterNativePluginManager = {
  adapter: 'opencode',
  discoverSkills,
  displayName: 'OpenCode',
  discover
}

export default manager
