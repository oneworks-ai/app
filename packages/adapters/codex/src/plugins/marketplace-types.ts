import type { IconRef } from '@oneworks/types'

export interface CodexMarketplacePluginDefinition {
  agents?: string[]
  commands?: string[]
  description?: string
  displayName?: string
  featured?: boolean
  icon?: IconRef
  installable?: boolean
  name: string
  nativeEnabled?: boolean
  nativeInstalled?: boolean
  skills?: string[]
  source: {
    source: 'local'
    path: string
  } | {
    source: 'app-server'
    marketplace: string
    pluginId: string
  }
  version?: string
}

export interface CodexMarketplaceCatalog {
  name?: string
  title?: string
  plugins: CodexMarketplacePluginDefinition[]
}

export interface CodexMarketplaceRuntime {
  cwd: string
  env: Record<string, string | null | undefined>
}
