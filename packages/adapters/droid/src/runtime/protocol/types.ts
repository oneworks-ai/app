import type { ChildProcessWithoutNullStreams } from 'node:child_process'

export const FACTORY_API_VERSION = '1.0.0'
export const FACTORY_PROTOCOL_VERSION = '1.151.0'

export interface FactoryEnvelopeBase {
  jsonrpc: '2.0'
  factoryApiVersion: string
  factoryProtocolVersion: string
}

export interface FactoryRequest extends FactoryEnvelopeBase {
  type: 'request'
  id: string
  method: string
  params?: Record<string, unknown>
}

export interface FactoryResponse extends FactoryEnvelopeBase {
  type: 'response'
  id: string
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

export interface FactoryNotification extends FactoryEnvelopeBase {
  type: 'notification'
  method: string
  params?: Record<string, unknown>
}

export type FactoryIncoming = FactoryRequest | FactoryResponse | FactoryNotification
export type DroidProcess = ChildProcessWithoutNullStreams

export interface DroidMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: Array<Record<string, unknown>>
  createdAt?: number | string
  updatedAt?: number | string
  parentId?: string
}

export interface DroidInitializeResult {
  sessionId: string
  session: { messages: DroidMessage[]; title?: string }
  settings: { modelId?: string; reasoningEffort?: string }
  availableModels?: Array<{ modelId?: string; displayName?: string }>
}
