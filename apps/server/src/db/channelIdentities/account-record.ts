import { parseJsonRecord } from './json'
import type { JsonRecord } from './json'

export type ChannelIdentityLinkStatus = 'pending' | 'verified' | 'revoked'

export interface ChannelAccountDbRow {
  channelType: string
  accountId: string
  accountKey: string
  displayName: string | null
  avatarUrl: string | null
  metadataJson: string | null
  createdAt: number
  updatedAt: number
}

export interface ChannelAccountRow {
  channelType: string
  accountId: string
  accountKey: string
  displayName: string | null
  avatarUrl: string | null
  metadata: JsonRecord | null
  createdAt: number
  updatedAt: number
}

export interface CanonicalUserRow {
  id: string
  displayName: string | null
  createdAt: number
  updatedAt: number
}

export interface ChannelIdentityLinkRow {
  channelType: string
  accountId: string
  userId: string
  status: ChannelIdentityLinkStatus
  source: string | null
  createdAt: number
  updatedAt: number
}

export interface ChannelAccountInput {
  channelType: string
  accountId: string
  accountKey?: string | null
  displayName?: string | null
  avatarUrl?: string | null
  metadata?: JsonRecord | null
}

export interface CanonicalUserInput {
  id?: string | null
  displayName?: string | null
}

export interface ChannelIdentityLinkInput {
  channelType: string
  accountId: string
  userId: string
  status?: ChannelIdentityLinkStatus
  source?: string | null
}

export function mapAccountRow(row: ChannelAccountDbRow | undefined): ChannelAccountRow | undefined {
  if (row == null) return undefined
  return {
    channelType: row.channelType,
    accountId: row.accountId,
    accountKey: row.accountKey,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    metadata: parseJsonRecord(row.metadataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}
