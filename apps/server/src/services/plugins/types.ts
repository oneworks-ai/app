/* eslint-disable max-lines -- plugin runtime facade contracts stay colocated for host and package parity. */
import type { Buffer } from 'node:buffer'
import type { IncomingHttpHeaders } from 'node:http'

import type {
  ConfigJsonSchema,
  PluginConfigManifest,
  PluginContributionAvailability,
  PluginContributionManifest as SharedPluginContributionManifest,
  PluginLocalizedText,
  PluginNativeMetadata,
  PluginRequestPermission,
  PluginRequestPrincipal,
  PluginRuntimeApiRegistration,
  PluginRuntimeChannelInvocation,
  PluginRuntimeChannelRequest,
  PluginRuntimeEndpoint,
  PluginRuntimeSource,
  PluginRuntimeSourceGroup,
  PluginServerRuntimeRole,
  RelayRoomDescriptor,
  RelayRoomLiveRequest,
  SharedAgentRoomDirectoryEntry
} from '@oneworks/types'

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

export interface PluginCommandInvocation {
  payload?: unknown
}

export type PluginCommandHandler = (payload: unknown) => unknown | Promise<unknown>

export type PluginRuntimeChannelHandler = (
  request: PluginRuntimeChannelRequest
) => unknown | Promise<unknown>

export interface PluginProxyRequest {
  method: string
  path: string
  query: string
  headers: IncomingHttpHeaders
  body: Buffer
  principal: PluginRequestPrincipal
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
  requiredPermission?: PluginRequestPermission
}

export class PluginProxyPermissionError extends Error {
  constructor(readonly permission: PluginRequestPermission) {
    super(`Plugin API requires the "${permission}" permission.`)
    this.name = 'PluginProxyPermissionError'
  }
}

export const requirePluginRequestPermission = (
  principal: PluginRequestPrincipal | undefined,
  permission: PluginRequestPermission
) => {
  const permissions = principal?.permissions ?? []
  const allowed = permissions.includes(permission) ||
    (permission === 'workspace:read' && permissions.includes('workspace:manage'))
  if (!allowed) throw new PluginProxyPermissionError(permission)
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

export interface PluginOneWorksChannelFacade {
  createRoom: (principal: PluginRequestPrincipal, input: unknown) => Promise<unknown>
  createRoomShare: (principal: PluginRequestPrincipal, roomId: string, input: unknown) => Promise<unknown>
  createScenario: (principal: PluginRequestPrincipal, input: unknown) => Promise<unknown>
  deleteRoom: (principal: PluginRequestPrincipal, roomId: string) => Promise<boolean>
  deleteScenario: (principal: PluginRequestPrincipal, scenarioRef: string) => Promise<boolean>
  getTrace: (principal: PluginRequestPrincipal, limit?: unknown) => Promise<unknown>
  injectSimulation: (principal: PluginRequestPrincipal, input: unknown) => Promise<unknown>
  listEntities: (principal: PluginRequestPrincipal) => Promise<unknown>
  listRooms: (principal: PluginRequestPrincipal) => Promise<unknown>
  listShareOwners: (principal: PluginRequestPrincipal) => Promise<unknown>
  listShares: (principal: PluginRequestPrincipal) => Promise<unknown>
  listSharedRooms: (principal: PluginRequestPrincipal) => Promise<unknown>
  listSimulationTargets: (principal: PluginRequestPrincipal) => Promise<unknown>
  listScenarios: (principal: PluginRequestPrincipal) => Promise<unknown>
  runScenario: (principal: PluginRequestPrincipal, scenarioRef: string) => Promise<unknown>
  revokeRoomShare: (principal: PluginRequestPrincipal, roomId: string, shareRef: string) => Promise<boolean>
  updateRoom: (principal: PluginRequestPrincipal, roomId: string, input: unknown) => Promise<unknown>
  updateRoomChannelConnection: (
    principal: PluginRequestPrincipal,
    roomId: string,
    memberKey: string,
    channelLinkName: string,
    input: unknown
  ) => Promise<unknown>
  updateScenario: (principal: PluginRequestPrincipal, scenarioRef: string, input: unknown) => Promise<unknown>
}

export interface PluginRoomRelayFacade {
  handleRequest: (request: RelayRoomLiveRequest, ownerSourceId: string) => Promise<unknown>
  registerDirectoryClient: (client: {
    listVisible: () => Promise<SharedAgentRoomDirectoryEntry[]>
  }) => () => void
  registerTunnel: (
    tunnel: {
      isConnected: () => boolean
      publishDescriptor: (descriptor: RelayRoomDescriptor) => boolean
      subscribeConnection: (listener: (connected: boolean) => void) => () => void
    },
    owner: { ownerDeviceId: string; ownerLabel?: string; ownerSourceId: string; ownerUserId: string }
  ) => void
}

export interface PluginServerContext {
  scope: string
  runtime: {
    endpoint: PluginRuntimeEndpoint
    invokeChannel: (channelId: string, invocation?: PluginRuntimeChannelInvocation) => Promise<unknown>
    registerChannel: (channelId: string, handler: PluginRuntimeChannelHandler) => void
    role: PluginServerRuntimeRole
  }
  pluginRoot: string
  workspaceFolder: string
  projectHome: string
  options: Record<string, unknown>
  sessions?: PluginSessionAdapter
  oneworksChannel?: PluginOneWorksChannelFacade
  roomTunnel?: PluginRoomRelayFacade
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
