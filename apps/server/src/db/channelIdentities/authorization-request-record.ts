import { parseJsonRecord } from './json'
import type { JsonRecord } from './json'

export type ChannelAuthorizationRequestStatus = 'pending' | 'granted' | 'denied' | 'expired'

export interface ChannelAuthorizationRequestDbRow {
  id: string
  channelType: string
  channelLinkName: string | null
  requesterUserId: string | null
  requesterAccountId: string | null
  credentialSubjectUserId: string | null
  credentialKey: string | null
  capability: string
  status: ChannelAuthorizationRequestStatus
  message: string | null
  metadataJson: string | null
  createdAt: number
  updatedAt: number
  expiresAt: number | null
  resolvedAt: number | null
}

export interface ChannelAuthorizationRequestRow {
  id: string
  channelType: string
  channelLinkName: string | null
  requesterUserId: string | null
  requesterAccountId: string | null
  credentialSubjectUserId: string | null
  credentialKey: string | null
  capability: string
  status: ChannelAuthorizationRequestStatus
  message: string | null
  metadata: JsonRecord | null
  createdAt: number
  updatedAt: number
  expiresAt: number | null
  resolvedAt: number | null
}

export interface AuthorizationRequestInput {
  id?: string | null
  channelType: string
  channelLinkName?: string | null
  requesterUserId?: string | null
  requesterAccountId?: string | null
  credentialSubjectUserId?: string | null
  credentialKey?: string | null
  capability: string
  status?: ChannelAuthorizationRequestStatus
  message?: string | null
  metadata?: JsonRecord | null
  expiresAt?: number | null
}

export interface AuthorizationRequestUpdates {
  status?: ChannelAuthorizationRequestStatus
  message?: string | null
  metadata?: JsonRecord | null
  expiresAt?: number | null
  resolvedAt?: number | null
}

export function mapAuthorizationRequestRow(
  row: ChannelAuthorizationRequestDbRow | undefined
): ChannelAuthorizationRequestRow | undefined {
  if (row == null) return undefined
  return {
    id: row.id,
    channelType: row.channelType,
    channelLinkName: row.channelLinkName,
    requesterUserId: row.requesterUserId,
    requesterAccountId: row.requesterAccountId,
    credentialSubjectUserId: row.credentialSubjectUserId,
    credentialKey: row.credentialKey,
    capability: row.capability,
    status: row.status,
    message: row.message,
    metadata: parseJsonRecord(row.metadataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
    resolvedAt: row.resolvedAt
  }
}
