export const RELAY_CONFIG_SAFE_FIELDS = [
  'defaultModelService',
  'modelServices',
  'recommendedModels'
] as const

export type RelayConfigSafeField = typeof RELAY_CONFIG_SAFE_FIELDS[number]

export interface RelayConfigPatch {
  defaultModelService?: string
  modelServices?: Record<string, unknown>
  recommendedModels?: unknown[]
  [key: string]: unknown
}

export interface RelayConfigProjectRule {
  allow?: string[]
  deny?: string[]
}

export interface RelayConfigAssignment {
  allowedFields?: RelayConfigSafeField[]
  configPatch?: RelayConfigPatch
  enabled?: boolean
  id: string
  project?: RelayConfigProjectRule
  ruleIds?: string[]
  rules?: string[] | RelayConfigAssignment[]
  updatedAt?: string
  version?: string
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
  projectId?: string
  projectName?: string
  workspaceFolder?: string
}

export interface RelayResolvedConfigPatch {
  allowedFields: RelayConfigSafeField[]
  matchedAssignmentIds: string[]
  patch?: RelayConfigPatch
}
