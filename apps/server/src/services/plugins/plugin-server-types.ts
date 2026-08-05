import type { Buffer } from 'node:buffer'
import type { IncomingHttpHeaders } from 'node:http'

import type {
  ConfigJsonSchema,
  PluginLocalizedText,
  PluginRuntimeChannelInvocation,
  PluginRuntimeChannelRequest,
  PluginRuntimeEndpoint,
  PluginServerRuntimeRole
} from '@oneworks/types'

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
