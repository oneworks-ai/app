import { Buffer } from 'node:buffer'
import path from 'node:path'

import type { ManagedPluginInstallConfig, PluginRuntimeSource } from '@oneworks/types'
import {
  isSafePublicPluginIdentity,
  resolveManagedPluginPublicPackageId,
  resolveManagedPluginScope
} from '@oneworks/utils'

export interface ManagedPluginRuntimeIdentity {
  name: string
  packageId: string
  requestId: string
  scope: string
  source: PluginRuntimeSource
}

const normalizeManagedIdentityPart = (value: string | undefined) => {
  const normalized = value?.trim()
  if (
    normalized == null ||
    normalized === '' ||
    Buffer.byteLength(normalized, 'utf8') > 512 ||
    !isSafePublicPluginIdentity(normalized) ||
    path.isAbsolute(normalized) ||
    /(?:^|[\s=("'`[,;])(?:file:\/\/\/|[a-z]:[\\/]|\\\\|\/(?!\/))/iu.test(normalized) ||
    /^(?:file|https?|git(?:\+[^:]+)?|ssh):/iu.test(normalized) ||
    normalized.split(/[\\/]/u).includes('..')
  ) return undefined
  return normalized
}

export const toManagedPluginRuntimeIdentity = (
  config: ManagedPluginInstallConfig
): ManagedPluginRuntimeIdentity | undefined => {
  const adapter = normalizeManagedIdentityPart(config.adapter)
  const name = normalizeManagedIdentityPart(config.name)
  if (adapter == null || name == null) return undefined
  let scope
  try {
    scope = resolveManagedPluginScope({
      adapter: config.adapter,
      name: config.name,
      scope: config.scope,
      source: config.source
    })
  } catch {
    return undefined
  }
  if (config.source.type === 'npm') {
    const packageId = normalizeManagedIdentityPart(resolveManagedPluginPublicPackageId({
      adapter: config.adapter,
      name: config.name,
      source: config.source
    }))
    if (packageId == null) return undefined
    return {
      name,
      packageId,
      requestId: packageId,
      scope,
      source: {
        adapter,
        kind: 'package',
        plugin: packageId
      }
    }
  }
  if (config.source.type !== 'marketplace') {
    return {
      name,
      packageId: name,
      requestId: name,
      scope,
      source: { adapter, kind: 'directory' }
    }
  }
  const marketplace = normalizeManagedIdentityPart(config.source.marketplace)
  const plugin = normalizeManagedIdentityPart(config.source.plugin)
  if (marketplace == null || plugin == null) return undefined
  const packageId = `${plugin}@${marketplace}`
  return {
    name,
    packageId,
    requestId: packageId,
    scope,
    source: {
      adapter,
      kind: 'marketplace',
      marketplace,
      plugin
    }
  }
}
