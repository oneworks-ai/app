export type ChannelMemorySubjectType = 'account' | 'canonical_user' | 'channel' | 'conversation' | 'entity' | 'room'
export type ChannelMemorySensitivity = 'normal' | 'sensitive'

export interface ChannelMemoryVisibility {
  channels?: string[]
  conversationTypes?: string[]
  entities?: string[]
  orgs?: string[]
  rooms?: string[]
}

export interface ChannelMemorySource {
  channelId?: string
  channelKey?: string
  channelType?: string
  issuer: string
  org: string
  roomId?: string
  sessionType: string
}

export interface ChannelMemoryMetadata {
  sourceChildRunId?: string
  sourceMessageId?: string
}

export interface ChannelMemoryDbRow {
  id: string
  issuer: string
  orgId: string
  subjectType: ChannelMemorySubjectType
  subjectId: string
  sourceJson: string
  channelKey: string | null
  channelId: string | null
  entity: string | null
  canonicalUserId: string | null
  accountId: string | null
  roomId: string | null
  threadKey: string | null
  sensitivity: ChannelMemorySensitivity
  visibilityJson: string | null
  keywordsJson: string | null
  content: string
  importance: number
  confidence: number
  pinned: number
  createdAt: number
  updatedAt: number
  expiresAt: number | null
  metadataJson: string | null
}

export interface ChannelMemoryRow
  extends Omit<ChannelMemoryDbRow, 'metadataJson' | 'keywordsJson' | 'pinned' | 'sourceJson' | 'visibilityJson'>
{
  keywords: string[]
  metadata: ChannelMemoryMetadata | null
  pinned: boolean
  visibility: ChannelMemoryVisibility | null
  source: ChannelMemorySource | null
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const parseStringArray = (value: string | null) => {
  if (value == null) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

const parseVisibility = (value: string | null): ChannelMemoryVisibility | null => {
  if (value == null) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) return null
    const source = parsed
    return {
      channels: Array.isArray(source.channels)
        ? source.channels.filter((item): item is string => typeof item === 'string')
        : undefined,
      conversationTypes: Array.isArray(source.conversationTypes)
        ? source.conversationTypes.filter((item): item is string => typeof item === 'string')
        : undefined,
      entities: Array.isArray(source.entities)
        ? source.entities.filter((item): item is string => typeof item === 'string')
        : undefined,
      orgs: Array.isArray(source.orgs)
        ? source.orgs.filter((item): item is string => typeof item === 'string')
        : undefined,
      rooms: Array.isArray(source.rooms)
        ? source.rooms.filter((item): item is string => typeof item === 'string')
        : undefined
    }
  } catch {
    return null
  }
}

const parseSource = (value: string): ChannelMemorySource | null => {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) return null
    const source = parsed
    if (
      typeof source.issuer !== 'string' ||
      typeof source.org !== 'string' ||
      typeof source.sessionType !== 'string'
    ) return null
    return {
      channelId: typeof source.channelId === 'string' ? source.channelId : undefined,
      channelKey: typeof source.channelKey === 'string' ? source.channelKey : undefined,
      channelType: typeof source.channelType === 'string' ? source.channelType : undefined,
      issuer: source.issuer,
      org: source.org,
      roomId: typeof source.roomId === 'string' ? source.roomId : undefined,
      sessionType: source.sessionType
    }
  } catch {
    return null
  }
}

const parseMetadata = (value: string | null): ChannelMemoryMetadata | null => {
  if (value == null) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) return null
    const source = parsed
    return {
      sourceChildRunId: typeof source.sourceChildRunId === 'string' ? source.sourceChildRunId : undefined,
      sourceMessageId: typeof source.sourceMessageId === 'string' ? source.sourceMessageId : undefined
    }
  } catch {
    return null
  }
}

export const mapChannelMemoryRow = (row: ChannelMemoryDbRow | undefined): ChannelMemoryRow | undefined => {
  if (row == null) return undefined
  const { keywordsJson, metadataJson, pinned, sourceJson, visibilityJson, ...stored } = row
  return {
    ...stored,
    keywords: parseStringArray(keywordsJson),
    metadata: parseMetadata(metadataJson),
    pinned: pinned === 1,
    source: parseSource(sourceJson),
    visibility: parseVisibility(visibilityJson)
  }
}
