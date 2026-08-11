export type ChannelIngressRouterDecision = 'ignore' | 'observe' | 'create_child' | 'defer'

export interface ChannelIngressRouterRunDbRow {
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
  syntheticActorRole: 'admin' | 'participant' | null
  syntheticUserLabel: string | null
  decision: ChannelIngressRouterDecision
  reason: string
  confidence: number
  mode: string | null
  model: string | null
  adapter: string | null
  visibility: string | null
  candidateCount: number
  filteredCount: number
  contextCount: number
  childRunId: string | null
  error: string | null
  latencyMs: number | null
  createdAt: number
}

export type ChannelIngressRouterRunRow = ChannelIngressRouterRunDbRow
