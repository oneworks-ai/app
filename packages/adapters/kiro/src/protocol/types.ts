import type { ChildProcessWithoutNullStreams } from 'node:child_process'

export type KiroAcpProcess = ChildProcessWithoutNullStreams

export interface AcpError {
  code: number
  data?: unknown
  message: string
}

export interface AcpMessage {
  error?: AcpError
  id?: number | string
  jsonrpc: '2.0'
  method?: string
  params?: unknown
  result?: unknown
}

export interface AcpInitializeResult {
  agentCapabilities?: {
    loadSession?: boolean
    sessionCapabilities?: {
      additionalDirectories?: unknown
      close?: unknown
      resume?: unknown
    }
  }
  agentInfo?: {
    name?: string
    version?: string
  }
  protocolVersion?: number
}

export interface AcpSessionResult {
  configOptions?: unknown[]
  modes?: {
    availableModes?: Array<{ id?: string; name?: string }>
    currentModeId?: string
  }
  models?: {
    availableModels?: Array<{ modelId?: string; name?: string }>
    currentModelId?: string
  }
  sessionId?: string
}

export interface AcpSessionUpdateParams {
  sessionId?: string
  update?: Record<string, unknown>
}
