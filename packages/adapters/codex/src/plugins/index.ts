import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'

import { convertClaudePluginToOneWorks } from '@oneworks/adapter-claude-code/plugins'
import type { AdapterPluginInstaller, ManagedPluginSource, PluginManifest, PluginRuntimeSource } from '@oneworks/types'
import {
  isCredentialLikeNativeAppValue,
  isSafePublicPluginIdentity,
  resolveManagedPluginPublicPackageId
} from '@oneworks/utils'

import { collectCodexAppMetadata } from './app-metadata'
import { resolveCodexMarketplaceInstallSource } from './marketplace'
import { loadCodexMarketplaceCatalogFromSource } from './marketplace-catalog'
import type { CodexPluginManifest } from './source'
import { detectCodexPluginRoot, mergeCodexPluginManifest, parseCodexPluginManifest } from './source'

const normalizeManifestString = (value: unknown, maxBytes: number) => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized !== '' && Buffer.byteLength(normalized, 'utf8') <= maxBytes ? normalized : undefined
}

const isUnsafeManifestIdentity = (value: string) => (
  path.isAbsolute(value) ||
  /(?:^|[\s=("'`[,;])(?:file:\/\/\/|[a-z]:[\\/]|\\\\|\/(?!\/))/iu.test(value) ||
  value.split(/[\\/]/u).includes('..')
)

const normalizePublicManifestString = (value: unknown, maxBytes: number) => {
  const normalized = normalizeManifestString(value, maxBytes)
  return normalized == null ||
      isUnsafeManifestIdentity(normalized) ||
      isCredentialLikeNativeAppValue(normalized) ||
      !isSafePublicPluginIdentity(normalized)
    ? undefined
    : normalized
}

const toRuntimeSource = (
  source: ManagedPluginSource,
  pluginName: string
): PluginRuntimeSource => {
  if (source.type === 'marketplace') {
    const marketplace = normalizePublicManifestString(source.marketplace, 512)
    const plugin = normalizePublicManifestString(source.plugin, 512)
    if (marketplace == null || plugin == null) throw new Error('Codex marketplace identity is invalid.')
    return { adapter: 'codex', kind: 'marketplace', marketplace, plugin }
  }
  return {
    adapter: 'codex',
    kind: source.type === 'npm' ? 'package' : 'directory',
    ...(source.type !== 'npm'
      ? {}
      : {
        plugin: resolveManagedPluginPublicPackageId({
          adapter: 'codex',
          name: pluginName,
          source
        })
      })
  }
}

const toGeneratedAssetManifest = async (oneworksRoot: string): Promise<PluginManifest['assets']> => {
  const assets: NonNullable<PluginManifest['assets']> = {}
  for (const key of ['apps', 'entities', 'hooks', 'mcp', 'skills'] as const) {
    try {
      if ((await fs.stat(path.join(oneworksRoot, key))).isDirectory()) assets[key] = key
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('Generated Codex plugin assets could not be inspected safely.')
      }
    }
  }
  return assets
}

const writeGeneratedAppMetadata = async (
  oneworksRoot: string,
  files: Array<{ content: string; path: string }>
) => {
  const appsRoot = path.resolve(oneworksRoot, 'apps')
  const targets = new Set<string>()
  for (const file of files) {
    const target = path.resolve(appsRoot, file.path)
    const relative = path.relative(appsRoot, target)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Generated Codex app metadata must stay within the OneWorks apps directory.')
    }
    if (targets.has(target)) throw new Error('Generated Codex app metadata paths collide.')
    targets.add(target)
    try {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, file.content, { encoding: 'utf8', flag: 'wx' })
    } catch {
      throw new Error('Generated Codex app metadata could not be written safely.')
    }
  }
}

const convertCodexPluginToOneWorks: AdapterPluginInstaller<CodexPluginManifest>['convertToOneWorks'] = async (
  params
) => {
  const manifest = params.manifest == null
    ? undefined
    : {
      ...params.manifest,
      ...(params.manifest.hooks == null ? { hooks: './hooks.json' } : {}),
      ...(params.manifest.mcpServers == null ? { mcpServers: './.mcp.json' } : {})
    }
  await convertClaudePluginToOneWorks({ ...params, manifest })
  const appMetadata = await collectCodexAppMetadata(params.nativePluginRoot, manifest)
  await writeGeneratedAppMetadata(params.oneworksRoot, appMetadata.generatedFiles)
  const diagnostics = [...appMetadata.diagnostics]
  const version = normalizePublicManifestString(manifest?.version, 128)
  if (version == null) {
    diagnostics.push({
      code: 'codex_plugin_version_missing',
      level: 'warning',
      message: 'The Codex plugin does not declare a version.'
    })
  }
  const displayName = normalizePublicManifestString(
    manifest?.displayName ?? manifest?.interface?.displayName,
    512
  )
  const description = normalizePublicManifestString(
    manifest?.interface?.shortDescription ?? manifest?.description,
    16 * 1024
  )
  const generatedManifest: PluginManifest = {
    __oneWorksPluginManifest: true,
    name: params.pluginName,
    ...(displayName == null ? {} : { displayName }),
    ...(description == null ? {} : { description }),
    version: version ?? '0.0.0',
    assets: await toGeneratedAssetManifest(params.oneworksRoot),
    native: {
      adapter: 'codex',
      ...(appMetadata.apps.length === 0 ? {} : { apps: appMetadata.apps }),
      ...(diagnostics.length === 0 ? {} : { diagnostics })
    },
    source: toRuntimeSource(params.source, params.pluginName)
  }
  try {
    await fs.writeFile(
      path.join(params.oneworksRoot, 'plugin.json'),
      `${JSON.stringify(generatedManifest, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' }
    )
  } catch {
    throw new Error('Generated Codex plugin metadata could not be written safely.')
  }
}

export const codexPluginInstaller: AdapterPluginInstaller<CodexPluginManifest> = {
  adapter: 'codex',
  displayName: 'Codex',
  resolveSource: resolveCodexMarketplaceInstallSource,
  detectPluginRoot: detectCodexPluginRoot,
  readManifest: parseCodexPluginManifest,
  mergeManifest: mergeCodexPluginManifest,
  validateManifest: ({ manifest }) => {
    const name = normalizePublicManifestString(manifest?.name, 256)
    if (name == null || isUnsafeManifestIdentity(name)) {
      throw new Error('Codex plugin metadata must declare a non-empty name no longer than 256 bytes.')
    }
  },
  getPluginName: ({ manifest }) => normalizePublicManifestString(manifest?.name, 256)!,
  convertToOneWorks: convertCodexPluginToOneWorks,
  formatInstallSummary: params => [`Installed Codex plugin: ${params.pluginName}`]
}

export default codexPluginInstaller

export { loadCodexMarketplaceCatalogFromSource }
export { CODEX_BUILT_IN_PLUGIN_MARKETPLACES } from './built-in-marketplaces'
export { getEffectiveCodexMarketplace } from './marketplace'
export type { CodexMarketplaceCatalog, CodexMarketplacePluginDefinition } from './marketplace-catalog'
