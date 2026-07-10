export const RELAY_CONFIG_SAFE_FIELDS = [
  'modelServices',
  'recommendedModels',
  'plugins',
  'marketplaces',
  'skills',
  'skillsMeta',
  'skillRegistries',
  'adapters'
] as const

export type RelayConfigSafeField = typeof RELAY_CONFIG_SAFE_FIELDS[number]

export const RELAY_TEAM_CONFIG_SAFE_FIELDS = RELAY_CONFIG_SAFE_FIELDS.filter(field => field !== 'adapters')

export interface RelayConfigPatch {
  adapters?: Record<string, unknown>
  marketplaces?: Record<string, unknown>
  modelServices?: Record<string, unknown>
  plugins?: unknown[] | Record<string, unknown>
  recommendedModels?: unknown[]
  skillRegistries?: unknown[] | Record<string, unknown>
  skills?: unknown[] | Record<string, unknown>
  skillsMeta?: Record<string, unknown>
  [key: string]: unknown
}

export interface RelayConfigProjectRule {
  allow?: string[]
  deny?: string[]
}

export interface RelayConfigSnapshotProvenance {
  assignmentId: string
  fields: RelayConfigSafeField[]
  mode: 'default' | 'override'
  profileId: string
  profileName: string
  teamId: string
  teamName?: string
  version: number
  versionId: string
}

export interface RelayConfigAssignment {
  allowedFields?: RelayConfigSafeField[]
  configPatch?: RelayConfigPatch
  enabled?: boolean
  id: string
  mustRefreshAfter?: string
  project?: RelayConfigProjectRule
  provenance?: RelayConfigSnapshotProvenance
  ruleIds?: string[]
  rules?: string[] | RelayConfigAssignment[]
  secrets?: RelayConfigSnapshotSecretEnvelope[]
  updatedAt?: string
  version?: string
}

export interface RelayConfigSnapshotSecretEnvelope {
  algorithm: 'aes-256-gcm'
  ciphertext: string
  expiresAt: string
  iv: string
  keyId: string
  recipientDeviceId: string
  ref: string
  secretId: string
  secretVersion: number
  tag: string
  version: 1
}

export interface RelayConfigSnapshot {
  account?: {
    email?: string
    id?: string
    name?: string
  }
  assignments?: RelayConfigAssignment[]
  hash?: string
  lastAppliedAt?: string | null
  lastError?: string | null
  lastSyncedAt?: string | null
  matchedProject?: boolean | string | null
  rules?: RelayConfigAssignment[]
  sourceServerId?: string
  team?: {
    id?: string
    name?: string
  }
  updatedAt?: string
  version: string
}

export interface RelayConfigProjectContext {
  cwd?: string
  gitRepositories?: string[]
  projectId?: string
  projectName?: string
  workspaceFolder?: string
}

export interface RelayResolvedConfigPatch {
  allowedFields: RelayConfigSafeField[]
  matchedAssignmentIds: string[]
  patch?: RelayConfigPatch
}
