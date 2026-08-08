export type ChannelCommandRunStatus = 'started' | 'success' | 'denied' | 'failed'
export type ChannelCommandRunSource = 'slash' | 'natural_language' | 'system_resume' | 'approval_resume'
export type ChannelCommandRunPermission = 'everyone' | 'admin'

export interface ChannelCommandRunDbRow {
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
  source: ChannelCommandRunSource
  commandName: string
  commandPathJson: string
  rawArgsJson: string
  permission: ChannelCommandRunPermission
  status: ChannelCommandRunStatus
  startedAt: number
  completedAt: number | null
  error: string | null
  metadataJson: string | null
}

export interface ChannelCommandRunRow extends
  Omit<
    ChannelCommandRunDbRow,
    'commandPathJson' | 'metadataJson' | 'rawArgsJson'
  >
{
  commandPath: string[]
  rawArgs: string[]
  metadata: Record<string, unknown> | null
}

export const stringifyJson = (value: unknown) => {
  if (value == null) return null
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

const parseStringArray = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
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

export const mapRunRow = (row: ChannelCommandRunDbRow | undefined): ChannelCommandRunRow | undefined => {
  if (row == null) return undefined
  const { commandPathJson, metadataJson, rawArgsJson, ...stored } = row
  return {
    ...stored,
    commandPath: parseStringArray(commandPathJson),
    rawArgs: parseStringArray(rawArgsJson),
    metadata: parseMetadata(metadataJson)
  }
}
