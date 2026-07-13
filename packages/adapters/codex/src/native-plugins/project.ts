import path from 'node:path'

import type { NativeHostPlugin } from '@oneworks/types'
import {
  createNativeHostPluginId,
  listSafeChildDirectories,
  normalizeOptionalString,
  readSmallJsonObjectWithin,
  toHomeDisplayPath
} from '@oneworks/utils'

import { codexNativePluginCapabilities as capabilities } from './capabilities.js'

export const discoverCodexProjectPlugins = async (
  cwd: string,
  realHome: string
) => {
  const root = path.resolve(cwd, '.codex', 'plugins')
  const plugins: Array<NativeHostPlugin & { resolvedPath: string }> = []
  for (const child of await listSafeChildDirectories(root)) {
    const manifest = await readSmallJsonObjectWithin(
      child.resolvedPath,
      path.resolve(child.resolvedPath, '.codex-plugin/plugin.json')
    )
    if (manifest == null) continue
    const name = normalizeOptionalString(manifest.name) ?? child.name
    plugins.push({
      adapter: 'codex',
      capabilities,
      id: createNativeHostPluginId('codex', `project:${child.resolvedPath}`),
      name,
      resolvedPath: child.resolvedPath,
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
      ...(normalizeOptionalString((manifest.interface as Record<string, unknown> | undefined)?.displayName) != null
        ? { displayName: normalizeOptionalString((manifest.interface as Record<string, unknown>).displayName) }
        : {}),
      ...(normalizeOptionalString(manifest.version) != null
        ? { version: normalizeOptionalString(manifest.version) }
        : {})
    })
  }
  return plugins
}
