import type { ChannelIdentityLinkRow } from './account-record'
import { parseJsonRecord } from './json'
import type { JsonRecord } from './json'

export type ChannelIdentityLinkCodeStatus = 'active' | 'consumed' | 'expired'

export interface ChannelIdentityLinkCodeDbRow {
  code: string
  userId: string
  sourceChannelType: string
  sourceAccountId: string
  status: ChannelIdentityLinkCodeStatus
  createdAt: number
  expiresAt: number
  consumedAt: number | null
  consumedChannelType: string | null
  consumedAccountId: string | null
  metadataJson: string | null
}

export interface ChannelIdentityLinkCodeRow {
  code: string
  userId: string
  sourceChannelType: string
  sourceAccountId: string
  status: ChannelIdentityLinkCodeStatus
  createdAt: number
  expiresAt: number
  consumedAt: number | null
  consumedChannelType: string | null
  consumedAccountId: string | null
  metadata: JsonRecord | null
}

export type ChannelIdentityLinkCodeConsumeStatus =
  | 'consumed'
  | 'already_linked'
  | 'conflict'
  | 'expired'
  | 'not_active'
  | 'not_found'

export interface ChannelIdentityLinkCodeConsumeResult {
  code?: ChannelIdentityLinkCodeRow
  existingLink?: ChannelIdentityLinkRow
  link?: ChannelIdentityLinkRow
  status: ChannelIdentityLinkCodeConsumeStatus
}

export interface IdentityLinkCodeInput {
  code?: string | null
  userId: string
  sourceChannelType: string
  sourceAccountId: string
  expiresAt: number
  metadata?: JsonRecord | null
}

export interface IdentityLinkCodeConsumeInput {
  code: string
  targetAccountId: string
  targetChannelType: string
}

export interface IdentityLinkCodeUpdates {
  consumedAccountId?: string | null
  consumedAt?: number | null
  consumedChannelType?: string | null
  status: ChannelIdentityLinkCodeStatus
}

export function mapIdentityLinkCodeRow(
  row: ChannelIdentityLinkCodeDbRow | undefined
): ChannelIdentityLinkCodeRow | undefined {
  if (row == null) return undefined
  return {
    code: row.code,
    userId: row.userId,
    sourceChannelType: row.sourceChannelType,
    sourceAccountId: row.sourceAccountId,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    consumedChannelType: row.consumedChannelType,
    consumedAccountId: row.consumedAccountId,
    metadata: parseJsonRecord(row.metadataJson)
  }
}
