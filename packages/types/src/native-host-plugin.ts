import type { PluginDetailAssetFile } from './plugin'

export type NativeHostPluginState = 'disabled' | 'enabled' | 'unknown'

export type NativeHostPluginScope = 'builtin' | 'local' | 'managed' | 'project' | 'unknown' | 'user'

export type NativeHostPluginSourceKind =
  | 'cache'
  | 'installed-copy'
  | 'local-file'
  | 'managed'
  | 'npm-config'

export type NativeHostPluginCapabilityStatus = 'available' | 'read-only' | 'unsupported'

export interface NativeHostPluginCapabilities {
  discover: NativeHostPluginCapabilityStatus
  disable: NativeHostPluginCapabilityStatus
  enable: NativeHostPluginCapabilityStatus
  import: NativeHostPluginCapabilityStatus
  install: NativeHostPluginCapabilityStatus
  uninstall: NativeHostPluginCapabilityStatus
  update: NativeHostPluginCapabilityStatus
}

export interface NativeHostPluginDiagnostic {
  adapter?: string
  code: string
  level: 'error' | 'info' | 'warning'
  message: string
}

export interface NativeHostPlugin {
  adapter: string
  capabilities: NativeHostPluginCapabilities
  description?: string
  diagnostics?: NativeHostPluginDiagnostic[]
  displayName?: string
  icon?: string
  id: string
  marketplace?: string
  name: string
  scope: NativeHostPluginScope
  source: {
    displayPath?: string
    /** Adapter-owned path for server-side asset discovery. Never expose through the public API. */
    internalRoot?: string
    kind: NativeHostPluginSourceKind
  }
  state: NativeHostPluginState
  version?: string
}

export interface NativeHostPluginDiscoveryResult {
  diagnostics: NativeHostPluginDiagnostic[]
  plugins: NativeHostPlugin[]
}

export type NativeHostSkillScope = 'global' | 'project'

export interface NativeHostSkill {
  adapter: string
  body: string
  description?: string
  id: string
  name: string
  scope: NativeHostSkillScope
  source: {
    displayPath?: string
    id: string
    type: 'adapter-home' | 'adapter-project'
  }
}

export interface NativeHostSkillRoot {
  id: string
  path: string
  scope: NativeHostSkillScope
}

export interface NativeHostSkillDiscoveryResult {
  diagnostics: NativeHostPluginDiagnostic[]
  skills: NativeHostSkill[]
}

export type NativeHostPluginAssetKind =
  | 'agents'
  | 'apps'
  | 'commands'
  | 'docs'
  | 'entities'
  | 'hooks'
  | 'mcp'
  | 'rules'
  | 'scripts'
  | 'skills'
  | 'specs'

export interface NativeHostPluginAssetGroup {
  files: PluginDetailAssetFile[]
  kind: NativeHostPluginAssetKind
}

export interface AdapterNativePluginDiscoveryContext {
  cwd: string
  env: Record<string, string | null | undefined>
}

export interface AdapterNativePluginManager {
  adapter: string
  discover: (
    context: AdapterNativePluginDiscoveryContext
  ) => Promise<NativeHostPluginDiscoveryResult>
  discoverSkills?: (
    context: AdapterNativePluginDiscoveryContext
  ) => Promise<NativeHostSkillDiscoveryResult>
  displayName?: string
}
