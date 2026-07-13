import path from 'node:path'

import type { AdapterNativePluginManager, NativeHostPluginDiagnostic } from '@oneworks/types'
import {
  createNativeHostPluginId,
  discoverNativeHostSkills,
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
  disable: 'unsupported',
  enable: 'unsupported',
  import: 'unsupported',
  install: 'read-only',
  uninstall: 'read-only',
  update: 'unsupported'
} as const

const readHomeManifest = async (root: string) => (
  await readSmallJsonObject(path.resolve(root, 'kimi.plugin.json')) ??
    await readSmallJsonObject(path.resolve(root, '.kimi-plugin/plugin.json')) ??
    await readSmallJsonObject(path.resolve(root, 'plugin.json'))
)

const readProjectManifest = async (root: string) => (
  await readSmallJsonObjectWithin(root, path.resolve(root, 'kimi.plugin.json')) ??
    await readSmallJsonObjectWithin(root, path.resolve(root, '.kimi-plugin/plugin.json'))
)

const discover: AdapterNativePluginManager['discover'] = async ({ cwd, env }) => {
  const diagnostics: NativeHostPluginDiagnostic[] = []
  const realHome = resolveRealUserHome(env)
  const kimiHome = resolveOptionalPath(
    env.KIMI_CODE_HOME ?? env.__ONEWORKS_PROJECT_ADAPTER_KIMI_SHARE_DIR__ ?? env.KIMI_SHARE_DIR
  ) ?? path.resolve(realHome, '.kimi')
  const plugins = []
  const pluginsRoot = path.resolve(kimiHome, 'plugins')
  for (const directoryName of await listChildDirectories(pluginsRoot)) {
    const root = path.resolve(pluginsRoot, directoryName)
    let manifest
    try {
      manifest = await readHomeManifest(root)
    } catch {
      diagnostics.push({
        code: 'native_plugin_manifest_unreadable',
        level: 'warning',
        message: `Kimi plugin ${directoryName} has an unreadable manifest.`
      })
      continue
    }
    if (manifest == null) continue
    const name = normalizeOptionalString(manifest.name) ?? directoryName
    plugins.push({
      adapter: 'kimi',
      capabilities,
      id: createNativeHostPluginId('kimi', `user:${root}`),
      name,
      scope: 'user' as const,
      source: {
        displayPath: toHomeDisplayPath(realHome, root),
        internalRoot: root,
        kind: 'installed-copy' as const
      },
      state: 'enabled' as const,
      ...(normalizeOptionalString(manifest.description) != null
        ? { description: normalizeOptionalString(manifest.description) }
        : {}),
      ...(normalizeOptionalString((manifest.interface as Record<string, unknown> | undefined)?.displayName) != null
        ? { displayName: normalizeOptionalString((manifest.interface as Record<string, unknown>).displayName) }
        : {}),
      ...(normalizeOptionalString(manifest.version) != null
        ? { version: normalizeOptionalString(manifest.version) }
        : {})
    })
  }

  const projectRoot = path.resolve(cwd, '.kimi', 'plugins')
  for (const child of await listSafeChildDirectories(projectRoot)) {
    let manifest
    try {
      manifest = await readProjectManifest(child.resolvedPath)
    } catch {
      diagnostics.push({
        code: 'native_plugin_manifest_unreadable',
        level: 'warning',
        message: `Kimi project plugin ${child.name} has an unreadable manifest.`
      })
      continue
    }
    if (manifest == null) continue
    const name = normalizeOptionalString(manifest.name) ?? child.name
    plugins.push({
      adapter: 'kimi',
      capabilities,
      id: createNativeHostPluginId('kimi', `project:${child.resolvedPath}`),
      name,
      scope: 'project' as const,
      source: {
        displayPath: toHomeDisplayPath(realHome, child.displayPath),
        internalRoot: child.resolvedPath,
        kind: 'local-file' as const
      },
      state: 'enabled' as const,
      ...(normalizeOptionalString(manifest.description) != null
        ? { description: normalizeOptionalString(manifest.description) }
        : {}),
      ...(normalizeOptionalString((manifest.interface as Record<string, unknown> | undefined)?.displayName) != null
        ? { displayName: normalizeOptionalString((manifest.interface as Record<string, unknown>).displayName) }
        : {}),
      ...(normalizeOptionalString(manifest.version) != null
        ? { version: normalizeOptionalString(manifest.version) }
        : {})
    })
  }
  return { diagnostics, plugins }
}

const discoverSkills: NonNullable<AdapterNativePluginManager['discoverSkills']> = async ({ cwd, env }) => {
  const realHome = resolveRealUserHome(env)
  const kimiHome = resolveOptionalPath(
    env.KIMI_CODE_HOME ?? env.__ONEWORKS_PROJECT_ADAPTER_KIMI_SHARE_DIR__ ?? env.KIMI_SHARE_DIR
  ) ?? path.resolve(realHome, '.kimi')
  return {
    diagnostics: [],
    skills: await discoverNativeHostSkills({
      adapter: 'kimi',
      realHome,
      roots: [
        { id: 'home-kimi', path: path.resolve(kimiHome, 'skills'), scope: 'global' },
        { id: 'project-kimi', path: path.resolve(cwd, '.kimi', 'skills'), scope: 'project' }
      ]
    })
  }
}

const manager: AdapterNativePluginManager = {
  adapter: 'kimi',
  discoverSkills,
  displayName: 'Kimi CLI',
  discover
}

export default manager
