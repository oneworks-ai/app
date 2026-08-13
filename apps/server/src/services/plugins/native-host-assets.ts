import type { NativeHostPlugin, NativeHostPluginAssetGroup, NativeHostPluginAssetKind } from '@oneworks/types'
import { listNativeHostPluginAssetsWithin } from '@oneworks/utils'

const PUBLIC_NATIVE_ASSET_KINDS = new Set<NativeHostPluginAssetKind>([
  'agents',
  'apps',
  'commands',
  'docs',
  'entities',
  'hooks',
  'mcp',
  'rules',
  'scripts',
  'skills',
  'specs'
])

export const listSafeNativeHostPluginAssets = async (
  plugin: NativeHostPlugin
): Promise<NativeHostPluginAssetGroup[]> => {
  const root = plugin.source.internalRoot
  if (root == null || root === '') return []
  let groups: NativeHostPluginAssetGroup[]
  try {
    groups = await listNativeHostPluginAssetsWithin(root)
  } catch {
    throw new Error('Native plugin assets could not be read safely.')
  }
  return groups.slice(0, PUBLIC_NATIVE_ASSET_KINDS.size).flatMap((group) => {
    if (!PUBLIC_NATIVE_ASSET_KINDS.has(group.kind) || !Array.isArray(group.files)) return []
    const files = group.files.slice(0, 200).flatMap((file) => {
      if (
        file == null ||
        typeof file !== 'object' ||
        typeof file.path !== 'string' ||
        file.path.trim() === '' ||
        file.path.includes('\0') ||
        file.path.split('/').includes('..') ||
        file.path.startsWith('/') ||
        /^[a-z]:[\\/]/iu.test(file.path) ||
        (
          file.contentKind !== 'binary' &&
          file.contentKind !== 'markdown' &&
          file.contentKind !== 'text'
        ) ||
        !Number.isFinite(file.size) ||
        file.size < 0
      ) return []
      return [{
        contentKind: file.contentKind,
        path: file.path,
        size: file.size,
        ...(file.truncated !== true ? {} : { truncated: true }),
        ...(plugin.adapter === 'codex' && group.kind === 'apps'
          ? {}
          : typeof file.content !== 'string'
          ? {}
          : { content: file.content })
      }]
    })
    return files.length === 0 ? [] : [{ files, kind: group.kind }]
  })
}
