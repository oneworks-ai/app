export type ChannelChildSessionRunStatus =
  | 'started'
  | 'dispatched'
  | 'running'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'expired'
export type ChannelChildSessionRunTriggerType = 'message' | 'message_batch' | 'system_resume'
export type ChannelChildSessionRunDispatchMode = 'create_session' | 'continue_session'

export interface ChannelChildSessionRunDbRow {
  id: string
  channelType: string
  channelKey: string
  channelId: string
  sessionType: string
  channelLinkName: string | null
  entity: string | null
  actorUserId: string | null
  actorAccountId: string | null
  senderId: string | null
  messageId: string | null
  sessionId: string | null
  conversationStateId: string | null
  threadKey: string | null
  triggerType: ChannelChildSessionRunTriggerType
  dispatchMode: ChannelChildSessionRunDispatchMode
  status: ChannelChildSessionRunStatus
  startedAt: number
  completedAt: number | null
  memorySnapshotId: string | null
  continuitySnapshotJson: string | null
  error: string | null
  metadataJson: string | null
}

export interface ChannelChildSessionRunRow extends Omit<ChannelChildSessionRunDbRow, 'metadataJson'> {
  metadata: Record<string, unknown> | null
  continuitySnapshot: Record<string, unknown> | null
}

export const stringifyJson = (value: unknown) => {
  if (value == null) return null
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

const parseMetadata = (value: string | null): Record<string, unknown> | null => {
  if (value == null || value === '') return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export const mapRunRow = (row: ChannelChildSessionRunDbRow | undefined): ChannelChildSessionRunRow | undefined => {
  if (row == null) return undefined
  const { metadataJson, ...stored } = row
  return {
    ...stored,
    metadata: parseMetadata(metadataJson),
    continuitySnapshot: parseMetadata(row.continuitySnapshotJson)
  }
}
