import type { ChildProcessWithoutNullStreams } from 'node:child_process'

export interface PiRpcCommand {
  id?: string
  type: string
  [key: string]: unknown
}

export interface PiRpcResponse {
  command: string
  data?: unknown
  error?: string
  id?: string
  success: boolean
  type: 'response'
}

export interface PiRpcEvent {
  type: string
  [key: string]: unknown
}

export interface PiRpcSessionState {
  isCompacting?: boolean
  isStreaming?: boolean
  messageCount?: number
  model?: { id?: string; provider?: string }
  sessionId?: string
  sessionName?: string
  thinkingLevel?: string
}

export type PiProcess = ChildProcessWithoutNullStreams
