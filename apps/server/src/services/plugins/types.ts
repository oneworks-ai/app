import type { Buffer } from 'node:buffer'
import type { IncomingHttpHeaders } from 'node:http'

import type {
  ConfigJsonSchema,
  PluginConfigManifest,
  PluginLocalizedText,
  PluginRuntimeApiRegistration
} from '@oneworks/types'

export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export type PluginDiagnosticLevel = 'error' | 'warning'

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
}

export interface PluginServerManifest {
  entry?: string
}

export interface PluginContributionLauncherSearchProvider {
  id: string
  title?: string
  command: string
}

export interface PluginContributionManifest {
  navItems?: unknown[]
  menuItems?: unknown[]
  chatHeaderActions?: unknown[]
  chatInteractionPanelEmptyActions?: unknown[]
  workbenchTabs?: unknown[]
  workspaceDrawerTabs?: unknown[]
  launcherSearchProviders?: PluginContributionLauncherSearchProvider[]
  [key: string]: unknown
}

export interface PluginRuntimeManifest {
  assets?: {
    hooks?: string
    mcp?: string
    skills?: string
  }
  name?: string
  displayName?: string
  version?: string
  config?: PluginConfigManifest
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
  requestedVersion?: string
  version?: string
  requestId: string
  packageId?: string
  sourceGroup?: 'builtIn' | 'global' | 'local' | 'localDev'
  watch?: {
    enabled: boolean
  }
  options?: Record<string, unknown>
  manifest?: PluginRuntimeManifest
  pluginRoot: string
  client?: PluginClientManifest & {
    clientEntryUrl?: string
    devClientEntryUrl?: string
  }
  apis?: PluginRuntimeApiRegistration[]
  contributions?: PluginContributionManifest
  diagnostics: PluginDiagnostic[]
  enabled: boolean
}

export interface PluginCommandInvocation {
  payload?: unknown
}

export type PluginCommandHandler = (payload: unknown) => unknown | Promise<unknown>

export interface PluginProxyRequest {
  method: string
  path: string
  query: string
  headers: IncomingHttpHeaders
  body: Buffer
}

export interface PluginProxyResponse {
  status?: number
  headers?: Record<string, string | string[] | undefined>
  body?: unknown
}

export type PluginProxyHandler = (request: PluginProxyRequest) => PluginProxyResponse | Promise<PluginProxyResponse>

export interface PluginApiDocumentation {
  desc?: PluginLocalizedText
  description?: PluginLocalizedText
  headerSchema?: ConfigJsonSchema
  inputSchema?: ConfigJsonSchema
  outputSchema?: ConfigJsonSchema
  title?: PluginLocalizedText
}

export interface PluginApiRegistration extends PluginApiDocumentation {
  apiId: string
  handler?: PluginProxyHandler
  proxy?: {
    target: string
  }
}

export interface PluginSessionSubmitInput {
  sessionId: string
  message: string
  mode?: string
  requestId?: string
}

export interface PluginSessionAdapter {
  listSessions: () => unknown[] | Promise<unknown[]>
  submitMessage: (input: PluginSessionSubmitInput) => unknown | Promise<unknown>
}

export interface PluginServerContext {
  scope: string
  pluginRoot: string
  workspaceFolder: string
  projectHome: string
  options: Record<string, unknown>
  sessions?: PluginSessionAdapter
  logger: {
    info: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
  }
  registerCommand: (commandId: string, handler: PluginCommandHandler) => void
  registerApi: (apiId: string, options: Omit<PluginApiRegistration, 'apiId'>) => void
  registerLocalService: (serviceId: string, start: () => unknown | Promise<unknown>) => void
  dispose: (callback: () => unknown | Promise<unknown>) => void
}
