import { parseJson } from './json'

export type ChannelPolicyScope = 'account' | 'user'
export type ChannelPolicyState = 'normal' | 'warned' | 'muted_until' | 'muted_permanent'

export interface ChannelPolicyStateRow {
  policyKey: string
  channelLinkName: string
  scope: ChannelPolicyScope
  subjectKey: string
  state: ChannelPolicyState
  reason: string | null
  hits: number
  hitWindowStartedAt: number | null
  mutedUntil: number | null
  revision: number
  updatedBy: string
  updatedAt: number
}

export interface ChannelPolicyEventRow {
  id: string
  eventKey: string
  policyKey: string | null
  channelLinkName: string
  eventType: string
  actorUserId: string | null
  actorAccountId: string | null
  metadata: Record<string, unknown> | null
  createdAt: number
}

export interface ChannelPolicyEventDbRow extends Omit<ChannelPolicyEventRow, 'metadata'> {
  metadataJson: string | null
}

export const mapPolicyEventRow = (row: ChannelPolicyEventDbRow | undefined): ChannelPolicyEventRow | undefined => {
  if (row == null) return undefined
  const metadata = parseJson(row.metadataJson)
  return {
    ...row,
    metadata: metadata != null && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata as Record<string, unknown>
      : null
  }
}
