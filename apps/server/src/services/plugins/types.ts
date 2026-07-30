import type {
  PluginConfigManifest,
  PluginContributionAvailability,
  PluginContributionManifest as SharedPluginContributionManifest,
  PluginNativeMetadata,
  PluginRuntimeApiRegistration,
  PluginRuntimeSource,
  PluginRuntimeSourceGroup,
  PluginServerRuntimeRole
} from '@oneworks/types'

export type {
  PluginApiDocumentation,
  PluginApiRegistration,
  PluginCommandHandler,
  PluginCommandInvocation,
  PluginProxyHandler,
  PluginProxyRequest,
  PluginProxyResponse,
  PluginRuntimeChannelHandler,
  PluginServerContext,
  PluginSessionAdapter,
  PluginSessionSubmitInput
} from './plugin-server-types'

export type { PublicPluginDiagnostic, PublicPluginRuntimeInstance, PublicPluginRuntimeManifest } from '@oneworks/types'

export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export type PluginDiagnosticLevel = 'error' | 'info' | 'warning'

export interface PluginDiagnostic {
  level: PluginDiagnosticLevel
  code: string
  message: string
  scope?: string
  pluginRoot?: string
  details?: unknown
}

export interface PluginClientManifest {
  entry?: string
  root?: string
  devEntry?: string
  devServer?: string
  sourceRoot?: string
}

export interface PluginServerManifest {
  entry?: string
  roles: PluginServerRuntimeRole[]
}

export interface PluginContributionLauncherSearchProvider extends PluginContributionAvailability {
  id: string
  title: string
  command: string
}

export interface PluginContributionManifest extends SharedPluginContributionManifest {
  menuItems?: unknown[]
  [key: string]: unknown
}

export interface PluginRuntimeManifest {
  assets?: {
    apps?: string
    entities?: string
    hooks?: string
    mcp?: string
    rules?: string
    skills?: string
    specs?: string
  }
  name?: string
  displayName?: string
  displayNameI18n?: Record<string, string>
  description?: string
  descriptionI18n?: Record<string, string>
  icon?: string
  version?: string
  config?: PluginConfigManifest
  native?: PluginNativeMetadata
  source?: PluginRuntimeSource
  plugin?: {
    client?: PluginClientManifest
    server?: PluginServerManifest
    contributions?: PluginContributionManifest
  }
}

export interface PluginRuntimeInstance {
  scope: string
  name: string
  displayName?: string
  displayNameI18n?: Record<string, string>
  description?: string
  descriptionI18n?: Record<string, string>
  icon?: string
  requestedVersion?: string
  version?: string
  requestId: string
  packageId?: string
  source?: PluginRuntimeSource
  sourceGroup?: PluginRuntimeSourceGroup
  watch?: {
    enabled: boolean
  }
  options?: Record<string, unknown>
  manifest?: PluginRuntimeManifest
  pluginRoot: string
  client?: PluginClientManifest & {
    clientEntryUrl?: string
    devClientEntryUrl?: string
    devClientEntryKind?: 'dev-server' | 'host-vite' | 'runtime-source'
  }
  apis?: PluginRuntimeApiRegistration[]
  contributions?: PluginContributionManifest
  diagnostics: PluginDiagnostic[]
  enabled: boolean
}
