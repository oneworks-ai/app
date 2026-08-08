import { parseJsonRecord, parseScopes } from './json'
import type { JsonRecord } from './json'

export type ChannelCredentialStatus = 'active' | 'needs_auth' | 'expired' | 'revoked'

export interface ChannelUserCredentialDbRow {
  userId: string
  channelType: string
  credentialKey: string
  label: string | null
  status: ChannelCredentialStatus
  scopesJson: string | null
  expiresAt: number | null
  metadataJson: string | null
  createdAt: number
  updatedAt: number
}

export interface ChannelUserCredentialRow {
  userId: string
  channelType: string
  credentialKey: string
  label: string | null
  status: ChannelCredentialStatus
  scopes: string[] | null
  expiresAt: number | null
  metadata: JsonRecord | null
  createdAt: number
  updatedAt: number
}

export interface ChannelUserCredentialInput {
  userId: string
  channelType: string
  credentialKey: string
  label?: string | null
  status?: ChannelCredentialStatus
  scopes?: string[] | null
  expiresAt?: number | null
  metadata?: JsonRecord | null
}

export function mapCredentialRow(
  row: ChannelUserCredentialDbRow | undefined
): ChannelUserCredentialRow | undefined {
  if (row == null) return undefined
  return {
    userId: row.userId,
    channelType: row.channelType,
    credentialKey: row.credentialKey,
    label: row.label,
    status: row.status,
    scopes: parseScopes(row.scopesJson),
    expiresAt: row.expiresAt,
    metadata: parseJsonRecord(row.metadataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}
