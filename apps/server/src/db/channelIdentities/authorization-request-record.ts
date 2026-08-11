import { parseJsonRecord } from './json'
import type { JsonRecord } from './json'

export type ChannelAuthorizationRequestStatus = 'pending' | 'granted' | 'denied' | 'expired'

export interface ChannelAuthorizationRequestDbRow {
  id: string
  channelType: string
  issuerKey: string | null
  channelKey: string | null
  channelId: string | null
  channelLinkName: string | null
  requesterUserId: string | null
  requesterAccountId: string | null
  credentialSubjectUserId: string | null
  credentialKey: string | null
  allowedApproversJson: string | null
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
  issuerKey: string | null
  channelKey: string | null
  channelId: string | null
  channelLinkName: string | null
  requesterUserId: string | null
  requesterAccountId: string | null
  credentialSubjectUserId: string | null
  credentialKey: string | null
  allowedApprovers: string[]
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
  issuerKey?: string | null
  channelKey?: string | null
  channelId?: string | null
  channelLinkName?: string | null
  requesterUserId?: string | null
  requesterAccountId?: string | null
  credentialSubjectUserId?: string | null
  credentialKey?: string | null
  allowedApprovers?: string[]
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
  allowedApprovers?: string[]
}

const isTypedApproverPrincipal = (value: string) => (
  /^user:[^:\s]+$/u.test(value) || /^account:\S+:[^:\s]+$/u.test(value)
)

export const validateAllowedApprovers = (value: readonly string[] | undefined) => {
  const normalized = [...new Set((value ?? []).map(item => item.trim()))]
  if (normalized.some(item => !isTypedApproverPrincipal(item))) {
    throw new Error('allowed approvers must use user:<canonicalUserId> or account:<issuerKey>:<accountId>')
  }
  return normalized
}

const parseJsonStringArray = (value: string | null) => {
  if (value == null || value === '') return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? [
        ...new Set(
          parsed.filter((item): item is string => typeof item === 'string' && isTypedApproverPrincipal(item.trim()))
            .map(item => item.trim())
        )
      ]
      : []
  } catch {
    return []
  }
}

export function mapAuthorizationRequestRow(
  row: ChannelAuthorizationRequestDbRow | undefined
): ChannelAuthorizationRequestRow | undefined {
  if (row == null) return undefined
  return {
    id: row.id,
    channelType: row.channelType,
    issuerKey: row.issuerKey,
    channelKey: row.channelKey,
    channelId: row.channelId,
    channelLinkName: row.channelLinkName,
    requesterUserId: row.requesterUserId,
    requesterAccountId: row.requesterAccountId,
    credentialSubjectUserId: row.credentialSubjectUserId,
    credentialKey: row.credentialKey,
    allowedApprovers: parseJsonStringArray(row.allowedApproversJson),
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
