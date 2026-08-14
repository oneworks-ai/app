import type { AdapterOutputEvent, EffortLevel } from '@oneworks/types'

export interface JunieProtocolDiagnostic {
  code: 'duplicate_terminal' | 'post_terminal_event' | 'unknown_event'
  eventType?: string
  line?: number
  message: string
}

export interface JunieJsonStreamParserOptions {
  effort?: EffortLevel
  expectedSessionId?: string
  model?: string
  onDiagnostic: (diagnostic: JunieProtocolDiagnostic) => void
  onEvent: (event: AdapterOutputEvent) => void
  onSessionId: (sessionId: string) => void
}

export interface JunieJsonStreamParserResult {
  didFatalError: boolean
  didResult: boolean
  didStop: boolean
  eventCount: number
  sessionId?: string
}
