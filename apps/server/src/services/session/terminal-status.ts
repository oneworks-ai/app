import type { SessionStatus } from '@oneworks/core'

export type SessionTerminalStatus = Extract<SessionStatus, 'completed' | 'failed' | 'terminated'>

export const isPreservedSessionTerminalStatus = (
  status: SessionStatus | undefined
): status is Extract<SessionTerminalStatus, 'failed' | 'terminated'> => (
  status === 'failed' || status === 'terminated'
)

export const resolveSessionTerminalStatus = (
  currentStatus: SessionStatus | undefined,
  exitCode = 0
): SessionTerminalStatus => {
  if (isPreservedSessionTerminalStatus(currentStatus)) return currentStatus
  return exitCode === 0 ? 'completed' : 'failed'
}
