import { parseJsonRecord, parseScopes } from './json'
import type { JsonRecord } from './json'

export type ChannelCredentialStatus = 'active' | 'needs_auth' | 'expired' | 'revoked'

export interface ChannelUserCredentialDbRow {
  issuerKey: string
  userId: string
  channelType: string
  credentialKey: string
  providerHandle: string | null
  label: string | null
  status: ChannelCredentialStatus
  scopesJson: string | null
  expiresAt: number | null
  metadataJson: string | null
  createdAt: number
  updatedAt: number
}

export interface ChannelUserCredentialRow {
  issuerKey: string
  userId: string
  channelType: string
  credentialKey: string
  providerHandle: string | null
  label: string | null
  status: ChannelCredentialStatus
  scopes: string[] | null
  expiresAt: number | null
  metadata: JsonRecord | null
  createdAt: number
  updatedAt: number
}

export interface ChannelUserCredentialInput {
  issuerKey: string
  userId: string
  channelType: string
  credentialKey: string
  providerHandle?: string | null
  label?: string | null
  status?: ChannelCredentialStatus
  scopes?: string[] | null
  expiresAt?: number | null
  metadata?: JsonRecord | null
}

const SECRET_KEY_PATTERN = /(?:access_?)?token|secret|password|private_?key|authorization/iu
const SECRET_VALUE_PATTERN = /^(?:sk-|Bearer[\s\-_]|eyJ[\w-]{8,}\.)/u
const PROVIDER_ID_PATTERN = /^[a-z0-9][\w-]{0,31}$/iu
const OPAQUE_REFERENCE_PATTERN = /^[a-zA-Z0-9][\w.~:/-]{0,191}$/u
const DISALLOWED_PROVIDER_IDS = new Set(['inline', 'raw', 'secret', 'token'])

export const assertSafeCredentialMetadata = (metadata: JsonRecord | null | undefined) => {
  const visit = (value: unknown, path: string) => {
    if (typeof value === 'string') {
      if (SECRET_VALUE_PATTERN.test(value.trim())) {
        throw new Error(`credential metadata must not contain secret-like values (${path})`)
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`))
      return
    }
    if (value != null && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) {
        if (SECRET_KEY_PATTERN.test(key)) {
          throw new Error(`credential metadata must not contain secret-like keys (${path}.${key})`)
        }
        visit(nested, `${path}.${key}`)
      }
    }
  }
  visit(metadata, 'metadata')
}

export const parseOpaqueCredentialProviderHandle = (value: string | null | undefined) => {
  const handle = value?.trim()
  if (handle == null || handle === '') return undefined
  const separator = handle.indexOf(':')
  if (separator <= 0 || separator === handle.length - 1) return undefined
  const providerId = handle.slice(0, separator)
  const reference = handle.slice(separator + 1)
  if (
    !PROVIDER_ID_PATTERN.test(providerId) ||
    DISALLOWED_PROVIDER_IDS.has(providerId.toLowerCase()) ||
    !OPAQUE_REFERENCE_PATTERN.test(reference) ||
    SECRET_VALUE_PATTERN.test(reference)
  ) return undefined
  return { providerId, reference }
}

export const assertOpaqueCredentialProviderHandle = (value: string | null | undefined) => {
  if (value == null || value.trim() === '') return
  if (parseOpaqueCredentialProviderHandle(value) == null) {
    throw new Error('credential provider handle must be a bounded opaque provider reference')
  }
}

export function mapCredentialRow(
  row: ChannelUserCredentialDbRow | undefined
): ChannelUserCredentialRow | undefined {
  if (row == null) return undefined
  return {
    issuerKey: row.issuerKey,
    userId: row.userId,
    channelType: row.channelType,
    credentialKey: row.credentialKey,
    providerHandle: row.providerHandle,
    label: row.label,
    status: row.status,
    scopes: parseScopes(row.scopesJson),
    expiresAt: row.expiresAt,
    metadata: parseJsonRecord(row.metadataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}
