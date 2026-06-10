import { DEFAULT_SUPPORTED_PROTOCOL_RANGE, getCurrentProtocolVersion } from '@oneworks/runtime-protocol'
import type {
  RuntimeCommand,
  RuntimeEvent,
  RuntimeEventDraft,
  RuntimeHeartbeat,
  RuntimeMeta,
  RuntimeState
} from '@oneworks/runtime-protocol'

export const DEFAULT_RUNTIME_PROTOCOL_VERSION = getCurrentProtocolVersion()
export { DEFAULT_SUPPORTED_PROTOCOL_RANGE }

export type RuntimeJsonObject = Record<string, unknown>

export type { RuntimeCommand, RuntimeEvent, RuntimeEventDraft, RuntimeHeartbeat, RuntimeMeta, RuntimeState }

export interface RuntimeIndexSession extends RuntimeJsonObject {
  storePath: string
  cwd?: string
  status?: string
  updatedAt: number
}

export interface RuntimeIndex extends RuntimeJsonObject {
  protocolVersion: string
  sessions: Record<string, RuntimeIndexSession>
}

export interface RuntimeOwnerMetadata extends RuntimeJsonObject {
  runtimeId: string
  pid?: number
  host?: string
  createdAt: number
  updatedAt: number
}

export type RuntimeLockName =
  | 'runtime-owner'
  | 'commands.append'
  | 'events.append'
  | 'state.write'
